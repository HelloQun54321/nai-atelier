import { describe, expect, it, vi } from 'vitest';
import { normalizePromptPunctuation, proofreadPrompt, type PromptProofreadDeps } from '../../services/tagProofread';
import type { TagSuggestion } from '../../services/tagDictionary';

const suggestion = (name: string): TagSuggestion => ({ name, chinese: '', category: 0, categoryLabel: 'Tag', postCount: 1, isNovelAI: false });

/** 词库替身：entries 是精确命中的标准写法，candidates 是前缀候选。 */
const deps = (
  entries: Record<string, string> = {},
  candidates: Record<string, TagSuggestion[]> = {},
  options: { fail?: boolean } = {},
): PromptProofreadDeps => ({
  lookup: vi.fn(async (tags: string[]) => {
    if (options.fail) throw new Error('尚未下载 Tag 词库');
    return new Map(tags.filter(tag => entries[tag]).map(tag => [tag, suggestion(entries[tag])]));
  }),
  search: vi.fn(async (query: string) => {
    if (options.fail) throw new Error('尚未下载 Tag 词库');
    return candidates[query] || [];
  }),
});

describe('normalizePromptPunctuation', () => {
  it('把中文分隔标点换成英文并保留间隔', () => {
    expect(normalizePromptPunctuation('1girl，solo，best quality')).toEqual({ text: '1girl, solo, best quality', count: 2 });
    expect(normalizePromptPunctuation('1girl， solo')).toEqual({ text: '1girl, solo', count: 1 });
  });

  it('中文冒号连着写正好还原数值权重，句号等标点直接替换', () => {
    expect(normalizePromptPunctuation('0.8：：artist:kieed：：')).toEqual({ text: '0.8::artist:kieed::', count: 4 });
    expect(normalizePromptPunctuation('「银发」（少女）、。【】')).toEqual({ text: '"银发"(少女), .[]', count: 8 });
  });

  it('英文提示词原样返回', () => {
    expect(normalizePromptPunctuation('1girl, solo, long hair')).toEqual({ text: '1girl, solo, long hair', count: 0 });
  });
});

describe('proofreadPrompt', () => {
  it('命中词库时把写法对齐成标准形式，大小写与下划线一起纠正', async () => {
    const result = await proofreadPrompt('HatSune_Miku, 1Girl', deps({ 'hatsune miku': 'hatsune miku', '1girl': '1girl' }));
    expect(result.text).toBe('hatsune miku, 1girl');
    expect(result.corrections).toEqual([
      { from: 'HatSune_Miku', to: 'hatsune miku' },
      { from: '1Girl', to: '1girl' },
    ]);
    expect(result.punctuation).toBe(0);
    expect(result.dictionaryUnavailable).toBe(false);
  });

  it('词库没有但拼错一个字母时改成最近的常用词', async () => {
    const result = await proofreadPrompt('masterpice, best quality', deps({ 'best quality': 'best quality' }, { masterpice: [suggestion('masterpiece')] }));
    expect(result.text).toBe('masterpiece, best quality');
    expect(result.corrections).toEqual([{ from: 'masterpice', to: 'masterpiece' }]);
  });

  it('长词允许两处编辑距离，短词不做模糊替换', async () => {
    const swapped = await proofreadPrompt('hatusne miku', deps({}, { 'hatusne miku': [suggestion('hatsune miku')] }));
    expect(swapped.text).toBe('hatsune miku');
    // 词数不同的候选不算同一个词
    const extra = await proofreadPrompt('silver hair', deps({}, { 'silver hair': [suggestion('silver hairband')] }));
    expect(extra.text).toBe('silver hair');
    expect(extra.corrections).toEqual([]);
  });

  it('词库没有的词原样保留，不做猜测', async () => {
    const result = await proofreadPrompt('my own oc, 1girl', deps({ '1girl': '1girl' }));
    expect(result.text).toBe('my own oc, 1girl');
    expect(result.corrections).toEqual([]);
  });

  it('中文写的自然语言原样保留，不查词库也不翻译', async () => {
    const dependency = deps({});
    const result = await proofreadPrompt('银发少女，白色连衣裙', dependency);
    expect(result.text).toBe('银发少女, 白色连衣裙');
    expect(dependency.lookup).not.toHaveBeenCalled();
    expect(result.corrections).toEqual([]);
  });

  it('保留权重包装与括号，只替换里面的词', async () => {
    const result = await proofreadPrompt('0.8：：gebijiade89：：, {HatSune_Miku}, [silver_hair]',
      deps({ 'gebijiade89': 'gebijiade89', 'hatsune miku': 'hatsune miku', 'silver hair': 'silver hair' }));
    expect(result.text).toBe('0.8::gebijiade89::, {hatsune miku}, [silver hair]');
    expect(result.corrections.map(item => item.from)).toEqual(['HatSune_Miku', 'silver_hair']);
  });

  it('artist: 前缀保留，只对齐后面的名字', async () => {
    const result = await proofreadPrompt('artist:HatSune_Miku, solo', deps({ 'hatsune miku': 'hatsune miku', solo: 'solo' }));
    expect(result.text).toBe('artist:hatsune miku, solo');
    expect(result.corrections).toEqual([{ from: 'HatSune_Miku', to: 'hatsune miku' }]);
  });

  it('分段标记不动，只校对其中的词', async () => {
    const result = await proofreadPrompt('<artist>, HatSune_Miku, </artist>', deps({ 'hatsune miku': 'hatsune miku' }));
    expect(result.text).toBe('<artist>, hatsune miku, </artist>');
  });

  it('词库未就绪时只统一标点，并如实标记', async () => {
    const result = await proofreadPrompt('1girl，masterpice', deps({}, {}, { fail: true }));
    expect(result.text).toBe('1girl, masterpice');
    expect(result.corrections).toEqual([]);
    expect(result.punctuation).toBe(1);
    expect(result.dictionaryUnavailable).toBe(true);
  });

  it('没有需要改的地方时原样返回', async () => {
    const result = await proofreadPrompt('1girl, solo', deps({ '1girl': '1girl', solo: 'solo' }));
    expect(result.text).toBe('1girl, solo');
    expect(result.corrections).toEqual([]);
    expect(result.punctuation).toBe(0);
  });

  it('同一段里重复的词各改各的，改回原文后位置不错乱', async () => {
    const result = await proofreadPrompt('HatSune_Miku, smile, HatSune_Miku', deps({ 'hatsune miku': 'hatsune miku', smile: 'smile' }));
    expect(result.text).toBe('hatsune miku, smile, hatsune miku');
  });
});
