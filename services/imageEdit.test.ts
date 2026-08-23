import { describe, expect, it } from 'vitest';
import { buildImageEditParameters, resolveImageEditModel, validateImageEditDimensions, validateImageEditSampler } from './imageEdit';

describe('image edit helpers', () => {
  it('validates NovelAI canvas dimensions and 64 pixel alignment', () => {
    expect(validateImageEditDimensions(832, 1216)).toBeNull();
    expect(validateImageEditDimensions(833, 1216)).toContain('64');
    expect(validateImageEditDimensions(2048, 2048)).toBeNull();
    expect(validateImageEditDimensions(2048, 2112)).toContain('总像素');
  });

  it('resolves only runtime-advertised inpainting models', () => {
    expect(resolveImageEditModel('nai-diffusion-5-full', ['nai-diffusion-5-full-inpainting'])).toBe('nai-diffusion-5-full-inpainting');
    expect(() => resolveImageEditModel('nai-diffusion-5-full', [])).toThrow();
  });

  it('rejects samplers outside the current image edit capability set', () => {
    expect(() => validateImageEditSampler('ddim')).toThrow('当前采样器不支持图像编辑');
    expect(() => validateImageEditSampler('k_euler_ancestral')).not.toThrow();
  });

  it('encodes image, mask, strength, noise, and focused flags without a data URL prefix', () => {
    expect(buildImageEditParameters('inpaint', 'data:image/png;base64,aW1hZ2U=', 'data:image/png;base64,bWFzaw==', 0.7, 0.2, true)).toEqual({
      image: 'aW1hZ2U=',
      mask: 'bWFzaw==',
      img2img: { strength: 0.7 },
      inpaintImg2ImgStrength: 0.7,
      noise: 0.2,
      add_original_image: true,
      _local_focused_inpainting: true,
    });
  });
});
