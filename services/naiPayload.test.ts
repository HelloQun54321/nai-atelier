import { describe, expect, it } from 'vitest';
import { buildNaiGenerationPayload, withTransparentPromptTags } from './naiPayload';

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
});
