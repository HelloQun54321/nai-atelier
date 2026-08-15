import { describe, it, expect } from 'vitest';
import { validateMediaSource, MEDIA_VARIANTS } from './mediaValidation';

describe('validateMediaSource 内部路径', () => {
  it('白名单内的 /api/ 路径识别为内部来源', () => {
    expect(validateMediaSource('/api/assets/covers/a_b.webp')).toEqual({ source: '/api/assets/covers/a_b.webp', internal: true });
    expect(validateMediaSource('/api/local-history/abc123/image')).toEqual({ source: '/api/local-history/abc123/image', internal: true });
    expect(validateMediaSource('/api/inspirations/ins-1/image')).toEqual({ source: '/api/inspirations/ins-1/image', internal: true });
    expect(validateMediaSource('/api/vibes/v1/image')).toEqual({ source: '/api/vibes/v1/image', internal: true });
    expect(validateMediaSource('/api/character-references/c1/thumbnail')).toEqual({ source: '/api/character-references/c1/thumbnail', internal: true });
    const hex64 = 'a'.repeat(64);
    expect(validateMediaSource(`/api/integrations/st-chatu8/history/${hex64}/image`)).toEqual({
      source: `/api/integrations/st-chatu8/history/${hex64}/image`,
      internal: true,
    });
  });

  it('内部路径允许携带查询串', () => {
    expect(validateMediaSource('/api/assets/x.png?variant=thumb-320')?.internal).toBe(true);
  });

  it('不在白名单的内部样式路径按远程 URL 解析并失败', () => {
    expect(() => validateMediaSource('/api/unknown/route')).toThrow();
  });
});

describe('validateMediaSource 远程图', () => {
  it('https 且主机在白名单时通过（大小写不敏感）', () => {
    const ok = validateMediaSource('https://CDN.DONMAI.US/a.png');
    expect(ok?.internal).toBe(false);
    expect(ok?.source).toBe('https://cdn.donmai.us/a.png');
  });

  it('http、非白名单主机、带凭据的 URL 一律拒绝', () => {
    expect(() => validateMediaSource('http://cdn.donmai.us/a.png')).toThrow('Remote image host is not allowed');
    expect(() => validateMediaSource('https://evil.example.com/a.png')).toThrow('Remote image host is not allowed');
    expect(() => validateMediaSource('https://user:pass@cdn.donmai.us/a.png')).toThrow('Remote image host is not allowed');
  });
});

describe('validateMediaSource 输入健壮性', () => {
  it('空值、超长、含换行的输入直接拒绝', () => {
    expect(() => validateMediaSource(null)).toThrow('Invalid image source');
    expect(() => validateMediaSource('')).toThrow('Invalid image source');
    expect(() => validateMediaSource('a\nb')).toThrow('Invalid image source');
    expect(() => validateMediaSource(`${'https://cdn.donmai.us/'}${'a'.repeat(2100)}`)).toThrow('Invalid image source');
  });

  it('非 URL 垃圾输入抛错而不是崩溃', () => {
    expect(() => validateMediaSource('not a url at all')).toThrow();
  });
});

describe('MEDIA_VARIANTS', () => {
  it('包含从 160 到 960 的缩略图档位与 original', () => {
    for (const variant of ['thumb-160', 'thumb-320', 'thumb-640', 'thumb-960', 'original']) {
      expect(MEDIA_VARIANTS.has(variant)).toBe(true);
    }
    expect(MEDIA_VARIANTS.has('thumb-123')).toBe(false);
  });
});
