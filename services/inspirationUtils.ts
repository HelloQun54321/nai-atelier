import { Inspiration, InspirationSourceType } from '../types';

const KEYWORDS = [
  'portrait', 'landscape', 'close-up', 'full body', 'dynamic angle', 'cinematic lighting',
  'rim lighting', 'backlighting', 'soft lighting', 'dramatic shadows', 'bokeh', 'depth of field',
  'photorealistic', 'realistic', 'oil painting', 'watercolor', 'sketch', 'monochrome', 'anime',
];

export const normalizeInspirationTags = (tags: string[]) => Array.from(new Set(
  tags.map(tag => tag.trim().replace(/^#/, '')).filter(Boolean)
)).slice(0, 80);

export const sourceLabel = (source?: InspirationSourceType) => ({
  history: '生成历史', aitag: 'AITag', danbooru: 'Danbooru', pixiv: 'Pixiv', upload: '手动上传', agent: '项目 Agent', other: '其他来源',
}[source || 'other']);

export const suggestInspirationTags = (item: Pick<Inspiration, 'prompt' | 'params' | 'sourceType' | 'tags'>) => {
  const prompt = String(item.prompt || '').toLowerCase();
  const artists = Array.from(prompt.matchAll(/artist:([^,\n:]+)/g)).map(match => `画师:${match[1].trim()}`);
  const keywords = KEYWORDS.filter(keyword => prompt.includes(keyword));
  const width = Number(item.params?.width || 0);
  const height = Number(item.params?.height || 0);
  const orientation = width && height ? (width > height ? '横图' : width < height ? '竖图' : '方图') : '';
  const source = item.sourceType ? sourceLabel(item.sourceType) : '';
  return normalizeInspirationTags([...(item.tags || []), source, orientation, ...artists.slice(0, 8), ...keywords.slice(0, 8)]);
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
