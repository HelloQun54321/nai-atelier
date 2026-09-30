// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../types';
import { useStChatu8Selection } from './stChatu8Sync';
import { isStChatu8ExportableChain } from '../worker/stChatu8Policy.mjs';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('./api', () => ({ api: { get, post } }));
const chains = [
  { id: 'a', type: 'style' }, { id: 'b', type: 'style' }, { id: 'legacy' }, { id: 'character', type: 'character' },
  { id: 'v5', type: 'style', params: { model: 'nai-diffusion-5-full' } }, { id: 'v4', type: 'style', params: { model: 'nai-diffusion-4-full' } },
] as PromptChain[];
const entry = (chainId: string, status: 'pending' | 'synced' | 'removed' = 'pending') => ({ chainId, requestId: `request:${chainId}`, status, requestedAt: 1, confirmedAt: status === 'pending' ? 0 : 2, lastVerifiedAt: status === 'pending' ? 0 : 2 });
const workspace = (entries = [entry('a', 'synced')]) => ({ entries, lastSnapshotAt: 2 });
beforeEach(() => { get.mockReset(); post.mockReset(); get.mockResolvedValue(workspace()); });
afterEach(cleanup);

describe('智慧姬挑选草稿、队列与接收记录', () => {
  it('仅允许 V4.5 / V5 Full / Curated 与旧默认条目，拒绝 V4 和未知模型', () => {
    for (const model of ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-5-full', 'nai-diffusion-5-curated', 'nai-diffusion-5-full-inpainting', '']) expect(isStChatu8ExportableChain({ type: 'style', params: { model } })).toBe(true);
    for (const model of ['nai-diffusion-4-full', 'nai-diffusion-6-full', 'nai-diffusion-4-50-full']) expect(isStChatu8ExportableChain({ type: 'style', params: { model } })).toBe(false);
  });
  it('关闭时不读取；进入重新核对，已同步与已移除项不可通过普通挑选重复加入', async () => {
    const disabled = renderHook(() => useStChatu8Selection(false, chains, vi.fn()));
    expect(get).not.toHaveBeenCalled(); disabled.unmount();
    const { result } = renderHook(() => useStChatu8Selection(true, chains, vi.fn()));
    await waitFor(() => expect(result.current.records.length).toBe(1));
    get.mockResolvedValueOnce(workspace([entry('a', 'synced'), entry('b', 'removed')]));
    act(() => result.current.begin()); await waitFor(() => expect(result.current.busy).toBe(false));
    expect(get).toHaveBeenLastCalledWith('/st-chatu8/workspace', { cache: 'no-store' });
    act(() => { result.current.toggle('a'); result.current.toggle('b'); });
    expect(result.current.selected.size).toBe(0); expect(result.current.records.length).toBe(2);
  });
  it('跨筛选与视图保留新勾选，批量操作排除既有记录及不兼容项，返回不提交', async () => {
    const { result } = renderHook(() => useStChatu8Selection(true, chains, vi.fn()));
    await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.begin()); await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.setFiltered(['a', 'b', 'legacy', 'character', 'v5', 'v4'], true));
    act(() => result.current.setFiltered(['b'], false));
    act(() => result.current.setView('records')); act(() => result.current.setView('pick'));
    expect([...result.current.selected]).toEqual(['legacy', 'v5']);
    act(() => result.current.cancel()); expect(post).not.toHaveBeenCalled(); expect(result.current.open).toBe(false);
  });
  it('加入是增量操作，保存后清空草稿并显示待同步，不把已同步项重新发送', async () => {
    const { result, rerender } = renderHook(({ items }) => useStChatu8Selection(true, items, vi.fn()), { initialProps: { items: chains } });
    await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.begin()); await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => { result.current.toggle('b'); result.current.toggle('v5'); });
    rerender({ items: chains.filter(chain => chain.id !== 'b') });
    post.mockResolvedValueOnce(workspace([entry('a', 'synced'), entry('v5')]));
    await act(async () => { await result.current.save(); });
    expect(post).toHaveBeenLastCalledWith('/st-chatu8/workspace', { action: 'enqueue', chainIds: ['v5'] });
    expect(result.current.view).toBe('pending'); expect(result.current.selected.size).toBe(0);
    expect(result.current.accepts('v5')).toBe(true); expect(result.current.accepts('a')).toBe(false);
  });
  it('接收后从待同步移到记录，状态筛选分别显示已同步和已移除', async () => {
    get.mockResolvedValue(workspace([entry('b')]));
    const { result } = renderHook(() => useStChatu8Selection(true, chains, vi.fn()));
    await waitFor(() => expect(result.current.pending.length).toBe(1));
    act(() => result.current.begin()); await waitFor(() => expect(result.current.busy).toBe(false));
    get.mockResolvedValueOnce(workspace([entry('b', 'synced'), entry('a', 'removed')]));
    await act(async () => { await result.current.load(); });
    expect(result.current.pending.length).toBe(0); expect(result.current.records.length).toBe(2);
    act(() => { result.current.setView('records'); result.current.setRecordFilter('removed'); });
    expect(result.current.accepts('a')).toBe(true); expect(result.current.accepts('b')).toBe(false);
    post.mockResolvedValueOnce(workspace([entry('b', 'synced'), entry('a')]));
    await act(async () => { await result.current.actOnEntries('requeue', ['a']); });
    expect(post).toHaveBeenLastCalledWith('/st-chatu8/workspace', { action: 'requeue', chainIds: ['a'] });
    expect(result.current.view).toBe('pending');
  });
  it('写入失败保留勾选、读取失败保留核对记录，都不自动重复请求', async () => {
    const notify = vi.fn(); const { result } = renderHook(() => useStChatu8Selection(true, chains, notify));
    await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.begin()); await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.toggle('b')); post.mockRejectedValueOnce(new Error('模拟失败'));
    await act(async () => { await result.current.save(); });
    expect(post).toHaveBeenCalledTimes(1); expect([...result.current.selected]).toEqual(['b']);
    expect(notify).toHaveBeenLastCalledWith('模拟失败', 'error');
    get.mockRejectedValueOnce(new Error('连接失败'));
    await act(async () => { await result.current.load(); });
    expect(result.current.records.length).toBe(1); expect(result.current.lastSnapshotAt).toBe(2); expect(result.current.error).toBe('连接失败');
  });
  it('返回后的迟到读取不覆盖新一轮列表，关闭立即退出并丢弃未提交草稿', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useStChatu8Selection(enabled, chains, vi.fn()), { initialProps: { enabled: true } });
    await waitFor(() => expect(result.current.busy).toBe(false));
    let finish!: (value: ReturnType<typeof workspace>) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => result.current.begin()); act(() => result.current.cancel());
    get.mockResolvedValueOnce(workspace([entry('b', 'synced')]));
    act(() => result.current.begin()); await waitFor(() => expect(result.current.entries.has('b')).toBe(true));
    await act(async () => { finish(workspace([entry('legacy', 'removed')])); });
    expect(result.current.entries.has('b')).toBe(true); expect(result.current.entries.has('legacy')).toBe(false);
    act(() => result.current.toggle('v5')); rerender({ enabled: false });
    expect(result.current.open).toBe(false); expect(result.current.selected.size).toBe(0); expect(post).not.toHaveBeenCalled();
  });
  it('草稿中改成 V4 或被删除的条目不发送；空草稿不能误清空已有队列', async () => {
    const { result, rerender } = renderHook(({ items }) => useStChatu8Selection(true, items, vi.fn()), { initialProps: { items: chains } });
    await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.begin()); await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.toggle('b'));
    rerender({ items: chains.map(chain => chain.id === 'b' ? { ...chain, params: { ...chain.params, model: 'nai-diffusion-4-full' } } : chain) });
    expect(result.current.selected.size).toBe(0);
    await act(async () => { await result.current.save(); }); expect(post).not.toHaveBeenCalled();
  });
});
