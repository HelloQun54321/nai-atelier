import { describe, expect, it } from 'vitest';
import { DEFAULT_NAI_RUNTIME } from './naiRuntime';
import { getDefaultStepsForModel, getModelFollowDefaultSteps, getRuntimeNaiModelInfo, getSelectableNaiModels } from './naiModels';

describe('runtime NovelAI model capabilities', () => {
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
