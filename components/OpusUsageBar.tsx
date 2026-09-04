import React from 'react';
import { isNovelaiSubscriptionInactive, usageRemainingImages, usageRemainingPercent, useNovelaiUsage } from '../services/naiUsage';
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
  const { info, usage, loading, error, refresh } = useNovelaiUsage();
  const runtime = useNaiRuntime();
  // 请求明确成功但没有 usage 时才表示非 Opus；加载和失败都保留完整状态行。
  if (!usage && !loading && !error) return null;
  const percent = usage ? usageRemainingPercent(usage) : 0;
  // 活动加成可能让真实额度超过 100%；圆环保持满圈，数字和张数保留真实值。
  const ringPercent = Math.min(100, percent);
  const images = usage ? usageRemainingImages(usage, runtime.imagesPerPercent) : 0;
  const negative = usage?.isNegative === true;
  const low = !negative && percent <= 20;
  // Key 已失效（官方 active=false）：额度数字属于废账号，展示没有意义，
  // 直接红色 × 提示切换，避免「看着有额度、生成必失败」的误导。
  const keyInvalid = isNovelaiSubscriptionInactive(info);
  // 同步健康度：提取失效或超过 48 小时未更新时，直接用红色圆环和叉号示警，
  // 避免「项目能跑但常量早已过期」的静默失效。
  const health = runtime.health;
  const syncPending = health?.reason === 'pending';
  const runtimeSyncBroken = isNaiRuntimeSyncUnhealthy(runtime);
  const syncBroken = Boolean(error) || runtimeSyncBroken;
  const ringClass = keyInvalid || syncBroken
    ? 'text-red-500 dark:text-red-400'
    : negative
      ? 'text-red-500 dark:text-red-400'
      : low
        ? 'text-amber-500 dark:text-amber-400'
        : 'text-emerald-500 dark:text-emerald-400';
  const keyInvalidSummary = '当前密钥已失效（订阅已过期），免费生成与额度估算不可用，请到 设置 → 密钥 切换';
  const syncSummary = keyInvalid
    ? keyInvalidSummary
    : error
    ? `Opus 限额同步失败：${error}`
    : syncPending
    ? '官方常量同步进行中，稍后自动重试'
    : runtimeSyncBroken
    ? `⚠ ${describeNaiRuntimeSyncProblem(runtime)}：张数换算与费用估算可能过期，请检查电脑网络，或让 AI 运行 npm run test:live-sync 排查`
    : health?.missed?.length
      ? `常量同步部分失效：未命中 ${health.missed.join('、')}（${runtime.syncedAt ? new Date(runtime.syncedAt).toLocaleString() : ''} 同步）`
      : `常量同步正常（${runtime.syncedAt ? new Date(runtime.syncedAt).toLocaleString() : '等待首次同步'}）`;
  const title = `${!usage
    ? error ? 'Opus 限额同步失败，点击立即重试' : '正在同步 Opus 限额'
    : negative
    ? 'Opus 限额已用尽：所有生图将消耗 Anlas，额度恢复后自动回到免费生成'
    : `Opus 免费生成限额：剩余 ${percent}%（约 ${images} 张）`} · 仅 V5 等新模型受限，V4.5 及以下不限\n拼车账号额度全员共享，每分钟自动同步，点击立即刷新\n${syncSummary}`;
  return (
    <button
      type="button"
      role="status"
      onClick={() => void refresh()}
      title={collapsed ? title : `${title}（点击立即刷新）`}
      aria-busy={loading}
      aria-label={`Opus 生成限额 ${keyInvalid ? '当前密钥已失效' : syncBroken ? '同步失败' : !usage ? '正在同步' : negative ? '已用尽' : `${percent}%`}`}
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
            strokeDashoffset={OPUS_RING_CIRCUMFERENCE * (1 - ringPercent / 100)}
            className={`transition-[stroke-dashoffset,opacity] duration-700 ease-out ${loading ? 'opacity-25' : ''}`}
          />
        </svg>
        {loading && (
          <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full animate-spin" aria-label="正在刷新 Opus 限额">
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${OPUS_RING_CIRCUMFERENCE * 0.22} ${OPUS_RING_CIRCUMFERENCE * 0.78}`}
            />
          </svg>
        )}
        <span className={`relative font-bold tabular-nums ${keyInvalid || syncBroken ? 'text-lg leading-none' : percent > 99 ? 'text-mini' : 'text-micro'}`}>
          {keyInvalid || syncBroken ? '×' : usage ? `${percent}%` : ''}
        </span>
      </span>
      {!collapsed && <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-gray-600 dark:text-gray-300">Opus 限额</span>
        <span className={`mt-0.5 block text-micro font-normal tabular-nums ${keyInvalid || error ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
          {keyInvalid ? '当前密钥已失效，点击切换' : error ? '同步失败，点击重试' : usage ? `≈${images} 张` : '正在同步…'}
        </span>
      </span>}
    </button>
  );
};
