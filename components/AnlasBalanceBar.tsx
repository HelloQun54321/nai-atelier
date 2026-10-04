import React from 'react';
import { Gem, LoaderCircle, RefreshCw } from 'lucide-react';
import type { useAnlasBudget } from '../services/anlasBudget';
import type { useNovelaiUsage } from '../services/naiUsage';
import { NOVELAI_USAGE_REFRESH_EVENT } from '../services/naiUsage';
import type { NovelaiSubscriptionInfo } from '../services/naiUsage';

interface AnlasBalanceBarProps {
  collapsed?: boolean;
  /** 设置与触屏详情共用双列资源视图，侧栏保留原有紧凑行。 */
  variant?: 'bar' | 'details';
  budget: Pick<ReturnType<typeof useAnlasBudget>, 'remaining' | 'loading'>;
  subscription: Pick<ReturnType<typeof useNovelaiUsage>, 'info' | 'loading' | 'error' | 'fetchedAt' | 'refresh'>;
  className?: string;
}

export const compactPoints = (points: number) => points < 10_000
  ? String(points)
  : new Intl.NumberFormat('zh-CN', { notation: 'compact', useGrouping: false, minimumSignificantDigits: 3, maximumSignificantDigits: 3 }).format(points);

/** 所有资源视图共用官方余额校验；未知、非法值与真实零分别表达。 */
export const officialAnlasBalance = (info: NovelaiSubscriptionInfo | null) => {
  const balance = info?.trainingStepsLeft;
  if (!balance || !Number.isFinite(balance.fixedTrainingStepsLeft) || balance.fixedTrainingStepsLeft < 0
    || !Number.isFinite(balance.purchasedTrainingSteps) || balance.purchasedTrainingSteps < 0) return null;
  const total = balance.fixedTrainingStepsLeft + balance.purchasedTrainingSteps;
  return Number.isFinite(total) ? total : null;
};

/** 个人预算与官方余额分别展示，共享同一 Key 的订阅查询，不互相覆盖。 */
export const AnlasBalanceBar: React.FC<AnlasBalanceBarProps> = ({ collapsed = false, variant = 'bar', budget, subscription, className = '' }) => {
  const { info, loading, error, fetchedAt, refresh } = subscription;
  const balance = info?.trainingStepsLeft;
  // 只有两种余额都明确有效时才显示总数，字段缺失不能默认成 0。
  const total = officialAnlasBalance(info);
  const balanceKnown = total !== null;
  const fullBudget = budget.loading ? '…' : String(budget.remaining);
  const fullBalance = total === null ? loading ? '…' : '—' : String(total);
  // 极大数值在窄侧栏保留单位；完整数值始终可从悬停说明和辅助标签读取。
  const compact = collapsed || fullBudget.length + fullBalance.length > 12;
  const budgetText = budget.loading ? '…' : compact ? compactPoints(budget.remaining) : fullBudget;
  const balanceText = total === null ? fullBalance : compact ? compactPoints(total) : fullBalance;
  const balanceState = error
    ? total === null ? '账号余额刷新失败，余额未知' : '账号余额刷新失败，显示上次同步值'
    : loading ? total === null ? '正在查询账号余额' : '正在刷新账号余额，显示上次同步值'
      : total === null ? '账号余额未知' : '账号余额已同步';
  const budgetSummary = budget.loading ? '加载中' : `${budget.remaining.toLocaleString('zh-CN')} 点`;
  const balanceSummary = total === null ? '未知' : `${total.toLocaleString('zh-CN')} 点`;
  const title = [
    `个人剩余预算：${budgetSummary}（本地）`,
    `账号剩余点数：${balanceSummary}（官方）`,
    ...(balanceKnown ? [`订阅赠送：${balance!.fixedTrainingStepsLeft.toLocaleString('zh-CN')} 点；Paid Anlas：${balance!.purchasedTrainingSteps.toLocaleString('zh-CN')} 点`] : []),
    ...(info?.active === false ? ['订阅已过期，免费权益不可用；保留点数的使用权限以官方响应为准。'] : []),
    balanceState,
    ...(error ? [`刷新失败原因：${error}`] : []),
    ...(fetchedAt > 0 ? [`最近成功同步：${new Date(fetchedAt).toLocaleString('zh-CN', { hour12: false })}`] : []),
    '账号余额不会覆盖个人预算；共享账号余额不等于个人可支配点数。',
    '点击刷新账号余额',
  ].join('\n');
  const refreshAll = () => {
    void refresh();
    // 同一次查询同步所有额度／余额视图；共享驱动会合并同 Key 的并发请求。
    window.dispatchEvent(new CustomEvent(NOVELAI_USAGE_REFRESH_EVENT));
  };
  const refreshLabel = `刷新 Anlas 余额：个人剩余预算 ${budgetSummary} / 账号剩余点数 ${balanceSummary}；${balanceState}`;
  if (variant === 'details') return (
    <section aria-label="Anlas 点数" className={`rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/70 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300"><Gem className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />Anlas</span>
        <button type="button" onClick={refreshAll} disabled={loading} title={title} aria-label={refreshLabel} aria-busy={loading}
          className="mobile-touch -my-2 -mr-2 flex w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 outline-none transition hover:bg-gray-200 hover:text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-wait dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-indigo-300">
          <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div className="min-w-0"><dt className="text-micro text-gray-500 dark:text-gray-400">本地预算</dt><dd className="mt-1 break-all text-lg font-bold leading-6 tabular-nums text-indigo-600 dark:text-indigo-300">{budgetSummary}</dd></div>
        <div className="min-w-0 border-l border-gray-200 pl-3 dark:border-gray-700"><dt className="text-micro text-gray-500 dark:text-gray-400">官方余额</dt><dd className={`mt-1 break-all text-lg font-semibold leading-6 tabular-nums ${error ? 'text-amber-600 dark:text-amber-400' : 'text-gray-800 dark:text-gray-100'}`}>{balanceSummary}</dd></div>
      </dl>
      {balanceKnown && <dl className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-micro text-gray-500 dark:text-gray-400"><dt>订阅赠送 / Paid</dt><dd className="tabular-nums">{balance!.fixedTrainingStepsLeft.toLocaleString('zh-CN')} / {balance!.purchasedTrainingSteps.toLocaleString('zh-CN')}</dd></dl>}
      <p className="mt-2 text-micro text-gray-500 dark:text-gray-400">本地预算 ≠ 官方余额</p>
      {error && <p role="status" className="mt-2 break-words text-xs text-amber-600 dark:text-amber-400">{total === null ? '余额未知' : '显示上次余额'}：{error}</p>}
    </section>
  );
  const AccountIcon = loading ? LoaderCircle : Gem;
  return (
    <button type="button" onClick={refreshAll} disabled={loading} title={title}
      aria-label={refreshLabel}
      aria-busy={loading}
      className={`flex w-full cursor-pointer select-none items-center border-b border-gray-200 text-left outline-none transition hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 disabled:cursor-wait dark:border-gray-800/80 dark:hover:bg-gray-800/70 ${collapsed ? 'h-[60px] justify-center px-0' : 'h-11 justify-between gap-2 px-3'} ${className}`}>
      <span className={collapsed ? 'flex min-w-0 flex-col items-center gap-1' : 'contents'} aria-hidden="true">
        <span className={`flex shrink-0 items-center ${collapsed ? '' : 'gap-1.5'}`}>
          <span className="relative flex shrink-0 text-indigo-600 dark:text-indigo-300">
            <AccountIcon className={`${collapsed ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${loading ? 'animate-spin' : ''}`} />
            {error && <span title={balanceState} className="absolute -right-1 -top-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-amber-500 text-tiny font-bold leading-none text-white">!</span>}
          </span>
          {!collapsed && <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Anlas</span>}
        </span>
        <span className={`flex shrink-0 items-center tabular-nums ${collapsed ? 'w-11 flex-col' : 'gap-1'}`}>
          <span className={`font-bold leading-none text-indigo-600 dark:text-indigo-300 ${compact ? 'text-xs' : 'text-sm'}`}>{budgetText}</span>
          {collapsed
            ? <span className="my-0.5 h-px w-8 bg-gray-300 dark:bg-gray-600" />
            : <span className="text-micro text-gray-400 dark:text-gray-500">/</span>}
          <span className={`leading-none ${compact ? 'text-micro' : 'text-xs'} ${error ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>{balanceText}</span>
        </span>
      </span>
    </button>
  );
};
