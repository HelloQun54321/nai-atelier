import { describe, it, expect } from 'vitest';
import {
  normalizeInspirationTags,
  sourceLabel,
  suggestInspirationTags,
  inspirationSimilarity,
} from './inspirationUtils';

describe('normalizeInspirationTags', () => {
  it('去重、去 # 前缀、修剪空白并过滤空串', () => {
    expect(normalizeInspirationTags([' #portrait ', 'portrait', '', '  ', 'masterpiece'])).toEqual([
      'portrait',
      'masterpiece',
    ]);
  });

  it('最多保留 80 个标签', () => {
    const tags = Array.from({ length: 100 }, (_, i) => `tag${i}`);
    expect(normalizeInspirationTags(tags)).toHaveLength(80);
    expect(normalizeInspirationTags(tags)[0]).toBe('tag0');
  });
});

describe('sourceLabel', () => {
  it('每种来源类型都有标签（含 pixiv 回归）', () => {
    // 回归：标签映射表曾缺 pixiv 键，导致 Pixiv 来源显示 undefined
    expect(sourceLabel('pixiv')).toBe('Pixiv');
    expect(sourceLabel('history')).toBe('生成历史');
    expect(sourceLabel('aitag')).toBe('AITag');
    expect(sourceLabel('danbooru')).toBe('Danbooru');
    expect(sourceLabel('upload')).toBe('手动上传');
    expect(sourceLabel('agent')).toBe('项目 Agent');
    expect(sourceLabel('other')).toBe('其他来源');
  });

  it('缺省时回退到其他来源', () => {
    expect(sourceLabel()).toBe('其他来源');
    expect(sourceLabel(undefined)).toBe('其他来源');
  });
});

describe('suggestInspirationTags', () => {
  it('从 prompt 提取画师 tag、按宽高判方向、附带来源标签', () => {
    const tags = suggestInspirationTags({
      prompt: 'artist:alice, artist:bob, close-up, bokeh',
      params: { width: 832, height: 1216 } as any,
      sourceType: 'pixiv',
      tags: ['keep-me'],
    });
    expect(tags).toContain('keep-me');
    expect(tags).toContain('画师:alice');
    expect(tags).toContain('画师:bob');
    expect(tags).toContain('close-up');
    expect(tags).toContain('bokeh');
    expect(tags).toContain('竖图');
    expect(tags).toContain('Pixiv');
  });

  it('等宽高产方图、缺参时不产生方向标签', () => {
    const square = suggestInspirationTags({ prompt: '', params: { width: 1024, height: 1024 } as any, sourceType: 'upload', tags: [] });
    expect(square).toContain('方图');
    const noParams = suggestInspirationTags({ prompt: '', params: undefined, sourceType: undefined, tags: [] });
    expect(noParams).toEqual([]);
  });
});

describe('inspirationSimilarity', () => {
  const base = { prompt: '', tags: ['a', 'b'], sourceType: 'history' } as any;
  const similar = { prompt: '', tags: ['a', 'b', 'c'], sourceType: 'history' } as any;
  const different = { prompt: '', tags: ['x'], sourceType: 'pixiv' } as any;

  it('共享标签与来源加分', () => {
    expect(inspirationSimilarity(base, similar)).toBeGreaterThan(inspirationSimilarity(base, different));
  });

  it('prompt 词元重合加分', () => {
    const p1 = { prompt: 'dynamic angle cinematic lighting', tags: [], sourceType: undefined } as any;
    const p2 = { prompt: 'cinematic lighting soft focus', tags: [], sourceType: undefined } as any;
    const p3 = { prompt: 'completely unrelated words here', tags: [], sourceType: undefined } as any;
    expect(inspirationSimilarity(p1, p2)).toBeGreaterThan(inspirationSimilarity(p1, p3));
  });
});
