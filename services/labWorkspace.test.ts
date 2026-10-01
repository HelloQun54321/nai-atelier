// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createLabWorkspaceSession, getLabModeLabel, getLabWorkspaceAssetId, LAB_DEFAULT_PARAMS, loadLabWorkspaceSession, normalizeParams, saveLabWorkspaceSession } from './labWorkspace';

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

  it('四模式默认自动构图，旧角色启用语义兼容，停用／排序／自由坐标随草稿恢复', () => {
    const characters = [
      { id: 'b', prompt: 'second', negativePrompt: 'negative b', x: 0.223, y: 0.887, enabled: false },
      { id: 'a', prompt: 'first', negativePrompt: 'negative a', x: 0.5, y: 0.5 },
    ];
    const automatic = createLabWorkspaceSession('', '', '', { ...params, characters }, {});
    expect(automatic.textToImage.params.useCoords).toBe(false);
    for (const draft of Object.values(automatic.edits)) expect(draft.params.useCoords).toBe(false);
    const session = createLabWorkspaceSession('', '', '', { ...params, characters, useCoords: true }, {});
    saveLabWorkspaceSession('roles', session);
    const restored = loadLabWorkspaceSession('roles', automatic);
    for (const draft of [restored.textToImage, ...Object.values(restored.edits)]) {
      expect(draft.params.characters).toEqual(characters);
      expect(draft.params.useCoords).toBe(true);
    }
    expect(restored.edits.outpaint.params.characters).not.toBe(restored.textToImage.params.characters);
    expect(normalizeParams({ ...params, characters: [{ ...characters[0], x: NaN, y: Infinity }] }).characters?.[0]).toMatchObject({ x: 0.5, y: 0.5 });
  });

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

  it('扩图保留本轮原图、已应用尺寸与待调整尺寸，旧画布不重复套用扩展', () => {
    const fallback = createLabWorkspaceSession('', '', '', params, {});
    const applied = { top: 128, bottom: 192, left: 0, right: 0 };
    const pending = { ...applied, bottom: 256 };
    const session = { ...fallback, edits: { ...fallback.edits, outpaint: {
      ...fallback.edits.outpaint, baseImageRef: 'original', maskRef: 'mask',
      expansion: pending, appliedExpansion: applied, outpaintRatioId: 'custom',
    } } };
    saveLabWorkspaceSession('new-outpaint', session);
    expect(loadLabWorkspaceSession('new-outpaint', fallback).edits.outpaint).toMatchObject({
      baseImageRef: 'original', maskRef: 'mask', expansion: pending, appliedExpansion: applied, outpaintRatioId: 'custom',
    });
    // 旧草稿已经把白边存入 base；只消除过期计划，不裁剪底图、不丢弃蒙版。
    saveLabWorkspaceSession('old-outpaint', { ...session, edits: { ...session.edits, outpaint: {
      ...session.edits.outpaint, appliedExpansion: undefined, outpaintRatioId: undefined,
    } } });
    expect(loadLabWorkspaceSession('old-outpaint', fallback).edits.outpaint).toMatchObject({
      baseImageRef: 'original', maskRef: 'mask', expansion: { top: 0, bottom: 0, left: 0, right: 0 }, outpaintRatioId: 'custom',
    });
  });

  it('所有工作台入口均恢复各自模式，新工作台默认文生图', () => {
    const session = { ...createLabWorkspaceSession('style', '', '', params, {}), activeMode: 'outpaint' as const };
    for (const key of ['playground', 'style-chain', 'character-chain']) {
      saveLabWorkspaceSession(key, session);
      expect(loadLabWorkspaceSession(key, createLabWorkspaceSession('', '', '', params, {})).activeMode).toBe('outpaint');
    }
    expect(loadLabWorkspaceSession('new-chain', createLabWorkspaceSession('', '', '', params, {})).activeMode).toBe('text-to-image');
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
