// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { ChainList } from '../../components/ChainList';
import { IMPORT_SESSION_KEY } from '../../services/metadataService';

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
vi.mock('../../services/artistSamples', () => ({ getArtistSampleDictionary: async () => [] }));
vi.mock('../../services/appearancePreferences', () => ({ useGalleryFrostedCaption: () => false }));
vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({}) }));
vi.mock('../../services/naiModels', async original => ({ ...await original<typeof import('../../services/naiModels')>(), getNaiModelDisplayLabel: () => 'V4.5', getSelectableNaiModels: () => [] }));
vi.mock('../../services/imageDisplayPreferences', () => ({
  useMobileImageDisplayPreferences: () => ({ layout: 'grid' }),
  mobileGalleryClassName: () => '', mobileGalleryStyle: () => ({}),
}));
vi.mock('../../components/StyleCollectorControl', () => ({ StyleCollectorControl: () => null }));
vi.mock('../../components/chain/FolderBatchImportModal', () => ({ FolderBatchImportModal: () => null }));
vi.mock('../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: '', ImageShareActions: () => null }));
vi.mock('../../components/SmartImage', () => ({
  ImageActivityContext: React.createContext(true),
  SmartImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock('../../components/ShortestColumnMasonry', async importOriginal => {
  const actual = await importOriginal<typeof import('../../components/ShortestColumnMasonry')>();
  return { ...actual, useMasonryColumnCount: () => 1 };
});

class FixedResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) { this.callback([{ target, contentRect: { width: 1000 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
  unobserve() {}
  disconnect() {}
}
class NoopIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

const styleChain: PromptChain = {
  id: 'style-a',
  userId: 'synthetic-owner',
  name: '风格 A',
  type: 'style',
  description: '',
  tags: [],
  basePrompt: 'masterpiece, best quality',
  negativePrompt: 'bad hands',
  modules: [{ id: 'm1', name: '风格模块', content: 'watercolor', position: 'post', isActive: true }],
  params: {
    model: 'nai-diffusion-4-5-full', width: 1024, height: 1536, steps: 32, scale: 6,
    sampler: 'k_euler_ancestral', seed: 1234, qualityToggle: true, ucPreset: 4, useCoords: false,
    characters: [{ id: 'char-1', prompt: '1girl', negativePrompt: '', x: 0.5, y: 0.5 }],
  },
  variableValues: { subject: '1girl, solo' },
  createdAt: 1,
  updatedAt: 1,
};

const characterChain: PromptChain = { ...styleChain, id: 'char-a', name: '角色 A', type: 'character' };

const props = (chains: PromptChain[], type: 'style' | 'character' = 'style') => ({
  chains, type, onCreate: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(), onRefresh: vi.fn(),
  onUpdateChain: vi.fn(), onNavigateToPlayground: vi.fn(), isLoading: false, notify: vi.fn(),
});

beforeEach(() => {
  confirmAction.mockReset().mockResolvedValue(false);
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '');
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('风格串发送到实验室', () => {
  it('把所有提示词结构、模块、角色槽位与生成参数投递到导入通道并跳转实验室', () => {
    const viewProps = props([styleChain]);
    render(<ChainList {...viewProps} />);

    fireEvent.click(screen.getByRole('button', { name: '发送到实验室：风格 A' }));

    const payload = JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!);
    expect(payload).toMatchObject({
      targetMode: 'text-to-image',
      basePrompt: 'masterpiece, best quality',
      subjectPrompt: '1girl, solo',
      negativePrompt: 'bad hands',
      modules: styleChain.modules,
    });
    expect(payload.params).toMatchObject({
      model: 'nai-diffusion-4-5-full', width: 1024, height: 1536, steps: 32, scale: 6, seed: 1234,
    });
    expect(payload.params.characters).toHaveLength(1);
    expect(viewProps.notify).toHaveBeenCalledWith('已把「风格 A」发送到实验室');
    expect(viewProps.onNavigateToPlayground).toHaveBeenCalledTimes(1);
    // 卡片本身是「点开编辑」的按钮，发送必须拦截冒泡，不能顺带打开原串。
    expect(viewProps.onSelect).not.toHaveBeenCalled();
    expect(viewProps.onDelete).not.toHaveBeenCalled();
  });

  it('自定义角色列表不提供该入口，普通风格串卡片仍可发送', () => {
    const viewProps = props([characterChain], 'character');
    const { unmount } = render(<ChainList {...viewProps} />);
    expect(screen.queryByRole('button', { name: '发送到实验室：角色 A' })).toBeNull();
    expect(screen.queryByRole('button', { name: '查找相似' })).toBeNull();
    unmount();

    const styleProps = props([styleChain, characterChain]);
    render(<ChainList {...styleProps} />);
    expect(screen.getByRole('button', { name: '发送到实验室：风格 A' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '发送到实验室：角色 A' })).toBeNull();
  });

  it('查找相似默认覆盖搜索外和首屏外的全部风格串，关闭保留搜索并可打开原串', async () => {
    const items = Array.from({ length: 70 }, (_, index) => ({ ...styleChain, id: `style-${index}`, name: `合成串 ${index}`,
      basePrompt: index < 68 ? `artist:unique_${index}` : 'artist:shared', modules: [], previewImage: undefined }));
    const viewProps = props([...items, characterChain]);
    const view = render(<ChainList {...viewProps} />);
    expect(view.container.querySelector('[data-return-item-id="style-69"]')).toBeNull();
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: '合成串 0' } });
    fireEvent.click(screen.getByRole('button', { name: '查找相似' }));
    await screen.findByText('已扫描 70 条 · 1 组相似 · 涉及 2 条 · 线索不足 0 条');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog', { name: '查找相似' })).toBeNull();
    expect((search as HTMLInputElement).value).toBe('合成串 0');
    fireEvent.click(screen.getByRole('button', { name: '查找相似' }));
    await screen.findByRole('button', { name: '打开原串：合成串 69' });
    fireEvent.click(screen.getByRole('button', { name: '打开原串：合成串 69' }));
    expect(viewProps.onSelect).toHaveBeenCalledWith('style-69');
    expect(viewProps.onDelete).not.toHaveBeenCalled(); expect(viewProps.onUpdateChain).not.toHaveBeenCalled();
  });

  it('访客没有查找相似入口', () => {
    render(<ChainList {...props([styleChain])} isGuest />);
    expect(screen.queryByRole('button', { name: '查找相似' })).toBeNull();
  });

  it('对比悬浮删除复用单删确认，取消与失败保留，成功只移除指定风格串', async () => {
    const items = ['a', 'b', 'c'].map(id => ({ ...styleChain, id, name: id, basePrompt: 'artist:shared', modules: [] }));
    const viewProps = props(items);
    render(<ChainList {...viewProps} />);
    fireEvent.click(screen.getByRole('button', { name: '查找相似' }));
    await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
    const dialog = within(screen.getByRole('dialog', { name: '查找相似' }));
    const remove = () => fireEvent.click(dialog.getByRole('button', { name: '删除：b' }));
    remove();
    await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ rememberKey: 'chain.delete', title: '删除“b”？', tone: 'danger' })));
    expect(viewProps.onDelete).not.toHaveBeenCalled();
    await waitFor(() => expect((dialog.getByRole('button', { name: '删除：b' }) as HTMLButtonElement).disabled).toBe(false));
    confirmAction.mockResolvedValue(true);
    viewProps.onDelete.mockRejectedValueOnce(new Error('合成写入失败'));
    remove();
    await waitFor(() => expect(viewProps.notify).toHaveBeenCalledWith('删除失败，请稍后重试', 'error'));
    expect(dialog.getByRole('region', { name: 'b' })).toBeTruthy();
    remove();
    await screen.findByText('已扫描 2 条 · 1 组相似 · 涉及 2 条 · 线索不足 0 条');
    expect(viewProps.onDelete.mock.calls).toEqual([['b'], ['b']]);
    expect(dialog.queryByRole('region', { name: 'b' })).toBeNull();
    expect(dialog.getByRole('region', { name: 'a' })).toBeTruthy();
    expect(dialog.getByRole('region', { name: 'c' })).toBeTruthy();
  });
});
