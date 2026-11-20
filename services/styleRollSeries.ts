import { ROLL_EXPERIMENT_MAX_CHARS, type RollExperiment } from './styleRoll';

/**
 * 连续 Roll：用户明确授权后由页面在本次会话内逐轮推进。
 * 只在页面打开期间运行，任何失败、取消、拒绝费用或记录将满都立即停下，不重试、不跨刷新续跑。
 */
export type RollSeriesStopReason = 'user_stop' | 'max_rounds' | 'opus_limit' | 'points_limit' | 'no_progress' | 'error' | 'cancelled' | 'declined' | 'record_full' | 'record_changed' | 'page_closed';

export const ROLL_SERIES_STOP_LABELS: Record<RollSeriesStopReason, string> = {
  user_stop: '已手动停止',
  max_rounds: '已达到轮数上限',
  opus_limit: 'Opus 额度已降到设定值',
  points_limit: '点数已降到设定值',
  no_progress: '长时间没有完成任何一轮',
  error: '本轮失败',
  cancelled: '本轮生成已取消',
  declined: '未确认本轮费用',
  record_full: '当前画风记录容量将满，请新建记录后再继续',
  record_changed: '已切换到其他画风记录',
  page_closed: 'Roll 页面已关闭',
};

export interface RollSeriesState {
  running: boolean;
  /** 每次启动递增，迟到的上一轮结果不能记到新一次连续 Roll 上。 */
  runId: number;
  experimentId: string;
  rounds: number;
  maxRounds: number;
  stopAtPercent: number;
  stopAtPoints: number;
  skipConfirmation: boolean;
  stopReason: RollSeriesStopReason | '';
  lastError: string;
  startedAt: number;
  stoppedAt: number;
  lastRoundAt: number;
  lastProgressAt: number;
  /** 正在抽取或等待本批出图；期间不发起下一轮，也不按无进展停止。 */
  inFlight: boolean;
}

export const ROLL_SERIES_ROUND_GAP_MS = 6000;
export const ROLL_SERIES_NO_PROGRESS_MS = 10 * 60 * 1000;
const STORAGE_KEY = 'nai-roll-series-last';

const idleState = (): RollSeriesState => ({
  running: false, runId: 0, experimentId: '', rounds: 0, maxRounds: 500, stopAtPercent: 5, stopAtPoints: 0, skipConfirmation: false,
  stopReason: '', lastError: '', startedAt: 0, stoppedAt: 0, lastRoundAt: 0, lastProgressAt: 0, inFlight: false,
});

/** 刷新后只读回上一次的停止结果供助手核对，不恢复运行。 */
function readLastStop(): RollSeriesState {
  const state = idleState();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return state;
    const value = JSON.parse(raw) as Partial<RollSeriesState>;
    const reason = typeof value.stopReason === 'string' && value.stopReason in ROLL_SERIES_STOP_LABELS ? value.stopReason as RollSeriesStopReason : '';
    return { ...state, experimentId: String(value.experimentId || ''), rounds: Math.max(0, Number(value.rounds) || 0), maxRounds: Math.max(1, Number(value.maxRounds) || 500),
      stopReason: reason, lastError: String(value.lastError || ''), startedAt: Number(value.startedAt) || 0, stoppedAt: Number(value.stoppedAt) || 0 };
  } catch { return state; }
}

let store: RollSeriesState | null = null;
/** 同一页面会话共用一份可变状态：组件重建后仍能读到运行或停止情况。 */
export const getRollSeries = (): RollSeriesState => (store ??= readLastStop());

export function startRollSeries(options: { experimentId: string; maxRounds: number; stopAtPercent: number; stopAtPoints: number; skipConfirmation?: boolean }, now = Date.now()): RollSeriesState {
  const state = getRollSeries();
  Object.assign(state, idleState(), {
    running: true, runId: state.runId + 1, experimentId: options.experimentId,
    maxRounds: options.maxRounds, stopAtPercent: options.stopAtPercent, stopAtPoints: options.stopAtPoints, skipConfirmation: options.skipConfirmation === true,
    startedAt: now, lastProgressAt: now,
  });
  return state;
}

/** 只停止正在运行的连续 Roll；返回是否真的停下了，避免重复提示。 */
export function stopRollSeries(reason: RollSeriesStopReason, error = '', now = Date.now()): boolean {
  const state = getRollSeries();
  if (!state.running) return false;
  Object.assign(state, { running: false, stopReason: reason, lastError: error, stoppedAt: now });
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ experimentId: state.experimentId, rounds: state.rounds, maxRounds: state.maxRounds, stopReason: reason, lastError: error, startedAt: state.startedAt, stoppedAt: now }));
  } catch { /* 停止结果不可写时仍以内存状态为准。 */ }
  return true;
}

export type RollSeriesStep = { action: 'wait' } | { action: 'run' } | { action: 'stop'; reason: RollSeriesStopReason };

/** 每次计时检查决定等待、发起下一轮还是停止；额度未知不当作已达标。 */
export function nextRollSeriesStep(state: RollSeriesState, signals: { busy: boolean; experimentId: string; opusPercent: number | null; points: number | null }, now = Date.now()): RollSeriesStep {
  if (!state.running || state.inFlight) return { action: 'wait' };
  if (signals.experimentId !== state.experimentId) return { action: 'stop', reason: 'record_changed' };
  if (state.rounds >= state.maxRounds) return { action: 'stop', reason: 'max_rounds' };
  if (signals.opusPercent !== null && signals.opusPercent <= state.stopAtPercent) return { action: 'stop', reason: 'opus_limit' };
  if (signals.points !== null && signals.points <= state.stopAtPoints) return { action: 'stop', reason: 'points_limit' };
  if (now - state.lastProgressAt > ROLL_SERIES_NO_PROGRESS_MS) return { action: 'stop', reason: 'no_progress' };
  if (signals.busy || now - state.lastRoundAt < ROLL_SERIES_ROUND_GAP_MS) return { action: 'wait' };
  return { action: 'run' };
}

/**
 * 记录整块存在一行里，逼近上限后保存会失败。按最近候选的实际体积估算再加一轮是否越界，
 * 留出余量提前停下，不让无人值守的连续 Roll 撞上限后每轮报错。
 */
export function rollSeriesWouldOverflow(experiment: RollExperiment, count: number, limit = ROLL_EXPERIMENT_MAX_CHARS): boolean {
  const recent = experiment.candidates.slice(-20);
  const perCandidate = recent.length ? Math.ceil(recent.reduce((sum, candidate) => sum + JSON.stringify(candidate).length, 0) / recent.length) + 48 : 600;
  return JSON.stringify(experiment).length + perCandidate * count + 512 > limit * 0.95;
}
