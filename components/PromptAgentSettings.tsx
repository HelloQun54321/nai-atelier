import React, { useEffect, useMemo, useState } from 'react';
import { PromptAgentAuthPrompt, PromptAgentConfig, PromptAgentModel, PromptAgentProvider, promptAgentService } from '../services/promptAgent';
import { useConfirmDialog } from './ConfirmDialog';
import { useMobileHistoryLayer } from './MobileUI';

interface PromptAgentSettingsProps {
  notify: (message: string, type?: 'success' | 'error') => void;
}

type View = 'home' | 'login' | 'logout' | 'model' | 'auth' | 'key';

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

export const PromptAgentSettings: React.FC<PromptAgentSettingsProps> = ({ notify }) => {
  const confirmAction = useConfirmDialog();
  const [config, setConfig] = useState<PromptAgentConfig | null>(null);
  const [providers, setProviders] = useState<PromptAgentProvider[]>([]);
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

  const reload = async () => {
    const [nextConfig, nextProviders, nextModels] = await Promise.all([
      promptAgentService.getConfig(), promptAgentService.getProviders(), promptAgentService.getAvailableModels(),
    ]);
    setConfig(nextConfig);
    setProviders(nextProviders);
    setModels(nextModels);
  };

  useEffect(() => { void reload().catch(() => notify('读取 AI 模型服务失败', 'error')); }, []);

  const filteredProviders = useMemo(() => providers.filter(provider => {
    if (view === 'logout' && !provider.configured) return false;
    return fuzzyMatch(`${provider.name} ${provider.id} ${provider.authType === 'oauth' ? 'OAuth' : 'API key'}`, query);
  }), [providers, query, view]);
  const filteredModels = useMemo(() => models.filter(model => fuzzyMatch(`${model.name} ${model.id} ${model.provider}`, query)), [models, query]);

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

  const currentModel = models.find(model => model.current) || (config ? { id: config.model, name: config.model, provider: config.provider } : null);
  const configured = providers.filter(provider => provider.configured);

  return <>
    <div className="mt-3 space-y-3">
      <div className="rounded-2xl border border-fuchsia-100 bg-gradient-to-br from-fuchsia-50 to-indigo-50 p-4 dark:border-fuchsia-950 dark:from-fuchsia-950/30 dark:to-indigo-950/30">
        <div className="text-[11px] font-bold uppercase tracking-wider text-fuchsia-500">当前 Agent 模型</div>
        <div className="mt-1 truncate text-base font-black text-gray-900 dark:text-white">{config?.configured ? currentModel?.name || config.model : '尚未配置模型服务'}</div>
        {config?.configured && <div className="mt-1 text-xs text-gray-500">{currentModel?.provider} · {config.configuredProviders.length} 个服务已配置</div>}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button type="button" onClick={() => openView('login')} className="mobile-touch rounded-xl border border-gray-200 bg-white px-3 text-left text-sm font-bold text-gray-800 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"><span className="mr-2 text-emerald-500">＋</span>登录模型服务</button>
        <button type="button" disabled={configured.length === 0} onClick={() => openView('model')} className="mobile-touch rounded-xl border border-gray-200 bg-white px-3 text-left text-sm font-bold text-gray-800 shadow-sm disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"><span className="mr-2 text-indigo-500">◆</span>选择模型</button>
        <button type="button" disabled={configured.length === 0} onClick={() => openView('logout')} className="mobile-touch rounded-xl border border-gray-200 bg-white px-3 text-left text-sm font-bold text-gray-800 shadow-sm disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"><span className="mr-2 text-red-500">−</span>退出模型服务</button>
      </div>
      {configured.length > 0 && <div className="flex flex-wrap gap-1.5">{configured.map(provider => <span key={provider.id} className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">✓ {provider.name}</span>)}</div>}
      <p className="text-[11px] leading-5 text-gray-500 dark:text-gray-400">按 pi 官方逻辑分开管理：先登录供应商，再从已配置供应商中选择模型。密钥加密保存在电脑，不进入浏览器存储。</p>
    </div>

    {view !== 'home' && <div className="fixed inset-0 z-[1700] flex flex-col bg-gray-50 dark:bg-gray-950">
      <header className="flex min-h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-3 border-b border-gray-200 bg-white px-3 pt-[env(safe-area-inset-top)] dark:border-gray-800 dark:bg-gray-900 md:px-5">
        <button type="button" onClick={view === 'key' ? () => { setView('login'); setApiKey(''); } : requestClose} className="mobile-touch flex items-center justify-center text-gray-500" aria-label="返回"><svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7 7-7m-7 7h18" /></svg></button>
        <div className="min-w-0 flex-1"><h2 className="font-black text-gray-900 dark:text-white">{view === 'login' ? '选择要配置的服务' : view === 'logout' ? '选择要退出的服务' : view === 'model' ? '选择 Agent 模型' : view === 'auth' ? '选择登录方式' : `登录 ${targetProvider?.name || ''}`}</h2><p className="text-[11px] text-gray-500">{view === 'model' ? '仅显示已经配置凭据的供应商' : view === 'key' ? (loginAuthType === 'oauth' ? '按 pi 的 OAuth 流程完成登录' : '使用 API Key 登录') : view === 'auth' ? targetProvider?.name : '输入文字可立即筛选'}</p></div>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col p-3 md:p-5">
        {view !== 'key' && view !== 'auth' && <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={view === 'model' ? '搜索模型名称、ID或供应商…' : '搜索模型服务…'} className="mobile-touch w-full rounded-2xl border border-gray-300 bg-white px-4 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-900" />}
        {view === 'auth' ? <div className="mx-auto mt-10 w-full max-w-md space-y-3 rounded-3xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900"><p className="text-sm font-black dark:text-white">{targetProvider?.name}</p>{targetProvider?.authTypes.map(authType => <button key={authType} type="button" disabled={busy} onClick={() => void advanceLogin(targetProvider, [], authType)} className="mobile-touch w-full rounded-xl border border-gray-200 px-4 text-left text-sm font-bold hover:border-indigo-500 dark:border-gray-700">{authType === 'oauth' ? 'OAuth / 订阅账号登录' : 'API Key 登录'}</button>)}</div> : view === 'key' ? <div className="mx-auto mt-10 w-full max-w-md rounded-3xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900 md:p-6"><div className="text-sm font-black text-gray-900 dark:text-white">{targetProvider?.name}</div><p className="mt-1 text-xs leading-5 text-gray-500">{loginPrompt?.message || '正在准备登录…'}</p>{loginEvents.map((event, index) => <div key={index} className="mt-3 rounded-xl bg-indigo-50 p-3 text-xs leading-5 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">{event.message}{event.instructions && <div>{event.instructions}</div>}{event.url && <a href={event.url} target="_blank" rel="noreferrer" className="mt-1 block break-all font-bold underline">打开授权页面</a>}{event.verificationUri && <a href={event.verificationUri} target="_blank" rel="noreferrer" className="mt-1 block break-all font-bold underline">打开设备授权页面</a>}{event.userCode && <div className="mt-1 font-mono font-black">设备码：{event.userCode}</div>}{event.links?.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="mt-1 block break-all font-bold underline">{link.label || link.url}</a>)}</div>)}{loginPrompt?.type === 'select' ? <div className="mt-4 space-y-2">{loginPrompt.options.map(option => <button key={option.id} type="button" disabled={busy} onClick={() => submitLoginAnswer(option.id)} className="mobile-touch w-full rounded-xl border border-gray-200 px-3 text-left text-sm font-bold hover:border-indigo-500 dark:border-gray-700"><span className="block">{option.label}</span>{option.description && <span className="mt-0.5 block text-[11px] font-normal text-gray-500">{option.description}</span>}</button>)}</div> : <><div className="mt-4 flex gap-2"><input autoFocus type={loginPrompt?.type === 'secret' && !showKey ? 'password' : 'text'} value={apiKey} onChange={event => setApiKey(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submitLoginAnswer(); }} placeholder={loginPrompt?.placeholder || '请输入'} autoComplete="new-password" className="mobile-touch min-w-0 flex-1 rounded-xl border border-gray-300 bg-gray-50 px-3 font-mono text-sm dark:border-gray-700 dark:bg-gray-950" />{loginPrompt?.type === 'secret' && <button type="button" onClick={() => setShowKey(value => !value)} className="mobile-touch rounded-xl border border-gray-300 px-3 text-sm dark:border-gray-700">{showKey ? '隐藏' : '显示'}</button>}</div><button type="button" disabled={busy || !apiKey.trim()} onClick={() => submitLoginAnswer()} className="mobile-touch mt-4 w-full rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-sm font-bold text-white disabled:opacity-40">{busy ? '继续…' : '继续'}</button></>}<p className="mt-4 text-[11px] leading-5 text-gray-400">登录步骤由 pi Provider提供；最终凭据只加密保存到运行本项目的电脑。</p></div> :
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {(view === 'model' ? filteredModels : filteredProviders).map(item => view === 'model' ? (() => { const model = item as PromptAgentModel; return <button key={`${model.provider}/${model.id}`} type="button" disabled={busy} onClick={() => void selectModel(model)} className="flex min-h-16 w-full items-center gap-3 border-b border-gray-100 px-4 text-left last:border-0 hover:bg-indigo-50 dark:border-gray-800 dark:hover:bg-indigo-950/20"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${model.current ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400 dark:bg-gray-800'}`}>{model.current ? '✓' : '→'}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm text-gray-900 dark:text-white">{model.id}</b><span className="block truncate text-[11px] text-gray-500">[{model.provider}] {model.name}</span></span><span className="hidden shrink-0 text-right text-[10px] leading-4 text-gray-400 sm:block">上下文 {formatContext(model.contextWindow)}<br />{model.reasoning ? '推理' : '普通'}{model.imageInput ? ' · 识图' : ''}</span></button>; })() : (() => { const provider = item as PromptAgentProvider; return <button key={provider.id} type="button" disabled={busy} onClick={() => view === 'logout' ? void logout(provider) : startProviderLogin(provider)} className="flex min-h-16 w-full items-center gap-3 border-b border-gray-100 px-4 text-left last:border-0 hover:bg-fuchsia-50 dark:border-gray-800 dark:hover:bg-fuchsia-950/20"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${provider.configured ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} /><span className="min-w-0 flex-1"><b className="block truncate text-sm text-gray-900 dark:text-white">{provider.name}</b><span className="block truncate text-[11px] text-gray-500">{provider.id} · {provider.authTypes.map(value => value === 'oauth' ? 'OAuth' : 'API key').join(' / ')} · {provider.modelCount} 个模型</span></span><span className={`shrink-0 text-xs font-bold ${provider.configured ? 'text-emerald-600' : 'text-gray-400'}`}>{provider.configured ? '✓ 已配置' : '未配置'}</span></button>; })())}
            {(view === 'model' ? filteredModels : filteredProviders).length === 0 && <div className="p-10 text-center text-sm text-gray-500">{query ? '没有匹配结果' : view === 'model' ? '没有可用模型，请先登录模型服务' : '没有可用服务'}</div>}
          </div>}
      </main>
    </div>}
  </>;
};
