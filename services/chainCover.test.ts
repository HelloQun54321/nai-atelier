import { describe, expect, it } from 'vitest';
import { decideCurrentPreviewCover } from './chainCover';

describe('风格串封面策略', () => {
  it('已有封面时常规保存保持既有封面不变，不因切换当前预览图而自动覆盖', () => {
    expect(decideCurrentPreviewCover('/api/local-history/new/image', '/api/assets/covers/old.webp')).toEqual({
      source: '/api/assets/covers/old.webp',
      needsUpload: false,
    });
  });

  it('没有封面时自动将当前生成的预览图片设为初始封面', () => {
    expect(decideCurrentPreviewCover('/api/local-history/new/image', null)).toEqual({
      source: '/api/local-history/new/image',
      needsUpload: true,
    });
    expect(decideCurrentPreviewCover('/api/local-history/new/image', undefined)).toEqual({
      source: '/api/local-history/new/image',
      needsUpload: true,
    });
  });

  it('复制为新串（forceUpload）时会为当前图片制作独立封面', () => {
    expect(decideCurrentPreviewCover('/api/local-history/current.webp', '/api/assets/covers/old.webp', true)).toEqual({
      source: '/api/local-history/current.webp',
      needsUpload: true,
    });
  });

  it('预览区没有图片且无已有封面时不生成封面', () => {
    expect(decideCurrentPreviewCover(null, undefined)).toEqual({ source: null, needsUpload: false });
  });
});
