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
vi.mock('../../services/api', async original => {
  const actual = await original<typeof import('../../services/api')>();
  return { ...actual, api: { ...actual.api, uploadFile: vi.fn(async () => ({ url: '/api/assets/synthetic.png' })) } };
});
vi.mock('../../services/metadataService', async original => ({ ...await original<typeof import('../../services/metadataService')>(), extractMetadata: vi.fn(async () => null) }));
vi.mock('../../services/imageSharing', async original => ({ ...await original<typeof import('../../services/imageSharing')>(), copySharedImage: vi.fn(async () => {}) }));
const { confirmAction } = vi.hoisted(() => ({ confirmAction: vi.fn() }));

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
    deleteInspirationBoard: vi.fn(),
    saveInspiration: vi.fn(async () => {}),
    bulkUpdateInspirations: vi.fn(async () => {}),
    bulkDeleteInspirations: vi.fn(async () => {}),
  },
}));

vi.mock('../../components/SmartImage', () => ({
  ImageActivityContext: React.createContext(true),
  SmartImage: ({ thumbnailVariant: _thumbnailVariant, ...props }: any) => React.createElement('img', props),
  OriginalImage: (props: any) => React.createElement('img', props),
}));

vi.mock('../../components/ConfirmDialog', () => ({
  useConfirmDialog: () => confirmAction,
}));


vi.mock('../../components/useKeepAliveScrollRestore', () => ({
  useKeepAliveScrollRestore: () => vi.fn(),
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
  vi.clearAllMocks(); localStorage.clear(); confirmAction.mockResolvedValue(true);
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete document.documentElement.dataset.motion; });

const mockUser: User = {
  id: 'user-1',
  username: 'test-user',
  role: 'user',
  createdAt: 1,
};

it.each([390, 1280])('宽度 %s：收藏未读取时显示加载中，读取完成后才显示空状态或作品', width => {
  vi.stubGlobal('innerWidth', width);
  const props = { currentUser: mockUser, onRefresh: vi.fn(), notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, { ...props, inspirationsData: null }));
  expect(screen.getByRole('status').textContent).toContain('加载中…');
  expect(screen.queryByText('这里还没有匹配的收藏')).toBeNull();
  expect(screen.queryByRole('button', { name: '加入第一条收藏' })).toBeNull();
  view.rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: [] }));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByText('这里还没有匹配的收藏')).toBeTruthy();
  expect(screen.getByRole('button', { name: '加入第一条收藏' })).toBeTruthy();
  view.rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: mockInspirations }));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('button', { name: '加入第一条收藏' })).toBeNull();
  expect(view.container.querySelectorAll('article')).toHaveLength(mockInspirations.length);
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
  fireEvent.click(screen.getByRole('button', { name: '管理' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '收藏管理' })).getByRole('button', { name: '管理标签' }));
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
  fireEvent.click(screen.getByRole('button', { name: '管理' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '收藏管理' })).getByRole('button', { name: '管理标签' }));
  await screen.findByText('#构图分类');
  cleanup(); vi.mocked(db.getCollectionTagNames).mockRejectedValueOnce(new Error('合成加载失败'));
  render(React.createElement(InspirationGallery, props));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成加载失败', 'error'));
  fireEvent.click(screen.getByRole('button', { name: '管理' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '收藏管理' })).getByRole('button', { name: '管理标签' }));
  expect((screen.getByRole('button', { name: '添加标签' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载标签' }));
  await screen.findByText('#构图分类'); expect(db.saveCollectionTagNames).toHaveBeenCalledOnce();
});
const enterCollectionSelection = () => {
  fireEvent.click(screen.getByRole('button', { name: '管理' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '收藏管理' })).getByRole('button', { name: '批量选择图片' }));
};
const selectCollectionCard = (card: HTMLElement) => {
  if (screen.queryByRole('button', { name: '管理' })) enterCollectionSelection();
  fireEvent.click(within(card).getByRole('button', { name: '选择收藏' }));
};

it('收藏卡片右上复制图片不选择或打开详情，详情图片保持同位置且底部不重复分享', async () => {
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  const card = within(container).getByText(mockInspirations[0].title).closest('article')!;
  const copy = within(card).getByRole('button', { name: '复制图片' });
  expect(copy.parentElement!.className).toContain('absolute right-2 top-2');
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
  expect(detailCopy.parentElement!.className).toContain('absolute right-2 top-2');
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

it('列表移除重复标题栏，收窄侧栏；卡片只保留名称和标签，图片左下不遮挡', () => {
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  expect(container.querySelector('main h1')).toBeNull();
  const sidebar = container.querySelector('aside')!;
  expect(sidebar.classList.contains('w-44')).toBe(true);
  expect(sidebar.classList.contains('hidden')).toBe(true); expect(sidebar.classList.contains('md:block')).toBe(true);
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

it('收藏搜索不再匹配备注；详情接收文生图排序，调整后即时生效', async () => {
  const props = { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, { ...props, labModuleOrder: ['negative', 'params', 'prompt'] }));
  const card = screen.getByText(mockInspirations[0].title).closest('article')!;
  fireEvent.click(within(card).getByRole('img').closest('button')!);
  const sections = () => Array.from(view.container.querySelectorAll('[data-collection-section]'), element => element.getAttribute('data-collection-section'));
  expect(sections()).toEqual(['tags', 'negative', 'params', 'prompt']);
  view.rerender(React.createElement(InspirationGallery, { ...props, labModuleOrder: ['prompt', 'params', 'negative'] }));
  expect(sections()).toEqual(['tags', 'prompt', 'params', 'negative']);
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.change(screen.getByPlaceholderText('搜索标题、提示词或标签…'), { target: { value: '自动收录' } });
  await waitFor(() => expect(screen.getByText('这里还没有匹配的收藏')).toBeTruthy());
});

describe('InspirationGallery 来源筛选与未整理心智', () => {
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
    expect(screen.getByRole('button', { name: '管理' })).toBeTruthy();
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

it('实际新建收藏夹窗口和颜色选择可被 Agent 读取', async () => {
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  fireEvent.click(await screen.findByRole('button', { name: /新建收藏夹/ }));
  const page = readAgentPage({ limit: 20 }); expect(page.title).toBe('新建收藏夹');
  expect(page.controls.some(item => item.label.includes('名称') || item.role === 'input')).toBe(true);
  expect(page.controls.filter(item => item.pressed !== undefined)).not.toHaveLength(0);
});

it('手机管理当前收藏夹可修改名称与颜色，编辑焦点正确，关闭后回到原筛选面板', async () => {
  vi.stubGlobal('innerWidth', 390);
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  await screen.findByRole('button', { name: '编辑收藏夹：角色设计' });
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); const filter = screen.getByRole('dialog', { name: '筛选收藏' });
  fireEvent.click(within(filter).getByRole('button', { name: '选择收藏夹：角色设计' }));
  const surface = within(filter).getByRole('button', { name: '选择收藏夹：角色设计' }).closest('.press-reveal-surface')!;
  longPress(surface); expect(surface.getAttribute('data-press-revealed')).toBe('true');
  fireEvent.click(within(filter).getByRole('button', { name: '编辑收藏夹：角色设计' }));
  const editor = screen.getByRole('dialog', { name: '编辑收藏夹' }); const input = within(editor).getByRole('textbox');
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: '新名称' } }); fireEvent.click(within(editor).getByRole('button', { name: '颜色 #ec4899' }));
  fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(db.updateInspirationBoard).toHaveBeenCalledWith('board-1', { name: '新名称', color: '#ec4899' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑收藏夹' })).toBeNull());
  expect(screen.getByRole('dialog', { name: '筛选收藏' })).toBe(filter);
});
it.each([390, 1280])('宽度 %s 的收藏夹删除可发现且必须确认，取消不删除，确认后回到未整理语义', async width => {
  vi.stubGlobal('innerWidth', width); const refresh = vi.fn();
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: refresh, notify: vi.fn() }));
  await screen.findByRole('button', { name: '编辑收藏夹：角色设计' });
  let root: HTMLElement = document.body;
  if (width < 768) {
    fireEvent.click(screen.getByRole('button', { name: '筛选' })); root = screen.getByRole('dialog', { name: '筛选收藏' });
    fireEvent.click(within(root).getByRole('button', { name: '选择收藏夹：角色设计' }));
  }
  const remove = () => { const button = within(root).getByRole('button', { name: '删除收藏夹：角色设计' }); longPress(button.closest('.press-reveal-surface')!); fireEvent.click(button); };
  confirmAction.mockResolvedValue(false); remove(); await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
  expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ message: '收藏夹内作品不会删除，它们会回到“未整理”。' }));
  expect(db.deleteInspirationBoard).not.toHaveBeenCalled();
  confirmAction.mockResolvedValue(true); remove(); await waitFor(() => expect(db.deleteInspirationBoard).toHaveBeenCalledExactlyOnceWith('board-1'));
  expect(refresh).toHaveBeenCalledOnce();
  if (width < 768) expect(within(root).getByRole('button', { name: /全部\s+3/ }).getAttribute('aria-pressed')).toBe('true');
});

it('手机长按只显露删除，松手不打开详情；批量选择必须从管理进入', () => {
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
  const savedPrompt = initialPrompt ? 'moonlight, rain' : '';
  if (initialPrompt) fireEvent.change(within(dialog).getByLabelText('提示词'), { target: { value: savedPrompt } });
  await waitFor(() => expect(within(dialog).getByRole('option', { name: '角色设计' })).toBeTruthy());
  fireEvent.change(within(dialog).getByRole('combobox', { name: '收藏夹' }), { target: { value: 'board-1' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(db.saveInspiration).toHaveBeenCalledOnce());
  expect(api.uploadFile).toHaveBeenCalledWith(file, 'inspirations');
  expect(db.saveInspiration).toHaveBeenCalledWith(expect.objectContaining({
    boardId: 'board-1', prompt: savedPrompt, negativePrompt: 'bad anatomy', imageUrl: '/api/assets/synthetic.png',
    params: expect.objectContaining({ model: 'nai-diffusion-4-5-full', width: 1152, height: 768, steps: 24, scale: 6,
      seed: 54321, sampler: 'k_dpmpp_2m', cfgRescale: 0.2, qualityToggle: true, useCoords: true,
      characters: [expect.objectContaining({ prompt: 'blue hair', negativePrompt: 'red hair', x: 0.3, y: 0.7 })] }),
  }));
});

it('换成无元数据图片清除旧配置，旧图片的迟到解析不覆盖当前图，也不伪造默认参数', async () => {
  let resolve!: (value: string | null) => void;
  vi.mocked(extractMetadata).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [], onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  const dialog = screen.getByRole('dialog', { name: '加入收藏库' });
  const input = within(dialog).getByLabelText('上传收藏图片');
  fireEvent.change(input, { target: { files: [new File(['first'], 'first.png', { type: 'image/png' })] } });
  expect((within(dialog).getByRole('button', { name: '正在读取图片…' }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(dialog).getByLabelText('提示词') as HTMLTextAreaElement).matches(':disabled')).toBe(true);
  const current = new File(['current'], 'current.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [current] } });
  await waitFor(() => expect((within(dialog).getByRole('button', { name: '加入收藏库' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(within(dialog).getByLabelText('提示词'), { target: { value: 'manual prompt' } });
  await act(async () => resolve(JSON.stringify({ prompt: 'old prompt', width: 1024, height: 1024, seed: 1 })));
  expect((within(dialog).getByLabelText('提示词') as HTMLTextAreaElement).value).toBe('manual prompt');
  fireEvent.click(within(dialog).getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(db.saveInspiration).toHaveBeenCalledWith(expect.objectContaining({ title: 'current', prompt: 'manual prompt', negativePrompt: '', params: undefined })));
  expect(api.uploadFile).toHaveBeenCalledWith(current, 'inspirations');
});

it('换图清除已解析参数，保存失败保留当前图片和解析结果供重试', async () => {
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
  const sections = ['全局', '来源', '自定义收藏夹'].map(text => within(root).getByText(text));
  expect(sections[0].compareDocumentPosition(sections[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(sections[1].compareDocumentPosition(sections[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
  const tags = within(field).getByRole('group', { name: '标签（同时满足）' });
  expect(within(tags).getAllByRole('button')).toHaveLength(2);
  expect(tags.classList.contains('max-w-[50%]')).toBe(true);
  expect(tags.classList.contains('overflow-x-auto')).toBe(true);
  expect(tags.classList.contains('flex-wrap')).toBe(false);
  expect(screen.queryByRole('group', { name: '当前筛选' })).toBeNull();
  expect(screen.getByRole('button', { name: '筛选 2' })).toBeTruthy();
  expect(container.querySelectorAll('article')).toHaveLength(2);
  search.focus(); fireEvent.change(search, { target: { value: '晚霞' } });
  await waitFor(() => expect(container.querySelectorAll('article')).toHaveLength(1));
  expect(screen.getByText('匹配晚霞')).toBeTruthy();
  fireEvent.click(within(tags).getByRole('button', { name: '取消筛选：#雨天' }));
  expect(container.querySelectorAll('article')).toHaveLength(2);
  expect(search.value).toBe('晚霞');
  expect(screen.getByRole('button', { name: '筛选 1' })).toBeTruthy();
  fireEvent.click(within(tags).getByRole('button', { name: '取消筛选：#逆光' }));
  expect(screen.getByRole('searchbox')).toBe(search);
  expect(search.parentElement).toBe(field); expect(document.activeElement).toBe(search);
  expect(search.value).toBe('晚霞');
  expect(within(field).queryByRole('group')).toBeNull();
  expect(container.querySelectorAll('article')).toHaveLength(2);
  fireEvent.change(search, { target: { value: '' } });
  await waitFor(() => expect(container.querySelectorAll('article')).toHaveLength(3));
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
  expect(within(header).getByRole('combobox', { name: '移动到收藏夹' })).toBeTruthy();
  expect(within(header).getByRole('textbox', { name: '添加标签' })).toBeTruthy();
  expect(within(header).getByRole('button', { name: '取消收藏' }).classList.contains('mobile-touch')).toBe(true);
  expect(within(header).getByRole('button', { name: '退出多选' }).classList.contains('mobile-touch')).toBe(true);
  expect(within(header).queryByRole('searchbox')).toBeNull(); expect(within(header).queryByRole('button', { name: '筛选' })).toBeNull();
  expect(main.firstElementChild).toBe(content); expect(main.querySelector('.sticky')).toBeNull(); expect(main.scrollTop).toBe(420);
  expect(screen.getByText('已整理角色图').closest('article')).toBe(card);
  fireEvent.click(within(header).getByRole('button', { name: '退出多选' }));
  expect((within(header).getByRole('searchbox') as HTMLInputElement).value).toBe('图');
  expect(within(header).getByRole('button', { name: '取消筛选：#原创' })).toBeTruthy();
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
    const handle = within(row).getByRole('button', { name: /排序收藏夹/ });
    handle.setPointerCapture = vi.fn(); handle.releasePointerCapture = vi.fn();
  });
};

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
it('拖拽选中的多张作品到收藏夹，一次移动；可拖回未整理，同夹不发请求，外部拖入被忽略', async () => {
  const onRefresh = vi.fn(async () => {});
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh, notify: vi.fn() }));
  const folder = (await screen.findByRole('button', { name: '选择收藏夹：角色设计' })).closest('.press-reveal-surface')!;
  const card = (index: number) => screen.getByText(mockInspirations[index].title).closest('article')!;
  const dataTransfer = dragData();
  fireEvent.drop(folder, { dataTransfer }); expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
  fireEvent.dragStart(card(0), { dataTransfer }); fireEvent.drop(folder, { dataTransfer }); expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
  for (const index of [1, 2]) selectCollectionCard(card(index));
  fireEvent.dragStart(card(1), { dataTransfer });
  expect(fireEvent.dragOver(folder, { dataTransfer })).toBe(false); expect(dataTransfer.dropEffect).toBe('move'); expect(folder.classList.contains('border-indigo-500')).toBe(true);
  fireEvent.drop(folder, { dataTransfer }); fireEvent.drop(folder, { dataTransfer });
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(db.bulkUpdateInspirations).toHaveBeenCalledExactlyOnceWith(['insp-2', 'insp-3'], { boardId: 'board-1' });
  expect(screen.queryByText('已选 2 个作品，共 2 页')).toBeNull();
  const unorganized = screen.getByRole('button', { name: /未整理\s+2/ });
  fireEvent.dragStart(card(0), { dataTransfer }); fireEvent.drop(unorganized, { dataTransfer });
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2));
  expect(db.bulkUpdateInspirations).toHaveBeenLastCalledWith(['insp-1'], { boardId: '' });
});

it('取消拖拽、只读作品不能移动；保存失败保留作品与选择，能够重试', async () => {
  vi.mocked(db.bulkUpdateInspirations).mockRejectedValueOnce(new Error('合成移动失败'));
  const notify = vi.fn(), onRefresh = vi.fn(async () => {});
  const readOnly = { ...mockInspirations[2], id: 'read-only', title: '只读作品', userId: 'other' };
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [...mockInspirations, readOnly], onRefresh, notify }));
  const folder = (await screen.findByRole('button', { name: '选择收藏夹：角色设计' })).closest('.press-reveal-surface')!;
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
  fireEvent.change(screen.getByRole('combobox', { name: '移动到收藏夹' }), { target: { value: 'board-1' } });
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(db.bulkUpdateInspirations).toHaveBeenLastCalledWith(['insp-2'], { boardId: 'board-1' });
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

it('收藏单张和多图组沿用 AITag 聚焦居中，切换及关闭保留位置，不写整理数据', () => {
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [...groupedImages, mockInspirations[0]], onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  const cards = Array.from(container.querySelectorAll('article'));
  const { root, scrollCalls } = mockGalleryGeometry(cards);
  cards.forEach(card => expect(card.className).not.toContain('brightness-'));
  fireEvent.click(within(cards[0]).getByRole('img').closest('button')!);
  expect(root.scrollTop).toBe(1650);
  expect(scrollCalls).toContainEqual({ top: 1650, behavior: 'smooth' });
  expect(cards[0].className).not.toContain('brightness-');
  expect(cards[1].className).toContain('brightness-[.7]');
  fireEvent.click(within(cards[1]).getByRole('img').closest('button')!);
  expect(root.scrollTop).toBe(2450);
  expect(cards[0].className).toContain('brightness-[.7]');
  expect(cards[1].className).not.toContain('brightness-');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(root.scrollTop).toBe(2450);
  cards.forEach(card => expect(card.className).not.toContain('brightness-'));
  expect(db.updateInspiration).not.toHaveBeenCalled();
  expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
});

it('作品组可整组选中和拖入收藏夹；在未整理筛选内移动不带走其他夹的组员，展开仍能看全组', async () => {
  const onRefresh = vi.fn(async () => {});
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: groupedImages, onRefresh, notify: vi.fn() }));
  const folder = (await screen.findByRole('button', { name: '选择收藏夹：角色设计' })).closest('.press-reveal-surface')!;
  const card = screen.getByText('我的作品组').closest('article')!;
  selectCollectionCard(card); expect(screen.getByText('已选 1 个作品，共 3 页')).toBeTruthy();
  selectCollectionCard(card); expect(screen.queryByText('已选 1 个作品，共 3 页')).toBeNull();
  const dataTransfer = dragData(); fireEvent.dragStart(card, { dataTransfer }); fireEvent.drop(folder, { dataTransfer });
  await waitFor(() => expect(db.bulkUpdateInspirations).toHaveBeenCalledWith(expect.arrayContaining(['group-0', 'group-1', 'group-2']), { boardId: 'board-1' }));
  cleanup(); vi.clearAllMocks();
  const splitGroup = groupedImages.map(image => image.id === 'group-0' ? { ...image, boardId: 'board-1' } : image);
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: splitGroup, onRefresh, notify: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: /未整理\s+2/ }));
  const filteredCard = screen.getByText('我的作品组').closest('article')!;
  expect(within(filteredCard).getByText('2页')).toBeTruthy();
  const target = (await screen.findByRole('button', { name: '选择收藏夹：角色设计' })).closest('.press-reveal-surface')!;
  fireEvent.dragStart(filteredCard, { dataTransfer: dragData() }); fireEvent.drop(target, { dataTransfer: dragData() });
  await waitFor(() => expect(db.bulkUpdateInspirations).toHaveBeenCalledWith(expect.arrayContaining(['group-1', 'group-2']), { boardId: 'board-1' }));
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

it.each([390, 1280])('宽度 %s：管理面板显式进入多选，空选择保持模式，切换不重建图片', width => {
  vi.stubGlobal('innerWidth', width);
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  const card = screen.getByText(mockInspirations[0].title).closest('article')!;
  const image = within(card).getByRole('img');
  const imageButton = image.closest('button')!;
  expect(within(card).getByRole('button', { name: '删除收藏' }).className).toContain('bg-red-500');
  expect(within(card).queryByRole('button', { name: '选择收藏' })).toBeNull();
  expect(screen.queryByRole('button', { name: '全选筛选结果' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '管理' }));
  const panel = screen.getByRole('dialog', { name: '收藏管理' });
  expect(panel.classList.contains('mobile-sheet')).toBe(width < 768);
  expect(panel.classList.contains('fixed')).toBe(width >= 768);
  fireEvent.click(within(panel).getByRole('button', { name: '批量选择图片' }));
  expect(screen.queryByRole('dialog', { name: '收藏管理' })).toBeNull();
  expect(screen.getByText('已选 0 个作品，共 0 页')).toBeTruthy();
  expect((screen.getByRole('button', { name: '取消收藏' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('combobox', { name: '移动到收藏夹' }) as HTMLSelectElement).disabled).toBe(true);
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
  expect(screen.getByRole('button', { name: '管理' })).toBeTruthy();
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
  expect(screen.getByRole('button', { name: '管理' })).toBeTruthy();
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
  expect(screen.getByRole('button', { name: '管理' })).toBeTruthy();
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


it.each([390, 1280])('宽度 %s：管理标签排第一项，没有失效检查或重复收藏夹管理', width => {
  vi.stubGlobal('innerWidth', width);
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: '管理' }));
  const menu = screen.getByRole('dialog', { name: '收藏管理' });
  expect(within(menu).getAllByRole('button').filter(button => button.textContent !== '').map(button => button.textContent)).toEqual(['管理标签', '批量选择图片']);
  fireEvent.click(within(menu).getByRole('button', { name: '管理标签' }));
  expect(screen.queryByRole('dialog', { name: '收藏管理' })).toBeNull();
  const manager = screen.getByRole('dialog', { name: '管理标签' });
  expect(within(manager).getByText('#原创')).toBeTruthy();
  expect(within(manager).queryByText('#生成历史')).toBeNull();
  fireEvent.click(within(manager).getByRole('button', { name: '关闭' }));
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
  expect(screen.getByRole('button', { name: '管理' })).toBeTruthy();
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
  fireEvent.click(screen.getByRole('button', { name: '管理' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '收藏管理' })).getByRole('button', { name: '管理标签' }));
  const manager = screen.getByRole('dialog', { name: '管理标签' });
  fireEvent.click(within(manager).getByRole('button', { name: '重命名标签：原创' }));
  fireEvent.change(within(manager).getByRole('textbox', { name: '标签名称' }), { target: { value: '我的标签' } });
  fireEvent.click(within(manager).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  await waitFor(() => expect(within(view.container.querySelector('header')!).getByRole('button', { name: '取消筛选：#我的标签' })).toBeTruthy());
  fireEvent.click(within(manager).getByRole('button', { name: '关闭' }));
  expect(screen.getByText('已整理角色图')).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择收藏夹：角色设计' }).getAttribute('aria-pressed')).toBe('true');
});
