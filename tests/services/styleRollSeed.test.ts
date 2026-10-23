import { expect, it } from 'vitest';
import { normalizeRollArtistKey, promptHasArtistTags } from '../../services/styleRollSeed';

it('画师键仍统一大小写、下划线和括号前空格', () => {
  expect(normalizeRollArtistKey('  Alpha_Artist(example)  ')).toBe('alpha artist (example)');
});

it.each(['artist:alpha', '1.2::ARTIST:alpha ::', '0.8::Artists:alpha ::'])('保留外部图库使用的显式画师识别：%s', prompt => {
  expect(promptHasArtistTags(prompt)).toBe(true);
});

it.each(['alpha_artist', '@alpha_artist', 'by Alpha_Painter:0.9', 'alpha_artist(example)'])('裸名及署名仅在词库命中时识别：%s', prompt => {
  const known = new Set(['alpha artist', 'alpha painter', 'alpha artist (example)']);
  expect(promptHasArtistTags(prompt, known)).toBe(true);
  expect(promptHasArtistTags(prompt, new Set())).toBe(false);
});

it('空提示词和普通质量词不会被当成画师', () => {
  expect(promptHasArtistTags('   ')).toBe(false);
  expect(promptHasArtistTags('masterpiece, best quality, 1girl', new Set(['alpha']))).toBe(false);
});
