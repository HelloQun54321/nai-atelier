import { expect, it } from 'vitest';
import type { PromptChain } from '../../types';
import { extractArtistParticipation, extractChainArtistParticipation, extractHistoryParticipation, extractPromptArtistTags, normalizeArtistUsageKey } from '../../services/artistParticipation';

it('画师参与按名字去重，保留多词名字并识别加权、分组、裸词和负权重', () => {
  const known = new Set(['bare artist', 'other artist']);
  expect(extractArtistParticipation('1.4::artist:Alpha_Name ::, Artists: {[alpha name], beta artist}, bare_artist, by other_artist, -1::artist:gamma::, solo', known))
    .toEqual(['alpha name', 'beta artist', 'bare artist', 'other artist', 'gamma']);
  expect(normalizeArtistUsageKey(' Ａlpha_Name\\(style\\) ')).toBe('alpha name (style)');
  expect(extractArtistParticipation('unknown name, by unknown, @unknown')).toEqual([]);
});

it('风格串计入启用模块、主体与角色正向，不读取停用项和负面', () => {
  const chain: PromptChain = { id: 'synthetic-chain', userId: 'synthetic-user', type: 'style', name: '参与统计夹具', description: '', tags: [], createdAt: 1, updatedAt: 1,
    basePrompt: 'artist:base', variableValues: { subject: 'artist:subject' },
    modules: [{ id: 'on', name: '启用', content: 'artist:on', isActive: true }, { id: 'off', name: '停用', content: 'artist:off', isActive: false }],
    negativePrompt: 'artist:negative', params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', characters: [
      { id: 'one', prompt: 'artist:base', sections: { appearance: 'artist:role' }, negativePrompt: 'artist:role-negative', x: 0.5, y: 0.5 },
      { id: 'off', prompt: 'artist:disabled', enabled: false, x: 0.5, y: 0.5 },
    ] } };
  expect(extractChainArtistParticipation(chain)).toEqual(['base', 'subject', 'on', 'role']);
});

it('历史完整文本、角色及分栏各自去重，容忍旧JSON格式', () => {
  const result = extractHistoryParticipation({ prompt: '1.2::artist:alpha ::, solo, solo, best quality', base_prompt: 'artist:stale',
    params: JSON.stringify({ characters: [{ id: 'one', prompt: 'girl', sections: { appearance: 'artist:beta' }, x: 0.5, y: 0.5 }] }) });
  expect(result.artists).toEqual(['alpha', 'beta']);
  expect(result.tags).toEqual(['solo', 'best quality']);
  expect(result.characters).toEqual([{ id: 'artist:beta, girl', name: 'artist:beta, girl' }]);
  expect(extractHistoryParticipation({ params: '{invalid' })).toEqual({ artists: [], tags: [], characters: [] });
  expect(extractHistoryParticipation({ prompt: 'artist:alpha', params: '{"characters":{}}' }).artists).toEqual(['alpha']);
});

it('负权重画师是被压低的，参与统计与实际生成口径一致', () => {
  const known = new Set(['kept', 'suppressed', 'zero', 'bare kept', 'bare suppressed']);
  expect(extractPromptArtistTags(['1.4::artist:kept::, -1::artist:suppressed::, 0::artist:zero::, bare kept, -0.5::bare suppressed::'], known))
    .toEqual(['kept', 'bare kept']);
  expect(extractHistoryParticipation({ prompt: 'artist:kept, -1::artist:suppressed::' }, known).artists).toEqual(['kept']);
});

it('全局未闭合的分组不跨到角色栏，角色描述不会被当成画师名', () => {
  const characters = JSON.stringify({ characters: [{ id: 'one', prompt: 'girl, long hair', x: 0.5, y: 0.5 }] });
  // 全局以未闭合的 artists: 分组结尾时，join 成一段解析会让角色栏的普通描述全被当成画师。
  expect(extractHistoryParticipation({ prompt: 'artist:alpha, artists:{', params: characters }).artists).toEqual(['alpha']);
  expect(extractPromptArtistTags(['artist:alpha, artists:{', 'girl, long hair'])).toEqual(['alpha']);
});
