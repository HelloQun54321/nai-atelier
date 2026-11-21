import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types, getRequestHeaders, saveSettings, saveSettingsDebounced } from '../../../../script.js';

const EXTENSION_NAME = 'nai-prompt-manager-bridge';
const CHATU8_NAME = 'st-chatu8';
const BAIBAI_NAME = 'baibai_image';
const BAIBAI_ARTIST_COVER_DIR = '柏宝绘_画师串';
const BAIBAI_IDB_NAME = 'baibai_image_vibes';
const BAIBAI_IDB_STORE = 'vibes';
const VIBE_ENCODING_KEY = 'b36a8472fe418d9f80d6bb1c54e3a6e62c62936aa7bf31dae2bcf7e929f6430f';
const DEFAULT_URL = 'http://localhost:3000';
const SYNC_INTERVAL = 10 * 60_000;
const EVENT_SYNC_DELAY = 3_000;
const FOCUS_SYNC_COOLDOWN = 30_000;
let syncing = false;
let syncTimer = null;
let presetObserver = null;
let eventSyncTimer = null;
let lastStSignature = '';
let lastBaiBaiSignature = '';
let lastAutoSyncAt = 0;
const vibeReadCache = new Map();
const baiBaiVibeReadCache = new Map();

const defaults = () => ({
  baseUrl: DEFAULT_URL,
  autoSync: true,
  panelExpanded: false,
  artistIds: {},
  artistHashes: {},
  artistUpdatedAt: {},
  artistPreviewUrls: {},
  artistPreviewHashes: {},
  artistPreviewPaths: {},
  vibeUploadedHashes: {},
  vibeDownloadedVersions: {},
  lastSyncAt: 0,
  baiBaiArtistIds: {},
  baiBaiArtistHashes: {},
  baiBaiArtistUpdatedAt: {},
  baiBaiArtistPreviewUrls: {},
  baiBaiArtistPreviewHashes: {},
  baiBaiArtistPreviewPaths: {},
  baiBaiVibeUploadedHashes: {},
  baiBaiVibeDownloadedVersions: {},
  baiBaiLastSyncAt: 0,
});

const settings = () => {
  const current = extension_settings[EXTENSION_NAME];
  if (!current || typeof current !== 'object' || Array.isArray(current)) extension_settings[EXTENSION_NAME] = defaults();
  else for (const [key, value] of Object.entries(defaults())) if (current[key] === undefined) current[key] = value;
  return extension_settings[EXTENSION_NAME];
};

const chatu8 = () => extension_settings[CHATU8_NAME] || null;
const baibai = () => extension_settings[BAIBAI_NAME] || null;

const stSyncSignature = () => {
  const st = chatu8();
  if (!st) return '';
  const filteredStorage = Object.fromEntries(
    Object.entries(st.configImageStorage || {}).filter(
      ([k, v]) => !k.startsWith('cfgimg_npm_') && !String(v?.path || '').includes('npm_bridge_')
    )
  );
  return JSON.stringify({
    yushe: st.yushe || {},
    vibePresets: st.vibePresets || {},
    vibeGroups: st.vibeGroups || {},
    configImageStorage: filteredStorage,
  });
};

const baiBaiSyncSignature = () => {
  const bb = baibai();
  if (!bb) return '';
  return JSON.stringify({
    artistPresets: Array.isArray(bb.nai?.artistPresets) ? bb.nai.artistPresets : [],
    vibes: Array.isArray(bb.nai?.vibes) ? bb.nai.vibes : [],
  });
};

const hashText = async value => {
  const bytes = new TextEncoder().encode(String(value));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
};

const hashBytes = async bytes => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
};

const canonicalVibeHash = async document => {
  const image = String(document?.image || '').replace(/^data:image\/[^;]+;base64,/i, '');
  if (!image) return String(document?.id || '').toLowerCase();
  try {
    const binary = atob(image);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return await hashBytes(bytes);
  } catch {
    return String(document?.id || '').toLowerCase();
  }
};

const textToBase64 = text => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const setStatus = (message, state = '') => {
  const node = document.querySelector('.npm-bridge-status');
  if (node) { node.textContent = message; node.title = message; node.dataset.state = state; }
  const badge = document.querySelector('.npm-bridge-summary-status');
  if (badge) {
    badge.textContent = state === 'working' ? '同步中' : state === 'success' ? '已核对' : state === 'error' ? '需处理' : state === 'pending' ? '待确认' : '待连接';
    badge.title = message; badge.dataset.state = state;
  }
};

const collectArtistPreviews = () => {
  const st = chatu8();
  return Object.entries(st?.yushe || {}).map(([name, preset]) => {
    const previewImageId = preset?.previewImageId;
    const path = previewImageId ? st?.configImageStorage?.[previewImageId]?.path : '';
    return previewImageId && path ? { name, path } : null;
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
};

const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const enhancePresetSelector = () => {
  const backdrops = typeof document.querySelectorAll === 'function' ? document.querySelectorAll('.st-chatu8-workflow-viz-backdrop') : [];
  if (!backdrops.length) return;
  const previews = collectArtistPreviews();
  if (!previews.length) return;
  for (const backdrop of backdrops) {
    // st-chatu8 v3+ 的 Vibe / Vibe 组 / 资产弹窗共用 workflow-viz-backdrop，仅向预设弹窗注入配图筛选。
    if (backdrop.dataset.npmBridgeEnhanced === 'true' || !backdrop.querySelector('.st-chatu8-preset-viz-container')) continue;
    const toolbar = backdrop.querySelector('.st-chatu8-workflow-viz-toolbar');
    const search = backdrop.querySelector('.st-chatu8-viz-search-input');
    if (!toolbar || !search) continue;
    backdrop.dataset.npmBridgeEnhanced = 'true';

    const host = document.createElement('div');
    host.className = 'npm-bridge-preview-host';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'npm-bridge-preview-trigger';
    trigger.innerHTML = `<i class="fa-solid fa-images"></i><span>有配图 ${previews.length}</span>`;
    trigger.title = '查看由 st-chatu8 与 NAI Atelier 共享的画师串配图';
    const picker = document.createElement('div');
    picker.className = 'npm-bridge-preview-picker';
    picker.hidden = true;
    picker.innerHTML = previews.map(item => `
      <button type="button" class="npm-bridge-preview-item" data-name="${escapeHtml(item.name)}">
        <img src="${escapeHtml(item.path)}" alt="" loading="lazy">
        <span>${escapeHtml(item.name)}</span>
      </button>
    `).join('');
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      picker.hidden = !picker.hidden;
      trigger.classList.toggle('active', !picker.hidden);
    });
    picker.addEventListener('click', event => {
      const item = event.target.closest('.npm-bridge-preview-item');
      if (!item) return;
      search.value = item.dataset.name || '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      picker.hidden = true;
      trigger.classList.remove('active');
    });
    host.append(trigger, picker);
    toolbar.appendChild(host);
  }
};

const watchPresetSelector = () => {
  if (presetObserver) presetObserver.disconnect();
  presetObserver = new MutationObserver(() => enhancePresetSelector());
  presetObserver.observe(document.body, { childList: true, subtree: true });
  enhancePresetSelector();
};

const uniqueName = (collection, requested, currentName = '') => {
  if (!collection[requested] || requested === currentName) return requested;
  let index = 2;
  while (collection[`${requested} (${index})`]) index++;
  return `${requested} (${index})`;
};

const artistSnapshot = (name, preset, bridgeSettings, source = chatu8()) => {
  const externalId = bridgeSettings.artistIds[name];
  const previewPath = String(source?.configImageStorage?.[preset?.previewImageId]?.path || '');
  return {
    externalId, name,
    fixedPrompt: String(preset?.fixedPrompt || ''),
    fixedPromptEnd: String(preset?.fixedPrompt_end || ''),
    negativePrompt: String(preset?.negativePrompt || ''),
    previewPath,
    previewSourceImage: previewPath && bridgeSettings.artistPreviewPaths[externalId] === previewPath ? bridgeSettings.artistPreviewUrls[externalId] || '' : '',
  };
};

const collectArtists = async (bridgeSettings, sourceSettings = chatu8()) => {
  const source = sourceSettings?.yushe || {};
  const artists = [];
  for (const [name, preset] of Object.entries(source)) {
    let externalId = bridgeSettings.artistIds[name];
    // 首次读取用名称生成稳定 ID，多个酒馆页面或回执尚未落盘时也能识别为同一条。
    if (!externalId) externalId = bridgeSettings.artistIds[name] = `st:${await hashText(name)}`;
    const item = artistSnapshot(name, preset, bridgeSettings, sourceSettings);
    const hash = await hashText(JSON.stringify(item));
    if (bridgeSettings.artistHashes[externalId] !== hash) {
      bridgeSettings.artistHashes[externalId] = hash;
      bridgeSettings.artistUpdatedAt[externalId] = Date.now();
    }
    artists.push({ ...item, updatedAt: bridgeSettings.artistUpdatedAt[externalId] || Date.now() });
  }
  return artists;
};

const artistListSignature = artists => JSON.stringify(artists.map(({ updatedAt: _updatedAt, ...artist }) => artist).sort((a, b) => a.externalId.localeCompare(b.externalId)));

// saveSettings 会吞掉保存错误，必须回读酒馆服务确认落盘；不把当前页面内存当接收成功。
const readPersistedArtistSnapshot = async artists => {
  const incomplete = reason => ({ artists, artistSnapshot: { version: 2, complete: false, count: artists.length }, reason });
  try {
    const response = await fetch('/api/settings/get', { method: 'POST', headers: getRequestHeaders(), body: '{}' });
    if (!response.ok) return incomplete(`酒馆设置核对失败 (${response.status})`);
    const payload = await response.json();
    const document = typeof payload.settings === 'string' ? JSON.parse(payload.settings) : payload.settings;
    const source = document?.extension_settings?.[CHATU8_NAME];
    if (!source?.yushe || typeof source.yushe !== 'object' || Array.isArray(source.yushe) || Object.values(source.yushe).some(preset => !preset || typeof preset !== 'object' || Array.isArray(preset))) return incomplete('酒馆风格串列表未就绪');
    const persistedSettings = { ...defaults(), ...(document.extension_settings[EXTENSION_NAME] || {}) };
    const persisted = await collectArtists(persistedSettings, source);
    if (artistListSignature(persisted) !== artistListSignature(artists)) return incomplete('酒馆设置尚未保存，请手动同步重试');
    return { artists: persisted, artistSnapshot: { version: 2, complete: true, count: persisted.length } };
  } catch { return incomplete('酒馆设置核对失败，请手动同步重试'); }
};

const decodeStoredVibeText = raw => {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (text.startsWith('{') || text.startsWith('[')) return text;
  if (text.startsWith('data:')) {
    const comma = text.indexOf(',');
    if (comma < 0) return '';
    const header = text.slice(0, comma);
    const body = text.slice(comma + 1);
    if (header.includes(';base64')) {
      const binary = atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    return decodeURIComponent(body);
  }
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return text;
  }
};

const readStoredVibes = async (bridgeSettings, { force = false } = {}) => {
  const st = chatu8();
  const documents = [];
  const all = new Map();
  const bridgeDuplicates = [];
  const activeCacheKeys = new Set();
  for (const [name, preset] of Object.entries(st?.vibePresets || {})) {
    const dataId = preset?.vibeDataId;
    const storageEntry = dataId ? st?.configImageStorage?.[dataId] : null;
    const path = storageEntry?.path || '';
    if (!path) continue;
    const cacheKey = `${dataId}|${path}|${Number(storageEntry?.date || 0)}`;
    activeCacheKeys.add(cacheKey);
    try {
      let parsed = !force ? vibeReadCache.get(cacheKey) : null;
      if (!parsed) {
        const response = await fetch(path, { cache: 'no-store' });
        if (!response.ok) continue;
        const text = decodeStoredVibeText(await response.text());
        const document = JSON.parse(text);
        if (document?.identifier !== 'novelai-vibe-transfer' || !document.id) continue;
        const sourceHash = await canonicalVibeHash(document);
        if (!/^[a-f0-9]{64}$/.test(sourceHash)) continue;
        parsed = { document, sourceHash };
        vibeReadCache.set(cacheKey, parsed);
      }
      const entry = {
        name, dataId, document: parsed.document, sourceHash: parsed.sourceHash, path,
        isBridge: /\/(?:cfgimg_)?npm_bridge_[^/]+$/i.test(path),
      };
      const existing = all.get(parsed.sourceHash);
      if (existing && (existing.isBridge || entry.isBridge)) {
        if (existing.isBridge && !entry.isBridge) {
          bridgeDuplicates.push(existing);
          all.set(parsed.sourceHash, entry);
        } else {
          bridgeDuplicates.push(entry);
        }
        continue;
      }
      all.set(parsed.sourceHash, entry);
    } catch (error) {
      console.warn('[NPM Bridge] 无法读取 Vibe:', name, error);
    }
  }
  for (const key of vibeReadCache.keys()) {
    if (!activeCacheKeys.has(key)) vibeReadCache.delete(key);
  }
  for (const entry of all.values()) {
    const preset = st.vibePresets?.[entry.name] || {};
    const document = {
      ...entry.document,
      name: entry.name,
      importInfo: {
        ...(entry.document.importInfo || {}),
        model: preset.model || entry.document.importInfo?.model || 'nai-diffusion-4-5-full',
        information_extracted: Number(preset.infoExtract ?? entry.document.importInfo?.information_extracted ?? 1),
        strength: Number(preset.strength ?? entry.document.importInfo?.strength ?? 0.6),
      },
    };
    entry.document = document;
    entry.hash = await hashText(JSON.stringify(document));
    if (bridgeSettings.vibeUploadedHashes[entry.sourceHash] !== entry.hash) documents.push(document);
  }
  return { documents, all, bridgeDuplicates };
};

const cleanupBridgeVibeDuplicates = async duplicates => {
  const st = chatu8();
  for (const duplicate of duplicates) {
    const current = st.vibePresets?.[duplicate.name];
    const storage = st.configImageStorage?.[duplicate.dataId];
    if (!duplicate.isBridge || current?.vibeDataId !== duplicate.dataId || storage?.path !== duplicate.path) continue;
    if (storage.path) {
      try {
        await fetch('/api/images/delete', {
          method: 'POST',
          headers: getRequestHeaders(),
          body: JSON.stringify({ path: storage.path }),
        });
      } catch (error) {
        console.warn('[NPM Bridge] 清理重复 Vibe 文件失败:', duplicate.name, error);
      }
    }
    delete st.vibePresets[duplicate.name];
    delete st.configImageStorage[duplicate.dataId];
  }
};

const collectGroups = (vibeMap, bridgeSettings) => {
  const st = chatu8();
  const sourceHashByDataId = new Map(Array.from(vibeMap.entries()).map(([sourceHash, value]) => [value.dataId, sourceHash]));
  return Object.entries(st?.vibeGroups || {}).map(([name, group]) => ({
    externalId: bridgeSettings.groupIds?.[name] || `st-group:${name}`,
    name,
    normalizeStrengths: st?.normalizeRefStrength === 'true',
    updatedAt: Number(group?.updatedAt || 0),
    vibes: (Array.isArray(group?.vibes) ? group.vibes : []).map(vibe => ({
      sourceHash: sourceHashByDataId.get(vibe?.vibeDataId),
      strength: Number(vibe?.strength ?? 0.6),
    })).filter(vibe => vibe.sourceHash),
  })).filter(group => group.vibes.length);
};

const uploadVibeText = async (dataId, text) => {
  const response = await fetch('/api/images/upload', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      image: textToBase64(text),
      format: 'png',
      ch_name: 'chatu8_config',
      // 文件名对齐 dataId，确保最新版 st-chatu8 deleteConfigImage 的路径安全校验放行清理。
      filename: dataId,
    }),
  });
  if (!response.ok) throw new Error(`SillyTavern 保存 Vibe 失败：${response.status}`);
  return (await response.json()).path;
};

const bytesToBase64 = bytes => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x4000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x4000));
  }
  return btoa(binary);
};

const resolvePresetName = (collection, requested, currentName = '', externalId = '', idMap = {}) => {
  if (currentName && currentName === requested) return currentName;
  if (!collection[requested]) return requested;
  const mappedId = idMap[requested];
  if (!mappedId || mappedId === externalId) return requested;
  let index = 2;
  while (collection[`${requested} (${index})`]) index++;
  return `${requested} (${index})`;
};

const uploadArtistPreview = async (name, imageUrl, oldPath = null, externalId = '', fileId = '') => {
  const bridgeSettings = settings();
  const url = imageUrl.startsWith('http') ? imageUrl : `${bridgeSettings.baseUrl.replace(/\/$/, '')}${imageUrl}`;
  const imageResponse = await fetch(url, { cache: 'no-store' });
  if (!imageResponse.ok) throw new Error(`下载画师串配图失败：${imageResponse.status}`);
  const type = String(imageResponse.headers.get('content-type') || 'image/png').split(';')[0].toLowerCase();
  const format = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  const contentHash = await hashBytes(bytes);

  const key = externalId || name;
  if (oldPath && bridgeSettings.artistPreviewHashes?.[key] === contentHash) {
    return { path: oldPath, contentHash, unchanged: true };
  }

  const nextId = fileId || `cfgimg_npm_bridge_preview_${crypto.randomUUID()}`;
  const response = await fetch('/api/images/upload', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      image: bytesToBase64(bytes),
      format,
      ch_name: 'chatu8_config',
      // 文件名对齐 previewImageId，使 st-chatu8 v3+ 删预设时能一并清理磁盘文件。
      filename: nextId,
    }),
  });
  if (!response.ok) throw new Error(`SillyTavern 保存画师串配图失败：${response.status}`);
  const newPath = (await response.json()).path;

  if (oldPath && oldPath !== newPath && /(?:cfgimg_)?npm_bridge_preview_/i.test(oldPath)) {
    try {
      await fetch('/api/images/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ path: oldPath }),
      });
    } catch (error) {
      console.warn('[NPM Bridge] 清理旧画师配图失败:', oldPath, error);
    }
  }

  return { id: nextId, path: newPath, contentHash, unchanged: false };
};

const applyArtists = async (artists, receipts = []) => {
  const st = chatu8();
  const bridgeSettings = settings();
  st.yushe ||= {};
  st.configImageStorage ||= {};
  bridgeSettings.artistPreviewHashes ||= {};
  bridgeSettings.artistPreviewUrls ||= {};
  bridgeSettings.artistPreviewPaths ||= {};

  const artistsWithPreviews = artists.filter(a => a.previewImage);
  let downloadedCount = 0;
  let appliedCount = 0;
  const namesById = new Map(Object.entries(bridgeSettings.artistIds).map(([name, id]) => [id, name]));

  for (const artist of artists) {
    let failure = '';
    const currentName = namesById.get(artist.externalId) || '';
    const name = resolvePresetName(st.yushe, artist.name, currentName, artist.externalId, bridgeSettings.artistIds);
    let previewImageId = (currentName ? st.yushe[currentName]?.previewImageId : null) || st.yushe[name]?.previewImageId || null;
    const previousHash = bridgeSettings.artistPreviewHashes[artist.externalId] || '';
    const previousPath = previewImageId ? st.configImageStorage?.[previewImageId]?.path : null;

    if (artist.previewImage) {
      const hasValidPreview = previewImageId && previousPath && previousHash;
      const urlMatches = bridgeSettings.artistPreviewUrls?.[artist.externalId] === artist.previewImage;
      const pathMatches = bridgeSettings.artistPreviewPaths[artist.externalId] === previousPath;
      const needsDownload = !hasValidPreview || !urlMatches || !pathMatches;

      if (needsDownload) {
        try {
          const result = await uploadArtistPreview(name, artist.previewImage, previousPath, artist.externalId);
          if (!result.unchanged || !previewImageId) {
            previewImageId = result.id || `cfgimg_npm_bridge_preview_${crypto.randomUUID()}`;
            st.configImageStorage[previewImageId] = { path: result.path, date: Date.now(), type: 'image' };
          }
          bridgeSettings.artistPreviewHashes[artist.externalId] = result.contentHash;
          bridgeSettings.artistPreviewUrls[artist.externalId] = artist.previewImage;
          bridgeSettings.artistPreviewPaths[artist.externalId] = result.path;
          downloadedCount++;
          if (artistsWithPreviews.length > 5 && (downloadedCount % 15 === 0 || downloadedCount === artistsWithPreviews.length)) {
            setStatus(`正在同步画师串配图 (${downloadedCount}/${artistsWithPreviews.length})…`, 'working');
          }
        } catch (error) {
          console.warn('[NPM Bridge] 无法更新画师配图:', name, error);
          failure = error.message || '封面保存失败';
        }
      }
    }

    const previous = st.yushe[name];
    const unchanged = currentName === name && previous
      && String(previous.fixedPrompt || '') === String(artist.fixedPrompt || '')
      && String(previous.fixedPrompt_end || '') === String(artist.fixedPromptEnd || '')
      && String(previous.negativePrompt || '') === String(artist.negativePrompt || '')
      && (previous.previewImageId || null) === previewImageId;
    if (!unchanged) {
      st.yushe[name] = {
        ...previous,
        fixedPrompt: artist.fixedPrompt || '',
        fixedPrompt_end: artist.fixedPromptEnd || '',
        negativePrompt: artist.negativePrompt || '',
        ...(previewImageId ? { previewImageId } : {}),
      };
      appliedCount++;
    }
    if (currentName && currentName !== name) {
      delete st.yushe[currentName];
      delete bridgeSettings.artistIds[currentName];
    }
    bridgeSettings.artistIds[name] = artist.externalId;
    namesById.set(artist.externalId, name);
    bridgeSettings.artistHashes[artist.externalId] = await hashText(JSON.stringify(artistSnapshot(name, st.yushe[name], bridgeSettings)));
    bridgeSettings.artistUpdatedAt[artist.externalId] = Number(artist.updatedAt || Date.now());
    if (artist.receipt) receipts.push({ externalId: artist.externalId, ...artist.receipt, success: !failure, reason: failure });
  }
  return appliedCount;
};

const applyVibes = async (items, localVibes) => {
  const st = chatu8();
  const bridgeSettings = settings();
  st.vibePresets ||= {};
  st.configImageStorage ||= {};
  for (const item of items) {
    if (localVibes.has(item.sourceHash)) {
      bridgeSettings.vibeDownloadedVersions[item.sourceHash] = Number(item.updatedAt || Date.now());
      continue;
    }
    if (Number(bridgeSettings.vibeDownloadedVersions[item.sourceHash] || 0) >= Number(item.updatedAt || 0)) continue;
    const response = await fetch(`${bridgeSettings.baseUrl.replace(/\/$/, '')}${item.fileUrl}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`下载 Vibe“${item.name}”失败：${response.status}`);
    const text = await response.text();
    const document = JSON.parse(text);
    const dataId = `cfgimg_npm_bridge_${crypto.randomUUID()}`;
    const path = await uploadVibeText(dataId, text);
    st.configImageStorage[dataId] = { path, date: Date.now(), type: 'text' };
    const name = uniqueName(st.vibePresets, item.name);
    st.vibePresets[name] = {
      model: document.importInfo?.model || 'nai-diffusion-4-5-full',
      infoExtract: Number(document.importInfo?.information_extracted ?? 1),
      strength: Number(document.importInfo?.strength ?? item.defaultStrength ?? 0.6),
      imageId: null,
      vibeDataId: dataId,
      thumbnail: document.thumbnail || null,
    };
    localVibes.set(item.sourceHash, { name, dataId, document, hash: await hashText(text) });
    bridgeSettings.vibeDownloadedVersions[item.sourceHash] = Number(item.updatedAt || Date.now());
    bridgeSettings.vibeUploadedHashes[item.sourceHash] = await hashText(text);
  }
};

const applyGroups = (groups, localVibes) => {
  const st = chatu8();
  st.vibeGroups ||= {};
  for (const group of groups) {
    const vibes = group.vibes.map(reference => ({
      vibeDataId: localVibes.get(reference.sourceHash)?.dataId,
      strength: Number(reference.strength ?? 0.6),
    })).filter(reference => reference.vibeDataId).slice(0, 4);
    if (!vibes.length) continue;
    const name = uniqueName(st.vibeGroups, group.name, group.name);
    const previous = st.vibeGroups[name];
    if (previous && JSON.stringify(previous.vibes || []) === JSON.stringify(vibes)) continue;
    st.vibeGroups[name] = {
      ...previous,
      vibes,
      createdAt: st.vibeGroups[name]?.createdAt || Date.now(),
      updatedAt: Number(group.updatedAt || Date.now()),
    };
  }
};

/* ============ 柏宝绘 (ST-BaiBai-Image) 桥接逻辑 ============ */

const baiBaiVibeFingerprint = encodings => Object.keys(encodings || {})
  .sort()
  .map(key => `${key}:${String(encodings[key]?.encoding || '').slice(0, 64)}`)
  .join('|');

const readBaiBaiIdbVibe = key => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB 不可用')); return; }
  const req = indexedDB.open(BAIBAI_IDB_NAME, 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(BAIBAI_IDB_STORE)) db.createObjectStore(BAIBAI_IDB_STORE);
  };
  req.onsuccess = () => {
    const db = req.result;
    try {
      const tx = db.transaction(BAIBAI_IDB_STORE, 'readonly');
      const getReq = tx.objectStore(BAIBAI_IDB_STORE).get(key);
      getReq.onsuccess = () => {
        db.close();
        if (getReq.result) resolve(getReq.result);
        else reject(new Error('Vibe 本地记录不存在'));
      };
      getReq.onerror = () => { db.close(); reject(getReq.error || new Error('读取 Vibe 失败')); };
    } catch (error) {
      db.close();
      reject(error);
    }
  };
  req.onerror = () => reject(req.error || new Error('打开柏宝绘 Vibe 本地存储失败'));
});

const baiBaiArtistSnapshot = (preset, bridgeSettings) => {
  const externalId = bridgeSettings.baiBaiArtistIds[preset.id] || `baibai:${preset.id}`;
  const previewPath = String(preset.previewPath || '');
  return {
    externalId,
    name: String(preset.name || '').trim(),
    prompt: String(preset.prompt || ''),
    quality: String(preset.quality || ''),
    negative: String(preset.negative || ''),
    previewPath,
    previewSourceImage: previewPath && bridgeSettings.baiBaiArtistPreviewPaths[externalId] === previewPath
      ? bridgeSettings.baiBaiArtistPreviewUrls[externalId] || ''
      : '',
  };
};

const collectBaiBaiArtists = async (bridgeSettings, sourceSettings = baibai(), { mutateBridge = true } = {}) => {
  const list = Array.isArray(sourceSettings?.nai?.artistPresets) ? sourceSettings.nai.artistPresets : [];
  const artists = [];
  for (const preset of list) {
    if (!preset || typeof preset !== 'object' || typeof preset.id !== 'string' || !preset.id || preset.id.startsWith('bi_')) continue;
    let externalId = bridgeSettings.baiBaiArtistIds[preset.id];
    if (!externalId) {
      externalId = `baibai:${preset.id}`;
      if (mutateBridge) bridgeSettings.baiBaiArtistIds[preset.id] = externalId;
    }
    const item = baiBaiArtistSnapshot(preset, bridgeSettings);
    if (!item.name) continue;
    const hash = await hashText(JSON.stringify(item));
    if (mutateBridge && bridgeSettings.baiBaiArtistHashes[externalId] !== hash) {
      bridgeSettings.baiBaiArtistHashes[externalId] = hash;
      bridgeSettings.baiBaiArtistUpdatedAt[externalId] = Date.now();
    }
    artists.push({ ...item, updatedAt: bridgeSettings.baiBaiArtistUpdatedAt[externalId] || Date.now() });
  }
  return artists;
};

const readPersistedBaiBaiArtistSnapshot = async artists => {
  const incomplete = reason => ({ artists, artistSnapshot: { version: 2, complete: false, count: artists.length }, reason });
  try {
    const response = await fetch('/api/settings/get', { method: 'POST', headers: getRequestHeaders(), body: '{}' });
    if (!response.ok) return incomplete(`酒馆设置核对失败 (${response.status})`);
    const payload = await response.json();
    const document = typeof payload.settings === 'string' ? JSON.parse(payload.settings) : payload.settings;
    const source = document?.extension_settings?.[BAIBAI_NAME];
    if (!source?.nai || !Array.isArray(source.nai.artistPresets)) return incomplete('柏宝绘画师串列表未就绪');
    const persistedSettings = { ...defaults(), ...(document.extension_settings?.[EXTENSION_NAME] || {}) };
    const persisted = await collectBaiBaiArtists(persistedSettings, source, { mutateBridge: false });
    if (artistListSignature(persisted) !== artistListSignature(artists)) return incomplete('柏宝绘配置尚未落盘，请手动同步重试');
    return { artists: persisted, artistSnapshot: { version: 2, complete: true, count: persisted.length } };
  } catch { return incomplete('酒馆设置核对失败，请手动同步重试'); }
};

const readBaiBaiVibes = async (bridgeSettings, { force = false } = {}) => {
  const bb = baibai();
  const list = Array.isArray(bb?.nai?.vibes) ? bb.nai.vibes : [];
  const documents = [];
  const all = new Map();
  const grouped = new Map();
  const activeCacheKeys = new Set();

  for (const vibe of list) {
    if (!vibe || typeof vibe !== 'object' || !vibe.id || !vibe.dataPath) continue;
    const cacheKey = `${vibe.id}|${vibe.dataPath}|${vibe.fingerprint || ''}`;
    activeCacheKeys.add(cacheKey);
    try {
      let parsed = !force ? baiBaiVibeReadCache.get(cacheKey) : null;
      if (!parsed) {
        let rawData = null;
        if (String(vibe.dataPath).startsWith('idb:')) {
          rawData = await readBaiBaiIdbVibe(String(vibe.dataPath).slice(4));
        } else {
          const response = await fetch(vibe.dataPath, { cache: 'no-store' });
          if (!response.ok) continue;
          rawData = await response.json();
        }
        if (!rawData || typeof rawData !== 'object' || !rawData.encodings || typeof rawData.encodings !== 'object') continue;
        const encodings = {};
        for (const [modelKey, enc] of Object.entries(rawData.encodings)) {
          if (typeof enc?.encoding === 'string' && enc.encoding) {
            encodings[modelKey] = {
              [VIBE_ENCODING_KEY]: {
                encoding: enc.encoding,
                params: { information_extracted: typeof enc.infoExtracted === 'number' ? enc.infoExtracted : 1 },
              },
            };
          }
        }
        if (!Object.keys(encodings).length) continue;
        const cleanImage = String(rawData.image || '').replace(/^data:image\/[^;]+;base64,/i, '');
        let sourceHash = cleanImage ? await canonicalVibeHash({ image: cleanImage }) : '';
        if (!/^[a-f0-9]{64}$/.test(sourceHash)) {
          sourceHash = await hashText(vibe.fingerprint || baiBaiVibeFingerprint(rawData.encodings));
        }
        const firstEnc = Object.values(rawData.encodings)[0];
        const document = {
          identifier: 'novelai-vibe-transfer',
          version: 1,
          type: 'encoding',
          image: cleanImage,
          thumbnail: String(rawData.thumbnail || ''),
          id: sourceHash,
          encodings,
          name: String(vibe.name || '导入的 Vibe'),
          importInfo: {
            model: Object.keys(encodings)[0] || 'v4-5full',
            information_extracted: typeof firstEnc?.infoExtracted === 'number' ? firstEnc.infoExtracted : 1,
            strength: Number.isFinite(Number(vibe.strength)) ? Number(vibe.strength) : 0.6,
          },
        };
        parsed = { document, sourceHash };
        baiBaiVibeReadCache.set(cacheKey, parsed);
      }
      const document = {
        ...parsed.document,
        name: String(vibe.name || parsed.document.name || '导入的 Vibe'),
        importInfo: {
          ...(parsed.document.importInfo || {}),
          strength: Number.isFinite(Number(vibe.strength)) ? Number(vibe.strength) : 0.6,
        },
      };
      const hash = await hashText(JSON.stringify(document));
      const entry = { id: vibe.id, name: document.name, sourceHash: parsed.sourceHash, document, hash, group: String(vibe.group || '').trim(), strength: document.importInfo.strength, fingerprint: String(vibe.fingerprint || '') };
      all.set(parsed.sourceHash, entry);
      if (bridgeSettings.baiBaiVibeUploadedHashes[parsed.sourceHash] !== hash) {
        documents.push(document);
      }
      if (entry.group) {
        const members = grouped.get(entry.group) || [];
        members.push({ sourceHash: parsed.sourceHash, strength: entry.strength });
        grouped.set(entry.group, members);
      }
    } catch (error) {
      console.warn('[NPM Bridge] 无法读取柏宝绘 Vibe:', vibe.name, error);
    }
  }
  for (const key of baiBaiVibeReadCache.keys()) {
    if (!activeCacheKeys.has(key)) baiBaiVibeReadCache.delete(key);
  }
  const vibeGroups = Array.from(grouped.entries()).map(([name, vibes]) => ({
    externalId: `baibai-group:${name}`,
    name,
    normalizeStrengths: true,
    vibes,
  }));
  return { documents, all, vibeGroups };
};

const uploadBaiBaiArtistPreview = async (presetId, imageUrl, oldPath = null, externalId = '') => {
  const bridgeSettings = settings();
  const url = imageUrl.startsWith('http') ? imageUrl : `${bridgeSettings.baseUrl.replace(/\/$/, '')}${imageUrl}`;
  const imageResponse = await fetch(url, { cache: 'no-store' });
  if (!imageResponse.ok) throw new Error(`下载画师串配图失败：${imageResponse.status}`);
  const type = String(imageResponse.headers.get('content-type') || 'image/png').split(';')[0].toLowerCase();
  const format = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  const contentHash = await hashBytes(bytes);

  if (oldPath && bridgeSettings.baiBaiArtistPreviewHashes?.[externalId] === contentHash) {
    return { path: oldPath, contentHash, unchanged: true };
  }

  const response = await fetch('/api/images/upload', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      image: bytesToBase64(bytes),
      format,
      ch_name: BAIBAI_ARTIST_COVER_DIR,
      filename: presetId,
    }),
  });
  if (!response.ok) throw new Error(`SillyTavern 保存柏宝绘封面失败：${response.status}`);
  const newPath = (await response.json()).path;
  return { path: newPath, contentHash, unchanged: false };
};

const uploadBaiBaiFile = async (name, base64Data) => {
  const response = await fetch('/api/files/upload', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ name, data: base64Data }),
  });
  if (!response.ok) throw new Error(`SillyTavern 保存柏宝绘文件失败：${response.status}`);
  return (await response.json()).path;
};

const applyBaiBaiArtists = async (artists, receipts = []) => {
  const bb = baibai();
  const bridgeSettings = settings();
  bb.nai ||= {};
  if (!Array.isArray(bb.nai.artistPresets)) bb.nai.artistPresets = [];
  bridgeSettings.baiBaiArtistIds ||= {};
  bridgeSettings.baiBaiArtistPreviewHashes ||= {};
  bridgeSettings.baiBaiArtistPreviewUrls ||= {};
  bridgeSettings.baiBaiArtistPreviewPaths ||= {};

  const presetIdByExternalId = new Map(Object.entries(bridgeSettings.baiBaiArtistIds).map(([presetId, extId]) => [extId, presetId]));
  let appliedCount = 0;

  for (const artist of artists) {
    let failure = '';
    let presetId = presetIdByExternalId.get(artist.externalId) || '';
    let existingIndex = presetId ? bb.nai.artistPresets.findIndex(item => item && item.id === presetId) : -1;
    if (existingIndex === -1 && artist.externalId.startsWith('baibai:')) {
      const candidateId = artist.externalId.slice('baibai:'.length);
      existingIndex = bb.nai.artistPresets.findIndex(item => item && item.id === candidateId);
      if (existingIndex !== -1) presetId = candidateId;
    }
    if (existingIndex === -1) {
      presetId = `npm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    }
    const previous = existingIndex >= 0 ? bb.nai.artistPresets[existingIndex] : null;
    let previewPath = String(previous?.previewPath || '');
    const previousHash = bridgeSettings.baiBaiArtistPreviewHashes[artist.externalId] || '';

    if (artist.previewImage) {
      const hasValidPreview = Boolean(previewPath && previousHash);
      const urlMatches = bridgeSettings.baiBaiArtistPreviewUrls[artist.externalId] === artist.previewImage;
      const pathMatches = bridgeSettings.baiBaiArtistPreviewPaths[artist.externalId] === previewPath;
      if (!hasValidPreview || !urlMatches || !pathMatches) {
        try {
          const result = await uploadBaiBaiArtistPreview(presetId, artist.previewImage, previewPath || null, artist.externalId);
          previewPath = result.path;
          bridgeSettings.baiBaiArtistPreviewHashes[artist.externalId] = result.contentHash;
          bridgeSettings.baiBaiArtistPreviewUrls[artist.externalId] = artist.previewImage;
          bridgeSettings.baiBaiArtistPreviewPaths[artist.externalId] = result.path;
        } catch (error) {
          console.warn('[NPM Bridge] 无法更新柏宝绘封面:', artist.name, error);
          failure = error.message || '封面保存失败';
        }
      }
    }

    const nextPreset = {
      ...(previous || {}),
      id: presetId,
      name: artist.name || '未命名画师串',
      prompt: artist.prompt || '',
      quality: artist.quality || '',
      negative: artist.negative || '',
      ...(previewPath ? { previewPath } : {}),
    };
    const unchanged = previous
      && previous.name === nextPreset.name
      && String(previous.prompt || '') === nextPreset.prompt
      && String(previous.quality || '') === nextPreset.quality
      && String(previous.negative || '') === nextPreset.negative
      && String(previous.previewPath || '') === previewPath;

    if (!unchanged) {
      if (existingIndex >= 0) bb.nai.artistPresets[existingIndex] = nextPreset;
      else bb.nai.artistPresets.push(nextPreset);
      appliedCount++;
    }
    bridgeSettings.baiBaiArtistIds[presetId] = artist.externalId;
    presetIdByExternalId.set(artist.externalId, presetId);
    bridgeSettings.baiBaiArtistHashes[artist.externalId] = await hashText(JSON.stringify(baiBaiArtistSnapshot(nextPreset, bridgeSettings)));
    bridgeSettings.baiBaiArtistUpdatedAt[artist.externalId] = Number(artist.updatedAt || Date.now());
    if (artist.receipt) receipts.push({ externalId: artist.externalId, ...artist.receipt, success: !failure, reason: failure });
  }
  return appliedCount;
};

const applyBaiBaiVibes = async (items, groups, localVibes) => {
  const bb = baibai();
  const bridgeSettings = settings();
  bb.nai ||= {};
  if (!Array.isArray(bb.nai.vibes)) bb.nai.vibes = [];
  const existingFingerprints = new Set(bb.nai.vibes.map(v => String(v?.fingerprint || '')).filter(Boolean));
  let appliedCount = 0;

  for (const item of items) {
    if (localVibes.has(item.sourceHash)) {
      bridgeSettings.baiBaiVibeDownloadedVersions[item.sourceHash] = Number(item.updatedAt || Date.now());
      continue;
    }
    if (Number(bridgeSettings.baiBaiVibeDownloadedVersions[item.sourceHash] || 0) >= Number(item.updatedAt || 0)) continue;
    const response = await fetch(`${bridgeSettings.baseUrl.replace(/\/$/, '')}${item.fileUrl}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`下载 Vibe“${item.name}”失败：${response.status}`);
    const text = await response.text();
    const document = JSON.parse(text);
    const encodings = {};
    for (const [modelKey, groupObj] of Object.entries(document.encodings || {})) {
      const first = Object.values(groupObj || {})[0];
      if (typeof first?.encoding === 'string' && first.encoding) {
        encodings[modelKey] = {
          encoding: first.encoding,
          infoExtracted: typeof first.params?.information_extracted === 'number' ? first.params.information_extracted : 1,
        };
      }
    }
    const modelKeys = Object.keys(encodings);
    if (!modelKeys.length) continue;
    const fingerprint = baiBaiVibeFingerprint(encodings);
    if (existingFingerprints.has(fingerprint)) {
      bridgeSettings.baiBaiVibeDownloadedVersions[item.sourceHash] = Number(item.updatedAt || Date.now());
      continue;
    }
    const vibeId = `npm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const cleanImage = String(document.image || '').replace(/^data:image\/[^;]+;base64,/i, '');
    const thumbnail = String(document.thumbnail || '');
    const vibeData = { image: cleanImage, thumbnail, encodings };
    const dataPath = await uploadBaiBaiFile(`bbi-vibe-${vibeId}.json`, textToBase64(JSON.stringify(vibeData)));
    let thumbnailPath = '';
    if (thumbnail.startsWith('data:image/')) {
      const comma = thumbnail.indexOf(',');
      const format = thumbnail.match(/^data:image\/([^;,]+)/i)?.[1]?.toLowerCase() || 'jpg';
      const ext = format === 'jpeg' ? 'jpg' : format;
      if (comma > 0) {
        thumbnailPath = await uploadBaiBaiFile(`bbi-vibe-thumb-${vibeId}.${ext}`, thumbnail.slice(comma + 1));
      }
    }
    const nextVibe = {
      id: vibeId,
      name: item.name || document.name || '导入的 Vibe',
      dataPath,
      thumbnailPath,
      modelKeys,
      hasImage: Boolean(cleanImage),
      fingerprint,
      strength: Number(document.importInfo?.strength ?? item.defaultStrength ?? 0.6),
      group: String(item.group || ''),
    };
    bb.nai.vibes.push(nextVibe);
    existingFingerprints.add(fingerprint);
    localVibes.set(item.sourceHash, { id: vibeId, name: nextVibe.name, sourceHash: item.sourceHash, document, hash: await hashText(text), group: nextVibe.group, strength: nextVibe.strength, fingerprint });
    bridgeSettings.baiBaiVibeDownloadedVersions[item.sourceHash] = Number(item.updatedAt || Date.now());
    bridgeSettings.baiBaiVibeUploadedHashes[item.sourceHash] = await hashText(text);
    appliedCount++;
  }

  // 手动同步时，仅对尚未分组的柏宝绘 Vibe 补全工坊分组名，不覆盖用户已在柏宝绘手选的分组。
  const groupBySourceHash = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const ref of Array.isArray(group?.vibes) ? group.vibes : []) {
      if (ref?.sourceHash && !groupBySourceHash.has(ref.sourceHash)) {
        groupBySourceHash.set(ref.sourceHash, group.name);
      }
    }
  }
  for (const [sourceHash, local] of localVibes.entries()) {
    const targetGroup = groupBySourceHash.get(sourceHash);
    if (!targetGroup) continue;
    const item = bb.nai.vibes.find(v => v && v.id === local.id);
    if (item && !String(item.group || '').trim()) {
      item.group = targetGroup;
      appliedCount++;
    }
  }

  return appliedCount;
};

/* ============ 统一同步调度 ============ */

async function syncChatu8({ quiet = false, manual = !quiet } = {}) {
  const bridgeSettings = settings();
  const baseUrl = bridgeSettings.baseUrl.replace(/\/$/, '');
  const statusResponse = await fetch(`${baseUrl}/api/integrations/st-chatu8/status`, { cache: 'no-store' });
  const status = await statusResponse.json().catch(() => ({}));
  if (!statusResponse.ok) throw new Error(status.error || `连接器返回 ${statusResponse.status}`);
  if (status.enabled !== true) {
    return { active: false, message: '智慧姬同步已关闭，请在 Atelier 设置中开启。', state: 'idle' };
  }
  const currentSignature = stSyncSignature();
  const localChanged = !lastStSignature || currentSignature !== lastStSignature;
  const artists = await collectArtists(bridgeSettings);
  if (!quiet || localChanged) await saveSettings();
  let snapshot = await readPersistedArtistSnapshot(artists);
  if (quiet && !localChanged && !snapshot.artistSnapshot.complete) {
    await saveSettings();
    snapshot = await readPersistedArtistSnapshot(artists);
  }
  const vibeData = await readStoredVibes(bridgeSettings, { force: !quiet });
  const response = await fetch(`${baseUrl}/api/integrations/st-chatu8/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      artists: snapshot.artists,
      artistSnapshot: { ...snapshot.artistSnapshot, cursor: status.snapshotCursor },
      manual,
      vibeDocuments: vibeData.documents,
      vibeSourceHashes: Array.from(vibeData.all.keys()),
      vibeGroups: collectGroups(vibeData.all, bridgeSettings),
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `连接器返回 ${response.status}`);
  if (result.enabled !== true) {
    return { active: false, message: '智慧姬同步已关闭，本次同步已停止。', state: 'idle' };
  }
  const receipts = [];
  const appliedArtists = await applyArtists(result.artists || [], receipts);
  let confirmed = 0;
  let pending = 0;
  if (result.protocolVersion === 2 && receipts.length) {
    await saveSettings();
    const received = await readPersistedArtistSnapshot(await collectArtists(settings()));
    for (const receipt of receipts) if (!received.artistSnapshot.complete) { receipt.success = false; receipt.reason ||= received.reason; }
    const acknowledgement = await fetch(`${baseUrl}/api/integrations/st-chatu8/artist-receipts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...received, receipts }),
    });
    const acknowledged = await acknowledgement.json().catch(() => ({}));
    if (!acknowledgement.ok) throw new Error(acknowledged.error || '接收回执提交失败，已保存内容会在下次同步核对');
    confirmed = Number(acknowledged.confirmed) || 0;
    pending = receipts.length - confirmed;
  }
  await cleanupBridgeVibeDuplicates(vibeData.bridgeDuplicates || []);
  for (const document of vibeData.documents) {
    const sourceHash = await canonicalVibeHash(document);
    if (vibeData.all.has(sourceHash)) bridgeSettings.vibeUploadedHashes[sourceHash] = vibeData.all.get(sourceHash).hash;
  }
  await applyVibes(result.vibes || [], vibeData.all);
  applyGroups(result.groups || [], vibeData.all);
  bridgeSettings.lastSyncAt = Date.now();
  lastStSignature = stSyncSignature();
  if (appliedArtists > 0 || (result.vibes || []).length > 0 || (result.groups || []).length > 0 || (vibeData.bridgeDuplicates || []).length > 0 || localChanged || !quiet) {
    saveSettingsDebounced();
  }
  const historyCount = Number(result.status?.linkedHistory || 0);
  const counts = result.artistSync;
  const message = counts
    ? `导入 ${counts.created} · 更新 ${counts.updated} · 接收确认 ${confirmed}${pending ? ` · 待确认 ${pending}（${receipts.find(receipt => !receipt.success)?.reason || '请手动同步重试'}）` : ''}${result.artistSnapshotComplete === true ? '' : ' · 列表未完整核对'} · Vibe ${vibeData.all.size} · 历史 ${historyCount}`
    : `同步完成：更新 ${appliedArtists} 个风格串，${vibeData.all.size} 个 Vibe；历史 ${historyCount} 张。`;
  enhancePresetSelector();
  return { active: true, message, state: pending || result.artistSnapshotComplete !== true ? 'pending' : 'success' };
}

async function syncBaiBai({ quiet = false, manual = !quiet } = {}) {
  const bridgeSettings = settings();
  const baseUrl = bridgeSettings.baseUrl.replace(/\/$/, '');
  const statusResponse = await fetch(`${baseUrl}/api/integrations/st-baibai/status`, { cache: 'no-store' });
  const status = await statusResponse.json().catch(() => ({}));
  if (!statusResponse.ok) throw new Error(status.error || `柏宝绘连接器返回 ${statusResponse.status}`);
  if (status.enabled !== true) {
    return { active: false, message: '柏宝绘同步已关闭，请在 Atelier 设置中开启。', state: 'idle' };
  }
  // 柏宝绘会在运行期把设置缓存到 Vue reactive 内存：自动同步严格只读，绝不改动 baibai_image 或触发写盘。
  const artists = await collectBaiBaiArtists(bridgeSettings, baibai(), { mutateBridge: manual });
  const snapshot = await readPersistedBaiBaiArtistSnapshot(artists);
  const vibeData = await readBaiBaiVibes(bridgeSettings, { force: manual });
  const response = await fetch(`${baseUrl}/api/integrations/st-baibai/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      artists: snapshot.artists,
      artistSnapshot: { ...snapshot.artistSnapshot, cursor: status.snapshotCursor },
      manual,
      vibeDocuments: vibeData.documents,
      vibeSourceHashes: Array.from(vibeData.all.keys()),
      vibeGroups: vibeData.vibeGroups,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `柏宝绘连接器返回 ${response.status}`);
  if (result.enabled !== true) {
    return { active: false, message: '柏宝绘同步已关闭，本次同步已停止。', state: 'idle' };
  }

  for (const document of vibeData.documents) {
    const sourceHash = String(document.id || '').toLowerCase();
    if (vibeData.all.has(sourceHash)) bridgeSettings.baiBaiVibeUploadedHashes[sourceHash] = vibeData.all.get(sourceHash).hash;
  }

  let appliedArtists = 0;
  let appliedVibes = 0;
  let confirmed = 0;
  let pending = 0;
  const receipts = [];

  if (manual && result.writeBackAllowed !== false) {
    appliedArtists = await applyBaiBaiArtists(result.artists || [], receipts);
    appliedVibes = await applyBaiBaiVibes(result.vibes || [], result.groups || [], vibeData.all);
    if (appliedArtists > 0 || appliedVibes > 0 || receipts.length > 0) {
      await saveSettings();
    }
    if (result.protocolVersion === 2 && receipts.length) {
      const received = await readPersistedBaiBaiArtistSnapshot(await collectBaiBaiArtists(settings(), baibai(), { mutateBridge: true }));
      for (const receipt of receipts) if (!received.artistSnapshot.complete) { receipt.success = false; receipt.reason ||= received.reason; }
      const acknowledgement = await fetch(`${baseUrl}/api/integrations/st-baibai/artist-receipts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...received, receipts }),
      });
      const acknowledged = await acknowledgement.json().catch(() => ({}));
      if (!acknowledgement.ok) throw new Error(acknowledged.error || '柏宝绘接收回执提交失败');
      confirmed = Number(acknowledged.confirmed) || 0;
      pending = receipts.length - confirmed;
    }
    if (appliedArtists > 0 || appliedVibes > 0) {
      saveSettingsDebounced();
    }
  }

  bridgeSettings.baiBaiLastSyncAt = Date.now();
  lastBaiBaiSignature = baiBaiSyncSignature();
  const historyCount = Number(result.status?.linkedHistory || 0);
  const counts = result.artistSync;
  const wroteBack = manual && (appliedArtists > 0 || appliedVibes > 0 || confirmed > 0);
  const refreshHint = wroteBack ? ' · 已写入柏宝绘配置，请刷新酒馆页面生效' : '';
  const summary = counts
    ? `导入 ${counts.created} · 更新 ${counts.updated}${manual ? ` · 接收确认 ${confirmed}${pending ? ` · 待确认 ${pending}` : ''}` : ' · 只读核对'} · Vibe ${vibeData.all.size} · 历史 ${historyCount}${refreshHint}`
    : `同步完成：Vibe ${vibeData.all.size} · 历史 ${historyCount}${refreshHint}`;
  const state = pending ? 'pending' : wroteBack ? 'pending' : (result.artistSnapshotComplete === true || !manual) ? 'success' : 'pending';
  return { active: true, wroteBack, message: summary, state };
}

async function syncNow({ quiet = false, manual = !quiet } = {}) {
  if (syncing) return;
  const hasChatu8 = Boolean(chatu8());
  const hasBaiBai = Boolean(baibai());
  if (!hasChatu8 && !hasBaiBai) {
    setStatus('未检测到 st-chatu8 或 柏宝绘，请先安装并启用对应扩展。', 'error');
    return;
  }
  syncing = true;
  const button = document.querySelector('.npm-bridge-sync');
  if (button) button.disabled = true;
  if (!quiet) setStatus(hasChatu8 && hasBaiBai ? '正在同步智慧姬与柏宝绘…' : hasBaiBai ? '柏宝绘同步：正在检查开关…' : '智慧姬同步：正在检查开关…', 'working');
  try {
    const outcomes = [];
    if (hasChatu8) {
      const outcome = await syncChatu8({ quiet, manual });
      outcomes.push({ name: '智慧姬', ...outcome });
    }
    if (hasBaiBai) {
      const outcome = await syncBaiBai({ quiet, manual });
      outcomes.push({ name: '柏宝绘', ...outcome });
    }
    lastAutoSyncAt = Date.now();
    const activeOutcomes = outcomes.filter(item => item.active);
    if (!activeOutcomes.length) {
      if (outcomes.length === 1) setStatus(outcomes[0].message, outcomes[0].state);
      else setStatus('智慧姬与柏宝绘同步均已关闭，请在 Atelier 设置中开启。', 'idle');
    } else if (activeOutcomes.length === 1 && outcomes.length === 1) {
      setStatus(activeOutcomes[0].message, activeOutcomes[0].state);
    } else {
      const combined = activeOutcomes.map(item => `${item.name}：${item.message}`).join(' ｜ ');
      const state = activeOutcomes.some(item => item.state === 'error')
        ? 'error'
        : activeOutcomes.some(item => item.state === 'pending')
          ? 'pending'
          : 'success';
      setStatus(combined, state);
    }
  } catch (error) {
    console.error('[NPM Bridge] 同步失败:', error);
    setStatus(`同步失败：${error.message}`, 'error');
  } finally {
    syncing = false;
    if (button) button.disabled = false;
  }
}

const panelTitle = () => {
  const hasChatu8 = Boolean(chatu8());
  const hasBaiBai = Boolean(baibai());
  if (hasChatu8 && hasBaiBai) return '智慧姬 / 柏宝绘同步';
  if (hasBaiBai && !hasChatu8) return '柏宝绘同步';
  return '智慧姬同步';
};

const renderSettings = () => {
  if (document.querySelector('.npm-bridge-panel')) return;
  const container = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
  if (!container) return;
  const currentSettings = settings();
  const panel = document.createElement('details');
  panel.className = 'npm-bridge-panel';
  panel.open = currentSettings.panelExpanded === true;
  panel.innerHTML = `
    <summary class="npm-bridge-summary">
      <span class="npm-bridge-title"><i class="fa-solid fa-link" aria-hidden="true"></i> ${panelTitle()}</span>
      <span class="npm-bridge-summary-status" aria-live="polite">待连接</span>
      <i class="fa-solid fa-chevron-down npm-bridge-chevron" aria-hidden="true"></i>
    </summary>
    <div class="npm-bridge-content">

    <div class="npm-bridge-row">
      <label for="npm-bridge-base-url" class="npm-bridge-field-label">服务地址 (Base URL)</label>
      <input id="npm-bridge-base-url" type="url" class="text_pole npm-bridge-base-url" placeholder="${DEFAULT_URL}" value="${escapeHtml(currentSettings.baseUrl || DEFAULT_URL)}">
    </div>
    <div class="npm-bridge-actions">
      <button type="button" class="menu_button npm-bridge-sync"><i class="fa-solid fa-rotate"></i> 立即同步</button>
      <label class="checkbox_label"><input type="checkbox" class="npm-bridge-auto"> 自动同步</label>
    </div>
    <div class="npm-bridge-status" role="status">请先在 Atelier 设置中开启同步开关。</div>
    </div>
  `;
  container.appendChild(panel);
  panel.addEventListener('toggle', () => {
    if (settings().panelExpanded === panel.open) return;
    settings().panelExpanded = panel.open;
    saveSettingsDebounced();
  });

  const baseUrlInput = panel.querySelector('.npm-bridge-base-url');
  baseUrlInput.addEventListener('change', () => {
    const val = baseUrlInput.value.trim().replace(/\/$/, '') || DEFAULT_URL;
    baseUrlInput.value = val;
    settings().baseUrl = val;
    saveSettingsDebounced();
  });

  panel.querySelector('.npm-bridge-auto').checked = currentSettings.autoSync !== false;
  panel.querySelector('.npm-bridge-auto').addEventListener('change', event => {
    settings().autoSync = event.target.checked;
    saveSettingsDebounced();
    scheduleAutoSync();
  });
  panel.querySelector('.npm-bridge-sync').addEventListener('click', () => syncNow({ quiet: false, manual: true }));
};

const scheduleAutoSync = () => {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  if (settings().autoSync === false) {
    if (eventSyncTimer) clearTimeout(eventSyncTimer);
    eventSyncTimer = null;
    return;
  }
  syncTimer = setInterval(() => {
    if (!document.hidden) syncNow({ quiet: true, manual: false });
  }, SYNC_INTERVAL);
};

const hasLocalSignatureChanged = () => {
  const chatu8Changed = Boolean(chatu8()) && stSyncSignature() !== lastStSignature;
  const baiBaiChanged = Boolean(baibai()) && baiBaiSyncSignature() !== lastBaiBaiSignature;
  return chatu8Changed || baiBaiChanged;
};

const scheduleChangedSettingsSync = () => {
  if (settings().autoSync === false) return;
  if (!hasLocalSignatureChanged()) return;
  if (eventSyncTimer) clearTimeout(eventSyncTimer);
  eventSyncTimer = setTimeout(() => {
    eventSyncTimer = null;
    if (settings().autoSync !== false && hasLocalSignatureChanged()) syncNow({ quiet: true, manual: false });
  }, EVENT_SYNC_DELAY);
};

jQuery(async () => {
  settings();
  renderSettings();
  if (!document.querySelector('.npm-bridge-panel')) {
    const renderTimer = setInterval(() => {
      renderSettings();
      if (document.querySelector('.npm-bridge-panel')) clearInterval(renderTimer);
    }, 500);
    setTimeout(() => clearInterval(renderTimer), 15_000);
  }
  scheduleAutoSync();
  watchPresetSelector();
  eventSource.on(event_types.SETTINGS_UPDATED, scheduleChangedSettingsSync);
  window.addEventListener('focus', () => {
    if (settings().autoSync === false) return;
    if (lastAutoSyncAt > 0 && Date.now() - lastAutoSyncAt < FOCUS_SYNC_COOLDOWN && !hasLocalSignatureChanged()) return;
    syncNow({ quiet: true, manual: false });
  });
  setTimeout(() => { if (settings().autoSync !== false) syncNow({ quiet: true, manual: false }); }, 2500);
});
