import React from 'react';
import { Gauge } from 'lucide-react';
import { clampUsagePercent, usagePercentPerDay, usageRemainingImages, useNovelaiUsage } from '../services/naiUsage';
import { useNaiRuntime } from '../services/naiRuntime';

interface OpusUsageBarProps {
  collapsed: boolean;
}

/**
 * NovelAI Opus 免费生成限额（V5 起生效），展示在侧栏 Anlas 预算下方。
 * 非 Opus 订阅或未配置 API Key 时不渲染，与官方“仅 Opus 显示用量条”一致。
 */
export const OpusUsageBar: React.FC<OpusUsageBarProps> = ({ collapsed }) => {
  const { usage, loading, refresh } = useNovelaiUsage();
  const runtime = useNaiRuntime();
  if (!usage) {
    // 首次加载且可能存在数据时占位，避免侧栏高度跳动；确认无数据则完全不渲染。
    if (loading) return <div className="h-11 w-full" aria-hidden="true" />;
    return null;
  }
  const percent = clampUsagePercent(usage);
  const images = usageRemainingImages(usage, runtime.imagesPerPercent);
  const perDay = usagePercentPerDay(usage);
  const negative = usage.isNegative;
  const title = `${negative
    ? 'Opus 限额已用尽：所有生图将消耗 Anlas，额度恢复后自动回到免费生成'
    : `Opus 免费生成限额：剩余 ${percent}%（约 ${images} 张）· 每天恢复 ${perDay}%${perDay ? `（约 ${Math.round(runtime.imagesPerPercent * perDay)} 张）` : ''}`} · 仅 V5 等新模型受限，V4.5 及以下不限\n拼车账号额度全员共享，每分钟自动同步，点击立即刷新`;
  return (
    <div
      role="status"
      onClick={() => void refresh()}
      title={collapsed ? title : `${title}（点击立即刷新）`}
      aria-label={`Opus 生成限额 ${negative ? '已用尽' : `${percent}%`}`}
      className={`relative flex h-11 w-full cursor-pointer select-none items-center border-b border-gray-200 outline-none transition hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 dark:border-gray-800 dark:hover:bg-gray-800 ${negative ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'} ${collapsed ? 'justify-center px-0' : 'justify-between px-3'}`}
    >
      <span className="flex items-center">
        <Gauge className="h-4 w-4" />
        {!collapsed && <span className="ml-2 text-xs font-medium text-gray-600 dark:text-gray-300">Opus 限额</span>}
      </span>
      {!collapsed && (
        <span className="flex items-baseline gap-1.5">
          <span className="text-sm font-black tabular-nums">{negative ? '已用尽' : `${percent}%`}</span>
          {!negative && <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">≈{images}张</span>}
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-gray-200 dark:bg-gray-800" aria-hidden="true">
        <span
          className={`block h-full ${negative ? 'bg-red-500' : 'bg-emerald-500'}`}
          style={{ width: `${percent}%` }}
        />
      </span>
    </div>
  );
};
