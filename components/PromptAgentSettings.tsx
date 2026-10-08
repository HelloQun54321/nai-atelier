import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import './AgentSurface.css';
import { AgentGenerationOptions } from './AgentChatPreferences';
import { useAgentRuntimeRecheck } from './useAgentRuntimeRecheck';
import { AgentConnectionForm } from './AgentConnectionForm';
import { ArrowLeft, Plus } from 'lucide-react';
import { PromptAgentConfig, PromptAgentCustomProvider, PromptAgentModel, PromptAgentProbeResult, agentRuntimeWarning, displayModelName, formatModelOptionTitle, mergePromptAgentModelCapabilities, promptAgentService } from '../services/promptAgent';
import { useConfirmDialog } from './ConfirmDialog';
import { useMobileHistoryLayer } from './MobileUI';
import { useModalA11y, isTopmostModal } from './useModalA11y';

interface PromptAgentSettingsProps {
  notify: (message: string, type?: 'success' | 'error') => void;
}

type View = 'home' | 'model' | 'custom';

const emptyCustomProvider = (): PromptAgentCustomProvider => ({
  name: '', baseUrl: '', api: 'openai-completions', apiKey: '', headers: {},
  models: [], select: true,
});

const fuzzyMatch = (value: string, query: string) => {
  const source = value.toLowerCase();
  let position = 0;
  for (const character of query.toLowerCase().trim()) {
    position = source.indexOf(character, position);
    if (position < 0) return false;
    position += 1;
  }
  return true;
};

const formatContext = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 1000)}K` : String(value || '—');
export const CustomProviderForm = AgentConnectionForm;

export const PromptAgentSettings: React.FC<PromptAgentSettingsProps> = ({ notify }) => {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const [config, setConfig] = useState<PromptAgentConfig | null>(null);
  const [customProviders, setCustomProviders] = useState<PromptAgentCustomProvider[]>([]);
  const [models, setModels] = useState<PromptAgentModel[]>([]);
  const [view, setView] = useState<View>('home');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [customResult, setCustomResult] = useState<PromptAgentProbeResult | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<PromptAgentCustomProvider['models']>([]);
  const [customDraft, setCustomDraft] = useState<PromptAgentCustomProvider>(emptyCustomProvider);
  // P2-17：子页覆盖层（全屏）的焦点管理：进入时移入、Tab 圈禁、返回 home 后归还。
  const subViewRef = useModalA11y<HTMLDivElement>(view !== 'home');

  const reload = async () => {
    const [nextConfig, nextModels, nextCustomProviders] = await Promise.all([
      promptAgentService.getConfig(), promptAgentService.getAvailableModels(), promptAgentService.getCustomProviders(),
    ]);
    setConfig(nextConfig);
    setModels(nextModels);
    setCustomProviders(nextCustomProviders);
    window.dispatchEvent(new CustomEvent('nai-agent-runtime-changed'));
  };

  useEffect(() => { void reload().catch(() => notify('读取 AI 模型服务失败', 'error')); }, []);
  useAgentRuntimeRecheck(setConfig, true, Boolean(config && agentRuntimeWarning(config)));

  const filteredModels = useMemo(() => models.filter(model => fuzzyMatch(`${model.name} ${model.id} ${model.provider}`, query)), [models, query]);

  const openView = (next: View) => { setQuery(''); setView(next); };
  const closeView = () => { setView('home'); setQuery(''); setCustomDraft(emptyCustomProvider()); setDiscoveredModels([]); setCustomResult(null); };
  const requestClose = useMobileHistoryLayer(view !== 'home', closeView, 'prompt-agent-settings');

  useEffect(() => {
    if (view === 'home') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmostModal(subViewRef.current)) requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view]);

  const selectModel = async (model: PromptAgentModel) => {
    setBusy(true);
    try { const next = await promptAgentService.selectModel(model.provider, model.id); setConfig(next); await reload(); notify(`助手模型已切换为 ${model.name}`); closeView(); }
    catch (error) { notify(error instanceof Error ? error.message : '切换模型失败', 'error'); }
    finally { setBusy(false); }
  };

  const openCustom = (provider?: PromptAgentCustomProvider) => {
    setCustomResult(null); setDiscoveredModels([]);
    setCustomDraft(provider ? { ...provider, select: false, apiKey: '', models: provider.models.map(model => ({ ...model })) } : emptyCustomProvider());
    setView('custom');
  };

  const saveCustom = async () => {
    setBusy(true);
    try { await promptAgentService.saveCustomProvider(customDraft); await reload(); notify((customDraft.select ? 'API 连接已保存并设为默认' : 'API 连接已保存') + (customResult?.ok ? `；模型 ${customResult.model || customDraft.testModel || customDraft.models[0]?.id} 本次测试通过，其他模型未验证` : '（未验证）')); closeView(); }
    catch (error) { notify(error instanceof Error ? error.message : '保存自定义接口失败', 'error'); }
    finally { setBusy(false); }
  };

  const customDraftRef = useRef(customDraft);
  customDraftRef.current = customDraft;
  const testCustom = async () => {
    setBusy(true);
    const snapshot = JSON.stringify(customDraft);
    try { const result = await promptAgentService.testCustomProvider(customDraft); if (JSON.stringify(customDraftRef.current) === snapshot) setCustomResult(result); }
    catch (error) { if (JSON.stringify(customDraftRef.current) === snapshot) setCustomResult({ ok: false, message: error instanceof Error ? error.message : '连接测试失败' }); }
    finally { setBusy(false); }
  };

  const fetchCustom = async () => {
    const snapshot = JSON.stringify(customDraft);
    setBusy(true);
    try {
      const result = await promptAgentService.fetchCustomProviderModels(customDraft);
      if (JSON.stringify(customDraftRef.current) !== snapshot) return;
      setDiscoveredModels(result.models);
      setCustomDraft(previous => ({ ...previous, baseUrl: result.baseUrl || previous.baseUrl, models: previous.models.some(model => model.id) ? previous.models.filter(model => model.id).map(model => { const discovered = result.models.find(item => item.id.toLowerCase() === model.id.toLowerCase()); return discovered ? mergePromptAgentModelCapabilities(model, discovered) : model; }) : result.models.slice(0, 1) }));
      notify('已刷新现有模型的能力，请选择要加入的其他模型；手动设置已保留');
    } catch (error) { notify(error instanceof Error ? error.message : '获取模型失败', 'error'); }
    finally { setBusy(false); }
  };

  const deleteCustom = async (provider: PromptAgentCustomProvider) => {
    if (!provider.id || !await confirmAction({ title: `删除 ${provider.name}？`, message: '将删除这套接口配置和电脑中加密保存的密钥，不影响已有助手对话。', confirmLabel: '删除接口', tone: 'danger' })) return;
    setBusy(true);
    try { await promptAgentService.deleteCustomProvider(provider.id); await reload(); notify('自定义接口已删除'); }
    catch (error) { notify(error instanceof Error ? error.message : '删除失败', 'error'); }
    finally { setBusy(false); }
  };

  const currentModel = models.find(model => model.current) || (config ? { id: config.model, name: config.model, provider: config.provider } : null);

  return <>
    {view === 'home' && (
      <div data-agent-surface className="agent-theme mt-3 space-y-4">
      {/* 阶段二：层级 1 - 当前运行模型卡 */}
      <div className="appearance-panel rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-meta font-bold uppercase tracking-wider text-indigo-500">{t("当前助手模型")}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={models.length === 0}
              onClick={() => openView('model')}
              className="mobile-touch rounded-lg border border-indigo-200 bg-indigo-50/60 px-2.5 py-1 text-xs font-bold text-indigo-600 hover:bg-indigo-100 disabled:opacity-40 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
            >
              {t("更换模型")}</button>
          </div>
        </div>
        <div className="mt-1.5 truncate text-base font-black text-gray-900 dark:text-white">{config?.configured ? displayModelName(currentModel?.name || config.model) : t("尚未配置模型服务")}</div>
        {config?.configured && <div className="mt-1 text-xs text-gray-500">{t("{0} · {1} 个服务已配置", [(currentModel as { providerName?: string } | null)?.providerName || currentModel?.provider, config.configuredProviders.length])}</div>}
      </div>
      {config && agentRuntimeWarning(config) && <div role="status" className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{agentRuntimeWarning(config)}</div>}
      {config?.credentialWarning && <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{config.credentialWarning}</div>}

      {/* 阶段二：层级 3 - 模型服务管理区 */}
      <div className="appearance-panel rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-2">
          <div>
            <b className="block text-sm text-gray-900 dark:text-white">{t("API 连接")}</b>
          </div>
          <button type="button" onClick={() => openCustom()} className="mobile-touch inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"><Plus className="h-3.5 w-3.5" />{t("连接 API")}</button>
        </div>
        <div className="mt-3 space-y-2">
          {customProviders.map(provider => (
            <div
              key={provider.id}
              className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/30 px-3 py-2 dark:border-indigo-950/50 dark:bg-indigo-950/20"
            >
              <span className="h-2 w-2 rounded-full bg-indigo-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <b className="block truncate text-sm text-gray-800 dark:text-gray-100">{provider.name}</b>
                <span className="block truncate text-micro text-gray-400">{t("{0} · {1} 个模型", [provider.baseUrl, provider.models.length])}</span>
              </div>
              <button
                type="button"
                onClick={() => openCustom(provider)}
                className="mobile-touch rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {t("编辑")}</button>
              <button
                type="button"
                onClick={() => void deleteCustom(provider)}
                className="mobile-touch rounded-lg border border-transparent px-2.5 py-1 text-xs font-bold text-gray-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-900/40 dark:hover:bg-red-950/30 dark:hover:text-red-400"
              >
                {t("删除")}</button>
            </div>
          ))}

          {customProviders.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 py-6 text-center text-xs text-gray-400 dark:border-gray-800">
              {t("尚未连接 API")}</div>
          )}
        </div>
      </div>
      <section aria-label={t("生图协作")} className="appearance-panel rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">{t("生图协作")}</h3>
        <AgentGenerationOptions />
      </section>
    </div>
    )}

    {view !== 'home' && (
      <div
        ref={subViewRef}
        role="dialog"
        aria-modal="true"
        aria-label={view === 'model' ? t("选择助手模型") : (customDraft.id ? t("编辑 API 连接") : t("连接 API"))}
        data-agent-surface
        className="agent-theme appearance-surface agent-settings-subview absolute inset-0 z-[1100] flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950"
      >
      <header className="workspace-command-bar flex flex-none items-center gap-3 border-b border-gray-200 bg-white px-3 pt-[env(safe-area-inset-top)] dark:border-gray-800 dark:bg-gray-900 md:px-5">
        <button type="button" onClick={requestClose} className="mobile-touch flex items-center justify-center rounded-xl p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" aria-label={t("返回")}><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1"><h2 className="font-black text-gray-900 dark:text-white">{view === 'model' ? t("选择助手模型") : (customDraft.id ? t("编辑 API 连接") : t("连接 API"))}</h2></div>
        {view === 'model' && <button type="button" onClick={() => openCustom()} className="mobile-touch rounded-xl px-3 text-sm text-indigo-600 dark:text-indigo-300">{t("连接 API")}</button>}
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col p-3 md:p-5">
        {view === 'model' && <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t("搜索模型名称、ID或连接…")} className="mobile-touch w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm outline-none focus:border-indigo-500 dark:border-gray-800 dark:bg-gray-900" />}
        {view === 'custom' ? <CustomProviderForm value={customDraft} onChange={next => { if (next.baseUrl !== customDraft.baseUrl || next.apiKey !== customDraft.apiKey || next.api !== customDraft.api) setDiscoveredModels([]); setCustomDraft(next); setCustomResult(null); }} result={customResult} discovered={discoveredModels} busy={busy} onTest={() => void testCustom()} onFetch={() => void fetchCustom()} onSave={() => void saveCustom()} /> :
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {filteredModels.map(model => <button key={`${model.provider}/${model.id}`} type="button" disabled={busy} onClick={() => void selectModel(model)} className="flex min-h-16 w-full items-center gap-3 border-b border-gray-100 px-4 text-left last:border-0 hover:bg-indigo-50 dark:border-gray-800 dark:hover:bg-indigo-950/20"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${model.current ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400 dark:bg-gray-800'}`}>{model.current ? '✓' : '→'}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm text-gray-900 dark:text-white">{formatModelOptionTitle(model, models)}</b><span className="block truncate text-meta text-gray-500">{model.providerName || model.provider}</span></span><span className="hidden shrink-0 text-right text-micro leading-4 text-gray-500 dark:text-gray-400 sm:block">{t("上下文 ")}{formatContext(model.contextWindow)}<br />{model.reasoning ? t("推理") : model.capabilityDetection?.reasoning === 'unknown' ? t("推理未知") : t("普通")}{model.imageInput ? t(" · 图片") : model.capabilityDetection?.imageInput === 'unknown' ? t(" · 图片未知") : ''}</span></button>)}
            {!filteredModels.length && <div className="p-10 text-center text-sm text-gray-500">{query ? t("没有匹配结果") : t("还没有模型，请先连接 API")}</div>}
          </div>}
      </main>
    </div>)}
  </>;
};
