// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { saveChainFolders, useChainFolders } from '../../services/useChainFolders';
import type { ChainFolderState } from '../../services/chainFolders';

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../../services/api', () => ({ api: { get, put } }));
const initial: ChainFolderState = { revision: 1, folders: [{ id: 'folder', name: '合成目录', parentId: null }], assignments: {} };
const saved: ChainFolderState = { ...initial, revision: 2, assignments: { created: 'folder' } };
beforeEach(() => {
  get.mockReset().mockResolvedValue(initial);
  put.mockReset().mockResolvedValue(saved);
});
afterEach(cleanup);

it('App独立保存归属后，保活列表立即接收真实回执，不必切窗或重新GET', async () => {
  const first = renderHook(() => useChainFolders(true));
  const second = renderHook(() => useChainFolders(true));
  await waitFor(() => expect(first.result.current.ready && second.result.current.ready).toBe(true));
  await act(async () => { await saveChainFolders({ ...initial, assignments: saved.assignments }); });
  expect(first.result.current.state).toEqual(saved);
  expect(second.result.current.state).toEqual(saved);
  expect(get).toHaveBeenCalledTimes(2);
});

it('保存回执先到时，迟到的旧读取不能覆盖新目录', async () => {
  let finish!: (state: ChainFolderState) => void;
  get.mockImplementationOnce(() => new Promise<ChainFolderState>(resolve => { finish = resolve; }));
  const hook = renderHook(() => useChainFolders(true));
  await act(async () => { await saveChainFolders({ ...initial, assignments: saved.assignments }); });
  expect(hook.result.current.state).toEqual(saved);
  await act(async () => { finish(initial); });
  expect(hook.result.current.state).toEqual(saved);
});

it('保存失败不广播未落库归属，窗口回到前台仍能回读其他设备的新目录', async () => {
  const hook = renderHook(() => useChainFolders(true));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  put.mockRejectedValueOnce(Error('synthetic conflict'));
  await expect(saveChainFolders({ ...initial, assignments: saved.assignments })).rejects.toThrow('synthetic conflict');
  expect(hook.result.current.state).toEqual(initial);
  get.mockResolvedValueOnce(saved);
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(hook.result.current.state).toEqual(saved);
});

it('组件内保存同步其他保活列表，禁用的目录不读取或接收广播', async () => {
  const first = renderHook(() => useChainFolders(true));
  const second = renderHook(() => useChainFolders(true));
  const disabled = renderHook(() => useChainFolders(false));
  await waitFor(() => expect(first.result.current.ready && second.result.current.ready).toBe(true));
  await act(async () => { await first.result.current.save({ ...initial, assignments: saved.assignments }); });
  expect(second.result.current.state).toEqual(saved);
  expect(disabled.result.current.ready).toBe(false);
  expect(get).toHaveBeenCalledTimes(2);
});
