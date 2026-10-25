// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
    cancelGenerationJob, getGenerationJob, isGenerationJobState, isGenerationJobTerminal, observeGenerationJob, startGenerationJob, updateGenerationJobApproval,
} from '../../services/generationJob';
import type { GenerationJobDescriptor, GenerationJobSnapshot, GenerationJobState } from '../../services/generationJob';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const MODEL = 'nai-diffusion-4-5-full';
const params = { model: MODEL, width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler' };
const descriptor: GenerationJobDescriptor = {
    payload: { model: MODEL, action: 'generate', parameters: { ...params } },
    history: { prompt: 'synthetic prompt', negativePrompt: 'synthetic negative', params: { ...params } },
    randomSeed: true, stream: false, approvedCost: 5,
};
const snapshot: GenerationJobSnapshot = {
    token: 'synthetic-token', state: 'generating', completedCount: 1, requestedCount: 3, historyIds: ['h1'],
};

it('实时 GET 跳过同块旧预览，最终图、保存与失败告警按顺序交付，不等待绘制', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const snapshots: GenerationJobSnapshot[] = [1, 2, 3].map(step => ({ ...snapshot, previewVersion: step, preview: { image: 'data:image/png;base64,AQID', step } }));
    snapshots.push({ ...snapshot, previewVersion: 4, preview: { image: 'final-unsaved' } }, { ...snapshot, state: 'saving', previewVersion: 4 }, { ...snapshot, state: 'failed', previewVersion: 4, accountingFailed: true, accountingError: '记账失败', cleanupError: '清理失败', code: 'history_save_failed' });
    const text = snapshots.map(value => `event: snapshot\r\ndata: ${JSON.stringify(value)}\r\n\r\n`).join('');
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
        const encoded = new TextEncoder().encode(text);
        controller.enqueue(encoded.slice(0, 23)); controller.enqueue(encoded.slice(23)); controller.close();
    } });
    const fetch = vi.fn(async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetch);
    const steps: number[] = [], received: GenerationJobSnapshot[] = [], abort = new AbortController();
    const observing = observeGenerationJob('synthetic-key', 'a b/c', abort.signal, value => { received.push(value); if (value.preview?.step) steps.push(value.preview.step); }, 0);
    await observing;
    expect(steps).toEqual([]);
    expect(frames).toHaveLength(0);
    expect(received.map(value => value.state)).toEqual(['generating', 'generating', 'generating', 'generating', 'saving', 'failed']);
    expect(received.flatMap(value => value.preview ? [value.preview.image] : [])).toEqual(['final-unsaved']);
    expect(received.at(-1)).toMatchObject({ accountingFailed: true, accountingError: '记账失败', cleanupError: '清理失败', code: 'history_save_failed' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toEqual(['/api/generation-job?token=a%20b%2Fc&events=1&previewVersion=0', {
        headers: { Authorization: 'Bearer synthetic-key', Accept: 'text/event-stream' }, cache: 'no-store', signal: abort.signal,
    }]);
});

it('同块仅剩过程图时交付最新步数，状态字段逐条保留', async () => {
    const values: GenerationJobSnapshot[] = [1, 2, 3].map(step => ({ ...snapshot, previewVersion: step, preview: { image: `frame-${step}`, step } }));
    values.push({ ...snapshot, state: 'cancelled', previewVersion: 3 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(values.map(value => `event: snapshot\ndata: ${JSON.stringify(value)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })));
    const received: GenerationJobSnapshot[] = [];
    await observeGenerationJob('key', 'token', new AbortController().signal, value => { received.push(value); });
    expect(received.map(value => value.preview?.step)).toEqual([undefined, undefined, 3, undefined]);
    expect(received.every(value => value.historyIds[0] === 'h1')).toBe(true);
    expect(received.at(-1)?.state).toBe('cancelled');
});

it.each(['visible', 'hidden'] as const)('%s 页跨块立即交付新图，最终图与同版本保存状态无需绘制即可到达', async visibility => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visibility);
    const raf = vi.fn(); vi.stubGlobal('requestAnimationFrame', raf);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })));
    const received: GenerationJobSnapshot[] = [];
    const observing = observeGenerationJob('key', 'token', new AbortController().signal, value => { received.push(value); });
    const emit = (value: GenerationJobSnapshot) => controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(value)}\n\n`));
    emit({ ...snapshot, previewVersion: 1, preview: { image: 'first', step: 1 } });
    await vi.waitFor(() => expect(received.at(-1)?.preview?.image).toBe('first'));
    emit({ ...snapshot, previewVersion: 2, preview: { image: 'latest', step: 2 } });
    await vi.waitFor(() => expect(received.at(-1)?.preview?.image).toBe('latest'));
    emit({ ...snapshot, previewVersion: 3, preview: { image: 'final' } });
    await vi.waitFor(() => expect(received.at(-1)?.preview?.image).toBe('final'));
    emit({ ...snapshot, state: 'saving', previewVersion: 3 });
    emit({ ...snapshot, state: 'succeeded', previewVersion: 4 });
    await observing;
    expect(received.map(value => value.state)).toEqual(['generating', 'generating', 'generating', 'saving', 'succeeded']);
    expect(raf).not.toHaveBeenCalled();
});

it('实时观察不伪报断流成功，错误状态与取消保留原有语义', async () => {
    const fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: '任务不存在', code: 'generation_job_not_found' }), { status: 404 }))
        .mockResolvedValueOnce(new Response('event: snapshot\ndata: {"state":"generating"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
        .mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await expect(observeGenerationJob('key', 'token', signal, () => {})).rejects.toMatchObject({ status: 404, code: 'generation_job_not_found' });
    await expect(observeGenerationJob('key', 'token', signal, () => {})).rejects.toThrow('连接已断开');
    await expect(observeGenerationJob('key', 'token', signal, () => {})).rejects.toThrow('连接不可用');
});

it('状态取值只接受后端约定，终态仅成功、取消与失败', () => {
    const states: GenerationJobState[] = ['waiting', 'preparing', 'generating', 'saving', 'paused', 'awaiting_confirmation', 'succeeded', 'cancelled', 'failed'];
    expect(states.every(state => isGenerationJobState(state))).toBe(true);
    expect([undefined, null, '', 'queued', 'done'].some(value => isGenerationJobState(value))).toBe(false);
    expect(states.filter(state => isGenerationJobTerminal(state))).toEqual(['succeeded', 'cancelled', 'failed']);
});

it('提交任务只发一次 POST，带 Key、任务头、张数与位置，body 是完整 descriptor', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(snapshot)));
    vi.stubGlobal('fetch', fetch);
    expect(await startGenerationJob('synthetic-key', 'synthetic-token', descriptor, 3, 'next')).toEqual(snapshot);
    expect(fetch).toHaveBeenCalledOnce();
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe('/api/generation-job');
    expect(options).toMatchObject({
        method: 'POST', cache: 'no-store',
        headers: {
            Authorization: 'Bearer synthetic-key', 'X-Nai-Generation-Task': 'synthetic-token',
            'X-Nai-Generation-Count': '3', 'X-Nai-Generation-Placement': 'next', 'Content-Type': 'application/json',
        },
        body: JSON.stringify(descriptor),
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    // 费用上限随 descriptor 一起提交，后端不依赖本地状态。
    expect(JSON.parse(String(options?.body))).toMatchObject({ approvedCost: 5, randomSeed: true, payload: { action: 'generate' } });

    await startGenerationJob('synthetic-key', 'synthetic-token', descriptor, 1);
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({ 'X-Nai-Generation-Count': '1' });
    expect(fetch.mock.calls[1][1]?.headers).not.toHaveProperty('X-Nai-Generation-Placement');
});

it('状态查询是可缓存的只读 GET，用 token 查询串且不重复发送任务头', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(snapshot)));
    vi.stubGlobal('fetch', fetch);
    expect(await getGenerationJob('synthetic-key', 'synthetic-token')).toEqual(snapshot);
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe('/api/generation-job?token=synthetic-token');
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer synthetic-key' } });
    expect(options?.headers).not.toHaveProperty('X-Nai-Generation-Task');
    expect(options).not.toHaveProperty('body');
    expect(options?.signal).toBeInstanceOf(AbortSignal);

    await getGenerationJob('synthetic-key', 'a b/c');
    expect(fetch.mock.calls[1][0]).toBe('/api/generation-job?token=a%20b%2Fc');
    await getGenerationJob('synthetic-key', 'synthetic-token', 7);
    expect(fetch.mock.calls[2][0]).toBe('/api/generation-job?token=synthetic-token&previewVersion=7');
});

it('取消按 Key 发送 DELETE，页面卸载的 keepalive 请求不再挂超时信号', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await cancelGenerationJob('synthetic-key', 'synthetic-token');
    expect(fetch.mock.calls[0][0]).toBe('/api/generation-job');
    expect(fetch.mock.calls[0][1]).toMatchObject({
        method: 'DELETE', cache: 'no-store', headers: { Authorization: 'Bearer synthetic-key', 'X-Nai-Generation-Task': 'synthetic-token' },
    });
    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('body');

    await cancelGenerationJob('synthetic-key', 'synthetic-token', { keepalive: true });
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'DELETE', keepalive: true });
    expect(fetch.mock.calls[1][1]).not.toHaveProperty('signal');
});

it('费用上涨后的补充授权只上传 approvedCost，并返回后端快照', async () => {
    const awaiting = { ...snapshot, state: 'awaiting_confirmation' as const, cost: 12 };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(awaiting)));
    vi.stubGlobal('fetch', fetch);
    expect(await updateGenerationJobApproval('synthetic-key', 'synthetic-token', 12)).toEqual(awaiting);
    expect(fetch.mock.calls[0][1]).toMatchObject({
        method: 'PATCH', cache: 'no-store',
        headers: { Authorization: 'Bearer synthetic-key', 'X-Nai-Generation-Task': 'synthetic-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedCost: 12 }),
    });
});

it('后端拒绝保留结构化 code 与状态码，401 沿用局域网解锁事件', async () => {
    const unlock = vi.fn(); window.addEventListener('nai-lan-access-required', unlock);
    const fetch = vi.fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: '此 Key 正在生成', code: 'generation_busy' }), { status: 409 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: '需要解锁', code: 'LAN_ACCESS_REQUIRED' }), { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    try {
        await expect(startGenerationJob('synthetic-key', 'synthetic-token', descriptor, 1)).rejects.toMatchObject({ code: 'generation_busy', status: 409 });
        await expect(getGenerationJob('synthetic-key', 'synthetic-token')).rejects.toMatchObject({ code: 'LAN_ACCESS_REQUIRED', status: 401 });
        await vi.waitFor(() => expect(unlock).toHaveBeenCalledOnce());
        expect(fetch).toHaveBeenCalledTimes(2);
    } finally { window.removeEventListener('nai-lan-access-required', unlock); }
});
