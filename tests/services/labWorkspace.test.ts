// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLabImageEditDraft, createLabWorkspaceSession, deleteLabWorkspaceSession, getLabModeLabel, getLabWorkspaceAssetId, LAB_DEFAULT_PARAMS, loadLabWorkspaceSession, normalizeParams, openLabWorkspaceSession, saveLabWorkspaceSession } from '../../services/labWorkspace';
import { DEFAULT_GENERATION_MEMORY_PREFERENCES, type GenerationMemoryPreferences } from '../../services/appearancePreferences';

const params = {
  model: 'nai-diffusion-4-5-full',
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
};
const noMemory: GenerationMemoryPreferences = { parameters: false, globalPrompt: false, negativePrompt: false, characterPrompt: false, characterNegativePrompt: false };
const privateDraft = () => {
  const session = createLabWorkspaceSession('private-global', 'private-subject', 'private-negative', { ...params, seed: 1234,
    characters: [
      { id: 'shared', prompt: 'private-role-positive', negativePrompt: 'private-role-negative', x: 0.1, y: 0.2, enabled: false },
      { id: 'new', prompt: 'private-new-positive', negativePrompt: 'private-new-negative', x: 0.3, y: 0.4 },
    ], useCoords: true }, { module: false });
  session.activeMode = 'outpaint';
  for (const [index, draft] of Object.values(session.edits).entries()) {
    draft.prompt = `private-edit-global-${index}`; draft.negativePrompt = `private-edit-negative-${index}`;
    draft.strength = 0.42; draft.params.steps = 20 + index;
  }
  return session;
};

describe('lab workspace session', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])('角色分栏重启恢复，参数记忆开启时也不绕过文字选择（记词=%s）', rememberText => {
    const session = privateDraft();
    for (const draft of [session.textToImage, ...Object.values(session.edits)]) {
      draft.params.characters![0].sections = { appearance: 'private-section-positive' };
      draft.params.characters![0].sectionMeta = { appearance: { entryName: 'private-source' } };
      draft.params.characters![0].sectionNegatives = { appearance: 'private-section-negative' };
      draft.params._promptSections = { scene: 'private-scene', sectionNegatives: { scene: 'private-scene-negative' } };
    }
    const memory = { ...noMemory, parameters: true, globalPrompt: rememberText, negativePrompt: rememberText,
      characterPrompt: rememberText, characterNegativePrompt: rememberText };
    saveLabWorkspaceSession('playground', session, true, memory);
    const raw = localStorage.getItem('nai-lab-workspace-v1:playground')!;
    expect(raw.includes('private-section-positive')).toBe(rememberText);
    expect(raw.includes('private-section-negative')).toBe(rememberText);
    expect(raw.includes('private-source')).toBe(rememberText);
    expect(raw.includes('private-scene-negative')).toBe(rememberText);
    sessionStorage.clear();
    const restored = openLabWorkspaceSession('playground', createLabWorkspaceSession('', '', '', params, {}), true, memory);
    for (const draft of [restored.textToImage, ...Object.values(restored.edits)]) {
      expect(draft.params.characters![0].sections).toEqual(rememberText ? { appearance: 'private-section-positive' } : undefined);
      expect(draft.params.characters![0].sectionNegatives).toEqual(rememberText ? { appearance: 'private-section-negative' } : undefined);
      expect(draft.params._promptSections?.sectionNegatives).toEqual(rememberText ? { scene: 'private-scene-negative' } : undefined);
    }
  });

  it('只记正向分栏时不保存分类负面，旧全量副本也按当前范围读取', () => {
    const session = privateDraft();
    session.textToImage.params._promptSections = { scene: 'night', sectionNegatives: { scene: 'private-scene-negative' } };
    const memory = { ...noMemory, globalPrompt: true };
    saveLabWorkspaceSession('playground', session, true, memory);
    expect(localStorage.getItem('nai-lab-workspace-v1:playground')).not.toContain('private-scene-negative');
    sessionStorage.clear();
    localStorage.setItem('nai-lab-workspace-v1:playground', JSON.stringify(session));
    expect(openLabWorkspaceSession('playground', createLabWorkspaceSession('', '', '', params, {}), true, memory)
      .textToImage.params._promptSections?.sectionNegatives).toBeUndefined();
  });

  it('只记参数时四模式不存任何提示词、主体或模块启用，保留角色参数与模式', () => {
    const session = privateDraft();
    const fallback = createLabWorkspaceSession('', '', '', params, {});
    const memory = { ...noMemory, parameters: true };
    saveLabWorkspaceSession('playground', session, true, memory);
    const raw = localStorage.getItem('nai-lab-workspace-v1:playground')!;
    expect(raw).not.toContain('private-'); expect(raw).not.toContain('activeModules');
    expect(raw).not.toContain('subjectPrompt'); expect(raw).not.toContain('negativePrompt');
    sessionStorage.clear();
    const restored = openLabWorkspaceSession('playground', fallback, true, memory);
    expect(restored.activeMode).toBe('outpaint');
    expect(restored.textToImage).toMatchObject({ basePrompt: '', subjectPrompt: '', negativePrompt: '', activeModules: {} });
    expect(restored.textToImage.params.steps).toBe(28);
    for (const [index, operation] of (['image-to-image', 'inpaint', 'outpaint'] as const).entries()) {
      expect(restored.edits[operation].params.steps).toBe(20 + index);
    }
    for (const draft of [restored.textToImage, ...Object.values(restored.edits)]) {
      expect(draft.params).toMatchObject({ seed: 1234, useCoords: true, characters: [
        { id: 'shared', prompt: '', x: 0.1, y: 0.2, enabled: false }, { id: 'new', prompt: '', x: 0.3, y: 0.4 },
      ] });
      expect(draft.params.characters!.every(role => !role.negativePrompt)).toBe(true);
    }
    for (const draft of Object.values(restored.edits)) expect(draft).toMatchObject({ prompt: '', negativePrompt: '', strength: 0.42 });
  });

  it.each(['globalPrompt', 'negativePrompt', 'characterPrompt', 'characterNegativePrompt'] as const)('仅记住 %s 时独立恢复四模式所选词，其余文字与参数用默认值', field => {
    const session = privateDraft();
    const fallback = createLabWorkspaceSession('', '', '', params, {});
    const memory = { ...noMemory, [field]: true };
    saveLabWorkspaceSession('playground', session, true, memory);
    const raw = localStorage.getItem('nai-lab-workspace-v1:playground')!;
    for (const [name, word] of [['globalPrompt', 'private-global'], ['negativePrompt', 'private-negative'],
      ['characterPrompt', 'private-role-positive'], ['characterNegativePrompt', 'private-role-negative']] as const) {
      expect(raw.includes(word)).toBe(name === field);
    }
    expect(raw).not.toContain('1234'); expect(raw).not.toContain('"activeMode"'); expect(raw).not.toContain('"strength"');
    expect(raw.includes('private-subject')).toBe(field === 'globalPrompt');
    expect(raw.includes('activeModules')).toBe(field === 'globalPrompt');
    sessionStorage.clear();
    const restored = openLabWorkspaceSession('playground', fallback, true, memory);
    expect(restored.activeMode).toBe('text-to-image');
    expect(restored.textToImage.basePrompt).toBe(field === 'globalPrompt' ? 'private-global' : '');
    expect(restored.textToImage.subjectPrompt).toBe(field === 'globalPrompt' ? 'private-subject' : '');
    expect(restored.textToImage.negativePrompt).toBe(field === 'negativePrompt' ? 'private-negative' : '');
    for (const [index, operation] of (['image-to-image', 'inpaint', 'outpaint'] as const).entries()) {
      expect(restored.edits[operation].prompt).toBe(field === 'globalPrompt' ? `private-edit-global-${index}` : '');
      expect(restored.edits[operation].negativePrompt).toBe(field === 'negativePrompt' ? `private-edit-negative-${index}` : '');
      expect(restored.edits[operation].strength).toBe(fallback.edits[operation].strength);
    }
    for (const draft of [restored.textToImage, ...Object.values(restored.edits)]) {
      expect(draft.params.seed).toBeUndefined(); expect(draft.params.steps).toBe(28); expect(draft.params.useCoords).toBe(false);
      if (field === 'characterPrompt' || field === 'characterNegativePrompt') {
        expect(draft.params.characters).toHaveLength(2);
        expect(draft.params.characters![0]).toMatchObject({ id: 'shared', x: 0.5, y: 0.5, prompt: field === 'characterPrompt' ? 'private-role-positive' : '' });
        expect(draft.params.characters![0].negativePrompt).toBe(field === 'characterNegativePrompt' ? 'private-role-negative' : undefined);
        expect(draft.params.characters![0].enabled).toBeUndefined();
      } else expect(draft.params.characters).toEqual([]);
    }
  });

  it('读取旧全量记忆按当前范围过滤，未勾选部分恢复本预设原值，新角色不挪用其他角色文本', () => {
    const session = privateDraft();
    const fallback = createLabWorkspaceSession('preset global', 'preset subject', 'preset negative', { ...params, seed: 2,
      characters: [{ id: 'other', prompt: 'other preset role', negativePrompt: 'other preset negative', x: 0.9, y: 0.9 },
        { id: 'shared', prompt: 'preset role', negativePrompt: 'preset role negative', x: 0.7, y: 0.8, enabled: true }] }, { module: true });
    localStorage.setItem('nai-lab-workspace-v1:style', JSON.stringify(session));
    for (const parameters of [false, true]) {
      const memory = { ...noMemory, characterPrompt: true, parameters };
      const restored = openLabWorkspaceSession('style', fallback, true, memory);
      expect(restored.textToImage).toMatchObject({ basePrompt: 'preset global', subjectPrompt: 'preset subject', negativePrompt: 'preset negative', activeModules: { module: true } });
      expect(restored.activeMode).toBe(parameters ? 'outpaint' : 'text-to-image');
      for (const draft of [restored.textToImage, ...Object.values(restored.edits)]) {
        expect(draft.params.seed).toBe(parameters ? 1234 : 2);
        expect(draft.params.characters![0]).toMatchObject({ id: 'shared', prompt: 'private-role-positive', negativePrompt: 'preset role negative',
          x: parameters ? 0.1 : 0.7, y: parameters ? 0.2 : 0.8, enabled: !parameters });
        expect(draft.params.characters![1]).toMatchObject({ id: 'new', prompt: 'private-new-positive', x: parameters ? 0.3 : 0.5, y: parameters ? 0.4 : 0.5 });
        expect(draft.params.characters![1].negativePrompt).toBeUndefined();
      }
      for (const operation of ['image-to-image', 'inpaint', 'outpaint'] as const) {
        expect(restored.edits[operation].prompt).toBe(fallback.edits[operation].prompt);
        expect(restored.edits[operation].negativePrompt).toBe('preset negative');
      }
    }
  });

  it('记忆范围只改变持久副本，不裁掉同会话草稿；不同预设的未选字段仍各用原值', () => {
    const session = privateDraft();
    const memory = { ...noMemory, negativePrompt: true };
    for (const id of ['style', 'character']) {
      saveLabWorkspaceSession(id, session, true, memory);
      expect(loadLabWorkspaceSession(id, session, true, noMemory).textToImage).toEqual(session.textToImage);
    }
    sessionStorage.clear();
    for (const id of ['style', 'character']) {
      const fallback = createLabWorkspaceSession(`${id} original`, '', '', params, {});
      expect(loadLabWorkspaceSession(id, fallback, true, memory).textToImage).toMatchObject({ basePrompt: `${id} original`, negativePrompt: 'private-negative' });
    }
    const fallback = createLabWorkspaceSession('original', '', '', params, {});
    saveLabWorkspaceSession('none', session, true, noMemory); sessionStorage.clear();
    const raw = localStorage.getItem('nai-lab-workspace-v1:none')!;
    expect(raw).not.toContain('private-'); expect(raw).not.toContain('1234');
    const restored = loadLabWorkspaceSession('none', fallback, true, noMemory);
    expect(restored).toMatchObject({ activeMode: fallback.activeMode, textToImage: fallback.textToImage });
    for (const operation of ['image-to-image', 'inpaint', 'outpaint'] as const) expect(restored.edits[operation]).toMatchObject({
      prompt: fallback.edits[operation].prompt, negativePrompt: '', params: fallback.edits[operation].params,
      strength: fallback.edits[operation].strength, noise: 0, focused: fallback.edits[operation].focused,
    });
  });

  it('此前只记角色词的副本后来开启参数范围时，缺失的角色位置与启用仍从预设补齐', () => {
    const session = privateDraft();
    const fallback = createLabWorkspaceSession('preset', '', '', { ...params, seed: 2,
      characters: [{ id: 'shared', prompt: 'preset role', negativePrompt: 'preset negative', x: 0.7, y: 0.8, enabled: false }] }, {});
    saveLabWorkspaceSession('style', session, true, { ...noMemory, characterPrompt: true }); sessionStorage.clear();
    const restored = loadLabWorkspaceSession('style', fallback, true, { ...noMemory, parameters: true, characterPrompt: true });
    expect(restored.textToImage.params).toMatchObject({ seed: 2, characters: [
      { id: 'shared', prompt: 'private-role-positive', negativePrompt: 'preset negative', x: 0.7, y: 0.8, enabled: false },
      { id: 'new', prompt: 'private-new-positive', x: 0.5, y: 0.5 },
    ] });
    expect(restored.activeMode).toBe('text-to-image');
  });

  it.each(['playground', 'style-chain', 'character-chain'])('%s 退出清空会话后恢复四模式完整配置，不带旧图片或坐标', key => {
    const fallback = createLabWorkspaceSession('saved', '', '', params, {});
    const session = createLabWorkspaceSession('unsaved', 'subject', 'negative', { ...params, seed: 123, variety: true, cfgRescale: 0.3,
      characters: [{ id: 'role', prompt: 'role text', negativePrompt: 'role negative', x: 0.2, y: 0.8, enabled: false }], useCoords: true,
      vibes: { enabled: true, normalizeStrengths: true, slots: [] }, characterReferences: { enabled: true, slots: [] } }, { light: false });
    session.activeMode = 'outpaint';
    for (const [index, operation] of (['image-to-image', 'inpaint', 'outpaint'] as const).entries()) {
      session.edits[operation] = { ...session.edits[operation], prompt: `${operation} prompt`, negativePrompt: `${operation} negative`,
        params: { ...session.edits[operation].params, model: 'nai-diffusion-5-full', steps: 20 + index, scale: 4 + index, seed: 100 + index,
          transparent: true, transparentWeight: 1.5, alphaMode: 'straight', qualityPresetId: 'custom', ucPresetId: 'none' },
        strength: 0.4, noise: 0.2, brushSize: 32, focused: false, minimumContextArea: 96, imageToImageSizeMode: 'custom', outpaintRatioId: '3:2',
        baseImageRef: 'private-base', maskRef: 'private-mask', resultImageRef: 'private-result', parentHistoryId: 'old-parent', baseImageSource: 'history',
        focusedRect: { x: 1, y: 1, width: 64, height: 64 }, expansion: { top: 64, right: 0, bottom: 0, left: 0 },
        appliedExpansion: { top: 64, right: 0, bottom: 0, left: 0 }, promptSource: 'history' };
    }
    saveLabWorkspaceSession(key, session);
    expect(localStorage.getItem(`nai-lab-workspace-v1:${key}`)).not.toContain('private-');
    sessionStorage.clear();
    const restored = openLabWorkspaceSession(key, fallback);
    expect(restored.activeMode).toBe('outpaint');
    expect(restored.textToImage).toEqual(session.textToImage);
    for (const operation of ['image-to-image', 'inpaint', 'outpaint'] as const) {
      const draft = restored.edits[operation];
      expect(draft.params).toEqual(session.edits[operation].params);
      expect(draft).toMatchObject({ prompt: `${operation} prompt`, negativePrompt: `${operation} negative`, strength: 0.4, noise: 0.2,
        brushSize: 32, focused: false, minimumContextArea: 96, imageToImageSizeMode: 'custom', outpaintRatioId: '3:2', promptSource: 'current',
        expansion: { top: 0, right: 0, bottom: 0, left: 0 } });
      for (const field of ['baseImageRef', 'baseImageSource', 'maskRef', 'resultImageRef', 'parentHistoryId', 'focusedRect', 'appliedExpansion'] as const) expect(draft[field]).toBeUndefined();
    }
  });

  it('关闭不读取或写入跨重启记忆，本会话草稿继续保留；开启记住最新输入', () => {
    const fallback = createLabWorkspaceSession('saved', '', '', params, {});
    const older = createLabWorkspaceSession('old memory', '', '', params, {});
    saveLabWorkspaceSession('style', older);
    sessionStorage.clear();
    const remembered = localStorage.getItem('nai-lab-workspace-v1:style');
    const read = vi.spyOn(Storage.prototype, 'getItem');
    expect(loadLabWorkspaceSession('style', fallback, false)).toEqual(fallback);
    expect(read.mock.instances).not.toContain(localStorage);
    read.mockRestore();
    const current = createLabWorkspaceSession('current input', '', '', params, {});
    current.edits.inpaint.maskRef = 'session-mask';
    const write = vi.spyOn(Storage.prototype, 'setItem');
    saveLabWorkspaceSession('style', current, false);
    expect(write.mock.instances).not.toContain(localStorage);
    expect(localStorage.getItem('nai-lab-workspace-v1:style')).toBe(remembered);
    expect(openLabWorkspaceSession('style', fallback, false).edits.inpaint.maskRef).toBe('session-mask');
    expect(loadLabWorkspaceSession('style', fallback, false).textToImage.basePrompt).toBe('current input');
    saveLabWorkspaceSession('style', current, true);
    sessionStorage.clear();
    expect(loadLabWorkspaceSession('style', fallback).textToImage.basePrompt).toBe('current input');
    expect(loadLabWorkspaceSession('style', fallback, false)).toEqual(fallback);
  });

  it('跨重启的实验室、风格串与自定义角色记忆互相隔离，放弃只清对应草稿', () => {
    const fallback = createLabWorkspaceSession('saved', '', '', params, {});
    for (const key of ['playground', 'style-chain', 'character-chain']) saveLabWorkspaceSession(key, createLabWorkspaceSession(key, '', '', params, {}));
    deleteLabWorkspaceSession('style-chain'); sessionStorage.clear();
    expect(loadLabWorkspaceSession('style-chain', fallback)).toEqual(fallback);
    expect(loadLabWorkspaceSession('playground', fallback).textToImage.basePrompt).toBe('playground');
    expect(loadLabWorkspaceSession('character-chain', fallback).textToImage.basePrompt).toBe('character-chain');
  });

  it('损坏草稿与存储失败不阻断生成，另一个存储仍能保存或清除', () => {
    const fallback = createLabWorkspaceSession('saved', '', '', params, {});
    const session = createLabWorkspaceSession('latest', '', '', params, {});
    saveLabWorkspaceSession('style', session);
    for (const broken of ['invalid', 'null', '{}']) {
      sessionStorage.setItem('nai-lab-workspace-v1:style', broken);
      expect(loadLabWorkspaceSession('style', fallback).textToImage.basePrompt).toBe('latest');
    }
    sessionStorage.clear(); localStorage.setItem('nai-lab-workspace-v1:style', 'invalid');
    expect(loadLabWorkspaceSession('style', fallback)).toEqual(fallback);
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (this === localStorage) throw new Error('synthetic storage full');
      setItem.call(this, key, value);
    });
    expect(saveLabWorkspaceSession('style', session)).toBe(false);
    expect(loadLabWorkspaceSession('style', fallback).textToImage.basePrompt).toBe('latest');
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (this === sessionStorage) throw new Error('synthetic session unavailable');
      setItem.call(this, key, value);
    });
    sessionStorage.clear(); expect(saveLabWorkspaceSession('style', session)).toBe(true);
    expect(loadLabWorkspaceSession('style', fallback).textToImage.basePrompt).toBe('latest');
    const removeItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (this === sessionStorage) throw new Error('synthetic session unavailable');
      removeItem.call(this, key);
    });
    expect(() => deleteLabWorkspaceSession('style')).not.toThrow();
    expect(localStorage.getItem('nai-lab-workspace-v1:style')).toBeNull();
  });

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

  it('旧会话缺少编辑模式时保留文生图文字与参数，其余模式采用默认草稿', () => {
    const fallback = createLabWorkspaceSession('saved', '', '', params, {});
    sessionStorage.setItem('nai-lab-workspace-v1:legacy', JSON.stringify({ textToImage: { basePrompt: 'legacy text', params: { ...params, seed: 123 } } }));
    const restored = loadLabWorkspaceSession('legacy', fallback);
    expect(restored.textToImage).toMatchObject({ basePrompt: 'legacy text', params: { seed: 123 } });
    expect(restored.edits).toEqual(fallback.edits);
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

it('呈现形式正负与来源随草稿保存恢复，旧字段未提供时不添加占位', () => {
  const sections = { presentation: '{two panels}', sectionNegatives: { presentation: 'single panel' }, sectionMeta: { presentation: { source: 'manual', entryName: '双格' } } };
  const session = createLabWorkspaceSession('style', '{two panels}', 'style negative', { ...LAB_DEFAULT_PARAMS, _promptSections: sections }, {});
  saveLabWorkspaceSession('presentation-synthetic', session, true);
  const restored = loadLabWorkspaceSession('presentation-synthetic', createLabWorkspaceSession('', '', '', LAB_DEFAULT_PARAMS, {}));
  expect(restored.textToImage.params._promptSections).toMatchObject(sections);
  expect(restored.textToImage.negativePrompt).toBe('style negative');
  expect(normalizeParams({ ...LAB_DEFAULT_PARAMS, _promptSections: { scene: 'garden' } })._promptSections).not.toHaveProperty('presentation');
});
