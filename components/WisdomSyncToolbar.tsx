import { ArrowLeft, CheckCheck, Clock3, ListFilter, RefreshCw } from 'lucide-react';
import { IconButton, ToolbarButton } from './DesignSystem';
import type { WisdomSyncSelection, WisdomSyncView } from '../services/stChatu8Sync';

export function WisdomSyncToolbar({ sync, filteredIds }: { sync: WisdomSyncSelection; filteredIds: string[] }) {
  const tabs: { view: WisdomSyncView; label: string; count?: number; icon: typeof ListFilter }[] = [
    { view: 'pick', label: '挑选风格串', icon: ListFilter }, { view: 'pending', label: '待同步', count: sync.pending.length, icon: Clock3 }, { view: 'records', label: '同步记录', count: sync.records.length, icon: CheckCheck },
  ];
  const verified = sync.lastSnapshotAt ? new Date(sync.lastSnapshotAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return <div className="flex-none border-b border-gray-200 bg-white/80 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900/80 md:px-5">
    <div className="flex items-center gap-2">
      <div role="tablist" aria-label="智慧姬同步视图" className="flex min-w-0 flex-1 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800/80 sm:flex-none">
        {tabs.map(tab => <button key={tab.view} role="tab" aria-selected={sync.view === tab.view} onClick={() => sync.setView(tab.view)} className={`mobile-touch flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors sm:px-3 ${sync.view === tab.view ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}`}><tab.icon className="hidden h-3.5 w-3.5 sm:block" /><span className="whitespace-nowrap">{tab.label}</span>{tab.count !== undefined && <span className="text-micro opacity-70">{tab.count}</span>}</button>)}
      </div>
      <span className="flex-1 max-sm:hidden" />
      <IconButton label="核对同步列表" title="刷新本机记录；对方删除会在连接器下一次成功同步时核对" disabled={sync.busy} onClick={() => void sync.load()}><RefreshCw className={`h-4 w-4 ${sync.busy ? 'animate-spin' : ''}`} /></IconButton>
      <IconButton label="返回资料库" title="返回资料库，取消尚未加入的勾选" onClick={sync.cancel}><ArrowLeft className="h-4 w-4" /></IconButton>
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      {sync.view === 'pick' ? <>
        <p className="text-xs text-gray-500 dark:text-gray-400">已选 <b className="text-indigo-600 dark:text-indigo-300">{sync.selected.size}</b> 条 · V4.5 / V5</p>
        <div className="flex flex-wrap gap-1.5">
          <ToolbarButton disabled={sync.busy || !filteredIds.some(id => sync.available.has(id))} onClick={() => sync.setFiltered(filteredIds, true)} className="!h-8 !px-2.5 !text-xs">全选筛选结果</ToolbarButton>
          <ToolbarButton disabled={sync.busy || !sync.selected.size} onClick={() => sync.setFiltered(filteredIds, false)} className="!h-8 !px-2.5 !text-xs">取消筛选结果</ToolbarButton>
          <ToolbarButton tone="primary" disabled={sync.busy || !sync.selected.size} onClick={() => void sync.save()} className="!h-8 !px-3 !text-xs">加入待同步</ToolbarButton>
        </div>
      </> : sync.view === 'pending' ? <>
        <p className="text-xs text-gray-500 dark:text-gray-400">在智慧姬点击「立即同步」接收；成功后自动进入同步记录。</p>
        {sync.pending.length > 0 && <ToolbarButton disabled={sync.busy} onClick={() => void sync.actOnEntries('remove', sync.pending.map(entry => entry.chainId))} className="!h-8 !px-2.5 !text-xs">全部移出待同步</ToolbarButton>}
      </> : <>
        <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">记录状态<select aria-label="记录状态" value={sync.recordFilter} onChange={event => sync.setRecordFilter(event.target.value as typeof sync.recordFilter)} className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"><option value="all">全部记录</option><option value="synced">已同步</option><option value="removed">智慧姬中已移除</option></select></label>
        <span className="text-xs text-gray-400">{verified ? `最近完整核对 ${verified}` : '等待连接器首次完整核对'}</span>
      </>}
    </div>
    {sync.error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{sync.error} · 保留上次记录，可手动刷新。</p>}
  </div>;
}
