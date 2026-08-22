import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NAI_RUNTIME, refreshNaiRuntimeConfig } from './naiRuntime';

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
});
