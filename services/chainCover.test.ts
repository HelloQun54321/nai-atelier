import { describe, expect, it } from 'vitest';
import { decideCurrentPreviewCover } from './chainCover';

describe('风格串当前预览封面', () => {
  it('左右切换后的当前图片优先于原封面', () => {
    expect(decideCurrentPreviewCover('/api/local-history/new/image', '/api/assets/covers/old.webp')).toEqual({
      source: '/api/local-history/new/image',
      needsUpload: true,
    });
  });

  it('当前仍是原封面时不重复上传', () => {
    expect(decideCurrentPreviewCover(null, '/api/assets/covers/current.webp')).toEqual({
      source: '/api/assets/covers/current.webp',
      needsUpload: false,
    });
  });

  it('新建风格串会为当前图片制作独立封面', () => {
    expect(decideCurrentPreviewCover(null, '/api/assets/covers/source.webp', true)).toEqual({
      source: '/api/assets/covers/source.webp',
      needsUpload: true,
    });
  });

  it('预览区没有图片时不生成封面', () => {
    expect(decideCurrentPreviewCover(null, undefined)).toEqual({ source: null, needsUpload: false });
  });
});
