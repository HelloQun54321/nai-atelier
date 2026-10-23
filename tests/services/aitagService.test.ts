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
  aitagPromptHasArtistTags,
  buildAitagChainDescription,
  getAitagPositivePromptText,
  getAitagSavedChainWorkIds,
  getAitagWorkPromptTexts,
  matchesAitagPromptQuery,
  parseAitagPromptQuery,
  type AitagImage,
} from '../../services/aitagService';

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

describe('AITag 本地筛选辅助', () => {
  const image = (aiJson: Record<string, unknown>): AitagImage => ({ id: 1, work_id: 7, author_id: 1, image_type: 'nai', file_name: '7_p0.png', ai_json: aiJson });

  it('提示词检索：逗号分隔多条件，最长包含条件交给服务端，其余与排除条件本地判定', () => {
    expect(parseAitagPromptQuery('long_hair， blue eyes, -Smile, -smile,')).toEqual({ remote: 'long_hair', localInclude: ['blue eyes'], exclude: ['smile'] });
    expect(parseAitagPromptQuery('1girl')).toEqual({ remote: '1girl', localInclude: [], exclude: [] });
    expect(parseAitagPromptQuery('-nsfw')).toEqual({ remote: '', localInclude: [], exclude: ['nsfw'] });
    expect(parseAitagPromptQuery('  ')).toEqual({ remote: '', localInclude: [], exclude: [] });
  });

  it('本地细筛按下划线／大小写归一化，排除命中即剔除，单条件不重复判定', () => {
    const query = parseAitagPromptQuery('masterpiece, long hair, -smile');
    expect(matchesAitagPromptQuery(['Masterpiece, LONG_HAIR, blue eyes'], query)).toBe(true);
    expect(matchesAitagPromptQuery(['masterpiece, long hair, smile'], query)).toBe(false);
    expect(matchesAitagPromptQuery(['masterpiece'], query)).toBe(false);
    expect(matchesAitagPromptQuery([], parseAitagPromptQuery('-smile'))).toBe(true);
    expect(matchesAitagPromptQuery([], parseAitagPromptQuery('anything'))).toBe(true);
  });

  it('正向提示词包含基础与角色提示词，不混入负面；详情加载后覆盖全部页', () => {
    const first = image({ Comment: { prompt: 'base tag', uc: 'bad hands', v4_prompt: { caption: { base_caption: 'base tag', char_captions: [{ char_caption: 'girl, red hair' }] } } } });
    expect(getAitagPositivePromptText(first)).toBe('base tag, girl, red hair');
    const second = image({ prompt: 'artist:synthetic, scenery' });
    const work = { id: 7, firstImage: first };
    expect(getAitagWorkPromptTexts(work)).toEqual(['base tag, girl, red hair']);
    expect(getAitagWorkPromptTexts(work, { work, images: [first, second] })).toEqual(['base tag, girl, red hair', 'artist:synthetic, scenery']);
    expect(getAitagWorkPromptTexts(work, { work, images: [second], isPreviewOnly: true })).toEqual(['base tag, girl, red hair']);
  });

  it('画师串识别 artist: 前缀与词库中的裸画师名，普通 Tag 不误判', () => {
    expect(aitagPromptHasArtistTags('1girl, artist:synthetic painter, solo')).toBe(true);
    expect(aitagPromptHasArtistTags('1girl, 1.2::Artist:synthetic::, solo')).toBe(true);
    expect(aitagPromptHasArtistTags('1girl, artistic, solo')).toBe(false);
    expect(aitagPromptHasArtistTags('1girl, synthetic_painter, solo')).toBe(false);
    expect(aitagPromptHasArtistTags('1girl, synthetic_painter, solo', new Set(['synthetic painter']))).toBe(true);
  });

  it('只按保存时写入的 AITag 来源说明识别已保存风格串，角色条目不计入', () => {
    const chains = [
      { type: 'style' as const, description: buildAitagChainDescription(11) },
      { type: 'style' as const, description: `备注 ${buildAitagChainDescription(12)}` },
      { type: 'character' as const, description: buildAitagChainDescription(13) },
      { type: 'style' as const, description: 'aitag 14' },
    ];
    expect([...getAitagSavedChainWorkIds(chains)].sort()).toEqual([11, 12]);
    expect(getAitagSavedChainWorkIds(undefined).size).toBe(0);
  });
});
