import { describe, expect, it } from 'vitest';
import { createLabImageEditDraft } from '../../services/labWorkspace';
import { appendTagsToImageEditDraft, buildImageEditMetadataPatch, buildPromptFragmentPatch, canSaveLabModeToLibrary, mergePresetSettings, placeTagsInCharacterSlot } from '../../services/labModeTools';
import type { CharacterParams } from '../../types';

const params = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  qualityToggle: true,
  ucPreset: 4,
};

describe('外部片段取用', () => {
  const current = { prompt: 'scene', negativePrompt: 'bad', params: { ...params, seed: 77, model: 'nai-diffusion-4-5-full', characters: [{ id: 'old', prompt: 'old role', x: 0.2, y: 0.8 }] } };
  it('追加保留权重、顺序、重复词、负面和参数', () => {
    const patch = buildPromptFragmentPatch(current, { mode: 'prompt-fragments', prompt: '{{artist:a}}, scene' });
    expect(patch).toEqual({ prompt: 'scene, {{artist:a}}, scene' });
  });
  it('替换只有角色时保留全局词和参考，设置不隐式导入 Seed 或模型', () => {
    const character = { id: 'new', prompt: '', negativePrompt: 'hat', x: 0.5, y: 0.5 };
    const patch = buildPromptFragmentPatch(current, { mode: 'prompt-fragments', characters: [character], replace: true, importSettings: true, params: { steps: 20, seed: 88, model: 'nai-diffusion-5-full-high' } });
    expect(patch.prompt).toBeUndefined(); expect(patch.negativePrompt).toBeUndefined();
    expect(patch.params).toMatchObject({ steps: 20, width: params.width, seed: 77, model: current.params.model, characters: [character] });
  });
  it('明确勾选时才能更新 Seed 和模型，空字段可清空，缺失 Seed 保持原值', () => {
    expect(buildPromptFragmentPatch(current, { mode: 'prompt-fragments', replace: true, prompt: '', importSeed: true, importModel: true, params: { seed: 88, model: 'nai-diffusion-5-full-high' } })).toMatchObject({ prompt: '', params: { seed: 88, model: 'nai-diffusion-5-full-high' } });
    expect(buildPromptFragmentPatch(current, { mode: 'prompt-fragments', importSeed: true, params: {} })).toEqual({});
  });
});

describe('元数据参数复用透明度规则', () => {
  it('旧透明配置按自身提示词恢复而非继承当前权重', () => {
    const current = { ...params, transparent: true, transparentWeight: 2.8 };
    expect(mergePresetSettings(current, { ...params, transparent: true }, '1girl, 2.1::transparent background::').transparentWeight).toBe(2.1);
    expect(mergePresetSettings(current, { ...params, transparent: true }, '1girl').transparentWeight).toBe(1);
    expect(mergePresetSettings(current, params).transparentWeight).toBe(2.8);
  });
});

describe('编辑页顶部工具路由', () => {
  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('为 %s 追加反推 Tag 并导入元数据', operation => {
    const current = createLabImageEditDraft(operation, 'old prompt', 'old negative', params);

    expect(appendTagsToImageEditDraft(current, '1girl, blue eyes')).toMatchObject({
      prompt: 'old prompt, 1girl, blue eyes',
      promptSource: 'custom',
    });
    expect(buildImageEditMetadataPatch('new prompt', 'new negative', { ...params, seed: 9 })).toMatchObject({
      prompt: 'new prompt',
      negativePrompt: 'new negative',
      params: { seed: 9 },
      promptSource: 'custom',
    });
  });

  it('只有文生图支持保存到现有预设库', () => {
    expect(canSaveLabModeToLibrary('text-to-image')).toBe(true);
    expect(canSaveLabModeToLibrary('image-to-image')).toBe(false);
    expect(canSaveLabModeToLibrary('inpaint')).toBe(false);
    expect(canSaveLabModeToLibrary('outpaint')).toBe(false);
  });
});

describe('外部反推写进角色提示词', () => {
  const blank = (): CharacterParams => ({ id: 'blank', prompt: '', x: 0.5, y: 0.5 });

  it('优先写空白槽，已写好的角色提示词原样保留', () => {
    const placed = placeTagsInCharacterSlot([
      { id: 'a', prompt: 'blue hair', x: 0.2, y: 0.4 },
      { id: 'b', prompt: '  ', x: 0.8, y: 0.6 },
    ], 'sitting', 2, blank);
    expect(placed).toMatchObject({ slot: 1, created: false });
    expect(placed.characters[0].prompt).toBe('blue hair');
    expect(placed.characters[1].prompt).toBe('sitting');
  });

  it('角色都写满时新增一位，不覆盖已有内容', () => {
    const placed = placeTagsInCharacterSlot([{ id: 'a', prompt: 'blue hair', x: 0.2, y: 0.4 }], 'sitting', 2, blank);
    expect(placed).toMatchObject({ slot: 1, created: true });
    expect(placed.characters[0].prompt).toBe('blue hair');
    expect(placed.characters[1].prompt).toBe('sitting');
  });

  it('槽位达到模型上限时只追加到最后一位，不删角色也不清空提示词', () => {
    const placed = placeTagsInCharacterSlot([{ id: 'a', prompt: 'blue hair', x: 0.2, y: 0.4 }], 'sitting', 1, blank);
    expect(placed).toMatchObject({ slot: 0, created: false });
    expect(placed.characters).toHaveLength(1);
    expect(placed.characters[0].prompt).toBe('blue hair, sitting');
  });
});
