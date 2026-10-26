// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollectionImportDialog } from '../../../components/inspiration/CollectionImportDialog';
import type { InspirationBoard, User } from '../../../types';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), save: vi.fn(), extract: vi.fn() }));
vi.mock('../../../services/api', () => ({ api: { uploadFile: mocks.upload } }));
vi.mock('../../../services/dbService', () => ({ db: { saveInspiration: mocks.save } }));
vi.mock('../../../services/metadataService', async original => ({ ...await original<typeof import('../../../services/metadataService')>(), extractMetadata: mocks.extract }));
const user: User = { id: 'synthetic-user', username: 'synthetic', role: 'user', createdAt: 1 };
const boards: InspirationBoard[] = [{ id: 'folder', userId: user.id, name: '合成收藏夹', color: '#6366f1', sortOrder: 0, createdAt: 1, updatedAt: 1 }];
const file = (name: string, type = 'image/png') => new File(['synthetic-' + name], name, { type, lastModified: 1 });
const metadata = (seed: number, prompt: string) => JSON.stringify({ model: 'nai-diffusion-4-5-full', width: 1152, height: 768, steps: 24, scale: 6, seed, sampler: 'k_dpmpp_2m', cfg_rescale: 0.2,
  v4_prompt: { use_coords: true, caption: { base_caption: prompt, char_captions: [{ char_caption: 'character-' + seed, centers: [{ x: 0.3, y: 0.7 }] }] } },
  v4_negative_prompt: { caption: { base_caption: 'negative-' + seed, char_captions: [{ char_caption: 'character-negative-' + seed }] } },
});
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  mocks.upload.mockImplementation(async (image: File) => ({ url: '/synthetic/' + image.name }));
  mocks.save.mockResolvedValue(undefined); mocks.extract.mockResolvedValue(null);
  let url = 0;
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:synthetic-' + ++url); static revokeObjectURL = vi.fn(); });
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const setup = (initialFiles: File[] = []) => {
  const props = { currentUser: user, boards, tagSuggestions: ['构图', '光影'], initialFiles, initialBoardId: '', onClose: vi.fn(), onRefresh: vi.fn(async () => {}), notify: vi.fn() };
  const view = render(<CollectionImportDialog {...props} />);
  return { ...view, ...props, props };
};
const add = (files: File[]) => fireEvent.change(screen.getByLabelText('上传收藏图片'), { target: { files } });
const ready = () => waitFor(() => expect((screen.getByRole('button', { name: '加入收藏库' }) as HTMLButtonElement).disabled).toBe(false));
const choose = (name: string) => fireEvent.click(screen.getByRole('button', { name: '选择候选：' + name }));
const openInfo = () => {
  const summary = screen.getByText('生成信息（可选）');
  if (!(summary.closest('details') as HTMLDetailsElement).open) fireEvent.click(summary);
};

it('导入图片可同时选择多个收藏夹，并保留起始收藏夹', async () => {
  const second = { ...boards[0], id: 'second', name: '第二收藏夹' };
  const props = { currentUser: user, boards: [...boards, second], tagSuggestions: [], initialFiles: [file('multi-folder.png')], initialBoardId: 'folder', onClose: vi.fn(), onRefresh: vi.fn(async () => {}), notify: vi.fn() };
  render(<CollectionImportDialog {...props} />); await ready();
  fireEvent.click(screen.getByRole('button', { name: '收藏夹' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '第二收藏夹' }));
  expect((screen.getByRole('checkbox', { name: '合成收藏夹' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(screen.getByRole('dialog', { name: '收藏夹' })).getByRole('button', { name: '完成' }));
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ boardIds: ['folder', 'second'] })));
});

it('手机导入内打开收藏夹后，返回只关闭最上层，保留候选与导入窗口', async () => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(max-width: 1279px)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  window.history.replaceState({}, '');
  const { onClose } = setup([file('mobile-folder.png')]); await ready();
  await waitFor(() => expect(window.history.state.__naiMobileLayers).toHaveLength(1));
  const parentState = window.history.state;
  fireEvent.click(screen.getByRole('button', { name: '收藏夹' }));
  await waitFor(() => expect(window.history.state.__naiMobileLayers).toHaveLength(2));
  act(() => { window.history.replaceState(parentState, ''); window.dispatchEvent(new PopStateEvent('popstate', { state: parentState })); });
  expect(screen.queryByRole('dialog', { name: '收藏夹' })).toBeNull();
  expect(screen.getByRole('dialog', { name: '加入收藏库' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择候选：mobile-folder.png' })).toBeTruthy(); expect(onClose).not.toHaveBeenCalled();
  window.history.replaceState({}, '');
});

it.each([390, 1280])('宽度 %s 的空状态以一个可点击拖入区填满正文，保留固定外框、设置组和操作区', width => {
  vi.stubGlobal('innerWidth', width);
  const trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus();
  const { unmount, container, onClose } = setup();
  const dialog = screen.getByRole('dialog', { name: '加入收藏库' });
  expect(container.contains(dialog)).toBe(false); expect(dialog.classList.contains('operation-dialog')).toBe(true);
  expect(dialog.querySelector('header')!.nextElementSibling!.classList.contains('overflow-y-auto')).toBe(true);
  expect(dialog.querySelector('ul')).toBeNull(); expect(dialog.querySelector('fieldset')).toBeNull();
  const picker = screen.getByRole('button', { name: '选择或拖入图片' });
  expect(picker.className).toContain('flex-1'); expect(picker.className).toContain('min-h-64');
  expect(picker.className).toContain('items-center'); expect(picker.className).toContain('justify-center');
  expect(within(picker).getByText('PNG / JPEG / WebP，最多 12 MB')).toBeTruthy();
  expect(screen.getAllByText('PNG / JPEG / WebP，最多 12 MB')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '追加图片' })).toBeNull();
  const settings = screen.getByRole('button', { name: '收藏夹' }).closest('label')!.parentElement!;
  expect(settings.contains(screen.getByRole('textbox', { name: '公共标签' }))).toBe(true);
  expect(settings.classList.contains('sm:grid-cols-2')).toBe(true);
  const input = screen.getByLabelText('上传收藏图片'); const click = vi.spyOn(input, 'click');
  fireEvent.click(picker); expect(click).toHaveBeenCalledOnce();
  expect(dialog.querySelector('footer')!.classList.contains('flex-none')).toBe(true);
  expect((screen.getByLabelText('上传收藏图片') as HTMLInputElement).multiple).toBe(true);
  expect((screen.getByRole('button', { name: '加入收藏库' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
  unmount(); expect(document.activeElement).toBe(trigger); trigger.remove();
});

it.each([390, 1280])('宽度 %s 选入图片后才展示候选编辑布局，追加入口与设置对齐并保留44px触控区', async width => {
  vi.stubGlobal('innerWidth', width);
  setup([file('layout.png')]); await ready();
  const dialog = screen.getByRole('dialog');
  expect(screen.queryByRole('button', { name: '选择或拖入图片' })).toBeNull();
  const candidates = screen.getByRole('list');
  expect(candidates.classList.contains('max-h-64')).toBe(true); expect(candidates.classList.contains('overflow-y-auto')).toBe(true);
  expect(candidates.parentElement!.classList.contains('md:grid-cols-[260px_1fr]')).toBe(true);
  expect(dialog.querySelector('fieldset')).toBeTruthy();
  const append = screen.getByRole('button', { name: '追加图片' });
  expect(append.parentElement!.classList.contains('items-end')).toBe(true);
  expect(append.parentElement!.contains(screen.getByRole('button', { name: '收藏夹' }))).toBe(true);
  expect(append.parentElement!.contains(screen.getByRole('textbox', { name: '公共标签' }))).toBe(true);
  expect(append.className).toContain('!h-11'); expect(append.className).toContain('!w-11');
  expect(screen.getByRole('button', { name: '收藏夹' }).classList.contains('h-11')).toBe(true);
  expect(screen.getByRole('textbox', { name: '公共标签' }).closest('span')!.classList.contains('h-11')).toBe(true);
  const click = vi.spyOn(screen.getByLabelText('上传收藏图片'), 'click'); fireEvent.click(append); expect(click).toHaveBeenCalledOnce();
  add([file('appended.png')]); await ready();
  expect(screen.getAllByRole('button', { name: /^选择候选：/ })).toHaveLength(2);
  expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('appended');
});

it('追加20张时只滚动候选列表显露选中项，外部正文与焦点保持原位，编辑不重新定位', async () => {
  setup([file('image-1.png')]); await ready();
  const list = screen.getByRole('list');
  const body = screen.getByRole('dialog').querySelector('header')!.nextElementSibling as HTMLElement;
  body.scrollTop = 42;
  const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 260, width: 260, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
  const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === list) return rect(100, 356);
    if (this.parentElement === list) {
      const top = 100 + Array.from(list.children).indexOf(this) * 80 - list.scrollTop;
      return rect(top, top + 80);
    }
    return rect(0, 0);
  });
  try {
    const focus = screen.getByRole('textbox', { name: '公共标签' }); focus.focus();
    add(Array.from({ length: 19 }, (_, index) => file(`image-${index + 2}.png`))); await ready();
    expect(list.scrollTop).toBe(1344); expect(body.scrollTop).toBe(42); expect(document.activeElement).toBe(focus);
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('image-20');
    list.scrollTop = 700;
    fireEvent.change(screen.getByRole('textbox', { name: '公共标签' }), { target: { value: '手动分类' } });
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '编辑当前项' } });
    expect(list.scrollTop).toBe(700); expect(body.scrollTop).toBe(42);
    choose('image-1.png'); expect(list.scrollTop).toBe(0); expect(body.scrollTop).toBe(42);
  } finally { geometry.mockRestore(); }
});

it.each([390, 1280])('宽度 %s 以完整图片预览为主，生成信息默认折叠且无需展开或填写即可收藏', async width => {
  vi.stubGlobal('innerWidth', width);
  const { onClose } = setup([file('preview.png')]); await ready();
  const details = screen.getByText('生成信息（可选）').closest('details') as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(screen.getByLabelText('提示词').closest('details')).toBe(details);
  expect(screen.getByLabelText('负面提示词').closest('details')).toBe(details);
  const preview = screen.getByRole('img', { name: 'preview' });
  expect(preview.classList.contains('object-contain')).toBe(true); expect(preview.parentElement!.classList.contains('max-h-72')).toBe(true);
  expect(preview.getAttribute('src')).toBe(screen.getByRole('img', { name: 'preview.png' }).getAttribute('src'));
  expect(preview.closest('fieldset')!.getAttribute('data-safe-mode-work')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ title: 'preview', prompt: '', negativePrompt: '', params: undefined }));
});

it('多选图片逐图保留完整元数据与角色，公共收藏夹和标签应用整批，不跨图覆盖', async () => {
  const images = [file('first.png'), file('second.png'), file('plain.jpg', 'image/jpeg')];
  mocks.extract.mockImplementation(async (image: File) => image.name === 'first.png' ? metadata(11, 'first prompt') : image.name === 'second.png' ? metadata(22, '') : null);
  const { onClose, onRefresh, notify } = setup(); add(images); await ready();
  fireEvent.click(screen.getByRole('button', { name: '收藏夹' })); fireEvent.click(screen.getByRole('checkbox', { name: '合成收藏夹' })); fireEvent.click(within(screen.getByRole('dialog', { name: '收藏夹' })).getByRole('button', { name: '完成' }));
  fireEvent.change(screen.getByRole('textbox', { name: '公共标签' }), { target: { value: '构图, 光影, 构图' } });
  choose('first.png'); openInfo(); fireEvent.change(screen.getByLabelText('提示词'), { target: { value: 'edited first' } });
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('已加入收藏库'));
  expect(mocks.upload.mock.calls).toEqual(images.map(image => [image, 'inspirations']));
  const saved = mocks.save.mock.calls.map(([item]) => item);
  expect(saved).toHaveLength(3);
  expect(saved[0]).toEqual(expect.objectContaining({ title: 'first', prompt: 'edited first', negativePrompt: 'negative-11', params: expect.objectContaining({ seed: 11, width: 1152, height: 768, cfgRescale: 0.2, model: 'nai-diffusion-4-5-full', useCoords: true, characters: [expect.objectContaining({ prompt: 'character-11', negativePrompt: 'character-negative-11', x: 0.3, y: 0.7 })] }) }));
  expect(saved[1]).toEqual(expect.objectContaining({ title: 'second', prompt: '', params: expect.objectContaining({ seed: 22, characters: [expect.objectContaining({ prompt: 'character-22' })] }) }));
  expect(saved[2]).toEqual(expect.objectContaining({ title: 'plain', prompt: '', negativePrompt: '', params: undefined }));
  saved.forEach(item => expect(item).toEqual(expect.objectContaining({ tags: ['构图', '光影'], boardIds: ['folder'], sourceType: 'upload', userId: user.id })));
  expect(new Set(saved.map(item => item.id)).size).toBe(3);
  expect(onRefresh).toHaveBeenCalledOnce(); expect(onClose).not.toHaveBeenCalled(); expect(screen.getByRole('status').textContent).toBe('已保存 3/3 张');
  expect(screen.getByRole('button', { name: '完成' })).toBeTruthy();
});

it('单图标题和正负词仍可编辑，无元数据不伪造参数；成功沿用自动关闭', async () => {
  const image = file('single.webp', 'image/webp');
  const { onClose, onRefresh } = setup([image]); await ready();
  openInfo();
  fireEvent.change(screen.getByLabelText('标题'), { target: { value: ' 手动标题 ' } });
  fireEvent.change(screen.getByLabelText('提示词'), { target: { value: 'manual prompt' } });
  fireEvent.change(screen.getByLabelText('负面提示词'), { target: { value: 'manual negative' } });
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ title: '手动标题', prompt: 'manual prompt', negativePrompt: 'manual negative', params: undefined, boardIds: [] }));
  expect(onRefresh).toHaveBeenCalledOnce();
});

it('迟到元数据只补当前候选未编辑字段，不覆盖人工输入或其他图片', async () => {
  let finish!: (value: string) => void;
  mocks.extract.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  setup([file('late.png')]);
  openInfo();
  fireEvent.change(screen.getByLabelText('标题'), { target: { value: '手动标题' } });
  fireEvent.change(screen.getByLabelText('提示词'), { target: { value: 'manual pending' } });
  add([file('plain.jpg', 'image/jpeg')]); choose('late.png'); openInfo();
  await act(async () => finish(metadata(33, 'late prompt'))); await ready();
  expect((screen.getByLabelText('提示词') as HTMLTextAreaElement).value).toBe('manual pending');
  expect((screen.getByLabelText('负面提示词') as HTMLTextAreaElement).value).toBe('negative-33');
  expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('手动标题');
  choose('plain.jpg'); openInfo(); expect((screen.getByLabelText('提示词') as HTMLTextAreaElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[0][0].params.seed).toBe(33); expect(mocks.save.mock.calls[1][0].params).toBeUndefined();
});

it('移除候选立即释放预览，迟到解析不复活；卸载释放其余预览且不会更新界面', async () => {
  let finish!: (value: string) => void;
  mocks.extract.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { unmount } = setup([file('removed.png'), file('kept.jpg', 'image/jpeg')]);
  const removedUrl = screen.getByRole('img', { name: 'removed.png' }).getAttribute('src');
  fireEvent.click(screen.getByRole('button', { name: '移除候选：removed.png' }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(removedUrl);
  await act(async () => finish(metadata(44, 'removed prompt')));
  expect(screen.queryByRole('button', { name: '选择候选：removed.png' })).toBeNull();
  await ready(); unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2); expect(mocks.save).not.toHaveBeenCalled();
});

it('窗口本地 drop 与 chooser 共用追加和验证，不接链接、目录、空文件或过大文件', async () => {
  const { notify } = setup();
  const dialog = screen.getByRole('dialog');
  const image = file('dropped.png');
  const transfer = { files: [image], types: ['Files'], dropEffect: 'none' };
  expect(fireEvent.dragOver(dialog, { dataTransfer: transfer })).toBe(false); expect(transfer.dropEffect).toBe('copy');
  expect(fireEvent.dragOver(dialog, { dataTransfer: { files: [image] } })).toBe(false);
  expect(fireEvent.drop(dialog, { dataTransfer: transfer })).toBe(false); await ready();
  expect(screen.getByRole('button', { name: '选择候选：dropped.png' })).toBeTruthy();
  expect(fireEvent.drop(dialog, { dataTransfer: { files: [], types: ['text/uri-list'] } })).toBe(true);
  const huge = file('huge.png'); Object.defineProperty(huge, 'size', { value: 12 * 1024 * 1024 + 1 });
  const directory = file('nested.png'); Object.defineProperty(directory, 'webkitRelativePath', { value: 'folder/nested.png' });
  add([file('text.txt', 'text/plain'), new File([], 'empty.png', { type: 'image/png' }), huge, directory, file('valid.webp', 'image/webp')]);
  await ready(); expect(notify).toHaveBeenCalledTimes(4);
  expect(screen.getAllByRole('button', { name: /^选择候选：/ })).toHaveLength(2); expect(mocks.extract).toHaveBeenCalledTimes(2);
});

it('同一窗口重复追加相同文件不创建重复候选，initialFiles新增文件只入队一次', async () => {
  const first = file('repeat.png'), second = file('second.png');
  const { props, rerender } = setup([first]); await ready();
  add([first]);
  rerender(<CollectionImportDialog {...props} initialFiles={[first, second]} />); await ready();
  rerender(<CollectionImportDialog {...props} initialFiles={[first, second]} />);
  expect(screen.getAllByRole('button', { name: /^选择候选：/ })).toHaveLength(2);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2); expect(mocks.extract).toHaveBeenCalledTimes(2);
});

it('名称、大小和修改时间相同的不同文件仍逐张导入，不以文件属性猜测内容相同', async () => {
  const first = new File(['A'], 'same.png', { type: 'image/png', lastModified: 1 });
  const second = new File(['B'], 'same.png', { type: 'image/png', lastModified: 1 });
  setup([first, second]); await ready();
  expect(screen.getAllByRole('button', { name: '选择候选：same.png' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.upload).toHaveBeenNthCalledWith(1, first, 'inspirations');
  expect(mocks.upload).toHaveBeenNthCalledWith(2, second, 'inspirations');
});

it('逐张串行保存，单项失败继续后续项；重试只处理失败项并复用 id 和上传地址', async () => {
  mocks.save.mockRejectedValueOnce(new Error('合成记录失败'));
  const { notify, onClose } = setup([file('retry.png'), file('success.png')]); await ready();
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('已导入 1 张，失败 1 张', 'error'));
  expect(mocks.upload).toHaveBeenCalledTimes(2); expect(mocks.save).toHaveBeenCalledTimes(2);
  const failedId = mocks.save.mock.calls[0][0].id;
  expect(screen.getByRole('alert').textContent).toBe('合成记录失败');
  expect(screen.getByRole('status').textContent).toBe('已保存 1/2 张'); expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('已加入收藏库'));
  expect(mocks.save).toHaveBeenCalledTimes(3); expect(mocks.upload).toHaveBeenCalledTimes(2);
  expect(mocks.save.mock.calls[2][0]).toEqual(expect.objectContaining({ id: failedId, imageUrl: '/synthetic/retry.png' }));
  expect(screen.getByRole('status').textContent).toBe('已保存 2/2 张');
});

it('上传失败保留原候选，不自动重试，主动导入仍使用同一记录 id', async () => {
  mocks.upload.mockRejectedValueOnce(new Error('合成上传失败'));
  const { notify } = setup([file('upload-retry.png')]); await ready();
  const id = screen.getByRole('list').querySelector('li')!.getAttribute('data-import-id');
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成上传失败', 'error'));
  expect(mocks.upload).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.upload).toHaveBeenCalledTimes(2); expect(mocks.save.mock.calls[0][0].id).toBe(id);
});

it('读取异常单独反馈，不冒充缺失配置；主动导入时才重读失败候选', async () => {
  mocks.extract.mockRejectedValueOnce(new Error('合成读取失败')).mockResolvedValueOnce(metadata(55, 'recovered'));
  const { notify } = setup([file('read-retry.png')]);
  await ready(); expect(screen.getByRole('alert').textContent).toBe('合成读取失败');
  expect(mocks.extract).toHaveBeenCalledOnce(); expect(mocks.upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('已加入收藏库'));
  expect(mocks.extract).toHaveBeenCalledTimes(2); expect(mocks.save.mock.calls[0][0]).toEqual(expect.objectContaining({ prompt: 'recovered', params: expect.objectContaining({ seed: 55 }) }));
});

it('保存中锁定重复提交、追加、编辑、移除、Esc、关闭和遮罩，后续项等待首项保存', async () => {
  let finish!: () => void;
  mocks.save.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const { onClose, onRefresh, notify } = setup([file('busy.png'), file('queued.png')]); await ready();
  openInfo();
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const dialog = screen.getByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: '正在保存…' })); fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '关闭' })); fireEvent.click(dialog.parentElement!);
  fireEvent.click(screen.getByRole('button', { name: '移除候选：busy.png' }));
  fireEvent.drop(dialog, { dataTransfer: { files: [file('ignored.png')], types: ['Files'] } });
  expect((screen.getByLabelText('提示词') as HTMLTextAreaElement).matches(':disabled')).toBe(true);
  expect(onClose).not.toHaveBeenCalled(); expect(onRefresh).not.toHaveBeenCalled(); expect(mocks.upload).toHaveBeenCalledOnce();
  expect(screen.getAllByRole('button', { name: /^选择候选：/ })).toHaveLength(2);
  const completed = new Promise<void>(resolve => { notify.mockImplementationOnce(() => resolve()); });
  await act(async () => { finish(); await completed; });
  expect(mocks.upload).toHaveBeenCalledTimes(2); expect(mocks.save).toHaveBeenCalledTimes(2);
});

it('已保存后刷新异常单独反馈，不把成功项变失败或再次上传，手动刷新只读取', async () => {
  const { notify, onRefresh, onClose } = setup([file('refresh.png')]);
  onRefresh.mockRejectedValueOnce(new Error('合成回读失败')); await ready();
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('图片已保存，但收藏库刷新失败：合成回读失败', 'error'));
  expect(screen.getByRole('status').textContent).toBe('已保存 1/1 张'); expect(screen.queryByRole('alert')).toBeNull(); expect(onClose).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: '加入收藏库' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '加入收藏库' })); expect(mocks.save).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '刷新' })).toBeNull());
  expect(onRefresh).toHaveBeenCalledTimes(2); expect(mocks.upload).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledOnce();
});

it('空标题禁止整批提交，公共标签候选可取用，游客不能入队或保存', async () => {
  const { unmount, props } = setup([file('title.png')]); await ready();
  fireEvent.change(screen.getByLabelText('标题'), { target: { value: ' ' } });
  expect((screen.getByRole('button', { name: '加入收藏库' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '选择已有标签' })).getByRole('button', { name: '#光影' }));
  expect((screen.getByRole('textbox', { name: '公共标签' }) as HTMLInputElement).value).toBe('光影');
  unmount(); render(<CollectionImportDialog {...props} currentUser={{ ...user, role: 'guest' }} initialFiles={[file('guest.png')]} />);
  expect(screen.queryByRole('button', { name: /^选择候选：/ })).toBeNull(); expect(mocks.upload).not.toHaveBeenCalled();
});
