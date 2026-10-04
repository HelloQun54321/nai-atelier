// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANLAS_BUDGET_CHANGED_EVENT, hashNaiApiKey, useAnlasBudget } from '../../services/anlasBudget';
import { NOVELAI_USAGE_REFRESH_EVENT, useNovelaiUsage } from '../../services/naiUsage';
import { vibeService } from '../../services/vibeService';

const responseFor = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json' },
});
const item = { id: 'test-vibe', name: '测试素材' };
const apiKey = 'vibe-refresh-test-key';

describe('Vibe 编码后的余额更新', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    sessionStorage.setItem('nai_api_key', apiKey);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('为本地预算补上请求 Key 的指纹，新编码成功只发送一次官方刷新通知', async () => {
    const keyHash = await hashNaiApiKey(apiKey);
    const budget = { remaining: 1664, personal: { [keyHash]: { anlasSpent: 2, opusImages: 0 } } };
    const fetchMock = vi.fn().mockResolvedValue(responseFor({ item, anlasBudget: budget }));
    vi.stubGlobal('fetch', fetchMock);
    const events = vi.spyOn(window, 'dispatchEvent');

    expect(await vibeService.encode(item.id, 1, apiKey)).toEqual({ item, anlasBudget: budget });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events.mock.calls.map(([event]) => event.type)).toEqual([
      ANLAS_BUDGET_CHANGED_EVENT, NOVELAI_USAGE_REFRESH_EVENT,
    ]);
    expect((events.mock.calls[0][0] as CustomEvent).detail).toEqual({ ...budget, keyHash });
  });

  it('没有本地预算字段的成功响应仍刷新官方余额，支持本地存储的 Key', async () => {
    sessionStorage.clear();
    localStorage.setItem('nai_api_key', ` ${apiKey} `);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFor({ item })));
    const events = vi.spyOn(window, 'dispatchEvent');
    await vibeService.encode(item.id, 1, apiKey);
    expect(events.mock.calls.map(([event]) => event.type)).toEqual([NOVELAI_USAGE_REFRESH_EVENT]);
  });

  it('重复编码复用没有新消费，不额外刷新或再次请求编码', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFor({ item, duplicate: true }));
    vi.stubGlobal('fetch', fetchMock);
    const events = vi.spyOn(window, 'dispatchEvent');
    expect(await vibeService.encode(item.id, 1, apiKey)).toEqual({ item, duplicate: true });
    expect(events).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 402, 503])('HTTP %s 正确抛错，不通知成功、不重试', async status => {
    const fetchMock = vi.fn().mockResolvedValue(responseFor({ error: '编码失败', code: 'ENCODING_FAILED' }, status));
    vi.stubGlobal('fetch', fetchMock);
    const events = vi.spyOn(window, 'dispatchEvent');
    await expect(vibeService.encode(item.id, 1, apiKey)).rejects.toMatchObject({
      name: 'ApiError', message: '编码失败', status, code: 'ENCODING_FAILED',
    });
    expect(events).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('网络失败不记账、不刷新、不自动重试', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('网络中断'));
    vi.stubGlobal('fetch', fetchMock);
    const events = vi.spyOn(window, 'dispatchEvent');
    await expect(vibeService.encode(item.id, 1, apiKey)).rejects.toThrow('网络中断');
    expect(events).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('切 Key 后的迟到编码按原 Key 通知预算，不刷新新账号或改写新预算', async () => {
    const keyHashA = await hashNaiApiKey(apiKey);
    const keyB = 'vibe-late-encoding-key-b';
    let resolveEncoding!: (response: Response) => void;
    const pendingEncoding = new Promise<Response>(resolve => { resolveEncoding = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/encodings')) return pendingEncoding;
      return responseFor({ remaining: 800, personal: {} });
    }));
    const encoding = vibeService.encode(item.id, 1, apiKey);
    sessionStorage.setItem('nai_api_key', keyB);
    const budget = renderHook(() => useAnlasBudget());
    await waitFor(() => expect(budget.result.current.remaining).toBe(800));
    const events = vi.spyOn(window, 'dispatchEvent');
    await act(async () => {
      resolveEncoding(responseFor({ item, anlasBudget: { remaining: 1664 } }));
      await encoding;
    });
    expect(events.mock.calls.map(([event]) => event.type)).toEqual([ANLAS_BUDGET_CHANGED_EVENT]);
    expect((events.mock.calls[0][0] as CustomEvent).detail.keyHash).toBe(keyHashA);
    expect(budget.result.current.remaining).toBe(800);
    expect(budget.result.current.personal).toBeNull();
  });

  it('成功立即更新本地预算并查询官方余额，慢查询不阻塞编码结果交付', async () => {
    const key = 'vibe-hook-integration-key';
    sessionStorage.setItem('nai_api_key', key);
    const keyHash = await hashNaiApiKey(key);
    const subscription = (paid: number) => ({
      active: true, tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: paid },
    });
    let subscriptionRequests = 0;
    let encodingRequests = 0;
    let resolveBalance!: (response: Response) => void;
    const pendingBalance = new Promise<Response>(resolve => { resolveBalance = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/novelai-subscription')) {
        subscriptionRequests++;
        return subscriptionRequests === 1 ? responseFor(subscription(8000)) : pendingBalance;
      }
      if (url.includes('/encodings')) {
        encodingRequests++;
        return responseFor({ item, anlasBudget: {
          remaining: 1664, personal: { [keyHash]: { anlasSpent: 2, opusImages: 0 } },
        } });
      }
      return responseFor({ remaining: 1666, personal: {} });
    }));
    const hook = renderHook(() => ({ budget: useAnlasBudget(), subscription: useNovelaiUsage() }));
    await waitFor(() => {
      expect(hook.result.current.budget.loading).toBe(false);
      expect(hook.result.current.subscription.info).toEqual(subscription(8000));
    });
    await act(async () => {
      expect((await vibeService.encode(item.id, 1, key)).item).toEqual(item);
    });
    await waitFor(() => expect(hook.result.current.budget.remaining).toBe(1664));
    expect(hook.result.current.budget.personal?.anlasSpent).toBe(2);
    expect(hook.result.current.subscription.loading).toBe(true);
    expect(subscriptionRequests).toBe(2);
    expect(encodingRequests).toBe(1);
    await act(async () => { resolveBalance(responseFor(subscription(7998))); });
    await waitFor(() => expect(hook.result.current.subscription.info).toEqual(subscription(7998)));
    expect(hook.result.current.budget.remaining).toBe(1664);
  });
});
