// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ARTIST_SAMPLES_CHANGED, buildArtistSampleImageUrl, controlArtistSamplePack, getArtistSampleCatalog, getArtistSampleDictionary, getArtistSampleLookup, getArtistSampleStatus, matchArtistSampleTags, normalizeArtistSampleTag } from '../../services/artistSamples';
import { getArtistDictionaryEntriesAt, getArtistDictionaryPage } from '../../services/tagDictionary';
import { getSampledArtistDictionaryEntries, mergeArtistSampleDictionary, getArtistSampleLibrary } from '../../services/artistSamples';
import { isArtistSampleModelForPack, isArtistOwnSampleForPack, getAvailableArtistSampleIndices, getAvailableArtistSampleCatalogTags, getArtistSampleCatalogImageIndex, isArtistOwnSampleRemoved, type ArtistSampleRemoval } from '../../services/artistSamples';
vi.mock('../../services/tagDictionary', () => ({ getArtistDictionaryPage: vi.fn(), getArtistDictionaryEntriesAt: vi.fn() }));
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('V5样张只认Full与FullMedium，V4.5保留原模型范围，缺失模型不冒充Full', () => {
  for (const model of ['nai-diffusion-5-full', 'nai-diffusion-5-full-medium']) expect(isArtistSampleModelForPack('v5', model)).toBe(true);
  for (const model of ['nai-diffusion-5-curated', 'nai-diffusion-5-full-inpainting', 'nai-diffusion-5-full-medium-inpainting', 'nai-diffusion-5-unknown', '']) expect(isArtistSampleModelForPack('v5', model)).toBe(false);
  expect(isArtistSampleModelForPack('v45', 'nai-diffusion-4-5-curated')).toBe(true);
  expect(isArtistSampleModelForPack('v45', 'nai-diffusion-4-5-full')).toBe(true);
  expect(isArtistOwnSampleForPack({ pack: 'v5', params: { model: 'nai-diffusion-5-curated' } } as any)).toBe(false);
  expect(isArtistOwnSampleForPack({ pack: 'v45' } as any)).toBe(true);
  expect(isArtistOwnSampleForPack({ pack: 'v5' } as any)).toBe(false);
});

it('图包删除按版本精确Tag和物理index去重，首张跳过隐藏项，全删后移出可用目录', () => {
  const catalog = { pack: 'v45' as const, revision: 'one', tags: ['Artist_A', 'artist a', 'single'] };
  const removed: ArtistSampleRemoval[] = [
    { source: 'pack', pack: 'v45', revision: 'one', tag: 'Artist_A', index: 0, imageCount: 2 },
    { source: 'pack', pack: 'v45', revision: 'one', tag: 'Artist_A', index: 0, imageCount: 2 },
    { source: 'pack', pack: 'v45', revision: 'one', tag: 'single', index: 0, imageCount: 1 },
  ];
  expect(getAvailableArtistSampleIndices('v45', 'Artist_A', 'one', 2, removed)).toEqual([1]);
  expect(getArtistSampleCatalogImageIndex(catalog, 'Artist_A', removed)).toBe(1);
  expect(getArtistSampleCatalogImageIndex(catalog, 'artist a', removed)).toBe(0);
  expect(getArtistSampleCatalogImageIndex(catalog, 'ARTIST A', removed)).toBeUndefined();
  expect(getAvailableArtistSampleCatalogTags(catalog, removed)).toEqual(['Artist_A', 'artist a']);
  expect(getArtistSampleCatalogImageIndex({ ...catalog, revision: 'two' }, 'single', removed)).toBe(0);
  expect(getArtistSampleCatalogImageIndex({ ...catalog, tags: ['Artist_A'] }, 'artist a', removed)).toBe(1);
  const own = { id: 'one', pack: 'v45', tag: 'Artist_A' } as any;
  expect(isArtistOwnSampleRemoved(own, [{ source: 'own', pack: 'v45', tag: 'Artist_A', id: 'one' }])).toBe(true);
  expect(isArtistOwnSampleRemoved({ ...own, pack: 'v5' }, [{ source: 'own', pack: 'v45', tag: 'Artist_A', id: 'one' }])).toBe(false);
});

it('状态、目录、lookup与图片URL保留原Tag、模型包和revision，查询只走本地接口', async () => {
  vi.mocked(fetch).mockImplementation(async url => response({ endpoint: String(url) }));
  await getArtistSampleStatus(); await getArtistSampleCatalog('v5'); await getArtistSampleLookup('v45', 'artist name (x)');
  expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual(['/api/artist-samples/status', '/api/artist-samples/catalog?pack=v5', '/api/artist-samples/lookup?pack=v45&tag=artist+name+%28x%29']);
  const url = new URL(buildArtistSampleImageUrl('v5', 'artist name (x)', 2, 'revision & one'), 'http://synthetic.local');
  expect(url.pathname).toBe('/api/artist-samples/image');
  expect(Object.fromEntries(url.searchParams)).toEqual({ pack: 'v5', tag: 'artist name (x)', index: '2', revision: 'revision & one' });
});

it('控制接口只有显式动作与local-control头，取消选择不广播变更', async () => {
  const changed = vi.fn(); window.addEventListener(ARTIST_SAMPLES_CHANGED, changed);
  try {
    vi.mocked(fetch).mockResolvedValueOnce(response({ status: { packs: [] } })).mockResolvedValueOnce(response({ cancelled: true, status: { packs: [] } }));
    await controlArtistSamplePack('reindex', 'v5'); await controlArtistSamplePack('pick', 'v45');
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/artist-samples/control', expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nai-local-control': 'true' }, body: JSON.stringify({ action: 'reindex', pack: 'v5' }) }));
    expect(changed).toHaveBeenCalledOnce();
  } finally { window.removeEventListener(ARTIST_SAMPLES_CHANGED, changed); }
});

it('后台下载与暂停使用control动作，并广播设置状态变化', async () => {
  const changed = vi.fn(); window.addEventListener(ARTIST_SAMPLES_CHANGED, changed);
  try {
    vi.mocked(fetch).mockResolvedValueOnce(response({ status: { packs: [] } })).mockResolvedValueOnce(response({ status: { packs: [] } }));
    await controlArtistSamplePack('download', 'v45');
    await controlArtistSamplePack('pause', 'v45');
    expect(vi.mocked(fetch).mock.calls.map(([url, init]) => ({ url: String(url), body: (init as RequestInit).body }))).toEqual([
      { url: '/api/artist-samples/control', body: JSON.stringify({ action: 'download', pack: 'v45' }) },
      { url: '/api/artist-samples/control', body: JSON.stringify({ action: 'pause', pack: 'v45' }) },
    ]);
    expect(changed).toHaveBeenCalledTimes(2);
  } finally { window.removeEventListener(ARTIST_SAMPLES_CHANGED, changed); }
});

it('后端错误保留具体原因，不伪装为无样张', async () => {
  vi.mocked(fetch).mockResolvedValue(response({ error: '合成索引损坏', code: 'SYNTHETIC_INDEX' }, 409));
  await expect(getArtistSampleCatalog('v5')).rejects.toMatchObject({ message: '合成索引损坏', status: 409, code: 'SYNTHETIC_INDEX' });
});

it('逐包操作仅在指定时传file，保留整组调用与成功取消失败的广播语义', async () => {
  const changed = vi.fn(); window.addEventListener(ARTIST_SAMPLES_CHANGED, changed);
  try {
    vi.mocked(fetch).mockImplementation(async () => response({ status: { packs: [] } }));
    await controlArtistSamplePack('download', 'v5', 'STYLISH-8000');
    await controlArtistSamplePack('pause', 'v5', 'STYLISH-8000');
    await controlArtistSamplePack('download', 'v45');
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string))).toEqual([
      { action: 'download', pack: 'v5', file: 'STYLISH-8000' },
      { action: 'pause', pack: 'v5', file: 'STYLISH-8000' },
      { action: 'download', pack: 'v45' },
    ]);
    expect(changed).toHaveBeenCalledTimes(3);
    vi.mocked(fetch).mockResolvedValueOnce(response({ cancelled: true, status: { packs: [] } }));
    await controlArtistSamplePack('download', 'v5', 'NAID5F-10000-Q');
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: '合成分片失败' }, 409));
    await expect(controlArtistSamplePack('download', 'v5', 'STYLISH-8000')).rejects.toThrow('合成分片失败');
    expect(changed).toHaveBeenCalledTimes(3);
  } finally { window.removeEventListener(ARTIST_SAMPLES_CHANGED, changed); }
});

it('未提供图包能力的状态404提示支持平台，不把NotFound当成已配置的空目录', async () => {
  vi.mocked(fetch).mockResolvedValue(response({ error: 'Not Found' }, 404));
  await expect(getArtistSampleStatus()).rejects.toThrow('本地图包仅支持电脑端及局域网访问');
});

it.each([['lookup', 15_000], ['picker', 310_000]] as const)('%s 请求使用确定的超时，选择窗口不会被15秒提前取消', async (kind, timeout) => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => { signal = init!.signal as AbortSignal; signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); }));
  const pending = kind === 'picker' ? controlArtistSamplePack('pick', 'v5') : getArtistSampleLookup('v5', 'sample');
  const rejected = expect(pending).rejects.toThrow('读取画师样张超时，请重试');
  if (kind === 'picker') { await vi.advanceTimersByTimeAsync(15_000); expect(signal.aborted).toBe(false); }
  await vi.advanceTimersByTimeAsync(kind === 'picker' ? timeout - 15_000 : timeout); await rejected;
});

it('外部取消可终止状态与lookup，取消不改成超时', async () => {
  vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); }));
  const controller = new AbortController();
  const status = getArtistSampleStatus(controller.signal), lookup = getArtistSampleLookup('v5', 'sample', controller.signal);
  const checks = [expect(status).rejects.toMatchObject({ name: 'AbortError' }), expect(lookup).rejects.toMatchObject({ name: 'AbortError' })];
  controller.abort(); await Promise.all(checks);
});

it('完整轻量目录通过既有分片入口加载一次，包含首个分页之外的画师', async () => {
  vi.mocked(getArtistDictionaryPage).mockResolvedValue({ page: 0, pageCount: 2, pageSize: 100, total: 101, entries: [] });
  vi.mocked(getArtistDictionaryEntriesAt).mockResolvedValue([{ name: 'last artist', chinese: '', postCount: 1 }]);
  const first = getArtistSampleDictionary(), second = getArtistSampleDictionary();
  expect(first).toBe(second); await expect(first).resolves.toEqual([{ name: 'last artist', chinese: '', postCount: 1 }]);
  expect(getArtistDictionaryEntriesAt).toHaveBeenCalledWith(Array.from({ length: 101 }, (_, index) => index));
  expect(getArtistDictionaryPage).toHaveBeenCalledOnce();
});

it('原名精确匹配优先；下划线、空白与大小写唯一匹配，冲突或未知包键不造画师', () => {
  expect(normalizeArtistSampleTag('  Artist__Name \t ')).toBe('artist name');
  const entries = ['foo_bar', 'foo bar', 'mizu', 'missing'].map(name => ({ name, chinese: '', postCount: 1 }));
  expect(matchArtistSampleTags(entries, ['foo_bar', 'MIZU', 'not in dictionary']).map(entry => entry.name)).toEqual(['foo_bar', 'mizu']);
  expect(matchArtistSampleTags([{ name: 'artist name', chinese: '', postCount: 1 }], ['Artist__Name']).map(entry => entry.name)).toEqual(['artist name']);
  expect(matchArtistSampleTags([{ name: 'mizu', chinese: '', postCount: 1 }], ['Mizu', 'MIZU'])).toEqual([]);
});

it('目录并集保留无图画师及词库身份，只补图包原名并明确未知热度', () => {
  const known = { name: 'known_artist', chinese: '已有译名', postCount: 42 };
  const missing = { name: 'without image', chinese: '', postCount: 0 };
  const entries = [known, missing];
  const merged = mergeArtistSampleDictionary(entries, ['Known Artist', '包内画师', '包内画师']);
  expect(merged).toEqual([known, missing, { name: '包内画师', chinese: '', postCount: 0, postCountKnown: false }]);
  expect(merged[0]).toBe(known);
  expect(getSampledArtistDictionaryEntries(entries, ['Known Artist', '包内画师'])).toEqual([known, merged[2]]);
  expect(mergeArtistSampleDictionary(entries, [])).toEqual(entries);
  expect(mergeArtistSampleDictionary(entries, ['second pack']).map(entry => entry.name)).toEqual(['known_artist', 'without image', 'second pack']);
  expect(entries).toEqual([known, missing]);
});

it('并集精确匹配优先，归一化冲突保留原名而不猜测或吞掉图包名称', () => {
  const entries = ['foo_bar', 'foo bar', 'mizu'].map(name => ({ name, chinese: name, postCount: 2 }));
  const merged = mergeArtistSampleDictionary(entries, ['foo_bar', 'FOO BAR', 'Mizu', 'MIZU', '  ']);
  expect(merged.map(entry => entry.name)).toEqual(['foo_bar', 'foo bar', 'mizu', 'FOO BAR', 'Mizu', 'MIZU']);
  expect(getSampledArtistDictionaryEntries(entries, ['foo_bar', 'FOO BAR']).map(entry => entry.name)).toEqual(['foo_bar', 'FOO BAR']);
});

it('完整浏览目录合并所有已接入包原始名单，切换来源不累积过期条目且不重读词库', async () => {
  let tags = ['pack only'];
  vi.mocked(fetch).mockImplementation(async url => String(url).includes('/status')
    ? response({ packs: [{ id: 'v45', phase: 'ready' }, { id: 'v5', phase: 'ready', model: 'nai-diffusion-5-full' }] })
    : response({ pack: String(url).includes('pack=v5') ? 'v5' : 'v45', model: 'nai-diffusion-5-full', tags }));
  expect((await getArtistSampleLibrary()).map(entry => entry.name)).toContain('pack only');
  tags = ['replacement'];
  const next = await getArtistSampleLibrary();
  expect(next.map(entry => entry.name)).toContain('replacement');
  expect(next.map(entry => entry.name)).not.toContain('pack only');
  expect(getArtistDictionaryEntriesAt).not.toHaveBeenCalled();
});

it('未接入或旧Curated包不请求catalog，已接入目录错误明确拒绝并可重试', async () => {
  vi.mocked(fetch).mockResolvedValue(response({ packs: [{ id: 'v45', phase: 'unconfigured' }, { id: 'v5', phase: 'ready', model: 'nai-diffusion-5-curated' }] }));
  await getArtistSampleLibrary();
  expect(fetch).toHaveBeenCalledOnce();
  vi.mocked(fetch).mockImplementation(async url => String(url).includes('/status')
    ? response({ packs: [{ id: 'v5', phase: 'ready', model: 'nai-diffusion-5-full' }] })
    : response({ error: '合成目录读取失败' }, 503));
  await expect(getArtistSampleLibrary()).rejects.toThrow('合成目录读取失败');
  vi.mocked(fetch).mockImplementation(async url => String(url).includes('/status')
    ? response({ packs: [{ id: 'v5', phase: 'ready', model: 'nai-diffusion-5-full' }] })
    : response({ pack: 'v5', model: 'nai-diffusion-5-full', tags: [] }));
  await expect(getArtistSampleLibrary()).resolves.toEqual(await getArtistSampleDictionary());
});

it('不支持本地图包的status404回退词库，鉴权401仍显式失败', async () => {
  vi.mocked(fetch).mockImplementation(async () => response({ error: 'Not Found' }, 404));
  await expect(getArtistSampleLibrary()).resolves.toBe(await getArtistSampleDictionary());
  expect(fetch).toHaveBeenCalledOnce();
  vi.mocked(fetch).mockImplementation(async () => response({ error: '请先登录' }, 401));
  await expect(getArtistSampleLibrary()).rejects.toMatchObject({ status: 401 });
});
