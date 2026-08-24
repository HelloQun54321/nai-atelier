import { describe, expect, it } from 'vitest';
import { buildNaiGenerationPayload, buildNaiImageEditPayload, withTransparentPromptTags } from './naiPayload';

const baseParams = {
  model: 'nai-diffusion-5-full', width: 832, height: 1216, steps: 28,
  scale: 5, sampler: 'k_euler_ancestral', qualityToggle: false, ucPreset: 4,
};

describe('NovelAI generation payload', () => {
  it('adds V5 alpha fields and transparent tags without changing the source prompt', () => {
    const prompt = '1girl, solo';
    const payload = buildNaiGenerationPayload(prompt, '', { ...baseParams, transparent: true });
    expect(prompt).toBe('1girl, solo');
    expect(payload.input).toBe('1girl, solo, transparent background, has alpha');
    expect(payload.parameters.tag_hint_transparent_background).toBe(true);
    expect(payload.parameters.straight_alpha).toBe(true);
  });

  it('does not duplicate existing transparent tags', () => {
    expect(withTransparentPromptTags('1girl, 2.1::transparent background::, has alpha'))
      .toBe('1girl, 2.1::transparent background::, has alpha');
  });

  it('strips unsupported alpha fields from older models while allowing their official stream capability', () => {
    const payload = buildNaiGenerationPayload('1girl', '', {
      ...baseParams, model: 'nai-diffusion-4-5-full', transparent: true,
    }, { stream: true });
    expect(payload.parameters.tag_hint_transparent_background).toBeUndefined();
    expect(payload.parameters.straight_alpha).toBeUndefined();
    expect(payload.parameters.stream).toBe('sse');
  });

  it('enables SSE only on streamed models', () => {
    const payload = buildNaiGenerationPayload('1girl', '', baseParams, { stream: true });
    expect(payload.parameters.stream).toBe('sse');
  });

  it('requires a runtime capability before streaming an unknown future model', () => {
    const params = { ...baseParams, model: 'nai-diffusion-6-full' };
    expect(buildNaiGenerationPayload('1girl', '', params, { stream: true }).parameters.stream).toBeUndefined();
    expect(buildNaiGenerationPayload('1girl', '', params, { stream: true, runtimeStreamSupported: true }).parameters.stream).toBe('sse');
  });

  it('builds an img2img payload with strength and noise while preserving normal prompts', () => {
    const payload = buildNaiImageEditPayload('1girl', 'bad hands', baseParams, {
      operation: 'image-to-image', image: 'data:image/png;base64,aW1hZ2U=', strength: 0.65, noise: 0.2,
      runtimeModels: ['nai-diffusion-5-full-inpainting'],
    });
    const editParameters = payload.parameters as Record<string, any>;
    expect(payload.action).toBe('img2img');
    expect(payload.model).toBe('nai-diffusion-5-full');
    expect(editParameters.image).toBe('aW1hZ2U=');
    expect(editParameters.strength).toBe(0.65);
    expect(editParameters.noise).toBe(0.2);
    expect(editParameters.add_original_image).toBe(true);
  });

  it('builds an inpainting payload with a mask and inpainting model capability', () => {
    const payload = buildNaiImageEditPayload('1girl', '', { ...baseParams, model: 'nai-diffusion-4-5-full' }, {
      operation: 'inpaint', image: 'data:image/png;base64,aW1hZ2U=', mask: 'data:image/png;base64,bWFzaw==',
      strength: 0.8, noise: 0.1, runtimeModels: ['nai-diffusion-4-5-full-inpainting'],
    });
    const editParameters = payload.parameters as Record<string, any>;
    expect(payload.action).toBe('infill');
    expect(payload.model).toBe('nai-diffusion-4-5-full-inpainting');
    expect(editParameters.mask).toBe('bWFzaw==');
    expect(editParameters.img2img).toEqual({ strength: 0.8 });
    expect(editParameters.inpaintImg2ImgStrength).toBe(0.8);
  });

  it('builds outpainting as ordinary infill without the Focused marker', () => {
    const payload = buildNaiImageEditPayload('landscape', '', baseParams, {
      operation: 'outpaint', image: 'data:image/png;base64,aW1hZ2U=', mask: 'data:image/png;base64,bWFzaw==',
      strength: 1, noise: 0, focused: true, minimumContextArea: 0.5, runtimeModels: ['nai-diffusion-5-full-inpainting'],
    });
    const editParameters = payload.parameters as Record<string, any>;
    expect(payload.action).toBe('infill');
    expect(payload.model).toBe('nai-diffusion-5-full-inpainting');
    expect(editParameters._local_edit_operation).toBe('outpaint');
    expect(editParameters._local_focused_inpainting).toBeUndefined();
    expect(editParameters._local_minimum_context_area).toBeUndefined();
  });

  it('normalizes legacy Focused context values only for inpainting', () => {
    const payload = buildNaiImageEditPayload('1girl', '', baseParams, {
      operation: 'inpaint', image: 'data:image/png;base64,aW1hZ2U=', mask: 'data:image/png;base64,bWFzaw==',
      strength: 1, noise: 0, focused: true, minimumContextArea: 0.5, runtimeModels: ['nai-diffusion-5-full-inpainting'],
    });
    const editParameters = payload.parameters as Record<string, any>;
    expect(editParameters._local_focused_inpainting).toBe(true);
    expect(editParameters._local_minimum_context_area).toBe(64);
  });

  it('uses model-specific runtime presets and never injects the removed nsfw tag', () => {
    const v5 = buildNaiGenerationPayload('1girl', '', {
      ...baseParams,
      qualityToggle: undefined,
      ucPreset: undefined,
      qualityPresetId: 'light',
      ucPresetId: 'light',
    });
    expect(v5.parameters.qualityPresetId).toBe('light');
    expect(v5.parameters.ucPresetId).toBe('light');
    expect(v5.input).toContain('amazing quality');
    const v5Negative = (v5.parameters.v4_negative_prompt as any).caption.base_caption as string;
    expect(v5Negative).toContain('bad hands');
    expect(v5Negative).not.toContain('nsfw');

    const curated = buildNaiGenerationPayload('1girl', '', {
      ...baseParams,
      model: 'nai-diffusion-4-5-curated',
      qualityToggle: undefined,
      ucPreset: undefined,
      qualityPresetId: 'standard',
      ucPresetId: 'humanFocus',
    });
    expect(curated.input).toContain('rating:general');
    expect((curated.parameters.v4_negative_prompt as any).caption.base_caption).toContain('bad anatomy');
  });

  it('transforms character centers before a Focused local request', () => {
    const payload = buildNaiImageEditPayload('1girl', '', {
      ...baseParams,
      characters: [{ id: 'c1', prompt: 'girl', x: 0.5, y: 0.5 }],
    }, {
      operation: 'inpaint',
      image: 'data:image/png;base64,aW1hZ2U=',
      mask: 'data:image/png;base64,bWFzaw==',
      strength: 0.8,
      noise: 0.1,
      focused: true,
      focusedGeometry: {
        crop: { x: 200, y: 100, width: 400, height: 300 },
        inner: { x: 264, y: 164, width: 272, height: 172 },
        requestWidth: 768,
        requestHeight: 576,
        fullSizeMask: false,
      },
      sourceWidth: 1000,
      sourceHeight: 800,
      runtimeModels: ['nai-diffusion-5-full-inpainting'],
    });
    const captions = (payload.parameters as any).v4_prompt.caption.char_captions;
    expect(captions[0].centers[0]).toEqual({ x: 0.75, y: 1 });
  });

  it('does not send retained Vibe selections for inpainting or outpainting', () => {
    const payload = buildNaiImageEditPayload('1girl', '', {
      ...baseParams,
      vibes: { enabled: true, normalizeStrengths: true, slots: [{ vibeId: 'v1', encodingId: 'e1', informationExtracted: 1, strength: 0.6 }] },
    }, {
      operation: 'outpaint',
      image: 'data:image/png;base64,aW1hZ2U=',
      mask: 'data:image/png;base64,bWFzaw==',
      strength: 1,
      noise: 0,
      runtimeModels: ['nai-diffusion-5-full-inpainting'],
    });
    expect((payload.parameters as any)._local_vibes).toBeUndefined();
  });

  it('rejects an edit when the runtime does not expose the inpainting variant', () => {
    expect(() => buildNaiImageEditPayload('1girl', '', baseParams, {
      operation: 'inpaint', image: 'data:image/png;base64,aW1hZ2U=', mask: 'data:image/png;base64,bWFzaw==',
      strength: 1, noise: 0, runtimeModels: [],
    })).toThrow('当前模型不支持图像编辑');
  });
});
