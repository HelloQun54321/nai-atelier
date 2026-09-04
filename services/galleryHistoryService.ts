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

  /**
   * 写入本地存储。storage 不可用（无 localStorage/已被禁用）视为环境不支持，不算失败。
   * 失败时按序降级：先砍半重试（保留原「淘汰一半」行为，仍不够则继续对半递减），
   * 直到写入成功；若始终失败，则把内存态回滚为 storage 中上次成功落盘的真实内容
   * （避免内存态与实际存储脱节），返回 false。
   */
  private persist(): boolean {
    if (!this.cache) return true;
    let snapshot = this.cache.slice(0, MAX_HISTORY_ITEMS);
    const storage = getStorage();
    if (!storage) {
      // 无存储可用时内存态即唯一事实来源，仅截断上限。
      this.cache = snapshot;
      return true;
    }
    for (let attempt = 0; attempt < MAX_HISTORY_ITEMS; attempt++) {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        // 写入成功：内存态与存储保持一致（截断后可能少于缓存上限）。
        this.cache = snapshot;
        return true;
      } catch {
        // 存储满等异常：对半递减重试（200→100→50→25→…），空列表无需再试。
        snapshot = snapshot.slice(0, Math.floor(snapshot.length / 2));
        if (snapshot.length === 0) break;
      }
    }
    // 写入始终失败：回滚内存态为 storage 中实际存在的内容（无则空），保证与存储一致。
    try {
      const raw = storage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      this.cache = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.cache = [];
    }
    return false;
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
    return this.persist();
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

