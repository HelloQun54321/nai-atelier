import React, { useState, useSyncExternalStore } from 'react';
import { cancelCloudQueueTask, CloudQueueStatus as QueueStatus, getCurrentCloudQueueStatus, isCloudQueueTaskActive, subscribeCloudQueueStatus } from '../services/cloudQueue';
import { normalizeCloudQueueCount } from '../worker/cloudQueueNumbers.mjs';

type GenerationProgress = { step: number; total: number };

const statusLabel = (status: QueueStatus, progress?: GenerationProgress | null) => {
  if (status.phase === 'preparing') return '准备生成…';
  if (status.phase === 'joining') return '加入队列中…';
  if (status.phase === 'waiting') {
    const ahead = normalizeCloudQueueCount(status.position);
    return ahead === null ? '排队中 · 前方任务数未知' : `排队中 · 前方 ${ahead} 个任务`;
  }
  if (status.phase === 'ready') return '即将生成…';
  if (status.phase === 'generating') return progress ? `生成中 ${progress.step}/${progress.total}` : '生成中…';
  if (status.phase === 'cancelled') return '已取消排队';
  if (status.phase === 'error') return status.error || '公共队列连接失败';
  return '生成完成';
};

const queueCountLabel = (status: QueueStatus) => {
  if (!['waiting', 'ready', 'generating'].includes(status.phase)) return null;
  const count = normalizeCloudQueueCount(status.queueSize);
  const prefix = status.phase === 'waiting' ? '队列共' : '最近队列数：';
  return count === null ? '队列数量未知' : `${prefix} ${count} 个任务`;
};

const statusTone = (status: QueueStatus) => {
  if (status.cleanupError) return 'queue-status-surface--failure';
  if (status.phase === 'completed') return 'queue-status-surface--success';
  if (status.phase === 'error') return 'queue-status-surface--failure';
  if (status.phase !== 'cancelled') return 'queue-status-surface--active';
  return 'queue-status-surface--normal';
};

export const useCloudQueueStatus = () => useSyncExternalStore(
  subscribeCloudQueueStatus,
  getCurrentCloudQueueStatus,
  getCurrentCloudQueueStatus,
);

const QueueStatusBody: React.FC<{ status: QueueStatus; compact?: boolean; generationProgress?: GenerationProgress | null }> = ({ status, compact = false, generationProgress }) => {
  const [cancelling, setCancelling] = useState(false);
  const active = isCloudQueueTaskActive(status);
  return <div className={`relative z-[1] flex w-full items-center justify-center ${compact ? 'min-h-8' : 'min-h-7'}`}>
      <div className={`flex w-full min-w-0 justify-center ${status.cancelable ? 'pl-2 pr-20' : 'px-2'}`}>
        <div className="flex min-w-0 max-w-full items-center justify-center gap-2">
          {active && <span aria-hidden="true" className="queue-status-spinner h-4 w-4 shrink-0 rounded-full border-2 border-white/90 border-t-transparent" />}
          <div className="min-w-0 text-center">
            <p className="truncate text-sm font-bold leading-5">{statusLabel(status, generationProgress)}</p>
            {queueCountLabel(status) && <p className="mt-0.5 text-xs leading-4 text-white/90">{queueCountLabel(status)}</p>}
            {status.cleanupError && <p className="mt-0.5 text-xs leading-4 text-white/90">{status.cleanupError}</p>}
            {status.greeting && <p className="mt-0.5 truncate text-center text-xs leading-4 text-white/75">当前使用者：{status.greeting}</p>}
          </div>
          {active && <span aria-hidden="true" className="h-4 w-4 shrink-0" />}
        </div>
      </div>
      {status.cancelable && <button type="button" disabled={cancelling} onClick={async () => { setCancelling(true); try { await cancelCloudQueueTask(status.taskId); } finally { setCancelling(false); } }} className="mobile-touch absolute right-0 inline-flex items-center justify-center rounded-xl bg-white/15 px-3 text-xs font-bold text-white ring-1 ring-white/15 transition-colors hover:bg-white/25 disabled:opacity-60">{cancelling ? '取消中…' : '取消排队'}</button>}
  </div>;
};

export const InlineCloudQueueStatus: React.FC<{ compact?: boolean; className?: string; generationProgress?: GenerationProgress | null }> = ({ compact = false, className = '', generationProgress }) => {
  const status = useCloudQueueStatus();
  if (!status || (status.phase === 'completed' && !status.cleanupError)) return null;
  return <div role="status" className={`queue-status-surface relative ${statusTone(status)} ${compact ? 'min-h-12 rounded-full px-4 py-2' : 'min-h-12 rounded-lg px-4 py-3'} text-white shadow-lg ${className}`}><QueueStatusBody status={status} compact={compact} generationProgress={generationProgress} /></div>;
};

export const CloudQueueStatus: React.FC<{ hidden?: boolean }> = ({ hidden = false }) => {
  const status = useCloudQueueStatus();
  if (!status || hidden || (status.phase === 'completed' && !status.cleanupError)) return null;
  return <div role="status" className={`queue-status-surface ${statusTone(status)} fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-[1180] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 rounded-2xl px-4 py-3 text-white shadow-xl md:bottom-5 md:left-auto md:right-5 md:w-80 md:translate-x-0`}><QueueStatusBody status={status} /></div>;
};
