import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, createSseParser, isQueueCancelledError, parseErrorResponse, NAI_ACCOUNTING_ERROR_EVENT } from '../../services/api';

describe('SSE parser', () => {
  it('记账回执自带失败状态，后续兼容错误帧不重复提示', async () => {
    const events: Event[] = [];
    vi.stubGlobal('window', { dispatchEvent: (event: Event) => { events.push(event); return true; } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('event: final\ndata: {"image":"fake"}\n\nevent: nai_usage\ndata: {"estimatedSpent":0,"accountingFailed":true,"accountingError":"本地预算更新失败（HTTP 503）"}\n\nevent: nai_usage_error\ndata: {"message":"本地预算更新失败（HTTP 503）"}\n\n')));
    await api.postSse('/generate-stream', {}, {}, () => {});
    const notices = events.filter(event => event.type === NAI_ACCOUNTING_ERROR_EVENT) as CustomEvent[];
    expect(notices).toHaveLength(1); expect(notices[0].detail.message).toContain('本地预算更新失败（HTTP 503）');
    vi.unstubAllGlobals();
  });
  it.each([null, '', false, -1])('费用字段 %s 不能伪装成零点数，记账失败仍交付成品并派发提示', async value => {
    const events: Event[] = [];
    vi.stubGlobal('window', { dispatchEvent: (event: Event) => { events.push(event); return true; } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`event: final\ndata: {"image":"fake"}\n\nevent: nai_usage\ndata: ${JSON.stringify({ estimatedSpent: value, remaining: value })}\n\nevent: nai_usage_error\ndata: {}\n\n`)));
    const received: string[] = [];
    expect(await api.postSse('/generate-stream', {}, {}, event => received.push(event.event))).toEqual({});
    expect(received).toContain('final');
    const notice = events.find(event => event.type === NAI_ACCOUNTING_ERROR_EVENT) as CustomEvent;
    expect(notice).toBeTruthy();
    expect(notice.detail.message).toContain('核对账号余额与本地预算');
    expect(notice.detail.message).not.toContain('官方余额');
    vi.unstubAllGlobals();
  });
  it('POST 流透传取消信号，保留已有逐帧解析', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(new Response('event: result\ndata: {"index":0}\n\n'));
    vi.stubGlobal('fetch', fetchMock);
    const events: unknown[] = [];
    await api.postSse('/danbooru/covers', {}, {}, event => events.push(event.data), { signal: controller.signal });
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    expect(events).toEqual([{ index: 0 }]);
    vi.unstubAllGlobals();
  });
  it('parses events split across arbitrary network chunks', () => {
    const events: Array<{ event: string; data: unknown }> = [];
    const parser = createSseParser(event => events.push(event));
    parser.push('event: inter');
    parser.push('mediate\r\ndata: {"step_ix":7,');
    parser.push('"image":"abc"}\r\n\r\nevent: final\n');
    parser.push('data: {"seed":42,"image":"xyz"}\n\n');
    parser.finish();
    expect(events).toEqual([
      { event: 'intermediate', data: { step_ix: 7, image: 'abc' } },
      { event: 'final', data: { seed: 42, image: 'xyz' } },
    ]);
  });

  it('joins multiple data lines and ignores comments', () => {
    const events: Array<{ event: string; data: unknown }> = [];
    const parser = createSseParser(event => events.push(event));
    parser.push(': keepalive\ndata: first\ndata: second\n\n');
    expect(events).toEqual([{ event: 'message', data: 'first\nsecond' }]);
  });
});

describe('parseErrorResponse', () => {
  const jsonResponse = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status });

  it('保留结构化等待时间，忽略无效和负值', async () => {
    expect(await parseErrorResponse(jsonResponse(403, { error: '需要验证', code: 'DANBOORU_CHALLENGE', retryAfter: 300 }))).toMatchObject({ status: 403, code: 'DANBOORU_CHALLENGE', retryAfter: 300 });
    for (const retryAfter of [-1, '300', null]) expect((await parseErrorResponse(jsonResponse(429, { error: '等待', retryAfter }))).retryAfter).toBeUndefined();
  });

  it('takes the message field from the JSON payload and attaches code/status', async () => {
    const error = await parseErrorResponse(jsonResponse(499, { error: '已取消排队', code: 'QUEUE_CANCELLED' }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe('ApiError');
    expect(error.message).toBe('已取消排队');
    expect(error.code).toBe('QUEUE_CANCELLED');
    expect(error.status).toBe(499);
  });

  it('falls back to the error field when message is missing', async () => {
    const error = await parseErrorResponse(jsonResponse(401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' }));
    expect(error.message).toBe('需要局域网访问密码');
    expect(error.code).toBe('LAN_ACCESS_REQUIRED');
    expect(error.status).toBe(401);
  });

  it('falls back to a generic status message for an empty or non-string payload', async () => {
    const empty = await parseErrorResponse(jsonResponse(503, {}));
    expect(empty.message).toBe('请求失败 (503)');
    const nonString = await parseErrorResponse(jsonResponse(500, { error: 42 }));
    expect(nonString.message).toBe('请求失败 (500)');
  });

  it('truncates long non-JSON bodies instead of exposing them whole', async () => {
    const body = 'x'.repeat(3000);
    const error = await parseErrorResponse(new Response(`<html>${body}</html>`, { status: 502 }));
    expect(error.message.length).toBeLessThanOrEqual(510);
    expect(error.message).not.toContain(body);
    expect(error.status).toBe(502);
    expect(error.message).toBe('服务暂时不可用 (HTTP 502)，请稍后重试');
  });

  it.each([502, 503, 504])('原始HTML与JSON包装的HTML都只显示状态说明：%s', async status => {
    const html = '<!DOCTYPE html><html><head><title>novelai.net | 502: Bad gateway</title></head><body>synthetic-ray-id</body></html>';
    const raw = await parseErrorResponse(new Response(html, { status, headers: { 'Content-Type': 'text/html' } }));
    const wrapped = await parseErrorResponse(jsonResponse(status, { error: html, code: 'UPSTREAM_FAILED', retryAfter: 2.3 }));
    expect(raw.message).toBe(`服务暂时不可用 (HTTP ${status})，请稍后重试`);
    expect(wrapped).toMatchObject({ message: raw.message, status, code: 'UPSTREAM_FAILED', retryAfter: 3 });
    expect(wrapped.message).not.toMatch(/DOCTYPE|synthetic-ray-id|<html/);
  });

  it('403错误网页不冒充服务端故障，普通纯文本仍保留有界的具体原因', async () => {
    expect((await parseErrorResponse(new Response('<html>challenge</html>', { status: 403 }))).message).toBe('服务返回了错误页面 (HTTP 403)，请检查网络或代理后重试');
    expect((await parseErrorResponse(new Response('quota limit reached', { status: 429 }))).message).toBe('quota limit reached');
    expect((await parseErrorResponse(new Response('x'.repeat(3000), { status: 500 }))).message).toHaveLength(501);
  });
});

describe('isQueueCancelledError', () => {
  it('recognizes ApiError with QUEUE_CANCELLED code even with a foreign message', () => {
    const error = new ApiError('服务端未知文案', 499, 'QUEUE_CANCELLED');
    expect(isQueueCancelledError(error)).toBe(true);
  });

  it('recognizes ApiError with HTTP 499', () => {
    expect(isQueueCancelledError(new ApiError('已取消排队', 499))).toBe(true);
  });

  it('keeps the legacy message match for plain errors (old gateway)', () => {
    expect(isQueueCancelledError(new Error('已取消排队'))).toBe(true);
    expect(isQueueCancelledError(new Error('其他错误'))).toBe(false);
  });

  it('rejects unrelated structured errors', () => {
    const error = new ApiError('公共队列服务不可用', 503, 'CLOUD_QUEUE_UNAVAILABLE');
    expect(isQueueCancelledError(error)).toBe(false);
    expect(isQueueCancelledError(null)).toBe(false);
  });
});

describe('api.postSse', () => {
  const encodeSse = (...frames: Array<{ event: string; data: string }>) =>
    frames.map(frame => `event: ${frame.event}\ndata: ${frame.data}\n\n`).join('');

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('透传 nai_usage 事件的 estimatedSpent 到返回值', async () => {
    const body = encodeSse(
      { event: 'final', data: JSON.stringify({ image: 'data:image/png;base64,AA==' }) },
      { event: 'nai_usage', data: JSON.stringify({ keyHash: 'k', remaining: 1200, estimatedSpent: 6, refreshPersonal: true }) }
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: stream, headers: new Headers() } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const received: string[] = [];
    const result = await api.postSse('/generate-stream', {}, { Authorization: 'Bearer x' }, event => {
      received.push(event.event);
    }, { budgetKeyHash: 'k' });

    expect(received).toEqual(['final', 'nai_usage']);
    expect(result.estimatedCost).toBe(6);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer x', Accept: 'text/event-stream' });
  });

  it('nai_usage 缺失 estimatedSpent 或为 nai_usage_error 时不产出 estimatedCost', async () => {
    const body = encodeSse(
      { event: 'final', data: JSON.stringify({ image: 'data:image/png;base64,AA==' }) },
      { event: 'nai_usage', data: JSON.stringify({ keyHash: 'k', remaining: 900, refreshPersonal: true }) }
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: stream, headers: new Headers() } as Response));

    const result = await api.postSse('/generate-stream', {}, { Authorization: 'Bearer x' }, () => {});
    expect(result.estimatedCost).toBeUndefined();
  });
});
