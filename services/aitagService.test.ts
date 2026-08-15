import { describe, it, expect } from 'vitest';
import {
  parseMaybeJsonArray,
  parseAitagAiJson,
  getAitagType,
  buildAitagImageUrl,
  buildAitagPreviewUrl,
} from './aitagService';

describe('parseMaybeJsonArray', () => {
  it('原生数组转字符串数组', () => {
    expect(parseMaybeJsonArray([1, 'b', null])).toEqual(['1', 'b', 'null']);
  });

  it('合法 JSON 数组字符串解析', () => {
    expect(parseMaybeJsonArray('["a", "b"]')).toEqual(['a', 'b']);
  });

  it('非 JSON 字符串按逗号/空白切分', () => {
    expect(parseMaybeJsonArray('tag1, tag2 tag3')).toEqual(['tag1', 'tag2', 'tag3']);
  });

  it('空值返回空数组', () => {
    expect(parseMaybeJsonArray(undefined)).toEqual([]);
    expect(parseMaybeJsonArray('')).toEqual([]);
    expect(parseMaybeJsonArray('   ')).toEqual([]);
    expect(parseMaybeJsonArray(123)).toEqual([]);
  });
});

describe('parseAitagAiJson', () => {
  it('对象原样返回、JSON 字符串解析', () => {
    expect(parseAitagAiJson({ a: 1 })).toEqual({ a: 1 });
    expect(parseAitagAiJson('{"b":2}')).toEqual({ b: 2 });
  });

  it('坏 JSON 与空值返回 null', () => {
    expect(parseAitagAiJson('not json')).toBeNull();
    expect(parseAitagAiJson('')).toBeNull();
    expect(parseAitagAiJson(null)).toBeNull();
    expect(parseAitagAiJson(42)).toBeNull();
  });
});

describe('getAitagType', () => {
  it('优先 AI_type，回退 ai_type，其余为空串', () => {
    expect(getAitagType({ AI_type: 'illust', ai_type: 'manga' } as any)).toBe('illust');
    expect(getAitagType({ ai_type: 'manga' } as any)).toBe('manga');
    expect(getAitagType(undefined)).toBe('');
  });
});

describe('buildAitagImageUrl', () => {
  it('本地与远程直连字段优先', () => {
    expect(buildAitagImageUrl({ local_image_url: '/api/assets/a' } as any)).toBe('/api/assets/a');
    expect(buildAitagImageUrl({ remote_image_url: 'https://x/y' } as any)).toBe('https://x/y');
  });

  it('按 image_type/author_id/file_name 组装 webp 地址', () => {
    const url = buildAitagImageUrl({ image_type: 'illust', author_id: 42, file_name: 'pic.png' } as any);
    expect(url).toContain('/illust/42/pic.webp');
  });

  it('image_path 兜底：剥离旧前缀并替换为 webp', () => {
    const url = buildAitagImageUrl({ image_path: '/www/pixiv_ai_tag/9/1/abc.png' } as any);
    expect(url).toContain('9/1/abc.webp');
    expect(url).not.toContain('www/pixiv_ai_tag');
  });

  it('无任何信息返回空串', () => {
    expect(buildAitagImageUrl(undefined)).toBe('');
    expect(buildAitagImageUrl({} as any)).toBe('');
  });
});

describe('buildAitagPreviewUrl', () => {
  it('本地缓存字段优先级 localFirst > local_cover > firstImage', () => {
    expect(buildAitagPreviewUrl({ id: 1, localFirstImageUrl: '/a' } as any)).toBe('/a');
    expect(buildAitagPreviewUrl({ id: 1, local_cover_url: '/b' } as any)).toBe('/b');
    const viaFirst = buildAitagPreviewUrl({ id: 1, firstImage: { remote_image_url: '/c' } as any } as any);
    expect(viaFirst).toBe('/c');
  });

  it('无 id 或无任何图片信息返回空串', () => {
    expect(buildAitagPreviewUrl(undefined)).toBe('');
    expect(buildAitagPreviewUrl({} as any)).toBe('');
  });
});
