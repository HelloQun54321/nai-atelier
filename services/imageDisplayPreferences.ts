import { CSSProperties, useEffect, useState } from 'react';

export type MobileImageLayout = 'masonry' | 'portrait' | 'square';
export type MobileImageColumns = 'auto' | 1 | 2 | 3;
export type DesktopImageColumns = 'auto' | 1 | 2 | 3 | 4 | 5;

export interface MobileImageDisplayPreferences {
  layout: MobileImageLayout;
  columns: MobileImageColumns;
  desktopColumns: DesktopImageColumns;
}

const STORAGE_KEY = 'nai_mobile_image_display';
const CHANGE_EVENT = 'nai-mobile-image-display-change';
const DEFAULTS: MobileImageDisplayPreferences = { layout: 'masonry', columns: 2, desktopColumns: 'auto' };

export const getMobileImageDisplayPreferences = (): MobileImageDisplayPreferences => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const layout: MobileImageLayout = ['masonry', 'portrait', 'square'].includes(saved.layout) ? saved.layout : DEFAULTS.layout;
    const columns: MobileImageColumns = saved.columns === 'auto' || [1, 2, 3].includes(saved.columns) ? saved.columns : DEFAULTS.columns;
    const desktopColumns: DesktopImageColumns = saved.desktopColumns === 'auto' || [1, 2, 3, 4, 5].includes(saved.desktopColumns) ? saved.desktopColumns : DEFAULTS.desktopColumns;
    return { layout, columns, desktopColumns };
  } catch {
    return DEFAULTS;
  }
};

export const setMobileImageDisplayPreferences = (value: MobileImageDisplayPreferences) => {
  // 配额满/隐私模式下 setItem 会抛异常，不让持久化失败影响会话内的显示状态
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 忽略写入失败
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
};

export const useMobileImageDisplayPreferences = () => {
  const [value, setValue] = useState(getMobileImageDisplayPreferences);
  useEffect(() => {
    const update = () => setValue(getMobileImageDisplayPreferences());
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return value;
};

export const mobileGalleryClassName = (preferences: MobileImageDisplayPreferences) =>
  `mobile-gallery mobile-gallery--${preferences.layout} ${preferences.columns === 'auto' ? 'mobile-gallery--auto' : ''}`;

/** 列数：移动端注入 --mobile-gallery-cols-setting（1/2/3），桌面端注入 --mobile-gallery-cols-desktop（2-5）；auto 不注入，由 CSS 自适应。 */
export const mobileGalleryStyle = (preferences: MobileImageDisplayPreferences) => ({
  ...(preferences.columns === 'auto' ? {} : { '--mobile-gallery-cols-setting': preferences.columns }),
  ...(preferences.desktopColumns === 'auto' ? {} : { '--mobile-gallery-cols-desktop': preferences.desktopColumns }),
} as CSSProperties);
