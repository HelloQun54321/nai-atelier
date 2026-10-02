// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenHistory } from './GenHistory';
import { localHistory } from '../services/localHistory';
import { copySharedImage, downloadSharedImage, setCleanSharedImages } from '../services/imageSharing';
import type { LocalGenItem } from '../types';
import { db } from '../services/dbService';
import { buildBrowserHistoryOrder } from '../services/historyBrowse';

const { confirmAction, listeners } = vi.hoisted(() => ({ confirmAction: vi.fn(async () => false), listeners: new Set<(event: { type: string; id?: string; external?: boolean; favorite?: boolean }) => void>() }));
vi.mock('./ConfirmDialog', () => ({ useConfirmDialog: () => confirmAction }));
vi.mock('../services/lowConsumption', () => ({ useLowConsumption: () => ({ enabled: false }) }));
vi.mock('../services/localHistory', () => ({ localHistory: {
    prepare: vi.fn(async () => 0), subscribe: (listener: (event: { type: string; id?: string; external?: boolean; favorite?: boolean }) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    getPage: vi.fn(), getBrowseOrder: vi.fn(), setFavorite: vi.fn(async () => 1), delete: vi.fn(),
    countOlderThan: vi.fn(async () => 0), getCount: vi.fn(async () => 2), deleteOlderThan: vi.fn(), keepOnly: vi.fn(),
} }));
vi.mock('../services/dbService', () => ({ db: { saveInspiration: vi.fn(async () => {}) } }));
vi.mock('../services/imageSharing', async importOriginal => ({
    ...await importOriginal<typeof import('../services/imageSharing')>(),
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
        observe(element: HTMLElement) { if (element.dataset.historyLoadMore) loadMore = () => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
        unobserve() {} disconnect() {}
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })));
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => {
    vi.useRealTimers();
    cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
});

const setup = async (width = 1280, expectedCount = 2) => {
    vi.stubGlobal('innerWidth', width);
    const notify = vi.fn();
    const result = render(<div className="agent-stage safe-mode dark"><aside className="relative z-40">侧边栏</aside><main className="isolate overflow-hidden"><GenHistory currentUser={{ id: 'local', username: 'owner', role: 'user', createdAt: 1 }} chains={[]} notify={notify} /></main></div>);
    await waitFor(() => expect(result.container.querySelectorAll('.mobile-gallery-item').length).toBe(expectedCount));
    return { ...result, notify, cards: Array.from(result.container.querySelectorAll<HTMLElement>('.mobile-gallery-item')) };
};

describe('历史缩略图就地操作', () => {
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

    it('加入灵感后的提示挂到根层，关闭提示不重复保存', async () => {
        const { container, cards } = await setup();
        fireEvent.click(cards[0]);
        fireEvent.click(screen.getByText('加入灵感库'));
        fireEvent.change(screen.getByPlaceholderText('为这张图取个标题...'), { target: { value: '合成标题' } });
        fireEvent.click(screen.getByRole('button', { name: '加入' }));
        const dialog = await screen.findByRole('dialog', { name: '已加入灵感库' });
        expect(dialog.parentElement).toBe(container.firstElementChild);
        expect(dialog.closest('main')).toBeNull();
        fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
        expect(screen.queryByRole('dialog', { name: '已加入灵感库' })).toBeNull();
        expect(db.saveInspiration).toHaveBeenCalledOnce();
    });

    it.each([1280, 390])('宽度 %s 删除在左上，右上依次收藏、下载、复制，所有按钮无文字', async width => {
        const { cards } = await setup(width);
        const card = within(cards[0]);
        const favorite = card.getByRole('button', { name: '收藏' });
        const right = favorite.parentElement!;
        expect(right.classList.contains('right-2')).toBe(true);
        expect(right.classList.contains('top-2')).toBe(true);
        expect(within(right).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['收藏', '下载', '复制']);
        const remove = card.getByRole('button', { name: '删除历史图片' });
        expect(remove.parentElement?.classList.contains('left-2')).toBe(true);
        expect(remove.parentElement?.classList.contains('top-2')).toBe(true);
        for (const button of card.getAllByRole('button')) expect(button.textContent).toBe('');
        const share = card.getByRole('button', { name: '下载' }).parentElement!;
        for (const className of ['opacity-100', 'md:opacity-0', 'md:pointer-events-none', 'group-hover:pointer-events-auto', 'group-focus-within:opacity-100', '[@media(hover:none)]:opacity-100']) {
            expect(share.classList.contains(className)).toBe(true);
        }
    });

    it('分享使用各自原图并即时跟随清洗设置，不打开详情或进入多选', async () => {
        const { cards } = await setup();
        const timer = vi.spyOn(window, 'setTimeout');
        for (const clean of [false, true]) {
            act(() => setCleanSharedImages(clean));
            const copy = within(cards[1]).getByRole('button', { name: '复制' });
            fireEvent.pointerDown(copy); fireEvent.click(copy);
            await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith(items[1].imageUrl, clean, { prompt: items[1].prompt, negativePrompt: items[1].negativePrompt, params: items[1].params }));
            const download = within(cards[0]).getByRole('button', { name: '下载' });
            fireEvent.pointerDown(download); fireEvent.click(download);
            await waitFor(() => expect(downloadSharedImage).toHaveBeenLastCalledWith(items[0].imageUrl, 'NAI-2026-10-02-02-30-01.png', clean));
            await waitFor(() => expect((download as HTMLButtonElement).disabled).toBe(false));
        }
        expect(timer.mock.calls.some(([, delay]) => delay === 550)).toBe(false);
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
        expect(timer.mock.calls.some(([, delay]) => delay === 550)).toBe(false);
        expect(screen.queryByText('图片详情')).toBeNull();
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
        expect(within(cards[0]).getByRole('status', { name: '正在更新收藏' })).toBeTruthy();
        fireEvent.click(within(cards[0]).getByRole('button', { name: '复制' }));
        await waitFor(() => expect(copySharedImage).toHaveBeenCalledWith(items[0].imageUrl, false, { prompt: items[0].prompt, negativePrompt: items[0].negativePrompt, params: items[0].params }));
        await act(async () => resolveFavorite(1));
        expect(within(cards[0]).getByRole('button', { name: '取消收藏' })).toBeTruthy();
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
        fireEvent.click(screen.getByText('加入灵感库'));
        const input = screen.getByPlaceholderText('为这张图取个标题...');
        fireEvent.keyDown(input, { key: 'ArrowRight' });
        expect(screen.getByText('20 / 25')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
        expect(screen.getByRole('status').textContent).toContain('正在加载图片');
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

    it('卡片键盘可打开，滚动位移会取消长按选择', async () => {
        vi.stubGlobal('PointerEvent', MouseEvent);
        const { cards } = await setup();
        vi.useFakeTimers();
        fireEvent.pointerDown(cards[0], { clientX: 10, clientY: 10, button: 0 });
        fireEvent.pointerMove(cards[0], { clientX: 10, clientY: 40, button: 0 });
        act(() => vi.advanceTimersByTime(600));
        expect(screen.queryByText(/多选模式/)).toBeNull();
        fireEvent.keyDown(cards[0], { key: 'Enter' });
        expect(screen.getByRole('dialog', { name: '历史图片查看器' })).toBeTruthy();
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
