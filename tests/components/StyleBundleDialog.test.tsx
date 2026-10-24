// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { StyleBundleDialog } from '../../components/chain/StyleBundleDialog';
import { setLanguage } from '../../services/i18n';

const mocks = vi.hoisted(() => ({ read: vi.fn(), export: vi.fn(), import: vi.fn(), download: vi.fn(), target: vi.fn(), openDirectory: vi.fn(), getAllChains: vi.fn() }));
vi.mock('../../services/dbService', () => ({ db: { getAllChains: mocks.getAllChains } }));
vi.mock('../../services/styleBundle', () => ({ readStyleBundle: mocks.read, exportStyleBundle: mocks.export, importStyleBundle: mocks.import }));
vi.mock('../../services/exportLocation', () => ({ beginExportTarget: mocks.target, openExportDirectory: mocks.openDirectory }));
vi.mock('../../services/fileDownload', () => ({ downloadFile: mocks.download }));
vi.mock('../../components/MobileUI', () => ({ useMobileHistoryLayer: (_open: boolean, close: () => void) => close }));

const chains = Array.from({ length: 65 }, (_, index) => ({ id: `chain-${index}`, name: `风格 ${index}`, type: 'style' } as PromptChain));
const props = () => ({ chains, filteredChains: chains.slice(0, 63), selectedChains: chains.slice(61), initialScope: 'all' as const, onClose: vi.fn(), onImported: vi.fn(), notify: vi.fn() });
const preview = { entries: [
  { id: 'a', name: '水彩', description: '纸张', cover: true, sources: [{ author: '作者甲', sourceUrl: 'https://example.org/free', note: '免费分享' }] },
  { id: 'b', name: '素描', description: '铅笔', cover: false, sources: [] },
], coverage: 'full' as const, warnings: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(preview);
  mocks.export.mockResolvedValue(new Blob(['synthetic']));
  mocks.download.mockResolvedValue({ saved: true, cancelled: false });
  mocks.target.mockReturnValue(undefined);
  mocks.openDirectory.mockResolvedValue(undefined);
  mocks.getAllChains.mockResolvedValue(chains);
});
afterEach(() => { cleanup(); setLanguage('zh-CN'); });

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
  const footer = button.closest('footer')!;
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
  fireEvent.change(screen.getByLabelText('选择 .naia 文件'), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  expect(await screen.findByText(label)).toBeTruthy();
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
  fireEvent.change(screen.getByLabelText('选择 .naia 文件'), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('checkbox', { name: '水彩' });
  expect(screen.getByRole('link', { name: 'https://example.org/free' }).getAttribute('rel')).toBe('noopener noreferrer');
  fireEvent.click(screen.getByRole('button', { name: '导入全部' }));
  await screen.findByText('合成保存失败');
  expect(mocks.import.mock.calls[0][1]).toEqual(['a', 'b']);
  expect((screen.getByRole('checkbox', { name: '水彩' }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('搜索分享包'), { target: { value: '铅笔' } });
  fireEvent.click(screen.getByRole('button', { name: '导入筛选结果' }));
  await waitFor(() => expect(callbacks.onImported).toHaveBeenCalledTimes(2));
  expect(mocks.import.mock.calls[1][1]).toEqual(['b']);
  expect(screen.queryByText('合成保存失败')).toBeNull();
});

it('取消选文件保留原预览与可导入选择', async () => {
  mocks.import.mockResolvedValue({ createdIds: [], importedEntryIds: [], failed: [] });
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
  const input = screen.getByLabelText('选择 .naia 文件');
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
  const input = screen.getByLabelText('选择 .naia 文件');
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
  for (const name of ['导入全部', '导入筛选结果', '导入已选（0）']) {
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
  fireEvent.change(screen.getByLabelText('选择 .naia 文件'), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('checkbox', { name: '水彩' });
  fireEvent.change(screen.getByLabelText('搜索分享包'), { target: { value: '作者甲' } });
  expect(screen.queryByRole('checkbox', { name: '素描' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
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
  fireEvent.change(screen.getByLabelText('选择 .naia 文件'), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('button', { name: '加载更多（5）' });
  expect(screen.queryByRole('checkbox', { name: '包内风格 104' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '导入筛选结果' }));
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
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '导出 65 条' }));
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(document.activeElement).toBe(close);
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
  fireEvent.change(screen.getByLabelText('选择 .naia 文件'), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('checkbox', { name: '水彩' });
  fireEvent.change(screen.getByLabelText('搜索分享包'), { target: { value: '水彩' } });
  fireEvent.click(screen.getByRole('button', { name: '导入筛选结果' }));
  await waitFor(() => expect(callbacks.notify).toHaveBeenCalledWith('风格串已保存，列表刷新失败：合成刷新失败', 'error'));
  expect((screen.getByRole('checkbox', { name: '水彩' }) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '导入筛选结果' }) as HTMLButtonElement).disabled).toBe(true);
});

it('英文界面单条导入失败原因使用已有译文', async () => {
  setLanguage('en');
  mocks.import.mockResolvedValue({ createdIds: [], importedEntryIds: [], failed: [{ id: 'a', name: '水彩', error: '未收到新建风格串回执' }] });
  render(<StyleBundleDialog {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  fireEvent.change(screen.getByLabelText('Choose a .naia file'), { target: { files: [new File(['synthetic'], 'styles.naia')] } });
  await screen.findByRole('checkbox', { name: '水彩' });
  fireEvent.click(screen.getByRole('button', { name: 'Import all' }));
  expect(await screen.findByText('No confirmation was received for the new style chain')).toBeTruthy();
  expect(screen.queryByText('未收到新建风格串回执')).toBeNull();
});
