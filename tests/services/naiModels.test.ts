import { describe, expect, it } from 'vitest';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';
import { applyNaiModelSettings, getDefaultStepsForModel, getModelFollowDefaultSteps, getRuntimeNaiModelInfo, getSelectableNaiModels } from '../../services/naiModels';

describe('runtime NovelAI model capabilities', () => {
  it.each(['nai-diffusion-5-full-medium', 'nai-diffusion-5-full-medium-inpainting'])('%s 继承 V5 能力，固定设置不覆盖 High 草稿', model => {
    const draft = { model, width: 832, height: 1216, scale: 5, steps: 35, sampler: 'k_euler', cfgRescale: 0.6, ucPresetId: 'light',
      characters: [{ id: 'c', prompt: 'blue hair', negativePrompt: 'red hair', x: 0.2, y: 0.7 }] };
    const snapshot = structuredClone(draft);
    const effective = applyNaiModelSettings(draft, DEFAULT_NAI_RUNTIME);
    expect(effective).toMatchObject({ steps: 14, sampler: 'k_euler_ancestral', cfgRescale: 0, ucPresetId: 'heavy', characters: [{ negativePrompt: '', prompt: 'blue hair' }] });
    expect(draft).toEqual(snapshot);
    const high = { ...draft, model: 'nai-diffusion-5-full' };
    expect(applyNaiModelSettings(high, DEFAULT_NAI_RUNTIME)).toBe(high);
    expect(getRuntimeNaiModelInfo(model, DEFAULT_NAI_RUNTIME)).toMatchObject({ maxCharacters: 32, opusUsageLimit: true, supportsStreamedResponses: true, supportsTransparentBackground: true, supportsVibes: false, supportsCharacterReferences: false });
    expect(getDefaultStepsForModel(model)).toBe(14);
    expect(getSelectableNaiModels(DEFAULT_NAI_RUNTIME).some(item => item.id === model)).toBe(false);
  });

  it('固定设置跟随官方运行时，旧缓存缺少字段仍使用 Medium 限制', () => {
    const model = 'nai-diffusion-5-full-medium';
    const draft = { model, width: 832, height: 1216, steps: 35, scale: 5, sampler: 'k_euler' };
    const runtime = { ...DEFAULT_NAI_RUNTIME, modelCapabilities: { ...DEFAULT_NAI_RUNTIME.modelCapabilities,
      [model]: { ...DEFAULT_NAI_RUNTIME.modelCapabilities[model], fixedSettings: { steps: 16, sampler: 'k_euler', ucPresetId: 'light' } },
    } };
    expect(applyNaiModelSettings(draft, runtime)).toMatchObject({ steps: 16, sampler: 'k_euler', ucPresetId: 'light' });
    expect(applyNaiModelSettings(draft, { ...runtime, modelCapabilities: {} }).steps).toBe(14);
  });

  it('uses the official current limits for V5 and V4.5 Curated', () => {
    const v5 = getRuntimeNaiModelInfo('nai-diffusion-5-full', DEFAULT_NAI_RUNTIME);
    expect(v5.maxCharacters).toBe(32);
    expect(v5.supportsTransparentBackground).toBe(true);
    expect(v5.supportsVibes).toBe(false);

    const curated = getRuntimeNaiModelInfo('nai-diffusion-4-5-curated', DEFAULT_NAI_RUNTIME);
    expect(curated.maxCharacters).toBe(6);
    expect(curated.supportsVibes).toBe(true);
    expect(curated.supportsCharacterReferences).toBe(true);
    expect(curated.supportsCharacterReferenceInpainting).toBe(true);
  });

  it('applies the base-model capability to inpainting variants and future models', () => {
    const v5Edit = getRuntimeNaiModelInfo('nai-diffusion-5-full-inpainting', DEFAULT_NAI_RUNTIME);
    expect(v5Edit.maxCharacters).toBe(32);
    expect(v5Edit.supportsTransparentBackground).toBe(true);

    const futureRuntime = {
      ...DEFAULT_NAI_RUNTIME,
      models: [...DEFAULT_NAI_RUNTIME.models, 'nai-diffusion-6-full'],
      modelCapabilities: {
        ...DEFAULT_NAI_RUNTIME.modelCapabilities,
        'nai-diffusion-6-full': {
          ...DEFAULT_NAI_RUNTIME.modelCapabilities['nai-diffusion-5-full'],
          maxCharacters: 40,
          supportsVibes: true,
        },
      },
    };
    const future = getSelectableNaiModels(futureRuntime).find(model => model.id === 'nai-diffusion-6-full');
    expect(future?.maxCharacters).toBe(40);
    expect(future?.supportsVibes).toBe(true);
  });
});
describe('model default steps on switch', () => {
  it('reports V5 series as 23 steps and other models as 28 steps', () => {
    expect(getDefaultStepsForModel('nai-diffusion-5-full')).toBe(23);
    expect(getDefaultStepsForModel('nai-diffusion-5-curated')).toBe(23);
    expect(getDefaultStepsForModel('nai-diffusion-4-5-full')).toBe(28);
    expect(getDefaultStepsForModel('nai-diffusion-4-full')).toBe(28);
    expect(getDefaultStepsForModel(undefined)).toBe(28);
  });

  it('follows the V5 default when switching to V5 with 28 steps or no steps', () => {
    expect(getModelFollowDefaultSteps('nai-diffusion-5-full', 28)).toBe(23);
    expect(getModelFollowDefaultSteps('nai-diffusion-5-curated', 28)).toBe(23);
    expect(getModelFollowDefaultSteps('nai-diffusion-5-full', undefined)).toBe(23);
  });

  it('follows the 28-step default when switching away from V5 with 23 steps or no steps', () => {
    expect(getModelFollowDefaultSteps('nai-diffusion-4-5-full', 23)).toBe(28);
    expect(getModelFollowDefaultSteps('nai-diffusion-4-5-curated', 23)).toBe(28);
    expect(getModelFollowDefaultSteps('nai-diffusion-4-full', undefined)).toBe(28);
  });

  it('keeps a V5 model on its own 23-step default', () => {
    expect(getModelFollowDefaultSteps('nai-diffusion-5-full', 23)).toBe(23);
  });

  it('preserves custom step values that are neither 23 nor 28', () => {
    expect(getModelFollowDefaultSteps('nai-diffusion-5-full', 16)).toBe(16);
    expect(getModelFollowDefaultSteps('nai-diffusion-4-5-full', 16)).toBe(16);
    expect(getModelFollowDefaultSteps('nai-diffusion-5-full', 35)).toBe(35);
  });

  it('keeps the 28-step default when switching between non-V5 models', () => {
    expect(getModelFollowDefaultSteps('nai-diffusion-4-full', 28)).toBe(28);
    expect(getModelFollowDefaultSteps('nai-diffusion-4-5-full', 28)).toBe(28);
  });
});
