import { expect, it } from 'vitest';
import type { Inspiration, PromptChain } from '../../types';
import { collectionChainPartition, collectionSource, getCollectionChainFolders } from '../../services/inspirationUtils';
const favorite = (id: string, params = {}, sourceType = 'chain') => ({ id, sourceId: id, sourceType, params, createdAt: 1 } as Inspiration);
const chain = (id: string, partition: { id: string; name: string }) => ({ id, params: { _chainPartition: partition } } as PromptChain);

it('法典书目与广场归同一自动入口，其他来源仍保持独立', () => {
  expect(collectionSource('codex')).toBe('codex'); expect(collectionSource('codex-community')).toBe('codex');
  expect(collectionSource('chain')).toBe('chain'); expect(collectionSource('aitag')).toBe('aitag');
});
it('已有与新分区仅在有收藏时出现，不写收藏夹或改动旧资料', () => {
  const partition = { id: 'a'.repeat(64), name: '包 A' }, second = { id: 'b'.repeat(64), name: '包 B' };
  const chains = [chain('a', partition), chain('b', second)], items = [favorite('own'), favorite('a')];
  const before = JSON.stringify({ chains, items });
  expect(getCollectionChainFolders(items, chains)).toEqual([{ id: 'own', name: '我的风格串', count: 1 }, { ...partition, count: 1 }]);
  expect(getCollectionChainFolders([...items, favorite('b')], chains)).toContainEqual({ ...second, count: 1 });
  expect(JSON.stringify({ chains, items })).toBe(before);
});
it('原串删除后使用收藏参数快照，同名不同包不合并，归档及角色来源不入串收藏夹', () => {
  const a = { id: 'a'.repeat(64), name: '合集' }, b = { id: 'b'.repeat(64), name: '合集' };
  const items = [favorite('a', { _styleBundleImport: a }), favorite('b', { _chainPartition: b }), { ...favorite('archived'), archived: true }, favorite('character', {}, 'character')];
  const folders = getCollectionChainFolders(items, []);
  expect(folders.map(folder => folder.name)).toEqual(['合集', '合集 (2)']);
  expect(folders.map(folder => folder.count)).toEqual([1, 1]);
  expect(collectionChainPartition(items[0], new Map())).toBe(a.id);
});
