import { expect, it } from 'vitest';
import type { PromptChain } from '../../types';
import { createCombinationData } from '../../services/promptLibraryEntries';
import { promptLibraryCategoryCounts, promptLibraryCategoryUpdates } from '../../services/promptLibraryCategories';

it('空分类参与名单，统计及标签替换仅作用于组合并保留其他标签', () => {
  const data = createCombinationData('组合', { scene: { kind: 'scene', text: 'night', filled: true } });
  const combo = { ...data, id: 'combo', tags: ['旧分类', '目标', '__internal__'] } as PromptChain;
  const fragment = { id: 'fragment', type: 'scene', tags: ['旧分类'] } as PromptChain;
  expect(promptLibraryCategoryCounts([combo, fragment], ['空分类'])).toEqual(expect.arrayContaining([['空分类', 0], ['旧分类', 1], ['目标', 1]]));
  expect(promptLibraryCategoryCounts([combo, fragment])).not.toEqual(expect.arrayContaining([['__internal__', 1]]));
  expect(promptLibraryCategoryUpdates([combo, fragment], '旧分类', '目标')).toEqual([{ id: 'combo', tags: ['目标', '__internal__'] }]);
  expect(combo.tags).toEqual(['旧分类', '目标', '__internal__']);
});
