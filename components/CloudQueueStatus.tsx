import React, { useState, useSyncExternalStore } from 'react';
import { cancelCloudQueueTask, CloudQueueStatus as QueueStatus, getCurrentCloudQueueStatus, subscribeCloudQueueStatus } from '../services/cloudQueue';

const statusLabel = (status: QueueStatus) => {
  if (status.phase === 'preparing' || status.phase === 'joining') return '正在加入公共队列…';
  if (status.phase === 'waiting') {
    const ahead = Math.max(0, Number(status.position) || 0);
    const queueSize = Math.max(0, Number(status.queueSize) || 0);
    return `排队中 · 前方 ${ahead} 个任务${queueSize ? ` · 队列共 ${queueSize} 个任务` : ''}`;
  }
  if (status.phase === 'ready') return '轮到你了 · 即将开始';
  if (status.phase === 'generating') return '已获得队列许可 · 正在生成';
  if (status.phase === 'cancelled') return '已取消排队';
  if (status.phase === 'error') return status.error || '公共队列连接失败';
  return '生成完成';
};

const statusTone = (status: QueueStatus) => {
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

const QueueStatusBody: React.FC<{ status: QueueStatus; compact?: boolean }> = ({ status, compact = false }) => {
  const [cancelling, setCancelling] = useState(false);
  const active = !['completed', 'cancelled', 'error'].includes(status.phase);
  return <div className={`relative z-[1] flex w-full items-center justify-center ${compact ? 'min-h-8' : 'min-h-7'}`}>
      <div className={`flex w-full min-w-0 justify-center ${status.cancelable ? 'px-12' : 'px-2'}`}>
        <div className="flex min-w-0 max-w-full items-center justify-center gap-2">
          {active && <span aria-hidden="true" className="queue-status-spinner h-4 w-4 shrink-0 rounded-full border-2 border-white/90 border-t-transparent" />}
          <div className="min-w-0 text-center">
            <p className="truncate text-sm font-bold leading-5">{statusLabel(status)}</p>
            {status.greeting && <p className="mt-0.5 truncate text-center text-xs leading-4 text-white/75">当前使用者：{status.greeting}</p>}
          </div>
          {active && <span aria-hidden="true" className="h-4 w-4 shrink-0" />}
        </div>
      </div>
      {status.cancelable && <button type="button" disabled={cancelling} onClick={async () => { setCancelling(true); try { await cancelCloudQueueTask(status.taskId); } finally { setCancelling(false); } }} className="mobile-touch absolute right-0 inline-flex items-center justify-center rounded-xl bg-white/15 px-3 text-xs font-bold text-white ring-1 ring-white/15 transition-colors hover:bg-white/25 disabled:opacity-60">取消</button>}
  </div>;
};

export const InlineCloudQueueStatus: React.FC<{ compact?: boolean; className?: string }> = ({ compact = false, className = '' }) => {
  const status = useCloudQueueStatus();
  if (!status) return null;
  return <div role="status" className={`queue-status-surface relative ${statusTone(status)} ${compact ? 'min-h-12 rounded-full px-4 py-2' : 'min-h-12 rounded-lg px-4 py-3'} text-white shadow-lg ${className}`}><QueueStatusBody status={status} compact={compact} /></div>;
};

export const CloudQueueStatus: React.FC<{ hidden?: boolean }> = ({ hidden = false }) => {
  const status = useCloudQueueStatus();
  if (!status || hidden) return null;
  return <div role="status" className={`queue-status-surface ${statusTone(status)} fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-[1180] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 rounded-2xl px-4 py-3 text-white shadow-xl md:bottom-5 md:left-auto md:right-5 md:w-80 md:translate-x-0`}><QueueStatusBody status={status} /></div>;
};
