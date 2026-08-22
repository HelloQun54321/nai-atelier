import { describe, expect, it } from 'vitest';
import { splitNovelAiPromptWithCategories, tokenizeNovelAiPrompt } from './promptImport';
import type { TagSuggestion } from './tagDictionary';

const artist = (name: string): TagSuggestion => ({
  name,
  chinese: name,
  category: 1,
  categoryLabel: '画师',
  postCount: 1,
  isNovelAI: false,
});

describe('NovelAI 提示词导入拆分', () => {
  it('保留数值权重组，不按组内逗号拆开', () => {
    expect(tokenizeNovelAiPrompt('1.5::best quality, masterpiece::, 1girl, blue eyes')).toEqual([
      '1.5::best quality, masterpiece::',
      '1girl',
      'blue eyes',
    ]);
  });

  it('把质量、媒介和画师移入画风，把人物内容留在主体', () => {
    const categories = new Map([['konya karasue', artist('konya_karasue')]]);
    const result = splitNovelAiPromptWithCategories(
      '1.5::best quality, masterpiece::, digital illustration, konya_karasue, 1girl, blue eyes',
      categories,
    );
    expect(result.basePrompt).toBe('1.5::best quality, masterpiece::, digital illustration, konya_karasue');
    expect(result.subjectPrompt).toBe('1girl, blue eyes');
  });

  it('含未知内容的权重组整体留在主体，避免改变权重语义', () => {
    const result = splitNovelAiPromptWithCategories(
      '0.8::masterpiece, remielle dan::, no text',
      new Map(),
    );
    expect(result.basePrompt).toBe('no text');
    expect(result.subjectPrompt).toBe('0.8::masterpiece, remielle dan::');
  });

  it('无法识别的词默认留在主体', () => {
    const result = splitNovelAiPromptWithCategories('forest shrine, solo', new Map());
    expect(result.basePrompt).toBe('');
    expect(result.subjectPrompt).toBe('forest shrine, solo');
  });
});
