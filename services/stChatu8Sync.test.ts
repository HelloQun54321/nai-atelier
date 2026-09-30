// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../types';
import { useStChatu8Selection } from './stChatu8Sync';
import { isStChatu8ExportableChain } from '../worker/stChatu8Policy.mjs';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('./api', () => ({ api: { get, post } }));
const chains = [
  { id: 'a', type: 'style' }, { id: 'b', type: 'style' },
  { id: 'legacy' }, { id: 'character', type: 'character' },
  { id: 'v5', type: 'style', params: { model: 'nai-diffusion-5-full' } },
  { id: 'v4', type: 'style', params: { model: 'nai-diffusion-4-full' } },
] as PromptChain[];
beforeEach(() => { get.mockReset(); post.mockReset(); get.mockResolvedValue({ chainIds: ['a'] }); });
afterEach(cleanup);

describe('智慧姬发送范围草稿与持久化', () => {
  it('允许 V4.5 / V5 Full / Curated 与旧默认条目；V4、未知模型不可勾选', () => {
    for (const model of ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-5-full-inpainting', 'nai-diffusion-5-full', 'nai-diffusion-5-curated', 'nai-diffusion-5-full-inpainting', '']) expect(isStChatu8ExportableChain({ type: 'style', params: { model } })).toBe(true);
    for (const model of ['nai-diffusion-4-full', 'nai-diffusion-6-full', 'nai-diffusion-4-50-full']) expect(isStChatu8ExportableChain({ type: 'style', params: { model } })).toBe(false);
  });
  it('角色页或游客不读取；每次进入选择重新读取最新范围', async () => {
    const view = renderHook(() => useStChatu8Selection(false, chains, vi.fn()));
    expect(get).not.toHaveBeenCalled(); view.unmount();
    const { result } = renderHook(() => useStChatu8Selection(true, chains, vi.fn()));
    await waitFor(() => expect(result.current.savedCount).toBe(1));
    get.mockResolvedValueOnce({ chainIds: ['b', 'legacy'] });
    act(() => result.current.begin());
    await waitFor(() => expect([...result.current.selected]).toEqual(['b', 'legacy']));
    expect(get).toHaveBeenLastCalledWith('/st-chatu8/export-selection', { cache: 'no-store' });
  });
  it('跨筛选保留勾选，批量操作不选角色，取消不写入', async () => {
    const { result } = renderHook(() => useStChatu8Selection(true, chains, vi.fn()));
    await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.begin()); await waitFor(() => expect(result.current.selected.has('a')).toBe(true));
    act(() => result.current.setFiltered(['b', 'legacy', 'character', 'v5', 'v4'], true));
    act(() => result.current.setFiltered(['b'], false));
    expect([...result.current.selected]).toEqual(['a', 'legacy', 'v5']);
    act(() => result.current.cancel());
    expect(post).not.toHaveBeenCalled(); expect(result.current.selecting).toBe(false); expect(result.current.savedCount).toBe(1);
  });
  it('只有保存才提交完整范围，条目被删除后不会发出失效 ID，允许保存为空', async () => {
    const notify = vi.fn();
    const { result, rerender } = renderHook(({ items }) => useStChatu8Selection(true, items, notify), { initialProps: { items: chains } });
    await waitFor(() => expect(result.current.savedCount).toBe(1));
    act(() => result.current.begin()); await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.toggle('b'));
    rerender({ items: chains.filter(chain => chain.id !== 'a') });
    post.mockResolvedValueOnce({ chainIds: ['b'] });
    await act(async () => { await result.current.save(); });
    expect(post).toHaveBeenLastCalledWith('/st-chatu8/export-selection', { chainIds: ['b'] });
    expect(result.current.savedCount).toBe(1); expect(result.current.selecting).toBe(false);
    get.mockResolvedValueOnce({ chainIds: ['b'] });
    act(() => result.current.begin()); await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.toggle('b')); post.mockResolvedValueOnce({ chainIds: [] });
    await act(async () => { await result.current.save(); });
    expect(post).toHaveBeenLastCalledWith('/st-chatu8/export-selection', { chainIds: [] });
    expect(result.current.savedCount).toBe(0);
  });
  it('保存失败保留勾选供手动重试，不自动重试', async () => {
    const notify = vi.fn(); const { result } = renderHook(() => useStChatu8Selection(true, chains, notify));
    await waitFor(() => expect(result.current.savedCount).toBe(1));
    act(() => result.current.begin()); await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.toggle('b')); post.mockRejectedValueOnce(new Error('模拟失败'));
    await act(async () => { await result.current.save(); });
    expect(post).toHaveBeenCalledTimes(1); expect(result.current.selecting).toBe(true);
    expect([...result.current.selected]).toEqual(['a', 'b']); expect(notify).toHaveBeenLastCalledWith('模拟失败', 'error');
  });
  it('离开后迟到读取不覆盖新一轮选择', async () => {
    const { result } = renderHook(() => useStChatu8Selection(true, chains, vi.fn()));
    await waitFor(() => expect(result.current.savedCount).toBe(1));
    let finish!: (value: { chainIds: string[] }) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => result.current.begin()); act(() => result.current.cancel());
    get.mockResolvedValueOnce({ chainIds: ['b'] }); act(() => result.current.begin());
    await waitFor(() => expect([...result.current.selected]).toEqual(['b']));
    await act(async () => { finish({ chainIds: ['legacy'] }); });
    expect([...result.current.selected]).toEqual(['b']);
  });
  it('已选风格串改成 V4 后从待发送范围排除，不改动原条目的模型', async () => {
    const { result, rerender } = renderHook(({ items }) => useStChatu8Selection(true, items, vi.fn()), { initialProps: { items: chains } });
    await waitFor(() => expect(result.current.savedCount).toBe(1));
    act(() => result.current.begin()); await waitFor(() => expect(result.current.busy).toBe(false));
    rerender({ items: chains.map(chain => chain.id === 'a' ? { ...chain, params: { ...chain.params, model: 'nai-diffusion-4-full' } } : chain) });
    expect(result.current.savedCount).toBe(0); expect(result.current.selected.size).toBe(0);
    post.mockResolvedValueOnce({ chainIds: [] }); await act(async () => { await result.current.save(); });
    expect(post).toHaveBeenLastCalledWith('/st-chatu8/export-selection', { chainIds: [] });
  });
});
