// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtistLibrary } from './ArtistLibrary';
import { CharacterLibrary } from './CharacterLibrary';
import { DanbooruGallery } from './DanbooruGallery';
import { GenHistory } from './GenHistory';
import { getArtistDictionaryPage, getCharacterDictionaryPage } from '../services/tagDictionary';
import { danbooruService } from '../services/danbooruService';
import { generateImage } from '../services/naiService';

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

// 目录、配置及生图全部隔离，测试只执行工具栏查找和显示切换。
vi.mock('../services/dbService', () => ({ db: { getBenchmarkConfig: vi.fn(async () => null) } }));
vi.mock('./ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn(async () => false) }));
vi.mock('../services/lowConsumption', async importOriginal => ({
  ...await importOriginal<typeof import('../services/lowConsumption')>(), useLowConsumption: () => ({ enabled: false }),
}));
vi.mock('../services/localHistory', () => ({ localHistory: {
  prepare: vi.fn(async () => 0), subscribe: () => () => {},
  getPage: vi.fn(async () => ({ items: [], total: 0 })),
} }));
vi.mock('../services/naiService', () => ({ generateImage: vi.fn() }));
vi.mock('../services/tagDictionary', async importOriginal => ({
  ...await importOriginal<typeof import('../services/tagDictionary')>(),
  getArtistDictionaryPage: vi.fn(async () => ({ entries: [], total: 12, page: 0, pageCount: 1 })),
  getCharacterDictionaryPage: vi.fn(async () => ({ entries: [], total: 12, page: 0, pageCount: 1 })),
}));
vi.mock('../services/naiRuntime', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/naiRuntime')>();
  return { ...actual, getNaiRuntimeConfig: vi.fn(async () => actual.DEFAULT_NAI_RUNTIME) };
});
vi.mock('../services/naiUsage', async importOriginal => ({
  ...await importOriginal<typeof import('../services/naiUsage')>(),
  useNovelaiUsage: () => ({ usage: null, refreshIfStale: vi.fn() }),
}));
vi.mock('../services/anlasBudget', async importOriginal => ({
  ...await importOriginal<typeof import('../services/anlasBudget')>(),
  useAnlasBudget: () => ({ remaining: 1666 }),
}));
vi.mock('../services/danbooruService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/danbooruService')>();
  return { ...actual, resolveDanbooruQuery: vi.fn(async (query: string) => query), danbooruService: {
    ...actual.danbooruService,
    search: vi.fn(async ({ query, page }: { query: string; page: number }) => ({ items: [], query, page, hasMore: false })),
  } };
});

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
});

describe('资料目录工具栏行为', () => {
  it('画师筛选改变真实目录排序，更多菜单切换预览方式后仍可再次访问', async () => {
    render(<ArtistLibrary artistsData={[]} onRefresh={vi.fn(async () => {})} notify={vi.fn()} />);
    await waitFor(() => expect(getArtistDictionaryPage).toHaveBeenCalledWith(0, 'popular'));
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.change(screen.getByRole('combobox', { name: '画师排序' }), { target: { value: 'name-desc' } });
    await waitFor(() => expect(getArtistDictionaryPage).toHaveBeenCalledWith(0, 'name-desc'));
    expect(localStorage.getItem('nai_artist_sort')).toBe('name-desc');
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('button', { name: '切换到基准图预览' }));
    expect(screen.queryByRole('dialog', { name: '画师工具' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.getByRole('button', { name: '切换到原始图预览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制历史' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务队列' })).toBeTruthy();
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('角色范围、排序与收藏集中筛选，抽卡设置独立且不会启动生成', async () => {
    render(<CharacterLibrary chains={[]} onCreate={vi.fn()} onDelete={vi.fn()} onNavigateToPlayground={vi.fn()} onRefresh={vi.fn(async () => {})} notify={vi.fn()} onSelect={vi.fn()} />);
    await waitFor(() => expect(getCharacterDictionaryPage).toHaveBeenCalledWith(0, 'popular'));
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.change(screen.getByRole('combobox', { name: '角色排序' }), { target: { value: 'least' } });
    await waitFor(() => expect(getCharacterDictionaryPage).toHaveBeenCalledWith(0, 'least'));
    expect(localStorage.getItem('nai_character_sort')).toBe('least');
    fireEvent.change(screen.getByRole('combobox', { name: '角色范围' }), { target: { value: 'custom' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '只看收藏' }));
    expect(screen.getByRole('button', { name: '筛选 3' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
    expect((screen.getByRole('combobox', { name: '角色范围' }) as HTMLSelectElement).value).toBe('all');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '抽卡设置' }));
    const settings = screen.getByRole('dialog', { name: '角色抽卡设置' });
    fireEvent.change(within(settings).getByRole('combobox', { name: '数量' }), { target: { value: '24' } });
    expect((within(settings).getByRole('combobox', { name: '数量' }) as HTMLSelectElement).value).toBe('24');
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('Danbooru 合并筛选仍保留输入 Tag，重置只撤掉追加条件', async () => {
    render(<DanbooruGallery active={false} currentUser={{ id: 'local', username: 'owner', role: 'user', createdAt: 1 }} notify={vi.fn()} onNavigateToPlayground={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索 Danbooru' }), { target: { value: 'blue_hair' } });
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.change(screen.getByRole('combobox', { name: '排序方式' }), { target: { value: 'latest' } });
    await waitFor(() => expect(danbooruService.search).toHaveBeenCalledWith(expect.objectContaining({ query: expect.stringContaining('order:id_desc') })));
    expect(vi.mocked(danbooruService.search).mock.calls.at(-1)?.[0]?.query).toContain('blue_hair');
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
    await waitFor(() => expect(vi.mocked(danbooruService.search).mock.calls.at(-1)?.[0]?.query).not.toContain('order:id_desc'));
    expect(vi.mocked(danbooruService.search).mock.calls.at(-1)?.[0]?.query).toContain('blue_hair');
    expect((screen.getByRole('searchbox', { name: '搜索 Danbooru' }) as HTMLInputElement).value).toBe('blue_hair');
  });

  it.each([1280, 390])('历史管理在宽度 %s 只打开对应形态，批量选择后关闭菜单', async width => {
    vi.stubGlobal('innerWidth', width);
    render(<GenHistory chains={[]} currentUser={{ id: 'local', username: 'owner', role: 'user', createdAt: 1 }} notify={vi.fn()} />);
    const trigger = width < 768 ? screen.getByRole('button', { name: '历史管理' }) : screen.getByRole('button', { name: '管理' });
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(trigger);
    const panel = screen.getByRole('dialog', { name: '历史管理' });
    expect(panel.classList.contains('mobile-sheet')).toBe(width < 768);
    fireEvent.click(within(panel).getByRole('button', { name: '批量选择图片' }));
    expect(screen.queryByRole('dialog', { name: '历史管理' })).toBeNull();
    expect(screen.getByText(/多选模式 · 已选/)).toBeTruthy();
  });
});
