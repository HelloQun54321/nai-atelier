import type { CharacterParams, NAIParams } from '../types';
import { createUuid } from './id';
import { extractMetadata, parseNovelAIMetadata, type PromptFragmentImport } from './metadataService';
import { getMobileOriginalUrl } from './mobileImageCache';
import { notifyLanAccessRequired, parseErrorResponse } from './api';
import { CODEX_ASSETS, CODEX_SITE, validateCodexDataUrl } from '../worker/codexRemote.mjs';
import { CODEX_MEDIA_HOSTS } from '../worker/sharedWhitelist.mjs';
import { readCodexCache, writeCodexCache } from './codexCache';
import { hasCollectibleNaiMetadata } from './pngMetadata.mjs';

type Raw = Record<string, any>;
const object = (value: unknown): Raw => value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
export interface CodexCharacter { label: string; prompt: string; negative: string }
export interface CodexImage {
  id: string; url: string; originalUrl: string; width: number; height: number;
  raw: string; prompt?: string; negative?: string; characters?: CodexCharacter[]; parameterSource: string;
}
export interface CodexEntry {
  key: string; id: string; source: 'codex' | 'codex-community'; bookId: string; bookTitle: string;
  title: string; path: string[]; prompt: string; negative: string; characters: CodexCharacter[];
  note: string; author: string; sourceUrl: string; images: CodexImage[]; coverIndex: number;
  nsfw: boolean; r18g: boolean; createdAt: number; likeCount: number; updates: string[]; isNew: boolean;
}
export interface CodexBook {
  id: string; title: string; type: string; author: string; version: string; entryCount: number;
  nsfw: boolean; hasOriginal: boolean; originalSections: string[]; exampleModel: string;
  dataUrl: string; assetBaseUrl: string; assetPathMode: string;
}
export interface CodexBootstrap {
  release: string; baseUrl: string; books: CodexBook[]; media: Raw;
  files: Record<string, { size: number; sha256: string }>; offline?: boolean; error?: string;
}
export interface CodexResult { entries: CodexEntry[]; release: string; offline?: boolean; error?: string }
export interface CodexImageMetadata { prompt: string; negativePrompt?: string; params: Partial<NAIParams>; rawPrompt: string; rawNegative: string }
const inFlight = new Map<string, Promise<CodexResult>>();
const loaded = new Map<string, CodexResult>();
const searchText = new WeakMap<CodexEntry, string>();
let bootstrap: CodexBootstrap | undefined;

export async function fetchCodexJson(url: string, file?: { size: number; sha256: string }, signal?: AbortSignal): Promise<any> {
  if (!validateCodexDataUrl(url)) throw new Error('不支持的法典数据地址');
  const response = await fetch(`/api/codex/data?url=${encodeURIComponent(url)}`, { signal });
  notifyLanAccessRequired(response);
  if (!response.ok) throw await parseErrorResponse(response);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (file) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)), n => n.toString(16).padStart(2, '0')).join('');
    if (bytes.byteLength !== file.size || hash !== file.sha256) throw new Error('法典数据校验失败，保留已有缓存');
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function normalizeCodexBooks(value: unknown): CodexBook[] {
  if (!Array.isArray(value) || !value.length) throw new Error('法典书目格式无效');
  const ids = new Set<string>();
  return value.map(raw => {
    const item = object(raw);
    const id = String(item.id || '');
    if (!/^[\w-]+$/.test(id) || ids.has(id)) throw new Error('法典书目编号无效或重复');
    ids.add(id);
    const dataUrl = String(item.dataUrl || '');
    return { id, title: String(item.title || id), type: String(item.type || 'codex'), author: String(item.author || ''),
      version: String(item.version || ''), entryCount: Number(item.entryCount) || 0, nsfw: Boolean(item.nsfw),
      hasOriginal: item.hasOriginal === true, originalSections: strings(item.originalSections), exampleModel: String(item.exampleModel || ''),
      dataUrl, assetBaseUrl: String(item.assetBaseUrl || ''), assetPathMode: String(item.assetPathMode || '') };
  });
}

export async function loadCodexBootstrap(refresh = false, signal?: AbortSignal): Promise<CodexBootstrap> {
  if (bootstrap && !refresh) return bootstrap;
  try {
    const source = object(await fetchCodexJson(`${CODEX_SITE}/data-source.json`, undefined, signal));
    if (source.schemaVersion !== 1 || source.baseUrl !== `${CODEX_ASSETS}/data` || source.pointer !== 'current.json') throw new Error('法典发布配置暂不支持');
    const pointer = object(await fetchCodexJson(`${source.baseUrl}/${source.pointer}`, undefined, signal));
    if (!/^r-[a-f0-9]+$/.test(pointer.release) || pointer.manifest !== `releases/${pointer.release}/manifest.json`) throw new Error('法典发布版本无效');
    const manifest = object(await fetchCodexJson(`${source.baseUrl}/${pointer.manifest}`, undefined, signal));
    const files = object(manifest.files) as CodexBootstrap['files'];
    if (!files['codexes.json'] || !files['media.json']) throw new Error('法典发布清单不完整');
    const baseUrl = `${source.baseUrl}/releases/${pointer.release}`;
    const [index, media] = await Promise.all([
      fetchCodexJson(`${baseUrl}/codexes.json`, files['codexes.json'], signal),
      fetchCodexJson(`${baseUrl}/media.json`, files['media.json'], signal),
    ]);
    const next = { release: pointer.release as string, baseUrl, files, media: object(media), books: normalizeCodexBooks(index) };
    await writeCodexCache('bootstrap', next);
    if (bootstrap?.release !== next.release) loaded.clear();
    bootstrap = next;
    return next;
  } catch (cause) {
    if (signal?.aborted) throw signal.reason;
    const cached = bootstrap || await readCodexCache<CodexBootstrap>('bootstrap');
    if (!cached) throw cause;
    bootstrap = { ...cached, offline: true, error: cause instanceof Error ? cause.message : '法典连接失败' };
    return bootstrap;
  }
}

export const normalizeCodexCharacters = (value: unknown): CodexCharacter[] => Array.isArray(value) ? value.flatMap((raw, index) => {
  const item = typeof raw === 'string' ? { prompt: raw } : object(raw);
  const prompt = String(item.prompt || item.positive || item.char_caption || '');
  const negative = String(item.negative ?? item.uc ?? '');
  return prompt || negative ? [{ label: String(item.label || `char${index + 1}`), prompt, negative }] : [];
}) : [];

export function codexMediaUrl(file: unknown, book: CodexBook, media: Raw, entry: Raw, original = false): string {
  if (typeof file !== 'string' || !file) return '';
  try {
    let value = file;
    if (!/^https?:\/\//i.test(value)) {
      const relative = book.assetPathMode === 'relative';
      const path = relative ? value.replace(/^\/+/, '') : [original ? media.originalPrefix || 'originals' : media.imagePrefix || 'images', entry.assetCodexId || book.id, value].join('/');
      value = `${(relative ? book.assetBaseUrl : media.baseUrl || CODEX_ASSETS).replace(/\/+$/, '')}/${path.split('/').map(encodeURIComponent).join('/')}`;
    }
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !CODEX_MEDIA_HOSTS.includes(url.hostname)) return '';
    if (entry.assetRev) url.searchParams.set('v', String(entry.assetRev));
    return url.href;
  } catch { return ''; }
}

export function normalizeCodexEntries(value: unknown, book: CodexBook, media: Raw, community = false): CodexEntry[] {
  const data = object(value);
  if (!Array.isArray(data.entries)) throw new Error('法典词条格式无效');
  const keys = new Set<string>();
  return data.entries.map((raw: unknown, index: number) => {
    const item = object(raw);
    const path = community ? strings(Array.isArray(item.category) ? item.category : [item.category]) : strings(item.path);
    const prompt = String(community ? item.prompt || '' : item.tags || item.rawTags || '');
    const characters = normalizeCodexCharacters(item.characterPrompts);
    const id = String(item.id || `${book.id}-${index + 1}`);
    const source = community ? 'codex-community' as const : 'codex' as const;
    const key = `${source}:${book.id}:${id}`;
    if (keys.has(key)) throw new Error('法典词条编号重复，保留已有缓存');
    keys.add(key);
    const allowOriginal = community || book.hasOriginal || book.originalSections.includes(path[0]);
    const imageValues = Array.isArray(item.images) ? [...item.images] : [];
    if (item.image && !imageValues.some(value => (typeof value === 'string' ? value : object(value).path || object(value).image) === item.image)) {
      imageValues.unshift({ path: item.image, original: item.original, width: item.imageWidth, height: item.imageHeight });
    }
    const seen = new Set<string>();
    const images: CodexImage[] = imageValues.flatMap((rawImage: unknown) => {
      const image = typeof rawImage === 'string' ? { path: rawImage } : object(rawImage);
      let file = image.path || image.file || image.image || image.url || image.src;
      const communityFile = (value: unknown) => community && typeof value === 'string' && !/^https?:\/\//i.test(value)
        ? `https://pub-a66b6b5ffa0d44a89eb7dd6fa1070b58.r2.dev/${value.replace(/^\/+/, '')}` : value;
      file = communityFile(file);
      const url = codexMediaUrl(file, book, media, { ...item, ...image });
      if (!url || seen.has(url)) return [];
      seen.add(url);
      const originalUrl = allowOriginal && image.original && image._hasOriginal !== false ? codexMediaUrl(communityFile(image.original), book, media, { ...item, ...image }, true) : '';
      return [{ id: String(image.id || (community ? new URL(url).pathname : file)), url, originalUrl, width: Number(image.width || item.imageWidth) || 0, height: Number(image.height || item.imageHeight) || 0,
        raw: String(image.rawTag || image.rawTags || ''), prompt: image.tags === undefined ? undefined : String(image.tags),
        negative: image.negative === undefined ? undefined : String(image.negative),
        characters: image.characterPrompts === undefined ? undefined : normalizeCodexCharacters(image.characterPrompts), parameterSource: String(object(image.params).source || '') }];
    });
    const rating = String(item.rating || item.level || '').toLowerCase();
    return { key, id, source, bookId: book.id, bookTitle: book.title, title: String(item.title || '未命名词条'), path, prompt,
      negative: String(item.negative ?? ''), characters, note: String(community ? item.comment || '' : item.note || ''), author: String(item.submitter || item.author || book.author || data.author || ''),
      sourceUrl: community ? `${CODEX_SITE}/strings.html?entry=${encodeURIComponent(id)}` : `${CODEX_SITE}/share/${encodeURIComponent(book.id)}/${encodeURIComponent(id)}`,
      images, coverIndex: Math.min(Math.max(0, Number(item.coverIndex) || 0), Math.max(0, images.length - 1)),
      nsfw: book.nsfw || Boolean(item.nsfw) || ['restricted', 'r18', 'r18g', 'nsfw'].includes(rating) || path.some(part => part.toLowerCase() === 'nsfw'),
      r18g: rating === 'r18g' || path.some(part => /r18g|重口/i.test(part)), createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.parse(item.createdAt) || 0,
      likeCount: Math.max(0, Number(item.likeCount) || 0), updates: strings(item.updateBatches), isNew: Boolean(item.isNew) };
  });
}

export async function loadCodexBook(book: CodexBook, boot: CodexBootstrap, refresh = false, signal?: AbortSignal): Promise<CodexResult> {
  const key = `${boot.release}:${book.id}`;
  if (!refresh && loaded.has(key)) return loaded.get(key)!;
  if (!refresh && !signal && inFlight.has(key)) return inFlight.get(key)!;
  const currentCapabilities = (result: CodexResult): CodexResult => ({ ...result, entries: result.entries.map(entry =>
    book.hasOriginal || book.originalSections.includes(entry.path[0]) ? entry : { ...entry, images: entry.images.map(image => ({ ...image, originalUrl: '' })) }) });
  const task = (async () => {
    try {
      const cached = !book.dataUrl && !refresh ? await readCodexCache<CodexResult>(`book:${book.id}`) : undefined;
      if (cached?.release === boot.release) { const result = currentCapabilities(cached); loaded.set(key, result); return result; }
      const file = `${book.id}.json`;
      if (!book.dataUrl && !boot.files[file]) throw new Error('当前发布缺少这本书的数据');
      const raw = await fetchCodexJson(book.dataUrl || `${boot.baseUrl}/${file}`, book.dataUrl ? undefined : boot.files[file], signal);
      const result = { entries: normalizeCodexEntries(raw, book, boot.media), release: boot.release };
      loaded.set(key, result);
      // 外部书目仅使用实时源，不使用站点快照或离线回退。
      if (!book.dataUrl) await writeCodexCache(`book:${book.id}`, result);
      return result;
    } catch (cause) {
      if (signal?.aborted) throw signal.reason;
      const cached = !book.dataUrl ? await readCodexCache<CodexResult>(`book:${book.id}`) : undefined;
      if (!cached) throw cause;
      return { ...currentCapabilities(cached), offline: true, error: cause instanceof Error ? cause.message : '书目连接失败' };
    }
  })();
  if (!signal) inFlight.set(key, task);
  try { return await task; } finally { if (inFlight.get(key) === task) inFlight.delete(key); }
}

export async function loadCodexCommunity(signal?: AbortSignal): Promise<CodexResult> {
  try {
    const raw = await fetchCodexJson(`${CODEX_SITE}/api/community`, undefined, signal);
    const book = normalizeCodexBooks([{ id: 'community', title: '共创广场', hasOriginal: true }])[0];
    const result = { entries: normalizeCodexEntries(raw, book, {} , true), release: String(raw.generatedAt || '') };
    await writeCodexCache('community', result);
    return result;
  } catch (cause) {
    if (signal?.aborted) throw signal.reason;
    const cached = await readCodexCache<CodexResult>('community');
    if (!cached) throw cause;
    return { ...cached, offline: true, error: cause instanceof Error ? cause.message : '广场连接失败' };
  }
}

export async function loadCodexAuxiliary(boot: CodexBootstrap, file: string): Promise<Raw> {
  if (!boot.files[file]) return {};
  const key = `aux:${file}`;
  const cached = await readCodexCache<{ release: string; data: Raw }>(key);
  if (cached?.release === boot.release) return cached.data;
  const data = object(await fetchCodexJson(`${boot.baseUrl}/${file}`, boot.files[file]));
  await writeCodexCache(key, { release: boot.release, data });
  return data;
}

export function codexEntryMatches(entry: CodexEntry, query: string): boolean {
  if (!query.trim()) return true;
  let text = searchText.get(entry);
  if (!text) {
    text = [entry.title, entry.bookTitle, entry.author, entry.path.join('/'), entry.prompt, entry.negative, entry.note,
      ...entry.characters.flatMap(character => [character.label, character.prompt, character.negative]),
      ...entry.images.flatMap(image => [image.raw, image.prompt, image.negative,
        ...(image.characters || []).flatMap(character => [character.label, character.prompt, character.negative])])].join('\n').normalize('NFKC').replaceAll('_', ' ').toLowerCase();
    searchText.set(entry, text);
  }
  return query.split(/[,，]/).map(part => part.trim().normalize('NFKC').replaceAll('_', ' ').toLowerCase()).filter(Boolean).every(part => text.includes(part));
}

export const codexCharactersToParams = (characters: CodexCharacter[]): CharacterParams[] => characters.map(character => ({
  id: createUuid(), prompt: character.prompt, negativePrompt: character.negative, x: 0.5, y: 0.5, enabled: true,
}));

export function codexPromptImport(entry: CodexEntry, metadata?: CodexImageMetadata): PromptFragmentImport {
  if (metadata) return { mode: 'prompt-fragments', fullMetadata: true,
    partialMetadata: metadata.negativePrompt === undefined || ['model', 'width', 'height', 'steps', 'scale', 'sampler', 'seed'].some(key => metadata.params[key as keyof NAIParams] === undefined),
    replace: true, prompt: metadata.prompt, negativePrompt: metadata.negativePrompt,
    characters: metadata.params.characters, params: metadata.params, importSettings: true, importSeed: metadata.params.seed !== undefined, importModel: Boolean(metadata.params.model) };
  return { mode: 'prompt-fragments', replace: false, ...(entry.prompt ? { prompt: entry.prompt } : {}),
    ...(entry.negative ? { negativePrompt: entry.negative } : {}),
    ...(entry.characters.length ? { characters: codexCharactersToParams(entry.characters) } : {}) };
}

export async function readCodexImageFile(url: string): Promise<File> {
  const response = await fetch(getMobileOriginalUrl(url), { cache: 'no-cache' });
  notifyLanAccessRequired(response);
  if (!response.ok) throw await parseErrorResponse(response);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('来源没有返回可读取的图片');
  return new File([blob], new URL(url).pathname.split('/').pop() || 'codex.png', { type: blob.type });
}

export async function readCodexImageMetadata(file: File): Promise<CodexImageMetadata | null> {
  const text = await extractMetadata(file);
  if (!text) return null;
  // SD / ComfyUI 文本及工作流不会被映射成 NAI 配置。
  let raw: Raw;
  try { raw = object(JSON.parse(text)); } catch { return null; }
  let comment: Raw;
  try { comment = typeof raw.Comment === 'string' ? object(JSON.parse(raw.Comment)) : object(raw.Comment || raw); } catch { return null; }
  const parsed = parseNovelAIMetadata(JSON.stringify(comment));
  if (!hasCollectibleNaiMetadata(JSON.stringify(comment)) && !(parsed.params.model &&
    (typeof comment.prompt === 'string' || typeof comment.v4_prompt?.caption?.base_caption === 'string'))) return null;
  // 解析器的缺省值用于编辑体验，外部取用只承认图片实际记录的字段。
  const hasNegative = typeof comment.v4_negative_prompt?.caption?.base_caption === 'string' || typeof comment.uc === 'string';
  const params: Partial<NAIParams> = { qualityToggle: parsed.params.qualityToggle, ...(hasNegative ? { ucPreset: parsed.params.ucPreset } : {}) };
  for (const key of ['width', 'height', 'steps', 'scale', 'sampler'] as const) {
    if (comment[key] !== undefined && parsed.params[key] !== undefined) Object.assign(params, { [key]: parsed.params[key] });
  }
  if (Number.isInteger(comment.seed) && comment.seed >= 0) params.seed = comment.seed;
  if (parsed.params.model) params.model = parsed.params.model;
  if (comment.v4_prompt) {
    params.characters = parsed.params.characters;
    if (comment.v4_prompt.use_coords !== undefined) params.useCoords = parsed.params.useCoords;
  }
  if (parsed.params.vibes) params.vibes = parsed.params.vibes;
  if (comment.cfg_rescale !== undefined) params.cfgRescale = parsed.params.cfgRescale;
  if (comment.skip_cfg_above_sigma !== undefined) params.variety = parsed.params.variety;
  if (comment.transparent !== undefined || comment.tag_hint_transparent_background !== undefined) {
    params.transparent = parsed.params.transparent; params.transparentWeight = parsed.params.transparentWeight;
  }
  if (comment.straight_alpha !== undefined) params.alphaMode = parsed.params.alphaMode;
  return { ...parsed, negativePrompt: hasNegative ? parsed.negativePrompt : undefined, params, rawPrompt: String(comment.v4_prompt?.caption?.base_caption ?? comment.prompt ?? ''),
    rawNegative: String(comment.v4_negative_prompt?.caption?.base_caption ?? comment.uc ?? '') };
}
