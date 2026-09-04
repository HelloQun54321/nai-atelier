// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NAI_RUNTIME, NAI_RUNTIME_REFRESH_EVENT, refreshNaiRuntimeConfig, useNaiRuntime } from './naiRuntime';

describe('naiRuntime refresh', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('强制刷新会绕过首次缓存并使用无缓存请求', async () => {
    const payload = {
      ...DEFAULT_NAI_RUNTIME,
      syncedAt: 123,
      health: { ok: true, extracted: ['all'], missed: [] },
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload } as Response);

    const first = await refreshNaiRuntimeConfig();
    expect(first.syncedAt).toBe(123);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/novelai-runtime?_t=');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });

    const nextPayload = { ...payload, syncedAt: 456 };
    fetchMock.mockResolvedValue({ ok: true, json: async () => nextPayload } as Response);
    const second = await refreshNaiRuntimeConfig();
    expect(second.syncedAt).toBe(456);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('降级响应（502 带完整体）不被冻结：下一轮成功刷新替换缓存', async () => {
    const payload = {
      ...DEFAULT_NAI_RUNTIME,
      syncedAt: 123,
      health: { ok: true, extracted: ['all'], missed: [] },
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload } as Response);
    await refreshNaiRuntimeConfig();

    // 网关降级但响应体仍携带完整 runtime + 健康记录：合并进缓存而不是退回旧值。
    const degraded = { ...payload, syncedAt: 200, health: { ok: false, reason: 'fetch', error: 'x', attemptedAt: 1 } };
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => degraded } as Response);
    const afterDegrade = await refreshNaiRuntimeConfig();
    expect(afterDegrade.syncedAt).toBe(200);
    expect(afterDegrade.health).toMatchObject({ ok: false, reason: 'fetch' });

    // 同步恢复后缓存必须被新状态替换，而不是被降级响应永久冻结。
    const recovered = { ...payload, syncedAt: 456, health: { ok: true, extracted: ['all'], missed: [] } };
    fetchMock.mockResolvedValue({ ok: true, json: async () => recovered } as Response);
    const afterRecover = await refreshNaiRuntimeConfig();
    expect(afterRecover.syncedAt).toBe(456);
    expect(afterRecover.health?.ok).toBe(true);
  });
});

describe('useNaiRuntime 共享订阅', () => {
  const payload = { ...DEFAULT_NAI_RUNTIME, syncedAt: 1000, health: { ok: true, extracted: ['all'], missed: [] } };

  beforeEach(async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload } as Response));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    // 重置模块级 cachedConfig：先行拉一次让缓存回到测试基准，避免跨用例残留
    await refreshNaiRuntimeConfig();
    vi.mocked(fetch).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('多个实例挂载共享缓存：首个拉取后其余实例直接读缓存', async () => {
    const fetchMock = vi.mocked(fetch);
    const first = renderHook(() => useNaiRuntime());
    const second = renderHook(() => useNaiRuntime());
    await waitFor(() => {
      expect(first.result.current.syncedAt).toBe(1000);
      expect(second.result.current.syncedAt).toBe(1000);
    });
    // beforeEach 已预热缓存，两实例挂载都不应产生新的网络请求
    expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('/api/novelai-runtime'))).toHaveLength(0);
    first.unmount();
    second.unmount();
  });

  it('页面隐藏暂停、恢复可见后立即刷新并分发到全部实例', async () => {
    const fetchMock = vi.mocked(fetch);
    const hook = renderHook(() => useNaiRuntime());
    await waitFor(() => expect(hook.result.current.syncedAt).toBe(1000));
    const callsAfterMount = fetchMock.mock.calls.length;

    // 隐藏：暂停轮询（interval 停表，此处不触发新请求）
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // 恢复可见：立即触发一次拉取并广播结果
    const nextPayload = { ...payload, syncedAt: 2000 };
    fetchMock.mockResolvedValue({ ok: true, json: async () => nextPayload } as Response);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(hook.result.current.syncedAt).toBe(2000));
    expect(fetchMock.mock.calls.length).toBe(callsAfterMount + 1);
    hook.unmount();
  });

  it('NAI_RUNTIME_REFRESH_EVENT 触发共享刷新并分发', async () => {
    const fetchMock = vi.mocked(fetch);
    const first = renderHook(() => useNaiRuntime());
    const second = renderHook(() => useNaiRuntime());
    await waitFor(() => expect(first.result.current.syncedAt).toBe(1000));

    const nextPayload = { ...payload, syncedAt: 3000 };
    fetchMock.mockResolvedValue({ ok: true, json: async () => nextPayload } as Response);
    const callsBefore = fetchMock.mock.calls.length;
    window.dispatchEvent(new CustomEvent(NAI_RUNTIME_REFRESH_EVENT));
    await waitFor(() => {
      expect(first.result.current.syncedAt).toBe(3000);
      expect(second.result.current.syncedAt).toBe(3000);
    });
    // 共享驱动只发一份请求
    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1);
    first.unmount();
    second.unmount();
  });
});
