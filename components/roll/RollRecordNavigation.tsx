import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownWideNarrow, Check, ListChecks, Pencil, Plus, Trash2, X } from 'lucide-react';
import { getLanguage, t, useLanguage } from '../../services/i18n';
import type { RollExperimentSummary } from '../../services/styleRoll';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_RECENT_COUNT = 10;

/** 记录列表的呈现：主行名称，副行轮次／候选数与最近时间，当前记录高亮。 */
export interface RollRecordNavigationProps {
  records: RollExperimentSummary[];
  selectedId: string;
  /** 当前正在生成中的记录 ID：批量清理时自动跳过并禁用勾选。 */
  generatingRecordId?: string;
  busy?: boolean;
  loading?: boolean;
  /** 手机面板内：触控行更高，操作按钮常显。 */
  mobile?: boolean;
  className?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  /** 删除记录与候选一致：二次确认后彻底移除，不保留回收站。 */
  onDelete: (id: string) => void;
  /** 批量删除多条记录：由页面统一弹一次确认并逐条清理，返回是否已执行删除。 */
  onDeleteMany?: (ids: string[]) => Promise<boolean>;
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

export const RollRecordNavigation: React.FC<RollRecordNavigationProps> = ({ records, selectedId, generatingRecordId, busy = false, loading = false, mobile = false, className = '', onSelect, onCreate, onRename, onDelete, onDeleteMany, onPurgeArchived }) => {
  useLanguage();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'created'>('recent');
  const [renamingId, setRenamingId] = useState('');
  const [draft, setDraft] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const active = useMemo(() => records.filter(item => !item.archived), [records]);
  const archived = useMemo(() => records.filter(item => item.archived), [records]);
  const listed = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return active
      .filter(item => !keyword || item.name.toLowerCase().includes(keyword))
      .sort((a, b) => sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
  }, [active, query, sort]);
  const deletable = useMemo(() => active.filter(item => item.id !== generatingRecordId), [active, generatingRecordId]);
  useEffect(() => {
    const allowed = new Set(deletable.map(item => item.id));
    setCheckedIds(current => {
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (allowed.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : current;
    });
    if (selecting && active.length < 2) setSelecting(false);
  }, [active.length, deletable, selecting]);

  const emptyRecordIds = useMemo(() => deletable.filter(item => item.candidates === 0).map(item => item.id), [deletable]);
  const weekOldRecordIds = useMemo(() => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    return deletable.filter(item => item.updatedAt <= cutoff).map(item => item.id);
  }, [deletable]);
  const beyondRecentTenIds = useMemo(() => {
    if (active.length <= KEEP_RECENT_COUNT) return [];
    const newestTen = new Set([...active].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, KEEP_RECENT_COUNT).map(item => item.id));
    return deletable.filter(item => !newestTen.has(item.id)).map(item => item.id);
  }, [active, deletable]);

  const toggleChecked = (id: string) => {
    if (busy || id === generatingRecordId) return;
    setCheckedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const exitSelecting = () => { setSelecting(false); setCheckedIds(new Set()); };
  const handleBatchDelete = async () => {
    if (!onDeleteMany || !checkedIds.size || busy) return;
    const deleted = await onDeleteMany([...checkedIds]);
    if (deleted) exitSelecting();
  };

  const startRename = (item: RollExperimentSummary) => { setRenamingId(item.id); setDraft(item.name); };
  const submitRename = (event: React.FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (renamingId && name) onRename(renamingId, name);
    setRenamingId('');
  };
  const rowMeta = (item: RollExperimentSummary) => t('{0} 轮 · {1} 个候选 · {2}', [item.rounds, item.candidates, rollRecordTimeLabel(sort === 'created' ? item.createdAt : item.updatedAt)]);
  const actionClass = 'mobile-touch flex h-7 w-7 flex-none items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white hover:text-gray-700 disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-200 [&>svg]:h-3.5 [&>svg]:w-3.5';
  const quickChipClass = 'mobile-touch rounded-md border border-gray-200 bg-white px-1.5 py-1 text-mini font-medium text-gray-600 transition-colors hover:border-[var(--nai-accent)] hover:text-[var(--nai-accent)] disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300';
  const sortToggle = <button type="button" aria-label={t('记录排序')} aria-pressed={sort === 'created'} title={t(sort === 'recent' ? '当前按最近更新排序，点击切换为创建时间' : '当前按创建时间排序，点击切换为最近更新')}
    onClick={() => setSort(current => current === 'recent' ? 'created' : 'recent')}
    className={`mobile-touch inline-flex h-8 flex-none items-center gap-1 rounded-lg border px-2 text-micro font-medium transition-colors ${sort === 'created' ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/80 dark:bg-indigo-950/50 dark:text-indigo-300' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-800'}`}>
    <ArrowDownWideNarrow className="h-3.5 w-3.5" />
    <span>{t(sort === 'recent' ? '最近' : '创建')}</span>
  </button>;
  return <aside aria-label={t('画风记录列表')} className={className}>
    <header className="mb-2 flex flex-none items-center gap-1.5 px-0.5">
      {selecting ? <>
        <span className="text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-200">{t('已选 {0} 条', [checkedIds.size])}</span>
        <button type="button" disabled={busy} onClick={exitSelecting}
          className="mobile-touch ml-auto inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200">
          {t('完成')}
        </button>
      </> : <>
        <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-400">{t('共 {0} 条', [active.length])}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {active.length >= 3 && active.length < 8 && sortToggle}
          {onDeleteMany && active.length >= 2 && <button type="button" aria-label={t('批量清理记录')} title={t('批量清理记录')} disabled={busy} onClick={() => { setRenamingId(''); setCheckedIds(new Set()); setSelecting(true); }}
            className={actionClass}>
            <ListChecks />
          </button>}
          <button type="button" aria-label={t('新建记录')} title={t('新建记录')} disabled={busy} onClick={onCreate}
            className="mobile-touch inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-40 dark:text-indigo-400 dark:hover:bg-indigo-950/50">
            <Plus className="h-3.5 w-3.5" /><span>{t('新建')}</span>
          </button>
        </div>
      </>}
    </header>
    {selecting && <div role="group" aria-label={t('快捷勾选旧记录')} className="mb-2 flex flex-none flex-wrap gap-1">
      <button type="button" disabled={busy || !emptyRecordIds.length} onClick={() => setCheckedIds(new Set(emptyRecordIds))} className={quickChipClass}>{t('空记录')}</button>
      <button type="button" disabled={busy || !weekOldRecordIds.length} onClick={() => setCheckedIds(new Set(weekOldRecordIds))} className={quickChipClass}>{t('7 天前')}</button>
      <button type="button" disabled={busy || !beyondRecentTenIds.length} onClick={() => setCheckedIds(new Set(beyondRecentTenIds))} className={quickChipClass}>{t('留最近 10 条')}</button>
    </div>}
    {!selecting && active.length >= 8 && <div className="mb-2 flex flex-none items-center gap-1.5">
      <input aria-label={t('搜索 Roll')} placeholder={t('搜索 Roll')} value={query} onChange={event => setQuery(event.target.value)}
        className="mobile-touch h-8 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-xs font-normal text-gray-800 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
      {sortToggle}
    </div>}
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div role="list" aria-label={t('画风记录列表')} className="space-y-0.5">
        {listed.map(item => {
          const current = item.id === selectedId;
          if (selecting) {
            const checked = checkedIds.has(item.id);
            const locked = busy || item.id === generatingRecordId;
            return <div key={item.id} role="listitem" className={`flex items-stretch rounded-lg transition-colors ${checked ? 'bg-red-50/80 dark:bg-red-950/30' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
              <button type="button" role="checkbox" aria-checked={checked} disabled={locked} aria-label={t('选择画风记录：{0}', [item.name])} onClick={() => toggleChecked(item.id)}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left disabled:opacity-45 ${mobile ? 'py-2' : 'py-1.5'}`}>
                <span aria-hidden="true" className={`flex h-4 w-4 flex-none items-center justify-center rounded border transition-colors ${checked ? 'border-red-500 bg-red-500 text-white' : 'border-gray-300 bg-white text-transparent dark:border-gray-600 dark:bg-gray-900'}`}>
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${checked ? 'font-semibold text-red-700 dark:text-red-200' : 'text-gray-700 dark:text-gray-200'}`}>{item.name}</span>
                  <span className="mt-0.5 block truncate text-micro tabular-nums text-gray-400">{rowMeta(item)}</span>
                </span>
              </button>
            </div>;
          }
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
        {!listed.length && <p role="status" className="px-2 py-3 text-xs text-gray-400">{loading ? t('正在读取 Roll 列表…') : query.trim() ? t('没有匹配的 Roll') : t('还没有 Roll')}</p>}
      </div>
      {!selecting && archived.length > 0 && <div className="mt-2 border-t border-gray-200 pt-2 dark:border-gray-800">
        <button type="button" disabled={busy} onClick={onPurgeArchived}
          className="mobile-touch flex w-full items-center gap-1 rounded-md px-1 py-1.5 text-left text-xs text-red-500 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800">
          <Trash2 className="h-3.5 w-3.5 flex-none" />{t('清理 {0} 条旧的已删除记录', [archived.length])}
        </button>
      </div>}
    </div>
    {selecting && <div className="mt-2 flex flex-none items-center gap-1.5 border-t border-gray-200 pt-2 dark:border-gray-800">
      <button type="button" disabled={busy || !checkedIds.size} onClick={() => setCheckedIds(new Set())}
        className="mobile-touch rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800">
        {t('清空')}
      </button>
      <button type="button" disabled={busy || !checkedIds.size} onClick={() => void handleBatchDelete()}
        className="mobile-touch ml-auto inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-40">
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        <span>{t('删除所选 ({0})', [checkedIds.size])}</span>
      </button>
    </div>}
  </aside>;
};
