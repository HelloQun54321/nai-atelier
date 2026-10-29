export const DEFAULT_GENERATION_INTERVAL_SECONDS: number;
export const MAX_GENERATION_INTERVAL_SECONDS: number;
export function validateGenerationInterval(seconds: number): number;
/** 执行位真实阶段：idle 空闲、preparing 请求前准备、generating 上游生成中、saving 已收图等待保存确认。 */
export type GenerationTaskPhase = 'idle' | 'preparing' | 'generating' | 'saving';
export interface GenerationTaskLease { token: string; count: number; completed: number; phase: GenerationTaskPhase; inFlight: boolean; releasing: boolean; cancelled: boolean; managed: boolean; expiresAt: number }
export interface GenerationQueueSnapshot { intervalSeconds?: number; busy: boolean; completed: number; total: number; paused: boolean; pausing: boolean; waiting: { token: string; total: number; completed: number; position: number }[] }
export interface GenerationCancelResult { cancelled: true; position: 0; paused: boolean }
export class GenerationTasks {
  constructor(options?: { now?: () => number; idleMs?: number; intervalSeconds?: number; cancelTtlMs?: number });
  readonly size: number;
  current(key: string): GenerationTaskLease | undefined;
  /** 当前执行位的租约令牌；没有当前任务时返回空字符串。 */
  currentToken(key: string): string;
  snapshot(key: string): GenerationQueueSnapshot;
  setInterval(key: string, seconds: number): GenerationQueueSnapshot;
  waitMs(key: string): number;
  pause(key: string, paused: boolean): GenerationQueueSnapshot;
  reserve(key: string, token: string, count?: number, queued?: boolean): GenerationTaskLease;
  enqueue(key: string, token: string, placement: 'end' | 'next', count?: number): { position: number; paused: boolean };
  status(key: string, token: string): { position: number; paused: boolean; waitMs?: number };
  owned(key: string, token: string): GenerationTaskLease;
  /** 标记后台托管：无浏览器心跳也不被清理。 */
  manage(key: string, token: string): GenerationTaskLease;
  /** 明确取消：在途/待保存不提前放行；未知 token 抛过期且不建立墓碑。 */
  cancel(key: string, token: string): GenerationCancelResult;
  /** 取消当前执行位与全部等待项，并返回取消数及队列快照。 */
  cancelAll(key: string): { cancelled: number } & GenerationQueueSnapshot;
  renew(key: string, token: string, completed?: number, prepare?: boolean): { position: number; paused: boolean; waitMs?: number };
  release(key: string, token: string): void;
  enter(key: string, token?: string): () => void;
}
