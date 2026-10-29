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
import { PromptLibrarySettings } from './PromptLibrarySettings';
import { AGENT_PROVIDER_PRESETS, type AgentProviderPreset } from '../services/agentProviders';

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
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsLoadError, setSettingsLoadError] = useState('');
  const settingsLoadedRef = useRef(false);
  const [view, setView] = useState<View>('home');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [creativeSaving, setCreativeSaving] = useState(false);
  const [rulesDraft, setRulesDraft] = useState('');
  const [rulesSaving, setRulesSaving] = useState(false);
  const [searchBaseUrl, setSearchBaseUrl] = useState('https://api.deepseek.com');
  const [searchKeyDraft, setSearchKeyDraft] = useState('');
  const [searchSaving, setSearchSaving] = useState(false);
  const [customResult, setCustomResult] = useState<PromptAgentProbeResult | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<PromptAgentCustomProvider['models']>([]);
  const [customDraft, setCustomDraft] = useState<PromptAgentCustomProvider>(emptyCustomProvider);
  // P2-17：子页覆盖层（全屏）的焦点管理：进入时移入、Tab 圈禁、返回 home 后归还。
  const subViewRef = useModalA11y<HTMLDivElement>(view !== 'home');

  const reload = async () => {
    const hasSnapshot = settingsLoadedRef.current;
    if (!hasSnapshot) { setSettingsLoading(true); setSettingsLoadError(''); }
    try {
      const [nextConfig, nextModels, nextCustomProviders] = await Promise.all([
        promptAgentService.getConfig(), promptAgentService.getAvailableModels(), promptAgentService.getCustomProviders(),
      ]);
      setConfig(nextConfig);
      setModels(nextModels);
      setCustomProviders(nextCustomProviders);
      settingsLoadedRef.current = true;
      setSettingsLoaded(true);
      setSettingsLoadError('');
      window.dispatchEvent(new CustomEvent('nai-agent-runtime-changed'));
    } catch (error) {
      if (!hasSnapshot) setSettingsLoadError('读取 AI 模型服务失败');
      throw error;
    } finally {
      if (!hasSnapshot) setSettingsLoading(false);
    }
  };

  useEffect(() => { void reload().catch(() => notify('读取 AI 模型服务失败', 'error')); }, []);
  useEffect(() => { setRulesDraft(config?.creativeDirectRules || ''); }, [config?.creativeDirectRules]);
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

  const setCreativeDirect = async (enabled: boolean) => {
    setCreativeSaving(true);
    try {
      const next = await promptAgentService.setCreativeDirect(enabled);
      setConfig(next);
      window.dispatchEvent(new CustomEvent('nai-agent-runtime-changed'));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('保存破限模式设置失败'), 'error');
    } finally { setCreativeSaving(false); }
  };

  const saveCreativeDirectRules = async (rules: string) => {
    setRulesSaving(true);
    try {
      const next = await promptAgentService.setCreativeDirectRules(rules);
      setConfig(next);
      window.dispatchEvent(new CustomEvent('nai-agent-runtime-changed'));
      notify(rules.trim() ? t('破限规则已保存') : t('已恢复内置默认规则'));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('保存破限规则失败'), 'error');
    } finally { setRulesSaving(false); }
  };

  useEffect(() => { setSearchBaseUrl(config?.searchApiBaseUrl || 'https://api.deepseek.com'); }, [config?.searchApiBaseUrl]);

  const saveSearchApi = async ({ enabled, baseUrl, apiKey }: { enabled?: boolean; baseUrl?: string; apiKey?: string }) => {
    setSearchSaving(true);
    try {
      const next = await promptAgentService.setSearchApi({
        enabled: enabled ?? config?.searchEnabled === true,
        baseUrl: baseUrl ?? config?.searchApiBaseUrl,
        ...(apiKey === undefined ? {} : { apiKey }),
      });
      setConfig(next);
      setSearchKeyDraft('');
      window.dispatchEvent(new CustomEvent('nai-agent-runtime-changed'));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('保存联网搜索设置失败'), 'error');
    } finally { setSearchSaving(false); }
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

  const savePreset = async (preset: AgentProviderPreset, apiKey: string) => {
    setBusy(true);
    try {
      // 预设连接使用稳定 ID，重复保存会更新同一条连接，而不是不断生成新 ID。
      const target = { id: `custom-${preset.id}-preset`, name: preset.name, baseUrl: preset.baseUrl, api: preset.api, apiKey, headers: {}, models: [] as PromptAgentCustomProvider['models'], select: true };
      const fetched = await promptAgentService.fetchCustomProviderModels(target);
      const first = fetched.models[0];
      if (!first) throw new Error('接口未返回任何模型');
      await promptAgentService.saveCustomProvider({ ...target, baseUrl: fetched.baseUrl || preset.baseUrl, models: [first] });
      await reload();
      notify('API 连接已保存并设为默认');
      closeView();
    } catch (error) { notify(error instanceof Error ? error.message : '保存自定义接口失败', 'error'); }
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
    if (!provider.id || !await confirmAction({ rememberKey: 'agent.provider.delete', title: `删除 ${provider.name}？`, message: '将删除这套接口配置和电脑中加密保存的密钥，不影响已有助手对话。', confirmLabel: '删除接口', tone: 'danger' })) return;
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
      <div className="appearance-group rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        {!settingsLoaded && settingsLoading && <p role="status" className="mb-3 text-xs text-gray-500">{t('正在读取模型列表…')}</p>}
        {!settingsLoaded && settingsLoadError && <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <span>{t(settingsLoadError)}</span>
          <button type="button" onClick={() => { void reload().catch(() => notify('读取 AI 模型服务失败', 'error')); }} className="mobile-touch shrink-0 rounded-lg px-2 py-1 font-bold underline">{t('重试')}</button>
        </div>}
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
        {settingsLoaded && <div className="mt-1.5 truncate text-base font-black text-gray-900 dark:text-white">{config?.configured ? displayModelName(currentModel?.name || config.model) : t("尚未配置模型服务")}</div>}
        {config?.configured && <div className="mt-1 text-xs text-gray-500">{t("{0} · {1} 个服务已配置", [(currentModel as { providerName?: string } | null)?.providerName || currentModel?.provider, config.configuredProviders.length])}</div>}
      </div>
      {config && agentRuntimeWarning(config) && <div role="status" className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{agentRuntimeWarning(config)}</div>}
      {config?.credentialWarning && <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{config.credentialWarning}</div>}

      {/* 阶段二：层级 3 - 模型服务管理区 */}
      <div className="appearance-group rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
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
                className="appearance-group mobile-touch rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
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

          {settingsLoaded && customProviders.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 py-6 text-center text-xs text-gray-400 dark:border-gray-800">
              {t("尚未连接 API")}</div>
          )}
        </div>
      </div>
      <section aria-label={t('联网搜索')} className="appearance-group rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
          <span className="text-sm font-bold text-gray-900 dark:text-white">{t('使用搜索 API')}</span>
          <input type="checkbox" checked={config?.searchEnabled === true}
            disabled={typeof config?.searchEnabled !== 'boolean' || busy || searchSaving}
            onChange={event => { void saveSearchApi({ enabled: event.target.checked }); }}
            className="h-5 w-5 shrink-0 rounded border-gray-300 accent-indigo-600 disabled:opacity-40" />
        </label>
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('开启后优先调用搜索服务（兼容 DeepSeek Search/Fetch 协议）；按成功请求计费，每 1000 次 5 元，失败、无结果或超时不收费，2026-11-01 前免费。')}</p>
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t('服务地址')}
            <input value={searchBaseUrl} onChange={event => setSearchBaseUrl(event.target.value)} placeholder="https://api.deepseek.com" className="mobile-touch mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-normal outline-none focus:border-indigo-400 dark:border-gray-800 dark:bg-gray-950" />
          </label>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t('API Key')}
            <input type="password" value={searchKeyDraft} onChange={event => setSearchKeyDraft(event.target.value)} placeholder={config?.searchApiKeyCustom ? t('已保存，留空保持不变') : t('可留空，自动使用同地址的已配置连接')} className="mobile-touch mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-normal outline-none focus:border-indigo-400 dark:border-gray-800 dark:bg-gray-950" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { void saveSearchApi({ baseUrl: searchBaseUrl, apiKey: searchKeyDraft.trim() ? searchKeyDraft : undefined }); }} disabled={searchSaving} className="mobile-touch rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40">{t('保存搜索设置')}</button>
            {config?.searchApiKeyCustom && <button type="button" onClick={() => { void saveSearchApi({ apiKey: '' }); }} disabled={searchSaving} className="appearance-group mobile-touch rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">{t('清除已保存 Key')}</button>}
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-gray-400 dark:text-gray-500">{config?.searchApiKeyCustom ? t('已保存搜索专用 Key。') : config?.searchApiKeyConfigured ? t('将使用同地址的已配置连接。') : t('未检测到可用 Key，开启后仍使用免费搜索。')}</p>
      </section>
      <section aria-label={t("生图协作")} className="appearance-group rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">{t("生图协作")}</h3>
        <AgentGenerationOptions />
      </section>
      <PromptLibrarySettings />
      <section aria-label={t('破限模式')} className="appearance-group rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
          <span className="text-sm font-bold text-gray-900 dark:text-white">{t('破限模式')}</span>
          <input type="checkbox" checked={config?.creativeDirect === true}
            disabled={typeof config?.creativeDirect !== 'boolean' || busy || creativeSaving}
            onChange={event => { void setCreativeDirect(event.target.checked); }}
            className="h-5 w-5 shrink-0 rounded border-gray-300 accent-indigo-600 disabled:opacity-40" />
        </label>
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('默认开启。开启后向助手注入创作向破限交付契约：直接给出可用成果，不以前置审查、说教或替代方案回避请求；工具权限与费用确认照常生效。')}</p>
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('保存后从下一次助手请求生效，不改变正在运行的任务或已有对话；本模式只约束输出内容与交付尺度，不改变工具权限、费用确认或模型服务端的审核过滤。')}</p>
        {config && <details className="mt-3">
          <summary className="mobile-touch cursor-pointer text-xs font-semibold text-indigo-600 dark:text-indigo-300">{t('查看与编辑破限规则')}</summary>
          <textarea
            value={rulesDraft}
            onChange={event => setRulesDraft(event.target.value)}
            disabled={rulesSaving}
            rows={10}
            aria-label={t('破限规则正文')}
            className="mt-2 w-full resize-y rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-5 text-gray-700 outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { void saveCreativeDirectRules(rulesDraft); }}
              disabled={rulesSaving || !rulesDraft.trim() || rulesDraft === (config.creativeDirectRules || '')}
              className="mobile-touch rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40">{t('保存规则')}</button>
            <button type="button" onClick={() => { void saveCreativeDirectRules(''); }}
              disabled={rulesSaving || !config.creativeDirectRulesCustom}
              className="appearance-group mobile-touch rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">{t('恢复内置默认')}</button>
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{config.creativeDirectRulesCustom ? t('当前使用自定义规则') : t('当前使用内置默认规则')}；{t('保存后从下一次助手任务生效。')}</p>
        </details>}
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
        className="appearance-panel appearance-overlay agent-theme agent-settings-subview absolute inset-0 z-[1100] flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950"
      >
      <header className="workspace-command-bar flex flex-none items-center gap-3 border-b border-gray-200 bg-white px-3 pt-[env(safe-area-inset-top)] dark:border-gray-800 dark:bg-gray-900 md:px-5">
        <button type="button" onClick={requestClose} className="mobile-touch flex items-center justify-center rounded-xl p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" aria-label={t("返回")}><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1"><h2 className="font-black text-gray-900 dark:text-white">{view === 'model' ? t("选择助手模型") : (customDraft.id ? t("编辑 API 连接") : t("连接 API"))}</h2></div>
        {view === 'model' && <button type="button" onClick={() => openCustom()} className="mobile-touch rounded-xl px-3 text-sm text-indigo-600 dark:text-indigo-300">{t("连接 API")}</button>}
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col p-3 md:p-5">
        {view === 'model' && <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t("搜索模型名称、ID或连接…")} className="mobile-touch w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm outline-none focus:border-indigo-500 dark:border-gray-800 dark:bg-gray-900" />}
        {view === 'custom' ? <CustomProviderForm value={customDraft} onChange={next => { if (next.baseUrl !== customDraft.baseUrl || next.apiKey !== customDraft.apiKey || next.api !== customDraft.api) setDiscoveredModels([]); setCustomDraft(next); setCustomResult(null); }} result={customResult} discovered={discoveredModels} busy={busy} onTest={() => void testCustom()} onFetch={() => void fetchCustom()} onSave={() => void saveCustom()} presets={AGENT_PROVIDER_PRESETS} onSavePreset={(preset, apiKey) => void savePreset(preset, apiKey)} /> :
          <div className="appearance-group mt-3 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {filteredModels.map(model => <button key={`${model.provider}/${model.id}`} type="button" disabled={busy} onClick={() => void selectModel(model)} className="flex min-h-16 w-full items-center gap-3 border-b border-gray-100 px-4 text-left last:border-0 hover:bg-indigo-50 dark:border-gray-800 dark:hover:bg-indigo-950/20"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${model.current ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400 dark:bg-gray-800'}`}>{model.current ? '✓' : '→'}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm text-gray-900 dark:text-white">{formatModelOptionTitle(model, models)}</b><span className="block truncate text-meta text-gray-500">{model.providerName || model.provider}</span></span><span className="hidden shrink-0 text-right text-micro leading-4 text-gray-500 dark:text-gray-400 sm:block">{t("上下文 ")}{formatContext(model.contextWindow)}<br />{model.reasoning ? t("推理") : model.capabilityDetection?.reasoning === 'unknown' ? t("推理未知") : t("普通")}{model.imageInput ? t(" · 图片") : model.capabilityDetection?.imageInput === 'unknown' ? t(" · 图片未知") : ''}</span></button>)}
            {!filteredModels.length && <div className="p-10 text-center text-sm text-gray-500">
              {!settingsLoaded && settingsLoading ? t('正在读取模型列表…') : !settingsLoaded && settingsLoadError ? <><p>{t(settingsLoadError)}</p><button type="button" onClick={() => { void reload().catch(() => notify('读取 AI 模型服务失败', 'error')); }} className="mobile-touch mt-3 rounded-lg px-3 py-2 font-bold text-indigo-600 underline dark:text-indigo-300">{t('重试')}</button></> : query ? t("没有匹配结果") : t("还没有模型，请先连接 API")}
            </div>}
          </div>}
      </main>
    </div>)}
  </>;
};
