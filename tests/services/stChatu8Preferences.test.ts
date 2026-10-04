// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshStChatu8Preferences, setStChatu8Enabled, useStChatu8Preferences } from '../../services/stChatu8Preferences';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../services/api', () => ({ api: { get, post } }));
beforeEach(async () => {
  get.mockReset(); post.mockReset();
  get.mockResolvedValue({ enabled: false }); post.mockImplementation(async (_path, body) => body);
  vi.stubGlobal('BroadcastChannel', undefined);
  await setStChatu8Enabled(false); post.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('智慧姬同步全局开关', () => {
  it('默认关闭，非风格页面或游客不读取；同页多入口共用读取与开关', async () => {
    const inactive = renderHook(() => useStChatu8Preferences(false));
    expect(inactive.result.current.enabled).toBe(false); expect(get).not.toHaveBeenCalled(); inactive.unmount();
    const { result } = renderHook(() => [useStChatu8Preferences(), useStChatu8Preferences()]);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith('/st-chatu8/preferences', { cache: 'no-store' });
    await act(async () => { await setStChatu8Enabled(true); });
    expect(post).toHaveBeenCalledWith('/st-chatu8/preferences', { enabled: true });
    expect(result.current.map(item => item.enabled)).toEqual([true, true]);
    await act(async () => { await setStChatu8Enabled(false); });
    expect(result.current.map(item => item.enabled)).toEqual([false, false]);
  });
  it('保存失败保留已生效状态，显示原因，不自动重试', async () => {
    get.mockResolvedValue({ enabled: true });
    const { result } = renderHook(() => useStChatu8Preferences());
    await waitFor(() => expect(result.current.enabled).toBe(true));
    post.mockRejectedValueOnce(new Error('模拟保存失败'));
    await act(async () => { await expect(setStChatu8Enabled(false)).rejects.toThrow('模拟保存失败'); });
    expect(result.current).toMatchObject({ enabled: true, busy: false, error: '模拟保存失败' });
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => { await setStChatu8Enabled(false); });
    expect(result.current).toMatchObject({ enabled: false, error: '' });
  });
  it('旧读取迟到不能重新开启已关闭开关；下次进入从服务器恢复', async () => {
    let finish!: (value: { enabled: boolean }) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = renderHook(() => useStChatu8Preferences());
    await waitFor(() => expect(finish).toBeDefined());
    await act(async () => { await setStChatu8Enabled(false); });
    await act(async () => { finish({ enabled: true }); });
    expect(first.result.current.enabled).toBe(false); first.unmount();
    get.mockResolvedValueOnce({ enabled: true });
    const next = renderHook(() => useStChatu8Preferences());
    await waitFor(() => expect(next.result.current.enabled).toBe(true));
  });
  it('无法确认设置时关闭并显示原因，手动重读或回到前台可恢复', async () => {
    get.mockRejectedValueOnce(new Error('模拟读取失败'));
    const { result } = renderHook(() => useStChatu8Preferences());
    await waitFor(() => expect(result.current.error).toBe('模拟读取失败'));
    expect(result.current.enabled).toBe(false); expect(get).toHaveBeenCalledTimes(1);
    get.mockResolvedValueOnce({ enabled: true });
    await act(async () => { await refreshStChatu8Preferences(); });
    expect(result.current).toMatchObject({ enabled: true, error: '' });
    get.mockResolvedValueOnce({ enabled: 'true' });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(result.current.enabled).toBe(false));
    expect(result.current.error).toBe('智慧姬同步设置响应无效');
  });
  it('跨页消息触发重读；浏览器禁止通知时保存仍成功', async () => {
    let receive!: () => void; const broadcast = vi.fn(); const close = vi.fn();
    vi.stubGlobal('BroadcastChannel', class {
      addEventListener(_name: string, listener: () => void) { receive = listener; }
      postMessage = broadcast; close = close;
    });
    const { result } = renderHook(() => useStChatu8Preferences());
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await act(async () => { await setStChatu8Enabled(true); });
    expect(broadcast).toHaveBeenCalledWith('changed'); expect(close).toHaveBeenCalled();
    get.mockResolvedValueOnce({ enabled: false });
    await act(async () => { receive(); });
    await waitFor(() => expect(result.current.enabled).toBe(false));
    vi.stubGlobal('BroadcastChannel', class { constructor() { throw new Error('浏览器限制'); } });
    await act(async () => { await setStChatu8Enabled(true); });
    expect(result.current).toMatchObject({ enabled: true, error: '' });
  });
});
