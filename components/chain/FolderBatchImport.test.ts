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

  it('正确根据提示词与生成参数计算指纹并识别重复预设（忽略随机种子变化）', async () => {
    const { computeChainFingerprint } = await import('./FolderBatchImportModal');
    // 相同提示词和参数，即使种子不同（或一个有种子一个已清空为 undefined），指纹应完全相同
    const fpWithSeed = computeChainFingerprint('1girl, scenic', 'low quality', { seed: 123456789, steps: 28, model: 'nai-diffusion-4-5-full', width: 832, height: 1216 });
    const fpEmptySeed = computeChainFingerprint('1girl, scenic', 'low quality', { seed: undefined, steps: 28, model: 'nai-diffusion-4-5-full', width: 832, height: 1216 });
    const fpChangedSeed = computeChainFingerprint('1girl, scenic', 'low quality', { seed: 999999999, steps: 28, model: 'nai-diffusion-4-5-full', width: 832, height: 1216 });

    expect(fpWithSeed).toBe(fpEmptySeed);
    expect(fpWithSeed).toBe(fpChangedSeed);

    // 参数或提示词不同时，指纹不同
    const fpDifferentPrompt = computeChainFingerprint('1boy, scenic', 'low quality', { steps: 28, model: 'nai-diffusion-4-5-full', width: 832, height: 1216 });
    expect(fpWithSeed).not.toBe(fpDifferentPrompt);
  });
});

