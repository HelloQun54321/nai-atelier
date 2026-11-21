import type { ComicPageDraft } from './comicTypes';

export const COMIC_BOOK_KEY_PREFIX = 'comic_book_v1:';
export const DEFAULT_COMIC_BOOK_ID = 'default-sketchbook';
export const DEFAULT_COMIC_BOOK_TITLE = '速写单页集';
export const COMIC_BOOK_MAX_PAGES = 100;
export const COMIC_BOOK_MAX_CHARS = 6_000_000;

export interface ComicBook {
  id: string;
  title: string;
  description: string;
  pages: ComicPageDraft[];
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export const comicBookKeyPrefix = (userId: string) => `${COMIC_BOOK_KEY_PREFIX}${userId}:`;
export const comicBookStorageKey = (userId: string, bookId: string) => `${comicBookKeyPrefix(userId)}${bookId}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function validateComicBook(value: unknown): asserts value is ComicBook {
  if (!isRecord(value)) throw new Error('漫画作品资料无效');
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)) {
    throw new Error('漫画作品 ID 无效');
  }
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) {
    throw new Error('漫画作品名称不能为空且不超过 120 字');
  }
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 500)) {
    throw new Error('漫画作品简介过长');
  }
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > COMIC_BOOK_MAX_PAGES) {
    throw new Error(`每部作品需包含 1～${COMIC_BOOK_MAX_PAGES} 页`);
  }
  for (const page of value.pages) {
    if (!isRecord(page) || typeof page.id !== 'string' || !page.id) {
      throw new Error('漫画页数据结构无效');
    }
  }
  if (!Number.isSafeInteger(Number(value.revision)) || Number(value.revision) < 0) {
    throw new Error('漫画作品版本号无效');
  }
}

export const createComicBook = (
  title: string,
  initialPages: ComicPageDraft[],
  options: { id?: string; description?: string } = {},
): ComicBook => {
  const now = Date.now();
  const safeId = options.id && /^[a-zA-Z0-9_-]{1,100}$/.test(options.id)
    ? options.id
    : `book_${now}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: safeId,
    title: title.trim() || DEFAULT_COMIC_BOOK_TITLE,
    description: (options.description || '').trim(),
    pages: initialPages,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
};

/** 提取一部漫画作品全部页面所引用的生成历史 ID 与图片 URL（用于书架计数与引用核验）。 */
export const collectComicBookImageRefs = (book: ComicBook): { historyIds: string[]; urls: string[] } => {
  const historyIds = new Set<string>();
  const urls = new Set<string>();
  for (const page of book.pages) {
    for (const panel of page.panels || []) {
      if (panel.image?.historyId) historyIds.add(panel.image.historyId);
      if (panel.image?.url) urls.add(panel.image.url);
    }
    if (page.aiPage?.generatedPageImage?.historyId) {
      historyIds.add(page.aiPage.generatedPageImage.historyId);
    }
    if (page.aiPage?.generatedPageImage?.url) {
      urls.add(page.aiPage.generatedPageImage.url);
    }
    for (const zid of page.aiPage?.generatedPageImage?.zoneHistoryIds || []) {
      if (zid) historyIds.add(zid);
    }
  }
  return {
    historyIds: Array.from(historyIds),
    urls: Array.from(urls),
  };
};
