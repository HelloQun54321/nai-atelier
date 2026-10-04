import React, { useState } from 'react';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { AGENT_THINKING_LEVELS, AGENT_THINKING_LABELS, createAgentThinkingMap } from '../services/agentThinking.mjs';
import { previewPromptAgentEndpoint, type PromptAgentCustomProvider, type PromptAgentProbeResult } from '../services/promptAgent';

const sourceName = (source?: string) => ({ manual: '人工', metadata: '接口声明', official_docs: '官方文档', pi_catalog: '模型目录', model_name: '名称推断', unknown: '未知', fallback: '兼容选项，接口未声明' } as Record<string, string>)[source || 'unknown'] || '未知';
const inputStyle = 'mobile-touch w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-400';
type ConnectionModel = PromptAgentCustomProvider['models'][number];
const emptyModel = (): ConnectionModel => ({ id: '', reasoning: false, imageInput: false, contextWindow: 128000, maxTokens: 16384, capabilityDetection: { imageInput: 'unknown', reasoning: 'unknown', tools: 'unknown' } });

export const AgentConnectionForm: React.FC<{
  value: PromptAgentCustomProvider; onChange: (value: PromptAgentCustomProvider) => void;
  busy: boolean; onTest: () => void; onFetch: () => void; onSave: () => void;
  result?: PromptAgentProbeResult | null; discovered?: ConnectionModel[];
}> = ({ value, onChange, busy, onTest, onFetch, onSave, result, discovered = [] }) => {
  const [search, setSearch] = useState(''), [showKey, setShowKey] = useState(false);
  const patchModel = (index: number, patch: Partial<ConnectionModel>) => onChange({ ...value, models: value.models.map((model, i) => i === index ? { ...model, ...patch } : model) });
  const updateId = (index: number, id: string) => {
    const current = value.models[index];
    const automaticThinking = ['metadata', 'pi_catalog', 'official_docs'].includes(current.thinkingLevelsSource || '');
    patchModel(index, { id, ...(automaticThinking ? { thinkingLevels: undefined, thinkingLevelMap: undefined, thinkingLevelsSource: undefined, thinkingMode: undefined } : {}),
      reasoning: current.capabilityDetection?.reasoning === 'manual' ? current.reasoning : false,
      imageInput: current.capabilityDetection?.imageInput === 'manual' ? current.imageInput : false,
      tools: current.capabilityDetection?.tools === 'manual' ? current.tools : undefined,
      capabilityDetection: { imageInput: current.capabilityDetection?.imageInput === 'manual' ? 'manual' : 'unknown', reasoning: current.capabilityDetection?.reasoning === 'manual' ? 'manual' : 'unknown', tools: current.capabilityDetection?.tools === 'manual' ? 'manual' : 'unknown' },
    });
  };
  const choose = (model: ConnectionModel) => {
    const selected = value.models.some(item => item.id.toLowerCase() === model.id.toLowerCase());
    onChange({ ...value, models: selected ? value.models.filter(item => item.id.toLowerCase() !== model.id.toLowerCase()) : [...value.models.filter(item => item.id), model] });
  };
  const ready = Boolean(value.baseUrl.trim() && value.models.some(model => model.id.trim()));
  const matched = discovered.filter(model => `${model.id} ${model.name || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="min-h-0 flex-1 overflow-y-auto py-3">
    <div className="agent-theme appearance-panel mx-auto max-w-xl rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 md:p-5">
      <fieldset disabled={busy} className="space-y-4">
        <label className="block text-sm text-gray-700 dark:text-gray-200">API 地址<input autoFocus value={value.baseUrl} onChange={event => onChange({ ...value, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" className={`mt-1 font-mono ${inputStyle}`} /></label>
        <label className="block text-sm text-gray-700 dark:text-gray-200">API Key<span className="mt-1 flex gap-2"><input value={value.apiKey || ''} type={showKey ? 'text' : 'password'} onChange={event => onChange({ ...value, apiKey: event.target.value })} placeholder={value.id ? '留空保留已保存的 Key' : '填写 Key，本机无鉴权服务可留空'} autoComplete="new-password" className={`min-w-0 flex-1 font-mono ${inputStyle}`} /><button type="button" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey(!showKey)} className="mobile-touch shrink-0 rounded-xl px-3 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>
        <button type="button" disabled={busy || !value.baseUrl.trim()} onClick={onFetch} className="mobile-touch w-full rounded-xl border border-indigo-300 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40">{busy ? '正在连接…' : '获取模型'}</button>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2"><span className="text-sm text-gray-700 dark:text-gray-200">模型{value.models.filter(model => model.id).length ? ` · 已选 ${value.models.filter(model => model.id).length}` : ''}</span><button type="button" disabled={value.models.length >= 50} onClick={() => onChange({ ...value, models: [...value.models, emptyModel()] })} className="mobile-touch inline-flex items-center gap-1 rounded-lg px-2 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"><Plus className="h-3.5 w-3.5" />手动添加</button></div>
          {!!discovered.length && <div className="rounded-xl border border-gray-200 dark:border-gray-700">
            <input aria-label="搜索发现的模型" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索模型" className={`border-0 ${inputStyle}`} />
            <div className="max-h-48 overflow-y-auto border-t border-gray-200 dark:border-gray-700">{matched.slice(0, 100).map(model => {
              const selected = value.models.some(item => item.id.toLowerCase() === model.id.toLowerCase());
              return <label key={model.id} className="mobile-touch flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"><input type="checkbox" checked={selected} disabled={!selected && value.models.length >= 50} onChange={() => choose(model)} aria-label={`选择模型 ${model.id}`} /><span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-100">{model.id}</span><span className="shrink-0 text-micro text-gray-500 dark:text-gray-400">{model.imageInput ? '图片' : model.capabilityDetection?.imageInput === 'unknown' ? '图片未知' : '文本'}{model.reasoning ? ' · 推理' : ''}</span></label>;
            })}{matched.length > 100 && <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">还有 {matched.length - 100} 个模型，请搜索筛选。</p>}{!matched.length && <p className="p-3 text-xs text-gray-500 dark:text-gray-400">没有匹配模型</p>}</div>
          </div>}
          {value.models.map((model, index) => <div key={index} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <div className="flex items-center gap-2"><input value={model.id} onChange={event => updateId(index, event.target.value)} placeholder="手动输入模型 ID" aria-label={`模型 ID ${index + 1}`} className={`min-w-0 flex-1 font-mono ${inputStyle}`} /><button type="button" onClick={() => onChange({ ...value, models: value.models.filter((_, i) => i !== index) })} aria-label={`移除模型 ${model.id || index + 1}`} className="mobile-touch rounded-lg px-2 text-gray-400 hover:text-rose-600 dark:text-gray-500 dark:hover:text-rose-400"><Trash2 className="h-4 w-4" /></button></div>
            <details className="mt-2 text-xs text-gray-500 dark:text-gray-400"><summary className="mobile-touch cursor-pointer">模型能力 · {model.imageInput ? '图片输入' : model.capabilityDetection?.imageInput === 'unknown' ? '图片未知' : '纯文本'}{model.reasoning ? ' · 推理' : ''}</summary><div className="space-y-3 pt-2">
              <input value={model.name || ''} onChange={event => patchModel(index, { name: event.target.value })} placeholder="显示名称（可选）" className={inputStyle} />
              <div className="grid grid-cols-2 gap-2"><label title={sourceName(model.contextWindowSource)}>上下文长度<input type="number" min="1024" value={model.contextWindow} onChange={event => patchModel(index, { contextWindow: Number(event.target.value), contextWindowSource: 'manual' })} className={`mt-1 ${inputStyle}`} /></label><label title={sourceName(model.maxTokensSource)}>最大输出<input type="number" min="256" value={model.maxTokens} onChange={event => patchModel(index, { maxTokens: Number(event.target.value), maxTokensSource: 'manual' })} className={`mt-1 ${inputStyle}`} /></label></div>

              <div className="grid grid-cols-2 gap-2">{(['imageInput', 'reasoning'] as const).map(capability => <label key={capability} title={sourceName(model.capabilityDetection?.[capability])}>{capability === 'imageInput' ? '图片输入' : '推理'}<select aria-label={`${capability === 'imageInput' ? '图片输入能力' : '推理能力'} ${model.id || index + 1}`} value={model.capabilityDetection?.[capability] === 'unknown' ? 'unknown' : model[capability] ? 'yes' : 'no'} onChange={event => patchModel(index, { [capability]: event.target.value === 'yes', capabilityDetection: { imageInput: model.capabilityDetection?.imageInput || 'unknown', reasoning: model.capabilityDetection?.reasoning || 'unknown', tools: model.capabilityDetection?.tools, [capability]: event.target.value === 'unknown' ? 'unknown' : 'manual' } })} className={`mt-1 ${inputStyle}`}><option value="unknown">未知／自动识别</option><option value="yes">支持</option><option value="no">不支持</option></select></label>)}</div>
              {model.reasoning && <fieldset className="rounded-xl bg-gray-50 p-3 dark:bg-gray-950"><legend className="px-1" title={sourceName(model.thinkingLevelsSource)}>支持的思考档位</legend><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{AGENT_THINKING_LEVELS.map(level => {
                const levels = model.thinkingLevels || ['off', 'minimal', 'low', 'medium', 'high'];
                return <label key={level} className="flex min-h-8 items-center gap-2"><input type="checkbox" aria-label={`支持思考档位：${AGENT_THINKING_LABELS[level]} (${model.id || index + 1})`} checked={levels.includes(level)} onChange={event => { const next = AGENT_THINKING_LEVELS.filter(item => item === level ? event.target.checked : levels.includes(item)); const mapping = { ...model.thinkingLevelMap }; if (mapping[level] === null && event.target.checked) delete mapping[level]; patchModel(index, { thinkingLevels: next, thinkingLevelMap: createAgentThinkingMap(next, mapping), thinkingLevelsSource: 'manual' }); }} />{AGENT_THINKING_LABELS[level]}</label>;
              })}</div>{model.thinkingLevels?.length === 0 && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">至少选择一个思考档位</p>}</fieldset>}
              <p className="text-micro" title={sourceName(model.capabilityDetection?.tools)}>工具：{model.tools === undefined ? '未知' : model.tools ? '支持' : '不支持'}</p>
              {model.capabilityDetection?.imageInput === 'unknown' && <p className="text-micro">图片能力未知，请手动确认。</p>}
            </div></details>
          </div>)}
        </div>
        <details className="text-xs text-gray-500 dark:text-gray-400"><summary className="mobile-touch cursor-pointer">高级设置</summary><div className="space-y-3 pt-2">
          <label className="block">连接名称<input value={value.name} onChange={event => onChange({ ...value, name: event.target.value })} placeholder="可选，默认使用域名" className={`mt-1 ${inputStyle}`} /></label>
          <label className="block">接口协议<select value={value.api} onChange={event => onChange({ ...value, api: event.target.value as PromptAgentCustomProvider['api'] })} className={`mt-1 ${inputStyle}`}><option value="openai-completions">OpenAI Chat（默认）</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
          <p className="break-all">请求地址：{previewPromptAgentEndpoint(value.baseUrl, value.api) || '填写地址后预览'}</p>
          <div className="flex items-center justify-between"><span>附加请求头</span><button type="button" onClick={() => onChange({ ...value, headers: { ...value.headers, [`X-Custom-${Object.keys(value.headers || {}).length + 1}`]: '' } })} className="mobile-touch rounded-lg px-2">＋ 添加</button></div>
          {Object.entries(value.headers || {}).map(([name, headerValue], index) => <div key={index} className="flex gap-2"><input aria-label={`请求头名称 ${index + 1}`} value={name} onChange={event => onChange({ ...value, headers: Object.fromEntries(Object.entries(value.headers || {}).map((entry, i) => i === index ? [event.target.value, headerValue] : entry)) })} className={`min-w-0 flex-1 ${inputStyle}`} /><input aria-label={`请求头值 ${index + 1}`} value={headerValue} onChange={event => onChange({ ...value, headers: { ...value.headers, [name]: event.target.value } })} className={`min-w-0 flex-1 ${inputStyle}`} /><button type="button" aria-label={`删除请求头 ${name}`} onClick={() => onChange({ ...value, headers: Object.fromEntries(Object.entries(value.headers || {}).filter(([key]) => key !== name)) })} className="mobile-touch px-2"><Trash2 className="h-4 w-4" /></button></div>)}
          <label className="flex items-center gap-2"><input type="checkbox" checked={value.select === true} onChange={event => onChange({ ...value, select: event.target.checked })} />保存后设为默认</label>
          <div className="border-t border-gray-200 pt-3 dark:border-gray-700"><label className="block">测试模型<select value={value.testModel || value.models[0]?.id || ''} onChange={event => onChange({ ...value, testModel: event.target.value })} className={`mt-1 ${inputStyle}`}>{value.models.filter(model => model.id).map(model => <option key={model.id} value={model.id}>{model.id}</option>)}</select></label><label className="my-2 flex items-center gap-2"><input type="checkbox" checked={value.testImage === true} onChange={event => onChange({ ...value, testImage: event.target.checked })} />测试图片输入</label><button type="button" disabled={!ready} onClick={onTest} className="mobile-touch w-full rounded-xl border border-gray-300 dark:border-gray-700">测试模型 · 可能收费</button></div>
        </div></details>
        {result && <div role="status" className={`rounded-xl p-3 text-xs ${result.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>{result.message}<div className="mt-1">{Object.entries(result.checks || {}).map(([key, state]) => <span key={key} className="mr-2">{({ text: '文本', tools: '工具', image: '图片', network: '网络', auth: '鉴权', protocol: '协议' } as Record<string, string>)[key]}：{({ passed: '通过', failed: '未通过', not_tested: '未测', accepted: '请求已接受' } as Record<string, string>)[state] || state}</span>)}</div>{result.usage?.length ? <div className="mt-1">本次测试 {result.model} · {result.usage.reduce((sum, usage) => sum + usage.totalTokens, 0).toLocaleString()} tokens</div> : null}</div>}
        <button type="button" disabled={!ready || busy || value.models.some(model => model.reasoning && model.thinkingLevels?.length === 0)} onClick={onSave} className="mobile-touch w-full rounded-xl bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">保存连接</button>
        <p className="text-micro text-gray-500 dark:text-gray-400">Key 加密保存在本机</p>
      </fieldset>
    </div>
  </div>;
};
