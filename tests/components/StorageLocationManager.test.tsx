// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StorageLocationManager } from '../../components/StorageLocationManager';
import { type StorageLocationStatus } from '../../services/storageLocations';
import { type ExportLocation } from '../../services/exportLocation';

const mocks = vi.hoisted(() => ({
  status: vi.fn(), pick: vi.fn(), open: vi.fn(), switch: vi.fn(), cache: vi.fn(),
  exportStatus: vi.fn(), exportPick: vi.fn(), exportMode: vi.fn(), exportClear: vi.fn(),
  confirm: vi.fn(), android: false,
}));
vi.mock('../../services/storageLocations', () => ({ getStorageLocationStatus: mocks.status, pickStorageDirectory: mocks.pick, openStorageDirectory: mocks.open, switchStorageDataDirectory: mocks.switch, setStorageCacheDirectory: mocks.cache }));
vi.mock('../../services/exportLocation', () => ({ getExportLocation: mocks.exportStatus, pickExportDirectory: mocks.exportPick, setExportMode: mocks.exportMode, clearExportDirectory: mocks.exportClear }));
vi.mock('../../services/platform', () => ({ isAndroidApp: () => mocks.android }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));

const status: StorageLocationStatus = {
  available: true, mode: 'desktop', canManage: true,
  dataDir: 'C:\\Atelier', workspaceDir: 'C:\\Atelier\\workspace', cacheDir: 'D:\\Resources', cacheFollowsData: false,
  resourcePaths: { thumbnails: '', danbooru: '', models: '', tagData: '' }, state: { phase: 'idle' },
};
const exportState: ExportLocation = { mode: 'system', directory: '', canPickDirectory: true, canAsk: true, platform: 'desktop' };
beforeEach(() => {
  vi.resetAllMocks(); mocks.android = false; localStorage.clear();
  mocks.status.mockResolvedValue(status); mocks.exportStatus.mockResolvedValue(exportState);
  mocks.pick.mockResolvedValue({ cancelled: true, path: '' });
  mocks.confirm.mockResolvedValue(true); mocks.switch.mockResolvedValue({ restartRequired: true });
  mocks.cache.mockResolvedValue({ restartRequired: true });
  mocks.exportPick.mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const setup = async () => {
  const notify = vi.fn(); render(<StorageLocationManager notify={notify} />);
  await waitFor(() => expect((screen.getByRole('combobox', { name: '导出保存方式' }) as HTMLSelectElement).disabled).toBe(false));
  return notify;
};

it('只有展开编辑才显示切换方式；选择文件夹取消保留原输入且不迁移', async () => {
  await setup();
  expect(screen.queryByRole('combobox', { name: '目录切换方式' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更改工坊数据' }));
  const field = screen.getByRole('textbox', { name: '新的工坊数据位置' }) as HTMLInputElement;
  expect(field.value).toBe(status.dataDir);
  fireEvent.click(screen.getByRole('button', { name: '浏览' }));
  await waitFor(() => expect(mocks.pick).toHaveBeenCalledWith('data'));
  expect(field.value).toBe(status.dataDir);
  expect(mocks.switch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('迁移必须确认；取消确认不提交，确认后使用选中目标和migrate操作', async () => {
  const notify = await setup();
  fireEvent.click(screen.getByRole('button', { name: '更改工坊数据' }));
  fireEvent.change(screen.getByRole('textbox', { name: '新的工坊数据位置' }), { target: { value: 'D:\\New Atelier' } });
  mocks.confirm.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: '迁移并重启' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  expect(mocks.switch).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
  await waitFor(() => expect((screen.getByRole('button', { name: '迁移并重启' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '迁移并重启' }));
  await waitFor(() => expect(mocks.switch).toHaveBeenCalledWith('D:\\New Atelier', 'migrate'));
  expect(mocks.confirm.mock.calls[1][0].message).toContain('旧目录保留');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('正在切换'));
  expect((screen.getByRole('combobox', { name: '导出保存方式' }) as HTMLSelectElement).disabled).toBe(true);
});

it('打开另一工坊发送open而非迁移，不暗中合并', async () => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: '更改工坊数据' }));
  fireEvent.change(screen.getByRole('textbox', { name: '新的工坊数据位置' }), { target: { value: 'E:\\Existing' } });
  fireEvent.change(screen.getByRole('combobox', { name: '目录切换方式' }), { target: { value: 'open' } });
  fireEvent.click(screen.getByRole('button', { name: '打开并重启' }));
  await waitFor(() => expect(mocks.switch).toHaveBeenCalledWith('E:\\Existing', 'open'));
  expect(mocks.confirm.mock.calls[0][0].message).toContain('不合并');
});

it('设置失败保留目标和原状态，不显示成功并允许重试', async () => {
  const notify = await setup(); mocks.switch.mockRejectedValue(new Error('目标目录已有不同资料'));
  fireEvent.click(screen.getByRole('button', { name: '更改工坊数据' }));
  fireEvent.change(screen.getByRole('textbox', { name: '新的工坊数据位置' }), { target: { value: 'E:\\Conflict' } });
  fireEvent.click(screen.getByRole('button', { name: '迁移并重启' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('目标目录已有不同资料'));
  expect((screen.getByRole('textbox', { name: '新的工坊数据位置' }) as HTMLInputElement).value).toBe('E:\\Conflict');
  expect(screen.getByLabelText('工坊数据').contains(screen.getByRole('alert'))).toBe(true);
  expect(notify.mock.calls.some(call => call[1] === 'success')).toBe(false);
});

it('切换后台失败后显示失败原因并恢复编辑操作，不一直停在等待重启', async () => {
  const intervals = vi.spyOn(window, 'setInterval');
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '更改工坊数据' }));
  fireEvent.change(screen.getByRole('textbox', { name: '新的工坊数据位置' }), { target: { value: 'E:\\Target' } });
  fireEvent.click(screen.getByRole('button', { name: '迁移并重启' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('正在切换'));
  mocks.status.mockResolvedValue({ ...status, state: { phase: 'failed', error: '目标空间不足，已保留原工坊' } });
  const poll = intervals.mock.calls.find(([, delay]) => delay === 1000)![0] as () => Promise<void>;
  await act(async () => { await poll(); });
  expect(screen.getByRole('alert').textContent).toContain('目标空间不足');
  expect(screen.queryByRole('status')).toBeNull();
  expect((screen.getByRole('button', { name: '更改工坊数据' }) as HTMLButtonElement).disabled).toBe(false);
});

it('独立缓存位置可以恢复跟随工坊，发送空路径而非新目录', async () => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: '更改缓存与下载资源' }));
  fireEvent.click(screen.getByRole('button', { name: '跟随工坊' }));
  await waitFor(() => expect(mocks.cache).toHaveBeenCalledWith(''));
});

it('导出目录选择取消不改模式，选中后显示路径，清除回到系统默认', async () => {
  await setup(); const select = screen.getByRole('combobox', { name: '导出保存方式' }) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'directory' } });
  await waitFor(() => expect(mocks.exportPick).toHaveBeenCalledTimes(1));
  expect(select.value).toBe('system'); expect(mocks.exportMode).not.toHaveBeenCalled();
  const chosen = { ...exportState, mode: 'directory', directory: 'E:\\Exports' };
  mocks.exportPick.mockResolvedValue(chosen);
  await waitFor(() => expect(select.disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '更改默认导出位置' }));
  await waitFor(() => expect(select.value).toBe('directory'));
  expect(screen.getByText('E:\\Exports')).toBeTruthy();
  mocks.exportClear.mockResolvedValue(exportState);
  fireEvent.click(screen.getByRole('button', { name: '清除' }));
  await waitFor(() => expect(select.value).toBe('system'));
  expect(screen.queryByText('E:\\Exports')).toBeNull();
});

it.each(['button', 'mode'])('导出目录%s入口等待用户选定时显示选择窗口提示，不提前保存或迁移', async entry => {
  let finish!: (value: ExportLocation | null) => void;
  mocks.exportPick.mockReturnValue(new Promise<ExportLocation | null>(resolve => { finish = resolve; }));
  const notify = await setup();
  const select = screen.getByRole('combobox', { name: '导出保存方式' }) as HTMLSelectElement;
  if (entry === 'button') fireEvent.click(screen.getByRole('button', { name: '更改默认导出位置' }));
  else fireEvent.change(select, { target: { value: 'directory' } });
  expect(screen.getByRole('status').textContent).toContain('请在系统窗口中选择文件夹');
  expect(screen.getByRole('status').textContent).not.toContain('正在保存');
  expect(select.value).toBe('system');
  expect(mocks.exportMode).not.toHaveBeenCalled();
  expect(mocks.switch).not.toHaveBeenCalled(); expect(mocks.cache).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  await act(async () => { finish({ ...exportState, mode: 'directory', directory: 'E:\\Selected' }); });
  expect(select.value).toBe('directory');
  expect(screen.getByText('E:\\Selected')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('已保存');
  expect(select.disabled).toBe(false);
});

it('取消重新选择导出文件夹保留已有目录，退出选择状态并允许重试', async () => {
  let finish!: (value: ExportLocation | null) => void;
  mocks.exportStatus.mockResolvedValue({ ...exportState, mode: 'directory', directory: 'D:\\Existing' });
  mocks.exportPick.mockReturnValue(new Promise<ExportLocation | null>(resolve => { finish = resolve; }));
  const notify = await setup();
  fireEvent.click(screen.getByRole('button', { name: '更改默认导出位置' }));
  expect(screen.getByRole('status').textContent).toContain('选择文件夹');
  await act(async () => { finish(null); });
  expect(screen.getByText('D:\\Existing')).toBeTruthy();
  expect((screen.getByRole('combobox', { name: '导出保存方式' }) as HTMLSelectElement).value).toBe('directory');
  expect(screen.queryByRole('status')).toBeNull();
  expect(notify).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: '更改默认导出位置' }) as HTMLButtonElement).disabled).toBe(false);
});

it.each(['data', 'cache'] as const)('浏览%s位置等待选择时不显示保存，也不应用目录切换', async kind => {
  let finish!: (value: { path: string; cancelled: boolean }) => void;
  mocks.pick.mockReturnValue(new Promise<{ path: string; cancelled: boolean }>(resolve => { finish = resolve; }));
  await setup();
  fireEvent.click(screen.getByRole('button', { name: kind === 'data' ? '更改工坊数据' : '更改缓存与下载资源' }));
  fireEvent.click(screen.getByRole('button', { name: '浏览' }));
  expect(screen.getByRole('status').textContent).toContain('请在系统窗口中选择文件夹');
  expect(mocks.switch).not.toHaveBeenCalled(); expect(mocks.cache).not.toHaveBeenCalled();
  await act(async () => { finish({ path: '', cancelled: true }); });
  expect(screen.queryByRole('status')).toBeNull();
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(kind === 'data' ? status.dataDir : status.cacheDir);
});

it('目录选择器出错退出等待并保留原模式，明确错误后可重试', async () => {
  mocks.exportPick.mockRejectedValue(new Error('选择文件夹超时，请重试'));
  const notify = await setup();
  fireEvent.click(screen.getByRole('button', { name: '更改默认导出位置' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('选择文件夹超时'));
  expect(screen.queryByRole('status')).toBeNull();
  expect((screen.getByRole('combobox', { name: '导出保存方式' }) as HTMLSelectElement).value).toBe('system');
  expect((screen.getByRole('button', { name: '更改默认导出位置' }) as HTMLButtonElement).disabled).toBe(false);
  expect(notify).not.toHaveBeenCalled();
  expect(screen.getByLabelText('默认导出位置').contains(screen.getByRole('alert'))).toBe(true);
});

it('保存反馈留在导出项，成功两秒消失且不锁住其他设置；后一次操作不被旧定时器清掉', async () => {
  await setup(); vi.useFakeTimers();
  mocks.exportMode.mockResolvedValueOnce({ ...exportState, mode: 'ask' });
  fireEvent.change(screen.getByRole('combobox', { name: '导出保存方式' }), { target: { value: 'ask' } });
  await act(async () => {});
  expect(screen.getByRole('status').textContent).toContain('已保存');
  expect(screen.getByLabelText('默认导出位置').contains(screen.getByRole('status'))).toBe(true);
  expect((screen.getByRole('button', { name: '更改工坊数据' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
  expect(screen.getByRole('status').textContent).toContain('已保存');
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.queryByRole('status')).toBeNull();
  mocks.exportMode.mockResolvedValueOnce(exportState);
  fireEvent.change(screen.getByRole('combobox', { name: '导出保存方式' }), { target: { value: 'system' } });
  await act(async () => {});
  let finish!: (value: ExportLocation) => void;
  mocks.exportMode.mockReturnValueOnce(new Promise<ExportLocation>(resolve => { finish = resolve; }));
  fireEvent.change(screen.getByRole('combobox', { name: '导出保存方式' }), { target: { value: 'ask' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole('status').textContent).toContain('正在保存');
  await act(async () => { finish({ ...exportState, mode: 'ask' }); });
  expect(screen.getByRole('status').textContent).toContain('已保存');
});

it('保存失败行内显示原因及重试，点击重试后保存成功，未自动重复请求', async () => {
  await setup();
  mocks.exportMode.mockRejectedValueOnce(new Error('保存导出设置超时'));
  mocks.exportMode.mockResolvedValueOnce({ ...exportState, mode: 'ask' });
  fireEvent.change(screen.getByRole('combobox', { name: '导出保存方式' }), { target: { value: 'ask' } });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('保存导出设置超时'));
  expect(mocks.exportMode).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('button', { name: '更改缓存与下载资源' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(mocks.exportMode).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('已保存');
});

it('默认模式也能直接更改，等待选择时只锁相关操作，取消不会显示已保存', async () => {
  let finish!: (value: ExportLocation | null) => void;
  mocks.exportPick.mockReturnValue(new Promise<ExportLocation | null>(resolve => { finish = resolve; }));
  await setup();
  const change = screen.getByRole('button', { name: '更改默认导出位置' }) as HTMLButtonElement;
  expect(change.disabled).toBe(false);
  fireEvent.click(change);
  expect(change.disabled).toBe(true);
  expect((screen.getByRole('button', { name: '更改工坊数据' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '更改工坊数据' }));
  expect(screen.getByRole('textbox', { name: '新的工坊数据位置' })).toBeTruthy();
  expect((screen.getByRole('button', { name: '迁移并重启' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { finish(null); });
  expect(screen.queryByRole('status')).toBeNull();
  expect(change.disabled).toBe(false);
});

it.each([
  ['desktop', 'C:\\Users\\Synthetic\\Downloads', 'C:\\Users\\Synthetic\\Downloads'],
  ['browser', '', '由浏览器下载设置决定'],
  ['android', '', 'Pictures/NAI Atelier'],
] as const)('%s显示真实可知的默认位置，不伪造浏览器下载路径', async (platform, systemDirectory, expected) => {
  mocks.android = platform === 'android';
  mocks.exportStatus.mockResolvedValue({ ...exportState, platform, systemDirectory });
  await setup();
  expect(screen.getByText(expected)).toBeTruthy();
  if (platform === 'android') expect(screen.getByText('图片保存至相册，其余由系统询问')).toBeTruthy();
});

it('每次询问沿用导出API，不更改工坊路径', async () => {
  await setup(); mocks.exportMode.mockResolvedValue({ ...exportState, mode: 'ask' });
  fireEvent.change(screen.getByRole('combobox', { name: '导出保存方式' }), { target: { value: 'ask' } });
  await waitFor(() => expect(mocks.exportMode).toHaveBeenCalledWith('ask'));
  expect(mocks.switch).not.toHaveBeenCalled(); expect(mocks.cache).not.toHaveBeenCalled();
});

it('局域网入口只读主机位置，不提供远程打开或迁移，下载仍归访问设备', async () => {
  mocks.status.mockResolvedValue({ ...status, canManage: false });
  mocks.exportStatus.mockResolvedValue({ ...exportState, platform: 'browser', canAsk: false, canPickDirectory: false });
  await setup();
  expect(screen.getByText('请在运行工坊的电脑上更改数据与资源位置。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '更改工坊数据' })).toBeNull();
  expect(screen.queryByRole('button', { name: '打开工坊数据文件夹' })).toBeNull();
  expect((screen.getByRole('option', { name: '自定义文件夹' }) as HTMLOptionElement).disabled).toBe(true);
  expect((screen.getByRole('option', { name: '每次询问' }) as HTMLOptionElement).disabled).toBe(true);
});

it('Android显示私有数据位置，仅设置公共导出位置而不调用电脑目录接口', async () => {
  mocks.android = true; mocks.exportStatus.mockResolvedValue({ ...exportState, platform: 'android' });
  await setup(); expect(mocks.status).not.toHaveBeenCalled();
  expect(screen.getByText('Android 应用私有存储')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '更改工坊数据' })).toBeNull();
  expect(screen.getByRole('button', { name: '更改默认导出位置' })).toBeTruthy();
});
