// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearImageDisplayPageOverride,
  getImageDisplayPageOverride,
  getMobileImageDisplayPreferences,
  IMAGE_DISPLAY_PAGES,
  mobileGalleryClassName,
  mobileGalleryStyle,
  setMobileImageDisplayPreferences,
  useMobileImageDisplayPreferences,
  type ImageDisplayPage,
  type MobileImageDisplayPreferences,
} from '../../services/imageDisplayPreferences';

const global: MobileImageDisplayPreferences = { layout: 'square', columns: 3, desktopColumns: 5 };
const own: MobileImageDisplayPreferences = { layout: 'portrait', columns: 1, desktopColumns: 2 };
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('图片显示的全局默认与页面覆盖', () => {
  it('旧存储保留全局三项，页面默认继承；缺少字段沿用既有默认值', () => {
    localStorage.setItem('nai_mobile_image_display', JSON.stringify(global));
    expect(getMobileImageDisplayPreferences()).toEqual(global);
    for (const { id } of IMAGE_DISPLAY_PAGES) {
      expect(getMobileImageDisplayPreferences(id)).toEqual(global);
      expect(getImageDisplayPageOverride(id)).toBeNull();
    }
    localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: 'square', columns: 1 }));
    expect(getMobileImageDisplayPreferences('artists')).toEqual({ layout: 'square', columns: 1, desktopColumns: 5 });
  });

  it('全局和页面都接受7列桌面值，保留旧的显式列数并限制手机仍为3列', () => {
    const sevenColumns = { ...global, desktopColumns: 7 as const };
    setMobileImageDisplayPreferences(sevenColumns);
    setMobileImageDisplayPreferences(sevenColumns, 'artists');
    expect(getMobileImageDisplayPreferences()).toEqual(sevenColumns);
    expect(getImageDisplayPageOverride('artists')).toEqual(sevenColumns);
    expect(mobileGalleryStyle(sevenColumns, 7)).toMatchObject({ '--mobile-gallery-cols-desktop': 7, '--mobile-gallery-columns': 7 });

    for (const desktopColumns of [5, 6, 7] as const) {
      localStorage.setItem('nai_mobile_image_display', JSON.stringify({ ...global, desktopColumns }));
      expect(getMobileImageDisplayPreferences().desktopColumns).toBe(desktopColumns);
    }
    localStorage.setItem('nai_mobile_image_display', JSON.stringify({ ...global, desktopColumns: 7, columns: 3 }));
    expect(getMobileImageDisplayPreferences().columns).toBe(3);
  });

  it.each(IMAGE_DISPLAY_PAGES)('$id：整页覆盖独立于全局与其他页面，清除后恢复最新全局', ({ id }) => {
    setMobileImageDisplayPreferences(global);
    setMobileImageDisplayPreferences(own, id);
    expect(getImageDisplayPageOverride(id)).toEqual(own);
    expect(getMobileImageDisplayPreferences()).toEqual(global);
    for (const page of IMAGE_DISPLAY_PAGES) expect(getMobileImageDisplayPreferences(page.id)).toEqual(page.id === id ? own : global);
    const next = { ...global, layout: 'masonry' as const, desktopColumns: 4 as const };
    setMobileImageDisplayPreferences(next);
    expect(getMobileImageDisplayPreferences(id)).toEqual(own);
    expect(JSON.parse(localStorage.getItem('nai_mobile_image_display')!).pages[id]).toEqual(own);
    clearImageDisplayPageOverride(id);
    expect(getImageDisplayPageOverride(id)).toBeNull();
    expect(getMobileImageDisplayPreferences(id)).toEqual(next);
  });

  it('损坏配置与非法/残缺页面覆盖回退到全局，不创建半页继承规则', () => {
    for (const saved of ['null', '[]', 'invalid json']) {
      localStorage.setItem('nai_mobile_image_display', saved);
      expect(getMobileImageDisplayPreferences('artists')).toEqual({ layout: 'masonry', columns: 2, desktopColumns: 5 });
    }
    localStorage.setItem('nai_mobile_image_display', JSON.stringify({ ...global, pages: { artists: { layout: 'portrait' }, characters: { ...own, desktopColumns: 99 }, unknown: own } }));
    expect(getImageDisplayPageOverride('artists')).toBeNull();
    expect(getImageDisplayPageOverride('characters')).toBeNull();
    expect(getMobileImageDisplayPreferences('artists')).toEqual(global);
    expect(() => setMobileImageDisplayPreferences(global)).not.toThrow();
    expect(JSON.parse(localStorage.getItem('nai_mobile_image_display')!).pages).toEqual({});
  });

  it('有效hook同步同页/全局/跨标签变更，换page重新订阅且页面之间隔离', () => {
    setMobileImageDisplayPreferences(global);
    const { result, rerender } = renderHook(({ page }: { page?: ImageDisplayPage }) => useMobileImageDisplayPreferences(page), { initialProps: { page: 'artists' as ImageDisplayPage | undefined } });
    expect(result.current).toEqual(global);
    act(() => setMobileImageDisplayPreferences(own, 'characters'));
    expect(result.current).toEqual(global);
    rerender({ page: 'characters' });
    expect(result.current).toEqual(own);
    act(() => setMobileImageDisplayPreferences({ ...global, desktopColumns: 4 }));
    expect(result.current).toEqual(own);
    act(() => clearImageDisplayPageOverride('characters'));
    expect(result.current.desktopColumns).toBe(4);
    act(() => {
      localStorage.setItem('nai_mobile_image_display', JSON.stringify(own));
      window.dispatchEvent(new StorageEvent('storage', { key: 'nai_mobile_image_display' }));
    });
    expect(result.current).toEqual(own);
    rerender({ page: undefined });
    expect(result.current).toEqual(own);
  });

  it('三种布局的CSS列数取同一有效值，存储不可读/不可写不击穿页面', () => {
    for (const layout of ['masonry', 'portrait', 'square'] as const) {
      const preferences = { ...global, layout };
      expect(mobileGalleryClassName(preferences)).toContain(`mobile-gallery--${layout}`);
      expect(mobileGalleryStyle(preferences, 5)).toMatchObject({ '--mobile-gallery-cols-setting': 3, '--mobile-gallery-cols-desktop': 5, '--mobile-gallery-columns': 5 });
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(getMobileImageDisplayPreferences('artists')).toEqual({ layout: 'masonry', columns: 2, desktopColumns: 5 });
    expect(() => setMobileImageDisplayPreferences(own, 'artists')).not.toThrow();
    expect(() => clearImageDisplayPageOverride('artists')).not.toThrow();
  });
});
