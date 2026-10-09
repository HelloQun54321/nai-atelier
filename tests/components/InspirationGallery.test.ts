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
it('收藏卡片右上复制图片不选择或打开详情，详情图片保持同位置且底部不重复分享', async () => {
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  const card = within(container).getByText(mockInspirations[0].title).closest('article')!;
  const copy = within(card).getByRole('button', { name: '复制图片' });
  expect(copy.parentElement!.className).toContain('absolute right-2 top-2');
  expect(within(card).getByRole('button', { name: '选择收藏' }).classList.contains('left-2')).toBe(true);
  fireEvent.click(copy);
  await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith(mockInspirations[0].imageUrl, false));
  expect(document.querySelector('[data-agent-page-scope="detail"]')).toBeNull();
  expect(within(card).getByRole('button', { name: '选择收藏' }).classList.contains('bg-indigo-600')).toBe(false);
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
    tags: ['Pixiv'],
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
    expect(within(card).getByText('#' + item.tags![0])).toBeTruthy();
    expect(within(card).queryByText(item.prompt)).toBeNull();
    expect(within(card).queryByText('未整理')).toBeNull();
    expect(card.querySelector('.bottom-2.left-2')).toBeNull();
  }
  expect(screen.queryByText('自动收录')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  expect(within(screen.getByRole('dialog', { name: '加入收藏库' })).queryByText('备注')).toBeNull();
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
    fireEvent.change(within(filter).getByRole('combobox', { name: '标签' }), { target: { value: 'Pixiv' } });
    fireEvent.keyDown(within(filter).getByRole('combobox', { name: '标签' }), { key: 'Enter' });
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
    fireEvent.click(within(filter).getByRole('button', { name: '查看 2 条结果' }));
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
    fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
    expect(screen.getByText('已选 3 项')).toBeTruthy();
    expect(screen.getByText('取消已选 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消全部选择' }));
    expect(screen.queryByText('已选 3 项')).toBeNull();
    expect(screen.getByRole('button', { name: '全选筛选结果' })).toBeTruthy();
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

it('手机长按收藏封面显露选择入口，松手不打开详情，选择后保留批量流程', () => {
  vi.stubGlobal('innerWidth', 390);
  const view = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  const card = view.container.querySelector('.media-card') as HTMLElement;
  const image = card.querySelector('button')!; longPress(image);
  expect(card.getAttribute('data-press-revealed')).toBe('true');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(fireEvent.dragStart(card, { dataTransfer: dragData() })).toBe(false);
  fireEvent.click(within(card).getByRole('button', { name: '选择收藏' }));
  expect(screen.getByText('已选 1 项')).toBeTruthy();
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
  if (width < 768) fireEvent.click(within(root).getByRole('button', { name: '查看 3 条结果' }));
  fireEvent.click(within(screen.getByText(mockInspirations[0].title).closest('article')!).getByRole('button', { name: '选择收藏' }));
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
  fireEvent.click(within(screen.getByText(mockInspirations[0].title).closest('article')!).getByRole('button', { name: '选择收藏' }));
  fireEvent.click(screen.getByRole('button', { name: '取消收藏' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成取消失败', 'error'));
  expect(screen.getByText(mockInspirations[0].title)).toBeTruthy(); expect(screen.getByText('已选 1 项')).toBeTruthy();
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
  const input = within(filter).getByRole('combobox', { name: '标签' });
  expect(document.getElementById(input.getAttribute('list')!)?.querySelector('option[value="冷门标签"]')).toBeTruthy();
  for (const tag of ['逆光', '雨天']) { fireEvent.change(input, { target: { value: tag } }); fireEvent.keyDown(input, { key: 'Enter' }); }
  expect(screen.getByText('匹配')).toBeTruthy(); expect(screen.getByText('其他收藏夹')).toBeTruthy();
  expect(screen.queryByText('缺少雨天')).toBeNull(); expect(screen.queryByText('其他来源')).toBeNull();
  expect(screen.queryByRole('button', { name: '取消筛选：收藏夹：角色设计' })).toBeNull();
  fireEvent.click(within(filter).getByRole('button', { name: '取消筛选：#雨天' }));
  expect(screen.getByText('缺少雨天')).toBeTruthy();
  fireEvent.click(within(filter).getByRole('button', { name: '查看 3 条结果' }));
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
  const input = within(filter).getByRole('combobox', { name: '标签' });
  for (const tag of ['逆光', '雨天']) { fireEvent.change(input, { target: { value: tag } }); fireEvent.keyDown(input, { key: 'Enter' }); }
  fireEvent.click(within(filter).getByRole('button', { name: '查看 2 条结果' }));
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

const dragData = () => ({ setData: vi.fn(), effectAllowed: 'all', dropEffect: 'none' }) as unknown as DataTransfer;
it('拖拽选中的多张作品到收藏夹，一次移动；可拖回未整理，同夹不发请求，外部拖入被忽略', async () => {
  const onRefresh = vi.fn(async () => {});
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh, notify: vi.fn() }));
  const folder = (await screen.findByRole('button', { name: '选择收藏夹：角色设计' })).closest('.press-reveal-surface')!;
  const card = (index: number) => screen.getByText(mockInspirations[index].title).closest('article')!;
  const dataTransfer = dragData();
  fireEvent.drop(folder, { dataTransfer }); expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
  fireEvent.dragStart(card(0), { dataTransfer }); fireEvent.drop(folder, { dataTransfer }); expect(db.bulkUpdateInspirations).not.toHaveBeenCalled();
  for (const index of [1, 2]) fireEvent.click(within(card(index)).getByRole('button', { name: '选择收藏' }));
  fireEvent.dragStart(card(1), { dataTransfer });
  expect(fireEvent.dragOver(folder, { dataTransfer })).toBe(false); expect(dataTransfer.dropEffect).toBe('move'); expect(folder.classList.contains('border-indigo-500')).toBe(true);
  fireEvent.drop(folder, { dataTransfer }); fireEvent.drop(folder, { dataTransfer });
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(db.bulkUpdateInspirations).toHaveBeenCalledExactlyOnceWith(['insp-2', 'insp-3'], { boardId: 'board-1' });
  expect(screen.queryByText('已选 2 项')).toBeNull();
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
  fireEvent.click(within(card).getByRole('button', { name: '选择收藏' }));
  fireEvent.click(within(locked).getByRole('img').closest('button')!);
  expect(screen.getByText('已选 1 项')).toBeTruthy();
  fireEvent.dragStart(card, { dataTransfer }); fireEvent.drop(folder, { dataTransfer });
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成移动失败', 'error'));
  expect(screen.getByText('已选 1 项')).toBeTruthy(); expect(screen.getByText(mockInspirations[1].title)).toBeTruthy(); expect(onRefresh).not.toHaveBeenCalled();
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
  fireEvent.click(within(card).getByRole('button', { name: '选择收藏' })); expect(screen.getByText('已选 3 项')).toBeTruthy();
  fireEvent.click(within(card).getByRole('button', { name: '选择收藏' })); expect(screen.queryByText('已选 3 项')).toBeNull();
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
