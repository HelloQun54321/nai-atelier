import type { NAIParams } from '../types';
import { ApiError, notifyLanAccessRequired, parseErrorResponse } from './api';
import { t } from './i18n';
import { getArtistDictionaryEntriesAt, getArtistDictionaryPage, type ArtistDictionaryEntry } from './tagDictionary';

export type ArtistSamplePack = 'v45' | 'v5';
export const isArtistSampleModelForPack = (pack: ArtistSamplePack, model = '') =>
  pack === 'v45' ? /^nai-diffusion-4-5-/.test(model) && !model.endsWith('-inpainting') : /^nai-diffusion-5-full(?:-medium)?$/.test(model);
export const isArtistSampleSourceForPack = (pack: ArtistSamplePack, source?: { model?: string } | null) =>
  pack === 'v45' || source?.model === 'nai-diffusion-5-full';
export type ArtistSampleRemoval = { source: 'own'; pack: ArtistSamplePack; tag: string; id: string }
  | { source: 'pack'; pack: ArtistSamplePack; tag: string; revision: string; index: number; imageCount: number };
export interface ArtistSampleTemplate { prompt: string; negativePrompt: string; characterPrompt?: string; params: NAIParams }
export interface ArtistOwnSample extends ArtistSampleTemplate { id: string; tag: string; pack: ArtistSamplePack; imageUrl: string; createdAt: number }
export const isArtistOwnSampleForPack = (sample: ArtistOwnSample, pack: ArtistSamplePack = sample.pack) =>
  sample.pack === pack && (pack === 'v45' || isArtistSampleModelForPack(pack, sample.params?.model));
export interface ArtistSampleDownloadStatus {
  stage: 'missing' | 'downloading' | 'verifying' | 'paused' | 'error' | 'ready';
  receivedBytes: number;
  totalBytes: number;
  error?: string;
}
export interface ArtistSamplePackStatus {
  model?: string;
  id: ArtistSamplePack;
  label: string;
  filename: string;
  path?: string;
  phase: 'unconfigured' | 'indexing' | 'ready' | 'error';
  progress: number;
  processedBytes: number;
  totalBytes: number;
  count: number;
  imageCount?: number;
  revision: string;
  error?: string;
  managed?: boolean;
  download?: ArtistSampleDownloadStatus;
  files?: { filename: string; size: number; active: boolean; download: ArtistSampleDownloadStatus; count?: number }[];
}
export interface ArtistSampleStatus { available: boolean; canManage: boolean; packs: ArtistSamplePackStatus[]; downloadDirectory?: string }
export interface ArtistSampleCatalog { pack: ArtistSamplePack; revision: string; tags: string[]; model?: string }
export interface ArtistSampleLookup { pack: ArtistSamplePack; revision: string; tag: string; canonicalTag?: string; imageCount: number; sourceUrl: string; model?: string }
export const ARTIST_SAMPLES_CHANGED = 'nai-artist-samples-changed';
export const broadcastArtistSamplesChanged = () => { window.dispatchEvent(new Event(ARTIST_SAMPLES_CHANGED)); };

const request = async <T>(path: string, init: RequestInit = {}, timeout = 15_000): Promise<T> => {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  init.signal?.addEventListener('abort', cancel, { once: true });
  if (init.signal?.aborted) cancel();
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
    const response = await fetch(`/api/artist-samples/${path}`, { ...init, signal: controller.signal });
    notifyLanAccessRequired(response);
    if (!response.ok) {
      if (path === 'status' && response.status === 404) throw new ApiError(t('本地图包仅支持电脑端及局域网访问'), 404);
      throw await parseErrorResponse(response);
    }
    return await response.json() as T;
  } catch (error) {
    if (timedOut) throw new Error(t('读取画师样张超时，请重试'));
    throw error;
  } finally { window.clearTimeout(timer); init.signal?.removeEventListener('abort', cancel); }
};

export const getArtistSampleStatus = (signal?: AbortSignal) => request<ArtistSampleStatus>('status', { signal });
export const getArtistSampleCatalog = (pack: ArtistSamplePack) => request<ArtistSampleCatalog>(`catalog?${new URLSearchParams({ pack })}`);
export const getArtistSampleLookup = (pack: ArtistSamplePack, tag: string, signal?: AbortSignal) => request<ArtistSampleLookup>(`lookup?${new URLSearchParams({ pack, tag })}`, { signal });
export const buildArtistSampleImageUrl = (pack: ArtistSamplePack, tag: string, index: number, revision: string) => `/api/artist-samples/image?${new URLSearchParams({ pack, tag, index: String(index), revision })}`;
export type ArtistSamplePackAction = 'pick' | 'cancel' | 'reindex' | 'remove' | 'download' | 'pause';
export const controlArtistSamplePack = async (action: ArtistSamplePackAction, pack: ArtistSamplePack, file?: string) => {
  const result = await request<{ cancelled?: boolean; status: ArtistSampleStatus }>('control', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nai-local-control': 'true' }, body: JSON.stringify({ action, pack, ...(file !== undefined ? { file } : {}) }),
  }, action === 'pick' ? 310_000 : 15_000);
  if (!result.cancelled) broadcastArtistSamplesChanged();
  return result;
};

export const normalizeArtistSampleTag = (tag: string) => tag.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
export const isArtistOwnSampleRemoved = (sample: ArtistOwnSample, removedSamples: ArtistSampleRemoval[] = []) =>
  removedSamples.some(item => item.source === 'own' && item.pack === sample.pack && item.id === sample.id);

export function getAvailableArtistSampleIndices(pack: ArtistSamplePack, tag: string, revision: string, imageCount: number, removedSamples: ArtistSampleRemoval[] = []): number[] {
  const removed = new Set(removedSamples.filter(item => item.source === 'pack' && item.pack === pack && item.tag === tag && item.revision === revision)
    .map(item => item.source === 'pack' ? item.index : -1));
  return Array.from({ length: Math.max(0, Math.floor(imageCount)) }, (_, index) => index).filter(index => !removed.has(index));
}

/** 删除标记仅匹配精确图包名；别名只在目录内唯一时解析。 */
export function getArtistSampleCatalogImageIndex(catalog: ArtistSampleCatalog, tag: string, removedSamples: ArtistSampleRemoval[] = []): number | undefined {
  const matches = catalog.tags.includes(tag) ? [tag] : catalog.tags.filter(name => normalizeArtistSampleTag(name) === normalizeArtistSampleTag(tag));
  if (matches.length !== 1) return undefined;
  return getArtistSampleCatalogImageIndices(catalog, removedSamples).get(matches[0]);
}

export function getArtistSampleCatalogImageIndices(catalog: ArtistSampleCatalog, removedSamples: ArtistSampleRemoval[] = []): Map<string, number> {
  const removals = new Map<string, { count: number; indices: Set<number> }>();
  for (const item of removedSamples) if (item.source === 'pack' && item.pack === catalog.pack && item.revision === catalog.revision) {
    const entry = removals.get(item.tag) || { count: 1, indices: new Set<number>() };
    entry.count = Math.max(entry.count, item.imageCount); entry.indices.add(item.index); removals.set(item.tag, entry);
  }
  const available = new Map<string, number>();
  for (const tag of catalog.tags) {
    const removal = removals.get(tag); let index = 0;
    while (removal?.indices.has(index)) index++;
    if (!removal || index < removal.count) available.set(tag, index);
  }
  return available;
}
export const getAvailableArtistSampleCatalogTags = (catalog: ArtistSampleCatalog, removedSamples: ArtistSampleRemoval[] = []) =>
  [...getArtistSampleCatalogImageIndices(catalog, removedSamples).keys()];
let dictionaryPromise: Promise<ArtistDictionaryEntry[]> | undefined;
/** 一次读取轻量目录，底层仍复用词库分片缓存；样张交集不受列表已加载页数限制。 */
export const getArtistSampleDictionary = () => {
  if (!dictionaryPromise) dictionaryPromise = getArtistDictionaryPage(0).then(first => getArtistDictionaryEntriesAt(Array.from({ length: first.total }, (_, index) => index)))
    .catch(error => { dictionaryPromise = undefined; throw error; });
  return dictionaryPromise;
};

/** 精确匹配唯一名称；冲突条目不通过归一化猜测归属。 */
export const matchArtistSampleTags = (entries: ArtistDictionaryEntry[], tags: string[]) => {
  const unique = (names: string[]) => {
    const matches = new Map<string, Set<string>>();
    names.forEach(name => { const key = normalizeArtistSampleTag(name); if (!matches.has(key)) matches.set(key, new Set()); matches.get(key)!.add(name); });
    return new Set([...matches].filter(([key, names]) => key && names.size === 1).map(([key]) => key));
  };
  const exact = new Set(tags);
  const known = unique(entries.map(entry => entry.name)), samples = unique(tags);
  return entries.filter(entry => exact.has(entry.name) || (known.has(normalizeArtistSampleTag(entry.name)) && samples.has(normalizeArtistSampleTag(entry.name))));
};

/** 样张独有名称只补到浏览目录；不写回全局词库，0 表示未知热度。 */
export const getSampledArtistDictionaryEntries = (entries: ArtistDictionaryEntry[], tags: string[]): ArtistDictionaryEntry[] => {
  const exact = new Set(entries.map(entry => entry.name));
  const matched = matchArtistSampleTags(entries, tags);
  const matchedKeys = new Set(matched.map(entry => normalizeArtistSampleTag(entry.name)));
  const knownCounts = new Map<string, number>(), sampleCounts = new Map<string, number>();
  for (const name of exact) {
    const key = normalizeArtistSampleTag(name);
    knownCounts.set(key, (knownCounts.get(key) || 0) + 1);
  }
  const names = [...new Set(tags)].filter(name => normalizeArtistSampleTag(name));
  for (const name of names) {
    const key = normalizeArtistSampleTag(name);
    sampleCounts.set(key, (sampleCounts.get(key) || 0) + 1);
  }
  return [...matched, ...names.filter(name => {
    if (exact.has(name)) return false;
    const key = normalizeArtistSampleTag(name);
    return !(knownCounts.get(key) === 1 && sampleCounts.get(key) === 1 && matchedKeys.has(key));
  }).map(name => ({ name, chinese: '', postCount: 0, postCountKnown: false }))];
};

/** 保留无图词库画师，仅追加当前图包未匹配的原名。 */
export const mergeArtistSampleDictionary = (entries: ArtistDictionaryEntry[], tags: string[]): ArtistDictionaryEntry[] => {
  const names = new Set(entries.map(entry => entry.name));
  return [...entries, ...getSampledArtistDictionaryEntries(entries, tags).filter(entry => !names.has(entry.name))];
};

/** 完整浏览目录合并所有已就绪来源；只请求轻量名单，不读取图片。 */
export const getArtistSampleLibrary = async (): Promise<ArtistDictionaryEntry[]> => {
  const [entries, status] = await Promise.all([getArtistSampleDictionary(), getArtistSampleStatus().catch(error => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  })]);
  if (!status) return entries;
  const packs = status.packs.filter(pack => pack.phase === 'ready' && isArtistSampleSourceForPack(pack.id, pack));
  const catalogs = await Promise.all(packs.map(pack => getArtistSampleCatalog(pack.id)));
  return mergeArtistSampleDictionary(entries, catalogs.filter(catalog => isArtistSampleSourceForPack(catalog.pack, catalog)).flatMap(catalog => catalog.tags));
};
