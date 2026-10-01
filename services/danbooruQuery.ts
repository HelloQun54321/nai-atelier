/** 与 Danbooru PostQuery::UNLIMITED_METATAGS 对齐；order 与普通 Tag 都占匿名检索名额。 */
const unlimitedMetatags = new Set([
  'status', 'rating', 'limit', 'is', 'id', 'date', 'age', 'filesize', 'filetype',
  'parent', 'child', 'md5', 'width', 'height', 'duration', 'mpixels', 'ratio',
  'score', 'upvote', 'downvotes', 'favcount', 'embedded', 'tagcount', 'pixiv_id', 'pixiv',
]);

export const DANBOORU_RATIO_QUERIES = {
  portrait: 'ratio:<0.85', landscape: 'ratio:>1.15', square: 'ratio:0.85..1.15',
} as const;

export const splitDanbooruQuery = (query: string) => query.trim().split(/\s+/).filter(Boolean);

export const countDanbooruQueryTerms = (query: string) => new Set(splitDanbooruQuery(query)
  .filter(token => !token.includes(':') || !unlimitedMetatags.has(token.replace(/^[-~]/, '').split(':')[0].toLowerCase()))).size;

export interface DanbooruImageFilters {
  rating?: 'all' | 'g' | 's' | 'q' | 'e';
  ratio?: 'all' | keyof typeof DANBOORU_RATIO_QUERIES;
  subject?: 'all' | 'solo' | '1girl' | '1boy';
}

/** 本地筛选与上游数值范围一致；1girl/1boy 并不能证明画面只有一个人。 */
export const matchesDanbooruImageFilters = (post: {
  rating: string; width: number; height: number; tags: { general: string[] };
}, filters: DanbooruImageFilters) => {
  if (filters.rating && filters.rating !== 'all' && post.rating.toLowerCase() !== filters.rating) return false;
  if (filters.ratio && filters.ratio !== 'all') {
    if (!(post.width > 0 && post.height > 0)) return false;
    const ratio = post.width / post.height;
    if (filters.ratio === 'portrait' && ratio >= 0.85) return false;
    if (filters.ratio === 'landscape' && ratio <= 1.15) return false;
    if (filters.ratio === 'square' && (ratio < 0.85 || ratio > 1.15)) return false;
  }
  return !filters.subject || filters.subject === 'all' || post.tags.general.includes(filters.subject);
};

/** 排行榜接口不接受 tags，只有这些本地筛选可附在内部排行榜标记之后。 */
export const parseDanbooruExploreQuery = (query: string) => {
  const [marker, ...tokens] = splitDanbooruQuery(query);
  const scale = /^explore:popular_(day|week|month)$/.exec(marker || '')?.[1];
  if (!scale) return null;
  const filters: DanbooruImageFilters = {};
  for (const token of tokens) {
    if (/^rating:[gsqe]$/.test(token)) filters.rating = token.slice(7) as DanbooruImageFilters['rating'];
    else if (token === 'solo' || token === '1girl' || token === '1boy') filters.subject = token;
    else {
      const ratio = (Object.keys(DANBOORU_RATIO_QUERIES) as Array<keyof typeof DANBOORU_RATIO_QUERIES>)
        .find(key => DANBOORU_RATIO_QUERIES[key] === token);
      if (!ratio) throw new Error('Danbooru 排行榜包含不支持的筛选条件');
      filters.ratio = ratio;
    }
  }
  return { scale, filters };
};

export const validateDanbooruQuery = (query: string) => {
  if (query.length > 240) throw new Error('Danbooru 查询过长，请缩短检索条件');
  const tokens = splitDanbooruQuery(query);
  if (tokens.some(token => !/^[\p{L}\p{N}_:.()'!+\-/<>=~*]+$/u.test(token))) {
    throw new Error('Danbooru 查询中包含不支持的字符');
  }
  if (parseDanbooruExploreQuery(query)) return;
  if (tokens.some(token => token.startsWith('explore:'))) throw new Error('不支持的 Danbooru 排行榜');
  if (new Set(tokens.filter(token => token.startsWith('order:'))).size > 1) {
    throw new Error('Danbooru 一次只能使用一种排序');
  }
  if (countDanbooruQueryTerms(query) > 2) {
    throw new Error('Danbooru 匿名搜索最多支持两个检索条件；热度、评分和收藏排序占一个条件，请减少关键词或选择「最新」');
  }
};
