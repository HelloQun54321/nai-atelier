import { CSSProperties, useEffect, useState } from 'react';

export type MobileImageLayout = 'masonry' | 'portrait' | 'square';
export type MobileImageColumns = 'auto' | 1 | 2 | 3;

export interface MobileImageDisplayPreferences {
  layout: MobileImageLayout;
  columns: MobileImageColumns;
}

const STORAGE_KEY = 'nai_mobile_image_display';
const CHANGE_EVENT = 'nai-mobile-image-display-change';
const DEFAULTS: MobileImageDisplayPreferences = { layout: 'masonry', columns: 2 };

export const getMobileImageDisplayPreferences = (): MobileImageDisplayPreferences => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const layout: MobileImageLayout = ['masonry', 'portrait', 'square'].includes(saved.layout) ? saved.layout : DEFAULTS.layout;
    const columns: MobileImageColumns = saved.columns === 'auto' || [1, 2, 3].includes(saved.columns) ? saved.columns : DEFAULTS.columns;
    return { layout, columns };
  } catch {
    return DEFAULTS;
  }
};

export const setMobileImageDisplayPreferences = (value: MobileImageDisplayPreferences) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
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

export const mobileGalleryStyle = (preferences: MobileImageDisplayPreferences) => ({
  '--mobile-gallery-columns': preferences.columns === 'auto' ? 2 : preferences.columns,
} as CSSProperties);
