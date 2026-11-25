import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { availableParallelism, totalmem } from 'node:os';
import { join } from 'node:path';
import { createResponseMemoryCache } from './media-memory-cache.mjs';

const CACHE_VERSION = 'v1';
const HISTORY_THUMBNAIL_CACHE_VERSION = 'v2';
const CACHE_DIR = join(process.env.NAI_RESOURCE_ROOT || join(process.cwd(), 'local-cache'), 'thumbnails');
const CACHE_INDEX = join(CACHE_DIR, 'index.json');
const CACHE_LIMIT = 1024 * 1024 * 1024;
const CACHE_PRUNE_TARGET = 900 * 1024 * 1024;
// pinned 封面缓存总量上限：封面单张数十 KB，正常画师/角色数量级远达不到；
// 一旦超过（如目录被批量刷新）按最久未访问淘汰，避免 pinned 无界增长
// 反噬普通缩略图缓存（prune 目标永不达成）和磁盘占用。
const PIN_CACHE_LIMIT = 256 * 1024 * 1024;
const PIN_CACHE_TARGET = 200 * 1024 * 1024;

export const THUMB_WIDTHS = new Map([
  ['thumb-160', 160],
  ['thumb-240', 240],
  ['thumb-320', 320],
  ['thumb-480', 480],
  ['thumb-640', 640],
  ['thumb-960', 960],
]);

export const selectThumbnailConcurrency = ({
  logicalProcessors = availableParallelism(),
  totalMemoryBytes = totalmem(),
} = {}) => {
  const memoryGb = totalMemoryBytes / (1024 ** 3);
  // 档位按"网络抓取为瓶颈"标定：远端图片单张 0.8-3s 纯 I/O 等待，sharp 缩放
  // （≤960px webp，effort 3-4）每张仅几十毫秒，按 CPU 保守分档会卡错资源，
  // 一页 40 张图在 4 并发下要 10s+ 才能填满。CPU 占用仍受档位上限约束。
  if (logicalProcessors >= 16 && memoryGb >= 24) return 16;
  if (logicalProcessors >= 12 && memoryGb >= 16) return 12;
  if (logicalProcessors >= 8 && memoryGb >= 12) return 8;
  return 4;
};

export const THUMBNAIL_JOB_CONCURRENCY = selectThumbnailConcurrency();

const PREWARM_CONCURRENCY = 2;
const PREWARM_MAX_PENDING = 300;

/** 图库低优先级预热：按实际缩略图档位入队，同来源共享任务；页面离开撤销未启动租约。 */
export const createThumbnailPreWarmer = ({ cache, loadOriginal, concurrency = PREWARM_CONCURRENCY, maxPending = PREWARM_MAX_PENDING } = {}) => {
  const pending = new Map();
  const running = new Map();
  const owners = new Map();
  let scheduled = false;
  const isNeeded = task => task.leases.size > 0;
  const pump = () => {
    scheduled = false;
    while (running.size < concurrency && pending.size) {
      const task = [...pending.values()].sort((a, b) => a.priority - b.priority)[0];
      pending.delete(task.key);
      if (!isNeeded(task)) continue;
      running.set(task.key, task);
      // cache.get 调用零参数闭包，来源必须在此绑定，不能直接传入需要 source 的函数。
      Promise.resolve().then(() => cache.get(task.source, task.variant, () => loadOriginal(task.source), { pinned: task.pinned, priority: task.priority }))
        .catch(() => {}).finally(() => { running.delete(task.key); pump(); });
    }
  };
  const schedule = () => { if (!scheduled) { scheduled = true; setImmediate(pump); } };
  return {
    enqueue(sources, { pinned = false, variant = 'thumb-320', owner = '', generation = 0, priority = 2 } = {}) {
      if (!THUMB_WIDTHS.has(variant)) return 0;
      const state = owners.get(owner);
      if (owner && state && (generation < state.generation || (generation === state.generation && state.cancelled))) return 0;
      if (owner) {
        owners.delete(owner); owners.set(owner, { generation, cancelled: false });
        while (owners.size > 1024) owners.delete(owners.keys().next().value);
      }
      let added = 0;
      for (const source of sources) {
        if (pinned ? cache.isPinned(source, variant) : cache.has(source, variant)) continue;
        const key = JSON.stringify([source, variant, pinned]);
        let task = pending.get(key) || running.get(key);
        if (!task) {
          if (pending.size >= maxPending) break;
          task = { key, source, variant, pinned, priority, leases: new Map() };
          pending.set(key, task); added++;
        }
        task.priority = Math.min(task.priority, priority);
        task.leases.set(owner, generation);
      }
      if (pending.size) schedule();
      return added;
    },
    cancel(owner, generation) {
      if (!owner) return;
      const state = owners.get(owner);
      if (!state || generation >= state.generation) owners.set(owner, { generation, cancelled: true });
      while (owners.size > 1024) owners.delete(owners.keys().next().value);
      for (const task of pending.values()) {
        if ((task.leases.get(owner) ?? Infinity) <= generation) task.leases.delete(owner);
        if (!isNeeded(task)) pending.delete(task.key);
      }
    },
    get pendingCount() { return pending.size; },
  };
};

const getArtistSamplePreviewCrop = async image => {
  const metadata = await image.metadata();
  if (metadata.format !== 'jpeg' || metadata.width !== 768 || metadata.height !== 768 || metadata.hasAlpha
    || (metadata.orientation && metadata.orientation !== 1)) return null;
  const { data, info } = await image.clone().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 768 || info.height !== 768 || info.channels !== 3) return null;
  // shortcut: 仅支持已核实的 768 方形 JPEG、79px 纯黑列及左85/右86px内的压缩过渡，图包换规格时重新抽样，不追裁深色画面。
  for (let y = 0; y < 768; y++) {
    for (let x = 0; x < 79; x++) {
      const left = (y * 768 + x) * 3, right = (y * 768 + 767 - x) * 3;
      if (data[left] || data[left + 1] || data[left + 2] || data[right] || data[right + 1] || data[right + 2]) return null;
    }
  }
  const contentEdge = (right, limit) => {
    for (let offset = 79; offset <= limit; offset++) {
      for (let y = 0; y < 768; y++) {
        const pixel = (y * 768 + (right ? 767 - offset : offset)) * 3;
        if (Math.max(data[pixel], data[pixel + 1], data[pixel + 2]) > 32) return offset;
      }
    }
    return 79;
  };
  const left = contentEdge(false, 85), right = contentEdge(true, 86);
  for (let y = 0; y < 768; y++) {
    for (let x = 79; x < 689; x++) {
      const pixel = (y * 768 + x) * 3;
      if (data[pixel] || data[pixel + 1] || data[pixel + 2]) return { left, top: 0, width: 768 - left - right, height: 768 };
    }
  }
  return null;
};

export class ThumbnailCache {
  constructor(concurrency = THUMBNAIL_JOB_CONCURRENCY) {
    this.entries = {};
    this.inFlight = new Map();
    this.sourceMemoryCache = createResponseMemoryCache({ maxEntries: 16, maxBytes: 32 * 1024 * 1024 });
    this.activeJobs = 0;
    this.concurrency = concurrency;
    this.jobQueue = [];
    this.writeTimer = null;
    this.indexWritePromise = Promise.resolve();
  }

  async init() {
    await mkdir(CACHE_DIR, { recursive: true });
    try { this.entries = JSON.parse(await readFile(CACHE_INDEX, 'utf8')); } catch { this.entries = {}; }
    const files = new Set(await readdir(CACHE_DIR));
    const referencedFiles = new Set();
    for (const [key, entry] of Object.entries(this.entries)) {
      if (!entry?.file || !files.has(entry.file)) delete this.entries[key];
      else referencedFiles.add(entry.file);
    }
    for (const file of files) {
      if (file === 'index.json') continue;
      if (file.endsWith('.tmp')) {
        await unlink(join(CACHE_DIR, file)).catch(() => {});
        continue;
      }
      if (!referencedFiles.has(file)) await unlink(join(CACHE_DIR, file)).catch(() => {});
    }
    this.scheduleIndexWrite();
  }

  scheduleIndexWrite() {
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      const snapshot = `${JSON.stringify(this.entries)}\n`;
      this.indexWritePromise = this.indexWritePromise.catch(() => {}).then(async () => {
        const temporary = `${CACHE_INDEX}.${process.pid}.tmp`;
        await writeFile(temporary, snapshot, 'utf8');
        await rename(temporary, CACHE_INDEX);
      }).catch(() => {});
    }, 500);
    this.writeTimer.unref?.();
  }

  async withJobSlot(task, priority = 0) {
    // 循环等待而非一次判断：被唤醒者恢复执行前，并发的早到调用可能已把槽位占满，
    // 单次 if 会短暂突破并发上限（sharp 内存尖峰）
    while (this.activeJobs >= this.concurrency) {
      await new Promise(resolve => { this.jobQueue.push({ resolve, priority }); this.jobQueue.sort((a, b) => a.priority - b.priority); });
    }
    this.activeJobs++;
    try { return await task(); } finally {
      this.activeJobs--;
      this.jobQueue.shift()?.resolve();
    }
  }

  async prune() {
    // 先约束 pinned 总量：超过上限时按最久未访问淘汰固定封面
    let pinnedTotal = Object.values(this.entries).reduce((sum, entry) => entry.pinned ? sum + Number(entry.size || 0) : sum, 0);
    if (pinnedTotal > PIN_CACHE_LIMIT) {
      const pinnedOldest = Object.entries(this.entries)
        .filter(([, entry]) => entry.pinned)
        .sort((a, b) => Number(a[1].accessedAt || 0) - Number(b[1].accessedAt || 0));
      for (const [key, entry] of pinnedOldest) {
        await unlink(join(CACHE_DIR, entry.file)).catch(() => {});
        pinnedTotal -= Number(entry.size || 0);
        delete this.entries[key];
        if (pinnedTotal <= PIN_CACHE_TARGET) break;
      }
      console.warn(`[cache] pinned 封面缓存超过 ${PIN_CACHE_LIMIT >> 20}MB 上限，已按最久未访问淘汰到 ${PIN_CACHE_TARGET >> 20}MB 以内`);
      this.scheduleIndexWrite();
    }

    let total = Object.values(this.entries).reduce((sum, entry) => sum + Number(entry.size || 0), 0);
    if (total <= CACHE_LIMIT) return;
    // 只淘汰普通（非固定）缩略图；pinned 封面图（画师/角色 Tag 当前封面）永久保留，
    // 不受 1GB 容量限制影响。
    const oldest = Object.entries(this.entries)
      .filter(([, entry]) => !entry.pinned)
      .sort((a, b) => Number(a[1].accessedAt || 0) - Number(b[1].accessedAt || 0));
    for (const [key, entry] of oldest) {
      await unlink(join(CACHE_DIR, entry.file)).catch(() => {});
      total -= Number(entry.size || 0);
      delete this.entries[key];
      if (total <= CACHE_PRUNE_TARGET) break;
    }
    this.scheduleIndexWrite();
  }

  keyFor(source, variant, previewTransform = '') {
    const version = variant === 'thumb-960' && (
      /^\/api\/local-history\/(?:recycle-bin\/)?[^/]+\/image$/i.test(source)
      || /^\/api\/integrations\/(?:st-chatu8|st-baibai)\/history\/[a-f0-9]{64}\/image$/i.test(source)
    ) ? HISTORY_THUMBNAIL_CACHE_VERSION : CACHE_VERSION;
    return createHash('sha256').update(`${version}|${variant}|${source}${previewTransform ? `|${previewTransform}` : ''}`).digest('hex');
  }

  has(source, variant, { previewTransform = '' } = {}) {
    return Boolean(this.entries[this.keyFor(source, variant, previewTransform)]);
  }

  stats() {
    return Object.values(this.entries).reduce((summary, entry) => {
      const size = Math.max(0, Number(entry?.size || 0));
      summary.count += 1;
      summary.bytes += size;
      if (entry?.pinned) {
        summary.pinnedCount += 1;
        summary.pinnedBytes += size;
      }
      return summary;
    }, {
      count: 0,
      bytes: 0,
      pinnedCount: 0,
      pinnedBytes: 0,
      limitBytes: CACHE_LIMIT,
      pinnedLimitBytes: PIN_CACHE_LIMIT,
    });
  }

  /** 该缩略图是否已标记为固定保留（封面图）。 */
  isPinned(source, variant, { previewTransform = '' } = {}) {
    return this.entries[this.keyFor(source, variant, previewTransform)]?.pinned === true;
  }

  async put(source, variant, buffer, { pinned = false, previewTransform = '' } = {}) {
    const key = this.keyFor(source, variant, previewTransform);
    const file = `${key}.webp`;
    const temp = join(CACHE_DIR, `${key}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temp, buffer);
    await rename(temp, join(CACHE_DIR, file));
    this.entries[key] = { file, size: buffer.length, accessedAt: Date.now(), source, variant, pinned };
    this.scheduleIndexWrite();
    await this.prune();
    return { etag: `"nai-${key}"` };
  }

  async get(source, variant, loadOriginal, { pinned = false, priority = 0, previewTransform = '' } = {}) {
    const key = this.keyFor(source, variant, previewTransform);
    const existing = this.entries[key];
    if (existing) {
      try {
        const buffer = await readFile(join(CACHE_DIR, existing.file));
        existing.accessedAt = Date.now();
        // 请求标记为固定保留时升级该条目的 pinned 状态（封面图不再被 LRU 淘汰）。
        if (pinned && !existing.pinned) {
          existing.pinned = true;
          this.scheduleIndexWrite();
        }
        return { buffer, etag: `"nai-${key}"` };
      } catch { delete this.entries[key]; }
    }
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const promise = this.withJobSlot(async () => {
      const original = await this.sourceMemoryCache.get(source, loadOriginal, 30_000);
      if (original.status >= 400) {
        const error = new Error('Source image was not found');
        error.status = original.status;
        throw error;
      }
      const { default: sharp } = await import('sharp');
      const image = sharp(original.buffer, { failOn: 'warning', limitInputPixels: 100_000_000 }).rotate();
      const crop = /^artist-sample-padding-v[12]$/.test(previewTransform) ? await getArtistSamplePreviewCrop(image) : null;
      if (crop) image.extract(crop);
      const output = await image
        .resize({ width: THUMB_WIDTHS.get(variant), height: THUMB_WIDTHS.get(variant), fit: 'inside', withoutEnlargement: true })
        .webp({ quality: variant === 'thumb-960' ? 78 : 72, effort: variant === 'thumb-960' ? 3 : 4 })
        .toBuffer();
      const file = `${key}.webp`;
      const temp = join(CACHE_DIR, `${key}.${process.pid}.${Date.now()}.tmp`);
      await writeFile(temp, output);
      await rename(temp, join(CACHE_DIR, file));
      this.entries[key] = { file, size: output.length, accessedAt: Date.now(), source, variant, pinned };
      this.scheduleIndexWrite();
      await this.prune();
      return { buffer: output, etag: `"nai-${key}"` };
    }, priority).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
}
