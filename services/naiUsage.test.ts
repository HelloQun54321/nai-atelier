// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isActiveOpusSubscription,
  isNovelaiSubscriptionActive,
  isNovelaiSubscriptionInactive,
  NOVELAI_USAGE_REFRESH_EVENT,
  useNovelaiUsage,
} from './naiUsage';

const responseFor = (payload: unknown) => ({
  ok: true,
  json: async () => payload,
  text: async () => '',
}) as Response;

const errorResponse = (message: string) => ({
  ok: false,
  json: async () => ({ error: message }),
  text: async () => message,
}) as Response;

describe('订阅健康判定', () => {
  it('active=true 视为可生图，active=false 显式标记失效，null/未知不误报', () => {
    expect(isNovelaiSubscriptionActive({ active: true })).toBe(true);
    expect(isNovelaiSubscriptionActive({ active: false })).toBe(false);
    expect(isNovelaiSubscriptionActive(null)).toBe(false);
    expect(isNovelaiSubscriptionInactive({ active: false })).toBe(true);
    // null / undefined / 缺 active 是「未知」，不是「已失效」——加载中不得误拦。
    expect(isNovelaiSubscriptionInactive(null)).toBe(false);
    expect(isNovelaiSubscriptionInactive(undefined)).toBe(false);
    expect(isNovelaiSubscriptionInactive({})).toBe(false);
  });

  it('活跃 Opus 判定要求 tier>=3 且 active=true', () => {
    expect(isActiveOpusSubscription({ active: true, tier: 3 })).toBe(true);
    expect(isActiveOpusSubscription({ active: true, tier: 4 })).toBe(true);
    // 已失效的 Opus key 不再算活跃 Opus
    expect(isActiveOpusSubscription({ active: false, tier: 3 })).toBe(false);
    // 低档位 active 不是 Opus
    expect(isActiveOpusSubscription({ active: true, tier: 2 })).toBe(false);
    expect(isActiveOpusSubscription(null)).toBe(false);
  });
});

describe('useNovelaiUsage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('同一把 Key 的多个用量组件只共用一个订阅请求', async () => {
    const apiKey = 'pst-deduplicated-key';
    sessionStorage.setItem('nai_api_key', apiKey);
    let resolveRequest!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveRequest = resolve; });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal('fetch', fetchMock);

    const first = renderHook(() => useNovelaiUsage());
    const second = renderHook(() => useNovelaiUsage());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/novelai-subscription?_t=');
    expect(options.cache).toBe('no-store');
    expect(options.headers).toEqual({ Authorization: `Bearer ${apiKey}` });

    await act(async () => {
      resolveRequest(responseFor({ tier: 4, active: true, usage: { percent: 64, isNegative: false, timeUntilNextPercent: 1500 } }));
      await pending;
    });
    await waitFor(() => {
      expect(first.result.current.usage?.percent).toBe(64);
      expect(second.result.current.usage?.percent).toBe(64);
    });
    first.unmount();
    second.unmount();
  });

  it('手动刷新期间会保持 loading 状态，完成后更新额度', async () => {
    sessionStorage.setItem('nai_api_key', 'pst-refresh-key');
    let resolveNext!: (response: Response) => void;
    const nextRequest = new Promise<Response>(resolve => { resolveNext = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseFor({ tier: 4, active: true, usage: { percent: 100, isNegative: false, timeUntilNextPercent: 1500 } }))
      .mockReturnValueOnce(nextRequest);
    vi.stubGlobal('fetch', fetchMock);

    const hook = renderHook(() => useNovelaiUsage());
    await waitFor(() => {
      expect(hook.result.current.usage?.percent).toBe(100);
      expect(hook.result.current.loading).toBe(false);
    });

    let refreshPromise!: Promise<unknown>;
    act(() => { refreshPromise = hook.result.current.refresh(); });
    await waitFor(() => expect(hook.result.current.loading).toBe(true));

    await act(async () => {
      resolveNext(responseFor({ tier: 4, active: true, usage: { percent: 72, isNegative: false, timeUntilNextPercent: 1500 } }));
      await refreshPromise;
    });
    await waitFor(() => {
      expect(hook.result.current.usage?.percent).toBe(72);
      expect(hook.result.current.loading).toBe(false);
    });
    hook.unmount();
  });

  it('切换 Key 后订阅请求失败会暴露错误，重试成功后恢复当前 Key 额度', async () => {
    const keyA = 'pst-usage-key-a';
    const keyB = 'pst-usage-key-b';
    sessionStorage.setItem('nai_api_key', keyA);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseFor({ tier: 4, active: true, usage: { percent: 64, isNegative: false, timeUntilNextPercent: 1500 } }))
      .mockResolvedValueOnce(errorResponse('temporary subscription failure'))
      .mockResolvedValueOnce(responseFor({ tier: 4, active: true, usage: { percent: 37, isNegative: false, timeUntilNextPercent: 1500 } }));
    vi.stubGlobal('fetch', fetchMock);

    const hook = renderHook(() => useNovelaiUsage());
    await waitFor(() => expect(hook.result.current.usage?.percent).toBe(64));

    await act(async () => {
      sessionStorage.setItem('nai_api_key', keyB);
      window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: keyB }));
    });
    await waitFor(() => {
      expect(hook.result.current.loading).toBe(false);
      expect(hook.result.current.usage).toBeUndefined();
      expect(hook.result.current.error).toContain('temporary subscription failure');
    });

    await act(async () => { await hook.result.current.refresh(); });
    await waitFor(() => {
      expect(hook.result.current.usage?.percent).toBe(37);
      expect(hook.result.current.error).toBeNull();
    });
    hook.unmount();
  });

  it('请求成功但没有 usage 时识别为非 Opus，而不是同步失败', async () => {
    sessionStorage.setItem('nai_api_key', 'pst-tablet-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFor({ tier: 2, active: true })));

    const hook = renderHook(() => useNovelaiUsage());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.info?.tier).toBe(2);
    expect(hook.result.current.usage).toBeUndefined();
    expect(hook.result.current.error).toBeNull();
    hook.unmount();
  });

  it('页面隐藏时暂停轮询，恢复可见后立即刷新一次', async () => {
    const apiKey = 'pst-visibility-key';
    sessionStorage.setItem('nai_api_key', apiKey);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseFor({ tier: 4, active: true, usage: { percent: 64, isNegative: false, timeUntilNextPercent: 1500 } }))
      .mockResolvedValue(responseFor({ tier: 4, active: true, usage: { percent: 60, isNegative: false, timeUntilNextPercent: 1500 } }));
    vi.stubGlobal('fetch', fetchMock);
    // jsdom 默认可见
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    const hook = renderHook(() => useNovelaiUsage());
    await waitFor(() => expect(hook.result.current.usage?.percent).toBe(64));
    const callsAfterMount = fetchMock.mock.calls.length;

    // 切后台：暂停轮询，此后不产生新请求
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // 切回可见：立即刷新一次（interval 是否重启由驱动保证，这里验证立即刷新）
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(callsAfterMount + 1));
    await waitFor(() => expect(hook.result.current.usage?.percent).toBe(60));
    hook.unmount();
  });

  it('多个实例共享同一驱动：切 Key / 刷新事件只产生一份订阅请求', async () => {
    const apiKey = 'pst-shared-key';
    sessionStorage.setItem('nai_api_key', apiKey);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseFor({ tier: 4, active: true, usage: { percent: 64, isNegative: false, timeUntilNextPercent: 1500 } }))
      .mockResolvedValue(responseFor({ tier: 4, active: true, usage: { percent: 61, isNegative: false, timeUntilNextPercent: 1500 } }));
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    const first = renderHook(() => useNovelaiUsage());
    const second = renderHook(() => useNovelaiUsage());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // 共享请求（in-flight 去重）
    await waitFor(() => {
      expect(first.result.current.usage?.percent).toBe(64);
      expect(second.result.current.usage?.percent).toBe(64);
    });

    // 生图完成事件驱动刷新：驱动广播给所有订阅实例，仍只发一份请求
    await act(async () => {
      window.dispatchEvent(new CustomEvent(NOVELAI_USAGE_REFRESH_EVENT));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(first.result.current.usage?.percent).toBe(61);
    expect(second.result.current.usage?.percent).toBe(61);
    first.unmount();
    second.unmount();
  });
});
