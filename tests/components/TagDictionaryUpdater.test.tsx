// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TagDictionaryUpdater } from '../../components/TagDictionaryUpdater';
import { TagUpdateStatus } from '../../services/tagDictionaryUpdater';
import { setLanguage } from '../../services/i18n';

const mocks = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), reset: vi.fn(), importFile: vi.fn() }));
vi.mock('../../services/tagDictionaryUpdater', () => ({
  getTagUpdateStatus: mocks.get,
  startTagUpdate: mocks.start,
  importTagDictionaryFile: mocks.importFile,
  TAG_IMPORT_MAX_BYTES: 256 * 1024 * 1024
}));
vi.mock('../../services/tagDictionary', () => ({ resetTagDictionaryCache: mocks.reset }));
const idle: TagUpdateStatus = { available: true, running: false, phase: 'idle', message: '可以检查更新', startedAt: null, finishedAt: null, manifest: { count: 123, generatedAt: null, sourceLastModified: null } };
beforeEach(() => { vi.resetAllMocks(); mocks.get.mockResolvedValue(idle); });
afterEach(() => { cleanup(); vi.useRealTimers(); setLanguage('zh-CN'); });

it('设置行直接更新，进度与词库摘要留在原位，不创建弹窗', async () => {
  const running = { ...idle, running: true, phase: 'downloading', message: '正在下载最新数据库…' };
  const view = render(<div className="safe-mode dark"><TagDictionaryUpdater notify={vi.fn()} /></div>);
  await screen.findByText('123');
  expect(screen.queryByRole('progressbar')).toBeNull();
  mocks.start.mockResolvedValue(running); mocks.get.mockResolvedValue(running);
  fireEvent.click(screen.getByRole('button', { name: '更新词库' }));
  const progress = await screen.findByRole('progressbar');
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(progress.closest('.safe-mode.dark')).toBe(view.container.firstElementChild);
  expect(progress.getAttribute('aria-valuenow')).toBe('40');
  expect((screen.getByRole('button', { name: '更新中…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(view.container.querySelector('h4')?.parentElement?.classList.contains('flex-wrap')).toBe(true);
  expect(screen.getByText('词库生成时间：未知').parentElement?.classList.contains('flex-wrap')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '更新中…' }));
  expect(mocks.start).toHaveBeenCalledTimes(1);
});

it('主备线路错误逐行显示，失败后可以直接重试', async () => {
  const message = '主线路（primary.invalid）：连接超时\n备用线路（fallback.invalid）：下载服务器返回 403 Forbidden';
  mocks.get.mockResolvedValue({ ...idle, phase: 'error', message });
  render(<TagDictionaryUpdater notify={vi.fn()} />);
  const error = await screen.findByRole('alert');
  expect(error.textContent).toBe(message);
  expect(error.classList.contains('whitespace-pre-line')).toBe(true);
  expect(error.classList.contains('[overflow-wrap:anywhere]')).toBe(true);
  expect((screen.getByRole('button', { name: '更新词库' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('progressbar').firstElementChild?.classList.contains('bg-red-500')).toBe(true);
  mocks.start.mockResolvedValue({ ...idle, running: true, phase: 'checking' });
  fireEvent.click(screen.getByRole('button', { name: '更新词库' }));
  await screen.findByRole('button', { name: '更新中…' });
  expect(mocks.start).toHaveBeenCalledTimes(1);
});

it('完成后更新摘要且不重复处理，重新打开设置刷新缓存并省去旧通知', async () => {
  vi.useFakeTimers();
  const notify = vi.fn();
  const running = { ...idle, running: true, phase: 'generating' };
  mocks.get.mockResolvedValue(running);
  const view = render(<TagDictionaryUpdater notify={notify} />);
  await act(async () => {});
  const completed = { ...idle, phase: 'completed', message: 'Tag 词库更新完成', finishedAt: '2026-10-12T00:00:00Z', manifest: { ...idle.manifest!, count: 456, generatedAt: '2026-10-12T00:00:00Z' } };
  mocks.get.mockResolvedValue(completed);
  await act(async () => { await vi.advanceTimersByTimeAsync(701); });
  expect(screen.getByText('456')).toBeTruthy();
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  expect(mocks.reset).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(3001); });
  expect(mocks.reset).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<TagDictionaryUpdater notify={notify} />);
  await act(async () => {});
  expect(notify).toHaveBeenCalledTimes(1);
  expect(mocks.reset).toHaveBeenCalledTimes(2);
});

it.each([
  ['zh-TW', '主線路（primary.invalid）', '備用線路（fallback.invalid）'],
  ['en', 'Primary (primary.invalid)', 'Fallback (fallback.invalid)'],
  ['ja', '主回線（primary.invalid）', '予備回線（fallback.invalid）'],
  ['ko', '기본 경로 (primary.invalid)', '예비 경로 (fallback.invalid)'],
] as const)('%s 主备线路标签分别翻译，域名和服务错误保持原文', async (language, primary, fallback) => {
  setLanguage(language);
  mocks.get.mockResolvedValue({ ...idle, phase: 'error', message: '主线路（primary.invalid）：HTTP 502\n备用线路（fallback.invalid）：HTTP 403' });
  render(<TagDictionaryUpdater notify={vi.fn()} />);
  const error = await screen.findByRole('alert');
  expect(error.textContent).toContain(primary);
  expect(error.textContent).toContain(fallback);
  expect(error.textContent).toContain('HTTP 502\n');
  expect(error.textContent).toContain('HTTP 403');
});

it('首次手机安装没有词库清单时正常显示零条与未知时间', async () => {
  mocks.get.mockResolvedValue({ ...idle, manifest: null });
  render(<TagDictionaryUpdater notify={vi.fn()} />);
  await screen.findByText('0');
  expect(screen.getByText('词库生成时间：未知')).toBeTruthy();
});

it('三个操作共用同一形状，导入使用进入本地的向下图标', async () => {
  render(<TagDictionaryUpdater notify={vi.fn()} />);
  await screen.findByText('123');
  for (const element of [
    screen.getByRole('link', { name: '词库来源' }),
    screen.getByRole('button', { name: '导入词库' }),
    screen.getByRole('button', { name: '更新词库' })
  ]) {
    expect(element.className).toContain('rounded-lg');
    expect(element.className).toContain('px-2.5');
    expect(element.className).toContain('text-sm');
  }
  expect(screen.getByRole('button', { name: '导入词库' }).querySelector('svg')?.getAttribute('class')).toContain('lucide-import');
});

it('设置行说明指明仓库根目录的 tag.sqlite，并提供下载直链', async () => {
  render(<TagDictionaryUpdater notify={vi.fn()} />);
  await screen.findByText('123');
  expect(screen.getByText(/在仓库根目录下载 tag\.sqlite（约 24 MB）/)).toBeTruthy();
  const link = screen.getByRole('link', { name: '下载直链' });
  expect(link.getAttribute('href')).toBe('https://raw.githubusercontent.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table/main/tag.sqlite');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(screen.getByTitle('打开词库 GitHub 原址（仓库根目录的 tag.sqlite 可手动下载）')).toBeTruthy();
});

it('内置下载失败时可选择本地 tag.sqlite 导入，上传进度与生成状态留在设置行', async () => {
  let resolveImport!: (value: TagUpdateStatus) => void;
  const generating: TagUpdateStatus = { ...idle, running: true, phase: 'generating', message: '正在生成中英文 Tag 分片…' };
  mocks.importFile.mockImplementation((_file: File, onProgress?: (percent: number) => void) => {
    onProgress?.(60);
    return new Promise<TagUpdateStatus>(resolve => { resolveImport = resolve; });
  });
  const notify = vi.fn();
  const view = render(<TagDictionaryUpdater notify={notify} />);
  await screen.findByText('123');
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input.accept).toBe('.sqlite,.db,.sqlite3,application/octet-stream,application/x-sqlite3,application/vnd.sqlite3');
  expect(screen.getByRole('button', { name: '导入词库' })).toBeTruthy();
  const file = new File(['SQLite format 3\u0000synthetic'], 'tag.sqlite', { type: 'application/octet-stream' });
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByRole('button', { name: '上传中…' });
  expect(mocks.importFile).toHaveBeenCalledTimes(1);
  expect((mocks.importFile.mock.calls[0] as unknown[])[0]).toBe(file);
  expect(screen.getByRole('status').textContent).toBe('正在上传词库文件… 60%');
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('24');
  expect((screen.getByRole('button', { name: '更新中…' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '上传中…' }) as HTMLButtonElement).disabled).toBe(true);
  // running 状态变化会重跑 effect 刷新服务端状态；模拟真实服务端已进入生成阶段。
  mocks.get.mockResolvedValue(generating);
  await act(async () => { resolveImport(generating); });
  expect(screen.getByRole('status').textContent).toBe('正在生成中英文 Tag 分片…');
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('65');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(notify).not.toHaveBeenCalled();
});

it('导入失败在原位显示原因并恢复操作，不丢现有词库摘要', async () => {
  const reason = '导入的文件不是有效的 SQLite 词库，请在词库来源下载 tag.sqlite 后重试';
  mocks.importFile.mockRejectedValue(new Error(reason));
  const notify = vi.fn();
  const view = render(<TagDictionaryUpdater notify={notify} />);
  await screen.findByText('123');
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['not-a-dictionary'], 'tag.sqlite')] } });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(reason));
  expect(notify).toHaveBeenCalledWith(reason, 'error');
  expect((screen.getByRole('button', { name: '导入词库' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText('123')).toBeTruthy();
  expect(screen.getByRole('progressbar').firstElementChild?.classList.contains('bg-red-500')).toBe(true);
});

it('空文件与超过上限的文件直接提示，不发起上传', async () => {
  const notify = vi.fn();
  const view = render(<TagDictionaryUpdater notify={notify} />);
  await screen.findByText('123');
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([], 'tag.sqlite')] } });
  await waitFor(() => expect(notify).toHaveBeenCalledWith('选择的词库文件是空的，请重新下载 tag.sqlite', 'error'));
  const oversized = new File(['x'], 'tag.sqlite');
  Object.defineProperty(oversized, 'size', { value: 300 * 1024 * 1024 });
  fireEvent.change(input, { target: { files: [oversized] } });
  await waitFor(() => expect(notify).toHaveBeenCalledWith('词库文件不能超过 256 MB，请确认选择的是 tag.sqlite', 'error'));
  expect(mocks.importFile).not.toHaveBeenCalled();
});

it('请求尚未返回时禁用更新；连接失败在设置行内提示并恢复操作', async () => {
  let reject!: (error: Error) => void;
  mocks.start.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  const notify = vi.fn();
  render(<TagDictionaryUpdater notify={notify} />);
  await screen.findByText('123');
  fireEvent.click(screen.getByRole('button', { name: '更新词库' }));
  expect((screen.getByRole('button', { name: '更新中…' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { reject(new Error('更新服务不可用')); });
  expect(screen.getByRole('alert').textContent).toBe('更新服务不可用');
  expect((screen.getByRole('button', { name: '更新词库' }) as HTMLButtonElement).disabled).toBe(false);
  expect(notify).toHaveBeenCalledWith('更新服务不可用', 'error');
});
