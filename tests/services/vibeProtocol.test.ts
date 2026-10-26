import { describe, expect, it } from 'vitest';
import { defaultVibeInformation, normalizeReferenceStrengths, vibeBaseModel, vibeModelKey } from '../../services/vibeProtocol.mjs';

describe('官方 Vibe 模型与强度语义', () => {
  it('每个模型使用独立编码键，重绘型号回到基础模型，默认值按模型区分', () => {
    expect(vibeModelKey('nai-diffusion-4-5-full-inpainting')).toBe('v4-5full');
    expect(vibeModelKey('nai-diffusion-4-curated-preview')).toBe('v4curated');
    expect(vibeModelKey('nai-diffusion-4-curated-inpainting')).toBe('v4curated');
    expect(vibeModelKey('nai-diffusion-4-5-curated')).toBe('v4-5curated');
    expect(vibeBaseModel('nai-diffusion-5-full-medium')).toBe('nai-diffusion-5-full');
    expect(defaultVibeInformation('nai-diffusion-4-5-full')).toBe(0.7);
    expect(defaultVibeInformation('nai-diffusion-4-full')).toBe(1);
  });

  it('按绝对值总和归一化，单参考、零值、关闭归一化时保留原始输入', () => {
    expect(normalizeReferenceStrengths([1.5, -0.5])).toEqual([0.75, -0.25]);
    expect(normalizeReferenceStrengths([2])).toEqual([2]);
    expect(normalizeReferenceStrengths([0, 0])).toEqual([0, 0]);
    expect(normalizeReferenceStrengths([0.2, -0.3])).toEqual([0.2, -0.3]);
    expect(normalizeReferenceStrengths([1.5, -0.5], false)).toEqual([1.5, -0.5]);
  });
});
