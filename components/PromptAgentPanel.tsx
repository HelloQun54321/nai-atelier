import React, { useEffect, useRef, useState } from 'react';
import { PromptAgentAction, PromptAgentDraft, PromptChain } from '../types';
import { promptAgentService } from '../services/promptAgent';
import { vibeService } from '../services/vibeService';
import { useMobileHistoryLayer } from './MobileUI';
import { useConfirmDialog } from './ConfirmDialog';
import { getMobileImageDisplayPreferences, setMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { clearMobileThumbnailCache, getMobileCacheStats, setMobileCacheLimitMb } from '../services/mobileImageCache';

interface PromptAgentPanelProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  draft: PromptAgentDraft;
  presets: PromptChain[];
  apiKey: string;
  onRunStart: (snapshot: PromptAgentDraft) => void;
  onAction: (action: PromptAgentAction) => void;
  onFinalDraft: (draft: PromptAgentDraft) => void;
  onRequestGeneration: (draft: PromptAgentDraft, reason?: string) => void;
  onUndo: () => void;
  canUndo: boolean;
}

type ToolProgress = { name: string; state: 'running' | 'done' | 'error' };
type PanelMessage = { id: string; role: 'user' | 'agent' | 'error'; text: string; tools?: ToolProgress[] };
const toolLabels: Record<string, string> = {
  get_lab_state: '读取实验室', search_tags: '搜索 Tag', search_presets: '搜索预设', search_vibes: '搜索 Vibe',
  update_prompts: '修改提示词', set_prompt_modules: '整理提示词模块', set_characters: '设置角色',
  set_generation_params: '调整参数', set_vibes: '设置 Vibe', request_generation: '准备生图',
  get_project_overview: '读取项目概况', search_project_library: '搜索项目资料', list_generation_history: '读取生成历史',
  inspect_generation_image: '查看历史原图', create_chain: '新建资料', update_chain: '更新资料',
  create_inspiration: '保存灵感', update_inspiration: '更新灵感', list_vibe_groups: '读取 Vibe 组合',
  request_delete_project_item: '准备删除', request_clear_history: '准备清空历史',
  search_aitag: '搜索 AITag', get_aitag_work: '读取 AITag 作品', save_artist_profile: '保存画师资料',
  update_vibe: '更新 Vibe', save_vibe_group: '保存 Vibe 组合', request_vibe_encoding: '准备 Vibe 编码',
  get_project_settings: '读取项目设置', set_anlas_budget: '设置 Anlas 预算', set_cloud_queue: '设置拼车队列',
  set_artist_benchmark_config: '设置画师基准图', update_tag_dictionary: '更新 Tag 词库', manage_aitag: '管理 AITag', set_client_preferences: '调整界面偏好', navigate_view: '切换页面',
};

const renderInlineMarkdown = (value: string, keyPrefix: string): React.ReactNode[] => {
  const parts = value.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g);
  return parts.filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key} className="rounded bg-gray-100 px-1 py-0.5 text-[.92em] dark:bg-gray-800">{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={key} href={link[2]} target="_blank" rel="noreferrer" className="font-bold text-indigo-600 underline dark:text-indigo-300">{link[1]}</a>;
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
};

const AgentMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let inCode = false;
  const output: React.ReactNode[] = [];
  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) { inCode = !inCode; return; }
    if (inCode) { output.push(<code key={index} className="block whitespace-pre-wrap font-mono text-xs">{line || ' '}</code>); return; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { output.push(<div key={index} className="mt-2 font-black first:mt-0">{renderInlineMarkdown(heading[2], `h-${index}`)}</div>); return; }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) { output.push(<div key={index} className="flex gap-2"><span aria-hidden="true">•</span><span>{renderInlineMarkdown(bullet[1], `b-${index}`)}</span></div>); return; }
    const ordered = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (ordered) { output.push(<div key={index} className="flex gap-2"><span className="shrink-0">{ordered[1]}.</span><span>{renderInlineMarkdown(ordered[2], `o-${index}`)}</span></div>); return; }
    output.push(line ? <div key={index}>{renderInlineMarkdown(line, `p-${index}`)}</div> : <div key={index} className="h-2" />);
  });
  return <>{output}</>;
};

export const PromptAgentPanel: React.FC<PromptAgentPanelProps> = props => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [modelLabel, setModelLabel] = useState('');
  const [followingBottom, setFollowingBottom] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);
  const loadedSessionRef = useRef('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followBottomRef = useRef(true);
  const confirmAction = useConfirmDialog();
  const closePanel = () => {
    controllerRef.current?.abort();
    props.onClose();
  };
  const requestClose = useMobileHistoryLayer(props.open, closePanel, 'prompt-agent');

  useEffect(() => {
    if (!props.open || loadedSessionRef.current === props.sessionId || messages.length > 0) return;
    loadedSessionRef.current = props.sessionId;
    void promptAgentService.getSession(props.sessionId).then(items => setMessages(items)).catch(() => {});
  }, [props.open, props.sessionId]);

  useEffect(() => {
    if (!props.open) return;
    void promptAgentService.getConfig().then(config => setModelLabel(config.configured ? `${config.model} [${config.provider}] · ${config.imageInput ? '支持识图' : '不支持识图'}` : '尚未配置模型服务')).catch(() => setModelLabel('配置读取失败'));
  }, [props.open]);

  useEffect(() => {
    if (!props.open || !followBottomRef.current) return;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: running ? 'auto' : 'smooth' }));
  }, [messages, running, props.open]);

  useEffect(() => {
    if (!props.open) return;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closePanel(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [props.open]);

  if (!props.open) return null;

  const run = async (suggestion?: string) => {
    const prompt = (suggestion ?? input).trim();
    if (!prompt || running) return;
    const assistantId = crypto.randomUUID();
    setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'user', text: prompt }, { id: assistantId, role: 'agent', text: '' }]);
    setInput('');
    setRunning(true);
    const runSnapshot = structuredClone(props.draft);
    let labChanged = false;
    let requestedGeneration = false;
    let generationReason = '';
    let navigationTarget: { view: 'list' | 'characters' | 'library' | 'aitag' | 'inspiration' | 'history' | 'playground'; id?: string } | null = null;
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const vibes = await vibeService.list('', false).catch(() => []);
      const presets = props.presets.slice(0, 200).map(item => ({
        id: item.id, name: item.name, type: item.type, tags: item.tags,
        basePrompt: item.basePrompt, negativePrompt: item.negativePrompt, modules: item.modules,
        params: item.params, subjectPrompt: item.variableValues?.subject || '',
      }));
      const imageDisplay = getMobileImageDisplayPreferences();
      await promptAgentService.run({ sessionId: props.sessionId, message: prompt, draft: props.draft, context: { presets, vibes, clientSettings: {
        themeMode: localStorage.getItem('nai_theme') || 'system', safeMode: localStorage.getItem('nai_safe_mode') === 'true',
        imageLayout: imageDisplay.layout, imageColumns: imageDisplay.columns, mobileCache: getMobileCacheStats(), novelAiKeyConfigured: Boolean(props.apiKey),
      } } }, event => {
        if (event.type === 'text_delta') setMessages(previous => previous.map(item => item.id === assistantId ? { ...item, text: item.text + event.delta } : item));
        if (event.type === 'tool_start') setMessages(previous => previous.map(item => item.id === assistantId ? { ...item, tools: [...(item.tools || []).filter(tool => tool.name !== event.toolName), { name: event.toolName, state: 'running' }] } : item));
        if (event.type === 'tool_end') setMessages(previous => previous.map(item => item.id === assistantId ? { ...item, tools: (item.tools || []).map(tool => tool.name === event.toolName ? { ...tool, state: event.isError ? 'error' : 'done' } : tool) } : item));
        if (event.type === 'project_changed') window.dispatchEvent(new CustomEvent('nai-project-data-changed', { detail: { resource: event.resource } }));
        if (event.type === 'action') {
          if (event.action.kind === 'request_project_action') {
            const patch = event.action.patch;
            void (async () => {
              const isEncoding = patch.action === 'encode_vibe';
              const accepted = await confirmAction({ title: patch.title, message: patch.consequence, confirmLabel: patch.action === 'clear_history' ? '永久清空' : isEncoding ? '消耗 2 Anlas 并生成' : '确认执行', ...(isEncoding ? {} : { tone: 'danger' as const }) });
              if (!accepted) {
                setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'agent', text: '已取消该项目操作，没有修改数据。' }]);
                return;
              }
              try {
                if (patch.action === 'encode_vibe') {
                  if (!props.apiKey) throw new Error('请先在全局设置中填写 NovelAI API Key');
                  await vibeService.encode(patch.resourceId || '', Number(patch.payload?.informationExtracted ?? 1), props.apiKey);
                } else if (patch.action === 'clear_mobile_cache') {
                  await clearMobileThumbnailCache();
                } else await promptAgentService.executeProjectAction({ action: patch.action, resourceId: patch.resourceId, payload: patch.payload });
                window.dispatchEvent(new CustomEvent('nai-project-data-changed', { detail: patch }));
                setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'agent', text: '已在你确认后完成该项目操作。' }]);
              } catch (error) {
                setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : '项目操作失败' }]);
              }
            })();
          } else if (event.action.kind === 'set_client_preferences') {
            const patch = event.action.patch;
            if (patch.imageLayout || patch.imageColumns !== undefined) {
              const current = getMobileImageDisplayPreferences();
              setMobileImageDisplayPreferences({ layout: patch.imageLayout || current.layout, columns: patch.imageColumns ?? current.columns });
            }
            if (patch.mobileCacheLimit !== undefined) setMobileCacheLimitMb(patch.mobileCacheLimit);
            window.dispatchEvent(new CustomEvent('nai-agent-ui-preferences', { detail: patch }));
          } else if (event.action.kind === 'navigate_view') {
            navigationTarget = event.action.patch;
          } else {
            if (event.action.kind !== 'request_generation' && !labChanged) props.onRunStart(runSnapshot);
            if (event.action.kind !== 'request_generation') labChanged = true;
            props.onAction(event.action);
          }
          if (event.action.kind === 'request_generation') {
            requestedGeneration = true;
            generationReason = event.action.patch.reason || '';
          }
        }
        if (event.type === 'error') throw new Error(event.error);
        if (event.type === 'done') {
          if (labChanged) props.onFinalDraft(event.draft);
          if (requestedGeneration) props.onRequestGeneration(event.draft, generationReason);
          else if (navigationTarget) {
            window.dispatchEvent(new CustomEvent('nai-agent-navigate', { detail: navigationTarget }));
            props.onClose();
          }
          if (!event.message) setMessages(previous => previous.map(item => item.id === assistantId && !item.text ? { ...item, text: '已完成。' } : item));
        }
      }, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        setMessages(previous => previous.map(item => item.id === assistantId && !item.text ? { ...item, text: '已停止。' } : item));
      } else {
        setMessages(previous => [...previous.filter(item => item.id !== assistantId || item.text || item.tools?.length), { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : 'Agent 执行失败' }]);
      }
    } finally {
      controllerRef.current = null;
      setRunning(false);
    }
  };

  const reset = async () => {
    if (running) return;
    await promptAgentService.resetSession(props.sessionId);
    setMessages([]);
  };

  return <div className="fixed inset-0 z-[1100] flex flex-col bg-gray-50 dark:bg-gray-950">
    <header className="flex min-h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-3 border-b border-fuchsia-100 bg-white px-3 pt-[env(safe-area-inset-top)] dark:border-fuchsia-950 dark:bg-gray-900 md:px-5">
      <button type="button" onClick={requestClose} className="mobile-touch flex items-center justify-center rounded-xl text-gray-500" aria-label="返回实验室"><svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7 7-7m-7 7h18" /></svg></button>
      <div className="min-w-0 flex-1"><h2 className="font-black text-gray-900 dark:text-white">项目 Agent</h2><p className="truncate text-[11px] text-gray-500">{modelLabel || '正在读取模型…'} · 删除与付费操作仍需确认</p></div>
      {props.canUndo && <button type="button" onClick={props.onUndo} disabled={running} className="mobile-touch rounded-xl px-3 text-sm font-bold text-fuchsia-600 disabled:opacity-40">撤销本次</button>}
      <button type="button" onClick={() => void reset()} disabled={running} className="mobile-touch rounded-xl px-2 text-xs font-bold text-gray-500 disabled:opacity-40">清空对话</button>
    </header>
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} onScroll={event => { const element = event.currentTarget; const next = element.scrollHeight - element.scrollTop - element.clientHeight < 80; followBottomRef.current = next; setFollowingBottom(next); }} className="relative flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && <div className="mt-8 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-3xl text-white shadow-xl shadow-fuchsia-500/20">✦</div><h3 className="mt-4 text-lg font-black dark:text-white">告诉我你想在项目里做什么</h3><p className="mt-1 text-sm text-gray-500">我可以查看历史图片、整理创作配置，也可以管理资料库、AITag、Vibe与项目设置。</p><div className="mx-auto mt-5 grid max-w-lg gap-2 sm:grid-cols-2">{['查看最后一张图并改进动作', '检查整个项目的资料情况', '设计角色并调整实验室', '查看当前设置和 Anlas 预算'].map(text => <button key={text} type="button" onClick={() => void run(text)} className="mobile-touch rounded-2xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">{text}</button>)}</div></div>}
        {messages.map(message => <div key={message.id} className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'ml-auto whitespace-pre-wrap bg-indigo-600 text-white' : message.role === 'error' ? 'whitespace-pre-wrap bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300' : 'bg-white text-gray-800 shadow-sm dark:bg-gray-900 dark:text-gray-100'}`}>
          {message.role === 'agent' ? <AgentMarkdown text={message.text || (running ? '正在思考…' : '')} /> : message.text}
          {!!message.tools?.length && <div className="mt-2 flex flex-wrap gap-1.5 border-t border-gray-100 pt-2 dark:border-gray-800">{message.tools.map(tool => <span key={tool.name} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tool.state === 'running' ? 'animate-pulse bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-950/50 dark:text-fuchsia-300' : tool.state === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-950/50' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>{tool.state === 'running' ? '◌' : tool.state === 'error' ? '!' : '✓'} {toolLabels[tool.name] || tool.name}</span>)}</div>}
        </div>)}
        {!followingBottom && <button type="button" onClick={() => { followBottomRef.current = true; setFollowingBottom(true); scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }} className="sticky bottom-1 mx-auto block rounded-full bg-gray-900 px-3 py-1.5 text-xs font-bold text-white shadow-lg dark:bg-white dark:text-gray-900">回到底部 ↓</button>}
      </div>
      <div className="border-t border-gray-200 bg-white p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] dark:border-gray-800 dark:bg-gray-900 md:p-4"><div className="flex items-end gap-2"><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void run(); } }} rows={2} placeholder="例如：改成夜晚雨中的赛博朋克少女，然后直接生成" className="min-h-14 flex-1 resize-none rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-fuchsia-500 dark:border-gray-700 dark:bg-gray-950" />{running ? <button type="button" onClick={() => controllerRef.current?.abort()} className="mobile-touch rounded-2xl bg-red-500 px-4 text-sm font-bold text-white">停止</button> : <button type="button" onClick={() => void run()} disabled={!input.trim()} className="mobile-touch rounded-2xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 px-5 text-sm font-bold text-white shadow-lg disabled:opacity-40">执行</button>}</div></div>
    </main>
  </div>;
};
