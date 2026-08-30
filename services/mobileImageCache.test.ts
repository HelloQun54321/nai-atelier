import { describe, it, expect } from 'vitest';
import { getMobileOriginalUrl, ratchetVariantWidth, selectThumbnailVariant, thumbnailVariantWidth } from './mobileImageCache';

describe('selectThumbnailVariant', () => {
  it('按像素宽落入正确档位', () => {
    expect(selectThumbnailVariant(100)).toBe('thumb-160');
    expect(selectThumbnailVariant(200)).toBe('thumb-240');
    expect(selectThumbnailVariant(300)).toBe('thumb-320');
    expect(selectThumbnailVariant(450)).toBe('thumb-480');
    expect(selectThumbnailVariant(600)).toBe('thumb-640');
    expect(selectThumbnailVariant(800)).toBe('thumb-960');
    expect(selectThumbnailVariant(0)).toBe('thumb-160'); // 宽度归零（如移动端详情隐藏列表）
  });

  it('thumbnailVariantWidth 与档位名一致', () => {
    expect(thumbnailVariantWidth(100)).toBe(160);
    expect(thumbnailVariantWidth(800)).toBe(960);
  });
});

describe('ratchetVariantWidth 档位棘轮', () => {
  it('详情侧栏挤压（宽度下降）不降档：缓存键保持稳定', () => {
    // 桌面 4 列：卡片 640 档 → 打开详情被挤压到 480 档宽度 → 棘轮保持 640
    let floor = 0;
    floor = ratchetVariantWidth(floor, 640); // 初始 640
    expect(floor).toBe(640);
    floor = ratchetVariantWidth(floor, 410); // 侧栏打开后挤压
    expect(floor).toBe(640);
    floor = ratchetVariantWidth(floor, 1); // 移动端整栏隐藏、宽度归零
    expect(floor).toBe(640);
    floor = ratchetVariantWidth(floor, 640); // 关闭详情恢复
    expect(floor).toBe(640);
  });

  it('真实的布局放大仍然升档', () => {
    let floor = 0;
    floor = ratchetVariantWidth(floor, 300); // thumb-320
    expect(floor).toBe(320);
    floor = ratchetVariantWidth(floor, 700); // 窗口放大 → thumb-960? 700<=... 700>640 → 960
    expect(floor).toBe(960);
  });
});

describe('getMobileOriginalUrl', () => {
  it('对白名单内的远程图片走 /api/media 代理', () => {
    const remote = 'https://ai-img.10118899.xyz/NAI/123/456.webp';
    expect(getMobileOriginalUrl(remote)).toBe(`/api/media?source=${encodeURIComponent(remote)}&variant=original`);
  });

  it('对本地已有资源保持原始 URL', () => {
    const local = '/api/assets/aitag-covers/123.webp';
    expect(getMobileOriginalUrl(local)).toBe(local);
  });
});
