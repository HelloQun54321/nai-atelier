import React, { useEffect, useRef, useState } from 'react';
import { Merge, Pencil, X } from 'lucide-react';
import { db } from '../services/dbService';
import { promptLibraryCategoryCounts, promptLibraryCategoryUpdates, type PromptLibraryCategorySnapshot } from '../services/promptLibraryCategories';
import { readPromptLibraryTagNames } from '../services/promptLibraryTags';
import { t, useLanguage } from '../services/i18n';
import { useConfirmDialog } from './ConfirmDialog';
import { IconButton, ToolbarButton, ToolbarSearch } from './DesignSystem';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { useMobileHistoryLayer } from './MobileUI';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { TOOLBAR_FIELD_CLASS } from './ToolbarPopover';

export const PromptLibraryCategoryManager: React.FC<{
  onClose: () => void;
  onSnapshot: (snapshot: PromptLibraryCategorySnapshot) => void;
  onChanged: (from: string, to: string) => void;
}> = ({ onClose, onSnapshot, onChanged }) => {
  useLanguage();
  const confirm = useConfirmDialog();
  const dialog = useModalA11y<HTMLElement>(true);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<PromptLibraryCategorySnapshot | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ from: string; value: string; merge: boolean } | null>(null);
  const rows = snapshot ? promptLibraryCategoryCounts(snapshot.chains, snapshot.names) : [];
  const close = () => { if (pending.current) return false; onClose(); };
  const requestClose = useMobileHistoryLayer(true, close, 'prompt-library-categories');
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialog.current)) { event.preventDefault(); requestClose(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [dialog, requestClose]);
  const read = async () => {
    const [chains, names] = await Promise.all([db.getAllChains(), db.getPromptLibraryTagNames()]).catch(cause => { setBlocked(true); throw cause; });
    const next = { chains, names };
    setSnapshot(next); onSnapshot(next); setBlocked(false);
    return next;
  };
  const reload = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await read(); }
    catch { setBlocked(true); setError(t('分类读取失败，请重新加载后再操作')); }
    finally { pending.current = false; setBusy(false); }
  };
  useEffect(() => { void reload(); }, []); // 打开时读事实，不能用打开前的筛选快照批改。
  const nameOf = (value: string) => {
    try { return readPromptLibraryTagNames([value])[0]; }
    catch { throw new Error(t('分类名称无效：请勿使用空白、逗号、换行或内部保留标签')); }
  };
  const add = async () => {
    if (pending.current || blocked || !snapshot) return;
    pending.current = true; setBusy(true); setError('');
    let wrote = false;
    try {
      const name = nameOf(newName);
      const current = await read();
      if (promptLibraryCategoryCounts(current.chains, current.names).some(([tag]) => tag === name)) throw new Error(t('分类已存在'));
      wrote = true;
      const names = await db.savePromptLibraryTagNames([...current.names, name]);
      const next = { ...current, names };
      setSnapshot(next); onSnapshot(next); setNewName(''); setSearch('');
    } catch (cause) {
      if (wrote) { try { await read(); } catch { setBlocked(true); } }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { pending.current = false; setBusy(false); }
  };
  const update = async () => {
    if (pending.current || blocked || !editing || !snapshot) return;
    pending.current = true; setBusy(true); setError('');
    let wrote = false, completed = 0, total = 0;
    try {
      const from = editing.from, to = nameOf(editing.value);
      if (from === to) throw new Error(t('请选择不同的目标分类'));
      const current = await read();
      const names = promptLibraryCategoryCounts(current.chains, current.names).map(([tag]) => tag);
      if (!names.includes(from)) throw new Error(t('原分类已不存在，请重新选择'));
      if (editing.merge && !names.includes(to)) throw new Error(t('目标分类已不存在，请重新选择'));
      const updates = promptLibraryCategoryUpdates(current.chains, from, to);
      total = updates.length;
      const merging = names.includes(to);
      if (!await confirm({ rememberKey: merging ? 'prompt-library-category.merge' : 'prompt-library-category.rename',
        title: t(merging ? '将「{0}」合并到「{1}」？' : '将「{0}」重命名为「{1}」？', [from, to]),
        message: t('将更新 {0} 条组合的分类，其他标签、提示词、图片和参数保持原样。', [total]),
        confirmLabel: t(merging ? '合并分类' : '重命名'), tone: 'primary' })) return;
      wrote = true;
      for (const { id, tags } of updates) { await db.updateChain(id, { tags }); completed++; }
      await db.savePromptLibraryTagNames([...current.names.filter(name => name !== from), to]);
      await read();
      onChanged(from, to); setEditing(null);
    } catch (cause) {
      if (wrote) { try { await read(); } catch { setBlocked(true); } }
      const reason = cause instanceof Error ? cause.message : String(cause);
      setError(wrote ? t('已更新 {0}/{1} 条组合，操作尚未全部完成：{2}', [completed, total, reason]) : reason);
    } finally { pending.current = false; setBusy(false); }
  };
  return <ImagePreviewPortal><div className="fixed inset-0 z-[1250] flex items-end justify-center bg-black/55 backdrop-blur-sm md:items-center md:p-4" onClick={close}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-label={t('管理组合分类')} aria-busy={busy} className="appearance-panel mobile-safe-bottom flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900 md:rounded-2xl" onClick={event => event.stopPropagation()}>
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800"><h2 className="font-semibold">{t('管理组合分类')}</h2><IconButton label="关闭" disabled={busy} onClick={close}><X /></IconButton></header>
      <div className="space-y-3 p-3"><ToolbarSearch autoFocus aria-label={t('搜索分类')} value={search} onChange={event => setSearch(event.target.value)} />
        <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); void add(); }}><input aria-label={t('新分类名称')} maxLength={200} value={newName} disabled={busy || blocked || !snapshot} onChange={event => setNewName(event.target.value)} className={`${TOOLBAR_FIELD_CLASS} !mt-0 min-w-0 flex-1`} /><ToolbarButton type="submit" disabled={busy || blocked || !snapshot || !newName.trim()}>{t('新增分类')}</ToolbarButton></form>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {blocked && <ToolbarButton disabled={busy} onClick={() => void reload()}>{t('重新加载分类')}</ToolbarButton>}
      </div>
      <ul className="min-h-0 overflow-y-auto px-3 pb-3">{rows.filter(([tag]) => tag.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(([tag, count]) => <li key={tag} className="flex min-h-12 flex-wrap items-center gap-2 border-b border-gray-100 py-2 dark:border-gray-800">
        {editing?.from === tag ? <>
          {editing.merge ? <select aria-label={t('目标分类')} value={editing.value} disabled={busy} onChange={event => setEditing({ ...editing, value: event.target.value })} className={`${TOOLBAR_FIELD_CLASS} min-w-0 flex-1`}><option value="">{t('请选择目标分类')}</option>{rows.filter(([name]) => name !== tag).map(([name]) => <option key={name} value={name}>{name}</option>)}</select>
            : <input autoFocus aria-label={t('分类名称')} value={editing.value} disabled={busy} onChange={event => setEditing({ ...editing, value: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void update(); }} className={`${TOOLBAR_FIELD_CLASS} min-w-0 flex-1`} />}
          <ToolbarButton disabled={busy || blocked || !editing.value.trim()} onClick={() => void update()}>{t(editing.merge ? '合并' : '保存')}</ToolbarButton><IconButton label="取消" disabled={busy} onClick={() => setEditing(null)}><X /></IconButton>
        </> : <><span className="min-w-0 flex-1 break-words text-sm font-semibold">{tag}</span><span className="text-xs text-gray-500">{t('{0}条', [count])}</span><IconButton label={t('重命名分类：{0}', [tag])} disabled={busy || blocked} onClick={() => { setEditing({ from: tag, value: tag, merge: false }); setError(''); }}><Pencil /></IconButton><ToolbarButton aria-label={t('合并分类：{0}', [tag])} disabled={busy || blocked || rows.length < 2} onClick={() => { setEditing({ from: tag, value: '', merge: true }); setError(''); }}><Merge /><span>{t('合并')}</span></ToolbarButton></>}
      </li>)}</ul>
    </section>
  </div></ImagePreviewPortal>;
};
