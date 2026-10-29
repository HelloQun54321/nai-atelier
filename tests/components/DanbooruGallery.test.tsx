import { toggleCollectionTarget } from '../../services/collectionFavorites';
// @vitest-environment jsdom
import React from 'react';
import { mockGalleryGeometry } from '../support/galleryGeometry';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DanbooruGallery } from '../../components/DanbooruGallery';
import { danbooruService, resolveDanbooruQuery, type DanbooruPost } from '../../services/danbooruService';
import type { User } from '../../types';
import { db } from '../../services/dbService';
import { api } from '../../services/api';
import { importDanbooruCoverAsDataUrl } from '../../services/danbooruCoverImport';
import { IMPORT_SESSION_KEY } from '../../services/metadataService';
import { galleryHistoryService } from '../../services/galleryHistoryService';
import { copySharedImage, downloadSharedImage } from '../../services/imageSharing';
vi.mock('../../services/imageSharing', async original => ({ ...await original<typeof import('../../services/imageSharing')>(), copySharedImage: vi.fn(async () => {}), downloadSharedImage: vi.fn(async () => {}) }));

vi.mock('../../services/danbooruService', async original => ({
  ...await original<typeof import('../../services/danbooruService')>(),
  danbooruService: { search: vi.fn() }, resolveDanbooruQuery: vi.fn(),
}));
const masonryRender = vi.hoisted(() => vi.fn());
vi.mock('../../components/ShortestColumnMasonry', async original => {
  const actual = await original<typeof import('../../components/ShortestColumnMasonry')>();
  return { ...actual, ShortestColumnMasonry: (props: Parameters<typeof actual.ShortestColumnMasonry>[0]) => {
    masonryRender(props);
    return <actual.ShortestColumnMasonry {...props} />;
  } };
});
vi.mock('../../services/galleryHistoryService', () => ({ galleryHistoryService: { recordView: vi.fn(), getHistory: vi.fn(() => []) } }));
vi.mock('../../services/dbService', () => ({ db: { getInspirationBoards: vi.fn(async () => []), getInspirationsBySource: vi.fn(async () => []), updateInspiration: vi.fn() } }));
vi.mock('../../services/api', () => ({ api: { post: vi.fn() } }));
vi.mock('../../services/danbooruCoverImport', () => ({ importDanbooruCoverAsDataUrl: vi.fn() }));

const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
const search = vi.mocked(danbooruService.search);
const resolve = vi.mocked(resolveDanbooruQuery);
const result = (query = 'order:rank', items: DanbooruPost[] = [], page = 1, hasMore = false) => ({ query, items, page, hasMore, limit: 40 });
const post: DanbooruPost = { id: 1, rating: 'g', score: 10, favCount: 10, width: 800, height: 1200, fileExt: 'png', previewUrl: '', sampleUrl: '', sourceUrl: '', postUrl: 'https://danbooru.donmai.us/posts/1', tags: { general: ['solo'], artist: ['synthetic_artist'], copyright: [], character: [], meta: [] } };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => {
  document.documentElement.dataset.motion = 'full';
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      if (target.classList.contains('chain-masonry')) this.callback([{ contentRect: { width: 1000 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver);
    }
    unobserve() {} disconnect() {}
  });
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); observers.length = 0;
  vi.mocked(db.getInspirationsBySource).mockResolvedValue([]);
  vi.mocked(galleryHistoryService.getHistory).mockReturnValue([]);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  vi.stubGlobal('IntersectionObserver', class {
    targets: Element[] = [];
    constructor(callback: typeof observers[number]) {
      observers.push(entries => callback(entries.flatMap(entry => this.targets.map(target => ({ ...entry, target })))));
    }
    observe(target: Element) { this.targets.push(target); }
    disconnect() { this.targets = []; }
  });
  search.mockImplementation(async options => result(options?.query, [], options?.page));
  resolve.mockImplementation(async value => value);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete document.documentElement.dataset.motion; delete document.documentElement.dataset.galleryFrostedCaption; });
const setup = async () => {
  const notify = vi.fn();
  const view = render(<DanbooruGallery active currentUser={{ id: 'synthetic' } as User} notify={notify} onNavigateToPlayground={vi.fn()} />);
  await waitFor(() => expect(screen.queryByText('正在读取 Danbooru…')).toBeNull());
  return { ...view, notify };
};
it('首次首屏请求等待中不显示空结果，成功空结果与失败保持不同反馈', async () => {
  let resolveSearch!: (value: ReturnType<typeof result>) => void;
  search.mockReturnValue(new Promise(done => { resolveSearch = done; }));
  const notify = vi.fn();
  const view = render(<DanbooruGallery active currentUser={{ id: 'synthetic' } as User} notify={notify} onNavigateToPlayground={vi.fn()} />);
  expect(screen.getByText('正在读取 Danbooru…')).toBeTruthy();
  expect(screen.queryByText('没有找到匹配图片')).toBeNull();
  await act(async () => resolveSearch(result()));
  await screen.findByText('没有找到匹配图片');
  view.unmount();

  search.mockRejectedValue(new Error('合成请求失败'));
  const failed = render(<DanbooruGallery active currentUser={{ id: 'synthetic' } as User} notify={notify} onNavigateToPlayground={vi.fn()} />);
  await screen.findByText('合成请求失败');
  expect(screen.queryByText('没有找到匹配图片')).toBeNull();
  failed.unmount();
});
const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
const changeFilter = (name: string, value: string) => fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });
const submit = (value: string) => { const input = screen.getByRole('searchbox', { name: '搜索 Danbooru' }); fireEvent.change(input, { target: { value } }); fireEvent.submit(input.closest('form')!); };
it.each(['masonry', 'portrait', 'square'].flatMap(layout => [true, false].map(frosted => [layout, frosted] as const)))('Danbooru 足迹 %s／磨砂 %s 关闭屏外占位，瀑布流使用稳定分列且不改变图片比例', async (layout, frosted) => {
  document.documentElement.dataset.galleryFrostedCaption = String(frosted);
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout, columns: 2, desktopColumns: 2 }));
  vi.mocked(galleryHistoryService.getHistory).mockReturnValue(Array.from({ length: 4 }, (_, index) => ({
    id: 'danbooru:' + (index + 1), source: 'danbooru', sourceId: index + 1,
    title: '足迹作品 ' + index, artistName: 'synthetic artist', previewUrl: '', sampleUrl: '', tags: [], viewedAt: 1,
  })));
  const { container } = await setup();
  expect(container.querySelector('[data-toolbar-count-caption]')?.textContent).toBe('已加载 0 件');
  fireEvent.click(screen.getByRole('button', { name: '浏览足迹' }));
  expect(container.querySelector('[data-toolbar-count-caption]')?.textContent).toBe('共 4 条');
  const cards = Array.from(container.querySelectorAll<HTMLElement>('article'));
  expect(cards).toHaveLength(4);
  cards.forEach(card => {
    expect(card.style.contentVisibility).toBe('visible');
    expect((card.querySelector('.mobile-gallery-frame') as HTMLElement).style.getPropertyValue('--mobile-image-ratio')).toBe('');
  });
  expect(container.querySelector('.mobile-gallery--masonry')).toBeNull();
  expect(container.querySelectorAll('.chain-masonry-column')).toHaveLength(layout === 'masonry' ? 2 : 0);
  if (layout === 'masonry') {
    const props = masonryRender.mock.lastCall![0];
    expect(props.stableColumns).toBe(true);
    expect(props.items.map(props.getItemKey)).toEqual(['danbooru:1', 'danbooru:2', 'danbooru:3', 'danbooru:4']);
    expect(props.estimateItemHeight(props.items[0], 200)).toBe(frosted ? 302 : 352);
    expect(cards[0].parentElement).toBe(cards[1].parentElement);
  }
});

it.each([false, true])('足迹=%s：列表和详情使用同一图片，图片操作不打开详情或记浏览足迹', async history => {
  const sampleUrl = 'data:image/png;base64,c3ludGhldGlj';
  search.mockImplementation(async options => result(options?.query, [{ ...post, sampleUrl }]));
  vi.mocked(galleryHistoryService.getHistory).mockReturnValue([{ id: 'danbooru:1', source: 'danbooru', sourceId: 1, title: 'synthetic_artist', previewUrl: '', sampleUrl, tags: [], viewedAt: 1 }]);
  await setup();
  if (history) fireEvent.click(screen.getByRole('button', { name: '浏览足迹' }));
  const open = await screen.findByRole('button', { name: /synthetic[ _]artist/ });
  const card = open.closest('article')!;
  fireEvent.click(within(card).getByRole('button', { name: '复制图片' }));
  await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith(sampleUrl, false));
  expect(galleryHistoryService.recordView).not.toHaveBeenCalled();
  fireEvent.click(open);
  const surface = screen.getByRole('img', { name: 'Danbooru #1' }).closest('.press-reveal-surface')!;
  fireEvent.click(within(surface as HTMLElement).getByRole('button', { name: '下载图片' }));
  await waitFor(() => expect(downloadSharedImage).toHaveBeenLastCalledWith(sampleUrl, expect.stringMatching(/^danbooru-1\./), false));
});
it.each(['masonry', 'portrait', 'square', 'history'])('Danbooru %s 卡片沿用 AITag 聚焦居中，切换和关闭详情同步恢复', async layout => {
  const posts = [post, { ...post, id: 2, tags: { ...post.tags, artist: ['second_artist'] } }]
    .map(item => ({ ...item, sampleUrl: 'data:image/png;base64,c3ludGhldGlj' }));
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout }));
  search.mockImplementation(async options => result(options?.query, posts));
  vi.mocked(galleryHistoryService.getHistory).mockReturnValue(posts.map(item => ({
    id: `danbooru:${item.id}`, source: 'danbooru', sourceId: item.id, title: item.tags.artist[0],
    previewUrl: '', sampleUrl: item.sampleUrl, tags: [], viewedAt: 1,
  })));
  await setup();
  if (layout === 'history') fireEvent.click(screen.getByRole('button', { name: '浏览足迹' }));
  const first = await screen.findByRole('button', { name: /synthetic[ _]artist/ });
  const second = screen.getByRole('button', { name: /second[ _]artist/ });
  const cards = [first.closest('article')!, second.closest('article')!];
  const { root, scrollCalls } = mockGalleryGeometry(cards, () => document.querySelector('.aitag-detail-panel--open') ? -600 : 0);
  root.scrollTop = 1400;
  cards.forEach(card => expect(card.className).not.toContain('brightness-'));
  fireEvent.click(first);
  expect(root.scrollTop).toBe(1050);
  expect(scrollCalls.slice(0, 2)).toEqual([{ top: 800, behavior: 'instant' }, { top: 1050, behavior: 'smooth' }]);
  expect(cards[0].className).toContain('ring-2');
  expect(cards[0].className).not.toContain('brightness-');
  expect(cards[1].className).toContain('brightness-[.7]');
  fireEvent.click(second);
  expect(root.scrollTop).toBe(1850);
  expect(cards[0].className).toContain('brightness-[.7]');
  expect(cards[1].className).not.toContain('brightness-');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(root.scrollTop).toBe(2450);
  cards.forEach(card => expect(card.className).not.toContain('brightness-'));
});

it('详情主操作是图片反推，原站复制／使用独立，保存实际图片及原站标注', async () => {
  search.mockImplementation(async options => result(options?.query, [post]));
  search.mockImplementation(async options => result(options?.query, [{ ...post, sampleUrl: 'https://cdn.donmai.us/original/synthetic.png' }]));
  vi.mocked(importDanbooruCoverAsDataUrl).mockResolvedValue('data:image/png;base64,c3ludGhldGlj');
  vi.mocked(api.post).mockImplementation(async (_path, body) => ({ item: body }));
  await setup(); fireEvent.click(await screen.findByRole('button', { name: /synthetic artist/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: '图片反推' }).hasAttribute('disabled')).toBe(false));
  expect(screen.queryByRole('button', { name: '更多' })).toBeNull();
  expect(screen.queryByRole('button', { name: '导入实验室' })).toBeNull();
  const source = screen.getByRole('link', { name: '查看原帖' });
  expect(source.closest('header')).toBeTruthy();
  expect(source.getAttribute('href')).toBe(post.postUrl);
  expect(screen.getByRole('group', { name: '图片操作' }).contains(source)).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '原站 Tag 送往实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ prompt: 'solo', mode: 'append-prompt' });
  fireEvent.click(screen.getAllByRole('button', { name: '收藏' }).at(-1)!);
  await waitFor(() => expect(toggleCollectionTarget).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'danbooru', sourceId: String(post.id), prompt: 'solo', analysis: { externalSourceTags: ['synthetic_artist', 'solo'], externalSourcePage: 0 } })));
  expect(screen.queryByRole('button', { name: '加入收藏库' })).toBeNull();
});
it('同一作品更新已存反推，不重复下载或创建，保留原分类与备注', async () => {
  search.mockImplementation(async options => result(options?.query, [post]));
  const stored = { id: 'saved', userId: 'synthetic', title: 'keep title', imageUrl: '/api/assets/saved', prompt: 'blue hair', notes: 'keep notes', boardId: 'keep board', createdAt: 1, analysis: { extra: 'keep', imageTagger: { prompt: 'blue hair', createdAt: 1, result: { model: 'test', threshold: 0.35, characterThreshold: 0.85, rating: null, tags: [], character: [], general: [] } } } };
  vi.mocked(db.getInspirationsBySource).mockResolvedValue([stored]);
  await setup(); fireEvent.click(await screen.findByRole('button', { name: /synthetic artist/ }));
  await screen.findByRole('textbox', { name: '反推 Tag' });
  fireEvent.change(screen.getByRole('textbox', { name: '反推 Tag' }), { target: { value: 'edited hair' } });
  fireEvent.click(screen.getByRole('button', { name: '保存反推 Tag' }));
  await waitFor(() => expect(db.updateInspiration).toHaveBeenCalledWith('saved', { prompt: 'edited hair', analysis: { extra: 'keep', externalSourcePage: 0, externalSourceTags: ['synthetic_artist', 'solo'], imageTagger: { ...stored.analysis.imageTagger, prompt: 'edited hair' } } }));
  expect(importDanbooruCoverAsDataUrl).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
});
it('切换查询中止旧预取，迟到预取不再发起图片预热', async () => {
  const pending = deferred<ReturnType<typeof result>>();
  search.mockImplementation(async options => options?.page === 2 ? pending.promise : result(options?.query, [], 1, !options?.query?.includes('new')));
  await setup(); await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  const signal = search.mock.calls[1][0]?.signal;
  submit('new'); await waitFor(() => expect(search).toHaveBeenCalledTimes(3));
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve(result('order:rank', [{ ...post, sampleUrl: 'https://cdn.donmai.us/synthetic.webp' }], 2)));
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  const bodies = vi.mocked(fetch).mock.calls.filter(call => String(call[0]) === '/api/media/prewarm').map(call => JSON.parse(String(call[1]?.body)));
  expect(bodies.some(body => body.sources?.includes('https://cdn.donmai.us/synthetic.webp'))).toBe(false);
});
it('隐藏中止首屏，返回恢复加载，不被迟到旧响应覆盖', async () => {
  const pending = deferred<ReturnType<typeof result>>();
  search.mockReturnValueOnce(pending.promise).mockResolvedValue(result());
  const props = { currentUser: { id: 'synthetic' } as User, notify: vi.fn(), onNavigateToPlayground: vi.fn() };
  const { rerender } = render(<DanbooruGallery {...props} active />);
  const signal = search.mock.calls[0][0]?.signal;
  rerender(<DanbooruGallery {...props} active={false} />); expect(signal?.aborted).toBe(true);
  rerender(<DanbooruGallery {...props} active />);
  await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  await act(async () => pending.resolve(result('old', [post])));
  expect(screen.queryByRole('button', { name: /synthetic artist/ })).toBeNull();
});

it('慢翻译不能覆盖后来选择的筛选，也不能发送过期请求', async () => {
  await setup();
  const first = deferred<string>();
  resolve.mockReturnValueOnce(first.promise).mockResolvedValueOnce('synthetic');
  submit('旧中文'); submit('新中文');
  await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'synthetic order:rank', page: 1, limit: 40 })));
  const calls = search.mock.calls.length;
  await act(async () => first.resolve('old_tag'));
  expect(search).toHaveBeenCalledTimes(calls);
  expect(screen.queryByText('检索：old tag order:rank')).toBeNull();
});

it('超限组合在出站前提示，选择最新后可用两个关键词和画幅／评级', async () => {
  const { notify } = await setup();
  submit('frieren solo');
  await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('选择「最新」'), 'error'));
  expect(search).toHaveBeenCalledTimes(1);
  openFilters(); changeFilter('排序方式', 'latest');
  await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'frieren solo', page: 1, limit: 40 })));
  changeFilter('评级范围', 'g');
  await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'frieren solo rating:g', page: 1, limit: 40 })));
  changeFilter('画幅比例', 'portrait');
  await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'frieren solo rating:g ratio:<0.85', page: 1, limit: 40 })));
});

it('点击详情 Tag 沿用当前排序和筛选，不偷换成高分排序', async () => {
  search.mockImplementation(async options => result(options?.query, [post]));
  await setup(); openFilters(); changeFilter('评级范围', 'g');
  await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'order:rank rating:g', page: 1, limit: 40 })));
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(await screen.findByRole('button', { name: /synthetic artist/ }));
  fireEvent.click(screen.getByRole('button', { name: 'synthetic artist' }));
  await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'synthetic_artist order:rank rating:g', page: 1, limit: 40 })));
});

it('同查询重新加载时，之前的追加页不能拼回新结果', async () => {
  const nextPage = deferred<ReturnType<typeof result>>();
  let first = true;
  search.mockImplementation(async options => {
    if (options?.page === 2) return nextPage.promise;
    if (first) { first = false; return result('order:rank', [post], 1, true); }
    return result();
  });
  await setup();
  await waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'order:rank', page: 2, limit: 40 })));
  // 空 src 的合成图不会注册图片观察器，此处只有列表触底观察器。
  act(() => observers.at(-1)?.([{ isIntersecting: true }]));
  submit('');
  await waitFor(() => expect(screen.getByText('没有找到匹配图片')).toBeTruthy());
  await act(async () => nextPage.resolve(result('order:rank', [{ ...post, id: 2 }], 2, false)));
  expect(screen.queryByRole('button', { name: /synthetic artist/ })).toBeNull();
});

it('筛选后的空页仍可继续读取后续页，不因条目数量未变而停止观察', async () => {
  search.mockImplementation(async options => result(options?.query, [], options?.page, (options?.page || 1) < 3));
  await setup();
  await waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'order:rank', page: 2, limit: 40 })));
  await act(async () => observers.at(-1)?.([{ isIntersecting: true }]));
  await waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ page: 3 })));
  await act(async () => observers.at(-1)?.([{ isIntersecting: true }]));
  await screen.findByText('已加载 0 件 · 已全部加载');
  expect(search).not.toHaveBeenCalledWith(expect.objectContaining({ page: 4 }));
  expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'order:rank', page: 3, limit: 40 }));
});

it('超过 800 条后仍由底部哨兵自动追加，直到服务端报告末页', async () => {
  const firstPage = Array.from({ length: 800 }, (_, index) => ({ ...post, id: index + 1, postUrl: `https://danbooru.donmai.us/posts/${index + 1}` }));
  const lastPost = { ...post, id: 801, postUrl: 'https://danbooru.donmai.us/posts/801' };
  search.mockImplementation(async options => options?.page === 1
    ? result(options?.query, firstPage, 1, true)
    : result(options?.query, [lastPost], 2, false));
  const { container } = await setup();
  await waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ page: 2, limit: 40 })));
  expect(container.querySelector('[data-gallery-work-id="801"]')).toBeNull();
  act(() => observers.at(-1)?.([{ isIntersecting: true }]));
  await waitFor(() => expect(container.querySelector('[data-gallery-work-id="801"]')).toBeTruthy());
  expect(container.querySelector('[data-gallery-work-id="800"]')).toBeTruthy();
  expect(container.querySelector('[data-gallery-work-id="801"]')).toBeTruthy();
  expect(search).not.toHaveBeenCalledWith(expect.objectContaining({ page: 3 }));
});

it('追加请求失败后停止自动重试，用户点重试后继续加载', async () => {
  let pageTwoAttempts = 0;
  search.mockImplementation(async options => {
    if (options?.page === 1) return result(options?.query, [post], 1, true);
    pageTwoAttempts += 1;
    if (pageTwoAttempts <= 2) throw new Error('429 合成限流');
    return result(options?.query, [{ ...post, id: 2 }], 2, false);
  });
  const { notify } = await setup();
  await waitFor(() => expect(pageTwoAttempts).toBe(1)); // 首屏后的预取失败
  act(() => observers.at(-1)?.([{ isIntersecting: true }]));
  await screen.findByRole('alert');
  expect(screen.getByText('429 合成限流')).toBeTruthy();
  expect(pageTwoAttempts).toBe(2);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(pageTwoAttempts).toBe(2);

  fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
  await waitFor(() => expect(pageTwoAttempts).toBe(3));
  await waitFor(() => expect(document.querySelector('[data-gallery-work-id="2"]')).toBeTruthy());
  expect(screen.queryByRole('alert')).toBeNull();
  expect(notify).toHaveBeenCalledWith('429 合成限流', 'error');
});

// 收藏服务的持久化与并发在 services 定向测试中验证，这里隔离页面副作用。
vi.mock('../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../services/collectionFavorites')>(),
  ensureCollection: vi.fn(async () => {}), loadCollection: vi.fn(async () => []),
  subscribeCollection: () => () => {}, collectionRevision: () => 0, collectionTargetActive: () => false,
  toggleCollectionTarget: vi.fn(async () => true), syncHistoryCollectionFavorites: vi.fn(async () => {}),
}));
