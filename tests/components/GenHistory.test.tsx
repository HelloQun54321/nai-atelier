import { installPointerEvents, longPress } from '../support/touchEvents';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ConfirmDialogOptions } from '../../components/ConfirmDialog';
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

const { confirmAction, listeners, imageRender, collectionState } = vi.hoisted(() => ({ confirmAction: vi.fn<(options: ConfirmDialogOptions) => Promise<boolean>>(async () => false), imageRender: vi.fn(), listeners: new Set<(event: { type: string; id?: string; external?: boolean; favorite?: boolean }) => void>(), collectionState: { active: false } }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => confirmAction }));
vi.mock('../../components/SmartImage', () => ({
    ImageActivityContext: React.createContext(true),
    SmartImage: ({ src, alt, className, onLoad }: { src: string; alt: string; className?: string; onLoad?: React.ReactEventHandler<HTMLImageElement> }) => { imageRender(src); return <img src={src} alt={alt} className={className} onLoad={onLoad} />; },
    OriginalImage: ({ src, alt, className, onLoad, onError, style }: React.ImgHTMLAttributes<HTMLImageElement>) => <img src={src} alt={alt} className={className} onLoad={onLoad} onError={onError} style={style} />,
}));

vi.mock('../../services/localHistory', () => ({ localHistory: {
    prepare: vi.fn(async () => 0), subscribe: (listener: (event: { type: string; id?: string; external?: boolean; favorite?: boolean }) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    getRecycleBinCapabilities: vi.fn(), getBrowserMigrationRecovery: vi.fn(), getBrowserMigrationRecoveryMask: vi.fn(),
    getPage: vi.fn(), getBrowseOrder: vi.fn(), setFavorite: vi.fn(async () => 1), delete: vi.fn(),
    previewMove: vi.fn(), moveToRecycleBin: vi.fn(), getRecycleBinPage: vi.fn(), getRecycleBinItem: vi.fn(), restoreFromRecycleBin: vi.fn(), purgeRecycleBin: vi.fn(),
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
    vi.mocked(localHistory.prepare).mockResolvedValue(0);
    vi.mocked(localHistory.getRecycleBinCapabilities).mockResolvedValue({ move: 'remote' });
    vi.mocked(localHistory.getBrowserMigrationRecovery).mockResolvedValue({ error: null, active: [], bin: [] });
    vi.mocked(localHistory.previewMove).mockImplementation(async selection => ({ previewToken: 'token-' + (selection.days ?? selection.keepCount ?? 'ids'), expiresAt: Date.now() + 60000, requestedCount: 2, movableCount: 2, skippedCount: 0, skipped: [] }));
    vi.mocked(localHistory.moveToRecycleBin).mockResolvedValue({ operation: 'move', requestedCount: 2, completedCount: 2, completedIds: items.map(item => item.id), skippedCount: 0, failedCount: 0, movedCount: 2, restoredCount: 0, purgedCount: 0, warnings: [], skipped: [], failed: [], success: true, ok: true, outcome: 'success', partial: false, deletedCount: 2 });
    vi.mocked(localHistory.getRecycleBinPage).mockResolvedValue({ items: [], count: 0 });
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

it('手机历史卡片只留图片，封面下方不再追加时间行', async () => {
    const { container, cards } = await setup(390);
    expect(container.querySelectorAll('.gallery-card-footer')).toHaveLength(0);
    for (const card of cards) {
        expect(card.children).toHaveLength(1);
        expect(card.firstElementChild?.classList.contains('mobile-gallery-frame')).toBe(true);
    }
});

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

it('历史数量只在左侧徽标显示一次，顶栏不再重复右侧张数', async () => {
    const { container } = await setup(390);
    const caption = container.querySelector('[data-toolbar-count-badge]');
    expect(caption?.textContent).toBe('2');
    expect(caption?.getAttribute('title')).toBe('已加载 2 / 共 2');
    expect(container.querySelector('.history-result-count')).toBeNull();
    expect(screen.getByRole('button', { name: '筛选' })).toBeTruthy();
    expect(container.querySelectorAll('[data-toolbar-count-badge]')).toHaveLength(1);
});

it('历史下沿小字按查询范围显示匹配数', async () => {
    const view = render(<GenHistory currentUser={{ id: 'local', username: 'owner', role: 'user', createdAt: 1 }} chains={[]} notify={vi.fn()}
        initialQuery={{ query: { search: 'synthetic' }, token: 1 }} />);
    await waitFor(() => expect(view.container.querySelector('[data-toolbar-count-badge]')?.getAttribute('title')).toBe('已加载 2 / 共 2'));
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
        fireEvent.click(within(card).getByRole('button', { name: '移入回收站' }));
        await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: '移入回收站' })));
        expect(localHistory.previewMove).toHaveBeenCalledWith(expect.objectContaining({ ids: [items[0].id] }));
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
        fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
        fireEvent.click(screen.getByRole('button', { name: width === 1280 ? '按时间清理历史…' : '按时间移入回收站…' }));
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
        fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
        fireEvent.click(screen.getByRole('button', { name: '按时间清理历史…' }));
        const dialog = screen.getByRole('dialog', { name: '确认清理历史' });
        fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '7' } });
        await waitFor(() => expect((within(dialog).getByRole('button', { name: '确认移入回收站' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(within(dialog).getByRole('button', { name: '确认移入回收站' }));
        await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: '移入回收站', message: expect.stringContaining('候选 2 张 · 可移入 2 张') })));
        expect(localHistory.deleteOlderThan).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: '确认清理历史' })).toBe(dialog);
        confirmAction.mockResolvedValue(true);
        fireEvent.click(within(dialog).getByRole('button', { name: '确认移入回收站' }));
        await waitFor(() => expect(localHistory.moveToRecycleBin).toHaveBeenCalledWith({ previewToken: 'token-7', protectedIds: [] }));
    });

    it('手机数量清理的长预览可单独聚焦阅读，保留保护原因和独立确认操作', async () => {
        await setup(390);
        const skipped = Array.from({ length: 80 }, (_, index) => ({ id: `protected-image-${index}`, reasons: [index === 79 ? 'reference_check_failed' : 'chain'] }));
        vi.mocked(localHistory.previewMove).mockImplementation(async selection => ({ previewToken: `token-${selection.keepCount}`, expiresAt: Date.now() + 60000, requestedCount: 82, movableCount: 2, skippedCount: 80, skipped }));
        fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
        fireEvent.click(screen.getByRole('button', { name: '只保留最近指定数量' }));
        const dialog = screen.getByRole('dialog', { name: '确认清理历史' });
        const count = within(dialog).getByRole('spinbutton');
        fireEvent.change(count, { target: { value: '7' } });

        const preview = await within(dialog).findByRole('region', { name: '清理预览' });
        preview.focus();
        expect(document.activeElement).toBe(preview);
        expect(preview.textContent).toContain('protected-image-0: 创作配方仍在引用');
        expect(preview.textContent).toContain('protected-image-79: 无法确认引用关系，已保留原记录');
        const confirm = within(dialog).getByRole('button', { name: '确认移入回收站' });
        expect(preview.contains(count)).toBe(false);
        expect(preview.contains(confirm)).toBe(false);

        confirmAction.mockResolvedValueOnce(true);
        fireEvent.click(confirm);
        expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ message: preview.textContent }));
        await waitFor(() => expect(localHistory.moveToRecycleBin).toHaveBeenCalledWith({ previewToken: 'token-7', protectedIds: [] }));
    });

    it('清理预览数量只采用最后一次输入的结果，读取中或失败时禁止确认且不显示为 0', async () => {
        await setup();
        const pending = new Map<number, (count: number) => void>();
        vi.mocked(localHistory.previewMove).mockImplementation(selection => new Promise(resolve => { pending.set(selection.days!, count => resolve({ previewToken: 'token-' + selection.days, expiresAt: Date.now() + 60000, requestedCount: count, movableCount: count, skippedCount: 0, skipped: [] })); }));
        fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
        fireEvent.click(screen.getByRole('button', { name: '按时间清理历史…' }));
        const dialog = screen.getByRole('dialog', { name: '确认清理历史' });
        const confirm = within(dialog).getByRole('button', { name: '确认移入回收站' }) as HTMLButtonElement;
        // 先输入 3 再改成 30：30 的结果先到，3 的旧结果迟到也不能覆盖确认文案。
        fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '3' } });
        fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '30' } });
        expect(confirm.disabled).toBe(true);
        expect(dialog.textContent).toContain('将 30 天前的 … 张图片移入回收站');
        await act(async () => { pending.get(30)?.(5); });
        await act(async () => { pending.get(3)?.(99); });
        expect(dialog.textContent).toContain('将 30 天前的 5 张图片移入回收站');
        expect(confirm.disabled).toBe(false);
        // 小数天数按实际执行的取整值预览，读取失败显示原因并禁止确认。
        vi.mocked(localHistory.previewMove).mockRejectedValueOnce(new Error('synthetic count failure'));
        fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '7.6' } });
        await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe('读取失败，请重试'));
        expect(localHistory.previewMove).toHaveBeenLastCalledWith({ days: 7, protectedIds: [] });
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
        const remove = card.getByRole('button', { name: '移入回收站' });
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
            await waitFor(() => expect(downloadSharedImage).toHaveBeenLastCalledWith(items[0].imageUrl, 'NAI-2026-10-02-02-30-01.png', clean, expect.anything()));
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
        const remove = within(cards[0]).getByRole('button', { name: '移入回收站' });
        fireEvent.pointerDown(remove); fireEvent.click(remove);
        await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: '移入回收站', tone: 'danger' })));
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
    let frozenIds: string[] = [];
    vi.mocked(localHistory.previewMove).mockImplementation(async selection => {
        frozenIds = selection.ids || data.map(item => item.id);
        return { previewToken: 'fixture-token', expiresAt: Date.now() + 60000, requestedCount: frozenIds.length, movableCount: frozenIds.length, skippedCount: 0, skipped: [] };
    });
    vi.mocked(localHistory.moveToRecycleBin).mockImplementation(async () => {
        const ids = [...frozenIds];
        for (const id of ids) { const index = data.findIndex(item => item.id === id); if (index >= 0) data.splice(index, 1); }
        return { operation: 'move', requestedCount: ids.length, completedCount: ids.length, completedIds: ids, skippedCount: 0, failedCount: 0, movedCount: ids.length, restoredCount: 0, purgedCount: 0, warnings: [], skipped: [], failed: [], success: true, ok: true, outcome: 'success', partial: false, deletedCount: ids.length };
    });
    return data;
};
const cardById = (container: HTMLElement, id: string) => Array.from(container.querySelectorAll<HTMLElement>('[data-history-id]')).find(card => card.dataset.historyId === id)!;
const emit = (event: Parameters<typeof listeners.add>[0] extends (event: infer E) => void ? E : never) => { for (const listener of listeners) listener(event); };

describe('历史连续浏览会话', () => {
    it('随机覆盖全部结果，翻图跨过第 20 张且返回/重开保留相同种子与位置', async () => {
        browseFixture(); const { container } = await setup(1280, 20);
        fireEvent.click(screen.getByRole('button', { name: '筛选' }));
        fireEvent.click(await screen.findByRole('button', { name: '随机浏览' }));
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
        fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
        expect(screen.getByRole('button', { name: '重新洗牌' })).toBeTruthy();
        fireEvent.keyDown(window, { key: 'Escape' });
        fireEvent.click(cardById(container, order.ids[20]));
        expect(screen.getByText('21 / 65')).toBeTruthy();
        const seed = query.seed;
        fireEvent.click(screen.getByRole('button', { name: '返回历史列表' }));
        fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
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
        expect(screen.getByTitle('已加载 60 / 共 65')).toBeTruthy();
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

    it('收藏中取消当前收藏继续下一张，但仍收藏的图片移动会保护跳过', async () => {
        const data = browseFixture(3, true); const { container } = await setup(1280, 3);
        fireEvent.click(screen.getByRole('button', { name: '筛选' }));
        fireEvent.click(screen.getByRole('checkbox', { name: '只看收藏' }));
        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => expect(localHistory.getBrowseOrder).toHaveBeenLastCalledWith(expect.objectContaining({ favoriteOnly: true })));
        await waitFor(() => expect(cardById(container, data[0].id)).toBeTruthy());
        fireEvent.click(cardById(container, data[0].id));
        const viewer = screen.getByRole('dialog', { name: '历史图片查看器' });
        fireEvent.click(within(viewer).getByRole('button', { name: '取消收藏' }));
        await waitFor(() => expect(within(viewer).getByRole('img').getAttribute('src')).toBe(data[1].imageUrl));
        expect(within(viewer).getByText('1 / 2')).toBeTruthy();
        confirmAction.mockResolvedValue(true);
        vi.mocked(localHistory.previewMove).mockResolvedValue({ previewToken: 'protected', expiresAt: Date.now() + 60000, requestedCount: 1, movableCount: 0, skippedCount: 1, skipped: [{ id: data[1].id, reasons: ['favorite'] }] });
        vi.mocked(localHistory.moveToRecycleBin).mockResolvedValue({ operation: 'move', requestedCount: 1, completedCount: 0, completedIds: [], skippedCount: 1, failedCount: 0, movedCount: 0, restoredCount: 0, purgedCount: 0, warnings: [], skipped: [{ id: data[1].id, reasons: ['favorite'] }], failed: [], success: false, ok: false, outcome: 'blocked', partial: false, deletedCount: 0 });
        fireEvent.click(within(viewer).getByRole('button', { name: '移入回收站' }));
        await waitFor(() => expect(localHistory.previewMove).toHaveBeenCalledWith(expect.objectContaining({ ids: [data[1].id], protectedIds: expect.arrayContaining([data[1].id]) })));
        expect(within(viewer).getByRole('img').getAttribute('src')).toBe(data[1].imageUrl);
        expect(within(viewer).getByText('1 / 2')).toBeTruthy();
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
        const previous = data[1];
        fireEvent.click(cardById(container, data[2].id));
        fireEvent.click(within(screen.getByRole('dialog', { name: '历史图片查看器' })).getByRole('button', { name: '移入回收站' }));
        await waitFor(() => expect(screen.getByRole('img', { name: '历史生成图片预览' }).getAttribute('src')).toBe(previous.imageUrl));
        expect(screen.getByText('2 / 2')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '返回历史列表' }));
        await waitFor(() => expect(document.activeElement).toBe(cardById(container, previous.id)));
    });

    it('列表删除导致页边界移动后继续追加，不跳过原第 41 张或重复已加载图片', async () => {
        browseFixture(45); const { container } = await setup(1280, 20);
        await act(async () => loadMore?.());
        await waitFor(() => expect(container.querySelectorAll('[data-history-id]').length).toBe(40));
        confirmAction.mockResolvedValue(true);
        fireEvent.click(within(cardById(container, 'browse-0')).getByRole('button', { name: '移入回收站' }));
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
        fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
        fireEvent.click(within(screen.getByRole('dialog', { name: '更多操作' })).getByRole('button', { name: '批量选择图片' }));
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
    it('桌面多选与回收站直出顶栏，更多菜单仅保留按维护顺序排列的清理项', async () => {
        await setup();
        expect(screen.queryByRole('button', { name: '管理' })).toBeNull();
        expect(screen.getByRole('button', { name: '批量选择图片' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
        const dialog = within(screen.getByRole('dialog', { name: '更多操作' }));
        expect(dialog.getAllByRole('button').map(button => button.textContent?.trim())).toEqual(['按时间清理历史…', '按数量保留最新…', '全部移入回收站…']);
        expect(localHistory.delete).not.toHaveBeenCalled();
        expect(localHistory.keepOnly).not.toHaveBeenCalled();
    });

    it('回收站是顶栏独立入口，不进更多菜单', async () => {
        await setup();
        expect(screen.getByRole('button', { name: '回收站' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
        const dialog = within(screen.getByRole('dialog', { name: '更多操作' }));
        expect(dialog.queryByRole('button', { name: '回收站' })).toBeNull();
    });

    it('多选操作替换固定顶栏，退出保留排序、已加载图片和滚动位置', async () => {
        browseFixture(8);
        const { container } = await setup(1280, 8);
        fireEvent.click(screen.getByRole('button', { name: '筛选' }));
        fireEvent.change(screen.getByRole('combobox', { name: '历史排序' }), { target: { value: 'oldest' } });
        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => expect(localHistory.getBrowseOrder).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'oldest' })));
        const scroll = container.querySelector<HTMLElement>('.overflow-y-auto.p-4')!;
        scroll.scrollTop = 600;
        const requests = vi.mocked(localHistory.getPage).mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: '批量选择图片' }));
        const header = within(container.querySelector('header')!);
        expect(header.queryByRole('combobox', { name: '历史排序' })).toBeNull();
        expect(header.getByRole('button', { name: '移入回收站' })).toBeTruthy();
        expect(scroll.querySelector('.history-selection-actions')).toBeNull();
        fireEvent.click(header.getByRole('button', { name: '全选本页' }));
        expect(header.getByText(/多选模式 · 已选/).textContent).toContain('8');
        fireEvent.click(header.getByRole('button', { name: '退出多选' }));
        fireEvent.click(header.getByRole('button', { name: '筛选' }));
        expect((screen.getByRole('combobox', { name: '历史排序' }) as HTMLSelectElement).value).toBe('oldest');
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(scroll.scrollTop).toBe(600);
        expect(vi.mocked(localHistory.getPage).mock.calls.length).toBe(requests);
    });

    it('手机新图提示可从更多菜单角标进入查看最新，日期始终在更多筛选中可达', async () => {
        const data = browseFixture(8);
        const { container } = await setup(360, 8);
        expect(screen.queryByRole('button', { name: /^时间范围：/ })).toBeNull();
        container.querySelector<HTMLElement>('.overflow-y-auto.p-4')!.scrollTop = 600;
        data.unshift({ ...data[0], id: 'mobile-new', imageUrl: '/synthetic/new.png', createdAt: Date.now() });
        await act(async () => emit({ type: 'add', id: 'mobile-new' }));
        fireEvent.click(await screen.findByRole('button', { name: '更多操作，新增 1 张图片' }));
        const dialog = within(screen.getByRole('dialog', { name: '更多操作' }));
        fireEvent.click(dialog.getByRole('button', { name: '新增 1 张图片 · 查看最新' }));
        await waitFor(() => expect(cardById(container, 'mobile-new')).toBeTruthy());
        expect(screen.queryByRole('dialog', { name: '更多操作' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '筛选' }));
        expect(screen.getByLabelText('开始日期')).toBeTruthy();
        expect(screen.getByLabelText('结束日期')).toBeTruthy();
    });

    it('创作足迹入口只在手机历史工具栏显示，电脑沿用侧栏入口', async () => {
        const onOpenFootprint = vi.fn();
        render(<GenHistory currentUser={{ id: 'local', username: 'owner', role: 'user', createdAt: 1 }} chains={[]} notify={vi.fn()} onOpenFootprint={onOpenFootprint} />);
        const entry = await screen.findByRole('button', { name: '创作足迹' });
        expect(entry.className).toContain('md:hidden');
        fireEvent.click(entry);
        expect(onOpenFootprint).toHaveBeenCalledOnce();
    });
});

// 收藏服务的持久化与并发在 services 定向测试中验证，这里隔离页面副作用。
vi.mock('../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../services/collectionFavorites')>(),
  ensureCollection: vi.fn(async () => {}), loadCollection: vi.fn(async () => []),
  subscribeCollection: () => () => {}, collectionRevision: () => 0, collectionTargetActive: vi.fn(() => collectionState.active),
  toggleCollectionTarget: vi.fn(async () => true), syncHistoryCollectionFavorites: vi.fn(async () => {}),
}));


describe('回收站管理安全边界', () => {
    it.each([1280, 390])('宽度 %s 从顶栏独立入口进回收站再返回保留active节点和滚动', async width => {
        const { container, cards } = await setup(width);
        const scroll = container.querySelector<HTMLElement>('.workspace-scroll-viewport')!; scroll.scrollTop = 530;
        fireEvent.click(screen.getByRole('button', { name: '回收站' }));
        await screen.findByLabelText('历史回收站');
        expect(cards[0].isConnected).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: '返回生成历史' }));
        await waitFor(() => expect(screen.queryByLabelText('历史回收站')).toBeNull());
        expect(container.querySelector('[data-history-id]')).toBe(cards[0]); expect(scroll.scrollTop).toBe(530);
    });
    it('手机顶栏直达回收站，不经过管理层，返回一次保留历史卡片和滚动', async () => {
        vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.startsWith('(max-width:'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
        const previousState = window.history.state;
        const baseState = { syntheticHistoryPage: true };
        window.history.replaceState(baseState, '');
        const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
        try {
            const { container, cards } = await setup(390);
            const scroll = container.querySelector<HTMLElement>('.workspace-scroll-viewport')!;
            scroll.scrollTop = 530;
            fireEvent.click(screen.getByRole('button', { name: '回收站' }));
            // 顶栏入口不需要先退出管理层，因此不该再借用浏览器返回。
            expect(back).not.toHaveBeenCalled();
            expect(screen.queryByRole('dialog', { name: '更多操作' })).toBeNull();
            await screen.findByLabelText('历史回收站');
            expect(window.history.state.__naiMobileLayers).toEqual([expect.stringMatching(/^history-recycle-bin-/)]);

            const popToHistory = () => {
                window.history.replaceState(baseState, '');
                fireEvent(window, new PopStateEvent('popstate', { state: baseState }));
            };
            popToHistory();
            expect(screen.queryByLabelText('历史回收站')).toBeNull();
            expect(window.history.state).toEqual(baseState);
            expect(container.querySelector('[data-history-id]')).toBe(cards[0]);
            expect(scroll.scrollTop).toBe(530);
        } finally {
            window.history.replaceState(previousState, '');
            back.mockRestore();
        }
    });
    it.each([
        { action: '按时间移入回收站…', form: true },
        { action: '全部移入回收站…', form: false },
    ])('手机 $action 等管理层返回后才读取预览，取消不写入', async ({ action, form }) => {
        vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.startsWith('(max-width:'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
        const previousState = window.history.state;
        const baseState = { syntheticHistoryPage: true };
        window.history.replaceState(baseState, '');
        const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
        const popToHistory = () => {
            window.history.replaceState(baseState, '');
            fireEvent(window, new PopStateEvent('popstate', { state: baseState }));
        };
        try {
            await setup(390);
            fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
            fireEvent.click(within(screen.getByRole('dialog', { name: '更多操作' })).getByRole('button', { name: action }));
            expect(back).toHaveBeenCalledOnce();
            expect(localHistory.previewMove).not.toHaveBeenCalled();
            popToHistory();
            expect(screen.queryByRole('dialog', { name: '更多操作' })).toBeNull();
            if (form) {
                await screen.findByRole('dialog', { name: '确认清理历史' });
                expect(window.history.state.__naiMobileLayers).toEqual([expect.stringMatching(/^history-clean-/)]);
                popToHistory();
                expect(screen.queryByRole('dialog', { name: '确认清理历史' })).toBeNull();
            } else {
                await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
                expect(window.history.state).toEqual(baseState);
            }
            expect(localHistory.moveToRecycleBin).not.toHaveBeenCalled();
        } finally {
            window.history.replaceState(previousState, '');
            back.mockRestore();
        }
    });
    it('全部移动使用冻结预览，部分成功只移除completedIds并保留失败项选择', async () => {
        const { cards } = await setup(); confirmAction.mockResolvedValue(true);
        vi.mocked(localHistory.moveToRecycleBin).mockResolvedValue({ operation: 'move', requestedCount: 2, completedCount: 1, completedIds: [items[0].id], skippedCount: 0, failedCount: 1, movedCount: 1, restoredCount: 0, purgedCount: 0, warnings: [], skipped: [], failed: [{ id: items[1].id, reasons: ['write_conflict'] }], success: false, ok: false, outcome: 'partial', partial: true, deletedCount: 1 });
        fireEvent.click(screen.getByRole('button', { name: '批量选择图片' }));
        fireEvent.click(cards[0]); fireEvent.click(cards[1]);
        fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: '移入回收站' }));
        await waitFor(() => expect(cards[0].isConnected).toBe(false));
        expect(document.querySelector(`[data-history-id="${items[1].id}"]`)).not.toBeNull(); expect(screen.getAllByText('多选模式 · 已选 1 张')).toHaveLength(2);
        expect(document.querySelectorAll('[data-history-id]')).toHaveLength(1);
        expect(localHistory.moveToRecycleBin).toHaveBeenCalledWith({ previewToken: 'token-ids', protectedIds: [] }); expect(localHistory.delete).not.toHaveBeenCalled();
    });
    it('全量入口不直接清空UI，确认显示真实预览与引用跳过', async () => {
        const { container } = await setup(); confirmAction.mockResolvedValue(true);
        vi.mocked(localHistory.previewMove).mockResolvedValue({ previewToken: 'all-token', expiresAt: Date.now() + 60000, requestedCount: 2, movableCount: 0, skippedCount: 2, skipped: [{ id: items[0].id, reasons: ['chain'] }, { id: items[1].id, reasons: ['favorite'] }] });
        vi.mocked(localHistory.moveToRecycleBin).mockResolvedValue({ operation: 'move', requestedCount: 2, completedCount: 0, completedIds: [], skippedCount: 2, failedCount: 0, movedCount: 0, restoredCount: 0, purgedCount: 0, warnings: [], skipped: [], failed: [], success: false, ok: false, outcome: 'blocked', partial: false, deletedCount: 0 });
        fireEvent.click(screen.getByRole('button', { name: '更多操作' })); fireEvent.click(screen.getByRole('button', { name: '全部移入回收站…' }));
        await waitFor(() => expect(localHistory.previewMove).toHaveBeenCalledWith({ clear: true, protectedIds: [] }));
        await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('候选 2 张 · 可移入 0 张 · 跳过 2 张') })));
        expect(confirmAction.mock.calls[0][0].message).toContain('创作配方仍在引用');
        expect(container.querySelectorAll('[data-history-id]')).toHaveLength(2);
    });
    it('收藏正在保存也进入preview与执行保护，browser-only不发送伪可用清理请求', async () => {
        let done!: (count: number) => void; vi.mocked(localHistory.setFavorite).mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
        const { cards } = await setup(); fireEvent.click(within(cards[0]).getByRole('button', { name: '收藏' }));
        fireEvent.click(within(cards[0]).getByRole('button', { name: '移入回收站' }));
        await waitFor(() => expect(localHistory.previewMove).toHaveBeenCalledWith({ ids: [items[0].id], protectedIds: [items[0].id] }));
        await act(async () => done(1));
    });
    it('迁移失败档案保留入口和重试，跨tab失败也更新；browser-only不启动清理preview', async () => {
        vi.mocked(localHistory.getRecycleBinCapabilities).mockResolvedValue({ move: 'requires-remote-migration' });
        vi.mocked(localHistory.getBrowserMigrationRecovery).mockResolvedValue({ error: 'synthetic migration conflict', active: items, bin: [] });
        const { cards } = await setup(); await screen.findByText('synthetic migration conflict');
        expect((within(cards[0]).getByRole('button', { name: '移入回收站' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(within(cards[0]).getByRole('button', { name: '移入回收站' }));
        expect(localHistory.previewMove).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: '浏览器历史只读档案' }));
        await screen.findByLabelText('浏览器历史只读档案');
        expect(screen.queryByRole('button', { name: '永久删除' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '重试迁移' }));
        await waitFor(() => expect(localHistory.prepare).toHaveBeenCalledTimes(2));
    });
});

it('能力尚未确认remote时移动入口禁用，解析后才允许预览', async () => {
    let resolve!: (value: { move: 'remote' }) => void;
    vi.mocked(localHistory.getRecycleBinCapabilities).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { cards } = await setup();
    expect((within(cards[0]).getByRole('button', { name: '移入回收站' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(cards[0]).getByRole('button', { name: '移入回收站' }));
    expect(localHistory.previewMove).not.toHaveBeenCalled();
    await act(async () => resolve({ move: 'remote' }));
    expect((within(cards[0]).getByRole('button', { name: '移入回收站' }) as HTMLButtonElement).disabled).toBe(false);
});

it('移动确认在途时批量收藏入口禁用，不能在执行后补发收藏', async () => {
    const { cards } = await setup();
    let resolve!: (value: boolean) => void;
    confirmAction.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: '批量选择图片' }));
    fireEvent.click(cards[0]);
    const toolbar = screen.getByRole('banner');
    fireEvent.click(within(toolbar).getByRole('button', { name: '移入回收站' }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
    expect((within(toolbar).getByRole('button', { name: '收藏选中' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(toolbar).getByRole('button', { name: '取消收藏' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve(false));
    expect((within(toolbar).getByRole('button', { name: '收藏选中' }) as HTMLButtonElement).disabled).toBe(false);
    expect(localHistory.moveToRecycleBin).not.toHaveBeenCalled();
});

it('历史图被用作提示词库或风格串封面时，预览确认与移入结果均明确展示引用条目名称', async () => {
    const { cards, notify } = await setup();
    const skipped = [{
        id: items[0].id,
        reasons: ['chain'],
        coverRefs: [
            { id: 'lib-1', name: '月下长发', type: 'appearance' },
            { id: 'style-1', name: '复古赛璐璐', type: 'style' },
        ],
    }];
    vi.mocked(localHistory.previewMove).mockResolvedValueOnce({
        previewToken: 'cover-token', expiresAt: Date.now() + 60000, requestedCount: 1, movableCount: 0, skippedCount: 1, skipped,
    });
    vi.mocked(localHistory.moveToRecycleBin).mockResolvedValueOnce({
        operation: 'move', requestedCount: 1, completedCount: 0, completedIds: [], skippedCount: 1, failedCount: 0,
        movedCount: 0, restoredCount: 0, purgedCount: 0, warnings: [], skipped, failed: [],
        success: false, ok: false, outcome: 'blocked', partial: false, deletedCount: 0,
    });
    confirmAction.mockResolvedValueOnce(true);
    fireEvent.click(within(cards[0]).getByRole('button', { name: '移入回收站' }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
    expect(confirmAction.mock.calls[0][0].message).toContain('已被用作封面（提示词库「月下长发」、风格串「复古赛璐璐」）');
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('已被用作封面（提示词库「月下长发」、风格串「复古赛璐璐」）'), 'error'));
});
