import { createHash } from 'node:crypto';
import { mkdir, readdir, stat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

// 官方读取上限为短时 10 次／秒、长期建议约 1 次／秒；20 次是本机首屏突发预算，并非官方公布的池大小。
const READ_BURST = 20;
const READ_CONCURRENCY = 10;
const READ_INTERVAL_MS = 100;

/** 三类图库与局域网设备共用预算，最多十个进行中查询；长期仍每秒补一个。 */
export const createDanbooruLimiter = ({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, popularBurst = 50 } = {}) => {
  const queue = [];
  let tokens = READ_BURST, updated = now(), active = 0, nextStart = 0, blockedUntil = 0, failures = 0, timer;
  let popularTokens = popularBurst, popularUpdated = now();
  const cooldownError = () => Object.assign(new Error(`Danbooru 429：已暂停联网查询，请 ${Math.ceil((blockedUntil - now()) / 1000)} 秒后重试`), { status: 429, retryAfter: Math.ceil((blockedUntil - now()) / 1000) });
  const wake = () => {
    if (timer !== undefined) { clearTimer(timer); timer = undefined; }
    pump();
  };
  const pump = () => {
    if (!queue.length || active >= READ_CONCURRENCY) return;
    const time = now();
    tokens = Math.min(READ_BURST, tokens + Math.max(0, time - updated) / 1000); updated = Math.max(time, blockedUntil);
    const wait = Math.max(0, blockedUntil - time, nextStart - time, tokens >= 1 ? 0 : (1 - tokens) * 1000);
    if (wait > 0) { timer = setTimer(() => { timer = undefined; pump(); }, Math.ceil(wait)); return; }
    queue.sort((left, right) => left.priority - right.priority);
    // 热门榜另有官方每分钟一次、可短突发 50 次的端点预算；不阻塞普通检索。
    popularTokens = Math.min(popularBurst, popularTokens + Math.max(0, time - popularUpdated) / 60_000); popularUpdated = time;
    const index = queue.findIndex(task => !task.popular || popularTokens >= 1);
    if (index < 0) { timer = setTimer(() => { timer = undefined; pump(); }, Math.ceil((1 - popularTokens) * 60_000)); return; }
    const task = queue.splice(index, 1)[0]; task.signal?.removeEventListener('abort', task.abort);
    if (task.signal?.aborted) { task.reject(new DOMException('Aborted', 'AbortError')); wake(); return; }
    tokens--; active++; nextStart = time + READ_INTERVAL_MS;
    if (task.popular) popularTokens--;
    void Promise.resolve().then(task.load).then(task.resolve, task.reject).finally(() => { active--; wake(); });
    pump();
  };
  return {
    run(load, signal, priority = 0, popular = false) {
      if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
      if (blockedUntil > now()) return Promise.reject(cooldownError());
      return new Promise((resolve, reject) => {
        const task = { load, signal, priority, popular, resolve, reject, abort: () => {
          const index = queue.indexOf(task); if (index >= 0) queue.splice(index, 1);
          reject(new DOMException('Aborted', 'AbortError')); wake();
        } };
        signal?.addEventListener('abort', task.abort, { once: true }); queue.push(task); wake();
      });
    },
    observe(status, retryAfter) {
      if (status === 429 || status === 403) {
        failures++;
        const seconds = /^\d+(?:\.\d+)?$/.test(retryAfter || '') ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter || '') - now());
        // 禁止立刻换端点／身份重试；尊重 Retry-After，连续限流指数延长。
        blockedUntil = Math.max(blockedUntil, now() + Math.max(Number.isFinite(seconds) ? seconds : 0, status === 403 ? 5 * 60_000 : Math.min(5 * 60_000, 30_000 * 2 ** Math.min(failures - 1, 4))));
        tokens = 0; updated = blockedUntil;
        // 排队项及时报告冷却，不占住浏览器连接等几分钟；缓存读取仍可正常完成。
        for (const task of queue.splice(0)) { task.signal?.removeEventListener('abort', task.abort); task.reject(cooldownError()); }
        wake();
      } else if (status === 200 && blockedUntil <= now()) failures = 0;
    },
  };
};

/** 只持久缓存公开封面查询。目录和文件均在可再生缓存区，原图／D1 不参与。 */
export const createDanbooruDiskCache = (directory, { maxEntries = 2048, maxBytes = 128 * 1024 * 1024, now = Date.now } = {}) => {
  const root = resolve(directory);
  const entries = new Map();
  let bytes = 0, writes = Promise.resolve();
  const pathFor = key => {
    const path = resolve(root, `${createHash('sha256').update(key).digest('hex')}.json`);
    if (dirname(path) !== root) throw new Error('封面缓存路径越界');
    return path;
  };
  const remove = async path => {
    if (dirname(path) !== root || !/^[a-f0-9]{64}\.json$/.test(path.slice(root.length + 1))) throw new Error('封面缓存路径越界');
    bytes -= entries.get(path)?.bytes || 0; entries.delete(path);
    await unlink(path).catch(() => {});
  };
  const trim = async () => { while (entries.size > maxEntries || bytes > maxBytes) await remove(entries.keys().next().value); };
  const ready = mkdir(root, { recursive: true }).then(async () => {
    const files = (await readdir(root)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    const saved = await Promise.all(files.map(async name => { const path = resolve(root, name); return { path, info: await stat(path).catch(() => null) }; }));
    saved.filter(item => item.info?.isFile()).sort((a, b) => a.info.mtimeMs - b.info.mtimeMs).forEach(({ path, info }) => {
      entries.set(path, { bytes: info.size }); bytes += info.size;
    });
    await trim();
  }).catch(() => {});
  return {
    async get(key) {
      await ready; const path = pathFor(key);
      if (!entries.has(path)) return null;
      try {
        const saved = JSON.parse(await readFile(path, 'utf8'));
        if (saved.key !== key || !Number.isFinite(saved.cachedUntil) || saved.cachedUntil <= now() || saved.status !== 200 || typeof saved.body !== 'string') return null;
        const body = Buffer.from(saved.body, 'base64'); const data = JSON.parse(body.toString('utf8'));
        if (!Array.isArray(data) || !data.length) return null;
        const entry = entries.get(path); if (entry) { entries.delete(path); entries.set(path, entry); }
        return { status: 200, contentType: 'application/json', body, cachedUntil: saved.cachedUntil };
      } catch { return null; }
    },
    async set(key, value, ttl) {
      if (ttl < 3600_000 || value.status !== 200) return;
      try { const data = JSON.parse(value.body.toString('utf8')); if (!Array.isArray(data) || !data.length) return; } catch { return; }
      const text = JSON.stringify({ key, status: 200, cachedUntil: now() + ttl, body: value.body.toString('base64') });
      const size = Buffer.byteLength(text); if (size > maxBytes) return;
      writes = writes.catch(() => {}).then(async () => {
        await ready; const path = pathFor(key); const temporary = `${path}.tmp`;
        await writeFile(temporary, text); await rename(temporary, path);
        bytes -= entries.get(path)?.bytes || 0; entries.delete(path); entries.set(path, { bytes: size }); bytes += size;
        await trim();
      });
      await writes.catch(() => {});
    },
  };
};
