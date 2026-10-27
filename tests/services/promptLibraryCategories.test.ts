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

it('传树时父类统计含任意深度后代且父子多归属按组合ID去重，默认仍是直接归属', () => {
  const data = createCombinationData('组合', { scene: { kind: 'scene', text: 'night', filled: true } });
  const chains = [{ ...data, id: 'a', tags: ['父类', '子类'] }, { ...data, id: 'b', tags: ['孙类'] }] as PromptChain[];
  const tree = { revision: 1, nodes: [{ id: '父类', name: '父类', parentId: null }, { id: '子类', name: '子类', parentId: '父类' }, { id: '孙类', name: '孙类', parentId: '子类' }, { id: '空类', name: '空类', parentId: null }] };
  expect(new Map(promptLibraryCategoryCounts(chains, [], tree))).toEqual(new Map([['父类', 2], ['子类', 2], ['孙类', 1], ['空类', 0]]));
  expect(new Map(promptLibraryCategoryCounts(chains)).get('父类')).toBe(1);
});
