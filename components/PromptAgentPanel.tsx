import './AgentSurface.css';
import { getLastAgentPageRead, observeAgentPage, readAgentPage, type AgentPageSnapshot } from '../services/agentWorkspace';
import { getAgentContextUsage } from '../services/agentContextUsage';
import { AgentProjectImage } from './AgentProjectImage';
import { extractAgentMedia } from '../services/agentMedia';
import { prepareAgentAttachment } from '../services/agentAttachments';
import { promptAgentCoordinator } from '../services/promptAgentCoordinator';
import { AgentChatDisplayOptions, AgentDisclosure, useAgentDisplayPreferences } from './AgentChatPreferences';
import { AgentPermissionSelect } from './AgentPermissionSelect';
import { AgentModelControl } from './AgentModelControl';
import { useAgentRuntimeRecheck } from './useAgentRuntimeRecheck';
import type { AgentDisplayPreferences } from '../services/agentDisplayPreferences';
import type { PromptAgentEvent, PromptAgentTask } from '../services/promptAgent';
import { appearanceScrollBehavior } from '../services/appearancePreferences';
import { isTopmostModal } from './useModalA11y';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PromptAgentDraft, PromptAgentGenerationResult } from '../types';
import { PromptAgentCreativePreset, PromptAgentModel, PromptAgentSession, PromptAgentThinkingLevel, PromptAgentUsage, PromptAgentVisionUsage, agentRuntimeWarning, displayModelName, promptAgentService } from '../services/promptAgent';
import { formatPresetSessionLabel } from './PromptAgentSettings';
import { vibeService } from '../services/vibeService';
import { useMobileHistoryLayer } from './MobileUI';
import { useConfirmDialog } from './ConfirmDialog';
import { getMobileImageDisplayPreferences, setMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { clearMobileThumbnailCache, getMobileCacheStats, setMobileCacheLimitMb } from '../services/mobileImageCache';
import { ArrowDown, ArrowUp, ArrowLeft, Bot, Check, ChevronDown, Copy, Download, Expand, ImagePlus, List, MoreHorizontal, Pencil, Plus, RotateCcw, Square, Trash2, X } from 'lucide-react';

interface PromptAgentPanelProps {
  open: boolean;
  onClose: () => void;
  draft: PromptAgentDraft;
  apiKey: string;
  onRunStart: (snapshot: PromptAgentDraft) => void;
  onFinalDraft: (draft: PromptAgentDraft, reviewOnly?: boolean) => void;
  onRequestGeneration: (draft: PromptAgentDraft, reason?: string, onApproved?: () => Promise<void>) => Promise<boolean | PromptAgentGenerationResult> | void;
  onUndo: () => void;
  canUndo: boolean;
  tagAssistEnabled: boolean;
  splitPromptFields?: boolean;
}

type ToolProgress = { id: string; name: string; state: 'running' | 'done' | 'error' | 'interrupted'; args?: unknown; result?: unknown };
type PanelMessage = { id: string; role: 'user' | 'agent' | 'error'; text: string; thinking?: string; tools?: ToolProgress[]; model?: string; provider?: string; usage?: PromptAgentUsage; visionUsage?: PromptAgentVisionUsage[]; stopReason?: string; timestamp?: number; queued?: 'steer' | 'followUp' };
type AgentAttachment = { data: string; mimeType: string; name: string };
const toolLabels: Record<string, string> = {
  request_local_image_folder_access: '确认本地目录权限', list_local_images: '浏览本地图片', show_local_image: '展示本地图片', inspect_local_image: '观察本地图片', save_project_image_to_folder: '保存图片到电脑', copy_local_image: '复制本地图片',
  get_local_time: '查询本机时间与时区', get_agent_capabilities: '查询实际可用能力', enable_tool_group: '加载相关工具', show_project_image: '展示项目图片', inspect_project_image: '观察项目图片',
  search_novelai_docs: '检索 NovelAI 官方知识', read_novelai_doc: '读取 NovelAI 官方知识',
  web_search: '联网搜索', read_web_page: '读取网页',
  get_lab_state: '读取实验室', search_tags: '搜索 Tag', search_character_catalog: '搜索角色 Tag', search_vibes: '搜索 Vibe', search_character_references: '搜索角色参考',
  update_prompts: '修改全局提示词', set_prompt_modules: '整理提示词模块', set_characters: '设置角色专属提示词',
  set_generation_params: '调整参数', set_vibes: '设置 Vibe', set_character_references: '设置角色参考', request_generation: '准备生图',
  get_project_overview: '读取项目概况', search_project_library: '搜索项目资料', get_chain: '读取完整资料', list_generation_history: '读取生成历史',
  inspect_generation_image: '查看历史原图', create_chain: '新建资料', update_chain: '更新资料',
  create_inspiration: '保存灵感', update_inspiration: '更新灵感', list_vibe_groups: '读取 Vibe 组合', create_character_reference_from_history: '保存角色参考图', create_vibe_from_history: '从历史创建 Vibe', import_aitag_image: '导入 AITag 图片',
  request_delete_project_item: '准备删除', request_clear_history: '准备清空历史',
  search_aitag: '搜索 AITag', get_aitag_work: '读取 AITag 作品',
  update_vibe: '更新 Vibe', update_character_reference: '更新角色参考', save_vibe_group: '保存 Vibe 组合', request_vibe_encoding: '准备 Vibe 编码',
  get_project_settings: '读取项目设置', set_anlas_budget: '设置 Anlas 预算', set_cloud_queue: '设置拼车队列',
  update_tag_dictionary: '更新 Tag 词库', manage_aitag: '管理 AITag', set_client_preferences: '调整界面偏好', manage_artist_favorite: '管理画师收藏', navigate_view: '切换页面', set_chain_cover_from_history: '设置风格串封面',
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

const AgentUsageDetails: React.FC<{ message: PanelMessage }> = ({ message }) => <div aria-label="回答用量" className="min-w-0">
  <div className="max-w-full break-words px-2 py-1 text-micro leading-5">
    {message.model}{typeof message.usage?.totalTokens === 'number' ? ` · ${message.usage.totalTokens.toLocaleString()} tokens` : ''}
    {message.stopReason && message.stopReason !== 'stop' ? ` · ${message.stopReason}` : ''}
    {message.visionUsage?.map((item, index) => <div key={index}>历史视觉用量：{item.model} · {item.imageCount} 图{typeof item.usage?.totalTokens === 'number' ? ` · ${item.usage.totalTokens.toLocaleString()} tokens` : ''}</div>)}
  </div>
</div>;

const AgentMessageList = React.memo(({
  messages,
  visibleMessageCount,
  running,
  copiedMessageId,
  displayPreferences,
  onLoadEarlier,
  onCopy,
  onEdit,
  onRetry,
  onMediaReady,
}: {
  messages: PanelMessage[];
  visibleMessageCount: number;
  running: boolean;
  copiedMessageId: string;
  displayPreferences: AgentDisplayPreferences;
  onLoadEarlier: () => void;
  onCopy: (message: PanelMessage) => void;
  onEdit: (message: PanelMessage) => void;
  onRetry: () => void;
  onMediaReady: () => void;
}) => {
  const visibleMessages = messages.slice(-visibleMessageCount);
  const hiddenMessageCount = Math.max(0, messages.length - visibleMessages.length);
  return <>
    {hiddenMessageCount > 0 && <button type="button" onClick={onLoadEarlier} className="mx-auto flex h-9 items-center rounded-full border border-gray-200 bg-white px-3 text-meta font-bold text-gray-500 shadow-sm hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">再显示前面的 {Math.min(60, hiddenMessageCount)} 条消息</button>}
    {visibleMessages.map((message, index) => <article key={message.id} className={`group min-w-0 text-sm leading-7 text-gray-800 [overflow-wrap:anywhere] dark:text-gray-100 ${message.role === 'user' ? 'ml-auto flex max-w-[90%] flex-col items-end' : ''}`}>
      <div className={message.role === 'user' ? 'w-fit max-w-full whitespace-pre-wrap rounded-2xl bg-gray-100 px-4 py-2.5 dark:bg-gray-800' : message.role === 'error' ? 'whitespace-pre-wrap rounded-xl bg-red-50 px-3 py-2 text-red-600 dark:bg-red-950/40 dark:text-red-300' : 'min-w-0'}>
      {message.queued && <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">{message.queued === 'steer' ? '转向要求 · 当前步骤后处理' : '后续任务 · 完成本轮后处理'}</div>}
      {!!message.thinking && <AgentDisclosure title="思考过程" label="思考过程" defaultExpanded={displayPreferences.thinkingExpanded}><div className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-gray-500 dark:text-gray-400">{message.thinking}</div></AgentDisclosure>}
      {!!message.tools?.length && <AgentDisclosure title={`工具活动 · ${message.tools.length} 项${message.tools.some(tool => tool.state === 'error' || tool.state === 'interrupted') ? ' · 有未完成项' : message.tools.some(tool => tool.state === 'running') ? ' · 处理中' : ''}`} label="工具活动" defaultExpanded={displayPreferences.toolsExpanded} error={message.tools.some(tool => tool.state === 'error' || tool.state === 'interrupted')}>
        <div className="space-y-1">{message.tools.map(tool => <details key={tool.id} className={`text-xs leading-6 ${tool.state === 'error' || tool.state === 'interrupted' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}><summary className="cursor-pointer"><span className={tool.state === 'running' ? 'animate-pulse' : ''}>{tool.state === 'running' ? '处理中' : tool.state === 'error' ? '失败' : tool.state === 'interrupted' ? '未完成' : '完成'} · {toolLabels[tool.name] || tool.name}</span></summary><pre className="my-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-gray-50 p-2 text-micro leading-5 dark:bg-gray-900">{JSON.stringify({ input: tool.args, output: tool.result }, null, 2).slice(0, 4000)}</pre></details>)}</div>
      </AgentDisclosure>}
      {message.role === 'agent' ? <AgentMarkdown text={message.text || (running && index === visibleMessages.length - 1 && !message.tools?.length && !message.thinking ? '正在思考…' : '')} /> : message.text}
      {message.tools?.flatMap(tool => extractAgentMedia(tool.result)).filter((image, index, list) => list.findIndex(item => item.path === image.path) === index).slice(0, 4).map(image => <AgentProjectImage key={image.path} image={image} onReady={onMediaReady} />)}
      </div>
      {Boolean(message.text || message.model || message.usage || message.visionUsage?.length) && <div className="mt-1 flex min-w-0 items-center gap-0.5 text-xs text-gray-400">
        {!!message.text && <button type="button" onClick={() => onCopy(message)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" title={copiedMessageId === message.id ? '已复制' : '复制'} aria-label={copiedMessageId === message.id ? '已复制' : '复制'}>{copiedMessageId === message.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</button>}
        {message.role === 'user' && !running && !message.queued && <button type="button" onClick={() => onEdit(message)} aria-label="编辑重发" title="编辑重发" className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><Pencil className="h-3.5 w-3.5" /></button>}
        {message.role === 'agent' && index === visibleMessages.length - 1 && !running && <button type="button" onClick={onRetry} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" title="重新回答；已完成的资料修改不会撤回" aria-label="重新生成"><RotateCcw className="h-3.5 w-3.5" /></button>}
        {message.role === 'agent' && Boolean(message.model || message.usage || message.visionUsage?.length) && <AgentUsageDetails message={message} />}
      </div>}
    </article>)}
  </>;
}, (previous, next) => previous.messages === next.messages
  && previous.visibleMessageCount === next.visibleMessageCount
  && previous.running === next.running
  && previous.copiedMessageId === next.copiedMessageId
  && previous.displayPreferences === next.displayPreferences);

export const PromptAgentPanel: React.FC<PromptAgentPanelProps> = props => {
  const displayPreferences = useAgentDisplayPreferences();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState<PromptAgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [models, setModels] = useState<PromptAgentModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [runtimeWarning, setRuntimeWarning] = useState('');
  useAgentRuntimeRecheck(config => setRuntimeWarning(agentRuntimeWarning(config)), props.open, Boolean(runtimeWarning));
  const [attachmentError, setAttachmentError] = useState('');
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const attachmentLoadingRef = useRef(false);
  const [showSessions, setShowSessions] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [modelChanging, setModelChanging] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const changeModelMenu = useCallback((open: boolean) => { setShowModelMenu(open); if (open) setShowMoreMenu(false); }, []);
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
  const taskCursorRef = useRef({ runId: '', cursor: 0, events: [] as PromptAgentEvent[] });
  const [taskSnapshot, setTaskSnapshot] = useState<PromptAgentTask>({});
  const [pageRead, setPageRead] = useState<AgentPageSnapshot | null>(getLastAgentPageRead);
  useEffect(() => {
    if (!props.open) return;
    const update = (event: Event) => setPageRead((event as CustomEvent<AgentPageSnapshot>).detail);
    const refresh = () => { readAgentPage(); };
    window.addEventListener('nai-agent-page-read', update);
    window.addEventListener('nai-workspace-changed', refresh);
    const stopObserving = observeAgentPage(refresh);
    refresh();
    return () => { stopObserving(); window.removeEventListener('nai-agent-page-read', update); window.removeEventListener('nai-workspace-changed', refresh); };
  }, [props.open]);
  const uiActiveRef = useRef(props.open);
  const currentKeyRef = useRef(props.apiKey);
  currentKeyRef.current = props.apiKey;
  useEffect(() => { uiActiveRef.current = props.open; return () => { uiActiveRef.current = false; }; }, [props.open]);
  const composerSessionRef = useRef('');
  const composerRestoringRef = useRef(false);
  useEffect(() => {
    if (composerSessionRef.current === activeSessionId) return;
    composerSessionRef.current = activeSessionId; composerRestoringRef.current = true;
    const saved = promptAgentCoordinator.loadComposer(activeSessionId);
    setInput(saved.text); setAttachments(saved.attachments); setAttachmentError(''); setEditingMessageId('');
  }, [activeSessionId]);
  useEffect(() => { if (composerRestoringRef.current) { composerRestoringRef.current = false; return; } if (composerSessionRef.current === activeSessionId) promptAgentCoordinator.saveComposer(activeSessionId, input, attachments); }, [activeSessionId, input, attachments]);
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
      promptAgentService.getAvailableModels().then(items => { setModels(items); setModelsLoaded(true); }),
      loadCreativePresets(),
      promptAgentService.getConfig().then(config => setRuntimeWarning(agentRuntimeWarning(config))),
    ]).catch(() => setSessionInitError('无法连接 Agent 服务，请确认本地服务正在运行'));
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const refreshRuntime = () => {
      void Promise.all([
        refreshSessions(activeSessionId),
        promptAgentService.getAvailableModels().then(items => { setModels(items); setModelsLoaded(true); }),
        loadCreativePresets(),
        promptAgentService.getConfig().then(config => setRuntimeWarning(agentRuntimeWarning(config))),
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
      taskCursorRef.current = { runId: task.runId || '', cursor: task.cursor || 0, events: task.events || [] };
      setTaskSnapshot(task);
      const restored: PanelMessage[] = items.map(item => ({ ...item }));
      if ((['interrupted', 'preparing', 'running', 'waiting_confirmation', 'executing'].includes(String(task.status))) && task.events?.length) {
        const replayText = task.events.map(event => {
          if (event.type === 'text_delta') return event.delta;
          if (event.type === 'tool_start') return `\n▸ 开始：${event.toolName}`;
          if (event.type === 'tool_end') return `\n${event.isError ? '✕' : '✓'} 完成：${event.toolName}`;
          if (event.type === 'action') return `\n◆ 操作：${event.action.kind}`;
          if (event.type === 'queue') return `\n↳ 已排队：${event.action}`;
          return '';
        }).join('').trim();
        restored.push({ id: `task-replay-${activeSessionId}`, role: 'agent', text: `任务执行回放（${task.status === 'interrupted' ? '服务中断' : '仍在执行'}）\n\n${replayText || '没有可恢复的文本事件。'}\n\n你可以继续发送要求。` });
      }
      if (task.error) restored.push({ id: 'task-error-' + (task.runId || activeSessionId), role: 'error', text: task.error });
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
        const prior = taskCursorRef.current;
        const task = await promptAgentService.getTask(activeSessionId, prior.cursor, prior.runId);
        const events = task.reset || task.runId !== prior.runId ? task.events || [] : [...prior.events, ...(task.events || [])].slice(-500);
        task.events = events;
        taskCursorRef.current = { runId: task.runId || '', cursor: task.cursor || 0, events };
        if (disposed) return;
        setTaskSnapshot(task);
        const isRunning = ['preparing', 'running', 'waiting_confirmation', 'executing'].includes(String(task.status));
        if (isRunning && !promptAgentCoordinator.running(activeSessionId)) {
          const replay = (task.events || []).map(event => event.type === 'text_delta' ? event.delta : event.type === 'tool_start' ? '\n▸ ' + event.toolName : '').join('');
          setMessages(previous => [...previous.filter(item => !item.id.startsWith('task-replay-')), { id: 'task-replay-' + activeSessionId, role: 'agent', text: replay || '电脑正在执行任务…' }]);
        }
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
  const supportsImages = Boolean(activeModel?.imageInput);
  const sessionReady = Boolean(activeSessionId && activeSession && activeModel);
  const runningTool = messages.slice().reverse().map(message => message.tools?.find(tool => tool.state === 'running')).find(Boolean);
  const executionStatus = running
    ? taskSnapshot.status === 'waiting_confirmation' ? '等待你确认' : taskSnapshot.status === 'executing' ? '正在执行已批准操作' : runningTool ? `正在${toolLabels[runningTool.name] || runningTool.name}` : responseStartedRef.current ? '正在生成回复' : '正在准备任务'
    : taskSnapshot.status === 'failed' ? '上次任务失败' : taskSnapshot.status === 'aborted' ? '已停止' : taskSnapshot.status === 'interrupted' ? '服务已中断' : !sessionReady ? modelsLoaded ? '请配置或选择模型服务' : '正在加载对话' : editingMessageId ? '正在编辑旧消息' : '准备就绪';

  useLayoutEffect(() => {
    if (!props.open) return;
    const force = forceBottomAfterLoadRef.current;
    if (!force && !followBottomRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: force || running ? 'auto' : appearanceScrollBehavior() });
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
      if (event.key === 'Escape' && isTopmostModal(panelRef.current)) {
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

  const handleConfirmedAction = (event: Extract<PromptAgentEvent, { type: 'action' }>) => {
    const approvalKey = props.apiKey;
    if (event.action.kind === 'request_project_action') {
            const patch = event.action.patch;
            void (async () => {
              let approved = false;
              const isEncoding = patch.action === 'encode_vibe';
              const isLocalAccess = patch.action === 'grant_local_image_folder';
              const accepted = await confirmAction({ title: patch.title, message: patch.consequence, confirmLabel: patch.action === 'clear_history' ? '永久清空' : isEncoding ? '消耗 2 Anlas 并生成' : isLocalAccess ? patch.payload?.access === 'write' ? '允许保存' : '允许读取' : '确认执行', ...(isEncoding || isLocalAccess ? {} : { tone: 'danger' as const }) });
              if (!accepted) {
                await promptAgentService.control(activeSessionId, 'confirm', patch.requestId, { requestId: patch.requestId, accepted: false }).catch(() => {});
                setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'agent', text: isLocalAccess ? '未开放该图片目录。' : '已取消该项目操作，没有修改数据。' }]);
                return;
              }
              try {
                if (approvalKey !== currentKeyRef.current || !uiActiveRef.current) throw new Error('当前 Key 或页面已变化，请重新提出请求');
                await promptAgentService.control(activeSessionId, 'confirm', patch.requestId, { requestId: patch.requestId, accepted: true });
                approved = true;
                if (patch.action === 'encode_vibe') {
                  if (!props.apiKey) throw new Error('请先在全局设置中填写 NovelAI API Key');
                  await vibeService.encode(patch.resourceId || '', Number(patch.payload?.informationExtracted ?? 1), props.apiKey);
                  await promptAgentService.control(activeSessionId, 'finalize', patch.requestId, { requestId: patch.requestId, success: true, result: { action: patch.action, resourceId: patch.resourceId } });
                } else if (patch.action === 'clear_mobile_cache') {
                  await clearMobileThumbnailCache();
                  await promptAgentService.control(activeSessionId, 'finalize', patch.requestId, { requestId: patch.requestId, success: true, result: { action: patch.action } });
                } else await promptAgentService.executeProjectAction({ action: patch.action, resourceId: patch.resourceId, payload: patch.payload, sessionId: activeSessionId, confirmationRequestId: patch.requestId });
                if (patch.action !== 'grant_local_image_folder') window.dispatchEvent(new CustomEvent('nai-project-data-changed', { detail: patch }));
                setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'agent', text: patch.action === 'grant_local_image_folder' ? `已允许本次对话${patch.payload?.access === 'write' ? '保存图片到' : '读取图片目录'}：${String(patch.payload?.directory || '')}。` : '已在你确认后完成该项目操作。' }]);
              } catch (error) {
                if (approved) await promptAgentService.control(activeSessionId, 'finalize', patch.requestId, { requestId: patch.requestId, success: false }).catch(() => {});
                else await promptAgentService.control(activeSessionId, 'confirm', patch.requestId, { requestId: patch.requestId, accepted: false }).catch(() => {});
                setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : '项目操作失败' }]);
              }
            })();
          } else if (event.action.kind === 'request_generation') {
            const generationAction = event.action;
            void (async () => {
              let approved = false;
              const requestId = generationAction.patch.requestId;
              try {
                const success = await props.onRequestGeneration(event.draft || props.draft, generationAction.patch.reason, async () => {
                  if (approvalKey !== currentKeyRef.current || !uiActiveRef.current) throw new Error('当前 Key 或创作目标已变化，请重新提出请求');
                  await promptAgentService.control(activeSessionId, 'confirm', requestId, { requestId, accepted: true });
                  approved = true;
                });
                const receipt = typeof success === 'object' ? success : { success: success === true, historySaved: false };
                await promptAgentService.control(activeSessionId, approved ? 'finalize' : 'confirm', requestId, { requestId, accepted: false, success: receipt.success, result: receipt });
              } catch (error) {
                await promptAgentService.control(activeSessionId, approved ? 'finalize' : 'confirm', requestId, { requestId, accepted: false, success: false }).catch(() => {});
                setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : '生成失败' }]);
              }
            })();
          }
  };

  const run = async (suggestion?: string, mode: 'prompt' | 'retry' = 'prompt') => {
    const prompt = (suggestion ?? input).trim() || (attachments.length ? '请分析我附带的图片，并结合项目内容给出建议。' : '');
    if (!sessionReady || modelChanging || attachmentLoadingRef.current || !activeSessionId || !activeSession || (mode === 'prompt' && !prompt)) return;
    if (mode === 'prompt' && !editingMessageId && attachments.length && !supportsImages) {
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: '当前模型不支持图片输入，请在发送键旁选择支持图片的模型。' }]);
      return;
    }
    if (running && attachments.length) { setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: '运行中只支持文字补充，图片仍保留；请等完成后发送。' }]); return; }
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
    if (effectiveMode === 'prompt') { setInput(''); setAttachments([]); }
    else if (editingMessageId) setInput('');
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
      await promptAgentCoordinator.run({ apiKey: props.apiKey, sessionId: activeSessionId, message: prompt, mode: effectiveMode, images: effectiveMode === 'prompt' ? attachments.map(({ data, mimeType }) => ({ data, mimeType })) : [], draft: props.draft, context: { clientSettings: {
        currentPage: (() => { const page = readAgentPage(); return { view: page.view, title: page.title, snapshotId: page.snapshotId, capturedAt: page.capturedAt }; })(),
        themeMode: localStorage.getItem('nai_theme') || 'system', safeMode: localStorage.getItem('nai_safe_mode') === 'true', safeModeStartup: localStorage.getItem('nai_safe_mode_startup') !== 'false',
        imageLayout: imageDisplay.layout, imageColumns: imageDisplay.columns, mobileCache: getMobileCacheStats(), novelAiKeyConfigured: Boolean(props.apiKey), artistFavorites: Array.isArray(artistFavorites) ? artistFavorites.slice(0, 2000) : [],
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        autoShowGenerated: displayPreferences.autoShowGenerated,
        tagAssistEnabled: props.tagAssistEnabled, splitPromptFields: props.splitPromptFields ?? false,
      } } }, event => {
        if (!uiActiveRef.current) return;
        if (event.runId) setTaskSnapshot(previous => ({ ...previous, runId: event.runId }));
        if (event.type === 'response_start') {
          if (responseStartedRef.current) {
            const nextId = crypto.randomUUID();
            currentAssistantIdRef.current = nextId;
            setMessages(previous => [...previous, { id: nextId, role: 'agent', text: '' }]);
          } else responseStartedRef.current = true;
        }
        // React 可批量延迟执行更新；在事件到达时固定归属，避免下一轮覆盖上一轮收据。
        const responseId = currentAssistantIdRef.current;
        if (event.type === 'text_delta') setMessages(previous => previous.map(item => item.id === responseId ? { ...item, text: item.text + event.delta } : item));
        if (event.type === 'thinking_delta') setMessages(previous => previous.map(item => item.id === responseId ? { ...item, thinking: (item.thinking || '') + event.delta } : item));
        if (event.type === 'response_end') setMessages(previous => previous.map(item => item.id === responseId ? { ...item, model: event.model, provider: event.provider, usage: event.usage, stopReason: event.stopReason, timestamp: event.timestamp } : item));
        if (event.type === 'tool_start') setMessages(previous => previous.map(item => item.id === responseId ? { ...item, tools: [...(item.tools || []), { id: event.toolCallId, name: event.toolName, args: event.args, state: 'running' }] } : item));
        if (event.type === 'tool_end') setMessages(previous => previous.map(item => item.id === responseId ? { ...item, tools: (item.tools || []).map(tool => tool.id === event.toolCallId ? { ...tool, result: event.result, state: event.isError ? 'error' : 'done' } : tool) } : item));
        if (event.type === 'project_changed') window.dispatchEvent(new CustomEvent('nai-project-data-changed', { detail: { resource: event.resource } }));
        if (event.type === 'action') {
          if (event.action.kind === 'request_project_action' || event.action.kind === 'request_generation') handleConfirmedAction(event); else if (event.action.kind === 'set_client_preferences') {
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
          setTaskSnapshot(previous => ({ ...previous, status: event.status || 'completed', finalDraft: event.status === 'aborted' ? null : event.draft }));
          if (labChanged && event.status !== 'aborted') props.onFinalDraft(event.draft, !displayPreferences.autoApplyDraft);
          if (navigationTarget) {
            window.dispatchEvent(new CustomEvent('nai-agent-navigate', { detail: navigationTarget }));
            props.onClose();
          }
          if (!event.message) setMessages(previous => previous.map(item => item.id === responseId && !item.text ? { ...item, text: '已完成。' } : item));
        }
      });
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
    try { await promptAgentService.resetSession(activeSessionId); setMessages([]); } catch (error) { reportControlError(error); }
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
  };

  const updateThinkingLevel = async (thinkingLevel: PromptAgentThinkingLevel) => {
    if (!activeSession || running) return;
    const updated = await promptAgentService.updateSession(activeSession.id, { thinkingLevel });
    setSessions(previous => previous.map(item => item.id === updated.id ? { ...item, ...updated } : item));
  };

  const availableThinkingLevels = activeModel?.thinkingLevels?.length
    ? activeModel.thinkingLevels
    : activeModel?.reasoning ? ['off', 'minimal', 'low', 'medium', 'high'] as PromptAgentThinkingLevel[] : ['off'] as PromptAgentThinkingLevel[];
  const selectedThinkingLevel = availableThinkingLevels.includes(activeSession?.thinkingLevel || 'off')
    ? activeSession?.thinkingLevel || 'off'
    : availableThinkingLevels.includes('medium') ? 'medium' : availableThinkingLevels[0] || 'off';

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
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : '切换注入模式失败' }]);
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
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : '切换注入预设失败' }]);
    }
  };

  const defaultPresetId = creativePresets.find(p => p.isBuiltin)?.id || creativePresets[0]?.id || 'builtin-default';
  const getSessionPresetValue = (session: PromptAgentSession | null) => {
    if (!session || !session.creativeMode) return 'off';
    if (!session.presetName) return defaultPresetId;
    return creativePresets.find(p => p.name === session.presetName)?.id || defaultPresetId;
  };

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

  const reportControlError = (error: unknown) => setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : '任务控制失败，请检查电脑连接后重试' }]);
  const stopTask = async () => { try { await promptAgentService.control(activeSessionId, 'abort'); } catch (error) { reportControlError(error); } };
  const openAgentSettings = () => window.dispatchEvent(new CustomEvent('nai-open-global-settings', { detail: { section: 'agent' } }));
  const addAttachments = async (files: FileList | readonly File[] | null) => {
    if (!files || attachmentLoadingRef.current || !sessionReady || running || !supportsImages) return;
    const session = activeSessionId; const next = [...attachments]; const errors: string[] = [];
    attachmentLoadingRef.current = true; setAttachmentBusy(true); setAttachmentError('');
    try {
      for (const file of Array.from(files)) {
        if (next.length >= 4) { errors.push(`${file.name}：最多 4 张图片`); continue; }
        try { next.push(await prepareAgentAttachment(file)); }
        catch (error) { errors.push(`${file.name}：${error instanceof Error ? error.message : '图片处理失败'}`); }
      }
      if (composerSessionRef.current === session && uiActiveRef.current) { setAttachments(next); setAttachmentError(errors.join('；')); }
    } finally { attachmentLoadingRef.current = false; setAttachmentBusy(false); }
  };
  messageActionsRef.current = {
    loadEarlier: () => setVisibleMessageCount(count => count + 60),
    copy: message => { void copyMessage(message.id, message.text).catch(reportControlError); },
    edit: message => { setEditingMessageId(message.id); setInput(message.text); },
    retry: () => { void run('', 'retry'); },
  };

  return createPortal(<div aria-hidden={!props.open} className={`agent-overlay pointer-events-none fixed inset-0 z-[1100] ${props.open ? 'agent-overlay--open' : 'agent-overlay--closed'}`}>
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Agent 控制面板"
      data-agent-surface
      className="agent-theme appearance-panel agent-panel pointer-events-auto absolute flex overflow-hidden border-gray-200 bg-gray-50 shadow-2xl transition-[width,height,border-radius] dark:border-gray-800 dark:bg-gray-950"
      style={{ '--agent-mobile-height': `${mobileHeight}dvh`, '--agent-width': `${panelWidth}px` } as React.CSSProperties}
    >
    <button type="button" aria-label="调整 Agent 宽度" onPointerDown={startDesktopResize} className="agent-resize-handle-desktop" />
    <button type="button" aria-label="调整 Agent 高度" onPointerDown={startMobileResize} className="agent-resize-handle-mobile"><span /></button>
    {showSessions && <button type="button" aria-label="关闭会话列表" onClick={() => { setShowSessions(false); setSessionMenuId(''); }} className="absolute inset-0 z-10 bg-black/35" />}
    <aside aria-label="Agent 会话历史" className={`appearance-panel ${showSessions ? 'translate-x-0' : '-translate-x-full'} absolute inset-y-0 left-0 z-20 flex w-[min(82%,19rem)] flex-col border-r border-gray-200 bg-white pt-[env(safe-area-inset-top)] shadow-2xl transition-transform dark:border-gray-800 dark:bg-gray-900`}>
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
            <span className="mt-1 flex items-center gap-1.5 text-mini font-bold"><span className={`rounded-full px-1.5 py-0.5 ${session.creativeMode ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>注入{session.creativeMode ? '开' : '关'}</span>{(() => { const presetLabel = formatPresetSessionLabel(session); return presetLabel ? <span title={presetLabel} className="max-w-28 truncate rounded-full bg-violet-100 px-1.5 py-0.5 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">{presetLabel}</span> : null; })()}{session.running ? <span className="text-indigo-600">工作中</span> : session.taskStatus === 'interrupted' ? <span className="text-amber-600">上次中断</span> : session.taskStatus === 'failed' ? <span className="text-red-500">上次失败</span> : <span className="text-emerald-600">就绪</span>}</span>
          </button>}
          <button type="button" data-session-menu onClick={() => setSessionMenuId(value => value === session.id ? '' : session.id)} className="mobile-touch absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:bg-white/70 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200" aria-label="会话操作" title="会话操作"><MoreHorizontal className="h-4 w-4" /></button>
          {sessionMenuId === session.id && <div data-session-menu className="appearance-panel absolute right-1 top-[calc(50%+1.45rem)] z-30 w-28 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-xl ring-1 ring-black/5 dark:border-gray-700 dark:bg-gray-900">
            <button type="button" onClick={() => { setSessionMenuId(''); setEditingSessionId(session.id); setEditingTitle(session.title); }} disabled={running} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-gray-800"><Pencil className="h-3.5 w-3.5" />重命名</button>
            <button type="button" onClick={() => { setSessionMenuId(''); void deleteSession(session); }} disabled={running || sessions.length <= 1} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-30 dark:text-rose-400 dark:hover:bg-rose-950/30"><Trash2 className="h-3.5 w-3.5 text-rose-500" />删除</button>
          </div>}
        </div>)}
      </div>
      <p className="border-t border-gray-100 px-4 py-3 text-micro leading-4 text-gray-400 dark:border-gray-800">对话保存在电脑本地。删除与付费项目操作仍会单独确认。</p>
    </aside>

    <section className="relative flex min-w-0 flex-1 flex-col">
      {runtimeWarning && <p role="status" className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{runtimeWarning}</p>}
      {(taskSnapshot.pending || []).filter(item => !item.approved).map(item => <div key={item.requestId} className="flex flex-wrap items-center gap-2 border-b border-amber-200 p-2 text-xs dark:border-amber-900 dark:text-gray-300"><span className="min-w-0 flex-1">任务等待你确认：{item.operation.action}</span><button type="button" className="mobile-touch px-2 text-indigo-600 dark:text-indigo-300" onClick={() => handleConfirmedAction({ type: 'action', action: item.operation.action === 'request_generation' ? { kind: 'request_generation', patch: { requestId: item.requestId, reason: '接续上次请求' } } : { kind: 'request_project_action', patch: { ...item.operation, requestId: item.requestId, title: '接续项目操作？', consequence: JSON.stringify(item.operation) } }, draft: item.operation.payload.draft as PromptAgentDraft | undefined })}>查看并决定</button></div>)}
      {modelsLoaded && !activeModel && <div className="flex flex-wrap items-center gap-2 border-b border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200"><span className="min-w-0 flex-1">{models.length ? '这条会话的模型已不可用，请选择已接入的模型。' : '先接入模型服务，再开始创作。可以直接填写模型 ID，无需获取模型列表。'}</span><button type="button" onClick={models.length ? () => setShowModelMenu(true) : openAgentSettings} className="mobile-touch rounded-lg bg-indigo-600 px-3 text-white">{models.length ? '选择模型' : '接入 API'}</button></div>}
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
                      ? modelsLoaded ? 'bg-amber-500' : 'animate-pulse bg-gray-400'
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
                  {activeSession?.creativeMode && (
                    <span
                      className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-mini font-bold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
                      title={formatPresetSessionLabel(activeSession) || (activeSession.presetName ? `注入预设：${activeSession.presetName}` : '注入模式已开启')}
                    >
                      注入
                    </span>
                  )}
                </>
              )}
            </div>
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
              <div className="appearance-panel absolute right-0 top-11 z-30 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white p-1.5 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
                <div className="border-b border-gray-100 p-3 dark:border-gray-800"><AgentChatDisplayOptions /></div><div className="hidden border-b border-gray-100 px-3 py-2 md:block dark:border-gray-800"><p className="mb-2 text-xs text-gray-500">面板宽度</p><div className="grid grid-cols-3 gap-1">{[{ label: '窄', width: 440 }, { label: '标准', width: 540 }, { label: '宽', width: 680 }].map(item => <button key={item.width} type="button" onClick={() => choosePanelWidth(item.width)} className={`min-h-8 rounded-lg text-xs ${Math.abs(panelWidth - item.width) < 30 ? 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}>{item.label}</button>)}</div></div>
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
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-2 text-micro text-gray-500 dark:text-gray-400">
          <span aria-live="polite">已读取：{pageRead?.title || '页面尚未就绪'}{pageRead?.capturedAt ? ` · ${new Date(pageRead.capturedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
        </div>
      </header>
      {logExportError && <div role="status" className="absolute right-3 top-[calc(3.25rem+env(safe-area-inset-top))] z-40 max-w-[min(28rem,calc(100%-1.5rem))] rounded-lg bg-red-50 px-2 py-1 text-micro font-bold text-red-600 shadow dark:bg-red-950/80 dark:text-red-300">{logExportError}</div>}

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden">
        <div ref={scrollRef} onScroll={event => { const element = event.currentTarget; const next = element.scrollHeight - element.scrollTop - element.clientHeight < 80; followBottomRef.current = next; setFollowingBottom(next); }} className="relative flex-1 space-y-6 overflow-y-auto px-4 py-5 md:px-6">
          {messages.length === 0 && <div className="my-8 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"><Bot className="h-7 w-7" /></div><h3 className="mt-4 text-lg font-black dark:text-white">告诉我你想在项目里做什么</h3><p className="mt-1 text-sm text-gray-500">{sessionReady ? '这是一条独立对话，可在项目的任何页面继续。' : sessionInitError || (modelsLoaded && !activeModel ? '接入后可以观察图片和调整当前草稿。' : '正在加载这条对话…')}</p>{!sessionReady && sessionInitError && <button type="button" onClick={() => { setSessionInitError(''); void Promise.all([refreshSessions(), promptAgentService.getAvailableModels().then(items => { setModels(items); setModelsLoaded(true); })]).catch(() => setSessionInitError('无法连接 Agent 服务，请确认本地服务正在运行')); }} className="mobile-touch mt-3 rounded-xl border border-indigo-300 bg-white px-4 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-gray-900 dark:text-indigo-300">重试</button>}{activeSession && !activeSession.creativeModeLocked && !activeSession.messageCount && (
            <div className="mx-auto mt-5 flex max-w-sm items-center justify-between gap-3 border-y border-gray-100 py-3 text-left dark:border-gray-800">
              <div className="min-w-0 flex-1">
                <b className="block text-xs font-bold text-gray-800 dark:text-gray-100">注入预设</b>
                <span className="block text-micro text-gray-500">首条消息前可选，发送后锁定</span>
              </div>
              <select
                aria-label="选择注入预设"
                disabled={running}
                value={getSessionPresetValue(activeSession)}
                onChange={event => void selectSessionPreset(event.target.value)}
                className="mobile-touch max-w-[11rem] rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                <option value="off">关闭注入（普通模式）</option>
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
          )}<div className="mx-auto mt-5 grid max-w-lg gap-2 sm:grid-cols-2">{['查看最后一张图并改进动作', '检查整个项目的资料情况', '设计角色并调整实验室', '看看我的本地图片目录'].map(value => <button key={value} type="button" disabled={!sessionReady} onClick={() => void run(value)} className="mobile-touch rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900">{value}</button>)}</div></div>}
          <AgentMessageList
            messages={messages}
            visibleMessageCount={visibleMessageCount}
            running={running}
            copiedMessageId={copiedMessageId}
            displayPreferences={displayPreferences}
            onLoadEarlier={() => messageActionsRef.current.loadEarlier()}
            onCopy={message => messageActionsRef.current.copy(message)}
            onEdit={message => messageActionsRef.current.edit(message)}
            onRetry={() => messageActionsRef.current.retry()}
            onMediaReady={() => { if (followBottomRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' }); }}
          />
          {!followingBottom && <button type="button" onClick={() => { followBottomRef.current = true; setFollowingBottom(true); scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: appearanceScrollBehavior() }); }} className="sticky bottom-2 mx-auto flex items-center gap-1 rounded-full bg-gray-900/90 px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-xs transition hover:scale-105 active:scale-95 dark:bg-white/90 dark:text-gray-900"><ArrowDown className="h-3.5 w-3.5" />回到底部</button>}
        </div>
          <div onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void addAttachments(event.dataTransfer.files); } }} className="appearance-surface mx-3 mb-3 rounded-2xl border border-gray-200 bg-gray-50/60 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] focus-within:border-gray-400 dark:border-gray-700 dark:bg-gray-900/80 dark:focus-within:border-gray-500 md:mx-5" aria-busy={!sessionReady}>
          {editingMessageId && !running && <div className="mb-2 flex items-center rounded-xl bg-amber-50 px-3 py-1.5 text-meta text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"><b>正在编辑旧消息</b><span className="ml-1">发送后会从这里重新执行，后面的旧回答将被替换。</span><span className="flex-1" /><button type="button" onClick={() => { setEditingMessageId(''); setInput(''); }} className="font-bold">取消</button></div>}
          {running && <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <select aria-label="追加处理方式" value={queueMode} onChange={event => setQueueMode(event.target.value as 'steer' | 'followUp')} className="min-h-8 max-w-full rounded-lg border border-gray-200 bg-transparent px-2 text-xs dark:border-gray-700 dark:[color-scheme:dark]"><option value="steer">转向当前任务</option><option value="followUp">完成后继续</option></select>
            <button type="button" onClick={() => void promptAgentService.control(activeSessionId, 'clear').catch(reportControlError)} className="min-h-8 rounded-lg px-2 hover:bg-gray-100 dark:hover:bg-gray-800" title="清空已排队的任务要求">清空排队</button>
          </div>}
          {input.length >= 7000 && <p className="mb-2 text-micro text-gray-500">任务要求 {input.length} / 8000 字符，请分段发送。</p>}
          {attachmentBusy && <p role="status" className="mb-2 text-xs text-gray-500">正在处理图片副本…</p>}
          {attachmentError && <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-300">{attachmentError}</p>}
          {!!attachments.length && <p className="mb-2 text-micro text-gray-500">发送时交给 {`${activeModel?.provider}/${activeModel?.id}`}；图片用量计入当前模型。原文件保持不变。</p>}
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
          <textarea onPaste={event => { const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void addAttachments(files); } }} maxLength={8000} aria-label="任务要求" ref={inputRef} value={input} disabled={!sessionReady} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void run(); } }} rows={1} placeholder={!sessionReady ? modelsLoaded ? '先接入或选择模型服务…' : '正在加载对话…' : running ? (queueMode === 'steer' ? '补充或纠正当前任务…' : '添加完成后继续处理的任务…') : editingMessageId ? '修改这条消息后重新发送…' : '输入要求，或粘贴图片…'} className="min-h-12 w-full min-w-0 resize-none bg-transparent px-1 py-2 text-sm leading-6 text-gray-900 outline-none placeholder:text-gray-400 disabled:cursor-wait disabled:opacity-55 dark:text-gray-100 dark:placeholder:text-gray-500" />
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <label title={!sessionReady ? '请配置或选择模型服务' : supportsImages ? '添加图片' : '当前模型不支持图片输入'} aria-disabled={!sessionReady || running || attachmentBusy || attachments.length >= 4 || !supportsImages} className={'flex h-9 w-9 flex-none items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 ' + (sessionReady && supportsImages && !running && attachments.length < 4 ? 'cursor-pointer hover:bg-gray-200/60 dark:hover:bg-gray-800' : 'cursor-not-allowed opacity-35')}><ImagePlus className="h-[18px] w-[18px]" /><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden aria-label="选择图片附件" onChange={event => { void addAttachments(event.target.files); event.currentTarget.value = ''; }} disabled={!sessionReady || running || attachmentBusy || attachments.length >= 4 || !supportsImages} /></label>
            <AgentPermissionSelect disabled={running} />
            <AgentModelControl key={activeSessionId} models={models} activeModel={activeModel} thinkingLevels={availableThinkingLevels} thinkingLevel={selectedThinkingLevel} contextUsage={getAgentContextUsage(messages, activeModel)} open={showModelMenu} disabled={!props.open || running || !activeSessionId || !activeSession} onOpenChange={changeModelMenu} onModelChange={updateSessionModel} onThinkingChange={updateThinkingLevel} onBusyChange={setModelChanging} onConfigure={openAgentSettings} />
            {running && <button type="button" onClick={() => void stopTask()} className="agent-composer-action flex items-center justify-center rounded-full bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900" aria-label="停止" title="停止任务；已完成的修改不会撤销"><Square className="h-3.5 w-3.5 fill-current" /></button>}
            {(!running || input.trim() || attachments.length > 0) && <button type="button" onClick={() => void run()} disabled={!sessionReady || modelChanging || attachmentBusy || (!input.trim() && !attachments.length)} className="agent-composer-action flex items-center justify-center rounded-full bg-gray-900 text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:bg-gray-100 dark:text-gray-900 dark:disabled:bg-gray-800 dark:disabled:text-gray-600" aria-label={!sessionReady ? modelsLoaded ? '请配置或选择模型服务' : '正在加载对话' : running ? '追加要求' : editingMessageId ? '重新发送' : '执行'} title={running ? '追加要求' : '发送 · Enter；换行 · Shift+Enter'}><ArrowUp className="h-[18px] w-[18px]" /></button>}
          </div>
        </div>
      </main>
    </section>
    </div>
  </div>, document.body);
};
