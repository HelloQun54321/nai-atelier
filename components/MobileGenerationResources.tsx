import { t, useLanguage, getLanguage } from '../services/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { ChevronUp, Gem, LoaderCircle } from 'lucide-react';
import type { useAnlasBudget } from '../services/anlasBudget';
import { isActiveOpusSubscription, usageRemainingPercent, usageRingPercent, type useNovelaiUsage } from '../services/naiUsage';
import { useNaiChannelMode } from '../services/naiChannel';
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
  /** dock：嵌入实验室底栏的折叠额度格；footer：旧贴底小字入口。 */
  variant?: 'footer' | 'dock';
}

/** 四模式共用手机资源入口；复用工作台状态，不另建预算、订阅轮询或费用规则。 */
const OPUS_RING = 2 * Math.PI * 10;

export const MobileGenerationResources: React.FC<MobileGenerationResourcesProps> = ({ apiKey, budget, subscription, runtime, keyboardOffset = 0, variant = 'footer' }) => {
  useLanguage();
  const naiChannelMode = useNaiChannelMode();
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
  const gateway = info?.source === 'gateway';
  const percent = usage ? usageRemainingPercent(usage) : 0;
  const ringPercent = usage ? usageRingPercent(usage) : 0;
  const displayPercent = gateway ? percent.toFixed(1) : percent;
  const total = officialAnlasBalance(info);
  const gatewayManaged = gateway && info?.gatewayManagedWallet === true;
  const runtimeBroken = isNaiRuntimeSyncUnhealthy(runtime);
  const opusText = info?.active === false ? t(gateway ? '网关权益不可用' : '订阅过期')
    : error ? isActiveOpusSubscription(info) && usage ? t('Opus 额度 {0}% · 旧值', [displayPercent]) : t('额度查询失败')
      : loading ? t('额度同步中')
        : isActiveOpusSubscription(info) ? usage ? usage.isNegative ? t('Opus 额度已用尽') : t('Opus 额度 {0}%', [displayPercent]) : t('额度未知')
          : info?.active === true ? t('非 Opus') : t('额度未知');
  const balanceText = total === null ? loading ? '…' : t('未知') : `${compactPoints(total)}${error ? t('（旧值）') : ''}`;
  const summary = !apiKey ? t('未配置 Key')
    : gatewayManaged
      ? t('余额 {0} · {1}{2}', [balanceText, opusText, runtimeBroken ? t(' · 规则异常') : ''])
      : t('预算 {0} · 余额 {1} · {2}{3}', [budget.loading ? '…' : compactPoints(budget.remaining), balanceText, opusText, runtimeBroken ? t(' · 规则异常') : '']);
  // 收起时只保留两组标签和数值；旧值／过期／失败用颜色与符号标记，说明放入详情。
  const footerBudget = !apiKey ? '—' : budget.loading ? '…' : compactPoints(budget.remaining);
  const footerBalance = !apiKey || total === null ? '—' : compactPoints(total);
  const footerQuota = apiKey && isActiveOpusSubscription(info) && usage ? `${displayPercent}%` : '—';
  const warning = Boolean(apiKey && (error || runtimeBroken || info?.active === false));
  const footerTone = warning ? 'text-amber-600 dark:text-amber-400'
    : usage?.isNegative ? 'text-red-600 dark:text-red-400'
      : usage && ringPercent <= 20 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400';
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
  // 按次渠道没有点数与额度可看，手机底部只保留生成相关操作。
  if (naiChannelMode === 'per-use') return null;
  const AccountIcon = budget.loading || loading ? LoaderCircle : Gem;
  const sheet = <ImagePreviewPortal>
    <MobileBottomSheet open={open} title={t("账户资源")} onClose={() => setOpen(false)} footer={<button type="button" onClick={openSettings} className="mobile-touch w-full rounded-xl bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600 px-4 text-sm font-semibold text-white">{t("账户设置")}</button>}>
      <div ref={contentRef} className="mx-auto w-full max-w-sm">
        <p className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">{!apiKey ? t("未配置 Key") : keyName?.key === apiKey ? keyName.name : t("当前 Key")}</p>
        <div className="space-y-3">
          <AnlasBalanceBar variant="details" budget={budget} subscription={subscription} />
          <OpusUsageBar collapsed={false} showDetails showSyncTime={false} />
        </div>
        <dl className="mt-4 grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 text-meta text-gray-500 dark:text-gray-400">
          <dt>{t("订阅状态")}</dt><dd className="min-w-0 break-words text-gray-700 dark:text-gray-300">{!apiKey ? t("未配置 Key") : !info ? t("尚未同步") : info.active === false ? t(gateway ? '网关权益不可用' : "订阅过期") : gateway ? t('网关成员') : isActiveOpusSubscription(info) ? 'Opus' : t("非 Opus")}</dd>
          <dt>{t("最近成功同步")}</dt><dd className="min-w-0 break-words tabular-nums">{fetchedAt > 0 ? new Date(fetchedAt).toLocaleString(getLanguage(), { hour12: false }) : t("尚未同步")}</dd>
        </dl>
        {runtimeBroken && runtime && <p role="status" className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t("{0}，费用估算可能过期", [describeNaiRuntimeSyncProblem(runtime)])}</p>}
      </div>
    </MobileBottomSheet>
  </ImagePreviewPortal>;

  if (variant === 'dock') {
    return <>
      <button type="button" aria-label={t("查看账户资源：{0}", [summary])} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
        className={`appearance-group mobile-touch inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-1.5 dark:border-gray-700 dark:bg-gray-900/80 ${footerTone}`}>
        <span className="flex w-9 flex-col items-center gap-0.5" aria-hidden="true">
          <AccountIcon className={`h-3 w-3 text-indigo-600 dark:text-indigo-300 ${budget.loading || loading ? 'animate-spin' : ''}`} />
          {gatewayManaged ? (
            <span className="text-tiny font-bold leading-none tabular-nums text-indigo-600 dark:text-indigo-300">{footerBalance}</span>
          ) : <>
            <span className="text-tiny font-bold leading-none tabular-nums text-indigo-600 dark:text-indigo-300">{footerBudget}</span>
            <span className="h-px w-5 bg-gray-300 dark:bg-gray-600" />
            <span className="text-tiny leading-none tabular-nums text-gray-500 dark:text-gray-400">{footerBalance}</span>
          </>}
        </span>
        <span className={`relative flex h-8 w-8 items-center justify-center ${footerTone}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" className="absolute inset-0 h-full w-full -rotate-90">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-200 dark:text-gray-700" />
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeDasharray={OPUS_RING} strokeDashoffset={OPUS_RING * (1 - ringPercent / 100)}
              className={usage?.isNegative || error ? 'text-red-500' : ringPercent <= 20 ? 'text-amber-500' : 'text-emerald-500'} />
          </svg>
          <span className="relative text-tiny font-bold tabular-nums">{error ? '!' : footerQuota === '—' ? '—' : footerQuota.replace('%', '')}</span>
        </span>
      </button>
      {sheet}
    </>;
  }

  return <>
    <button type="button" aria-label={t("查看账户资源：{0}", [summary])} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
      style={keyboardOffset > 0 ? { bottom: `calc(${keyboardOffset}px + env(safe-area-inset-bottom))` } : undefined}
      className="mobile-touch group fixed inset-x-0 bottom-[env(safe-area-inset-bottom)] z-[900] mx-auto inline-flex h-11 w-max max-w-[calc(100vw-2rem)] cursor-pointer items-end justify-center gap-3 rounded-md border-0 bg-transparent px-2 pb-1 text-meta leading-4 shadow-none outline-none transition-opacity active:opacity-60 focus-visible:ring-2 focus-visible:ring-indigo-500 md:hidden">
      <span className={`whitespace-nowrap tabular-nums underline decoration-dotted decoration-gray-400/60 underline-offset-4 group-hover:decoration-current ${footerTone}`}>Anlas {gatewayManaged ? footerBalance : `${footerBudget}/${footerBalance}`}</span>
      <span className={`inline-flex items-center gap-1 whitespace-nowrap tabular-nums ${footerTone}`}><span className="underline decoration-dotted decoration-gray-400/60 underline-offset-4 group-hover:decoration-current">{t(!info ? '生成额度' : 'Opus 额度')} {footerQuota}{warning && <span aria-hidden="true" className="ml-1">!</span>}</span><ChevronUp aria-hidden="true" className="h-3 w-3 shrink-0" /></span>
    </button>
    {sheet}
  </>;
};
