// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainList } from '../../components/ChainList';
import { CHAIN_FOLDER_DRAG_TYPE } from '../../components/chain/ChainFolders';
import type { ChainFolderState } from '../../services/chainFolders';
import type { PromptChain } from '../../types';

const { get, put, confirm } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), confirm: vi.fn(async () => true) }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => confirm }));
vi.mock('../../services/api', () => ({ api: { get, put, post: vi.fn() } }));
vi.mock('../../services/collectionFavorites', () => ({ collectionTargetActive: () => false, readLegacyFavoriteIds: () => new Set(), subscribeCollection: () => () => {} }));
vi.mock('../../services/stChatu8Preferences', () => ({ useStChatu8Preferences: () => ({ enabled: false }) }));
vi.mock('../../services/stChatu8Sync', () => ({ useStChatu8Selection: () => ({ open: false, selecting: false, busy: false, entries: new Map(), available: new Set(), selected: new Set(), accepts: () => true, cancel: vi.fn() }), wisdomEntryLabel: () => '' }));
vi.mock('../../services/appearancePreferences', () => ({ useGalleryFrostedCaption: () => false }));
vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({}) }));
vi.mock('../../services/naiModels', () => ({ DEFAULT_NAI_MODEL: 'nai-diffusion-4-5-full', getNaiModelDisplayLabel: () => 'V4.5', getSelectableNaiModels: () => [], getDefaultStepsForModel: () => 23 }));
vi.mock('../../services/imageDisplayPreferences', () => ({ useMobileImageDisplayPreferences: () => ({ layout: 'grid' }), mobileGalleryClassName: () => '', mobileGalleryStyle: () => ({}) }));
vi.mock('../../components/StyleCollectorControl', () => ({ StyleCollectorControl: () => null }));
vi.mock('../../components/chain/FolderBatchImportModal', () => ({ FolderBatchImportModal: () => null }));
vi.mock('../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: '', ImageShareActions: () => null }));
vi.mock('../../components/SmartImage', () => ({ ImageActivityContext: React.createContext(true), SmartImage: () => null }));
vi.mock('../../components/ShortestColumnMasonry', () => ({ useMasonryColumnCount: () => 2, ShortestColumnMasonry: () => null }));

let stored: ChainFolderState;
const makeChain = (id: string): PromptChain => ({ id, userId: 'owner', name: '风格 ' + id, type: 'style', description: '', tags: [], basePrompt: 'original', negativePrompt: '', modules: [], params: { model: 'nai-diffusion-4-5-full' } as PromptChain['params'], createdAt: 1, updatedAt: 1 });
const setup = async () => {
  const props = { chains: [makeChain('a'), makeChain('b')], type: 'style' as const, onCreate: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(), onBulkDelete: vi.fn(), onRefresh: vi.fn(), onUpdateChain: vi.fn(), isLoading: false, notify: vi.fn() };
  const view = render(<ChainList {...props} />);
  await waitFor(() => expect((screen.getByRole('button', { name: '新建文件夹' }) as HTMLButtonElement).disabled).toBe(false));
  return { ...view, props };
};
const choose = (id: string) => fireEvent.change(screen.getByLabelText('选择文件夹'), { target: { value: id } });
beforeEach(() => {
  localStorage.clear(); get.mockReset(); put.mockReset();
  stored = { revision: 1, folders: [{ id: 'root', name: '画风实验', parentId: null }, { id: 'child', name: '平涂', parentId: 'root' }], assignments: { a: 'child' } };
  get.mockImplementation(async () => structuredClone(stored));
  put.mockImplementation(async (_path, state) => { stored = { ...structuredClone(state), revision: stored.revision + 1 }; return structuredClone(stored); });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('风格串文件夹完整交互', () => {
  it('父目录包含子目录、未整理独立，重新进入记住目录且不改标签', async () => {
    const view = await setup();
    choose('root');
    expect(screen.getByRole('button', { name: '打开风格串：风格 a' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '打开风格串：风格 b' })).toBeNull();
    view.unmount(); await setup();
    expect((screen.getByLabelText('选择文件夹') as HTMLSelectElement).value).toBe('root');
    choose('');
    expect(screen.getByRole('button', { name: '打开风格串：风格 b' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '打开风格串：风格 a' })).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });
  it('创建子目录、重命名，具体目录中新建风格串传递归属', async () => {
    const { props } = await setup(); choose('root');
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }));
    let dialog = screen.getByRole('dialog', { name: '新建文件夹' });
    expect((within(dialog).getByLabelText('上级文件夹') as HTMLSelectElement).value).toBe('root');
    fireEvent.change(within(dialog).getByLabelText('文件夹名称'), { target: { value: '厚涂' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(stored.folders).toHaveLength(3));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const created = stored.folders[2]; expect(created.parentId).toBe('root');
    fireEvent.click(screen.getByRole('button', { name: '编辑文件夹' }));
    dialog = screen.getByRole('dialog', { name: '编辑文件夹' });
    fireEvent.change(within(dialog).getByLabelText('文件夹名称'), { target: { value: '厚涂测试' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(stored.folders[2].name).toBe('厚涂测试'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getAllByRole('button', { name: '新建风格串' })[0]);
    dialog = screen.getByRole('dialog', { name: '新建风格串' });
    fireEvent.change(within(dialog).getByPlaceholderText('例如：新风格串'), { target: { value: '新配方' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));
    expect(props.onCreate).toHaveBeenCalledWith('新配方', '', 'style', created.id);
  });
  it('单条与批量移动只写目录元数据，手机无需拖放', async () => {
    const { props } = await setup();
    fireEvent.click(screen.getByRole('button', { name: '移动到文件夹：风格 b' }));
    fireEvent.change(screen.getByLabelText('目标文件夹'), { target: { value: 'child' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '移动' }));
    await waitFor(() => expect(stored.assignments.b).toBe('child'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '批量选择风格串' }));
    fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
    fireEvent.click(screen.getByRole('button', { name: '移动到文件夹' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '移动' }));
    await waitFor(() => expect(stored.assignments).toEqual({}));
    expect(props.onUpdateChain).not.toHaveBeenCalled(); expect(props.onDelete).not.toHaveBeenCalled();
  });
  it('拖放识别内部风格串，删除父目录保留配方并提升子目录', async () => {
    const { props } = await setup();
    const transfer = { types: [CHAIN_FOLDER_DRAG_TYPE], getData: () => JSON.stringify(['b']), dropEffect: '' };
    const root = within(screen.getByLabelText('风格串文件夹')).getByRole('button', { name: /画风实验/ });
    fireEvent.dragOver(root, { dataTransfer: transfer }); fireEvent.drop(root, { dataTransfer: transfer });
    await waitFor(() => expect(stored.assignments.b).toBe('root'));
    choose('root'); fireEvent.click(screen.getByRole('button', { name: '删除文件夹' }));
    await waitFor(() => expect(stored.folders).toEqual([{ id: 'child', name: '平涂', parentId: null }]));
    expect(stored.assignments).toEqual({ a: 'child' }); expect(props.onDelete).not.toHaveBeenCalled();
  });
  it('保存冲突回读新目录，不假报成功，失败后可重试', async () => {
    const { props } = await setup();
    put.mockRejectedValueOnce(Error('文件夹已在其他窗口更新，请按最新目录重试'));
    fireEvent.click(screen.getByRole('button', { name: '移动到文件夹：风格 b' }));
    fireEvent.change(screen.getByLabelText('目标文件夹'), { target: { value: 'root' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '移动' }));
    await waitFor(() => expect(props.notify).toHaveBeenCalledWith(expect.stringContaining('其他窗口'), 'error'));
    expect(stored.assignments.b).toBeUndefined(); expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '移动' }));
    await waitFor(() => expect(stored.assignments.b).toBe('root'));
  });
});
