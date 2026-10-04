import React, { useEffect, useRef, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import type { useAnlasBudget } from '../services/anlasBudget';
import { isActiveOpusSubscription, usageRemainingPercent, type useNovelaiUsage } from '../services/naiUsage';
import { describeNaiRuntimeSyncProblem, isNaiRuntimeSyncUnhealthy, type NaiRuntimeConfig } from '../services/naiRuntime';
import { naiKeyVault } from '../services/naiKeyVault';
import { AnlasBalanceBar, compactPoints, officialAnlasBalance } from './AnlasBalanceBar';
import { OpusUsageBar } from './OpusUsageBar';
import { MobileBottomSheet } from './MobileUI';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { isTopmostModal } from './useModalA11y';

interface MobileGenerationResourcesProps {
  apiKey: string;
  budget: Pick<ReturnType<typeof useAnlasBudget>, 'remaining' | 'loading'>;
  subscription: ReturnType<typeof useNovelaiUsage>;
  runtime: NaiRuntimeConfig | null;
}

/** 四模式共用手机资源入口；复用工作台状态，不另建预算、订阅轮询或费用规则。 */
export const MobileGenerationResources: React.FC<MobileGenerationResourcesProps> = ({ apiKey, budget, subscription, runtime }) => {
  const [open, setOpen] = useState(false);
  const [keyName, setKeyName] = useState<{ key: string; name: string } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const settingsAfterBackRef = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    if (settingsAfterBackRef.current) window.removeEventListener('popstate', settingsAfterBackRef.current);
  }, []);
  useEffect(() => {
    if (!open || !apiKey) return;
    let active = true;
    void naiKeyVault.list().then(entries => {
      if (active) setKeyName({ key: apiKey, name: entries.find(entry => entry.key === apiKey)?.name || '当前 Key' });
    }).catch(() => { /* 备注不可用时保留通用名称，不展示密钥明文。 */ });
    return () => { active = false; };
  }, [open, apiKey]);
  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(contentRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null)) { event.preventDefault(); setOpen(false); }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      desktop.removeEventListener('change', closeOnDesktop);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const { info, usage, loading, error, fetchedAt } = subscription;
  const total = officialAnlasBalance(info);
  const runtimeBroken = isNaiRuntimeSyncUnhealthy(runtime);
  const opusText = info?.active === false ? '订阅过期'
    : error ? isActiveOpusSubscription(info) && usage ? `Opus ${usageRemainingPercent(usage)}% · 旧值` : '额度查询失败'
      : loading ? '额度同步中'
        : isActiveOpusSubscription(info) ? usage ? usage.isNegative ? 'Opus 已用尽' : `Opus ${usageRemainingPercent(usage)}%` : '额度未知'
          : info?.active === true ? '非 Opus' : '额度未知';
  const balanceText = total === null ? loading ? '…' : '未知' : `${compactPoints(total)}${error ? '（旧值）' : ''}`;
  const summary = !apiKey ? '未配置 Key'
    : `预算 ${budget.loading ? '…' : compactPoints(budget.remaining)} · 余额 ${balanceText} · ${opusText}${runtimeBroken ? ' · 规则异常' : ''}`;
  const balance = info?.trainingStepsLeft;
  const openSettings = () => {
    const navigate = () => {
      settingsAfterBackRef.current = null;
      setOpen(false);
      window.dispatchEvent(new CustomEvent('nai-open-global-settings', { detail: { section: 'novelai' } }));
    };
    // 先退掉资源面板的手机历史层，再打开设置，避免回退事件误关新面板。
    if (String(window.history.state?.__naiMobileLayer || '').startsWith('sheet-')) {
      if (settingsAfterBackRef.current) return;
      settingsAfterBackRef.current = navigate;
      window.addEventListener('popstate', navigate, { once: true });
      window.history.back();
    } else navigate();
  };
  return <>
    <button type="button" aria-label={`查看账户资源：${summary}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
      className="appearance-panel mobile-touch flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border border-gray-200 bg-white/95 px-3 py-2 text-left text-micro shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900/95 md:hidden">
      <span className={`min-w-0 flex-1 break-words tabular-nums ${error || runtimeBroken || info?.active === false ? 'text-amber-600 dark:text-amber-400' : usage?.isNegative ? 'text-red-600 dark:text-red-400' : usage && usageRemainingPercent(usage) <= 20 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-600 dark:text-gray-300'}`}>{summary}</span>
      <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
    </button>
    <ImagePreviewPortal>
      <MobileBottomSheet open={open} title="账户资源" onClose={() => setOpen(false)} footer={<button type="button" onClick={openSettings} className="mobile-touch w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white">账户设置</button>}>
        <div ref={contentRef}>
          <p className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">{!apiKey ? '未配置 Key' : keyName?.key === apiKey ? keyName.name : '当前 Key'}</p>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/70">
            <AnlasBalanceBar budget={budget} subscription={subscription} />
            <OpusUsageBar collapsed={false} showDetails />
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
            <dt>本地预算</dt><dd className="text-right tabular-nums">{budget.loading ? '加载中' : `${budget.remaining.toLocaleString('zh-CN')} 点`}</dd>
            <dt>官方余额</dt><dd className="text-right tabular-nums">{total === null ? '未知' : `${total.toLocaleString('zh-CN')} 点`}</dd>
            {total !== null && balance && <><dt>订阅赠送 / Paid</dt><dd className="text-right tabular-nums">{balance.fixedTrainingStepsLeft.toLocaleString('zh-CN')} / {balance.purchasedTrainingSteps.toLocaleString('zh-CN')}</dd></>}
            <dt>最近成功同步</dt><dd className="text-right">{fetchedAt > 0 ? new Date(fetchedAt).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'}</dd>
          </dl>
          <p className="mt-3 text-micro text-gray-500 dark:text-gray-400">本地预算 ≠ 官方余额</p>
          {error && <p role="status" className="mt-2 break-words text-xs text-amber-600 dark:text-amber-400">{total === null ? '余额未知' : '显示上次余额'}：{error}</p>}
          {runtimeBroken && runtime && <p role="status" className="mt-2 text-xs text-amber-600 dark:text-amber-400">{describeNaiRuntimeSyncProblem(runtime)}，费用估算可能过期</p>}
        </div>
      </MobileBottomSheet>
    </ImagePreviewPortal>
  </>;
};
