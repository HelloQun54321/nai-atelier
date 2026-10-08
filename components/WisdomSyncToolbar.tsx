import { t, useLanguage, getLanguage } from '../services/i18n';
import { ArrowLeft, CheckCheck, Clock3, ListFilter } from 'lucide-react';
import { IconButton, ToolbarButton } from './DesignSystem';
import type { WisdomSyncSelection, WisdomSyncView } from '../services/stChatu8Sync';

export function WisdomSyncToolbar({ sync, filteredIds }: { sync: WisdomSyncSelection; filteredIds: string[] }) {
  useLanguage();
  const tabs: { view: WisdomSyncView; label: string; count?: number; icon: typeof ListFilter }[] = [
    { view: 'pick', label: '挑选风格串', icon: ListFilter }, { view: 'pending', label: '待同步', count: sync.pending.length, icon: Clock3 }, { view: 'records', label: '同步记录', count: sync.records.length, icon: CheckCheck },
  ];
  const verified = sync.lastSnapshotAt ? new Date(sync.lastSnapshotAt).toLocaleString(getLanguage(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const canSelectFiltered = filteredIds.some(id => sync.available.has(id) && !sync.selected.has(id));
  const canClearFiltered = filteredIds.some(id => sync.selected.has(id));
  return <div className="flex-none border-b border-gray-200 bg-white/80 px-3 py-1.5 dark:border-gray-800 dark:bg-gray-900/80 md:px-5">
    {/* 桌面按内容连续排布；窄屏才换行，不用占位将操作推到两端。 */}
    <div role="toolbar" aria-label={t("智慧姬同步操作")} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto">
        <IconButton label={t("返回资料库")} title={t("返回资料库，取消尚未加入的勾选")} onClick={sync.cancel} className="mobile-touch !h-8 !w-8 !rounded-lg"><ArrowLeft className="h-4 w-4" /></IconButton>
        <div role="tablist" aria-label={t("智慧姬同步视图")} className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800/80 sm:flex-none">
          {tabs.map(tab => <button key={tab.view} type="button" role="tab" aria-label={`${t(tab.label)}${tab.count !== undefined ? ` ${tab.count}` : ''}`} aria-selected={sync.view === tab.view} onClick={() => sync.setView(tab.view)} className={`mobile-touch flex min-h-8 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 sm:flex-none sm:px-3 ${sync.view === tab.view ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}`}>
            <tab.icon className="hidden h-3.5 w-3.5 shrink-0 sm:block" />
            {tab.view === 'pick' ? <><span className="sm:hidden">{t("挑选")}</span><span className="hidden sm:inline">{t(tab.label)}</span></> : <span>{t(tab.label)}</span>}
            {tab.count !== undefined && <span className="text-micro tabular-nums opacity-70">{tab.count}</span>}
          </button>)}
        </div>
      </div>
      <div role="group" aria-label={t("当前同步视图操作")} className="flex w-full min-w-0 flex-wrap items-center gap-1.5 text-xs sm:w-auto sm:border-l sm:border-gray-200 sm:pl-3 dark:sm:border-gray-700">
        {sync.view === 'pick' ? <>
          <span title={t("仅支持 V4.5 / V5；包含其他筛选下的勾选")} className="mr-1 whitespace-nowrap text-gray-500 dark:text-gray-400">{t("已选 ")}<b className="text-indigo-600 tabular-nums dark:text-indigo-300">{sync.selected.size}</b> {t(" 条")}</span>
          <ToolbarButton aria-label={t("全选筛选结果")} disabled={sync.busy || !canSelectFiltered} onClick={() => sync.setFiltered(filteredIds, true)} className="mobile-touch !h-8 !rounded-lg !px-2 !text-xs sm:!px-2.5"><span className="sm:hidden">{t("全选")}</span><span className="hidden sm:inline">{t("全选筛选结果")}</span></ToolbarButton>
          <ToolbarButton aria-label={t("取消筛选结果")} disabled={sync.busy || !canClearFiltered} onClick={() => sync.setFiltered(filteredIds, false)} className="mobile-touch !h-8 !rounded-lg !px-2 !text-xs sm:!px-2.5"><span className="sm:hidden">{t("取消")}</span><span className="hidden sm:inline">{t("取消筛选结果")}</span></ToolbarButton>
          <ToolbarButton tone="primary" disabled={sync.busy || !sync.selected.size} onClick={() => void sync.save()} className="mobile-touch !h-8 !rounded-lg !px-3 !text-xs">{t("加入待同步")}</ToolbarButton>
        </> : sync.view === 'pending' ? <>
          {sync.pending.length > 0 && <ToolbarButton disabled={sync.busy} onClick={() => void sync.actOnEntries('remove', sync.pending.map(entry => entry.chainId))} className="mobile-touch !h-8 !rounded-lg !px-2.5 !text-xs">{t("全部移出待同步")}</ToolbarButton>}
          <span className="text-gray-500 dark:text-gray-400" title={t("正文与封面保存成功后自动进入同步记录")}>{t("在智慧姬点击「立即同步」接收")}</span>
        </> : <>
          <label className="flex items-center gap-2 whitespace-nowrap text-gray-500 dark:text-gray-400">{t("记录状态")}<select aria-label={t("记录状态")} value={sync.recordFilter} onChange={event => sync.setRecordFilter(event.target.value as typeof sync.recordFilter)} className="mobile-touch h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"><option value="all">{t("全部记录")}</option><option value="synced">{t("已同步")}</option><option value="removed">{t("智慧姬中已移除")}</option></select></label>
          <span className="ml-1 text-gray-400">{verified ? t("最近完整核对 {0}", [verified]) : t("等待连接器首次完整核对")}</span>
        </>}
      </div>
    </div>
    {sync.error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{t("{0} · 暂时保留上次同步记录。", [t(sync.error)])}</p>}
  </div>;
}
