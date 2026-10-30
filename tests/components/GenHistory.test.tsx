import { installPointerEvents, longPress } from '../support/touchEvents';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenHistory } from '../../components/GenHistory';
import { HistoryImagePicker } from '../../components/HistoryImagePicker';
import { localHistory } from '../../services/localHistory';
import { copySharedImage, downloadSharedImage, setCleanSharedImages } from '../../services/imageSharing';
import type { LocalGenItem } from '../../types';
import { db } from '../../services/dbService';
import { buildBrowserHistoryOrder } from '../../services/historyBrowse';
import { LANGUAGES, setLanguage, t } from '../../services/i18n';
import { syncHistoryCollectionFavorites } from '../../services/collectionFavorites';

const { confirmAction, listeners, imageRender, collectionState } = vi.hoisted(() => ({ confirmAction: vi.fn(async () => false), imageRender: vi.fn(), listeners: new Set<(event: { type: string; id?: string; external?: boolean; favorite?: boolean }) => void>(), collectionState: { active: false } }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => confirmAction }));
vi.mock('../../components/SmartImage', () => ({
    ImageActivityContext: React.createContext(true),
    SmartImage: ({ src, alt, className, onLoad }: { src: string; alt: string; className?: string; onLoad?: React.ReactEventHandler<HTMLImageElement> }) => { imageRender(src); return <img src={src} alt={alt} className={className} onLoad={onLoad} />; },
    OriginalImage: ({ src, alt, className, onLoad, onError, style }: React.ImgHTMLAttributes<HTMLImageElement>) => <img src={src} alt={alt} className={className} onLoad={onLoad} onError={onError} style={style} />,
}));

vi.mock('../../services/localHistory', () => ({ localHistory: {
    prepare: vi.fn(async () => 0), subscribe: (listener: (event: { type: string; id?: string; external?: boolean; favorite?: boolean }) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    getPage: vi.fn(), getBrowseOrder: vi.fn(), setFavorite: vi.fn(async () => 1), delete: vi.fn(),
    countOlderThan: vi.fn(async () => 0), getCount: vi.fn(async () => 2), deleteOlderThan: vi.fn(), keepOnly: vi.fn(),
} }));
vi.mock('../../services/dbService', () => ({ db: { getInspirationBoards: vi.fn(async () => []), saveInspiration: vi.fn(async () => {}) } }));
vi.mock('../../services/imageSharing', async importOriginal => ({
    ...await importOriginal<typeof import('../../services/imageSharing')>(),
    copySharedImage: vi.fn(async () => {}), downloadSharedImage: vi.fn(async () => {}),
}));

const items = [1, 2].map(id => ({
    id: `history-${id}`, imageUrl: `/api/images/original-${id}.png`,
    prompt: 'synthetic test image', negativePrompt: '',
    params: { width: 832, height: 1216 },
    createdAt: new Date(2026, 9, 2, 2, 30, id).getTime(),
})) as LocalGenItem[];
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
let loadMore: (() => void) | undefined;

beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
    collectionState.active = false;
    items.forEach(item => { delete item.isFavorite; delete item.favoriteAt; });
    loadMore = undefined; confirmAction.mockResolvedValue(false);
    vi.mocked(localHistory.getPage).mockResolvedValue({ items, count: items.length });
    vi.mocked(localHistory.getBrowseOrder).mockResolvedValue({ ids: items.map(item => item.id), models: [], sources: [] });
    vi.mocked(copySharedImage).mockResolvedValue(); vi.mocked(downloadSharedImage).mockResolvedValue();
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class {
        constructor(private callback: ResizeObserverCallback) {}
        observe() { this.callback([{ contentRect: { width: Math.min(1024, window.innerWidth - 24) } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
        unobserve() {} disconnect() {}
    });
    vi.stubGlobal('IntersectionObserver', class {
        constructor(private callback: IntersectionObserverCallback) {}
        observe(element: HTMLElement) { if (element.dataset.historyLoadMore || element.dataset.masonryLoadEnd) loadMore = () => { const rect = element.getBoundingClientRect(); this.callback([{ target: element, isIntersecting: true, boundingClientRect: rect, intersectionRatio: 1, intersectionRect: rect, rootBounds: null, time: performance.now() }], this as unknown as IntersectionObserver); }; }
        unobserve() {} disconnect() {}
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })));
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => {
    vi.useRealTimers();
    cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    setLanguage('zh-CN');
    if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
});

const setup = async (width = 1280, expectedCount = 2) => {
    vi.stubGlobal('innerWidth', width);
    const notify = vi.fn();
    const navigate = vi.fn();
    const result = render(<div className="agent-stage safe-mode dark"><aside className="relative z-40">侧边栏</aside><main className="isolate overflow-hidden"><GenHistory currentUser={{ id: 'local', username: 'owner', role: 'user', createdAt: 1 }} chains={[]} notify={notify} onNavigateToPlayground={navigate} /></main></div>);
    await waitFor(() => expect(result.container.querySelectorAll('.mobile-gallery-item').length).toBe(expectedCount));
    return { ...result, notify, navigate, cards: Array.from(result.container.querySelectorAll<HTMLElement>('.mobile-gallery-item')) };
};

it('足迹带入的画师筛选应用到历史浏览查询', async () => {
    render(<GenHistory currentUser={{ id: 'local', username: 'owner', role: 'user', createdAt: 1 }} chains={[]} notify={vi.fn()} initialQuery={{ query: { search: 'artist:alpha_artist', sort: 'newest' }, token: 1 }} />);
    await waitFor(() => expect(vi.mocked(localHistory.getBrowseOrder).mock.calls.some(([query]) => query.search === 'artist:alpha_artist')).toBe(true));
});

it('首次历史请求未就绪和失败不显示暂无，重试成功空结果才显示空态', async () => {
    let fail!: (error: Error) => void;
    const delayed = new Promise<never>((_resolve, reject) => { fail = reject; });
    vi.mocked(localHistory.getBrowseOrder).mockReturnValue(delayed);
    render(<GenHistory currentUser={{ id: 'local', username: 'owner', role: 'user', createdAt: 1 }} chains={[]} notify={vi.fn()} />);
    expect(screen.getByText('加载中…')).toBeTruthy(); expect(screen.queryByText('暂无生成记录')).toBeNull();
    await act(async () => fail(new Error('合成历史失败')));
    expect(await screen.findByText('历史加载失败')).toBeTruthy(); expect(screen.queryByText('暂无生成记录')).toBeNull();
    vi.mocked(localHistory.getBrowseOrder).mockResolvedValue({ ids: [], models: [], sources: [] }); vi.mocked(localHistory.getPage).mockResolvedValue({ items: [], count: 0 });
    fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(await screen.findByText('暂无生成记录')).toBeTruthy();
});

it('历史图片选择器未知数量显示读取，缓存刷新失败保留图片且不报无图', async () => {
    let finish!: (value: { items: LocalGenItem[]; count: number }) => void;
    vi.mocked(localHistory.getPage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<HistoryImagePicker open onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText('正在读取历史图片…')).toBeTruthy(); expect(screen.getByText('全部 — 张')).toBeTruthy(); expect(screen.queryByText('历史页面中还没有生成图片')).toBeNull();
    await act(async () => finish({ items, count: items.length })); expect(screen.getAllByRole('img', { name: '历史生成图片' })).toHaveLength(2);
    let fail!: (error: Error) => void;
    vi.mocked(localHistory.getPage).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    act(() => listeners.forEach(listener => listener({ type: 'saved' })));
    expect(screen.getByText('全部 — 张')).toBeTruthy(); expect(screen.getAllByRole('img', { name: '历史生成图片' })).toHaveLength(2);
    await act(async () => fail(new Error('合成刷新失败')));
    expect(await screen.findByText('历史图片读取失败，请重试。')).toBeTruthy(); expect(screen.getAllByRole('img', { name: '历史生成图片' })).toHaveLength(2); expect(screen.queryByText('历史页面中还没有生成图片')).toBeNull();
});

it('历史仅追加下沿数量小字，原数量与手机浏览控件保留', async () => {
    const { container } = await setup(390);
    const caption = container.querySelector('[data-toolbar-count-caption]');
    expect(caption?.textContent).toBe('共 2 张 · 已加载 2 张');
    expect(container.querySelector('.history-result-count')?.textContent).toBe('2 张');
    expect(screen.getByRole('button', { name: '随机浏览' })).toBeTruthy();
    expect(container.querySelectorAll('[data-toolbar-count-caption]')).toHaveLength(1);
});

it('历史下沿小字按查询范围显示匹配数', async () => {
    const view = render(<GenHistory currentUser={{ id: 'local', username: 'owner', role: 'user', createdAt: 1 }} chains={[]} notify={vi.fn()}
        initialQuery={{ query: { search: 'synthetic' }, token: 1 }} />);
    await waitFor(() => expect(view.container.querySelector('[data-toolbar-count-caption]')?.textContent).toBe('匹配 2 张 · 已加载 2 张'));
});

it('历史图片选择器只追加下沿小字，保留原数量与关闭按钮', async () => {
    render(<HistoryImagePicker open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('共 2 张').closest('[data-toolbar-count-caption]')).toBeTruthy());
    expect(screen.getByText('全部 2 张')).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭历史图片选择' })).toBeTruthy();
    expect(screen.getByText('共 2 张').closest('header')?.hasAttribute('data-toolbar-caption-host')).toBe(true);
});

describe('历史缩略图就地操作', () => {
    it('打开关闭详情不重绘列表，单图尺寸及收藏更新只重绘当前卡片', async () => {
        const { cards } = await setup();
        await act(async () => {});
        imageRender.mockClear();
        fireEvent.click(cards[0]);
        expect(screen.getByRole('dialog', { name: '历史图片查看器' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '返回历史列表' }));
        expect(imageRender).not.toHaveBeenCalled();
        const image = within(cards[0]).getByRole('img');
        Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 800 } });
        fireEvent.load(image);
        expect(imageRender).toHaveBeenCalledWith(items[0].imageUrl);
        expect(imageRender).not.toHaveBeenCalledWith(items[1].imageUrl);
        imageRender.mockClear();
        fireEvent.click(within(cards[0]).getByRole('button', { name: '收藏' }));
        await waitFor(() => expect(within(cards[0]).getByRole('button', { name: '取消收藏' })).toBeTruthy());
        expect(imageRender).toHaveBeenCalledWith(items[0].imageUrl);
        expect(imageRender).not.toHaveBeenCalledWith(items[1].imageUrl);
        fireEvent.click(within(cards[0]).getByRole('button', { name: '取消收藏' }));
        await waitFor(() => expect(localHistory.setFavorite).toHaveBeenLastCalledWith(items[0].id, false));
    });

    it('稳定卡片回调仍读取最新页面回调，删除确认继续有效', async () => {
        const notify = vi.fn(), beforeRefresh = vi.fn(), afterRefresh = vi.fn();
        const props = { currentUser: { id: 'local', username: 'owner', role: 'user' as const, createdAt: 1 }, chains: [], notify, onRefreshInspiration: beforeRefresh };
        const view = render(<GenHistory {...props} />);
        await waitFor(() => expect(view.container.querySelectorAll('.mobile-gallery-item')).toHaveLength(2));
        await act(async () => {});
        imageRender.mockClear();
        view.rerender(<GenHistory {...props} onRefreshInspiration={afterRefresh} />);
        expect(imageRender).not.toHaveBeenCalled();
        const card = view.container.querySelector<HTMLElement>('.mobile-gallery-item')!;
        fireEvent.click(within(card).getByRole('button', { name: '收藏' }));
        await waitFor(() => expect(afterRefresh).toHaveBeenCalledOnce());
        expect(beforeRefresh).not.toHaveBeenCalled();
        fireEvent.click(within(card).getByRole('button', { name: '删除历史图片' }));
        expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ rememberKey: 'history.delete' }));
        expect(localHistory.delete).not.toHaveBeenCalled();
    });

    it.each(['masonry', 'portrait'])('历史 %s 布局仅在瀑布流测量前完整显示图片', async layout => {
        localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout, columns: 2 }));
        const { cards } = await setup();
        const image = within(cards[0]).getByRole('img');
        expect(image.className).toContain(layout === 'masonry' ? 'object-contain' : 'object-cover');
        if (layout === 'masonry') {
            Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 800 } });
            fireEvent.load(image);
            await waitFor(() => expect(image.className).toContain('object-cover'));
            expect(cards[0].querySelector('.mobile-gallery-frame')?.getAttribute('style')).toContain('1.5');
        }
    });

    it('五种语言保留历史图片和用户内容，日期与操作文字立即更新', async () => {
        const { container, cards } = await setup();
        for (const language of LANGUAGES) {
            act(() => setLanguage(language.code));
            expect(container.querySelector('.mobile-gallery-item')).toBe(cards[0]);
            expect(within(cards[0]).getByRole('button', { name: t('收藏') })).toBeTruthy();
            expect(cards[0].dataset.historyId).toBe('history-1');
        }
        expect(localHistory.getPage).toHaveBeenCalledTimes(2);
        expect(localHistory.delete).not.toHaveBeenCalled();
    });
    it.each([1280, 390])('宽度 %s 清理确认脱离工作区，取消不删除历史', async width => {
        const { container } = await setup(width);
        fireEvent.click(screen.getByRole('button', { name: '管理' }));
        fireEvent.click(screen.getByRole('button', { name: width === 1280 ? '按时间清理历史…' : '删除指定天数以前的历史' }));
        const dialog = screen.getByRole('dialog', { name: '确认清理历史' });
        expect(dialog.parentElement).toBe(container.firstElementChild);
        expect(dialog.closest('main')).toBeNull();
        expect(dialog.closest('.safe-mode.dark')).toBe(container.firstElementChild);
        fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
        expect(screen.queryByRole('dialog', { name: '确认清理历史' })).toBeNull();
        expect(localHistory.deleteOlderThan).not.toHaveBeenCalled();
        expect(localHistory.keepOnly).not.toHaveBeenCalled();
    });

    it('清理参数表单保留，最终确认按清理类型与实际参数隔离，取消不删除', async () => {
        await setup();
        fireEvent.click(screen.getByRole('button', { name: '管理' }));
        fireEvent.click(screen.getByRole('button', { name: '按时间清理历史…' }));
        const dialog = screen.getByRole('dialog', { name: '确认清理历史' });
        fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '7' } });
        await waitFor(() => expect((within(dialog).getByRole('button', { name: '确认删除' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));
        await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ rememberKey: 'history.clean-days', rememberScope: 7 })));
        expect(localHistory.deleteOlderThan).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: '确认清理历史' })).toBe(dialog);
        confirmAction.mockResolvedValue(true);
        fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));
        await waitFor(() => expect(localHistory.deleteOlderThan).toHaveBeenCalledWith(7));
    });

    it('清理预览数量只采用最后一次输入的结果，读取中或失败时禁止确认且不显示为 0', async () => {
        await setup();
        const pending = new Map<number, (count: number) => void>();
        vi.mocked(localHistory.countOlderThan).mockImplementation(days => new Promise(resolve => { pending.set(days, resolve); }));
        fireEvent.click(screen.getByRole('button', { name: '管理' }));
        fireEvent.click(screen.getByRole('button', { name: '按时间清理历史…' }));
        const dialog = screen.getByRole('dialog', { name: '确认清理历史' });
        const confirm = within(dialog).getByRole('button', { name: '确认删除' }) as HTMLButtonElement;
        // 先输入 3 再改成 30：30 的结果先到，3 的旧结果迟到也不能覆盖确认文案。
        fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '3' } });
        fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '30' } });
        expect(confirm.disabled).toBe(true);
        expect(dialog.textContent).toContain('将删除 30 天前的 … 张图片');
        await act(async () => { pending.get(30)?.(5); });
        await act(async () => { pending.get(3)?.(99); });
        expect(dialog.textContent).toContain('将删除 30 天前的 5 张图片');
        expect(confirm.disabled).toBe(false);
        // 小数天数按实际执行的取整值预览，读取失败显示原因并禁止确认。
        vi.mocked(localHistory.countOlderThan).mockRejectedValueOnce(new Error('synthetic count failure'));
        fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '7.6' } });
        await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe('读取失败，请重试'));
        expect(localHistory.countOlderThan).toHaveBeenLastCalledWith(7);
        expect(dialog.textContent).not.toContain(' 0 张');
        expect(confirm.disabled).toBe(true);
        fireEvent.click(confirm);
        expect(confirmAction).not.toHaveBeenCalled();
        expect(localHistory.deleteOlderThan).not.toHaveBeenCalled();
    });

    it('历史详情直接用统一爱心，不再二次填写收藏表单或重复保存图片', async () => {
  const { cards } = await setup(); fireEvent.click(cards[0]);
  expect(screen.queryByPlaceholderText('为这张图取个标题...')).toBeNull();
  expect(screen.queryByRole('combobox', { name: '收藏夹' })).toBeNull();
  const viewer = screen.getByRole('dialog', { name: '历史图片查看器' });
  fireEvent.click(within(viewer).getByRole('button', { name: '收藏' }));
  await waitFor(() => expect(localHistory.setFavorite).toHaveBeenCalledExactlyOnceWith(items[0].id, true));
  expect(db.saveInspiration).not.toHaveBeenCalled();
});

    it.each([1280, 390])('宽度 %s 删除在左上，右上依次收藏、下载、复制，所有按钮无文字', async width => {
        const { cards } = await setup(width);
        const card = within(cards[0]);
        const favorite = card.getByRole('button', { name: '收藏' });
        const right = favorite.parentElement!.parentElement!;
        expect(right.classList.contains('right-2')).toBe(true);
        expect(right.classList.contains('top-2')).toBe(true);
        expect(within(right).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['收藏', '下载图片', '复制图片']);
        const remove = card.getByRole('button', { name: '删除历史图片' });
        expect(remove.parentElement?.classList.contains('left-2')).toBe(true);
        expect(remove.parentElement?.classList.contains('top-2')).toBe(true);
        for (const button of card.getAllByRole('button')) expect(button.textContent).toBe('');
        const share = card.getByRole('button', { name: '下载图片' }).parentElement!;
        expect(share.classList.contains('hover-reveal-md')).toBe(false);
        expect(favorite.closest('.hover-reveal-touch')).toBeNull();
        expect(card.getByRole('button', { name: '下载图片' }).classList.contains('hover-reveal-md')).toBe(true);
        expect(remove.parentElement?.classList.contains('hover-reveal-md')).toBe(true);
    });

    it('分享使用各自原图并即时跟随清洗设置，不打开详情或进入多选', async () => {
        const { cards } = await setup();
        const timer = vi.spyOn(window, 'setTimeout');
        for (const clean of [false, true]) {
            act(() => setCleanSharedImages(clean));
            const copy = within(cards[1]).getByRole('button', { name: '复制图片' });
            fireEvent.pointerDown(copy); fireEvent.click(copy);
            await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith(items[1].imageUrl, clean, { prompt: items[1].prompt, negativePrompt: items[1].negativePrompt, params: items[1].params }));
            const download = within(cards[0]).getByRole('button', { name: '下载图片' });
            fireEvent.pointerDown(download); fireEvent.click(download);
            await waitFor(() => expect(downloadSharedImage).toHaveBeenLastCalledWith(items[0].imageUrl, 'NAI-2026-10-02-02-30-01.png', clean));
            await waitFor(() => expect((download as HTMLButtonElement).disabled).toBe(false));
        }
        expect(timer.mock.calls.some(([, delay]) => delay === 450)).toBe(false);
        expect(screen.queryByText('图片详情')).toBeNull();
        expect(screen.queryByText(/多选模式/)).toBeNull();
        expect(localHistory.delete).not.toHaveBeenCalled();
    });

    it('删除仍需确认，收藏仍正常写入，两者不触发长按或打开详情', async () => {
        const { cards } = await setup();
        const timer = vi.spyOn(window, 'setTimeout');
        const favorite = within(cards[0]).getByRole('button', { name: '收藏' });
        fireEvent.pointerDown(favorite); fireEvent.click(favorite);
        await waitFor(() => expect(localHistory.setFavorite).toHaveBeenCalledWith(items[0].id, true));
        const remove = within(cards[0]).getByRole('button', { name: '删除历史图片' });
        fireEvent.pointerDown(remove); fireEvent.click(remove);
        expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: '删除这张历史图片？', tone: 'danger' }));
        expect(localHistory.delete).not.toHaveBeenCalled();
        expect(timer.mock.calls.some(([, delay]) => delay === 450)).toBe(false);
        expect(screen.queryByText('图片详情')).toBeNull();
    });

    it('本地标记未收藏但共享记录仍有效时列表和大图保持亮心，失败重试继续取消', async () => {
        collectionState.active = true;
        items[0].isFavorite = false;
        vi.mocked(localHistory.setFavorite).mockImplementation(async (id, favorite) => {
            const item = items.find(entry => entry.id === id);
            if (item) item.isFavorite = favorite;
            listeners.forEach(listener => listener({ type: 'favorite', id, favorite }));
            return 1;
        });
        vi.mocked(syncHistoryCollectionFavorites).mockRejectedValue(new Error('合成收藏同步失败'));
        const { cards, notify } = await setup();
        const listHeart = () => within(cards[0]).getByRole('button', { name: '取消收藏' });
        expect(listHeart().getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(listHeart());
        await waitFor(() => expect(localHistory.setFavorite).toHaveBeenLastCalledWith(items[0].id, false));
        await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('合成收藏同步失败'), 'error'));
        expect(listHeart().getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(listHeart());
        await waitFor(() => expect(localHistory.setFavorite).toHaveBeenCalledTimes(2));
        expect(localHistory.setFavorite).toHaveBeenNthCalledWith(2, items[0].id, false);
        expect(localHistory.setFavorite).not.toHaveBeenCalledWith(items[0].id, true);

        fireEvent.click(cards[0]);
        const viewer = await screen.findByRole('dialog', { name: '历史图片查看器' });
        const viewerHeart = within(viewer).getByRole('button', { name: '取消收藏' });
        expect(viewerHeart.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(viewerHeart);
        await waitFor(() => expect(localHistory.setFavorite).toHaveBeenCalledTimes(3));
        expect(localHistory.setFavorite).toHaveBeenNthCalledWith(3, items[0].id, false);
        expect(localHistory.setFavorite).not.toHaveBeenCalledWith(items[0].id, true);
    });

    it('多选时隐藏所有单图操作，点击卡片只选择图片', async () => {
        const { cards } = await setup();
        fireEvent.click(screen.getByRole('button', { name: '管理' }));
        fireEvent.click(screen.getByRole('button', { name: '批量选择图片' }));
        expect(within(cards[0]).queryAllByRole('button')).toHaveLength(0);
        fireEvent.click(cards[0]);
        expect(within(screen.getByRole('banner')).getByText(/多选模式 · 已选 1 张/)).toBeTruthy();
        expect(screen.queryByText('图片详情')).toBeNull();
        expect(copySharedImage).not.toHaveBeenCalled();
        expect(downloadSharedImage).not.toHaveBeenCalled();
    });

    it('收藏写入期间不阻塞原图复制', async () => {
        let resolveFavorite!: (count: number) => void;
        vi.mocked(localHistory.setFavorite).mockImplementationOnce(() => new Promise(resolve => { resolveFavorite = resolve; }));
        const { cards } = await setup();
        fireEvent.click(within(cards[0]).getByRole('button', { name: '收藏' }));
        expect((within(cards[0]).getByRole('button', { name: '收藏' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(within(cards[0]).getByRole('button', { name: '复制图片' }));
        await waitFor(() => expect(copySharedImage).toHaveBeenCalledWith(items[0].imageUrl, false, { prompt: items[0].prompt, negativePrompt: items[0].negativePrompt, params: items[0].params }));
        await act(async () => resolveFavorite(1));
        expect(within(cards[0]).getByRole('button', { name: '取消收藏' })).toBeTruthy();
    });
});

describe('历史详情导入实验室', () => {
    const openDetails = async (width = 1280) => {
        const result = await setup(width);
        fireEvent.click(result.cards[0]);
        if (width < 768) fireEvent.click(screen.getByRole('button', { name: '图片详情' }));
        return result;
    };
    it.each([1280, 390])('宽度 %s 操作在参数之前，统一爱心常驻，模式默认文生图', async width => {
        await openDetails(width);
        const panel = screen.getByLabelText('图片详情面板');
        const actions = within(panel).getByRole('group', { name: '历史图片操作' });
        const params = within(panel).getByText('提示词与生成参数');
        expect(actions.compareDocumentPosition(params) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByLabelText('加入收藏库')).toBeNull();
        expect(screen.getAllByRole('button', { name: '收藏' }).length).toBeGreaterThan(0);
        const select = screen.getByRole('combobox', { name: '实验室导入模式' }) as HTMLSelectElement;
        expect(select.value).toBe('text-to-image');
        expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['文生图', '图生图', '局部重绘', '扩图']);
        expect(screen.queryByRole('button', { name: /编辑这张图片|导入到编辑器/ })).toBeNull();
    });
    it('默认导入显式进入文生图，只携带提示词和参数', async () => {
        const { navigate, notify } = await openDetails();
        fireEvent.click(screen.getByRole('button', { name: '导入到实验室' }));
        await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
        const data = JSON.parse(sessionStorage.getItem('nai_pending_import')!);
        expect(data).toEqual({ prompt: items[0].prompt, negativePrompt: '', params: items[0].params, targetMode: 'text-to-image' });
        expect(notify).toHaveBeenCalledWith('正在导入到实验室 · 文生图');
    });
    it.each(['image-to-image', 'inpaint', 'outpaint'])('%s 使用历史原图和参数，默认清空旧蒙版', async mode => {
        const { navigate } = await openDetails();
        fireEvent.change(screen.getByRole('combobox', { name: '实验室导入模式' }), { target: { value: mode } });
        fireEvent.click(screen.getByRole('button', { name: '导入到实验室' }));
        await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
        expect(JSON.parse(sessionStorage.getItem('nai_pending_import')!)).toEqual({ prompt: items[0].prompt, negativePrompt: '', params: items[0].params,
            mode: 'image-edit', baseImageUrl: items[0].imageUrl, parentHistoryId: items[0].id, imageEditOperation: mode, reuseEditMask: false });
    });
    it('只有匹配操作的历史蒙版可复用，切模式后取消勾选', async () => {
        const edit = { operation: 'inpaint', maskAvailable: true, strength: 1, noise: 0, focused: true } as const;
        vi.mocked(localHistory.getPage).mockResolvedValue({ items: [{ ...items[0], edit }, items[1]], count: 2 });
        await openDetails();
        const select = screen.getByRole('combobox', { name: '实验室导入模式' });
        fireEvent.change(select, { target: { value: 'inpaint' } });
        fireEvent.click(screen.getByRole('checkbox', { name: '复用原蒙版' }));
        fireEvent.change(select, { target: { value: 'outpaint' } });
        expect(screen.queryByRole('checkbox', { name: '复用原蒙版' })).toBeNull();
        fireEvent.change(select, { target: { value: 'inpaint' } });
        expect((screen.getByRole('checkbox', { name: '复用原蒙版' }) as HTMLInputElement).checked).toBe(false);
        fireEvent.click(screen.getByRole('checkbox', { name: '复用原蒙版' }));
        fireEvent.click(screen.getByRole('button', { name: '导入到实验室' }));
        await waitFor(() => expect(sessionStorage.getItem('nai_pending_import')).toBeTruthy());
        expect(JSON.parse(sessionStorage.getItem('nai_pending_import')!)).toMatchObject({ imageEditOperation: 'inpaint', reuseEditMask: true, editMetadata: edit });
    });
    it('换图清除模式选择，不沿用上一张的蒙版选项', async () => {
        await openDetails();
        fireEvent.change(screen.getByRole('combobox', { name: '实验室导入模式' }), { target: { value: 'outpaint' } });
        fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
        await waitFor(() => expect(screen.getByText('2 / 2')).toBeTruthy());
        expect((screen.getByRole('combobox', { name: '实验室导入模式' }) as HTMLSelectElement).value).toBe('text-to-image');
    });

});

const browseFixture = (count = 65, favorite = false) => {
    const data = Array.from({ length: count }, (_, index) => ({
        ...items[0], id: `browse-${index}`, imageUrl: `/synthetic/${index}.png`,
        createdAt: items[0].createdAt - index * 86400000, isFavorite: favorite,
        params: { ...items[0].params, model: index % 2 ? 'model-a' : 'model-b' },
    })) as LocalGenItem[];
    vi.mocked(localHistory.getBrowseOrder).mockImplementation(async query => buildBrowserHistoryOrder(data, query));
    vi.mocked(localHistory.getPage).mockImplementation(async (page, size, range, includeCount) => {
        const ids = range?.orderIds || data.map(item => item.id);
        return { items: ids.slice(page * size, (page + 1) * size).flatMap(id => data.filter(item => item.id === id)), ...(includeCount ? { count: ids.length } : {}) };
    });
    return data;
};
const cardById = (container: HTMLElement, id: string) => Array.from(container.querySelectorAll<HTMLElement>('[data-history-id]')).find(card => card.dataset.historyId === id)!;
const emit = (event: Parameters<typeof listeners.add>[0] extends (event: infer E) => void ? E : never) => { for (const listener of listeners) listener(event); };

describe('历史连续浏览会话', () => {
    it('随机覆盖全部结果，翻图跨过第 20 张且返回/重开保留相同种子与位置', async () => {
        browseFixture(); const { container } = await setup(1280, 20);
        fireEvent.click(screen.getByRole('button', { name: '随机浏览' }));
        await screen.findByRole('button', { name: '重新洗牌' });
        await waitFor(() => expect(vi.mocked(localHistory.getPage).mock.calls.at(-1)?.[2]?.sort).toBe('random'));
        const query = vi.mocked(localHistory.getBrowseOrder).mock.calls.at(-1)![0];
        const order = await localHistory.getBrowseOrder(query);
        await waitFor(() => expect(cardById(container, order.ids[19])).toBeTruthy());
        fireEvent.click(cardById(container, order.ids[19]));
        const viewer = screen.getByRole('dialog', { name: '历史图片查看器' });
        expect(viewer.parentElement?.parentElement).toBe(container.firstElementChild);
        expect(within(viewer).getByText('20 / 65')).toBeTruthy();
        fireEvent.click(within(viewer).getByRole('button', { name: '下一张图片' }));
        await waitFor(() => expect(within(viewer).getByRole('img', { name: '历史生成图片预览' }).getAttribute('src')).toContain(order.ids[20].replace('browse-', '/')));
        expect(within(viewer).getByText('21 / 65')).toBeTruthy();
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        await waitFor(() => expect(within(viewer).getByText('20 / 65')).toBeTruthy());
        fireEvent.click(within(viewer).getByRole('button', { name: '返回历史列表' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: '历史图片查看器' })).toBeNull());
        expect(screen.getByRole('button', { name: '重新洗牌' })).toBeTruthy();
        fireEvent.click(cardById(container, order.ids[20]));
        expect(screen.getByText('21 / 65')).toBeTruthy();
        const seed = query.seed;
        fireEvent.click(screen.getByRole('button', { name: '返回历史列表' }));
        fireEvent.click(screen.getByRole('button', { name: '重新洗牌' }));
        await waitFor(() => expect(vi.mocked(localHistory.getBrowseOrder).mock.calls.at(-1)![0].seed).not.toBe(seed));
    });

    it('连续追加前三页准确显示第 1–60 张，查询索引不重新生成', async () => {
        browseFixture(); const { container } = await setup(1280, 20);
        await act(async () => loadMore?.());
        await waitFor(() => expect(container.querySelectorAll('[data-history-id]').length).toBe(40));
        await act(async () => loadMore?.());
        await waitFor(() => expect(container.querySelectorAll('[data-history-id]').length).toBe(60));
        expect(screen.getByText('当前显示第 1 - 60 张')).toBeTruthy();
        expect(screen.getByText('已加载 60 / 65 张')).toBeTruthy();
        expect(localHistory.getBrowseOrder).toHaveBeenCalledOnce();
    });

    it('底部持续可见时自动连续追加超过三页，直到真实末尾且不读取越界页', async () => {
        browseFixture(85);
        let active = false;
        const checks = new Set<() => void>();
        vi.stubGlobal('IntersectionObserver', class {
            private targets = new Set<Element>();
            constructor(private callback: IntersectionObserverCallback) {}
            check = () => { for (const target of this.targets) this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); };
            observe(target: Element) {
                this.targets.add(target); checks.add(this.check);
                if (active) queueMicrotask(() => { if (this.targets.has(target)) this.check(); });
            }
            unobserve(target: Element) { this.targets.delete(target); }
            disconnect() { this.targets.clear(); checks.delete(this.check); }
        });
        const { container } = await setup(1280, 20);
        active = true;
        await act(async () => [...checks].forEach(check => check()));
        await waitFor(() => expect(container.querySelectorAll('[data-history-id]')).toHaveLength(85));
        expect(screen.getByText('当前显示第 1 - 85 张')).toBeTruthy();
        expect(localHistory.getBrowseOrder).toHaveBeenCalledOnce();
        const requested = vi.mocked(localHistory.getPage).mock.calls.map(([page]) => page);
        expect([...new Set(requested)]).toEqual([0, 1, 2, 3, 4]);
        await act(async () => [...checks].forEach(check => check()));
        expect(vi.mocked(localHistory.getPage).mock.calls.map(([page]) => page)).toEqual(requested);
    });

    it('浏览旧图时新增图片只提醒，点击提醒后才切换到最新结果', async () => {
        const data = browseFixture(25); const { container } = await setup(1280, 20);
        fireEvent.click(cardById(container, data[5].id));
        const before = vi.mocked(localHistory.getPage).mock.calls.length;
        data.unshift({ ...data[0], id: 'brand-new', imageUrl: '/synthetic/new.png', createdAt: Date.now() });
        await act(async () => emit({ type: 'add', id: 'brand-new' }));
        expect(await screen.findByRole('button', { name: '新增 1 张图片 · 查看最新' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '新增 1 张图片 · 查看最新' }).closest('header')).toBe(container.querySelector('header'));
        expect(vi.mocked(localHistory.getPage).mock.calls.length).toBe(before);
        expect(screen.getByText('6 / 25')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '返回历史列表' }));
        fireEvent.click(screen.getByRole('button', { name: '新增 1 张图片 · 查看最新' }));
        await waitFor(() => expect(cardById(container, 'brand-new')).toBeTruthy());
        expect(screen.queryByRole('button', { name: /新增 1 张/ })).toBeNull();
    });

    it('收藏中取消当前收藏或删除当前图片继续下一张，末张则退到上一张', async () => {
        const data = browseFixture(3, true); const { container } = await setup(1280, 3);
        fireEvent.click(screen.getByRole('button', { name: '只看收藏' }));
        await waitFor(() => expect(localHistory.getBrowseOrder).toHaveBeenLastCalledWith(expect.objectContaining({ favoriteOnly: true })));
        await waitFor(() => expect(cardById(container, data[0].id)).toBeTruthy());
        fireEvent.click(cardById(container, data[0].id));
        const viewer = screen.getByRole('dialog', { name: '历史图片查看器' });
        fireEvent.click(within(viewer).getByRole('button', { name: '取消收藏' }));
        await waitFor(() => expect(within(viewer).getByRole('img').getAttribute('src')).toBe(data[1].imageUrl));
        expect(within(viewer).getByText('1 / 2')).toBeTruthy();
        confirmAction.mockResolvedValue(true);
        fireEvent.click(within(viewer).getByRole('button', { name: '删除这张历史图片' }));
        await waitFor(() => expect(within(viewer).getByRole('img').getAttribute('src')).toBe(data[2].imageUrl));
        expect(within(viewer).getByText('1 / 1')).toBeTruthy();
        fireEvent.click(within(viewer).getByRole('button', { name: '删除这张历史图片' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: '历史图片查看器' })).toBeNull());
    });

    it('关闭后跨页迟到响应不重新打开查看器，输入时方向键不翻图', async () => {
        const data = browseFixture(25);
        let resolve!: (page: { items: LocalGenItem[] }) => void;
        vi.mocked(localHistory.getPage).mockImplementation(async (page, size, range, includeCount) => {
            if (page === 1) return new Promise(done => { resolve = done; });
            return { items: data.slice(page * size, (page + 1) * size), ...(includeCount ? { count: range?.orderIds?.length } : {}) };
        });
        const { container } = await setup(1280, 20);
        fireEvent.click(cardById(container, 'browse-19'));
        const input = screen.getByRole('combobox', { name: '实验室导入模式' });
        fireEvent.keyDown(input, { key: 'ArrowRight' });
        expect(screen.getByText('20 / 25')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
        expect(within(screen.getByRole('dialog', { name: '历史图片查看器' })).getByRole('status').textContent).toContain('正在加载图片');
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: '历史图片查看器' })).toBeNull();
        await act(async () => resolve({ items: data.slice(20) }));
        expect(screen.queryByRole('dialog', { name: '历史图片查看器' })).toBeNull();
        expect(cardById(container, 'browse-20')).toBeUndefined();
    });

    it('删除末张回到上一张，关闭后焦点归还最后查看的作品', async () => {
        const data = browseFixture(3); const { container } = await setup(1280, 3);
        confirmAction.mockResolvedValue(true);
        fireEvent.click(cardById(container, data[2].id));
        fireEvent.click(screen.getByRole('button', { name: '删除这张历史图片' }));
        await waitFor(() => expect(screen.getByRole('img', { name: '历史生成图片预览' }).getAttribute('src')).toBe(data[1].imageUrl));
        expect(screen.getByText('2 / 2')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '返回历史列表' }));
        await waitFor(() => expect(document.activeElement).toBe(cardById(container, data[1].id)));
    });

    it('列表删除导致页边界移动后继续追加，不跳过原第 41 张或重复已加载图片', async () => {
        browseFixture(45); const { container } = await setup(1280, 20);
        await act(async () => loadMore?.());
        await waitFor(() => expect(container.querySelectorAll('[data-history-id]').length).toBe(40));
        confirmAction.mockResolvedValue(true);
        fireEvent.click(within(cardById(container, 'browse-0')).getByRole('button', { name: '删除历史图片' }));
        await waitFor(() => expect(container.querySelectorAll('[data-history-id]').length).toBe(39));
        await act(async () => loadMore?.());
        await waitFor(() => expect(cardById(container, 'browse-40')).toBeTruthy());
        await act(async () => loadMore?.());
        await waitFor(() => expect(container.querySelectorAll('[data-history-id]').length).toBe(44));
        expect(new Set(Array.from(container.querySelectorAll<HTMLElement>('[data-history-id]')).map(node => node.dataset.historyId)).size).toBe(44);
        expect(screen.getByText('当前显示第 1 - 44 张')).toBeTruthy();
    });

    it('卡片键盘可打开，滚动位移会取消长按显露', async () => {
        installPointerEvents();
        const { cards } = await setup();
        vi.useFakeTimers();
        fireEvent.pointerDown(cards[0], { clientX: 10, clientY: 10, button: 0 });
        fireEvent.pointerMove(cards[0], { clientX: 10, clientY: 40, button: 0 });
        act(() => vi.advanceTimersByTime(600));
        expect(cards[0].hasAttribute('data-press-revealed')).toBe(false);
        expect(screen.queryByText(/多选模式/)).toBeNull();
        fireEvent.keyDown(cards[0], { key: 'Enter' });
        expect(screen.getByRole('dialog', { name: '历史图片查看器' })).toBeTruthy();
    });

    it('手机长按只显露操作，松手不打开大图、不进入多选；批量选择仍从管理进入', async () => {
        const { cards } = await setup(390);
        const favorite = within(cards[0]).getByRole('button', { name: '收藏' });
        expect(favorite.closest('.hover-reveal-touch')).toBeNull();
        longPress(cards[0]);
        expect(cards[0].getAttribute('data-press-revealed')).toBe('true');
        expect(screen.queryByRole('dialog', { name: '历史图片查看器' })).toBeNull();
        expect(screen.queryByText(/多选模式/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '管理' }));
        fireEvent.click(screen.getByRole('button', { name: '批量选择图片' }));
        fireEvent.click(cards[0]);
        expect(screen.getByText('已选 1 张')).toBeTruthy();
    });

    it('追加失败保留已经加载的图片，用户重试成功后继续同一顺序', async () => {
        const data = browseFixture(45);
        let fail = true;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(localHistory.getPage).mockImplementation(async (page, size, range, includeCount) => {
            if (page === 1 && fail) throw new Error('合成网络错误');
            return { items: data.slice(page * size, (page + 1) * size), ...(includeCount ? { count: range?.orderIds?.length } : {}) };
        });
        const { container } = await setup(1280, 20);
        await act(async () => loadMore?.());
        const retry = await screen.findByRole('button', { name: '加载更多失败 · 重试' });
        expect(container.querySelectorAll('[data-history-id]').length).toBe(20);
        fail = false; fireEvent.click(retry);
        await waitFor(() => expect(container.querySelectorAll('[data-history-id]').length).toBe(40));
        expect(screen.queryByRole('button', { name: '加载更多失败 · 重试' })).toBeNull();
        expect(localHistory.getBrowseOrder).toHaveBeenCalledOnce();
        warn.mockRestore(); error.mockRestore();
    });

    it('索引尚有图片却预取到空页时停止自动追加，原位重试重新读取而非复用空缓存', async () => {
        const data = browseFixture(45);
        let empty = true;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(localHistory.getPage).mockImplementation(async (page, size, range, includeCount) => ({
            items: page === 1 && empty ? [] : data.slice(page * size, (page + 1) * size),
            ...(includeCount ? { count: range?.orderIds?.length } : {}),
        }));
        const { container } = await setup(1280, 20);
        await act(async () => loadMore?.());
        const retry = await screen.findByRole('button', { name: '加载更多失败 · 重试' });
        expect(container.querySelectorAll('[data-history-id]')).toHaveLength(20);
        const beforeRetry = vi.mocked(localHistory.getPage).mock.calls.filter(([page]) => page === 1).length;
        empty = false;
        fireEvent.click(retry);
        await waitFor(() => expect(container.querySelectorAll('[data-history-id]')).toHaveLength(40));
        expect(vi.mocked(localHistory.getPage).mock.calls.filter(([page]) => page === 1)).toHaveLength(beforeRetry + 1);
        expect(screen.queryByRole('button', { name: '加载更多失败 · 重试' })).toBeNull();
    });
});

describe('历史顶栏状态一致性', () => {
    it('桌面管理按维护顺序排列，清空全部放最后，打开菜单不执行删除', async () => {
        await setup();
        fireEvent.click(screen.getByRole('button', { name: '管理' }));
        const dialog = within(screen.getByRole('dialog', { name: '历史管理' }));
        expect(dialog.getAllByRole('button').map(button => button.textContent?.trim())).toEqual(['批量选择图片', '按时间清理历史…', '按数量保留最新…', '清空全部']);
        expect(localHistory.delete).not.toHaveBeenCalled();
        expect(localHistory.keepOnly).not.toHaveBeenCalled();
    });

    it('多选操作替换固定顶栏，退出保留排序、已加载图片和滚动位置', async () => {
        browseFixture(8);
        const { container } = await setup(1280, 8);
        fireEvent.change(screen.getByRole('combobox', { name: '历史排序' }), { target: { value: 'oldest' } });
        await waitFor(() => expect(localHistory.getBrowseOrder).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'oldest' })));
        const scroll = container.querySelector<HTMLElement>('.overflow-y-auto.p-4')!;
        scroll.scrollTop = 600;
        const requests = vi.mocked(localHistory.getPage).mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: '管理' }));
        fireEvent.click(screen.getByRole('button', { name: '批量选择图片' }));
        const header = within(container.querySelector('header')!);
        expect(header.queryByRole('combobox', { name: '历史排序' })).toBeNull();
        expect(header.getByRole('button', { name: '删除选中' })).toBeTruthy();
        expect(scroll.querySelector('.history-selection-actions')).toBeNull();
        fireEvent.click(header.getByRole('button', { name: '全选本页' }));
        expect(header.getByText(/多选模式 · 已选/).textContent).toContain('8');
        fireEvent.click(header.getByRole('button', { name: '退出多选' }));
        expect((header.getByRole('combobox', { name: '历史排序' }) as HTMLSelectElement).value).toBe('oldest');
        expect(scroll.scrollTop).toBe(600);
        expect(vi.mocked(localHistory.getPage).mock.calls.length).toBe(requests);
    });

    it('手机新图提示可从管理角标进入查看最新，日期始终在更多筛选中可达', async () => {
        const data = browseFixture(8);
        const { container } = await setup(360, 8);
        expect(screen.queryByRole('button', { name: /^时间范围：/ })).toBeNull();
        container.querySelector<HTMLElement>('.overflow-y-auto.p-4')!.scrollTop = 600;
        data.unshift({ ...data[0], id: 'mobile-new', imageUrl: '/synthetic/new.png', createdAt: Date.now() });
        await act(async () => emit({ type: 'add', id: 'mobile-new' }));
        fireEvent.click(await screen.findByRole('button', { name: '管理，新增 1 张图片' }));
        const dialog = within(screen.getByRole('dialog', { name: '历史管理' }));
        fireEvent.click(dialog.getByRole('button', { name: '新增 1 张图片 · 查看最新' }));
        await waitFor(() => expect(cardById(container, 'mobile-new')).toBeTruthy());
        expect(screen.queryByRole('dialog', { name: '历史管理' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '更多筛选' }));
        expect(screen.getByLabelText('开始日期')).toBeTruthy();
        expect(screen.getByLabelText('结束日期')).toBeTruthy();
    });
});

// 收藏服务的持久化与并发在 services 定向测试中验证，这里隔离页面副作用。
vi.mock('../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../services/collectionFavorites')>(),
  ensureCollection: vi.fn(async () => {}), loadCollection: vi.fn(async () => []),
  subscribeCollection: () => () => {}, collectionRevision: () => 0, collectionTargetActive: vi.fn(() => collectionState.active),
  toggleCollectionTarget: vi.fn(async () => true), syncHistoryCollectionFavorites: vi.fn(async () => {}),
}));
