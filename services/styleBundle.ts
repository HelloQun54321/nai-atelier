import { sha256 } from '@noble/hashes/sha2.js';
import { api } from './api';
import { vibeService } from './vibeService';
import { VIBE_MODELS, vibeParameterKey } from './vibeProtocol.mjs';
import { createUuid } from './id';
import { characterReferenceService } from './characterReferenceService';
import { prepareImageBlob, getCleanSharedImages, getSharedImageCustomText, getSharedImageCleanContent } from './imageSharing';
import type { NAIParams, PromptChain, StyleBundleSource, VibeAsset } from '../types';

export type { StyleBundleSource } from '../types';
export type StyleBundleCoverMode = 'none' | 'compressed' | 'original';
export interface StyleBundleProgress { phase: 'export' | 'read' | 'import'; completed: number; total: number; name?: string }
type Progress = (value: StyleBundleProgress) => void;
export interface StyleBundlePreview {
  coverage: 'full' | 'partial' | 'unrecorded';
  entries: Array<{ id: string; name: string; description: string; cover: boolean; sources: StyleBundleSource[] }>;
  sources: StyleBundleSource[];
  warnings: string[];
}
interface Asset { id: string; offset: number; size: number; mime: string; hash: string }
interface Encoding { id: string; asset: string; sourceHash: string; name: string; model: string; modelKey: string; information: number; informationKnown?: boolean; parameters?: Record<string, unknown> | null }
interface Entry extends Pick<PromptChain, 'name' | 'description' | 'tags' | 'basePrompt' | 'negativePrompt' | 'modules' | 'params' | 'variableValues'> { id: string; cover?: string }
export interface StyleBundleEntryPreview extends Omit<Entry, 'cover'> { coverBlob?: Blob }
interface Manifest { coverage?: 'full' | 'partial'; entries: Entry[]; assets: Asset[]; encodings: Encoding[] }
interface Parsed { manifest: Manifest; entriesById: Map<string, Entry>; assetsById: Map<string, Asset>; file: Blob; offset: number; imported: Map<string, string>; covers: Map<string, string>; operationIds: Map<string, string>; references: Map<string, string>; vibes: Map<string, { vibeId: string; encodingId: string; informationExtracted: number; informationKnown: boolean }>; busy: boolean }
const parsedBundles = new WeakMap<StyleBundlePreview, Parsed>();
const MAGIC = new Uint8Array([78, 65, 73, 65, 13, 10, 26, 10]);
const HEADER = 48;
const MiB = 1024 * 1024;
// 每串至多一个封面、16 个角色参考与 16 个 Vibe 编码；清单另受总字节上限约束。
export const STYLE_BUNDLE_LIMITS = { entries: 10_000, assets: 330_000, encodings: 160_000, fileBytes: 2 * 1024 * MiB, assetBytes: 30 * MiB, manifestBytes: 64 * MiB, compressedManifestBytes: 16 * MiB } as const;
function fail(message = '分享包格式无效'): never { throw new Error(message); }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
const text = (value: unknown, max: number = STYLE_BUNDLE_LIMITS.manifestBytes): string => typeof value === 'string' && value.length <= max ? value : fail('分享包文字字段无效或过长');
const list = (value: unknown, max: number): unknown[] => Array.isArray(value) && value.length <= max ? value : fail('分享包条目数量无效或过多');
const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : fail('分享包数值无效');
const bool = (value: unknown): boolean => typeof value === 'boolean' ? value : fail('分享包开关无效');
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const hashBlob = async (blob: Blob) => {
  const hash = sha256.create(), reader = blob.stream().getReader();
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; hash.update(value); } }
  finally { reader.releaseLock(); }
  return hex(hash.digest());
};
const boundedBytes = async (stream: ReadableStream<Uint8Array>, max: number) => {
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) fail('分享包内容超过读取上限'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
};
const source = (value: unknown): StyleBundleSource => {
  const item = object(value);
  const result = { author: text(item.author ?? '', 200), sourceUrl: text(item.sourceUrl ?? '', 2000), note: text(item.note ?? '', 4000) };
  if (result.sourceUrl) {
    let url: URL; try { url = new URL(result.sourceUrl); } catch { return fail('来源链接无效'); }
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || host === 'localhost' || /\.(localhost|local|internal)$/.test(host) || /^[\d.]+$|^\[/.test(host)) fail('来源链接须为不含账号的公网 HTTP/HTTPS 域名链接');
  }
  return result;
};
const sources = (value: unknown) => {
  const seen = new Set<string>();
  const normalized = list(value ?? [], 101).map(source).filter(item => {
    const key = JSON.stringify(item); if (seen.has(key) || !Object.values(item).some(part => part.trim())) return false;
    seen.add(key); return true;
  });
  if (normalized.length > 100) fail('分享包条目数量无效或过多');
  return normalized;
};
const stringMap = (value: unknown, max = 100): Record<string, string> => Object.fromEntries(Object.entries(object(value)).map(([key, value]) => [text(key, max), text(value)]));
const creativeSnapshotKeys = new Set(['format', 'version', 'savedAt', 'algo', 'roles', 'global', 'key', 'name', 'provided', 'sections', 'negatives', 'meta', 'text', 'note', 'source', 'entryType', 'entryName', 'entryBasePrompt', 'entryBilingual', 'entryDescription', 'entryTags', 'needsReview', 'negative', 'roll', 'seed', 'seeds', 'checks', 'locks', 'appearance', 'wardrobe', 'pose', 'expression', 'scene', 'camera', 'extra']);
const creativeSnapshot = (value: unknown, depth = 0): unknown => {
  if (depth > 12) return fail('内容快照层级过深');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return finite(value);
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return list(value, 200).map(value => creativeSnapshot(value, depth + 1));
  return Object.fromEntries(Object.entries(object(value)).filter(([key]) => creativeSnapshotKeys.has(key)).map(([key, value]) => [key, creativeSnapshot(value, depth + 1)]));
};
const sections = (value: unknown) => {
  const item = object(value), result: Record<string, unknown> = {};
  for (const key of ['appearance', 'wardrobe', 'pose', 'expression', 'scene', 'camera', 'extra']) if (item[key] !== undefined) result[key] = text(item[key]);
  if (item.sectionNegatives !== undefined) result.sectionNegatives = stringMap(item.sectionNegatives);
  if (item.sectionMeta !== undefined) result.sectionMeta = Object.fromEntries(Object.entries(object(item.sectionMeta)).map(([key, value]) => {
    const meta = object(value); return [text(key, 100), Object.fromEntries(['entryName', 'notes', 'source', 'mode'].filter(key => meta[key] !== undefined).map(key => [key, text(meta[key])]))];
  }));
  return result;
};
// 分享只携带已知创作字段，账号、路径和未知本机扩展不会跟随对象展开。
const cleanParams = (value: unknown): NAIParams => {
  const item = object(value), result: Record<string, unknown> = {};
  for (const key of ['width', 'height', 'steps', 'scale', 'seed', 'ucPreset', 'cfgRescale', 'transparentWeight']) if (item[key] !== undefined) result[key] = finite(item[key]);
  for (const key of ['model', 'sampler', 'qualityPresetId', 'ucPresetId', 'alphaMode']) if (item[key] !== undefined) result[key] = text(item[key], 200);
  for (const key of ['qualityToggle', 'useCoords', 'variety', 'transparent']) if (item[key] !== undefined) result[key] = bool(item[key]);
  for (const key of ['width', 'height', 'steps', 'scale']) if (result[key] === undefined) fail(`分享包缺少参数 ${key}`);
  for (const key of ['width', 'height', 'steps']) if (!Number.isSafeInteger(result[key]) || Number(result[key]) <= 0) fail(`分享包参数 ${key} 无效`);
  if (typeof result.sampler !== 'string') fail('分享包缺少采样器');
  if (item._promptSections !== undefined) result._promptSections = sections(item._promptSections);
  if (item._rollContentSnapshot !== undefined) result._rollContentSnapshot = creativeSnapshot(item._rollContentSnapshot);
  if (item._promptLibrary !== undefined) {
    const library = object(item._promptLibrary);
    result._promptLibrary = Object.fromEntries(['bilingual', 'notes', 'kind'].filter(key => library[key] !== undefined).map(key => [key, text(library[key])]));
  }
  if (item.characters !== undefined) result.characters = list(item.characters, 100).map(value => {
    const character = object(value), output: Record<string, unknown> = { id: text(character.id, 200), prompt: text(character.prompt), x: finite(character.x), y: finite(character.y) };
    if (character.negativePrompt !== undefined) output.negativePrompt = text(character.negativePrompt);
    if (character.enabled !== undefined) output.enabled = bool(character.enabled);
    if (character.sections !== undefined) output.sections = sections(character.sections);
    if (character.sectionNegatives !== undefined) output.sectionNegatives = stringMap(character.sectionNegatives);
    if (character.sectionMeta !== undefined) output.sectionMeta = sections({ sectionMeta: character.sectionMeta }).sectionMeta;
    return output;
  });
  if (item.vibes !== undefined) {
    const vibes = object(item.vibes);
    result.vibes = { enabled: bool(vibes.enabled), normalizeStrengths: bool(vibes.normalizeStrengths), ...(vibes.sourceGroupName !== undefined ? { sourceGroupName: text(vibes.sourceGroupName, 200) } : {}), slots: list(vibes.slots, 16).map(value => {
      const slot = object(value); return { vibeId: text(slot.vibeId, 200), encodingId: text(slot.encodingId, 200), ...(slot.vibeName !== undefined ? { vibeName: text(slot.vibeName, 200) } : {}), informationExtracted: finite(slot.informationExtracted), ...(slot.informationKnown !== undefined ? { informationKnown: bool(slot.informationKnown) } : {}), strength: finite(slot.strength), ...(slot.effectiveStrength !== undefined ? { effectiveStrength: finite(slot.effectiveStrength) } : {}) };
    }) };
  }
  if (item.characterReferences !== undefined) {
    const references = object(item.characterReferences);
    result.characterReferences = { enabled: bool(references.enabled), slots: list(references.slots, 16).map(value => {
      const slot = object(value); if (!['character', 'style', 'character_style'].includes(String(slot.type))) fail('角色参考类型无效');
      return { assetId: text(slot.assetId, 200), ...(slot.assetName !== undefined ? { assetName: text(slot.assetName, 200) } : {}), type: slot.type, strength: finite(slot.strength), fidelity: finite(slot.fidelity), ...(slot.informationExtracted !== undefined ? { informationExtracted: finite(slot.informationExtracted) } : {}) };
    }) };
  }
  if (item._styleBundleSources !== undefined) result._styleBundleSources = sources(item._styleBundleSources);
  return result as unknown as NAIParams;
};
const cleanEntry = (value: unknown): Entry => {
  const item = object(value);
  const entry: Entry = { id: text(item.id, 200), name: text(item.name), description: text(item.description), tags: list(item.tags, 200).map(value => text(value, 200)), basePrompt: text(item.basePrompt), negativePrompt: text(item.negativePrompt), params: cleanParams(item.params), modules: list(item.modules, 200).map(value => {
    const module = object(value); const result = { id: text(module.id, 200), name: text(module.name), content: text(module.content), isActive: bool(module.isActive), ...(module.position !== undefined ? { position: module.position } : {}), ...(module.group !== undefined ? { group: text(module.group) } : {}) };
    if (result.position !== undefined && result.position !== 'pre' && result.position !== 'post') fail('模块位置无效');
    return result as PromptChain['modules'][number];
  }), ...(item.variableValues !== undefined ? { variableValues: stringMap(item.variableValues) } : {}), ...(item.cover !== undefined ? { cover: text(item.cover, 200) } : {}) };
  if (!entry.id || !entry.name.trim()) fail('分享包条目标识或名称为空');
  return entry;
};
const imageType = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return fail('分享包包含不支持的图片');
};
const validateImageDimensions = async (blob: Blob) => {
  const type = await imageType(blob), bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const view = new DataView(bytes.buffer); let width = 0, height = 0;
  if (type === 'image/png' && bytes.length >= 24) { width = view.getUint32(16); height = view.getUint32(20); }
  if (type === 'image/webp' && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8X') { width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16); height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16); }
    if (chunk === 'VP8 ') { width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff; }
    if (chunk === 'VP8L') { width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8); height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0xf) << 10); }
  }
  if (type === 'image/jpeg') {
    let offset = 2;
    for (let count = 0; count < 2048 && offset + 4 <= blob.size; count++) {
      const part = new Uint8Array(await blob.slice(offset, offset + 9).arrayBuffer());
      if (part[0] !== 255) break;
      const marker = part[1]; if (marker === 255) { offset++; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      const length = (part[2] << 8) | part[3]; if (length < 2) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && part.length >= 9) { height = (part[5] << 8) | part[6]; width = (part[7] << 8) | part[8]; break; }
      offset += 2 + length;
    }
  }
  if (!width || !height || width * height > 40_000_000) fail('分享图片尺寸无效或超过 4000 万像素');
};
const fetchBlob = async (path: string) => {
  if (path.startsWith('data:')) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(path);
    if (!match || match[2].length % 4 || match[2].length > Math.ceil(STYLE_BUNDLE_LIMITS.assetBytes / 3) * 4) fail('分享封面数据无效或超过 30 MiB');
    const raw = atob(match[2]);
    if (!raw.length || raw.length > STYLE_BUNDLE_LIMITS.assetBytes) fail('分享封面数据无效或超过 30 MiB');
    return new Blob([Uint8Array.from(raw, character => character.charCodeAt(0)).buffer], { type: `image/${match[1].toLowerCase()}` });
  }
  if (!/^\/api\/(assets\/|local-history\/|character-references\/|vibes\/)/.test(path) || path.includes('..') || /[?#\\]/.test(path)) fail('只允许读取工坊已保存图片');
  const response = await fetch(path);
  if (!response.ok || !response.body) fail(`读取分享素材失败 (${response.status})`);
  const bytes = await boundedBytes(response.body, STYLE_BUNDLE_LIMITS.assetBytes);
  return new Blob([bytes.buffer]);
};
const sharedImage = async (blob: Blob, cover: StyleBundleCoverMode | 'reference') => {
  await validateImageDimensions(blob);
  const original = new Blob([blob], { type: await imageType(blob) });
  const prepared = await prepareImageBlob(original, getCleanSharedImages(), false, getSharedImageCustomText(), getSharedImageCleanContent());
  if (cover !== 'compressed') return prepared;
  const bitmap = await createImageBitmap(prepared);
  try {
    if (bitmap.width * bitmap.height > 40_000_000) fail('封面像素过大');
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d'); if (!context) fail('无法压缩封面'); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('封面压缩失败')), 'image/webp', 0.8));
  } finally { bitmap.close(); }
};
const decodeBase64 = (value: unknown) => {
  const raw = text(value, 16 * MiB); if (!raw || raw.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) fail('Vibe 编码无效');
  const decoded = atob(raw); if (decoded.length < 64 || decoded.length > 12 * MiB) fail('Vibe 编码大小无效');
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
};
const encodeBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
};

export async function exportStyleBundle(chains: PromptChain[], options: { allChainIds: readonly string[]; coverMode: StyleBundleCoverMode; author: string; sourceUrl: string; note: string; onProgress?: Progress }): Promise<Blob> {
  if (!chains.length || chains.length > STYLE_BUNDLE_LIMITS.entries) fail('一次可导出 1～10000 条风格串');
  if (!Array.isArray(options.allChainIds) || options.allChainIds.some(id => typeof id !== 'string' || !id)) fail('分享包打包范围无效');
  const allIds = new Set(options.allChainIds), exportedIds = new Set(chains.map(chain => chain.id));
  const coverage = allIds.size === exportedIds.size && [...allIds].every(id => exportedIds.has(id)) ? 'full' : 'partial';
  if (!['none', 'compressed', 'original'].includes(options.coverMode)) fail('封面导出选项无效');
  const declaration = source(options), assets: Asset[] = [], blobs: Blob[] = [], entries: Entry[] = [], encodings: Encoding[] = [];
  const referenceIds = new Map<string, string>(), encodingIds = new Map<string, Encoding>(), assetHashes = new Map<string, string>(); let total = 0;
  const addAsset = async (blob: Blob) => {
    if (!blob.size || blob.size > STYLE_BUNDLE_LIMITS.assetBytes) fail('单张素材不能超过 30 MiB');
    const hash = await hashBlob(blob), key = `${hash}:${blob.type}`, existing = assetHashes.get(key); if (existing) return existing;
    if (total + blob.size > STYLE_BUNDLE_LIMITS.fileBytes - STYLE_BUNDLE_LIMITS.manifestBytes) fail('分享包超过 2 GiB，请压缩封面或分批导出');
    const id = `a${assets.length}`; assets.push({ id, offset: total, size: blob.size, mime: blob.type || 'application/octet-stream', hash }); assetHashes.set(key, id); blobs.push(blob); total += blob.size; return id;
  };
  for (const [index, chain] of chains.entries()) {
    if (chain.type && chain.type !== 'style') fail('分享包仅支持风格串');
    const resolvedParams = await vibeService.resolveParams(chain.params);
    const entry = cleanEntry({ ...chain, params: resolvedParams, id: `s${index}`, description: chain.description ?? '', basePrompt: chain.basePrompt ?? '', negativePrompt: chain.negativePrompt ?? '', modules: chain.modules ?? [], tags: chain.tags ?? [] });
    entry.params._styleBundleSources = sources([...(entry.params._styleBundleSources || []), declaration]);
    if (options.coverMode !== 'none' && chain.previewImage) {
      const cover = await sharedImage(await fetchBlob(chain.previewImage), options.coverMode);
      if (cover.size > 12 * MiB) fail('分享封面超过 12 MiB，请选择压缩封面或不带封面');
      entry.cover = await addAsset(cover);
    }
    for (const slot of entry.params.characterReferences?.slots || []) {
      const original = slot.assetId;
      if (!referenceIds.has(original)) referenceIds.set(original, await addAsset(await sharedImage(await fetchBlob(`/api/character-references/${encodeURIComponent(original)}/image`), 'reference')));
      slot.assetId = referenceIds.get(original)!;
    }
    for (const slot of entry.params.vibes?.slots || []) {
      const key = `${slot.vibeId}/${slot.encodingId}`;
      if (!encodingIds.has(key)) {
        const asset = object(object(await api.get(`/vibes/${encodeURIComponent(slot.vibeId)}`)).item);
        const response = object(await api.get(`/vibes/${encodeURIComponent(slot.vibeId)}/encodings/${encodeURIComponent(slot.encodingId)}/data`));
        const variant = object(response.variant), bytes = decodeBase64(response.encoding);
        if (VIBE_MODELS[String(variant.modelKey)] && VIBE_MODELS[String(variant.modelKey)] !== variant.model) fail('Vibe 模型与编码类型不一致');
        const sourceHash = text(asset.sourceHash, 64); if (!/^[a-f0-9]{64}$/.test(sourceHash)) fail('Vibe 原始标识无效');
        const id = `v${encodings.length}`;
        const encoding: Encoding = { id, sourceHash, name: text(asset.name, 100), model: text(variant.model, 200), modelKey: text(variant.modelKey, 200), information: finite(variant.informationExtracted), ...(variant.informationKnown === false ? { informationKnown: false } : {}), ...(variant.parameters !== undefined ? { parameters: variant.parameters as Record<string, unknown> | null } : {}), asset: await addAsset(new Blob([bytes.buffer], { type: 'application/octet-stream' })) };
        encodings.push(encoding); encodingIds.set(key, encoding);
      }
      const encoding = encodingIds.get(key)!;
      if (encoding.information !== slot.informationExtracted) fail('Vibe 选择与编码提取量不一致');
      slot.vibeId = encoding.id; slot.encodingId = encoding.id; slot.informationKnown = encoding.informationKnown !== false;
    }
    entries.push(entry); options.onProgress?.({ phase: 'export', completed: index + 1, total: chains.length, name: chain.name });
  }
  const json = new TextEncoder().encode(JSON.stringify({ coverage, entries, assets, encodings } satisfies Manifest));
  if (json.length > STYLE_BUNDLE_LIMITS.manifestBytes) fail('配方文字超过 64 MiB，请分批导出');
  const compressed = await boundedBytes(new Blob([json.buffer]).stream().pipeThrough(new CompressionStream('gzip')), STYLE_BUNDLE_LIMITS.compressedManifestBytes);
  // 可逆混淆只避免被普通 JSON/ZIP 工具直接打开，不是保密或身份验证。
  const obfuscated = compressed.map(byte => byte ^ 0xa7), header = new Uint8Array(HEADER); header.set(MAGIC);
  const view = new DataView(header.buffer); view.setUint32(8, 1); view.setUint32(12, obfuscated.length); header.set(sha256(obfuscated), 16);
  return new Blob([header.buffer, obfuscated.buffer, ...blobs], { type: 'application/x-nai-atelier-style-bundle' });
}

export async function readStyleBundle(file: Blob, onProgress?: Progress): Promise<StyleBundlePreview> {
  if (file.size < HEADER || file.size > STYLE_BUNDLE_LIMITS.fileBytes) fail('分享包大小无效（上限 2 GiB）');
  const header = new Uint8Array(await file.slice(0, HEADER).arrayBuffer()), view = new DataView(header.buffer);
  if (!MAGIC.every((byte, index) => byte === header[index])) fail('不是 Atelier .naia 风格串分享包');
  if (view.getUint32(8) !== 1) fail('分享包版本不受支持，请更新 Atelier');
  const length = view.getUint32(12); if (!length || length > STYLE_BUNDLE_LIMITS.compressedManifestBytes || HEADER + length > file.size) fail('分享包清单长度无效');
  const compressed = new Uint8Array(await file.slice(HEADER, HEADER + length).arrayBuffer());
  if (hex(sha256(compressed)) !== hex(header.subarray(16))) fail('分享包清单已损坏');
  const decoded = await boundedBytes(new Blob([compressed.map(byte => byte ^ 0xa7).buffer]).stream().pipeThrough(new DecompressionStream('gzip')), STYLE_BUNDLE_LIMITS.manifestBytes);
  let raw: Record<string, unknown>; try { raw = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded))); } catch { return fail('分享包清单损坏'); }
  const coverage = Object.hasOwn(raw, 'coverage') ? raw.coverage : 'unrecorded';
  if (coverage !== 'full' && coverage !== 'partial' && !(coverage === 'unrecorded' && !Object.hasOwn(raw, 'coverage'))) fail('分享包打包范围无效');
  const entries = list(raw.entries, STYLE_BUNDLE_LIMITS.entries).map(cleanEntry); if (!entries.length) fail('分享包没有风格串');
  const assets: Asset[] = list(raw.assets, STYLE_BUNDLE_LIMITS.assets).map(value => {
    const asset = object(value); return { id: text(asset.id, 200), offset: finite(asset.offset), size: finite(asset.size), mime: text(asset.mime, 100), hash: text(asset.hash, 64) };
  });
  const encodings: Encoding[] = list(raw.encodings, STYLE_BUNDLE_LIMITS.encodings).map(value => {
    const encoding = object(value);
    if (encoding.informationKnown !== undefined) bool(encoding.informationKnown);
    return { id: text(encoding.id, 200), asset: text(encoding.asset, 200), sourceHash: text(encoding.sourceHash, 64), name: text(encoding.name, 100), model: text(encoding.model, 200), modelKey: text(encoding.modelKey, 200), information: finite(encoding.information), ...(encoding.informationKnown === false ? { informationKnown: false } : {}), ...(encoding.parameters !== undefined ? { parameters: encoding.parameters === null ? null : object(encoding.parameters) } : {}) };
  });
  for (const collection of [entries, assets, encodings]) if (new Set(collection.map(item => item.id)).size !== collection.length) fail('分享包标识重复');
  const assetMap = new Map(assets.map(asset => [asset.id, asset])), encodingMap = new Map(encodings.map(encoding => [encoding.id, encoding]));
  let size = 0;
  for (const asset of assets) {
    if (asset.offset !== size || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > STYLE_BUNDLE_LIMITS.assetBytes || !/^[a-f0-9]{64}$/.test(asset.hash)) fail('分享包素材范围无效');
    size += asset.size;
  }
  if (HEADER + length + size !== file.size) fail('分享包素材缺失或含额外内容');
  for (const encoding of encodings) {
    const asset = assetMap.get(encoding.asset);
    if (!asset || asset.mime !== 'application/octet-stream' || asset.size < 64 || asset.size > 12 * MiB || !/^[a-f0-9]{64}$/.test(encoding.sourceHash) || !encoding.model || !encoding.modelKey || encoding.information < 0 || encoding.information > 1) fail('分享包 Vibe 编码引用无效');
    if (VIBE_MODELS[encoding.modelKey] && VIBE_MODELS[encoding.modelKey] !== encoding.model) fail('分享包 Vibe 模型与编码类型不一致');
    if (encoding.parameters !== undefined) {
      const information = encoding.parameters?.information_extracted;
      if (information != null && (typeof information !== 'number' || !Number.isFinite(information) || information < 0 || information > 1 || information !== encoding.information)) fail('分享包 Vibe 提取参数无效或不一致');
      if ((encoding.informationKnown !== false) !== (information != null)) fail('分享包 Vibe 提取量状态与参数不一致');
    }
  }
  const image = (id: string) => { if (!assetMap.get(id)?.mime.startsWith('image/')) fail('分享包图片引用无效'); };
  for (const entry of entries) {
    if (entry.cover) { image(entry.cover); if (assetMap.get(entry.cover)!.size > 12 * MiB) fail('分享封面超过可导入的 12 MiB 上限'); }
    for (const slot of entry.params.characterReferences?.slots || []) image(slot.assetId);
    for (const slot of entry.params.vibes?.slots || []) {
      const encoding = encodingMap.get(slot.encodingId);
      if (!encoding || slot.vibeId !== slot.encodingId || encoding.information !== slot.informationExtracted
        || slot.informationKnown !== undefined && slot.informationKnown !== (encoding.informationKnown !== false)) fail('分享包 Vibe 选择无效');
      slot.informationKnown = encoding.informationKnown !== false;
    }
  }
  for (const [index, asset] of assets.entries()) {
    const blob = file.slice(HEADER + length + asset.offset, HEADER + length + asset.offset + asset.size, asset.mime);
    if (await hashBlob(blob) !== asset.hash) fail('分享包素材已损坏');
    if (asset.mime !== 'application/octet-stream') {
      if (await imageType(blob) !== asset.mime) fail('分享包图片格式不匹配');
      await validateImageDimensions(blob);
      const bitmap = await createImageBitmap(blob);
      try { if (bitmap.width * bitmap.height > 40_000_000) fail('分享包图片像素过大'); }
      finally { bitmap.close(); }
    }
    onProgress?.({ phase: 'read', completed: index + 1, total: assets.length });
  }
  const allSources = [...new Map(entries.flatMap(entry => entry.params._styleBundleSources || []).map(item => [JSON.stringify(item), item])).values()];
  const preview: StyleBundlePreview = { coverage, entries: entries.map(entry => ({ id: entry.id, name: entry.name, description: entry.description, cover: Boolean(entry.cover), sources: entry.params._styleBundleSources || [] })), sources: allSources, warnings: ['来源是分享者填写的声明，未经签名验证。'] };
  parsedBundles.set(preview, { manifest: { entries, assets, encodings }, entriesById: new Map(entries.map(entry => [entry.id, entry])), assetsById: assetMap, file, offset: HEADER + length, imported: new Map(), covers: new Map(), operationIds: new Map(entries.map(entry => [entry.id, `naia-${hex(sha256(new TextEncoder().encode(createUuid())))}`])), references: new Map(), vibes: new Map(), busy: false });
  return preview;
}

/** 只读取已经完整校验的包；配方快照隔离修改，封面字节不上传也不改写。 */
export function getStyleBundleEntryPreview(preview: StyleBundlePreview, entryId: string): StyleBundleEntryPreview {
  const parsed = parsedBundles.get(preview); if (!parsed) fail('请先读取并校验分享包');
  const original = parsed.entriesById.get(entryId);
  if (!original) fail('分享包中不存在该风格串');
  const { cover, ...entry } = original;
  const result: StyleBundleEntryPreview = structuredClone(entry);
  if (cover) {
    const asset = parsed.assetsById.get(cover)!;
    result.coverBlob = parsed.file.slice(parsed.offset + asset.offset, parsed.offset + asset.offset + asset.size, asset.mime);
  }
  return result;
}

export async function importStyleBundle(preview: StyleBundlePreview, selectedIds: string[], onProgress?: Progress): Promise<{ createdIds: string[]; importedEntryIds: string[]; failed: Array<{ id: string; name: string; error: string }> }> {
  const parsed = parsedBundles.get(preview); if (!parsed) fail('请先读取并校验分享包');
  if (parsed.busy) fail('这个分享包正在导入');
  const selected = new Set(selectedIds), entries = parsed.manifest.entries.filter(entry => selected.has(entry.id));
  if (entries.length !== selected.size) fail('导入选择含未知风格串');
  const assets = new Map(parsed.manifest.assets.map(asset => [asset.id, asset])), encodings = new Map(parsed.manifest.encodings.map(encoding => [encoding.id, encoding]));
  const getBlob = (id: string) => { const asset = assets.get(id)!; return parsed.file.slice(parsed.offset + asset.offset, parsed.offset + asset.offset + asset.size, asset.mime); };
  const result = { createdIds: [] as string[], importedEntryIds: [] as string[], failed: [] as Array<{ id: string; name: string; error: string }> };
  parsed.busy = true;
  try { for (const [index, entry] of entries.entries()) {
    try {
      if (!parsed.imported.has(entry.id)) {
        const params = structuredClone(entry.params);
        for (const slot of params.characterReferences?.slots || []) {
          const id = slot.assetId;
          if (!parsed.references.has(id)) {
            const blob = getBlob(id), reference = await characterReferenceService.create(new File([blob], 'reference', { type: blob.type }), slot.assetName || entry.name);
            parsed.references.set(id, reference.item.id);
          }
          slot.assetId = parsed.references.get(id)!;
        }
        for (const slot of params.vibes?.slots || []) {
          const id = slot.encodingId, encoding = encodings.get(id)!;
          if (!parsed.vibes.has(id)) {
            const parameters = encoding.parameters !== undefined ? encoding.parameters : encoding.informationKnown === false ? null : { information_extracted: encoding.information };
            const document = { identifier: 'novelai-vibe-transfer', version: 1, type: 'image', id: encoding.sourceHash, name: encoding.name, encodings: { [encoding.modelKey]: { variant: { encoding: await encodeBase64(getBlob(encoding.asset)), ...(parameters !== null ? { params: parameters } : {}) } } }, importInfo: { model: encoding.model, information_extracted: encoding.information, strength: slot.strength } };
            const response = await api.post('/vibes/import', { document }) as { item: VibeAsset };
            const variants = response.item.encodings.filter(variant => variant.model === encoding.model && (encoding.informationKnown === false || variant.informationExtracted === encoding.information));
            if (!variants.length) fail('导入的 Vibe 缺少所需编码');
            const variant = variants.find(variant => variant.encodingHash === assets.get(encoding.asset)!.hash
              && (variant.informationKnown !== false) === (encoding.informationKnown !== false)
              && vibeParameterKey(variant.parameters !== undefined ? variant.parameters : variant.informationKnown === false ? null : { information_extracted: variant.informationExtracted }) === vibeParameterKey(parameters));
            if (!variant) fail('已有 Vibe 编码与分享包冲突，已保留原编码');
            parsed.vibes.set(id, { vibeId: response.item.id, encodingId: variant.id, informationExtracted: variant.informationExtracted, informationKnown: variant.informationKnown !== false });
          }
          Object.assign(slot, parsed.vibes.get(id));
        }
        let previewImage: string | undefined;
        if (entry.cover) {
          if (!parsed.covers.has(entry.cover)) { const blob = getBlob(entry.cover); parsed.covers.set(entry.cover, (await api.uploadFile(new File([blob], `cover.${blob.type.split('/')[1]}`, { type: blob.type }), 'covers')).url); }
          previewImage = parsed.covers.get(entry.cover);
        }
        // 复用后端已有操作 ID：回执丢失后重投同一条只返回已建条目，不覆盖或重复新建。
        const chain = await api.post('/chains', { id: parsed.operationIds.get(entry.id), name: entry.name, description: entry.description, tags: entry.tags, basePrompt: entry.basePrompt, negativePrompt: entry.negativePrompt, modules: entry.modules, params, variableValues: entry.variableValues, previewImage, type: 'style' });
        if (typeof chain.id !== 'string' || !chain.id) fail('未收到新建风格串回执');
        parsed.imported.set(entry.id, chain.id);
      }
      result.createdIds.push(parsed.imported.get(entry.id)!); result.importedEntryIds.push(entry.id);
    } catch (error) { result.failed.push({ id: entry.id, name: entry.name, error: error instanceof Error ? error.message : '导入失败' }); }
    onProgress?.({ phase: 'import', completed: index + 1, total: entries.length, name: entry.name });
  } } finally { parsed.busy = false; }
  return result;
}
