// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_ARTIST_REFERENCE_FILTER, collectArtistReferenceFacets, getArtistReferenceStatus, countArtistReferenceFilter, groupArtistReference, isArtistReferenceFilterActive,
  matchArtistReferenceEntries, matchesArtistReferenceFilter, summarizeArtistReference, type ArtistReferenceEntry,
} from '../../services/artistReference';

const record = (id: string, tag: string, extra: Partial<ArtistReferenceEntry> = {}): ArtistReferenceEntry => ({
  id, tag, artist: tag, testedPrompt: `artist:${tag}`, tester: '合成测试者', danbooruTag: tag, danbooruPosts: 12, look: '', danbooruLook: '',
  fidelity: '未知', usability: '可用', tags: [], roles: [], note: '', model: 'novelai-v5-full', evidenceNote: '', effects: [], biases: [], assessment: 'inferred',
  images: [{ full: `images/${id}.webp`, thumb: `thumbs/${id}.webp` }], ...extra,
});
const records = [
  record('a1', 'alpha_artist', { tags: ['涂-厚涂', '光-强明暗'], roles: ['主'] }),
  record('b1', 'Beta Artist', { tags: ['涂-厚涂'], roles: ['副'], usability: '稳定' }),
  record('b2', 'beta_artist', { tags: ['涂-平涂'], roles: ['附加-背景'], usability: '慎用' }),
  record('c1', 'only_in_reference', { tags: ['风-萌系'], roles: [], usability: '待验证', danbooruPosts: null }),
];

afterEach(() => { vi.unstubAllGlobals(); });

describe('画师组串参考', () => {
  it('不认识的状态响应按不可用处理，不把残缺数据交给页面', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(getArtistReferenceStatus()).rejects.toThrow('画师组串参考仅支持电脑端及局域网访问');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    await expect(getArtistReferenceStatus()).rejects.toThrow('画师组串参考仅支持电脑端及局域网访问');
    const valid = { available: true, canManage: false, phase: 'missing', version: '', revision: 0, updatedAt: '', fetchedAt: 0, count: 0, artistCount: 0, thumbnails: { cached: 0, total: 0 }, sync: { stage: 'idle', done: 0, total: 0, failed: 0, error: '' } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(valid), { status: 200 })));
    await expect(getArtistReferenceStatus()).resolves.toEqual(valid);
  });


  it('按图包同一归一规则归组，词库缺少的已测画师补成目录项', () => {
    const groups = groupArtistReference(records);
    expect([...groups.keys()]).toEqual(['alpha artist', 'beta artist', 'only in reference']);
    expect(groups.get('beta artist')?.map(item => item.id)).toEqual(['b1', 'b2']);
    const matched = matchArtistReferenceEntries([{ name: 'alpha artist', chinese: '画师甲', postCount: 30 }, { name: 'beta artist', chinese: '', postCount: 20 }, { name: 'unrelated', chinese: '', postCount: 1 }], groups);
    expect(matched).toEqual([
      { name: 'alpha artist', chinese: '画师甲', postCount: 30 },
      { name: 'beta artist', chinese: '', postCount: 20 },
      { name: 'only_in_reference', chinese: '', postCount: 0, postCountKnown: false },
    ]);
  });

  it('风格标签要求同一条记录同时包含，定位与可用性任一命中即可', () => {
    const groups = groupArtistReference(records);
    const beta = groups.get('beta artist');
    expect(matchesArtistReferenceFilter(beta, { ...EMPTY_ARTIST_REFERENCE_FILTER, tags: ['涂-厚涂'] })).toBe(true);
    expect(matchesArtistReferenceFilter(beta, { ...EMPTY_ARTIST_REFERENCE_FILTER, tags: ['涂-厚涂', '涂-平涂'] })).toBe(false);
    expect(matchesArtistReferenceFilter(beta, { ...EMPTY_ARTIST_REFERENCE_FILTER, roles: ['主', '附加-背景'] })).toBe(true);
    expect(matchesArtistReferenceFilter(beta, { ...EMPTY_ARTIST_REFERENCE_FILTER, tags: ['涂-厚涂'], usability: ['慎用'] })).toBe(false);
    expect(matchesArtistReferenceFilter(groups.get('alpha artist'), { ...EMPTY_ARTIST_REFERENCE_FILTER, tags: ['涂-厚涂', '光-强明暗'], usability: ['可用', '稳定'] })).toBe(true);
    expect(matchesArtistReferenceFilter(undefined, EMPTY_ARTIST_REFERENCE_FILTER)).toBe(true);
    expect(matchesArtistReferenceFilter(undefined, { ...EMPTY_ARTIST_REFERENCE_FILTER, only: true })).toBe(false);
    expect(matchesArtistReferenceFilter(beta, { ...EMPTY_ARTIST_REFERENCE_FILTER, only: true })).toBe(true);
    expect(isArtistReferenceFilterActive(EMPTY_ARTIST_REFERENCE_FILTER)).toBe(false);
    expect(countArtistReferenceFilter({ only: true, dimension: '涂', tags: ['a', 'b'], roles: ['主'], usability: ['稳定'], fidelity: ['高', '中'], testers: ['x'] })).toBe(9);
    expect(isArtistReferenceFilterActive({ ...EMPTY_ARTIST_REFERENCE_FILTER, testers: ['合成测试者'] })).toBe(true);
  });

  it('按风格探索选中维度后只保留含该维度标签的记录，还原度与测试者按所选任一命中', () => {
    const groups = groupArtistReference(records);
    const beta = groups.get('beta artist');
    expect(matchesArtistReferenceFilter(groups.get('alpha artist'), { ...EMPTY_ARTIST_REFERENCE_FILTER, dimension: '光' })).toBe(true);
    expect(matchesArtistReferenceFilter(beta, { ...EMPTY_ARTIST_REFERENCE_FILTER, dimension: '光' })).toBe(false);
    // 维度与标签同样要求出自同一条记录。
    expect(matchesArtistReferenceFilter(beta, { ...EMPTY_ARTIST_REFERENCE_FILTER, dimension: '涂', usability: ['慎用'] })).toBe(true);
    const mixed = [record('m1', 'mixed', { fidelity: '高', tester: '甲' }), record('m2', 'mixed', { fidelity: '低', tester: '乙' })];
    expect(matchesArtistReferenceFilter(mixed, { ...EMPTY_ARTIST_REFERENCE_FILTER, fidelity: ['高', '中'] })).toBe(true);
    expect(matchesArtistReferenceFilter(mixed, { ...EMPTY_ARTIST_REFERENCE_FILTER, fidelity: ['高'], testers: ['乙'] })).toBe(false);
    expect(matchesArtistReferenceFilter(mixed, { ...EMPTY_ARTIST_REFERENCE_FILTER, testers: ['乙', '丙'] })).toBe(true);
  });

  it('卡片摘要显示最谨慎的结论与记录数，不把分歧说成稳定', () => {
    expect(summarizeArtistReference(groupArtistReference(records).get('beta artist')!)).toEqual({ role: '副', usability: '慎用', count: 2 });
    expect(summarizeArtistReference([record('x', 'x', { usability: '稳定', roles: ['主'] }), record('y', 'x', { usability: '待验证', roles: ['主'] })])).toEqual({ role: '主', usability: '待验证', count: 2 });
    expect(summarizeArtistReference([records[3]])).toEqual({ role: '', usability: '待验证', count: 1 });
  });

  it('筛选项按来源站点「按风格探索」的维度顺序分组，维度计数为含该维度标签的条目数', () => {
    const facets = collectArtistReferenceFacets([...records, record('d1', 'delta', { tags: ['涂-厚涂', '涂-平涂', '自定义'], roles: ['主'], fidelity: '高', tester: '另一位测试者' })]);
    expect(facets.dimensions.map(group => group.dimension)).toEqual(['涂', '风', '光', '']);
    // delta 同时有两个「涂」标签，维度只按条目计一次。
    expect(facets.dimensions[0]).toEqual({ dimension: '涂', entries: 4, tags: [['涂-厚涂', 3], ['涂-平涂', 2]] });
    expect(facets.dimensions.at(-1)).toEqual({ dimension: '', entries: 1, tags: [['自定义', 1]] });
    expect(facets.roles[0]).toEqual(['主', 2]);
    expect(facets.testers).toEqual([['合成测试者', 4], ['另一位测试者', 1]]);
    expect(facets.usability).toEqual([['稳定', 1], ['可用', 2], ['慎用', 1], ['失效', 0], ['待验证', 1]]);
    expect(facets.fidelity).toEqual([['高', 1], ['中', 0], ['低', 0], ['未知', 4]]);
  });
});
