// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { ChainList } from '../../components/ChainList';
import { api } from '../../services/api';

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
vi.mock('../../services/stBaiBaiPreferences', () => ({ useStBaiBaiPreferences: () => ({ enabled: false }) }));
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
vi.mock('../../components/chain/StyleBundleDialog', () => ({ StyleBundleDialog: ({ onImported, chains }: { onImported: (id?: string) => Promise<void>; chains: PromptChain[] }) => <><button data-export-ids={chains.map(chain => chain.id).join(',')} onClick={() => void onImported()}>合成分享包回读</button><button onClick={() => void onImported('a'.repeat(64))}>合成导入包</button></> }));
vi.mock('../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: '', IMAGE_CARD_ACTION_TONE: { save: '', delete: '', primary: '' }, ImageShareActions: () => null }));
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
  it('卡片复制保留原区，新 ID 副本显示在目标区，不调用删除', async () => {
    const own = chain('own-id', '原始个人串', false), pack = { ...chain('pack-id', '包内配方', false), params: { ...own.params, _styleBundleImport: { id: 'a'.repeat(64), name: '目标包' } } };
    const callbacks = props([own, pack]);
    let rows = [own, pack];
    const reload = vi.fn(async () => { rows = [own, { ...own, id: 'copy-own-id', params: { ...own.params, _chainPartition: { id: 'a'.repeat(64), name: '目标包' } } }, pack]; view.rerender(<ChainList {...callbacks} chains={rows} onBundleImported={reload} />); });
    vi.mocked(api.post).mockResolvedValue({ sourceIds: [own.id], copiedIds: ['copy-own-id'], partitionId: 'a'.repeat(64) });
    const view = render(<ChainList {...callbacks} onBundleImported={reload} />);
    fireEvent.click(screen.getByRole('button', { name: '复制到分区：原始个人串' }));
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: '确认复制' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '复制到分区' })).toBeNull());
    expect(api.post).toHaveBeenLastCalledWith('/chains/copy-partition', { ids: [own.id], target: 'a'.repeat(64), operation: expect.any(String) });
    expect(screen.getByRole('button', { name: '打开风格串：原始个人串' })).toBeTruthy();
    expect(rows.find(row => row.id === own.id)).toBe(own);
    fireEvent.change(screen.getByRole('combobox', { name: '风格串分区' }), { target: { value: 'a'.repeat(64) } });
    expect(screen.getByRole('button', { name: '打开风格串：原始个人串' })).toBeTruthy();
    expect(callbacks.onCreate).not.toHaveBeenCalled(); expect(callbacks.onDelete).not.toHaveBeenCalled();
  });

  it('批量复制只提交当前分区选中的原 ID，游客和角色页隐藏复制入口', async () => {
    const first = chain('one', '个人一', false), second = chain('two', '个人二', false), pack = { ...chain('pack', '包内', false), params: { ...first.params, _styleBundleImport: { id: 'a'.repeat(64), name: '目标包' } } };
    const callbacks = props([first, second, pack]); const onBulkDelete = vi.fn();
    vi.mocked(api.post).mockResolvedValue({ sourceIds: ['one', 'two'], copiedIds: ['copy-one', 'copy-two'], partitionId: 'a'.repeat(64) });
    const view = render(<ChainList {...callbacks} onBulkDelete={onBulkDelete} />);
    fireEvent.click(screen.getByRole('button', { name: '批量选择风格串' }));
    fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
    fireEvent.click(screen.getByRole('button', { name: '复制到分区' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认复制' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '复制到分区' })).toBeNull());
    expect(api.post).toHaveBeenLastCalledWith('/chains/copy-partition', { ids: ['one', 'two'], target: 'a'.repeat(64), operation: expect.any(String) });
    expect(callbacks.onCreate).not.toHaveBeenCalled(); expect(onBulkDelete).not.toHaveBeenCalled();
    view.rerender(<ChainList {...callbacks} isGuest />);
    expect(screen.queryByRole('button', { name: /复制到分区/ })).toBeNull();
    view.rerender(<ChainList {...callbacks} type="character" />);
    expect(screen.queryByRole('button', { name: /复制到分区/ })).toBeNull();
  });
  it('各分享包独立分区，搜索与导出只作用于当前分区，重新挂载记住选择', async () => {
    const own = chain('own', '我的水彩', false);
    const imported = { ...chain('shared', '包内水彩', false), params: { ...own.params, _styleBundleImport: { id: 'a'.repeat(64), name: '水彩合集' } } };
    const other = { ...chain('other', '另一包配方', false), params: { ...own.params, _styleBundleImport: { id: 'b'.repeat(64), name: '另一个包' } } };
    const callbacks = props([own, imported, other]);
    const view = render(<ChainList {...callbacks} />);
    expect(screen.getByRole('button', { name: '打开风格串：我的水彩' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '打开风格串：包内水彩' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: '风格串分区' }), { target: { value: 'a'.repeat(64) } });
    expect(screen.getByRole('button', { name: '打开风格串：包内水彩' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '打开风格串：另一包配方' })).toBeNull();
    expect(screen.queryByRole('button', { name: '打开风格串：我的水彩' })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '另一包' } });
    expect(screen.getByText('无匹配结果')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(screen.getAllByRole('button', { name: '更多操作' }).find(button => button.parentElement?.classList.contains('max-md:hidden'))!);
    const overflow = await screen.findByRole('dialog', { name: '更多操作' });
    fireEvent.click(within(overflow).getByRole('button', { name: '风格串分享包' }));
    expect((await screen.findByRole('button', { name: '合成分享包回读' })).getAttribute('data-export-ids')).toBe('shared');
    view.unmount();
    render(<ChainList {...callbacks} />);
    expect((screen.getByRole('combobox', { name: '风格串分区' }) as HTMLSelectElement).value).toBe('a'.repeat(64));
  });

  it('旧导入单列，缺失分区回退到个人区，角色页不出现风格串分区', () => {
    localStorage.setItem('nai_style_partition', 'missing');
    const own = chain('own', '个人配方', false), legacy = chain('naia-' + 'c'.repeat(64), '旧包配方', false);
    const callbacks = props([own, legacy]);
    const view = render(<ChainList {...callbacks} />);
    expect((screen.getByRole('combobox', { name: '风格串分区' }) as HTMLSelectElement).value).toBe('own');
    fireEvent.change(screen.getByRole('combobox', { name: '风格串分区' }), { target: { value: 'legacy-imports' } });
    expect(screen.getByRole('button', { name: '打开风格串：旧包配方' })).toBeTruthy();
    view.rerender(<ChainList {...callbacks} type="character" />);
    expect(screen.queryByRole('combobox', { name: '风格串分区' })).toBeNull();
  });

  it('导入回读后切换包分区，批量全选与删除不会带上其他分区', async () => {
    const own = chain('own', '个人配方', false), imported = { ...chain('shared', '包内配方', false), params: { ...chain('x', '', false).params, _styleBundleImport: { id: 'a'.repeat(64), name: '合成包' } } };
    const callbacks = props([own]), onBundleImported = vi.fn(async () => {}), onBulkDelete = vi.fn();
    const view = render(<ChainList {...callbacks} onBundleImported={onBundleImported} onBulkDelete={onBulkDelete} />);
    fireEvent.click(screen.getAllByRole('button', { name: '更多操作' }).find(button => button.parentElement?.classList.contains('max-md:hidden'))!);
    const overflow = await screen.findByRole('dialog', { name: '更多操作' });
    fireEvent.click(within(overflow).getByRole('button', { name: '风格串分享包' }));
    fireEvent.click(await screen.findByRole('button', { name: '合成导入包' }));
    await waitFor(() => expect(onBundleImported).toHaveBeenCalledOnce());
    view.rerender(<ChainList {...callbacks} chains={[own, imported]} onBundleImported={onBundleImported} onBulkDelete={onBulkDelete} />);
    await waitFor(() => expect((screen.getByRole('combobox', { name: '风格串分区' }) as HTMLSelectElement).value).toBe('a'.repeat(64)));
    fireEvent.click(screen.getByRole('button', { name: '批量选择风格串' }));
    fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: '选择风格串：包内配方' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('checkbox', { name: '选择风格串：个人配方' })).toBeNull();
    expect(onBulkDelete).not.toHaveBeenCalled();
  });
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
    await waitFor(() => expect(view.container.querySelector('[data-return-item-id="180"]')?.getAttribute('aria-label')).toBe('打开风格串：自动风格 180'), { timeout: 10000 });
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
    expect(screen.getByRole('status', { name: '加载中…' })).toBeTruthy();
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
    fireEvent.click(screen.getAllByRole('button', { name: '更多操作' }).find(button => !button.closest('.md\\:hidden'))!);
    const overflow = await screen.findByRole('dialog', { name: '更多操作' });
    fireEvent.click(within(overflow).getByRole('button', { name: '风格串分享包' }));
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
    expect((caption as HTMLElement).firstElementChild?.firstElementChild).toBe(badge);
    expect(badge.textContent).toContain('待实测');
  });

  it('普通风格串不渲染该状态', () => {
    render(<ChainList {...props([chain('plain', '普通风格', false)])} />);
    expect(screen.queryByTitle('待实测：在此风格串生成后自动去除')).toBeNull();
  });

  it('按串参数显示精准参考与氛围参考数量，没有参考参数的不显示', () => {
    const withReferences = (id: string, name: string, vibes: number, references: number): PromptChain => {
      const base = chain(id, name, false);
      return { ...base, params: { ...base.params,
        ...(vibes ? { vibes: { enabled: true, normalizeStrengths: true, slots: Array.from({ length: vibes }, (_, index) => ({ vibeId: `v${index}`, encodingId: `e${index}`, informationExtracted: 1, strength: 0.6 })) } } : {}),
        ...(references ? { characterReferences: { enabled: true, slots: Array.from({ length: references }, (_, index) => ({ assetId: `a${index}`, type: 'character' as const, strength: 1, fidelity: 1 })) } } : {}),
      } };
    };
    render(<ChainList {...props([withReferences('ref', '带参考', 1, 2), chain('plain', '无参考', false)])} />);
    const card = screen.getByRole('button', { name: '打开风格串：带参考' });
    expect(within(card).getByTitle('精准参考 (2)').textContent).toContain('2');
    expect(within(card).getByTitle('氛围参考 (1)').textContent).toContain('1');
    const plain = screen.getByRole('button', { name: '打开风格串：无参考' });
    expect(within(plain).queryByTitle('精准参考 (2)')).toBeNull();
    expect(within(plain).queryByTitle('氛围参考 (1)')).toBeNull();
  });

  it('标签带参考类型但没有参考参数时显示文字徽标', () => {
    const tagged = { ...chain('tagged', '标签参考', false), tags: ['精准参考', '氛围参考'] };
    render(<ChainList {...props([tagged, chain('plain2', '空白参考', false)])} />);
    const card = screen.getByRole('button', { name: '打开风格串：标签参考' });
    expect(within(card).getByTitle('精准参考').textContent).toBe('精准参考');
    expect(within(card).getByTitle('氛围参考').textContent).toBe('氛围参考');
    const plain = screen.getByRole('button', { name: '打开风格串：空白参考' });
    expect(within(plain).queryByTitle('精准参考')).toBeNull();
    expect(within(plain).queryByTitle('氛围参考')).toBeNull();
  });

  it('筛选可只看带氛围参考或带精准参考的串', () => {
    const withReferences = (id: string, name: string, vibes: number, references: number): PromptChain => {
      const base = chain(id, name, false);
      return { ...base, params: { ...base.params,
        ...(vibes ? { vibes: { enabled: true, normalizeStrengths: true, slots: [{ vibeId: 'v', encodingId: 'e', informationExtracted: 1, strength: 0.6 }] } } : {}),
        ...(references ? { characterReferences: { enabled: true, slots: [{ assetId: 'a', type: 'character' as const, strength: 1, fidelity: 1 }] } } : {}),
      } };
    };
    render(<ChainList {...props([withReferences('v', '氛围串', 1, 0), withReferences('c', '精准串', 0, 1), chain('plain', '普通串', false)])} />);
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '有氛围参考' }));
    expect(screen.getByRole('button', { name: '打开风格串：氛围串' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '打开风格串：精准串' })).toBeNull();
    expect(screen.queryByRole('button', { name: '打开风格串：普通串' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '有氛围参考' }));
    fireEvent.click(screen.getByRole('button', { name: '有精准参考' }));
    expect(screen.getByRole('button', { name: '打开风格串：精准串' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '打开风格串：氛围串' })).toBeNull();
  });
});
