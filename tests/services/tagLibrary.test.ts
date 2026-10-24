import { expect, it } from 'vitest';
import { compareLibraryTags, parseArtistSearchTerms, matchesArtistSearch } from '../../services/tagLibrary';
import { compareArtistUsage, type ArtistUsageIndex } from '../../services/artistUsage';

const artists = [
  { name: 'unknown b', chinese: '', postCount: 0, postCountKnown: false },
  { name: 'popular', chinese: '', postCount: 12 },
  { name: 'zero', chinese: '', postCount: 0 },
  { name: 'unknown a', chinese: '', postCount: 0, postCountKnown: false },
];

it('画师搜索支持中英文逗号并去除空项与规范化重复项，不拆名字内空格', () => {
  expect(parseArtistSearchTerms('  Foo_Bar ,，foo bar, 中文 ， ,MIZU(test), mizu (test) '))
    .toEqual(['foo bar', '中文', 'mizu (test)']);
  expect(parseArtistSearchTerms('  , ， \t ')).toEqual([]);
});

it('多个搜索项为OR模糊匹配，兼容大小写下划线中文与括号前空格', () => {
  const terms = parseArtistSearchTerms('不存在，FOO_BAR, 小水, MIZU(test)');
  expect(matchesArtistSearch({ name: 'prefix Foo Bar suffix' }, terms)).toBe(true);
  expect(matchesArtistSearch({ name: 'other', chinese: '画师小水老师' }, terms)).toBe(true);
  expect(matchesArtistSearch({ name: 'mizu_(test)' }, terms)).toBe(true);
  expect(matchesArtistSearch({ name: 'neither', chinese: '无命中' }, terms)).toBe(false);
  expect(matchesArtistSearch({ name: 'anything' }, [])).toBe(true);
});

it('多个命中只返回原条目一次，归一化冲突名字仍保留独立身份', () => {
  const entries = [{ name: 'foo_bar', chinese: '小水' }, { name: 'foo bar', chinese: '' }, { name: 'other' }];
  const selected = entries.filter(entry => matchesArtistSearch(entry, parseArtistSearchTerms('foo,bar,小水,foo')));
  expect(selected).toEqual(entries.slice(0, 2));
  expect(selected[0]).toBe(entries[0]);
  expect(selected[1]).toBe(entries[1]);
});

it.each([
  ['popular', ['popular', 'zero', 'unknown a', 'unknown b']],
  ['least', ['zero', 'popular', 'unknown a', 'unknown b']],
  ['name-asc', ['popular', 'unknown a', 'unknown b', 'zero']],
  ['name-desc', ['zero', 'unknown b', 'unknown a', 'popular']],
] as const)('%s 不把图包未知热度冒充真实零值，名称排序仍覆盖全部条目', (sort, expected) => {
  expect([...artists].sort((left, right) => compareLibraryTags(left, right, sort)).map(entry => entry.name)).toEqual(expected);
});

it('收录数优先于热度，数量相同时未知热度仍排在已知条目后', () => {
  const usage: ArtistUsageIndex = { byTag: new Map([['unknown b', { chains: 2, images: 0, lastAt: 0 }]]), indexed: 1, total: 1 };
  expect([...artists].sort((left, right) => compareArtistUsage(left, right, 'usage-chains', usage)).map(entry => entry.name))
    .toEqual(['unknown b', 'popular', 'zero', 'unknown a']);
});
