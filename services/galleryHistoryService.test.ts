import { describe, it, expect, beforeEach } from 'vitest';
import { galleryHistoryService, type GalleryHistoryItem } from './galleryHistoryService';

// Mock localStorage for Node test runner
const createMockStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
};

describe('galleryHistoryService', () => {
  let mockStorage = createMockStorage();

  beforeEach(() => {
    mockStorage = createMockStorage();
    (globalThis as any).localStorage = mockStorage;
    galleryHistoryService.clear();
  });

  it('records and retrieves history items in reverse chronological order', () => {
    galleryHistoryService.recordView({
      id: 'pixiv:1001',
      source: 'pixiv',
      sourceId: '1001',
      title: 'Work 1',
      previewUrl: 'https://example.com/1.jpg',
      sampleUrl: 'https://example.com/1.jpg',
      tags: ['tag1'],
    });

    galleryHistoryService.recordView({
      id: 'danbooru:2001',
      source: 'danbooru',
      sourceId: 2001,
      title: 'Work 2',
      previewUrl: 'https://example.com/2.jpg',
      sampleUrl: 'https://example.com/2.jpg',
      tags: ['tag2'],
    });

    const all = galleryHistoryService.getHistory();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe('danbooru:2001');
    expect(all[1].id).toBe('pixiv:1001');

    const pixivOnly = galleryHistoryService.getHistory('pixiv');
    expect(pixivOnly).toHaveLength(1);
    expect(pixivOnly[0].id).toBe('pixiv:1001');

    const danbooruOnly = galleryHistoryService.getHistory('danbooru');
    expect(danbooruOnly).toHaveLength(1);
    expect(danbooruOnly[0].id).toBe('danbooru:2001');
  });

  it('moves existing item to top on repeated view without duplicate', () => {
    galleryHistoryService.recordView({
      id: 'pixiv:1001',
      source: 'pixiv',
      sourceId: '1001',
      title: 'Work 1',
      previewUrl: 'https://example.com/1.jpg',
      sampleUrl: 'https://example.com/1.jpg',
      tags: ['tag1'],
    });

    galleryHistoryService.recordView({
      id: 'pixiv:1002',
      source: 'pixiv',
      sourceId: '1002',
      title: 'Work 2',
      previewUrl: 'https://example.com/2.jpg',
      sampleUrl: 'https://example.com/2.jpg',
      tags: ['tag2'],
    });

    // Re-view 1001
    galleryHistoryService.recordView({
      id: 'pixiv:1001',
      source: 'pixiv',
      sourceId: '1001',
      title: 'Work 1 Updated',
      previewUrl: 'https://example.com/1.jpg',
      sampleUrl: 'https://example.com/1.jpg',
      tags: ['tag1'],
    });

    const list = galleryHistoryService.getHistory();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('pixiv:1001');
    expect(list[0].title).toBe('Work 1 Updated');
  });

  it('can remove single item and clear specific source', () => {
    galleryHistoryService.recordView({
      id: 'pixiv:1001',
      source: 'pixiv',
      sourceId: '1001',
      title: 'Work 1',
      previewUrl: 'https://example.com/1.jpg',
      sampleUrl: 'https://example.com/1.jpg',
      tags: [],
    });
    galleryHistoryService.recordView({
      id: 'danbooru:2001',
      source: 'danbooru',
      sourceId: 2001,
      title: 'Work 2',
      previewUrl: 'https://example.com/2.jpg',
      sampleUrl: 'https://example.com/2.jpg',
      tags: [],
    });

    galleryHistoryService.remove('pixiv:1001');
    expect(galleryHistoryService.getHistory()).toHaveLength(1);
    expect(galleryHistoryService.getHistory()[0].id).toBe('danbooru:2001');

    galleryHistoryService.clear('danbooru');
    expect(galleryHistoryService.getHistory()).toHaveLength(0);
  });

  it('syncs in-memory cache when localStorage quota error occurs', () => {
    // 模拟当数据体积大于 2000 字节时触发配额超限错误
    mockStorage.setItem = (key: string, value: string) => {
      if (value.length > 2000) {
        throw new Error('QuotaExceededError');
      }
    };

    // 记录 60 条记录，每条带有丰富信息以超出 2000 字节限制
    for (let i = 0; i < 60; i++) {
      galleryHistoryService.recordView({
        id: `item:${i}`,
        source: 'pixiv',
        sourceId: String(i),
        title: `Item With Very Long Title For Quota Simulation ${i}`,
        previewUrl: `https://example.com/long/path/to/preview/image/${i}.jpg`,
        sampleUrl: `https://example.com/long/path/to/sample/image/${i}.jpg`,
        tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
      });
    }

    // 触发配额超限降级后，内存中的缓存应同步截断到 50 条
    expect(galleryHistoryService.getHistory().length).toBeLessThanOrEqual(50);
  });

  it('写入彻底失败时返回失败标志并把内存态回滚为已落盘内容，不与存储脱节', () => {
    // 先成功写入两条真实历史
    mockStorage.setItem = (key: string, value: string) => {
      if (key === 'nai_gallery_view_history_v1') {
        // 不再允许任何写入（模拟存储被禁用/永久配额满）
        throw new Error('QuotaExceededError');
      }
    };
    // 预置一条已成功落盘的历史（代表上次写入成功的真实存储内容）
    const persisted: GalleryHistoryItem[] = [{
      id: 'pixiv:prev',
      source: 'pixiv',
      sourceId: 'prev',
      title: 'Prev',
      previewUrl: 'https://example.com/prev.jpg',
      sampleUrl: 'https://example.com/prev.jpg',
      tags: [],
      viewedAt: 1000,
    }];
    mockStorage.getItem = (key: string) => (key === 'nai_gallery_view_history_v1' ? JSON.stringify(persisted) : null);

    const ok = galleryHistoryService.recordView({
      id: 'pixiv:new',
      source: 'pixiv',
      sourceId: 'new',
      title: 'New',
      previewUrl: 'https://example.com/new.jpg',
      sampleUrl: 'https://example.com/new.jpg',
      tags: [],
    });

    // 写入失败：返回 false，且内存态回滚为 storage 中已落盘内容（不含 new）
    expect(ok).toBe(false);
    const history = galleryHistoryService.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe('pixiv:prev');
  });
});

