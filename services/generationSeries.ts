import { agentGenerationFailure, agentOperationError, normalizeAgentGenerationResult, validateGenerationCount } from './agentOperation.mjs';
import { parseHttpError } from './httpErrors.mjs';
import type { LocalGenItem, PromptAgentGenerationResult } from '../types';
import {
    cancelGenerationJob, getGenerationJob, isGenerationJobState, isGenerationJobTerminal, observeGenerationJob, startGenerationJob, updateGenerationJobApproval,
    type GenerationJobDescriptor, type GenerationJobPreview, type GenerationJobSnapshot, type GenerationJobState,
} from './generationJob';
import type { GenerationPlacement } from './generationTask';
import { localHistory } from './localHistory';
import { NOVELAI_USAGE_REFRESH_EVENT } from './naiUsage';
import { emitCloudQueueStatus, getCurrentCloudQueueStatus, isCloudQueueTaskActive } from './cloudQueue';
import { setGenerationQueuePaused } from './generationTask';
import { recordUsageEvent } from './usageEvents';
import { createUuid } from './id';

export interface GenerationSeriesProgress { current: number; total: number; stopping: boolean; position?: number }

/** 可恢复会话的来源标记：Roll 串用它定位中断后剩余的候选。 */
export interface GenerationSeriesMeta { experimentId?: string; roundId?: string }

/** 已确认的有限后台任务的本地归属：只用于界面通知与归属，执行与保存由后端完成。 */
export interface GenerationSeriesSession {
    scope: string;
    key: string;
    token: string;
    count: number;
    steps: number;
    model?: string;
    operation?: string;
    agent: boolean;
    placement?: GenerationPlacement;
    progress: GenerationSeriesProgress;
    stopped: boolean;
    queued: boolean;
    state: GenerationJobState;
    historyIds: string[];
    lastSavedItem?: LocalGenItem;
    preview?: GenerationJobPreview;
    previewVersion?: number;
    awaiting?: { cost: number; completedCount: number; requestedCount: number };
    accountingFailed?: boolean;
    accountingError?: string;
    cleanupError?: string;
    cloudQueueTaskId?: string;
    /** 观察链路暂时不可用时的就地说明；恢复后清除，不代表任务失败。 */
    connectionError?: string;
    /** 刷新/重开页面后仍要保留的小框：关闭页面只暂停，恢复后继续或取消。 */
    resumable?: boolean;
    /** 可恢复会话的页面归属，供 Roll 串找回中断的轮次。 */
    meta?: GenerationSeriesMeta;
}

/** 后端任务已随服务重启结束、但本地还留着记录的中断会话。 */
export interface InterruptedGenerationSeries { token: string; scope: string; count: number; meta?: GenerationSeriesMeta }

interface PersistedSeries {
    scope: string;
    token: string;
    count: number;
    steps: number;
    model?: string;
    operation?: string;
    agent: boolean;
    meta?: GenerationSeriesMeta;
    state: 'running' | 'interrupted';
    startedAt: number;
}

interface SupervisedSeries { session: GenerationSeriesSession; wake: (() => void) | null }

// 已确认的后台任务由工坊后端托管：本页只保留归属与显示，关闭/刷新不丢任务，重新挂载继续观察。
// 第 1 个发起页之外不新建同 Key 任务，后端按 Key 指纹裁决所有入口。
const groups = new Map<string, SupervisedSeries[]>();
const listeners = new Set<() => void>();
const publish = () => { for (const listener of listeners) listener(); };

// 可恢复会话落本地：刷新/重开页面用它找回同一个后端任务；后端进程重启后则变成「中断」记录。
const RESUME_STORAGE_KEY = 'nai_generation_series_pending';
const RESUME_LIMIT = 24;
const storage = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
const readPersisted = (): PersistedSeries[] => {
    try {
        const parsed = JSON.parse(storage()?.getItem(RESUME_STORAGE_KEY) || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item): item is PersistedSeries => Boolean(item && typeof item === 'object'
            && typeof (item as PersistedSeries).scope === 'string' && typeof (item as PersistedSeries).token === 'string'
            && (item as PersistedSeries).token.length > 0 && ((item as PersistedSeries).state === 'running' || (item as PersistedSeries).state === 'interrupted')));
    } catch { return []; }
};
const writePersisted = (records: PersistedSeries[]) => {
    // 配额满或隐私模式写不进去时不能影响生成，只是失去下次恢复的能力。
    try { storage()?.setItem(RESUME_STORAGE_KEY, JSON.stringify(records.slice(-RESUME_LIMIT))); } catch { /* 忽略写入失败 */ }
};
const removePersisted = (token: string) => {
    const records = readPersisted(), next = records.filter(item => item.token !== token);
    if (next.length !== records.length) writePersisted(next);
};
const rememberPersisted = (session: GenerationSeriesSession) => {
    if (!session.resumable) return;
    writePersisted([...readPersisted().filter(item => item.token !== session.token), {
        scope: session.scope, token: session.token, count: session.count, steps: session.steps,
        ...(session.model ? { model: session.model } : {}), ...(session.operation ? { operation: session.operation } : {}),
        agent: session.agent, ...(session.meta ? { meta: session.meta } : {}), state: 'running', startedAt: Date.now(),
    }]);
};
const markPersistedInterrupted = (token: string) => {
    const records = readPersisted(), next = records.map(item => item.token === token ? { ...item, state: 'interrupted' as const } : item);
    if (records.some(item => item.token === token)) { writePersisted(next); publish(); }
};
/** 后端任务已不存在、但本地仍留着记录的中断会话；页面据此提供「继续生成剩余」。 */
export const listInterruptedGenerationSeries = (): InterruptedGenerationSeries[] => readPersisted()
    .filter(item => item.state === 'interrupted')
    .map(({ token, scope, count, meta }) => ({ token, scope, count, ...(meta ? { meta } : {}) }));
export const clearInterruptedGenerationSeries = (token: string) => { removePersisted(token); publish(); };

const handlePageHide = () => {
    for (const list of groups.values()) for (const { session } of list) {
        if (isGenerationJobTerminal(session.state)) continue;
        if (session.resumable) {
            // Roll 串这类可恢复会话：保留任务并把队列暂停，关页后不再继续扣费；重开页面恢复小框后由用户继续。
            rememberPersisted(session);
            void setGenerationQueuePaused(session.key, true, { keepalive: true }).catch(() => { /* 暂停未送达时后端仍会续跑完本轮，图片照样保存。 */ });
            continue;
        }
        // 其它一次性后台生成沿用原行为：关闭/刷新时 keepalive 取消，不做页面冻结即取消。
        void cancelGenerationJob(session.key, session.token, { keepalive: true }).catch(() => { /* 卸载后无 UI 可提示，后端任务自行收敛到终态。 */ });
    }
};

const checkKeys = () => {
    const key = sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '';
    for (const list of groups.values()) for (const { session } of list) if (session.key !== key) stopGenerationSeriesSession(session);
};

let watchersInstalled = false;
const installWatchers = () => {
    if (watchersInstalled || typeof window === 'undefined') return;
    watchersInstalled = true;
    window.addEventListener('nai-api-key-changed', () => { checkKeys(); void restoreGenerationSeriesSessions(); });
    window.addEventListener('storage', checkKeys);
    // 回到前台立即查询一次，不等被节流的长定时器；隐藏不等于取消。
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        for (const list of groups.values()) for (const entry of list) entry.wake?.();
    });
    window.addEventListener('pagehide', handlePageHide);
};

export const getGenerationSeriesSession = (scope: string) => (groups.get(scope) || []).find(entry => !entry.session.queued)?.session || null;
export const getQueuedGenerationSeries = (scope: string) => (groups.get(scope) || []).filter(entry => entry.session.queued).map(entry => entry.session);
/** 助手读取所有正在监督的生成会话；不返回 Key，只给状态与真实进度。 */
export const listGenerationSeriesSessions = () => [...groups].flatMap(([scope, entries]) => entries.map(entry => ({ scope, session: entry.session })));
export const subscribeGenerationSeries = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

const applySnapshot = (session: GenerationSeriesSession, snapshot: GenerationJobSnapshot) => {
    if (snapshot.cloudQueue) {
        session.cloudQueueTaskId = snapshot.cloudQueue.taskId;
        emitCloudQueueStatus(snapshot.cloudQueue, session.key);
    } else if (snapshot.cloudQueue === null && session.cloudQueueTaskId && getCurrentCloudQueueStatus()?.taskId === session.cloudQueueTaskId) {
        emitCloudQueueStatus(null, session.key);
    }
    session.state = isGenerationJobState(snapshot.state) ? snapshot.state : session.state;
    if (Array.isArray(snapshot.historyIds)) session.historyIds = snapshot.historyIds.filter(id => typeof id === 'string' && id.length > 0);
    const position = typeof snapshot.position === 'number' && Number.isSafeInteger(snapshot.position) && snapshot.position > 0 ? snapshot.position : undefined;
    session.progress = { current: snapshot.completedCount, total: snapshot.requestedCount, stopping: session.stopped, ...(position ? { position } : {}) };
    session.queued = Boolean(position);
    const preview = snapshot.preview;
    if (preview && typeof preview.image === 'string' && preview.image) session.preview = preview;
    else if (snapshot.previewVersion !== undefined && snapshot.previewVersion !== session.previewVersion) session.preview = undefined;
    session.previewVersion = snapshot.previewVersion;
    if (snapshot.lastSavedItem && snapshot.lastSavedItem.id !== session.lastSavedItem?.id) {
        session.lastSavedItem = snapshot.lastSavedItem;
        // 后端已把结果写入历史：只广播变更让各视图刷新，本页不重复入库。
        // 广播属于观察副作用，失败不能影响任务归属。
        try { localHistory.notifyBackgroundSaved(snapshot.lastSavedItem.id); } catch { /* 忽略广播失败 */ }
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NOVELAI_USAGE_REFRESH_EVENT));
    }
    session.awaiting = session.state === 'awaiting_confirmation'
        ? { cost: typeof snapshot.cost === 'number' ? snapshot.cost : 0, completedCount: snapshot.completedCount, requestedCount: snapshot.requestedCount }
        : undefined;
    session.accountingFailed = snapshot.accountingFailed === true;
    session.accountingError = session.accountingFailed && typeof snapshot.accountingError === 'string' ? snapshot.accountingError.slice(0, 240) : undefined;
    session.cleanupError = typeof snapshot.cleanupError === 'string' && snapshot.cleanupError ? snapshot.cleanupError : undefined;
    publish();
};

const settleSnapshot = (session: GenerationSeriesSession, snapshot: GenerationJobSnapshot): PromptAgentGenerationResult => {
    if (snapshot.state === 'succeeded') {
        return normalizeAgentGenerationResult({
            success: true, historySaved: true, outcome: 'succeeded',
            requestedCount: session.count, completedCount: session.historyIds.length, historyIds: session.historyIds,
        });
    }
    if (snapshot.state === 'cancelled') {
        return normalizeAgentGenerationResult({
            success: false, historySaved: false, outcome: 'cancelled', code: 'user_stopped',
            error: '已取消后续生成，已经提交的图片仍会保存',
            requestedCount: session.count, completedCount: session.historyIds.length, historyIds: session.historyIds,
        });
    }
    return normalizeAgentGenerationResult({
        success: false, historySaved: false, outcome: snapshot.code === 'generation_busy' ? 'blocked' : 'failed',
        code: snapshot.code, error: parseHttpError(snapshot.error || '', undefined, '后台生成失败').message,
        requestedCount: session.count, completedCount: session.historyIds.length, historyIds: session.historyIds,
    });
};

/** 后端已回答过的 HTTP 状态码；没有它说明请求根本没到达上游。 */
const httpStatus = (error: unknown): number | undefined => {
    if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
    const status = error.status;
    return typeof status === 'number' ? status : undefined;
};

/** 观察阶段只有后端明确回答任务不存在才算归属终结；临时网络、401、5xx 都继续观察。 */
const isJobGone = (error: unknown): boolean => httpStatus(error) === 404;

/** 提交阶段的 4xx 是后端明确拒绝（忙碌／参数／鉴权），任务没有建立，不需要再核实。 */
const isDefinitiveSubmitFailure = (error: unknown): boolean => {
    const status = httpStatus(error);
    return status !== undefined && status >= 400 && status < 500;
};

const describeError = (error: unknown, fallback: string) => parseHttpError(error instanceof Error ? error.message : '', httpStatus(error), fallback).message;

const finishGenerationSeries = (session: GenerationSeriesSession) => {
    const list = groups.get(session.scope);
    if (!list) return;
    const rest = list.filter(entry => entry.session !== session);
    if (rest.length) groups.set(session.scope, rest); else groups.delete(session.scope);
    publish();
};

const failureReceipt = (session: GenerationSeriesSession, error: unknown): PromptAgentGenerationResult => ({
    ...agentGenerationFailure(error), requestedCount: session.count, completedCount: session.historyIds.length, historyIds: session.historyIds,
});

/** 结束本地归属并交出本请求的独立回执。 */
const settleSeries = (entry: SupervisedSeries, result: PromptAgentGenerationResult) => {
    entry.wake = null;
    if (!result.success) {
        // 失败/取消不会进入历史；只写轻量事件，供足迹页统计，不记录 Prompt。
        recordUsageEvent({
            category: 'generation',
            action: result.outcome || 'failed',
            target: entry.session.scope,
            amount: result.requestedCount,
            meta: {
                agent: entry.session.agent,
                model: entry.session.model,
                operation: entry.session.operation,
            },
        });
    }
    const queue = getCurrentCloudQueueStatus();
    if (queue && queue.taskId === entry.session.cloudQueueTaskId && isCloudQueueTaskActive(queue)) {
        emitCloudQueueStatus({ ...queue, phase: result.success ? 'completed' : result.outcome === 'cancelled' ? 'cancelled' : 'error',
            cancelable: false, error: result.success ? undefined : result.error }, entry.session.key);
    }
    finishGenerationSeries(entry.session);
    removePersisted(entry.session.token);
    return result;
};

/**
 * 只读观察直到终态：等待费用确认时放慢节奏，页面冻结也不会替用户确认。
 * 临时观察失败不结束归属（返回前台立即补查），只有后端明确回答任务不存在才终结。
 * 恢复模式从既有快照继续观察，绝不重新 POST 生图。
 */
const supervise = async (entry: SupervisedSeries, descriptor: GenerationJobDescriptor | undefined, restored?: GenerationJobSnapshot): Promise<PromptAgentGenerationResult> => {
    const { session } = entry;
    let snapshot: GenerationJobSnapshot | null = restored || null;
    if (!snapshot) {
        try {
            snapshot = await startGenerationJob(session.key, session.token, descriptor!, session.count, session.placement);
        } catch (error) {
            // 后端明确拒绝（忙碌／参数／鉴权）说明任务没有建立，直接按该回执收尾。
            if (isDefinitiveSubmitFailure(error)) return settleSeries(entry, failureReceipt(session, error));
            // POST 超时或响应丢失时任务可能已经建立：用同一 token 核实，绝不另发新任务。
            try { snapshot = await getGenerationJob(session.key, session.token); }
            catch (confirmError) {
                if (isJobGone(confirmError)) return settleSeries(entry, failureReceipt(session, error));
                session.connectionError = `暂时无法确认后台任务状态：${describeError(confirmError, '连接失败')}`;
                publish();
            }
        }
    }
    for (;;) {
        if (snapshot) {
            applySnapshot(session, snapshot);
            if (isGenerationJobTerminal(snapshot.state)) return settleSeries(entry, settleSnapshot(session, snapshot));
        }
        // 过程图开关只控制上游预览；保存、排队和终态始终实时观察。
        {
            const controller = new AbortController();
            entry.wake = () => controller.abort();
            try {
                await observeGenerationJob(session.key, session.token, controller.signal, next => {
                    snapshot = next;
                    session.connectionError = undefined;
                    applySnapshot(session, next);
                }, session.previewVersion);
                if (snapshot && isGenerationJobTerminal(snapshot.state)) return settleSeries(entry, settleSnapshot(session, snapshot));
            } catch (error) {
                if (isJobGone(error)) return settleSeries(entry, failureReceipt(session, error));
                if (!controller.signal.aborted) {
                    session.connectionError = `暂时无法读取后台任务状态：${describeError(error, '连接失败')}`;
                    publish();
                }
            } finally { entry.wake = null; }
            // 回到前台主动重连时立即补查，避免冻结连接或旧定时器拖住显示。
            if (controller.signal.aborted) {
                try { snapshot = await getGenerationJob(session.key, session.token, session.previewVersion); }
                catch (error) { if (isJobGone(error)) return settleSeries(entry, failureReceipt(session, error)); }
                continue;
            }
        }
        await new Promise<void>(resolve => {
            let settled = false;
            const wake = () => { if (settled) return; settled = true; clearTimeout(timer); entry.wake = null; resolve(); };
            const timer = setTimeout(wake, session.state === 'awaiting_confirmation' ? 2_000 : 1_000);
            entry.wake = wake;
        });
        try {
            snapshot = await getGenerationJob(session.key, session.token, session.previewVersion);
            if (session.connectionError) { session.connectionError = undefined; publish(); }
        } catch (error) {
            if (isJobGone(error)) return settleSeries(entry, failureReceipt(session, error));
            // 临时网络/鉴权/服务错误不能当作任务失败：保留归属，继续只读观察。
            session.connectionError = `暂时无法读取后台任务状态：${describeError(error, '连接失败')}`;
            publish();
        }
    }
};

/**
 * 提交一次有限后台任务：POST 一次后只观察后端状态；同一 scope 无位置时拒绝并发。
 * 返回的 settle 是该请求独立的结果回执，不与其他任务共享。
 */
export const beginGenerationSeries = (options: {
    scope: string;
    key: string;
    count: number;
    agent: boolean;
    placement?: GenerationPlacement;
    descriptor: GenerationJobDescriptor;
    /** 刷新/重开页面后仍保留小框（Roll 串）；关闭页面只会暂停，不会取消。 */
    resumable?: boolean;
    meta?: GenerationSeriesMeta;
}): { session: GenerationSeriesSession; settle: Promise<PromptAgentGenerationResult> } => {
    validateGenerationCount(options.count);
    const key = options.key.trim();
    if (!key) throw agentOperationError('请先配置 NovelAI API Key', 'missing_key');
    if (!options.placement && (groups.get(options.scope) || []).length > 0) throw agentOperationError('已有图片正在生成，请等待完成', 'generation_busy');
    const session: GenerationSeriesSession = {
        scope: options.scope, key, token: createUuid(), count: options.count, steps: options.descriptor.history.params.steps ?? 0,
        model: options.descriptor.history.params.model, operation: options.descriptor.history.edit?.operation || 'text-to-image',
        agent: options.agent,
        ...(options.placement ? { placement: options.placement } : {}),
        ...(options.resumable ? { resumable: true } : {}),
        ...(options.meta ? { meta: options.meta } : {}),
        progress: { current: 0, total: options.count, stopping: false }, stopped: false,
        queued: Boolean(options.placement), state: options.placement ? 'waiting' : 'preparing', historyIds: [],
    };
    const entry: SupervisedSeries = { session, wake: null };
    groups.set(options.scope, [...(groups.get(options.scope) || []), entry]);
    rememberPersisted(session);
    installWatchers();
    publish();
    return { session, settle: supervise(entry, options.descriptor) };
};

/** 取消只停止后续图片；已提交的产物仍由后端保存并进入终态。 */
export const stopGenerationSeriesSession = (session: GenerationSeriesSession) => {
    if (session.stopped) return;
    session.stopped = true;
    session.progress = { ...session.progress, stopping: true };
    // 用户明确取消就不再是「可恢复」：记录先清掉，避免下次打开页面又出现小框。
    removePersisted(session.token);
    publish();
    if (isGenerationJobTerminal(session.state)) return;
    void cancelGenerationJob(session.key, session.token).catch(error => {
        // 已被同 Key 的其他入口取消或租约已过期时，不再叠加“取消未送达”的假告警。
        const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : '';
        if (code === 'generation_cancelled' || code === 'generation_task_expired') return;
        // 取消未送达不能当作已取消：保留「取消中」，由状态核实给出最终回执。
        session.connectionError = `取消请求未送达：${describeError(error, '连接失败')}`;
        publish();
    });
};

/**
 * 重新打开页面时接回可恢复会话：只 GET 既有任务，不重新提交、不重复计费。
 * 任务仍在（服务未重启）→ 重建归属继续观察；后端回答 404 → 记为中断，由页面提供「继续生成剩余」。
 */
let restoreTask: Promise<void> | null = null;
export const restoreGenerationSeriesSessions = (): Promise<void> => {
    if (restoreTask) return restoreTask;
    restoreTask = (async () => {
        const records = readPersisted().filter(item => item.state === 'running');
        if (!records.length) return;
        const key = (sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '').trim();
        if (!key) return;
        for (const record of records) {
            if ((groups.get(record.scope) || []).some(entry => entry.session.token === record.token)) continue;
            let snapshot: GenerationJobSnapshot;
            try { snapshot = await getGenerationJob(key, record.token); }
            catch (error) {
                // 404 是后端明确回答任务已不存在（服务重启或已过期），转成中断记录；其它错误保留，下次再试。
                if (isJobGone(error)) markPersistedInterrupted(record.token);
                continue;
            }
            const session: GenerationSeriesSession = {
                scope: record.scope, key, token: record.token, count: record.count, steps: record.steps,
                ...(record.model ? { model: record.model } : {}), ...(record.operation ? { operation: record.operation } : {}),
                agent: record.agent, progress: { current: 0, total: record.count, stopping: false }, stopped: false, queued: false,
                state: isGenerationJobState(snapshot.state) ? snapshot.state : 'waiting', historyIds: [],
                resumable: true, ...(record.meta ? { meta: record.meta } : {}),
            };
            const entry: SupervisedSeries = { session, wake: null };
            groups.set(record.scope, [...(groups.get(record.scope) || []), entry]);
            applySnapshot(session, snapshot);
            publish();
            void supervise(entry, undefined, snapshot);
        }
    })().finally(() => { restoreTask = null; });
    return restoreTask;
};

/** 费用上涨后由用户显式补充授权；未确认的后端任务保持停止。 */
export const approveGenerationSeries = async (session: GenerationSeriesSession, approvedCost: number) => {
    await updateGenerationJobApproval(session.key, session.token, approvedCost);
};
