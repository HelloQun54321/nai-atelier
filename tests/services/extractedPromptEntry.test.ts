import { describe, expect, it } from 'vitest';
import type { PromptChain } from '../../types';
import { buildExtractedChainPayload } from '../../services/extractedPromptEntry';

describe('AI 提取候选的入库结构', () => {
  it('按候选分类写条目类型，英文提示词进 basePrompt，中文原名对照进 _promptLibrary', () => {
    const payload = buildExtractedChainPayload({ entryId: 'stable-candidate', kind: 'appearance', name: '银白长发', prompt: '1.2::white hair, long hair::, red eyes', original: '1.2::银白长发::，红眼' });
    expect(payload.type).toBe('appearance');
    expect(payload.name).toBe('银白长发');
    const data = payload.data as Partial<PromptChain>;
    /* 权重组与重复项原样保留，不因入库被重写或去重 */
    expect(data.basePrompt).toBe('1.2::white hair, long hair::, red eyes');
    const params = data.params as { _promptLibrary?: { bilingual?: string }; width?: number };
    expect(params._promptLibrary?.bilingual).toBe('1.2::银白长发::，红眼');
    /* 沿用六类库条目的参数与分栏字段，不新建结构 */
    expect(typeof params.width).toBe('number');
    expect(data.modules).toEqual([]);
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('entryId');
    expect(data.variableValues).toEqual({ subject: '' });
  });

  it('没有中文原文时对照留空，名称与提示词都去空白，空名称回退为固定文案', () => {
    const plain = buildExtractedChainPayload({ entryId: 'stable-candidate', kind: 'scene', name: '  雨夜街道  ', prompt: '  rainy street, night  ' });
    expect(plain.name).toBe('雨夜街道');
    expect((plain.data as Partial<PromptChain>).basePrompt).toBe('rainy street, night');
    expect((plain.data as Partial<PromptChain>).params as { _promptLibrary?: { bilingual?: string } }).toEqual(expect.objectContaining({ _promptLibrary: { bilingual: '', references: [] } }));
    expect(buildExtractedChainPayload({ entryId: 'stable-candidate', kind: 'pose', name: '   ', prompt: 'standing' }).name).toBe('未命名提取条目');
  });

  it('六类分类各自成为对应条目类型，不被合并成一条其他类型', () => {
    const kinds = ['appearance', 'wardrobe', 'pose', 'expression', 'scene', 'camera'] as const;
    const types = kinds.map(kind => buildExtractedChainPayload({ entryId: 'stable-candidate', kind, name: kind, prompt: 'x' }).type);
    expect(types).toEqual(kinds);
  });
});
