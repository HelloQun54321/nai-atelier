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
});
