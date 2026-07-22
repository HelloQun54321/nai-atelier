import React, { useEffect, useRef, useState } from 'react';
import { PromptAgentAction, PromptAgentDraft, PromptChain } from '../types';
import { promptAgentService } from '../services/promptAgent';
import { vibeService } from '../services/vibeService';
import { useMobileHistoryLayer } from './MobileUI';

interface PromptAgentPanelProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  draft: PromptAgentDraft;
  presets: PromptChain[];
  onRunStart: (snapshot: PromptAgentDraft) => void;
  onAction: (action: PromptAgentAction) => void;
  onFinalDraft: (draft: PromptAgentDraft) => void;
  onRequestGeneration: (draft: PromptAgentDraft, reason?: string) => void;
  onUndo: () => void;
  canUndo: boolean;
}

type PanelMessage = { id: string; role: 'user' | 'agent' | 'status' | 'error'; text: string };
const toolLabels: Record<string, string> = {
  get_lab_state: '读取实验室', search_tags: '搜索 Tag', search_presets: '搜索预设', search_vibes: '搜索 Vibe',
  update_prompts: '修改提示词', set_prompt_modules: '整理提示词模块', set_characters: '设置角色',
  set_generation_params: '调整参数', set_vibes: '设置 Vibe', request_generation: '准备生图',
};

export const PromptAgentPanel: React.FC<PromptAgentPanelProps> = props => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [modelLabel, setModelLabel] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  const loadedSessionRef = useRef('');
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
    void promptAgentService.getConfig().then(config => setModelLabel(config.configured ? `${config.model} [${config.provider}]` : '尚未配置模型服务')).catch(() => setModelLabel('配置读取失败'));
  }, [props.open]);

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
    props.onRunStart(structuredClone(props.draft));
    let requestedGeneration = false;
    let generationReason = '';
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const vibes = await vibeService.list('', false).catch(() => []);
      const presets = props.presets.slice(0, 200).map(item => ({
        id: item.id, name: item.name, type: item.type, tags: item.tags,
        basePrompt: item.basePrompt, negativePrompt: item.negativePrompt, modules: item.modules,
        params: item.params, subjectPrompt: item.variableValues?.subject || '',
      }));
      await promptAgentService.run({ sessionId: props.sessionId, message: prompt, draft: props.draft, context: { presets, vibes } }, event => {
        if (event.type === 'text_delta') setMessages(previous => previous.map(item => item.id === assistantId ? { ...item, text: item.text + event.delta } : item));
        if (event.type === 'tool_start') setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'status', text: `${toolLabels[event.toolName] || event.toolName}…` }]);
        if (event.type === 'action') {
          props.onAction(event.action);
          if (event.action.kind === 'request_generation') {
            requestedGeneration = true;
            generationReason = event.action.patch.reason || '';
          }
        }
        if (event.type === 'error') throw new Error(event.error);
        if (event.type === 'done') {
          props.onFinalDraft(event.draft);
          if (requestedGeneration) props.onRequestGeneration(event.draft, generationReason);
          if (!event.message) setMessages(previous => previous.map(item => item.id === assistantId && !item.text ? { ...item, text: '已按你的要求更新实验室。' } : item));
        }
      }, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : 'Agent 执行失败' }]);
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
      <div className="min-w-0 flex-1"><h2 className="font-black text-gray-900 dark:text-white">AI 生图 Agent</h2><p className="truncate text-[11px] text-gray-500">{modelLabel || '正在读取模型…'} · 生图前仍会确认费用</p></div>
      {props.canUndo && <button type="button" onClick={props.onUndo} disabled={running} className="mobile-touch rounded-xl px-3 text-sm font-bold text-fuchsia-600 disabled:opacity-40">撤销本次</button>}
      <button type="button" onClick={() => void reset()} disabled={running} className="mobile-touch rounded-xl px-2 text-xs font-bold text-gray-500 disabled:opacity-40">清空对话</button>
    </header>
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && <div className="mt-8 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-3xl text-white shadow-xl shadow-fuchsia-500/20">✦</div><h3 className="mt-4 text-lg font-black dark:text-white">告诉我你想画什么</h3><p className="mt-1 text-sm text-gray-500">我会直接整理 Tag、角色、参数和 Vibe，不需要你再手动搬运。</p><div className="mx-auto mt-5 grid max-w-lg gap-2 sm:grid-cols-2">{['帮我完善当前提示词', '设计一个角色并调整参数', '检查当前配置有什么问题', '根据当前内容直接生成一张'].map(text => <button key={text} type="button" onClick={() => void run(text)} className="mobile-touch rounded-2xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">{text}</button>)}</div></div>}
        {messages.map(message => message.role === 'status'
          ? <div key={message.id} className="mx-auto w-fit rounded-full bg-fuchsia-50 px-3 py-1 text-xs font-bold text-fuchsia-600 dark:bg-fuchsia-950/40 dark:text-fuchsia-300">✦ {message.text}</div>
          : <div key={message.id} className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'ml-auto bg-indigo-600 text-white' : message.role === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300' : 'bg-white text-gray-800 shadow-sm dark:bg-gray-900 dark:text-gray-100'}`}>{message.text || (running ? '正在思考…' : '')}</div>)}
      </div>
      <div className="border-t border-gray-200 bg-white p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] dark:border-gray-800 dark:bg-gray-900 md:p-4"><div className="flex items-end gap-2"><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void run(); } }} rows={2} placeholder="例如：改成夜晚雨中的赛博朋克少女，然后直接生成" className="min-h-14 flex-1 resize-none rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-fuchsia-500 dark:border-gray-700 dark:bg-gray-950" />{running ? <button type="button" onClick={() => controllerRef.current?.abort()} className="mobile-touch rounded-2xl bg-red-500 px-4 text-sm font-bold text-white">停止</button> : <button type="button" onClick={() => void run()} disabled={!input.trim()} className="mobile-touch rounded-2xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 px-5 text-sm font-bold text-white shadow-lg disabled:opacity-40">执行</button>}</div></div>
    </main>
  </div>;
};
