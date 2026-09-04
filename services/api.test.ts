import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, createSseParser, isQueueCancelledError, parseErrorResponse } from './api';

describe('SSE parser', () => {
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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: stream } as Response);
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: stream } as Response));

    const result = await api.postSse('/generate-stream', {}, { Authorization: 'Bearer x' }, () => {});
    expect(result.estimatedCost).toBeUndefined();
  });
});
