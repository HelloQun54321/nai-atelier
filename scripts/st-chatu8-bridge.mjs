import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

const STATE_FILE = join(process.cwd(), 'local-data', 'st-chatu8-bridge.json');
const MAX_VIBE_DOCUMENT_BYTES = 30 * 1024 * 1024;
const MAX_PREVIEW_IMAGE_BYTES = 30 * 1024 * 1024;
const HISTORY_BATCH_SIZE = 250;

const sha256 = value => createHash('sha256').update(value).digest('hex');
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

const defaultState = () => ({
  version: 1,
  artistLinks: {},
  vibeLinks: {},
  groupLinks: {},
  history: {},
  lastHistorySyncAt: 0,
  lastSyncAt: 0,
});

export const canonicalVibeSourceHash = document => {
  const image = String(document?.image || '').replace(/^data:image\/[^;]+;base64,/i, '');
  if (image) {
    try {
      const bytes = Buffer.from(image, 'base64');
      if (bytes.length) return sha256(bytes);
    } catch { /* Fall back to the declared identifier below. */ }
  }
  const declared = String(document?.id || '').toLowerCase();
  return /^[a-f0-9]{64}$/.test(declared) ? declared : '';
};

export const resolveStUserFile = (root, publicPath) => {
  if (!root || typeof publicPath !== 'string' || !publicPath.startsWith('/user/')) return null;
  const userRoot = resolve(root, 'data', 'default-user', 'user');
  const candidate = resolve(userRoot, publicPath.slice('/user/'.length));
  const rel = relative(userRoot, candidate);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? candidate : null;
};

export const collectStHistoryCandidates = (settings, resolvePath) => {
  const candidates = [];
  for (const entry of Object.values(settings?.jiuguanStorage || {})) {
    for (const image of Array.isArray(entry?.images) ? entry.images : []) {
      if (image?.isVideo || !image?.path || image.path === image.thumbnail_path) continue;
      const filePath = resolvePath(image.path);
      if (!filePath) continue;
      const externalId = sha256(String(image.path).replaceAll('\\', '/').toLowerCase());
      candidates.push({ image, filePath, externalId });
    }
  }
  return candidates;
};

const findSillyTavernRoot = async projectRoot => {
  const candidates = [
    process.env.SILLY_TAVERN_ROOT,
    resolve(projectRoot, '..', 'SillyTavern'),
    'D:\\SillyTavern',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const root = resolve(candidate);
      await stat(join(root, 'data', 'default-user', 'settings.json'));
      return root;
    } catch { /* Try the next known location. */ }
  }
  return null;
};

const readNovelAiMetadata = async filePath => {
  if (extname(filePath).toLowerCase() !== '.png') return { prompt: '', negativePrompt: '', params: {} };
  const handle = await open(filePath, 'r');
  try {
    const size = Math.min((await handle.stat()).size, 4 * 1024 * 1024);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, 0);
    if (buffer.subarray(1, 4).toString('ascii') !== 'PNG') return { prompt: '', negativePrompt: '', params: {} };
    let offset = 8;
    let comment = null;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
      const end = offset + 12 + length;
      if (end > buffer.length) break;
      if (type === 'tEXt') {
        const chunk = buffer.subarray(offset + 8, offset + 8 + length);
        const separator = chunk.indexOf(0);
        const keyword = separator >= 0 ? chunk.subarray(0, separator).toString('latin1') : '';
        if (keyword === 'Comment') {
          comment = chunk.subarray(separator + 1).toString('utf8');
          break;
        }
      }
      if (type === 'IEND') break;
      offset = end;
    }
    if (!comment) return { prompt: '', negativePrompt: '', params: {} };
    const parsed = JSON.parse(comment);
    const negativePrompt = String(parsed?.v4_negative_prompt?.caption?.base_caption || parsed?.uc || '');
    const characters = Array.isArray(parsed?.v4_prompt?.caption?.char_captions)
      ? parsed.v4_prompt.caption.char_captions.map((entry, index) => ({
          id: `st-${index + 1}`,
          prompt: String(entry?.char_caption || ''),
          negativePrompt: String(parsed?.v4_negative_prompt?.caption?.char_captions?.[index]?.char_caption || ''),
          x: Number(entry?.centers?.[0]?.x ?? 0.5),
          y: Number(entry?.centers?.[0]?.y ?? 0.5),
        }))
      : [];
    return {
      prompt: String(parsed?.prompt || parsed?.v4_prompt?.caption?.base_caption || ''),
      negativePrompt,
      params: {
        width: Number(parsed?.width || 832),
        height: Number(parsed?.height || 1216),
        steps: Number(parsed?.steps || 28),
        scale: Number(parsed?.scale || 5),
        sampler: String(parsed?.sampler || 'k_euler_ancestral'),
        seed: Number(parsed?.seed || 0),
        cfgRescale: Number(parsed?.cfg_rescale || 0),
        useCoords: parsed?.v4_prompt?.use_coords === true,
        characters,
      },
    };
  } catch {
    return { prompt: '', negativePrompt: '', params: {} };
  } finally {
    await handle.close();
  }
};

const chainToArtist = (chain, externalId) => {
  const activeModules = Array.isArray(chain.modules) ? chain.modules.filter(module => module?.isActive !== false) : [];
  const pre = activeModules.filter(module => module.position !== 'post').map(module => module.content).filter(Boolean);
  const post = activeModules.filter(module => module.position === 'post').map(module => module.content).filter(Boolean);
  return {
    externalId,
    name: chain.name,
    fixedPrompt: [chain.basePrompt, ...pre].filter(Boolean).join(', '),
    fixedPromptEnd: post.join(', '),
    negativePrompt: chain.negativePrompt || '',
    previewImage: chain.previewImage || '',
    updatedAt: Number(chain.updatedAt || 0),
  };
};

const artistHash = artist => sha256(JSON.stringify({
  name: String(artist.name || ''),
  fixedPrompt: String(artist.fixedPrompt || ''),
  fixedPromptEnd: String(artist.fixedPromptEnd || ''),
  negativePrompt: String(artist.negativePrompt || ''),
}));

const artistToChainBody = (artist, existing) => ({
  name: String(artist.name || '未命名画师串').slice(0, 100),
  description: existing?.description || '与 SillyTavern st-chatu8 双向同步',
  type: 'style',
  tags: Array.isArray(existing?.tags) ? existing.tags : [],
  basePrompt: String(artist.fixedPrompt || ''),
  negativePrompt: String(artist.negativePrompt || ''),
  modules: artist.fixedPromptEnd ? [{
    id: 'st-chatu8-postfix', name: '后置画风', content: String(artist.fixedPromptEnd), isActive: true, position: 'post',
  }] : [],
  params: existing?.params || {},
  variableValues: existing?.variableValues || { subject: '' },
});

export class StChatu8Bridge {
  constructor({ projectRoot = process.cwd(), requestWorkerJson, requestWorkerBuffer }) {
    this.projectRoot = projectRoot;
    this.requestWorkerJson = requestWorkerJson;
    this.requestWorkerBuffer = requestWorkerBuffer;
    this.root = null;
    this.state = defaultState();
    this.writeQueue = Promise.resolve();
    this.historySyncPromise = null;
  }

  async init() {
    this.root = await findSillyTavernRoot(this.projectRoot);
    try { this.state = { ...defaultState(), ...JSON.parse(await readFile(STATE_FILE, 'utf8')) }; } catch { /* First run. */ }
  }

  startHistorySync() {
    if (!this.root || this.historySyncPromise) return;
    this.historySyncPromise = this.syncHistory().catch(error => {
      console.error('[st-chatu8 bridge] 历史同步失败:', error.message);
    }).finally(() => { this.historySyncPromise = null; });
  }

  status() {
    return {
      connected: Boolean(this.root),
      sillyTavernRoot: this.root,
      linkedArtists: Object.keys(this.state.artistLinks || {}).length,
      linkedGroups: Object.keys(this.state.groupLinks || {}).length,
      linkedHistory: Object.keys(this.state.history || {}).length,
      lastSyncAt: Number(this.state.lastSyncAt || 0),
      lastHistorySyncAt: Number(this.state.lastHistorySyncAt || 0),
      historySyncing: Boolean(this.historySyncPromise),
    };
  }

  async saveState() {
    const snapshot = JSON.stringify(this.state, null, 2) + '\n';
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(STATE_FILE), { recursive: true });
      const temporary = `${STATE_FILE}.${process.pid}.tmp`;
      await writeFile(temporary, snapshot, 'utf8');
      await rename(temporary, STATE_FILE);
    });
    return this.writeQueue;
  }

  async readStSettings() {
    if (!this.root) throw Object.assign(new Error('未找到 SillyTavern'), { status: 503 });
    const settingsPath = join(this.root, 'data', 'default-user', 'settings.json');
    const document = JSON.parse(await readFile(settingsPath, 'utf8'));
    return document?.extension_settings?.['st-chatu8'] || {};
  }

  async readStPreviewData(publicPath) {
    const filePath = this.resolveStUserPath(publicPath);
    if (!filePath) return null;
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
  }

  resolveStUserPath(publicPath) {
    return resolveStUserFile(this.root, publicPath);
  }

  async syncHistory() {
    const settings = await this.readStSettings();
    const candidates = collectStHistoryCandidates(settings, publicPath => this.resolveStUserPath(publicPath));
    const unchecked = [];
    const known = new Set();
    for (const candidate of candidates) {
      const { image, externalId } = candidate;
      const previous = this.state.history[externalId];
      this.state.history[externalId] = { ...this.state.history[externalId], path: image.path, createdAt: Number(image.date || Date.now()) };
      if (!previous?.importedAt) unchecked.push(candidate);
    }
    for (let offset = 0; offset < unchecked.length; offset += 80) {
      const batch = unchecked.slice(offset, offset + 80).map(item => item.externalId);
      const result = await this.requestWorkerJson('/api/integrations/st-chatu8/history/known', { method: 'POST', body: { externalIds: batch } });
      for (const id of result.externalIds || []) known.add(id);
    }
    const pending = [];
    for (const { image, filePath, externalId } of unchecked) {
        if (known.has(externalId)) {
          this.state.history[externalId].importedAt ||= Date.now();
          continue;
        }
        try {
          const metadata = await readNovelAiMetadata(filePath);
          pending.push({
            externalId,
            imageType: extname(filePath).toLowerCase() === '.jpg' || extname(filePath).toLowerCase() === '.jpeg' ? 'image/jpeg' : 'image/png',
            sourceName: 'st-chatu8',
            createdAt: Number(image.date || Date.now()),
            ...metadata,
          });
        } catch { /* A half-written or deleted image is retried next scan. */ }
        if (pending.length >= HISTORY_BATCH_SIZE) await this.importHistoryBatch(pending.splice(0));
    }
    if (pending.length) await this.importHistoryBatch(pending);
    this.state.lastHistorySyncAt = Date.now();
    await this.saveState();
  }

  async importHistoryBatch(items) {
    const result = await this.requestWorkerJson('/api/integrations/st-chatu8/history/import', { method: 'POST', body: { items } });
    const now = Date.now();
    for (const item of items) this.state.history[item.externalId].importedAt = now;
    await this.saveState();
    return result;
  }

  async readHistoryImage(externalId) {
    const record = this.state.history?.[externalId];
    const filePath = record ? this.resolveStUserPath(record.path) : null;
    if (!filePath) throw Object.assign(new Error('st-chatu8 原图记录不存在'), { status: 404 });
    const buffer = await readFile(filePath);
    const extension = extname(filePath).toLowerCase();
    return { buffer, contentType: extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png' };
  }

  async syncArtists(incoming = []) {
    let chains = await this.requestWorkerJson('/api/chains');
    chains = Array.isArray(chains) ? chains : [];
    const byId = new Map(chains.map(chain => [chain.id, chain]));
    const linkedIds = new Set(Object.values(this.state.artistLinks || {}).map(link => link.chainId));
    const incomingIds = new Set();
    for (const raw of incoming.slice(0, 1000)) {
      const artist = {
        externalId: String(raw.externalId || '').slice(0, 160), name: String(raw.name || '').trim().slice(0, 100),
        fixedPrompt: String(raw.fixedPrompt || ''), fixedPromptEnd: String(raw.fixedPromptEnd || ''),
        negativePrompt: String(raw.negativePrompt || ''), previewPath: String(raw.previewPath || ''),
        updatedAt: Number(raw.updatedAt || 0),
      };
      if (!artist.externalId || !artist.name) continue;
      incomingIds.add(artist.externalId);
      let link = this.state.artistLinks[artist.externalId];
      let chain = link ? byId.get(link.chainId) : null;
      if (!chain) chain = chains.find(item => item.type === 'style' && item.name === artist.name && !linkedIds.has(item.id));
      if (!chain) {
        const created = await this.requestWorkerJson('/api/chains', { method: 'POST', body: artistToChainBody(artist) });
        chains = await this.requestWorkerJson('/api/chains');
        chain = chains.find(item => item.id === created.id);
      }
      if (!chain) continue;
      const stHash = artistHash(artist);
      link ||= { chainId: chain.id, lastStHash: '', lastNpmHash: '' };
      const npmHash = artistHash(chainToArtist(chain, artist.externalId));
      const previewChanged = artist.previewPath !== String(link.lastStPreviewPath || '')
        || String(chain.previewImage || '') !== String(link.lastNpmPreviewImage || '');
      if (stHash !== npmHash || previewChanged) {
        const body = artistToChainBody(artist, chain);
        // A missing st-chatu8 preview means "no preview supplied", not
        // "delete the NaiStudio cover". Only replace a cover when the
        // authoritative side actually provides image data.
        if (artist.previewPath) body.previewImage = await this.readStPreviewData(artist.previewPath);
        await this.requestWorkerJson(`/api/chains/${encodeURIComponent(chain.id)}`, { method: 'PUT', body });
        const refreshed = await this.requestWorkerJson(`/api/chains/${encodeURIComponent(chain.id)}`);
        if (refreshed?.id) {
          chain = refreshed;
          byId.set(chain.id, chain);
        }
      }
      this.state.artistLinks[artist.externalId] = {
        chainId: chain.id,
        lastStHash: stHash,
        lastNpmHash: stHash,
        lastStPreviewPath: artist.previewPath,
        lastNpmPreviewImage: String(chain.previewImage || ''),
      };
      linkedIds.add(chain.id);
    }
    chains = await this.requestWorkerJson('/api/chains');
    const artists = chains.filter(chain => chain.type === 'style').map(chain => {
      let pair = Object.entries(this.state.artistLinks).find(([, link]) => link.chainId === chain.id);
      if (!pair) {
        const externalId = `npm:${chain.id}`;
        this.state.artistLinks[externalId] = { chainId: chain.id, lastStHash: '', lastNpmHash: '' };
        pair = [externalId, this.state.artistLinks[externalId]];
      }
      if (pair[0].startsWith('st:') && !incomingIds.has(pair[0])) return null;
      const artist = chainToArtist(chain, pair[0]);
      pair[1].lastNpmHash = artistHash(artist);
      pair[1].lastNpmPreviewImage = String(chain.previewImage || '');
      return artist;
    }).filter(Boolean);
    await this.saveState();
    return artists;
  }

  async syncVibes(documents = [], incomingGroups = [], presentSourceHashes = []) {
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
      const result = await this.requestWorkerJson('/api/vibes/import', { method: 'POST', body: { document } });
      const requestedName = String(document.name || '').trim();
      if (result?.item?.id) this.state.vibeLinks[sourceHash] = { vibeId: result.item.id, lastSeenAt: Date.now() };
      const requestedStrength = clamp(document.importInfo?.strength, 0, 1, 0.6);
      if (requestedName && (result?.item?.name !== requestedName || Number(result?.item?.defaultStrength) !== requestedStrength)) {
        await this.requestWorkerJson(`/api/vibes/${encodeURIComponent(result.item.id)}`, {
          method: 'PUT', body: { name: requestedName, defaultStrength: requestedStrength },
        });
      }
    }
    const vibeResult = await this.requestWorkerJson('/api/vibes');
    const vibes = Array.isArray(vibeResult?.items) ? vibeResult.items : [];
    const bySourceHash = new Map(vibes.map(vibe => [vibe.sourceHash, vibe]));
    let groupsResult = await this.requestWorkerJson('/api/vibe-groups');
    let groups = Array.isArray(groupsResult?.items) ? groupsResult.items : [];
    const incomingGroupIds = new Set();
    for (const group of incomingGroups.slice(0, 200)) {
      const name = String(group?.name || '').trim().slice(0, 100);
      if (!name || !Array.isArray(group.vibes)) continue;
      const externalGroupId = String(group.externalId || name);
      const slots = group.vibes.slice(0, 4).map(reference => {
        const vibe = bySourceHash.get(reference.sourceHash);
        const encoding = vibe?.encodings?.find(item => Math.abs(Number(item.informationExtracted) - 1) < 0.001) || vibe?.encodings?.[0];
        return vibe && encoding ? {
          vibeId: vibe.id, vibeName: vibe.name, encodingId: encoding.id,
          informationExtracted: Number(encoding.informationExtracted), strength: clamp(reference.strength, 0, 1, 0.6),
        } : null;
      }).filter(Boolean);
      if (!slots.length) continue;
      let linkedId = this.state.groupLinks[externalGroupId];
      let existing = groups.find(item => item.id === linkedId) || groups.find(item => item.name === name);
      if (existing) {
        await this.requestWorkerJson(`/api/vibe-groups/${encodeURIComponent(existing.id)}`, { method: 'PUT', body: { name, slots, normalizeStrengths: group.normalizeStrengths !== false } });
        linkedId = existing.id;
      } else {
        const created = await this.requestWorkerJson('/api/vibe-groups', { method: 'POST', body: { name, slots, normalizeStrengths: group.normalizeStrengths !== false } });
        linkedId = created?.item?.id;
      }
      if (linkedId) {
        this.state.groupLinks[externalGroupId] = linkedId;
        incomingGroupIds.add(linkedId);
      }
    }
    groupsResult = await this.requestWorkerJson('/api/vibe-groups');
    groups = Array.isArray(groupsResult?.items) ? groupsResult.items : [];
    const byId = new Map(vibes.map(vibe => [vibe.id, vibe]));
    await this.saveState();
    return {
      vibes: vibes.filter(vibe => !this.state.vibeLinks[vibe.sourceHash] || incomingSourceHashes.has(vibe.sourceHash)).map(vibe => ({
        id: vibe.id, name: vibe.name, sourceHash: vibe.sourceHash, defaultStrength: vibe.defaultStrength,
        updatedAt: vibe.updatedAt, encodingCount: vibe.encodings?.length || 0,
        fileUrl: `/api/integrations/st-chatu8/vibes/${encodeURIComponent(vibe.id)}/file`,
      })),
      groups: groups.filter(group => !Object.values(this.state.groupLinks).includes(group.id) || incomingGroupIds.has(group.id)).map(group => ({
        externalId: `npm:${group.id}`, name: group.name, normalizeStrengths: group.normalizeStrengths,
        updatedAt: group.updatedAt,
        vibes: group.slots.map(slot => ({ sourceHash: byId.get(slot.vibeId)?.sourceHash, strength: slot.strength })).filter(item => item.sourceHash),
      })),
    };
  }

  async sync(payload = {}) {
    const artists = await this.syncArtists(Array.isArray(payload.artists) ? payload.artists : []);
    const vibeData = await this.syncVibes(
      Array.isArray(payload.vibeDocuments) ? payload.vibeDocuments : [],
      Array.isArray(payload.vibeGroups) ? payload.vibeGroups : [],
      Array.isArray(payload.vibeSourceHashes) ? payload.vibeSourceHashes : [],
    );
    this.state.lastSyncAt = Date.now();
    await this.saveState();
    this.startHistorySync();
    return { artists, ...vibeData, status: this.status() };
  }

  async readVibeFile(vibeId) {
    const result = await this.requestWorkerBuffer(`/api/vibes/${encodeURIComponent(vibeId)}/file`);
    if (result.status >= 400) throw Object.assign(new Error('Vibe 文件不存在'), { status: result.status });
    return { buffer: result.buffer, contentType: 'application/json; charset=utf-8' };
  }
}
