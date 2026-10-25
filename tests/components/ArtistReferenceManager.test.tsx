// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtistReferenceManager } from '../../components/ArtistReferenceManager';
import type { ArtistReferenceStatus } from '../../services/artistReference';

const mocks = vi.hoisted(() => ({ status: vi.fn(), control: vi.fn(), confirm: vi.fn() }));
vi.mock('../../services/artistReference', async original => ({ ...await original<typeof import('../../services/artistReference')>(), getArtistReferenceStatus: mocks.status, controlArtistReference: mocks.control }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));

const makeStatus = (patch: Partial<ArtistReferenceStatus> = {}): ArtistReferenceStatus => ({
  available: true, canManage: true, source: { label: '画师串工作室', url: 'https://reference.invalid' }, phase: 'missing', version: '', revision: 0, updatedAt: '', fetchedAt: 0,
  count: 0, artistCount: 0, thumbnails: { cached: 0, total: 0 }, sync: { stage: 'idle', done: 0, total: 0, failed: 0, error: '' }, ...patch,
});
const ready = (patch: Partial<ArtistReferenceStatus> = {}) => makeStatus({ phase: 'ready', version: '4:1', revision: 4, updatedAt: '2026-10-24T13:18:13Z', fetchedAt: 1, count: 697, artistCount: 659, thumbnails: { cached: 703, total: 703 }, ...patch });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.status.mockResolvedValue(makeStatus());
  mocks.confirm.mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('首次下载交给后台，下载缩略图时显示进度与取消，完成后通知画师库换用新数据', async () => {
  const changed = vi.fn();
  window.addEventListener('nai-artist-reference-changed', changed);
  try {
    const syncing = makeStatus({ phase: 'ready', revision: 4, artistCount: 659, sync: { stage: 'thumbnails', done: 300, total: 600, failed: 0, error: '' } });
    mocks.control.mockResolvedValueOnce({ status: syncing });
    render(<ArtistReferenceManager />);
    fireEvent.click(await screen.findByRole('button', { name: '下载参考 · 约 11 MB' }));
    expect(mocks.control).toHaveBeenCalledWith('sync');
    expect(await screen.findByText('正在下载例图缩略图：300 / 600')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '例图缩略图下载进度' }).getAttribute('aria-valuenow')).toBe('50');
    mocks.status.mockResolvedValue(ready({ sync: { stage: 'ready', done: 600, total: 600, failed: 2, error: '' } }));
    await waitFor(() => expect(screen.getByRole('button', { name: '检查更新' })).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('2 张例图缩略图未下载，浏览时会再次尝试')).toBeTruthy();
    expect(changed).toHaveBeenCalled();
    expect(screen.getByText(/可用 · 659 位画师 · 第 4 版/)).toBeTruthy();
  } finally { window.removeEventListener('nai-artist-reference-changed', changed); }
});

it('同步中主按钮改为取消；失败原因就地显示并保留已有数据', async () => {
  mocks.status.mockResolvedValue(ready({ sync: { stage: 'fetching', done: 0, total: 0, failed: 0, error: '' } }));
  mocks.control.mockResolvedValue({ status: ready({ sync: { stage: 'error', done: 0, total: 0, failed: 0, error: '无法连接画师串工作室，已保留现有数据' } }) });
  render(<ArtistReferenceManager />);
  expect(await screen.findByText('正在下载参考数据…')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(mocks.control).toHaveBeenCalledWith('cancel');
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '无法连接画师串工作室，已保留现有数据');
});

it('删除前确认，取消确认不删除；局域网设备只读', async () => {
  mocks.status.mockResolvedValue(ready());
  mocks.control.mockResolvedValue({ status: makeStatus() });
  const { unmount } = render(<ArtistReferenceManager />);
  fireEvent.click(await screen.findByRole('button', { name: '参考数据管理' }));
  mocks.confirm.mockResolvedValueOnce(false);
  fireEvent.click(await screen.findByRole('button', { name: '删除参考数据' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '删除画师组串参考', tone: 'danger' })));
  expect(mocks.control).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '参考数据管理' }));
  fireEvent.click(await screen.findByRole('button', { name: '删除参考数据' }));
  await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('remove'));
  expect(await screen.findByRole('button', { name: '下载参考 · 约 11 MB' })).toBeTruthy();
  unmount();

  mocks.status.mockResolvedValue(ready({ canManage: false }));
  render(<ArtistReferenceManager />);
  const locked = await screen.findByRole('button', { name: '仅工坊电脑可操作' });
  expect(locked.hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('button', { name: '参考数据管理' })).toBeNull();
  expect(screen.queryByRole('button', { name: '删除参考数据' })).toBeNull();
});

it('始终标注来源链接，下载后按数据署名致谢测试者', async () => {
  mocks.status.mockResolvedValue(makeStatus());
  const { unmount } = render(<ArtistReferenceManager />);
  const link = await screen.findByRole('link', { name: '画师串工作室' });
  expect(link.getAttribute('href')).toBe('https://reference.invalid');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(screen.getByText('致谢：感谢画师串工作室的整理与维护。')).toBeTruthy();
  unmount();
  mocks.status.mockResolvedValue(ready({ credits: { source: '画师串工作室', url: 'https://reference.invalid', testers: ['雨燕', '花枝鱼', '九七'] } }));
  render(<ArtistReferenceManager />);
  expect(await screen.findByText('致谢：感谢画师串工作室的整理与维护，以及测试者 雨燕、花枝鱼、九七 提供的例图与评价。')).toBeTruthy();
});

it('读取状态失败可重试', async () => {
  mocks.status.mockRejectedValueOnce(new Error('画师组串参考仅支持电脑端及局域网访问'));
  render(<ArtistReferenceManager />);
  expect(await screen.findByText(/仅支持电脑端及局域网访问/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试读取状态' }));
  expect(await screen.findByRole('button', { name: '下载参考 · 约 11 MB' })).toBeTruthy();
});
