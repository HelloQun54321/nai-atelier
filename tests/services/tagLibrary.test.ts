import { expect, it } from 'vitest';
import { compareLibraryTags } from '../../services/tagLibrary';
import { compareArtistUsage, type ArtistUsageIndex } from '../../services/artistUsage';

const artists = [
  { name: 'unknown b', chinese: '', postCount: 0, postCountKnown: false },
  { name: 'popular', chinese: '', postCount: 12 },
  { name: 'zero', chinese: '', postCount: 0 },
  { name: 'unknown a', chinese: '', postCount: 0, postCountKnown: false },
];

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
