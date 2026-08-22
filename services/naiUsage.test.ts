// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNovelaiUsage } from './naiUsage';

const responseFor = (payload: unknown) => ({
  ok: true,
  json: async () => payload,
  text: async () => '',
}) as Response;

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
});
