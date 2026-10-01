import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildDanbooruFilterQuery, resolveDanbooruQuery } from './danbooruService';
import { countDanbooruQueryTerms, DANBOORU_RATIO_QUERIES, matchesDanbooruImageFilters, parseDanbooruExploreQuery, validateDanbooruQuery } from './danbooruQuery';
import { searchTagDictionary } from './tagDictionary';

vi.mock('./tagDictionary', () => ({ normalizeTagQuery: (value: string) => value.toLowerCase(), searchTagDictionary: vi.fn().mockResolvedValue([]) }));
afterEach(() => vi.clearAllMocks());

describe('buildDanbooruFilterQuery', () => {
  it('defaults to order:rank when query and sort are empty', () => {
    expect(buildDanbooruFilterQuery()).toBe('order:rank');
    expect(buildDanbooruFilterQuery({ query: '' })).toBe('order:rank');
  });

  it('keeps raw query when provided', () => {
    expect(buildDanbooruFilterQuery({ query: 'hatsune_miku' })).toBe('hatsune_miku');
  });

  it('combines sort options correctly', () => {
    expect(buildDanbooruFilterQuery({ query: 'hatsune_miku', sort: 'score' })).toBe('hatsune_miku order:score');
    expect(buildDanbooruFilterQuery({ query: 'hatsune_miku', sort: 'favcount' })).toBe('hatsune_miku order:favcount');
    expect(buildDanbooruFilterQuery({ query: 'hatsune_miku', sort: 'latest' })).toBe('hatsune_miku order:id_desc');
    expect(buildDanbooruFilterQuery({ sort: 'score' })).toBe('explore:popular_month');
    expect(buildDanbooruFilterQuery({ sort: 'favcount' })).toBe('explore:popular_week');
  });

  it('评级和画幅不占匿名名额，solo 没有名额时留给本地筛选', () => {
    expect(buildDanbooruFilterQuery({
      query: 'frieren',
      sort: 'score',
      rating: 's',
      ratio: 'portrait',
      subject: 'solo',
    })).toBe('frieren order:score rating:s ratio:<0.85');

    expect(buildDanbooruFilterQuery({
      rating: 's',
      ratio: 'portrait',
      subject: 'solo',
    })).toBe('order:rank rating:s ratio:<0.85 solo');
  });

  it('两个关键词可用默认最新检索，显式热度／评分／收藏排序提前说明官方限制', () => {
    expect(buildDanbooruFilterQuery({ query: 'frieren solo', sort: 'latest', rating: 'g', ratio: 'square' }))
      .toBe('frieren solo rating:g ratio:0.85..1.15');
    for (const sort of ['rank', 'score', 'favcount'] as const) {
      expect(() => buildDanbooruFilterQuery({ query: 'frieren solo', sort })).toThrow('选择「最新」');
    }
    expect(buildDanbooruFilterQuery({ query: 'frieren order:score', sort: 'latest' })).toBe('frieren order:id_desc');
  });

  it('覆盖四种排序与全部评级、画幅、单人组合，没有遗漏条件或超限请求', () => {
    for (const query of ['', 'frieren', 'frieren solo']) {
      for (const sort of ['rank', 'score', 'favcount', 'latest'] as const) {
        for (const rating of ['all', 'g', 's', 'q', 'e'] as const) {
          for (const ratio of ['all', 'portrait', 'landscape', 'square'] as const) {
            for (const subject of ['all', 'solo'] as const) {
              const build = () => buildDanbooruFilterQuery({ query, sort, rating, ratio, subject });
              if (query === 'frieren solo' && sort !== 'latest') { expect(build).toThrow('匿名搜索'); continue; }
              const result = build();
              const explore = parseDanbooruExploreQuery(result);
              if (rating !== 'all') expect(result).toContain(`rating:${rating}`);
              if (ratio !== 'all') expect(result).toContain(DANBOORU_RATIO_QUERIES[ratio]);
              if (explore) expect(explore.filters).toMatchObject({ ...(rating !== 'all' ? { rating } : {}), ...(ratio !== 'all' ? { ratio } : {}) });
              else expect(countDanbooruQueryTerms(result)).toBeLessThanOrEqual(2);
              expect(() => validateDanbooruQuery(result)).not.toThrow();
            }
          }
        }
      }
    }
  });

  it('不悄悄截断多关键词，英文高级条件也不走中文词典', async () => {
    await expect(resolveDanbooruQuery('frieren, solo, blue_hair')).rejects.toThrow('最多输入两个关键词');
    expect(await resolveDanbooruQuery('1girl, ratio:<0.85')).toBe('1girl ratio:<0.85');
    expect(searchTagDictionary).not.toHaveBeenCalled();
  });

  it('普通标签和排序计数，评级／画幅等免费条件不计数', () => {
    expect(countDanbooruQueryTerms('frieren order:score rating:g ratio:<0.85 width:>500')).toBe(2);
    expect(countDanbooruQueryTerms('solo solo rating:g')).toBe(1);
    expect(countDanbooruQueryTerms('score date ratio')).toBe(3);
    expect(() => validateDanbooruQuery('solo order:score order:favcount')).toThrow('一种排序');
    expect(() => validateDanbooruQuery('a'.repeat(241))).toThrow('查询过长');
  });

  it('本地与上游画幅分界一致，solo 不误认双人图', () => {
    const post = { rating: 'g', width: 850, height: 1000, tags: { general: ['1girl', '1boy'] } };
    expect(matchesDanbooruImageFilters(post, { subject: 'solo' })).toBe(false);
    expect(matchesDanbooruImageFilters({ ...post, tags: { general: ['solo'] } }, { subject: 'solo' })).toBe(true);
    for (const width of [849, 850, 1000, 1150, 1151]) {
      const candidate = { ...post, width };
      expect(matchesDanbooruImageFilters(candidate, { ratio: 'portrait' })).toBe(width < 850);
      expect(matchesDanbooruImageFilters(candidate, { ratio: 'square' })).toBe(width >= 850 && width <= 1150);
      expect(matchesDanbooruImageFilters(candidate, { ratio: 'landscape' })).toBe(width > 1150);
    }
    expect(matchesDanbooruImageFilters(post, { rating: 'e' })).toBe(false);
    expect(matchesDanbooruImageFilters({ ...post, height: 0 }, { ratio: 'portrait' })).toBe(false);
  });
});
