// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { ChainList } from '../../components/ChainList';

const { syncSelection } = vi.hoisted(() => ({
  syncSelection: {
    open: false, view: 'pending', recordFilter: 'all', entries: new Map(), available: new Set(), selected: new Set(),
    selecting: false, busy: false, savedCount: 0,
    accepts: () => true, begin: vi.fn(), cancel: vi.fn(), toggle: vi.fn(), actOnEntries: vi.fn(),
  },
}));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn(async () => false) }));
vi.mock('../../services/collectionFavorites', () => ({
  ensureCollection: async () => {}, collectionSnapshot: () => [],
  collectionTargetActive: () => false, readLegacyFavoriteIds: () => new Set(), subscribeCollection: () => () => {},
}));
vi.mock('../../services/stChatu8Preferences', () => ({ useStChatu8Preferences: () => ({ enabled: false }) }));
vi.mock('../../services/stChatu8Sync', () => ({ useStChatu8Selection: () => syncSelection, wisdomEntryLabel: () => '' }));
vi.mock('../../services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../services/appearancePreferences', () => ({ useGalleryFrostedCaption: () => false }));
vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({}) }));
vi.mock('../../services/naiModels', async original => ({ ...await original<typeof import('../../services/naiModels')>(), getNaiModelDisplayLabel: () => 'V5 Curated', getSelectableNaiModels: () => [] }));
vi.mock('../../services/imageDisplayPreferences', () => ({
  useMobileImageDisplayPreferences: () => ({ layout: 'grid' }),
  mobileGalleryClassName: () => '', mobileGalleryStyle: () => ({}),
}));
vi.mock('../../components/StyleCollectorControl', () => ({ StyleCollectorControl: () => null }));
vi.mock('../../components/chain/FolderBatchImportModal', () => ({ FolderBatchImportModal: () => null }));
vi.mock('../../components/chain/StyleBundleDialog', () => ({ StyleBundleDialog: ({ onImported }: { onImported: () => Promise<void> }) => <button onClick={() => void onImported()}>合成分享包回读</button> }));
vi.mock('../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: '', ImageShareActions: () => null }));
vi.mock('../../components/SmartImage', () => ({
  ImageActivityContext: React.createContext(true),
  SmartImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

class FixedResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) { this.callback([{ target, contentRect: { width: 1000 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
  unobserve() {}
  disconnect() {}
}
class NoopIntersectionObserver { observe() {} disconnect() {} unobserve() {} }

const chain = (id: string, name: string, untested: boolean): PromptChain => ({
  id, userId: 'synthetic-owner', name, type: 'style', description: '', tags: untested ? ['待实测'] : [],
  basePrompt: '', negativePrompt: '', modules: [],
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 1, qualityToggle: true, ucPreset: 4 },
  previewImage: '/synthetic/cover.png', createdAt: 1, updatedAt: 1,
});

const props = (chains: PromptChain[]) => ({
  chains, type: 'style' as const, onCreate: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(), onRefresh: vi.fn(),
  onUpdateChain: vi.fn(), isLoading: false, notify: vi.fn(),
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '');
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('风格串卡片的待实测状态', () => {
  it('触底后无需点击便逐批展示全部风格串，超过首批和后续批次仍继续', async () => {
    class VisibleObserver {
      private targets = new Set<Element>();
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.targets.add(target);
        queueMicrotask(() => { if (this.targets.has(target)) this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); });
      }
      unobserve(target: Element) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); }
    }
    vi.stubGlobal('IntersectionObserver', VisibleObserver);
    const view = render(<ChainList {...props(Array.from({ length: 181 }, (_, index) => chain(String(index), `自动风格 ${index}`, false)))} />);
    const first = view.container.querySelector('[data-return-item-id="0"]');
    await waitFor(() => expect(view.container.querySelector('[data-return-item-id="180"]')?.getAttribute('aria-label')).toBe('打开风格串：自动风格 180'));
    expect(screen.queryByRole('button', { name: /加载更多/ })).toBeNull();
    expect(view.container.querySelector('[data-return-item-id="0"]')).toBe(first);
  });

  it('首读等待和失败不冒充空列表，重试成功后才显示真正空态', () => {
    const callbacks = props([]);
    const view = render(<ChainList {...callbacks} isLoading />);
    expect(screen.getByText('加载中…')).toBeTruthy();
    expect(screen.queryByText('暂无数据')).toBeNull();
    view.rerender(<ChainList {...callbacks} loadError="风格串列表加载失败，请稍后重试" />);
    expect(screen.getByRole('alert').textContent).toContain('风格串列表加载失败');
    expect(screen.queryByText('暂无数据')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(callbacks.onRefresh).toHaveBeenCalledOnce();
    view.rerender(<ChainList {...callbacks} />);
    expect(screen.getByText('暂无数据')).toBeTruthy();
  });

  it('刷新等待或失败时保留已读风格卡片', () => {
    const callbacks = props([chain('cached', '已读风格', false)]);
    const view = render(<ChainList {...callbacks} isLoading />);
    expect(screen.getByRole('button', { name: '打开风格串：已读风格' })).toBeTruthy();
    expect(screen.getByText('加载中…')).toBeTruthy();
    view.rerender(<ChainList {...callbacks} loadError="风格串列表加载失败，请稍后重试" />);
    expect(screen.getByRole('button', { name: '打开风格串：已读风格' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('风格串列表加载失败');
    expect(screen.queryByText('暂无数据')).toBeNull();
  });

  it('搜索无匹配显示紧凑清除筛选，清除后恢复已有风格串', () => {
    render(<ChainList {...props([chain('plain', '已有风格', false)])} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '没有这条' } });
    const empty = screen.getByText('无匹配结果');
    expect(empty.closest('.py-20')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByRole('button', { name: '打开风格串：已有风格' })).toBeTruthy();
  });

  it('空资料库保留引导，加载期间不显示空态或创建引导', () => {
    const callbacks = props([]);
    const view = render(<ChainList {...callbacks} />);
    expect(screen.getByText('暂无数据').closest('.py-20')).not.toBeNull();
    view.rerender(<ChainList {...callbacks} isLoading />);
    expect(screen.queryByText('暂无数据')).toBeNull();
    expect(screen.queryByText('无匹配结果')).toBeNull();
    expect(screen.getByText('加载中…')).toBeTruthy();
    expect(within(view.container.querySelector<HTMLElement>('[data-workspace-body]')!).queryByRole('button', { name: '新建风格串' })).toBeNull();
  });
  it('分享包优先使用专用回读回调，不改变其他导入入口的旧刷新语义', async () => {
    const callbacks = props([chain('plain', '普通风格', false)]), onBundleImported = vi.fn(async () => {});
    render(<ChainList {...callbacks} onBundleImported={onBundleImported} />);
    fireEvent.click(screen.getByRole('button', { name: '风格串分享包' }));
    fireEvent.click(await screen.findByRole('button', { name: '合成分享包回读' }));
    expect(onBundleImported).toHaveBeenCalledOnce();
    expect(callbacks.onRefresh).not.toHaveBeenCalled();
  });
  it('放在标题栏内并紧贴作品名，不再压在封面底部', () => {
    render(<ChainList {...props([chain('untested', '待测风格', true)])} />);
    const card = screen.getByRole('button', { name: '打开风格串：待测风格' });
    const badge = within(card).getByTitle('待实测：在此风格串生成后自动去除');
    const caption = badge.closest('.gallery-card-caption');

    // 不再位于封面图片框架内，而是标题栏里作品名上方最近的一行。
    expect(badge.closest('.mobile-gallery-frame')).toBeNull();
    expect(caption).not.toBeNull();
    const heading = within(caption as HTMLElement).getByRole('heading', { level: 3 });
    expect(heading.textContent).toBe('待测风格');
    expect(badge.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((caption as HTMLElement).firstElementChild).toBe(badge);
    expect(badge.textContent).toContain('待实测');
  });

  it('普通风格串不渲染该状态', () => {
    render(<ChainList {...props([chain('plain', '普通风格', false)])} />);
    expect(screen.queryByTitle('待实测：在此风格串生成后自动去除')).toBeNull();
  });
});
