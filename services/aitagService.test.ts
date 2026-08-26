import { describe, it, expect, vi } from 'vitest';
import {
  aitagService,
  parseMaybeJsonArray,
  parseAitagAiJson,
  getAitagType,
  getAitagMetadataText,
  buildAitagImageUrl,
  buildAitagPreviewUrl,
  extractAitagPrompt,
  hasAitagImagePrompt,
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


describe('getAitagMetadataText', () => {
  it('屏蔽 UTF-8 字节数少于 30 的短元数据', () => {
    expect(getAitagMetadataText({ ai_json: JSON.stringify({ Comment: '👻👻👻' }) } as any)).toBe('');
    expect(getAitagMetadataText({ ai_json: JSON.stringify({ Comment: 'a'.repeat(29) }) } as any)).toBe('');
  });

  it('保留达到 30 字节及以上的元数据', () => {
    expect(getAitagMetadataText({ ai_json: JSON.stringify({ Comment: 'a'.repeat(30) }) } as any)).toBe('a'.repeat(30));
    expect(getAitagMetadataText({ ai_json: JSON.stringify({ Comment: { prompt: '1girl, masterpiece, detailed eyes' } }) } as any))
      .toBe(JSON.stringify({ prompt: '1girl, masterpiece, detailed eyes' }));
  });
});

describe('extractAitagPrompt', () => {
  it('优先 Comment.v4_prompt.caption.base_caption，其次 Comment.prompt', () => {
    const image = {
      ai_json: JSON.stringify({
        Comment: {
          v4_prompt: { caption: { base_caption: 'masterpiece, 1girl' } },
          prompt: 'legacy prompt',
        },
      }),
    } as any;
    expect(extractAitagPrompt(image)).toBe('masterpiece, 1girl');
    expect(extractAitagPrompt({ ai_json: JSON.stringify({ Comment: { prompt: 'legacy prompt' } }) } as any)).toBe('legacy prompt');
  });

  it('顶层 v4_prompt / prompt / Description 依次兜底', () => {
    expect(extractAitagPrompt({ ai_json: JSON.stringify({ v4_prompt: { caption: { base_caption: 'v4 top' } } }) } as any)).toBe('v4 top');
    expect(extractAitagPrompt({ ai_json: JSON.stringify({ prompt: 'plain prompt' }) } as any)).toBe('plain prompt');
    expect(extractAitagPrompt({ ai_json: JSON.stringify({ Description: 'desc prompt' }) } as any)).toBe('desc prompt');
  });

  it('最后回退 prompt_text（原样返回，不裁剪），缺失时返回空串', () => {
    expect(extractAitagPrompt({ ai_json: '{}', prompt_text: 'from prompt_text' } as any)).toBe('from prompt_text');
    expect(extractAitagPrompt({ ai_json: '{}', prompt_text: '   ' } as any)).toBe('   ');
    expect(extractAitagPrompt({ ai_json: '{}' } as any)).toBe('');
  });
});

describe('hasAitagImagePrompt', () => {
  it('与 extractAitagPrompt 判定一致：有有效 prompt 为 true', () => {
    const cases: any[] = [
      { ai_json: JSON.stringify({ Comment: { v4_prompt: { caption: { base_caption: '1girl' } } } }) },
      { ai_json: JSON.stringify({ Comment: { prompt: 'legacy' } }) },
      { ai_json: JSON.stringify({ v4_prompt: { caption: { base_caption: 'v4' } } }) },
      { ai_json: JSON.stringify({ prompt: 'plain' }) },
      { ai_json: JSON.stringify({ Description: 'desc' }) },
      { ai_json: '{}', prompt_text: 'pt' },
    ];
    for (const image of cases) {
      expect(hasAitagImagePrompt(image)).toBe(true);
      expect(extractAitagPrompt(image).trim().length).toBeGreaterThan(0);
    }
  });

  it('无 prompt（空串/缺失/空白元数据）判定为 false', () => {
    const cases: any[] = [
      { ai_json: JSON.stringify({ Comment: { prompt: '', v4_prompt: { caption: { base_caption: '  ' } } } }) },
      { ai_json: JSON.stringify({ Description: '' }) },
      { ai_json: '{}', prompt_text: '' },
      { ai_json: '{}', prompt_text: '   ' },
      { ai_json: JSON.stringify({ Comment: { prompt: '', steps: '', seed: '' } }) },
    ];
    for (const image of cases) {
      expect(hasAitagImagePrompt(image)).toBe(false);
    }
  });

  it('null / undefined / 非对象安全返回 false', () => {
    expect(hasAitagImagePrompt(null as any)).toBe(false);
    expect(hasAitagImagePrompt(undefined as any)).toBe(false);
  });
});

describe('aitagService', () => {
  it('所有列表与缓存请求固定使用 NovelAI 来源', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    try {
      await aitagService.search({ page: 1 });
      await aitagService.searchCache({ page: 1 });
      await aitagService.getCacheStatus();
      await aitagService.waitForFirstImageCache({ ids: [1] });

      expect(fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost').searchParams.get('aiType')))
        .toEqual(['nai', 'nai', 'nai', 'nai']);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
