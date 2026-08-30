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

  it('正确计算自动清理候选集（computeAutoCleanupTargets）', async () => {
    const { computeAutoCleanupTargets } = await import('./FolderBatchImportModal');

    const fakeFile = new File([''], 'test.png', { type: 'image/png' });
    const detectedItems: any[] = [
      { id: 'item-1', file: fakeFile, name: 'preset-1', isDuplicate: false, selected: true },
      { id: 'item-2', file: fakeFile, name: 'preset-2', isDuplicate: false, selected: true },
      { id: 'item-dup-unselected', file: fakeFile, name: 'preset-dup-1', isDuplicate: true, selected: false },
      { id: 'item-dup-forced', file: fakeFile, name: 'preset-dup-2', isDuplicate: true, selected: true },
    ];

    const ignoredFiles: any[] = [
      { id: 'ignored-1', file: fakeFile, name: 'bad-1.png', reason: 'no-metadata' },
      { id: 'ignored-2', file: fakeFile, name: 'bad-2.jpg', reason: 'non-png' },
    ];

    const importedSuccessfullyIds = new Set(['item-1', 'item-2', 'item-dup-forced']);

    // 1. 两者均关闭
    const noneTargets = computeAutoCleanupTargets({
      detectedItems,
      ignoredFiles,
      importedSuccessfullyIds,
      deleteSourceAfterImport: false,
      autoDeleteJunk: false,
    });
    expect(noneTargets).toEqual([]);

    // 2. 仅开启 deleteSourceAfterImport（删除已导入成功的源文件）
    const sourceOnlyTargets = computeAutoCleanupTargets({
      detectedItems,
      ignoredFiles,
      importedSuccessfullyIds,
      deleteSourceAfterImport: true,
      autoDeleteJunk: false,
    });
    expect(sourceOnlyTargets.map(t => t.id)).toEqual(['item-1', 'item-2', 'item-dup-forced']);
    expect(sourceOnlyTargets.every(t => t.category === 'source')).toBe(true);

    // 3. 仅开启 autoDeleteJunk（删除无元数据与未导入的重复素材，不误删已强制导入的 item-dup-forced）
    const junkOnlyTargets = computeAutoCleanupTargets({
      detectedItems,
      ignoredFiles,
      importedSuccessfullyIds,
      deleteSourceAfterImport: false,
      autoDeleteJunk: true,
    });
    expect(junkOnlyTargets.map(t => t.id)).toEqual(['ignored-1', 'ignored-2', 'item-dup-unselected']);
    expect(junkOnlyTargets.every(t => t.category === 'junk')).toBe(true);

    // 4. 两者均开启（收件箱完全清空模式）
    const bothTargets = computeAutoCleanupTargets({
      detectedItems,
      ignoredFiles,
      importedSuccessfullyIds,
      deleteSourceAfterImport: true,
      autoDeleteJunk: true,
    });
    // 包含 3 个源文件 + 2 个忽略文件 + 1 个未导入的重复文件，共 6 个
    expect(bothTargets.length).toBe(6);
    expect(bothTargets.map(t => t.id)).toEqual([
      'item-1',
      'item-2',
      'item-dup-forced',
      'ignored-1',
      'ignored-2',
      'item-dup-unselected',
    ]);
  });
});


