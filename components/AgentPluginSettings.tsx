import React, { useEffect, useRef, useState } from 'react';
import { useConfirmDialog } from './ConfirmDialog';
import { parseErrorResponse } from '../services/api';

interface Plugin {
  id: string; name: string; version: string; description: string; enabled: boolean;
  state: string; error: string; unsupported: string[]; tools: string[]; log: string;
  config: Record<string, unknown>; source: { url?: string; commit?: string; name?: string };
  promptBlocks?: Array<{ id: string; title: string; chars: number; sha256: string }>;
  declaredPromptBlocks?: Array<{ id: string; title: string; text: string }>;
}
interface PromptPreview { active: boolean; kind: string; blocks: Array<{ id: string; title: string; text: string; chars: number; sha256: string }> }
const labels: Record<string, string> = { installed: '已安装 · 未启用', running: '运行中', starting: '启动中', error: '启动失败', unsupported: '需要适配 DSH 接口' };
const endpoint = '/api/prompt-agent/plugins';
async function request(path = '', init?: RequestInit) {
  const response = await fetch(endpoint + path, { ...init, credentials: 'same-origin' });
  if (!response.ok) throw await parseErrorResponse(response);
  return response.json();
}

export const AgentPluginSettings: React.FC<{ notify: (message: string, type?: 'success' | 'error') => void }> = ({ notify }) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Plugin[]>([]);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, PromptPreview>>({});
  const file = useRef<HTMLInputElement>(null);
  const confirm = useConfirmDialog();
  const reload = async () => {
    const data = await request(); setItems(data.items); setPreviews({});
    setDrafts(current => Object.fromEntries(data.items.map((item: Plugin) => [item.id, current[item.id] ?? JSON.stringify(item.config || {}, null, 2)])));
  };
  useEffect(() => { if (open) void reload().catch(reason => setError(reason.message)); }, [open]);
  const action = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true); setError('');
    try { await work(); await reload(); notify(message, 'success'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '插件操作失败'); await reload().catch(() => {}); }
    finally { setBusy(false); }
  };
  const toggle = (item: Plugin) => action(async () => {
    const config = JSON.parse(drafts[item.id] || '{}');
    await request(`/${item.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !item.enabled, config }) });
  }, item.enabled ? '插件已停用' : '插件已启用；新助手任务会加载它的工具');

  return <section aria-label="助手插件" className="appearance-group rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
    <div className="flex items-center justify-between gap-3">
      <div><b className="block text-sm text-gray-900 dark:text-white">助手插件 · DeepSeek</b><p className="mt-1 text-xs text-gray-500">安装 GitHub / ZIP 插件，查看运行状态与兼容情况。</p></div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mobile-touch shrink-0 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white">{open ? '收起插件管理' : '管理插件'}</button>
    </div>
    {open && <div className="mt-4 space-y-4">
      <p className="text-xs leading-5 text-gray-500">插件可提供工具或静态提示词片段；只在下一次完全访问权限的助手任务中使用，开关不改变正在运行的任务。安装不会自动运行；启用会在本机执行插件代码。依赖 DSH 专属服务、界面或配置补丁的原始插件仍需适配。</p>
      <form onSubmit={event => { event.preventDefault(); void action(() => request('/install', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url}) }), '插件已安装，请查看兼容情况后启用'); }} className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-xs text-gray-600 dark:text-gray-300">GitHub 插件地址
          <input aria-label="GitHub 插件地址" type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://github.com/作者/插件" className="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 dark:border-gray-700" />
        </label>
        <button disabled={busy} className="mobile-touch rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? '处理中…' : '从地址安装'}</button>
        <button disabled={busy} type="button" onClick={() => file.current?.click()} className="mobile-touch rounded-lg border border-gray-300 px-3 py-2 text-xs dark:border-gray-700">导入 ZIP</button>
        <input ref={file} type="file" accept=".zip,application/zip" aria-label="插件 ZIP 文件" className="hidden" onChange={event => {
          const selected = event.target.files?.[0]; event.target.value = '';
          if (selected) void action(() => request('/install?name=' + encodeURIComponent(selected.name), {method:'POST', headers:{'Content-Type':'application/zip'}, body:selected}), '插件已安装，请查看兼容情况后启用');
        }} />
      </form>
      {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-red-600 dark:text-red-300">{error}</p>}
      {items.length === 0 && <p className="text-xs text-gray-500">尚未安装插件。</p>}
      {items.map(item => <article key={item.id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><b className="break-all text-sm">{item.name}</b><span className="ml-2 text-xs text-gray-500">{item.version}</span></div><span role="status" className="text-xs text-indigo-500">{labels[item.state] || item.state}</span></div>
        <p className="mt-1 break-words text-xs text-gray-500">{item.description}</p>
        {item.source.url && <p className="mt-2 break-all text-xs text-gray-500">{item.source.url} {item.source.commit?.slice(0, 8)}</p>}
        {item.source.name && <p className="mt-2 break-all text-xs text-gray-500">安装来源：{item.source.name}</p>}
        {item.unsupported.length > 0 && <ul className="mt-2 list-inside list-disc text-xs text-amber-700 dark:text-amber-300">{item.unsupported.map(missing => <li key={missing}>{missing}</li>)}</ul>}
        {item.error && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-red-600 dark:text-red-300">{item.error}</p>}
        {item.tools.length > 0 && <p className="mt-2 break-words text-xs text-gray-500">可用工具：{item.tools.join('、')}</p>}
        <p className="mt-2 text-xs text-gray-500">提示词片段：{item.promptBlocks?.length || 0} 段运行中{!item.enabled && item.declaredPromptBlocks?.length ? `；安装包声明 ${item.declaredPromptBlocks.length} 段，尚未运行核验` : ''}</p>
        <button disabled={busy} type="button" onClick={async () => {
          try { const preview = await request(`/${item.id}/preview`); setPreviews(current => ({ ...current, [item.id]: preview })); }
          catch (reason) { setError(reason instanceof Error ? reason.message : '预览失败'); }
        }} className="mobile-touch mt-2 rounded-lg border border-gray-300 px-3 py-2 text-xs dark:border-gray-700">查看提示词片段</button>
        {previews[item.id] && <div className="mt-2 space-y-2">
          <p className="text-xs text-gray-500">{previews[item.id].active ? '运行时注册原文；下一次完全访问任务使用。' : '仅预览安装包声明，未启动代码；启用后以运行时注册原文为准。'}</p>
          {!previews[item.id].blocks.length && <p className="text-xs text-gray-500">当前没有可预览的静态片段。</p>}
          {previews[item.id].blocks.map(block => <details key={block.id}><summary className="cursor-pointer break-all text-xs">{block.title} · {block.chars} 字符</summary><p className="my-1 break-all font-mono text-micro text-gray-500">SHA256：{block.sha256}</p><pre className="appearance-surface max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-100 p-2 text-xs dark:bg-gray-950">{block.text}</pre></details>)}
        </div>}
        <details className="mt-2"><summary className="cursor-pointer text-xs text-gray-500">插件配置与日志</summary>
          <label className="mt-2 block text-xs">配置 JSON<textarea aria-label={`${item.name} 配置 JSON`} disabled={item.enabled || busy} value={drafts[item.id] || '{}'} onChange={event => setDrafts({...drafts,[item.id]:event.target.value})} rows={4} className="mt-1 w-full rounded-lg border border-gray-200 bg-transparent p-2 font-mono text-xs dark:border-gray-700" /></label>
          <p className="mt-1 text-xs text-gray-500">启用时保存配置；已运行的插件先停用再修改。</p>
          {item.log && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{item.log}</pre>}
        </details>
        <div className="mt-3 flex gap-2">
          <button disabled={busy || item.unsupported.length > 0} type="button" onClick={() => void toggle(item)} className="mobile-touch rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white disabled:opacity-40">{item.enabled ? '停用' : '启用本地代码'}</button>
          <button disabled={busy || item.enabled} type="button" onClick={async () => { if (await confirm({ title:`移除 ${item.name}？`, message:'只移除该插件的安装文件和配置，保留工坊作品与个人资料。', confirmLabel:'移除插件', tone:'danger' })) void action(() => request(`/${item.id}`, {method:'DELETE'}), '插件已移除'); }} className="mobile-touch rounded-lg border border-gray-300 px-3 py-2 text-xs disabled:opacity-40 dark:border-gray-700">移除</button>
        </div>
      </article>)}
    </div>}
  </section>;
};
