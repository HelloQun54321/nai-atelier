import React, { useEffect, useState } from 'react';
import { cancelCloudQueueTask, CloudQueueStatus as QueueStatus } from '../services/cloudQueue';

const statusLabel = (status: QueueStatus) => {
  if (status.phase === 'preparing' || status.phase === 'joining') return '正在加入公共队列…';
  if (status.phase === 'waiting') return `排队中 · 前方 ${Math.max(0, Number(status.position) || 0)} 个任务`;
  if (status.phase === 'ready') return '轮到你了 · 即将开始';
  if (status.phase === 'generating') return '已获得队列许可 · 正在生成';
  if (status.phase === 'cancelled') return '已取消排队';
  if (status.phase === 'error') return status.error || '公共队列连接失败';
  return '生成完成';
};

export const CloudQueueStatus: React.FC = () => {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const handleStatus = (event: Event) => setStatus((event as CustomEvent<QueueStatus | null>).detail);
    window.addEventListener('nai-cloud-queue-status', handleStatus);
    return () => window.removeEventListener('nai-cloud-queue-status', handleStatus);
  }, []);

  if (!status) return null;
  const failed = status.phase === 'error';
  return <div className={`fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-[1180] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 rounded-2xl px-4 py-3 text-white shadow-xl md:bottom-5 md:left-auto md:right-5 md:w-80 md:translate-x-0 ${failed ? 'bg-red-600' : 'bg-gradient-to-r from-indigo-600 to-violet-600'}`}>
    <div className="flex items-center gap-3">
      {!['completed', 'cancelled', 'error'].includes(status.phase) && <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/90 border-t-transparent" />}
      <div className="min-w-0 flex-1"><p className="text-sm font-bold">{statusLabel(status)}</p>{status.greeting && <p className="mt-0.5 truncate text-xs text-white/70">当前使用者：{status.greeting}</p>}</div>
      {status.cancelable && <button type="button" disabled={cancelling} onClick={async () => { setCancelling(true); try { await cancelCloudQueueTask(status.taskId); } finally { setCancelling(false); } }} className="mobile-touch shrink-0 rounded-xl bg-white/15 px-3 text-xs font-bold text-white hover:bg-white/25">取消</button>}
    </div>
  </div>;
};
