import { describe, expect, it } from 'vitest';
import { DEFAULT_NAI_RUNTIME } from './naiRuntime';
import { getRuntimeNaiModelInfo, getSelectableNaiModels } from './naiModels';

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
