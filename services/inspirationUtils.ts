import { Inspiration, InspirationSourceType } from '../types';

const KEYWORDS = [
  'portrait', 'landscape', 'close-up', 'full body', 'dynamic angle', 'cinematic lighting',
  'rim lighting', 'backlighting', 'soft lighting', 'dramatic shadows', 'bokeh', 'depth of field',
  'photorealistic', 'realistic', 'oil painting', 'watercolor', 'sketch', 'monochrome', 'anime',
];

export const normalizeInspirationTags = (tags: string[]) => Array.from(new Set(
  tags.map(tag => tag.trim().replace(/^#/, '')).filter(Boolean)
)).slice(0, 80);

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
  history: '生成历史', aitag: 'AITag', danbooru: 'Danbooru', pixiv: 'Pixiv', upload: '手动上传', agent: '创作助手', artist: '画师库', character: '角色库', chain: '风格预设', other: '其他来源',
}[source || 'other'] || '其他来源');

// 旧版自动来源 Tag 只在读取时隐藏，来源字段与私人存储保持原样。
export const getCollectionTags = (item: Pick<Inspiration, 'tags' | 'sourceType'>) =>
  normalizeInspirationTags(item.tags || []).filter(tag => tag !== sourceLabel(item.sourceType));

export const collectionGroupKey = (item: Inspiration) => JSON.stringify(
  item.sourceId && (item.sourceType === 'aitag' || item.sourceType === 'pixiv')
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
    String(a.analysis?.collectionImageId ?? a.analysis?.externalSourcePage ?? a.imageUrl).localeCompare(
      String(b.analysis?.collectionImageId ?? b.analysis?.externalSourcePage ?? b.imageUrl), undefined, { numeric: true }
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
