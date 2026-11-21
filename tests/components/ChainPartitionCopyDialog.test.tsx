// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChainPartitionCopyDialog } from '../../components/chain/ChainPartitionCopyDialog';
import { copyChainsToPartition } from '../../services/chainPartitionCopy';
vi.mock('../../services/chainPartitionCopy', () => ({ copyChainsToPartition: vi.fn() }));
vi.mock('../../components/MobileUI', () => ({ useMobileHistoryLayer: (_open: boolean, close: () => void) => close }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(copyChainsToPartition).mockResolvedValue(undefined); });
afterEach(cleanup);
const props = () => ({ ids: ['original-a', 'original-b'], destinations: [{ id: 'own', name: '我的风格串' }, { id: 'a'.repeat(64), name: '目标分享包' }], onReload: vi.fn(async () => {}), onDone: vi.fn(), onClose: vi.fn(), notify: vi.fn() });

it('把原始 ID 一次提交给目标分区，忙碌时阻止重复提交、关闭和切换', async () => {
  const p = props(); let finish!: () => void;
  vi.mocked(copyChainsToPartition).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<ChainPartitionCopyDialog {...p} />);
  fireEvent.change(screen.getByRole('combobox', { name: '目标分区' }), { target: { value: 'a'.repeat(64) } });
  fireEvent.click(screen.getByRole('button', { name: '确认复制' }));
  fireEvent.click(screen.getByRole('button', { name: '处理中…' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(copyChainsToPartition).toHaveBeenCalledExactlyOnceWith(p.ids, 'a'.repeat(64), expect.any(String));
  expect(p.onClose).not.toHaveBeenCalled();
  expect((screen.getByRole('combobox', { name: '目标分区' }) as HTMLSelectElement).disabled).toBe(true);
  await act(async () => finish());
  expect(p.onReload).toHaveBeenCalledOnce(); expect(p.onDone).toHaveBeenCalledOnce(); expect(p.onClose).toHaveBeenCalledOnce();
});

it('复制成功但列表回读失败，只重试读取，不重复写入或改变目标', async () => {
  const p = props(); p.onReload.mockRejectedValueOnce(new Error('synthetic refresh failure'));
  render(<ChainPartitionCopyDialog {...p} />);
  fireEvent.click(screen.getByRole('button', { name: '确认复制' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('复制已完成'); expect(p.onDone).not.toHaveBeenCalled();
  expect((screen.getByRole('combobox', { name: '目标分区' }) as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
  await waitFor(() => expect(p.onDone).toHaveBeenCalledOnce());
  expect(copyChainsToPartition).toHaveBeenCalledOnce(); expect(p.onReload).toHaveBeenCalledTimes(2);
});

it('取消不会复制；请求失败保留错误与选择并回读真实状态', async () => {
  const p = props(), view = render(<ChainPartitionCopyDialog {...p} />);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(p.onClose).toHaveBeenCalledOnce(); expect(copyChainsToPartition).not.toHaveBeenCalled();
  view.unmount(); vi.mocked(copyChainsToPartition).mockRejectedValueOnce(new Error('synthetic transfer failure'));
  render(<ChainPartitionCopyDialog {...p} />);
  fireEvent.click(screen.getByRole('button', { name: '确认复制' }));
  await screen.findByText('synthetic transfer failure');
  expect(p.onReload).toHaveBeenCalledOnce(); expect(p.onDone).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '确认复制' })).toBeTruthy();
});
