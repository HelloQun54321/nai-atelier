import { describe, it, expect } from 'vitest';
import { buildAitagFirstImageMeta } from '../../services/aitagMetadataCore';
import {
  getAitagWorkModelLabels,
  getAitagWorkPromptTexts,
  getAitagWorkReferenceUsage,
  type AitagImage,
} from '../../services/aitagService';

/**
 * 一致性契约：同一份首图元数据，无论走「直接解析 ai_json」还是走「列表下发的派生结论」，
 * 模型标签、提示词与参考使用都必须相同。前端与 Worker 共用 services/aitagMetadataCore.ts，
 * 这条测试同时锁住两侧语义，改了任何一侧而没同步另一侧都会失败。
 */
const fixtures: Array<{ name: string; aiJson: unknown }> = [
  {
    name: '普通文生图',
    aiJson: { prompt: '1girl, artist:synthetic, soft light', seed: 123, model: 'NovelAI Diffusion V4.5 1229B44F', width: 832, height: 1216 },
  },
  {
    name: '字符串 Comment 与角色词',
    aiJson: JSON.stringify({
      Comment: JSON.stringify({
        prompt: 'base prompt',
        v4_prompt: { caption: { base_caption: 'base, artist:synthetic', char_captions: [{ char_caption: 'char-a, artist:synthetic' }] } },
      }),
    }),
  },
  {
    name: '氛围参考',
    aiJson: { prompt: 'x', reference_image_multiple: ['synthetic'], reference_strength_multiple: [0.6] },
  },
  {
    name: '精准参考',
    aiJson: { Comment: { prompt: 'x', director_reference_descriptions: ['synthetic'] } },
  },
  {
    name: '空参考数组不算使用',
    aiJson: { prompt: 'x', reference_image_multiple: [], reference_strength_multiple: [], vibe_transfer: false },
  },
  {
    name: '没有元数据',
    aiJson: undefined,
  },
];

describe('AITag 元数据共享实现', () => {
  it.each(fixtures)('列表派生结论与直接解析结果完全一致：$name', ({ aiJson }) => {
    const image: AitagImage = {
      id: 1,
      work_id: 7,
      author_id: 1,
      image_type: 'nai',
      file_name: '7_p0.png',
      prompt_text: typeof aiJson === 'string' ? undefined : 'fallback prompt',
      ai_json: aiJson as AitagImage['ai_json'],
    };
    const stripped: AitagImage = { ...image, ai_json: undefined };
    const meta = buildAitagFirstImageMeta(image);

    const viaJson = {
      usage: getAitagWorkReferenceUsage({ id: 7, firstImage: image }),
      texts: getAitagWorkPromptTexts({ id: 7, firstImage: image }),
      models: getAitagWorkModelLabels({ id: 7, firstImage: image }),
    };
    const viaMeta = {
      usage: getAitagWorkReferenceUsage({ id: 7, firstImage: stripped, firstImageMeta: meta }),
      texts: getAitagWorkPromptTexts({ id: 7, firstImageMeta: meta }),
      models: getAitagWorkModelLabels({ id: 7, firstImage: stripped, firstImageMeta: meta }),
    };

    expect(viaMeta).toEqual(viaJson);
  });

  it('派生结论保留筛选所需的最小信息，且不依赖 ai_json 存在', () => {
    const image: AitagImage = {
      id: 2,
      work_id: 8,
      author_id: 1,
      image_type: 'nai',
      file_name: '8_p0.png',
      ai_json: {
        prompt: '1girl, artist:synthetic',
        model: 'NovelAI Diffusion V5 657484A5',
        width: 1024,
        height: 1536,
        reference_image_multiple: ['synthetic'],
      },
    };
    const meta = buildAitagFirstImageMeta(image);
    expect(meta).toMatchObject({ width: 1024, height: 1536, hasVibe: true, hasPrecise: false, hasMetadata: true });
    expect(meta?.promptText).toContain('artist:synthetic');
    expect(meta?.model).toContain('V5');
    // 剥离 ai_json 后派生结论仍可用于筛选
    expect(getAitagWorkReferenceUsage({ id: 8, firstImage: { ...image, ai_json: undefined }, firstImageMeta: meta }))
      .toEqual({ vibe: true, precise: false, unknown: false });
  });
});
