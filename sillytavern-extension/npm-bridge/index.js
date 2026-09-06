import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types, getRequestHeaders, saveSettingsDebounced } from '../../../../script.js';

const EXTENSION_NAME = 'nai-prompt-manager-bridge';
const CHATU8_NAME = 'st-chatu8';
const DEFAULT_URL = 'http://localhost:3000';
const SYNC_INTERVAL = 10 * 60_000;
const EVENT_SYNC_DELAY = 3_000;
let syncing = false;
let syncTimer = null;
let presetObserver = null;
let eventSyncTimer = null;
let lastStSignature = '';

const defaults = () => ({
  baseUrl: DEFAULT_URL,
  autoSync: true,
  artistIds: {},
  artistHashes: {},
  artistUpdatedAt: {},
  artistPreviewUrls: {},
  artistPreviewHashes: {},
  vibeUploadedHashes: {},
  vibeDownloadedVersions: {},
  lastSyncAt: 0,
});

const settings = () => {
  extension_settings[EXTENSION_NAME] = { ...defaults(), ...(extension_settings[EXTENSION_NAME] || {}) };
  return extension_settings[EXTENSION_NAME];
};

const chatu8 = () => extension_settings[CHATU8_NAME] || null;

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
  if (!node) return;
  node.textContent = message;
  node.dataset.state = state;
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
  const backdrop = document.querySelector('.st-chatu8-workflow-viz-backdrop');
  if (!backdrop || backdrop.dataset.npmBridgeEnhanced === 'true') return;
  const toolbar = backdrop.querySelector('.st-chatu8-workflow-viz-toolbar');
  const search = backdrop.querySelector('.st-chatu8-viz-search-input');
  if (!toolbar || !search) return;
  const previews = collectArtistPreviews();
  if (!previews.length) return;
  backdrop.dataset.npmBridgeEnhanced = 'true';

  const host = document.createElement('div');
  host.className = 'npm-bridge-preview-host';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'npm-bridge-preview-trigger';
  trigger.innerHTML = `<i class="fa-solid fa-images"></i><span>有配图 ${previews.length}</span>`;
  trigger.title = '查看由 st-chatu8 与 NaiPromptManager 共享的画师串配图';
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

const collectArtists = async bridgeSettings => {
  const source = chatu8()?.yushe || {};
  const artists = [];
  for (const [name, preset] of Object.entries(source)) {
    let externalId = bridgeSettings.artistIds[name];
    if (!externalId) externalId = bridgeSettings.artistIds[name] = `st:${crypto.randomUUID()}`;
    const rawPreviewPath = String(bridgeSettings?.configImageStorage?.[preset?.previewImageId]?.path || chatu8()?.configImageStorage?.[preset?.previewImageId]?.path || '');
    const item = {
      externalId,
      name,
      fixedPrompt: String(preset?.fixedPrompt || ''),
      fixedPromptEnd: String(preset?.fixedPrompt_end || ''),
      negativePrompt: String(preset?.negativePrompt || ''),
      previewPath: rawPreviewPath,
    };
    const hash = await hashText(JSON.stringify(item));
    if (bridgeSettings.artistHashes[externalId] !== hash) {
      bridgeSettings.artistHashes[externalId] = hash;
      bridgeSettings.artistUpdatedAt[externalId] = Date.now();
    }
    artists.push({ ...item, updatedAt: bridgeSettings.artistUpdatedAt[externalId] || Date.now() });
  }
  return artists;
};

const readStoredVibes = async bridgeSettings => {
  const st = chatu8();
  const documents = [];
  const all = new Map();
  const bridgeDuplicates = [];
  for (const [name, preset] of Object.entries(st?.vibePresets || {})) {
    const dataId = preset?.vibeDataId;
    const path = dataId ? st?.configImageStorage?.[dataId]?.path : '';
    if (!path) continue;
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) continue;
      const text = await response.text();
      const document = JSON.parse(text);
      if (document?.identifier !== 'novelai-vibe-transfer' || !document.id) continue;
      const sourceHash = await canonicalVibeHash(document);
      if (!/^[a-f0-9]{64}$/.test(sourceHash)) continue;
      const entry = { name, dataId, document, sourceHash, path, isBridge: /\/npm_bridge_[^/]+$/i.test(path) };
      const existing = all.get(sourceHash);
      if (existing && (existing.isBridge || entry.isBridge)) {
        if (existing.isBridge && !entry.isBridge) {
          bridgeDuplicates.push(existing);
          all.set(sourceHash, entry);
        } else {
          bridgeDuplicates.push(entry);
        }
        continue;
      }
      all.set(sourceHash, entry);
    } catch (error) {
      console.warn('[NPM Bridge] 无法读取 Vibe:', name, error);
    }
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

const uploadVibeText = async (name, text) => {
  const response = await fetch('/api/images/upload', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      image: textToBase64(text),
      format: 'png',
      ch_name: 'chatu8_config',
      filename: `npm_bridge_${String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}_${Date.now()}`,
    }),
  });
  if (!response.ok) throw new Error(`SillyTavern 保存 Vibe 失败：${response.status}`);
  return (await response.json()).path;
};

const bytesToBase64 = bytes => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const uploadArtistPreview = async (name, imageUrl, oldPath = null) => {
  const bridgeSettings = settings();
  const url = imageUrl.startsWith('http') ? imageUrl : `${bridgeSettings.baseUrl.replace(/\/$/, '')}${imageUrl}`;
  const imageResponse = await fetch(url, { cache: 'no-store' });
  if (!imageResponse.ok) throw new Error(`下载画师串配图失败：${imageResponse.status}`);
  const type = String(imageResponse.headers.get('content-type') || 'image/png').split(';')[0].toLowerCase();
  const format = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  const contentHash = await hashBytes(bytes);

  // If previous file exists and content hash matches, avoid duplicate uploads
  if (oldPath && bridgeSettings.artistPreviewHashes?.[name] === contentHash) {
    return { path: oldPath, contentHash, unchanged: true };
  }

  const response = await fetch('/api/images/upload', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      image: bytesToBase64(bytes),
      format,
      ch_name: 'chatu8_config',
      filename: `npm_bridge_preview_${String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}_${Date.now()}`,
    }),
  });
  if (!response.ok) throw new Error(`SillyTavern 保存画师串配图失败：${response.status}`);
  const newPath = (await response.json()).path;

  // Clean up old bridge-generated preview file to prevent disk accumulation
  if (oldPath && oldPath !== newPath && /npm_bridge_preview_/i.test(oldPath)) {
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

  return { path: newPath, contentHash, unchanged: false };
};

const applyArtists = async artists => {
  const st = chatu8();
  const bridgeSettings = settings();
  st.yushe ||= {};
  bridgeSettings.artistPreviewHashes ||= {};
  for (const artist of artists) {
    const currentName = Object.entries(bridgeSettings.artistIds).find(([, id]) => id === artist.externalId)?.[0] || '';
    const name = uniqueName(st.yushe, artist.name, currentName);
    let previewImageId = currentName ? st.yushe[currentName]?.previewImageId : null;
    const previousHash = bridgeSettings.artistPreviewHashes[artist.externalId] || '';
    const previousPath = previewImageId ? st.configImageStorage?.[previewImageId]?.path : null;

    if (artist.previewImage) {
      const needsDownload = !previewImageId || !previousPath || !previousHash;
      if (needsDownload || !artist.externalId.startsWith('st:')) {
        try {
          const result = await uploadArtistPreview(name, artist.previewImage, previousPath);
          if (!result.unchanged) {
            previewImageId = `cfgimg_npm_preview_${crypto.randomUUID()}`;
            st.configImageStorage ||= {};
            st.configImageStorage[previewImageId] = { path: result.path, date: Date.now(), type: 'image' };
          }
          bridgeSettings.artistPreviewHashes[artist.externalId] = result.contentHash;
        } catch (error) {
          console.warn('[NPM Bridge] 无法更新画师配图:', name, error);
        }
      }
    }

    st.yushe[name] = {
      fixedPrompt: artist.fixedPrompt || '',
      fixedPrompt_end: artist.fixedPromptEnd || '',
      negativePrompt: artist.negativePrompt || '',
      ...(previewImageId ? { previewImageId } : {}),
    };
    if (currentName && currentName !== name) {
      delete st.yushe[currentName];
      delete bridgeSettings.artistIds[currentName];
    }
    bridgeSettings.artistIds[name] = artist.externalId;
    bridgeSettings.artistHashes[artist.externalId] = await hashText(JSON.stringify({
      externalId: artist.externalId, name, fixedPrompt: artist.fixedPrompt || '',
      fixedPromptEnd: artist.fixedPromptEnd || '', negativePrompt: artist.negativePrompt || '',
    }));
    bridgeSettings.artistUpdatedAt[artist.externalId] = Number(artist.updatedAt || Date.now());
    bridgeSettings.artistPreviewUrls[artist.externalId] = artist.previewImage || '';
  }
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
    const path = await uploadVibeText(item.name, text);
    const dataId = `cfgimg_npm_${crypto.randomUUID()}`;
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
    st.vibeGroups[name] = {
      vibes,
      createdAt: st.vibeGroups[name]?.createdAt || Date.now(),
      updatedAt: Number(group.updatedAt || Date.now()),
    };
  }
};

async function syncNow({ quiet = false } = {}) {
  if (syncing) return;
  const st = chatu8();
  if (!st) {
    setStatus('未检测到 st-chatu8，请先安装并启用该扩展。', 'error');
    return;
  }
  syncing = true;
  if (!quiet) setStatus('正在同步画师串、Vibe 与历史索引…', 'working');
  try {
    const bridgeSettings = settings();
    const artists = await collectArtists(bridgeSettings);
    const vibeData = await readStoredVibes(bridgeSettings);
    const response = await fetch(`${bridgeSettings.baseUrl.replace(/\/$/, '')}/api/integrations/st-chatu8/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artists,
        vibeDocuments: vibeData.documents,
        vibeSourceHashes: Array.from(vibeData.all.keys()),
        vibeGroups: collectGroups(vibeData.all, bridgeSettings),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `连接器返回 ${response.status}`);
    await applyArtists(result.artists || []);
    await cleanupBridgeVibeDuplicates(vibeData.bridgeDuplicates || []);
    for (const document of vibeData.documents) {
      const sourceHash = await canonicalVibeHash(document);
      if (vibeData.all.has(sourceHash)) bridgeSettings.vibeUploadedHashes[sourceHash] = vibeData.all.get(sourceHash).hash;
    }
    await applyVibes(result.vibes || [], vibeData.all);
    applyGroups(result.groups || [], vibeData.all);
    bridgeSettings.lastSyncAt = Date.now();
    lastStSignature = stSyncSignature();
    saveSettingsDebounced();
    const historyCount = Number(result.status?.linkedHistory || 0);
    const previewCount = collectArtistPreviews().length;
    setStatus(`同步完成：${result.artists?.length || 0} 个画师串（${previewCount} 个带配图）、${vibeData.all.size} 个 Vibe；历史已索引 ${historyCount} 张原图。`, 'success');
    enhancePresetSelector();
  } catch (error) {
    console.error('[NPM Bridge] 同步失败:', error);
    setStatus(`同步失败：${error.message}`, 'error');
  } finally {
    syncing = false;
  }
}

const renderSettings = () => {
  if (document.querySelector('.npm-bridge-panel')) return;
  const container = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
  if (!container) return;
  const currentSettings = settings();
  const panel = document.createElement('div');
  panel.className = 'npm-bridge-panel';
  panel.innerHTML = `
    <h3><i class="fa-solid fa-link"></i> NaiPromptManager 连接器</h3>
    <div class="npm-bridge-row">
      <label class="npm-bridge-field-label">服务地址 (Base URL)</label>
      <input type="text" class="text_pole npm-bridge-base-url" placeholder="${DEFAULT_URL}" value="${escapeHtml(currentSettings.baseUrl || DEFAULT_URL)}">
    </div>
    <div class="npm-bridge-actions">
      <button type="button" class="menu_button npm-bridge-sync"><i class="fa-solid fa-rotate"></i> 立即同步</button>
      <label class="checkbox_label"><input type="checkbox" class="npm-bridge-auto"> 自动同步</label>
    </div>
    <div class="npm-bridge-status">等待首次同步。</div>
  `;
  container.appendChild(panel);

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
  panel.querySelector('.npm-bridge-sync').addEventListener('click', () => syncNow());
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
    if (!document.hidden) syncNow({ quiet: true });
  }, SYNC_INTERVAL);
};

const scheduleChangedSettingsSync = () => {
  if (settings().autoSync === false) return;
  const signature = stSyncSignature();
  if (!signature || signature === lastStSignature) return;
  if (eventSyncTimer) clearTimeout(eventSyncTimer);
  eventSyncTimer = setTimeout(() => {
    eventSyncTimer = null;
    if (settings().autoSync !== false && stSyncSignature() !== lastStSignature) syncNow({ quiet: true });
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
  window.addEventListener('focus', () => syncNow({ quiet: true }));
  setTimeout(() => syncNow(), 2500);
});
