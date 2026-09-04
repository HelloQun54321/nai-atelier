// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTagDictionaryCache, searchTagDictionary } from './tagDictionary';

type ShardEntry = [name: string, chinese: string, category: number, postCount: number, source: number];

const makeManifest = (generatedAt: string) => ({
  version: 1,
  generatedAt,
  count: 1,
  categoryCounts: {},
  categories: {},
  // 两字符英文查询走 shards[key]
  shards: { be: `shard-be-${generatedAt}.json` },
  chineseShards: {},
  popular: {},
  popularArtists: [],
  artistPageSize: 500,
  artistPages: [],
  artistNamePages: [],
  popularCharacters: [],
  characterPageSize: 500,
  characterPages: [],
  characterNamePages: [],
  characterSearchShardCount: 0,
  characterSearchShards: [],
  characterSearchRecords: '',
});

describe('tagDictionary reset 竞态', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetTagDictionaryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetTagDictionaryCache();
  });

  const respondJson = (payload: unknown) => ({
    ok: true,
    status: 200,
    json: async () => payload,
  }) as Response;

  /** 构造「旧 shard 在途时 reset」的真实竞态时序：旧 shard 挂起、放行后应作废并重试新 URL */
  it('reset 后在途旧分片请求作废：按新 manifest 的 URL 重试并返回新数据', async () => {
    const oldShard: ShardEntry[] = [['be-old', '旧词', 0, 10, 0]];
    const newShard: ShardEntry[] = [['be-new', '新词', 0, 20, 0]];

    // 旧代 shard 的放行闸
    let releaseOldShard!: (response: Response) => void;
    const oldShardPending = new Promise<Response>(resolve => { releaseOldShard = resolve; });

    let manifestCalls = 0;
    const fetchMock = vi.fn((url: string) => {
      const path = String(url);
      if (path.includes('manifest.json')) {
        // reset 前第 1 次 manifest → gen-a；reset 后重试的 manifest（新 ?v=）→ gen-b
        manifestCalls++;
        const generatedAt = manifestCalls === 1 ? 'gen-a' : 'gen-b';
        return Promise.resolve(respondJson(makeManifest(generatedAt)));
      }
      if (path.includes('shard-be-gen-b.json')) return Promise.resolve(respondJson(newShard));
      if (path.includes('shard-be-gen-a.json')) return oldShardPending; // 旧代 shard 在途
      return Promise.resolve(respondJson([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const firstQuery = searchTagDictionary('be');
    // 等 manifest 落地、旧 shard 请求已发出（在途）：fetch mock 无真实 IO，flush 微任务链
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(fetchMock.mock.calls.length).toBe(2); // manifest(gen-a) + 旧 shard(挂起)

    // reset 发生在旧分片请求在途时
    resetTagDictionaryCache();

    // 放行旧分片 → 落地时代际不匹配 → 丢弃并重试（新 manifest → 新 shard URL）
    releaseOldShard(respondJson(oldShard));
    const suggestions = await firstQuery;

    // 旧分片 'be-old' 词条被丢弃，返回新代数据
    expect(suggestions.map(s => s.name)).toEqual(['be-new']);
    expect(fetchMock.mock.calls.length).toBe(4); // manifest-a + shard-a + manifest-b + shard-b
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.filter(u => u.includes('manifest.json'))).toHaveLength(2);
    expect(urls.some(u => u.includes('shard-be-gen-b.json'))).toBe(true);
  });

  it('无 reset 时普通搜索不受影响（manifest 与分片只请求一次并缓存）', async () => {
    const shard: ShardEntry[] = [['beautiful', '美丽', 0, 99, 0]];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respondJson(makeManifest('gen-a')))
      .mockResolvedValueOnce(respondJson(shard));
    vi.stubGlobal('fetch', fetchMock);

    const first = await searchTagDictionary('beautiful');
    expect(first.map(s => s.name)).toEqual(['beautiful']);
    // manifest + shard 各一次，shard 进缓存
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 再次搜索同前缀：命中缓存，不再发网络请求
    fetchMock.mockClear();
    const second = await searchTagDictionary('be');
    expect(second.map(s => s.name)).toEqual(['beautiful']);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
