import { expect, it } from 'vitest';
import { getPromptArtists } from '../../services/promptArtists';

it('显式画师、裸名和多重权重共用完整权重流，重复同名不相加', () => {
  expect(getPromptArtists('0.54::artist:alpha::, 0.78::alpha::, blue eyes, 0.35::artist:beta::', {}, ['alpha', 'beta'])).toEqual([
    { name: 'alpha', weights: [0.54, 0.78] }, { name: 'beta', weights: [0.35] },
  ]);
  expect(getPromptArtists('2::artist:alpha::, artist:beta')).toEqual([{ name: 'alpha', weights: [2] }, { name: 'beta', weights: [1] }]);
});
it('角色正向按独立字段识别，停用角色和负面不参与，不改写参数', () => {
  const params = { characters: [{ id: '1', prompt: 'artist:beta', negativePrompt: 'artist:negative', x: .5, y: .5 }, { id: '2', prompt: 'artist:disabled', enabled: false, x: .5, y: .5 }] };
  const before = JSON.stringify(params);
  expect(getPromptArtists('artist:alpha', params).map(artist => artist.name)).toEqual(['alpha', 'beta']);
  expect(JSON.stringify(params)).toBe(before);
});
it('裸名必须命中目录，普通词不伪装画师；无冲突别名规范化，冲突不猜', () => {
  expect(getPromptArtists('ALPHA_artist, solo, fake_artist', {}, ['alpha artist'])).toEqual([{ name: 'alpha artist', weights: [1] }]);
  expect(getPromptArtists('Alpha Artist', {}, ['alpha_artist', 'alpha artist'])).toEqual([]);
  expect(getPromptArtists('alpha_artist', {}, ['alpha_artist', 'alpha artist'])).toEqual([{ name: 'alpha_artist', weights: [1] }]);
});
it('普通大括号倍率与负权重如实显示，未知身份仍保留显式画师', () => {
  expect(getPromptArtists('{artist:alpha}, -1::artist:unknown::')).toEqual([{ name: 'alpha', weights: [1.05] }, { name: 'unknown', weights: [-1] }]);
  expect(getPromptArtists('')).toEqual([]);
});
