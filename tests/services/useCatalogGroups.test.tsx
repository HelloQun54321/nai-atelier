// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCatalogGroups } from '../../services/useCatalogGroups';
import type { CatalogGroupKind, CatalogGroupState } from '../../services/catalogGroups';
const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../../services/api', () => ({ api: { get, put } }));
const initial: CatalogGroupState = { revision: 1, groups: [{ id: 'g1', name: '合成分组' }], memberships: {} };
const saved: CatalogGroupState = { ...initial, revision: 2, memberships: { 'artist:画师': ['g1'] } };
beforeEach(() => { get.mockReset().mockResolvedValue(initial); put.mockReset().mockResolvedValue(saved); });
afterEach(cleanup);

it('焦点回读相同版本保留状态引用，避免保活列表误判为分组变化', async () => {
  get.mockImplementation(async () => structuredClone(initial));
  const hook = renderHook(() => useCatalogGroups('artist'));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const first = hook.result.current.state;
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(get).toHaveBeenCalledTimes(2);
  expect(hook.result.current.state).toBe(first);
});

it('保存真实回执同步同类型保活实例，不影响另一类型', async () => {
  const first = renderHook(() => useCatalogGroups('artist'));
  const second = renderHook(() => useCatalogGroups('artist'));
  const character = renderHook(() => useCatalogGroups('character'));
  await waitFor(() => expect(first.result.current.ready && second.result.current.ready && character.result.current.ready).toBe(true));
  await act(async () => { await first.result.current.save(saved); });
  expect(put).toHaveBeenCalledWith('/catalog-groups/artist', saved);
  expect(second.result.current.state).toEqual(saved);
  expect(character.result.current.state).toEqual(initial);
});
it('同类保存广播到达后，迟到旧读取不能覆盖它', async () => {
  let finish!: (value: CatalogGroupState) => void;
  get.mockImplementationOnce(() => new Promise<CatalogGroupState>(resolve => { finish = resolve; }));
  const slow = renderHook(() => useCatalogGroups('artist'));
  const writer = renderHook(() => useCatalogGroups('artist'));
  await waitFor(() => expect(writer.result.current.ready).toBe(true));
  await act(async () => { await writer.result.current.save(saved); });
  await act(async () => { finish(initial); });
  expect(slow.result.current.state).toEqual(saved);
});
it('目录类型切换隔离旧读取，并重新读取新类型', async () => {
  let finish!: (value: CatalogGroupState) => void;
  get.mockImplementationOnce(() => new Promise<CatalogGroupState>(resolve => { finish = resolve; }));
  const hook = renderHook(({ kind }: { kind: CatalogGroupKind }) => useCatalogGroups(kind), { initialProps: { kind: 'artist' as CatalogGroupKind } });
  hook.rerender({ kind: 'character' });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => { finish(saved); });
  expect(hook.result.current.state).toEqual(initial);
  expect(get).toHaveBeenLastCalledWith('/catalog-groups/character', { cache: 'no-store' });
});
it('写入冲突回读真实状态并报告失败，不广播未保存状态', async () => {
  const first = renderHook(() => useCatalogGroups('artist'));
  const second = renderHook(() => useCatalogGroups('artist'));
  await waitFor(() => expect(first.result.current.ready && second.result.current.ready).toBe(true));
  put.mockRejectedValueOnce(Error('synthetic conflict'));
  get.mockResolvedValueOnce(saved);
  await act(async () => { await expect(first.result.current.save(initial)).rejects.toThrow('synthetic conflict'); });
  expect(first.result.current.state).toEqual(saved);
  expect(second.result.current.state).toEqual(initial);
  expect(first.result.current.busy).toBe(false);
});
it('读取损坏状态及回读失败均禁止写入，主动重载后恢复', async () => {
  get.mockResolvedValueOnce({ broken: true });
  const hook = renderHook(() => useCatalogGroups('artist'));
  await waitFor(() => expect(hook.result.current.error).not.toBe(''));
  await expect(hook.result.current.save(initial)).rejects.toThrow('尚未就绪');
  expect(put).not.toHaveBeenCalled();
  await act(async () => { await hook.result.current.reload(); });
  expect(hook.result.current.ready).toBe(true);
  put.mockRejectedValueOnce(Error('lost receipt'));
  get.mockRejectedValueOnce(Error('offline'));
  await act(async () => { await expect(hook.result.current.save(initial)).rejects.toThrow('lost receipt'); });
  expect(hook.result.current.error).toBe('分组回读失败，请重新加载后再整理');
  await expect(hook.result.current.save(initial)).rejects.toThrow('尚未就绪');
  await act(async () => { await hook.result.current.reload(); });
  expect(hook.result.current.error).toBe('');
});
it('错误响应不作为成功回执或广播', async () => {
  const hook = renderHook(() => useCatalogGroups('artist'));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  put.mockResolvedValueOnce({ invalid: true });
  await act(async () => { await expect(hook.result.current.save(initial)).rejects.toThrow('分组数据无效'); });
  expect(hook.result.current.state).toEqual(initial);
});
