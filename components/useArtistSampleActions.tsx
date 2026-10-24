import React, { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { LoaderCircle } from 'lucide-react';
import { t } from '../services/i18n';
import type { ArtistSamplePack, ArtistSampleRemoval, ArtistSampleTemplate } from '../services/artistSamples';
import { deleteArtistSample, validateArtistSampleTemplate, type ArtistSampleData } from '../services/artistSampleDrafts';
import { artistSampleGenerationBusy, beginArtistSampleGeneration, getArtistSampleGeneration, readArtistSampleApiKey, removeCachedArtistSample, retryArtistSampleSave, type ArtistSampleGeneration } from '../services/artistSampleGeneration';
import { applyEstimatorRuntime, estimateV45GenerationCost, useAnlasBudget } from '../services/anlasBudget';
import { isActiveOpusSubscription, useNovelaiUsage } from '../services/naiUsage';
import { useNaiRuntime } from '../services/naiRuntime';
import { confirmationCostScope } from '../services/dailyConfirmation';
import { approveGenerationSeries, stopGenerationSeriesSession } from '../services/generationSeries';
import { setGenerationQueuePaused } from '../services/generationTask';
import { useConfirmDialog } from './ConfirmDialog';
import { ArtistSampleSettingsDialog } from './ArtistSampleSettingsDialog';

type SettingsTarget = { tag?: string; pack: ArtistSamplePack; generateAfterSave: false } | { tag: string; pack: ArtistSamplePack; generateAfterSave: true; regenerate?: boolean };

/** 画师库与 Roll 共用样张操作，费用确认、当前版本和原图保护不能各自实现。 */
export function useArtistSampleActions({ active, data, setData, notify, enforceFreeStepLimit = true }: {
  active: boolean; data: ArtistSampleData; setData: Dispatch<SetStateAction<ArtistSampleData>>;
  notify: (message: string, type?: 'success' | 'error') => void; enforceFreeStepLimit?: boolean;
}) {
  const confirm = useConfirmDialog();
  const budget = useAnlasBudget(), subscription = useNovelaiUsage();
  const runtime = useNaiRuntime(); applyEstimatorRuntime(runtime);
  const activeRef = useRef(active); activeRef.current = active;
  useEffect(() => { activeRef.current = active; return () => { activeRef.current = false; }; }, [active]);
  const requesting = useRef(false);
  const [requestingTarget, setRequestingTarget] = useState('');
  const [sampleSettings, setSampleSettings] = useState<SettingsTarget | null>(null);
  const removalLocks = useRef(new Set<string>());
  const removeSample = async (removal: ArtistSampleRemoval) => {
    const key = JSON.stringify(removal);
    if (removalLocks.current.has(key)) return;
    removalLocks.current.add(key);
    try {
      if (!await confirm({ title: t('删除这张样张？'), message: t('只从画师样张中移除，历史、收藏和原图保留。'), confirmLabel: t('删除当前样张'), tone: 'danger', rememberKey: 'artist-sample.delete' })) return;
      await deleteArtistSample(removal);
      removeCachedArtistSample(removal);
      setData(current => ({ ...current, removedSamples: [...(current.removedSamples || []), removal] }));
    } finally { removalLocks.current.delete(key); }
  };
  const generateSample = async (tag: string, pack: ArtistSamplePack, template: ArtistSampleTemplate, regenerate = false, options: { skipConfirmation?: boolean } = {}) => {
    if (requesting.current || artistSampleGenerationBusy(getArtistSampleGeneration(tag, pack))) return;
    const key = readArtistSampleApiKey();
    if (!key) { notify(t('请先在“全局设置”中配置 NovelAI API Key'), 'error'); return; }
    requesting.current = true; setRequestingTarget(pack + ':' + tag);
    const snapshot = structuredClone(template);
    try {
      validateArtistSampleTemplate(pack, snapshot);
      void subscription.refreshIfStale();
      const cost = estimateV45GenerationCost(snapshot.params, isActiveOpusSubscription(subscription.info), subscription.info?.usage?.isNegative ?? true);
      if (cost > 0 && !options.skipConfirmation && !await confirm({ rememberKey: 'artist-sample.generate', rememberScope: confirmationCostScope(key, cost, 1, budget.remaining, snapshot.params.model), title: budget.remaining <= 0 ? 'Anlas 预算已用尽' : '确认生成图片', message: t('本轮生成 {0} 张，预计共消耗 {1} Anlas。本地剩余预算：{2}。', [1, cost, budget.remaining]), confirmLabel: t('消耗 {0} 点并生成', [cost]), ...(cost > budget.remaining ? { tone: 'danger' as const } : {}) })) return;
      if (!activeRef.current) return;
      if (readArtistSampleApiKey() !== key) throw new Error('NovelAI Key 已变化，请重新发起生成');
      void beginArtistSampleGeneration(tag, pack, snapshot, key, cost, true, regenerate, () => activeRef.current).catch(error => notify((error as Error).message, 'error'));
    } catch (error) { notify(t((error as Error).message), 'error'); }
    finally { requesting.current = false; setRequestingTarget(''); }
  };
  const supplementSample = (tag: string, pack: ArtistSamplePack, regenerate = false, options: { skipConfirmation?: boolean } = {}) => {
    const template = data.templates[pack];
    if (!template) { setSampleSettings({ tag, pack, generateAfterSave: true, regenerate }); return false; }
    void generateSample(tag, pack, template, regenerate, options);
    return true;
  };
  const manageGeneration = async (tag: string, pack: ArtistSamplePack, action: 'approve' | 'resume') => {
    const session = getArtistSampleGeneration(tag, pack)?.session;
    if (!session || !activeRef.current) return;
    try {
      if (readArtistSampleApiKey() !== session.key) throw new Error('NovelAI Key 已变化，请重新发起生成');
      if (action === 'resume') { await setGenerationQueuePaused(session.key, false); return; }
      const cost = session.awaiting?.cost;
      if (cost === undefined) return;
      if (!await confirm({ rememberKey: 'artist-sample.cost-increase', rememberScope: confirmationCostScope(session.key, cost, 1, budget.remaining), title: '后台任务费用已变化', message: t('本轮剩余 {0} 张，当前每张预计 {1} Anlas，共 {2} Anlas。本地剩余预算：{3}。', [1, cost, cost, budget.remaining]), confirmLabel: t('消耗 {0} 点并生成', [cost]), tone: 'danger' })) { stopGenerationSeriesSession(session); return; }
      if (readArtistSampleApiKey() !== session.key) throw new Error('NovelAI Key 已变化，请重新发起生成');
      if (!activeRef.current) return;
      await approveGenerationSeries(session, cost);
    } catch (error) { notify((error as Error).message, 'error'); }
  };
  const settingsDialog = sampleSettings && <ArtistSampleSettingsDialog key={sampleSettings.pack + ':' + sampleSettings.tag} {...sampleSettings} enforceFreeStepLimit={enforceFreeStepLimit} onClose={() => setSampleSettings(null)} onSaved={template => {
    setData(current => ({ ...current, templates: { ...current.templates, [sampleSettings.pack]: template } }));
    const target = sampleSettings;
    flushSync(() => setSampleSettings(null));
    if (target.generateAfterSave) void generateSample(target.tag, target.pack, template, target.regenerate);
  }} />;
  return { requesting, requestingTarget, removeSample, supplementSample, manageGeneration, setSampleSettings, settingsDialog };
}

export function ArtistSampleGenerationStatus({ tag, pack, generation, busy, hasOwnSamples, supplementSample, manageGeneration }: {
  tag: string; pack: ArtistSamplePack; generation?: ArtistSampleGeneration; busy: boolean; hasOwnSamples: boolean;
  supplementSample: (tag: string, pack: ArtistSamplePack) => unknown;
  manageGeneration: (tag: string, pack: ArtistSamplePack, action: 'approve' | 'resume') => Promise<void>;
}) {
  if (!busy && !generation?.error && generation?.phase !== 'save_failed') return null;
  return <div data-card-action="true" className="appearance-group flex flex-wrap items-center justify-center gap-1 border-t border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    {busy && <span role="status" className="flex min-w-0 items-center gap-1"><LoaderCircle className="h-3 w-3 shrink-0 animate-spin" />{t(generation?.session?.connectionError || (generation?.session?.awaiting ? '等待费用确认' : generation?.session?.state === 'paused' ? '任务已暂停' : generation?.phase === 'saving' ? '正在保存样张…' : '正在生成样张…'))}</span>}
    {generation?.error && <span role="alert" className="max-h-16 w-full overflow-y-auto break-words text-center text-red-600 dark:text-red-300">{t(generation.error)}</span>}
    {generation?.phase === 'save_failed' && <button type="button" className="mobile-touch min-h-11 px-2 font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => void retryArtistSampleSave(tag, pack)}>{t('重试保存样张')}</button>}
    {!busy && !hasOwnSamples && generation?.phase === 'failed' && generation.preview && <button type="button" data-agent-action="business" className="mobile-touch min-h-11 px-2 font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => supplementSample(tag, pack)}>{t('补充样张')}</button>}
    {generation?.session?.awaiting && <button type="button" data-agent-action="business" className="mobile-touch min-h-11 px-2 underline" onClick={() => void manageGeneration(tag, pack, 'approve')}>{t('确认费用')}</button>}
    {generation?.session?.state === 'paused' && <button type="button" data-agent-action="business" className="mobile-touch min-h-11 px-2 underline" onClick={() => void manageGeneration(tag, pack, 'resume')}>{t('继续')}</button>}
    {generation?.session && <button type="button" className="mobile-touch min-h-11 px-2 underline" disabled={generation.session.stopped} onClick={() => stopGenerationSeriesSession(generation.session!)}>{t(generation.session.stopped ? '取消中…' : '取消')}</button>}
  </div>;
}
