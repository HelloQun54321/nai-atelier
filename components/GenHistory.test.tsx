// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenHistory } from './GenHistory';
import { localHistory } from '../services/localHistory';
import { copySharedImage, downloadSharedImage, setCleanSharedImages } from '../services/imageSharing';
import type { LocalGenItem } from '../types';
import { db } from '../services/dbService';

const { confirmAction } = vi.hoisted(() => ({ confirmAction: vi.fn(async () => false) }));
vi.mock('./ConfirmDialog', () => ({ useConfirmDialog: () => confirmAction }));
vi.mock('../services/lowConsumption', () => ({ useLowConsumption: () => ({ enabled: false }) }));
vi.mock('../services/localHistory', () => ({ localHistory: {
    prepare: vi.fn(async () => 0), subscribe: () => () => {},
    getPage: vi.fn(), setFavorite: vi.fn(async () => 1), delete: vi.fn(),
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

beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
    vi.mocked(localHistory.getPage).mockResolvedValue({ items, count: items.length });
    vi.mocked(copySharedImage).mockResolvedValue(); vi.mocked(downloadSharedImage).mockResolvedValue();
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class {
        constructor(private callback: ResizeObserverCallback) {}
        observe() { this.callback([{ contentRect: { width: 1024 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
        unobserve() {} disconnect() {}
    });
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })));
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => {
    cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
});

const setup = async (width = 1280) => {
    vi.stubGlobal('innerWidth', width);
    const notify = vi.fn();
    const result = render(<div className="agent-stage safe-mode dark"><aside className="relative z-40">侧边栏</aside><main className="isolate overflow-hidden"><GenHistory currentUser={{ id: 'local', username: 'owner', role: 'user', createdAt: 1 }} chains={[]} notify={notify} /></main></div>);
    await waitFor(() => expect(result.container.querySelectorAll('.mobile-gallery-item').length).toBe(2));
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
        expect(screen.getByText(/多选模式 · 已选 1 张/)).toBeTruthy();
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
