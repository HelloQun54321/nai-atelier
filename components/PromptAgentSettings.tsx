import React, { useEffect, useMemo, useState } from 'react';
import { PromptAgentAuthPrompt, PromptAgentConfig, PromptAgentCustomProvider, PromptAgentModel, PromptAgentProvider, promptAgentService } from '../services/promptAgent';
import { useConfirmDialog } from './ConfirmDialog';
import { useMobileHistoryLayer } from './MobileUI';

interface PromptAgentSettingsProps {
  notify: (message: string, type?: 'success' | 'error') => void;
}

type View = 'home' | 'login' | 'logout' | 'model' | 'vision' | 'auth' | 'key' | 'custom';

const emptyCustomProvider = (): PromptAgentCustomProvider => ({
  name: '', baseUrl: '', api: 'openai-completions', apiKey: '', headers: {},
  models: [{ id: '', name: '', reasoning: false, imageInput: false, contextWindow: 128000, maxTokens: 16384 }],
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

const CustomProviderForm: React.FC<{
  value: PromptAgentCustomProvider;
  onChange: (value: PromptAgentCustomProvider) => void;
  busy: boolean;
  onTest: () => void;
  onFetch: () => void;
  onSave: () => void;
}> = ({ value, onChange, busy, onTest, onFetch, onSave }) => {
  const patchModel = (index: number, patch: Partial<PromptAgentCustomProvider['models'][number]>) => onChange({ ...value, models: value.models.map((model, modelIndex) => modelIndex === index ? { ...model, ...patch } : model) });
  const headerEntries = Object.entries(value.headers || {});
  const patchHeader = (index: number, name: string, headerValue: string) => {
    const next = Object.fromEntries(headerEntries.map((entry, entryIndex) => entryIndex === index ? [name, headerValue] : entry).filter(([key]) => key.trim()));
    onChange({ ...value, headers: next });
  };
  const ready = Boolean(value.name.trim() && value.baseUrl.trim() && value.models.some(model => model.id.trim()));
  const fetchReady = Boolean(value.name.trim() && value.baseUrl.trim());
  return <div className="min-h-0 flex-1 overflow-y-auto py-3">
    <div className="mx-auto max-w-2xl space-y-4 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 md:p-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-gray-600 dark:text-gray-300">接口名称<input value={value.name} onChange={event => onChange({ ...value, name: event.target.value })} placeholder="例如：我的中转站" className="mobile-touch mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm font-normal dark:border-gray-700 dark:bg-gray-950" /></label>
        <label className="text-xs font-bold text-gray-600 dark:text-gray-300">接口协议<select value={value.api} onChange={event => onChange({ ...value, api: event.target.value as PromptAgentCustomProvider['api'] })} className="mobile-touch mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm font-normal dark:border-gray-700 dark:bg-gray-950"><option value="openai-completions">OpenAI Chat / Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
      </div>
      <label className="block text-xs font-bold text-gray-600 dark:text-gray-300">Base URL<input value={value.baseUrl} onChange={event => onChange({ ...value, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" className="mobile-touch mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 font-mono text-sm font-normal dark:border-gray-700 dark:bg-gray-950" /><span className="mt-1 block font-normal text-gray-400">填写到版本路径，例如 OpenAI兼容接口通常以 /v1 结尾。HTTP 只允许本机回环地址，局域网或公网接口必须使用 HTTPS。</span></label>
      <label className="block text-xs font-bold text-gray-600 dark:text-gray-300">API Key<input type="password" value={value.apiKey || ''} onChange={event => onChange({ ...value, apiKey: event.target.value })} placeholder={value.id ? '留空则继续使用原密钥' : '本地无密钥服务可以留空'} autoComplete="new-password" className="mobile-touch mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 font-mono text-sm font-normal dark:border-gray-700 dark:bg-gray-950" /></label>
      <div className="rounded-2xl border border-gray-200 p-3 dark:border-gray-700">
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <b className="shrink-0 text-sm dark:text-white">附加请求头</b>
          <span className="min-w-0 flex-1 basis-44 text-[10px] leading-4 text-gray-400">例如 HTTP-Referer；敏感鉴权头请使用 API Key</span>
          <button type="button" onClick={() => onChange({ ...value, headers: { ...(value.headers || {}), [`X-Custom-${headerEntries.length + 1}`]: '' } })} className="mobile-touch ml-auto shrink-0 rounded-xl px-3 text-xs font-bold text-indigo-600">＋ 添加</button>
        </div>
        {headerEntries.length ? <div className="space-y-2">{headerEntries.map(([name, headerValue], index) => <div key={`${name}-${index}`} className="grid grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)_44px] gap-2"><input value={name} onChange={event => patchHeader(index, event.target.value, headerValue)} placeholder="请求头名称" className="mobile-touch min-w-0 rounded-xl border border-gray-300 bg-gray-50 px-3 font-mono text-xs dark:border-gray-700 dark:bg-gray-950"/><input value={headerValue} onChange={event => patchHeader(index, name, event.target.value)} placeholder="请求头值" className="mobile-touch min-w-0 rounded-xl border border-gray-300 bg-gray-50 px-3 font-mono text-xs dark:border-gray-700 dark:bg-gray-950"/><button type="button" onClick={() => onChange({ ...value, headers: Object.fromEntries(headerEntries.filter((_, entryIndex) => entryIndex !== index)) })} className="mobile-touch text-red-500" aria-label={`删除请求头 ${name}`}>×</button></div>)}</div> : <p className="text-[11px] text-gray-400">没有附加请求头。Authorization、Cookie、X-API-Key 等敏感字段不会保存在这里。</p>}
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <b className="shrink-0 text-sm dark:text-white">模型</b>
          <span className="min-w-0 flex-1 basis-36 text-[10px] leading-4 text-gray-400">可以为同一个接口添加多个模型</span>
          <button type="button" onClick={() => onChange({ ...value, models: [...value.models, { id: '', name: '', reasoning: false, imageInput: false, contextWindow: 128000, maxTokens: 16384 }] })} className="mobile-touch ml-auto shrink-0 rounded-xl bg-indigo-50 px-3 text-xs font-bold text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">＋ 添加模型</button>
        </div>
        <div className="space-y-3">{value.models.map((model, index) => <div key={index} className="rounded-2xl border border-gray-200 p-3 dark:border-gray-700">
          <div className="flex gap-2"><input value={model.id} onChange={event => patchModel(index, { id: event.target.value })} placeholder="模型 ID，例如 deepseek-chat" className="mobile-touch min-w-0 flex-1 rounded-xl border border-gray-300 bg-gray-50 px-3 font-mono text-sm dark:border-gray-700 dark:bg-gray-950" />{value.models.length > 1 && <button type="button" onClick={() => onChange({ ...value, models: value.models.filter((_, modelIndex) => modelIndex !== index) })} className="mobile-touch rounded-xl px-3 text-sm font-bold text-red-500">删除</button>}</div>
          <input value={model.name || ''} onChange={event => patchModel(index, { name: event.target.value })} placeholder="显示名称（可选）" className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm dark:border-gray-700 dark:bg-gray-950" />
          <div className="mt-2 grid grid-cols-2 gap-2"><label className="text-[11px] text-gray-500">上下文长度<input type="number" min="1024" value={model.contextWindow} onChange={event => patchModel(index, { contextWindow: Number(event.target.value) })} className="mobile-touch mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-2 text-sm dark:border-gray-700 dark:bg-gray-950" /></label><label className="text-[11px] text-gray-500">最大输出<input type="number" min="256" value={model.maxTokens} onChange={event => patchModel(index, { maxTokens: Number(event.target.value) })} className="mobile-touch mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-2 text-sm dark:border-gray-700 dark:bg-gray-950" /></label></div>
          <div className="mt-2 flex flex-wrap gap-4"><label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={model.imageInput} onChange={event => patchModel(index, { imageInput: event.target.checked, capabilityDetection: { imageInput: 'manual', reasoning: model.capabilityDetection?.reasoning || 'unknown' } })}/>支持识图</label><label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={model.reasoning} onChange={event => patchModel(index, { reasoning: event.target.checked, capabilityDetection: { imageInput: model.capabilityDetection?.imageInput || 'unknown', reasoning: 'manual' } })}/>支持推理</label></div>
          {model.capabilityDetection && <div className="mt-2 text-[10px] text-gray-400">能力来源：识图 {model.capabilityDetection.imageInput === 'manual' ? '人工' : '自动'} · 推理 {model.capabilityDetection.reasoning === 'manual' ? '人工' : '自动'}（仍可手动纠正）</div>}
        </div>)}</div>
      </div>
      <div className="flex gap-2 border-t border-gray-100 pt-4 dark:border-gray-800"><button type="button" disabled={busy || !fetchReady} onClick={onFetch} className="mobile-touch flex-1 rounded-xl border border-indigo-300 text-sm font-bold text-indigo-600 disabled:opacity-40 dark:border-indigo-800 dark:text-indigo-300">获取模型</button><button type="button" disabled={busy || !ready} onClick={onTest} className="mobile-touch flex-1 rounded-xl border border-indigo-300 text-sm font-bold text-indigo-600 disabled:opacity-40 dark:border-indigo-800 dark:text-indigo-300">测试连接</button><button type="button" disabled={busy || !ready} onClick={onSave} className="mobile-touch flex-[1.4] rounded-xl bg-indigo-600 text-sm font-bold text-white disabled:opacity-40">保存并选用</button></div>
      <p className="text-[10px] leading-4 text-gray-400">API Key只会加密保存在运行项目的电脑。「获取模型」会请求 /models 并自动识别能力；人工纠正的识图/推理标记不会被覆盖。「测试连接」还会执行一次极小文本与工具调用，可能产生少量模型费用；标记为识图的模型也会附带最小图片请求。两者均由电脑发起，不经过手机。</p>
    </div>
  </div>;
};

export const PromptAgentSettings: React.FC<PromptAgentSettingsProps> = ({ notify }) => {
  const confirmAction = useConfirmDialog();
  const [config, setConfig] = useState<PromptAgentConfig | null>(null);
  const [providers, setProviders] = useState<PromptAgentProvider[]>([]);
  const [customProviders, setCustomProviders] = useState<PromptAgentCustomProvider[]>([]);
  const [models, setModels] = useState<PromptAgentModel[]>([]);
  const [view, setView] = useState<View>('home');
  const [query, setQuery] = useState('');
  const [targetProvider, setTargetProvider] = useState<PromptAgentProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [loginAnswers, setLoginAnswers] = useState<string[]>([]);
  const [loginFlowId, setLoginFlowId] = useState('');
  const [loginAuthType, setLoginAuthType] = useState<'api_key' | 'oauth'>('api_key');
  const [loginPrompt, setLoginPrompt] = useState<PromptAgentAuthPrompt | null>(null);
  const [loginEvents, setLoginEvents] = useState<Array<{ type: string; message?: string; instructions?: string; url?: string; verificationUri?: string; userCode?: string; links?: Array<{ url: string; label?: string }> }>>([]);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customDraft, setCustomDraft] = useState<PromptAgentCustomProvider>(emptyCustomProvider);

  const reload = async () => {
    const [nextConfig, nextProviders, nextModels, nextCustomProviders] = await Promise.all([
      promptAgentService.getConfig(), promptAgentService.getProviders(), promptAgentService.getAvailableModels(), promptAgentService.getCustomProviders(),
    ]);
    setConfig(nextConfig);
    setProviders(nextProviders);
    setModels(nextModels);
    setCustomProviders(nextCustomProviders);
    window.dispatchEvent(new CustomEvent('nai-agent-runtime-changed'));
  };

  useEffect(() => { void reload().catch(() => notify('读取 AI 模型服务失败', 'error')); }, []);

  const filteredProviders = useMemo(() => providers.filter(provider => {
    if (provider.custom) return false;
    if (view === 'logout' && !provider.configured) return false;
    return fuzzyMatch(`${provider.name} ${provider.id} ${provider.authType === 'oauth' ? 'OAuth' : 'API key'}`, query);
  }), [providers, query, view]);
  const filteredModels = useMemo(() => models.filter(model => (view !== 'vision' || model.imageInput) && fuzzyMatch(`${model.name} ${model.id} ${model.provider}`, query)), [models, query, view]);

  const openView = (next: View) => { setQuery(''); setView(next); };
  const closeView = () => { setView('home'); setQuery(''); setTargetProvider(null); setApiKey(''); setLoginAnswers([]); setLoginFlowId(''); setLoginAuthType('api_key'); setLoginPrompt(null); setLoginEvents([]); setShowKey(false); };
  const requestClose = useMobileHistoryLayer(view !== 'home', closeView, 'prompt-agent-settings');

  useEffect(() => {
    if (view === 'home') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') view === 'key' ? (setView('login'), setApiKey('')) : requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view]);

  const advanceLogin = async (provider: PromptAgentProvider, answers: string[], authType = loginAuthType, flowId = loginFlowId) => {
    setBusy(true);
    try {
      setLoginAuthType(authType);
      const result = await promptAgentService.login(provider.id, answers, authType, flowId || undefined);
      if (result.complete) {
        await reload();
        notify(`${provider.name} 已配置`);
        closeView();
      } else {
        setTargetProvider(provider);
        setLoginAnswers(answers);
        if (result.flowId) setLoginFlowId(result.flowId);
        setLoginPrompt(result.prompt || null);
        setLoginEvents(result.events || []);
        setApiKey('');
        setView('key');
        if (authType === 'oauth' && result.flowId && !result.prompt) window.setTimeout(() => void advanceLogin(provider, [], authType, result.flowId), 1000);
      }
    } catch (error) { notify(error instanceof Error ? error.message : '登录失败', 'error'); }
    finally { setBusy(false); }
  };

  const startProviderLogin = (provider: PromptAgentProvider) => {
    setTargetProvider(provider);
    if (provider.authTypes.length > 1) { setView('auth'); return; }
    const authType = provider.authTypes[0] || provider.authType;
    void advanceLogin(provider, [], authType);
  };

  const submitLoginAnswer = (value = apiKey) => {
    if (!targetProvider || !value.trim()) return;
    void advanceLogin(targetProvider, [...loginAnswers, value.trim()]);
  };

  const logout = async (provider: PromptAgentProvider) => {
    if (!await confirmAction({ title: `退出 ${provider.name}？`, message: '将删除电脑中保存的这个模型服务凭据，不影响其他服务和 Agent 对话。', confirmLabel: '退出服务', tone: 'danger' })) return;
    setBusy(true);
    try { await promptAgentService.logout(provider.id); await reload(); notify(`已退出 ${provider.name}`); closeView(); }
    catch (error) { notify(error instanceof Error ? error.message : '退出失败', 'error'); }
    finally { setBusy(false); }
  };

  const selectModel = async (model: PromptAgentModel) => {
    setBusy(true);
    try { const next = await promptAgentService.selectModel(model.provider, model.id); setConfig(next); await reload(); notify(`Agent 模型已切换为 ${model.name}`); closeView(); }
    catch (error) { notify(error instanceof Error ? error.message : '切换模型失败', 'error'); }
    finally { setBusy(false); }
  };

  const selectVisionModel = async (model: PromptAgentModel) => {
    setBusy(true);
    try { const next = await promptAgentService.selectVisionModel(model.provider, model.id); setConfig(next); await reload(); notify(`视觉模型已切换为 ${model.name}`); closeView(); }
    catch (error) { notify(error instanceof Error ? error.message : '切换视觉模型失败', 'error'); }
    finally { setBusy(false); }
  };

  const selectVisionAuto = async () => {
    setBusy(true);
    try { const next = await promptAgentService.selectVisionAuto(); setConfig(next); await reload(); notify('视觉模型已改为自动匹配'); closeView(); }
    catch (error) { notify(error instanceof Error ? error.message : '启用自动视觉模型失败', 'error'); }
    finally { setBusy(false); }
  };

  const openCustom = (provider?: PromptAgentCustomProvider) => {
    setCustomDraft(provider ? { ...provider, apiKey: '', models: provider.models.map(model => ({ ...model })) } : emptyCustomProvider());
    setView('custom');
  };

  const saveCustom = async () => {
    setBusy(true);
    try { await promptAgentService.saveCustomProvider(customDraft); await reload(); notify('自定义接口已保存并选用'); closeView(); }
    catch (error) { notify(error instanceof Error ? error.message : '保存自定义接口失败', 'error'); }
    finally { setBusy(false); }
  };

  const testCustom = async () => {
    setBusy(true);
    try { const result = await promptAgentService.testCustomProvider(customDraft); notify(result.message); }
    catch (error) { notify(error instanceof Error ? error.message : '连接测试失败', 'error'); }
    finally { setBusy(false); }
  };

  const fetchCustom = async () => {
    setBusy(true);
    try {
      const result = await promptAgentService.fetchCustomProviderModels(customDraft);
      const existing = new Map(customDraft.models.filter(model => model.id.trim()).map(model => [model.id.trim().toLowerCase(), model]));
      const remoteIds = new Set(result.models.map(model => model.id.toLowerCase()));
      const merged = result.models.map(model => {
        const previous = existing.get(model.id.toLowerCase());
        if (!previous) return model;
        const manualImage = previous.capabilityDetection?.imageInput === 'manual';
        const manualReasoning = previous.capabilityDetection?.reasoning === 'manual';
        return {
          ...previous,
          ...model,
          imageInput: manualImage ? previous.imageInput : model.imageInput,
          reasoning: manualReasoning ? previous.reasoning : model.reasoning,
          capabilityDetection: {
            imageInput: manualImage ? 'manual' as const : model.capabilityDetection?.imageInput || 'unknown',
            reasoning: manualReasoning ? 'manual' as const : model.capabilityDetection?.reasoning || 'unknown',
          },
        };
      });
      merged.push(...[...existing.entries()].filter(([id]) => !remoteIds.has(id)).map(([, model]) => model));
      setCustomDraft(previous => ({ ...previous, models: merged }));
      const visionCount = result.models.filter(model => model.imageInput).length;
      const reasoningCount = result.models.filter(model => model.reasoning).length;
      notify(`已识别 ${result.models.length} 个模型：${visionCount} 个支持识图，${reasoningCount} 个支持推理；无法确认的能力保持关闭，可手动纠正`);
    } catch (error) { notify(error instanceof Error ? error.message : '获取模型失败', 'error'); }
    finally { setBusy(false); }
  };

  const deleteCustom = async (provider: PromptAgentCustomProvider) => {
    if (!provider.id || !await confirmAction({ title: `删除 ${provider.name}？`, message: '将删除这套接口配置和电脑中加密保存的密钥，不影响已有 Agent 对话。', confirmLabel: '删除接口', tone: 'danger' })) return;
    setBusy(true);
    try { await promptAgentService.deleteCustomProvider(provider.id); await reload(); notify('自定义接口已删除'); }
    catch (error) { notify(error instanceof Error ? error.message : '删除失败', 'error'); }
    finally { setBusy(false); }
  };

  const currentModel = models.find(model => model.current) || (config ? { id: config.model, name: config.model, provider: config.provider } : null);
  const currentVisionModel = models.find(model => model.currentVision) || (config?.visionAvailable ? { id: config.visionModel, name: config.visionModel, provider: config.visionProvider } : null);
  const configured = providers.filter(provider => provider.configured);

  return <>
    <div className="mt-3 space-y-3">
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/60">
          <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-500">当前 Agent 模型</div>
          <div className="mt-1 truncate text-base font-black text-gray-900 dark:text-white">{config?.configured ? currentModel?.name || config.model : '尚未配置模型服务'}</div>
          {config?.configured && <div className="mt-1 text-xs text-gray-500">{currentModel?.provider} · {config.configuredProviders.length} 个服务已配置</div>}
          {config?.visionAvailable && <div className="mt-2 border-t border-gray-200 pt-2 text-xs text-gray-500 dark:border-gray-800">视觉模型：<b className="text-gray-700 dark:text-gray-200">{currentVisionModel?.name || config.visionModel}</b> · {currentVisionModel?.provider}{config.visionDedicated ? ' · 独立分析' : ' · 跟随主模型'} · {config.visionMode === 'auto' ? '自动匹配' : '手动固定'}</div>}
        </div>
        {config?.credentialWarning && <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{config.credentialWarning}</div>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <button type="button" onClick={() => openView('login')} className="mobile-touch rounded-xl border border-gray-200 bg-white px-3 text-left text-sm font-bold text-gray-800 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"><span className="mr-2 text-emerald-500">＋</span>登录模型服务</button>
        <button type="button" disabled={configured.length === 0} onClick={() => openView('model')} className="mobile-touch rounded-xl border border-gray-200 bg-white px-3 text-left text-sm font-bold text-gray-800 shadow-sm disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"><span className="mr-2 text-indigo-500">◆</span>选择模型</button>
        <button type="button" disabled={!models.some(model => model.imageInput)} onClick={() => openView('vision')} className="mobile-touch rounded-xl border border-violet-200 bg-white px-3 text-left text-sm font-bold text-gray-800 shadow-sm disabled:opacity-40 dark:border-violet-900 dark:bg-gray-900 dark:text-gray-100"><span className="mr-2 text-violet-500">◉</span>选择视觉模型</button>
        <button type="button" disabled={configured.length === 0} onClick={() => openView('logout')} className="mobile-touch rounded-xl border border-gray-200 bg-white px-3 text-left text-sm font-bold text-gray-800 shadow-sm disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"><span className="mr-2 text-red-500">−</span>退出模型服务</button>
        <button type="button" onClick={() => openCustom()} className="mobile-touch rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-left text-sm font-bold text-indigo-700 shadow-sm dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300"><span className="mr-2">⌁</span>添加自定义接口</button>
      </div>
      {customProviders.length > 0 && <div className="rounded-2xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900"><div className="px-2 py-1 text-[11px] font-bold text-gray-400">自定义接口</div>{customProviders.map(provider => <div key={provider.id} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"><span className="h-2.5 w-2.5 rounded-full bg-indigo-500"/><div className="min-w-0 flex-1"><b className="block truncate text-sm dark:text-white">{provider.name}</b><span className="block truncate text-[10px] text-gray-400">{provider.baseUrl} · {provider.models.length} 个模型</span></div><button type="button" onClick={() => openCustom(provider)} className="mobile-touch rounded-xl px-3 text-xs font-bold text-indigo-600">编辑</button><button type="button" onClick={() => void deleteCustom(provider)} className="mobile-touch rounded-xl px-3 text-xs font-bold text-red-500">删除</button></div>)}</div>}
      {configured.length > 0 && <div className="flex flex-wrap gap-1.5">{configured.map(provider => <span key={provider.id} className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">✓ {provider.name}</span>)}</div>}
      <p className="text-[11px] leading-5 text-gray-500 dark:text-gray-400">这里选择的是新对话默认主模型；已有对话在对话顶部单独切换。视觉模型会按每个对话的主模型独立解析，可分析附件与历史原图。Agent 还可受限搜索公网并读取搜索结果，不能访问本机或局域网地址。密钥加密保存在电脑，不进入浏览器存储。</p>
    </div>

    {view !== 'home' && <div className="fixed inset-0 z-[1700] flex flex-col bg-gray-50 dark:bg-gray-950">
      <header className="flex min-h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-3 border-b border-gray-200 bg-white px-3 pt-[env(safe-area-inset-top)] dark:border-gray-800 dark:bg-gray-900 md:px-5">
        <button type="button" onClick={view === 'key' ? () => { setView('login'); setApiKey(''); } : requestClose} className="mobile-touch flex items-center justify-center text-gray-500" aria-label="返回"><svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7 7-7m-7 7h18" /></svg></button>
        <div className="min-w-0 flex-1"><h2 className="font-black text-gray-900 dark:text-white">{view === 'login' ? '选择要配置的服务' : view === 'logout' ? '选择要退出的服务' : view === 'model' ? '选择 Agent 模型' : view === 'vision' ? '选择视觉模型' : view === 'auth' ? '选择登录方式' : view === 'custom' ? (customDraft.id ? '编辑自定义接口' : '添加自定义接口') : `登录 ${targetProvider?.name || ''}`}</h2><p className="text-[11px] text-gray-500">{view === 'model' ? '主模型负责推理和调用工具' : view === 'vision' ? '只显示支持图片输入的已配置模型' : view === 'key' ? (loginAuthType === 'oauth' ? '按 pi 的 OAuth 流程完成登录' : '使用 API Key 登录') : view === 'custom' ? '由 Pi 作为正式 Provider运行，不是简单转发器' : view === 'auth' ? targetProvider?.name : '输入文字可立即筛选'}</p></div>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col p-3 md:p-5">
        {view !== 'key' && view !== 'auth' && view !== 'custom' && <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={view === 'model' || view === 'vision' ? '搜索模型名称、ID或供应商…' : '搜索模型服务…'} className="mobile-touch w-full rounded-2xl border border-gray-300 bg-white px-4 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-900" />}
        {view === 'custom' ? <CustomProviderForm value={customDraft} onChange={setCustomDraft} busy={busy} onTest={() => void testCustom()} onFetch={() => void fetchCustom()} onSave={() => void saveCustom()} /> : view === 'auth' ? <div className="mx-auto mt-10 w-full max-w-md space-y-3 rounded-3xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900"><p className="text-sm font-black dark:text-white">{targetProvider?.name}</p>{targetProvider?.authTypes.map(authType => <button key={authType} type="button" disabled={busy} onClick={() => void advanceLogin(targetProvider, [], authType)} className="mobile-touch w-full rounded-xl border border-gray-200 px-4 text-left text-sm font-bold hover:border-indigo-500 dark:border-gray-700">{authType === 'oauth' ? 'OAuth / 订阅账号登录' : 'API Key 登录'}</button>)}</div> : view === 'key' ? <div className="mx-auto mt-10 w-full max-w-md rounded-3xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900 md:p-6"><div className="text-sm font-black text-gray-900 dark:text-white">{targetProvider?.name}</div><p className="mt-1 text-xs leading-5 text-gray-500">{loginPrompt?.message || '正在准备登录…'}</p>{loginEvents.map((event, index) => <div key={index} className="mt-3 rounded-xl bg-indigo-50 p-3 text-xs leading-5 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">{event.message}{event.instructions && <div>{event.instructions}</div>}{event.url && <a href={event.url} target="_blank" rel="noreferrer" className="mt-1 block break-all font-bold underline">打开授权页面</a>}{event.verificationUri && <a href={event.verificationUri} target="_blank" rel="noreferrer" className="mt-1 block break-all font-bold underline">打开设备授权页面</a>}{event.userCode && <div className="mt-1 font-mono font-black">设备码：{event.userCode}</div>}{event.links?.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="mt-1 block break-all font-bold underline">{link.label || link.url}</a>)}</div>)}{loginPrompt?.type === 'select' ? <div className="mt-4 space-y-2">{loginPrompt.options.map(option => <button key={option.id} type="button" disabled={busy} onClick={() => submitLoginAnswer(option.id)} className="mobile-touch w-full rounded-xl border border-gray-200 px-3 text-left text-sm font-bold hover:border-indigo-500 dark:border-gray-700"><span className="block">{option.label}</span>{option.description && <span className="mt-0.5 block text-[11px] font-normal text-gray-500">{option.description}</span>}</button>)}</div> : <><div className="mt-4 flex gap-2"><input autoFocus type={loginPrompt?.type === 'secret' && !showKey ? 'password' : 'text'} value={apiKey} onChange={event => setApiKey(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submitLoginAnswer(); }} placeholder={loginPrompt?.placeholder || '请输入'} autoComplete="new-password" className="mobile-touch min-w-0 flex-1 rounded-xl border border-gray-300 bg-gray-50 px-3 font-mono text-sm dark:border-gray-700 dark:bg-gray-950" />{loginPrompt?.type === 'secret' && <button type="button" onClick={() => setShowKey(value => !value)} className="mobile-touch rounded-xl border border-gray-300 px-3 text-sm dark:border-gray-700">{showKey ? '隐藏' : '显示'}</button>}</div><button type="button" disabled={busy || !apiKey.trim()} onClick={() => submitLoginAnswer()} className="mobile-touch mt-4 w-full rounded-xl bg-indigo-600 text-sm font-bold text-white disabled:opacity-40">{busy ? '继续…' : '继续'}</button></>}<p className="mt-4 text-[11px] leading-5 text-gray-400">登录步骤由 pi Provider提供；最终凭据只加密保存到运行本项目的电脑。</p></div> :
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {view === 'vision' && <button type="button" disabled={busy} onClick={() => void selectVisionAuto()} className="flex min-h-16 w-full items-center gap-3 border-b border-violet-100 bg-violet-50/60 px-4 text-left hover:bg-violet-100 disabled:opacity-40 dark:border-violet-900 dark:bg-violet-950/20 dark:hover:bg-violet-950/40"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${config?.visionMode === 'auto' ? 'bg-violet-600 text-white' : 'bg-white text-violet-500 dark:bg-gray-800'}`}>{config?.visionMode === 'auto' ? '✓' : '↻'}</span><span><b className="block text-sm text-gray-900 dark:text-white">自动匹配视觉模型</b><span className="block text-[11px] text-gray-500">主模型不能识图时，优先选择同一接口的多模态模型，再从其他已配置接口中选择</span></span></button>}
            {(view === 'model' || view === 'vision' ? filteredModels : filteredProviders).map(item => view === 'model' || view === 'vision' ? (() => { const model = item as PromptAgentModel; const selected = view === 'vision' ? model.currentVision : model.current; return <button key={`${model.provider}/${model.id}`} type="button" disabled={busy} onClick={() => void (view === 'vision' ? selectVisionModel(model) : selectModel(model))} className="flex min-h-16 w-full items-center gap-3 border-b border-gray-100 px-4 text-left last:border-0 hover:bg-indigo-50 dark:border-gray-800 dark:hover:bg-indigo-950/20"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${selected ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400 dark:bg-gray-800'}`}>{selected ? '✓' : '→'}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm text-gray-900 dark:text-white">{model.id}</b><span className="block truncate text-[11px] text-gray-500">[{model.provider}] {model.name}</span></span><span className="hidden shrink-0 text-right text-[10px] leading-4 text-gray-400 sm:block">上下文 {formatContext(model.contextWindow)}<br />{model.reasoning ? '推理' : '普通'}{model.imageInput ? ' · 识图' : ''}</span></button>; })() : (() => { const provider = item as PromptAgentProvider; return <button key={provider.id} type="button" disabled={busy} onClick={() => view === 'logout' ? void logout(provider) : startProviderLogin(provider)} className="flex min-h-16 w-full items-center gap-3 border-b border-gray-100 px-4 text-left last:border-0 hover:bg-indigo-50 dark:border-gray-800 dark:hover:bg-indigo-950/20"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${provider.configured ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} /><span className="min-w-0 flex-1"><b className="block truncate text-sm text-gray-900 dark:text-white">{provider.name}</b><span className="block truncate text-[11px] text-gray-500">{provider.id} · {provider.authTypes.map(value => value === 'oauth' ? 'OAuth' : 'API key').join(' / ')} · {provider.modelCount} 个模型</span></span><span className={`shrink-0 text-xs font-bold ${provider.configured ? 'text-emerald-600' : 'text-gray-400'}`}>{provider.configured ? '✓ 已配置' : '未配置'}</span></button>; })())}
            {(view === 'model' || view === 'vision' ? filteredModels : filteredProviders).length === 0 && <div className="p-10 text-center text-sm text-gray-500">{query ? '没有匹配结果' : view === 'vision' ? '没有支持识图的模型，请先配置模型服务' : view === 'model' ? '没有可用模型，请先登录模型服务' : '没有可用服务'}</div>}
          </div>}
      </main>
    </div>}
  </>;
};
