import { longPress } from '../support/touchEvents';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { operateAgentPage, readAgentPage } from '../../services/agentWorkspace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { ChainList } from '../../components/ChainList';
import { copySharedImage } from '../../services/imageSharing';
import { LANGUAGES, setLanguage, t } from '../../services/i18n';
vi.mock('../../services/imageSharing', async original => ({ ...await original<typeof import('../../services/imageSharing')>(), copySharedImage: vi.fn(async () => {}) }));

const { get, post, put, preferences } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), preferences: { enabled: true } }));
const confirmAction = vi.hoisted(() => vi.fn(async () => false));
const collectionState = vi.hoisted(() => ({ rows: [] as any[], revision: 0, listeners: new Set<() => void>() }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => confirmAction }));
vi.mock('../../services/stChatu8Preferences', () => ({ useStChatu8Preferences: () => preferences }));
vi.mock('../../services/api', () => ({ api: { get, post, put } }));
vi.mock('../../components/StyleCollectorControl', () => ({ StyleCollectorControl: () => React.createElement('button', { role: 'switch', 'aria-label': '收集模式' }) }));
vi.mock('../../components/ImageTaggerPanel', () => ({ ImageTaggerAction: () => React.createElement('button', { 'aria-label': '图片反推' }) }));
vi.mock('../../components/chain/FolderBatchImportModal', () => ({ FolderBatchImportModal: ({ isOpen, onSuccess }: { isOpen: boolean; onSuccess: () => void }) => isOpen ? React.createElement('button', { onClick: onSuccess }, '完成测试导入') : null }));
vi.mock('../../components/SmartImage', () => ({ ImageActivityContext: React.createContext(true), SmartImage: () => null }));
vi.mock('../../services/imageDisplayPreferences', () => ({ useMobileImageDisplayPreferences: () => ({ layout: 'grid' }), mobileGalleryClassName: () => '', mobileGalleryStyle: () => ({}) }));
vi.mock('../../components/ShortestColumnMasonry', () => ({ useMasonryColumnCount: () => 2, ShortestColumnMasonry: () => null }));
vi.mock('../../components/useRestoreListAnchor', () => ({ useRestoreListAnchor: () => {} }));
vi.mock('../../components/useKeepAliveScrollRestore', () => ({ useKeepAliveScrollRestore: () => () => {} }));
vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({}) }));
vi.mock('../../services/naiModels', async original => ({ ...await original<typeof import('../../services/naiModels')>(), getNaiModelDisplayLabel: (model: string) => model?.startsWith('nai-diffusion-5-') ? 'V5' : 'V4.5', getSelectableNaiModels: () => [{ id: 'nai-diffusion-4-5-full', label: 'V4.5 Full' }, { id: 'nai-diffusion-5-full', label: 'V5 Full' }] }));

const chain = (id: string, name: string, model = 'nai-diffusion-4-5-full'): PromptChain => ({
  id, userId: 'test-owner', name, type: 'style', description: '', tags: [], basePrompt: '', negativePrompt: '', modules: [],
  params: { model, width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 1, qualityToggle: true, ucPreset: 4 }, createdAt: 1, updatedAt: 1,
});
const chains = [chain('a', '风格 A'), chain('b', '风格 B'), chain('v5', '风格 V5', 'nai-diffusion-5-full'), chain('v4', '风格 V4', 'nai-diffusion-4-full')];
const props = () => ({ chains, type: 'style' as const, onCreate: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(), onRefresh: vi.fn(), onUpdateChain: vi.fn(), isLoading: false, notify: vi.fn() });
const bulkProps = () => ({ ...props(), onBulkDelete: vi.fn(async (_ids: string[], _onProgress: (completed: number) => void) => ({ remainingIds: [] as string[], errorCount: 0 })) });
const beginBulkSelection = async () => {
  await waitFor(() => expect((screen.getByRole('button', { name: '批量选择风格串' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '批量选择风格串' }));
};
it.each(['style', 'character'] as const)('%s 封面右上保留透明图片操作，左上恢复红色删除，子操作不打开工作台', async type => {
  const p = props();
  const label = type === 'character' ? '自定义角色' : '风格串';
  render(React.createElement(ChainList, { ...p, type, chains: [{ ...chains[0], type, previewImage: '/synthetic/cover.png' }] }));
  const card = screen.getByRole('button', { name: `打开${label}：风格 A` });
  const caption = within(card).getByText('风格 A').closest('.gallery-card-caption');
  expect(caption?.parentElement).toBe(card);
  expect(card.querySelector(':scope > .mobile-gallery-frame')).toBeTruthy();
  expect(card.classList.contains('gallery-card-visual')).toBe(true);
  const imageCopy = within(card).getByRole('button', { name: '复制图片' });
  const edit = within(card).getByRole('button', { name: `编辑${label}信息：风格 A` });
  const controls = edit.parentElement!;
  expect(controls.className).toContain('absolute right-2 top-2');
  expect(controls.classList.contains('image-card-actions')).toBe(true);
  expect(controls.classList.contains('hover-reveal-md')).toBe(false);
  expect(within(controls).getByRole('button', { name: '收藏' }).closest('.hover-reveal-md')).toBeNull();
  expect(controls.contains(imageCopy)).toBe(true);
  const buttons = within(controls).getAllByRole('button');
  expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
    '收藏', '下载图片', '复制图片',
    ...(type === 'style' ? ['发送到实验室：风格 A'] : []),
    `编辑${label}信息：风格 A`,
  ]);
  for (const button of buttons) {
    for (const token of ['bg-black/45', 'border-white/60', 'rounded-full', 'h-11', 'w-11', 'md:h-8', 'md:w-8', 'focus-visible:ring-white']) expect(button.classList.contains(token)).toBe(true);
    expect(button.classList.contains('bg-white/90')).toBe(false);
  }
  const remove = within(card).getByRole('button', { name: '删除：风格 A' });
  expect(remove.parentElement!.className).toContain('absolute left-2 top-2');
  expect(remove.parentElement!.classList.contains('hover-reveal-md')).toBe(true);
  for (const token of ['bg-red-500', 'text-white', 'rounded-full', 'h-11', 'w-11', 'md:h-8', 'md:w-8', 'focus-visible:ring-white']) expect(remove.classList.contains(token)).toBe(true);
  expect(within(card).queryByRole('button', { name: '复制/查看详情：风格 A' })).toBeNull();
  fireEvent.click(imageCopy);
  await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith('/synthetic/cover.png', false));
  fireEvent.keyDown(imageCopy, { key: 'Enter' });
  fireEvent.keyDown(edit, { key: 'Enter' });
  fireEvent.click(edit);
  expect(screen.getByRole('dialog', { name: `编辑${label}信息` })).toBeTruthy();
  expect(p.onSelect).not.toHaveBeenCalled();
  expect(p.onDelete).not.toHaveBeenCalled();
});
beforeEach(() => {
  localStorage.clear(); preferences.enabled = true;
  collectionState.rows = []; collectionState.revision = 0; collectionState.listeners.clear();
  confirmAction.mockReset(); confirmAction.mockResolvedValue(false);
  get.mockReset(); post.mockReset(); get.mockResolvedValue({ entries: [], lastSnapshotAt: 0 });
  put.mockReset(); put.mockResolvedValue(undefined);
  post.mockImplementation(async (_path, body) => ({ entries: body.chainIds.map((chainId: string) => ({ chainId, requestId: chainId, status: 'pending', requestedAt: 1, confirmedAt: 0, lastVerifiedAt: 0 })), lastSnapshotAt: 0 }));
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '');
});
afterEach(() => { cleanup(); setLanguage('zh-CN'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([390, 1280])('宽度 %s：标签管理紧邻筛选标签，先关闭筛选再打开，手机返回不误关管理', async width => {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('matchMedia', () => ({ matches: width < 1280, addEventListener() {}, removeEventListener() {} }));
  render(React.createElement(ChainList, { ...props(), chains: [{ ...chains[0], tags: ['我的分类', '待实测', '__角色目录__'] }] }));
  const trigger = screen.getByRole('button', { name: width < 768 ? '筛选与排序' : '筛选' });
  trigger.focus(); fireEvent.click(trigger);
  const filter = screen.getByRole('dialog', { name: '筛选与排序' });
  const heading = within(filter).getByText('自定义标签');
  const manage = within(filter).getByRole('button', { name: '管理标签' });
  expect(manage.parentElement?.parentElement).toBe(heading.parentElement);
  await waitFor(() => expect((manage as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(manage);
  const manager = await screen.findByRole('dialog', { name: '管理标签' });
  expect(screen.queryByRole('dialog', { name: '筛选与排序' })).toBeNull();
  expect(manager.contains(document.activeElement)).toBe(true);
  expect(within(manager).getByText('#我的分类')).toBeTruthy();
  expect(within(manager).queryByText('#待实测')).toBeNull();
  expect(within(manager).queryByText('#__角色目录__')).toBeNull();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(screen.getByRole('dialog', { name: '管理标签' })).toBe(manager);
  fireEvent.click(within(manager).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '管理标签' })).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(put).not.toHaveBeenCalled();
});

it('分类标签重命名覆盖未命中搜索的同类资料，保留筛选及其他资料类型', async () => {
  preferences.enabled = false;
  const p = props();
  let stored = [
    { ...chains[0], tags: ['分类甲', '待实测'] },
    { ...chains[1], tags: ['分类甲', '另一分类'] },
    { ...chain('role', '角色 A'), type: 'character' as const, tags: ['分类甲'] },
  ];
  put.mockImplementation(async (path: string, updates: Partial<PromptChain>) => {
    stored = stored.map(item => path === `/chains/${item.id}` ? { ...item, ...updates } : item);
  });
  const Harness = () => {
    const [items, setItems] = React.useState(stored);
    return React.createElement(ChainList, { ...p, chains: items, onReloadTags: async () => { setItems([...stored]); } });
  };
  render(React.createElement(Harness));
  fireEvent.change(screen.getByPlaceholderText('搜索我的风格串'), { target: { value: '风格 A' } });
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  let filter = within(screen.getByRole('dialog', { name: '筛选与排序' }));
  fireEvent.click(filter.getByRole('button', { name: '分类甲' }));
  fireEvent.click(filter.getByRole('button', { name: '只看待实测' }));
  fireEvent.click(filter.getByRole('button', { name: '管理标签' }));
  const manager = await screen.findByRole('dialog', { name: '管理标签' });
  fireEvent.click(within(manager).getByRole('button', { name: '重命名标签：分类甲' }));
  fireEvent.change(within(manager).getByRole('textbox', { name: '标签名称' }), { target: { value: '分类乙' } });
  confirmAction.mockResolvedValueOnce(true);
  fireEvent.click(within(manager).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(p.notify).toHaveBeenCalledWith('标签已更新'));
  expect(put.mock.calls).toEqual([
    ['/chains/a', { tags: ['分类乙', '待实测'] }],
    ['/chains/b', { tags: ['分类乙', '另一分类'] }],
  ]);
  expect(stored[2].tags).toEqual(['分类甲']);
  expect(p.onRefresh).not.toHaveBeenCalled();
  fireEvent.click(within(manager).getByRole('button', { name: '关闭' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选 2' }));
  filter = within(screen.getByRole('dialog', { name: '筛选与排序' }));
  expect(filter.getByRole('button', { name: '分类乙' }).getAttribute('aria-pressed')).toBe('true');
  expect(filter.getByRole('button', { name: '只看待实测' }).getAttribute('aria-pressed')).toBe('true');
  expect((screen.getByPlaceholderText('搜索我的风格串') as HTMLInputElement).value).toBe('风格 A');
  expect(screen.queryByRole('button', { name: '打开风格串：风格 B' })).toBeNull();
});

it('自定义角色共用分类管理但访客无入口，不管理词库角色标签', async () => {
  const p = props();
  const view = render(React.createElement(ChainList, { ...p, type: 'character', chains: [{ ...chains[0], tags: ['风格分类'] }, { ...chain('role', '角色 A'), type: 'character', tags: ['角色分类'] }] }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(screen.getByRole('button', { name: '管理标签' }));
  const manager = await screen.findByRole('dialog', { name: '管理标签' });
  expect(within(manager).getByText('#角色分类')).toBeTruthy();
  expect(within(manager).queryByText('#风格分类')).toBeNull();
  view.rerender(React.createElement(ChainList, { ...p, type: 'character', isGuest: true, chains: [] }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.queryByRole('button', { name: '管理标签' })).toBeNull();
});

it.each([390, 1280])('宽度 %s：直达多选进入原位批量选择，四个型号不限，图片节点不重建，零选择仍保留模式', async width => {
  vi.stubGlobal('innerWidth', width);
  const p = bulkProps();
  const view = render(React.createElement('div', { className: 'safe-mode dark' }, React.createElement(ChainList, { ...p, chains: chains.map(item => ({ ...item, previewImage: '/synthetic.png' })) })));
  const header = view.container.querySelector('header')!;
  const frames = [...view.container.querySelectorAll('.mobile-gallery-frame')];
  const selectButton = screen.getByRole('button', { name: '批量选择风格串' });
  expect(selectButton.getAttribute('title')).toBe('批量选择风格串');
  expect(selectButton.querySelector('svg')).toBeTruthy();
  expect(within(selectButton).getByText('多选').className).toContain('hidden xl:inline');
  await beginBulkSelection();
  expect(view.container.querySelector('header')).toBe(header);
  expect([...view.container.querySelectorAll('.mobile-gallery-frame')]).toEqual(frames);
  expect(within(header).getByRole('group', { name: '风格串批量操作' }).classList.contains('overflow-x-auto')).toBe(true);
  expect(screen.queryByPlaceholderText('搜索我的风格串')).toBeNull();
  for (const item of chains) {
    const card = screen.getByRole('checkbox', { name: `选择风格串：${item.name}` });
    expect(card.getAttribute('data-safe-mode-work')).toBe('true');
    expect(card.getAttribute('aria-disabled')).toBe('false');
    expect(card.querySelector('.rounded-full.absolute.left-2.top-2')).toBeTruthy();
    expect(within(card).queryByRole('button')).toBeNull();
  }
  const first = screen.getByRole('checkbox', { name: '选择风格串：风格 A' });
  fireEvent.click(within(first).getByText('风格 A'));
  expect(first.getAttribute('aria-checked')).toBe('true');
  fireEvent.keyDown(first, { key: 'Enter' });
  expect(first.getAttribute('aria-checked')).toBe('false');
  longPress(first);
  expect(first.getAttribute('aria-checked')).toBe('true');
  expect(first.getAttribute('data-press-revealed')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  expect(screen.getByText('已选 4 条')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '反选筛选结果' }));
  expect(screen.getByText('已选 0 条')).toBeTruthy();
  expect(screen.getByRole('button', { name: '退出多选' })).toBeTruthy();
  expect(p.onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '退出多选' }));
  expect(screen.getByPlaceholderText('搜索我的风格串')).toBeTruthy();
  expect(screen.queryByRole('group', { name: '风格串批量操作' })).toBeNull();
});

it('批删只针对当前搜索/标签/模型筛选，刷新剔除隐藏选择，类型切换退出且角色/访客没有入口', async () => {
  const p = bulkProps();
  const items = [{ ...chains[0], tags: ['星空'] }, chains[1], { ...chains[2], tags: ['星空'] }];
  const view = render(React.createElement(ChainList, { ...p, chains: items }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const filter = within(screen.getByRole('dialog', { name: '筛选与排序' }));
  fireEvent.click(filter.getByRole('button', { name: '星空' }));
  fireEvent.change(filter.getByRole('combobox', { name: '模型筛选' }), { target: { value: 'nai-diffusion-5-full' } });
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.change(screen.getByPlaceholderText('搜索我的风格串'), { target: { value: '风格' } });
  await beginBulkSelection(); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  expect(screen.getByText('已选 1 条')).toBeTruthy();
  confirmAction.mockResolvedValueOnce(true);
  p.onBulkDelete.mockResolvedValueOnce({ remainingIds: ['v5'], errorCount: 1 });
  fireEvent.click(screen.getByRole('button', { name: /^删除$/ }));
  await waitFor(() => expect(p.onBulkDelete).toHaveBeenCalledWith(['v5'], expect.any(Function)));
  expect(p.onDelete).not.toHaveBeenCalled(); expect(p.onRefresh).not.toHaveBeenCalled();
  view.rerender(React.createElement(ChainList, { ...p, chains: items.map(item => ({ ...item, tags: [] })) }));
  await waitFor(() => expect(screen.getByText('已选 0 条')).toBeTruthy());
  expect(p.notify).toHaveBeenCalledWith('已删除 0 条，1 条未删除', 'error');
  view.rerender(React.createElement(ChainList, { ...p, type: 'character', chains: items.map(item => ({ ...item, type: 'character' as const })) }));
  expect(screen.queryByRole('group', { name: '风格串批量操作' })).toBeNull(); expect(screen.queryByRole('button', { name: '批量选择风格串' })).toBeNull();
  view.rerender(React.createElement(ChainList, { ...p, isGuest: true }));
  expect(screen.queryByRole('button', { name: '批量选择风格串' })).toBeNull();
});

it('批删取消只保留选择；处理中锁定选择/退出/重复删除，回读仅保留未删除条目', async () => {
  const p = bulkProps();
  let complete!: (value: { remainingIds: string[]; errorCount: number }) => void;
  p.onBulkDelete.mockImplementationOnce(async (_ids, progress) => { progress(1); return new Promise(resolve => { complete = resolve; }); });
  render(React.createElement(ChainList, p));
  await beginBulkSelection(); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  const remove = screen.getByRole('button', { name: /^删除$/ });
  fireEvent.click(remove);
  await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
  expect(p.onBulkDelete).not.toHaveBeenCalled(); expect(screen.getByText('已选 4 条')).toBeTruthy();
  expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: '删除 4 条风格串？', tone: 'danger' }));
  confirmAction.mockResolvedValueOnce(true); fireEvent.click(remove);
  await waitFor(() => expect(screen.getByText('正在删除 1/4')).toBeTruthy());
  const card = screen.getByRole('checkbox', { name: '选择风格串：风格 A' });
  expect(card.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(card); fireEvent.keyDown(card, { key: ' ' });
  expect(card.getAttribute('aria-checked')).toBe('true');
  for (const name of ['退出多选', '全选筛选结果', '反选筛选结果', '清空选择', '删除']) expect((screen.getByRole('button', { name: new RegExp(`^${name}$`) }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(remove); expect(p.onBulkDelete).toHaveBeenCalledOnce();
  await act(async () => complete({ remainingIds: ['b'], errorCount: 2 }));
  expect(screen.getByText('已选 1 条')).toBeTruthy();
  expect(card.getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('checkbox', { name: '选择风格串：风格 B' }).getAttribute('aria-checked')).toBe('true');
  expect(p.notify).toHaveBeenCalledWith('已删除 3 条，1 条未删除', 'error');
  fireEvent.click(screen.getByRole('button', { name: '清空选择' })); expect(screen.getByText('已选 0 条')).toBeTruthy();
});

it('智慧姬正在读取时直达多选按钮锁定，进入多选退出智慧姬筛选且能选择 V4，退出恢复原搜索', async () => {
  const p = bulkProps(); render(React.createElement(ChainList, p));
  await waitFor(() => expect((screen.getByRole('button', { name: '批量选择风格串' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '智慧姬同步' }));
  await screen.findByRole('checkbox', { name: '智慧姬同步：风格 A' });
  expect(screen.getByRole('checkbox', { name: '智慧姬同步：风格 V4' }).getAttribute('aria-disabled')).toBe('true');
  await beginBulkSelection();
  expect(screen.queryByRole('checkbox', { name: '智慧姬同步：风格 A' })).toBeNull();
  const v4 = screen.getByRole('checkbox', { name: '选择风格串：风格 V4' });
  fireEvent.click(v4); expect(v4.getAttribute('aria-checked')).toBe('true');
  expect(screen.queryByRole('button', { name: '加入待同步' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '退出多选' }));
  expect(screen.getByPlaceholderText('搜索我的风格串')).toBeTruthy();
});

it('确认期间切换资料类型后迟到确认不能删除原筛选条目，切回风格串不恢复旧选择', async () => {
  const p = bulkProps();
  let confirm!: (approved: boolean) => void;
  confirmAction.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
  const view = render(React.createElement(ChainList, p));
  await beginBulkSelection(); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  fireEvent.click(screen.getByRole('button', { name: /^删除$/ }));
  await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
  view.rerender(React.createElement(ChainList, { ...p, type: 'character', chains: chains.map(item => ({ ...item, type: 'character' as const })) }));
  await act(async () => confirm(true));
  expect(p.onBulkDelete).not.toHaveBeenCalled();
  view.rerender(React.createElement(ChainList, p));
  expect(screen.queryByRole('checkbox')).toBeNull();
  await beginBulkSelection(); expect(screen.getByText('已选 0 条')).toBeTruthy();
});

it.each(['style', 'character'] as const)('%s 搜索标题跟随五种语言，资料名称即使命中界面词典也保留原文', type => {
  const label = type === 'character' ? '自定义角色' : '风格串';
  render(React.createElement(ChainList, { ...props(), type, chains: [{ ...chains[0], type, name: '我的风格串' }] }));
  for (const language of LANGUAGES) {
    act(() => setLanguage(language.code));
    expect(screen.getByPlaceholderText(t('搜索{0}', [t(type === 'character' ? '我的自定义角色' : '我的风格串')]))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('打开{0}：{1}', [t(label), '我的风格串']) })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('删除：{0}', ['我的风格串']) })).toBeTruthy();
  }
});

it.each(['style', 'character'] as const)('%s 无封面也可删除：取消不提交，确认传正确 ID，失败不打开工作台', async type => {
  const p = props();
  render(React.createElement(ChainList, { ...p, type, chains: [{ ...chains[0], type }] }));
  const card = screen.getByRole('button', { name: `打开${type === 'character' ? '自定义角色' : '风格串'}：风格 A` });
  const remove = within(card).getByRole('button', { name: '删除：风格 A' });
  fireEvent.click(remove);
  await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: '删除“风格 A”？', tone: 'danger' })));
  expect(p.onDelete).not.toHaveBeenCalled();
  confirmAction.mockResolvedValue(true);
  fireEvent.click(remove);
  await waitFor(() => expect(p.onDelete).toHaveBeenCalledWith('a'));
  p.onDelete.mockRejectedValueOnce(new Error('合成删除失败'));
  fireEvent.click(remove);
  await waitFor(() => expect(p.notify).toHaveBeenCalledWith('删除失败，请稍后重试', 'error'));
  expect(p.onSelect).not.toHaveBeenCalled();
  expect(within(card).getByRole('button', { name: '删除：风格 A' })).toBeTruthy();
});

describe('风格串列表的酒馆筛选交互', () => {
  it.each(['desktop', 'mobile'])('Agent 在 %s 从大量卡片打开真实筛选浮层，读取选项并选中 V5 后实际过滤列表', async surface => {
    render(React.createElement('main', { 'data-agent-view': 'list' }, React.createElement(ChainList, { ...props(), chains: [...Array.from({ length: 40 }, (_, i) => chain(`old-${i}`, `旧风格${i}`)), chain('v5', 'V5 作品', 'nai-diffusion-5-full')] })));
    const page = readAgentPage({ query: '筛选' }), trigger = page.controls.find(item => item.label === (surface === 'desktop' ? '筛选' : '筛选与排序'))!;
    let operation!: ReturnType<typeof operateAgentPage>;
    act(() => { operation = operateAgentPage({ action: 'click', snapshotId: page.snapshotId, controlId: trigger.id, expect: { label: '模型筛选' } }); });
    await operation;
    const filter = readAgentPage({ query: '模型筛选' }); expect(filter.title).toBe('筛选与排序');
    expect(filter.controls[0].options?.some(option => option.value === 'nai-diffusion-5-full')).toBe(true);
    act(() => { operation = operateAgentPage({ action: 'select', snapshotId: filter.snapshotId, controlId: filter.controls[0].id, value: 'nai-diffusion-5-full' }); });
    expect((await operation).verification?.control?.value).toBe('nai-diffusion-5-full');
    expect(screen.getByText('V5 作品')).toBeTruthy(); expect(screen.queryByText('旧风格0')).toBeNull();
  });
  it('无封面卡片可直接读取并打开，子按钮回车不触发父卡片', async () => {
    const p = props(); render(React.createElement('main', { 'data-agent-view': 'list' }, React.createElement(ChainList, p)));
    const page = readAgentPage({ query: '打开风格串：风格 A' }); expect(page.controls).toHaveLength(1);
    let operation!: ReturnType<typeof operateAgentPage>;
    act(() => { operation = operateAgentPage({ action: 'press', snapshotId: page.snapshotId, controlId: page.controls[0].id, key: 'Enter' }); }); await operation;
    expect(p.onSelect).toHaveBeenCalledExactlyOnceWith('a');
    const edit = screen.getByRole('button', { name: '编辑风格串信息：风格 A' });
    expect(edit.parentElement!.className).toContain('absolute right-2 top-2');
    expect(screen.queryByRole('button', { name: '下载图片' })).toBeNull();
    expect(screen.queryByRole('button', { name: '复制图片' })).toBeNull();
    fireEvent.keyDown(edit, { key: 'Enter' }); expect(p.onSelect).toHaveBeenCalledTimes(1);
  });
  it.each(['desktop', 'mobile'])('%s 自定义标签可组合模型与状态筛选，多选要求同时包含，选项不被结果缩掉', surface => {
    const items = [
      { ...chain('a', '夜景 A'), tags: ['aitag', 'NAI', '星空', '水面', '待实测'] },
      { ...chain('b', '夜景 B'), tags: ['星空'] },
      { ...chain('v5', '夜景 V5', 'nai-diffusion-5-full'), tags: ['星空', '水面'] },
      { ...chain('role', '角色'), type: 'character' as const, tags: ['角色专用分类'] },
    ];
    render(React.createElement(ChainList, { ...props(), chains: items }));
    fireEvent.click(screen.getByRole('button', { name: surface === 'desktop' ? '筛选' : '筛选与排序' }));
    const filter = within(screen.getByRole('dialog', { name: '筛选与排序' }));
    for (const tag of ['aitag', 'NAI', '待实测', '角色专用分类']) expect(filter.queryByRole('button', { name: tag })).toBeNull();
    fireEvent.click(filter.getByRole('button', { name: '星空' }));
    fireEvent.click(filter.getByRole('button', { name: '水面' }));
    expect(screen.queryByText('夜景 B')).toBeNull();
    expect(screen.getByText('夜景 A')).toBeTruthy(); expect(screen.getByText('夜景 V5')).toBeTruthy();
    expect(filter.getByText('2 项筛选已启用')).toBeTruthy();
    fireEvent.change(filter.getByRole('combobox', { name: '模型筛选' }), { target: { value: 'nai-diffusion-4-5-full' } });
    fireEvent.click(filter.getByRole('button', { name: '只看待实测' }));
    expect(screen.queryByText('夜景 V5')).toBeNull();
    expect(filter.getByRole('button', { name: '水面' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(filter.getByRole('button', { name: '重置筛选' }));
    expect(screen.getByText('夜景 B')).toBeTruthy();
    expect(filter.getByRole('button', { name: '水面' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('卡片保存后立即出现自定义标签，删除最后一处标签后撤掉失效筛选', async () => {
    const p = props();
    const Harness = () => {
      const [items, setItems] = React.useState([chain('a', '风格 A'), chain('b', '风格 B')]);
      return React.createElement(ChainList, { ...p, chains: items, onUpdateChain: async (id, updates) => { setItems(current => current.map(item => item.id === id ? { ...item, ...updates } : item)); } });
    };
    render(React.createElement(Harness));
    fireEvent.click(screen.getByRole('button', { name: '编辑风格串信息：风格 A' }));
    fireEvent.change(screen.getByRole('textbox', { name: '添加标签' }), { target: { value: '我的标签' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑风格串信息' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '筛选与排序' })).getByRole('button', { name: '我的标签' }));
    expect(screen.queryByText('风格 B')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '编辑风格串信息：风格 A' }));
    fireEvent.click(screen.getByRole('button', { name: '移除标签 我的标签' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑风格串信息' })).toBeNull());
    expect(screen.getByText('风格 B')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    expect(screen.queryByRole('button', { name: '我的标签' })).toBeNull();
    expect(screen.getByText('暂无自定义标签，可在卡片铅笔中添加')).toBeTruthy();
  });

  it('导入新增大量标签可搜索并滚动；标签减少后隐藏搜索不会残留不可见条件', () => {
    const p = props();
    const view = render(React.createElement(ChainList, { ...p, chains: [chain('a', '风格 A')] }));
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    view.rerender(React.createElement(ChainList, { ...p, chains: [{ ...chain('a', '风格 A'), tags: Array.from({ length: 15 }, (_, i) => `分类${i}`) }] }));
    const filter = within(screen.getByRole('dialog', { name: '筛选与排序' }));
    fireEvent.change(filter.getByRole('textbox', { name: '搜索自定义标签' }), { target: { value: '分类14' } });
    expect(filter.queryByRole('button', { name: '分类0' })).toBeNull();
    const tag = filter.getByRole('button', { name: '分类14' });
    expect(tag.closest('.max-h-40')?.classList.contains('overflow-y-auto')).toBe(true);
    view.rerender(React.createElement(ChainList, { ...p, chains: [{ ...chain('a', '风格 A'), tags: ['新的分类'] }] }));
    expect(filter.queryByRole('textbox', { name: '搜索自定义标签' })).toBeNull();
    expect(filter.getByRole('button', { name: '新的分类' })).toBeTruthy();
  });

  it('卡片铅笔可独立改名，支持键盘聚焦与触屏，不会进入工作台或改写生成配置', async () => {
    const p = props(); render(React.createElement(ChainList, p));
    const edit = screen.getByRole('button', { name: '编辑风格串信息：风格 A' });
    expect(edit.className).not.toContain('hidden');
    expect(edit.classList.contains('hover-reveal-md')).toBe(true);
    fireEvent.click(edit);
    expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '改名后的风格' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑风格串信息' })).toBeNull());
    expect(p.onUpdateChain).toHaveBeenCalledExactlyOnceWith('a', { name: '改名后的风格', description: '', tags: [] });
    expect(p.onDelete).not.toHaveBeenCalled(); expect(p.onSelect).not.toHaveBeenCalled();
  });

  it('访客及同步挑选模式不显示卡片编辑和删除入口', async () => {
    const p = { ...props(), chains: [{ ...chains[0], previewImage: '/synthetic/cover.png' }] };
    const view = render(React.createElement(ChainList, { ...p, isGuest: true }));
    expect(screen.queryByRole('button', { name: /编辑风格串信息/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '删除：风格 A' })).toBeNull();
    expect(screen.getByRole('button', { name: '复制图片' })).toBeTruthy();
    view.rerender(React.createElement(ChainList, p));
    await waitFor(() => expect(screen.getByRole('button', { name: '智慧姬同步' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '智慧姬同步' }));
    expect(screen.queryByRole('button', { name: '删除：风格 A' })).toBeNull();
    expect(screen.queryByRole('button', { name: /编辑风格串信息/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '下载图片' })).toBeNull();
    expect(screen.queryByRole('button', { name: '复制图片' })).toBeNull();
    expect(screen.queryByRole('button', { name: /更多操作：/ })).toBeNull();
  });

  it.each([390, 1024, 1280])('宽度 %s 的触屏长按显露同组图片取用与编辑，子操作不打开工作台', async width => {
    vi.stubGlobal('innerWidth', width);
    const p = props(); render(React.createElement(ChainList, { ...p, chains: [{ ...chains[0], previewImage: '/synthetic/cover.png', description: '完整组合说明' }] }));
    const card = screen.getByRole('button', { name: '打开风格串：风格 A' });
    expect(screen.queryByRole('button', { name: '更多操作：风格 A' })).toBeNull();
    expect(card.hasAttribute('data-press-revealed')).toBe(false); longPress(card);
    expect(card.getAttribute('data-press-revealed')).toBe('true');
    const controls = card.querySelector('[data-card-action].right-2')!;
    expect(within(controls as HTMLElement).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['收藏', '下载图片', '复制图片', '发送到实验室：风格 A', '编辑风格串信息：风格 A']);
    fireEvent.click(within(card).getByRole('button', { name: '复制图片' }));
    await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith('/synthetic/cover.png', false));
    fireEvent.click(within(card).getByRole('button', { name: '编辑风格串信息：风格 A' }));
    const edit = screen.getByRole('dialog', { name: '编辑风格串信息' });
    expect((within(edit).getByRole('textbox', { name: '描述' }) as HTMLTextAreaElement).value).toBe('完整组合说明');
    expect(p.onSelect).not.toHaveBeenCalled(); expect(p.onDelete).not.toHaveBeenCalled();
  });

  it('手机移除白色按钮；访客有封面时只提供图片取用，无封面不留空操作组', async () => {
    vi.stubGlobal('innerWidth', 390);
    const p = { ...props(), chains: [{ ...chains[0], previewImage: '/synthetic/cover.png' }] };
    const view = render(React.createElement(ChainList, p));
    longPress(screen.getByRole('button', { name: '打开风格串：风格 A' }));
    fireEvent.click(screen.getByRole('button', { name: '删除：风格 A' }));
    expect(confirmAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '复制/查看详情：风格 A' })).toBeNull();
    view.rerender(React.createElement(ChainList, { ...p, isGuest: true }));
    longPress(screen.getByRole('button', { name: '打开风格串：风格 A' }));
    expect(screen.queryByRole('button', { name: '删除：风格 A' })).toBeNull();
    expect(screen.queryByRole('button', { name: /编辑风格串信息/ })).toBeNull();
    expect(screen.getByRole('button', { name: '下载图片' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
    await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith('/synthetic/cover.png', false));
    view.rerender(React.createElement(ChainList, { ...p, chains: [chains[0]], isGuest: true }));
    const card = screen.getByRole('button', { name: '打开风格串：风格 A' });
    expect(card.querySelector('.hover-reveal-md')).toBeNull();
    expect(p.onSelect).not.toHaveBeenCalled(); expect(p.onDelete).not.toHaveBeenCalled();
  });

  it('顶栏按查找、同步、添加排序；刷新与图片反推入口移除', async () => {
    const p = props(); const view = render(React.createElement(ChainList, p));
    const header = view.container.querySelector('header')!;
    const desktop = [...header.querySelectorAll('button')].filter(button => !button.closest('.md\\:hidden'));
    expect(desktop.map(button => button.getAttribute('aria-label') || button.textContent)).toEqual(['筛选', '智慧姬同步', '查找相似', '收集模式', '批量导入', '新建风格串']);
    expect(header.firstElementChild?.contains(screen.getByPlaceholderText('搜索我的风格串'))).toBe(true);
    expect(header.querySelectorAll('[role="switch"]')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /刷新|反推/ })).toBeNull();
    fireEvent.click(desktop[4]);
    expect(p.onRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '完成测试导入' }));
    expect(p.onRefresh).toHaveBeenCalledOnce();
  });

  it.each(['desktop', 'mobile'])('%s 的组合筛选真正缩小结果，重置保留搜索且两种面板共享状态', async surface => {
    localStorage.setItem('nai_chain_favs', JSON.stringify(['a', 'v5']));
    const items = [
      { ...chain('a', '共同 A'), tags: ['标签甲', '待实测'], createdAt: 1, updatedAt: 3 },
      { ...chain('b', '共同 B'), tags: ['标签甲', '标签乙'], createdAt: 2, updatedAt: 2 },
      { ...chain('v5', '共同 V5', 'nai-diffusion-5-full'), tags: ['标签甲', '标签乙', '待实测'], createdAt: 3, updatedAt: 1 },
      chain('c', '其他'),
    ];
    render(React.createElement(ChainList, { ...props(), chains: items }));
    fireEvent.change(screen.getByPlaceholderText('搜索我的风格串'), { target: { value: '共同' } });
    fireEvent.click(screen.getByRole('button', { name: surface === 'desktop' ? '筛选' : '筛选与排序' }));
    const dialog = screen.getByRole('dialog', { name: '筛选与排序' });
    const filter = within(dialog);
    expect(filter.getByText('自定义标签')).toBeTruthy();
    expect(filter.getByRole('button', { name: '标签甲' })).toBeTruthy();
    expect(filter.queryByRole('button', { name: '待实测' })).toBeNull();
    expect(screen.getByText('共同 A')).toBeTruthy(); expect(screen.getByText('共同 B')).toBeTruthy();
    fireEvent.click(filter.getByRole('button', { name: '只看收藏' }));
    expect(screen.queryByText('共同 B')).toBeNull(); expect(screen.getByText('共同 V5')).toBeTruthy();
    fireEvent.change(filter.getByRole('combobox', { name: '模型筛选' }), { target: { value: 'nai-diffusion-4-5-full' } });
    expect(screen.queryByText('共同 V5')).toBeNull(); expect(screen.getByText('共同 A')).toBeTruthy();
    fireEvent.click(filter.getByRole('button', { name: '重置筛选' }));
    expect((screen.getByPlaceholderText('搜索我的风格串') as HTMLInputElement).value).toBe('共同');
    expect(screen.getByText('共同 A')).toBeTruthy(); expect(screen.queryByText('其他')).toBeNull();
    fireEvent.click(filter.getByRole('button', { name: '只看待实测' }));
    expect(screen.queryByText('共同 B')).toBeNull();
    fireEvent.change(filter.getByRole('combobox', { name: '排序' }), { target: { value: 'created_desc' } });
    const visibleNames = screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent);
    expect(visibleNames).toEqual(['共同 V5', '共同 A']);
    if (surface === 'desktop') fireEvent.keyDown(document, { key: 'Escape' });
    else fireEvent.click(filter.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '筛选与排序' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: surface === 'desktop' ? '筛选与排序' : '筛选 1' }));
    const other = within(screen.getByRole('dialog', { name: '筛选与排序' }));
    expect(other.getByRole('button', { name: '只看待实测' }).getAttribute('aria-pressed')).toBe('true');
    expect((other.getByRole('combobox', { name: '排序' }) as HTMLSelectElement).value).toBe('created_desc');
  });

  it.each([
    { anchorLeft: 600, anchorWidth: 88, viewport: 1400, left: 644 },
    { anchorLeft: 0, anchorWidth: 40, viewport: 1000, left: 204 },
    { anchorLeft: 760, anchorWidth: 24, viewport: 800, left: 596 },
  ])('筛选共用锚定展开，屏幕边缘仅作可见范围修正：$anchorLeft', ({ anchorLeft, anchorWidth, viewport, left }) => {
    vi.stubGlobal('innerWidth', viewport);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('aria-label') === '筛选与排序') return { width: 384 } as DOMRect;
      return { left: anchorLeft, width: anchorWidth, bottom: 72 } as DOMRect;
    });
    render(React.createElement(ChainList, props()));
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    const dialog = screen.getByRole('dialog', { name: '筛选与排序' });
    expect(dialog.classList.contains('fixed')).toBe(true);
    expect(dialog.classList.contains('-translate-x-1/2')).toBe(true);
    expect(dialog.classList.contains('right-0')).toBe(false);
    expect(dialog.style.left).toBe(`${left}px`);
    expect(dialog.style.top).toBe('80px');
    expect(dialog.closest('header')).toBeNull();
    expect(dialog.classList.contains('appearance-popover')).toBe(true);
    expect(dialog.style.transformOrigin).toBe(`${anchorLeft + anchorWidth / 2 - left + 192}px top`);
    if (anchorLeft === 600) {
      vi.stubGlobal('innerWidth', 800); fireEvent(window, new Event('resize'));
      expect(dialog.style.left).toBe('596px');
      vi.stubGlobal('innerWidth', 600); fireEvent(window, new Event('resize'));
      expect(screen.queryByRole('dialog')).toBeNull();
      return;
    }
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['style', 'character'] as const)('%s 新建与编辑弹窗脱离工作区隔离层，保留回调与应用主题', type => {
    const p = { ...props(), type, chains: chains.map(item => ({ ...item, type })) };
    const label = type === 'character' ? '新建自定义角色' : '新建风格串';
    const view = render(React.createElement('div', { className: 'agent-stage safe-mode' },
      React.createElement('aside', { className: 'z-40' }, '侧边栏'),
      React.createElement('main', { className: 'isolate overflow-hidden' }, React.createElement(ChainList, p)),
    ));
    const stage = view.container.firstElementChild;
    fireEvent.click(screen.getAllByRole('button', { name: label })[0]);
    const create = screen.getByRole('dialog', { name: label });
    expect(create.parentElement).toBe(stage); expect(create.closest('main')).toBeNull();
    expect(create.classList.contains('z-[1200]')).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(type === 'character' ? '例如：新角色' : '例如：新风格串'), { target: { value: '合成预设' } });
    fireEvent.click(within(create).getByRole('button', { name: '创建' }));
    expect(p.onCreate).toHaveBeenCalledWith('合成预设', '', type);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getAllByTitle('编辑信息')[0]);
    const edit = screen.getByRole('dialog', { name: type === 'character' ? '编辑自定义角色信息' : '编辑风格串信息' });
    expect(edit.closest('main')).toBeNull(); expect(edit.closest('.safe-mode')).toBe(stage);
  });

  it('卡片勾选取代打开编辑；跨搜索保持选择，V5 可选、V4 禁用，保存所选 V4.5 与 V5', async () => {
    const p = props(); render(React.createElement(ChainList, p));
    const trigger = screen.getByRole('button', { name: '智慧姬同步' }); await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false));
    fireEvent.click(trigger);
    const a = await screen.findByRole('checkbox', { name: '智慧姬同步：风格 A' });
    await waitFor(() => expect(a.getAttribute('aria-disabled')).toBe('false'));
    fireEvent.keyDown(a, { key: ' ' }); expect(a.getAttribute('aria-checked')).toBe('true');
    const v5 = screen.getByRole('checkbox', { name: '智慧姬同步：风格 V5' });
    expect(v5.getAttribute('aria-disabled')).toBe('false'); fireEvent.click(v5); expect(v5.getAttribute('aria-checked')).toBe('true');
    const v4 = screen.getByRole('checkbox', { name: '智慧姬同步：风格 V4' });
    expect(v4.getAttribute('aria-disabled')).toBe('true'); fireEvent.click(v4); expect(v4.getAttribute('aria-checked')).toBe('false');
    const search = screen.getByPlaceholderText('搜索我的风格串'); fireEvent.change(search, { target: { value: '风格 B' } });
    expect(search.parentElement?.classList.contains('min-w-0')).toBe(true);
    expect(search.parentElement?.classList.contains('min-w-[12rem]')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByRole('checkbox', { name: '智慧姬同步：风格 A' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: '智慧姬同步：风格 B' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '加入待同步' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/st-chatu8/workspace', { action: 'enqueue', chainIds: ['a', 'v5', 'b'] }));
    expect(p.onSelect).not.toHaveBeenCalled(); expect(p.onDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: '智慧姬同步：风格 A' })).toBeNull());
    expect(screen.getByRole('tab', { name: '待同步 3' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '返回资料库' }));
    fireEvent.click(screen.getByText('风格 A')); expect(p.onSelect).toHaveBeenCalledWith('a');
  });
  it('移动端在筛选面板提供同一选择入口；取消恢复列表且不保存', async () => {
    render(React.createElement(ChainList, props()));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const entry = await screen.findByRole('button', { name: '智慧姬同步（待同步 0）' });
    await waitFor(() => expect(entry.hasAttribute('disabled')).toBe(false)); fireEvent.click(entry);
    await screen.findByRole('checkbox', { name: '智慧姬同步：风格 A' });
    fireEvent.click(screen.getByRole('button', { name: '返回资料库' })); expect(post).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox', { name: '智慧姬同步：风格 A' })).toBeNull();
  });
  it('角色与游客页面不提供发送范围或读取请求', async () => {
    const view = render(React.createElement(ChainList, { ...props(), type: 'character' }));
    expect(screen.queryByRole('button', { name: '智慧姬同步' })).toBeNull(); expect(get).not.toHaveBeenCalled(); view.unmount();
    render(React.createElement(ChainList, { ...props(), isGuest: true }));
    expect(screen.queryByRole('button', { name: '智慧姬同步' })).toBeNull(); expect(get).not.toHaveBeenCalled();
  });
  it('待同步与接收记录分开，移出只改队列，对方移除条目可显式重新加入', async () => {
    const entry = (chainId: string, status: string) => ({ chainId, requestId: chainId, status, requestedAt: 1, confirmedAt: 2, lastVerifiedAt: 2 });
    const current = { entries: [entry('a', 'pending'), entry('b', 'synced'), entry('v5', 'removed')], lastSnapshotAt: 2 };
    get.mockResolvedValue(current);
    const p = props(); render(React.createElement(ChainList, p));
    const trigger = await screen.findByRole('button', { name: '智慧姬同步 1' });
    await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false)); fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('tab', { name: '待同步 1' }).getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByText('风格 A')).toBeTruthy(); expect(screen.queryByText('风格 B')).toBeNull();
    post.mockResolvedValueOnce({ entries: current.entries.slice(1), lastSnapshotAt: 2 });
    fireEvent.click(screen.getByRole('button', { name: '移出待同步：风格 A' }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/st-chatu8/workspace', { action: 'remove', chainIds: ['a'] }));
    expect(p.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: '同步记录 2' }));
    expect(screen.queryByText('风格 A')).toBeNull(); expect(screen.getByText('风格 B')).toBeTruthy(); expect(screen.getByText('智慧姬中已移除', { selector: 'span' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '记录状态' }), { target: { value: 'removed' } });
    expect(screen.queryByText('风格 B')).toBeNull(); expect(screen.getByText('风格 V5')).toBeTruthy();
    post.mockResolvedValueOnce({ entries: [entry('b', 'synced'), entry('v5', 'pending')], lastSnapshotAt: 2 });
    await waitFor(() => expect(screen.getByRole('button', { name: '重新加入待同步：风格 V5' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '重新加入待同步：风格 V5' }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/st-chatu8/workspace', { action: 'requeue', chainIds: ['v5'] }));
    expect(screen.getByRole('tab', { name: '待同步 1' }).getAttribute('aria-selected')).toBe('true');
  });
  it('关闭时桌面与手机隐藏入口；开启后显示，编辑中关闭立即退出且不提交草稿', async () => {
    preferences.enabled = false;
    const p = props(); const view = render(React.createElement(ChainList, p));
    expect(screen.queryByRole('button', { name: '智慧姬同步' })).toBeNull(); expect(get).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '智慧姬同步（待同步 0）' })).toBeNull();
    preferences.enabled = true; view.rerender(React.createElement(ChainList, p));
    expect(await screen.findByRole('button', { name: '智慧姬同步（待同步 0）' })).toBeTruthy();
    const trigger = screen.getByRole('button', { name: '智慧姬同步' });
    await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false)); fireEvent.click(trigger);
    await screen.findByRole('checkbox', { name: '智慧姬同步：风格 A' });
    preferences.enabled = false; view.rerender(React.createElement(ChainList, p));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: '智慧姬同步：风格 A' })).toBeNull());
    expect(screen.queryByRole('button', { name: '智慧姬同步' })).toBeNull(); expect(post).not.toHaveBeenCalled();
  });
});

// 收藏服务的持久化与并发在 services 定向测试中验证，这里隔离页面副作用。
vi.mock('../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../services/collectionFavorites')>(),
  ensureCollection: vi.fn(async () => {}), loadCollection: vi.fn(async () => []),
  collectionSnapshot: () => collectionState.rows,
  subscribeCollection: (listener: () => void) => { collectionState.listeners.add(listener); return () => { collectionState.listeners.delete(listener); }; },
  collectionRevision: () => collectionState.revision,
  collectionTargetActive: (target: any) => collectionState.rows.some(item => !item.archived && (item.imageUrl === target.imageUrl || item.analysis?.collectionOriginalUrl === target.imageUrl)),
  toggleCollectionTarget: vi.fn(async () => true), syncHistoryCollectionFavorites: vi.fn(async () => {}),
}));

it.each(['style', 'character'] as const)('%s收藏筛选与当前封面红心一致，无封面旧标记保留，归档不会滞留筛选', async type => {
  const current = { ...chain('legacy-current', '旧当前封面'), type, previewImage: '/api/assets/current.png' };
  const replaced = { ...chain('legacy-replaced', '已换封面'), type, previewImage: '/api/assets/replaced.png' };
  const missing = { ...chain('legacy-missing', '无封面旧标记'), type };
  const raw = JSON.stringify([current.id, replaced.id, missing.id, 'unknown']); localStorage.setItem('nai_chain_favs', raw);
  collectionState.rows = [
    { sourceType: type === 'style' ? 'chain' : 'character', sourceId: current.id, imageUrl: '/api/inspirations/current/image', analysis: { collectionOriginalUrl: current.previewImage } },
    { sourceType: type === 'style' ? 'chain' : 'character', sourceId: replaced.id, imageUrl: '/api/assets/previous.png' },
  ];
  render(React.createElement(ChainList, { ...props(), type, chains: [current, replaced, missing] }));
  const label = type === 'style' ? '风格串' : '自定义角色';
  const card = screen.getByRole('button', { name: `打开${label}：${current.name}` });
  expect(within(card).getByRole('button', { name: '取消收藏' })).toBeTruthy();
  expect(within(screen.getByRole('button', { name: `打开${label}：${replaced.name}` })).getByRole('button', { name: '收藏' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '筛选与排序' })).getByRole('button', { name: '只看收藏' }));
  expect(screen.getByText(current.name)).toBeTruthy(); expect(screen.getByText(missing.name)).toBeTruthy(); expect(screen.queryByText(replaced.name)).toBeNull();
  act(() => { collectionState.rows[0].archived = true; collectionState.revision++; collectionState.listeners.forEach(listener => listener()); });
  expect(screen.queryByText(current.name)).toBeNull(); expect(screen.getByText(missing.name)).toBeTruthy();
  expect(localStorage.getItem('nai_chain_favs')).toBe(raw);
});
