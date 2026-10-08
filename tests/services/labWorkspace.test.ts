// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createLabImageEditDraft, createLabWorkspaceSession, getLabModeLabel, getLabWorkspaceAssetId, LAB_DEFAULT_PARAMS, loadLabWorkspaceSession, normalizeParams, openLabWorkspaceSession, saveLabWorkspaceSession } from '../../services/labWorkspace';

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

  it('图生图输出尺寸选择随草稿恢复，旧草稿保持原尺寸，其他模式互不干扰', () => {
    const session = createLabWorkspaceSession('', '', '', params, {});
    session.edits['image-to-image'].imageToImageSizeMode = 'custom';
    session.edits['image-to-image'].params = { ...params, width: 1024, height: 1024 };
    saveLabWorkspaceSession('sizes', session);
    expect(openLabWorkspaceSession('sizes', session).edits['image-to-image']).toMatchObject({ imageToImageSizeMode: 'custom', params: { width: 1024, height: 1024 } });
    expect(openLabWorkspaceSession('sizes', session).edits.inpaint.params.width).toBe(832);
    delete session.edits['image-to-image'].imageToImageSizeMode;
    saveLabWorkspaceSession('sizes', session);
    expect(loadLabWorkspaceSession('sizes', session).edits['image-to-image'].imageToImageSizeMode).toBe('original');
  });

  it('新建与重置共用的草稿仅为局部重绘默认开启聚焦', () => {
    const session = createLabWorkspaceSession('', '', '', params, {});
    for (const operation of ['image-to-image', 'inpaint', 'outpaint'] as const) {
      expect(createLabImageEditDraft(operation, '', '', params).focused).toBe(operation === 'inpaint');
      expect(session.edits[operation].focused).toBe(operation === 'inpaint');
    }
    expect(createLabImageEditDraft('inpaint', '', '', params, { focused: false }).focused).toBe(false);
  });

  it.each([false, true])('复开草稿保留明确保存的聚焦选择 %s', focused => {
    const session = createLabWorkspaceSession('', '', '', params, {});
    session.edits.inpaint.focused = focused;
    for (const key of ['playground', 'style-chain', 'character-chain']) {
      saveLabWorkspaceSession(key, session);
      expect(openLabWorkspaceSession(key, createLabWorkspaceSession('', '', '', params, {})).edits.inpaint.focused).toBe(focused);
    }
  });

  it('旧草稿缺少聚焦字段时采用局部重绘的新默认值', () => {
    const session = createLabWorkspaceSession('', '', '', params, {});
    const { focused: _focused, ...legacyDraft } = session.edits.inpaint;
    sessionStorage.setItem('nai-lab-workspace-v1:legacy', JSON.stringify({ ...session, edits: { ...session.edits, inpaint: legacyDraft } }));
    expect(loadLabWorkspaceSession('legacy', session).edits.inpaint.focused).toBe(true);
  });

  it('自由实验室复开隔离全部旧图片及关联坐标，保留各模式文字参数且不改原草稿', () => {
    const session = createLabWorkspaceSession('base', 'subject', 'negative', params, { light: true });
    session.activeMode = 'outpaint';
    for (const operation of ['image-to-image', 'inpaint', 'outpaint'] as const) {
      session.edits[operation] = { ...session.edits[operation], prompt: `draft-${operation}`, strength: 0.4,
        baseImageRef: 'base', baseImageSource: 'history', parentHistoryId: 'parent', maskRef: 'mask', resultImageRef: 'result',
        promptSource: 'history', expansion: { top: 64, right: 128, bottom: 0, left: 0 },
        appliedExpansion: { top: 0, right: 128, bottom: 0, left: 0 }, focusedRect: { x: 64, y: 64, width: 128, height: 128 } };
    }
    saveLabWorkspaceSession('playground', session);
    const opened = openLabWorkspaceSession('playground', session);
    expect(opened.activeMode).toBe('outpaint');
    expect(opened.textToImage).toEqual(session.textToImage);
    for (const operation of ['image-to-image', 'inpaint', 'outpaint'] as const) {
      const draft = opened.edits[operation];
      expect(draft).toMatchObject({ prompt: `draft-${operation}`, params: session.edits[operation].params, strength: 0.4,
        expansion: { top: 0, right: 0, bottom: 0, left: 0 }, promptSource: 'current' });
      for (const key of ['baseImageRef', 'baseImageSource', 'parentHistoryId', 'maskRef', 'resultImageRef', 'appliedExpansion', 'focusedRect'] as const) {
        expect(draft[key]).toBeUndefined();
        expect(session.edits[operation][key]).toBeDefined();
      }
    }
    expect(loadLabWorkspaceSession('playground', session).edits.inpaint.resultImageRef).toBe('result');
    saveLabWorkspaceSession('preset', session);
    expect(openLabWorkspaceSession('preset', session)).toEqual(loadLabWorkspaceSession('preset', session));
  });

  it('透明权重随草稿保存恢复，四模式独立，旧数据不强制覆盖原提示词权重', () => {
    const fallback = createLabWorkspaceSession('original', '', '', params, {});
    const session = createLabWorkspaceSession('transparent subject', '', '', { ...params, model: 'nai-diffusion-5-full', transparent: true, transparentWeight: 2.1 }, {});
    session.edits.inpaint.params.transparentWeight = 1.6;
    saveLabWorkspaceSession('alpha-weight', session);
    const restored = loadLabWorkspaceSession('alpha-weight', fallback);
    expect(restored.textToImage.params).toMatchObject({ transparent: true, transparentWeight: 2.1 });
    expect(restored.edits.inpaint.params.transparentWeight).toBe(1.6);
    expect(restored.edits.outpaint.params.transparentWeight).toBe(2.1);
    expect(normalizeParams(params).transparentWeight).toBeUndefined();
    expect(normalizeParams({ ...params, transparentWeight: 8 }).transparentWeight).toBe(3);
  });

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
