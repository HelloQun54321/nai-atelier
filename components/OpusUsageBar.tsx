import { t, useLanguage, getLanguage } from '../services/i18n';
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { isNovelaiSubscriptionInactive, NOVELAI_USAGE_REFRESH_EVENT, usageRemainingImages, usageRemainingPercent, useNovelaiUsage } from '../services/naiUsage';
import { useNaiRuntime, isNaiRuntimeSyncUnhealthy, describeNaiRuntimeSyncProblem } from '../services/naiRuntime';

interface OpusUsageBarProps {
  collapsed: boolean;
  /** 触屏完整视图直接显示异常与同步时间；常规刷新复用原位动画，不另起加载文字行。 */
  showDetails?: boolean;
  /** 资源面板集中显示一次账户同步时间，设置内保留行内时间。 */
  showSyncTime?: boolean;
}

const OPUS_RING_CIRCUMFERENCE = 2 * Math.PI * 16;

/**
 * NovelAI Opus 免费生成限额（V5 起生效），展示在侧栏 Anlas 预算下方。
 * 活跃非 Opus 订阅不显示用量条；过期订阅改为展示 Paid Anlas 状态。
 */
export const OpusUsageBar: React.FC<OpusUsageBarProps> = ({ collapsed, showDetails = false, showSyncTime = true }) => {
  useLanguage();
  const { info, usage, loading, error, fetchedAt, refresh } = useNovelaiUsage();
  const gateway = info?.source === 'gateway';
  const quotaLabel = !info ? '生成额度' : gateway ? '成员额度' : 'Opus 限额';
  const runtime = useNaiRuntime();
  const refreshAll = () => {
    void refresh();
    // 与 Anlas 行同源刷新；同 Key 的多个视图由共享驱动合并查询。
    window.dispatchEvent(new CustomEvent(NOVELAI_USAGE_REFRESH_EVENT));
  };
  // 订阅过期不等于 Key 失效；隐藏残留的免费额度，明确 Paid Anlas 付费路径。
  const expired = isNovelaiSubscriptionInactive(info);
  if (expired) {
    const paid = info?.trainingStepsLeft?.purchasedTrainingSteps;
    const balanceLabel = paid === undefined ? t(gateway ? '网关余额未知' : 'Paid Anlas 余额未知') : t(gateway ? '网关付费余额：{0} 点' : 'Paid Anlas：{0} 点', [paid.toLocaleString(getLanguage())]);
    const expiredLabel = gateway ? '网关权益不可用' : '订阅已过期';
    const runtimeWarning = isNaiRuntimeSyncUnhealthy(runtime) ? describeNaiRuntimeSyncProblem(runtime) : '';
    return <button type="button" role="status" aria-label={gateway ? t(expiredLabel) : t("订阅已过期 · {0}", [balanceLabel])} aria-busy={loading}
      onClick={refreshAll} title={gateway ? `${t(expiredLabel)} · ${balanceLabel} · ${t('成员分配额度与实际扣费以网关为准；点击刷新')}` : t("订阅已过期，Opus 免费权益不可用。{0}。可确认付费生成，权限与扣费以官方响应为准；余额不会覆盖本地预算。{1}{2}", [balanceLabel, error ? t('状态刷新失败：{0}', [t(error)]) : '', runtimeWarning ? t('官方计费规则同步异常：{0}', [t(runtimeWarning)]) : ''])}
      className={`min-h-14 w-full cursor-pointer select-none text-left outline-none transition hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 dark:hover:bg-gray-800 ${error ? 'text-red-500 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'} ${showDetails && !collapsed ? 'appearance-group rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/70' : `flex items-center border-b border-gray-200 dark:border-gray-800 ${collapsed ? 'justify-center px-0' : 'gap-2.5 px-3'}`}`}>
      {showDetails && !collapsed ? <>
        <span className="flex items-center justify-between gap-2 text-xs font-medium"><span>{t(expiredLabel)}</span><RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></span>
        <span className="mt-3 grid grid-cols-2 gap-3 text-xs"><span className="min-w-0">{t("免费权益不可用")}</span><span className="min-w-0 break-words border-l border-gray-200 pl-3 tabular-nums dark:border-gray-700">{t(balanceLabel)}</span></span>
        {runtimeWarning && <span className="mt-2 block text-micro">{t("计费规则同步异常")}</span>}
        {error && <span className="mt-2 block break-words text-micro">{t("状态刷新失败：{0}，点按重试", [t(error)])}</span>}
        {showSyncTime && fetchedAt > 0 && <span className="mt-2 block text-micro text-gray-500 dark:text-gray-400">{t("最近同步 {0}", [new Date(fetchedAt).toLocaleTimeString(getLanguage(), { hour12: false })])}</span>}
      </> : <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center text-mini font-bold">{t(gateway ? '网关' : '付费')}</span>
      {!collapsed && <span className="min-w-0 flex-1"><span className="block text-xs font-medium">{t(expiredLabel)}</span><span className="mt-0.5 block text-micro">{error ? t("状态刷新失败，点击重试") : t("免费权益不可用")}</span>{runtimeWarning && <span className="mt-0.5 block text-micro">{t("计费规则同步异常")}</span>}</span>}
      </>}
    </button>;
  }
  // 请求明确成功但没有 usage 时不展示 Opus 条；加载/失败保留状态行。
  if (!usage && !loading && !error) return null;
  const percent = usage ? usageRemainingPercent(usage) : 0;
  const displayPercent = gateway ? percent.toFixed(2) : percent;
  // 活动加成可能让真实额度超过 100%；圆环保持满圈，数字和张数保留真实值。
  const ringPercent = Math.min(100, percent);
  const images = usage ? usageRemainingImages(usage, runtime.imagesPerPercent) : 0;
  const negative = usage?.isNegative === true;
  const low = !negative && percent <= 20;
  // 同步健康度：提取失效或超过 48 小时未更新时，直接用红色圆环和叉号示警，
  // 避免「项目能跑但常量早已过期」的静默失效。
  const health = runtime.health;
  const syncPending = health?.reason === 'pending';
  const runtimeSyncBroken = isNaiRuntimeSyncUnhealthy(runtime);
  // 额度查询错误用红叉；规则同步失败只代表估算可能过期，不能覆盖已知额度。
  const syncBroken = Boolean(error);
  const ringClass = syncBroken
    ? 'text-red-500 dark:text-red-400'
    : negative
      ? 'text-red-500 dark:text-red-400'
      : low
        ? 'text-amber-500 dark:text-amber-400'
        : 'text-emerald-500 dark:text-emerald-400';
  const valueClass = syncBroken || negative
    ? 'text-red-700 dark:text-red-400'
    : low ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400';
  const syncSummary = t(error
    ? t(!info ? '额度同步失败：{0}' : gateway ? '成员额度同步失败：{0}' : 'Opus 限额同步失败：{0}', [t(error)])
    : syncPending
    ? '官方常量同步进行中，稍后自动重试'
    : runtimeSyncBroken
    ? `⚠ ${describeNaiRuntimeSyncProblem(runtime)}：张数换算与费用估算可能过期，请检查电脑网络，或让 AI 运行 npm run test:live-sync 排查`
    : health?.missed?.length
      ? `常量同步部分失效：未命中 ${health.missed.join('、')}（${runtime.syncedAt ? new Date(runtime.syncedAt).toLocaleString(getLanguage()) : ''} 同步）`
      : `常量同步正常（${runtime.syncedAt ? new Date(runtime.syncedAt).toLocaleString(getLanguage()) : t('等待首次同步')}）`);
  const title = !info ? `${error ? t('额度未知：{0}', [t(error)]) : t('正在同步…')}\n${syncSummary}` : gateway ? `${!usage ? error ? t('额度未知：{0}', [t(error)]) : t('正在同步…') : t('成员额度：{0}%（约 {1} 张），按官方规则估算', [displayPercent, images])}\n${t('成员分配额度与实际扣费以网关为准；点击刷新')}\n${syncSummary}` : `${t(!usage
    ? error ? 'Opus 限额同步失败，点击立即重试' : '正在同步 Opus 限额'
    : negative
    ? 'Opus 限额已用尽：所有生图将消耗 Anlas，额度恢复后自动回到免费生成'
    : `Opus 免费生成限额：剩余 ${percent}%（约 ${images} 张）`)} · ${t('仅 V5 等新模型受限，V4.5 及以下不限')}\n${t('拼车账号额度全员共享，每分钟自动同步，点击立即刷新')}\n${syncSummary}`;
  const ring = <span className={`relative flex flex-none items-center justify-center rounded-full ${showDetails && !collapsed ? 'h-11 w-11' : 'h-9 w-9'} ${ringClass}`}>
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
          <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full animate-spin" aria-label={t(!info ? '正在同步' : gateway ? '正在刷新成员额度' : "正在刷新 Opus 限额")}>
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
        <span className={`relative font-bold tabular-nums ${valueClass} ${syncBroken ? 'text-lg leading-none' : showDetails && !collapsed ? 'text-meta' : percent > 99 ? 'text-mini' : 'text-micro'}`}>
          {syncBroken ? '×' : usage ? `${displayPercent}%` : ''}
        </span>
        {runtimeSyncBroken && <span role="img" aria-label={t('计费规则同步异常')} className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500 ring-2 ring-white dark:ring-gray-900" />}
      </span>;
  return (
    <button
      type="button"
      role="status"
      onClick={refreshAll}
      title={collapsed ? title : t("{0}（点击立即刷新）", [title])}
      aria-busy={loading}
      aria-label={t(!info ? '生成额度 {0}' : gateway ? '成员生成额度 {0}' : "Opus 生成限额 {0}", [syncBroken ? t('同步失败') : !usage ? t('正在同步') : negative ? t('已用尽') : `${displayPercent}%`]) + (runtimeSyncBroken ? ` · ${t('计费规则同步异常')}` : '')}
      className={`group relative min-h-14 w-full cursor-pointer select-none text-left outline-none transition hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 dark:hover:bg-gray-800 ${showDetails && !collapsed ? 'appearance-group rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/70' : `flex items-center border-b border-gray-200 dark:border-gray-800 ${collapsed ? 'justify-center px-0' : 'gap-2.5 px-3'}`}`}
    >
      {showDetails && !collapsed ? <>
        <span className="flex items-center justify-between gap-2 text-xs font-medium text-gray-600 dark:text-gray-300"><span>{t(quotaLabel)}</span><RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 text-gray-500 dark:text-gray-400 ${loading ? 'animate-spin' : ''}`} /></span>
        <span className="mt-3 grid grid-cols-2 items-center gap-3">
          <span className="flex min-w-0 items-center gap-2">{ring}<span className="text-micro text-gray-500 dark:text-gray-400">{t("剩余额度")}</span></span>
          <span className="min-w-0 border-l border-gray-200 pl-3 dark:border-gray-700"><span className="block text-micro text-gray-500 dark:text-gray-400">{t("估算可生成")}</span><span className="mt-1 block break-words text-lg font-semibold leading-6 tabular-nums text-gray-800 dark:text-gray-100">{usage ? t("≈{0} 张", [images]) : '—'}</span></span>
        </span>
        <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-micro text-gray-500 dark:text-gray-400">
          <span>{runtimeSyncBroken ? t("计费规则同步异常，张数换算可能过期") : syncPending ? t("计费规则正在同步") : t("V5 等受限模型共用额度")}</span>
          {showSyncTime && fetchedAt > 0 && <span>{t("最近同步 {0}", [new Date(fetchedAt).toLocaleTimeString(getLanguage(), { hour12: false })])}</span>}
        </span>
        {error && <span className="mt-2 block break-words text-micro text-red-500 dark:text-red-400">{usage ? t("上次额度 {0}%（≈{1} 张）：{2}", [displayPercent, images, t(error)]) : t("额度未知：{0}", [t(error)])}</span>}
        {negative && <span className="mt-2 block text-micro text-red-500 dark:text-red-400">{t(gateway ? '成员额度已用尽，请核对网关余额与策略' : "额度已用尽，生成将消耗 Anlas")}</span>}
      </> : <>
      {ring}
      {!collapsed && <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-gray-600 dark:text-gray-300">{t(quotaLabel)}</span>
        <span className={`mt-0.5 block text-micro font-normal tabular-nums ${error ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
          {error ? t("同步失败，点击重试") : usage ? t("≈{0} 张", [images]) : t("正在同步…")}
        </span>
      </span>}
      </>}
    </button>
  );
};
