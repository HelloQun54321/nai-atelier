import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { promptAgentService, type AgentPermissionMode } from '../services/promptAgent';

export const AgentPermissionSelect: React.FC<{ disabled?: boolean }> = ({ disabled }) => {
  const [mode, setMode] = useState<AgentPermissionMode>('standard'); const [busy, setBusy] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    const load = () => { void promptAgentService.getConfig().then(config => { if (!disposed) setMode(config.permissionMode || 'standard'); }).catch(() => { if (!disposed) setError('权限设置暂不可用'); }).finally(() => { if (!disposed) setBusy(false); }); };
    load(); window.addEventListener('nai-agent-permissions-changed', load);
    return () => { disposed = true; window.removeEventListener('nai-agent-permissions-changed', load); };
  }, []);
  const change = async (next: AgentPermissionMode) => {
    setBusy(true); setError('');
    try { const config = await promptAgentService.setPermissionMode(next); setMode(config.permissionMode || next); window.dispatchEvent(new Event('nai-agent-permissions-changed')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '权限修改失败'); }
    finally { setBusy(false); }
  };
  return <div className="min-w-0">
    <label title="只读：浏览与查看；标准：项目正常操作，首次写电脑目录时确认；完全访问：自动读写。生图费用与删除仍单独确认。" className="inline-flex min-h-9 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
      <ShieldCheck className="h-3.5 w-3.5" /><span>权限</span>
      <select aria-label="Agent 权限" value={mode} disabled={disabled || busy} onChange={event => void change(event.target.value as AgentPermissionMode)} className="max-w-28 cursor-pointer bg-transparent py-1 text-xs font-medium text-gray-700 outline-none disabled:cursor-wait disabled:opacity-50 dark:text-gray-200 dark:[color-scheme:dark]">
        <option value="read_only">只读</option><option value="standard">标准</option><option value="full">完全访问</option>
      </select>
    </label>{error && <p role="alert" className="max-w-64 break-words text-xs text-red-600 dark:text-red-400">{error}</p>}
  </div>;
};
