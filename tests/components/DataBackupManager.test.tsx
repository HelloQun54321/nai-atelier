// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataBackupManager } from '../../components/DataBackupManager';

const mocks = vi.hoisted(() => ({
  storageStatus: vi.fn(), pickDirectory: vi.fn(), backupStatus: vi.fn(), saveConfig: vi.fn(), confirm: vi.fn(), deleteBackup: vi.fn(),
}));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));

vi.mock('../../services/storageLocations', () => ({
  getStorageLocationStatus: mocks.storageStatus,
  pickStorageDirectory: mocks.pickDirectory,
}));
vi.mock('../../services/localBackup', () => ({
  getLocalBackupStatus: mocks.backupStatus,
  saveLocalBackupConfig: mocks.saveConfig,
  formatBackupDate: () => 'date', formatBytes: () => '0 B',
  openLocalBackupFolder: vi.fn(), startLocalBackup: vi.fn(), deleteLocalBackup: mocks.deleteBackup,
}));

const backupStatus = {
  running: false, phase: 'idle', startedAt: null, finishedAt: null, error: null,
  progress: { copiedFiles: 0, totalFiles: 0, copiedBytes: 0, totalBytes: 0, currentItem: '', percent: 0 },
  targetDir: 'C:\\Backups', targetDirExists: false, sourceDir: 'local-data',
  sourceStats: { fileCount: 0, totalBytes: 0 }, currentBackup: null, lastBackup: null, backups: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.storageStatus.mockResolvedValue({ canManage: true });
  mocks.pickDirectory.mockResolvedValue({ cancelled: true, path: '' });
  mocks.backupStatus.mockResolvedValue(backupStatus);
  mocks.saveConfig.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

it('备份删除复用独立类型确认，取消不执行删除，确认后才删除所选存档', async () => {
  mocks.backupStatus.mockResolvedValue({ ...backupStatus, backups: [{ name: 'synthetic-backup', path: 'D:/synthetic-backup', createdAt: '', totalBytes: 1, fileCount: 1 }] });
  mocks.confirm.mockResolvedValue(false);
  render(<DataBackupManager notify={vi.fn()} />);
  await waitFor(() => expect(mocks.backupStatus).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /历史备份存档/ }));
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ rememberKey: 'backup.delete', rememberScope: 'C:\\Backups', message: 'synthetic-backup' })));
  expect(mocks.deleteBackup).not.toHaveBeenCalled();
  mocks.confirm.mockResolvedValue(true);
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  await waitFor(() => expect(mocks.deleteBackup).toHaveBeenCalledWith('synthetic-backup'));
});

const openTargetEditor = async () => {
  render(<DataBackupManager notify={vi.fn()} />);
  await waitFor(() => expect(mocks.backupStatus).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '修改路径' }));
  return screen.getByRole('textbox', { name: '备份目标目录' }) as HTMLInputElement;
};

it('本机可浏览目录；取消选择保留编辑路径且不会保存', async () => {
  const input = await openTargetEditor();
  fireEvent.change(input, { target: { value: 'D:\\Typed backups' } });
  expect(screen.getByRole('button', { name: '浏览文件夹' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '浏览文件夹' }));
  await waitFor(() => expect(mocks.pickDirectory).toHaveBeenCalledWith('backup'));
  expect(input.value).toBe('D:\\Typed backups');
  expect(mocks.saveConfig).not.toHaveBeenCalled();
});

it('本机选择目录后填入输入框，并可通过现有保存按钮保存该路径', async () => {
  mocks.pickDirectory.mockResolvedValue({ cancelled: false, path: 'E:\\Selected backup' });
  const input = await openTargetEditor();
  fireEvent.click(screen.getByRole('button', { name: '浏览文件夹' }));
  await waitFor(() => expect(input.value).toBe('E:\\Selected backup'));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(mocks.saveConfig).toHaveBeenCalledWith({ targetDir: 'E:\\Selected backup' }));
});

it('目录选择进行中显示选择状态并禁用按钮', async () => {
  let finishPick!: (value: { cancelled: boolean; path: string }) => void;
  mocks.pickDirectory.mockReturnValue(new Promise(resolve => { finishPick = resolve; }));
  await openTargetEditor();
  const browseButton = screen.getByRole('button', { name: '浏览文件夹' });
  fireEvent.click(browseButton);
  expect((screen.getByRole('button', { name: '选择中…' }) as HTMLButtonElement).disabled).toBe(true);
  finishPick({ cancelled: true, path: '' });
  await waitFor(() => expect((screen.getByRole('button', { name: '浏览文件夹' }) as HTMLButtonElement).disabled).toBe(false));
});

it('LAN 只显示手动路径编辑，不提供本机目录浏览', async () => {
  mocks.storageStatus.mockResolvedValue({ canManage: false });
  await openTargetEditor();
  expect(screen.queryByRole('button', { name: '浏览文件夹' })).toBeNull();
  expect(mocks.pickDirectory).not.toHaveBeenCalled();
});

it('备份卡片窄屏为可收缩单列，长路径不扩大整列宽度', async () => {
  mocks.backupStatus.mockResolvedValue({ ...backupStatus, targetDir: `D:\\${'很长的备份文件夹\\'.repeat(12)}` });
  render(<DataBackupManager notify={vi.fn()} />);
  const sourceCard = (await screen.findByText('当前本地源数据 (local-data)')).closest('div.rounded-xl')!;
  const grid = sourceCard.parentElement!;
  expect(grid.classList.contains('grid-cols-1')).toBe(true);
  expect(grid.classList.contains('sm:grid-cols-2')).toBe(true);
  expect([...grid.children].every(card => card.classList.contains('min-w-0'))).toBe(true);
});


it('首次读取等待与失败不展示虚假的源数据、目录或空备份，重试成功才显示真实空态', async () => {
  const pending = Promise.withResolvers<typeof backupStatus>();
  mocks.backupStatus.mockReturnValue(pending.promise);
  render(<DataBackupManager notify={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toContain('正在读取…');
  expect(screen.queryByText('0 B')).toBeNull();
  expect(screen.queryByText('首次备份时将自动创建该目录')).toBeNull();
  expect(screen.queryByRole('button', { name: /历史备份存档/ })).toBeNull();
  await act(async () => pending.reject(new Error('无法读取备份状态')));
  expect(screen.getByRole('alert').textContent).toContain('无法读取备份状态');
  expect(screen.queryByText('0 B')).toBeNull();
  expect(screen.queryByText('暂无备份')).toBeNull();
  mocks.backupStatus.mockResolvedValue(backupStatus);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  fireEvent.click(await screen.findByRole('button', { name: /历史备份存档/ }));
  expect(screen.getByText('暂无备份')).toBeTruthy();
});

it('后台刷新等待和失败保留已经读取的备份与源数据', async () => {
  const saved = { ...backupStatus, sourceStats: { fileCount: 123, totalBytes: 456 }, backups: [{ name: 'synthetic-cache', path: 'D:/synthetic-cache', createdAt: '', totalBytes: 1, fileCount: 1 }] };
  mocks.backupStatus.mockResolvedValue(saved);
  render(<DataBackupManager notify={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /历史备份存档/ }));
  expect(screen.getByText('synthetic-cache')).toBeTruthy();
  const pending = Promise.withResolvers<typeof saved>();
  mocks.backupStatus.mockReturnValue(pending.promise);
  // 通过原有编辑状态触发读取，不调用备份或任何写入操作。
  fireEvent.click(screen.getByRole('button', { name: '修改路径' }));
  expect(screen.getByText('synthetic-cache')).toBeTruthy();
  await act(async () => pending.reject(new Error('synthetic refresh failure')));
  expect(screen.getByText('synthetic-cache')).toBeTruthy();
  expect(screen.getByText('· 123 个文件')).toBeTruthy();
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
});
