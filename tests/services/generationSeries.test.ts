// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LocalGenItem } from '../../types';
import {
    approveGenerationSeries, beginGenerationSeries, getGenerationSeriesSession, getQueuedGenerationSeries,
    stopGenerationSeriesSession, subscribeGenerationSeries,
} from '../../services/generationSeries';
import type { GenerationJobDescriptor, GenerationJobSnapshot } from '../../services/generationJob';
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { InlineCloudQueueStatus } from '../../components/CloudQueueStatus';
import { emitCloudQueueStatus, getCurrentCloudQueueStatus } from '../../services/cloudQueue';

// 只替换四个网络函数；状态判定与全部状态机逻辑走真实实现。
const job = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), cancel: vi.fn(), approve: vi.fn(), observe: vi.fn() }));
vi.mock('../../services/generationJob', async importOriginal => Object.assign({}, await importOriginal(), {
    startGenerationJob: job.start, getGenerationJob: job.get, cancelGenerationJob: job.cancel, updateGenerationJobApproval: job.approve, observeGenerationJob: job.observe,
}));

const MODEL = 'nai-diffusion-4-5-full';
const params = { model: MODEL, width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler' };
const descriptor = (): GenerationJobDescriptor => ({
    payload: { model: MODEL, action: 'generate', parameters: { ...params } },
    history: { prompt: 'synthetic prompt', negativePrompt: 'synthetic negative', params: { ...params } },
    randomSeed: true, stream: false, approvedCost: 5,
});
const snapshot = (overrides: Partial<GenerationJobSnapshot> = {}): GenerationJobSnapshot => ({
    token: 'synthetic-token', state: 'preparing', completedCount: 0, requestedCount: 3, historyIds: [], ...overrides,
});
const callsFor = (token: string) => job.cancel.mock.calls.filter(call => call[1] === token);

let scopeSeq = 0;
const nextScope = () => `synthetic-series-${++scopeSeq}`;

beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    emitCloudQueueStatus(null);
    job.start.mockReset().mockResolvedValue(snapshot({ state: 'preparing' }));
    job.get.mockReset().mockResolvedValue(snapshot({ state: 'succeeded', completedCount: 3, historyIds: ['h1', 'h2', 'h3'] }));
    job.cancel.mockReset().mockResolvedValue(undefined);
    job.approve.mockReset().mockResolvedValue(undefined);
    job.observe.mockReset();
});

it('已保存结果的记账失败原因跟随后端回执，不再次提交生图', async () => {
    job.start.mockResolvedValueOnce(snapshot({ state: 'succeeded', completedCount: 1, requestedCount: 1, historyIds: ['h1'], accountingFailed: true, accountingError: '本地预算更新失败（HTTP 503）' }));
    const { session, settle } = beginGenerationSeries({ scope: nextScope(), key: 'synthetic-key', count: 1, agent: false, descriptor: descriptor() });
    await expect(settle).resolves.toMatchObject({ success: true, completedCount: 1 });
    expect(session.accountingFailed).toBe(true); expect(session.accountingError).toBe('本地预算更新失败（HTTP 503）');
    expect(job.start).toHaveBeenCalledOnce(); expect(job.cancel).not.toHaveBeenCalled();
});

it('开启预览后实时观察每步与保存终态，不再等待一秒轮询，重连不重复 POST', async () => {
    const steps: number[] = [];
    let publishSnapshot: (snapshot: GenerationJobSnapshot) => void = () => {};
    let disconnect: () => void = () => {};
    job.start.mockResolvedValueOnce(snapshot({ state: 'generating', previewVersion: 0 }));
    job.observe.mockImplementationOnce((_key, _token, _signal, onSnapshot) => {
        publishSnapshot = onSnapshot;
        return new Promise<void>((_resolve, reject) => { disconnect = () => reject(new Error('synthetic-disconnect')); });
    }).mockImplementationOnce(async (_key, _token, _signal, onSnapshot) => {
        onSnapshot(snapshot({ state: 'succeeded', completedCount: 1, requestedCount: 1, historyIds: ['h1'] }));
    });
    job.get.mockResolvedValueOnce(snapshot({ state: 'generating', previewVersion: 8 }));
    const { session, settle } = beginGenerationSeries({ scope: nextScope(), key: 'synthetic-key', count: 1, agent: false, descriptor: { ...descriptor(), stream: true } });
    await vi.advanceTimersByTimeAsync(0);
    const unsubscribe = subscribeGenerationSeries(() => { if (session.preview?.step) steps.push(session.preview.step); });
    for (let step = 1; step <= 8; step++) publishSnapshot(snapshot({ state: 'generating', previewVersion: step, preview: { image: 'data:image/png;base64,AQID', step } }));
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(session.steps).toBe(28);
    expect(job.get).not.toHaveBeenCalled();
    unsubscribe(); disconnect();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settle).resolves.toMatchObject({ success: true, completedCount: 1 });
    expect(job.observe).toHaveBeenCalledTimes(2);
    expect(job.start).toHaveBeenCalledOnce();
    expect(job.cancel).not.toHaveBeenCalled();
});

it('实时观察冻结后回前台立即重连，保留后台任务和最新状态', async () => {
    const scope = nextScope();
    job.start.mockResolvedValueOnce(snapshot({ state: 'generating' }));
    job.observe.mockImplementationOnce((_key, _token, signal) => new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('重新观察', 'AbortError')));
    })).mockImplementationOnce(async (_key, _token, _signal, onSnapshot) => {
        onSnapshot(snapshot({ state: 'succeeded', completedCount: 1, requestedCount: 1, historyIds: ['h1'] }));
    });
    job.get.mockResolvedValueOnce(snapshot({ state: 'generating', previewVersion: 8 }));
    const { settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 1, agent: false, descriptor: { ...descriptor(), stream: true } });
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    await expect(settle).resolves.toMatchObject({ success: true });
    expect(job.observe).toHaveBeenCalledTimes(2);
    expect(job.get).toHaveBeenCalledOnce(); expect(job.start).toHaveBeenCalledOnce();
    expect(job.cancel).not.toHaveBeenCalled();
});

it('未变化的预览不重复传图，版本变化清除已保存预览，旧快照仍兼容', async () => {
    const scope = nextScope();
    const preview = { image: 'data:image/png;base64,AQID', step: 4 };
    job.start.mockResolvedValueOnce(snapshot({ state: 'generating', previewVersion: 2, preview }));
    job.get
        .mockResolvedValueOnce(snapshot({ state: 'generating', previewVersion: 2 }))
        .mockResolvedValueOnce(snapshot({ state: 'waiting', previewVersion: 3, completedCount: 1, historyIds: ['h1'] }))
        .mockResolvedValueOnce(snapshot({ state: 'failed', preview: { image: 'data:image/png;base64,BAUG' }, code: 'history_save_failed' }));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 3, agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.preview).toEqual(preview);
    expect(job.get).toHaveBeenLastCalledWith('synthetic-key', session.token, 2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.preview).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(job.get).toHaveBeenLastCalledWith('synthetic-key', session.token, 3);
    expect(session.preview?.image).toBe('data:image/png;base64,BAUG');
    await expect(settle).resolves.toMatchObject({ outcome: 'failed', code: 'history_save_failed' });
});
afterEach(() => { cleanup(); emitCloudQueueStatus(null); vi.useRealTimers(); sessionStorage.clear(); });

it.each(['generate', 'img2img', 'inpaint', 'outpaint'].flatMap(operation => [false, true].map(stream => ({ operation, stream }))))(
    '$operation 预览 $stream：后台排队回执驱动实际提示，生成与完成正确收尾', async ({ operation, stream }) => {
        sessionStorage.setItem('nai_api_key', 'synthetic-key');
        const data = descriptor(); data.stream = stream;
        data.payload.action = operation === 'generate' ? 'generate' : operation === 'img2img' ? 'img2img' : 'infill';
        if (operation === 'outpaint') data.payload.parameters._local_edit_operation = 'outpaint';
        const cloud = { taskId: 'synthetic-cloud-task', phase: 'joining' as const, cancelable: true };
        job.start.mockResolvedValueOnce(snapshot({ state: 'generating', cloudQueue: cloud }));
        let push: (value: GenerationJobSnapshot) => void = () => {};
        let finish: () => void = () => {};
        job.observe.mockImplementationOnce((_key, _token, _signal, onSnapshot) => {
            push = onSnapshot; return new Promise<void>(resolve => { finish = resolve; });
        });
        const view = render(createElement(InlineCloudQueueStatus, { generationProgress: { step: 8, total: 28 } }));
        let settle!: Promise<unknown>;
        await act(async () => {
            ({ settle } = beginGenerationSeries({ scope: nextScope(), key: 'synthetic-key', count: 1, agent: false, descriptor: data }));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(screen.getByRole('status').textContent).toContain('加入队列中…');
        const deliver = async (next: GenerationJobSnapshot) => {
            await act(async () => {
                if (stream) { push(next); if (next.state === 'succeeded') finish(); }
                else { job.get.mockResolvedValueOnce(next); await vi.advanceTimersByTimeAsync(1000); }
            });
        };
        await deliver(snapshot({ state: 'generating', cloudQueue: { ...cloud, phase: 'waiting', position: 2, queueSize: 4, greeting: '正在生成中～' } }));
        expect(screen.getByRole('status').textContent).toContain('前方 2 个任务');
        expect(screen.getByRole('status').textContent).toContain('队列共 4 个任务');
        expect(screen.getByRole('status').textContent).toContain('当前使用者：正在生成中～');
        expect(screen.getByRole('button', { name: '取消排队' })).toBeTruthy();
        await deliver(snapshot({ state: 'generating', cloudQueue: { ...cloud, phase: 'waiting', position: 0, queueSize: 0 } }));
        expect(screen.getByRole('status').textContent).toContain('前方 0 个任务');
        expect(screen.getByRole('status').textContent).toContain('队列共 0 个任务');
        await deliver(snapshot({ state: 'generating', cloudQueue: { ...cloud, phase: 'generating', cancelable: false, queueSize: null } }));
        expect(screen.getByRole('status').textContent).toContain('生成中 8/28');
        expect(screen.getByRole('status').textContent).toContain('队列数量未知');
        expect(screen.queryByRole('button', { name: '取消排队' })).toBeNull();
        await deliver(snapshot({ state: 'succeeded', requestedCount: 1, completedCount: 1, historyIds: ['h1'], cloudQueue: { ...cloud, phase: 'completed', cancelable: false } }));
        await expect(settle).resolves.toMatchObject({ success: true });
        expect(screen.queryByRole('status')).toBeNull();
        expect(job.start).toHaveBeenCalledOnce();
        view.unmount();
    },
);

it('待生成任务与旧任务回执不清除新提示，切 Key 后迟到回执不能重新点亮', async () => {
    sessionStorage.setItem('nai_api_key', 'synthetic-key');
    const cloud = { taskId: 'old-cloud-task', phase: 'waiting' as const, position: 2 };
    job.start.mockResolvedValueOnce(snapshot({ state: 'generating', cloudQueue: cloud }))
        .mockResolvedValueOnce(snapshot({ state: 'waiting', position: 1, cloudQueue: null }));
    const first = beginGenerationSeries({ scope: nextScope(), key: 'synthetic-key', count: 1, agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    const waiting = beginGenerationSeries({ scope: nextScope(), key: 'synthetic-key', count: 1, placement: 'end', agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    expect(getCurrentCloudQueueStatus()?.taskId).toBe(cloud.taskId);
    emitCloudQueueStatus({ taskId: 'new-cloud-task', phase: 'waiting', position: 0 }, 'synthetic-key');
    job.get.mockResolvedValue(snapshot({ state: 'succeeded', cloudQueue: { ...cloud, phase: 'completed' } }));
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([first.settle, waiting.settle]);
    expect(getCurrentCloudQueueStatus()?.taskId).toBe('new-cloud-task');

    job.start.mockResolvedValueOnce(snapshot({ state: 'generating', cloudQueue: cloud }));
    const switched = beginGenerationSeries({ scope: nextScope(), key: 'synthetic-key', count: 1, agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    sessionStorage.setItem('nai_api_key', 'another-key');
    window.dispatchEvent(new Event('nai-api-key-changed'));
    emitCloudQueueStatus({ taskId: 'another-key-task', phase: 'waiting' }, 'another-key');
    await vi.advanceTimersByTimeAsync(1000); await switched.settle;
    expect(getCurrentCloudQueueStatus()?.taskId).toBe('another-key-task');
});

it.each(['succeeded', 'cancelled', 'failed'] as const)('后台 %s 时仍在等待的公共队列提示按真实终态收束', async state => {
    sessionStorage.setItem('nai_api_key', 'synthetic-key');
    job.start.mockResolvedValueOnce(snapshot({ state: 'generating', cloudQueue: { taskId: 'cloud-terminal', phase: 'waiting', cancelable: true } }));
    job.get.mockResolvedValueOnce(snapshot({ state, requestedCount: 1, completedCount: state === 'succeeded' ? 1 : 0,
        historyIds: state === 'succeeded' ? ['h1'] : [], error: state === 'failed' ? 'synthetic failure' : undefined }));
    const { settle } = beginGenerationSeries({ scope: nextScope(), key: 'synthetic-key', count: 1, agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(1000); await settle;
    expect(getCurrentCloudQueueStatus()).toMatchObject({ phase: state === 'succeeded' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'error', cancelable: false });
});

it('一次 POST 后只轮询观察：进度、预览与已保存项透传，终态退出并给出成功回执', async () => {
    const scope = nextScope();
    const listener = vi.fn();
    const unsubscribe = subscribeGenerationSeries(listener);
    const built = descriptor();
    const saved = { id: 'h1', imageUrl: '/api/local-history/h1/image', prompt: 'synthetic prompt', params: { ...params }, createdAt: 1000 } as LocalGenItem;
    job.get
        .mockResolvedValueOnce(snapshot({ state: 'generating', completedCount: 1, historyIds: ['h1'], lastSavedItem: saved, preview: { image: 'data:image/png;base64,AQID', step: 4 } }))
        .mockResolvedValueOnce(snapshot({ state: 'succeeded', completedCount: 3, historyIds: ['h1', 'h2', 'h3'] }));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 3, agent: true, descriptor: built });
    // POST 只发生一次，且只用 scope 内的这一个 token 观察。
    expect(job.start).toHaveBeenCalledOnce();
    expect(job.start).toHaveBeenCalledWith('synthetic-key', session.token, built, 3, undefined);

    await vi.advanceTimersByTimeAsync(0);
    expect(session.progress).toEqual({ current: 0, total: 3, stopping: false });
    expect(listener.mock.calls.length).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.state).toBe('generating');
    expect(session.progress).toEqual({ current: 1, total: 3, stopping: false });
    expect(session.historyIds).toEqual(['h1']);
    expect(session.preview).toEqual({ image: 'data:image/png;base64,AQID', step: 4 });
    expect(session.lastSavedItem).toEqual(saved);
    expect(job.get).toHaveBeenCalledOnce();
    expect(job.get).toHaveBeenCalledWith('synthetic-key', session.token, undefined);

    unsubscribe();
    const publishedWhileSubscribed = listener.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settle).resolves.toMatchObject({
        success: true, historySaved: true, outcome: 'succeeded', requestedCount: 3, completedCount: 3, historyIds: ['h1', 'h2', 'h3'],
    });
    expect(listener.mock.calls.length).toBe(publishedWhileSubscribed);
    expect(job.start).toHaveBeenCalledOnce();
    expect(job.get).toHaveBeenCalledTimes(2);
    expect(getGenerationSeriesSession(scope)).toBeNull();
    expect(getQueuedGenerationSeries(scope)).toEqual([]);
});

it('当前任务在请求间隔等待时仍保留活动结果，不误归类为队尾等待任务', async () => {
    const scope = nextScope();
    const saved: LocalGenItem = { id: 'saved-during-interval', imageUrl: '/api/local-history/saved-during-interval/image', prompt: 'synthetic', params, createdAt: 1000 };
    job.start.mockResolvedValueOnce(snapshot({ state: 'waiting', position: 0, completedCount: 1, historyIds: [saved.id], lastSavedItem: saved }));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 3, agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    expect(getGenerationSeriesSession(scope)).toBe(session);
    expect(getQueuedGenerationSeries(scope)).toEqual([]);
    expect(session.lastSavedItem?.imageUrl).toBe(saved.imageUrl);
    expect(session.progress.current).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle;
});

it('同 scope 无位置时拒绝并发；有位置可排队，排队会话不算活动会话', async () => {
    const busyScope = nextScope();
    const queuedScope = nextScope();
    const built = descriptor();
    const first = beginGenerationSeries({ scope: busyScope, key: 'synthetic-key', count: 1, agent: false, descriptor: built });
    let failure: unknown = null;
    try { beginGenerationSeries({ scope: busyScope, key: 'synthetic-key', count: 1, agent: false, descriptor: built }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'generation_busy' });

    const next = beginGenerationSeries({ scope: busyScope, key: 'synthetic-key', count: 1, agent: false, placement: 'next', descriptor: built });
    expect(next.session.queued).toBe(true);
    expect(next.session.state).toBe('waiting');
    expect(getGenerationSeriesSession(busyScope)).toBe(first.session);
    expect(getQueuedGenerationSeries(busyScope)).toEqual([next.session]);

    const solo = beginGenerationSeries({ scope: queuedScope, key: 'synthetic-key', count: 1, agent: false, placement: 'end', descriptor: built });
    expect(getGenerationSeriesSession(queuedScope)).toBeNull();
    expect(getQueuedGenerationSeries(queuedScope)).toEqual([solo.session]);
    expect(job.start).toHaveBeenCalledWith('synthetic-key', solo.session.token, built, 1, 'end');

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    for (const result of await Promise.all([first.settle, next.settle, solo.settle])) {
        expect(result).toMatchObject({ success: true, outcome: 'succeeded', requestedCount: 1, completedCount: 1 });
    }
    expect(getGenerationSeriesSession(busyScope)).toBeNull();
    expect(getQueuedGenerationSeries(busyScope)).toEqual([]);
});

it('等待费用确认时暴露待确认信息，补充授权发 PATCH，停止发 DELETE 并保留已保存图片', async () => {
    const scope = nextScope();
    job.get
        .mockResolvedValueOnce(snapshot({ state: 'awaiting_confirmation', cost: 12, completedCount: 1, requestedCount: 3, historyIds: ['h1'] }))
        .mockResolvedValueOnce(snapshot({ state: 'cancelled', completedCount: 1, requestedCount: 3, historyIds: ['h1'] }));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 3, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.state).toBe('awaiting_confirmation');
    expect(session.awaiting).toEqual({ cost: 12, completedCount: 1, requestedCount: 3 });

    await approveGenerationSeries(session, 40);
    expect(job.approve).toHaveBeenCalledWith('synthetic-key', session.token, 40);

    stopGenerationSeriesSession(session);
    expect(session.stopped).toBe(true);
    expect(session.progress.stopping).toBe(true);
    expect(job.cancel).toHaveBeenCalledWith('synthetic-key', session.token);
    expect(callsFor(session.token)).toHaveLength(1);
    // 已停止的会话不会重复发送取消。
    stopGenerationSeriesSession(session);
    expect(callsFor(session.token)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(settle).resolves.toMatchObject({
        success: false, historySaved: false, outcome: 'cancelled', code: 'user_stopped',
        requestedCount: 3, completedCount: 1, historyIds: ['h1'],
    });
    expect(getGenerationSeriesSession(scope)).toBeNull();
});

it('旧后台返回HTML错误时回执简明，保留5/6图片，不重发生成或取消已失败任务', async () => {
    const scope = nextScope(), historyIds = ['h1', 'h2', 'h3', 'h4', 'h5'];
    job.start.mockResolvedValueOnce(snapshot({ state: 'failed', requestedCount: 6, completedCount: 5, historyIds, code: 'generation_failed', error: '<!DOCTYPE html><html><body>synthetic-ray</body></html>' }));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 6, agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await expect(settle).resolves.toMatchObject({ success: false, outcome: 'failed', code: 'generation_failed', completedCount: 5, requestedCount: 6, historyIds, error: '服务返回了错误页面，请稍后重试' });
    expect(session.historyIds).toEqual(historyIds); expect(job.start).toHaveBeenCalledOnce();
    expect(job.get).not.toHaveBeenCalled(); expect(job.cancel).not.toHaveBeenCalled(); expect(getGenerationSeriesSession(scope)).toBeNull();
});

it('后端失败终态保留错误码，忙碌归类为 blocked', async () => {
    const failedScope = nextScope();
    job.get.mockResolvedValue(snapshot({ state: 'failed', completedCount: 1, requestedCount: 2, historyIds: ['h1'], code: 'quota_exceeded', error: '额度不足' }));
    const failed = beginGenerationSeries({ scope: failedScope, key: 'synthetic-key', count: 2, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(failed.settle).resolves.toMatchObject({ success: false, outcome: 'failed', code: 'quota_exceeded', completedCount: 1, historyIds: ['h1'] });

    const busyScope = nextScope();
    job.get.mockResolvedValue(snapshot({ state: 'failed', completedCount: 0, requestedCount: 1, historyIds: [], code: 'generation_busy', error: '此 Key 正在生成' }));
    const busy = beginGenerationSeries({ scope: busyScope, key: 'synthetic-key', count: 1, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(busy.settle).resolves.toMatchObject({ success: false, outcome: 'blocked', code: 'generation_busy' });
});

it('页面卸载只对未终态会话发送 keepalive 取消，已终态会话不再取消', async () => {
    const doneScope = nextScope();
    const done = beginGenerationSeries({ scope: doneScope, key: 'synthetic-key', count: 1, agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await done.settle;
    expect(getGenerationSeriesSession(doneScope)).toBeNull();

    const liveScope = nextScope();
    const live = beginGenerationSeries({ scope: liveScope, key: 'synthetic-key', count: 1, agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    expect(getGenerationSeriesSession(liveScope)).toBe(live.session);

    window.dispatchEvent(new Event('pagehide'));
    expect(callsFor(live.session.token)).toEqual([['synthetic-key', live.session.token, { keepalive: true }]]);
    expect(callsFor(done.session.token)).toEqual([]);

    job.get.mockResolvedValue(snapshot({ state: 'cancelled', completedCount: 0, requestedCount: 1, historyIds: [] }));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(live.settle).resolves.toMatchObject({ outcome: 'cancelled', code: 'user_stopped' });
});

it('Key 变更后旧 Key 归属的会话被取消', async () => {
    const scope = nextScope();
    sessionStorage.setItem('nai_api_key', 'synthetic-key');
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 1, agent: false, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    sessionStorage.setItem('nai_api_key', 'synthetic-rotated');
    window.dispatchEvent(new Event('nai-api-key-changed'));
    expect(session.stopped).toBe(true);
    expect(job.cancel).toHaveBeenCalledWith('synthetic-key', session.token);
    expect(callsFor(session.token).every(call => call.length === 2)).toBe(true);

    job.get.mockResolvedValue(snapshot({ state: 'cancelled', completedCount: 0, requestedCount: 1, historyIds: [] }));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settle).resolves.toMatchObject({ outcome: 'cancelled', code: 'user_stopped' });
    expect(getGenerationSeriesSession(scope)).toBeNull();
});

it('临时观察失败只就地提示并保留归属，恢复后仍按后端终态回执', async () => {
    const scope = nextScope();
    job.get
        .mockRejectedValueOnce(new Error('网络不可达'))
        .mockRejectedValueOnce(new Error('网关 502'))
        .mockRejectedValueOnce(new Error('鉴权过期'));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 2, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    for (let attempt = 0; attempt < 3; attempt++) {
        await vi.advanceTimersByTimeAsync(1_000);
        expect(getGenerationSeriesSession(scope)).toBe(session);
    }
    expect(session.connectionError).toBeTruthy();
    expect(session.stopped).toBe(false);
    // 失联期间归属仍在：页面卸载照常送达 keepalive 取消。
    window.dispatchEvent(new Event('pagehide'));
    expect(callsFor(session.token)).toEqual([['synthetic-key', session.token, { keepalive: true }]]);

    job.get.mockResolvedValue(snapshot({ state: 'succeeded', completedCount: 2, historyIds: ['h1', 'h2'] }));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settle).resolves.toMatchObject({ success: true, outcome: 'succeeded', requestedCount: 2, completedCount: 2, historyIds: ['h1', 'h2'] });
    expect(session.connectionError).toBeUndefined();
    expect(getGenerationSeriesSession(scope)).toBeNull();
    expect(job.start).toHaveBeenCalledOnce();
    expect(job.get).toHaveBeenCalledTimes(4);
});

it('后端明确回答任务不存在才终结归属，回执取该 404 的 code', async () => {
    const scope = nextScope();
    job.get.mockRejectedValueOnce(Object.assign(new Error('生成任务不存在或已结束'), { status: 404, code: 'generation_task_expired' }));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 1, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settle).resolves.toMatchObject({ success: false, outcome: 'failed', code: 'generation_task_expired' });
    expect(session.connectionError).toBeUndefined();
    expect(getGenerationSeriesSession(scope)).toBeNull();
});

it('POST 回执丢失时用同一 token 核实，不重复提交也不新建任务', async () => {
    const scope = nextScope();
    job.start.mockRejectedValueOnce(new Error('提交响应丢失'));
    job.get
        .mockResolvedValueOnce(snapshot({ state: 'generating', completedCount: 1, historyIds: ['h1'] }))
        .mockResolvedValueOnce(snapshot({ state: 'succeeded', completedCount: 3, historyIds: ['h1', 'h2', 'h3'] }));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 3, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    expect(job.start).toHaveBeenCalledOnce();
    expect(job.get).toHaveBeenCalledOnce();
    expect(job.get).toHaveBeenCalledWith('synthetic-key', session.token);
    expect(session.connectionError).toBeUndefined();
    expect(session.state).toBe('generating');
    expect(session.progress).toEqual({ current: 1, total: 3, stopping: false });

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settle).resolves.toMatchObject({ success: true, outcome: 'succeeded', requestedCount: 3, completedCount: 3 });
    expect(job.start).toHaveBeenCalledOnce();
    expect(getGenerationSeriesSession(scope)).toBeNull();
});

it('POST 失败且核实发现任务不存在时，以原始提交错误回执', async () => {
    const scope = nextScope();
    job.start.mockRejectedValueOnce(Object.assign(new Error('提交时网关超时'), { code: 'generation_submit_failed' }));
    job.get.mockRejectedValueOnce(Object.assign(new Error('生成任务不存在或已结束'), { status: 404, code: 'generation_job_not_found' }));
    const { settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 1, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    await expect(settle).resolves.toMatchObject({ success: false, outcome: 'failed', code: 'generation_submit_failed', error: '提交时网关超时' });
    expect(getGenerationSeriesSession(scope)).toBeNull();
});

it('取消失败不静默当作已取消，保留取消中并就地说明', async () => {
    const scope = nextScope();
    job.cancel.mockRejectedValueOnce(new Error('取消请求超时'));
    const { session, settle } = beginGenerationSeries({ scope, key: 'synthetic-key', count: 1, agent: true, descriptor: descriptor() });
    await vi.advanceTimersByTimeAsync(0);
    stopGenerationSeriesSession(session);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.stopped).toBe(true);
    expect(session.progress.stopping).toBe(true);
    expect(session.connectionError).toBeTruthy();
    expect(getGenerationSeriesSession(scope)).toBe(session);

    job.get.mockResolvedValue(snapshot({ state: 'cancelled', completedCount: 1, requestedCount: 1, historyIds: ['h1'] }));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settle).resolves.toMatchObject({ outcome: 'cancelled', code: 'user_stopped', requestedCount: 1, completedCount: 1, historyIds: ['h1'] });
    expect(session.connectionError).toBeUndefined();
    expect(getGenerationSeriesSession(scope)).toBeNull();
});

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('拒绝无效张数 %s', count => {
    expect(() => beginGenerationSeries({ scope: nextScope(), key: 'synthetic-key', count, agent: false, descriptor: descriptor() })).toThrow('生成张数');
    expect(job.start).not.toHaveBeenCalled();
});
