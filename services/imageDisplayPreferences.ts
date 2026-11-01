import { CSSProperties, useEffect, useState } from 'react';

export type MobileImageLayout = 'masonry' | 'portrait' | 'square';
export type MobileImageColumns = 'auto' | 1 | 2 | 3;
export type DesktopImageColumns = 'auto' | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface MobileImageDisplayPreferences {
  layout: MobileImageLayout;
  columns: MobileImageColumns;
  desktopColumns: DesktopImageColumns;
}

export const IMAGE_DISPLAY_PAGES = [
  { id: 'chains', label: '风格串' },
  { id: 'artists', label: '画师库' },
  { id: 'characters', label: '角色库' },
  { id: 'history', label: '生成历史' },
  { id: 'favorites', label: '收藏库' },
  { id: 'codex', label: '法典' },
  { id: 'aitag', label: 'AITag' },
  { id: 'pixiv', label: 'Pixiv' },
  { id: 'danbooru', label: 'Danbooru' },
  { id: 'roll', label: 'Roll 串' },
] as const;
export type ImageDisplayPage = typeof IMAGE_DISPLAY_PAGES[number]['id'];
type PageOverrides = Partial<Record<ImageDisplayPage, MobileImageDisplayPreferences>>;

const STORAGE_KEY = 'nai_mobile_image_display';
const CHANGE_EVENT = 'nai-mobile-image-display-change';
// 电脑端默认一行 5 张，不再按窗口宽度自适应（原 auto 会在 4/5/6 之间跳）。
const DEFAULTS: MobileImageDisplayPreferences = { layout: 'masonry', columns: 2, desktopColumns: 5 };

const normalizePreferences = (value: unknown): MobileImageDisplayPreferences => {
  const saved = value && typeof value === 'object' ? value as Partial<MobileImageDisplayPreferences> : {};
  const layout: MobileImageLayout = ['masonry', 'portrait', 'square'].includes(saved.layout as string) ? saved.layout! : DEFAULTS.layout;
  const columns: MobileImageColumns = saved.columns === 'auto' || [1, 2, 3].includes(saved.columns as number) ? saved.columns! : DEFAULTS.columns;
  const desktopColumns: DesktopImageColumns = saved.desktopColumns === 'auto' || [1, 2, 3, 4, 5, 6, 7].includes(saved.desktopColumns as number) ? saved.desktopColumns! : DEFAULTS.desktopColumns;
  return { layout, columns, desktopColumns };
};

const readPreferences = (): { global: MobileImageDisplayPreferences; pages: PageOverrides } => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const pages: PageOverrides = {};
    for (const { id } of IMAGE_DISPLAY_PAGES) {
      const override = saved?.pages?.[id];
      const normalized = normalizePreferences(override);
      if (override && Object.keys(normalized).every(key => override[key] === normalized[key as keyof MobileImageDisplayPreferences])) pages[id] = normalized;
    }
    return { global: normalizePreferences(saved), pages };
  } catch {
    return { global: { ...DEFAULTS }, pages: {} };
  }
};

export const getMobileImageDisplayPreferences = (page?: ImageDisplayPage): MobileImageDisplayPreferences => {
  const saved = readPreferences();
  return (page && saved.pages[page]) || saved.global;
};

export const getImageDisplayPageOverride = (page: ImageDisplayPage): MobileImageDisplayPreferences | null =>
  readPreferences().pages[page] ?? null;

const writePreferences = ({ global, pages }: ReturnType<typeof readPreferences>) => {
  // 配额满/隐私模式下 setItem 会抛异常，不让持久化失败影响会话内的显示状态
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...global, pages }));
  } catch {
    // 忽略写入失败
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
};

export const setMobileImageDisplayPreferences = (value: MobileImageDisplayPreferences, page?: ImageDisplayPage) => {
  const saved = readPreferences();
  if (page) saved.pages[page] = normalizePreferences(value);
  else saved.global = normalizePreferences(value);
  writePreferences(saved);
};

export const clearImageDisplayPageOverride = (page: ImageDisplayPage) => {
  const saved = readPreferences();
  delete saved.pages[page];
  writePreferences(saved);
};

export const useMobileImageDisplayPreferences = (page?: ImageDisplayPage) => {
  const [value, setValue] = useState(() => getMobileImageDisplayPreferences(page));
  useEffect(() => {
    const update = () => setValue(getMobileImageDisplayPreferences(page));
    update();
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, [page]);
  return value;
};

export const mobileGalleryClassName = (preferences: MobileImageDisplayPreferences) =>
  `mobile-gallery mobile-gallery--${preferences.layout} ${preferences.columns === 'auto' ? 'mobile-gallery--auto' : ''}`;

/** 未传实际列数时沿用 CSS 断点；分栏图库传入按容器宽度解析的列数。 */
export const mobileGalleryStyle = (preferences: MobileImageDisplayPreferences, columns?: number) => ({
  ...(preferences.columns === 'auto' ? {} : { '--mobile-gallery-cols-setting': preferences.columns }),
  ...(preferences.desktopColumns === 'auto' ? {} : { '--mobile-gallery-cols-desktop': preferences.desktopColumns }),
  ...(columns === undefined ? {} : { '--mobile-gallery-columns': columns }),
} as CSSProperties);
