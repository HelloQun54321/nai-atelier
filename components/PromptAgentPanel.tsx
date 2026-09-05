import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PromptAgentDraft } from '../types';
import { PromptAgentCreativePreset, PromptAgentModel, PromptAgentSession, PromptAgentThinkingLevel, PromptAgentUsage, PromptAgentVisionUsage, displayModelName, promptAgentService } from '../services/promptAgent';
import { formatPresetSessionLabel } from './PromptAgentSettings';
import { vibeService } from '../services/vibeService';
import { useMobileHistoryLayer } from './MobileUI';
import { useConfirmDialog } from './ConfirmDialog';
import { getMobileImageDisplayPreferences, setMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { clearMobileThumbnailCache, getMobileCacheStats, setMobileCacheLimitMb } from '../services/mobileImageCache';
import { ArrowDown, ArrowLeft, Bot, Check, ChevronDown, Copy, Download, Expand, ImagePlus, List, MoreHorizontal, Pencil, Plus, RotateCcw, Send, SlidersHorizontal, Square, Trash2, X } from 'lucide-react';

interface PromptAgentPanelProps {
  open: boolean;
  onClose: () => void;
  draft: PromptAgentDraft;
  apiKey: string;
  onRunStart: (snapshot: PromptAgentDraft) => void;
  onFinalDraft: (draft: PromptAgentDraft) => void;
  onRequestGeneration: (draft: PromptAgentDraft, reason?: string) => Promise<boolean> | void;
  onUndo: () => void;
  canUndo: boolean;
  tagAssistEnabled: boolean;
}

type ToolProgress = { id: string; name: string; state: 'running' | 'done' | 'error'; args?: unknown; result?: unknown };
type PanelMessage = { id: string; role: 'user' | 'agent' | 'error'; text: string; thinking?: string; tools?: ToolProgress[]; model?: string; provider?: string; usage?: PromptAgentUsage; visionUsage?: PromptAgentVisionUsage[]; stopReason?: string; timestamp?: number; queued?: 'steer' | 'followUp' };
type AgentAttachment = { data: string; mimeType: string; name: string };
const toolLabels: Record<string, string> = {
  search_novelai_docs: '检索 NovelAI 官方知识', read_novelai_doc: '读取 NovelAI 官方知识',
  web_search: '联网搜索', read_web_page: '读取网页',
  get_lab_state: '读取实验室', search_tags: '搜索 Tag', search_character_catalog: '搜索角色 Tag', search_vibes: '搜索 Vibe', search_character_references: '搜索角色参考',
  update_prompts: '修改全局提示词', set_prompt_modules: '整理提示词模块', set_characters: '设置角色专属提示词',
  set_generation_params: '调整参数', set_vibes: '设置 Vibe', set_character_references: '设置角色参考', request_generation: '准备生图',
  get_project_overview: '读取项目概况', search_project_library: '搜索项目资料', get_chain: '读取完整资料', list_generation_history: '读取生成历史',
  inspect_generation_image: '查看历史原图', create_chain: '新建资料', update_chain: '更新资料',
  create_inspiration: '保存灵感', update_inspiration: '更新灵感', list_vibe_groups: '读取 Vibe 组合', create_character_reference_from_history: '保存角色参考图', create_vibe_from_history: '从历史创建 Vibe', import_aitag_image: '导入 AITag 图片',
  request_delete_project_item: '准备删除', request_clear_history: '准备清空历史',
  search_aitag: '搜索 AITag', get_aitag_work: '读取 AITag 作品', save_artist_profile: '保存画师资料',
  update_vibe: '更新 Vibe', update_character_reference: '更新角色参考', save_vibe_group: '保存 Vibe 组合', request_vibe_encoding: '准备 Vibe 编码',
  get_project_settings: '读取项目设置', set_anlas_budget: '设置 Anlas 预算', set_cloud_queue: '设置拼车队列',
  set_artist_benchmark_config: '设置画师基准图', update_tag_dictionary: '更新 Tag 词库', manage_aitag: '管理 AITag', set_client_preferences: '调整界面偏好', manage_artist_favorite: '管理画师收藏', navigate_view: '切换页面', set_chain_cover_from_history: '设置风格串封面',
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

const AgentContentCard: React.FC<{ title: string; content: string; code?: boolean }> = ({ title, content, code }) => {
  const [expanded, setExpanded] = useState(content.length < 360);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return <section className="my-2 overflow-hidden rounded-xl border border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-950/70">
    <header className="flex min-h-10 items-center gap-2 border-b border-gray-200 px-3 dark:border-gray-800">
      <span className="min-w-0 flex-1 truncate text-meta font-bold text-gray-600 dark:text-gray-300">{title}</span>
      <button type="button" onClick={() => setExpanded(value => !value)} className="flex h-8 items-center gap-1 rounded-lg px-2 text-micro font-bold text-gray-500 hover:bg-gray-200/70 dark:hover:bg-gray-800"><ChevronDown className={`h-3.5 w-3.5 transition ${expanded ? 'rotate-180' : ''}`} />{expanded ? '收起' : '展开'}</button>
      <button type="button" onClick={() => void copy()} className="flex h-8 items-center gap-1 rounded-lg px-2 text-micro font-bold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? '已复制' : '复制'}</button>
    </header>
    {expanded && <div className={`max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-5 ${code ? 'font-mono' : ''}`}>{content}</div>}
    {!expanded && <div className="truncate px-3 py-2 text-xs text-gray-400">{content}</div>}
  </section>;
};

const AgentMarkdown: React.FC<{ text: string }> = React.memo(({ text }) => {
  const [expanded, setExpanded] = useState(() => text.length < 4_000);
  if (!expanded) {
    return <div className="space-y-2">
      <div className="line-clamp-4 whitespace-pre-wrap text-gray-600 dark:text-gray-300">{text.slice(0, 520)}</div>
      <button type="button" onClick={() => setExpanded(true)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-indigo-50 px-2.5 text-meta font-bold text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-900/60"><Expand className="h-3.5 w-3.5" />展开完整长回答</button>
    </div>;
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const output: React.ReactNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) { codeLines.push(lines[index]); index += 1; }
      output.push(<AgentContentCard key={`code-${index}`} title={language ? `代码 · ${language}` : '代码'} content={codeLines.join('\n')} code />);
      continue;
    }
    const commaCount = (line.match(/[,，]/g) || []).length;
    if (line.length >= 120 && commaCount >= 5) {
      output.push(<AgentContentCard key={`prompt-${index}`} title="提示词" content={line} />);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { output.push(<div key={index} className="mt-2 font-black first:mt-0">{renderInlineMarkdown(heading[2], `h-${index}`)}</div>); continue; }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) { output.push(<div key={index} className="flex gap-2"><span aria-hidden="true">•</span><span>{renderInlineMarkdown(bullet[1], `b-${index}`)}</span></div>); continue; }
    const ordered = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (ordered) { output.push(<div key={index} className="flex gap-2"><span className="shrink-0">{ordered[1]}.</span><span>{renderInlineMarkdown(ordered[2], `o-${index}`)}</span></div>); continue; }
    output.push(line ? <div key={index}>{renderInlineMarkdown(line, `p-${index}`)}</div> : <div key={index} className="h-2" />);
  }
  return <>{output}</>;
});

const AgentMessageList = React.memo(({
  messages,
  visibleMessageCount,
  running,
  copiedMessageId,
  onLoadEarlier,
  onCopy,
  onEdit,
  onRetry,
}: {
  messages: PanelMessage[];
  visibleMessageCount: number;
  running: boolean;
  copiedMessageId: string;
  onLoadEarlier: () => void;
  onCopy: (message: PanelMessage) => void;
  onEdit: (message: PanelMessage) => void;
  onRetry: () => void;
}) => {
  const visibleMessages = messages.slice(-visibleMessageCount);
  const hiddenMessageCount = Math.max(0, messages.length - visibleMessages.length);
  return <>
    {hiddenMessageCount > 0 && <button type="button" onClick={onLoadEarlier} className="mx-auto flex h-9 items-center rounded-full border border-gray-200 bg-white px-3 text-meta font-bold text-gray-500 shadow-sm hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">再显示前面的 {Math.min(60, hiddenMessageCount)} 条消息</button>}
    {visibleMessages.map((message, index) => <div key={message.id} className={`group min-w-0 max-w-[88%] [overflow-wrap:anywhere] rounded-2xl px-3 py-2 text-sm leading-6 md:max-w-[84%] ${message.role === 'user' ? 'ml-auto whitespace-pre-wrap bg-indigo-600 text-white shadow-sm shadow-indigo-500/20' : message.role === 'error' ? 'whitespace-pre-wrap bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300' : 'bg-white text-gray-800 shadow-sm dark:bg-gray-900 dark:text-gray-100'}`}>
      {message.queued && <div className="mb-1 text-micro font-bold opacity-70">{message.queued === 'steer' ? '转向要求 · 当前步骤后处理' : '后续任务 · 完成本轮后处理'}</div>}
      {!!message.thinking && <details className="mb-2 rounded-xl bg-gray-50 px-3 py-1.5 dark:bg-gray-950"><summary className="cursor-pointer text-meta font-bold text-gray-500">思考过程 <span className="font-normal text-gray-400">· 点击展开</span></summary><div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] text-xs leading-5 text-gray-500">{message.thinking}</div></details>}
      {message.role === 'agent' ? <AgentMarkdown text={message.text || (running ? '正在思考…' : '')} /> : message.text}
      {!!message.tools?.length && <div className="mt-2 space-y-1 border-t border-gray-100 pt-2 dark:border-gray-800">{message.tools.map(tool => <details key={tool.id} className={`rounded-lg px-2 py-1.5 text-micro ${tool.state === 'running' ? 'animate-pulse bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300' : tool.state === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-950/50' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}><summary className="cursor-pointer font-bold">{tool.state === 'running' ? '处理中' : tool.state === 'error' ? '失败' : '完成'} · {toolLabels[tool.name] || tool.name}<span className="ml-1 font-normal opacity-70">· 详情</span></summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all border-t border-current/10 pt-1 opacity-75">{JSON.stringify({ input: tool.args, output: tool.result }, null, 2).slice(0, 4000)}</pre></details>)}</div>}
      {!!message.visionUsage?.length && <div className="mt-2 space-y-0.5 border-t border-violet-100 pt-1.5 text-micro text-violet-500 dark:border-violet-950 dark:text-violet-300">{message.visionUsage.map((item, usageIndex) => <div key={`${item.provider}/${item.model}/${usageIndex}`} className="truncate">视觉 {item.model} · {item.imageCount} 图{typeof item.usage?.totalTokens === 'number' ? ` · ${item.usage.totalTokens.toLocaleString()} tokens${item.usage.cost?.total ? ` · $${item.usage.cost.total.toFixed(4)}` : ''}` : ''}</div>)}</div>}
      <div className={`mt-1 flex min-w-0 items-center gap-1 border-t pt-1 text-micro ${message.role === 'user' ? 'border-white/20 text-white/70' : 'border-gray-100 text-gray-400 dark:border-gray-800'}`}>
        {message.role === 'agent' && <span className="min-w-0 flex-1 truncate pr-1">{message.model || ''}{message.usage && typeof message.usage.totalTokens === 'number' ? ` · ${message.usage.totalTokens.toLocaleString()} tokens${message.usage.cost?.total ? ` · $${message.usage.cost.total.toFixed(4)}` : ''}` : ''}{message.stopReason && message.stopReason !== 'stop' ? ` · ${message.stopReason}` : ''}</span>}
        {message.role !== 'agent' && <span className="flex-1" />}
        <div className="flex flex-none items-center gap-0.5 whitespace-nowrap">
          <button type="button" onClick={() => onCopy(message)} className={`mobile-touch flex items-center justify-center rounded-lg font-bold transition-colors ${message.role === 'user' ? 'hover:bg-white/20' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`} title={copiedMessageId === message.id ? '已复制' : '复制'} aria-label={copiedMessageId === message.id ? '已复制' : '复制'}>
            {copiedMessageId === message.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="ml-1 hidden md:inline">{copiedMessageId === message.id ? '已复制' : '复制'}</span>
          </button>
          {message.role === 'user' && !running && !message.queued && <button type="button" onClick={() => onEdit(message)} className="mobile-touch rounded-lg px-1.5 font-bold whitespace-nowrap hover:bg-white/20">编辑重发</button>}
          {message.role === 'agent' && index === visibleMessages.length - 1 && !running && <button type="button" onClick={onRetry} className="mobile-touch flex items-center justify-center rounded-lg font-bold text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/40" title="重新生成" aria-label="重新生成"><RotateCcw className="h-3.5 w-3.5" /><span className="ml-1 hidden md:inline">重新生成</span></button>}
        </div>
      </div>
    </div>)}
  </>;
}, (previous, next) => previous.messages === next.messages
  && previous.visibleMessageCount === next.visibleMessageCount
  && previous.running === next.running
  && previous.copiedMessageId === next.copiedMessageId);

export const PromptAgentPanel: React.FC<PromptAgentPanelProps> = props => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState<PromptAgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [models, setModels] = useState<PromptAgentModel[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [creativePresets, setCreativePresets] = useState<PromptAgentCreativePreset[]>([]);
  const [queueMode, setQueueMode] = useState<'steer' | 'followUp'>('steer');
  const [busySessionAction, setBusySessionAction] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState('');
  const [sessionMenuId, setSessionMenuId] = useState('');
  const [editingTitle, setEditingTitle] = useState('');
  const [editingMessageId, setEditingMessageId] = useState('');
  const [sessionSearch, setSessionSearch] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [exportingLog, setExportingLog] = useState(false);
  const [logExportError, setLogExportError] = useState('');
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [followingBottom, setFollowingBottom] = useState(true);
  const [visibleMessageCount, setVisibleMessageCount] = useState(60);
  const [hasOpened, setHasOpened] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => Math.min(680, Math.max(420, Number(localStorage.getItem('nai_agent_panel_width')) || 520)));
  const [mobileHeight, setMobileHeight] = useState(() => Math.min(92, Math.max(25, Number(localStorage.getItem('nai_agent_mobile_height')) || 68)));
  const currentAssistantIdRef = useRef('');
  const responseStartedRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followBottomRef = useRef(true);
  const forceBottomAfterLoadRef = useRef(false);
  const loadedSessionIdRef = useRef('');
  // 会话历史加载的代际计数：丢弃切换会话后晚到的旧响应
  const sessionLoadSeqRef = useRef(0);
  // 初始化失败提示：吞掉错误会让面板永远停在"正在加载对话"且无重试入口
  const [sessionInitError, setSessionInitError] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingPanelWidthRef = useRef(panelWidth);
  const pendingMobileHeightRef = useRef(mobileHeight);
  const messageActionsRef = useRef({
    loadEarlier: () => {},
    copy: (_message: PanelMessage) => {},
    edit: (_message: PanelMessage) => {},
    retry: () => {},
  });
  const confirmAction = useConfirmDialog();
  const closePanel = () => {
    props.onClose();
  };
  const requestClose = useMobileHistoryLayer(props.open, closePanel, 'prompt-agent');

  useEffect(() => {
    if (props.open) setHasOpened(true);
    localStorage.removeItem('nai_agent_fullscreen');
  }, [props.open]);

  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    // Keep the composer naturally sized for normal multi-line instructions.
    // Only exceptionally long pasted text gets its own scroll area, so it
    // cannot hide the conversation and send controls.
    textarea.style.height = 'auto';
    const maxHeight = Math.max(176, Math.floor(window.innerHeight * 0.42));
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input, props.open]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--agent-panel-width', `${panelWidth}px`);
    // Multiple editors can stay mounted at once. A closed panel must not clear
    // the docking class owned by the currently visible panel.
    if (!props.open) return;
    root.classList.add('agent-panel-docked');
    return () => root.classList.remove('agent-panel-docked');
  }, [props.open, panelWidth]);

  const startDesktopResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (window.innerWidth < 1024) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    panelRef.current?.style.setProperty('transition', 'none');
    const move = (moveEvent: PointerEvent) => {
      const next = Math.min(680, Math.max(420, startWidth + startX - moveEvent.clientX));
      pendingPanelWidthRef.current = next;
      document.documentElement.style.setProperty('--agent-panel-width', `${next}px`);
      panelRef.current?.style.setProperty('--agent-width', `${next}px`);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      const next = pendingPanelWidthRef.current;
      setPanelWidth(next);
      localStorage.setItem('nai_agent_panel_width', String(Math.round(next)));
      panelRef.current?.style.removeProperty('transition');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };

  const startMobileResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (window.innerWidth >= 1024) return;
    event.preventDefault();
    const startY = event.clientY;
    const startPixels = window.innerHeight * mobileHeight / 100;
    panelRef.current?.style.setProperty('transition', 'none');
    const move = (moveEvent: PointerEvent) => {
      const nextPixels = startPixels + startY - moveEvent.clientY;
      const next = Math.min(92, Math.max(25, nextPixels / window.innerHeight * 100));
      pendingMobileHeightRef.current = next;
      panelRef.current?.style.setProperty('--agent-mobile-height', `${next}dvh`);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      const next = pendingMobileHeightRef.current;
      setMobileHeight(next);
      localStorage.setItem('nai_agent_mobile_height', String(Math.round(next)));
      panelRef.current?.style.removeProperty('transition');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };

  const choosePanelWidth = (width: number) => {
    const next = Math.min(680, Math.max(420, width));
    setPanelWidth(next);
    localStorage.setItem('nai_agent_panel_width', String(next));
  };

  const refreshSessions = async (preferredId?: string) => {
    let items = await promptAgentService.listSessions();
    if (!items.length) items = [await promptAgentService.createSession()];
    setSessions(items);
    const stored = localStorage.getItem('nai_prompt_agent_session') || '';
    const next = preferredId || activeSessionId || (items.some(item => item.id === stored) ? stored : items[0]?.id) || '';
    if (next) setActiveSessionId(next);
  };

  const loadCreativePresets = async () => {
    try {
      const state = await promptAgentService.getCreativePresets();
      setCreativePresets(state.items || []);
    } catch {
      // 容错：预设读取失败不影响 Agent 主流程
    }
  };

  useEffect(() => {
    if (!props.open) return;
    setSessionInitError('');
    void Promise.all([
      refreshSessions(),
      promptAgentService.getAvailableModels().then(setModels),
      loadCreativePresets(),
    ]).catch(() => setSessionInitError('无法连接 Agent 服务，请确认本地服务正在运行'));
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const refreshRuntime = () => {
      void Promise.all([
        refreshSessions(activeSessionId),
        promptAgentService.getAvailableModels().then(setModels),
        loadCreativePresets(),
      ]).catch(() => {});
    };
    window.addEventListener('nai-agent-runtime-changed', refreshRuntime);
    return () => window.removeEventListener('nai-agent-runtime-changed', refreshRuntime);
  }, [props.open, activeSessionId]);

  useEffect(() => {
    if (!props.open || !activeSessionId || running) return;
    // Opening/switching a conversation always starts at its newest message.
    // Keep this flag until the asynchronously loaded history has rendered.
    forceBottomAfterLoadRef.current = true;
    followBottomRef.current = true;
    setFollowingBottom(true);
    localStorage.setItem('nai_prompt_agent_session', activeSessionId);
    const switchingSession = loadedSessionIdRef.current !== activeSessionId;
    if (switchingSession) {
      setMessages([]);
      setVisibleMessageCount(60);
    }
    // 会话加载序号守卫：快速切换会话时，先发出的慢响应不得覆盖新会话的消息
    const loadSeq = ++sessionLoadSeqRef.current;
    void Promise.all([promptAgentService.getSession(activeSessionId), promptAgentService.getTask(activeSessionId)]).then(([items, task]) => {
      if (loadSeq !== sessionLoadSeqRef.current) return;
      const restored = items.map(item => ({ ...item }));
      if ((task.status === 'interrupted' || task.status === 'running') && task.events?.length) {
        const replayText = task.events.map(event => {
          if (event.type === 'text_delta') return event.delta;
          if (event.type === 'tool_start') return `\n▸ 开始：${event.toolName}`;
          if (event.type === 'tool_end') return `\n${event.isError ? '✕' : '✓'} 完成：${event.toolName}`;
          if (event.type === 'action') return `\n◆ 操作：${event.action.kind}`;
          if (event.type === 'queue') return `\n↳ 已排队：${event.action}`;
          return '';
        }).join('').trim();
        restored.push({ id: `task-replay-${activeSessionId}`, role: 'agent', text: `任务执行回放（${task.status === 'running' ? '异常中断' : '中断'}）\n\n${replayText || '没有可恢复的文本事件。'}\n\n你可以继续发送要求。` });
      }
      loadedSessionIdRef.current = activeSessionId;
      setMessages(restored);
    }).catch(() => {});
  }, [props.open, activeSessionId]);

  // Re-attach to a computer-side task after a refresh or phone reconnect.
  // Poll quickly only while work is running; idle conversations back off.
  useEffect(() => {
    if (!props.open || !activeSessionId) return;
    let disposed = false;
    let timer = 0;
    let wasRunning = running;
    const poll = async () => {
      let delay = wasRunning ? 2000 : 10000;
      try {
        const task = await promptAgentService.getTask(activeSessionId);
        if (disposed) return;
        const isRunning = task.status === 'running';
        delay = isRunning ? 2000 : 10000;
        if (isRunning) setRunning(true);
        else if (wasRunning && ['completed', 'failed', 'aborted', 'interrupted'].includes(String(task.status))) {
          setRunning(false);
          const history = await promptAgentService.getSession(activeSessionId).catch(() => []);
          if (!disposed) setMessages(history.map(item => ({ ...item })));
          void refreshSessions(activeSessionId);
        }
        wasRunning = isRunning;
      } catch { /* task polling is best effort */ }
      if (!disposed) timer = window.setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [props.open, activeSessionId]);

  const activeSession = sessions.find(item => item.id === activeSessionId);
  const activeModel = models.find(item => item.provider === activeSession?.provider && item.id === activeSession?.model);
  const supportsImages = Boolean(activeModel?.imageInput || activeSession?.visionAvailable);
  const sessionReady = Boolean(activeSessionId && activeSession);
  const runningTool = messages.slice().reverse().map(message => message.tools?.find(tool => tool.state === 'running')).find(Boolean);
  const executionStatus = running
    ? runningTool ? `正在${toolLabels[runningTool.name] || runningTool.name}` : responseStartedRef.current ? '正在生成回复' : '正在准备任务'
    : !sessionReady ? '正在加载对话' : editingMessageId ? '正在编辑旧消息' : '准备就绪';

  useLayoutEffect(() => {
    if (!props.open) return;
    const force = forceBottomAfterLoadRef.current;
    if (!force && !followBottomRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: force || running ? 'auto' : 'smooth' });
    // Do not consume the force flag while the old message list is being
    // cleared. The next render containing loaded history must still jump.
    if (force && messages.length > 0) forceBottomAfterLoadRef.current = false;
  }, [messages, running, props.open]);

  useLayoutEffect(() => {
    if (!props.open) return;
    forceBottomAfterLoadRef.current = true;
    followBottomRef.current = true;
    setFollowingBottom(true);
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [props.open, activeSessionId]);

  useEffect(() => {
    if (!props.open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (sessionMenuId) {
          setSessionMenuId('');
          return;
        }
        if (showMoreMenu) {
          setShowMoreMenu(false);
          return;
        }
        if (showModelMenu) {
          setShowModelMenu(false);
          return;
        }
        if (showSessions) {
          setShowSessions(false);
          return;
        }
        if (editingMessageId) {
          setEditingMessageId('');
          setInput('');
          return;
        }
        closePanel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [props.open, sessionMenuId, showMoreMenu, showModelMenu, showSessions, editingMessageId]);

  useEffect(() => {
    if (!sessionMenuId) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('[data-session-menu]')) return;
      setSessionMenuId('');
    };
    window.addEventListener('pointerdown', closeOnOutsidePointerDown);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointerDown);
  }, [sessionMenuId]);

  useEffect(() => {
    if (!showModelMenu) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !modelMenuRef.current?.contains(event.target)) setShowModelMenu(false);
    };
    window.addEventListener('pointerdown', closeOnOutsidePointerDown);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointerDown);
  }, [showModelMenu]);

  useEffect(() => {
    if (!showMoreMenu) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreMenuRef.current?.contains(event.target)) setShowMoreMenu(false);
    };
    window.addEventListener('pointerdown', closeOnOutsidePointerDown);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointerDown);
  }, [showMoreMenu]);

  if (!props.open && !hasOpened) return null;

  const exportAuditLog = async () => {
    if (!activeSessionId || exportingLog) return;
    setExportingLog(true);
    setLogExportError('');
    try {
      const log = await promptAgentService.getAuditLog(activeSessionId);
      const blob = new Blob([`${JSON.stringify(log, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const title = (activeSession?.title || 'agent').replace(/[\\/:*?"<>|]/g, '_').slice(0, 36);
      anchor.href = url;
      anchor.download = `nai-agent-log-${title || 'session'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setLogExportError(error instanceof Error ? error.message : '导出日志失败');
    } finally {
      setExportingLog(false);
    }
  };

  const run = async (suggestion?: string, mode: 'prompt' | 'retry' = 'prompt') => {
    const prompt = (suggestion ?? input).trim() || (attachments.length ? '请分析我附带的图片，并结合项目内容给出建议。' : '');
    if (!activeSessionId || !activeSession || (mode === 'prompt' && !prompt)) return;
    if (attachments.length && !supportsImages) {
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: '没有可用的视觉模型，请先在 Agent 设置中选择带“识图”标记的模型。' }]);
      return;
    }
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
    props.onRunStart(runSnapshot);
    let labChanged = false;
    let navigationTarget: { view: 'list' | 'characters' | 'library' | 'aitag' | 'danbooru' | 'inspiration' | 'history' | 'playground'; id?: string } | null = null;
    const controller = new AbortController();
    try {
      const imageDisplay = getMobileImageDisplayPreferences();
      let artistFavorites: string[] = [];
      try { artistFavorites = JSON.parse(localStorage.getItem('nai_fav_artists') || '[]'); } catch { /* ignore damaged browser preference */ }
      await promptAgentService.run({ apiKey: props.apiKey, sessionId: activeSessionId, message: prompt, mode: effectiveMode, images: effectiveMode === 'prompt' ? attachments.map(({ data, mimeType }) => ({ data, mimeType })) : [], draft: props.draft, context: { clientSettings: {
        themeMode: localStorage.getItem('nai_theme') || 'system', safeMode: localStorage.getItem('nai_safe_mode') === 'true', safeModeStartup: localStorage.getItem('nai_safe_mode_startup') !== 'false',
        imageLayout: imageDisplay.layout, imageColumns: imageDisplay.columns, mobileCache: getMobileCacheStats(), novelAiKeyConfigured: Boolean(props.apiKey), artistFavorites: Array.isArray(artistFavorites) ? artistFavorites.slice(0, 2000) : [],
        tagAssistEnabled: props.tagAssistEnabled,
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
        if (event.type === 'vision_usage') setMessages(previous => previous.map(item => item.id === currentAssistantIdRef.current ? { ...item, visionUsage: [...(item.visionUsage || []), { provider: event.provider, model: event.model, imageCount: event.imageCount, usage: event.usage }] } : item));
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
                await promptAgentService.control(activeSessionId, 'confirm', patch.requestId, { requestId: patch.requestId, accepted: true });
                if (patch.action === 'encode_vibe') {
                  if (!props.apiKey) throw new Error('请先在全局设置中填写 NovelAI API Key');
                  await vibeService.encode(patch.resourceId || '', Number(patch.payload?.informationExtracted ?? 1), props.apiKey);
                  await promptAgentService.control(activeSessionId, 'finalize', patch.requestId, { requestId: patch.requestId, success: true, result: { action: patch.action, resourceId: patch.resourceId } });
                } else if (patch.action === 'clear_mobile_cache') {
                  await clearMobileThumbnailCache();
                  await promptAgentService.control(activeSessionId, 'finalize', patch.requestId, { requestId: patch.requestId, success: true, result: { action: patch.action } });
                } else await promptAgentService.executeProjectAction({ action: patch.action, resourceId: patch.resourceId, payload: patch.payload, sessionId: activeSessionId, confirmationRequestId: patch.requestId });
                window.dispatchEvent(new CustomEvent('nai-project-data-changed', { detail: patch }));
                setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'agent', text: '已在你确认后完成该项目操作。' }]);
              } catch (error) {
                await promptAgentService.control(activeSessionId, 'finalize', patch.requestId, { requestId: patch.requestId, success: false }).catch(() => {});
                setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : '项目操作失败' }]);
              }
            })();
          } else if (event.action.kind === 'request_generation') {
            const generationAction = event.action;
            void Promise.resolve(props.onRequestGeneration(event.draft || props.draft, generationAction.patch.reason))
              .then(success => promptAgentService.control(activeSessionId, 'finalize', generationAction.patch.requestId, { requestId: generationAction.patch.requestId, success: success === true }).catch(() => {}))
              .catch(() => {
                // 生图流程本身抛异常也必须回传 finalize，否则服务端任务永久等待确认
                void promptAgentService.control(activeSessionId, 'finalize', generationAction.patch.requestId, { requestId: generationAction.patch.requestId, success: false }).catch(() => {});
              });
          } else if (event.action.kind === 'set_client_preferences') {
            const patch = event.action.patch;
            if (patch.themeMode) {
              localStorage.setItem('nai_theme', patch.themeMode);
              window.dispatchEvent(new CustomEvent('nai-agent-theme-change', { detail: patch.themeMode }));
            }
            if (patch.safeMode !== undefined) {
              localStorage.setItem('nai_safe_mode', String(patch.safeMode));
              window.dispatchEvent(new CustomEvent('nai-agent-safe-mode-change', { detail: patch.safeMode }));
            }
            if (patch.safeModeStartup !== undefined) localStorage.setItem('nai_safe_mode_startup', String(patch.safeModeStartup));
            if (patch.imageLayout || patch.imageColumns !== undefined) {
              const current = getMobileImageDisplayPreferences();
              setMobileImageDisplayPreferences({ layout: patch.imageLayout || current.layout, columns: patch.imageColumns ?? current.columns, desktopColumns: current.desktopColumns });
            }
            if (patch.mobileCacheLimit !== undefined) setMobileCacheLimitMb(patch.mobileCacheLimit);
            window.dispatchEvent(new CustomEvent('nai-agent-ui-preferences', { detail: patch }));
          } else if (event.action.kind === 'manage_artist_favorite') {
            let favorites: string[] = [];
            try { favorites = JSON.parse(localStorage.getItem('nai_fav_artists') || '[]'); } catch { /* ignore damaged browser preference */ }
            const next = new Set(Array.isArray(favorites) ? favorites : []);
            if (event.action.patch.favorite) next.add(event.action.patch.name); else next.delete(event.action.patch.name);
            localStorage.setItem('nai_fav_artists', JSON.stringify([...next]));
            window.dispatchEvent(new CustomEvent('nai-agent-artist-favorites-change'));
          } else if (event.action.kind === 'navigate_view') {
            navigationTarget = event.action.patch;
          } else {
            labChanged = true;
            // The service mutates its isolated draft. Do not apply individual
            // actions to React state while the user may still be editing; the
            // complete draft is committed atomically in the done event.
          }
        }
        if (event.type === 'error') throw new Error(event.error);
        if (event.type === 'done') {
          if (labChanged) props.onFinalDraft(event.draft);
          if (navigationTarget) {
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
        setMessages(previous => [...previous.filter(item => item.id !== assistantId || item.text || item.tools?.length || item.visionUsage?.length), { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : 'Agent 执行失败' }]);
      }
    } finally {
      setRunning(false);
      void refreshSessions(activeSessionId);
    }
  };

  const reset = async () => {
    if (running || !activeSessionId || !activeSession) return;
    if (!await confirmAction({ title: '清空当前 Agent 对话？', message: '只会删除这条对话的聊天记录，不影响项目资料、图片或设置。', confirmLabel: '清空对话', tone: 'danger' })) return;
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

  const thinkingLevelLabels: Record<PromptAgentThinkingLevel, string> = { off: '不思考', minimal: '极少', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最大' };
  const availableThinkingLevels = activeModel?.thinkingLevels?.length
    ? activeModel.thinkingLevels
    : activeModel?.reasoning ? ['off', 'minimal', 'low', 'medium', 'high'] as PromptAgentThinkingLevel[] : ['off'] as PromptAgentThinkingLevel[];
  const selectedThinkingLevel = availableThinkingLevels.includes(activeSession?.thinkingLevel || 'off')
    ? activeSession?.thinkingLevel || 'off'
    : availableThinkingLevels.at(-1) || 'off';

  const updateCreativeMode = async (creativeMode: boolean) => {
    if (!activeSession || running || activeSession.creativeModeLocked || activeSession.messageCount) return;
    try {
      const updated = await promptAgentService.updateSession(activeSession.id, { creativeMode });
      setSessions(previous => previous.map(item => item.id === updated.id ? {
        ...item,
        ...updated,
        ...(creativeMode === false ? { presetName: undefined, presetRevisionHash: undefined, effectivePolicyFingerprint: undefined } : {}),
      } : item));
    } catch (error) {
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : '切换破限模式失败' }]);
    }
  };

  const selectSessionPreset = async (targetPresetId: string | 'off') => {
    if (!activeSession || running || activeSession.creativeModeLocked || activeSession.messageCount) return;
    try {
      if (targetPresetId === 'off') {
        const updated = await promptAgentService.updateSession(activeSession.id, { creativeMode: false });
        setSessions(previous => previous.map(item => item.id === updated.id ? {
          ...item,
          ...updated,
          presetName: undefined,
          presetRevisionHash: undefined,
          effectivePolicyFingerprint: undefined,
        } : item));
        return;
      }
      // 阶段三：切换预设只作用于当前这条新会话（方案 A）
      const presetState = await promptAgentService.getCreativePresets();
      const originalActive = presetState.activeCreativePresetId || null;
      await promptAgentService.setActiveCreativePreset(targetPresetId);
      try {
        if (activeSession.creativeMode) {
          await promptAgentService.updateSession(activeSession.id, { creativeMode: false });
        }
        const updated = await promptAgentService.updateSession(activeSession.id, { creativeMode: true });
        setSessions(previous => previous.map(item => item.id === updated.id ? {
          ...item,
          ...updated,
        } : item));
      } finally {
        await promptAgentService.setActiveCreativePreset(originalActive);
      }
    } catch (error) {
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : '切换破限预设失败' }]);
    }
  };

  const defaultPresetId = creativePresets.find(p => p.isBuiltin)?.id || creativePresets[0]?.id || 'builtin-default';
  const getSessionPresetValue = (session: PromptAgentSession | null) => {
    if (!session || !session.creativeMode) return 'off';
    if (!session.presetName) return defaultPresetId;
    return creativePresets.find(p => p.name === session.presetName)?.id || defaultPresetId;
  };

  const formatUsage = (usage?: PromptAgentUsage) => usage && typeof usage.totalTokens === 'number'
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
    let projectedBytes = attachments.reduce((sum, item) => sum + item.data.length, 0);
    [...files].slice(0, 4 - attachments.length).forEach(file => {
      if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(file.type) || file.size > 6 * 1024 * 1024) return;
      // Keep the encoded request below the gateway limit, not just the raw
      // per-file limit. Base64 is larger than the original binary data.
      if (projectedBytes + Math.ceil(file.size * 4 / 3) > 44 * 1024 * 1024) return;
      projectedBytes += Math.ceil(file.size * 4 / 3);
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || '');
        const data = value.replace(/^data:[^;]+;base64,/, '');
        setAttachments(previous => previous.length >= 4 ? previous : [...previous, { data, mimeType: file.type, name: file.name }]);
      };
      reader.readAsDataURL(file);
    });
  };

  messageActionsRef.current = {
    loadEarlier: () => setVisibleMessageCount(count => count + 60),
    copy: message => { void copyMessage(message.id, message.text); },
    edit: message => { setEditingMessageId(message.id); setInput(message.text); },
    retry: () => { void run('', 'retry'); },
  };

  return createPortal(<div aria-hidden={!props.open} className={`agent-overlay pointer-events-none fixed inset-0 z-[1100] ${props.open ? 'agent-overlay--open' : 'agent-overlay--closed'}`}>
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Agent 控制面板"
      className="agent-panel pointer-events-auto absolute flex overflow-hidden border-gray-200 bg-gray-50 shadow-2xl transition-[width,height,border-radius] dark:border-gray-800 dark:bg-gray-950"
      style={{ '--agent-mobile-height': `${mobileHeight}dvh`, '--agent-width': `${panelWidth}px` } as React.CSSProperties}
    >
    <button type="button" aria-label="调整 Agent 宽度" onPointerDown={startDesktopResize} className="agent-resize-handle-desktop" />
    <button type="button" aria-label="调整 Agent 高度" onPointerDown={startMobileResize} className="agent-resize-handle-mobile"><span /></button>
    {showSessions && <button type="button" aria-label="关闭会话列表" onClick={() => { setShowSessions(false); setSessionMenuId(''); }} className="absolute inset-0 z-10 bg-black/35" />}
    <aside aria-label="Agent 会话历史" className={`${showSessions ? 'translate-x-0' : '-translate-x-full'} absolute inset-y-0 left-0 z-20 flex w-[min(82%,19rem)] flex-col border-r border-gray-200 bg-white pt-[env(safe-area-inset-top)] shadow-2xl transition-transform dark:border-gray-800 dark:bg-gray-900`}>
      <div className="flex h-14 items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800">
        <b className="min-w-0 flex-1 truncate text-sm dark:text-white">Agent 对话</b>
        <button type="button" onClick={() => void createSession()} disabled={running || busySessionAction} className="mobile-touch flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-500/20 disabled:opacity-40" aria-label="新建对话" title="新建对话"><Plus className="h-5 w-5" /></button>
        <button type="button" onClick={() => { setShowSessions(false); setSessionMenuId(''); }} className="mobile-touch flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200" aria-label="关闭会话列表" title="关闭"><X className="h-5 w-5" /></button>
      </div>
      <div className="px-2 py-2"><input value={sessionSearch} onChange={event => setSessionSearch(event.target.value)} placeholder="搜索对话" className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs text-gray-800 outline-none placeholder:text-gray-400 focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-600" /></div>
      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {sessions.filter(session => (session.title || '').toLowerCase().includes(sessionSearch.trim().toLowerCase())).length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400">没有找到匹配的对话</div>
        ) : sessions.filter(session => session.title.toLowerCase().includes(sessionSearch.trim().toLowerCase())).map(session => <div key={session.id} className={`group relative min-h-[4.75rem] rounded-xl border ${session.id === activeSessionId ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30' : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
          {editingSessionId === session.id ? <form onSubmit={event => { event.preventDefault(); void saveSessionTitle(session); }} className="flex min-h-[4.75rem] items-center px-2 pr-12"><input autoFocus value={editingTitle} onChange={event => setEditingTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setEditingSessionId(''); }} onBlur={() => void saveSessionTitle(session)} className="h-9 min-w-0 flex-1 rounded-lg border border-indigo-300 bg-white px-2 text-xs text-gray-800 outline-none dark:bg-gray-950 dark:text-gray-100" /></form> : <button type="button" disabled={running && session.id !== activeSessionId} onClick={() => { if (!running) { setActiveSessionId(session.id); setShowSessions(false); setSessionMenuId(''); } }} className="block min-h-[4.75rem] w-full py-2 pl-3 pr-12 text-left">
            <span className="block truncate text-sm font-bold text-gray-800 dark:text-gray-100">{session.title}</span>
            <span className="mt-0.5 block truncate text-micro text-gray-400">{displayModelName(session.model)} · {session.messageCount || 0} 轮 · {new Date(session.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            <span className="mt-1 flex items-center gap-1.5 text-mini font-bold"><span className={`rounded-full px-1.5 py-0.5 ${session.creativeMode ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>破限{session.creativeMode ? '开' : '关'}</span>{(() => { const presetLabel = formatPresetSessionLabel(session); return presetLabel ? <span title={presetLabel} className="max-w-28 truncate rounded-full bg-violet-100 px-1.5 py-0.5 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">{presetLabel}</span> : null; })()}{session.running ? <span className="text-indigo-600">工作中</span> : session.taskStatus === 'interrupted' ? <span className="text-amber-600">上次中断</span> : session.taskStatus === 'failed' ? <span className="text-red-500">上次失败</span> : <span className="text-emerald-600">就绪</span>}</span>
          </button>}
          <button type="button" data-session-menu onClick={() => setSessionMenuId(value => value === session.id ? '' : session.id)} className="mobile-touch absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:bg-white/70 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200" aria-label="会话操作" title="会话操作"><MoreHorizontal className="h-4 w-4" /></button>
          {sessionMenuId === session.id && <div data-session-menu className="absolute right-1 top-[calc(50%+1.45rem)] z-30 w-28 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-xl ring-1 ring-black/5 dark:border-gray-700 dark:bg-gray-900">
            <button type="button" onClick={() => { setSessionMenuId(''); setEditingSessionId(session.id); setEditingTitle(session.title); }} disabled={running} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-gray-800"><Pencil className="h-3.5 w-3.5" />重命名</button>
            <button type="button" onClick={() => { setSessionMenuId(''); void deleteSession(session); }} disabled={running || sessions.length <= 1} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-30 dark:text-rose-400 dark:hover:bg-rose-950/30"><Trash2 className="h-3.5 w-3.5 text-rose-500" />删除</button>
          </div>}
        </div>)}
      </div>
      <p className="border-t border-gray-100 px-4 py-3 text-micro leading-4 text-gray-400 dark:border-gray-800">对话保存在电脑本地。删除与付费项目操作仍会单独确认。</p>
    </aside>

    <section className="relative flex min-w-0 flex-1 flex-col">
      {/* 顶栏与状态栏合流为单行（节省约 36px 空间） */}
      <header className="border-b border-gray-200 bg-white pt-[env(safe-area-inset-top)] dark:border-gray-800 dark:bg-gray-900">
        <div className="flex h-12 items-center gap-1 px-2 md:px-3">
          <button type="button" onClick={requestClose} className="mobile-touch flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800" aria-label="返回" title="返回"><ArrowLeft className="h-5 w-5" /></button>
          <button type="button" onClick={() => { setShowSessions(true); setShowModelMenu(false); setShowMoreMenu(false); }} className="mobile-touch flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800" aria-label="会话列表" title="会话列表"><List className="h-5 w-5" /></button>

          {/* 标题与执行状态圆点合流 */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  running
                    ? 'animate-pulse bg-indigo-500'
                    : !sessionReady
                      ? 'animate-pulse bg-gray-400'
                      : editingMessageId
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                }`}
                title={executionStatus}
              />
              <h2 className="truncate text-sm font-black text-gray-900 dark:text-white">
                {activeSession?.title || '项目 Agent'}
              </h2>
            </div>
            <div className="flex min-w-0 items-center gap-1.5 truncate text-micro text-gray-500">
              {running ? (
                <span className="truncate font-bold text-indigo-600 dark:text-indigo-400">
                  {executionStatus}
                </span>
              ) : (
                <>
                  <span className="truncate font-medium text-gray-600 dark:text-gray-300" title={activeSession?.model || ''}>
                    {displayModelName(activeSession?.model) || '未选择模型'}
                  </span>
                  {activeSession?.creativeMode && (
                    <span
                      className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-mini font-bold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
                      title={formatPresetSessionLabel(activeSession) || (activeSession.presetName ? `破限预设：${activeSession.presetName}` : '破限模式已开启')}
                    >
                      破限
                    </span>
                  )}
                  {activeSession?.thinkingLevel && activeSession.thinkingLevel !== 'off' && (
                    <span className="hidden shrink-0 truncate md:inline"> · 思考:{thinkingLevelLabels[activeSession.thinkingLevel]}</span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 撤销修改：醒目克制地提升到主顶栏 */}
          {props.canUndo && (
            <button
              type="button"
              onClick={props.onUndo}
              disabled={running}
              className="mobile-touch inline-flex h-9 items-center gap-1 rounded-xl border border-amber-300/80 bg-amber-50 px-2.5 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-40 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70"
              title="撤销最近一次 Agent 对项目的修改"
              aria-label="撤销修改"
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">撤销修改</span>
            </button>
          )}

          {/* 模型与思考设置菜单 */}
          <div ref={modelMenuRef} className="static flex items-center gap-1 md:relative">
            <button type="button" onClick={() => setShowModelMenu(value => { const next = !value; if (next) setShowMoreMenu(false); return next; })} className={`mobile-touch flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 dark:text-gray-400 ${showModelMenu ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`} aria-label="模型与思考设置" title="模型与思考设置"><SlidersHorizontal className="h-5 w-5" /></button>
            {showModelMenu && <div className="absolute inset-x-2 bottom-2 top-12 z-30 flex w-auto max-h-none flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 md:inset-x-auto md:bottom-auto md:right-0 md:top-11 md:max-h-[min(76vh,42rem)] md:w-[min(20rem,calc(100vw-1rem))]">
              <div className="border-b border-gray-100 p-3 dark:border-gray-800"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className="block text-xs text-gray-700 dark:text-gray-100">模型与思考</b><span className="mt-0.5 block truncate text-micro text-gray-400">{displayModelName(activeSession?.model) || '正在加载对话…'}</span></div><div className="flex items-center gap-1.5"><span className="shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-micro font-bold text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">最高：{thinkingLevelLabels[availableThinkingLevels.at(-1) || 'off']}</span><button type="button" onClick={() => setShowModelMenu(false)} className="mobile-touch flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200 md:hidden" aria-label="关闭模型菜单" title="关闭"><X className="h-4 w-4" /></button></div></div><label className="mt-3 flex items-center gap-2 text-meta text-gray-500"><span className="flex-1">思考等级</span><select aria-label="思考等级" disabled={!sessionReady || running || availableThinkingLevels.length <= 1} value={selectedThinkingLevel} onChange={event => void updateThinkingLevel(event.target.value as PromptAgentThinkingLevel)} className="h-9 min-w-24 rounded-lg border border-gray-200 bg-gray-50 px-2 text-xs font-bold text-gray-700 outline-none disabled:opacity-40 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200">{availableThinkingLevels.map(level => <option key={level} value={level}>{thinkingLevelLabels[level]}</option>)}</select></label>{activeSession && !activeSession.creativeModeLocked && !activeSession.messageCount && <div className="mt-3 border-t border-gray-100 pt-2.5 dark:border-gray-800"><div className="flex items-center justify-between gap-2"><span className="text-meta text-gray-600 dark:text-gray-300">破限预设</span><select aria-label="切换本对话破限模式" disabled={running} value={getSessionPresetValue(activeSession)} onChange={event => void selectSessionPreset(event.target.value)} className="h-8 max-w-[10rem] rounded-lg border border-gray-200 bg-gray-50 px-2 text-xs font-bold text-violet-700 outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-violet-300"><option value="off">关闭破限</option><optgroup label="内置预设">{creativePresets.filter(p => p.isBuiltin).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>{creativePresets.some(p => !p.isBuiltin) && <optgroup label="自定义预设">{creativePresets.filter(p => !p.isBuiltin).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}</select></div><span className="mt-1 block text-micro text-gray-400">仅对当前对话生效，首条消息后锁定</span></div>}{activeSession?.creativeModeLocked && <div className="mt-3 border-t border-gray-100 pt-2.5 text-micro text-gray-400 dark:border-gray-800">破限模式：<b className="text-gray-600 dark:text-gray-300">{activeSession.creativeMode ? (activeSession.presetName || '已开启') : '已关闭'}</b>（已随首条消息锁定）</div>}</div>
              <div className="overflow-y-auto p-2"><button type="button" onClick={() => { setShowModelMenu(false); window.dispatchEvent(new CustomEvent('nai-open-global-settings', { detail: { section: 'agent' } })); }} className="mb-2 flex w-full items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-left text-xs font-bold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-950/50"><span>配置模型服务</span><span aria-hidden="true">→</span></button>{models.map(model => <button key={`${model.provider}/${model.id}`} type="button" disabled={!sessionReady || running} onClick={() => void updateSessionModel(model)} className={`block w-full rounded-xl px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-40 ${model.provider === activeSession?.provider && model.id === activeSession?.model ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}><b className="block truncate text-xs text-gray-800 dark:text-white">{displayModelName(model.id)}</b><span className="block text-micro text-gray-400">{model.providerName || model.provider} · {model.reasoning ? `推理，最高 ${thinkingLevelLabels[model.thinkingLevels.at(-1) || 'off']}` : '普通'}{model.imageInput ? ' · 识图' : ''}</span></button>)}</div>
              <div className="hidden border-t border-gray-100 p-3 md:block dark:border-gray-800"><div className="mb-2 text-micro font-bold text-gray-400">面板宽度</div><div className="grid grid-cols-3 gap-1">{[{ label: '窄', width: 440 }, { label: '标准', width: 540 }, { label: '宽', width: 680 }].map(item => <button key={item.width} type="button" onClick={() => choosePanelWidth(item.width)} className={`h-8 rounded-lg text-meta font-bold ${Math.abs(panelWidth - item.width) < 30 ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}>{item.label}</button>)}</div></div>
            </div>}
          </div>

          {/* 新增：“…” 更多菜单（收进：导出会话日志、清空当前对话） */}
          <div ref={moreMenuRef} className="relative flex items-center">
            <button
              type="button"
              onClick={() => setShowMoreMenu(value => { const next = !value; if (next) setShowModelMenu(false); return next; })}
              className={`mobile-touch flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 ${showMoreMenu ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
              aria-label="更多会话操作"
              title="更多会话操作"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {showMoreMenu && (
              <div className="absolute right-0 top-11 z-30 w-44 overflow-hidden rounded-2xl border border-gray-200 bg-white p-1.5 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    void exportAuditLog();
                  }}
                  disabled={exportingLog || !activeSessionId}
                  className="flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-gray-800"
                  aria-label="导出本会话 Agent 日志"
                >
                  <Download className="h-4 w-4 text-gray-400" />
                  <span>{exportingLog ? '正在导出…' : '导出会话日志'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    void reset();
                  }}
                  disabled={!sessionReady || running || !messages.length}
                  className="flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-30 dark:text-rose-400 dark:hover:bg-rose-950/30"
                  aria-label="清空对话"
                >
                  <Trash2 className="h-4 w-4 text-rose-500" />
                  <span>清空当前对话</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {logExportError && <div role="status" className="absolute right-3 top-[calc(3.25rem+env(safe-area-inset-top))] z-40 max-w-[min(28rem,calc(100%-1.5rem))] rounded-lg bg-red-50 px-2 py-1 text-micro font-bold text-red-600 shadow dark:bg-red-950/80 dark:text-red-300">{logExportError}</div>}

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden">
        <div ref={scrollRef} onScroll={event => { const element = event.currentTarget; const next = element.scrollHeight - element.scrollTop - element.clientHeight < 80; followBottomRef.current = next; setFollowingBottom(next); }} className="relative flex-1 space-y-3 overflow-y-auto p-3 md:p-4">
          {messages.length === 0 && <div className="mt-8 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"><Bot className="h-7 w-7" /></div><h3 className="mt-4 text-lg font-black dark:text-white">告诉我你想在项目里做什么</h3><p className="mt-1 text-sm text-gray-500">{sessionReady ? '这是一条独立对话，可在项目的任何页面继续。' : sessionInitError || '正在加载这条对话…'}</p>{!sessionReady && sessionInitError && <button type="button" onClick={() => { setSessionInitError(''); void Promise.all([refreshSessions(), promptAgentService.getAvailableModels().then(setModels)]).catch(() => setSessionInitError('无法连接 Agent 服务，请确认本地服务正在运行')); }} className="mobile-touch mt-3 rounded-xl border border-indigo-300 bg-white px-4 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-gray-900 dark:text-indigo-300">重试</button>}{activeSession && !activeSession.creativeModeLocked && !activeSession.messageCount && (
            <div className="mx-auto mt-4 flex max-w-sm items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50/50 p-3 text-left shadow-sm dark:border-violet-900/50 dark:bg-violet-950/20">
              <div className="min-w-0 flex-1">
                <b className="block text-xs font-bold text-gray-800 dark:text-gray-100">破限预设</b>
                <span className="block text-micro text-gray-500">首条消息前可选，发送后锁定</span>
              </div>
              <select
                aria-label="选择破限预设"
                disabled={running}
                value={getSessionPresetValue(activeSession)}
                onChange={event => void selectSessionPreset(event.target.value)}
                className="mobile-touch max-w-[11rem] rounded-xl border border-violet-300 bg-white px-2.5 py-1 text-xs font-bold text-violet-700 shadow-sm outline-none dark:border-violet-800 dark:bg-gray-900 dark:text-violet-300"
              >
                <option value="off">关闭破限（普通模式）</option>
                <optgroup label="内置预设">
                  {creativePresets.filter(p => p.isBuiltin).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
                {creativePresets.some(p => !p.isBuiltin) && (
                  <optgroup label="自定义预设">
                    {creativePresets.filter(p => !p.isBuiltin).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}<div className="mx-auto mt-5 grid max-w-lg gap-2 sm:grid-cols-2">{['查看最后一张图并改进动作', '检查整个项目的资料情况', '设计角色并调整实验室', '查看当前设置和 Anlas 预算'].map(value => <button key={value} type="button" disabled={!sessionReady} onClick={() => void run(value)} className="mobile-touch rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 shadow-sm hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">{value}</button>)}</div></div>}
          <AgentMessageList
            messages={messages}
            visibleMessageCount={visibleMessageCount}
            running={running}
            copiedMessageId={copiedMessageId}
            onLoadEarlier={() => messageActionsRef.current.loadEarlier()}
            onCopy={message => messageActionsRef.current.copy(message)}
            onEdit={message => messageActionsRef.current.edit(message)}
            onRetry={() => messageActionsRef.current.retry()}
          />
          {!followingBottom && <button type="button" onClick={() => { followBottomRef.current = true; setFollowingBottom(true); scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }} className="sticky bottom-2 mx-auto flex items-center gap-1 rounded-full bg-gray-900/90 px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-xs transition hover:scale-105 active:scale-95 dark:bg-white/90 dark:text-gray-900"><ArrowDown className="h-3.5 w-3.5" />回到底部</button>}
        </div>
          <div className="border-t border-gray-200 bg-white p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] dark:border-gray-800 dark:bg-gray-900 md:p-3" aria-busy={!sessionReady}>
          {editingMessageId && !running && <div className="mb-2 flex items-center rounded-xl bg-amber-50 px-3 py-1.5 text-meta text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"><b>正在编辑旧消息</b><span className="ml-1">发送后会从这里重新执行，后面的旧回答将被替换。</span><span className="flex-1" /><button type="button" onClick={() => { setEditingMessageId(''); setInput(''); }} className="font-bold">取消</button></div>}
          {running && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-2.5 py-1.5 text-xs dark:border-indigo-950/60 dark:bg-indigo-950/30">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 font-bold text-indigo-700 dark:text-indigo-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
                  追加模式
                </span>
                <div className="inline-flex rounded-lg bg-indigo-100/70 p-0.5 dark:bg-indigo-900/50">
                  <button
                    type="button"
                    onClick={() => setQueueMode('steer')}
                    className={`rounded-md px-2 py-0.5 text-micro font-bold transition ${
                      queueMode === 'steer'
                        ? 'bg-white text-indigo-700 shadow-sm dark:bg-gray-800 dark:text-indigo-300'
                        : 'text-gray-500 hover:text-indigo-700 dark:text-gray-400 dark:hover:text-indigo-200'
                    }`}
                  >
                    转向当前任务
                  </button>
                  <button
                    type="button"
                    onClick={() => setQueueMode('followUp')}
                    className={`rounded-md px-2 py-0.5 text-micro font-bold transition ${
                      queueMode === 'followUp'
                        ? 'bg-white text-indigo-700 shadow-sm dark:bg-gray-800 dark:text-indigo-300'
                        : 'text-gray-500 hover:text-indigo-700 dark:text-gray-400 dark:hover:text-indigo-200'
                    }`}
                  >
                    排到任务之后
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void promptAgentService.control(activeSessionId, 'abort')}
                  className="mobile-touch flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-micro font-bold text-rose-600 transition hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60"
                  title="停止当前 Agent 任务"
                >
                  <Square className="h-2.5 w-2.5 fill-current" />
                  停止任务
                </button>
                <button
                  type="button"
                  onClick={() => void promptAgentService.control(activeSessionId, 'clear')}
                  className="mobile-touch rounded px-1.5 py-0.5 text-micro font-bold text-gray-400 transition-colors hover:text-rose-600 dark:hover:text-rose-400"
                  title="清空已排队的任务要求"
                >
                  清空排队
                </button>
              </div>
            </div>
          )}
          {!!attachments.length && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((attachment, index) => (
                <span key={`${attachment.name}-${index}`} className="flex max-w-48 items-center gap-1.5 rounded-full bg-indigo-50 py-1 pl-2.5 pr-1.5 text-micro text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200">
                  <span className="truncate">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments(previous => previous.filter((_, itemIndex) => itemIndex !== index))}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-indigo-400 hover:bg-indigo-200/60 hover:text-rose-600 dark:hover:bg-indigo-900 dark:hover:text-rose-300"
                    aria-label={`移除附件 ${attachment.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex min-w-0 items-end gap-2">
            <label title={!sessionReady ? '正在加载对话' : supportsImages ? '添加图片' : '没有可用的视觉模型'} aria-disabled={!sessionReady || running || attachments.length >= 4 || !supportsImages} className={`mobile-touch flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400 ${sessionReady && supportsImages && !running && attachments.length < 4 ? 'cursor-pointer hover:border-indigo-400 hover:text-indigo-500' : 'cursor-not-allowed opacity-35'}`}><ImagePlus className="h-[18px] w-[18px]" /><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden aria-label="选择图片附件" onChange={event => { addAttachments(event.target.files); event.currentTarget.value = ''; }} disabled={!sessionReady || running || attachments.length >= 4 || !supportsImages} /></label>
            <textarea ref={inputRef} value={input} disabled={!sessionReady} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void run(); } }} rows={1} placeholder={!sessionReady ? '正在加载对话…' : running ? (queueMode === 'steer' ? '补充或纠正当前任务…' : '添加完成后继续处理的任务…') : editingMessageId ? '修改这条消息后重新发送…' : '告诉 Agent 你想让它查看、修改或生成什么…'} className="min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm leading-5 text-gray-900 outline-none placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 disabled:cursor-wait disabled:opacity-55 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-600 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/20" />
            {running && !input.trim() && !attachments.length ? (
              <button
                type="button"
                onClick={() => void promptAgentService.control(activeSessionId, 'abort')}
                className="mobile-touch flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-rose-600 p-0 text-white shadow-lg shadow-rose-600/20 transition hover:bg-rose-500 active:scale-95"
                aria-label="停止"
                title="停止当前 Agent 任务"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void run()}
                disabled={!sessionReady || (!input.trim() && !attachments.length)}
                className="mobile-touch flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-indigo-600 p-0 text-white shadow-lg shadow-indigo-500/15 transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none dark:disabled:bg-gray-800 dark:disabled:text-gray-600"
                aria-label={!sessionReady ? '正在加载对话' : running ? '追加要求' : editingMessageId ? '重新发送' : '执行'}
                title={!sessionReady ? '正在加载对话' : running ? '追加要求' : editingMessageId ? '重新发送' : '执行'}
              >
                <Send className="h-[18px] w-[18px]" />
              </button>
            )}
          </div>
        </div>
      </main>
    </section>
    </div>
  </div>, document.body);
};
