import { expect, it } from 'vitest';
import type { PromptChain } from '../../types';
import { extractArtistParticipation, normalizeArtistUsageKey } from '../../services/artistParticipation';
import { extractRollChainArtistTags } from '../../services/styleRollChainArtists';

const chainOf = (basePrompt: string): PromptChain => ({
  id: 'synthetic-style', userId: 'synthetic-user', type: 'style', name: '合成风格串',
  description: '', tags: [], createdAt: 1, updatedAt: 1, basePrompt, negativePrompt: '', modules: [], variableValues: { subject: '' },
  params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' },
});

it('显式画师与词库已知裸名混合提取，返回名字而非权重或普通词', () => {
  const chain = chainOf('1.4::artist:Alpha_Name ::, Artists: {[alpha name], beta artist}, bare_artist, by other_artist, @known, solo, unknown name, by unknown, @unknown');
  expect(extractRollChainArtistTags(chain, new Set(['BARE_ARTIST', 'other artist', 'known'].map(normalizeArtistUsageKey))))
    .toEqual(['alpha name', 'beta artist', 'bare artist', 'other artist', 'known']);
});

it('排除数值零负权重及范围内抑制词，正向再出现仍可导入，不改变参与统计语义', () => {
  const text = '-1::artist:gamma, artist:delta::, 0::artist:zero::, (artist:paren:-0.5), by bare:-1, @known:0, artist:gamma, [artist:soft], 1.2::artist:positive';
  expect(extractRollChainArtistTags(chainOf(text), new Set(['bare', 'known'])))
    .toEqual(['gamma', 'soft', 'positive']);
  expect(extractArtistParticipation('-1::artist:gamma::')).toEqual(['gamma']);
});

it('大小写下划线全角与转义括号归一去重，保持首次出现顺序', () => {
  const chain = chainOf('Ａｒｔｉｓｔ：Ａlpha_Name\\(style\\), alpha_name(style), by ＢＥＴＡ＿ＮＡＭＥ, Artists: {alpha name (style), beta_name}');
  expect(extractRollChainArtistTags(chain, new Set(['alpha name (style)', 'beta name'])))
    .toEqual(['alpha name (style)', 'beta name']);
});

it('编译主体、启用模块与多角色正向，忽略负面和停用内容且不修改原串', () => {
  const chain = chainOf('artist:base');
  chain.variableValues = { subject: 'artist:subject' };
  chain.modules = [
    { id: 'on', name: '启用', content: 'artist:module', isActive: true },
    { id: 'off', name: '停用', content: 'artist:disabled-module', isActive: false },
  ];
  chain.negativePrompt = 'artist:negative';
  chain.params.characters = [
    { id: 'one', prompt: 'artist:role-one', negativePrompt: 'artist:role-negative', x: 0.5, y: 0.5 },
    { id: 'two', prompt: '', sections: { appearance: 'artist:role-two', pose: 'artist:base' }, sectionNegatives: { appearance: 'artist:section-negative' }, x: 0.5, y: 0.5 },
    { id: 'off', prompt: 'artist:disabled-role', enabled: false, x: 0.5, y: 0.5 },
  ];
  const before = structuredClone(chain), known = new Set<string>();
  expect(extractRollChainArtistTags(chain, known)).toEqual(['base', 'subject', 'module', 'role-one', 'role-two']);
  expect(chain).toEqual(before); expect([...known]).toEqual([]);
});

it('未闭合数值权重只约束所在正向通道，空串正常返回空集合', () => {
  const chain = chainOf('-1::artist:suppressed');
  chain.params.characters = [{ id: 'role', prompt: 'artist:visible', x: 0.5, y: 0.5 }];
  expect(extractRollChainArtistTags(chain, new Set())).toEqual(['visible']);
  expect(extractRollChainArtistTags(chainOf(''), new Set())).toEqual([]);
});
