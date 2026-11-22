import React, { useMemo, useState } from 'react';
import { Check, FolderOpen, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { getLanguage, t, useLanguage } from '../../services/i18n';
import type { RollExperimentSummary } from '../../services/styleRoll';

/** 记录列表的呈现：主行名称，副行轮次／候选数与最近时间，当前记录高亮。 */
export interface RollRecordNavigationProps {
  records: RollExperimentSummary[];
  selectedId: string;
  busy?: boolean;
  loading?: boolean;
  /** 手机面板内：触控行更高，操作按钮常显。 */
  mobile?: boolean;
  className?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onReload: () => void;
  onRename: (id: string, name: string) => void;
  /** 删除记录与候选一致：二次确认后彻底移除，不保留回收站。 */
  onDelete: (id: string) => void;
  /** 旧版本回收站里标记删除的记录只留一次性清理出口。 */
  onPurgeArchived: () => void;
}

/** 相对时间跟着界面语言走；超过一周直接给日期，避免「37 天前」这类无用精度。 */
export const rollRecordTimeLabel = (value: number, language = getLanguage(), now = Date.now()) => {
  const diff = Math.max(0, now - value), minute = 60_000, hour = 60 * minute, day = 24 * hour;
  try {
    const relative = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    if (diff < minute) return relative.format(0, 'second');
    if (diff < hour) return relative.format(-Math.floor(diff / minute), 'minute');
    if (diff < day) return relative.format(-Math.floor(diff / hour), 'hour');
    if (diff < day * 7) return relative.format(-Math.floor(diff / day), 'day');
    return new Intl.DateTimeFormat(language, { month: '2-digit', day: '2-digit' }).format(value);
  } catch { return ''; }
};

export const RollRecordNavigation: React.FC<RollRecordNavigationProps> = ({ records, selectedId, busy = false, loading = false, mobile = false, className = '', onSelect, onCreate, onReload, onRename, onDelete, onPurgeArchived }) => {
  useLanguage();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'created'>('recent');
  const [renamingId, setRenamingId] = useState('');
  const [draft, setDraft] = useState('');
  const active = useMemo(() => records.filter(item => !item.archived), [records]);
  const archived = useMemo(() => records.filter(item => item.archived), [records]);
  const listed = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return active
      .filter(item => !keyword || item.name.toLowerCase().includes(keyword))
      .sort((a, b) => sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
  }, [active, query, sort]);
  const startRename = (item: RollExperimentSummary) => { setRenamingId(item.id); setDraft(item.name); };
  const submitRename = (event: React.FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (renamingId && name) onRename(renamingId, name);
    setRenamingId('');
  };
  const rowMeta = (item: RollExperimentSummary) => t('{0} 轮 · {1} 个候选 · {2}', [item.rounds, item.candidates, rollRecordTimeLabel(sort === 'created' ? item.createdAt : item.updatedAt)]);
  const actionClass = 'mobile-touch flex h-7 w-7 flex-none items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white hover:text-gray-700 disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-200 [&>svg]:h-3.5 [&>svg]:w-3.5';
  return <aside aria-label={t('画风记录列表')} className={className}>
    <header className="mb-2 flex flex-none items-center gap-1.5 px-0.5">
      <FolderOpen className="h-4 w-4 flex-none text-gray-400" />
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('画风记录')}</span>
      <span aria-hidden="true" className="text-micro tabular-nums text-gray-400">{active.length}</span>
      <div className="ml-auto flex items-center gap-0.5">
        <button type="button" className={actionClass} aria-label={t('重新加载画风记录')} title={t('重新加载画风记录')} disabled={busy || loading} onClick={onReload}><RefreshCw className={loading ? 'animate-spin' : undefined} /></button>
        <button type="button" className={actionClass} aria-label={t('新建记录')} title={t('新建记录')} disabled={busy} onClick={onCreate}><Plus /></button>
      </div>
    </header>
    {active.length >= 8 && <input aria-label={t('搜索画风记录')} placeholder={t('搜索画风记录')} value={query} onChange={event => setQuery(event.target.value)}
      className="mobile-touch mb-2 h-8 w-full flex-none rounded-lg border border-gray-200 bg-white px-2 text-xs font-normal text-gray-800 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />}
    {active.length >= 3 && <select aria-label={t('记录排序')} value={sort} onChange={event => setSort(event.target.value === 'created' ? 'created' : 'recent')}
      className="mobile-touch mb-2 h-8 w-full flex-none rounded-lg border border-gray-200 bg-white px-1.5 text-xs font-normal text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200">
      <option value="recent">{t('最近更新')}</option>
      <option value="created">{t('创建时间')}</option>
    </select>}
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div role="list" aria-label={t('画风记录列表')} className="space-y-0.5">
        {listed.map(item => {
          const current = item.id === selectedId;
          if (item.id === renamingId) return <form key={item.id} onSubmit={submitRename} className="appearance-group rounded-lg p-1.5">
            <input aria-label={t('记录名称')} autoFocus maxLength={120} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setRenamingId(''); }}
              className="mobile-touch h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
            <div className="mt-1 flex justify-end gap-1">
              <button type="button" className={actionClass} aria-label={t('取消重命名')} title={t('取消重命名')} onClick={() => setRenamingId('')}><X /></button>
              <button type="submit" className={`${actionClass} !text-indigo-600 dark:!text-indigo-400`} aria-label={t('保存记录名称')} title={t('保存记录名称')} disabled={!draft.trim()}><Check /></button>
            </div>
          </form>;
          return <div key={item.id} role="listitem" className={`group/record relative flex items-stretch rounded-lg transition-colors ${current ? 'bg-indigo-50 dark:bg-indigo-950/50' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
            <button type="button" aria-pressed={current} aria-label={t('打开画风记录：{0}', [item.name])} onClick={() => onSelect(item.id)}
              className={`min-w-0 flex-1 rounded-lg px-2 text-left ${mobile ? 'py-2' : 'py-1.5'}`}>
              <span className={`block truncate text-sm ${current ? 'font-semibold text-indigo-700 dark:text-indigo-200' : 'text-gray-700 dark:text-gray-200'}`}>{item.name}</span>
              <span className={`mt-0.5 block truncate text-micro tabular-nums ${current ? 'text-indigo-500/80 dark:text-indigo-300/70' : 'text-gray-400'}`}>{rowMeta(item)}</span>
            </button>
            <div className={`flex flex-none items-center gap-0.5 pr-1 ${mobile ? '' : `pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 rounded-md pl-2 opacity-0 transition-opacity group-hover/record:pointer-events-auto group-hover/record:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 ${current ? 'bg-indigo-50/95 dark:bg-indigo-950/95' : 'bg-gray-100/95 dark:bg-gray-800/95'}`}`}>
              <button type="button" className={actionClass} aria-label={t('重命名记录：{0}', [item.name])} title={t('重命名记录')} disabled={busy} onClick={() => startRename(item)}><Pencil /></button>
              <button type="button" className={actionClass} aria-label={t('删除记录：{0}', [item.name])} title={t('删除记录')} disabled={busy} onClick={() => onDelete(item.id)}><Trash2 /></button>
            </div>
          </div>;
        })}
        {!listed.length && <p role="status" className="px-2 py-3 text-xs text-gray-400">{loading ? t('正在读取画风记录…') : query.trim() ? t('没有匹配的画风记录') : t('还没有画风记录')}</p>}
      </div>
      {archived.length > 0 && <div className="mt-2 border-t border-gray-200 pt-2 dark:border-gray-800">
        <button type="button" disabled={busy} onClick={onPurgeArchived}
          className="mobile-touch flex w-full items-center gap-1 rounded-md px-1 py-1.5 text-left text-xs text-red-500 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800">
          <Trash2 className="h-3.5 w-3.5 flex-none" />{t('清理 {0} 条旧的已删除记录', [archived.length])}
        </button>
      </div>}
    </div>
  </aside>;
};
