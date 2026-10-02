import React from 'react';
import { Gem, LoaderCircle } from 'lucide-react';
import type { useAnlasBudget } from '../services/anlasBudget';
import type { useNovelaiUsage } from '../services/naiUsage';
import { NOVELAI_USAGE_REFRESH_EVENT } from '../services/naiUsage';

interface AnlasBalanceBarProps {
  collapsed?: boolean;
  budget: Pick<ReturnType<typeof useAnlasBudget>, 'remaining' | 'loading'>;
  subscription: Pick<ReturnType<typeof useNovelaiUsage>, 'info' | 'loading' | 'error' | 'fetchedAt' | 'refresh'>;
  className?: string;
}

const compactPoints = (points: number) => points < 10_000
  ? String(points)
  : new Intl.NumberFormat('zh-CN', { notation: 'compact', useGrouping: false, minimumSignificantDigits: 3, maximumSignificantDigits: 3 }).format(points);

/** 个人预算与官方余额分别展示，共享同一 Key 的订阅查询，不互相覆盖。 */
export const AnlasBalanceBar: React.FC<AnlasBalanceBarProps> = ({ collapsed = false, budget, subscription, className = '' }) => {
  const { info, loading, error, fetchedAt, refresh } = subscription;
  const balance = info?.trainingStepsLeft;
  // 只有两种余额都明确有效时才显示总数，字段缺失不能默认成 0。
  const balanceKnown = balance != null
    && Number.isFinite(balance.fixedTrainingStepsLeft) && balance.fixedTrainingStepsLeft >= 0
    && Number.isFinite(balance.purchasedTrainingSteps) && balance.purchasedTrainingSteps >= 0
    && Number.isFinite(balance.fixedTrainingStepsLeft + balance.purchasedTrainingSteps);
  const total = balanceKnown ? balance!.fixedTrainingStepsLeft + balance!.purchasedTrainingSteps : null;
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
  const AccountIcon = loading ? LoaderCircle : Gem;
  return (
    <button type="button" onClick={() => {
      void refresh();
      // 同一次查询同步所有额度／余额视图；共享驱动会合并同 Key 的并发请求。
      window.dispatchEvent(new CustomEvent(NOVELAI_USAGE_REFRESH_EVENT));
    }} disabled={loading} title={title}
      aria-label={`刷新 Anlas 余额：个人剩余预算 ${budgetSummary} / 账号剩余点数 ${balanceSummary}；${balanceState}`}
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
