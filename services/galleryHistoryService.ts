/**
 * 画廊本地浏览足迹管理服务
 *
 * 职责：
 * 记录用户在 Danbooru 画廊和 Pixiv 画廊中点开查看过的大图历史，
 * 提供秒级无网络回溯与离线缓存查看。上限 200 条。
 */

export interface GalleryHistoryItem {
  id: string; // 唯一键：`pixiv:${id}` 或 `danbooru:${id}`
  source: 'pixiv' | 'danbooru';
  sourceId: string | number;
  title: string;
  artistName?: string;
  artistId?: string;
  previewUrl: string;
  sampleUrl: string;
  originalUrl?: string;
  tags: string[];
  viewedAt: number;
  // 附加元数据
  width?: number;
  height?: number;
  score?: number;
  bookmarks?: number;
  pageCount?: number;
}

const STORAGE_KEY = 'nai_gallery_view_history_v1';
const MAX_HISTORY_ITEMS = 200;

const getStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : (globalThis as any).localStorage;
  } catch {
    return null;
  }
};

class GalleryHistoryService {
  private cache: GalleryHistoryItem[] | null = null;

  private load(): GalleryHistoryItem[] {
    if (this.cache) return this.cache;
    try {
      const storage = getStorage();
      const raw = storage ? storage.getItem(STORAGE_KEY) : null;
      this.cache = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(this.cache)) this.cache = [];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  private persist() {
    if (!this.cache) return;
    const limited = this.cache.slice(0, MAX_HISTORY_ITEMS);
    this.cache = limited;
    try {
      const storage = getStorage();
      if (storage) {
        storage.setItem(STORAGE_KEY, JSON.stringify(limited));
      }
    } catch {
      // 存储满：淘汰一半并同步更新内存态，避免内存态与实际存储脱节
      this.cache = limited.slice(0, 50);
      try {
        const storage = getStorage();
        if (storage) {
          storage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
        }
      } catch {
        // ignore
      }
    }
  }

  public recordView(item: Omit<GalleryHistoryItem, 'viewedAt'>) {
    const list = this.load();
    const existingIndex = list.findIndex(i => i.id === item.id);
    const historyItem: GalleryHistoryItem = {
      ...item,
      viewedAt: Date.now(),
    };

    if (existingIndex >= 0) {
      list.splice(existingIndex, 1);
    }
    list.unshift(historyItem);

    if (list.length > MAX_HISTORY_ITEMS) {
      list.length = MAX_HISTORY_ITEMS;
    }
    this.persist();
  }

  public getHistory(source?: 'pixiv' | 'danbooru'): GalleryHistoryItem[] {
    const list = this.load();
    if (!source) return list;
    return list.filter(item => item.source === source);
  }

  public remove(id: string) {
    const list = this.load();
    const index = list.findIndex(i => i.id === id);
    if (index >= 0) {
      list.splice(index, 1);
      this.persist();
    }
  }

  public clear(source?: 'pixiv' | 'danbooru') {
    if (!source) {
      this.cache = [];
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    } else {
      const list = this.load();
      this.cache = list.filter(item => item.source !== source);
      this.persist();
    }
  }
}

export const galleryHistoryService = new GalleryHistoryService();

