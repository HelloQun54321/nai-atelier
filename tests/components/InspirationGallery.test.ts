import { longPress } from '../support/touchEvents';
// @vitest-environment jsdom
import React from 'react';
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

vi.mock('../../services/appearancePreferences', () => ({
  useMobileImageDisplayPreferences: () => ({
    mobileImageAspectRatio: 'auto',
    mobileImageObjectFit: 'contain',
    desktopColumns: 4,
    mobileColumns: 2,
  }),
}));

vi.mock('../../components/useKeepAliveScrollRestore', () => ({
  useKeepAliveScrollRestore: () => vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks(); confirmAction.mockResolvedValue(true);
  vi.mocked(extractMetadata).mockReset().mockResolvedValue(null);
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:synthetic'); static revokeObjectURL = vi.fn(); });
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mockUser: User = {
  id: 'user-1',
  username: 'test-user',
  role: 'user',
  createdAt: 1,
};
it('灵感卡片右上复制图片不选择或打开详情，详情图片保持同位置且底部不重复分享', async () => {
  const { container } = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  const card = within(container).getByText(mockInspirations[0].title).closest('article')!;
  const copy = within(card).getByRole('button', { name: '复制图片' });
  expect(copy.parentElement!.className).toContain('absolute right-2 top-2');
  expect(within(card).getByRole('button', { name: '选择灵感' }).classList.contains('left-2')).toBe(true);
  fireEvent.click(copy);
  await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith(mockInspirations[0].imageUrl, false));
  expect(document.querySelector('[data-agent-page-scope="detail"]')).toBeNull();
  expect(within(card).getByRole('button', { name: '选择灵感' }).classList.contains('bg-indigo-600')).toBe(false);
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

describe('InspirationGallery 来源筛选与未整理心智', () => {
  it('未整理分类正确包含未分配灵感板的卡片（即使有来源标签与备注）', () => {
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

  it('桌面筛选不重复侧栏导航，重置只清除筛选并保留所在分类与搜索', () => {
    render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: /Danbooru\s+1/ }));
    fireEvent.change(screen.getByPlaceholderText('搜索标题、提示词、备注或标签'), { target: { value: '带有标签' } });
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    const filter = screen.getByRole('dialog', { name: '筛选灵感' });
    expect(within(filter).queryByRole('combobox', { name: '分类' })).toBeNull();
    expect(within(filter).queryByRole('combobox', { name: '灵感板' })).toBeNull();
    fireEvent.change(within(filter).getByRole('combobox', { name: '标签' }), { target: { value: 'Pixiv' } });
    expect(screen.queryByText('未整理带有标签的图')).toBeNull();
    expect(screen.getByRole('button', { name: '筛选 1' })).toBeTruthy();
    fireEvent.click(within(filter).getByRole('button', { name: '重置筛选' }));
    expect(screen.getByText('未整理带有标签的图')).toBeTruthy();
    expect(screen.queryByText('Pixiv 收藏图')).toBeNull();
    expect((screen.getByPlaceholderText('搜索标题、提示词、备注或标签') as HTMLInputElement).value).toBe('带有标签');
  });

  it('手机筛选保留分类入口，并与桌面共用条件', () => {
    vi.stubGlobal('innerWidth', 390);
    render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    const filter = screen.getByRole('dialog', { name: '筛选灵感' });
    fireEvent.change(within(filter).getByRole('combobox', { name: '分类' }), { target: { value: 'unorganized' } });
    expect(screen.queryByText('已整理角色图')).toBeNull();
    expect(screen.getByText('未整理带有标签的图')).toBeTruthy();
    expect(screen.getByRole('button', { name: '筛选 1' })).toBeTruthy();
    fireEvent.click(within(filter).getByRole('button', { name: '查看 2 条结果' }));
    vi.stubGlobal('innerWidth', 1280); fireEvent(window, new Event('resize'));
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    expect(screen.getByText('未整理带有标签的图')).toBeTruthy();
    expect(screen.queryByText('已整理角色图')).toBeNull();
    expect(within(screen.getByRole('dialog', { name: '筛选灵感' })).queryByRole('combobox', { name: '分类' })).toBeNull();
  });

  it('全选筛选结果只选当前可编辑资料，取消选择恢复浏览', () => {
    render(React.createElement(InspirationGallery, {
      currentUser: mockUser,
      inspirationsData: [...mockInspirations, { ...mockInspirations[0], id: 'other-user', userId: 'user-2', title: '他人的资料' }],
      onRefresh: vi.fn(), notify: vi.fn(),
    }));
    fireEvent.change(screen.getByPlaceholderText('搜索标题、提示词、备注或标签'), { target: { value: '图' } });
    fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
    expect(screen.getByText('已选 3 项')).toBeTruthy();
    expect(screen.getByText('取消已选 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消全部选择' }));
    expect(screen.queryByText('已选 3 项')).toBeNull();
    expect(screen.getByRole('button', { name: '全选筛选结果' })).toBeTruthy();
  });

  it('手动收录保留独立滚动正文与固定操作区，Esc 关闭且不写入资料', () => {
    render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '加入灵感库' }));
    const dialog = screen.getByRole('dialog', { name: '加入灵感库' });
    expect(dialog.querySelector('header')?.nextElementSibling?.classList.contains('overflow-y-auto')).toBe(true);
    expect(dialog.querySelector('footer')?.classList.contains('flex-none')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '加入灵感库' })).toBeNull();
  });
});

it('实际新建灵感板窗口和颜色选择可被 Agent 读取', async () => {
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  fireEvent.click(await screen.findByRole('button', { name: /新建灵感板/ }));
  const page = readAgentPage({ limit: 20 }); expect(page.title).toBe('新建灵感板');
  expect(page.controls.some(item => item.label.includes('名称') || item.role === 'input')).toBe(true);
  expect(page.controls.filter(item => item.pressed !== undefined)).not.toHaveLength(0);
});

it('手机管理当前灵感板可修改名称与颜色，编辑焦点正确，关闭后回到原筛选面板', async () => {
  vi.stubGlobal('innerWidth', 390);
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  await screen.findByRole('button', { name: '编辑灵感板：角色设计' });
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); const filter = screen.getByRole('dialog', { name: '筛选灵感' });
  fireEvent.click(within(filter).getByRole('button', { name: '选择灵感板：角色设计' }));
  const surface = within(filter).getByRole('button', { name: '选择灵感板：角色设计' }).closest('.press-reveal-surface')!;
  longPress(surface); expect(surface.getAttribute('data-press-revealed')).toBe('true');
  fireEvent.click(within(filter).getByRole('button', { name: '编辑灵感板：角色设计' }));
  const editor = screen.getByRole('dialog', { name: '编辑灵感板' }); const input = within(editor).getByRole('textbox');
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: '新名称' } }); fireEvent.click(within(editor).getByRole('button', { name: '颜色 #ec4899' }));
  fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(db.updateInspirationBoard).toHaveBeenCalledWith('board-1', { name: '新名称', color: '#ec4899' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑灵感板' })).toBeNull());
  expect(screen.getByRole('dialog', { name: '筛选灵感' })).toBe(filter);
});
it.each([390, 1280])('宽度 %s 的灵感板删除可发现且必须确认，取消不删除，确认后回到未整理语义', async width => {
  vi.stubGlobal('innerWidth', width); const refresh = vi.fn();
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: refresh, notify: vi.fn() }));
  await screen.findByRole('button', { name: '编辑灵感板：角色设计' });
  let root: HTMLElement = document.body;
  if (width < 768) {
    fireEvent.click(screen.getByRole('button', { name: '筛选' })); root = screen.getByRole('dialog', { name: '筛选灵感' });
    fireEvent.click(within(root).getByRole('button', { name: '选择灵感板：角色设计' }));
  }
  const remove = () => { const button = within(root).getByRole('button', { name: '删除灵感板：角色设计' }); longPress(button.closest('.press-reveal-surface')!); fireEvent.click(button); };
  confirmAction.mockResolvedValue(false); remove(); await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
  expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ message: '板内灵感不会删除，它们会回到“未整理”。' }));
  expect(db.deleteInspirationBoard).not.toHaveBeenCalled();
  confirmAction.mockResolvedValue(true); remove(); await waitFor(() => expect(db.deleteInspirationBoard).toHaveBeenCalledExactlyOnceWith('board-1'));
  expect(refresh).toHaveBeenCalledOnce();
  if (width < 768) expect(within(root).getByRole('button', { name: '全部灵感板' }).getAttribute('aria-pressed')).toBe('true');
});

it('手机长按灵感封面显露选择入口，松手不打开详情，选择后保留批量流程', () => {
  vi.stubGlobal('innerWidth', 390);
  const view = render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(), notify: vi.fn() }));
  const card = view.container.querySelector('.media-card') as HTMLElement;
  const image = card.querySelector('button')!; longPress(image);
  expect(card.getAttribute('data-press-revealed')).toBe('true');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: '选择灵感' }));
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
  fireEvent.click(screen.getByRole('button', { name: '加入灵感库' }));
  const dialog = screen.getByRole('dialog', { name: '加入灵感库' });
  const file = new File(['synthetic'], 'reference.png', { type: 'image/png' });
  fireEvent.change(within(dialog).getByLabelText('上传灵感图片'), { target: { files: [file] } });
  await waitFor(() => expect((within(dialog).getByRole('button', { name: '加入灵感库' }) as HTMLButtonElement).disabled).toBe(false));
  expect((within(dialog).getByLabelText('提示词') as HTMLTextAreaElement).value).toBe(initialPrompt);
  const savedPrompt = initialPrompt ? 'moonlight, rain' : '';
  if (initialPrompt) fireEvent.change(within(dialog).getByLabelText('提示词'), { target: { value: savedPrompt } });
  fireEvent.click(within(dialog).getByRole('button', { name: '加入灵感库' }));
  await waitFor(() => expect(db.saveInspiration).toHaveBeenCalledOnce());
  expect(api.uploadFile).toHaveBeenCalledWith(file, 'inspirations');
  expect(db.saveInspiration).toHaveBeenCalledWith(expect.objectContaining({
    prompt: savedPrompt, negativePrompt: 'bad anatomy', imageUrl: '/api/assets/synthetic.png',
    params: expect.objectContaining({ model: 'nai-diffusion-4-5-full', width: 1152, height: 768, steps: 24, scale: 6,
      seed: 54321, sampler: 'k_dpmpp_2m', cfgRescale: 0.2, qualityToggle: true, useCoords: true,
      characters: [expect.objectContaining({ prompt: 'blue hair', negativePrompt: 'red hair', x: 0.3, y: 0.7 })] }),
  }));
});

it('换成无元数据图片清除旧配置，旧图片的迟到解析不覆盖当前图，也不伪造默认参数', async () => {
  let resolve!: (value: string | null) => void;
  vi.mocked(extractMetadata).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [], onRefresh: vi.fn(async () => {}), notify: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: '加入灵感库' }));
  const dialog = screen.getByRole('dialog', { name: '加入灵感库' });
  const input = within(dialog).getByLabelText('上传灵感图片');
  fireEvent.change(input, { target: { files: [new File(['first'], 'first.png', { type: 'image/png' })] } });
  expect((within(dialog).getByRole('button', { name: '正在读取图片…' }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(dialog).getByLabelText('提示词') as HTMLTextAreaElement).matches(':disabled')).toBe(true);
  const current = new File(['current'], 'current.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [current] } });
  await waitFor(() => expect((within(dialog).getByRole('button', { name: '加入灵感库' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(within(dialog).getByLabelText('提示词'), { target: { value: 'manual prompt' } });
  await act(async () => resolve(JSON.stringify({ prompt: 'old prompt', width: 1024, height: 1024, seed: 1 })));
  expect((within(dialog).getByLabelText('提示词') as HTMLTextAreaElement).value).toBe('manual prompt');
  fireEvent.click(within(dialog).getByRole('button', { name: '加入灵感库' }));
  await waitFor(() => expect(db.saveInspiration).toHaveBeenCalledWith(expect.objectContaining({ title: 'current', prompt: 'manual prompt', negativePrompt: '', params: undefined })));
  expect(api.uploadFile).toHaveBeenCalledWith(current, 'inspirations');
});

it('换图清除已解析参数，保存失败保留当前图片和解析结果供重试', async () => {
  vi.mocked(extractMetadata).mockResolvedValueOnce(JSON.stringify({ prompt: 'first', width: 1024, height: 1024, seed: 10 }));
  vi.mocked(db.saveInspiration).mockRejectedValueOnce(new Error('合成保存失败'));
  const notify = vi.fn();
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: [], onRefresh: vi.fn(async () => {}), notify }));
  fireEvent.click(screen.getByRole('button', { name: '加入灵感库' }));
  const dialog = screen.getByRole('dialog', { name: '加入灵感库' });
  const input = within(dialog).getByLabelText('上传灵感图片');
  fireEvent.change(input, { target: { files: [new File(['first'], 'first.png', { type: 'image/png' })] } });
  await waitFor(() => expect((within(dialog).getByLabelText('提示词') as HTMLTextAreaElement).value).toBe('first'));
  fireEvent.click(within(dialog).getByRole('button', { name: '加入灵感库' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成保存失败', 'error'));
  expect(db.saveInspiration).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ seed: 10 }) }));
  expect(screen.getByRole('dialog', { name: '加入灵感库' })).toBe(dialog);
  fireEvent.change(input, { target: { files: [new File(['next'], 'next.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect((within(dialog).getByRole('button', { name: '加入灵感库' }) as HTMLButtonElement).disabled).toBe(false));
  expect((within(dialog).getByLabelText('提示词') as HTMLTextAreaElement).value).toBe('');
  fireEvent.click(within(dialog).getByRole('button', { name: '加入灵感库' }));
  await waitFor(() => expect(db.saveInspiration).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'next', params: undefined })));
});

it.each([390, 1280])('宽度 %s 可归档、查看已归档并恢复，归档不会删除资料', async width => {
  vi.stubGlobal('innerWidth', width);
  const props = { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: vi.fn(async () => {}), notify: vi.fn() };
  const view = render(React.createElement(InspirationGallery, props));
  const card = screen.getByText(mockInspirations[0].title).closest('article')!;
  fireEvent.click(within(card).getByRole('button', { name: '选择灵感' }));
  fireEvent.click(screen.getByRole('button', { name: '归档' }));
  await waitFor(() => expect(props.onRefresh).toHaveBeenCalledOnce());
  expect(db.bulkUpdateInspirations).toHaveBeenCalledWith(['insp-1'], { archived: true });
  const archived = mockInspirations.map(item => item.id === 'insp-1' ? { ...item, archived: true } : item);
  view.rerender(React.createElement(InspirationGallery, { ...props, inspirationsData: archived }));
  expect(screen.queryByText(mockInspirations[0].title)).toBeNull();
  if (width < 768) {
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    const filter = screen.getByRole('dialog', { name: '筛选灵感' });
    fireEvent.change(within(filter).getByRole('combobox', { name: '分类' }), { target: { value: 'archived' } });
    fireEvent.click(within(filter).getByRole('button', { name: '查看 1 条结果' }));
  } else fireEvent.click(screen.getByRole('button', { name: /已归档\s+1/ }));
  expect(screen.queryByText(mockInspirations[1].title)).toBeNull();
  fireEvent.click(within(screen.getByText(mockInspirations[0].title).closest('article')!).getByRole('button', { name: '选择灵感' }));
  fireEvent.click(screen.getByRole('button', { name: '恢复到资料库' }));
  await waitFor(() => expect(props.onRefresh).toHaveBeenCalledTimes(2));
  expect(db.bulkUpdateInspirations).toHaveBeenLastCalledWith(['insp-1'], { archived: false });
  view.rerender(React.createElement(InspirationGallery, props));
  expect(screen.queryByText(mockInspirations[0].title)).toBeNull();
  expect(screen.getByRole('heading', { name: '已归档' })).toBeTruthy();
  expect(confirmAction).not.toHaveBeenCalled();
});

it('归档失败保留条目和选择，显示失败且不误报成功', async () => {
  vi.mocked(db.bulkUpdateInspirations).mockRejectedValueOnce(new Error('合成归档失败'));
  const notify = vi.fn(), refresh = vi.fn(async () => {});
  render(React.createElement(InspirationGallery, { currentUser: mockUser, inspirationsData: mockInspirations, onRefresh: refresh, notify }));
  fireEvent.click(within(screen.getByText(mockInspirations[0].title).closest('article')!).getByRole('button', { name: '选择灵感' }));
  fireEvent.click(screen.getByRole('button', { name: '归档' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成归档失败', 'error'));
  expect(screen.getByText(mockInspirations[0].title)).toBeTruthy();
  expect(screen.getByText('已选 1 项')).toBeTruthy();
  expect(refresh).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalledWith('已归档');
});
