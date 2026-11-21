import { vibeStrength } from '../services/vibeProtocol.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { isStChatu8ExportableChain } from '../worker/stChatu8Policy.mjs';
import {
  canonicalVibeSourceHash,
  computeSillyTavernRootDir,
  findSillyTavernLocation,
  findSillyTavernUserDir,
  readNovelAiMetadata,
  resolveNovelAiModelFromSource,
  resolveStUserFile,
} from './st-chatu8-bridge.mjs';

const DEFAULT_STATE_FILE = join(process.cwd(), 'local-data', 'st-baibai-bridge.json');
const CHATU8_STATE_FILE = join(process.cwd(), 'local-data', 'st-chatu8-bridge.json');
const MAX_VIBE_DOCUMENT_BYTES = 30 * 1024 * 1024;
const MAX_PREVIEW_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_SIDECAR_BYTES = 2 * 1024 * 1024;
const HISTORY_BATCH_SIZE = 250;
const BAIBAI_FOLDER_PREFIX = '柏宝绘_';
const BAIBAI_ARTIST_COVER_FOLDER = '柏宝绘_画师串';
const BAIBAI_IMAGE_PATTERN = /^bbi_[a-zA-Z0-9_]+-[a-zA-Z0-9]+\.(?:png|jpe?g|webp)$/i;

const sha256 = value => createHash('sha256').update(value).digest('hex');

const defaultState = () => ({
  version: 1,
  sillyTavernRoot: '',
  artistLinks: {},
  vibeLinks: {},
  groupLinks: {},
  history: {},
  lastHistorySyncAt: 0,
  lastSyncAt: 0,
});

const DEFAULT_CHAIN_PARAMS = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  qualityToggle: true,
  ucPreset: 4,
  characters: [],
};

// 只有明确声明且每条有效、ID 唯一的完整快照，才可据缺失判断对方已移除。
export const isCompleteBaiBaiArtistSnapshot = payload => {
  const marker = payload?.artistSnapshot;
  const artists = payload?.artists;
  if (marker?.version !== 2 || marker.complete !== true || !Array.isArray(artists) || marker.count !== artists.length) return false;
  const ids = new Set();
  for (const artist of artists) {
    if (!artist || typeof artist.externalId !== 'string' || !artist.externalId || artist.externalId.length > 160 || typeof artist.name !== 'string' || !artist.name.trim() || artist.name.length > 100 || ids.has(artist.externalId)) return false;
    for (const field of ['prompt', 'quality', 'negative', 'previewPath', 'previewSourceImage']) {
      if (typeof artist[field] !== 'string') return false;
    }
    ids.add(artist.externalId);
  }
  return true;
};

const chainToBaiBaiArtist = (chain, externalId) => {
  const activeModules = Array.isArray(chain.modules) ? chain.modules.filter(module => module?.isActive !== false) : [];
  const pre = activeModules.filter(module => module.position !== 'post').map(module => module.content).filter(Boolean);
  const post = activeModules.filter(module => module.position === 'post').map(module => module.content).filter(Boolean);
  return {
    externalId,
    name: chain.name,
    prompt: [chain.basePrompt, ...pre].filter(Boolean).join(', '),
    quality: post.join(', '),
    negative: chain.negativePrompt || '',
    previewImage: chain.previewImage || '',
    updatedAt: Number(chain.updatedAt || 0),
  };
};

const artistHash = artist => sha256(JSON.stringify({
  name: String(artist.name || ''),
  prompt: String(artist.prompt || ''),
  quality: String(artist.quality || ''),
  negative: String(artist.negative || ''),
}));

const baiBaiArtistToChainBody = (artist, existing) => ({
  name: String(artist.name || '未命名风格串').slice(0, 100),
  description: existing?.description || '与 SillyTavern 柏宝绘同步',
  type: 'style',
  tags: Array.isArray(existing?.tags) ? existing.tags : [],
  basePrompt: String(artist.prompt || ''),
  negativePrompt: String(artist.negative || ''),
  modules: artist.quality ? [{
    id: 'st-baibai-quality', name: '正面质量词', content: String(artist.quality), isActive: true, position: 'post',
  }] : [],
  params: {
    ...DEFAULT_CHAIN_PARAMS,
    ...(existing?.params || {}),
  },
  variableValues: existing?.variableValues || { subject: '' },
});

const vibeGroupSignature = group => JSON.stringify({
  name: group.name,
  normalizeStrengths: group.normalizeStrengths !== false,
  slots: (group.slots || []).map(slot => [slot.vibeId, slot.vibeName || '', slot.encodingId, Number(slot.informationExtracted), Number(slot.strength)]),
});

const stripBbiTagShell = raw => {
  const text = String(raw || '').trim();
  if (!text) return '';
  const match = text.match(/^<bbi_image\b[^>]*>([\s\S]*?)<\/bbi_image>$/i);
  return (match ? match[1] : text).trim();
};

/** 扫描柏宝绘生成的图库目录（user/images/柏宝绘_<角色名>/ 与旧 user/files/bbi_*），排除画师串封面目录。 */
export const collectBaiBaiHistoryCandidates = async (root, userDir = null) => {
  const resolvedUserDir = userDir || (root ? await findSillyTavernUserDir(root) : null);
  if (!resolvedUserDir) return [];
  const candidates = [];
  const seen = new Set();
  const filesDir = join(resolvedUserDir, 'user', 'files');

  const pushCandidate = (publicPath, filePath, folderCharacter) => {
    const normalizedPublic = String(publicPath).replaceAll('\\', '/');
    const externalId = sha256(normalizedPublic.toLowerCase());
    if (seen.has(externalId)) return;
    seen.add(externalId);
    const stem = basename(filePath, extname(filePath));
    candidates.push({
      publicPath: normalizedPublic,
      filePath,
      sidecarPath: join(filesDir, `${stem}.json`),
      folderCharacter,
      externalId,
    });
  };

  // 1. 新结构：user/images/柏宝绘_<角色名>/bbi_*.<ext>（显式排除 柏宝绘_画师串）
  const imagesRoot = join(resolvedUserDir, 'user', 'images');
  try {
    const dirs = await readdir(imagesRoot, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      if (!dir.name.startsWith(BAIBAI_FOLDER_PREFIX) || dir.name === BAIBAI_ARTIST_COVER_FOLDER) continue;
      const folderCharacter = dir.name.slice(BAIBAI_FOLDER_PREFIX.length).trim();
      const folderPath = join(imagesRoot, dir.name);
      try {
        const files = await readdir(folderPath, { withFileTypes: true });
        for (const file of files) {
          if (!file.isFile() || !BAIBAI_IMAGE_PATTERN.test(file.name)) continue;
          const publicPath = `/user/images/${dir.name}/${file.name}`;
          const filePath = resolveStUserFile(root, publicPath, resolvedUserDir);
          if (filePath) pushCandidate(publicPath, filePath, folderCharacter);
        }
      } catch { /* 单个子目录不可读时继续 */ }
    }
  } catch { /* user/images 目录尚未创建 */ }

  // 2. 旧结构：user/files/bbi_*.<ext>
  try {
    const files = await readdir(filesDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !BAIBAI_IMAGE_PATTERN.test(file.name)) continue;
      const publicPath = `/user/files/${file.name}`;
      const filePath = resolveStUserFile(root, publicPath, resolvedUserDir);
      if (filePath) pushCandidate(publicPath, filePath, '');
    }
  } catch { /* user/files 目录尚未创建 */ }

  return candidates;
};

/** 合并 PNG 隐写元数据与柏宝绘侧写 JSON（覆盖 JPEG 转码丢 PNG 块以及角色来源名场景）。 */
export const readBaiBaiHistoryMetadata = async (filePath, sidecarPath, folderCharacter = '', modelMappings = {}) => {
  const pngMeta = await readNovelAiMetadata(filePath, modelMappings);
  let sidecar = null;
  if (sidecarPath) {
    try {
      const info = await stat(sidecarPath);
      if (info.isFile() && info.size > 0 && info.size <= MAX_SIDECAR_BYTES) {
        const parsed = JSON.parse(await readFile(sidecarPath, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) sidecar = parsed;
      }
    } catch { /* 侧写文件可选 */ }
  }
  let fallbackMtime = Date.now();
  try {
    const info = await stat(filePath);
    if (Number.isFinite(info.mtimeMs) && info.mtimeMs > 0) fallbackMtime = Math.round(info.mtimeMs);
  } catch { /* ignore */ }

  const meta = sidecar?.meta && typeof sidecar.meta === 'object' ? sidecar.meta : null;
  const metaParams = meta?.params && typeof meta.params === 'object' ? meta.params : {};
  const sidecarModel = resolveNovelAiModelFromSource(meta?.model, modelMappings);
  const sidecarParams = {
    ...(sidecarModel ? { model: sidecarModel } : {}),
    ...(Number(meta?.width) > 0 ? { width: Number(meta.width) } : {}),
    ...(Number(meta?.height) > 0 ? { height: Number(meta.height) } : {}),
    ...(Number.isFinite(Number(metaParams.steps)) ? { steps: Number(metaParams.steps) } : {}),
    ...(Number.isFinite(Number(metaParams.cfg)) ? { scale: Number(metaParams.cfg) } : {}),
    ...(typeof metaParams.sampler === 'string' && metaParams.sampler.trim() ? { sampler: metaParams.sampler.trim() } : {}),
    ...(typeof metaParams.noiseSchedule === 'string' && metaParams.noiseSchedule.trim() ? { noiseSchedule: metaParams.noiseSchedule.trim() } : {}),
    ...(Number.isFinite(Number(metaParams.cfgRescale)) ? { cfgRescale: Number(metaParams.cfgRescale) } : {}),
    ...(Number.isFinite(Number(sidecar?.seed)) ? { seed: Number(sidecar.seed) } : {}),
  };

  const character = String(sidecar?.character || folderCharacter || '').trim().slice(0, 60);
  const createdAt = Number.isFinite(Number(sidecar?.createdAt)) && Number(sidecar.createdAt) > 0
    ? Number(sidecar.createdAt)
    : fallbackMtime;

  return {
    prompt: pngMeta.prompt || String(meta?.positive || '').trim() || stripBbiTagShell(sidecar?.prompt),
    negativePrompt: pngMeta.negativePrompt || String(meta?.negative || '').trim(),
    params: { ...sidecarParams, ...(pngMeta.params || {}) },
    sourceName: character ? `柏宝绘 · ${character}` : 'st-baibai',
    createdAt,
  };
};

export class StBaiBaiBridge {
  constructor({
    projectRoot = process.cwd(),
    requestWorkerJson,
    requestWorkerBuffer,
    modelMappings = () => ({}),
    stateFile = DEFAULT_STATE_FILE,
    sharedRootFallbackFile = CHATU8_STATE_FILE,
  }) {
    this.projectRoot = projectRoot;
    this.requestWorkerJson = requestWorkerJson;
    this.requestWorkerBuffer = requestWorkerBuffer;
    this.modelMappings = typeof modelMappings === 'function' ? modelMappings : () => modelMappings || {};
    this.stateFile = stateFile;
    this.sharedRootFallbackFile = sharedRootFallbackFile;
    this.root = null;
    this.userDir = null;
    this.state = defaultState();
    this.writeQueue = Promise.resolve();
    this.historySyncPromise = null;
    this.syncQueue = Promise.resolve();
    this.enabled = false;
    this.generation = 0;
    this.preferenceRevision = 0;
    this.preferenceQueue = Promise.resolve();
    this.receiptSession = randomUUID();
    this.snapshotCursor = randomUUID();
  }

  async init() {
    try { this.state = { ...defaultState(), ...JSON.parse(await readFile(this.stateFile, 'utf8')) }; } catch { /* First run. */ }
    let preferredRoot = this.state.sillyTavernRoot;
    if (!preferredRoot && this.sharedRootFallbackFile) {
      try {
        const shared = JSON.parse(await readFile(this.sharedRootFallbackFile, 'utf8'));
        if (typeof shared?.sillyTavernRoot === 'string' && shared.sillyTavernRoot.trim()) {
          preferredRoot = shared.sillyTavernRoot.trim();
        }
      } catch { /* No shared root file yet. */ }
    }
    const found = await findSillyTavernLocation(this.projectRoot, preferredRoot);
    this.root = found.root;
    this.userDir = found.userDir;
  }

  async setRoot(inputPath, { strict = true } = {}) {
    const raw = String(inputPath || '').trim();
    if (!raw) {
      if (strict) throw Object.assign(new Error('请提供有效的 SillyTavern 安装根目录'), { status: 400 });
      return { connected: Boolean(this.root), sillyTavernRoot: this.root };
    }
    const candidate = resolve(computeSillyTavernRootDir(raw));
    const userDir = await findSillyTavernUserDir(candidate);
    if (!userDir) {
      if (strict) throw Object.assign(new Error(`未在该目录下找到 SillyTavern 用户配置（data/*/settings.json）：${candidate}`), { status: 404 });
      return { connected: Boolean(this.root), sillyTavernRoot: this.root };
    }
    this.root = candidate;
    this.userDir = userDir;
    this.state.sillyTavernRoot = candidate;
    await this.saveState();
    return { connected: true, sillyTavernRoot: this.root };
  }

  applyPreferences(preferences) {
    if (typeof preferences?.enabled !== 'boolean') throw new Error('柏宝绘同步设置响应无效');
    this.preferenceRevision++;
    if (this.enabled !== preferences.enabled) { this.generation++; this.snapshotCursor = randomUUID(); }
    this.enabled = preferences.enabled;
    return { enabled: this.enabled };
  }

  async refreshPreferences(request = () => this.requestWorkerJson('/api/st-baibai/preferences')) {
    const ticket = ++this.preferenceRevision;
    try {
      const preferences = await request();
      if (ticket === this.preferenceRevision) this.applyPreferences(preferences);
      return { enabled: this.enabled };
    } catch (error) {
      if (ticket === this.preferenceRevision && ![401, 403].includes(error.status)) this.applyPreferences({ enabled: false });
      throw error;
    }
  }

  setPreferences(request) {
    const pending = this.preferenceQueue.catch(() => {}).then(async () => {
      this.preferenceRevision++;
      return this.applyPreferences(await request());
    });
    this.preferenceQueue = pending;
    return pending;
  }

  assertEnabled(generation = this.generation) {
    if (!this.enabled || generation !== this.generation) {
      throw Object.assign(new Error('柏宝绘同步已关闭，请在 Atelier 设置中开启'), { status: 409, code: 'SYNC_DISABLED' });
    }
  }

  async requestSyncJson(generation, path, options) {
    this.assertEnabled(generation);
    const result = await this.requestWorkerJson(path, options);
    this.assertEnabled(generation);
    return result;
  }

  startHistorySync() {
    if (!this.root || this.historySyncPromise) return;
    this.historySyncPromise = this.syncHistory().catch(error => {
      if (error.code !== 'SYNC_DISABLED') console.error('[st-baibai bridge] 历史同步失败:', error.message);
    }).finally(() => { this.historySyncPromise = null; });
  }

  status() {
    return {
      enabled: this.enabled,
      connected: Boolean(this.root),
      sillyTavernRoot: this.root,
      linkedArtists: Object.keys(this.state.artistLinks || {}).length,
      linkedVibes: Object.keys(this.state.vibeLinks || {}).length,
      linkedGroups: Object.keys(this.state.groupLinks || {}).length,
      linkedHistory: Object.keys(this.state.history || {}).length,
      lastSyncAt: Number(this.state.lastSyncAt || 0),
      lastHistorySyncAt: Number(this.state.lastHistorySyncAt || 0),
      historySyncing: Boolean(this.historySyncPromise),
      snapshotCursor: this.snapshotCursor,
    };
  }

  async saveState() {
    const snapshot = JSON.stringify(this.state, null, 2) + '\n';
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.stateFile), { recursive: true });
      const temporary = `${this.stateFile}.${process.pid}.tmp`;
      await writeFile(temporary, snapshot, 'utf8');
      await rename(temporary, this.stateFile);
    });
    return this.writeQueue;
  }

  resolveStUserPath(publicPath) {
    return resolveStUserFile(this.root, publicPath, this.userDir);
  }

  async readStPreviewData(publicPath) {
    const filePath = this.resolveStUserPath(publicPath);
    if (!filePath) return null;
    try {
      const info = await stat(filePath);
      if (info.size <= 0 || info.size > MAX_PREVIEW_IMAGE_BYTES) return null;
      const bytes = await readFile(filePath);
      const contentType = bytes[0] === 0x89 && bytes.subarray(1, 4).toString('ascii') === 'PNG'
        ? 'image/png'
        : bytes[0] === 0xff && bytes[1] === 0xd8
          ? 'image/jpeg'
          : bytes.subarray(8, 12).toString('ascii') === 'WEBP'
            ? 'image/webp'
            : '';
      return contentType ? `data:${contentType};base64,${bytes.toString('base64')}` : null;
    } catch {
      return null;
    }
  }

  async syncHistory() {
    if (!(await this.refreshPreferences()).enabled) return;
    if (!this.root) throw Object.assign(new Error('未找到 SillyTavern'), { status: 503 });
    const generation = this.generation;
    const userDir = this.userDir || await findSillyTavernUserDir(this.root);
    this.userDir = userDir;
    const candidates = await collectBaiBaiHistoryCandidates(this.root, userDir);
    this.assertEnabled(generation);
    const unchecked = [];
    const known = new Set();
    for (const candidate of candidates) {
      const previous = this.state.history[candidate.externalId];
      this.state.history[candidate.externalId] = {
        ...previous,
        path: candidate.publicPath,
        createdAt: previous?.createdAt || Date.now(),
      };
      if (!previous?.importedAt) unchecked.push(candidate);
    }
    for (let offset = 0; offset < unchecked.length; offset += 80) {
      const batch = unchecked.slice(offset, offset + 80).map(item => item.externalId);
      const result = await this.requestSyncJson(generation, '/api/integrations/st-baibai/history/known', { method: 'POST', body: { externalIds: batch } });
      for (const id of result.externalIds || []) known.add(id);
    }
    const mappings = this.modelMappings() || {};
    const pending = [];
    for (const candidate of unchecked) {
      this.assertEnabled(generation);
      if (known.has(candidate.externalId)) {
        this.state.history[candidate.externalId].importedAt ||= Date.now();
        continue;
      }
      try {
        const metadata = await readBaiBaiHistoryMetadata(candidate.filePath, candidate.sidecarPath, candidate.folderCharacter, mappings);
        const ext = extname(candidate.filePath).toLowerCase();
        this.state.history[candidate.externalId].createdAt = metadata.createdAt;
        pending.push({
          externalId: candidate.externalId,
          imageType: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png',
          ...metadata,
        });
      } catch { /* 半写入或已删除文件下次扫描再试 */ }
      if (pending.length >= HISTORY_BATCH_SIZE) await this.importHistoryBatch(pending.splice(0), generation);
    }
    if (pending.length) await this.importHistoryBatch(pending, generation);
    this.assertEnabled(generation);
    this.state.lastHistorySyncAt = Date.now();
    await this.saveState();
  }

  async importHistoryBatch(items, generation = this.generation) {
    const result = await this.requestSyncJson(generation, '/api/integrations/st-baibai/history/import', { method: 'POST', body: { items } });
    const now = Date.now();
    for (const item of items) this.state.history[item.externalId].importedAt = now;
    await this.saveState();
    return result;
  }

  async readHistoryImage(externalId, { maxBytes, signal } = {}) {
    const record = this.state.history?.[externalId];
    const filePath = record ? this.resolveStUserPath(record.path) : null;
    if (!filePath) throw Object.assign(new Error('柏宝绘原图记录不存在'), { status: 404 });
    let buffer;
    if (maxBytes === undefined) buffer = await readFile(filePath);
    else {
      signal?.throwIfAborted();
      const file = await open(filePath, 'r');
      try {
        const info = await file.stat();
        if (!info.isFile()) throw Object.assign(new Error('柏宝绘原图记录不存在'), { status: 404 });
        const tooLarge = () => Object.assign(new Error('图片过大，无法交给当前模型识别'), { status: 413 });
        if (info.size > maxBytes) throw tooLarge();
        const chunks = [];
        let size = 0;
        while (size <= maxBytes) {
          signal?.throwIfAborted();
          const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - size + 1));
          const { bytesRead } = await file.read(chunk, 0, chunk.length, size);
          if (!bytesRead) break;
          size += bytesRead;
          if (size > maxBytes) throw tooLarge();
          chunks.push(chunk.subarray(0, bytesRead));
        }
        signal?.throwIfAborted();
        buffer = Buffer.concat(chunks, size);
      } finally { await file.close(); }
    }
    const extension = extname(filePath).toLowerCase();
    return { buffer, contentType: extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png' };
  }

  async syncArtists(incoming = [], selectedChainIds = [], generation = this.generation, workspace = null, completeSnapshot = false, allowWriteBack = false) {
    let chains = await this.requestSyncJson(generation, '/api/chains');
    chains = Array.isArray(chains) ? chains : [];
    const byId = new Map(chains.map(chain => [chain.id, chain]));
    const byName = new Map();
    for (const chain of chains.filter(item => !item.type || item.type === 'style')) {
      const named = byName.get(chain.name) || [];
      named.push(chain);
      byName.set(chain.name, named);
    }
    const linkedIds = new Set(Object.values(this.state.artistLinks || {}).map(link => link.chainId));
    const incomingById = new Map();
    const selected = new Set(selectedChainIds);
    const counts = { received: 0, created: 0, updated: 0, unchanged: 0, selected: 0, exported: 0 };

    for (const raw of incoming) {
      this.assertEnabled(generation);
      if (!raw || typeof raw !== 'object') continue;
      const externalId = String(raw.externalId || '').slice(0, 160);
      // 柏宝绘内置画师串（bi_*）不参与同步。
      if (!externalId || /^bi_/i.test(externalId) || /^baibai:bi_/i.test(externalId)) continue;
      const artist = {
        externalId,
        name: String(raw.name || '').trim().slice(0, 100),
        prompt: String(raw.prompt || ''),
        quality: String(raw.quality || ''),
        negative: String(raw.negative || ''),
        previewPath: String(raw.previewPath || ''),
        previewSourceImage: String(raw.previewSourceImage || ''),
        updatedAt: Number(raw.updatedAt || 0),
      };
      if (!artist.name) continue;
      incomingById.set(artist.externalId, artist);
      counts.received++;
      let link = this.state.artistLinks[artist.externalId];
      let chain = link ? byId.get(link.chainId) : null;
      let wasCreated = false;
      if (chain?.type && chain.type !== 'style') chain = null;
      if (!chain) chain = byName.get(artist.name)?.find(item => !linkedIds.has(item.id));
      if (!chain) {
        const body = baiBaiArtistToChainBody(artist);
        const created = await this.requestSyncJson(generation, '/api/chains', { method: 'POST', body });
        if (created?.id) {
          chain = { ...body, id: created.id, previewImage: '', createdAt: Date.now(), updatedAt: Date.now() };
          chains.push(chain);
          byId.set(chain.id, chain);
          byName.set(chain.name, [...(byName.get(chain.name) || []), chain]);
          counts.created++;
          wasCreated = true;
        }
      }
      if (!chain) continue;
      if (workspace && workspace.chainIds.includes(chain.id)) {
        this.state.artistLinks[artist.externalId] = { ...link, chainId: chain.id };
        linkedIds.add(chain.id);
        counts.unchanged++;
        continue;
      }
      const stHash = artistHash(artist);
      link ||= { chainId: chain.id, lastStHash: '', lastNpmHash: '' };
      const npmHash = artistHash(chainToBaiBaiArtist(chain, artist.externalId));
      const previewChanged = artist.previewPath !== String(link.lastStPreviewPath || '')
        || String(chain.previewImage || '') !== String(link.lastNpmPreviewImage || '');
      const acknowledgedPreview = artist.previewPath && artist.previewSourceImage && artist.previewSourceImage === chain.previewImage;
      let previewConfirmed = !artist.previewPath || Boolean(acknowledgedPreview) || (!previewChanged && Boolean(chain.previewImage));
      let previewUpdated = false;
      let changed = false;
      if (stHash !== npmHash || previewChanged) {
        const body = baiBaiArtistToChainBody(artist, chain);
        if (artist.previewPath && !acknowledgedPreview) {
          const preview = await this.readStPreviewData(artist.previewPath);
          if (preview) {
            body.previewImage = preview;
            previewUpdated = true;
            previewConfirmed = true;
          }
        }
        if (stHash !== npmHash || previewUpdated) {
          await this.requestSyncJson(generation, `/api/chains/${encodeURIComponent(chain.id)}`, { method: 'PUT', body });
          const refreshed = await this.requestSyncJson(generation, `/api/chains/${encodeURIComponent(chain.id)}`);
          if (refreshed?.id) {
            chain = refreshed;
            byId.set(chain.id, chain);
          }
          if (!wasCreated) counts.updated++;
          changed = true;
        }
      }
      if (!changed && !wasCreated) counts.unchanged++;
      this.state.artistLinks[artist.externalId] = {
        ...link,
        chainId: chain.id,
        lastStHash: stHash,
        lastNpmHash: stHash,
        lastStPreviewPath: previewConfirmed ? artist.previewPath : String(link.lastStPreviewPath || ''),
        lastNpmPreviewImage: previewConfirmed ? String(chain.previewImage || '') : String(link.lastNpmPreviewImage || ''),
        ...(previewUpdated ? { importedPreviewImage: String(chain.previewImage || ''), importedPreviewPath: artist.previewPath } : {}),
      };
      linkedIds.add(chain.id);
    }

    chains = await this.requestSyncJson(generation, '/api/chains');
    const linksByChain = new Map(Object.entries(this.state.artistLinks).map(pair => [pair[1].chainId, pair]));
    const entries = new Map((workspace?.entries || []).map(entry => [entry.chainId, entry]));
    const updates = [];
    const previewMatches = (artist, current, link) => !artist.previewImage || (current?.previewPath && (
      current.previewSourceImage === artist.previewImage
      || (link.importedPreviewImage === artist.previewImage && link.importedPreviewPath === current.previewPath)
      || (!workspace && !current.previewSourceImage && link.lastStPreviewPath === current.previewPath && link.lastNpmPreviewImage === artist.previewImage)
    ));
    if (completeSnapshot && workspace) {
      for (const entry of workspace.entries) {
        const pair = linksByChain.get(entry.chainId);
        const chain = chains.find(item => item.id === entry.chainId);
        if (!pair || !chain) continue;
        const current = incomingById.get(pair[0]);
        if (!current && entry.status !== 'pending') updates.push({ chainId: entry.chainId, requestId: entry.requestId, status: 'removed' });
        else if (current) {
          const artist = chainToBaiBaiArtist(chain, pair[0]);
          if (entry.status !== 'pending' || (artistHash(current) === artistHash(artist) && previewMatches(artist, current, pair[1]))) {
            updates.push({ chainId: entry.chainId, requestId: entry.requestId, status: 'synced' });
          }
        }
      }
    }

    // 柏宝绘会在运行期把 settings 缓存到 Vue reactive 内存；自动同步只做只读入库，绝不下发写回任务。
    const artists = allowWriteBack
      ? chains.filter(chain => isStChatu8ExportableChain(chain) && selected.has(chain.id)).map(chain => {
        counts.selected++;
        let pair = linksByChain.get(chain.id);
        if (!pair) {
          const externalId = `npm:${chain.id}`;
          this.state.artistLinks[externalId] = { chainId: chain.id, lastStHash: '', lastNpmHash: '' };
          pair = [externalId, this.state.artistLinks[externalId]];
        }
        const artist = chainToBaiBaiArtist(chain, pair[0]);
        const current = incomingById.get(pair[0]);
        if (current && artistHash(current) === artistHash(artist) && previewMatches(artist, current, pair[1]) && (!workspace || completeSnapshot)) return null;
        const entry = entries.get(chain.id);
        if (workspace && entry) {
          const contentHash = sha256(JSON.stringify(artist));
          let transfer = pair[1].transfer;
          if (!transfer || transfer.requestId !== entry.requestId || transfer.contentHash !== contentHash || transfer.session !== this.receiptSession || transfer.generation !== generation) {
            transfer = { requestId: entry.requestId, token: randomUUID(), contentHash, textHash: artistHash(artist), previewImage: String(artist.previewImage || ''), session: this.receiptSession, generation };
            pair[1].transfer = transfer;
          }
          artist.receipt = { requestId: transfer.requestId, token: transfer.token };
        }
        pair[1].lastNpmHash = artistHash(artist);
        pair[1].lastNpmPreviewImage = String(chain.previewImage || '');
        return artist;
      }).filter(Boolean)
      : [];

    counts.exported = artists.length;
    this.lastArtistSync = counts;
    this.assertEnabled(generation);
    await this.saveState();
    if (workspace && (updates.length || completeSnapshot)) {
      await this.requestSyncJson(generation, '/api/integrations/st-baibai/artist-records', {
        method: 'POST', body: { updates, verifiedAt: completeSnapshot ? Date.now() : 0 },
      });
    }
    return artists;
  }

  async syncVibes(documents = [], incomingGroups = [], presentSourceHashes = [], generation = this.generation, allowWriteBack = false) {
    const incomingSourceHashes = new Set(presentSourceHashes
      .map(value => String(value || '').toLowerCase())
      .filter(value => /^[a-f0-9]{64}$/.test(value)));
    for (const document of documents.slice(0, 100)) {
      const text = JSON.stringify(document);
      if (Buffer.byteLength(text) > MAX_VIBE_DOCUMENT_BYTES) continue;
      if (document?.identifier !== 'novelai-vibe-transfer') continue;
      const sourceHash = canonicalVibeSourceHash(document);
      if (!sourceHash) continue;
      incomingSourceHashes.add(sourceHash);
      const result = await this.requestSyncJson(generation, '/api/vibes/import', { method: 'POST', body: { document } });
      const requestedName = String(document.name || '').trim();
      const vibeId = result?.item?.id || null;
      if (vibeId) this.state.vibeLinks[sourceHash] = { vibeId, lastSeenAt: Date.now() };
      const requestedStrength = vibeStrength(document.importInfo?.strength);
      if (vibeId && requestedName && (result?.item?.name !== requestedName || Number(result?.item?.defaultStrength) !== requestedStrength)) {
        await this.requestSyncJson(generation, `/api/vibes/${encodeURIComponent(vibeId)}`, {
          method: 'PUT', body: { name: requestedName, defaultStrength: requestedStrength },
        });
      }
    }

    const vibeResult = await this.requestSyncJson(generation, '/api/vibes');
    const vibes = Array.isArray(vibeResult?.items) ? vibeResult.items : [];
    const bySourceHash = new Map(vibes.map(vibe => [vibe.sourceHash, vibe]));
    let groupsResult = await this.requestSyncJson(generation, '/api/vibe-groups');
    let groups = Array.isArray(groupsResult?.items) ? groupsResult.items : [];
    const incomingGroupIds = new Set();

    for (const group of incomingGroups.slice(0, 200)) {
      const name = String(group?.name || '').trim().slice(0, 100);
      if (!name || !Array.isArray(group.vibes)) continue;
      const externalGroupId = String(group.externalId || `baibai-group:${name}`);
      const slots = group.vibes.slice(0, 16).map(reference => {
        const vibe = bySourceHash.get(reference.sourceHash);
        const encoding = vibe?.encodings?.find(item => Math.abs(Number(item.informationExtracted) - 1) < 0.001) || vibe?.encodings?.[0];
        return vibe && encoding ? {
          vibeId: vibe.id, vibeName: vibe.name, encodingId: encoding.id,
          informationExtracted: Number(encoding.informationExtracted), strength: vibeStrength(reference.strength),
        } : null;
      }).filter(Boolean);
      if (!slots.length) continue;
      let linkedId = this.state.groupLinks[externalGroupId];
      let existing = groups.find(item => item.id === linkedId) || groups.find(item => item.name === name);
      const body = { name, slots, normalizeStrengths: group.normalizeStrengths !== false };
      if (existing) {
        if (vibeGroupSignature(existing) !== vibeGroupSignature(body)) {
          await this.requestSyncJson(generation, `/api/vibe-groups/${encodeURIComponent(existing.id)}`, { method: 'PUT', body });
          Object.assign(existing, body);
        }
        linkedId = existing.id;
      } else {
        const created = await this.requestSyncJson(generation, '/api/vibe-groups', { method: 'POST', body });
        linkedId = created?.item?.id;
        if (linkedId) groups.push({ ...body, id: linkedId });
      }
      if (linkedId) {
        this.state.groupLinks[externalGroupId] = linkedId;
        incomingGroupIds.add(linkedId);
      }
    }

    this.assertEnabled(generation);
    await this.saveState();

    // 自动后台同步只做入库，不下发写回给柏宝绘。
    if (!allowWriteBack) return { vibes: [], groups: [] };

    groupsResult = await this.requestSyncJson(generation, '/api/vibe-groups');
    groups = Array.isArray(groupsResult?.items) ? groupsResult.items : [];
    const byId = new Map(vibes.map(vibe => [vibe.id, vibe]));
    const firstGroupByVibeId = new Map();
    for (const group of groups) {
      for (const slot of Array.isArray(group.slots) ? group.slots : []) {
        if (slot?.vibeId && !firstGroupByVibeId.has(slot.vibeId)) {
          firstGroupByVibeId.set(slot.vibeId, group.name);
        }
      }
    }

    return {
      vibes: vibes.filter(vibe => !this.state.vibeLinks[vibe.sourceHash] || incomingSourceHashes.has(vibe.sourceHash)).map(vibe => ({
        id: vibe.id,
        name: vibe.name,
        sourceHash: vibe.sourceHash,
        defaultStrength: vibe.defaultStrength,
        group: firstGroupByVibeId.get(vibe.id) || '',
        updatedAt: vibe.updatedAt,
        encodingCount: vibe.encodings?.length || 0,
        fileUrl: `/api/integrations/st-baibai/vibes/${encodeURIComponent(vibe.id)}/file`,
      })),
      groups: groups.filter(group => !Object.values(this.state.groupLinks).includes(group.id) || incomingGroupIds.has(group.id)).map(group => ({
        externalId: `npm:${group.id}`,
        name: group.name,
        normalizeStrengths: group.normalizeStrengths,
        updatedAt: group.updatedAt,
        vibes: group.slots.map(slot => ({ sourceHash: byId.get(slot.vibeId)?.sourceHash, strength: slot.strength })).filter(item => item.sourceHash),
      })),
    };
  }

  sync(payload = {}) {
    const queuedGeneration = this.enabled ? this.generation : null;
    const pending = this.syncQueue.catch(() => {}).then(() => this.performSync(payload, queuedGeneration));
    this.syncQueue = pending;
    return pending;
  }

  async performSync(payload, queuedGeneration = null) {
    const disabled = () => ({ enabled: false, protocolVersion: 2, writeBackAllowed: false, artistSnapshotComplete: false, artists: [], vibes: [], groups: [], status: this.status() });
    if (!(await this.refreshPreferences()).enabled) return disabled();
    if (queuedGeneration !== null && queuedGeneration !== this.generation) return disabled();
    const generation = this.generation;
    const allowWriteBack = payload.manual === true;
    try {
      const selection = await this.requestSyncJson(generation, '/api/st-baibai/workspace');
      const selectedChainIds = allowWriteBack && Array.isArray(selection?.chainIds) ? selection.chainIds : [];
      const completeSnapshot = isCompleteBaiBaiArtistSnapshot(payload) && payload.artistSnapshot.cursor === this.snapshotCursor;
      if (completeSnapshot) this.snapshotCursor = randomUUID();
      const artists = await this.syncArtists(
        Array.isArray(payload.artists) ? payload.artists : [],
        selectedChainIds,
        generation,
        selection,
        completeSnapshot,
        allowWriteBack,
      );
      const vibeData = await this.syncVibes(
        Array.isArray(payload.vibeDocuments) ? payload.vibeDocuments : [],
        Array.isArray(payload.vibeGroups) ? payload.vibeGroups : [],
        Array.isArray(payload.vibeSourceHashes) ? payload.vibeSourceHashes : [],
        generation,
        allowWriteBack,
      );
      this.assertEnabled(generation);
      this.state.lastSyncAt = Date.now();
      await this.saveState();
      this.startHistorySync();
      this.assertEnabled(generation);
      let outgoing = [];
      if (allowWriteBack) {
        const current = await this.requestSyncJson(generation, '/api/st-baibai/workspace');
        const activeRequests = new Map((current.entries || []).filter(entry => entry.status === 'pending').map(entry => [entry.chainId, entry.requestId]));
        outgoing = artists.filter(artist => activeRequests.get(this.state.artistLinks[artist.externalId]?.chainId) === artist.receipt?.requestId);
      }
      return {
        enabled: true,
        protocolVersion: 2,
        writeBackAllowed: allowWriteBack,
        artistSnapshotComplete: completeSnapshot,
        artists: outgoing,
        artistSync: this.lastArtistSync,
        ...vibeData,
        status: this.status(),
      };
    } catch (error) {
      if (error.code === 'SYNC_DISABLED') return disabled();
      throw error;
    }
  }

  acknowledgeArtists(payload = {}) {
    const queuedGeneration = this.generation;
    const pending = this.syncQueue.catch(() => {}).then(async () => {
      await this.refreshPreferences();
      this.assertEnabled(queuedGeneration);
      const complete = isCompleteBaiBaiArtistSnapshot(payload);
      const incoming = new Map((Array.isArray(payload.artists) ? payload.artists : []).map(artist => [artist.externalId, artist]));
      const workspace = await this.requestSyncJson(queuedGeneration, '/api/st-baibai/workspace');
      const active = new Map((workspace.entries || []).filter(entry => entry.status === 'pending').map(entry => [entry.chainId, entry.requestId]));
      const updates = [];
      const seen = new Set();
      for (const receipt of Array.isArray(payload.receipts) ? payload.receipts : []) {
        if (!receipt || seen.has(receipt.externalId)) continue;
        seen.add(receipt.externalId);
        const link = this.state.artistLinks[receipt?.externalId];
        const transfer = link?.transfer;
        if (!transfer || active.get(link.chainId) !== transfer.requestId || transfer.session !== this.receiptSession || transfer.generation !== queuedGeneration || receipt.token !== transfer.token || receipt.requestId !== transfer.requestId) continue;
        const current = incoming.get(receipt.externalId);
        let confirmed = receipt.success === true && complete && current && artistHash(current) === transfer.textHash
          && (!transfer.previewImage || (current.previewPath && current.previewSourceImage === transfer.previewImage));
        let reason = receipt.reason;
        if (confirmed) {
          const chain = await this.requestSyncJson(queuedGeneration, `/api/chains/${encodeURIComponent(link.chainId)}`);
          if (!isStChatu8ExportableChain(chain) || artistHash(chainToBaiBaiArtist(chain, receipt.externalId)) !== transfer.textHash || String(chain.previewImage || '') !== transfer.previewImage) {
            confirmed = false; reason = '工坊条目已更新，请手动同步最新内容';
          }
        }
        updates.push({
          chainId: link.chainId,
          requestId: transfer.requestId,
          onlyPending: true,
          ...(confirmed
            ? { status: 'synced' }
            : { error: String(reason || '未确认正文与封面已保存，请手动同步重试').slice(0, 200) }),
        });
      }
      const result = await this.requestSyncJson(queuedGeneration, '/api/integrations/st-baibai/artist-records', {
        method: 'POST', body: { updates, verifiedAt: complete && updates.length ? Date.now() : 0 },
      });
      return {
        confirmed: updates.filter(update => update.status === 'synced').filter(update => result.entries?.some(entry => entry.chainId === update.chainId && entry.requestId === update.requestId && entry.status === 'synced')).length,
      };
    });
    this.syncQueue = pending;
    return pending;
  }

  async readVibeFile(vibeId) {
    await this.refreshPreferences();
    const generation = this.generation;
    this.assertEnabled(generation);
    const result = await this.requestWorkerBuffer(`/api/vibes/${encodeURIComponent(vibeId)}/file`);
    if (result.status >= 400) throw Object.assign(new Error('Vibe 文件不存在'), { status: result.status });
    this.assertEnabled(generation);
    return { buffer: result.buffer, contentType: 'application/json; charset=utf-8' };
  }
}
