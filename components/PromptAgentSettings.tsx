import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, FileUp, LogIn, Plus, Save, Settings2, Star, Trash2, Upload, X } from 'lucide-react';
import { PromptAgentAuthPrompt, PromptAgentConfig, PromptAgentCreativeInspectResult, PromptAgentCreativePreset, PromptAgentCreativePresetRevision, PromptAgentCreativePresetState, PromptAgentCustomProvider, PromptAgentInjectionItem, PromptAgentLabTarget, PromptAgentModel, PromptAgentProvider, displayModelName, formatModelOptionTitle, promptAgentService } from '../services/promptAgent';
import { useConfirmDialog } from './ConfirmDialog';
import { useMobileHistoryLayer } from './MobileUI';
import { useModalA11y } from './useModalA11y';

interface PromptAgentSettingsProps {
  notify: (message: string, type?: 'success' | 'error') => void;
}

type View = 'home' | 'login' | 'logout' | 'model' | 'vision' | 'auth' | 'key' | 'custom' | 'creative_lab';

const emptyCustomProvider = (): PromptAgentCustomProvider => ({
  name: '', baseUrl: '', api: 'openai-completions', apiKey: '', headers: {},
  models: [{ id: '', name: '', reasoning: false, imageInput: false, contextWindow: 128000, maxTokens: 16384 }],
});

/** 会话列表/标题副行的破限预设标签文本：存在预设名时展示（含短指纹），无预设返回 null（不拉正文）。 */
export const formatPresetSessionLabel = (session: { presetName?: string; presetRevisionHash?: string; effectivePolicyFingerprint?: string; creativeMode?: boolean }): string | null => {
  if (session.creativeMode === false || !session.presetName) return null;
  const fingerprint = session.effectivePolicyFingerprint || session.presetRevisionHash || '';
  return fingerprint ? `${session.presetName} · ${fingerprint.slice(0, 7)}` : session.presetName;
};

/** 兼容 string 或 part[] 结构的规范化消息正文渲染。 */
export const formatMessageContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
        return (part as { text: string }).text;
      }
      return '';
    }).filter(Boolean).join('');
  }
  return content ? String(content) : '';
};

/** 9 个破限注入槽位：固定标签、顺序稳定、跨组件一致；仅含已审定 target，无旧键。 */
export const LAB_SLOTS: ReadonlyArray<{ target: PromptAgentLabTarget; label: string; hint: string; kind: 'text' | 'list' | 'number' }> = [
  { target: 'system_head', label: '系统提示词（头部）', hint: 'system 段顶部注入，无 role（0 号槽位）', kind: 'text' },
  { target: 'system_middle', label: '系统提示词（中段）', hint: 'system 段中部注入，无 role（1 号槽位）', kind: 'text' },
  { target: 'system_tail', label: '系统提示词（尾部）', hint: 'system 段尾部注入，无 role（2 号槽位）', kind: 'text' },
  { target: 'context_head', label: '上下文头部消息', hint: 'context 头部帧（3 号槽位）；role: user|assistant 成对整体维护', kind: 'list' },
  { target: 'context_depth', label: '上下文窗口深度', hint: '上下文深度（4 号槽位）；严格数值 depth', kind: 'number' },
  { target: 'user_preamble', label: '用户消息前导', hint: '用户消息前导帧 header（5 号槽位，#101/#102 约定）', kind: 'text' },
  { target: 'user_suffix', label: '用户消息尾部', hint: '用户消息尾部拦截元素（6 号槽位）', kind: 'text' },
  { target: 'conversation_tail', label: '会话尾部拦截', hint: '会话尾部拦截元素（7 号槽位）；role 固定 user', kind: 'text' },
  { target: 'assistant_prefill', label: 'Assistant 预填', hint: 'assistant 预填（8 号槽位）；role 固定 assistant', kind: 'text' },
];

/** 生成客户端临时槽位 id：服务端入库时会 normalize 为真实 id；编辑器内仅需同列表唯一，绝不共用 ''。 */
const makeTempSlotId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through */ }
  return `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** 与 target 无关的固定项渲染顺序：LAB_SLOTS 即稳定顺序；此处为每个 target 建立新槽位的最小 item。context_depth 默认 1（服务端有效范围从 1 开始）。新建补齐空槽默认 enabled: false 避免注入空文本帧。 */
export const makeEmptySlot = (target: PromptAgentLabTarget): PromptAgentInjectionItem => ({
  id: makeTempSlotId(), name: '', target, enabled: false, content: '',
  role: target === 'conversation_tail' ? 'user' : target === 'assistant_prefill' ? 'assistant' : target === 'context_head' ? 'user' : undefined,
  depth: target === 'context_depth' ? 1 : undefined,
});

/** 新建一个空的 context_head 成对（user + assistant），编辑器内立即给出两框正文。空槽默认 enabled: false。 */
export const makeEmptyContextHeadPair = (): PromptAgentInjectionItem[] => {
  const pairId = makeTempSlotId();
  return [
    { id: makeTempSlotId(), pairId, name: '', target: 'context_head', enabled: false, content: '', role: 'user' },
    { id: makeTempSlotId(), pairId, name: '', target: 'context_head', enabled: false, content: '', role: 'assistant' },
  ];
};

/** 保存前对 slots 进行清洗：空内容槽位（trim 后为空）统一置为 enabled: false，防止向服务端装配空帧。 */
export const sanitizeSlotsForSave = (slots: PromptAgentInjectionItem[]): PromptAgentInjectionItem[] =>
  slots.map(slot => (slot.content || '').trim() === '' ? { ...slot, enabled: false } : slot);

export const defaultPresetId = (presets: PromptAgentCreativePreset[], activeId?: string) => (activeId && presets.some(preset => preset.id === activeId) ? activeId : presets.length ? presets[0].id : null);

/** 生成“每个 target 至少一组可见正文框”的补齐模板：text/number 槽位缺失补真实空槽；context_head 缺失补一对空 user+assistant（两个可编辑正文框）。 */
export const fillMissingSlots = (slots: PromptAgentInjectionItem[]): PromptAgentInjectionItem[] => {
  const present = new Set(slots.map(item => item.target));
  const copy = slots.map(item => ({ ...item }));
  for (const slot of LAB_SLOTS) {
    if (slot.target === 'context_head') {
      if (!present.has(slot.target)) copy.push(...makeEmptyContextHeadPair());
      continue;
    }
    if (!present.has(slot.target)) copy.push(makeEmptySlot(slot.target));
  }
  return copy;
};

/** 加载到编辑器的工作副本：builtin 原样只读；自定义归一化到完整 9 目标（每个 text 槽位必有 textarea，context_head 渲染成对编辑区）。 */
const buildLabDraft = (preset: PromptAgentCreativePreset | null): PromptAgentInjectionItem[] => {
  if (!preset) return [];
  if (preset.isBuiltin) return preset.slots.map(item => ({ ...item }));
  return fillMissingSlots(preset.slots);
};

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
        <label className="text-xs font-bold text-gray-600 dark:text-gray-300">接口名称<input value={value.name} onChange={event => onChange({ ...value, name: event.target.value })} placeholder="例如：我的中转站" className="mobile-touch mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm font-normal outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-400" /></label>
        <label className="text-xs font-bold text-gray-600 dark:text-gray-300">接口协议<select value={value.api} onChange={event => onChange({ ...value, api: event.target.value as PromptAgentCustomProvider['api'] })} className="mobile-touch mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm font-normal outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-400"><option value="openai-completions">OpenAI Chat / Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
      </div>
      <label className="block text-xs font-bold text-gray-600 dark:text-gray-300">Base URL<input value={value.baseUrl} onChange={event => onChange({ ...value, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" className="mobile-touch mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 font-mono text-sm font-normal outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-400" /><span className="mt-1 block text-micro font-normal leading-4 text-gray-400 dark:text-gray-500">填写到版本路径，例如 OpenAI兼容接口通常以 /v1 结尾。HTTP 只允许本机回环地址，局域网或公网接口必须使用 HTTPS。</span></label>
      <label className="block text-xs font-bold text-gray-600 dark:text-gray-300">API Key<input type="password" value={value.apiKey || ''} onChange={event => onChange({ ...value, apiKey: event.target.value })} placeholder={value.id ? '留空则继续使用原密钥' : '本地无密钥服务可以留空'} autoComplete="new-password" className="mobile-touch mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 font-mono text-sm font-normal outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-400" /></label>
      <div className="rounded-2xl border border-gray-200 p-3 dark:border-gray-700">
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <b className="shrink-0 text-sm dark:text-white">附加请求头</b>
          <span className="min-w-0 flex-1 basis-44 text-micro leading-4 text-gray-400 dark:text-gray-500">例如 HTTP-Referer；敏感鉴权头请使用 API Key</span>
          <button type="button" onClick={() => onChange({ ...value, headers: { ...(value.headers || {}), [`X-Custom-${headerEntries.length + 1}`]: '' } })} className="mobile-touch ml-auto shrink-0 rounded-xl px-3 text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">＋ 添加</button>
        </div>
        {headerEntries.length ? <div className="space-y-2">{headerEntries.map(([name, headerValue], index) => <div key={`${name}-${index}`} className="grid grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)_44px] gap-2"><input value={name} onChange={event => patchHeader(index, event.target.value, headerValue)} placeholder="请求头名称" className="mobile-touch min-w-0 rounded-xl border border-gray-300 bg-gray-50 px-3 font-mono text-xs outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-400"/><input value={headerValue} onChange={event => patchHeader(index, name, event.target.value)} placeholder="请求头值" className="mobile-touch min-w-0 rounded-xl border border-gray-300 bg-gray-50 px-3 font-mono text-xs outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-400"/><button type="button" onClick={() => onChange({ ...value, headers: Object.fromEntries(headerEntries.filter((_, entryIndex) => entryIndex !== index)) })} className="mobile-touch text-gray-400 hover:text-rose-600 dark:text-gray-500 dark:hover:text-rose-400" aria-label={`删除请求头 ${name}`}>×</button></div>)}</div> : <p className="text-meta text-gray-400 dark:text-gray-500">没有附加请求头。Authorization、Cookie、X-API-Key 等敏感字段不会保存在这里。</p>}
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <b className="shrink-0 text-sm dark:text-white">模型</b>
          <span className="min-w-0 flex-1 basis-36 text-micro leading-4 text-gray-400 dark:text-gray-500">可以为同一个接口添加多个模型</span>
          <button type="button" onClick={() => onChange({ ...value, models: [...value.models, { id: '', name: '', reasoning: false, imageInput: false, contextWindow: 128000, maxTokens: 16384 }] })} className="mobile-touch ml-auto shrink-0 rounded-xl bg-indigo-50 px-3 text-xs font-bold text-indigo-600 transition hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70">＋ 添加模型</button>
        </div>
        <div className="space-y-3">{value.models.map((model, index) => <div key={index} className="rounded-2xl border border-gray-200 p-3 dark:border-gray-700">
          <div className="flex gap-2"><input value={model.id} onChange={event => patchModel(index, { id: event.target.value })} placeholder="模型 ID，例如 deepseek-chat" className="mobile-touch min-w-0 flex-1 rounded-xl border border-gray-300 bg-gray-50 px-3 font-mono text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-400" />{value.models.length > 1 && <button type="button" onClick={() => onChange({ ...value, models: value.models.filter((_, modelIndex) => modelIndex !== index) })} className="mobile-touch rounded-xl px-3 text-sm font-bold text-rose-500 hover:text-rose-600 dark:text-rose-400">删除</button>}</div>
          <input value={model.name || ''} onChange={event => patchModel(index, { name: event.target.value })} placeholder="显示名称（可选）" className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-400" />
          <div className="mt-2 grid grid-cols-2 gap-2"><label className="text-meta text-gray-500 dark:text-gray-400">上下文长度<input type="number" min="1024" value={model.contextWindow} onChange={event => patchModel(index, { contextWindow: Number(event.target.value) })} className="mobile-touch mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-400" /></label><label className="text-meta text-gray-500 dark:text-gray-400">最大输出<input type="number" min="256" value={model.maxTokens} onChange={event => patchModel(index, { maxTokens: Number(event.target.value) })} className="mobile-touch mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-400" /></label></div>
          <div className="mt-2 flex flex-wrap gap-4"><label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={model.imageInput} onChange={event => patchModel(index, { imageInput: event.target.checked, capabilityDetection: { imageInput: 'manual', reasoning: model.capabilityDetection?.reasoning || 'unknown' } })}/>支持识图</label><label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={model.reasoning} onChange={event => patchModel(index, { reasoning: event.target.checked, capabilityDetection: { imageInput: model.capabilityDetection?.imageInput || 'unknown', reasoning: 'manual' } })}/>支持推理</label></div>
          {model.capabilityDetection && <div className="mt-2 text-micro text-gray-400 dark:text-gray-500">能力来源：识图 {model.capabilityDetection.imageInput === 'manual' ? '人工' : '自动'} · 推理 {model.capabilityDetection.reasoning === 'manual' ? '人工' : '自动'}（仍可手动纠正）</div>}
        </div>)}</div>
      </div>
      <div className="flex gap-2 border-t border-gray-100 pt-4 dark:border-gray-800"><button type="button" disabled={busy || !fetchReady} onClick={onFetch} className="mobile-touch flex-1 rounded-xl border border-indigo-300 text-sm font-bold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40">获取模型</button><button type="button" disabled={busy || !ready} onClick={onTest} className="mobile-touch flex-1 rounded-xl border border-indigo-300 text-sm font-bold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40">测试连接</button><button type="button" disabled={busy || !ready} onClick={onSave} className="mobile-touch flex-[1.4] rounded-xl bg-emerald-600 text-sm font-bold text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:opacity-40">保存并选用</button></div>
      <p className="text-micro leading-4 text-gray-400 dark:text-gray-500">API Key只会加密保存在运行项目的电脑。「获取模型」会请求 /models 并自动识别能力；人工纠正的识图/推理标记不会被覆盖。「测试连接」还会执行一次极小文本与工具调用，可能产生少量模型费用；标记为识图的模型也会附带最小图片请求。两者均由电脑发起，不经过手机。</p>
    </div>
  </div>;
};

/** 单个槽位在编辑状态中的带内更新。 */
const patchSlotIn = (slots: PromptAgentInjectionItem[], id: string, patch: Partial<PromptAgentInjectionItem>) => slots.map(item => item.id === id ? { ...item, ...patch } : item);

/** 独立行内子组件：可编辑 9 槽表单。 */
const EditableSlotForm: React.FC<{
  value: PromptAgentInjectionItem[];
  onChange: (next: PromptAgentInjectionItem[]) => void;
  busy: boolean;
}> = ({ value, onChange, busy }) => {
  const addContextHeadPair = () => {
    const pairId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    onChange([...value,
      { id: `head-${pairId}-u`, pairId, name: '', target: 'context_head', enabled: false, content: '', role: 'user' },
      { id: `head-${pairId}-a`, pairId, name: '', target: 'context_head', enabled: false, content: '', role: 'assistant' },
    ]);
  };
  // 成对启停：按 pairId 或相邻反 role 联动切换同组两项 enabled 状态，保持轮次交替契约。
  const toggleContextHeadPair = (item: PromptAgentInjectionItem) => {
    const nextEnabled = !item.enabled;
    const siblingId = item.pairId ? '' : siblingIdOf(item, value);
    const isPaired = (candidate: PromptAgentInjectionItem) =>
      candidate.target === 'context_head' &&
      (item.pairId ? candidate.pairId === item.pairId : candidate.id === item.id || candidate.id === siblingId);
    onChange(value.map(candidate => isPaired(candidate) ? { ...candidate, enabled: nextEnabled } : candidate));
  };
  // 成对删除：优先按 pairId 移除同组两项；无 pairId（旧数据/服务端导入）则按相邻反 role 回退配对，绝不孤立单条。
  const removeContextHeadPair = (item: PromptAgentInjectionItem) => {
    const siblingId = item.pairId ? '' : siblingIdOf(item, value);
    const paired = value.filter(candidate => candidate.target === 'context_head' && (item.pairId ? candidate.pairId === item.pairId : candidate.id === item.id || candidate.id === siblingId));
    onChange(paired.length > 1 ? value.filter(candidate => !paired.includes(candidate)) : value.filter(candidate => candidate.id !== item.id));
  };
  const siblingIdOf = (item: PromptAgentInjectionItem, all: PromptAgentInjectionItem[]) => {
    const heads = all.filter(candidate => candidate.target === 'context_head');
    const index = heads.findIndex(candidate => candidate.id === item.id);
    if (index < 0) return '';
    const neighbor = heads[index + (item.role === 'user' ? 1 : -1)];
    return neighbor && neighbor.role !== item.role ? neighbor.id : '';
  };

  return <div className="space-y-4">
    {LAB_SLOTS.map((slot, index) => {
      const slotItems = value.filter(item => item.target === slot.target);
      if (slot.kind === 'list') {
        return <section key={slot.target} className="rounded-2xl border border-gray-200 bg-white p-3 shadow-xs dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1"><b className="shrink-0 text-sm text-gray-900 dark:text-white">{slot.label}</b><span className="min-w-0 flex-1 text-micro leading-4 text-gray-400">#{index} · {slot.hint}</span><button type="button" onClick={addContextHeadPair} className="mobile-touch inline-flex shrink-0 items-center gap-1 rounded-xl border border-violet-200 bg-violet-50/80 px-2.5 py-1 text-xs font-bold text-violet-700 transition hover:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300"><Plus className="h-3.5 w-3.5" />成对添加</button></div>
          {slotItems.length === 0 ? <p className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center text-micro text-gray-400 dark:border-gray-800">context_head 尚无成对内容；成对添加、成对移除，不孤立单条。停用只影响注入，正文仍可编辑。</p> : <div className="space-y-2">{slotItems.map(item => <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50/50 p-2.5 dark:border-gray-800 dark:bg-gray-950/50">
            <div className="flex flex-wrap items-center gap-2"><span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-micro font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-400">{item.role === 'assistant' ? 'assistant' : 'user'}</span><span className="min-w-0 flex-1 truncate text-micro text-gray-400">{item.name || '（未命名条目）'}</span><button type="button" onClick={() => toggleContextHeadPair(item)} className={`mobile-touch inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-micro font-bold transition ${item.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-gray-100 text-gray-400 hover:text-gray-600 dark:bg-gray-800'}`} aria-pressed={item.enabled} title={item.enabled ? '停用此成对（保留内容，不注入）' : '启用此成对'}>{item.enabled ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{item.enabled ? '已启用' : '已停用'}</button><button type="button" onClick={() => removeContextHeadPair(item)} className="mobile-touch inline-flex shrink-0 items-center justify-center rounded-lg p-1 text-gray-400 hover:text-rose-500 dark:text-gray-500 dark:hover:text-rose-400" aria-label="删除此成对" title="删除此成对（连带同组另一条）"><Trash2 className="h-3.5 w-3.5" /></button></div>
            <input value={item.name || ''} onChange={event => onChange(patchSlotIn(value, item.id, { name: event.target.value }))} placeholder="条目名（可选）" className="mobile-touch mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs outline-none focus:border-violet-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-violet-500" />
            <textarea value={item.content} onChange={event => onChange(patchSlotIn(value, item.id, { content: event.target.value }))} rows={3} disabled={busy} placeholder="内容…" aria-label={`${slot.label} ${item.role === 'assistant' ? 'assistant' : 'user'} 正文`} className={`mobile-touch mt-1.5 w-full resize-y rounded-xl border px-3 py-2 font-mono text-xs outline-none transition ${item.enabled ? 'border-gray-200 bg-white text-gray-800 focus:border-violet-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-violet-500' : 'border-gray-200/60 bg-gray-100/60 text-gray-400 dark:border-gray-800/60 dark:bg-gray-950/40 dark:text-gray-500'}`} />
          </div>)}</div>}
        </section>;
      }
      const slotItem = slotItems[0];
      return <section key={slot.target} className={`rounded-2xl border p-3.5 shadow-xs transition-colors ${slotItem?.enabled ? 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900' : 'border-dashed border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-950/30'}`}>
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1"><b className="shrink-0 text-sm text-gray-900 dark:text-white">{slot.label}</b><span className="min-w-0 flex-1 text-micro leading-4 text-gray-400">#{index} · {slot.hint}</span>{slotItem && <button type="button" role="switch" aria-checked={slotItem.enabled} onClick={() => onChange(patchSlotIn(value, slotItem.id, { enabled: !slotItem.enabled }))} className={`mobile-touch inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-micro font-bold transition ${slotItem.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-gray-100 text-gray-400 hover:text-gray-600 dark:bg-gray-800'}`} aria-pressed={slotItem.enabled} title={slotItem.enabled ? '停用此槽位（保留内容，不注入）' : '启用此槽位'}>{slotItem.enabled ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{slotItem.enabled ? '已启用' : '已停用'}</button>}</div>
        {!slotItem ? <button type="button" onClick={() => onChange([...value, makeEmptySlot(slot.target)])} className="mobile-touch inline-flex items-center gap-1 rounded-xl border border-dashed border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-500 hover:border-gray-400 dark:border-gray-700">＋ 启用此槽位</button> : <div className="flex flex-wrap items-end gap-2"><input value={slotItem.name || ''} onChange={event => onChange(patchSlotIn(value, slotItem.id, { name: event.target.value }))} placeholder={slot.target === 'conversation_tail' || slot.target === 'assistant_prefill' ? '名称（如 安全拦截 / 结尾语）' : '名称（可选）'} className="mobile-touch min-w-0 flex-1 basis-40 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-violet-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-violet-500" />{slot.target === 'context_depth' && <label className="text-meta text-gray-500 dark:text-gray-400">上下文窗口深度<input type="number" min={1} max={100} step={1} value={slotItem.depth ?? 1} onChange={event => { const raw = Number(event.target.value); const clamped = Math.min(100, Math.max(1, Math.floor(Number.isFinite(raw) ? raw : 1))); onChange(patchSlotIn(value, slotItem.id, { depth: clamped })); }} disabled={busy} className="mobile-touch mt-1 w-36 rounded-xl border border-gray-300 bg-white px-3 py-1.5 font-mono text-sm text-gray-900 outline-none focus:border-violet-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-violet-500" /></label>}</div>}
        {slotItem && <textarea value={slotItem.content} onChange={event => onChange(patchSlotIn(value, slotItem.id, { content: event.target.value }))} rows={5} disabled={busy} placeholder={slotItem.enabled ? '在此输入内容…' : '此槽位已停用（停用只影响注入，正文仍可编辑）'} aria-label={`${slot.label} 正文`} className={`mobile-touch mt-2 w-full resize-y rounded-xl border px-3 py-2 font-mono text-xs outline-none transition ${slotItem.enabled ? 'border-gray-200 bg-white text-gray-800 focus:border-violet-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-violet-500' : 'border-gray-200/60 bg-gray-100/60 text-gray-400 dark:border-gray-800/60 dark:bg-gray-950/40 dark:text-gray-500'}`} />}
      </section>;
    })}
  </div>;
};

/** builtin 预设只读面板：全部槽位只读/禁用，供滚动浏览；修改只能走「复制为自定义」。 */
const BuiltinPresetPanel: React.FC<{
  preset: PromptAgentCreativePreset;
  forking?: boolean;
  onFork: () => void;
  exporting?: boolean;
  onExport: () => void;
  onOpenInspector: () => void;
}> = ({ preset, forking, onFork, exporting, onExport, onOpenInspector }) => {
  const slots = preset.slots || [];
  return <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <b className="text-sm text-gray-900 dark:text-white">内置预设（只读）</b>
        <span className="ml-2 text-micro text-gray-400">按系统策略提供全部正文，不可直接原地修改</span>
      </div>
      <button
        type="button"
        onClick={onOpenInspector}
        className="mobile-touch inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-100 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-300"
        aria-label="规范化上下文估算"
        title="规范化上下文估算"
      >
        <Settings2 className="h-3.5 w-3.5" />
        规范化上下文估算
      </button>
    </div>
    <div className="mt-3 space-y-4">{slots.length === 0 && <p className="py-4 text-center text-sm text-gray-500">该内置预设没有槽位内容</p>}{slots.map(item => {
      const meta = LAB_SLOTS.find(slot => slot.target === item.target);
      return <div key={item.id} className="rounded-2xl border border-gray-100 p-3 dark:border-gray-800">
        <div className="flex flex-wrap items-center gap-2"><b className="text-sm text-gray-900 dark:text-white">{meta?.label || item.target}</b>{item.role && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-micro font-bold text-gray-500 dark:bg-gray-800">{item.role}</span>}{item.depth !== undefined && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-micro font-bold text-indigo-700 dark:bg-indigo-950/60">depth {item.depth}</span>}<span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-bold ${item.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60' : 'bg-gray-100 text-gray-400 dark:bg-gray-800'}`}>{item.enabled ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{item.enabled ? '已启用' : '已停用'}</span></div>
        <textarea readOnly value={item.content || ''} rows={5} aria-label={`${meta?.label || item.target}（只读）`} className="mt-2 w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs dark:border-gray-800 dark:bg-gray-950" />
      </div>;
    })}</div>
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
      <button
        type="button"
        disabled={forking}
        onClick={onFork}
        className="mobile-touch inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
      >
        <Copy className="h-3.5 w-3.5" />
        复制为自定义以编辑
      </button>
      <button
        type="button"
        disabled={exporting}
        onClick={onExport}
        title="导出当前预设"
        aria-label="导出当前预设"
        className="mobile-touch inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        <Upload className="h-3.5 w-3.5" />
        导出当前
      </button>
    </div>
  </div>;
};

/** 自定义预设编辑器：加载草稿 → 就地编辑 9 槽 → 保存为新版修订。保存成功后由父级 reload 刷新列表。 */
const CustomPresetEditor: React.FC<{
  preset: PromptAgentCreativePreset;
  busy: boolean;
  notify: (message: string, type?: 'success' | 'error') => void;
  onSaved: () => void;
  onFork: () => void;
  onExport: () => void;
  forking?: boolean;
  exporting?: boolean;
  onOpenInspector: () => void;
  onOpenRevisions: () => void;
}> = ({ preset, busy, notify, onSaved, onFork, onExport, forking, exporting, onOpenInspector, onOpenRevisions }) => {
  const [name, setName] = useState(preset.name);
  const [description, setDescription] = useState(preset.description || '');
  const [slots, setSlots] = useState<PromptAgentInjectionItem[]>(() => buildLabDraft(preset));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) { notify('请先填写预设名称', 'error'); return; }
    setSaving(true);
    try {
      const sanitized = sanitizeSlotsForSave(slots);
      setSlots(sanitized);
      await promptAgentService.updateCreativePreset(preset.id, { name: name.trim(), description: description.trim() || undefined, slots: sanitized });
      notify('预设已保存');
      onSaved();
    } catch (error) { notify(error instanceof Error ? error.message : '保存预设失败', 'error'); }
    finally { setSaving(false); }
  };

  const resetDraft = () => {
    setName(preset.name);
    setDescription(preset.description || '');
    setSlots(buildLabDraft(preset));
    notify('已重置修改');
  };

  return <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <b className="text-sm text-gray-900 dark:text-white">编辑预设</b>
        <span className="ml-2 text-micro text-gray-400">固定 9 槽位；停用只影响注入，正文始终可编辑</span>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={onOpenInspector}
          className="mobile-touch inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-600 hover:bg-indigo-100 disabled:opacity-40 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-300"
          aria-label="规范化上下文估算"
          title="规范化上下文估算"
        >
          <Settings2 className="h-3.5 w-3.5" />
          规范化上下文估算
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onOpenRevisions}
          className="mobile-touch inline-flex items-center gap-1 rounded-xl border border-gray-200 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          title="修订历史"
        >
          <FileUp className="h-3.5 w-3.5" />
          修订历史
        </button>
      </div>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2"><input value={name} onChange={event => setName(event.target.value)} placeholder="预设名称" className="mobile-touch rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-violet-500" /><input value={description} onChange={event => setDescription(event.target.value)} placeholder="描述（可选）" className="mobile-touch rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-violet-500" /></div>
    <div className="mt-4"><EditableSlotForm value={slots} onChange={setSlots} busy={busy || saving} /></div>
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
      <button
        type="button"
        disabled={busy || saving || !name.trim()}
        onClick={() => void save()}
        className="mobile-touch inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:opacity-40"
      >
        <Save className="h-4 w-4" />
        {saving ? '保存中…' : '保存预设'}
      </button>
      <button
        type="button"
        disabled={busy || forking}
        onClick={onFork}
        title="以选中预设为模板另存为新预设"
        className="mobile-touch inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        <Copy className="h-3.5 w-3.5" />
        另存为…
      </button>
      <button
        type="button"
        disabled={busy || exporting}
        onClick={onExport}
        title="导出当前预设"
        aria-label="导出当前预设"
        className="mobile-touch inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        <Upload className="h-3.5 w-3.5" />
        导出当前
      </button>
      <button
        type="button"
        disabled={busy || saving}
        onClick={resetDraft}
        className="mobile-touch ml-auto text-xs font-bold text-gray-400 transition hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
      >
        重置修改
      </button>
    </div>
  </div>;
};

/** Inspector 结果展示：完整规范化正文（systemPrompt / canonicalMessages / sourceSegments）+ 数字估算。 */
const InspectorResultView: React.FC<{ result: PromptAgentCreativeInspectResult }> = ({ result }) => {
  if (!result.ok) return <p className="py-3 text-sm text-rose-600 dark:text-rose-400">{result.message || '估算失败'}</p>;
  const estimate = result.tokenEstimate;
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2 text-micro">{estimate && <span className="rounded-lg bg-indigo-50 px-2 py-1 font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">约 {estimate.totalTokens} tokens</span>}{estimate && <span className="rounded-lg bg-gray-100 px-2 py-1 text-gray-600 dark:bg-gray-800 dark:text-gray-300">上下文 {estimate.contextWindow} · 深度 {estimate.contextDepth}</span>}{result.hashes?.presetRevisionHash && <span className="rounded-lg bg-gray-100 px-2 py-1 font-mono text-gray-500 dark:bg-gray-800 dark:text-gray-400">{result.hashes.presetRevisionHash}</span>}</div>
    {result.systemPrompt && <details open={false} className="rounded-xl border border-gray-200 dark:border-gray-800"><summary className="cursor-pointer px-3 py-2 text-xs font-bold text-gray-700 select-none hover:text-indigo-600 dark:text-gray-200 dark:hover:text-indigo-400">完整系统提示词</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-micro leading-5 text-gray-600 dark:text-gray-300">{result.systemPrompt}</pre></details>}
    {result.canonicalMessages && result.canonicalMessages.length > 0 && <details open={false} className="rounded-xl border border-gray-200 dark:border-gray-800"><summary className="cursor-pointer px-3 py-2 text-xs font-bold text-gray-700 select-none hover:text-indigo-600 dark:text-gray-200 dark:hover:text-indigo-400">规范化消息（{result.canonicalMessages.length}）</summary><div className="max-h-60 space-y-2 overflow-auto px-3 pb-3">{result.canonicalMessages.map((message, index) => <div key={index} className="rounded-lg bg-gray-50 p-2 dark:bg-gray-950"><span className="text-micro font-bold text-indigo-600 dark:text-indigo-400">{message.role}</span><pre className="mt-1 whitespace-pre-wrap font-mono text-micro leading-5 text-gray-600 dark:text-gray-300">{formatMessageContent(message.content)}</pre></div>)}</div></details>}
    {result.sourceSegments && result.sourceSegments.length > 0 && <details open={false} className="rounded-xl border border-gray-200 dark:border-gray-800"><summary className="cursor-pointer px-3 py-2 text-xs font-bold text-gray-700 select-none hover:text-indigo-600 dark:text-gray-200 dark:hover:text-indigo-400">来源片段</summary><div className="max-h-60 space-y-1 overflow-auto px-3 pb-3">{result.sourceSegments.map((segment, index) => <div key={index} className="flex gap-2 text-micro text-gray-600 dark:text-gray-300"><span className="shrink-0 rounded bg-gray-100 px-1.5 text-gray-500 dark:bg-gray-800">{segment.characterCount}字</span><span className="min-w-0 flex-1 truncate">{segment.label}{segment.target ? ` · ${segment.target}` : ''}{segment.presetName ? ` · ${segment.presetName}` : ''}</span></div>)}</div></details>}
    {estimate && <details open={false} className="rounded-xl border border-gray-200 dark:border-gray-800"><summary className="cursor-pointer px-3 py-2 text-xs font-bold text-gray-700 select-none hover:text-indigo-600 dark:text-gray-200 dark:hover:text-indigo-400">令牌估算明细</summary><div className="grid grid-cols-2 gap-2 px-3 pb-3 text-micro text-gray-600 dark:text-gray-300"><span>策略 {estimate.policyTokens}</span><span>草稿 {estimate.draftTokens}</span><span>历史 {estimate.historyTokens}</span><span>预设 {estimate.presetTokens}</span><span>总量 {estimate.totalTokens}</span><span>上下文窗口 {estimate.contextWindow}</span><span>深度 {estimate.contextDepth}</span><span>预计余量 {estimate.projectedBuffer}</span></div></details>}
    {result.warnings && result.warnings.length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{result.warnings.map((warning, index) => <div key={`${warning}-${index}`}>{warning}</div>)}</div>}
  </div>;
};

/** 预设编辑工作区：同一面板内联子状态机的全部子面板（edit / create / inspect / revisions）。 */
const CreativeLabView: React.FC<{
  presets: PromptAgentCreativePreset[];
  activeCreativePresetId?: string;
  warnings: string[];
  busy: boolean;
  notify: (message: string, type?: 'success' | 'error') => void;
  onStateChanged: (next: PromptAgentCreativePresetState) => void;
  onDeletePreset: (preset: PromptAgentCreativePreset) => void;
}> = ({ presets, activeCreativePresetId, warnings, busy, notify, onStateChanged, onDeletePreset }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'create'>('edit');
  const [editorKey, setEditorKey] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorContent, setInspectorContent] = useState<PromptAgentCreativeInspectResult | null>(null);
  const [inspectorBusy, setInspectorBusy] = useState(false);
  const [inspectorMessage, setInspectorMessage] = useState('');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const importRef = React.useRef<HTMLInputElement | null>(null);
  const [revisionPresetId, setRevisionPresetId] = useState<string | null>(null);
  const [revisionItems, setRevisionItems] = useState<PromptAgentCreativePresetRevision[] | null>(null);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createSlots, setCreateSlots] = useState<PromptAgentInjectionItem[]>(() => fillMissingSlots([]));
  const [creating, setCreating] = useState(false);
  const [forking, setForking] = useState(false);

  const [mobileTab, setMobileTab] = useState<'list' | 'editor'>('list');

  const selected = presets.find(preset => preset.id === selectedId) ?? null;
  const customPresets = presets.filter(preset => !preset.isBuiltin);
  const initial = defaultPresetId(presets, activeCreativePresetId);

  useEffect(() => {
    if (selectedId === null || !presets.some(preset => preset.id === selectedId)) {
      setSelectedId(initial);
    }
  }, [selectedId, presets, initial]);

  useEffect(() => {
    if (!inspectorOpen && !revisionPresetId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (inspectorOpen) setInspectorOpen(false);
        if (revisionPresetId) setRevisionPresetId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [inspectorOpen, revisionPresetId]);

  const reloadState = async () => {
    const state = await promptAgentService.getCreativePresets();
    onStateChanged(state);
    setEditorKey(value => value + 1);
  };

  const runActive = async (presetId: string | null) => {
    if (busy) return;
    try {
      const next = await promptAgentService.setActiveCreativePreset(presetId);
      onStateChanged(next);
      notify(presetId ? '已设为默认（作用于新对话）' : '已清除默认预设');
    } catch (error) { notify(error instanceof Error ? error.message : '设置默认失败', 'error'); }
  };

  const createNew = async () => {
    if (busy || creating) return;
    if (!createName.trim()) { notify('请先填写预设名称', 'error'); return; }
    setCreating(true);
    try {
      const sanitized = sanitizeSlotsForSave(createSlots);
      const created = await promptAgentService.createCreativePreset({ name: createName.trim(), description: createDescription.trim() || undefined, slots: sanitized });
      notify(`预设「${created.name}」已创建`);
      setMode('edit'); setSelectedId(created.id);
      setMobileTab('editor');
      await reloadState();
    } catch (error) { notify(error instanceof Error ? error.message : '创建预设失败', 'error'); }
    finally { setCreating(false); }
  };

  const openInspector = async (messageOverride?: string) => {
    if (busy || !selected) return;
    const runEstimate = async () => {
      setInspectorBusy(true);
      try {
        const result = await promptAgentService.inspectCreativeContext({ presetId: selected.id, draft: { basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler' } }, message: messageOverride ?? inspectorMessage });
        setInspectorContent(result);
        notify(result.ok ? '规范化上下文估算完成' : '规范化上下文估算失败', result.ok ? undefined : 'error');
      } catch (error) { notify(error instanceof Error ? error.message : '规范化上下文估算失败', 'error'); }
      finally { setInspectorBusy(false); }
    };
    if (!inspectorOpen) { setInspectorOpen(true); setInspectorContent(null); await runEstimate(); }
    else { await runEstimate(); }
  };

  const openRevisions = async () => {
    if (busy || !selected) return;
    setRevisionPresetId(selected.id); setRevisionBusy(true);
    try {
      const detail = await promptAgentService.getCreativePresetDetail(selected.id);
      setRevisionItems(detail.revisions || []);
    } catch (error) { notify(error instanceof Error ? error.message : '读取修订失败', 'error'); }
    finally { setRevisionBusy(false); }
  };

  const exportPresets = async (ids: string[]) => {
    if (exporting || !ids.length) return;
    setExporting(true);
    try {
      const payload = await promptAgentService.exportCreativePresets(ids);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `creative-presets-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(`已导出 ${payload.presets.length} 个预设`);
    } catch (error) { notify(error instanceof Error ? error.message : '导出失败', 'error'); }
    finally { setExporting(false); }
  };

  const importFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onerror = () => notify('读取导入文件失败', 'error');
    reader.onload = () => {
      let parsed: unknown;
      try { parsed = JSON.parse(String(reader.result || '')); }
      catch { notify('导入文件不是有效 JSON', 'error'); return; }
      void (async () => {
        setImporting(true);
        try {
          const candidate = parsed as { schema?: unknown; version?: unknown; presets?: unknown };
          if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.presets)) {
            notify('导入文件缺少 presets 数组', 'error'); return;
          }
          const result = await promptAgentService.importCreativePresets({
            schema: typeof candidate.schema === 'string' ? candidate.schema : 'creative-presets',
            version: typeof candidate.version === 'number' ? candidate.version : 1,
            presets: candidate.presets as PromptAgentCreativePreset[],
          });
          notify(result.imported ? `已导入 ${result.imported} 个预设${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''}` : '没有可导入的预设');
          if (result.imported) await reloadState();
        } catch (error) { notify(error instanceof Error ? error.message : '导入失败', 'error'); }
        finally { setImporting(false); }
      })();
    };
    reader.readAsText(file);
  };

  const selectPreset = (preset: PromptAgentCreativePreset | null) => {
    setSelectedId(preset?.id ?? null);
    setMode('edit');
    setEditorKey(value => value + 1);
    setRevisionPresetId(null); setInspectorOpen(false); setInspectorContent(null);
    setMobileTab('editor');
  };

  const beginCreate = () => {
    setMode('create');
    setCreateName(''); setCreateDescription('');
    setCreateSlots(fillMissingSlots([]));
    setRevisionPresetId(null); setInspectorOpen(false); setInspectorContent(null);
    setMobileTab('editor');
  };

  const forkSelected = async (preset: PromptAgentCreativePreset) => {
    if (busy || forking) return;
    setForking(true);
    try {
      // 另存为语义：只传 name/description/forkFromId，服务端据此复制全部槽位；
      // 不附带清空的 slots，避免与“新预设”路径产生歧义。
      const baseName = preset.name.slice(0, 76);
      const created = await promptAgentService.createCreativePreset({
        name: `${baseName}（副本）`, description: preset.description, forkFromId: preset.id,
      });
      notify(`已从「${preset.name}」另存为「${created.name}」`);
      setSelectedId(created.id); setMode('edit');
      setMobileTab('editor');
      await reloadState();
    } catch (error) { notify(error instanceof Error ? error.message : '另存为失败', 'error'); }
    finally { setForking(false); }
  };

  const renderEditor = () => {
    if (mode === 'create') return <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-2"><b className="text-sm text-gray-900 dark:text-white">新建空预设</b><span className="min-w-0 flex-1 text-micro text-gray-400">固定 9 槽位全部可编辑</span></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2"><input autoFocus value={createName} onChange={event => setCreateName(event.target.value)} placeholder="预设名称" className="mobile-touch rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-violet-500" /><input value={createDescription} onChange={event => setCreateDescription(event.target.value)} placeholder="描述（可选）" className="mobile-touch rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-violet-500" /></div>
      <div className="mt-4"><EditableSlotForm value={createSlots} onChange={setCreateSlots} busy={creating} /></div>
      <div className="mt-4 flex gap-2 border-t border-gray-100 pt-3 dark:border-gray-800"><button type="button" disabled={creating || !createName.trim()} onClick={() => void createNew()} className="mobile-touch inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:opacity-40"><Save className="h-4 w-4" />{creating ? '创建中…' : '创建预设'}</button><button type="button" disabled={creating} onClick={() => selectPreset(selected)} className="mobile-touch rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">取消</button></div>
    </div>;
    if (!selected) return <div className="p-10 text-center text-sm text-gray-500">请先选择一个预设</div>;
    const key = `${selected.id}:${editorKey}`;
    if (selected.isBuiltin) return <BuiltinPresetPanel key={key} preset={selected} forking={forking} onFork={() => void forkSelected(selected)} exporting={exporting} onExport={() => void exportPresets([selected.id])} onOpenInspector={() => void openInspector()} />;
    return <CustomPresetEditor key={key} preset={selected} busy={busy} notify={notify} onSaved={() => void reloadState()} onFork={() => void forkSelected(selected)} onExport={() => void exportPresets([selected.id])} forking={forking} exporting={exporting} onOpenInspector={() => void openInspector()} onOpenRevisions={() => void openRevisions()} />;
  };

  return <div className="min-h-0 flex-1 overflow-y-auto py-3">
    <div className="mx-auto flex min-h-0 max-w-6xl flex-col gap-3">
      {/* 移动端分段视图切换：清单 vs 编辑器 */}
      <div className="sticky top-0 z-10 flex rounded-xl border border-gray-200 bg-gray-100/90 p-1 backdrop-blur-xs dark:border-gray-800 dark:bg-gray-900/90 md:hidden">
        <button
          type="button"
          onClick={() => setMobileTab('list')}
          className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
            mobileTab === 'list'
              ? 'bg-white text-violet-700 shadow-xs dark:bg-gray-800 dark:text-violet-300'
              : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          预设清单 ({presets.length})
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('editor')}
          className={`flex-1 truncate rounded-lg px-2 py-1.5 text-xs font-bold transition ${
            mobileTab === 'editor'
              ? 'bg-white text-violet-700 shadow-xs dark:bg-gray-800 dark:text-violet-300'
              : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          {mode === 'create' ? '新建预设' : '编辑预设'}
        </button>
      </div>

      <div className="flex min-h-0 flex-col gap-4 md:grid md:grid-cols-[300px_1fr] md:gap-4 items-start">
        {/* 左栏：预设列表 */}
        <div className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 self-start w-full ${mobileTab === 'list' ? 'block' : 'hidden md:block'}`}>
          <div className="mb-2 flex items-center gap-2"><span className="text-meta font-bold uppercase tracking-wider text-violet-500">预设</span><span className="min-w-0 flex-1 truncate text-micro text-gray-400">{customPresets.length} 个自定义 · {presets.length - customPresets.length} 个内置</span><button type="button" disabled={busy || importing || !presets.length} onClick={() => exportPresets(presets.map(preset => preset.id))} title="导出全部预设（含内置）" aria-label="导出全部预设" className="mobile-touch inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Upload className="h-3.5 w-3.5" /><span className="hidden sm:inline">导出全部</span></button><button type="button" disabled={busy || importing} onClick={() => importRef.current?.click()} aria-label="导入预设 JSON" className="mobile-touch inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">导入 JSON</span></button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) importFromFile(file); event.currentTarget.value = ''; }} /></div>
          <div className="space-y-2">
            <button type="button" disabled={busy} onClick={beginCreate} className="mobile-touch inline-flex w-full items-center gap-1.5 rounded-xl border border-dashed border-violet-300 px-3 py-2 text-sm font-bold text-violet-600 transition hover:border-violet-500 hover:bg-violet-50/50 disabled:opacity-40 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/20"><Plus className="h-4 w-4" />新建空预设</button>
            {presets.length === 0 && (
              <p className="py-6 text-center text-xs text-gray-400">暂无预设，点击上方「新建空预设」开始</p>
            )}
            {presets.map(preset => {
              const effectiveActiveId = activeCreativePresetId || defaultPresetId(presets);
              const isActive = preset.id === effectiveActiveId;
              const isSelected = preset.id === selectedId && mode === 'edit';
              return <div key={preset.id} className={`flex items-center gap-1 rounded-xl border px-2 py-1.5 transition-colors ${isSelected ? 'border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/30' : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50/60 dark:hover:bg-gray-800/40'}`}>
                <button type="button" onClick={() => selectPreset(preset)} className="mobile-touch min-w-0 flex-1 px-1 text-left">
                  <span className="flex items-center gap-1.5"><b className="truncate text-sm text-gray-900 dark:text-white">{preset.name}</b>{isActive && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-micro font-bold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"><Star className="h-2.5 w-2.5 fill-current" />默认</span>}{preset.isBuiltin && <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-micro font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400">内置</span>}</span>
                  <span className="mt-0.5 block truncate text-micro text-gray-400">{preset.description || (preset.isBuiltin ? '内置只读预设' : '自定义预设')} · {preset.slots.length} 个槽位</span>
                </button>
                {!preset.isBuiltin && <button type="button" disabled={busy} onClick={() => void runActive(isActive ? null : preset.id)} title={isActive ? '取消默认' : '设为默认'} aria-label={isActive ? '取消默认' : '设为默认'} className="mobile-touch inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-gray-400 hover:text-violet-600 disabled:opacity-40 dark:hover:text-violet-300">{isActive ? <Check className="h-4 w-4 text-violet-600 dark:text-violet-400" /> : <Star className="h-4 w-4" />}</button>}
                {!preset.isBuiltin && <button type="button" disabled={busy} onClick={() => void onDeletePreset(preset)} title="删除预设" aria-label={`删除预设 ${preset.name}`} className="mobile-touch inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-gray-400 hover:text-red-500 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>}
              </div>;
            })}
          </div>
          {warnings.length > 0 && <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{warnings.map((warning, index) => <div key={`${warning}-${index}`}>{warning}</div>)}</div>}
        </div>

        {/* 右栏：编辑器与估算面板 */}
        <div className={`min-w-0 space-y-4 w-full ${mobileTab === 'editor' ? 'block' : 'hidden md:block'}`}>
          {renderEditor()}

          {inspectorOpen && (
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex items-center gap-2"><b className="text-sm text-gray-900 dark:text-white">规范化上下文估算</b><button type="button" onClick={() => setInspectorOpen(false)} className="mobile-touch ml-auto text-gray-400 hover:text-gray-600" aria-label="关闭估算面板"><X className="h-4 w-4" /></button></div>
              <p className="mb-2 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-micro leading-4 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">规范化上下文估算：展示经注入拼装后的系统提示词与规范化消息序列，供核对上下文构成与 Token 占用。</p>
              <div className="mb-3 flex items-end gap-2"><label className="min-w-0 flex-1 text-meta text-gray-500">模拟用户消息<textarea value={inspectorMessage} onChange={event => setInspectorMessage(event.target.value)} rows={2} placeholder="输入一段模拟用户消息，观察其对上下文估算的影响…" aria-label="模拟用户消息" className="mobile-touch mt-1 w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-400" /></label><button type="button" disabled={inspectorBusy} onClick={() => void openInspector()} className="mobile-touch rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-40">发送并估算</button></div>
              {inspectorBusy ? <p className="py-4 text-center text-sm text-gray-500">估算中…</p> : inspectorContent ? <InspectorResultView result={inspectorContent} /> : <p className="py-4 text-center text-sm text-gray-500">输入模拟消息后发送，或直接发送空消息进行估算</p>}
            </div>
          )}

          {revisionPresetId && (
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex items-center gap-2"><b className="text-sm text-gray-900 dark:text-white">修订历史</b><button type="button" onClick={() => setRevisionPresetId(null)} className="mobile-touch ml-auto text-gray-400 hover:text-gray-600" aria-label="关闭修订面板"><X className="h-4 w-4" /></button></div>
              {revisionBusy ? <p className="py-4 text-center text-sm text-gray-500">读取中…</p> : !revisionItems || revisionItems.length === 0 ? <p className="py-4 text-center text-sm text-gray-500">暂无修订记录</p> :
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">{revisionItems.map(item => <div key={`${item.revisionHash}-${item.version}`} className="rounded-xl border border-gray-100 p-2 text-xs dark:border-gray-800"><div className="flex items-center gap-2"><b className="text-gray-800 dark:text-gray-200">v{item.version}</b><span className="truncate text-gray-500">{new Date(item.createdAt).toLocaleString('zh-CN')}</span></div><div className="mt-1 truncate font-mono text-micro text-gray-400">{item.revisionHash}</div></div>)}</div>}
            </div>
          )}
        </div>
      </div>
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
  // 破限提示词与预设实验室：预设列表 / 激活预设 / 服务端警告（编辑工作区由 CreativeLabView 自持）。
  const [creativePresets, setCreativePresets] = useState<PromptAgentCreativePreset[]>([]);
  const [activeCreativePresetId, setActiveCreativePresetId] = useState<string | undefined>(undefined);
  const [creativeWarnings, setCreativeWarnings] = useState<string[]>([]);
  // 连接服务菜单展开状态
  const [connectMenuOpen, setConnectMenuOpen] = useState(false);
  const connectMenuRef = useRef<HTMLDivElement | null>(null);
  // P2-17：子页覆盖层（全屏）的焦点管理：进入时移入、Tab 圈禁、返回 home 后归还。
  const subViewRef = useModalA11y<HTMLDivElement>(view !== 'home');

  const reload = async () => {
    const [nextConfig, nextProviders, nextModels, nextCustomProviders, nextCreative] = await Promise.all([
      promptAgentService.getConfig(), promptAgentService.getProviders(), promptAgentService.getAvailableModels(), promptAgentService.getCustomProviders(), promptAgentService.getCreativePresets(),
    ]);
    setConfig(nextConfig);
    setProviders(nextProviders);
    setModels(nextModels);
    setCustomProviders(nextCustomProviders);
    setCreativePresets(nextCreative.items || []);
    setActiveCreativePresetId(nextCreative.activeCreativePresetId);
    setCreativeWarnings(nextCreative.warnings || []);
    window.dispatchEvent(new CustomEvent('nai-agent-runtime-changed'));
  };

  useEffect(() => { void reload().catch(() => notify('读取 AI 模型服务失败', 'error')); }, []);

  useEffect(() => {
    if (!connectMenuOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !connectMenuRef.current?.contains(event.target)) setConnectMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeOnOutside);
    return () => window.removeEventListener('pointerdown', closeOnOutside);
  }, [connectMenuOpen]);

  const filteredProviders = useMemo(() => providers.filter(provider => {
    if (provider.custom) return false;
    if (view === 'logout' && !provider.configured) return false;
    return fuzzyMatch(`${provider.name} ${provider.id} ${provider.authType === 'oauth' ? 'OAuth' : 'API key'}`, query);
  }), [providers, query, view]);
  const filteredModels = useMemo(() => models.filter(model => (view !== 'vision' || model.imageInput) && fuzzyMatch(`${model.name} ${model.id} ${model.provider}`, query)), [models, query, view]);

  const openView = (next: View) => { setQuery(''); setView(next); setConnectMenuOpen(false); };
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

  /** 删除自定义预设（builtin 只读，不在列表提供删除）。删除 active 时后端原子回退到内置默认，无需前端补 setActive(null)。 */
  const handleDeletePreset = async (preset: PromptAgentCreativePreset) => {
    if (preset.isBuiltin) return;
    if (!await confirmAction({ title: `删除预设「${preset.name}」？`, message: '该操作不可撤销；若这是当前默认预设，将自动回退到内置默认。不影响已建立的 Agent 对话。', confirmLabel: '删除预设', tone: 'danger' })) return;
    setBusy(true);
    try {
      await promptAgentService.deleteCreativePreset(preset.id);
      await reload();
      notify('预设已删除');
    } catch (error) { notify(error instanceof Error ? error.message : '删除预设失败', 'error'); }
    finally { setBusy(false); }
  };

  const currentModel = models.find(model => model.current) || (config ? { id: config.model, name: config.model, provider: config.provider } : null);
  const currentVisionModel = models.find(model => model.currentVision) || (config?.visionAvailable ? { id: config.visionModel, name: config.visionModel, provider: config.visionProvider } : null);
  const configured = providers.filter(provider => provider.configured && !provider.custom);

  return <>
    {view === 'home' && (
      <div className="mt-3 space-y-4">
      {/* 阶段二：层级 1 - 当前运行模型卡 */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-meta font-bold uppercase tracking-wider text-indigo-500">当前 Agent 模型</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={configured.length === 0}
              onClick={() => openView('model')}
              className="mobile-touch rounded-lg border border-indigo-200 bg-indigo-50/60 px-2.5 py-1 text-xs font-bold text-indigo-600 hover:bg-indigo-100 disabled:opacity-40 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
            >
              更换模型
            </button>
            <button
              type="button"
              disabled={!models.some(model => model.imageInput)}
              onClick={() => openView('vision')}
              className="mobile-touch rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              视觉设置
            </button>
          </div>
        </div>
        <div className="mt-1.5 truncate text-base font-black text-gray-900 dark:text-white">{config?.configured ? displayModelName(currentModel?.name || config.model) : '尚未配置模型服务'}</div>
        {config?.configured && <div className="mt-1 text-xs text-gray-500">{(currentModel as { providerName?: string } | null)?.providerName || currentModel?.provider} · {config.configuredProviders.length} 个服务已配置</div>}
        {config?.visionAvailable && <div className="mt-2.5 border-t border-gray-100 pt-2 text-xs text-gray-500 dark:border-gray-800">视觉模型：<b className="text-gray-700 dark:text-gray-200">{displayModelName(currentVisionModel?.name || config.visionModel)}</b> · {(currentVisionModel as { providerName?: string } | null)?.providerName || currentVisionModel?.provider}{config.visionDedicated ? ' · 独立分析' : ' · 跟随主模型'} · {config.visionMode === 'auto' ? '自动匹配' : '手动固定'}</div>}
      </div>
      {config?.credentialWarning && <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{config.credentialWarning}</div>}

      {/* 层级 2 - 注入预设专属卡片 */}
      {(() => {
        const effectiveActiveId = activeCreativePresetId || defaultPresetId(creativePresets);
        const activePreset = creativePresets.find(p => p.id === effectiveActiveId);
        const isCustomActive = Boolean(activeCreativePresetId && !activePreset?.isBuiltin);
        const customCount = creativePresets.filter(p => !p.isBuiltin).length;
        const builtinCount = creativePresets.length - customCount;
        return (
          <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4 shadow-sm dark:border-violet-900/60 dark:bg-violet-950/20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-meta font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">注入预设</span>
                  {activePreset && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100/80 px-2 py-0.5 text-micro font-bold text-violet-700 dark:bg-violet-950/70 dark:text-violet-300">
                      <Star className="h-2.5 w-2.5 fill-current" />
                      {activePreset.name}
                      {isCustomActive ? '（自定义）' : '（内置默认）'}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  当前生效预设：<b className="text-gray-800 dark:text-gray-100">{activePreset?.name || '（未配置预设）'}</b>
                  <span className="ml-1 text-gray-400">· 共 {creativePresets.length} 个预设（{builtinCount} 内置 · {customCount} 自定义）</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setView('creative_lab')}
                aria-label="进入注入预设管理"
                className="mobile-touch inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-violet-700 active:scale-98"
              >
                管理注入预设
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* 阶段二：层级 3 - 模型服务管理区 */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-2">
          <div>
            <b className="block text-sm text-gray-900 dark:text-white">已连接模型服务</b>
            <span className="block text-micro text-gray-400">电脑本地安全存储，管理已配置的服务商与自定义接口</span>
          </div>
          <div ref={connectMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setConnectMenuOpen(prev => !prev)}
              className="mobile-touch inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700"
            >
              <Plus className="h-3.5 w-3.5" />
              连接服务
            </button>
            {connectMenuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-xl ring-1 ring-black/5 dark:border-gray-700 dark:bg-gray-900">
                <button
                  type="button"
                  onClick={() => { setConnectMenuOpen(false); openView('login'); }}
                  className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  <LogIn className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  常用服务商登录
                </button>
                <button
                  type="button"
                  onClick={() => { setConnectMenuOpen(false); openCustom(); }}
                  className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                >
                  <Plus className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                  添加自定义接口
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {configured.map(provider => (
            <div
              key={provider.id}
              className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50/50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/40"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <b className="block truncate text-sm text-gray-800 dark:text-gray-100">{provider.name}</b>
                <span className="block truncate text-micro text-gray-400">
                  {provider.id} · {provider.authTypes.map(v => v === 'oauth' ? 'OAuth' : 'API Key').join(' / ')} · {provider.modelCount} 个可用模型
                </span>
              </div>
              <button
                type="button"
                onClick={() => startProviderLogin(provider)}
                className="mobile-touch rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                管理
              </button>
              <button
                type="button"
                onClick={() => void logout(provider)}
                className="mobile-touch rounded-lg border border-transparent px-2.5 py-1 text-xs font-bold text-gray-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-900/40 dark:hover:bg-red-950/30 dark:hover:text-red-400"
              >
                断开
              </button>
            </div>
          ))}

          {customProviders.map(provider => (
            <div
              key={provider.id}
              className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/30 px-3 py-2 dark:border-indigo-950/50 dark:bg-indigo-950/20"
            >
              <span className="h-2 w-2 rounded-full bg-indigo-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <b className="block truncate text-sm text-gray-800 dark:text-gray-100">{provider.name}</b>
                <span className="block truncate text-micro text-gray-400">
                  {provider.baseUrl} · {provider.models.length} 个模型 · 自定义接口
                </span>
              </div>
              <button
                type="button"
                onClick={() => openCustom(provider)}
                className="mobile-touch rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                编辑
              </button>
              <button
                type="button"
                onClick={() => void deleteCustom(provider)}
                className="mobile-touch rounded-lg border border-transparent px-2.5 py-1 text-xs font-bold text-gray-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-900/40 dark:hover:bg-red-950/30 dark:hover:text-red-400"
              >
                删除
              </button>
            </div>
          ))}

          {configured.length === 0 && customProviders.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 py-6 text-center text-xs text-gray-400 dark:border-gray-800">
              尚未连接任何模型服务。点击右上角「＋ 连接服务」开始配置。
            </div>
          )}
        </div>
      </div>
      <p className="text-meta leading-5 text-gray-500 dark:text-gray-400">这里选择的是新对话默认主模型；已有对话在对话顶部单独切换。视觉模型会按每个对话的主模型独立解析，可分析附件与历史原图。Agent 还可受限搜索公网并读取搜索结果，不能访问本机或局域网地址。密钥加密保存在电脑，不进入浏览器存储。</p>
    </div>
    )}

    {view !== 'home' && (
      <div
        ref={subViewRef}
        role="dialog"
        aria-modal="true"
        aria-label={view === 'login' ? '选择要配置的服务' : view === 'logout' ? '选择要退出的服务' : view === 'model' ? '选择 Agent 模型' : view === 'vision' ? '选择视觉模型' : view === 'auth' ? '选择登录方式' : view === 'custom' ? (customDraft.id ? '编辑自定义接口' : '添加自定义接口') : view === 'creative_lab' ? '注入预设管理' : '登录模型服务'}
        className="fixed inset-0 z-[1100] flex flex-col bg-gray-50 dark:bg-gray-950"
      >
      <header className="workspace-command-bar flex flex-none items-center gap-3 border-b border-gray-200 bg-white px-3 pt-[env(safe-area-inset-top)] dark:border-gray-800 dark:bg-gray-900 md:px-5">
        <button type="button" onClick={view === 'key' ? () => { setView('login'); setApiKey(''); } : requestClose} className="mobile-touch flex items-center justify-center rounded-xl p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" aria-label="返回"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1"><h2 className="font-black text-gray-900 dark:text-white">{view === 'login' ? '选择要配置的服务' : view === 'logout' ? '选择要退出的服务' : view === 'model' ? '选择 Agent 模型' : view === 'vision' ? '选择视觉模型' : view === 'auth' ? '选择登录方式' : view === 'custom' ? (customDraft.id ? '编辑自定义接口' : '添加自定义接口') : view === 'creative_lab' ? '注入提示词与预设管理' : `登录 ${targetProvider?.name || ''}`}</h2><p className="text-meta text-gray-500">{view === 'model' ? '主模型负责推理和调用工具' : view === 'vision' ? '只显示支持图片输入的已配置模型' : view === 'key' ? (loginAuthType === 'oauth' ? '按官方 OAuth 流程完成登录' : '使用 API Key 登录') : view === 'custom' ? '自定义模型服务配置' : view === 'auth' ? targetProvider?.name : view === 'creative_lab' ? '9 个注入槽位：预设编辑与激活管理' : '输入文字可立即筛选'}</p></div>
      </header>
      <main className={`mx-auto flex min-h-0 w-full flex-1 flex-col p-3 md:p-5 ${view === 'creative_lab' ? 'max-w-6xl' : 'max-w-3xl'}`}>
        {view !== 'key' && view !== 'auth' && view !== 'custom' && view !== 'creative_lab' && <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={view === 'model' || view === 'vision' ? '搜索模型名称、ID或供应商…' : '搜索模型服务…'} className="mobile-touch w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm outline-none focus:border-indigo-500 dark:border-gray-800 dark:bg-gray-900" />}
        {view === 'custom' ? <CustomProviderForm value={customDraft} onChange={setCustomDraft} busy={busy} onTest={() => void testCustom()} onFetch={() => void fetchCustom()} onSave={() => void saveCustom()} /> : view === 'creative_lab' ? <CreativeLabView presets={creativePresets} activeCreativePresetId={activeCreativePresetId} warnings={creativeWarnings} busy={busy} notify={notify} onStateChanged={next => { setCreativePresets(next.items || []); setActiveCreativePresetId(next.activeCreativePresetId); setCreativeWarnings(next.warnings || []); }} onDeletePreset={preset => void handleDeletePreset(preset)} /> : view === 'auth' ? <div className="mx-auto mt-10 w-full max-w-md space-y-3 rounded-3xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900"><p className="text-sm font-black dark:text-white">{targetProvider?.name}</p>{targetProvider?.authTypes.map(authType => <button key={authType} type="button" disabled={busy} onClick={() => void advanceLogin(targetProvider, [], authType)} className="mobile-touch w-full rounded-xl border border-gray-200 px-4 text-left text-sm font-bold hover:border-indigo-500 dark:border-gray-800">{authType === 'oauth' ? 'OAuth / 订阅账号登录' : 'API Key 登录'}</button>)}</div> : view === 'key' ? <div className="mx-auto mt-10 w-full max-w-md rounded-3xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900 md:p-6"><div className="text-sm font-black text-gray-900 dark:text-white">{targetProvider?.name}</div><p className="mt-1 text-xs leading-5 text-gray-500">{loginPrompt?.message || '正在准备登录…'}</p>{loginEvents.map((event, index) => <div key={index} className="mt-3 rounded-xl bg-indigo-50 p-3 text-xs leading-5 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">{event.message}{event.instructions && <div>{event.instructions}</div>}{event.url && <a href={event.url} target="_blank" rel="noreferrer" className="mt-1 block break-all font-bold underline">打开授权页面</a>}{event.verificationUri && <a href={event.verificationUri} target="_blank" rel="noreferrer" className="mt-1 block break-all font-bold underline">打开设备授权页面</a>}{event.userCode && <div className="mt-1 font-mono font-black">设备码：{event.userCode}</div>}{event.links?.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="mt-1 block break-all font-bold underline">{link.label || link.url}</a>)}</div>)}{loginPrompt?.type === 'select' ? <div className="mt-4 space-y-2">{loginPrompt.options.map(option => <button key={option.id} type="button" disabled={busy} onClick={() => submitLoginAnswer(option.id)} className="mobile-touch w-full rounded-xl border border-gray-200 px-3 text-left text-sm font-bold hover:border-indigo-500 dark:border-gray-800"><span className="block">{option.label}</span>{option.description && <span className="mt-0.5 block text-meta font-normal text-gray-500">{option.description}</span>}</button>)}</div> : <><div className="mt-4 flex gap-2"><input autoFocus type={loginPrompt?.type === 'secret' && !showKey ? 'password' : 'text'} value={apiKey} onChange={event => setApiKey(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submitLoginAnswer(); }} placeholder={loginPrompt?.placeholder || '请输入'} autoComplete="new-password" className="mobile-touch min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 font-mono text-sm dark:border-gray-800 dark:bg-gray-950" />{loginPrompt?.type === 'secret' && <button type="button" onClick={() => setShowKey(value => !value)} className="mobile-touch rounded-xl border border-gray-200 px-3 text-sm dark:border-gray-800">{showKey ? '隐藏' : '显示'}</button>}</div><button type="button" disabled={busy || !apiKey.trim()} onClick={() => submitLoginAnswer()} className="mobile-touch mt-4 w-full rounded-xl bg-indigo-600 text-sm font-bold text-white disabled:opacity-40">{busy ? '继续…' : '继续'}</button></>}<p className="mt-4 text-meta leading-5 text-gray-400">登录凭据只加密保存到运行本项目的电脑本地。</p></div> :
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {view === 'vision' && <button type="button" disabled={busy} onClick={() => void selectVisionAuto()} className="flex min-h-16 w-full items-center gap-3 border-b border-violet-100 bg-violet-50/60 px-4 text-left hover:bg-violet-100 disabled:opacity-40 dark:border-violet-900 dark:bg-violet-950/20 dark:hover:bg-violet-950/40"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${config?.visionMode === 'auto' ? 'bg-violet-600 text-white' : 'bg-white text-violet-500 dark:bg-gray-800'}`}>{config?.visionMode === 'auto' ? '✓' : '↻'}</span><span><b className="block text-sm text-gray-900 dark:text-white">自动匹配视觉模型</b><span className="block text-meta text-gray-500">主模型不能识图时，优先选择同一接口的多模态模型，再从其他已配置接口中选择</span></span></button>}
            {view === 'login' && <button type="button" onClick={() => openCustom()} className="flex min-h-14 w-full items-center gap-3 border-b border-indigo-100 bg-indigo-50/60 px-4 text-left hover:bg-indigo-100/70 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/50"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white"><Plus className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><b className="block truncate text-sm text-gray-900 dark:text-white">添加自定义接口</b><span className="block truncate text-meta text-gray-500">兼容 OpenAI / Anthropic 协议的中转站或本地大模型</span></span><span className="shrink-0 text-xs font-bold text-indigo-600 dark:text-indigo-300">配置 →</span></button>}
            {(view === 'model' || view === 'vision' ? filteredModels : filteredProviders).map(item => view === 'model' || view === 'vision' ? (() => { const model = item as PromptAgentModel; const selected = view === 'vision' ? model.currentVision : model.current; return <button key={`${model.provider}/${model.id}`} type="button" disabled={busy} onClick={() => void (view === 'vision' ? selectVisionModel(model) : selectModel(model))} className="flex min-h-16 w-full items-center gap-3 border-b border-gray-100 px-4 text-left last:border-0 hover:bg-indigo-50 dark:border-gray-800 dark:hover:bg-indigo-950/20"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${selected ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400 dark:bg-gray-800'}`}>{selected ? '✓' : '→'}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm text-gray-900 dark:text-white">{formatModelOptionTitle(model, models)}</b><span className="block truncate text-meta text-gray-500">[{model.providerName || model.provider}] {model.name}</span></span><span className="hidden shrink-0 text-right text-micro leading-4 text-gray-400 sm:block">上下文 {formatContext(model.contextWindow)}<br />{model.reasoning ? '推理' : '普通'}{model.imageInput ? ' · 识图' : ''}</span></button>; })() : (() => { const provider = item as PromptAgentProvider; return <button key={provider.id} type="button" disabled={busy} onClick={() => view === 'logout' ? void logout(provider) : startProviderLogin(provider)} className="flex min-h-16 w-full items-center gap-3 border-b border-gray-100 px-4 text-left last:border-0 hover:bg-indigo-50 dark:border-gray-800 dark:hover:bg-indigo-950/20"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${provider.configured ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} /><span className="min-w-0 flex-1"><b className="block truncate text-sm text-gray-900 dark:text-white">{provider.name}</b><span className="block truncate text-meta text-gray-500">{provider.id} · {provider.authTypes.map(value => value === 'oauth' ? 'OAuth' : 'API key').join(' / ')} · {provider.modelCount} 个模型</span></span><span className={`shrink-0 text-xs font-bold ${provider.configured ? 'text-emerald-600' : 'text-gray-400'}`}>{provider.configured ? '✓ 已配置' : '未配置'}</span></button>; })())}
            {(view === 'model' || view === 'vision' ? filteredModels : filteredProviders).length === 0 && <div className="p-10 text-center text-sm text-gray-500">{query ? '没有匹配结果' : view === 'vision' ? '没有支持识图的模型，请先配置模型服务' : view === 'model' ? '没有可用模型，请先登录模型服务' : '没有可用服务'}</div>}
          </div>}
      </main>
    </div>)}
  </>;
};
