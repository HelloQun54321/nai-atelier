import { longPress } from '../support/touchEvents';
// @vitest-environment jsdom
import React from 'react';
import { mockGalleryGeometry } from '../support/galleryGeometry';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InspirationGallery } from '../../components/InspirationGallery';
import { readAgentPage } from '../../services/agentWorkspace';
import { Inspiration, User } from '../../types';
import { db } from '../../services/dbService';
import { copySharedImage } from '../../services/imageSharing';
import { api } from '../../services/api';
import { extractMetadata } from '../../services/metadataService';
import { NAI_QUALITY_TAGS } from '../../services/promptUtils';
import { buildMediaUrl } from '../../services/mobileImageCache';
import { applyCollectionBoardUpdates, getCollectionBoardIds } from '../../services/inspirationUtils';
vi.mock('../../services/api', async original => {
  const actual = await original<typeof import('../../services/api')>();
  return { ...actual, api: { ...actual.api, uploadFile: vi.fn(async () => ({ url: '/api/assets/synthetic.png' })) } };
});
vi.mock('../../services/metadataService', async original => ({ ...await original<typeof import('../../services/metadataService')>(), extractMetadata: vi.fn(async () => null) }));
vi.mock('../../services/imageSharing', async original => ({ ...await original<typeof import('../../services/imageSharing')>(), copySharedImage: vi.fn(async () => {}) }));
const { confirmAction, imageRender } = vi.hoisted(() => ({ confirmAction: vi.fn(), imageRender: vi.fn() }));

vi.mock('../../services/dbService', () => ({
  db: {
    getInspirationBoards: vi.fn(async () => [
      { id: 'board-1', name: '角色设计', color: '#6366f1', sortOrder: 0, userId: 'user-1', createdAt: 1, updatedAt: 1 },
    ]),
    getAllInspirations: vi.fn(async () => []),
    getCollectionTagNames: vi.fn(async () => []),
    saveCollectionTagNames: vi.fn(async (tags: string[]) => tags),
    updateInspiration: vi.fn(),
    updateInspirationBoard: vi.fn(),
    createInspirationBoard: vi.fn(async () => {}),
    deleteInspirationBoard: vi.fn(),
    saveInspiration: vi.fn(async () => {}),
    bulkUpdateInspirations: vi.fn(async () => {}),
    bulkDeleteInspirations: vi.fn(async () => {}),
  },
}));

vi.mock('../../components/SmartImage', () => ({
  ImageActivityContext: React.createContext(true),
  SmartImage: ({ thumbnailVariant: _thumbnailVariant, previewTransform, className = 'h-full w-full object-cover', ...props }: any) => { imageRender(props.alt); return React.createElement('img', { ...props, className, 'data-preview-transform': previewTransform }); },
  OriginalImage: (props: any) => React.createElement('img', props),
}));

vi.mock('../../components/ConfirmDialog', () => ({
  useConfirmDialog: () => confirmAction,
}));


beforeEach(() => {
  document.documentElement.dataset.motion = 'full';
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      if (target.classList.contains('chain-masonry')) this.callback([{ contentRect: { width: 1000 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver);
    }
    unobserve() {} disconnect() {}
  });
  vi.clearAllMocks(); localStorage.clear(); localStorage.setItem('nai-collection-navigation-expanded', 'true'); confirmAction.mockResolvedValue(true);
  vi.mocked(db.getCollectionTagNames).mockReset().mockResolvedValue([]);
  vi.mocked(db.saveCollectionTagNames).mockReset().mockImplementation(async tags => tags);
  vi.mocked(db.getInspirationBoards).mockReset().mockResolvedValue([{ id: 'board-1', name: '角色设计', color: '#6366f1', sortOrder: 0, userId: 'user-1', createdAt: 1, updatedAt: 1 }]);
  vi.mocked(db.updateInspirationBoard).mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number; pointerType: string; isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse'; this.isPrimary = init.isPrimary ?? true;
    }
  });
  vi.mocked(extractMetadata).mockReset().mockResolvedValue(null);
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:synthetic'); static revokeObjectURL = vi.fn(); });
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete document.documentElement.dataset.motion; });

const mockUser: User = {
  id: 'user-1',
  username: 'test-user',
  role: 'user',
  createdAt: 1,
};

const nestedBoards = () => [
  { id: 'root', name: '根夹', parentId: null },
  { id: 'child', name: '子夹', parentId: 'root' },
  { id: 'grand', name: '孙夹', parentId: 'child' },
  { id: 'sibling', name: '同级夹', parentId: 'root' },
  { id: 'other', name: '另一根夹', parentId: null },
].map((board, sortOrder) => ({ ...board, userId: mockUser.id, color: '#6366f1', sortOrder, createdAt: 1, updatedAt: 1 }));

const directoryDragData = () => {
  const values = new Map<string, string>();
  return { setData: vi.fn((type: string, value: string) => values.set(type, value)), getData: (type: string) => values.get(type) || '', get types() { return [...values.keys()]; }, effectAllowed: 'all', dropEffect: 'none' } as unknown as DataTransfer;
};

it('拖动收藏夹移动整棵子树，保留选中、颜色与图片归属，图片拖入仍只追加直接目标', async () => {
  let stored = nestedBoards();
  vi.mocked(db.getInspirationBoards).mockImplementation(async () => stored);
  vi.mocked(db.updateInspirationBoard).mockImplementation(async (id, updates) => { stored = stored.map(board => board.id === id ? { ...board, ...updates } : board); });
  const images = [{ ...mockInspirations[0], boardIds: ['grand', 'sibling'], title: '子树作品' }];
  const onRefresh = vi.fn(async () => {});
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: images, onRefresh, notify: vi.fn() }));
  const source = await screen.findByRole('button', { name: '选择收藏夹：子夹' });
  fireEvent.click(source);
  const transfer = directoryDragData();
  fireEvent.dragStart(source, { dataTransfer: transfer });
  const destination = screen.getByRole('button', { name: '选择收藏夹：另一根夹' });
  fireEvent.dragOver(destination, { dataTransfer: transfer }); fireEvent.drop(destination, { dataTransfer: transfer });
  await waitFor(() => expect(db.updateInspirationBoard).toHaveBeenCalledExactlyOnceWith('child', { parentId: 'other' }));
  await waitFor(() => expect(screen.getByRole('option', { name: '另一根夹 / 子夹 / 孙夹 (1)' })).toBeTruthy());
  expect(screen.getByRole('button', { name: '选择收藏夹：子夹' }).getAttribute('aria-pressed')).toBe('true');
  expect(stored.find(board => board.id === 'grand')?.parentId).toBe('child');
  expect(stored.find(board => board.id === 'child')?.color).toBe('#6366f1');
  expect(images[0].boardIds).toEqual(['grand', 'sibling']); expect(db.bulkUpdateInspirations).not.toHaveBeenCalled(); expect(onRefresh).not.toHaveBeenCalled();
  const rootTransfer = directoryDragData();
  fireEvent.dragStart(screen.getByRole('button', { name: '选择收藏夹：子夹' }), { dataTransfer: rootTransfer });
  const rootTarget = screen.getByRole('group', { name: '移到根目录' });
  fireEvent.dragOver(rootTarget, { dataTransfer: rootTransfer }); fireEvent.drop(rootTarget, { dataTransfer: rootTransfer });
  await waitFor(() => expect(db.updateInspirationBoard).toHaveBeenLastCalledWith('child', { parentId: null }));
  await waitFor(() => expect(screen.getByRole('option', { name: '子夹 / 孙夹 (1)' })).toBeTruthy());
  expect(screen.getByRole('button', { name: '选择收藏夹：子夹' }).getAttribute('aria-pressed')).toBe('true');
  const imageTransfer = directoryDragData();
  fireEvent.dragStart(screen.getByText('子树作品').closest('article')!, { dataTransfer: imageTransfer });
  fireEvent.drop(screen.getByRole('button', { name: '选择收藏夹：子夹' }), { dataTransfer: imageTransfer });
  await waitFor(() => expect(db.bulkUpdateInspirations).toHaveBeenCalledWith([images[0].id], { addBoardIds: ['child'] }));
  expect(db.updateInspirationBoard).toHaveBeenCalledTimes(2);
});

it('收藏夹移动冲突后回读真实目录并保留原选中，可再次拖动重试', async () => {
  vi.mocked(db.getInspirationBoards).mockResolvedValue(nestedBoards());
  vi.mocked(db.updateInspirationBoard).mockRejectedValueOnce(new Error('目录已更改，请重新读取'));
  const notify = vi.fn();
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [], onRefresh: vi.fn(), notify }));
  const source = await screen.findByRole('button', { name: '选择收藏夹：子夹' });
  fireEvent.click(source);
  const move = () => {
    const transfer = directoryDragData(); fireEvent.dragStart(screen.getByRole('button', { name: '选择收藏夹：子夹' }), { dataTransfer: transfer });
    const target = screen.getByRole('button', { name: '选择收藏夹：另一根夹' });
    fireEvent.dragOver(target, { dataTransfer: transfer }); fireEvent.drop(target, { dataTransfer: transfer });
  };
  move();
  await waitFor(() => expect(notify).toHaveBeenCalledWith('目录已更改，请重新读取', 'error'));
  expect(db.getInspirationBoards).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('option', { name: '根夹 / 子夹 / 孙夹' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择收藏夹：子夹' }).getAttribute('aria-pressed')).toBe('true');
  move(); await waitFor(() => expect(db.updateInspirationBoard).toHaveBeenCalledTimes(2));
  expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
});

it.each([390, 1280])('宽度 %s：共用目录树父夹含任意深度后代，交叉归属只计一次，拖入只添加直接目标', async width => {
  vi.stubGlobal('innerWidth', width);
  vi.mocked(db.getInspirationBoards).mockResolvedValue(nestedBoards());
  const data = [
    { ...mockInspirations[0], id: 'nested-shared', title: '跨层作品', boardIds: ['root', 'grand', 'sibling'] },
    { ...mockInspirations[1], id: 'nested-child', title: '子夹作品', boardIds: ['child'] },
    { ...mockInspirations[2], id: 'nested-other', title: '其他作品', boardIds: ['other'] },
  ];
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: data, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  await screen.findByRole('button', { name: '选择收藏夹：根夹' });
  if (width < 768) {
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    const filter = screen.getByRole('dialog', { name: '筛选收藏' });
    const select = within(filter).getByRole('combobox', { name: '选择目录' });
    expect(within(select).getByRole('option', { name: '根夹 / 子夹 / 孙夹 (1)' })).toBeTruthy();
    fireEvent.change(select, { target: { value: 'root' } }); fireEvent.click(within(filter).getByRole('button', { name: '确认' }));
  } else fireEvent.click(screen.getByRole('button', { name: '选择收藏夹：根夹' }));
  expect(screen.getByText('跨层作品')).toBeTruthy(); expect(screen.getByText('子夹作品')).toBeTruthy(); expect(screen.queryByText('其他作品')).toBeNull();
  expect(screen.getByRole('button', { name: '选择收藏夹：根夹' }).textContent).toContain('2');
  const card = screen.getByText('子夹作品').closest('article')!;
  const transfer = dragData(); fireEvent.dragStart(card, { dataTransfer: transfer });
  fireEvent.drop(screen.getByRole('button', { name: '选择收藏夹：根夹' }), { dataTransfer: transfer });
  await waitFor(() => expect(db.bulkUpdateInspirations).toHaveBeenCalledWith(['nested-child'], { addBoardIds: ['root'] }));
});

it('新建默认当前夹并可选择任意上级；编辑排除自身后代，冲突回读目录且保留输入', async () => {
  vi.mocked(db.getInspirationBoards).mockResolvedValue(nestedBoards());
  const notify = vi.fn();
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify }));
  fireEvent.click(await screen.findByRole('button', { name: '选择收藏夹：子夹' }));
  fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }));
  const create = screen.getByRole('dialog', { name: '新建收藏夹' });
  const parent = within(create).getByRole('combobox', { name: '上级收藏夹' }) as HTMLSelectElement;
  expect(parent.value).toBe('child'); expect(within(parent).getByRole('option', { name: '根夹 / 子夹 / 孙夹' })).toBeTruthy();
  fireEvent.change(within(create).getByRole('textbox'), { target: { value: '新子夹' } });
  fireEvent.change(parent, { target: { value: 'grand' } }); fireEvent.click(within(create).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(db.createInspirationBoard).toHaveBeenCalledWith(expect.objectContaining({ name: '新子夹', parentId: 'grand' })));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建收藏夹' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '选择收藏夹：根夹' })); fireEvent.click(screen.getByRole('button', { name: '编辑收藏夹' }));
  const editor = screen.getByRole('dialog', { name: '编辑收藏夹' });
  const options = within(editor).getByRole('combobox', { name: '上级收藏夹' }) as HTMLSelectElement;
  expect(Array.from(options.options, option => option.value)).toEqual(['', 'other']);
  fireEvent.change(options, { target: { value: 'other' } });
  vi.mocked(db.updateInspirationBoard).mockRejectedValueOnce(new Error('目录已更改，请重新读取'));
  const loads = vi.mocked(db.getInspirationBoards).mock.calls.length;
  fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('目录已更改，请重新读取', 'error'));
  expect(db.getInspirationBoards).toHaveBeenCalledTimes(loads + 1); expect(options.value).toBe('other');
  expect(db.updateInspirationBoard).toHaveBeenLastCalledWith('root', expect.objectContaining({ parentId: 'other' }));
});

it('目录排序只调整同父级，不改父归属或其它层级顺序', async () => {
  vi.mocked(db.getInspirationBoards).mockResolvedValue(nestedBoards());
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [], onRefresh: vi.fn(), notify: vi.fn() }));
  const handle = await screen.findByRole('button', { name: '排序收藏夹：子夹' });
  fireEvent.keyDown(handle, { key: 'ArrowDown' });
  await waitFor(() => expect(handle.getAttribute('aria-disabled')).toBe('false'));
  expect(db.updateInspirationBoard).toHaveBeenCalled();
  expect(vi.mocked(db.updateInspirationBoard).mock.calls.every(([id]) => ['child', 'sibling'].includes(id))).toBe(true);
  expect(vi.mocked(db.updateInspirationBoard).mock.calls.every(([, updates]) => Object.keys(updates).join() === 'sortOrder')).toBe(true);
});

it('全部收藏仍在列表中，打开、切换和关闭详情只重渲染发生选择变化的封面', async () => {
  const data = Array.from({ length: 120 }, (_, index) => ({ id: `perf-${index}`, userId: mockUser.id, title: `性能作品 ${index}`, imageUrl: `/synthetic-${index}.png`, prompt: '', createdAt: 200 - index } as Inspiration));
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: data, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  await waitFor(() => expect(db.getInspirationBoards).toHaveBeenCalledOnce());
  const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-gallery-work-id]'));
  // 首屏只渲染一批，加载更多后全部收藏仍在列表中。
  expect(cards).toHaveLength(60);
  fireEvent.click(screen.getByRole('button', { name: '加载更多（60）' }));
  const allCards = Array.from(container.querySelectorAll<HTMLElement>('[data-gallery-work-id]'));
  expect(allCards).toHaveLength(120);
  cards.splice(0, cards.length, ...allCards);
  imageRender.mockClear();
  fireEvent.click(cards[0].querySelector('button.gallery-card-caption')!);
  expect(imageRender.mock.calls.map(([title]) => title)).toEqual([cards[0].querySelector('h3')!.textContent]);
  imageRender.mockClear();
  fireEvent.click(cards[1].querySelector('button.gallery-card-caption')!);
  expect(new Set(imageRender.mock.calls.map(([title]) => title))).toEqual(new Set(cards.slice(0, 2).map(card => card.querySelector('h3')!.textContent)));
  imageRender.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(imageRender.mock.calls.map(([title]) => title)).toEqual([cards[1].querySelector('h3')!.textContent]);
  expect(Array.from(container.querySelectorAll('[data-gallery-work-id]'))).toEqual(cards);
  expect(db.updateInspiration).not.toHaveBeenCalled();
});

it.each([390, 1280])('宽度 %s：同一收藏命中多个夹，批量部分选中只增删触及关系，未整理仅无归属', async width => {
  vi.stubGlobal('innerWidth', width);
  const folders = ['one', 'two'].map((id, sortOrder) => ({ id, name: id, sortOrder, userId: mockUser.id, createdAt: 1, updatedAt: 1 }));
  vi.mocked(db.getInspirationBoards).mockResolvedValue(folders);
  let data: Inspiration[] = [
    { id: 'both', userId: mockUser.id, title: '多夹作品', imageUrl: '/both.png', prompt: '', boardIds: ['one', 'two'], createdAt: 3 },
    { id: 'second', userId: mockUser.id, title: '另一作品', imageUrl: '/second.png', prompt: '', boardIds: ['two'], createdAt: 2 },
    { id: 'none', userId: mockUser.id, title: '未归属作品', imageUrl: '/none.png', prompt: '', boardIds: [], createdAt: 1 },
  ];
  vi.mocked(db.bulkUpdateInspirations).mockImplementation(async (ids, updates) => { data = data.map(item => ids.includes(item.id) ? applyCollectionBoardUpdates(item, updates) : item); });
  const props = { currentUser: mockUser, inspirationsData: data, onRefresh: vi.fn(async () => view.rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: data }))), notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, props));
  await waitFor(() => expect(db.getInspirationBoards).toHaveBeenCalledOnce());
  if (width >= 768) {
    fireEvent.click(screen.getByRole('button', { name: '选择收藏夹：one' }));
    expect(screen.getByText('多夹作品')).toBeTruthy(); expect(screen.queryByText('另一作品')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '选择收藏夹：two' }));
    expect(screen.getByText('多夹作品')).toBeTruthy(); expect(screen.getByText('另一作品')).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择收藏夹：two' }).textContent).toContain('2');
    fireEvent.click(screen.getByRole('button', { name: /全部\s+3/ }));
  }
  // 手机分类收在筛选层，归属管理则直接在同一批量工具位置打开。
  fireEvent.click(screen.getByRole('button', { name: '批量选择图片' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  fireEvent.click(screen.getByRole('button', { name: '管理收藏夹' }));
  expect((screen.getByRole('checkbox', { name: /one/ }) as HTMLInputElement).indeterminate).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: /one/ }));
  await waitFor(() => expect(db.bulkUpdateInspirations).toHaveBeenLastCalledWith(['second', 'none'], { addBoardIds: ['one'] }));
  await waitFor(() => expect((screen.getByRole('checkbox', { name: 'one' }) as HTMLInputElement).checked).toBe(true));
  expect(getCollectionBoardIds(data[0])).toEqual(['one', 'two']); expect(getCollectionBoardIds(data[1])).toEqual(['two', 'one']);
  fireEvent.click(screen.getByRole('checkbox', { name: 'one' }));
  await waitFor(() => expect(db.bulkUpdateInspirations).toHaveBeenLastCalledWith(['both', 'second', 'none'], { removeBoardIds: ['one'] }));
  await waitFor(() => expect(props.onRefresh).toHaveBeenCalledTimes(2));
  expect(getCollectionBoardIds(data[0])).toEqual(['two']); expect(getCollectionBoardIds(data[1])).toEqual(['two']); expect(getCollectionBoardIds(data[2])).toEqual([]);
  fireEvent.click(within(screen.getByRole('dialog', { name: '管理收藏夹' })).getByRole('button', { name: '完成' }));
  fireEvent.click(screen.getByRole('button', { name: '退出多选' }));
  if (width < 768) fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click((width < 768 ? within(screen.getByRole('dialog', { name: '筛选收藏' })) : screen).getByRole('button', { name: /未整理\s+1/ }));
  if (width < 768) fireEvent.click(screen.getByRole('button', { name: '确认' }));
  expect(screen.getByText('未归属作品')).toBeTruthy(); expect(screen.queryByText('多夹作品')).toBeNull();
  vi.mocked(db.bulkUpdateInspirations).mockReset().mockResolvedValue(undefined);
});

it('缺图画师偏好在收藏库保留空封面与 Tag，可进入详情且没有失效图片操作', async () => {
  const item: Inspiration = { id: 'empty-artist', userId: mockUser.id, title: 'synthetic artist', imageUrl: '', prompt: 'artist:synthetic artist', sourceType: 'artist', sourceId: 'synthetic artist', createdAt: 1 };
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [item], onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  fireEvent.click(screen.getByText('暂无样张'));
  expect(screen.getAllByText('暂无样张').length).toBeGreaterThan(0);
  expect(screen.getByText('artist:synthetic artist')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '复制图片' })).toBeNull();
});

it.each(['v45', 'v5'])('%s图包收藏列表与详情预览裁边按实际比例展示，原图查看与复制仍取原件', async pack => {
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: 'masonry', columns: 1, desktopColumns: 1 }));
  const sample = { pack, tag: 'synthetic artist', revision: 'a'.repeat(24), index: 0 };
  const item: Inspiration = { id: 'pack-favorite', userId: mockUser.id, title: '图包收藏', imageUrl: '/api/inspirations/pack-favorite/image', prompt: '', sourceType: 'artist', sourceId: 'synthetic artist', analysis: { artistSample: sample }, createdAt: 1 };
  const own: Inspiration = { ...item, id: 'own-favorite', title: '自建收藏', imageUrl: '/api/assets/own.jpg', analysis: { artistSample: { ...sample, ownSampleId: 'own' } } };
  const legacy: Inspiration = { ...item, id: 'legacy-favorite', title: '旧画师收藏', imageUrl: '/api/assets/old.jpg', analysis: {} };
  const other: Inspiration = { ...item, id: 'other-favorite', title: '其他来源收藏', sourceType: 'upload', analysis: { artistSample: sample } };
  const onRefresh = vi.fn(async () => {});
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [item, own, legacy, other], onRefresh, notify: vi.fn() }));
  const image = screen.getByRole('img', { name: item.title });
  expect(image.getAttribute('data-preview-transform')).toBe('artist-sample-padding-v2');
  for (const title of [own.title, legacy.title, other.title]) expect(screen.getByRole('img', { name: title }).getAttribute('data-preview-transform')).toBeNull();
  Object.defineProperties(image, { naturalWidth: { value: 254 }, naturalHeight: { value: 320 } });
  fireEvent.load(image);
  await waitFor(() => expect(Number((image.closest('.mobile-gallery-frame') as HTMLElement).style.getPropertyValue('--mobile-image-ratio'))).toBeCloseTo(254 / 320));
  const card = image.closest('article')!;
  fireEvent.click(within(card).getByRole('button', { name: '复制图片' }));
  await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith(item.imageUrl, false));
  fireEvent.click(image.closest('button')!);
  const detail = container.querySelector<HTMLElement>('[data-agent-page-scope="detail"]')!;
  expect(within(detail).getByRole('img', { name: item.title }).getAttribute('src')).toBe(buildMediaUrl(item.imageUrl, 'thumb-960', 'artist-sample-padding-v2'));
  fireEvent.click(within(detail).getByRole('button', { name: '复制图片' }));
  await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith(item.imageUrl, false));
  fireEvent.click(within(detail).getByRole('button', { name: '放大查看：' + item.title }));
  const lightbox = screen.getByRole('dialog', { name: '图片预览' });
  expect(within(lightbox).getByRole('img').getAttribute('src')).toBe(item.imageUrl);
  expect(db.updateInspiration).not.toHaveBeenCalled();
  expect(onRefresh).not.toHaveBeenCalled();
});

it('收藏首次失败显示错误与重试，刷新失败保留旧作品且不显示加入第一条', async () => {
  const refresh = vi.fn(async () => {}), props = { currentUser: mockUser, onRefresh: refresh, notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, { ...props, inspirationsData: null, loadError: '合成收藏读取失败' }));
  expect(within(screen.getByRole('main')).getByRole('alert').textContent).toContain('合成收藏读取失败'); expect(within(screen.getByRole('main')).queryByRole('status')).toBeNull(); expect(screen.queryByText('这里还没有匹配的收藏')).toBeNull();
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: '重试' })); expect(refresh).toHaveBeenCalledOnce();
  view.rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: mockInspirations, loadError: '合成收藏刷新失败' }));
  expect(view.container.querySelectorAll('article')).toHaveLength(mockInspirations.length); expect(screen.queryByRole('button', { name: '加入第一条收藏' })).toBeNull();
  view.rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: [] })); expect(screen.getByText('这里还没有匹配的收藏')).toBeTruthy();
});

it('画廊手动收录入口透传收藏夹读取状态与重试，不把未读取目录当作空目录', async () => {
  let fail!: (error: Error) => void;
  vi.mocked(db.getInspirationBoards).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [], onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '加入收藏库' })).getByRole('button', { name: '收藏夹' }));
  const picker = within(screen.getByRole('dialog', { name: '收藏夹' }));
  expect(picker.getByRole('status').textContent).toBe('正在读取…'); expect(picker.queryByText('暂无收藏夹')).toBeNull();
  await act(async () => fail(new Error('合成收藏夹读取失败')));
  expect(picker.getByRole('alert').textContent).toContain('合成收藏夹读取失败'); expect(picker.queryByText('暂无收藏夹')).toBeNull();
  fireEvent.click(picker.getByRole('button', { name: '重试' }));
  expect(await picker.findByRole('checkbox', { name: '角色设计' })).toBeTruthy();
});

it('标签目录尚未读取与读取失败时筛选不显示无匹配，重试成功空目录才显示', async () => {
  let fail!: (error: Error) => void; vi.mocked(db.getCollectionTagNames).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [], onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); const panel = screen.getByRole('dialog', { name: '筛选收藏' });
  expect(within(panel).getByRole('status').textContent).toContain('正在读取…'); expect(within(panel).queryByText('没有匹配的标签')).toBeNull();
  await act(async () => fail(new Error('合成标签读取失败')));
  expect(within(panel).getByRole('alert').textContent).toContain('合成标签读取失败'); expect(within(panel).queryByText('没有匹配的标签')).toBeNull();
  fireEvent.click(within(panel).getByRole('button', { name: '重新加载标签' })); expect(await within(panel).findByText('没有匹配的标签')).toBeTruthy();
});

it.each([390, 1280])('宽度 %s：收藏未读取时显示加载中，读取完成后才显示空状态或作品', width => {
  vi.stubGlobal('innerWidth', width);
  const props = { currentUser: mockUser, onRefresh: vi.fn(), notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, { ...props, inspirationsData: null }));
  expect(within(screen.getByRole('main')).getByRole('status').textContent).toContain('加载中…');
  expect(screen.queryByText('这里还没有匹配的收藏')).toBeNull();
  expect(screen.queryByRole('button', { name: '加入第一条收藏' })).toBeNull();
  view.rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: [] }));
  expect(view.container.querySelector('[data-toolbar-count-caption]')?.textContent).toContain('共 0 组');
  expect(screen.getByText('这里还没有匹配的收藏')).toBeTruthy();
  expect(screen.getByRole('button', { name: '加入第一条收藏' })).toBeTruthy();
  view.rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: mockInspirations }));
  expect(view.container.querySelector('[data-toolbar-count-caption]')?.textContent).toContain(`共 ${mockInspirations.length} 组`);
  expect(screen.queryByRole('button', { name: '加入第一条收藏' })).toBeNull();
  expect(view.container.querySelectorAll('article')).toHaveLength(mockInspirations.length);
});

it.each([390, 1280])('宽度 %s：一次显示超过 100 条独立收藏，末项仍可搜索', async width => {
  vi.stubGlobal('innerWidth', width);
  const data: Inspiration[] = Array.from({ length: 105 }, (_, index) => ({
    id: `large-${index}`, userId: mockUser.id, title: index === 104 ? '最后一条专属收藏' : `收藏 ${index}`,
    imageUrl: `/large-${index}.png`, prompt: '', createdAt: index,
  }));
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: data, onRefresh: vi.fn(), notify: vi.fn() }));
  // 首屏只渲染一批；加载更多可继续展示，搜索仍能命中未渲染的末项。
  expect(container.querySelectorAll('article')).toHaveLength(60);
  fireEvent.click(screen.getByRole('button', { name: '加载更多（45）' }));
  expect(container.querySelectorAll('article')).toHaveLength(105);
  const search = screen.getByRole('searchbox', { name: '搜索标题、提示词或标签…' });
  fireEvent.change(search, { target: { value: '最后一条专属收藏' } });
  await waitFor(() => expect(container.querySelectorAll('article')).toHaveLength(1));
  expect(screen.getByText('最后一条专属收藏')).toBeTruthy();
});

it.each([390, 1280])('宽度 %s：接近底部自动连续展开超过三批收藏，真实末尾停止且末项可选择', async width => {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('IntersectionObserver', class {
    private targets = new Set<Element>();
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.targets.add(target);
      queueMicrotask(() => { if (this.targets.has(target)) this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); });
    }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  });
  const data: Inspiration[] = Array.from({ length: 185 }, (_, index) => ({ id: `continuous-${index}`, userId: mockUser.id, title: `连续收藏 ${index}`, imageUrl: `/continuous-${index}.png`, prompt: '', createdAt: index }));
  const view = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: data, onRefresh: vi.fn(), notify: vi.fn() }));
  await waitFor(() => expect(view.container.querySelectorAll('article')).toHaveLength(185));
  expect(screen.queryByRole('button', { name: /^加载更多/ })).toBeNull();
  fireEvent.click(screen.getByRole('img', { name: '连续收藏 184' }));
  expect(view.container.querySelector('[data-agent-page-scope="detail"]')).toBeTruthy();
  expect(db.getAllInspirations).not.toHaveBeenCalled();
});

it('收藏夹数量排除归档条目，并随数据更新', async () => {
  const data: Inspiration[] = [
    { id: 'count-live-1', userId: mockUser.id, title: '活动收藏', imageUrl: '/live.png', prompt: '', boardId: 'board-1', createdAt: 2 },
    { id: 'count-archived', userId: mockUser.id, title: '归档收藏', imageUrl: '/archived.png', prompt: '', boardId: 'board-1', createdAt: 1, archived: true },
  ];
  const props = { currentUser: mockUser, inspirationsData: data, onRefresh: vi.fn(), notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, props));
  const folder = await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  expect(folder.textContent).toMatch(/角色设计\s*1/);
  view.rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: [...data, { ...data[0], id: 'count-live-2', title: '第二条活动收藏' }] }));
  expect(folder.textContent).toMatch(/角色设计\s*2/);
});

it('作品组重复页键时保留卡片首图与详情各自的原有顺序', () => {
  const base: Inspiration = {
    id: 'same-page-key-old', userId: mockUser.id, title: '同组作品 · 1', imageUrl: '/old-page.png', prompt: '',
    sourceType: 'pixiv', sourceId: 'same-work', createdAt: 1, analysis: { collectionImageId: 'same-page' },
  };
  const newer = { ...base, id: 'same-page-key-new', title: '同组作品 · 2', imageUrl: '/new-page.png', createdAt: 2 };
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [base, newer], onRefresh: vi.fn(), notify: vi.fn() }));
  const card = screen.getByText('同组作品').closest('article')!;
  expect(within(card).getByRole('img').getAttribute('src')).toBe('/new-page.png');
  fireEvent.click(within(card).getByRole('img').closest('button')!);
  expect(within(screen.getByRole('complementary', { name: '同组作品' })).getAllByRole('img').map(image => image.getAttribute('src'))).toEqual(['/old-page.png', '/new-page.png']);
});

it.each(['masonry', 'portrait', 'square'])('%s 布局按作品组排序，保持首图页码与组展开，记住排序且不改资料', async layout => {
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout, columns: 1, desktopColumns: 1 }));
  const make = (id: string, title: string, createdAt: number): Inspiration => ({ id, userId: mockUser.id, title, createdAt, prompt: '', imageUrl: '/' + id });
  const data = [make('single', '作品10', 20), { ...make('p0', '作品2 · 1', 1), sourceType: 'pixiv' as const, sourceId: 'group', analysis: { externalSourcePage: 0 } }, { ...make('p1', '作品2 · 2', 30), sourceType: 'pixiv' as const, sourceId: 'group', analysis: { externalSourcePage: 1 } }, make('old', '作品1', 10)];
  const props = { currentUser: mockUser, inspirationsData: data, onRefresh: vi.fn(async () => {}), notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, props));
  const order = () => [...view.container.querySelectorAll('article h3')].map(element => element.textContent);
  expect(order()).toEqual(['作品2', '作品10', '作品1']);
  const sorter = screen.getByRole('combobox', { name: '收藏排序' });
  expect(sorter.parentElement!.className).toContain('hidden md:inline-flex');
  expect(sorter.className).toContain('w-auto!');
  fireEvent.change(sorter, { target: { value: 'oldest' } }); expect(order()).toEqual(['作品1', '作品10', '作品2']);
  fireEvent.change(sorter, { target: { value: 'name' } }); expect(order()).toEqual(['作品1', '作品2', '作品10']);
  const card = within(view.container).getByText('作品2').closest('article')!;
  expect(within(card).getByRole('img').getAttribute('src')).toBe('/p0');
  fireEvent.click(within(card).getByRole('img').closest('button')!);
  const detail = screen.getByRole('complementary', { name: '作品2' });
  expect(within(detail).getAllByRole('img').map(image => image.getAttribute('src'))).toEqual(['/p0', '/p1']);
  fireEvent.click(within(detail).getByRole('button', { name: '关闭' }));
  fireEvent.change(sorter, { target: { value: 'nameDesc' } }); expect(order()).toEqual(['作品10', '作品2', '作品1']);
  enterCollectionSelection(); expect(screen.queryByRole('combobox', { name: '收藏排序' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '退出多选' }));
  expect((screen.getByRole('combobox', { name: '收藏排序' }) as HTMLSelectElement).value).toBe('nameDesc');
  view.unmount(); render(React.createElement(InspirationGallery, props));
  expect((screen.getByRole('combobox', { name: '收藏排序' }) as HTMLSelectElement).value).toBe('nameDesc');
  expect(db.updateInspiration).not.toHaveBeenCalled(); expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
});

it('手机排序收在现有筛选面板，重置筛选与跨分类不重置排序，坏偏好回退默认', async () => {
  vi.stubGlobal('innerWidth', 390); localStorage.setItem('nai-collection-sort', 'constructor');
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  expect((screen.getByRole('combobox', { name: '收藏排序' }) as HTMLSelectElement).value).toBe('newest');
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const panel = screen.getByRole('dialog', { name: '筛选收藏' });
  fireEvent.change(within(panel).getByRole('combobox', { name: '收藏排序' }), { target: { value: 'oldest' } });
  fireEvent.click(within(panel).getByRole('button', { name: '重置筛选' }));
  expect((within(panel).getByRole('combobox', { name: '收藏排序' }) as HTMLSelectElement).value).toBe('oldest');
  fireEvent.click(within(panel).getByRole('button', { name: /^生成历史/ }));
  expect((within(panel).getByRole('combobox', { name: '收藏排序' }) as HTMLSelectElement).value).toBe('oldest');
  expect(localStorage.getItem('nai-collection-sort')).toBe('oldest');
});

it('新建的 0 页标签立即进入详情、批量添加及手动收录选择器，重开仍保留，加载失败不覆盖目录', async () => {
  let catalog: string[] = [];
  vi.mocked(db.getCollectionTagNames).mockImplementation(async () => catalog);
  vi.mocked(db.saveCollectionTagNames).mockImplementation(async tags => { catalog = [...tags]; return catalog; });
  const notify = vi.fn();
  const props = { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify };
  const view = render(React.createElement(InspirationGallery, props));
  openCollectionTagManager();
  const manager = screen.getByRole('dialog', { name: '管理标签' });
  await waitFor(() => expect((within(manager).getByRole('textbox', { name: '新标签名称' }) as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(within(manager).getByRole('textbox', { name: '新标签名称' }), { target: { value: '构图分类' } });
  fireEvent.click(within(manager).getByRole('button', { name: '添加标签' }));
  await within(manager).findByText('#构图分类');
  expect(db.bulkUpdateInspirations).not.toHaveBeenCalled(); expect(db.updateInspiration).not.toHaveBeenCalled();
  fireEvent.click(within(manager).getByRole('button', { name: '关闭' }));
  fireEvent.click(within(view.container).getByText(mockInspirations[0].title).closest('article')!.querySelector('img')!.closest('button')!);
  const detail = document.querySelector<HTMLElement>('[data-agent-page-scope="detail"]')!;
  fireEvent.click(within(detail).getByRole('button', { name: '添加标签' }));
  fireEvent.click(within(detail).getByRole('button', { name: '选择已有标签' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '选择已有标签' })).getByRole('button', { name: '#构图分类' }));
  await waitFor(() => expect(db.updateInspiration).toHaveBeenCalledWith(mockInspirations[0].id, { tags: [...mockInspirations[0].tags!.filter(tag => tag !== '生成历史'), '构图分类'] }));
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  enterCollectionSelection();
  fireEvent.click(within(view.container).getAllByRole('button', { name: '选择收藏' })[0]);
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '选择已有标签' })).getByRole('button', { name: '#构图分类' }));
  expect((screen.getByRole('textbox', { name: '添加标签' }) as HTMLInputElement).value).toBe('构图分类');
  fireEvent.click(screen.getByRole('button', { name: '退出多选' }));
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  const upload = screen.getByRole('dialog', { name: '加入收藏库' });
  fireEvent.click(within(upload).getByRole('button', { name: '选择已有标签' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '选择已有标签' })).getByRole('button', { name: '#构图分类' }));
  expect((within(upload).getByPlaceholderText('构图, 光影') as HTMLInputElement).value).toBe('构图分类');
  view.unmount(); render(React.createElement(InspirationGallery, props));
  openCollectionTagManager();
  await screen.findByText('#构图分类');
  cleanup(); vi.mocked(db.getCollectionTagNames).mockRejectedValueOnce(new Error('合成加载失败'));
  render(React.createElement(InspirationGallery, props));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成加载失败', 'error'));
  openCollectionTagManager();
  expect((screen.getByRole('button', { name: '添加标签' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载标签' }));
  await screen.findByText('#构图分类'); expect(db.saveCollectionTagNames).toHaveBeenCalledOnce();
});
const enterCollectionSelection = () => {
  fireEvent.click(screen.getByRole('button', { name: '批量选择图片' }));
};
const openCollectionTagManager = () => {
  fireEvent.click(screen.getByRole('button', { name: /^筛选(?: \d+)?$/ }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '筛选收藏' })).getByRole('button', { name: '管理标签' }));
};
const selectCollectionCard = (card: HTMLElement) => {
  if (screen.queryByRole('button', { name: '批量选择图片' })) enterCollectionSelection();
  fireEvent.click(within(card).getByRole('button', { name: '选择收藏' }));
};

it('收藏卡片右上复制图片不选择或打开详情，详情图片保持同位置且底部不重复分享', async () => {
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  const card = within(container).getByText(mockInspirations[0].title).closest('article')!;
  const copy = within(card).getByRole('button', { name: '复制图片' });
  expect(copy.closest('.image-card-actions')!.className).toContain('absolute right-2 top-2');
  expect(within(card).getByRole('button', { name: '删除收藏' }).classList.contains('left-2')).toBe(true);
  expect(within(card).queryByRole('button', { name: '选择收藏' })).toBeNull();
  fireEvent.click(copy);
  await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith(mockInspirations[0].imageUrl, false));
  expect(document.querySelector('[data-agent-page-scope="detail"]')).toBeNull();
  expect(within(card).queryByRole('button', { name: '选择收藏' })).toBeNull();
  fireEvent.click(within(card).getByRole('img').closest('button')!);
  const detail = document.querySelector<HTMLElement>('[data-agent-page-scope="detail"]')!;
  const detailCopy = within(detail).getByRole('button', { name: '复制图片' });
  expect(detailCopy.closest('section')!.classList.contains('press-reveal-surface')).toBe(true);
  expect(detailCopy.closest('.image-card-actions')!.className).toContain('absolute right-2 top-2');
  expect(detailCopy.closest('footer')).toBeNull();
  expect(detail.querySelector('footer')!.querySelector('[data-card-action]')).toBeNull();
});

const mockInspirations: Inspiration[] = [
  {
    id: 'insp-1',
    userId: 'user-1',
    title: '已整理角色图',
    imageUrl: 'data:image/png;base64,1',
    prompt: 'girl',
    boardId: 'board-1',
    sourceType: 'history',
    tags: ['生成历史', '原创'],
    createdAt: 1000,
  },
  {
    id: 'insp-2',
    userId: 'user-1',
    title: '未整理带有标签的图',
    imageUrl: 'data:image/png;base64,2',
    prompt: 'danbooru art',
    boardId: undefined, // 未分类/未整理
    sourceType: 'danbooru',
    tags: ['Danbooru', '1girl'],
    notes: '自动收录',
    createdAt: 2000,
  },
  {
    id: 'insp-3',
    userId: 'user-1',
    title: 'Pixiv 收藏图',
    imageUrl: 'data:image/png;base64,3',
    prompt: 'pixiv illustration',
    boardId: undefined, // 未整理
    sourceType: 'pixiv',
    tags: ['Pixiv', '风景'],
    createdAt: 3000,
  },
];

it('收藏分类默认收起无导航节点，桌面入口记住独立展开偏好并复用公共避让类', async () => {
  localStorage.removeItem('nai-collection-navigation-expanded');
  const props = { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, props));
  const toggle = screen.getByRole('button', { name: '展开收藏分类' });
  const navigation = document.getElementById(toggle.getAttribute('aria-controls')!)!;
  expect(toggle.className).toContain('hidden md:inline-flex');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(navigation.hidden).toBe(true);
  expect(navigation.className).toBe('hidden');
  expect(navigation.querySelector('button,select,input')).toBeNull();
  fireEvent.click(toggle);
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  expect(navigation.hidden).toBe(false);
  expect(navigation.className).toContain('workspace-fixed-pane workspace-category-navigation');
  expect(navigation.className).toContain('hidden w-52');
  expect(navigation.classList.contains('appearance-panel')).toBe(true);
  expect(navigation.classList.contains('md:flex')).toBe(true);
  expect(navigation.classList.contains('md:flex-col')).toBe(true);
  expect(navigation.className).not.toContain('overflow-y-auto');
  expect(within(navigation).getByRole('navigation').className).toContain('md:overflow-y-auto');
  expect(navigation.className).not.toContain('!mt-');
  expect(navigation.className).not.toContain('mb-1.5');
  view.unmount();
  render(React.createElement(InspirationGallery, props));
  expect(screen.getByRole('button', { name: '收起收藏分类' }).getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '收起收藏分类' }));
  expect(localStorage.getItem('nai-collection-navigation-expanded')).toBe('false');
});

it('收起分类保持收藏夹、来源、搜索和已打开作品详情', async () => {
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  fireEvent.click(await screen.findByRole('button', { name: '选择收藏夹：角色设计' }));
  const search = screen.getByRole('searchbox', { name: '搜索标题、提示词或标签…' }) as HTMLInputElement;
  fireEvent.change(search, { target: { value: '角色' } });
  fireEvent.click(screen.getByText('已整理角色图').closest('article')!.querySelector('button.absolute.inset-0')!);
  const detail = screen.getByRole('complementary', { name: '已整理角色图' });
  fireEvent.click(screen.getByRole('button', { name: '收起收藏分类' }));
  expect(search.value).toBe('角色');
  expect(screen.getByRole('button', { name: '展开收藏分类' }).title).toContain('角色设计');
  expect(screen.queryByText('未整理带有标签的图')).toBeNull();
  expect(screen.getByRole('complementary', { name: '已整理角色图' })).toBe(detail);
  fireEvent.click(within(detail).getByRole('button', { name: '关闭' }));
  fireEvent.click(screen.getByRole('button', { name: '展开收藏分类' }));
  expect(screen.getByRole('button', { name: '选择收藏夹：角色设计' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.change(search, { target: { value: '' } });
  fireEvent.click(within(screen.getByRole('complementary', { name: '收藏分类' })).getByRole('button', { name: /Pixiv/ }));
  fireEvent.click(screen.getByRole('button', { name: '收起收藏分类' }));
  expect(screen.getByRole('button', { name: '展开收藏分类' }).title).toContain('Pixiv');
  await screen.findByText('Pixiv 收藏图');
  expect(screen.queryByText('未整理带有标签的图')).toBeNull();
});

it('收展分类保留多选，重新展开仍可拖入收藏夹', async () => {
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  const card = screen.getByText(mockInspirations[1].title).closest('article')!;
  selectCollectionCard(card);
  expect(screen.getByText('已选 1 个作品，共 1 页')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '收起收藏分类' }));
  expect(screen.getByText('已选 1 个作品，共 1 页')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '展开收藏分类' }));
  const folder = screen.getByRole('button', { name: '选择收藏夹：角色设计' }).closest('[data-collection-folder]')!;
  const dataTransfer = dragData();
  fireEvent.dragStart(card, { dataTransfer }); fireEvent.drop(folder, { dataTransfer });
  await waitFor(() => expect(db.bulkUpdateInspirations).toHaveBeenCalledWith(['insp-2'], { addBoardIds: ['board-1'] }));
});

it.each(['masonry', 'portrait', 'square'])('收藏 %s 布局保留真实高度，图片加载与参数更新不重建卡片或换列', layout => {
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout, columns: 2, desktopColumns: 2 }));
  const items = Array.from({ length: 4 }, (_, index) => ({
    ...mockInspirations[0], id: 'stable-' + index, title: '稳定作品 ' + index, createdAt: 10 - index,
    params: { width: 400, height: 400 },
  } as Inspiration));
  const props = { currentUser: mockUser, inspirationsData: items, onRefresh: vi.fn(async () => {}), notify: vi.fn() };
  const { container, rerender } = render(React.createElement(InspirationGallery, props));
  const cards = items.map(item => screen.getByText(item.title).closest('article')!);
  const columns = cards.map(card => card.parentElement);
  cards.forEach(card => expect(within(card).getByRole('img').className).toContain(layout === 'masonry' ? 'object-contain' : 'object-cover'));
  expect(container.querySelectorAll('.chain-masonry-column')).toHaveLength(layout === 'masonry' ? 2 : 0);
  expect(container.querySelector('.mobile-gallery--masonry')).toBeNull();
  cards.forEach(card => expect(card.style.contentVisibility).toBe('visible'));
  fireEvent.load(within(cards[0]).getByRole('img'));
  rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: items.map((item, index) => index === 0 ? { ...item, params: { ...item.params!, height: 1600 } } : item) }));
  items.forEach((item, index) => {
    expect(screen.getByText(item.title).closest('article')).toBe(cards[index]);
    expect(cards[index].parentElement).toBe(columns[index]);
  });
  if (layout === 'masonry') expect(cards[0].parentElement).toBe(cards[2].parentElement);
});

it('收藏瀑布流的无尺寸图片先完整显示，加载后按真实比例更新卡片', async () => {
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: 'masonry', columns: 2 }));
  const pendingFrames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pendingFrames.push(callback); return pendingFrames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const item = { ...mockInspirations[0], id: 'unknown-ratio', title: '未知比例收藏', params: undefined };
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [item], onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  const card = screen.getByText(item.title).closest('article')!;
  const image = within(card).getByRole('img') as HTMLImageElement;
  const frame = card.querySelector<HTMLElement>('.mobile-gallery-frame')!;
  expect(image.className).toContain('object-contain');
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 800 } });
  fireEvent.load(image);
  act(() => pendingFrames.splice(0).forEach(callback => callback(0)));
  expect(frame.style.getPropertyValue('--mobile-image-ratio')).toBe('1.5');
  expect(image.className).toContain('object-cover');
  expect(container.querySelector('.chain-masonry-column')).toBeTruthy();
});

it('列表移除重复标题栏，侧栏与风格串同宽；卡片只保留名称和标签，图片左下不遮挡', () => {
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  expect(container.querySelector('main h1')).toBeNull();
  const sidebar = container.querySelector('aside')!;
  expect(sidebar.classList.contains('w-52')).toBe(true);
  expect(sidebar.classList.contains('hidden')).toBe(true); expect(sidebar.classList.contains('md:flex')).toBe(true); expect(sidebar.classList.contains('md:flex-col')).toBe(true);
  for (const item of mockInspirations) {
    const card = screen.getByText(item.title).closest('article')!;
    expect(within(card).getByText('#' + item.tags![1])).toBeTruthy();
    expect(within(card).queryByText(item.prompt)).toBeNull();
    expect(within(card).queryByText('未整理')).toBeNull();
    expect(card.querySelector('.bottom-2.left-2')).toBeNull();
  }
  expect(screen.queryByText('自动收录')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  expect(within(screen.getByRole('dialog', { name: '加入收藏库' })).queryByText('备注')).toBeNull();
});

it.each([390, 1280])('宽度 %s：旧来源 Tag 不进入卡片、搜索或标签筛选，独立来源分类仍可用', async width => {
  vi.stubGlobal('innerWidth', width);
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  expect(screen.queryByText('#生成历史')).toBeNull();
  expect(screen.queryByText('#Danbooru')).toBeNull();
  expect(screen.queryByText('#Pixiv')).toBeNull();
  expect(screen.getByText('#原创')).toBeTruthy();
  expect(db.updateInspiration).not.toHaveBeenCalled();
  expect(mockInspirations[0].tags).toEqual(['生成历史', '原创']);
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const filter = screen.getByRole('dialog', { name: '筛选收藏' });
  expect(within(filter).queryByRole('button', { name: '#Pixiv' })).toBeNull();
  expect(within(filter).queryByRole('button', { name: '#生成历史' })).toBeNull();
  expect(within(filter).getByRole('button', { name: '#风景' })).toBeTruthy();
  fireEvent.click(within(width < 768 ? filter : document.querySelector('aside')!).getByRole('button', { name: /生成历史\s+1/ }));
  expect(screen.getByText('已整理角色图')).toBeTruthy();
  expect(screen.queryByText('Pixiv 收藏图')).toBeNull();
  fireEvent.click(within(filter).getByRole('button', { name: '确认' }));
  fireEvent.change(screen.getByPlaceholderText('搜索标题、提示词或标签…'), { target: { value: '生成历史' } });
  await waitFor(() => expect(screen.getByText('这里还没有匹配的收藏')).toBeTruthy());
});

it('收藏搜索不再匹配备注；详情采用固定顺序', async () => {
  const props = { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, props));
  const card = screen.getByText(mockInspirations[0].title).closest('article')!;
  fireEvent.click(within(card).getByRole('img').closest('button')!);
  const sections = () => Array.from(view.container.querySelectorAll('[data-collection-section]'), element => element.getAttribute('data-collection-section'));
  expect(sections()).toEqual(['tags', 'prompt', 'negative', 'params']);
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.change(screen.getByPlaceholderText('搜索标题、提示词或标签…'), { target: { value: '自动收录' } });
  await waitFor(() => expect(screen.getByText('这里还没有匹配的收藏')).toBeTruthy());
});

describe('InspirationGallery 来源筛选与未整理心智', () => {
  it('主动切换来源或搜索回到顶部，数据刷新与选择模式变化保留浏览位置', async () => {
    const props = { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() };
    const view = render(React.createElement(InspirationGallery, props));
    const root = view.container.querySelector('main')!;
    Object.defineProperties(root, { clientHeight: { configurable: true, value: 500 }, scrollHeight: { configurable: true, value: 5000 } });
    root.scrollTop = 2100; fireEvent.scroll(root);
    fireEvent.click(screen.getByRole('button', { name: /^Danbooru/ }));
    expect(root.scrollTop).toBe(0);
    root.scrollTop = 1200; fireEvent.scroll(root);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '未整理' } });
    expect(root.scrollTop).toBe(0);
    root.scrollTop = 600; fireEvent.scroll(root);
    view.rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: mockInspirations.map(item => ({ ...item })) }));
    expect(root.scrollTop).toBe(600);
    fireEvent.click(screen.getByRole('button', { name: '批量选择图片' }));
    expect(root.scrollTop).toBe(600);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(root.scrollTop).toBe(600);
  });
  it('未整理分类正确包含未分配收藏夹的卡片（即使有来源标签与备注）', () => {
    render(
      React.createElement(InspirationGallery, {
        currentUser: mockUser,
        inspirationsData: mockInspirations,
        onRefresh: vi.fn(),
        notify: vi.fn(),
      })
    );

    // 侧栏存在“未整理”按钮且计数为 2（insp-2 与 insp-3）
    const unorganizedButtons = screen.getAllByRole('button', { name: /未整理/ });
    expect(unorganizedButtons.length).toBeGreaterThan(0);
    expect(screen.getByText('2', { selector: 'span' })).toBeTruthy();

    // 点击未整理按钮
    fireEvent.click(unorganizedButtons[0]);

    // 页面应展示 insp-2 与 insp-3，不展示已归入 board-1 的 insp-1
    expect(screen.getByText('未整理带有标签的图')).toBeTruthy();
    expect(screen.getByText('Pixiv 收藏图')).toBeTruthy();
    expect(screen.queryByText('已整理角色图')).toBeNull();
  });

  it('侧栏来源导航包含 Danbooru 与 Pixiv 并可按来源精确筛选', () => {
    render(
      React.createElement(InspirationGallery, {
        currentUser: mockUser,
        inspirationsData: mockInspirations,
        onRefresh: vi.fn(),
        notify: vi.fn(),
      })
    );

    // 查找 Danbooru 来源按钮（侧栏带计数的按钮）
    const danbooruButton = screen.getByRole('button', { name: /Danbooru\s+1/ });
    expect(danbooruButton).toBeTruthy();
    fireEvent.click(danbooruButton);

    expect(screen.getByText('未整理带有标签的图')).toBeTruthy();
    expect(screen.queryByText('Pixiv 收藏图')).toBeNull();
    expect(screen.queryByText('已整理角色图')).toBeNull();

    // 查找 Pixiv 来源按钮（侧栏带计数的按钮）
    const pixivButton = screen.getByRole('button', { name: /Pixiv\s+1/ });
    expect(pixivButton).toBeTruthy();
    fireEvent.click(pixivButton);

    expect(screen.getByText('Pixiv 收藏图')).toBeTruthy();
    expect(screen.queryByText('未整理带有标签的图')).toBeNull();
    expect(screen.queryByText('已整理角色图')).toBeNull();
  });

  it('桌面筛选不重复侧栏导航，重置清除条件并保留当前收藏夹与搜索', async () => {
    render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: /Danbooru\s+1/ }));
    fireEvent.change(screen.getByPlaceholderText('搜索标题、提示词或标签…'), { target: { value: '带有标签' } });
    fireEvent.click(screen.getByRole('button', { name: '筛选 1' }));
    const filter = screen.getByRole('dialog', { name: '筛选收藏' });
    expect(within(filter).queryByRole('combobox', { name: '分类' })).toBeNull();
    expect(within(filter).queryByRole('combobox', { name: '收藏夹' })).toBeNull();
    fireEvent.click(within(filter).getByRole('button', { name: '#风景' }));
    expect(screen.queryByText('未整理带有标签的图')).toBeNull();
    expect(screen.getByRole('button', { name: '筛选 2' })).toBeTruthy();
    fireEvent.click(within(filter).getByRole('button', { name: '重置筛选' }));
    expect(screen.getByText('未整理带有标签的图')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Pixiv 收藏图')).toBeNull());
    expect((screen.getByPlaceholderText('搜索标题、提示词或标签…') as HTMLInputElement).value).toBe('带有标签');
  });

  it('手机筛选保留分类入口，并与桌面共用条件', () => {
    vi.stubGlobal('innerWidth', 390);
    render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    const filter = screen.getByRole('dialog', { name: '筛选收藏' });
    fireEvent.click(within(filter).getByRole('button', { name: /未整理\s+2/ }));
    expect(screen.queryByText('已整理角色图')).toBeNull();
    expect(screen.getByText('未整理带有标签的图')).toBeTruthy();
    expect(screen.getByRole('button', { name: '筛选 1' })).toBeTruthy();
    fireEvent.click(within(filter).getByRole('button', { name: '确认' }));
    vi.stubGlobal('innerWidth', 1280); fireEvent(window, new Event('resize'));
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    expect(screen.getByText('未整理带有标签的图')).toBeTruthy();
    expect(screen.queryByText('已整理角色图')).toBeNull();
    expect(within(screen.getByRole('dialog', { name: '筛选收藏' })).queryByRole('combobox', { name: '分类' })).toBeNull();
  });

  it('全选筛选结果只选当前可编辑资料，取消选择恢复浏览', () => {
    render(React.createElement(InspirationGallery, {
      currentUser: mockUser,
      inspirationsData: [...mockInspirations, { ...mockInspirations[0], id: 'other-user', userId: 'user-2', title: '他人的资料' }],
      onRefresh: vi.fn(), notify: vi.fn(),
    }));
    fireEvent.change(screen.getByPlaceholderText('搜索标题、提示词或标签…'), { target: { value: '图' } });
    enterCollectionSelection();
    fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
    expect(screen.getByText('已选 3 个作品，共 3 页')).toBeTruthy();
    expect(within(screen.getByRole('banner')).getByRole('button', { name: '退出多选' }).textContent).toContain('退出多选');
    fireEvent.click(screen.getByRole('button', { name: '退出多选' }));
    expect(screen.queryByText('已选 3 个作品，共 3 页')).toBeNull();
    expect(screen.getByRole('button', { name: '批量选择图片' })).toBeTruthy();
  });

  it('手动收录保留独立滚动正文与固定操作区，Esc 关闭且不写入资料', () => {
    render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
    const dialog = screen.getByRole('dialog', { name: '加入收藏库' });
    expect(dialog.querySelector('header')?.nextElementSibling?.classList.contains('overflow-y-auto')).toBe(true);
    expect(dialog.querySelector('footer')?.classList.contains('flex-none')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '加入收藏库' })).toBeNull();
  });
});

it.each([390, 1280])('宽度 %s 的收藏夹使用标题加号和同色文件夹图标，选中态沿用风格串', async width => {
  vi.stubGlobal('innerWidth', width);
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  if (width < 768) fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const root = width < 768 ? screen.getByRole('dialog', { name: '筛选收藏' }) : screen.getByRole('complementary', { name: '收藏分类' });
  const create = within(root).getByRole('button', { name: '新建收藏夹' });
  expect(create.textContent).toBe('');
  expect(create.querySelector('svg.lucide-plus')).toBeTruthy();
  expect(create.querySelector('svg.lucide-folder-plus')).toBeNull();
  expect(create.getAttribute('data-appearance')).toBe('control');
  const folder = within(root).getByRole('button', { name: '选择收藏夹：角色设计' });
  expect((folder as HTMLElement).style.getPropertyValue('--collection-folder-color')).toBe('#6366f1');
  fireEvent.click(folder);
  const row = folder.closest('.directory-tree-row')!;
  expect(row.classList.contains('bg-indigo-100')).toBe(true);
  expect(row.classList.contains('dark:bg-indigo-950/50')).toBe(true);
  expect(folder.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(create);
  expect(screen.getByRole('dialog', { name: '新建收藏夹' })).toBeTruthy();
  expect(db.updateInspirationBoard).not.toHaveBeenCalled();
});

it('实际新建收藏夹窗口和颜色选择可被 Agent 读取', async () => {
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  fireEvent.click(await screen.findByRole('button', { name: /新建收藏夹/ }));
  const name = screen.getByRole('textbox', { name: '名称' });
  expect(name.getAttribute('placeholder')).toBe('例如：电影感光影'); expect(name.hasAttribute('maxlength')).toBe(false);
  expect(document.activeElement).toBe(name);
  const page = readAgentPage({ limit: 20 }); expect(page.title).toBe('新建收藏夹');
  expect(page.controls.some(item => item.label.includes('名称') || item.role === 'input')).toBe(true);
  expect(page.controls.filter(item => item.pressed !== undefined)).not.toHaveLength(0);
});

it('手机管理当前收藏夹可修改名称与颜色，编辑焦点正确，关闭后回到原筛选面板', async () => {
  vi.stubGlobal('innerWidth', 390);
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); const filter = screen.getByRole('dialog', { name: '筛选收藏' });
  fireEvent.click(within(filter).getByRole('button', { name: '选择收藏夹：角色设计' }));
  fireEvent.click(within(filter).getByRole('button', { name: '编辑收藏夹' }));
  const editor = screen.getByRole('dialog', { name: '编辑收藏夹' }); const input = within(editor).getByRole('textbox');
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: '新名称' } }); fireEvent.click(within(editor).getByRole('button', { name: '颜色 #ec4899' }));
  fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(db.updateInspirationBoard).toHaveBeenCalledWith('board-1', { name: '新名称', color: '#ec4899', parentId: null }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑收藏夹' })).toBeNull());
  expect(screen.getByRole('dialog', { name: '筛选收藏' })).toBe(filter);
});

it('共用收藏夹编辑窗口保存中锁定字段和颜色，Esc、关闭与遮罩不能退出或重复提交', async () => {
  let finish!: () => void;
  vi.mocked(db.updateInspirationBoard).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  fireEvent.click(await screen.findByRole('button', { name: '选择收藏夹：角色设计' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑收藏夹' }));
  const editor = screen.getByRole('dialog', { name: '编辑收藏夹' });
  fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
  expect((within(editor).getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
  expect((within(editor).getByRole('combobox', { name: '上级收藏夹' }) as HTMLSelectElement).disabled).toBe(true);
  expect((within(editor).getByRole('button', { name: '颜色 #ec4899' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(editor).getByRole('button', { name: '保存' })); fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(within(editor).getByRole('button', { name: '关闭' })); fireEvent.mouseDown(editor.parentElement!);
  expect(screen.getByRole('dialog', { name: '编辑收藏夹' })).toBe(editor); expect(db.updateInspirationBoard).toHaveBeenCalledOnce();
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑收藏夹' })).toBeNull());
});

it('手机筛选内的共用收藏夹编辑返回只关闭最上层，不关闭筛选或写入资料', async () => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(max-width: 1279px)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  window.history.replaceState({}, '');
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const filter = screen.getByRole('dialog', { name: '筛选收藏' });
  fireEvent.change(within(filter).getByRole('combobox', { name: '选择目录' }), { target: { value: 'board-1' } });
  await waitFor(() => expect(window.history.state.__naiMobileLayers).toHaveLength(1));
  const parentState = window.history.state;
  fireEvent.click(within(filter).getByRole('button', { name: '编辑收藏夹' }));
  await waitFor(() => expect(window.history.state.__naiMobileLayers).toHaveLength(2));
  act(() => { window.history.replaceState(parentState, ''); window.dispatchEvent(new PopStateEvent('popstate', { state: parentState })); });
  expect(screen.queryByRole('dialog', { name: '编辑收藏夹' })).toBeNull(); expect(screen.getByRole('dialog', { name: '筛选收藏' })).toBe(filter);
  expect(db.updateInspirationBoard).not.toHaveBeenCalled(); window.history.replaceState({}, '');
});
it.each([390, 1280])('宽度 %s 的收藏夹删除可发现且必须确认，取消不删除，确认后回到未整理语义', async width => {
  vi.stubGlobal('innerWidth', width); const refresh = vi.fn();
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: refresh, notify: vi.fn() }));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  let root: HTMLElement = document.body;
  if (width < 768) {
    fireEvent.click(screen.getByRole('button', { name: '筛选' })); root = screen.getByRole('dialog', { name: '筛选收藏' });
    fireEvent.click(within(root).getByRole('button', { name: '选择收藏夹：角色设计' }));
  }
  if (width >= 768) fireEvent.click(within(root).getByRole('button', { name: '选择收藏夹：角色设计' }));
  const remove = () => fireEvent.click(within(root).getByRole('button', { name: '删除收藏夹' }));
  confirmAction.mockResolvedValue(false); remove(); await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
  expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ message: '仅移除本收藏夹归属，作品与其他归属保留；没有其他归属的作品会回到“未整理”。子收藏夹将提升到本夹的上级。' }));
  expect(db.deleteInspirationBoard).not.toHaveBeenCalled();
  confirmAction.mockResolvedValue(true); remove(); await waitFor(() => expect(db.deleteInspirationBoard).toHaveBeenCalledExactlyOnceWith('board-1'));
  expect(refresh).toHaveBeenCalledOnce();
  if (width < 768) expect(within(root).getByRole('button', { name: /全部\s+3/ }).getAttribute('aria-pressed')).toBe('true');
});

it('手机长按只显露删除，松手不打开详情；批量选择由多选按钮进入', () => {
  vi.stubGlobal('innerWidth', 390);
  const view = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  const card = view.container.querySelector('.media-card') as HTMLElement;
  const image = card.querySelector('button')!; longPress(image);
  expect(card.getAttribute('data-press-revealed')).toBe('true');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(fireEvent.dragStart(card, { dataTransfer: dragData() })).toBe(false);
  expect(within(card).getByRole('button', { name: '删除收藏' })).toBeTruthy();
  expect(within(card).queryByRole('button', { name: '选择收藏' })).toBeNull();
  expect(screen.queryByText('已选 0 个作品，共 0 页')).toBeNull();
  selectCollectionCard(card);
  expect(screen.getByText('已选 1 个作品，共 1 页')).toBeTruthy();
});

it.each(['moonlight', ''])('手动上传保留全局词「%s」的完整参数与角色，修改文字不丢参数', async initialPrompt => {
  vi.mocked(extractMetadata).mockResolvedValue(JSON.stringify({
    model: 'nai-diffusion-4-5-full', width: 1152, height: 768, steps: 24, scale: 6, seed: 54321,
    sampler: 'k_dpmpp_2m', cfg_rescale: 0.2,
    v4_prompt: { use_coords: true, caption: { base_caption: `${initialPrompt}${NAI_QUALITY_TAGS}`, char_captions: [{ char_caption: 'blue hair', centers: [{ x: 0.3, y: 0.7 }] }] } },
    v4_negative_prompt: { caption: { base_caption: 'bad anatomy', char_captions: [{ char_caption: 'red hair' }] } },
  }));
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [], onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  const dialog = screen.getByRole('dialog', { name: '加入收藏库' });
  const file = new File(['synthetic'], 'reference.png', { type: 'image/png' });
  fireEvent.change(within(dialog).getByLabelText('上传收藏图片'), { target: { files: [file] } });
  await waitFor(() => expect((within(dialog).getByRole('button', { name: '加入收藏库' }) as HTMLButtonElement).disabled).toBe(false));
  expect((within(dialog).getByLabelText('提示词') as HTMLTextAreaElement).value).toBe(initialPrompt);
  fireEvent.click(within(dialog).getByText('生成信息（可选）'));
  const savedPrompt = initialPrompt ? 'moonlight, rain' : '';
  if (initialPrompt) fireEvent.change(within(dialog).getByLabelText('提示词'), { target: { value: savedPrompt } });
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  fireEvent.click(within(dialog).getByRole('button', { name: '收藏夹' })); fireEvent.click(screen.getByRole('checkbox', { name: '角色设计' })); fireEvent.click(within(screen.getByRole('dialog', { name: '收藏夹' })).getByRole('button', { name: '完成' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(db.saveInspiration).toHaveBeenCalledOnce());
  expect(api.uploadFile).toHaveBeenCalledWith(file, 'inspirations');
  expect(db.saveInspiration).toHaveBeenCalledWith(expect.objectContaining({
    boardIds: ['board-1'], prompt: savedPrompt, negativePrompt: 'bad anatomy', imageUrl: '/api/assets/synthetic.png',
    params: expect.objectContaining({ model: 'nai-diffusion-4-5-full', width: 1152, height: 768, steps: 24, scale: 6,
      seed: 54321, sampler: 'k_dpmpp_2m', cfgRescale: 0.2, qualityToggle: true, useCoords: true,
      characters: [expect.objectContaining({ prompt: 'blue hair', negativePrompt: 'red hair', x: 0.3, y: 0.7 })] }),
  }));
});

it('追加无元数据候选后移除旧候选，迟到解析不覆盖当前图，也不伪造默认参数', async () => {
  let resolve!: (value: string | null) => void;
  vi.mocked(extractMetadata).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [], onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  const dialog = screen.getByRole('dialog', { name: '加入收藏库' });
  const input = within(dialog).getByLabelText('上传收藏图片');
  fireEvent.change(input, { target: { files: [new File(['first'], 'first.png', { type: 'image/png' })] } });
  expect((within(dialog).getByRole('button', { name: '正在读取图片…' }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(dialog).getByLabelText('提示词') as HTMLTextAreaElement).matches(':disabled')).toBe(false);
  const current = new File(['current'], 'current.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [current] } });
  fireEvent.click(within(dialog).getByRole('button', { name: '移除候选：first.png' }));
  await waitFor(() => expect((within(dialog).getByRole('button', { name: '加入收藏库' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(dialog).getByText('生成信息（可选）'));
  fireEvent.change(within(dialog).getByLabelText('提示词'), { target: { value: 'manual prompt' } });
  await act(async () => resolve(JSON.stringify({ prompt: 'old prompt', width: 1024, height: 1024, seed: 1 })));
  expect((within(dialog).getByLabelText('提示词') as HTMLTextAreaElement).value).toBe('manual prompt');
  fireEvent.click(within(dialog).getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(db.saveInspiration).toHaveBeenCalledWith(expect.objectContaining({ title: 'current', prompt: 'manual prompt', negativePrompt: '', params: undefined })));
  expect(api.uploadFile).toHaveBeenCalledWith(current, 'inspirations');
});

it('保存失败保留当前候选和解析结果，移除后追加无元数据图不带入旧配置', async () => {
  vi.mocked(extractMetadata).mockResolvedValueOnce(JSON.stringify({ prompt: 'first', width: 1024, height: 1024, seed: 10 }));
  vi.mocked(db.saveInspiration).mockRejectedValueOnce(new Error('合成保存失败'));
  const notify = vi.fn();
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [], onRefresh: vi.fn(async () => {}), notify }));
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  const dialog = screen.getByRole('dialog', { name: '加入收藏库' });
  const input = within(dialog).getByLabelText('上传收藏图片');
  fireEvent.change(input, { target: { files: [new File(['first'], 'first.png', { type: 'image/png' })] } });
  await waitFor(() => expect((within(dialog).getByLabelText('提示词') as HTMLTextAreaElement).value).toBe('first'));
  fireEvent.click(within(dialog).getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成保存失败', 'error'));
  expect(db.saveInspiration).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ seed: 10 }) }));
  expect(screen.getByRole('dialog', { name: '加入收藏库' })).toBe(dialog);
  fireEvent.click(within(dialog).getByRole('button', { name: '移除候选：first.png' }));
  fireEvent.change(input, { target: { files: [new File(['next'], 'next.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect((within(dialog).getByRole('button', { name: '加入收藏库' }) as HTMLButtonElement).disabled).toBe(false));
  expect((within(dialog).getByLabelText('提示词') as HTMLTextAreaElement).value).toBe('');
  fireEvent.click(within(dialog).getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(db.saveInspiration).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'next', params: undefined })));
});

it.each([390, 1280])('宽度 %s 只有全局、来源和自定义收藏夹导航，取消收藏需确认', async width => {
  vi.stubGlobal('innerWidth', width);
  const props = { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, props));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  if (width < 768) fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const root = width < 768 ? screen.getByRole('dialog', { name: '筛选收藏' }) : document.body;
  const sections = ['来源', '自定义收藏夹'].map(text => within(root).getByText(text));
  expect(sections[0].compareDocumentPosition(sections[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(root).queryByRole('button', { name: /已归档|已置顶|最近使用/ })).toBeNull();
  if (width < 768) fireEvent.click(within(root).getByRole('button', { name: '确认' }));
  selectCollectionCard(screen.getByText(mockInspirations[0].title).closest('article')!);
  fireEvent.click(screen.getByRole('button', { name: '取消收藏' }));
  await waitFor(() => expect(db.bulkDeleteInspirations).toHaveBeenCalledWith(['insp-1']));
  expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('原图与已有分类信息会保留') }));
  view.rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: mockInspirations.map(item => ({ ...item, archived: item.id === 'insp-1' })) }));
  expect(screen.queryByText(mockInspirations[0].title)).toBeNull();
});

it('取消收藏失败保留条目和选择，显示错误供重试', async () => {
  vi.mocked(db.bulkDeleteInspirations).mockRejectedValueOnce(new Error('合成取消失败'));
  const notify = vi.fn(), refresh = vi.fn(async () => {});
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: refresh, notify }));
  selectCollectionCard(screen.getByText(mockInspirations[0].title).closest('article')!);
  fireEvent.click(screen.getByRole('button', { name: '取消收藏' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成取消失败', 'error'));
  expect(screen.getByText(mockInspirations[0].title)).toBeTruthy(); expect(screen.getByText('已选 1 个作品，共 1 页')).toBeTruthy();
  expect(refresh).not.toHaveBeenCalled();
});

it.each([390, 1280])('宽度 %s 来源和收藏夹直接切换，多个标签仍取交集', async width => {
  vi.stubGlobal('innerWidth', width);
  const items = [
    { ...mockInspirations[0], id: 'match', title: '匹配', sourceType: 'pixiv' as const, tags: ['逆光', '雨天', '冷门标签'] },
    { ...mockInspirations[0], id: 'partial', title: '缺少雨天', sourceType: 'pixiv' as const, tags: ['逆光'] },
    { ...mockInspirations[0], id: 'source', title: '其他来源', sourceType: 'history' as const, tags: ['逆光', '雨天'] },
    { ...mockInspirations[1], id: 'folder', title: '其他收藏夹', sourceType: 'pixiv' as const, tags: ['逆光', '雨天'] },
    { ...mockInspirations[2], id: 'all-tags', title: '合成标签', tags: Array.from({ length: 90 }, (_, index) => 'tag-'+index) },
  ];
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: items, onRefresh: vi.fn(), notify: vi.fn() }));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  if (width < 768) fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const root = width < 768 ? screen.getByRole('dialog', { name: '筛选收藏' }) : document.body;
  fireEvent.click(within(root).getByRole('button', { name: '选择收藏夹：角色设计' }));
  fireEvent.click(within(root).getByRole('button', { name: /Pixiv\s+4/ }));
  if (width >= 768) fireEvent.click(screen.getByRole('button', { name: '筛选 1' }));
  const filter = screen.getByRole('dialog', { name: '筛选收藏' });
  const input = within(filter).getByRole('searchbox', { name: '搜索标签' });
  expect(input.hasAttribute('list')).toBe(false);
  expect(within(filter).getByRole('button', { name: '#冷门标签' })).toBeTruthy();
  expect(within(filter).queryByRole('button', { name: '选择已有标签' })).toBeNull();
  expect(within(filter).queryByRole('button', { name: '添加筛选标签' })).toBeNull();
  fireEvent.change(input, { target: { value: '冷门' } });
  expect(within(filter).getByRole('button', { name: '#冷门标签' })).toBeTruthy();
  expect(within(filter).queryByRole('button', { name: '#逆光' })).toBeNull();
  fireEvent.change(input, { target: { value: '没有这个合成标签' } });
  expect(within(filter).getByText('没有匹配的标签')).toBeTruthy();
  fireEvent.change(input, { target: { value: '' } });
  for (const tag of ['逆光', '雨天']) fireEvent.click(within(filter).getByRole('button', { name: '#' + tag }));
  expect(screen.getByText('匹配')).toBeTruthy(); expect(screen.getByText('其他收藏夹')).toBeTruthy();
  expect(screen.queryByText('缺少雨天')).toBeNull(); expect(screen.queryByText('其他来源')).toBeNull();
  expect(screen.queryByRole('button', { name: '取消筛选：收藏夹：角色设计' })).toBeNull();
  const rain = within(filter).getByRole('button', { name: '#雨天' });
  expect(rain.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(rain);
  expect(rain.getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByText('缺少雨天')).toBeTruthy();
  fireEvent.click(within(filter).getByRole('button', { name: '确认' }));
  if (width < 768) fireEvent.click(screen.getByRole('button', { name: '筛选 2' }));
  const navigation = width < 768 ? screen.getByRole('dialog', { name: '筛选收藏' }) : document.body;
  fireEvent.click(within(navigation).getByRole('button', { name: '选择收藏夹：角色设计' }));
  expect(screen.getByText('其他来源')).toBeTruthy(); expect(screen.queryByText('其他收藏夹')).toBeNull();
  expect(screen.queryByRole('button', { name: '取消筛选：来源：Pixiv' })).toBeNull();
});

it.each([390, 1280])('宽度 %s：标签在搜索框内，交集与关键词组合筛选，取消最后一个标签仍保留输入与焦点', async width => {
  vi.stubGlobal('innerWidth', width);
  const items = [
    { ...mockInspirations[0], id: 'match', title: '匹配晚霞', tags: ['逆光', '雨天'] },
    { ...mockInspirations[0], id: 'partial', title: '同名晚霞', tags: ['逆光'] },
    { ...mockInspirations[0], id: 'other', title: '匹配夜景', tags: ['逆光', '雨天'] },
  ];
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: items, onRefresh: vi.fn(), notify: vi.fn() }));
  const search = screen.getByRole('searchbox', { name: '搜索标题、提示词或标签…' }) as HTMLInputElement;
  const field = search.parentElement!;
  expect(field.closest('header')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const filter = screen.getByRole('dialog', { name: '筛选收藏' });
  for (const tag of ['逆光', '雨天']) fireEvent.click(within(filter).getByRole('button', { name: '#' + tag }));
  fireEvent.click(within(filter).getByRole('button', { name: '确认' }));
  expect(search.parentElement).toBe(field);
  const tags = within(field).getByRole('group', { name: '已生效的筛选条件' });
  expect(within(tags).getAllByRole('button')).toHaveLength(2);
  expect(tags.nextElementSibling).toBe(search);
  expect(within(tags).getAllByRole('button').map(chip => chip.getAttribute('data-search-filter-chip'))).toEqual(['逆光', '雨天']);
  expect(tags.classList.contains('whitespace-nowrap')).toBe(true);
  expect(tags.classList.contains('overflow-hidden')).toBe(true);
  expect(tags.classList.contains('flex-wrap')).toBe(false);
  expect(screen.queryByRole('group', { name: '当前筛选' })).toBeNull();
  expect(screen.getByRole('button', { name: '筛选 2' })).toBeTruthy();
  expect(container.querySelectorAll('article')).toHaveLength(2);
  search.focus(); fireEvent.change(search, { target: { value: '晚霞' } });
  await waitFor(() => expect(container.querySelectorAll('article')).toHaveLength(1));
  expect(screen.getByText('匹配晚霞')).toBeTruthy();
  fireEvent.click(within(tags).getByRole('button', { name: '移除筛选：#雨天' }));
  expect(container.querySelectorAll('article')).toHaveLength(2);
  expect(search.value).toBe('晚霞');
  expect(screen.getByRole('button', { name: '筛选 1' })).toBeTruthy();
  fireEvent.click(within(tags).getByRole('button', { name: '移除筛选：#逆光' }));
  expect(screen.getByRole('searchbox')).toBe(search);
  expect(search.parentElement).toBe(field); expect(document.activeElement).toBe(search);
  expect(search.value).toBe('晚霞');
  expect(within(field).queryByRole('group')).toBeNull();
  expect(container.querySelectorAll('article')).toHaveLength(2);
  fireEvent.change(search, { target: { value: '' } });
  await waitFor(() => expect(container.querySelectorAll('article')).toHaveLength(3));
});

it.each([390, 1280])('宽度 %s：搜索内条件过多时与 AITag 共用 +N，连续取消保持关键词、输入节点和真实交集', async width => {
  vi.stubGlobal('innerWidth', width);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-search-filter-chip') ? 200 : 44; });
  const items = [
    { ...mockInspirations[0], id: 'both', title: '合成晚霞', tags: ['逆光', '雨天'] },
    { ...mockInspirations[0], id: 'one', title: '合成晚霞二', tags: ['逆光'] },
  ];
  const view = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: items, onRefresh: vi.fn(), notify: vi.fn() }));
  const input = screen.getByRole('searchbox', { name: '搜索标题、提示词或标签…' }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: '晚霞' } });
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const panel = screen.getByRole('dialog', { name: '筛选收藏' });
  for (const tag of ['逆光', '雨天']) fireEvent.click(within(panel).getByRole('button', { name: '#' + tag }));
  fireEvent.click(within(panel).getByRole('button', { name: '确认' }));
  await waitFor(() => expect(view.container.querySelectorAll('article')).toHaveLength(1));
  const group = screen.getByRole('group', { name: '已生效的筛选条件' });
  expect(group.nextElementSibling).toBe(input); expect(group.classList.contains('flex-wrap')).toBe(false);
  expect(within(group).queryByRole('button', { name: /移除筛选/ })).toBeNull();
  const more = within(group).getByRole('button', { name: '查看其余 2 个筛选条件' });
  more.focus(); fireEvent.click(more);
  const reopened = screen.getByRole('dialog', { name: '筛选收藏' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(within(reopened).getByRole('button', { name: '#雨天' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(reopened).getByRole('button', { name: '#雨天' }));
  expect(view.container.querySelectorAll('article')).toHaveLength(2);
  fireEvent.click(within(reopened).getByRole('button', { name: '确认' }));
  expect(document.activeElement).toBe(more);
  expect(within(group).getByRole('button', { name: '查看其余 1 个筛选条件' })).toBe(more);
  expect(screen.getByRole('searchbox')).toBe(input); expect(input.value).toBe('晚霞');
  expect(db.updateInspiration).not.toHaveBeenCalled(); expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
});

it.each([390, 1280])('宽度 %s：多选只替换原顶栏，不向列表插入一行；退出保留搜索、标签、收藏夹与滚动位置', async width => {
  vi.stubGlobal('innerWidth', width);
  const view = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '图' } });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)); });
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const filter = screen.getByRole('dialog', { name: '筛选收藏' });
  fireEvent.click(within(width < 768 ? filter : view.container.querySelector('aside')!).getByRole('button', { name: '选择收藏夹：角色设计' }));
  fireEvent.click(within(filter).getByRole('button', { name: '#原创' }));
  fireEvent.click(within(filter).getByRole('button', { name: '确认' }));
  const header = screen.getByRole('banner'); const main = view.container.querySelector('main')!;
  const content = main.firstElementChild; main.scrollTop = 420;
  const card = screen.getByText('已整理角色图').closest('article')!;
  selectCollectionCard(card);
  expect(screen.getByRole('banner')).toBe(header); expect(view.container.querySelectorAll('header')).toHaveLength(1);
  const batch = within(header).getByRole('group', { name: '收藏批量操作' });
  expect(batch.classList.contains('flex-nowrap')).toBe(true); expect(batch.classList.contains('flex-wrap')).toBe(false);
  expect(batch.classList.contains('overflow-x-auto')).toBe(true);
  expect(within(header).getByRole('button', { name: '管理收藏夹' })).toBeTruthy();
  expect(within(header).getByRole('textbox', { name: '添加标签' })).toBeTruthy();
  expect(within(header).getByRole('button', { name: '取消收藏' }).classList.contains('mobile-touch')).toBe(true);
  expect(within(header).getByRole('button', { name: '退出多选' }).classList.contains('mobile-touch')).toBe(true);
  expect(within(header).queryByRole('searchbox')).toBeNull(); expect(within(header).queryByRole('button', { name: '筛选' })).toBeNull();
  expect(main.firstElementChild).toBe(content); expect(main.querySelector('.sticky')).toBeNull(); expect(main.scrollTop).toBe(420);
  expect(screen.getByText('已整理角色图').closest('article')).toBe(card);
  fireEvent.click(within(header).getByRole('button', { name: '退出多选' }));
  expect((within(header).getByRole('searchbox') as HTMLInputElement).value).toBe('图');
  expect(within(header).getByRole('button', { name: '移除筛选：#原创' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择收藏夹：角色设计' }).getAttribute('aria-pressed')).toBe('true');
  expect(main.firstElementChild).toBe(content); expect(main.scrollTop).toBe(420);
  expect(db.updateInspiration).not.toHaveBeenCalled(); expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
});

it('顶栏批量加标签失败保留选择与输入，重试成功保留空多选并可退出恢复浏览', async () => {
  vi.mocked(db.updateInspiration).mockRejectedValueOnce(new Error('标签写入失败')).mockResolvedValue(undefined);
  const notify = vi.fn(); const onRefresh = vi.fn(async () => {});
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, notify, onRefresh }));
  const card = screen.getByText('Pixiv 收藏图').closest('article')!;
  selectCollectionCard(card);
  const header = screen.getByRole('banner'); const input = within(header).getByRole('textbox', { name: '添加标签' }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: '逆光' } }); fireEvent.click(within(header).getByRole('button', { name: '添加' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('标签写入失败', 'error'));
  expect(within(header).getByText('已选 1 个作品，共 1 页')).toBeTruthy(); expect(input.value).toBe('逆光'); expect(onRefresh).not.toHaveBeenCalled();
  await waitFor(() => expect((within(header).getByRole('button', { name: '添加' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(header).getByRole('button', { name: '添加' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(within(header).getByText('已选 0 个作品，共 0 页')).toBeTruthy();
  fireEvent.click(within(header).getByRole('button', { name: '退出多选' }));
  expect(within(header).getByRole('searchbox')).toBeTruthy();
  expect(db.updateInspiration).toHaveBeenLastCalledWith('insp-3', { tags: ['风景', '逆光'] });
  expect(onRefresh).toHaveBeenCalledOnce(); expect(within(header).queryByRole('group', { name: '收藏批量操作' })).toBeNull();
});

const sortableBoards = () => ['角色设计', '背景', '构图'].map((name, index) => ({ id: 'board-' + (index + 1), name, userId: mockUser.id, sortOrder: index, createdAt: index + 1, updatedAt: 1 }));
const folderOrder = (root: HTMLElement) => Array.from(root.querySelectorAll('[data-collection-folder]'), element => element.getAttribute('data-collection-folder'));
const prepareFolderPointers = (root: HTMLElement) => {
  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-collection-folder]'));
  rows.forEach((row, index) => {
    row.getBoundingClientRect = () => ({ top: 100 + index * 44, bottom: 140 + index * 44, left: 0, right: 176, width: 176, height: 40 }) as DOMRect;
    row.parentElement!.getBoundingClientRect = row.getBoundingClientRect;
    const handle = within(row.parentElement!).getByRole('button', { name: /排序收藏夹/ });
    handle.setPointerCapture = vi.fn(); handle.releasePointerCapture = vi.fn();
  });
};

it('文件夹固定标题：收藏侧栏只滚目录列表，排序把手边缘滚动驱动新列表而非外层', async () => {
  vi.mocked(db.getInspirationBoards).mockResolvedValue(sortableBoards());
  const view = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, notify: vi.fn(), onRefresh: vi.fn(async () => {}) }));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  const outer = screen.getByRole('complementary', { name: '收藏分类' });
  const tree = screen.getByRole('complementary', { name: '收藏夹目录' });
  const folders = tree.closest<HTMLElement>('[data-collection-folders]')!;
  const header = tree.querySelector<HTMLElement>('.directory-tree-header')!;
  const viewport = tree.querySelector<HTMLElement>('.directory-tree-scroll-viewport')!;
  expect(outer.classList.contains('overflow-hidden')).toBe(true);
  expect(outer.classList.contains('md:flex-col')).toBe(true);
  expect(outer.classList.contains('overflow-y-auto')).toBe(false);
  expect(folders.classList.contains('md:h-full')).toBe(true);
  expect(folders.classList.contains('min-h-0')).toBe(true);
  expect(viewport.classList.contains('md:overflow-y-auto')).toBe(true);
  expect(viewport.contains(header)).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '选择收藏夹：角色设计' }));
  for (const name of ['新建收藏夹', '编辑收藏夹', '删除收藏夹']) expect(header.contains(screen.getByRole('button', { name }))).toBe(true);
  prepareFolderPointers(outer);
  viewport.getBoundingClientRect = () => ({ top: 100, bottom: 220, left: 0, right: 176, width: 176, height: 120 }) as DOMRect;
  outer.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 176, width: 176, height: 600 }) as DOMRect;
  outer.scrollTop = 70; folders.scrollTop = 35; viewport.scrollTop = 120;
  const handle = screen.getByRole('button', { name: '排序收藏夹：角色设计' });
  fireEvent.pointerDown(handle, { pointerType: 'mouse', pointerId: 7, clientX: 12, clientY: 120, button: 0 });
  fireEvent.pointerMove(handle, { pointerType: 'mouse', pointerId: 7, clientX: 12, clientY: 208 });
  expect(viewport.scrollTop).toBe(132);
  expect(outer.scrollTop).toBe(70);
  expect(folders.scrollTop).toBe(35);
  fireEvent.pointerMove(handle, { pointerType: 'mouse', pointerId: 7, clientX: 12, clientY: 108 });
  expect(viewport.scrollTop).toBe(120);
  fireEvent.pointerCancel(handle, { pointerId: 7 });
  expect(db.updateInspirationBoard).not.toHaveBeenCalled();
  expect(view.container.contains(outer)).toBe(true);
});

it.each([[1280, 'mouse'], [390, 'touch']] as const)('宽度 %s：%s 拖动收藏夹保存顺序，重进页面仍保留，不移动作品或切换当前收藏夹', async (width, pointerType) => {
  vi.stubGlobal('innerWidth', width);
  let storedBoards = sortableBoards();
  vi.mocked(db.getInspirationBoards).mockImplementation(async () => [...storedBoards].sort((a, b) => a.sortOrder - b.sortOrder));
  vi.mocked(db.updateInspirationBoard).mockImplementation(async (id, updates) => { storedBoards = storedBoards.map(board => board.id === id ? { ...board, ...updates } : board); });
  const props = { currentUser: mockUser, inspirationsData: mockInspirations, notify: vi.fn(), onRefresh: vi.fn(async () => {}) };
  const view = render(React.createElement(InspirationGallery, props));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  if (width < 768) fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const root = width < 768 ? screen.getByRole('dialog', { name: '筛选收藏' }) : view.container.querySelector('aside')!;
  prepareFolderPointers(root);
  fireEvent.click(within(root).getByRole('button', { name: '选择收藏夹：角色设计' }));
  const handle = within(root).getByRole('button', { name: '排序收藏夹：角色设计' });
  fireEvent.pointerDown(handle, { pointerType, pointerId: 3, clientX: 12, clientY: 120, button: 0 });
  fireEvent.pointerMove(handle, { pointerType, pointerId: 3, clientX: 12, clientY: 208 });
  expect(root.querySelector('[data-collection-folder="board-3"]')!.classList.contains('ring-2')).toBe(true);
  fireEvent.pointerUp(handle, { pointerType, pointerId: 3, clientX: 12, clientY: 208 });
  await waitFor(() => expect(db.updateInspirationBoard).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(handle.getAttribute('aria-disabled')).toBe('false'));
  expect(db.updateInspirationBoard).toHaveBeenCalledWith('board-1', { sortOrder: 2 });
  expect(db.updateInspirationBoard).toHaveBeenCalledWith('board-2', { sortOrder: 0 });
  expect(db.updateInspirationBoard).toHaveBeenCalledWith('board-3', { sortOrder: 1 });
  expect(folderOrder(root)).toEqual(['board-2', 'board-3', 'board-1']);
  expect(within(root).getByRole('button', { name: '选择收藏夹：角色设计' }).getAttribute('aria-pressed')).toBe('true');
  expect(db.bulkUpdateInspirations).not.toHaveBeenCalled(); expect(props.onRefresh).not.toHaveBeenCalled();
  view.unmount();
  const next = render(React.createElement(InspirationGallery, props));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  expect(folderOrder(next.container.querySelector('aside')!)).toEqual(['board-2', 'board-3', 'board-1']);
});

it('收藏夹排序支持方向键，只保存变化项，边界、自身和取消的拖动不保存', async () => {
  vi.mocked(db.getInspirationBoards).mockResolvedValue(sortableBoards());
  const view = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  const handle = await screen.findByRole('button', { name: '排序收藏夹：角色设计' });
  const root = view.container.querySelector('aside')!; prepareFolderPointers(root);
  fireEvent.keyDown(handle, { key: 'ArrowUp' });
  fireEvent.keyDown(screen.getByRole('button', { name: '排序收藏夹：构图' }), { key: 'ArrowDown' });
  fireEvent.pointerDown(handle, { clientX: 12, clientY: 120 }); fireEvent.pointerUp(handle, { clientX: 12, clientY: 120 });
  fireEvent.pointerDown(handle, { clientX: 12, clientY: 120 }); fireEvent.pointerMove(handle, { clientX: 12, clientY: 208 }); fireEvent.pointerCancel(handle);
  fireEvent.pointerDown(handle, { clientX: 12, clientY: 120 }); fireEvent.pointerMove(handle, { clientX: 999, clientY: 208 }); fireEvent.pointerUp(handle);
  expect(db.updateInspirationBoard).not.toHaveBeenCalled();
  fireEvent.keyDown(handle, { key: 'ArrowDown' });
  await waitFor(() => expect(handle.getAttribute('aria-disabled')).toBe('false'));
  expect(folderOrder(root)).toEqual(['board-2', 'board-1', 'board-3']);
  expect(db.updateInspirationBoard).toHaveBeenCalledTimes(2);
  expect(db.updateInspirationBoard).not.toHaveBeenCalledWith('board-3', expect.anything());
  expect(document.activeElement).toBe(handle);
});

it('收藏夹顺序部分保存失败后重新读取实际顺序，作品与分类保留，可再次排序', async () => {
  let storedBoards = sortableBoards(); let calls = 0;
  vi.mocked(db.getInspirationBoards).mockImplementation(async () => [...storedBoards].sort((a, b) => a.sortOrder - b.sortOrder));
  vi.mocked(db.updateInspirationBoard).mockImplementation(async (id, updates) => {
    if (++calls === 2) throw new Error('保存中断');
    storedBoards = storedBoards.map(board => board.id === id ? { ...board, ...updates } : board);
  });
  const notify = vi.fn();
  const view = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify }));
  const handle = await screen.findByRole('button', { name: '排序收藏夹：角色设计' });
  const root = view.container.querySelector('aside')!; prepareFolderPointers(root);
  fireEvent.pointerDown(handle, { clientX: 12, clientY: 120 }); fireEvent.pointerMove(handle, { clientX: 12, clientY: 208 }); fireEvent.pointerUp(handle);
  await waitFor(() => expect(notify).toHaveBeenCalledWith('保存中断', 'error'));
  expect(folderOrder(root)).toEqual(['board-2', 'board-1', 'board-3']);
  expect(screen.getByText('已整理角色图')).toBeTruthy(); expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
  fireEvent.keyDown(handle, { key: 'ArrowDown' });
  await waitFor(() => expect(handle.getAttribute('aria-disabled')).toBe('false'));
  expect(folderOrder(root)).toEqual(['board-2', 'board-3', 'board-1']);
  expect([...storedBoards].sort((a, b) => a.sortOrder - b.sortOrder).map(board => board.id)).toEqual(['board-2', 'board-3', 'board-1']);
});

it('收藏夹顺序保存期间禁止重复提交，访客的排序把手不可操作', async () => {
  vi.mocked(db.getInspirationBoards).mockResolvedValue(sortableBoards());
  let finish!: () => void;
  vi.mocked(db.updateInspirationBoard).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const props = { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, props));
  const handle = await screen.findByRole('button', { name: '排序收藏夹：角色设计' });
  fireEvent.keyDown(handle, { key: 'ArrowDown' }); fireEvent.keyDown(handle, { key: 'ArrowDown' });
  expect(db.updateInspirationBoard).toHaveBeenCalledOnce(); expect(handle.getAttribute('aria-disabled')).toBe('true');
  await act(async () => finish());
  await waitFor(() => expect(handle.getAttribute('aria-disabled')).toBe('false'));
  expect(db.updateInspirationBoard).toHaveBeenCalledTimes(2);
  view.rerender(React.createElement(InspirationGallery, { ...props, currentUser: { ...mockUser, role: 'guest' } }));
  expect((screen.getByRole('button', { name: '排序收藏夹：背景' }) as HTMLButtonElement).disabled).toBe(true);
});

const dragData = () => ({ setData: vi.fn(), effectAllowed: 'all', dropEffect: 'none' }) as unknown as DataTransfer;

it('画廊拒绝文件拖入且无覆盖层，按钮选择多图仍保留配置并整批设置标签和收藏夹', async () => {
  vi.mocked(extractMetadata).mockResolvedValueOnce(JSON.stringify({ prompt: '第一张独立提示词', width: 1024, height: 1024, seed: 123 })).mockResolvedValueOnce(null);
  const refresh = vi.fn(async () => {});
  const view = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), onImportRefresh: refresh, notify: vi.fn() }));
  const zone = view.container.querySelector('[data-collection-file-dropzone]')!;
  const files = [new File(['A'], '第一张.png', { type: 'image/png' }), new File(['B'], '第二张.jpg', { type: 'image/jpeg' })];
  const dataTransfer = { ...dragData(), types: ['Files'], files };
  fireEvent.dragEnter(zone, { dataTransfer });
  expect(screen.queryByText('拖入本地图片，加入收藏库')).toBeNull();
  expect(fireEvent.dragOver(zone, { dataTransfer })).toBe(false); expect(dataTransfer.dropEffect).toBe('none');
  expect(fireEvent.drop(zone, { dataTransfer })).toBe(false);
  expect(screen.queryByRole('dialog', { name: '加入收藏库' })).toBeNull();
  expect(extractMetadata).not.toHaveBeenCalled();
  expect(api.uploadFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  const dialog = await screen.findByRole('dialog', { name: '加入收藏库' });
  expect(screen.queryByText('拖入本地图片，加入收藏库')).toBeNull();
  const chooser = within(dialog).getByLabelText('上传收藏图片') as HTMLInputElement;
  expect(chooser.multiple).toBe(true);
  fireEvent.change(chooser, { target: { files } });
  await waitFor(() => expect((within(dialog).getByRole('button', { name: '加入收藏库' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(dialog).getByRole('button', { name: '收藏夹' })); fireEvent.click(screen.getByRole('checkbox', { name: '角色设计' })); fireEvent.click(within(screen.getByRole('dialog', { name: '收藏夹' })).getByRole('button', { name: '完成' }));
  fireEvent.change(within(dialog).getByRole('textbox', { name: '公共标签' }), { target: { value: '夜景, 构图' } });
  expect(api.uploadFile).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(db.saveInspiration).toHaveBeenCalledTimes(2));
  expect(db.saveInspiration).toHaveBeenNthCalledWith(1, expect.objectContaining({ title: '第一张', prompt: '第一张独立提示词', params: expect.objectContaining({ seed: 123 }), boardIds: ['board-1'], tags: ['夜景', '构图'] }));
  expect(db.saveInspiration).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: '第二张', prompt: '', negativePrompt: '', params: undefined, boardIds: ['board-1'], tags: ['夜景', '构图'] }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: '加入收藏库' })).toBe(dialog);
});

it('收藏夹拒绝外部文件与网页链接，内部图片携带Files类型仍只移动作品', async () => {
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  const folder = (await screen.findByRole('button', { name: '选择收藏夹：角色设计' })).closest('[data-collection-folder]')!;
  fireEvent.drop(folder, { dataTransfer: { ...dragData(), types: ['text/uri-list'], files: [], getData: () => 'https://example.com/image.png' } });
  expect(screen.queryByRole('dialog', { name: '加入收藏库' })).toBeNull();
  const file = new File(['synthetic'], 'local.png', { type: 'image/png' });
  const dataTransfer = { ...dragData(), types: ['Files'], files: [file] };
  expect(fireEvent.dragOver(folder, { dataTransfer })).toBe(false);
  expect(dataTransfer.dropEffect).toBe('none');
  expect(fireEvent.drop(folder, { dataTransfer })).toBe(false);
  expect(screen.queryByRole('dialog', { name: '加入收藏库' })).toBeNull();
  expect(extractMetadata).not.toHaveBeenCalled();
  expect(db.bulkUpdateInspirations).not.toHaveBeenCalled(); expect(db.saveInspiration).not.toHaveBeenCalled();
  const card = screen.getByText(mockInspirations[1].title).closest('article')!;
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.dragEnter(card, { dataTransfer });
  expect(fireEvent.dragOver(folder, { dataTransfer })).toBe(false);
  expect(dataTransfer.dropEffect).toBe('copy');
  expect(screen.queryByText('拖入本地图片，加入收藏库')).toBeNull();
  fireEvent.drop(folder, { dataTransfer });
  await waitFor(() => expect(db.bulkUpdateInspirations).toHaveBeenCalledExactlyOnceWith(['insp-2'], { addBoardIds: ['board-1'] }));
  expect(screen.queryByRole('dialog', { name: '加入收藏库' })).toBeNull();
  expect(api.uploadFile).not.toHaveBeenCalled();
});

it('访客的文件导入入口禁用，拖入本地文件不写入且阻止浏览器打开文件', () => {
  const view = render(React.createElement(InspirationGallery, { currentUser: { ...mockUser, role: 'guest' }, inspirationsData: [], onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  expect((screen.getByRole('button', { name: '加入收藏库' }) as HTMLButtonElement).disabled).toBe(true);
  const zone = view.container.querySelector('[data-collection-file-dropzone]')!;
  expect(fireEvent.drop(zone, { dataTransfer: { ...dragData(), types: ['Files'], files: [new File(['A'], 'local.png', { type: 'image/png' })] } })).toBe(false);
  expect(screen.queryByRole('dialog', { name: '加入收藏库' })).toBeNull();
  expect(extractMetadata).not.toHaveBeenCalled(); expect(api.uploadFile).not.toHaveBeenCalled();
});

it('筛选窗口内拖入文件不叠加导入窗口，保留原筛选且阻止文件导航', async () => {
  vi.stubGlobal('innerWidth', 390);
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const filter = screen.getByRole('dialog', { name: '筛选收藏' });
  const folder = within(filter).getByRole('button', { name: '选择收藏夹：角色设计' }).closest('[data-collection-folder]')!;
  const dataTransfer = { ...dragData(), types: ['Files'], files: [new File(['A'], 'local.png', { type: 'image/png' })] };
  expect(fireEvent.dragOver(folder, { dataTransfer })).toBe(false); expect(dataTransfer.dropEffect).toBe('none');
  expect(fireEvent.drop(folder, { dataTransfer })).toBe(false);
  expect(screen.getByRole('dialog', { name: '筛选收藏' })).toBe(filter);
  expect(screen.queryByRole('dialog', { name: '加入收藏库' })).toBeNull();
  expect(api.uploadFile).not.toHaveBeenCalled();
});
it('拖拽多张作品追加收藏夹；全部和未整理不接受清空归属，同夹与外部拖入不发请求', async () => {
  const onRefresh = vi.fn(async () => {});
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh, notify: vi.fn() }));
  const folder = (await screen.findByRole('button', { name: '选择收藏夹：角色设计' })).closest('[data-collection-folder]')!;
  const card = (index: number) => screen.getByText(mockInspirations[index].title).closest('article')!;
  const dataTransfer = dragData();
  fireEvent.drop(folder, { dataTransfer }); expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
  fireEvent.dragStart(card(0), { dataTransfer }); fireEvent.drop(folder, { dataTransfer }); expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
  for (const index of [1, 2]) selectCollectionCard(card(index));
  fireEvent.dragStart(card(1), { dataTransfer });
  expect(fireEvent.dragOver(folder, { dataTransfer })).toBe(false); expect(dataTransfer.dropEffect).toBe('copy'); expect(folder.classList.contains('border-indigo-500')).toBe(true);
  fireEvent.drop(folder, { dataTransfer }); fireEvent.drop(folder, { dataTransfer });
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(db.bulkUpdateInspirations).toHaveBeenCalledExactlyOnceWith(['insp-2', 'insp-3'], { addBoardIds: ['board-1'] });
  expect(screen.getByText('已选 2 个作品，共 2 页')).toBeTruthy();
  const unorganized = screen.getByRole('button', { name: /未整理\s+2/ });
  fireEvent.dragStart(card(0), { dataTransfer }); fireEvent.drop(unorganized, { dataTransfer });
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(db.bulkUpdateInspirations).toHaveBeenCalledOnce();
});

it('取消拖拽、只读作品不能移动；保存失败保留作品与选择，能够重试', async () => {
  vi.mocked(db.bulkUpdateInspirations).mockRejectedValueOnce(new Error('合成移动失败'));
  const notify = vi.fn(), onRefresh = vi.fn(async () => {});
  const readOnly = { ...mockInspirations[2], id: 'read-only', title: '只读作品', userId: 'other' };
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [...mockInspirations, readOnly], onRefresh, notify }));
  const folder = (await screen.findByRole('button', { name: '选择收藏夹：角色设计' })).closest('[data-collection-folder]')!;
  const card = screen.getByText(mockInspirations[1].title).closest('article')!;
  const locked = screen.getByText('只读作品').closest('article')!;
  const dataTransfer = dragData();
  expect(locked.draggable).toBe(false); expect(fireEvent.dragStart(locked, { dataTransfer })).toBe(false);
  fireEvent.drop(folder, { dataTransfer }); expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
  fireEvent.dragStart(card, { dataTransfer }); fireEvent.dragEnd(card); fireEvent.drop(folder, { dataTransfer });
  expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
  selectCollectionCard(card);
  fireEvent.click(within(locked).getByRole('img').closest('button')!);
  expect(screen.getByText('已选 1 个作品，共 1 页')).toBeTruthy();
  fireEvent.dragStart(card, { dataTransfer }); fireEvent.drop(folder, { dataTransfer });
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成移动失败', 'error'));
  expect(screen.getByText('已选 1 个作品，共 1 页')).toBeTruthy(); expect(screen.getByText(mockInspirations[1].title)).toBeTruthy(); expect(onRefresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '管理收藏夹' })); fireEvent.click(screen.getByRole('checkbox', { name: '角色设计' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(db.bulkUpdateInspirations).toHaveBeenLastCalledWith(['insp-2'], { addBoardIds: ['board-1'] });
});

// 收藏服务的持久化与并发在 services 定向测试中验证，这里隔离页面副作用。
vi.mock('../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../services/collectionFavorites')>(),
  ensureCollection: vi.fn(async () => {}), loadCollection: vi.fn(async () => []),
  subscribeCollection: () => () => {}, collectionRevision: () => 0, collectionTargetActive: () => false,
  toggleCollectionTarget: vi.fn(async () => true), syncHistoryCollectionFavorites: vi.fn(async () => {}),
}));


const groupedImages: Inspiration[] = [2, 0, 1].map(page => ({
  id: 'group-' + page, userId: mockUser.id, title: '我的作品组 · ' + (page + 1), imageUrl: '/synthetic/group-' + page + '.png', prompt: 'prompt-' + page,
  sourceType: 'aitag', sourceId: 'work-1', sourceUrl: 'https://aitag.win/i/1', createdAt: 10 + page,
  tags: ['AITag'], analysis: { collectionImageId: 'work_p' + page, collectionGroupSize: 3 },
}));

it.each([390, 1280])('宽度 %s：作品组只显示一张首图卡片，点开才在共用侧栏逐张显示图片与整理信息', async width => {
  vi.stubGlobal('innerWidth', width);
  const { container, rerender } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [...groupedImages, mockInspirations[0]], onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  const card = screen.getByText('我的作品组').closest('article')!;
  expect(container.querySelectorAll('article')).toHaveLength(2);
  expect(within(card).getByRole('img').getAttribute('src')).toBe('/synthetic/group-0.png');
  expect(within(card).getByText('3页')).toBeTruthy();
  expect(screen.queryByRole('img', { name: groupedImages[0].title })).toBeNull();
  fireEvent.click(within(card).getByRole('img').closest('button')!);
  const panel = screen.getByRole('complementary', { name: '我的作品组' });
  expect(within(panel).getByText('3页')).toBeTruthy();
  expect(panel.classList.contains('fixed')).toBe(true); expect(panel.classList.contains('lg:static')).toBe(true);
  expect(container.querySelector('main')!.classList.contains('hidden')).toBe(true); expect(container.querySelector('main')!.classList.contains('lg:block')).toBe(true);
  const images = within(panel).getAllByRole('img');
  expect(images.map(image => image.getAttribute('src'))).toEqual([0, 1, 2].map(page => '/synthetic/group-' + page + '.png'));
  expect(within(panel).getAllByRole('button', { name: '收藏' })).toHaveLength(3);
  expect(within(panel).getAllByRole('button', { name: '修改收藏标题' })).toHaveLength(3);
  expect(within(panel).getAllByRole('textbox', { name: '提示词' }).map(input => (input as HTMLTextAreaElement).value)).toEqual(['prompt-0', 'prompt-1', 'prompt-2']);
  expect(document.querySelector('[data-agent-page-title^="收藏详情"]')).toBeNull();
  expect(document.querySelector('.ui-modal-enter')).toBeNull();
  rerender(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [...groupedImages.map(image => image.id === 'group-1' ? { ...image, archived: true } : image), mockInspirations[0]], onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  expect(within(panel).getAllByRole('img')).toHaveLength(2);
  fireEvent.click(within(panel).getByRole('button', { name: width < 1024 ? '返回' : '关闭' }));
  expect(screen.queryByRole('complementary', { name: '我的作品组' })).toBeNull();
  expect(container.querySelector('main')!.classList.contains('hidden')).toBe(false);
});

it.each(['image', 'title'])('收藏单张和多图组从 %s 打开先抵消挤压再居中，切换及关闭保留位置，不写整理数据', target => {
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [...groupedImages, mockInspirations[0]], onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  const cards = Array.from(container.querySelectorAll('article'));
  const { root, scrollCalls } = mockGalleryGeometry(cards, () => container.querySelector('.aitag-detail-panel--open') ? -600 : 0);
  root.scrollTop = 1400;
  expect(container.querySelector('[data-collection-focused]')).toBeNull();
  fireEvent.click(target === 'image' ? within(cards[0]).getByRole('img').closest('button')! : cards[0].querySelector('button.gallery-card-caption')!);
  expect(root.scrollTop).toBe(1050);
  expect(scrollCalls.slice(0, 2)).toEqual([{ top: 800, behavior: 'instant' }, { top: 1050, behavior: 'smooth' }]);
  expect(cards[0].dataset.collectionActive).toBe('true');
  expect(cards[1].dataset.collectionActive).toBeUndefined();
  expect(cards[1].closest('[data-collection-focused]')?.getAttribute('data-collection-focused')).toBe('true');
  fireEvent.click(within(cards[1]).getByRole('img').closest('button')!);
  expect(root.scrollTop).toBe(1850);
  expect(cards[0].dataset.collectionActive).toBeUndefined();
  expect(cards[1].dataset.collectionActive).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(root.scrollTop).toBe(2450);
  expect(container.querySelector('[data-collection-focused]')).toBeNull();
  expect(db.updateInspiration).not.toHaveBeenCalled();
  expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
});

it('关闭选中作品聚焦后仍可打开收藏详情，但不压暗其他组或自动滚动', () => {
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [...groupedImages, mockInspirations[0]], onRefresh: vi.fn(async () => {}), notify: vi.fn(), selectionFocusEnabled: false }));
  const cards = Array.from(container.querySelectorAll('article'));
  const { root, scrollCalls } = mockGalleryGeometry(cards, () => container.querySelector('.aitag-detail-panel--open') ? -600 : 0);
  root.scrollTop = 1400;
  fireEvent.click(cards[0].querySelector('button.gallery-card-caption')!);
  expect(root.scrollTop).toBe(1400);
  expect(scrollCalls).toEqual([]);
  expect(container.querySelector('[data-collection-focused]')).toBeNull();
  expect(container.querySelector('.aitag-detail-panel--open')).toBeTruthy();
});

it('作品组可整组选中和拖入收藏夹；在未整理筛选内移动不带走其他夹的组员，展开仍能看全组', async () => {
  const onRefresh = vi.fn(async () => {});
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: groupedImages, onRefresh, notify: vi.fn() }));
  const folder = (await screen.findByRole('button', { name: '选择收藏夹：角色设计' })).closest('[data-collection-folder]')!;
  const card = screen.getByText('我的作品组').closest('article')!;
  selectCollectionCard(card); expect(screen.getByText('已选 1 个作品，共 3 页')).toBeTruthy();
  selectCollectionCard(card); expect(screen.queryByText('已选 1 个作品，共 3 页')).toBeNull();
  const dataTransfer = dragData(); fireEvent.dragStart(card, { dataTransfer }); fireEvent.drop(folder, { dataTransfer });
  await waitFor(() => expect(db.bulkUpdateInspirations).toHaveBeenCalledWith(expect.arrayContaining(['group-0', 'group-1', 'group-2']), { addBoardIds: ['board-1'] }));
  cleanup(); vi.clearAllMocks();
  const splitGroup = groupedImages.map(image => image.id === 'group-0' ? { ...image, boardId: 'board-1' } : image);
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: splitGroup, onRefresh, notify: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: /未整理\s+2/ }));
  const filteredCard = screen.getByText('我的作品组').closest('article')!;
  expect(within(filteredCard).getByText('2页')).toBeTruthy();
  const target = (await screen.findByRole('button', { name: '选择收藏夹：角色设计' })).closest('[data-collection-folder]')!;
  fireEvent.dragStart(filteredCard, { dataTransfer: dragData() }); fireEvent.drop(target, { dataTransfer: dragData() });
  await waitFor(() => expect(db.bulkUpdateInspirations).toHaveBeenCalledWith(expect.arrayContaining(['group-1', 'group-2']), { addBoardIds: ['board-1'] }));
  expect(vi.mocked(db.bulkUpdateInspirations).mock.lastCall![0]).toHaveLength(2);
  fireEvent.click(within(filteredCard).getByRole('img').closest('button')!);
  expect(within(screen.getByRole('complementary', { name: '我的作品组' })).getAllByRole('img')).toHaveLength(3);
});


it.each([390, 1280])('宽度 %s：各来源单张收藏也使用作品组侧栏，直接整理，不打开独立详情弹窗', async width => {
  vi.stubGlobal('innerWidth', width);
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  for (const item of mockInspirations) {
    const card = screen.getByText(item.title).closest('article')!;
    expect(within(card).getByText('1页')).toBeTruthy();
    fireEvent.click(within(card).getByRole('img').closest('button')!);
    const panel = screen.getByRole('complementary', { name: item.title });
    expect(within(panel).getAllByRole('img')).toHaveLength(1);
    expect(within(panel).getByText('1页')).toBeTruthy();
    expect((within(panel).getByRole('textbox', { name: '提示词' }) as HTMLTextAreaElement).value).toBe(item.prompt);
    expect(within(panel).queryByRole('combobox', { name: '切换所属收藏夹' })).toBeNull();
    expect(document.querySelector('.ui-modal-enter')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: width < 1024 ? '返回' : '关闭' }));
  }
});

it.each([390, 1280])('宽度 %s：多选按钮直接进入选择，空选择保持模式，切换不重建图片', width => {
  vi.stubGlobal('innerWidth', width);
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  const card = screen.getByText(mockInspirations[0].title).closest('article')!;
  const image = within(card).getByRole('img');
  const imageButton = image.closest('button')!;
  expect(within(card).getByRole('button', { name: '删除收藏' }).className).toContain('bg-red-500');
  expect(within(card).queryByRole('button', { name: '选择收藏' })).toBeNull();
  expect(screen.queryByRole('button', { name: '全选筛选结果' })).toBeNull();
  const header = screen.getByRole('banner');
  const select = within(header).getByRole('button', { name: '批量选择图片' });
  expect(select.textContent).toBe('多选');
  expect(select.getAttribute('aria-haspopup')).toBeNull();
  expect(screen.queryByRole('button', { name: '管理' })).toBeNull();
  fireEvent.click(select);
  expect(screen.getByRole('banner')).toBe(header);
  expect(screen.queryByRole('dialog', { name: '收藏管理' })).toBeNull();
  expect(screen.getByText('已选 0 个作品，共 0 页')).toBeTruthy();
  expect((screen.getByRole('button', { name: '取消收藏' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '管理收藏夹' }) as HTMLSelectElement).disabled).toBe(true);
  const checkbox = within(card).getByRole('button', { name: '选择收藏' });
  expect(checkbox.classList.contains('hover-reveal-md')).toBe(false);
  expect(checkbox.getAttribute('aria-pressed')).toBe('false');
  expect(checkbox.textContent).toBe(''); expect(checkbox.querySelector('svg')).toBeNull();
  expect(checkbox.classList.contains('left-1.5')).toBe(true); expect(checkbox.classList.contains('shadow')).toBe(true);
  expect(within(card).queryByRole('button', { name: '删除收藏' })).toBeNull();
  expect(within(card).queryByRole('button', { name: '复制图片' })).toBeNull();
  expect(card.querySelector('[data-card-action]')!.nextElementSibling).toBeNull();
  expect(within(card).getByRole('img')).toBe(image);
  expect(image.closest('button')).toBe(imageButton);
  expect(container.querySelectorAll('header')).toHaveLength(1);
  vi.useFakeTimers();
  fireEvent.pointerDown(imageButton, { pointerType: 'touch', pointerId: 9, button: 0, isPrimary: true });
  act(() => { vi.advanceTimersByTime(650); });
  expect(card.getAttribute('data-press-revealed')).not.toBe('true');
  fireEvent.pointerCancel(imageButton, { pointerType: 'touch', pointerId: 9 });
  vi.useRealTimers();
  fireEvent.click(imageButton);
  expect(checkbox.getAttribute('aria-pressed')).toBe('true'); expect(checkbox.textContent).toBe('✓');
  expect(screen.getByText('已选 1 个作品，共 1 页')).toBeTruthy();
  expect(screen.queryByRole('complementary', { name: mockInspirations[0].title })).toBeNull();
  fireEvent.click(screen.getByText(mockInspirations[0].title).closest('button')!);
  expect(screen.getByText('已选 0 个作品，共 0 页')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '管理' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '退出多选' }));
  expect(screen.getByRole('button', { name: '批量选择图片' })).toBeTruthy();
  expect(screen.getByText(mockInspirations[0].title).closest('article')).toBe(card);
  expect(within(card).getByRole('img')).toBe(image);
  expect(within(card).getByRole('button', { name: '删除收藏' })).toBeTruthy();
  expect(within(card).getByRole('button', { name: '复制图片' })).toBeTruthy();
  expect(db.bulkDeleteInspirations).not.toHaveBeenCalled();
});

it('普通卡片删除需确认，取消与重复点击不写入，确认后只取消自身收藏', async () => {
  let resolveConfirm!: (result: boolean) => void;
  confirmAction.mockImplementationOnce(() => new Promise<boolean>(resolve => { resolveConfirm = resolve; }));
  const onRefresh = vi.fn(async () => {}), notify = vi.fn();
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh, notify }));
  const card = screen.getByText(mockInspirations[0].title).closest('article')!;
  const remove = within(card).getByRole('button', { name: '删除收藏' });
  expect(remove.classList.contains('hover-reveal-md')).toBe(true);
  expect(remove.classList.contains('left-2')).toBe(true);
  fireEvent.click(remove); fireEvent.click(remove);
  expect(confirmAction).toHaveBeenCalledOnce();
  expect(screen.queryByRole('complementary', { name: mockInspirations[0].title })).toBeNull();
  expect(screen.queryByText('已选 0 个作品，共 0 页')).toBeNull();
  await act(async () => { resolveConfirm(false); });
  expect(db.bulkDeleteInspirations).not.toHaveBeenCalled();
  expect(onRefresh).not.toHaveBeenCalled();
  fireEvent.click(remove);
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(db.bulkDeleteInspirations).toHaveBeenCalledExactlyOnceWith(['insp-1']);
  expect(confirmAction).toHaveBeenLastCalledWith(expect.objectContaining({ message: '原图与已有分类信息会保留。', tone: 'danger' }));
  expect(screen.getByRole('button', { name: '批量选择图片' })).toBeTruthy();
  expect(mockInspirations[0].boardId).toBe('board-1');
  expect(db.updateInspiration).not.toHaveBeenCalled();
  expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
});

it('普通卡片删除失败保持浏览与原图可重试，只读卡片不提供删除或选择', async () => {
  vi.mocked(db.bulkDeleteInspirations).mockRejectedValueOnce(new Error('合成删除失败'));
  const readOnly = { ...mockInspirations[0], id: 'read-only', userId: 'other', title: '只读收藏' };
  const onRefresh = vi.fn(async () => {}), notify = vi.fn();
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [...mockInspirations, readOnly], onRefresh, notify }));
  const card = screen.getByText(mockInspirations[0].title).closest('article')!;
  const locked = screen.getByText(readOnly.title).closest('article')!;
  expect(within(locked).queryByRole('button', { name: '删除收藏' })).toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: '删除收藏' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成删除失败', 'error'));
  expect(onRefresh).not.toHaveBeenCalled();
  expect(within(card).getByRole('img')).toBeTruthy();
  expect(screen.getByRole('button', { name: '批量选择图片' })).toBeTruthy();
  fireEvent.click(within(card).getByRole('button', { name: '删除收藏' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(db.bulkDeleteInspirations).toHaveBeenLastCalledWith(['insp-1']);
  enterCollectionSelection();
  expect(within(locked).queryByRole('button', { name: '选择收藏' })).toBeNull();
  fireEvent.click(within(locked).getByRole('img').closest('button')!);
  expect(screen.getByText('已选 0 个作品，共 0 页')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  expect(screen.getByText('已选 3 个作品，共 3 页')).toBeTruthy();
});

it('作品组卡片删除仅取消当前筛选命中的页，不带走其他收藏夹组员', async () => {
  const splitGroup = groupedImages.map(image => image.id === 'group-0' ? { ...image, boardId: 'board-1' } : image);
  const onRefresh = vi.fn(async () => {});
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: splitGroup, onRefresh, notify: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: /未整理\s+2/ }));
  const card = screen.getByText('我的作品组').closest('article')!;
  fireEvent.click(within(card).getByRole('button', { name: '删除收藏' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: '取消 2 张图片的收藏？' }));
  expect(db.bulkDeleteInspirations).toHaveBeenCalledExactlyOnceWith(expect.arrayContaining(['group-1', 'group-2']));
  expect(vi.mocked(db.bulkDeleteInspirations).mock.lastCall![0]).toHaveLength(2);
  expect(db.bulkDeleteInspirations).not.toHaveBeenCalledWith(expect.arrayContaining(['group-0']));
  expect(splitGroup.find(image => image.id === 'group-0')!.boardId).toBe('board-1');
});


it.each([390, 1280])('宽度 %s：管理标签在筛选标签标题旁，关闭筛选后打开管理并归还焦点', width => {
  vi.stubGlobal('innerWidth', width);
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  const trigger = screen.getByRole('button', { name: '筛选' });
  trigger.focus(); fireEvent.click(trigger);
  const filter = screen.getByRole('dialog', { name: '筛选收藏' });
  expect(filter.classList.contains('mobile-sheet')).toBe(width < 768);
  expect(filter.classList.contains('fixed')).toBe(width >= 768);
  const heading = within(filter).getByRole('heading', { name: '标签（同时满足）' });
  const manageTags = within(filter).getByRole('button', { name: '管理标签' });
  expect(manageTags.parentElement).toBe(heading.parentElement);
  expect(screen.queryByRole('button', { name: '管理' })).toBeNull();
  fireEvent.click(manageTags);
  expect(screen.queryByRole('dialog', { name: '筛选收藏' })).toBeNull();
  const manager = screen.getByRole('dialog', { name: '管理标签' });
  expect(manager.contains(document.activeElement)).toBe(true);
  expect(within(manager).getByText('#原创')).toBeTruthy();
  expect(within(manager).queryByText('#生成历史')).toBeNull();
  fireEvent.click(within(manager).getByRole('button', { name: '关闭' }));
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByRole('searchbox').getAttribute('placeholder')).toBe('搜索标题、提示词或标签…');
  expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
});

it('全选与反选当前结果保留其他分类选择，清空选择不退出，计数区分作品与页', async () => {
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [...groupedImages, mockInspirations[0]], onRefresh: vi.fn(), notify: vi.fn() }));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  selectCollectionCard(screen.getByText(mockInspirations[0].title).closest('article')!);
  fireEvent.click(screen.getByRole('button', { name: /未整理\s+3/ }));
  fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  expect(screen.getByText('已选 2 个作品，共 4 页')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '反选筛选结果' }));
  expect(screen.getByText('已选 1 个作品，共 1 页')).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择收藏' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '反选筛选结果' }));
  expect(screen.getByText('已选 2 个作品，共 4 页')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }));
  expect(screen.getByText('已选 0 个作品，共 0 页')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '管理' })).toBeNull();
  expect((screen.getByRole('button', { name: '清空选择' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '退出多选' }));
  expect(screen.getByRole('button', { name: '批量选择图片' })).toBeTruthy();
});

it('作品组部分选中显示短横与边框，反选以当前作品组为单位，刷新移除失效选择', async () => {
  const data = groupedImages.map(image => image.id === 'group-0' ? { ...image, boardId: 'board-1' } : image);
  const props = { currentUser: mockUser, inspirationsData: data, onRefresh: vi.fn(), notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, props));
  fireEvent.click(await screen.findByRole('button', { name: '选择收藏夹：角色设计' }));
  selectCollectionCard(screen.getByText('我的作品组').closest('article')!);
  expect(screen.getByText('已选 1 个作品，共 1 页')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /全部\s+3/ }));
  const checkbox = screen.getByRole('button', { name: '选择收藏' });
  expect(checkbox.getAttribute('aria-pressed')).toBe('mixed'); expect(checkbox.textContent).toBe('−');
  expect(checkbox.title).toBe('部分选中'); expect(checkbox.closest('article')!.classList.contains('ring-2')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '反选筛选结果' }));
  expect(checkbox.getAttribute('aria-pressed')).toBe('true'); expect(checkbox.textContent).toBe('✓');
  expect(screen.getByText('已选 1 个作品，共 3 页')).toBeTruthy();
  view.rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: data.map(item => ({ ...item, archived: true })) }));
  await waitFor(() => expect(screen.getByText('已选 0 个作品，共 0 页')).toBeTruthy());
  expect((screen.getByRole('button', { name: '取消收藏' }) as HTMLButtonElement).disabled).toBe(true);
});

it('整组收藏夹管理显示部分归属，勾选只为缺少该夹的组员追加', async () => {
  const data = groupedImages.map((image, index) => ({ ...image, boardIds: index === 0 ? ['board-1', 'other'] : ['other'] }));
  const onRefresh = vi.fn(async () => {});
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: data, onRefresh, notify: vi.fn() }));
  await screen.findByRole('button', { name: '选择收藏夹：角色设计' });
  fireEvent.click(screen.getByRole('img', { name: '我的作品组' }).closest('button')!);
  fireEvent.click(screen.getByRole('button', { name: '管理整组收藏夹' }));
  const check = screen.getByRole('checkbox', { name: /角色设计/ }) as HTMLInputElement;
  expect(check.indeterminate).toBe(true);
  fireEvent.click(check);
  await waitFor(() => expect(db.bulkUpdateInspirations).toHaveBeenCalledWith(data.slice(1).map(image => image.id), { addBoardIds: ['board-1'] }));
  expect(data.every(image => image.boardIds.includes('other'))).toBe(true);
});

it('手机详情的收藏夹返回只关闭子层，保留当前作品详情', async () => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(max-width: 1279px)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  window.history.replaceState({}, '');
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: groupedImages, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  fireEvent.click(screen.getByRole('img', { name: '我的作品组' }).closest('button')!);
  await waitFor(() => expect(window.history.state.__naiMobileLayers).toHaveLength(1));
  const parentState = window.history.state;
  fireEvent.click(screen.getByRole('button', { name: '管理整组收藏夹' }));
  await waitFor(() => expect(window.history.state.__naiMobileLayers).toHaveLength(2));
  act(() => { window.history.replaceState(parentState, ''); window.dispatchEvent(new PopStateEvent('popstate', { state: parentState })); });
  expect(screen.queryByRole('dialog', { name: '管理整组收藏夹' })).toBeNull();
  expect(screen.getByRole('complementary', { name: '我的作品组' })).toBeTruthy(); expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
  window.history.replaceState({}, '');
});

it('全库标签重命名同步已选标签筛选，管理期间保留原关键词与收藏夹', async () => {
  let data = mockInspirations.map(item => ({ ...item, tags: [...(item.tags || [])] }));
  vi.mocked(db.bulkUpdateInspirations).mockImplementationOnce(async (ids, updates) => { data = data.map(item => ids.includes(item.id) ? { ...item, ...updates } : item); });
  const onRefresh = vi.fn(async () => view.rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: data })));
  const props = { currentUser: mockUser, inspirationsData: data, onRefresh, notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, props));
  fireEvent.click(await screen.findByRole('button', { name: '选择收藏夹：角色设计' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const filter = screen.getByRole('dialog', { name: '筛选收藏' });
  const tagInput = within(filter).getByRole('searchbox', { name: '搜索标签' });
  fireEvent.change(tagInput, { target: { value: '原创' } });
  fireEvent.click(within(filter).getByRole('button', { name: '#原创' }));
  expect(within(filter).getByRole('button', { name: '#原创' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(filter).getByRole('button', { name: '确认' }));
  openCollectionTagManager();
  const manager = screen.getByRole('dialog', { name: '管理标签' });
  fireEvent.click(within(manager).getByRole('button', { name: '重命名标签：原创' }));
  fireEvent.change(within(manager).getByRole('textbox', { name: '标签名称' }), { target: { value: '我的标签' } });
  fireEvent.click(within(manager).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  await waitFor(() => expect(within(view.container.querySelector('header')!).getByRole('button', { name: '移除筛选：#我的标签' })).toBeTruthy());
  fireEvent.click(within(manager).getByRole('button', { name: '关闭' }));
  expect(screen.getByText('已整理角色图')).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择收藏夹：角色设计' }).getAttribute('aria-pressed')).toBe('true');
});
