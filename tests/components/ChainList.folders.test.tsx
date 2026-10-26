// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageActivityProvider } from '../../components/SmartImage';
import { ChainList } from '../../components/ChainList';
import { CHAIN_FOLDER_DRAG_TYPE } from '../../components/chain/ChainFolders';
import { saveChainFolders } from '../../services/useChainFolders';
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
vi.mock('../../components/SmartImage', async importOriginal => ({ ...(await importOriginal<typeof import('../../components/SmartImage')>()), SmartImage: () => null }));
vi.mock('../../components/ShortestColumnMasonry', () => ({ useMasonryColumnCount: () => 2, ShortestColumnMasonry: () => null }));

let stored: ChainFolderState;
const makeChain = (id: string): PromptChain => ({ id, userId: 'owner', name: '风格 ' + id, type: 'style', description: '', tags: [], basePrompt: 'original', negativePrompt: '', modules: [], params: { model: 'nai-diffusion-4-5-full' } as PromptChain['params'], createdAt: 1, updatedAt: 1 });
const setup = async () => {
  const props = { chains: [makeChain('a'), makeChain('b')], type: 'style' as const, onCreate: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(), onBulkDelete: vi.fn(), onRefresh: vi.fn(), onUpdateChain: vi.fn(), isLoading: false, notify: vi.fn() };
  const view = render(<ChainList {...props} />);
  const expand = screen.queryByRole('button', { name: '展开文件夹' });
  if (expand) fireEvent.click(expand);
  await waitFor(() => expect((screen.getByRole('button', { name: '新建文件夹' }) as HTMLButtonElement).disabled).toBe(false));
  return { ...view, props };
};
const choose = (id: string) => fireEvent.change(screen.getByLabelText('选择文件夹'), { target: { value: id } });
beforeEach(() => {
  localStorage.clear(); get.mockReset(); put.mockReset();
  stored = { revision: 1, folders: [{ id: 'root', name: '画风实验', parentId: null }, { id: 'child', name: '平涂', parentId: 'root' }], assignments: { a: ['child'] } };
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
  it('手机等缺少 crypto.randomUUID 的环境里仍能创建并保存文件夹', async () => {
    const { props } = await setup(); choose('root');
    // 局域网 HTTP 属于非安全上下文：保留 crypto，但只提供 getRandomValues，逼真模拟缺少 randomUUID 的手机浏览器。
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => { for (let index = 0; index < array.length; index += 1) array[index] = (index * 7 + 3) % 256; return array; },
    });
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }));
    fireEvent.change(within(screen.getByRole('dialog', { name: '新建文件夹' })).getByLabelText('文件夹名称'), { target: { value: '手机新建' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: '新建文件夹' })).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(stored.folders).toHaveLength(3));
    const created = stored.folders[2];
    expect(created.name).toBe('手机新建'); expect(created.parentId).toBe('root');
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(put).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(props.notify).toHaveBeenCalledWith('文件夹已保存', 'success');
    const picker = screen.getByLabelText('选择文件夹') as HTMLSelectElement;
    expect(picker.value).toBe(created.id);
    expect(picker.textContent).toContain('手机新建');
  });
  it('保存失败时给出错误提示、保留面板与输入，不清空目录', async () => {
    const { props } = await setup(); choose('root');
    put.mockRejectedValueOnce(Error('文件夹资料过大'));
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }));
    fireEvent.change(within(screen.getByRole('dialog', { name: '新建文件夹' })).getByLabelText('文件夹名称'), { target: { value: '失败目录' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: '新建文件夹' })).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(props.notify).toHaveBeenCalledWith('文件夹资料过大', 'error'));
    expect(stored.folders).toHaveLength(2);
    const dialog = screen.getByRole('dialog', { name: '新建文件夹' });
    expect((within(dialog).getByLabelText('文件夹名称') as HTMLInputElement).value).toBe('失败目录');
    expect((within(dialog).getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false);
    expect(props.notify).not.toHaveBeenCalledWith('文件夹已保存', 'success');
  });
  it('单条与批量设置只写目录元数据，取消勾选才移除归属，手机无需拖放', async () => {
    const { props } = await setup();
    fireEvent.click(screen.getByRole('button', { name: '设置文件夹：风格 b' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: '平涂' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(stored.assignments.b).toEqual(['child']));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '批量选择风格串' }));
    fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
    fireEvent.click(screen.getByRole('button', { name: '设置文件夹' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: '平涂' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(stored.assignments).toEqual({}));
    expect(props.onUpdateChain).not.toHaveBeenCalled(); expect(props.onDelete).not.toHaveBeenCalled();
  });
  it('拖放识别内部风格串，删除父目录保留配方并提升子目录', async () => {
    const { props } = await setup();
    const transfer = { types: [CHAIN_FOLDER_DRAG_TYPE], getData: () => JSON.stringify(['b']), dropEffect: '' };
    const root = within(screen.getByLabelText('风格串文件夹')).getByRole('button', { name: /画风实验/ });
    fireEvent.dragOver(root, { dataTransfer: transfer }); fireEvent.drop(root, { dataTransfer: transfer });
    await waitFor(() => expect(stored.assignments.b).toEqual(['root']));
    choose('root'); fireEvent.click(screen.getByRole('button', { name: '删除文件夹' }));
    await waitFor(() => expect(stored.folders).toEqual([{ id: 'child', name: '平涂', parentId: null }]));
    expect(stored.assignments).toEqual({ a: ['child'] }); expect(props.onDelete).not.toHaveBeenCalled();
  });
  it('批量部分选中只修改触及目录，未触及归属逐条保留', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: '批量选择风格串' }));
    fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
    fireEvent.click(screen.getByRole('button', { name: '设置文件夹' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: '平涂' }).getAttribute('aria-checked')).toBe('mixed');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '画风实验' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(stored.assignments).toEqual({ a: ['child', 'root'], b: ['root'] }));
  });
  it('多归属父夹去重计数，拖入只追加，全部与未整理不接受拖入', async () => {
    stored.assignments = { a: ['child', 'root'], b: ['child'] };
    await setup();
    const navigation = within(screen.getByLabelText('风格串文件夹'));
    const root = navigation.getByRole('button', { name: /画风实验/ });
    expect(root.textContent).toBe('画风实验2');
    const transfer = { types: [CHAIN_FOLDER_DRAG_TYPE], getData: () => JSON.stringify(['b']), dropEffect: '' };
    fireEvent.drop(navigation.getByRole('button', { name: /未整理/ }), { dataTransfer: transfer });
    fireEvent.drop(navigation.getByRole('button', { name: /^全部/ }), { dataTransfer: transfer });
    expect(put).not.toHaveBeenCalled();
    fireEvent.drop(root, { dataTransfer: transfer });
    await waitFor(() => expect(stored.assignments.b).toEqual(['child', 'root']));
    choose('child');
    expect(screen.getByRole('button', { name: '打开风格串：风格 b' })).toBeTruthy();
    choose('root'); fireEvent.click(screen.getByRole('button', { name: '删除文件夹' }));
    await waitFor(() => expect(stored.assignments).toEqual({ a: ['child'], b: ['child'] }));
    choose(''); expect(screen.queryByRole('button', { name: '打开风格串：风格 a' })).toBeNull();
  });
  it('保存冲突回读新目录，不假报成功，失败后可重试', async () => {
    const { props } = await setup();
    put.mockRejectedValueOnce(Error('文件夹已在其他窗口更新，请按最新目录重试'));
    fireEvent.click(screen.getByRole('button', { name: '设置文件夹：风格 b' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: '画风实验' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(props.notify).toHaveBeenCalledWith(expect.stringContaining('其他窗口'), 'error'));
    expect(stored.assignments.b).toBeUndefined(); expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(stored.assignments.b).toEqual(['root']));
  });
});


describe('文件夹区域与弹窗生命周期', () => {
  it('默认收起，展开偏好记住，收起保留目录筛选且不占侧栏', async () => {
    const props = { chains: [makeChain('a'), makeChain('b')], type: 'style' as const, onCreate: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(), onRefresh: vi.fn(), onUpdateChain: vi.fn(), isLoading: false, notify: vi.fn() };
    const view = render(<ChainList {...props} />);
    expect(screen.queryByLabelText('风格串文件夹')).toBeTruthy();
    expect(screen.getByLabelText('风格串文件夹').className).toBe('hidden');
    expect(screen.getByLabelText('风格串文件夹').hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '展开文件夹' }));
    await waitFor(() => expect((screen.getByRole('button', { name: '新建文件夹' }) as HTMLButtonElement).disabled).toBe(false));
    const navigation = screen.getByLabelText('风格串文件夹');
    expect(navigation.className).toContain('workspace-fixed-pane');
    expect(navigation.className).toContain('chain-folder-navigation');
    expect(navigation.nextElementSibling?.classList.contains('workspace-scroll-viewport')).toBe(true);
    choose('root');
    fireEvent.click(screen.getByRole('button', { name: '收起文件夹' }));
    expect(navigation.hidden).toBe(true);
    expect(navigation.className).toBe('hidden');
    expect(screen.getByRole('button', { name: '展开文件夹' }).title).toContain('画风实验');
    expect(screen.queryByRole('button', { name: '打开风格串：风格 b' })).toBeNull();
    expect(localStorage.getItem('nai-style-folders-expanded')).toBe('false');
    view.unmount();
    const next = render(<ChainList {...props} />);
    expect(screen.getByRole('button', { name: '展开文件夹' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '展开文件夹' }));
    next.unmount(); render(<ChainList {...props} />);
    expect(screen.getByRole('button', { name: '收起文件夹' })).toBeTruthy();
  });
  it.each(['新建文件夹', '编辑文件夹', '设置文件夹：风格 a'])('%s隐藏时释放焦点与键盘，恢复保留草稿', async label => {
    const view = await setup(); choose('root');
    const page = (active: boolean) => <ImageActivityProvider active={active}><ChainList {...view.props} /></ImageActivityProvider>;
    // 从此处起在同一Provider树内切换active，不卸载页面状态。
    view.unmount();
    const mounted = render(page(true));
    await waitFor(() => expect((screen.getByRole('button', { name: '新建文件夹' }) as HTMLButtonElement).disabled).toBe(false));
    choose('root'); const source = screen.getByRole('button', { name: label }); source.focus(); fireEvent.click(source);
    const current = screen.getByRole('dialog');
    const field = within(current).queryByLabelText('文件夹名称');
    if (field) fireEvent.change(field, { target: { value: '保留草稿' } });
    mounted.rerender(page(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(current.contains(document.activeElement)).toBe(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    mounted.rerender(page(true));
    expect(screen.getByRole('dialog')).toBe(current);
    if (field) expect((field as HTMLInputElement).value).toBe('保留草稿');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(source);
  });
  it.each(['新建文件夹', '编辑文件夹', '设置文件夹：风格 a'])('%s手机返回只关闭本层并保留父历史', async label => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    window.history.replaceState({ __naiMobileLayers: ['parent'], __naiMobileLayer: 'parent' }, '');
    const view = await setup(); choose('root');
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(window.history.state.__naiMobileLayers).toHaveLength(2));
    await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.history.state.__naiMobileLayers).toEqual(['parent']);
    expect(view.props.onSelect).not.toHaveBeenCalled();
  });
  it('保存中Escape、遮罩、手机返回均不关闭，完成后可返回', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    await setup(); fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }));
    let finish!: (value: ChainFolderState) => void;
    put.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.change(screen.getByLabelText('文件夹名称'), { target: { value: '在途' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(window.history.state.__naiMobileLayers).toHaveLength(1);
    await act(async () => finish({ ...stored, revision: 2 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});


it('App独立保存归属后保活列表立即显示新串，保持当前目录且无需focus', async () => {
  const view = await setup();
  choose('root');
  const existing = screen.getByRole('button', { name: '打开风格串：风格 a' });
  expect(screen.queryByRole('button', { name: '打开风格串：风格 b' })).toBeNull();
  await act(async () => { await saveChainFolders({ ...stored, assignments: { ...stored.assignments, c: ['root'] } }); });
  view.rerender(<ChainList {...view.props} chains={[...view.props.chains, makeChain('c')]} />);
  expect(screen.getByRole('button', { name: '打开风格串：风格 c' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '打开风格串：风格 a' })).toBe(existing);
  expect(screen.queryByRole('button', { name: '打开风格串：风格 b' })).toBeNull();
  expect((screen.getByLabelText('选择文件夹') as HTMLSelectElement).value).toBe('root');
  expect(get).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledTimes(1);
});
