import { describe, expect, it } from 'vitest';
import type { TagSuggestion } from '../../services/tagDictionary';
import {
  buildStyleWarningTagMap,
  detectStyleCharacterTags,
  removeFlaggedStyleTags,
} from '../../services/comic/comicStyleGuard';

const makeSuggestion = (name: string, category: number): TagSuggestion => ({
  name,
  chinese: '',
  category,
  categoryLabel: '',
  postCount: 1000,
  isNovelAI: false,
});

describe('comicStyleGuard pure local character detection', () => {
  it('keeps artists, quality, and style descriptors unflagged while detecting characters, IP, counts, appearance, outfits, and poses', () => {
    const categories = new Map<string, TagSuggestion>([
      ['wlop', makeSuggestion('wlop', 1)],
      ['hatsune miku', makeSuggestion('hatsune miku', 4)],
      ['vocaloid', makeSuggestion('vocaloid', 3)],
      ['absurdres', makeSuggestion('absurdres', 5)],
    ]);
    const prompt = 'artist:example, wlop, masterpiece, absurdres, year 2025, anime coloring, cel shading, soft lighting, 1girl, solo, hatsune miku, vocaloid, silver hair, sailor uniform, looking at viewer';
    const hits = detectStyleCharacterTags(prompt, categories);
    expect(hits.map(h => [h.lookupTag, h.reason])).toEqual([
      ['1girl', 'count'],
      ['solo', 'count'],
      ['hatsune miku', 'character'],
      ['vocaloid', 'copyright'],
      ['silver hair', 'appearance'],
      ['sailor uniform', 'outfit'],
      ['looking at viewer', 'pose'],
    ]);
    const warningMap = buildStyleWarningTagMap(hits);
    expect(warningMap.has('wlop')).toBe(false);
    expect(warningMap.has('anime coloring')).toBe(false);
    expect(warningMap.get('hatsune miku')).toContain('角色名');
  });

  it('removes flagged character tags safely while preserving surrounding weight groups and style tags', () => {
    const prompt = '1.2::artist:foo, 1girl, silver hair::, {{crisp lineart, school uniform}}, masterpiece, smiling';
    const hits = detectStyleCharacterTags(prompt);
    expect(hits.map(h => h.lookupTag)).toEqual(['1girl', 'silver hair', 'school uniform', 'smiling']);
    const cleaned = removeFlaggedStyleTags(prompt, hits);
    expect(cleaned).toBe('1.2::artist:foo::, {{crisp lineart}}, masterpiece');
  });
});
