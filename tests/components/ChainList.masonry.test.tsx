// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { ChainList } from '../../components/ChainList';

const { confirmAction, syncSelection } = vi.hoisted(() => ({
  confirmAction: vi.fn(async () => false),
  syncSelection: {
    open: false, view: 'pending', recordFilter: 'all', entries: new Map(), available: new Set(), selected: new Set(),
    selecting: false, busy: false, savedCount: 0,
    accepts: vi.fn(() => true), begin: vi.fn(), cancel: vi.fn(), toggle: vi.fn(), actOnEntries: vi.fn(),
  },
}));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => confirmAction }));
vi.mock('../../services/collectionFavorites', () => ({
  collectionTargetActive: () => false, readLegacyFavoriteIds: (key: string) => new Set(JSON.parse(localStorage.getItem(key) || '[]')), subscribeCollection: () => () => {},
}));
vi.mock('../../services/stChatu8Preferences', () => ({ useStChatu8Preferences: () => ({ enabled: false }) }));
vi.mock('../../services/stChatu8Sync', () => ({ useStChatu8Selection: () => syncSelection, wisdomEntryLabel: () => '' }));
vi.mock('../../services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../services/appearancePreferences', () => ({ useGalleryFrostedCaption: () => false }));
vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({}) }));
vi.mock('../../services/naiModels', async original => ({ ...await original<typeof import('../../services/naiModels')>(), getNaiModelDisplayLabel: () => 'V4.5', getSelectableNaiModels: () => [] }));
vi.mock('../../services/imageDisplayPreferences', () => ({
  useMobileImageDisplayPreferences: () => ({ layout: 'masonry' }),
  mobileGalleryClassName: () => '', mobileGalleryStyle: () => ({}),
}));
vi.mock('../../components/StyleCollectorControl', () => ({ StyleCollectorControl: () => null }));
vi.mock('../../components/chain/FolderBatchImportModal', () => ({ FolderBatchImportModal: () => null }));
vi.mock('../../components/ImageTaggerPanel', () => ({ ImageTaggerAction: () => null }));
vi.mock('../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: '', ImageShareActions: () => null }));
vi.mock('../../components/SmartImage', () => ({
  ImageActivityContext: React.createContext(true),
  SmartImage: ({ src, alt, onLoad }: { src: string; alt: string; onLoad?: React.ReactEventHandler<HTMLImageElement> }) => <img src={src} alt={alt} data-testid={`preview-${alt}`} onLoad={onLoad} />,
}));
vi.mock('../../components/ShortestColumnMasonry', async importOriginal => {
  const actual = await importOriginal<typeof import('../../components/ShortestColumnMasonry')>();
  return { ...actual, useMasonryColumnCount: () => 5 };
});

class FixedResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 1000 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

class GalleryIntersectionObserver {
  static instances: GalleryIntersectionObserver[] = [];
  targets: Element[] = [];
  constructor(private callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit) {
    GalleryIntersectionObserver.instances.push(this);
  }
  observe(target: Element) { this.targets.push(target); }
  disconnect() { this.targets = []; }
  intersect(states: boolean[]) {
    this.callback(this.targets.map((target, index) => ({ target, isIntersecting: states[index] ?? false } as IntersectionObserverEntry)), this as unknown as IntersectionObserver);
  }
}

const chain = (index: number, options: { untested?: boolean; image?: boolean } = {}): PromptChain => ({
  id: `chain-${index}`,
  userId: 'synthetic-owner',
  name: `风格 ${index}`,
  type: 'style',
  description: '',
  tags: options.untested ? ['待实测'] : [],
  basePrompt: '',
  negativePrompt: '',
  modules: [],
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: index, qualityToggle: true, ucPreset: 4 },
  createdAt: 1,
  updatedAt: 1,
  ...(options.image ? { previewImage: `/synthetic/cover-${index}.png` } : {}),
});

const props = (chains: PromptChain[]) => ({
  chains, type: 'style' as const, onCreate: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(), onRefresh: vi.fn(),
  onUpdateChain: vi.fn(), isLoading: false, notify: vi.fn(),
});

const columnIds = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('.chain-masonry-column'))
  .map(column => Array.from(column.querySelectorAll<HTMLElement>('[data-return-item-id]')).map(card => card.dataset.returnItemId));

const expectBalanced = (container: HTMLElement, count: number) => {
  const columns = columnIds(container);
  expect(columns).toHaveLength(5);
  expect(columns.flat()).toHaveLength(count);
  const sizes = columns.map(column => column.length);
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
};

beforeEach(() => {
  localStorage.clear();
  GalleryIntersectionObserver.instances = [];
  confirmAction.mockReset(); confirmAction.mockResolvedValue(false);
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  vi.stubGlobal('IntersectionObserver', GalleryIntersectionObserver);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '');
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ChainList 最短列筛选与加载', () => {
  it('普通图片卡片直接打开原串，保留原封面及维护入口且没有模式入口', async () => {
    const viewProps = props([chain(0, { image: true })]);
    const { container } = render(<ChainList {...viewProps} />);
    const card = container.querySelector('[data-return-item-id="chain-0"]')!;
    expect(card.querySelector('img')?.getAttribute('src')).toBe('/synthetic/cover-0.png');
    expect(screen.queryByRole('button', { name: '统一角色' })).toBeNull();
    expect(screen.getByRole('button', { name: '编辑风格串信息：风格 0' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除：风格 0' })).toBeTruthy();
    fireEvent.click(card); expect(viewProps.onSelect).toHaveBeenCalledWith('chain-0');
    fireEvent.keyDown(card, { key: 'Enter' }); expect(viewProps.onSelect).toHaveBeenCalledTimes(2);
  });
  it('取消筛选不会被此前未找到的旧返回目标拉到第60项以后，新的编辑返回仍展开目标', async () => {
    const items = Array.from({ length: 130 }, (_, index) => chain(index));
    const viewProps = props(items);
    const { container, rerender } = render(<ChainList {...viewProps} />);
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(60));
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    const dialog = screen.getByRole('dialog', { name: '筛选与排序' });
    const favoriteToggle = within(dialog).getByRole('button', { name: '只看收藏' });
    fireEvent.click(favoriteToggle);
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(0));
    rerender(<ChainList {...viewProps} returnTargetId="chain-100" />);
    const root = container.querySelector<HTMLElement>('.min-h-0.flex-1.overflow-y-auto')!;
    root.scrollTop = 2000;
    fireEvent.click(favoriteToggle);
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(60));
    expect(root.scrollTop).toBe(0);
    expect(container.querySelector('[data-return-item-id="chain-100"]')).toBeNull();
    rerender(<ChainList {...viewProps} />);
    rerender(<ChainList {...viewProps} returnTargetId="chain-100" />);
    await waitFor(() => expect(container.querySelector('[data-return-item-id="chain-100"]')).not.toBeNull());
  });
  it('收藏与待实测控件连续切换后按新集合重新均衡，并可恢复完整列表', async () => {
    const items = Array.from({ length: 60 }, (_, index) => chain(index, { untested: index < 5 || index % 5 === 0 }));
    const favorites = items.filter((item, index) => index < 5 || index % 5 === 0).map(item => item.id);
    localStorage.setItem('nai_chain_favs', JSON.stringify(favorites));
    const { container } = render(<ChainList {...props(items)} />);
    await waitFor(() => expectBalanced(container, 60));

    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    const dialog = screen.getByRole('dialog', { name: '筛选与排序' });
    const favoriteToggle = within(dialog).getByRole('button', { name: '只看收藏' });
    const root = container.querySelector<HTMLElement>('.min-h-0.flex-1.overflow-y-auto')!;
    root.scrollTop = 2400;
    fireEvent.click(favoriteToggle);
    await waitFor(() => expectBalanced(container, favorites.length));
    expect(root.scrollTop).toBe(0);
    expect(favoriteToggle.getAttribute('aria-pressed')).toBe('true');

    root.scrollTop = 1600;
    fireEvent.click(favoriteToggle);
    await waitFor(() => expectBalanced(container, 60));
    expect(root.scrollTop).toBe(0);
    const untestedToggle = within(dialog).getByRole('button', { name: '只看待实测' });
    fireEvent.click(untestedToggle);
    await waitFor(() => expectBalanced(container, favorites.length));
    expect(untestedToggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(within(dialog).getByRole('button', { name: '重置筛选' }));
    await waitFor(() => expectBalanced(container, 60));
    expect(untestedToggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('列尾相交追加下一批但不观察全局底部；同轮只请求一次且保留旧卡片节点与图片比例更新', async () => {
    const items = Array.from({ length: 130 }, (_, index) => chain(index, { image: true }));
    const { container } = render(<ChainList {...props(items)} />);
    const root = container.querySelector('.min-h-0.flex-1.overflow-y-auto')!;
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(60));
    const card = container.querySelector<HTMLElement>('[data-return-item-id="chain-0"]')!;
    const originalIds = columnIds(container).flat();
    expect(originalIds).toHaveLength(60);
    const initialObserver = GalleryIntersectionObserver.instances.at(-1)!;
    await waitFor(() => expect(initialObserver.targets).toHaveLength(5));
    expect(initialObserver.targets.every(target => target.hasAttribute('data-masonry-load-end'))).toBe(true);
    expect(initialObserver.targets).not.toContain(root.querySelector('.flex.justify-center.py-6'));

    const image = screen.getByTestId('preview-风格 0') as HTMLImageElement;
    Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 600 } });
    fireEvent.load(image);
    await waitFor(() => expect(card.querySelector('.mobile-gallery-frame')?.getAttribute('style')).toContain('--mobile-image-ratio: 2'));
    expect(container.querySelector('[data-return-item-id="chain-0"]')).toBe(card);
    (root as HTMLElement).scrollTop = 700;

    const activeObserver = GalleryIntersectionObserver.instances.at(-1)!;
    await waitFor(() => expect(activeObserver.targets).toHaveLength(5));
    act(() => {
      activeObserver.intersect([false, false, true, false, false]);
      activeObserver.intersect([true, true, true, true, true]);
    });
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(120));
    expect(container.querySelector('[data-return-item-id="chain-0"]')).toBe(card);
    expect(root.scrollTop).toBe(700);
    act(() => activeObserver.intersect([true, true, true, true, true]));
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(130));
    expect(container.querySelector('[data-return-item-id="chain-0"]')).toBe(card);
    expect(root.scrollTop).toBe(700);
  });

  it('迟到的横竖图与无封面混合时，下一批补实际短列；数据刷新不缩回第一页或滚回顶部', async () => {
    const items = Array.from({ length: 130 }, (_, index) => chain(index, { image: index % 5 !== 4 }));
    const viewProps = props(items);
    const { container, rerender } = render(<ChainList {...viewProps} />);
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(60));
    const columns = Array.from(container.querySelectorAll<HTMLElement>('.chain-masonry-column'));
    const oldCards = Array.from(container.querySelectorAll<HTMLElement>('[data-return-item-id]'));
    const parents = oldCards.map(card => card.parentElement);
    expect(container.querySelector('[data-return-item-id="chain-0"] .mobile-gallery-frame')?.getAttribute('style')).toContain(`--mobile-image-ratio: ${832 / 1216}`);
    expect(container.querySelector('[data-return-item-id="chain-4"] .mobile-gallery-frame')?.getAttribute('style')).toContain(`--mobile-image-ratio: ${4 / 3}`);
    // 有封面先用生成比例预留，无封面仍4:3；随后不同横/竖图返回，旧节点不搬列。
    for (const [index, size] of [[0, [600, 1400]], [1, [1500, 600]], [2, [700, 1300]]] as const) {
      const image = screen.getByTestId(`preview-风格 ${index}`);
      Object.defineProperties(image, { naturalWidth: { configurable: true, value: size[0] }, naturalHeight: { configurable: true, value: size[1] } });
      fireEvent.load(image);
      expect(container.querySelector(`[data-return-item-id="chain-${index}"] .mobile-gallery-frame`)?.getAttribute('style')).toContain(`--mobile-image-ratio: ${size[0] / size[1]}`);
    }
    // 使用浏览器列高，而不是图片估算值；右列都是4:3无封面卡，已经实际结束得更早。
    columns.forEach((column, index) => vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ height: index === 4 ? 1200 : 20000 } as DOMRect));
    const root = container.querySelector<HTMLElement>('.min-h-0.flex-1.overflow-y-auto')!;
    root.scrollTop = 900;
    const observer = GalleryIntersectionObserver.instances.at(-1)!;
    act(() => observer.intersect([false, false, false, false, true]));
    await waitFor(() => expect(columnIds(container).flat()).toHaveLength(120));
    expect(container.querySelector('[data-return-item-id="chain-60"]')?.parentElement).toBe(columns[4]);
    oldCards.forEach((card, index) => {
      expect(container.querySelector(`[data-return-item-id="${card.dataset.returnItemId}"]`)).toBe(card);
      expect(card.parentElement).toBe(parents[index]);
    });
    expect(root.scrollTop).toBe(900);
    rerender(<ChainList {...viewProps} chains={items.map(item => ({ ...item }))} />);
    expect(columnIds(container).flat()).toHaveLength(120);
    expect(root.scrollTop).toBe(900);
  });
});
