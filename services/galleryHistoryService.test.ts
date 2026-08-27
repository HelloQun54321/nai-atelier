import { describe, it, expect, beforeEach } from 'vitest';
import { galleryHistoryService } from './galleryHistoryService';

describe('galleryHistoryService', () => {
  beforeEach(() => {
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
});
