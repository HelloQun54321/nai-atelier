import { expect, it } from 'vitest';
import { getBundlePartitions, getChainPartition, hasLegacyChainPartition, LEGACY_BUNDLE_PARTITION, OWN_CHAIN_PARTITION } from '../../services/chainPartitions';
import type { PromptChain } from '../../types';

const chain = (id: string, partition?: { id: string; name: string }) => ({ id, params: { _styleBundleImport: partition } } as PromptChain);
it('同包归同区，同名不同包不合并，旧包只读推断且不按来源声明误分个人内容', () => {
  const own = chain('own'), a = chain('1', { id: 'a'.repeat(64), name: '合集' }), b = chain('2', { id: 'b'.repeat(64), name: '合集' });
  expect(getChainPartition(own)).toBe(OWN_CHAIN_PARTITION);
  expect(getChainPartition(chain('naia-' + 'c'.repeat(64)))).toBe(LEGACY_BUNDLE_PARTITION);
  expect(getChainPartition(chain('own', { id: 'bad', name: '错误' }))).toBe(OWN_CHAIN_PARTITION);
  expect(getBundlePartitions([a, b, a, own])).toEqual([{ id: 'a'.repeat(64), name: '合集' }, { id: 'b'.repeat(64), name: '合集 (2)' }]);
  expect(getBundlePartitions([b, a])).toEqual(getBundlePartitions([a, b]));
});
it('主动转移优先于原包归属，最后一条转出后仍保留原分区，并支持原 ID 转回', () => {
  const imported = chain('naia-' + 'a'.repeat(64), { id: 'b'.repeat(64), name: '原包' });
  imported.params._chainPartition = { id: OWN_CHAIN_PARTITION, name: '我的风格串' };
  expect(getChainPartition(imported)).toBe(OWN_CHAIN_PARTITION);
  expect(getBundlePartitions([imported])).toEqual([{ id: 'b'.repeat(64), name: '原包' }]);
  expect(hasLegacyChainPartition([imported])).toBe(true);
  imported.params._chainPartition = { id: 'c'.repeat(64), name: '目标包' };
  expect(getChainPartition(imported)).toBe('c'.repeat(64));
  expect(getBundlePartitions([imported]).map(item => item.name)).toEqual(['原包', '目标包']);
  imported.params._chainPartition = { id: 'b'.repeat(64), name: '原包' };
  expect(getChainPartition(imported)).toBe('b'.repeat(64));
});
