import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { UserRound } from 'lucide-react';
import { ToolbarButton } from './DesignSystem';
import { AnchoredToolbarPopover } from './ToolbarPopover';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { MobileBottomSheet } from './MobileUI';
import { cancelCloudQueueTask, CloudQueueStatus as QueueStatus, getCachedCloudQueuePreferences, getCurrentCloudQueueStatus, isCloudQueueTaskActive, subscribeCloudQueuePreferences, subscribeCloudQueueStatus } from '../services/cloudQueue';
import { normalizeCloudQueueCount } from '../worker/cloudQueueNumbers.mjs';

type GenerationProgress = { step: number; total: number };

export const formatCloudQueueStatusLabel = (status: QueueStatus, progress?: GenerationProgress | null) => {
  if (status.phase === 'preparing') return t('准备生成…');
  if (status.phase === 'joining') return t('加入队列中…');
  if (status.phase === 'waiting') {
    if (status.proxy) return t('中转排队／生成中…');
    const ahead = normalizeCloudQueueCount(status.position);
    return ahead === null ? t('排队中 · 前方任务数未知') : t('排队中 · 前方 {0} 个任务', [ahead]);
  }
  if (status.phase === 'ready') return t('即将生成…');
  if (status.phase === 'generating') return progress ? t('生成中 {0}/{1}', [progress.step, progress.total]) : t('生成中…');
  if (status.phase === 'cancelled') return t(status.proxy ? '已停止等待' : '已取消排队');
  if (status.phase === 'error') return t(status.error || '公共队列连接失败');
  return t('生成完成');
};

export const formatCloudQueueCountLabel = (status: QueueStatus) => {
  if (status.proxy) return null;
  if (!['waiting', 'ready', 'generating'].includes(status.phase)) return null;
  const count = normalizeCloudQueueCount(status.queueSize);
  const prefix = status.phase === 'waiting' ? '队列共' : '最近队列数：';
  return count === null ? t("队列数量未知") : t("{0} {1} 个任务", [t(prefix), count]);
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

const getCloudQueueEnabled = () => getCachedCloudQueuePreferences().enabled;
export const useCloudQueueEnabled = () => useSyncExternalStore(subscribeCloudQueuePreferences, getCloudQueueEnabled, getCloudQueueEnabled);

const QueueStatusBody: React.FC<{ status: QueueStatus; compact?: boolean; generationProgress?: GenerationProgress | null }> = ({ status, compact = false, generationProgress }) => {
  useLanguage();
  const [cancelling, setCancelling] = useState(false);
  const active = isCloudQueueTaskActive(status);
  return <div className={`relative z-[1] flex w-full items-center justify-center ${compact ? 'min-h-8' : 'min-h-7'}`}>
      <div className={`flex w-full min-w-0 justify-center ${status.cancelable ? 'pl-2 pr-20' : 'px-2'}`}>
        <div className="flex min-w-0 max-w-full items-center justify-center gap-2">
          {active && <span aria-hidden="true" className="queue-status-spinner h-4 w-4 shrink-0 rounded-full border-2 border-white/90 border-t-transparent" />}
          <div className="min-w-0 text-center">
            <p className="truncate text-sm font-bold leading-5">{formatCloudQueueStatusLabel(status, generationProgress)}</p>
            {formatCloudQueueCountLabel(status) && <p className="mt-0.5 text-xs leading-4 text-white/90">{formatCloudQueueCountLabel(status)}</p>}
            {status.cleanupError && <p className="mt-0.5 text-xs leading-4 text-white/90">{t(status.cleanupError)}</p>}
            {!status.proxy && status.greeting && <p className="mt-0.5 truncate text-center text-xs leading-4 text-white/75">{t("当前使用者：{0}", [status.greeting])}</p>}
          </div>
          {active && <span aria-hidden="true" className="h-4 w-4 shrink-0" />}
        </div>
      </div>
      {status.cancelable && <button type="button" disabled={cancelling} onClick={async () => { setCancelling(true); try { await cancelCloudQueueTask(status.taskId); } finally { setCancelling(false); } }} className="appearance-group mobile-touch absolute right-0 inline-flex items-center justify-center rounded-xl bg-white/15 px-3 text-xs font-bold text-white ring-1 ring-white/15 transition-colors hover:bg-white/25 disabled:opacity-60">{cancelling ? t("取消中…") : status.proxy ? t("停止等待") : t("取消排队")}</button>}
  </div>;
};

export const InlineCloudQueueStatus: React.FC<{ compact?: boolean; className?: string; generationProgress?: GenerationProgress | null }> = ({ compact = false, className = '', generationProgress }) => {
  useLanguage();
  const status = useCloudQueueStatus();
  if (!status || (status.phase === 'completed' && !status.cleanupError)) return null;
  return <div role="status" className={`queue-status-surface relative ${statusTone(status)} ${compact ? 'min-h-12 rounded-full px-4 py-2' : 'min-h-12 rounded-lg px-4 py-3'} text-white shadow-lg ${className}`}><QueueStatusBody status={status} compact={compact} generationProgress={generationProgress} /></div>;
};

export const CloudQueueButton: React.FC<{ className?: string; generationProgress?: GenerationProgress | null }> = ({ className = '', generationProgress }) => {
  useLanguage();
  const status = useCloudQueueStatus();
  const [open, setOpen] = useState(false);
  const enabled = useCloudQueueEnabled();
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const anchorRef = useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  const visible = enabled && Boolean(status && (status.phase !== 'completed' || status.cleanupError));
  useEffect(() => { if (!visible) close(); }, [visible, close]);
  useEffect(() => {
    const resize = () => { const next = window.innerWidth < 768; if (next !== mobile) { setMobile(next); close(); } };
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, [mobile, close]);
  if (!visible || !status) return null;
  const hasCounts = !status.proxy && ['waiting', 'ready', 'generating'].includes(status.phase);
  const fraction = `${hasCounts ? normalizeCloudQueueCount(status.position) ?? '?' : '?'}/${hasCounts ? normalizeCloudQueueCount(status.queueSize) ?? '?' : '?'}`;
  const details = <InlineCloudQueueStatus generationProgress={generationProgress} />;
  return <div ref={anchorRef} className={`flex flex-none items-stretch ${className}`}>
    <ToolbarButton onClick={() => setOpen(value => !value)} aria-label={`${t("Key 排队")} ${fraction}`}
      aria-expanded={open} aria-haspopup="dialog" title={`${t("Key 排队")} · ${t("前方任务数／队列总数")}`}
      tone={status.cleanupError || status.phase === 'error' ? 'danger' : 'neutral'}
      className="mobile-touch !h-auto min-h-10 !gap-1.5 !px-2.5 !text-xs tabular-nums">
      <UserRound aria-hidden="true" className="h-3.5 w-3.5" /><span>{fraction}</span>
    </ToolbarButton>
    {open && (mobile ? <ImagePreviewPortal><MobileBottomSheet open title={t("Key 排队")} onClose={close}>{details}</MobileBottomSheet></ImagePreviewPortal>
      : <AnchoredToolbarPopover anchorRef={anchorRef} title={t("Key 排队")} above compact width={320} onClose={close}>{details}</AnchoredToolbarPopover>)}
  </div>;
};

export const CloudQueueStatus: React.FC<{ hidden?: boolean }> = ({ hidden = false }) => {
  useLanguage();
  const status = useCloudQueueStatus();
  if (!status || hidden || (status.phase === 'completed' && !status.cleanupError)) return null;
  return <div role="status" className={`queue-status-surface ${statusTone(status)} fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-[1180] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 rounded-2xl px-4 py-3 text-white shadow-xl md:bottom-5 md:left-auto md:right-5 md:w-80 md:translate-x-0`}><QueueStatusBody status={status} /></div>;
};
