import React, { useContext, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CircleAlert, CircleDollarSign, CirclePause, ImagePlus, LoaderCircle, RefreshCw } from 'lucide-react';
import { t } from '../services/i18n';
import type { PromptChain } from '../types';
import {
  getDefaultPromptLibraryCoverTemplate, promptLibraryCoverContent, validatePromptLibraryCoverTemplate,
  type PromptLibraryCoverTemplate,
} from '../services/promptLibraryCoverTemplate';
import { getPromptLibraryCoverTemplate } from '../services/promptLibraryCoverApi';
import {
  beginPromptLibraryCoverGeneration, getPromptLibraryCoverGeneration, promptLibraryCoverGenerationBusy,
  readPromptLibraryCoverApiKey, retryPromptLibraryCoverSave, subscribePromptLibraryCoverGeneration,
  promptLibraryCoverGenerationRevision, type PromptLibraryCoverGeneration,
} from '../services/promptLibraryCoverGeneration';
import { applyEstimatorRuntime, estimateV45GenerationCost, useAnlasBudget } from '../services/anlasBudget';
import { isActiveOpusSubscription, useNovelaiUsage } from '../services/naiUsage';
import { useNaiRuntime } from '../services/naiRuntime';
import { confirmationCostScope } from '../services/dailyConfirmation';
import { useNaiChannelMode } from '../services/naiChannel';
import { approveGenerationSeries, stopGenerationSeriesSession } from '../services/generationSeries';
import { setGenerationQueuePaused } from '../services/generationTask';
import { useConfirmDialog } from './ConfirmDialog';
import { PromptLibraryCoverSettingsDialog } from './PromptLibraryCoverSettingsDialog';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { InteractionPopover } from './InteractionPopover';
import { ImageActivityContext } from './SmartImage';
import { IMAGE_CARD_ACTION_CLASS } from './ImageShareActions';

type SettingsTarget = { generateAfterSave: false } | { chain: PromptChain; generateAfterSave: true; regenerate?: boolean };

/** 提示词库封面生成：费用确认、模板设置与卡片状态共用，不与画师／Roll 模板双向同步。 */
export function usePromptLibraryCoverActions({ active, notify }: {
  active: boolean;
  notify: (message: string, type?: 'success' | 'error') => void;
}) {
  const confirm = useConfirmDialog();
  const budget = useAnlasBudget();
  const perUseNaiChannel = useNaiChannelMode() === 'per-use';
  const subscription = useNovelaiUsage();
  const runtime = useNaiRuntime();
  applyEstimatorRuntime(runtime);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => { activeRef.current = active; return () => { activeRef.current = false; }; }, [active]);
  const [revision, setRevision] = useState(promptLibraryCoverGenerationRevision);
  useEffect(() => subscribePromptLibraryCoverGeneration(() => setRevision(promptLibraryCoverGenerationRevision())), []);
  const requesting = useRef(false);
  const [requestingTarget, setRequestingTarget] = useState('');
  const [template, setTemplate] = useState<PromptLibraryCoverTemplate | null | undefined>(undefined);
  const [settings, setSettings] = useState<SettingsTarget | null>(null);
  const templateLoaded = useRef(false);

  useEffect(() => {
    if (templateLoaded.current) return;
    templateLoaded.current = true;
    void getPromptLibraryCoverTemplate().then(value => setTemplate(value)).catch(() => setTemplate(null));
  }, []);

  const generateCover = async (chain: PromptChain, value: PromptLibraryCoverTemplate, regenerate = false, options: { skipConfirmation?: boolean } = {}) => {
    if (requesting.current || promptLibraryCoverGenerationBusy(getPromptLibraryCoverGeneration(chain.id))) return;
    if (!promptLibraryCoverContent(chain)) { notify(t('这条记录还没有正文，无法生成封面'), 'error'); return; }
    const key = readPromptLibraryCoverApiKey();
    if (!key) { notify(t('请先在“全局设置”中配置 NovelAI API Key'), 'error'); return; }
    requesting.current = true;
    setRequestingTarget(chain.id);
    const snapshot = structuredClone(value);
    try {
      validatePromptLibraryCoverTemplate(snapshot);
      void subscription.refreshIfStale();
      const cost = perUseNaiChannel ? 0 : estimateV45GenerationCost(snapshot.params, isActiveOpusSubscription(subscription.info), subscription.info?.usage?.isNegative ?? true);
      if (cost > 0 && !options.skipConfirmation && !await confirm({
        rememberKey: 'prompt-library-cover.generate',
        rememberScope: confirmationCostScope(key, cost, 1, budget.remaining, snapshot.params.model),
        title: budget.remaining <= 0 ? 'Anlas 预算已用尽' : '确认生成图片',
        message: t('本轮生成 {0} 张，预计共消耗 {1} Anlas。本地剩余预算：{2}。', [1, cost, budget.remaining]),
        confirmLabel: t('消耗 {0} 点并生成', [cost]),
        ...(cost > budget.remaining ? { tone: 'danger' as const } : {}),
      })) return;
      if (!activeRef.current) return;
      if (readPromptLibraryCoverApiKey() !== key) throw new Error('NovelAI Key 已变化，请重新发起生成');
      void beginPromptLibraryCoverGeneration(chain, snapshot, key, cost, true, regenerate, () => activeRef.current)
        .catch(error => notify((error as Error).message, 'error'));
    } catch (error) { notify(t((error as Error).message), 'error'); }
    finally { requesting.current = false; setRequestingTarget(''); }
  };

  const requestCover = (chain: PromptChain, regenerate = false) => {
    if (!promptLibraryCoverContent(chain)) { notify(t('这条记录还没有正文，无法生成封面'), 'error'); return false; }
    if (!template) { setSettings({ chain, generateAfterSave: true, regenerate }); return false; }
    void generateCover(chain, template, regenerate || Boolean(chain.previewImage));
    return true;
  };

  const manageGeneration = async (chainId: string, action: 'approve' | 'resume') => {
    const session = getPromptLibraryCoverGeneration(chainId)?.session;
    if (!session || !activeRef.current) return;
    try {
      if (readPromptLibraryCoverApiKey() !== session.key) throw new Error('NovelAI Key 已变化，请重新发起生成');
      if (action === 'resume') { await setGenerationQueuePaused(session.key, false); return; }
      const cost = session.awaiting?.cost;
      if (cost === undefined) return;
      if (!await confirm({
        rememberKey: 'prompt-library-cover.cost-increase',
        rememberScope: confirmationCostScope(session.key, cost, 1, budget.remaining),
        title: '后台任务费用已变化',
        message: t('本轮剩余 {0} 张，当前每张预计 {1} Anlas，共 {2} Anlas。本地剩余预算：{3}。', [1, cost, cost, budget.remaining]),
        confirmLabel: t('消耗 {0} 点并生成', [cost]),
        tone: 'danger',
      })) { stopGenerationSeriesSession(session); return; }
      if (readPromptLibraryCoverApiKey() !== session.key) throw new Error('NovelAI Key 已变化，请重新发起生成');
      if (!activeRef.current) return;
      await approveGenerationSeries(session, cost);
    } catch (error) { notify((error as Error).message, 'error'); }
  };

  const settingsDialog = settings && <PromptLibraryCoverSettingsDialog key={settings.generateAfterSave ? settings.chain.id : 'settings'} generateAfterSave={settings.generateAfterSave} onClose={() => setSettings(null)} onSaved={value => {
    setTemplate(value);
    const target = settings;
    flushSync(() => setSettings(null));
    if (target.generateAfterSave) void generateCover(target.chain, value, target.regenerate || Boolean(target.chain.previewImage));
  }} />;

  return {
    revision,
    requestingTarget,
    template,
    requestCover,
    manageGeneration,
    openCoverSettings: () => setSettings({ generateAfterSave: false }),
    settingsDialog,
    getGeneration: (chainId: string) => getPromptLibraryCoverGeneration(chainId),
    isBusy: (chainId: string) => requestingTarget === chainId || promptLibraryCoverGenerationBusy(getPromptLibraryCoverGeneration(chainId)),
    defaultTemplate: () => getDefaultPromptLibraryCoverTemplate(runtime),
  };
}

export function PromptLibraryCoverGenerationStatus({ chainId, generation, busy, hasCover, onRetryGenerate, manageGeneration }: {
  chainId: string;
  generation?: PromptLibraryCoverGeneration;
  busy: boolean;
  hasCover: boolean;
  onRetryGenerate: () => unknown;
  manageGeneration: (chainId: string, action: 'approve' | 'resume') => Promise<void>;
}) {
  const active = useContext(ImageActivityContext);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  const visible = active && (busy || Boolean(generation?.error || generation?.session?.awaiting || generation?.session?.connectionError) || generation?.phase === 'save_failed' || generation?.session?.state === 'paused');
  useEffect(() => { if (!visible) setOpen(false); }, [visible]);
  useEffect(() => { setOpen(false); }, [chainId]);
  if (!visible) return null;
  const failed = Boolean(generation?.error || generation?.phase === 'save_failed' || generation?.session?.connectionError);
  const awaiting = Boolean(generation?.session?.awaiting);
  const paused = generation?.session?.state === 'paused';
  const label = generation?.session?.connectionError
    || (awaiting ? '等待费用确认' : paused ? '任务已暂停' : generation?.phase === 'save_failed' ? '重试写封面'
      : generation?.error || (generation?.phase === 'saving' || generation?.session?.state === 'saving' ? '正在写入封面…' : '正在生成封面…'));
  const Icon = failed ? CircleAlert : awaiting ? CircleDollarSign : paused ? CirclePause : LoaderCircle;
  return <div data-card-action="true" data-prompt-library-cover-status="true" className="absolute bottom-2 right-2 z-30" onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key !== 'Tab') event.stopPropagation(); }}>
    <button ref={anchor} type="button" aria-label={t(label)} title={t(label)} aria-haspopup="dialog" aria-expanded={open} className={`${IMAGE_CARD_ACTION_CLASS} flex items-center justify-center`} onClick={() => setOpen(value => !value)}>
      <Icon aria-hidden="true" className={`h-4 w-4 ${!failed && !awaiting && !paused ? 'animate-spin' : ''}`} />
    </button>
    {open && <ImagePreviewPortal><InteractionPopover id={id} label={t(label)} anchorRef={anchor} onClose={() => setOpen(false)} className="p-3"><div className="flex max-w-xs flex-wrap items-center gap-2 text-xs">
      {label !== generation?.error && <span role="status" className="w-full">{t(label)}</span>}
      {generation?.error && <span role="alert" className="max-h-16 w-full overflow-y-auto break-words text-center text-red-600 dark:text-red-300">{t(generation.error)}</span>}
      {generation?.phase === 'save_failed' && <button type="button" className="mobile-touch min-h-11 px-2 font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => { flushSync(() => setOpen(false)); void retryPromptLibraryCoverSave(chainId); }}>{t('重试写封面')}</button>}
      {!busy && !hasCover && generation?.phase === 'failed' && generation.preview && <button type="button" data-agent-action="business" className="mobile-touch min-h-11 px-2 font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => { flushSync(() => setOpen(false)); onRetryGenerate(); }}>{t('重新生成封面')}</button>}
      {generation?.session?.awaiting && <button type="button" data-agent-action="business" className="mobile-touch min-h-11 px-2 underline" onClick={() => { flushSync(() => setOpen(false)); void manageGeneration(chainId, 'approve'); }}>{t('确认费用')}</button>}
      {generation?.session?.state === 'paused' && <button type="button" data-agent-action="business" className="mobile-touch min-h-11 px-2 underline" onClick={() => { flushSync(() => setOpen(false)); void manageGeneration(chainId, 'resume'); }}>{t('继续')}</button>}
      {generation?.session && <button type="button" className="mobile-touch min-h-11 px-2 underline" disabled={generation.session.stopped} onClick={() => { flushSync(() => setOpen(false)); stopGenerationSeriesSession(generation.session!); }}>{t(generation.session.stopped ? '取消中…' : '取消')}</button>}
    </div></InteractionPopover></ImagePreviewPortal>}
  </div>;
}

export function PromptLibraryCoverGenerateButton({ hasCover, disabled, onClick }: {
  hasCover: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const label = t(hasCover ? '重新生成封面' : '生成封面');
  return <button type="button" data-card-action data-agent-action="business" disabled={disabled} aria-label={label} title={label}
    onClick={event => { event.stopPropagation(); onClick(); }}
    className={`hover-reveal-md inline-flex items-center justify-center ${IMAGE_CARD_ACTION_CLASS}`}>
    <span className="relative" aria-hidden="true">
      <ImagePlus className="h-4 w-4" />
      {hasCover && <RefreshCw className="appearance-contrast absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-full bg-gray-900 p-px" />}
    </span>
  </button>;
}
