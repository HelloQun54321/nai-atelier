// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ASPECT_RATIOS,
  calculateDimensionsForRatio,
  detectClosestAspectRatio,
  getMaxDimensionsForRatio,
  getMaxScaleForRatio,
  normalizeTo64Step,
  OPUS_FREE_PIXEL_LIMIT,
} from './aspectRatio';

describe('aspectRatio service', () => {
  it('所有内置比例在 1.0x 基准档位下均在 Opus 免费像素上限内且严格为 64 的倍数', () => {
    for (const preset of BUILTIN_ASPECT_RATIOS) {
      expect(preset.baseWidth % 64).toBe(0);
      expect(preset.baseHeight % 64).toBe(0);
      const totalPixels = preset.baseWidth * preset.baseHeight;
      expect(totalPixels).toBeLessThanOrEqual(OPUS_FREE_PIXEL_LIMIT);
    }
  });

  it('按比例和 scale 缩放时正确计算 64 像素对齐的宽高', () => {
    const portrait = BUILTIN_ASPECT_RATIOS.find(p => p.id === '2:3')!;
    // 1.0x
    const res1 = calculateDimensionsForRatio(portrait, 1.0);
    expect(res1).toEqual({ width: 832, height: 1216 });

    // 1.25x (832*1.25=1040->1024, 1216*1.25=1520->1536)
    const res125 = calculateDimensionsForRatio(portrait, 1.25);
    expect(res125.width % 64).toBe(0);
    expect(res125.height % 64).toBe(0);
    expect(res125).toEqual({ width: 1024, height: 1536 });

    // 1.5x (832*1.5=1248->1280, 1216*1.5=1824->1856)
    const resLarge = calculateDimensionsForRatio(portrait, 1.5);
    expect(resLarge.width % 64).toBe(0);
    expect(resLarge.height % 64).toBe(0);
    expect(resLarge).toEqual({ width: 1280, height: 1856 });
  });

  it('按 2.0x 或大比例缩放时严格钳制在单边 2048 像素及总面积 3,145,728 像素内', () => {
    // 9:16 (768x1344) at 2.0x -> max is 1152x2048
    const phone = BUILTIN_ASPECT_RATIOS.find(p => p.id === '9:16')!;
    const resPhone = calculateDimensionsForRatio(phone, 2.0);
    expect(resPhone.width).toBeLessThanOrEqual(2048);
    expect(resPhone.height).toBeLessThanOrEqual(2048);
    expect(resPhone.width * resPhone.height).toBeLessThanOrEqual(3145728);
    expect(resPhone.height).toBe(2048);
    expect(resPhone.width % 64).toBe(0);

    // 1:2 (704x1408) at 2.0x
    const tall = BUILTIN_ASPECT_RATIOS.find(p => p.id === '1:2')!;
    const resTall = calculateDimensionsForRatio(tall, 2.0);
    expect(resTall.width).toBeLessThanOrEqual(2048);
    expect(resTall.height).toBeLessThanOrEqual(2048);
    expect(resTall.width * resTall.height).toBeLessThanOrEqual(3145728);
    expect(resTall.height).toBe(2048);
  });

  it('getMaxDimensionsForRatio 准确计算每个画幅比例的自适应最大安全上限', () => {
    // 1:2 (704x1408) -> max is 1024x2048, maxScale approx 1.45
    const tall = BUILTIN_ASPECT_RATIOS.find(p => p.id === '1:2')!;
    const maxTall = getMaxDimensionsForRatio(tall);
    expect(maxTall.width).toBe(1024);
    expect(maxTall.height).toBe(2048);
    expect(maxTall.maxScale).toBe(1.45);
    expect(getMaxScaleForRatio(tall)).toBe(1.45);

    // 1:1 (1024x1024) -> max is 1728x1728, maxScale approx 1.69
    const square = BUILTIN_ASPECT_RATIOS.find(p => p.id === '1:1')!;
    const maxSquare = getMaxDimensionsForRatio(square);
    expect(maxSquare.width).toBe(1728);
    expect(maxSquare.height).toBe(1728);
    expect(maxSquare.maxScale).toBe(1.69);

    // 3:4 (896x1152) -> max is 1536x1984, maxScale approx 1.72
    const standard = BUILTIN_ASPECT_RATIOS.find(p => p.id === '3:4')!;
    const maxStandard = getMaxDimensionsForRatio(standard);
    expect(maxStandard.width).toBe(1536);
    expect(maxStandard.height).toBe(1984);
    expect(maxStandard.maxScale).toBe(1.72);
  });

  it('normalizeTo64Step 确保尺寸在 64-2048 之间并对齐 64', () => {
    expect(normalizeTo64Step(0)).toBe(64);
    expect(normalizeTo64Step(100)).toBe(128);
    expect(normalizeTo64Step(5000)).toBe(2048);
    expect(normalizeTo64Step(832)).toBe(832);
  });

  it('detectClosestAspectRatio 能正确识别已知宽高对应的比例与倍率', () => {
    const detected = detectClosestAspectRatio(1024, 1024);
    expect(detected.preset.id).toBe('1:1');
    expect(detected.scale).toBe(1.0);

    const detectedWallpaper = detectClosestAspectRatio(768, 1344);
    expect(detectedWallpaper.preset.id).toBe('9:16');
    expect(detectedWallpaper.scale).toBe(1.0);

    const custom = detectClosestAspectRatio(1333, 444);
    expect(custom.preset).toBeTruthy();
    expect(custom.scale).toBeGreaterThanOrEqual(1.0);
  });
});
