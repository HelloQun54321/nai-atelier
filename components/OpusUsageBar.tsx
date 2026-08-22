import React from 'react';
import { clampUsagePercent, usageRemainingImages, useNovelaiUsage } from '../services/naiUsage';
import { useNaiRuntime, isNaiRuntimeSyncUnhealthy, describeNaiRuntimeSyncProblem } from '../services/naiRuntime';

interface OpusUsageBarProps {
  collapsed: boolean;
}

const OPUS_RING_CIRCUMFERENCE = 2 * Math.PI * 16;

/**
 * NovelAI Opus 免费生成限额（V5 起生效），展示在侧栏 Anlas 预算下方。
 * 非 Opus 订阅或未配置 API Key 时不渲染，与官方“仅 Opus 显示用量条”一致。
 */
export const OpusUsageBar: React.FC<OpusUsageBarProps> = ({ collapsed }) => {
  const { usage, loading, refresh } = useNovelaiUsage();
  const runtime = useNaiRuntime();
  if (!usage) {
    // 首次加载且可能存在数据时占位，避免侧栏高度跳动；确认无数据则完全不渲染。
    if (loading) return <div className="h-14 w-full" aria-hidden="true" />;
    return null;
  }
  const percent = clampUsagePercent(usage);
  const images = usageRemainingImages(usage, runtime.imagesPerPercent);
  const negative = usage.isNegative;
  const low = !negative && percent <= 20;
  const ringClass = negative
    ? 'text-red-500 dark:text-red-400'
    : low
      ? 'text-amber-500 dark:text-amber-400'
      : 'text-emerald-500 dark:text-emerald-400';
  // 同步健康度：提取失效或超过 48 小时未更新时，用琥珀色圆点显式示警，
  // 避免「项目能跑但常量早已过期」的静默失效。
  const health = runtime.health;
  const syncPending = health?.reason === 'pending';
  const syncBroken = isNaiRuntimeSyncUnhealthy(runtime);
  const syncSummary = syncPending
    ? '官方常量同步进行中，稍后自动重试'
    : syncBroken
    ? `⚠ ${describeNaiRuntimeSyncProblem(runtime)}：张数换算与费用估算可能过期，请检查电脑网络，或让 AI 运行 npm run test:live-sync 排查`
    : health?.missed?.length
      ? `常量同步部分失效：未命中 ${health.missed.join('、')}（${runtime.syncedAt ? new Date(runtime.syncedAt).toLocaleString() : ''} 同步）`
      : `常量同步正常（${runtime.syncedAt ? new Date(runtime.syncedAt).toLocaleString() : '等待首次同步'}）`;
  const title = `${negative
    ? 'Opus 限额已用尽：所有生图将消耗 Anlas，额度恢复后自动回到免费生成'
    : `Opus 免费生成限额：剩余 ${percent}%（约 ${images} 张）`} · 仅 V5 等新模型受限，V4.5 及以下不限\n拼车账号额度全员共享，每分钟自动同步，点击立即刷新\n${syncSummary}`;
  return (
    <button
      type="button"
      role="status"
      onClick={() => void refresh()}
      title={collapsed ? title : `${title}（点击立即刷新）`}
      aria-label={`Opus 生成限额 ${negative ? '已用尽' : `${percent}%`}`}
      className={`group relative flex min-h-14 w-full cursor-pointer select-none items-center border-b border-gray-200 text-left outline-none transition hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 dark:border-gray-800 dark:hover:bg-gray-800 ${collapsed ? 'justify-center px-0' : 'gap-2.5 px-3'}`}
    >
      <span className={`relative flex h-9 w-9 flex-none items-center justify-center rounded-full ${ringClass}`}>
        <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-gray-200 dark:text-gray-700" />
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={OPUS_RING_CIRCUMFERENCE}
            strokeDashoffset={OPUS_RING_CIRCUMFERENCE * (1 - percent / 100)}
            className="transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <span className="relative text-[9px] font-black tabular-nums">{percent}%</span>
        {syncBroken && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-gray-900" aria-label="官方常量同步异常" />}
      </span>
      {!collapsed && <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-gray-700 dark:text-gray-200">Opus 限额</span>
        <span className="mt-0.5 block text-[10px] tabular-nums text-gray-500 dark:text-gray-400">≈{images}张</span>
      </span>}
    </button>
  );
};
