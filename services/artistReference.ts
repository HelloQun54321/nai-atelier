import { notifyLanAccessRequired, parseErrorResponse } from './api';
import { t } from './i18n';
import { matchArtistSampleTags, normalizeArtistSampleTag } from './artistSamples';
import type { ArtistDictionaryEntry } from './tagDictionary';

export type ArtistReferenceUsability = '稳定' | '可用' | '慎用' | '失效' | '待验证';
export type ArtistReferenceFidelity = '高' | '中' | '低' | '未知';
export interface ArtistReferenceImage { full: string; thumb: string }
export interface ArtistReferenceEntry {
  id: string; tag: string; artist: string; testedPrompt: string; tester: string; danbooruTag: string; danbooruPosts: number | null;
  look: string; danbooruLook: string; fidelity: ArtistReferenceFidelity; usability: ArtistReferenceUsability;
  tags: string[]; roles: string[]; note: string; model: string; evidenceNote: string; effects: string[]; biases: string[]; assessment: string;
  images: ArtistReferenceImage[];
}
/** 来源与致谢：测试者取自数据中的署名。 */
export interface ArtistReferenceCredits { source: string; url: string; testers: string[] }
export interface ArtistReferenceData { version: string; source: { label: string; url: string }; credits?: ArtistReferenceCredits; revision: number; updatedAt: string; fetchedAt: number; entries: ArtistReferenceEntry[] }
export interface ArtistReferenceStatus {
  available: boolean; canManage: boolean; source?: { label: string; url: string }; credits?: ArtistReferenceCredits;
  phase: 'missing' | 'ready' | 'error'; error?: string; version: string; revision: number; updatedAt: string; fetchedAt: number;
  count: number; artistCount: number; thumbnails: { cached: number; total: number }; directory?: string;
  sync: { stage: 'idle' | 'fetching' | 'thumbnails' | 'ready' | 'cancelled' | 'error'; done: number; total: number; failed: number; error: string };
}
export type ArtistReferenceAction = 'sync' | 'cancel' | 'remove';
export interface ArtistReferenceFilter {
  only: boolean; dimension: string; tags: string[]; roles: string[];
  usability: ArtistReferenceUsability[]; fidelity: ArtistReferenceFidelity[]; testers: string[];
}

export const ARTIST_REFERENCE_CHANGED = 'nai-artist-reference-changed';
export const ARTIST_REFERENCE_USABILITY: ArtistReferenceUsability[] = ['稳定', '可用', '慎用', '失效', '待验证'];
export const ARTIST_REFERENCE_FIDELITY: ArtistReferenceFidelity[] = ['高', '中', '低', '未知'];
/** 风格标签按「维度-取值」书写；维度顺序与来源站点「按风格探索」一致，名称由界面按语言显示。 */
export const ARTIST_REFERENCE_DIMENSIONS = ['线', '涂', '色', '构', '景', '风', '光', '材'] as const;
export const EMPTY_ARTIST_REFERENCE_FILTER: ArtistReferenceFilter = { only: false, dimension: '', tags: [], roles: [], usability: [], fidelity: [], testers: [] };
export const broadcastArtistReferenceChanged = () => { window.dispatchEvent(new Event(ARTIST_REFERENCE_CHANGED)); };

const request = async <T>(path: string, init: RequestInit = {}, timeout = 15_000): Promise<T> => {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  init.signal?.addEventListener('abort', cancel, { once: true });
  if (init.signal?.aborted) cancel();
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
    const response = await fetch(`/api/artist-reference/${path}`, { ...init, signal: controller.signal });
    notifyLanAccessRequired(response);
    if (!response.ok) {
      if (path === 'status' && response.status === 404) throw new Error(t('画师组串参考仅支持电脑端及局域网访问'));
      throw await parseErrorResponse(response);
    }
    return await response.json() as T;
  } catch (error) {
    if (timedOut) throw new Error(t('读取画师组串参考超时，请重试'));
    throw error;
  } finally { window.clearTimeout(timer); init.signal?.removeEventListener('abort', cancel); }
};

/** 不认识的响应（旧版后端、非工坊服务）按不可用处理，不让页面读取残缺状态。 */
export const getArtistReferenceStatus = async (signal?: AbortSignal) => {
  const status = await request<ArtistReferenceStatus>('status', { signal });
  if (!status || typeof status !== 'object' || !['missing', 'ready', 'error'].includes(status.phase) || !status.sync || typeof status.sync.stage !== 'string' || !status.thumbnails) {
    throw new Error(t('画师组串参考仅支持电脑端及局域网访问'));
  }
  return status;
};
let dataCache: Promise<ArtistReferenceData> | undefined, dataVersion = '';
/** 同一版本只读取一次；版本由状态接口给出，更新或删除后自动换新。 */
export const getArtistReferenceData = (version: string) => {
  if (!dataCache || dataVersion !== version) {
    dataVersion = version;
    dataCache = request<ArtistReferenceData>('data', {}, 30_000).catch(error => { if (dataVersion === version) dataCache = undefined; throw error; });
  }
  return dataCache;
};
export const controlArtistReference = async (action: ArtistReferenceAction): Promise<{ status: ArtistReferenceStatus }> => {
  const result = await request<{ status: ArtistReferenceStatus }>('control', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nai-local-control': 'true' }, body: JSON.stringify({ action }),
  }, action === 'cancel' || action === 'remove' ? 60_000 : 15_000);
  broadcastArtistReferenceChanged();
  return result;
};
export const buildArtistReferenceImageUrl = (file: string) => `/api/artist-reference/image?${new URLSearchParams({ file })}`;

/** 按画师 Tag 归组；同一画师的不同测试者记录保留各自结论。 */
export const groupArtistReference = (entries: ArtistReferenceEntry[] = []) => {
  const groups = new Map<string, ArtistReferenceEntry[]>();
  for (const entry of entries) {
    const key = normalizeArtistSampleTag(entry.tag);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }
  return groups;
};

/** 词库命中按图包相同规则对齐；词库缺少的已测画师按参考条目补成目录项。 */
export const matchArtistReferenceEntries = (dictionary: ArtistDictionaryEntry[], groups: Map<string, ArtistReferenceEntry[]>): ArtistDictionaryEntry[] => {
  const tags = [...groups.values()].map(records => records[0].tag);
  const matched = matchArtistSampleTags(dictionary, tags);
  const covered = new Set(matched.map(entry => normalizeArtistSampleTag(entry.name)));
  // 作品数沿用参考记录；参考里也没有时与图包独有画师一样标为未知，不显示成 0。
  const extra = [...groups].filter(([key]) => !covered.has(key)).map(([, records]) => {
    const posts = records.find(record => record.danbooruPosts !== null)?.danbooruPosts;
    return { name: records[0].tag, chinese: '', postCount: posts ?? 0, ...(posts === undefined ? { postCountKnown: false } : {}) };
  });
  return [...matched, ...extra];
};

export const countArtistReferenceFilter = (filter: ArtistReferenceFilter) => Number(filter.only) + Number(Boolean(filter.dimension)) + filter.tags.length + filter.roles.length
  + filter.usability.length + filter.fidelity.length + filter.testers.length;
export const isArtistReferenceFilterActive = (filter: ArtistReferenceFilter) => countArtistReferenceFilter(filter) > 0;

/** 同一条来源记录需同时满足全部风格标签与所选维度；定位、可用性、还原度与测试者在所选项中任一即可。 */
export const matchesArtistReferenceFilter = (records: ArtistReferenceEntry[] | undefined, filter: ArtistReferenceFilter) => {
  if (!records?.length) return !isArtistReferenceFilterActive(filter);
  return records.some(record => filter.tags.every(tag => record.tags.includes(tag))
    && (!filter.dimension || record.tags.some(tag => tag.startsWith(`${filter.dimension}-`)))
    && (!filter.roles.length || record.roles.some(role => filter.roles.includes(role)))
    && (!filter.usability.length || filter.usability.includes(record.usability))
    && (!filter.fidelity.length || filter.fidelity.includes(record.fidelity))
    && (!filter.testers.length || filter.testers.includes(record.tester)));
};

const CAUTION_ORDER: ArtistReferenceUsability[] = ['稳定', '可用', '待验证', '慎用', '失效'];
/** 卡片摘要：最常见的首个定位与最谨慎的可用性，记录数如实显示，避免把分歧说成稳定。 */
export const summarizeArtistReference = (records: ArtistReferenceEntry[]) => {
  const rank = (value: ArtistReferenceUsability) => CAUTION_ORDER.indexOf(value);
  const caution = records.reduce((current, record) => rank(record.usability) > rank(current) ? record.usability : current, records[0].usability);
  const roles = new Map<string, number>();
  for (const record of records) if (record.roles[0]) roles.set(record.roles[0], (roles.get(record.roles[0]) || 0) + 1);
  const role = [...roles].sort((left, right) => right[1] - left[1])[0]?.[0] || '';
  return { role, usability: caution, count: records.length };
};

/** 计数与来源站点一致：维度按含该维度标签的条目数，其余按条目数。 */
export const collectArtistReferenceFacets = (entries: ArtistReferenceEntry[] = []) => {
  const tags = new Map<string, number>(), roles = new Map<string, number>(), testers = new Map<string, number>();
  const usability = new Map<string, number>(), fidelity = new Map<string, number>();
  const add = (map: Map<string, number>, value: string) => { if (value) map.set(value, (map.get(value) || 0) + 1); };
  for (const entry of entries) {
    entry.tags.forEach(tag => add(tags, tag)); entry.roles.forEach(role => add(roles, role));
    add(testers, entry.tester); add(usability, entry.usability); add(fidelity, entry.fidelity);
  }
  const byCount = (left: [string, number], right: [string, number]) => right[1] - left[1] || left[0].localeCompare(right[0]);
  const dimensions = ARTIST_REFERENCE_DIMENSIONS.map(dimension => ({
    dimension, entries: entries.filter(entry => entry.tags.some(tag => tag.startsWith(`${dimension}-`))).length,
    tags: [...tags].filter(([tag]) => tag.startsWith(`${dimension}-`)).sort(byCount),
  })).filter(group => group.tags.length);
  const other = [...tags].filter(([tag]) => !ARTIST_REFERENCE_DIMENSIONS.some(dimension => tag.startsWith(`${dimension}-`))).sort(byCount);
  return {
    dimensions: other.length ? [...dimensions, { dimension: '', entries: entries.filter(entry => entry.tags.some(tag => other.some(([value]) => value === tag))).length, tags: other }] : dimensions,
    roles: [...roles].sort(byCount), testers: [...testers].sort(byCount),
    usability: ARTIST_REFERENCE_USABILITY.map(value => [value, usability.get(value) || 0] as const),
    fidelity: ARTIST_REFERENCE_FIDELITY.map(value => [value, fidelity.get(value) || 0] as const),
  };
};
