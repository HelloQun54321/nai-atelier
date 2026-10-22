import { describe, expect, it, vi, afterEach } from 'vitest';
import { promptAgentService } from '../../services/promptAgent';

/**
 * 结果未知时的处理约定（按复查意见修正）：
 * 服务端目前没有按 operationId 去重/查询的入口，因此**客户端不自动重发**付费请求 ——
 * 连接中断时如实报错，避免重复消耗模型调用。请求体仍带 operationId，供网关侧将来做幂等。
 */
describe('库生成：结果未知时不自动重发', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('自动分类请求只发送原词，网络失败也不重发', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetch);
    const documents = [{ id: 'global', kind: 'global' as const, prompt: 'artist:test, blue dress' }];
    await expect(promptAgentService.classifyPrompts(documents)).rejects.toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ documents });
  });

  it('连接级失败只发一次，并把 operationId 放进请求体', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetch);
    await expect(promptAgentService.generateLibraryPrompt({ kind: 'appearance', brief: '金发少女', count: 1 })).rejects.toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(body.operationId).toMatch(/^[0-9a-f]{8}$/);
  });

  it('同一份输入得到同一个 operationId（可复现，便于服务端幂等）', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetch);
    const input = { kind: 'appearance' as const, brief: '金发少女', count: 1 };
    await expect(promptAgentService.generateLibraryPrompt(input)).rejects.toBeTruthy();
    await expect(promptAgentService.generateLibraryPrompt(input)).rejects.toBeTruthy();
    const first = JSON.parse(String(fetch.mock.calls[0][1].body)).operationId;
    const second = JSON.parse(String(fetch.mock.calls[1][1].body)).operationId;
    expect(first).toBe(second);
  });

  it('服务器错误同样只发一次', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: '提示词库分类无效' }, { status: 400 }));
    vi.stubGlobal('fetch', fetch);
    await expect(promptAgentService.generateLibraryPrompt({ kind: 'appearance', brief: 'x' })).rejects.toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
