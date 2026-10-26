// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANLAS_BUDGET_CHANGED_EVENT, hashNaiApiKey, useAnlasBudget } from '../../services/anlasBudget';
import { NOVELAI_USAGE_REFRESH_EVENT, useNovelaiUsage } from '../../services/naiUsage';
import { vibeService } from '../../services/vibeService';
import { api, NAI_ACCOUNTING_ERROR_EVENT } from '../../services/api';
import type { VibeAsset } from '../../types';
import type { ExportReceipt } from '../../services/exportLocation';
const exports = vi.hoisted(() => ({ begin: vi.fn(), save: vi.fn<() => Promise<ExportReceipt>>() }));
vi.mock('../../services/exportLocation', async importOriginal => ({ ...await importOriginal<typeof import('../../services/exportLocation')>(), beginExportTarget: exports.begin }));
vi.mock('../../services/fileDownload', () => ({ downloadFile: exports.save }));

const responseFor = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json' },
});

describe('Vibe 导出回执和删除接口', () => {
  afterEach(() => { exports.begin.mockReset(); exports.save.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const asset = { id: 'synthetic/id', name: '四份编码', encodings: Array.from({ length: 4 }, (_, index) => ({ id: `e${index}` })) } as VibeAsset;

  it.each(['naiv4vibe', 'naiv4vibeBundle'])('详情导出只请求资产，采用响应后缀 %s 并返回实际保存回执', async extension => {
    const receipt = { saved: false, cancelled: false, browserDownload: true };
    exports.save.mockResolvedValue(receipt);
    const target = Promise.resolve(undefined); exports.begin.mockReturnValue(target);
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { headers: { 'content-disposition': `attachment; filename=synthetic.${extension}` } }));
    vi.stubGlobal('fetch', fetch);
    expect(await vibeService.download(asset)).toBe(receipt);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/vibes/synthetic%2Fid/file');
    expect(exports.save).toHaveBeenCalledWith(expect.anything(), `四份编码.${extension}`, target);
    expect(exports.begin).toHaveBeenCalledOnce();
  });

  it('组合导出保留当前槽位与归一化，返回真实回执，保存取消继续向上传递', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ identifier: 'novelai-vibe-transfer-bundle', vibes: [] });
    const slots = [{ vibeId: asset.id, encodingId: 'e0', informationExtracted: 0.6, strength: -0.3 }];
    const receipt = { saved: true, cancelled: false, filename: '组合.naiv4vibeBundle' };
    exports.save.mockResolvedValueOnce(receipt).mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    expect(await vibeService.downloadGroup('组合', slots, false)).toBe(receipt);
    expect(post).toHaveBeenCalledWith('/vibes/export', { slots, normalizeStrengths: false });
    expect(exports.save).toHaveBeenCalledWith(expect.anything(), '组合.naiv4vibeBundle', undefined);
    await expect(vibeService.downloadGroup('组合', slots, false)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('详情HTTP错误直接抛出，不调用保存、不伪造成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFor({ error: 'Vibe 编码文件不存在' }, 400)));
    await expect(vibeService.download(asset)).rejects.toMatchObject({ status: 400, message: 'Vibe 编码文件不存在' });
    expect(exports.save).not.toHaveBeenCalled();
  });

  it('删除路径安全编码ID，保留后端409引用原因，不重试或自动解绑', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(responseFor({ success: true, id: asset.id }))
      .mockResolvedValueOnce(responseFor({ error: '这份编码仍被历史引用，不能永久删除' }, 409));
    vi.stubGlobal('fetch', fetch);
    expect(await vibeService.delete(asset.id)).toEqual({ success: true, id: asset.id });
    await expect(vibeService.deleteEncoding(asset.id, 'encoding/id')).rejects.toMatchObject({ status: 409, message: '这份编码仍被历史引用，不能永久删除' });
    expect(fetch.mock.calls.map(call => [call[0], call[1].method])).toEqual([
      ['/api/vibes/synthetic%2Fid', 'DELETE'], ['/api/vibes/synthetic%2Fid/encodings/encoding%2Fid', 'DELETE'],
    ]);
  });

  it.each(['asset', 'encoding'])('%s 删除响应失败也失效已物化缓存，后续主动取用免费重新导入', async target => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ slots: [], normalizeStrengths: true });
    vi.spyOn(api, 'delete').mockRejectedValue(Object.assign(new Error('文件删除失败'), { status: 503 }));
    const embedded = { model: 'nai-diffusion-4-5-full', encodings: ['synthetic'], strengths: [0.6] };
    await vibeService.importEmbedded(embedded); await vibeService.importEmbedded(embedded);
    expect(post).toHaveBeenCalledOnce();
    await expect(target === 'asset' ? vibeService.delete(asset.id) : vibeService.deleteEncoding(asset.id, 'e0')).rejects.toThrow('文件删除失败');
    await vibeService.importEmbedded(embedded);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls.every(call => call[0] === '/vibes/import')).toBe(true);
  });
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
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-Nai-Anlas-Max-Cost');
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
  it('新编码已保存但本地记账失败时保留资产并提示核对，不再编码', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFor({ item, anlasAccountingFailed: true, anlasAccountingError: '本地预算更新失败（HTTP 503）' }));
    vi.stubGlobal('fetch', fetchMock);
    const events = vi.spyOn(window, 'dispatchEvent');
    expect((await vibeService.encode(item.id, 1, apiKey)).item).toEqual(item);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events.mock.calls.some(([event]) => event.type === NAI_ACCOUNTING_ERROR_EVENT)).toBe(true);
    expect((events.mock.calls.find(([event]) => event.type === NAI_ACCOUNTING_ERROR_EVENT)![0] as CustomEvent).detail.message).toContain('本地预算更新失败（HTTP 503）');
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
