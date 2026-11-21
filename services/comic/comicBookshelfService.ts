import {
  createComicBook,
  DEFAULT_COMIC_BOOK_ID,
  DEFAULT_COMIC_BOOK_TITLE,
  type ComicBook,
} from './comicBookshelf';
import { createInitialComicDraft } from './comicGeometry';
import { loadComicDraft, normalizeComicDraft } from './comicStorage';

const LOCAL_BOOKSHELF_KEY = 'nai_comic_bookshelf_v1';
const LOCAL_ACTIVE_POINTER_KEY = 'nai_comic_bookshelf_active_v1';

const normalizeBook = (raw: ComicBook): ComicBook => {
  const pages = Array.isArray(raw.pages) && raw.pages.length > 0
    ? raw.pages.map(p => normalizeComicDraft(p))
    : [createInitialComicDraft()];
  return {
    id: raw.id,
    title: raw.title?.trim() || DEFAULT_COMIC_BOOK_TITLE,
    description: raw.description || '',
    pages,
    revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
};

export const readLocalBookshelfCache = (): ComicBook[] => {
  try {
    if (typeof localStorage === 'undefined') return [];
    const text = localStorage.getItem(LOCAL_BOOKSHELF_KEY);
    if (!text) return [];
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean).map(item => normalizeBook(item as ComicBook));
  } catch {
    return [];
  }
};

export const writeLocalBookshelfCache = (books: ComicBook[]): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LOCAL_BOOKSHELF_KEY, JSON.stringify(books));
  } catch {
    // 忽略浏览器配额异常
  }
};

export const readActiveBookPointer = (): { bookId?: string; pageId?: string } => {
  try {
    if (typeof localStorage === 'undefined') return {};
    const text = localStorage.getItem(LOCAL_ACTIVE_POINTER_KEY);
    if (!text) return {};
    const parsed = JSON.parse(text);
    return {
      bookId: typeof parsed?.bookId === 'string' ? parsed.bookId : undefined,
      pageId: typeof parsed?.pageId === 'string' ? parsed.pageId : undefined,
    };
  } catch {
    return {};
  }
};

export const writeActiveBookPointer = (bookId: string, pageId: string): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LOCAL_ACTIVE_POINTER_KEY, JSON.stringify({ bookId, pageId }));
  } catch {
    // 忽略存储异常
  }
};

export const createDefaultSketchbook = (): ComicBook => {
  const initialDraft = loadComicDraft();
  return createComicBook(DEFAULT_COMIC_BOOK_TITLE, [initialDraft], {
    id: DEFAULT_COMIC_BOOK_ID,
    description: '默认随手创作与单页草稿合集',
  });
};

export const comicBookshelfService = {
  /** 从后端 D1 加载书架；后端未重启或离线时自动降级本地缓存并保证自带「速写单页集」。 */
  loadBooks: async (): Promise<{ books: ComicBook[]; syncedToServer: boolean }> => {
    try {
      const response = await fetch('/api/comic-books', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json() as { books?: ComicBook[] };
        const serverBooks = Array.isArray(data.books) ? data.books.map(normalizeBook) : [];
        if (serverBooks.length > 0) {
          writeLocalBookshelfCache(serverBooks);
          return { books: serverBooks, syncedToServer: true };
        }
        // D1 尚无作品：把本地已有草稿或缓存迁入默认「速写单页集」并持久化到 D1
        const cached = readLocalBookshelfCache();
        const seedBooks = cached.length > 0 ? cached : [createDefaultSketchbook()];
        const savedList: ComicBook[] = [];
        for (const book of seedBooks) {
          const saved = await comicBookshelfService.saveBook(book);
          savedList.push(saved.book);
        }
        writeLocalBookshelfCache(savedList);
        return { books: savedList, syncedToServer: true };
      }
    } catch {
      // 网络不可达或测试环境回落本地缓存
    }

    const cached = readLocalBookshelfCache();
    if (cached.length > 0) {
      return { books: cached, syncedToServer: false };
    }
    const fallback = [createDefaultSketchbook()];
    writeLocalBookshelfCache(fallback);
    return { books: fallback, syncedToServer: false };
  },

  saveBook: async (book: ComicBook): Promise<{ book: ComicBook; syncedToServer: boolean; error?: string }> => {
    const normalized = normalizeBook(book);
    try {
      const response = await fetch(`/api/comic-books/${encodeURIComponent(normalized.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized),
      });
      if (response.ok) {
        const data = await response.json() as { book?: ComicBook };
        const saved = data.book ? normalizeBook(data.book) : normalized;
        return { book: saved, syncedToServer: true };
      }
      if (response.status === 409) {
        const err = await response.json().catch(() => ({})) as { error?: string };
        return { book: normalized, syncedToServer: false, error: err.error || '漫画书架保存冲突' };
      }
    } catch {
      // 回落本地缓存
    }
    return { book: normalized, syncedToServer: false };
  },

  deleteBook: async (bookId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/comic-books/${encodeURIComponent(bookId)}`, {
        method: 'DELETE',
      });
      return response.ok || response.status === 404;
    } catch {
      return false;
    }
  },
};
