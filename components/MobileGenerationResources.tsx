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
  keyboardOffset?: number;
}

/** 四模式共用手机资源入口；复用工作台状态，不另建预算、订阅轮询或费用规则。 */
export const MobileGenerationResources: React.FC<MobileGenerationResourcesProps> = ({ apiKey, budget, subscription, runtime, keyboardOffset = 0 }) => {
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
  // 收起时只保留两组标签和数值；旧值／过期／失败用颜色与符号标记，说明放入详情。
  const footerBudget = !apiKey ? '—' : budget.loading ? '…' : compactPoints(budget.remaining);
  const footerBalance = !apiKey || total === null ? '—' : compactPoints(total);
  const footerQuota = apiKey && isActiveOpusSubscription(info) && usage ? `${usageRemainingPercent(usage)}%` : '—';
  const warning = Boolean(apiKey && (error || runtimeBroken || info?.active === false));
  const footerTone = warning ? 'text-amber-600 dark:text-amber-400'
    : usage?.isNegative ? 'text-red-600 dark:text-red-400'
      : usage && usageRemainingPercent(usage) <= 20 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400';
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
      style={keyboardOffset > 0 ? { bottom: `calc(${keyboardOffset}px + env(safe-area-inset-bottom))` } : undefined}
      className="mobile-touch group fixed inset-x-0 bottom-[env(safe-area-inset-bottom)] z-[900] mx-auto inline-flex h-11 w-max max-w-[calc(100vw-2rem)] cursor-pointer items-end justify-center gap-3 rounded-md border-0 bg-transparent px-2 pb-1 text-meta leading-4 shadow-none outline-none transition-opacity active:opacity-60 focus-visible:ring-2 focus-visible:ring-indigo-500 md:hidden">
      <span className={`whitespace-nowrap tabular-nums underline decoration-dotted decoration-gray-400/60 underline-offset-4 group-hover:decoration-current ${footerTone}`}>Anlas {footerBudget}/{footerBalance}</span>
      <span className={`inline-flex items-center gap-1 whitespace-nowrap tabular-nums ${footerTone}`}><span className="underline decoration-dotted decoration-gray-400/60 underline-offset-4 group-hover:decoration-current">Opus额度 {footerQuota}{warning && <span aria-hidden="true" className="ml-1">!</span>}</span><ChevronUp aria-hidden="true" className="h-3 w-3 shrink-0" /></span>
    </button>
    <ImagePreviewPortal>
      <MobileBottomSheet open={open} title="账户资源" onClose={() => setOpen(false)} footer={<button type="button" onClick={openSettings} className="mobile-touch w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white">账户设置</button>}>
        <div ref={contentRef} className="mx-auto w-full max-w-sm">
          <p className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">{!apiKey ? '未配置 Key' : keyName?.key === apiKey ? keyName.name : '当前 Key'}</p>
          <div className="space-y-3">
            <AnlasBalanceBar variant="details" budget={budget} subscription={subscription} />
            <OpusUsageBar collapsed={false} showDetails showSyncTime={false} />
          </div>
          <dl className="mt-4 grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 text-meta text-gray-500 dark:text-gray-400">
            <dt>订阅状态</dt><dd className="min-w-0 break-words text-gray-700 dark:text-gray-300">{!apiKey ? '未配置 Key' : !info ? '尚未同步' : info.active === false ? '订阅过期' : isActiveOpusSubscription(info) ? 'Opus' : '非 Opus'}</dd>
            <dt>最近成功同步</dt><dd className="min-w-0 break-words tabular-nums">{fetchedAt > 0 ? new Date(fetchedAt).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'}</dd>
          </dl>
          {runtimeBroken && runtime && <p role="status" className="mt-2 text-xs text-amber-600 dark:text-amber-400">{describeNaiRuntimeSyncProblem(runtime)}，费用估算可能过期</p>}
        </div>
      </MobileBottomSheet>
    </ImagePreviewPortal>
  </>;
};
