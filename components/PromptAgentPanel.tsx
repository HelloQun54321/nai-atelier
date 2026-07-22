import React, { useEffect, useRef, useState } from 'react';
import { PromptAgentAction, PromptAgentDraft, PromptChain } from '../types';
import { PromptAgentModel, PromptAgentSession, PromptAgentThinkingLevel, PromptAgentUsage, promptAgentService } from '../services/promptAgent';
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

type ToolProgress = { id: string; name: string; state: 'running' | 'done' | 'error'; args?: unknown; result?: unknown };
type PanelMessage = { id: string; role: 'user' | 'agent' | 'error'; text: string; thinking?: string; tools?: ToolProgress[]; model?: string; provider?: string; usage?: PromptAgentUsage; stopReason?: string; timestamp?: number; queued?: 'steer' | 'followUp' };
type AgentAttachment = { data: string; mimeType: string; name: string };
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
  const [sessions, setSessions] = useState<PromptAgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [models, setModels] = useState<PromptAgentModel[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [queueMode, setQueueMode] = useState<'steer' | 'followUp'>('steer');
  const [busySessionAction, setBusySessionAction] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState('');
  const [editingTitle, setEditingTitle] = useState('');
  const [editingMessageId, setEditingMessageId] = useState('');
  const [sessionSearch, setSessionSearch] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [followingBottom, setFollowingBottom] = useState(true);
  const currentAssistantIdRef = useRef('');
  const responseStartedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followBottomRef = useRef(true);
  const confirmAction = useConfirmDialog();
  const closePanel = () => {
    props.onClose();
  };
  const requestClose = useMobileHistoryLayer(props.open, closePanel, 'prompt-agent');

  const refreshSessions = async (preferredId?: string) => {
    const items = await promptAgentService.listSessions(props.sessionId);
    setSessions(items);
    const stored = localStorage.getItem('nai_prompt_agent_session') || '';
    const next = preferredId || activeSessionId || (items.some(item => item.id === stored) ? stored : items[0]?.id) || '';
    if (next) setActiveSessionId(next);
  };

  useEffect(() => {
    if (!props.open) return;
    void Promise.all([refreshSessions(), promptAgentService.getAvailableModels().then(setModels)]).catch(() => {});
  }, [props.open]);

  useEffect(() => {
    if (!props.open || !activeSessionId || running) return;
    localStorage.setItem('nai_prompt_agent_session', activeSessionId);
    setMessages([]);
    void promptAgentService.getSession(activeSessionId).then(items => setMessages(items.map(item => ({ ...item })))).catch(() => {});
  }, [props.open, activeSessionId]);

  const activeSession = sessions.find(item => item.id === activeSessionId);
  const activeModel = models.find(item => item.provider === activeSession?.provider && item.id === activeSession?.model);

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

  const run = async (suggestion?: string, mode: 'prompt' | 'retry' = 'prompt') => {
    const prompt = (suggestion ?? input).trim() || (attachments.length ? '请分析我附带的图片，并结合项目内容给出建议。' : '');
    if (!activeSessionId || (mode === 'prompt' && !prompt)) return;
    if (running) {
      try {
        await promptAgentService.control(activeSessionId, queueMode, prompt);
        setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'user', text: prompt, queued: queueMode }]);
        setInput('');
      } catch (error) {
        setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : '追加要求失败' }]);
      }
      return;
    }
    let effectiveMode = mode;
    let revisedMessages: PanelMessage[] | null = null;
    if (editingMessageId && mode === 'prompt') {
      try {
        revisedMessages = (await promptAgentService.reviseMessage(activeSessionId, editingMessageId, prompt)).map(item => ({ ...item }));
        effectiveMode = 'retry';
        setEditingMessageId('');
      } catch (error) {
        setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : '编辑消息失败' }]);
        return;
      }
    }
    const assistantId = crypto.randomUUID();
    setMessages(previous => [...(revisedMessages || previous), ...(effectiveMode === 'prompt' ? [{ id: crypto.randomUUID(), role: 'user' as const, text: prompt }] : []), { id: assistantId, role: 'agent', text: '' }]);
    currentAssistantIdRef.current = assistantId;
    responseStartedRef.current = false;
    setInput('');
    setAttachments([]);
    setRunning(true);
    const runSnapshot = structuredClone(props.draft);
    let labChanged = false;
    let requestedGeneration = false;
    let generationReason = '';
    let navigationTarget: { view: 'list' | 'characters' | 'library' | 'aitag' | 'inspiration' | 'history' | 'playground'; id?: string } | null = null;
    const controller = new AbortController();
    try {
      const vibes = await vibeService.list('', false).catch(() => []);
      const presets = props.presets.slice(0, 200).map(item => ({
        id: item.id, name: item.name, type: item.type, tags: item.tags,
        basePrompt: item.basePrompt, negativePrompt: item.negativePrompt, modules: item.modules,
        params: item.params, subjectPrompt: item.variableValues?.subject || '',
      }));
      const imageDisplay = getMobileImageDisplayPreferences();
      await promptAgentService.run({ sessionId: activeSessionId, message: prompt, mode: effectiveMode, images: effectiveMode === 'prompt' ? attachments.map(({ data, mimeType }) => ({ data, mimeType })) : [], draft: props.draft, context: { presets, vibes, clientSettings: {
        themeMode: localStorage.getItem('nai_theme') || 'system', safeMode: localStorage.getItem('nai_safe_mode') === 'true',
        imageLayout: imageDisplay.layout, imageColumns: imageDisplay.columns, mobileCache: getMobileCacheStats(), novelAiKeyConfigured: Boolean(props.apiKey),
      } } }, event => {
        if (event.type === 'response_start') {
          if (responseStartedRef.current) {
            const nextId = crypto.randomUUID();
            currentAssistantIdRef.current = nextId;
            setMessages(previous => [...previous, { id: nextId, role: 'agent', text: '' }]);
          } else responseStartedRef.current = true;
        }
        if (event.type === 'text_delta') setMessages(previous => previous.map(item => item.id === currentAssistantIdRef.current ? { ...item, text: item.text + event.delta } : item));
        if (event.type === 'thinking_delta') setMessages(previous => previous.map(item => item.id === currentAssistantIdRef.current ? { ...item, thinking: (item.thinking || '') + event.delta } : item));
        if (event.type === 'response_end') setMessages(previous => previous.map(item => item.id === currentAssistantIdRef.current ? { ...item, model: event.model, provider: event.provider, usage: event.usage, stopReason: event.stopReason, timestamp: event.timestamp } : item));
        if (event.type === 'tool_start') setMessages(previous => previous.map(item => item.id === currentAssistantIdRef.current ? { ...item, tools: [...(item.tools || []), { id: event.toolCallId, name: event.toolName, args: event.args, state: 'running' }] } : item));
        if (event.type === 'tool_end') setMessages(previous => previous.map(item => item.id === currentAssistantIdRef.current ? { ...item, tools: (item.tools || []).map(tool => tool.id === event.toolCallId ? { ...tool, result: event.result, state: event.isError ? 'error' : 'done' } : tool) } : item));
        if (event.type === 'project_changed') window.dispatchEvent(new CustomEvent('nai-project-data-changed', { detail: { resource: event.resource } }));
        if (event.type === 'action') {
          if (event.action.kind === 'request_project_action') {
            const patch = event.action.patch;
            void (async () => {
              const isEncoding = patch.action === 'encode_vibe';
              const accepted = await confirmAction({ title: patch.title, message: patch.consequence, confirmLabel: patch.action === 'clear_history' ? '永久清空' : isEncoding ? '消耗 2 Anlas 并生成' : '确认执行', ...(isEncoding ? {} : { tone: 'danger' as const }) });
              if (!accepted) {
                await promptAgentService.control(activeSessionId, 'confirm', patch.requestId, { requestId: patch.requestId, accepted: false }).catch(() => {});
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
                await promptAgentService.control(activeSessionId, 'confirm', patch.requestId, { requestId: patch.requestId, accepted: true, result: { action: patch.action, resourceId: patch.resourceId } });
                window.dispatchEvent(new CustomEvent('nai-project-data-changed', { detail: patch }));
                setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'agent', text: '已在你确认后完成该项目操作。' }]);
              } catch (error) {
                await promptAgentService.control(activeSessionId, 'confirm', patch.requestId, { requestId: patch.requestId, accepted: false }).catch(() => {});
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
          if (!event.message) setMessages(previous => previous.map(item => item.id === currentAssistantIdRef.current && !item.text ? { ...item, text: '已完成。' } : item));
        }
      }, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        setMessages(previous => previous.map(item => item.id === assistantId && !item.text ? { ...item, text: '已停止。' } : item));
      } else {
        setMessages(previous => [...previous.filter(item => item.id !== assistantId || item.text || item.tools?.length), { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : 'Agent 执行失败' }]);
      }
    } finally {
      setRunning(false);
      void refreshSessions(activeSessionId);
    }
  };

  const reset = async () => {
    if (running) return;
    await promptAgentService.resetSession(activeSessionId);
    setMessages([]);
  };

  const createSession = async () => {
    if (running) return;
    setBusySessionAction(true);
    try {
      const created = await promptAgentService.createSession();
      await refreshSessions(created.id);
      setMessages([]);
      setShowSessions(false);
    } finally { setBusySessionAction(false); }
  };

  const saveSessionTitle = async (session: PromptAgentSession) => {
    const title = editingTitle.trim();
    if (!title || title === session.title) { setEditingSessionId(''); return; }
    const updated = await promptAgentService.updateSession(session.id, { title });
    setSessions(previous => previous.map(item => item.id === updated.id ? { ...item, ...updated } : item));
    setEditingSessionId('');
  };

  const deleteSession = async (session: PromptAgentSession) => {
    if (running || sessions.length <= 1) return;
    const accepted = await confirmAction({ title: '删除这条 Agent 对话？', message: `“${session.title}”的消息记录会从电脑删除，项目资料不会受到影响。`, confirmLabel: '删除对话', tone: 'danger' });
    if (!accepted) return;
    await promptAgentService.deleteSession(session.id);
    const remaining = sessions.filter(item => item.id !== session.id);
    setSessions(remaining);
    if (activeSessionId === session.id) setActiveSessionId(remaining[0]?.id || '');
  };

  const updateSessionModel = async (model: PromptAgentModel) => {
    if (!activeSession || running) return;
    const updated = await promptAgentService.updateSession(activeSession.id, { provider: model.provider, model: model.id });
    setSessions(previous => previous.map(item => item.id === updated.id ? { ...item, ...updated } : item));
    setShowModelMenu(false);
  };

  const updateThinkingLevel = async (thinkingLevel: PromptAgentThinkingLevel) => {
    if (!activeSession || running) return;
    const updated = await promptAgentService.updateSession(activeSession.id, { thinkingLevel });
    setSessions(previous => previous.map(item => item.id === updated.id ? { ...item, ...updated } : item));
  };

  const formatUsage = (usage?: PromptAgentUsage) => usage
    ? `${usage.totalTokens.toLocaleString()} tokens${usage.cost?.total ? ` · $${usage.cost.total.toFixed(4)}` : ''}`
    : '';

  const copyMessage = async (messageId: string, value: string) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else throw new Error('clipboard-unavailable');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) throw new Error('copy-failed');
    }
    setCopiedMessageId(messageId);
    window.setTimeout(() => setCopiedMessageId(current => current === messageId ? '' : current), 1400);
  };

  const addAttachments = (files: FileList | null) => {
    if (!files) return;
    [...files].slice(0, 4 - attachments.length).forEach(file => {
      if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(file.type) || file.size > 6 * 1024 * 1024) return;
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || '');
        const data = value.replace(/^data:[^;]+;base64,/, '');
        setAttachments(previous => previous.length >= 4 ? previous : [...previous, { data, mimeType: file.type, name: file.name }]);
      };
      reader.readAsDataURL(file);
    });
  };

  return <div className="fixed inset-0 z-[1100] flex bg-gray-50 dark:bg-gray-950">
    {showSessions && <button type="button" aria-label="关闭会话列表" onClick={() => setShowSessions(false)} className="fixed inset-0 z-10 bg-black/35 md:hidden" />}
    <aside className={`${showSessions ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-20 flex w-[min(82vw,19rem)] flex-col border-r border-gray-200 bg-white pt-[env(safe-area-inset-top)] shadow-2xl transition-transform dark:border-gray-800 dark:bg-gray-900 md:relative md:w-72 md:translate-x-0 md:shadow-none`}>
      <div className="flex h-14 items-center gap-2 px-3">
        <b className="flex-1 text-sm dark:text-white">Agent 对话</b>
        <button type="button" onClick={() => void createSession()} disabled={running || busySessionAction} className="mobile-touch flex items-center justify-center rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-xl font-light text-white disabled:opacity-40" aria-label="新建对话">＋</button>
      </div>
      <div className="px-2 pb-2"><input value={sessionSearch} onChange={event => setSessionSearch(event.target.value)} placeholder="搜索对话标题" className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs outline-none focus:border-fuchsia-400 dark:border-gray-700 dark:bg-gray-950" /></div>
      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {sessions.filter(session => session.title.toLowerCase().includes(sessionSearch.trim().toLowerCase())).map(session => <div key={session.id} className={`group rounded-2xl border px-3 py-2 ${session.id === activeSessionId ? 'border-fuchsia-200 bg-fuchsia-50 dark:border-fuchsia-900 dark:bg-fuchsia-950/30' : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
          {editingSessionId === session.id ? <form onSubmit={event => { event.preventDefault(); void saveSessionTitle(session); }} className="flex gap-1"><input autoFocus value={editingTitle} onChange={event => setEditingTitle(event.target.value)} onBlur={() => void saveSessionTitle(session)} className="min-w-0 flex-1 rounded-lg border border-fuchsia-300 bg-white px-2 text-sm dark:bg-gray-950" /></form> : <button type="button" disabled={running && session.id !== activeSessionId} onClick={() => { if (!running) { setActiveSessionId(session.id); setShowSessions(false); } }} className="block w-full text-left">
            <span className="block truncate text-sm font-bold text-gray-800 dark:text-gray-100">{session.title}</span>
            <span className="mt-0.5 block text-[10px] text-gray-400">{session.messageCount || 0} 轮 · {new Date(session.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{session.running ? ' · 工作中' : session.taskStatus === 'interrupted' ? ' · 上次中断' : session.taskStatus === 'failed' ? ' · 上次失败' : ''}</span>
          </button>}
          <div className="mt-1 flex gap-1 opacity-70 md:opacity-0 md:group-hover:opacity-100">
            <button type="button" onClick={() => { setEditingSessionId(session.id); setEditingTitle(session.title); }} disabled={running} className="rounded-lg px-2 py-1 text-[10px] font-bold text-gray-500">重命名</button>
            <button type="button" onClick={() => void deleteSession(session)} disabled={running || sessions.length <= 1} className="rounded-lg px-2 py-1 text-[10px] font-bold text-red-500 disabled:opacity-30">删除</button>
          </div>
        </div>)}
      </div>
      <p className="border-t border-gray-100 px-4 py-3 text-[10px] leading-4 text-gray-400 dark:border-gray-800">对话保存在电脑本地。删除与付费项目操作仍会单独确认。</p>
    </aside>

    <section className="relative flex min-w-0 flex-1 flex-col">
      <header className="flex min-h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-2 border-b border-fuchsia-100 bg-white px-2 pt-[env(safe-area-inset-top)] dark:border-fuchsia-950 dark:bg-gray-900 md:px-4">
        <button type="button" onClick={requestClose} className="mobile-touch flex items-center justify-center rounded-xl text-gray-500" aria-label="返回"><svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7 7-7m-7 7h18" /></svg></button>
        <button type="button" onClick={() => setShowSessions(true)} className="mobile-touch flex items-center justify-center rounded-xl text-gray-500 md:hidden" aria-label="会话列表">☰</button>
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-black text-gray-900 dark:text-white">{activeSession?.title || '项目 Agent'}</h2><p className="truncate text-[10px] text-gray-500">{running ? '正在执行，可继续追加要求' : `${activeSession?.model || '未选择模型'} · ${activeModel?.imageInput ? '支持识图' : '不支持识图'}`}</p></div>
        <div className="relative">
          <button type="button" disabled={running} onClick={() => setShowModelMenu(value => !value)} className="mobile-touch max-w-36 truncate rounded-xl border border-gray-200 px-2 text-[11px] font-bold text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300">模型</button>
          {showModelMenu && <div className="absolute right-0 top-12 z-30 max-h-[60vh] w-72 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-2 shadow-2xl dark:border-gray-700 dark:bg-gray-900">{models.map(model => <button key={`${model.provider}/${model.id}`} type="button" onClick={() => void updateSessionModel(model)} className={`block w-full rounded-xl px-3 py-2 text-left ${model.provider === activeSession?.provider && model.id === activeSession?.model ? 'bg-fuchsia-50 dark:bg-fuchsia-950/40' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}><b className="block truncate text-xs dark:text-white">{model.id}</b><span className="block text-[10px] text-gray-400">{model.provider} · {model.reasoning ? '推理' : '普通'}{model.imageInput ? ' · 识图' : ''}</span></button>)}</div>}
        </div>
        <select aria-label="思考等级" title="思考等级" disabled={running || !activeModel?.reasoning} value={activeSession?.thinkingLevel || 'off'} onChange={event => void updateThinkingLevel(event.target.value as PromptAgentThinkingLevel)} className="h-11 max-w-24 rounded-xl border border-gray-200 bg-white px-1 text-[11px] font-bold text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"><option value="off">不思考</option><option value="minimal">极少</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="xhigh">极高</option><option value="max">最大</option></select>
        {props.canUndo && <button type="button" onClick={props.onUndo} disabled={running} className="mobile-touch hidden rounded-xl px-2 text-xs font-bold text-fuchsia-600 disabled:opacity-40 sm:block">撤销本次</button>}
        <button type="button" onClick={() => void reset()} disabled={running || !messages.length} className="mobile-touch rounded-xl px-2 text-xs font-bold text-gray-500 disabled:opacity-30" aria-label="清空当前对话">清空</button>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden">
        <div ref={scrollRef} onScroll={event => { const element = event.currentTarget; const next = element.scrollHeight - element.scrollTop - element.clientHeight < 80; followBottomRef.current = next; setFollowingBottom(next); }} className="relative flex-1 space-y-3 overflow-y-auto p-3 md:p-4">
          {messages.length === 0 && <div className="mt-8 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-3xl text-white shadow-xl shadow-fuchsia-500/20">✦</div><h3 className="mt-4 text-lg font-black dark:text-white">告诉我你想在项目里做什么</h3><p className="mt-1 text-sm text-gray-500">这是一条独立对话，可在项目的任何页面继续。</p><div className="mx-auto mt-5 grid max-w-lg gap-2 sm:grid-cols-2">{['查看最后一张图并改进动作', '检查整个项目的资料情况', '设计角色并调整实验室', '查看当前设置和 Anlas 预算'].map(value => <button key={value} type="button" onClick={() => void run(value)} className="mobile-touch rounded-2xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">{value}</button>)}</div></div>}
          {messages.map((message, index) => <div key={message.id} className={`group max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'ml-auto whitespace-pre-wrap bg-indigo-600 text-white' : message.role === 'error' ? 'whitespace-pre-wrap bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300' : 'bg-white text-gray-800 shadow-sm dark:bg-gray-900 dark:text-gray-100'}`}>
            {message.queued && <div className="mb-1 text-[10px] font-bold opacity-70">{message.queued === 'steer' ? '转向要求 · 当前步骤后处理' : '后续任务 · 完成本轮后处理'}</div>}
            {!!message.thinking && <details className="mb-2 rounded-xl bg-gray-50 px-3 py-1 dark:bg-gray-950"><summary className="cursor-pointer text-[11px] font-bold text-gray-500">思考过程</summary><div className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-gray-500">{message.thinking}</div></details>}
            {message.role === 'agent' ? <AgentMarkdown text={message.text || (running ? '正在思考…' : '')} /> : message.text}
            {!!message.tools?.length && <div className="mt-2 space-y-1 border-t border-gray-100 pt-2 dark:border-gray-800">{message.tools.map(tool => <details key={tool.id} className={`rounded-xl px-2 py-1 text-[10px] ${tool.state === 'running' ? 'animate-pulse bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-950/50 dark:text-fuchsia-300' : tool.state === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-950/50' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}><summary className="cursor-pointer font-bold">{tool.state === 'running' ? '◌' : tool.state === 'error' ? '!' : '✓'} {toolLabels[tool.name] || tool.name}</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all opacity-75">{JSON.stringify({ input: tool.args, output: tool.result }, null, 2).slice(0, 4000)}</pre></details>)}</div>}
            <div className={`mt-2 flex items-center gap-2 border-t pt-1 text-[10px] ${message.role === 'user' ? 'border-white/20 text-white/70' : 'border-gray-100 text-gray-400 dark:border-gray-800'}`}>
              {message.role === 'agent' && <span className="truncate">{message.model || ''}{message.usage ? ` · ${formatUsage(message.usage)}` : ''}{message.stopReason && message.stopReason !== 'stop' ? ` · ${message.stopReason}` : ''}</span>}
              <span className="flex-1" />
              <button type="button" onClick={() => void copyMessage(message.id, message.text)} className="rounded-lg px-1.5 font-bold hover:bg-black/5">{copiedMessageId === message.id ? '已复制' : '复制'}</button>
              {message.role === 'user' && !running && !message.queued && <button type="button" onClick={() => { setEditingMessageId(message.id); setInput(message.text); }} className="rounded-lg px-1.5 font-bold hover:bg-white/10">编辑重发</button>}
              {message.role === 'agent' && index === messages.length - 1 && !running && <button type="button" onClick={() => void run('', 'retry')} className="rounded-lg px-1.5 font-bold text-fuchsia-500 hover:bg-fuchsia-50">重新生成</button>}
            </div>
          </div>)}
          {!followingBottom && <button type="button" onClick={() => { followBottomRef.current = true; setFollowingBottom(true); scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }} className="sticky bottom-1 mx-auto block rounded-full bg-gray-900 px-3 py-1.5 text-xs font-bold text-white shadow-lg dark:bg-white dark:text-gray-900">回到底部 ↓</button>}
        </div>
        <div className="border-t border-gray-200 bg-white p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] dark:border-gray-800 dark:bg-gray-900 md:p-4">
          {editingMessageId && !running && <div className="mb-2 flex items-center rounded-xl bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"><b>正在编辑旧消息</b><span className="ml-1">发送后会从这里重新执行，后面的旧回答将被替换。</span><span className="flex-1" /><button type="button" onClick={() => { setEditingMessageId(''); setInput(''); }} className="font-bold">取消</button></div>}
          {running && <div className="mb-2 flex items-center gap-2 text-[11px]"><span className="font-bold text-fuchsia-600">Agent 正在工作</span><button type="button" onClick={() => setQueueMode('steer')} className={`rounded-full px-2 py-1 font-bold ${queueMode === 'steer' ? 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950' : 'text-gray-400'}`}>转向当前任务</button><button type="button" onClick={() => setQueueMode('followUp')} className={`rounded-full px-2 py-1 font-bold ${queueMode === 'followUp' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950' : 'text-gray-400'}`}>排到任务之后</button><span className="flex-1" /><button type="button" onClick={() => void promptAgentService.control(activeSessionId, 'clear')} className="font-bold text-gray-400">清空排队</button><button type="button" onClick={() => void promptAgentService.control(activeSessionId, 'abort')} className="font-bold text-red-500">停止</button></div>}
          {!!attachments.length && <div className="mb-2 flex flex-wrap gap-1.5">{attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`} className="flex max-w-48 items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-[10px] text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200"><span className="truncate">{attachment.name}</span><button type="button" onClick={() => setAttachments(previous => previous.filter((_, itemIndex) => itemIndex !== index))} className="font-black">×</button></span>)}</div>}
          <div className="flex items-end gap-2"><label className="mobile-touch flex h-14 w-12 cursor-pointer items-center justify-center rounded-2xl border border-gray-200 text-xl text-gray-500 hover:border-fuchsia-400 dark:border-gray-700"><span aria-hidden="true">＋</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event => { addAttachments(event.target.files); event.currentTarget.value = ''; }} disabled={running || attachments.length >= 4} /></label><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void run(); } }} rows={2} placeholder={running ? (queueMode === 'steer' ? '补充或纠正当前任务…' : '添加完成后继续处理的任务…') : '告诉 Agent 你想让它查看、修改或生成什么…'} className="min-h-14 flex-1 resize-none rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-fuchsia-500 dark:border-gray-700 dark:bg-gray-950" /><button type="button" onClick={() => void run()} disabled={!input.trim() && !attachments.length} className={`mobile-touch rounded-2xl px-5 text-sm font-bold text-white shadow-lg disabled:opacity-40 ${running ? queueMode === 'steer' ? 'bg-gradient-to-r from-fuchsia-600 to-violet-600' : 'bg-gradient-to-r from-indigo-600 to-blue-600' : 'bg-gradient-to-r from-fuchsia-600 to-indigo-600'}`}>{running ? '追加' : editingMessageId ? '重发' : '执行'}</button></div>
        </div>
      </main>
    </section>
  </div>;
};
