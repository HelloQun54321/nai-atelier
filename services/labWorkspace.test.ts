// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createLabWorkspaceSession, getLabModeLabel, getLabWorkspaceAssetId, LAB_DEFAULT_PARAMS, loadLabWorkspaceSession, saveLabWorkspaceSession, scopeLabWorkspaceSessionToEntry } from './labWorkspace';

const params = {
  model: 'nai-diffusion-4-5-full',
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
};

describe('lab workspace session', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps four independent mode drafts and restores the active mode', () => {
    const fallback = createLabWorkspaceSession('style prompt', 'red bottle', 'bad hands', params, { module: true });
    const session = {
      ...fallback,
      activeMode: 'inpaint' as const,
      edits: {
        ...fallback.edits,
        'image-to-image': { ...fallback.edits['image-to-image'], prompt: 'style only', strength: 0.42, baseImageRef: 'asset-image' },
        inpaint: { ...fallback.edits.inpaint, prompt: 'blue bottle', maskRef: 'asset-mask', focused: true },
        outpaint: { ...fallback.edits.outpaint, expansion: { top: 64, right: 128, bottom: 0, left: 64 } },
      },
    };

    saveLabWorkspaceSession('chain-a', session);
    const restored = loadLabWorkspaceSession('chain-a', fallback);

    expect(restored.activeMode).toBe('inpaint');
    expect(restored.edits['image-to-image'].prompt).toBe('style only');
    expect(restored.edits['image-to-image'].strength).toBe(0.42);
    expect(restored.edits.inpaint.prompt).toBe('blue bottle');
    expect(restored.edits.inpaint.maskRef).toBe('asset-mask');
    expect(restored.edits.inpaint.focused).toBe(true);
    expect(restored.edits.outpaint.expansion).toEqual({ top: 64, right: 128, bottom: 0, left: 64 });
  });

  it('isolates drafts by chain or playground session key', () => {
    const fallback = createLabWorkspaceSession('style', '', '', params, {});
    saveLabWorkspaceSession('chain-a', { ...fallback, textToImage: { ...fallback.textToImage, basePrompt: 'chain a' } });
    saveLabWorkspaceSession('playground', { ...fallback, textToImage: { ...fallback.textToImage, basePrompt: 'playground' } });

    expect(loadLabWorkspaceSession('chain-a', fallback).textToImage.basePrompt).toBe('chain a');
    expect(loadLabWorkspaceSession('playground', fallback).textToImage.basePrompt).toBe('playground');
    expect(loadLabWorkspaceSession('chain-b', fallback).textToImage.basePrompt).toBe('style');
  });

  it('only the laboratory restores image editing modes', () => {
    const session = { ...createLabWorkspaceSession('style', '', '', params, {}), activeMode: 'outpaint' as const };

    expect(scopeLabWorkspaceSessionToEntry('playground', session).activeMode).toBe('outpaint');
    expect(scopeLabWorkspaceSessionToEntry('style-chain', session).activeMode).toBe('text-to-image');
    expect(scopeLabWorkspaceSessionToEntry('character-chain', session).activeMode).toBe('text-to-image');
    expect(session.activeMode).toBe('outpaint');
  });

  it('LAB_DEFAULT_PARAMS 是重置使用的免费边界默认参数', () => {
    expect(LAB_DEFAULT_PARAMS).toMatchObject({
      width: 832,
      height: 1216,
      steps: 28,
      scale: 5,
      sampler: 'k_euler_ancestral',
      qualityToggle: true,
      ucPreset: 4,
    });
    expect(LAB_DEFAULT_PARAMS.seed).toBeUndefined();
    expect(LAB_DEFAULT_PARAMS.characters).toEqual([]);
    // 与新建会话的初始草稿保持一致：重置后编辑草稿应回到该基底。
    const session = createLabWorkspaceSession('', '', '', LAB_DEFAULT_PARAMS, {});
    expect(session.edits.inpaint.params).toMatchObject({ width: 832, height: 1216, steps: 28 });
    expect(session.edits.inpaint.prompt).toBe('');
  });

  it('getLabModeLabel 提供四种生成模式的中文名', () => {
    expect(getLabModeLabel('text-to-image')).toBe('文生图');
    expect(getLabModeLabel('image-to-image')).toBe('图生图');
    expect(getLabModeLabel('inpaint')).toBe('局部重绘');
    expect(getLabModeLabel('outpaint')).toBe('扩图');
  });
});
