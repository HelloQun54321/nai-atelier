// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { StyleBundleDialog } from '../../components/chain/StyleBundleDialog';
import { setLanguage, t } from '../../services/i18n';
import { setMobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';
import { getNaiModelDisplayLabel } from '../../services/naiModels';

const mocks = vi.hoisted(() => ({ read: vi.fn(), entryPreview: vi.fn(), export: vi.fn(), import: vi.fn(), download: vi.fn(), target: vi.fn(), openDirectory: vi.fn(), getAllChains: vi.fn(), get: vi.fn(), put: vi.fn() }));
vi.mock('../../services/api', () => ({ api: { get: mocks.get, put: mocks.put } }));
vi.mock('../../services/dbService', () => ({ db: { getAllChains: mocks.getAllChains } }));
vi.mock('../../services/styleBundle', () => ({ readStyleBundle: mocks.read, getStyleBundleEntryPreview: mocks.entryPreview, exportStyleBundle: mocks.export, importStyleBundle: mocks.import }));
vi.mock('../../services/exportLocation', () => ({ beginExportTarget: mocks.target, openExportDirectory: mocks.openDirectory }));
vi.mock('../../services/fileDownload', () => ({ downloadFile: mocks.download }));
vi.mock('../../components/MobileUI', () => ({ useMobileHistoryLayer: (_open: boolean, close: () => void) => close }));

const chains = Array.from({ length: 65 }, (_, index) => ({ id: `chain-${index}`, name: `风格 ${index}`, type: 'style' } as PromptChain));
const props = () => ({ chains, filteredChains: chains.slice(0, 63), selectedChains: chains.slice(61), initialScope: 'all' as const, onClose: vi.fn(), onImported: vi.fn(), notify: vi.fn() });
const preview = { entries: [
  { id: 'a', name: '水彩', description: '纸张', cover: true, sources: [{ author: '作者甲', sourceUrl: 'https://example.org/free', note: '免费分享' }] },
  { id: 'b', name: '素描', description: '铅笔', cover: false, sources: [] },
], coverage: 'full' as const, warnings: [] };

const openMenu = (menu: 'folders' | 'selection' | 'info') => {
  const label = t(menu === 'folders' ? '设置文件夹' : menu === 'selection' ? '选择与导入' : '分享包信息');
  const trigger = screen.getByRole('button', { name: label });
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
};
const openFolderName = async () => {
  await waitFor(() => expect((screen.getByRole('button', { name: t('设置文件夹') }) as HTMLButtonElement).disabled).toBe(false));
  openMenu('folders');
  return screen.findByLabelText(t('文件夹名称'));
};
const folderModeField = () => { openMenu('folders'); return screen.getByRole('combobox', { name: t('导入到') }); };
const actionButton = (name: string) => {
  if (!screen.queryByRole('button', { name })) openMenu(name === t('查看文件夹') ? 'folders' : 'selection');
  return screen.getByRole('button', { name });
};

let folderState = { revision: 0, folders: [] as Array<{ id: string; name: string; parentId: string | null }>, assignments: {} as Record<string, string[]> };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe(target: Element) { this.callback([{ target, contentRect: { width: 960 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:synthetic-preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  mocks.entryPreview.mockImplementation((value, id) => {
    const entry = value.entries.find((entry: { id: string }) => entry.id === id);
    return { id, name: entry.name, description: entry.description, tags: [], basePrompt: '原始画风', negativePrompt: '', modules: [], params: { width: 832, height: 1216 }, variableValues: {}, ...(entry.cover ? { coverBlob: new Blob(['synthetic'], { type: 'image/png' }) } : {}) };
  });
  mocks.read.mockResolvedValue(preview);
  mocks.export.mockResolvedValue(new Blob(['synthetic']));
  mocks.download.mockResolvedValue({ saved: true, cancelled: false });
  mocks.target.mockReturnValue(undefined);
  mocks.openDirectory.mockResolvedValue(undefined);
  mocks.getAllChains.mockResolvedValue(chains);
  folderState = { revision: 0, folders: [], assignments: {} };
  mocks.get.mockImplementation(async () => structuredClone(folderState));
  mocks.put.mockImplementation(async (_path, next) => {
    folderState = { ...structuredClone(next), revision: next.revision + 1 };
    return structuredClone(folderState);
  });
});
afterEach(() => { cleanup(); setLanguage('zh-CN'); vi.unstubAllGlobals(); });

it('目录读取失败在顶部直接说明禁用原因并可重新加载，无需打开设置', async () => {
  mocks.get.mockRejectedValueOnce(Error('合成目录读取失败'));
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  const failure = await screen.findByRole('alert');
  expect(failure.textContent).toContain('合成目录读取失败');
  expect(failure.closest('header')).toBeTruthy();
  expect(screen.queryByRole('dialog', { name: '导入到' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(mocks.get).toHaveBeenCalledTimes(2);
});

it.each([320, 390, 1280])('%s宽度常态仅两排顶部控件且无底栏，设置与范围操作从顶部弹层可达', async width => {
  vi.stubGlobal('innerWidth', width);
  const warning = '来源是分享者填写的声明，未经签名验证。';
  mocks.read.mockResolvedValueOnce({ ...preview, warnings: [warning] });
  folderState.folders = Array.from({ length: 12 }, (_, index) => ({ id: 'f' + index, name: '夹' + index, parentId: null }));
  render(<StyleBundleDialog {...props()} />);
  const dialog = screen.getByRole('dialog', { name: '风格串分享包' });
  expect(dialog.querySelector('footer')).toBeNull();
  expect(dialog.querySelector('header')?.children).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('checkbox', { name: '水彩' });
  const header = dialog.querySelector('header')!;
  expect(header.children).toHaveLength(2);
  for (const row of Array.from(header.children)) expect(row.className).not.toContain('flex-wrap');
  expect(screen.queryByLabelText('文件夹名称')).toBeNull();
  expect(screen.queryByText('打包范围')).toBeNull();
  expect(screen.queryByRole('button', { name: '导入全部' })).toBeNull();
  expect(screen.getByRole('button', { name: '导入已选（2）' }).closest('header')).toBe(header);
  expect(screen.getByLabelText('搜索分享包').closest('header')).toBe(header);
  for (const label of ['选择 .naia 文件', '分享包信息', '设置文件夹', '选择与导入', '关闭']) expect(screen.getByRole('button', { name: label }).classList.contains('mobile-touch')).toBe(true);
  const info = screen.getByRole('button', { name: '分享包信息' });
  expect(info.title).toContain(warning);
  expect(info.querySelector('svg')?.classList.contains('text-amber-700')).toBe(true);
  openMenu('info');
  expect(screen.getByRole('dialog', { name: '分享包信息' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'https://example.org/free' })).toBeTruthy();
  expect(screen.getByText(warning)).toBeTruthy();
  openMenu('folders');
  expect(screen.queryByRole('dialog', { name: '分享包信息' })).toBeNull();
  expect((await screen.findByLabelText('文件夹名称') as HTMLInputElement).value).toBe('styles');
  expect(screen.getByRole('button', { name: '设置文件夹' }).title).toContain('styles');
  fireEvent.change(folderModeField(), { target: { value: 'existing' } });
  const list = screen.getByRole('checkbox', { name: '夹0' }).parentElement!.parentElement!;
  expect(list.className).toContain('max-h-60');
  expect(list.className).toContain('overflow-y-auto');
  fireEvent.click(screen.getByRole('checkbox', { name: '夹0' }));
  expect(screen.getByRole('button', { name: '设置文件夹' }).title).toContain('夹0');
  openMenu('selection');
  expect(screen.queryByRole('dialog', { name: '导入到' })).toBeNull();
  expect(screen.getByRole('dialog', { name: '选择与导入' })).toBeTruthy();
  expect(actionButton('导入全部')).toBeTruthy();
  expect(actionButton('导入筛选结果')).toBeTruthy();
  fireEvent.click(actionButton('清空选择'));
  expect((screen.getByRole('button', { name: '导入已选（0）' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(actionButton('全选筛选结果'));
  expect(mocks.import).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '选择与导入' })).toBeNull();
  expect(screen.getByRole('dialog', { name: '风格串分享包' })).toBe(dialog);
  expect(header.children).toHaveLength(2);
});

it.each([undefined, 'nai-diffusion-5-full'])('预览名称行沿用模型标记与安全模式标题，model=%s且圆角服从主题', async model => {
  mocks.entryPreview.mockImplementation((value, id) => {
    const entry = value.entries.find((entry: { id: string }) => entry.id === id);
    return { ...entry, tags: [], basePrompt: '', negativePrompt: '', modules: [], params: { model }, variableValues: {} };
  });
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  const card = (await screen.findByRole('checkbox', { name: '水彩' })).closest('.media-card') as HTMLElement;
  expect(card.querySelector('.gallery-card-badge')?.textContent).toBe(getNaiModelDisplayLabel(model));
  expect(card.querySelector('h3')?.getAttribute('data-safe-mode-title')).toBe('true');
  expect(card.className).toContain('rounded-xl');
  expect(card.className).not.toContain('!rounded-xl');
});

it.each([390, 1280])('%s宽度导入复用风格串卡片与页面布局偏好，仅导入窗口加宽', async width => {
  vi.stubGlobal('innerWidth', width);
  setMobileImageDisplayPreferences({ layout: 'square', columns: 2, desktopColumns: 2 });
  setMobileImageDisplayPreferences({ layout: 'portrait', columns: 1, desktopColumns: 3 }, 'chains');
  render(<StyleBundleDialog {...props()} />);
  const dialog = screen.getByRole('dialog', { name: '风格串分享包' });
  expect(dialog.className).toContain('max-w-2xl');
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  expect(dialog.className).toContain('max-w-6xl');
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  const checkbox = await screen.findByRole('checkbox', { name: '水彩' });
  const card = checkbox.closest('.media-card')!;
  expect(card.className).toContain('gallery-image-card');
  expect(card.className).toContain('gallery-card-visual');
  expect(card.querySelector('.mobile-gallery-frame')).toBeTruthy();
  expect(card.querySelector('.gallery-card-caption h3')?.textContent).toBe('水彩');
  expect(checkbox.parentElement?.className).toContain('rounded-full');
  expect(card.className).toContain('ring-2');
  const grid = card.closest('.mobile-gallery--portrait') as HTMLElement;
  expect(grid.style.getPropertyValue('--mobile-gallery-cols-setting')).toBe('1');
  expect(grid.style.getPropertyValue('--mobile-gallery-cols-desktop')).toBe('3');
  expect((await within(card as HTMLElement).findByRole('img')).getAttribute('src')).toMatch(/^blob:/);
  expect(mocks.entryPreview.mock.calls.every(call => call[0] === preview)).toBe(true);
  expect(screen.queryByRole('button', { name: '收藏' })).toBeNull();
  expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
});

it('配方与原始JSON描述默认折叠，无封面仍可勾选查看完整配方且不从描述解析', async () => {
  const description = '{"basePrompt":"不应使用描述里的词","long":"' + '完整原文'.repeat(1000) + '"}';
  const loaded = { ...preview, entries: preview.entries.map(entry => ({ ...entry, description })) };
  mocks.read.mockResolvedValueOnce(loaded);
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  const checkbox = await screen.findByRole('checkbox', { name: '素描' });
  const card = checkbox.closest('[data-bundle-entry]') as HTMLElement;
  expect(within(card).getByText('无封面')).toBeTruthy();
  expect(within(card).queryByRole('button', { name: /查看封面/ })).toBeNull();
  expect(card.querySelector('details')?.open).toBe(false);
  expect(card.querySelector('pre')).toBeNull();
  fireEvent.click(checkbox);
  expect((checkbox as HTMLInputElement).checked).toBe(false);
  fireEvent.click(within(card).getByText('配方详情'));
  await waitFor(() => expect(card.querySelector('pre')?.textContent).toContain('"basePrompt": "原始画风"'));
  expect(card.querySelector('pre')?.textContent).not.toContain('不应使用描述里的词');
  const raw = within(card).getByText('原始描述').parentElement as HTMLDetailsElement;
  expect(raw.open).toBe(false);
  expect(raw.querySelector('pre')).toBeNull();
  fireEvent.click(within(card).getByText('原始描述'));
  await waitFor(() => expect(raw.querySelector('pre')?.textContent).toBe(description));
  expect(mocks.import).not.toHaveBeenCalled();
  expect(mocks.put).not.toHaveBeenCalled();
});

it('独立选择与看图，翻包内有图项；筛选卸载卡片不释放大图URL，关闭仅退出当前层', async () => {
  const loaded = { ...preview, entries: [...preview.entries, { ...preview.entries[0], id: 'c', name: '油画' }] };
  mocks.read.mockResolvedValueOnce(loaded);
  let index = 0;
  vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:preview-${++index}`);
  const callbacks = props();
  const view = render(<StyleBundleDialog {...callbacks} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  const checkbox = await screen.findByRole('checkbox', { name: '水彩' });
  const scroll = checkbox.closest('[role=dialog]')!.querySelector('.overflow-y-auto') as HTMLElement;
  scroll.scrollTop = 250;
  fireEvent.click(checkbox);
  expect(screen.queryByRole('dialog', { name: '图片预览' })).toBeNull();
  expect((checkbox as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '查看封面：水彩' }));
  const lightbox = await screen.findByRole('dialog', { name: '图片预览' });
  const first = within(lightbox).getByRole('img').getAttribute('src')!;
  expect((checkbox as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText('搜索分享包'), { target: { value: '素描' } });
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(first);
  fireEvent.click(within(lightbox).getByRole('button', { name: '下一张图片' }));
  const next = within(lightbox).getByRole('img').getAttribute('src')!;
  expect(within(lightbox).getByRole('img').getAttribute('alt')).toBe('油画');
  expect(next).not.toBe(first);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(next);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '图片预览' })).toBeNull();
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(scroll.scrollTop).toBe(250);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(next);
  fireEvent.change(screen.getByLabelText('搜索分享包'), { target: { value: '' } });
  expect((screen.getByRole('checkbox', { name: '水彩' }) as HTMLInputElement).checked).toBe(false);
  expect(mocks.entryPreview.mock.calls.every(call => call[0] === loaded)).toBe(true);
  view.unmount();
  expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBe(vi.mocked(URL.createObjectURL).mock.calls.length);
});

it('更换文件释放旧卡片与大图URL，相同包内ID也恢复折叠详情', async () => {
  const loaded = { ...preview, entries: preview.entries.map(entry => ({ ...entry, name: '新包' + entry.name })) };
  let index = 0;
  vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:replacement-${++index}`);
  mocks.read.mockResolvedValueOnce(preview).mockResolvedValueOnce(loaded);
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  const input = screen.getByLabelText('选择 .naia 文件', { selector: 'input' });
  fireEvent.change(input, { target: { files: [new File(['first'], 'first.naia')] } });
  const card = (await screen.findByRole('checkbox', { name: '水彩' })).closest('[data-bundle-entry]') as HTMLElement;
  fireEvent.click(within(card).getByText('配方详情'));
  await waitFor(() => expect(card.querySelector('pre')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '查看封面：水彩' }));
  const oldSrc = within(await screen.findByRole('dialog', { name: '图片预览' })).getByRole('img').getAttribute('src')!;
  fireEvent.change(input, { target: { files: [new File(['next'], 'next.naia')] } });
  const nextCard = (await screen.findByRole('checkbox', { name: '新包水彩' })).closest('[data-bundle-entry]') as HTMLElement;
  expect(nextCard.querySelector('details')?.open).toBe(false);
  expect(nextCard.querySelector('pre')).toBeNull();
  expect(screen.queryByRole('dialog', { name: '图片预览' })).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(oldSrc);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:replacement-1');
});

it('换包清除旧预览状态引用，再读取同一preview对象也不复活大图或展开内容', async () => {
  const first = { ...preview, entries: preview.entries.map(entry => ({ ...entry, description: '第一包原始说明' })) };
  const second = { ...preview, entries: preview.entries.map(entry => ({ ...entry, name: '第二包' + entry.name })) };
  mocks.read.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(first);
  mocks.entryPreview.mockImplementation((value, id) => {
    const entry = value.entries.find((entry: { id: string }) => entry.id === id);
    return { ...entry, tags: [], basePrompt: '', negativePrompt: '', modules: [], params: { width: value === first ? 100 : 400, height: value === first ? 200 : 100 }, variableValues: {}, ...(entry.cover ? { coverBlob: new Blob(['synthetic'], { type: 'image/png' }) } : {}) };
  });
  let index = 0;
  vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:state-${++index}`);
  const callbacks = props();
  render(<StyleBundleDialog {...callbacks} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  const input = screen.getByLabelText('选择 .naia 文件', { selector: 'input' });
  const selectFile = () => fireEvent.change(input, { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  selectFile();
  const card = (await screen.findByRole('checkbox', { name: '水彩' })).closest('[data-bundle-entry]') as HTMLElement;
  expect((card.querySelector('.mobile-gallery-frame') as HTMLElement).style.getPropertyValue('--mobile-image-ratio')).toBe('0.5');
  fireEvent.click(within(card).getByText('配方详情'));
  await within(card).findByText('原始描述');
  fireEvent.click(within(card).getByText('原始描述'));
  await within(card).findByText('第一包原始说明');
  fireEvent.click(screen.getByRole('button', { name: '查看封面：水彩' }));
  const oldSrc = within(await screen.findByRole('dialog', { name: '图片预览' })).getByRole('img').getAttribute('src')!;
  selectFile();
  const secondCard = (await screen.findByRole('checkbox', { name: '第二包水彩' })).closest('[data-bundle-entry]') as HTMLElement;
  expect((secondCard.querySelector('.mobile-gallery-frame') as HTMLElement).style.getPropertyValue('--mobile-image-ratio')).toBe('4');
  expect(screen.queryByRole('dialog', { name: '图片预览' })).toBeNull();
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(oldSrc);
  selectFile();
  const restored = (await screen.findByRole('checkbox', { name: '水彩' })).closest('[data-bundle-entry]') as HTMLElement;
  expect((restored.querySelector('.mobile-gallery-frame') as HTMLElement).style.getPropertyValue('--mobile-image-ratio')).toBe('0.5');
  expect(restored.querySelector('details')?.open).toBe(false);
  expect(restored.querySelector('pre')).toBeNull();
  expect(screen.queryByRole('dialog', { name: '图片预览' })).toBeNull();
  fireEvent.click(within(restored).getByText('配方详情'));
  const raw = (await within(restored).findByText('原始描述')).parentElement as HTMLDetailsElement;
  expect(raw.open).toBe(false);
  expect(raw.querySelector('pre')).toBeNull();
  expect(callbacks.onClose).not.toHaveBeenCalled();
});

it('以文件名预填新夹并允许改名，分批导入和失败重试复用同一夹，完成后可查看', async () => {
  const onViewFolder = vi.fn();
  mocks.import.mockResolvedValueOnce({ createdIds: ['new-a'], importedEntryIds: ['a'], failed: [{ id: 'b', name: '素描', error: '合成保存失败' }] })
    .mockResolvedValueOnce({ createdIds: ['new-b'], importedEntryIds: ['b'], failed: [] });
  render(<StyleBundleDialog {...props()} onViewFolder={onViewFolder} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], '朋友的配方.naia')] } });
  const name = await openFolderName();
  expect((name as HTMLInputElement).value).toBe('朋友的配方');
  fireEvent.change(name, { target: { value: '朋友A分享' } });
  fireEvent.click(actionButton('导入全部'));
  await screen.findByText('合成保存失败');
  expect(folderState.folders.map(folder => folder.name)).toEqual(['朋友A分享']);
  const id = folderState.folders[0].id;
  expect(folderState.assignments).toEqual({ 'new-a': [id] });
  expect((await openFolderName() as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(actionButton('导入全部'));
  await waitFor(() => expect(folderState.assignments['new-b']).toEqual([id]));
  expect(folderState.folders).toHaveLength(1);
  expect(mocks.import.mock.calls[1][1]).toEqual(['b']);
  await waitFor(() => expect((actionButton('查看文件夹') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(actionButton('查看文件夹'));
  expect(onViewFolder).toHaveBeenCalledWith(id);
});

it('已有文件夹可多选，归类先读取最新归属并追加，保留其他串与其他夹', async () => {
  folderState = { revision: 0, folders: [{ id: 'f1', name: '分享区', parentId: null }, { id: 'f2', name: '收藏区', parentId: null }, { id: 'f3', name: '原有区', parentId: null }], assignments: { mine: ['f3'] } };
  mocks.import.mockImplementationOnce(async () => {
    folderState = { ...folderState, revision: 1, assignments: { ...folderState.assignments, 'new-a': ['f3'] } };
    return { createdIds: ['new-a'], importedEntryIds: ['a'], failed: [] };
  });
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], '分享.naia')] } });
  await openFolderName();
  fireEvent.change(folderModeField(), { target: { value: 'existing' } });
  expect((screen.getByRole('button', { name: '导入已选（2）' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: '分享区' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '收藏区' }));
  fireEvent.click(actionButton('导入全部'));
  await waitFor(() => expect(folderState.assignments['new-a']).toEqual(['f3', 'f1', 'f2']));
  expect(folderState.assignments.mine).toEqual(['f3']);
  expect(folderState.folders).toHaveLength(3);
  expect(mocks.put).toHaveBeenCalledTimes(1);
});

it('归类失败明确保留已保存状态，只重试归类而不重建串或文件夹', async () => {
  mocks.import.mockResolvedValueOnce({ createdIds: ['new-a'], importedEntryIds: ['a'], failed: [] });
  mocks.put.mockImplementationOnce(async (_path, next) => {
    folderState = { ...structuredClone(next), revision: next.revision + 1 }; return structuredClone(folderState);
  }).mockRejectedValueOnce(new Error('合成目录冲突'));
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], '分享.naia')] } });
  await openFolderName();
  fireEvent.change(screen.getByLabelText('搜索分享包'), { target: { value: '水彩' } });
  fireEvent.click(actionButton('导入筛选结果'));
  expect(await screen.findByText('风格串已保存，归类失败：合成目录冲突')).toBeTruthy();
  expect((screen.getByRole('checkbox', { name: '水彩' }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: '重试归类（1）' }).closest('header')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试归类（1）' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '重试归类（1）' })).toBeNull());
  expect(mocks.import).toHaveBeenCalledTimes(1);
  expect(folderState.folders).toHaveLength(1);
  expect(folderState.assignments['new-a']).toEqual([folderState.folders[0].id]);
});

it.each(['切页返回', '另一批成功'])('归类失败后%s仍保留顶部恢复入口，仅重试旧ID而不重建风格串', async nextAction => {
  mocks.import.mockReset().mockResolvedValueOnce({ createdIds: ['saved-a'], importedEntryIds: ['a'], failed: [] })
    .mockResolvedValueOnce({ createdIds: ['saved-b'], importedEntryIds: ['b'], failed: [] });
  mocks.put.mockImplementationOnce(async (_path, next) => {
    folderState = { ...structuredClone(next), revision: next.revision + 1 }; return structuredClone(folderState);
  }).mockRejectedValueOnce(Error('合成归类冲突'));
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], '分享.naia')] } });
  await screen.findByRole('checkbox', { name: '水彩' });
  fireEvent.change(screen.getByLabelText('搜索分享包'), { target: { value: '水彩' } });
  fireEvent.click(actionButton('导入筛选结果'));
  await screen.findByText('风格串已保存，归类失败：合成归类冲突');
  const folderId = folderState.folders[0].id;
  if (nextAction === '切页返回') {
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(screen.queryByRole('button', { name: '重试归类（1）' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '导入' }));
  } else {
    fireEvent.change(screen.getByLabelText('搜索分享包'), { target: { value: '素描' } });
    fireEvent.click(actionButton('导入筛选结果'));
    await waitFor(() => expect(folderState.assignments['saved-b']).toEqual([folderId]));
  }
  expect(await screen.findByText('已保存到风格串')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  const retry = screen.getByRole('button', { name: '重试归类（1）' });
  expect(retry.closest('header')).toBeTruthy();
  await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(retry);
  await waitFor(() => expect(folderState.assignments['saved-a']).toEqual([folderId]));
  expect(screen.queryByRole('button', { name: '重试归类（1）' })).toBeNull();
  expect(mocks.import).toHaveBeenCalledTimes(nextAction === '切页返回' ? 1 : 2);
  expect(folderState.folders).toHaveLength(1);
});

it('新夹保存回执丢失后重读复用原ID，首次归类前不创建风格串', async () => {
  mocks.import.mockResolvedValueOnce({ createdIds: ['new-a'], importedEntryIds: ['a'], failed: [] });
  mocks.put.mockImplementationOnce(async (_path, next) => {
    folderState = { ...structuredClone(next), revision: next.revision + 1 }; throw Error('合成回执丢失');
  });
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], '分享.naia')] } });
  await openFolderName();
  fireEvent.click(actionButton('导入全部'));
  await screen.findByText('合成回执丢失');
  expect(mocks.import).not.toHaveBeenCalled();
  fireEvent.click(actionButton('导入全部'));
  await waitFor(() => expect(folderState.assignments['new-a']).toEqual([folderState.folders[0].id]));
  expect(folderState.folders).toHaveLength(1);
});

it('配方保存后目标夹被删除可改选其他夹，只重试归类且不重建配方', async () => {
  folderState = { revision: 0, folders: [{ id: 'a', name: '旧目标', parentId: null }, { id: 'b', name: '新目标', parentId: null }], assignments: {} };
  mocks.import.mockImplementationOnce(async () => {
    folderState = { ...folderState, revision: 1, folders: folderState.folders.filter(folder => folder.id !== 'a') };
    return { createdIds: ['saved'], importedEntryIds: ['a'], failed: [] };
  });
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], '分享.naia')] } });
  await openFolderName();
  fireEvent.change(folderModeField(), { target: { value: 'existing' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '旧目标' }));
  fireEvent.click(actionButton('导入全部'));
  await screen.findByText('风格串已保存，归类失败：目标文件夹已不存在，请重新选择');
  expect((folderModeField() as HTMLSelectElement).disabled).toBe(false);
  openMenu('folders');
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: '旧目标' })).toBeNull());
  fireEvent.click(screen.getByRole('checkbox', { name: '新目标' }));
  fireEvent.click(screen.getByRole('button', { name: '重试归类（1）' }));
  await waitFor(() => expect(folderState.assignments.saved).toEqual(['b']));
  expect(mocks.import).toHaveBeenCalledTimes(1);
  expect(mocks.put).toHaveBeenCalledTimes(1);
});

it('导入失败后的锁定目标消失可恢复选择，未保存项随后正常导入', async () => {
  folderState = { revision: 0, folders: [{ id: 'a', name: '旧目标', parentId: null }, { id: 'b', name: '新目标', parentId: null }], assignments: {} };
  mocks.import.mockResolvedValueOnce({ createdIds: [], importedEntryIds: [], failed: [{ id: 'a', name: '水彩', error: '合成保存失败' }] })
    .mockResolvedValueOnce({ createdIds: ['saved'], importedEntryIds: ['a'], failed: [] });
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], '分享.naia')] } });
  await openFolderName();
  fireEvent.change(folderModeField(), { target: { value: 'existing' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '旧目标' }));
  fireEvent.click(actionButton('导入全部'));
  await screen.findByText('合成保存失败');
  folderState = { ...folderState, revision: 1, folders: folderState.folders.filter(folder => folder.id !== 'a') };
  fireEvent.click(actionButton('导入全部'));
  await screen.findByText('目标文件夹已不存在，请重新选择');
  expect(mocks.import).toHaveBeenCalledTimes(1);
  openMenu('folders');
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: '旧目标' })).toBeNull());
  fireEvent.click(screen.getByRole('checkbox', { name: '新目标' }));
  fireEvent.click(actionButton('导入全部'));
  await waitFor(() => expect(folderState.assignments.saved).toEqual(['b']));
  expect(mocks.import).toHaveBeenCalledTimes(2);
});

it('导出前读取最新库识别另端新增，保持原选中集合且先请求目录权限', async () => {
  const selected = chains.slice(0, 1), latest = chains.slice(0, 2);
  mocks.getAllChains.mockResolvedValueOnce(latest);
  render(<StyleBundleDialog {...props()} chains={selected} filteredChains={selected} selectedChains={selected} />);
  fireEvent.click(screen.getByRole('button', { name: '导出 1 条' }));
  await waitFor(() => expect(mocks.export).toHaveBeenCalledTimes(1));
  expect(mocks.export.mock.calls[0][0]).toEqual(selected);
  expect(mocks.export.mock.calls[0][1].allChainIds).toEqual(latest.map(chain => chain.id));
  expect(mocks.target.mock.invocationCallOrder[0]).toBeLessThan(mocks.getAllChains.mock.invocationCallOrder[0]);
  expect(mocks.getAllChains.mock.invocationCallOrder[0]).toBeLessThan(mocks.export.mock.invocationCallOrder[0]);
});

it('最新库删除旧项并混入角色时，只将当前风格串与缺省类型旧串算作完整库', async () => {
  const legacy = { ...chains[2], type: undefined } as unknown as PromptChain;
  mocks.getAllChains.mockResolvedValueOnce([chains[0], legacy, { ...chains[3], type: 'character' }]);
  render(<StyleBundleDialog {...props()} chains={chains.slice(0, 2)} />);
  fireEvent.click(screen.getByRole('button', { name: '导出 2 条' }));
  await waitFor(() => expect(mocks.export).toHaveBeenCalledTimes(1));
  expect(mocks.export.mock.calls[0][0]).toEqual(chains.slice(0, 2));
  expect(mocks.export.mock.calls[0][1].allChainIds).toEqual([chains[0].id, legacy.id]);
});

it('最新完整库快照读取失败时拒绝打包和下载，不回退旧缓存标整库', async () => {
  mocks.getAllChains.mockRejectedValueOnce(new Error('合成库读取失败'));
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导出 65 条' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '合成库读取失败');
  expect(mocks.export).not.toHaveBeenCalled();
  expect(mocks.download).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: '导出 65 条' }) as HTMLButtonElement).disabled).toBe(false);
});

it('导出旁可打开目录，导出后使用实际回执，取消或失败不丢失上次保存位置', async () => {
  const callbacks = props();
  const receipt = { saved: true, cancelled: false, path: 'D:\\synthetic\\share (1).naia' };
  mocks.download.mockResolvedValueOnce(receipt);
  render(<StyleBundleDialog {...callbacks} />);
  const openFolder = screen.getByRole('button', { name: '打开文件夹' });
  const exportButton = screen.getByRole('button', { name: '导出 65 条' });
  expect(openFolder.parentElement).toBe(exportButton.parentElement);
  fireEvent.click(openFolder);
  await waitFor(() => expect((openFolder as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.openDirectory).toHaveBeenLastCalledWith(undefined);
  expect(mocks.export).not.toHaveBeenCalled();
  fireEvent.click(exportButton);
  await waitFor(() => expect(callbacks.notify).toHaveBeenCalledWith('已导出 65 条风格串', 'success'));
  fireEvent.click(openFolder);
  await waitFor(() => expect(mocks.openDirectory).toHaveBeenLastCalledWith(receipt));
  await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false));
  mocks.download.mockRejectedValueOnce(new DOMException('cancel', 'AbortError'));
  fireEvent.click(exportButton);
  await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(2));
  await waitFor(() => expect((openFolder as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(openFolder);
  await waitFor(() => expect(mocks.openDirectory).toHaveBeenCalledTimes(3));
  expect(mocks.openDirectory).toHaveBeenLastCalledWith(receipt);
  await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false));
  mocks.download.mockRejectedValueOnce(new Error('合成保存失败'));
  fireEvent.click(exportButton);
  await screen.findByText('合成保存失败');
  fireEvent.click(openFolder);
  await waitFor(() => expect(mocks.openDirectory).toHaveBeenCalledTimes(4));
  expect(mocks.openDirectory).toHaveBeenLastCalledWith(receipt);
});

it('浏览器下载后保留未知位置回执，打开失败就地提示而不触发再次导出', async () => {
  const receipt = { saved: false, cancelled: false, browserDownload: true };
  const message = '当前浏览器无法确定下载目录，请在浏览器下载记录中选择「在文件夹中显示」';
  mocks.download.mockResolvedValueOnce(receipt);
  mocks.openDirectory.mockRejectedValueOnce(new Error(message));
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导出 65 条' }));
  const openFolder = screen.getByRole('button', { name: '打开文件夹' });
  await waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
  await waitFor(() => expect((openFolder as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(openFolder);
  expect((await screen.findByRole('alert')).textContent).toBe(message);
  expect(mocks.openDirectory).toHaveBeenCalledExactlyOnceWith(receipt);
  expect(mocks.export).toHaveBeenCalledOnce();
  expect(mocks.download).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  expect(screen.queryByRole('button', { name: '打开文件夹' })).toBeNull();
});

it('打开目录在按钮内反馈且不增减底部行，禁止重复点击及关闭，重试保留错误至成功', async () => {
  const callbacks = props();
  let rejectOpen!: (error: Error) => void;
  mocks.openDirectory.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectOpen = reject; }));
  render(<StyleBundleDialog {...callbacks} />);
  const button = screen.getByRole('button', { name: '打开文件夹' });
  const footer = button.closest('header')!;
  const idleRows = Array.from(footer.children);
  fireEvent.click(button);
  expect(Array.from(footer.children)).toEqual(idleRows);
  expect(button.getAttribute('aria-busy')).toBe('true');
  fireEvent.click(button);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(mocks.openDirectory).toHaveBeenCalledOnce();
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: '导出 65 条' }) as HTMLButtonElement).disabled).toBe(true);
  rejectOpen(new Error('合成打开失败'));
  await screen.findByText('合成打开失败');
  const errorRows = Array.from(footer.children);
  const error = screen.getByRole('alert');
  let finishOpen!: () => void;
  mocks.openDirectory.mockReturnValueOnce(new Promise<void>(resolve => { finishOpen = resolve; }));
  fireEvent.click(button);
  expect(mocks.openDirectory).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('alert')).toBe(error);
  expect(Array.from(footer.children)).toEqual(errorRows);
  await act(async () => finishOpen());
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(Array.from(footer.children)).toEqual(idleRows);
});

it('导出使用全部筛选集合而非首屏，并传递封面和来源字段到统一导出入口', async () => {
  render(<StyleBundleDialog {...props()} />);
  fireEvent.change(screen.getByLabelText('导出范围'), { target: { value: 'filtered' } });
  fireEvent.change(screen.getByLabelText('封面'), { target: { value: 'none' } });
  fireEvent.change(screen.getByLabelText('作者'), { target: { value: '合成作者' } });
  fireEvent.change(screen.getByLabelText('来源链接'), { target: { value: 'https://example.org/free' } });
  fireEvent.click(screen.getByRole('button', { name: '导出 63 条' }));
  await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
  expect(mocks.export.mock.calls[0][0]).toEqual(chains.slice(0, 63));
  expect(mocks.export.mock.calls[0][1]).toMatchObject({ allChainIds: chains.map(chain => chain.id), coverMode: 'none', author: '合成作者', sourceUrl: 'https://example.org/free' });
  expect(mocks.target).toHaveBeenCalledTimes(1);
  expect(mocks.target.mock.invocationCallOrder[0]).toBeLessThan(mocks.export.mock.invocationCallOrder[0]);
  fireEvent.change(screen.getByLabelText('导出范围'), { target: { value: 'selected' } });
  fireEvent.click(screen.getByRole('button', { name: '导出 4 条' }));
  await waitFor(() => expect(mocks.export).toHaveBeenCalledTimes(2));
  expect(mocks.export.mock.calls[1][0]).toEqual(chains.slice(61));
  expect(mocks.export.mock.calls[1][1].allChainIds).toEqual(chains.map(chain => chain.id));
});

it.each([['full', '整库打包'], ['partial', '部分打包'], ['unrecorded', '未记录']])('导入预览显示 %s 包的打包范围，筛选不会改变包内统计', async (coverage, label) => {
  mocks.read.mockResolvedValueOnce({ ...preview, coverage });
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('checkbox', { name: '水彩' });
  openMenu('info');
  expect(screen.getByText(label)).toBeTruthy();
  expect(screen.getByText('包内风格串：2 条')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索分享包'), { target: { value: '水彩' } });
  expect(screen.queryByRole('checkbox', { name: '素描' })).toBeNull();
  expect(screen.getByText(label)).toBeTruthy();
  expect(screen.getByText('包内风格串：2 条')).toBeTruthy();
});

it('预览来源并按搜索导入，部分失败后重试不重复成功项', async () => {
  const callbacks = props();
  mocks.import.mockResolvedValueOnce({ createdIds: ['new-a'], importedEntryIds: ['a'], failed: [{ id: 'b', name: '素描', error: '合成保存失败' }] })
    .mockResolvedValueOnce({ createdIds: ['new-b'], importedEntryIds: ['b'], failed: [] });
  render(<StyleBundleDialog {...callbacks} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('checkbox', { name: '水彩' });
  openMenu('info');
  expect(screen.getByRole('link', { name: 'https://example.org/free' }).getAttribute('rel')).toBe('noopener noreferrer');
  fireEvent.click(actionButton('导入全部'));
  await screen.findByText('合成保存失败');
  expect(mocks.import.mock.calls[0][1]).toEqual(['a', 'b']);
  expect((screen.getByRole('checkbox', { name: '水彩' }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('搜索分享包'), { target: { value: '铅笔' } });
  fireEvent.click(actionButton('导入筛选结果'));
  await waitFor(() => expect(callbacks.onImported).toHaveBeenCalledTimes(2));
  expect(mocks.import.mock.calls[1][1]).toEqual(['b']);
  expect(screen.queryByText('合成保存失败')).toBeNull();
});

it('取消选文件保留原预览与可导入选择', async () => {
  mocks.import.mockResolvedValue({ createdIds: [], importedEntryIds: [], failed: [] });
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  const input = screen.getByLabelText('选择 .naia 文件', { selector: 'input' });
  fireEvent.change(input, { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('checkbox', { name: '水彩' });
  fireEvent.change(input, { target: { files: [] } });
  expect(screen.getByRole('checkbox', { name: '水彩' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '导入已选（2）' }));
  await waitFor(() => expect(mocks.import).toHaveBeenCalledTimes(1));
  expect(mocks.import.mock.calls[0][0]).toBe(preview);
  expect(mocks.import.mock.calls[0][1]).toEqual(['a', 'b']);
});

it('选择损坏文件清除旧预览与选择，禁止导入旧包；读取期间禁止关闭和切页', async () => {
  const callbacks = props();
  render(<StyleBundleDialog {...callbacks} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  const input = screen.getByLabelText('选择 .naia 文件', { selector: 'input' });
  fireEvent.change(input, { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('checkbox', { name: '水彩' });
  let rejectRead!: (reason: Error) => void;
  mocks.read.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectRead = reject; }));
  fireEvent.change(input, { target: { files: [new File(['bad'], 'bad.naia')] } });
  expect(screen.getByRole('status').textContent).toBe('处理中…');
  expect((screen.getByRole('button', { name: '关闭' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '导出' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(callbacks.onClose).not.toHaveBeenCalled();
  rejectRead(new Error('合成格式错误'));
  await screen.findByRole('alert');
  expect(screen.queryByRole('checkbox', { name: '水彩' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: '素描' })).toBeNull();
  for (const name of ['选择与导入', '导入已选（0）']) {
    const button = screen.getByRole('button', { name });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(mocks.import).not.toHaveBeenCalled();
});

it('搜索可匹配分享来源，筛选勾选后仅导入已选且不覆盖现有串', async () => {
  mocks.import.mockResolvedValue({ createdIds: ['new-a'], importedEntryIds: ['a'], failed: [] });
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('checkbox', { name: '水彩' });
  fireEvent.change(screen.getByLabelText('搜索分享包'), { target: { value: '作者甲' } });
  expect(screen.queryByRole('checkbox', { name: '素描' })).toBeNull();
  fireEvent.click(actionButton('全选筛选结果'));
  fireEvent.click(screen.getByRole('button', { name: '导入已选（1）' }));
  await waitFor(() => expect(mocks.import).toHaveBeenCalledTimes(1));
  expect(mocks.import.mock.calls[0][1]).toEqual(['a']);
});

it('导入预览分批显示，全部与筛选范围仍覆盖尚未显示的条目', async () => {
  const entries = Array.from({ length: 105 }, (_, index) => ({ id: `entry-${index}`, name: `包内风格 ${index}`, description: '', cover: false, sources: [] }));
  mocks.read.mockResolvedValue({ entries, warnings: [] });
  mocks.import.mockResolvedValue({ createdIds: [], importedEntryIds: [], failed: [] });
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('button', { name: '加载更多（5）' });
  expect(screen.queryByRole('checkbox', { name: '包内风格 104' })).toBeNull();
  fireEvent.click(actionButton('导入筛选结果'));
  await waitFor(() => expect(mocks.import).toHaveBeenCalledTimes(1));
  expect(mocks.import.mock.calls[0][1]).toEqual(entries.map(entry => entry.id));
});

it('真实Portal就绪后移入焦点，Tab圈禁，Escape关闭并归还触发器', async () => {
  const Harness = () => {
    const [open, setOpen] = React.useState(false);
    return <><button onClick={() => setOpen(true)}>打开分享包</button>{open && <StyleBundleDialog {...props()} onClose={() => setOpen(false)} />}</>;
  };
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: '打开分享包' });
  trigger.focus(); fireEvent.click(trigger);
  const close = await screen.findByRole('button', { name: '关闭' });
  const first = screen.getByRole('button', { name: '导出' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByLabelText('分享说明'));
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

it('列表刷新失败仍保留成功项，不把已写入风格串重新导入', async () => {
  const callbacks = props();
  callbacks.onImported.mockRejectedValueOnce(new Error('合成刷新失败'));
  mocks.import.mockResolvedValue({ createdIds: ['new-a'], importedEntryIds: ['a'], failed: [] });
  render(<StyleBundleDialog {...callbacks} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  fireEvent.change(screen.getByLabelText('选择 .naia 文件', { selector: 'input' }), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('checkbox', { name: '水彩' });
  fireEvent.change(screen.getByLabelText('搜索分享包'), { target: { value: '水彩' } });
  fireEvent.click(actionButton('导入筛选结果'));
  await waitFor(() => expect(callbacks.notify).toHaveBeenCalledWith('风格串已保存，列表刷新失败：合成刷新失败', 'error'));
  expect((screen.getByRole('checkbox', { name: '水彩' }) as HTMLInputElement).disabled).toBe(true);
  expect((actionButton('导入筛选结果') as HTMLButtonElement).disabled).toBe(true);
});

it('英文界面单条导入失败原因使用已有译文', async () => {
  setLanguage('en');
  mocks.import.mockResolvedValue({ createdIds: [], importedEntryIds: [], failed: [{ id: 'a', name: '水彩', error: '未收到新建风格串回执' }] });
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  fireEvent.change(screen.getByLabelText('Choose a .naia file', { selector: 'input' }), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('checkbox', { name: '水彩' });
  fireEvent.click(actionButton('Import all'));
  expect(await screen.findByText('No confirmation was received for the new style chain')).toBeTruthy();
  expect(screen.queryByText('未收到新建风格串回执')).toBeNull();
});
