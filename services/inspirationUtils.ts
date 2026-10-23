import { Inspiration, InspirationSourceType } from '../types';
import type { MediaPreviewTransform } from './mobileImageCache';

/** 收藏已保存原件后仍按来源快照识别图包预览，不依赖图包继续安装。 */
export const getCollectionPreviewTransform = (item: Pick<Inspiration, 'sourceType' | 'analysis'>): MediaPreviewTransform | undefined => {
  if (item.sourceType !== 'artist') return undefined;
  const sample = item.analysis?.artistSample;
  if (sample && typeof sample === 'object' && 'ownSampleId' in sample) return undefined;
  const isPackSample = (value: unknown) => {
    if (!value || typeof value !== 'object') return false;
    const data = value as Record<string, unknown>;
    return (data.pack === 'v45' || data.pack === 'v5') && typeof data.tag === 'string' && Boolean(data.tag.trim()) && data.tag.length <= 4096 &&
      typeof data.revision === 'string' && /^[a-f0-9]{24}$/.test(data.revision) && Number.isSafeInteger(data.index) && Number(data.index) >= 0 && Number(data.index) <= 999999;
  };
  if (isPackSample(sample)) return 'artist-sample-padding-v2';
  const original = item.analysis?.collectionOriginalUrl;
  if (typeof original !== 'string' || !original.startsWith('/api/artist-samples/image?')) return undefined;
  const url = new URL(original, 'http://collection.local'), params = url.searchParams;
  const keys = ['pack', 'tag', 'index', 'revision'];
  if (url.hash || [...params.keys()].some(key => !keys.includes(key)) || keys.some(key => params.getAll(key).length !== 1)) return undefined;
  return isPackSample({ pack: params.get('pack'), tag: params.get('tag'), revision: params.get('revision'), index: /^\d+$/.test(params.get('index') || '') ? Number(params.get('index')) : undefined })
    ? 'artist-sample-padding-v2' : undefined;
};

const KEYWORDS = [
  'portrait', 'landscape', 'close-up', 'full body', 'dynamic angle', 'cinematic lighting',
  'rim lighting', 'backlighting', 'soft lighting', 'dramatic shadows', 'bokeh', 'depth of field',
  'photorealistic', 'realistic', 'oil painting', 'watercolor', 'sketch', 'monochrome', 'anime',
];

export const normalizeInspirationTags = (tags: string[]) => Array.from(new Set(
  tags.map(tag => tag.trim().replace(/^#/, '')).filter(Boolean)
)).slice(0, 80);

// 独立标签目录不受单张图片的 80 个标签上限约束。
export const normalizeCollectionTagNames = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim().replace(/^#/, '')).filter(Boolean))] : [];

export const COLLECTION_SORT_LABELS = { newest: '最新收藏', oldest: '最早收藏', name: '名称 A → Z', nameDesc: '名称 Z → A' } as const;
export type CollectionSort = keyof typeof COLLECTION_SORT_LABELS;

export const sortCollectionGroups = (groups: Inspiration[][], sort: CollectionSort): Inspiration[][] => {
  const time = (group: Inspiration[]) => Math.max(...group.map(item => item.createdAt));
  return [...groups].sort((a, b) => {
    const order = sort === 'name' || sort === 'nameDesc'
      ? a[0].title.replace(/ · \d+$/, '').localeCompare(b[0].title.replace(/ · \d+$/, ''), undefined, { numeric: true }) * (sort === 'nameDesc' ? -1 : 1)
      : (time(a) - time(b)) * (sort === 'newest' ? -1 : 1);
    return order || collectionGroupKey(a[0]).localeCompare(collectionGroupKey(b[0]));
  });
};

const RECENT_FOLDERS_KEY = 'nai-collection-recent-folders';
export const getRecentCollectionFolders = (): string[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_FOLDERS_KEY) || '[]');
    return Array.isArray(value) ? Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id)))).slice(0, 5) : [];
  } catch { return []; }
};
export const rememberCollectionFolder = (id?: string) => {
  if (!id) return;
  try { localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify([id, ...getRecentCollectionFolders().filter(previous => previous !== id)].slice(0, 5))); }
  catch { /* 浏览器偏好不可写不影响收藏保存。 */ }
};

export const sourceLabel = (source?: InspirationSourceType) => ({
  history: '生成历史', aitag: 'AITag', danbooru: 'Danbooru', pixiv: 'Pixiv', codex: '法典书目', 'codex-community': '共创广场', upload: '手动上传', agent: '创作助手', artist: '画师库', character: '角色库', chain: '风格预设', other: '其他来源',
}[source || 'other'] || '其他来源');

// 旧版自动来源 Tag 只在读取时隐藏，来源字段与私人存储保持原样。
export const getCollectionTags = (item: Pick<Inspiration, 'tags' | 'sourceType'>) =>
  normalizeInspirationTags(item.tags || []).filter(tag => tag !== sourceLabel(item.sourceType));

export const collectionGroupKey = (item: Inspiration) => JSON.stringify(
  item.sourceId && ['aitag', 'pixiv', 'codex', 'codex-community'].includes(item.sourceType || '')
    ? [item.userId, item.sourceType, item.sourceId] : ['image', item.id]
);

export const groupCollectionItems = (items: Inspiration[]): Inspiration[][] => {
  const groups = new Map<string, Inspiration[]>();
  for (const item of items) {
    const key = collectionGroupKey(item);
    const group = groups.get(key);
    if (group) group.push(item); else groups.set(key, [item]);
  }
  return Array.from(groups.values(), group => group.sort((a, b) =>
    String(a.analysis?.externalSourcePage ?? a.analysis?.collectionImageId ?? a.imageUrl).localeCompare(
      String(b.analysis?.externalSourcePage ?? b.analysis?.collectionImageId ?? b.imageUrl), undefined, { numeric: true }
    )
  ));
};

export const suggestInspirationTags = (item: Pick<Inspiration, 'prompt' | 'params' | 'sourceType' | 'tags'>) => {
  const prompt = String(item.prompt || '').toLowerCase();
  const artists = Array.from(prompt.matchAll(/artist:([^,\n:]+)/g)).map(match => `画师:${match[1].trim()}`);
  const keywords = KEYWORDS.filter(keyword => prompt.includes(keyword));
  const width = Number(item.params?.width || 0);
  const height = Number(item.params?.height || 0);
  const orientation = width && height ? (width > height ? '横图' : width < height ? '竖图' : '方图') : '';
  return normalizeInspirationTags([...getCollectionTags(item), orientation, ...artists.slice(0, 8), ...keywords.slice(0, 8)]);
};

const tokenSet = (value: string) => new Set(value.toLowerCase().split(/[,\s:(){}\[\]]+/).map(token => token.trim()).filter(token => token.length > 2));

export const inspirationSimilarity = (a: Inspiration, b: Inspiration) => {
  const tagsA = new Set(a.tags || []);
  const tagsB = new Set(b.tags || []);
  let score = 0;
  tagsA.forEach(tag => { if (tagsB.has(tag)) score += 4; });
  const promptA = tokenSet(a.prompt || '');
  const promptB = tokenSet(b.prompt || '');
  promptA.forEach(token => { if (promptB.has(token)) score += 1; });
  if (a.sourceType && a.sourceType === b.sourceType) score += 1;
  return score;
};
