// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { UNTESTED_CHAIN_TAG, isUntestedChain } from '../DesignSystem';
import { parseNovelAIMetadata } from '../../services/metadataService';

describe('FolderBatchImport & Untested Tag Lifecycle', () => {
  it('正确识别带有「待实测」标签的风格串', () => {
    expect(isUntestedChain({ tags: [UNTESTED_CHAIN_TAG] })).toBe(true);
    expect(isUntestedChain({ tags: ['other', UNTESTED_CHAIN_TAG, 'custom'] })).toBe(true);
    expect(isUntestedChain({ tags: ['other'] })).toBe(false);
    expect(isUntestedChain({ tags: [] })).toBe(false);
    expect(isUntestedChain(undefined)).toBe(false);
    expect(isUntestedChain(null)).toBe(false);
  });

  it('模拟生图成功后正确摘除「待实测」标签', () => {
    const initialTags = ['外部收集', UNTESTED_CHAIN_TAG, '画风A'];
    expect(isUntestedChain({ tags: initialTags })).toBe(true);

    const updatedTags = initialTags.filter(t => t !== UNTESTED_CHAIN_TAG);
    expect(updatedTags).toEqual(['外部收集', '画风A']);
    expect(isUntestedChain({ tags: updatedTags })).toBe(false);
  });

  it('正确解析并组装批量导入的 NovelAI 生成参数结构', () => {
    const rawJson = JSON.stringify({
      prompt: '1girl, masterpiece, cinematic lighting',
      uc: 'worst quality, low quality',
      steps: 28,
      scale: 5,
      sampler: 'k_euler_ancestral',
      width: 832,
      height: 1216,
      seed: 123456789,
    });

    const parsed = parseNovelAIMetadata(rawJson);
    expect(parsed.prompt).toContain('1girl');
    expect(parsed.negativePrompt).toBe('worst quality, low quality');
    expect(parsed.params.steps).toBe(28);
    expect(parsed.params.width).toBe(832);
    expect(parsed.params.height).toBe(1216);
    expect(parsed.params.seed).toBe(123456789);
  });

  it('正确根据提示词计算指纹并识别重复预设（只识别正负提示词，忽略尺寸/步数/模型/种子）', async () => {
    const { computeChainFingerprint } = await import('./FolderBatchImportModal');
    // 相同提示词，即使尺寸、步数、模型、种子等全部不同，指纹也完全相同
    const fpBase = computeChainFingerprint('1girl, scenic', 'low quality', { seed: 123456789, steps: 28, model: 'nai-diffusion-4-5-full', width: 832, height: 1216 });
    const fpDifferentDimensions = computeChainFingerprint('1girl, scenic', 'low quality', { seed: undefined, steps: 23, model: 'nai-diffusion-5-full', width: 1216, height: 832 });
    const fpSquareDimension = computeChainFingerprint('1girl, scenic', 'low quality', { width: 1024, height: 1024 });

    expect(fpBase).toBe(fpDifferentDimensions);
    expect(fpBase).toBe(fpSquareDimension);

    // 正向提示词不同
    const fpDifferentPrompt = computeChainFingerprint('1boy, scenic', 'low quality', { width: 832, height: 1216 });
    expect(fpBase).not.toBe(fpDifferentPrompt);

    // 负向提示词不同
    const fpDifferentNegative = computeChainFingerprint('1girl, scenic', 'worst quality, bad anatomy', { width: 832, height: 1216 });
    expect(fpBase).not.toBe(fpDifferentNegative);
  });

  it('正确解析有效预设的提示词与负面提示词', async () => {
    const validMetaJson = JSON.stringify({ prompt: '1girl, anime', uc: 'low quality' });
    const parsedValid = parseNovelAIMetadata(validMetaJson);
    expect(parsedValid.prompt).toContain('1girl');
    expect(parsedValid.negativePrompt).toContain('low quality');
  });
});

