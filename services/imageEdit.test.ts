import { describe, expect, it } from 'vitest';
import { buildImageEditParameters, getCenteredImageEditCrop, getContainedImageEditRect, getFocusedImageEditGeometry, getImageEditNormalizationTarget, limitFocusedImageEditRect, normalizeMinimumContextArea, resolveImageEditModel, validateImageEditDimensions, validateImageEditSampler } from './imageEdit';

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
    expect(() => validateImageEditSampler('k_dpmpp_2m')).not.toThrow();
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
      _local_minimum_context_area: 64,
    });
  });

  it('normalizes legacy Focused context values to the official pixel range', () => {
    expect(normalizeMinimumContextArea(undefined)).toBe(64);
    expect(normalizeMinimumContextArea(0.5)).toBe(64);
    expect(normalizeMinimumContextArea(32)).toBe(32);
    expect(normalizeMinimumContextArea(100)).toBe(96);
  });

  it('limits Focused selections and keeps the generated request within one megapixel', () => {
    const limited = limitFocusedImageEditRect(2048, 2048, { x: 0, y: 0, width: 2048, height: 2048 });
    expect(limited.width * limited.height).toBeLessThanOrEqual(589824);
    const geometry = getFocusedImageEditGeometry(2048, 2048, { x: 0, y: 0, width: 2048, height: 2048 }, 64);
    expect(geometry.crop.width * geometry.crop.height).toBeLessThanOrEqual(589824);
    expect(geometry.requestWidth * geometry.requestHeight).toBeLessThanOrEqual(1048576);
    expect(geometry.inner.x).toBeGreaterThanOrEqual(geometry.crop.x);
    expect(geometry.inner.y).toBeGreaterThanOrEqual(geometry.crop.y);
  });

  it('chooses aligned normalization targets and exposes crop/contain geometry', () => {
    expect(getImageEditNormalizationTarget(833, 1216)).toEqual({ width: 832, height: 1216 });
    expect(getImageEditNormalizationTarget(3000, 3000)).toEqual({ width: 2048, height: 2048 });
    expect(getImageEditNormalizationTarget(1024, 1024)).toEqual({ width: 1024, height: 1024 });
    const crop = getCenteredImageEditCrop(1600, 900, 1024, 1024);
    expect(crop.width).toBe(900);
    expect(crop.x).toBe(350);
    const contained = getContainedImageEditRect(1600, 900, 1024, 1024);
    expect(contained.width).toBe(1024);
    expect(contained.height).toBe(576);
    expect(contained.y).toBe(224);
  });
});
