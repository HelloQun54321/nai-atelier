import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import type { Inspiration, User } from '../../types';
import { db } from '../../services/dbService';
import { getCollectionTags, normalizeInspirationTags, sourceLabel } from '../../services/inspirationUtils';
import { t, useLanguage } from '../../services/i18n';
import { useConfirmDialog } from '../ConfirmDialog';
import { IconButton, ToolbarButton, ToolbarSearch } from '../DesignSystem';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useMobileHistoryLayer } from '../MobileUI';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { CollectionTagInput } from './CollectionControls';
import { canEditItem } from './InspirationShared';

export const CollectionTagManager: React.FC<{
  items: Inspiration[];
  tagNames: string[] | null;
  onSaveTagNames: (tags: string[]) => Promise<void>;
  onReloadTagNames: () => Promise<void>;
  currentUser: User;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onTagChanged: (from: string, to?: string) => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}> = ({ items, tagNames, onSaveTagNames, onReloadTagNames, currentUser, onClose, onRefresh, onTagChanged, notify }) => {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const dialogRef = useModalA11y<HTMLElement>(true);
  const savingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [newTag, setNewTag] = useState('');
  const [editing, setEditing] = useState<{ tag: string; value: string } | null>(null);
  const activeItems = useMemo(() => items.filter(item => !item.archived), [items]);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (tagNames || []).forEach(tag => counts.set(tag, 0));
    activeItems.forEach(item => getCollectionTags(item).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
    return Array.from(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [activeItems, tagNames]);
  const editableTags = useMemo(() => new Set(currentUser.role === 'guest' ? [] : [...(tagNames || []), ...activeItems.filter(item => canEditItem(item, currentUser)).flatMap(getCollectionTags)]), [activeItems, tagNames, currentUser.id, currentUser.role]);
  const requestClose = () => { if (savingRef.current) return false; onClose(); };
  useMobileHistoryLayer(true, requestClose, 'collection-tags');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmostModal(dialogRef.current)) {
        event.preventDefault();
        if (!savingRef.current) onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, dialogRef]);

  const addTag = async () => {
    const tag = normalizeInspirationTags([newTag])[0];
    if (savingRef.current || !tag || tagNames === null || currentUser.role === 'guest') return;
    if (tagCounts.some(([name]) => name === tag)) { notify(t('标签已存在'), 'error'); return; }
    savingRef.current = true; setBusy(true);
    try {
      await onSaveTagNames([...tagNames, tag]);
      setNewTag(''); setSearch('');
      notify(t('已添加标签 #{0}', [tag]));
    } catch (error: any) { await onReloadTagNames(); notify(error.message || t('标签添加失败'), 'error'); }
    finally { savingRef.current = false; setBusy(false); }
  };

  const updateTag = async (from: string, replacement?: string) => {
    if (savingRef.current || tagNames === null || currentUser.role === 'guest') return;
    const to = replacement === undefined ? undefined : normalizeInspirationTags([replacement])[0];
    if (replacement !== undefined && (!to || to === from)) return;
    const affected = activeItems.filter(item => canEditItem(item, currentUser) && getCollectionTags(item).includes(from));
    const registered = tagNames.includes(from);
    if (!affected.length && !registered) return;
    if (to && affected.some(item => sourceLabel(item.sourceType) === to)) {
      notify(t('标签名称与图片来源重复，请使用其他名称'), 'error'); return;
    }
    savingRef.current = true; setBusy(true);
    try {
      const merging = Boolean(to && tagCounts.some(([tag]) => tag === to));
      if (!await confirmAction({
        title: to ? merging ? t('将「{0}」合并到「{1}」？', [from, to]) : t('将「{0}」重命名为「{1}」？', [from, to]) : t('移除标签「{0}」？', [from]),
        message: t('将更新收藏库中 {0} 页的标签，图片和收藏夹保持原样。', [affected.length]),
        confirmLabel: to ? merging ? t('合并标签') : t('重命名') : t('移除标签'), tone: to ? 'primary' : 'danger',
      })) return;
      const batches = new Map<string, { ids: string[]; tags: string[] }>();
      affected.forEach(item => {
        const tags = normalizeInspirationTags(getCollectionTags(item).map(tag => tag === from ? to || '' : tag));
        const key = JSON.stringify(tags);
        const batch = batches.get(key);
        if (batch) batch.ids.push(item.id); else batches.set(key, { ids: [item.id], tags });
      });
      for (const { ids, tags } of batches.values()) await db.bulkUpdateInspirations(ids, { tags });
      if (registered) await onSaveTagNames(tagNames.flatMap(tag => tag === from ? to ? [to] : [] : [tag]));
      await onRefresh();
      onTagChanged(from, to); setEditing(null);
      notify(t('标签已更新'));
    } catch (error: any) {
      // 部分批次可能已保存，回读实际结果并保留输入，重试只处理仍含旧标签的图片。
      await onRefresh().catch(() => {});
      await onReloadTagNames();
      notify(error.message || t('标签更新失败'), 'error');
    } finally { savingRef.current = false; setBusy(false); }
  };

  const visibleTags = tagCounts.filter(([tag]) => tag.toLowerCase().includes(search.trim().toLowerCase()));
  return <ImagePreviewPortal><div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-end justify-center bg-black/55 backdrop-blur-sm md:items-center md:p-4" onClick={requestClose}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('管理标签')} aria-busy={busy} className="appearance-panel ui-sheet-enter mobile-safe-bottom flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900 md:rounded-2xl" onClick={event => event.stopPropagation()}>
      <header className="flex flex-none items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800"><h2 className="text-lg font-bold">{t('管理标签')}</h2><IconButton label={t('关闭')} disabled={busy} onClick={requestClose}><X /></IconButton></header>
      <div className="flex-none p-3"><ToolbarSearch autoFocus aria-label={t('搜索标签')} value={search} onChange={event => setSearch(event.target.value)} placeholder={t('搜索标签')} /></div>
      <form className="flex flex-none gap-2 px-3 pb-3" onSubmit={event => { event.preventDefault(); void addTag(); }}>
        <input aria-label={t('新标签名称')} maxLength={200} value={newTag} disabled={busy || tagNames === null || currentUser.role === 'guest'} onChange={event => setNewTag(event.target.value)} placeholder={t('新标签名称')} className="mobile-touch h-10 min-w-0 flex-1 rounded-xl border border-gray-200 bg-transparent px-3 text-sm outline-none focus:border-indigo-400 dark:border-gray-700" />
        <ToolbarButton type="submit" disabled={busy || tagNames === null || currentUser.role === 'guest' || !normalizeInspirationTags([newTag])[0]}>{t('添加标签')}</ToolbarButton>
      </form>
      {tagNames === null && <div className="px-3 pb-3"><ToolbarButton disabled={busy} onClick={() => void onReloadTagNames()}>{t('重新加载标签')}</ToolbarButton></div>}
      <ul className="min-h-0 overflow-y-auto px-3 pb-3">
        {visibleTags.map(([tag, count]) => <li key={tag} className="flex min-h-12 items-center gap-2 border-b border-gray-100 py-1 dark:border-gray-800">
          {editing?.tag === tag ? <>
            <CollectionTagInput maxLength={200} onPick={value => setEditing({ tag, value })} autoFocus aria-label={t('标签名称')} value={editing.value} suggestions={tagCounts.map(([name]) => name).filter(name => name !== tag)} disabled={busy} onChange={event => setEditing({ tag, value: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void updateTag(tag, editing.value); } }} className="mobile-touch h-10 min-w-0 flex-1 rounded-xl border border-indigo-400 bg-transparent px-2 text-sm outline-none" />
            <IconButton label={t('保存')} disabled={busy || tagNames === null || !normalizeInspirationTags([editing.value])[0] || normalizeInspirationTags([editing.value])[0] === tag} onClick={() => void updateTag(tag, editing.value)}><Check /></IconButton>
            <IconButton label={t('取消')} disabled={busy} onClick={() => setEditing(null)}><X /></IconButton>
          </> : <>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={tag}>#{tag}</span><span className="whitespace-nowrap text-xs text-gray-400">{t('{0}页', [count])}</span>
            <IconButton label={t('重命名标签：{0}', [tag])} disabled={busy || tagNames === null || !editableTags.has(tag)} onClick={() => setEditing({ tag, value: tag })}><Pencil /></IconButton>
            <IconButton label={t('移除标签：{0}', [tag])} disabled={busy || tagNames === null || !editableTags.has(tag)} onClick={() => void updateTag(tag)} className="text-red-500"><Trash2 /></IconButton>
          </>}
        </li>)}
        {!visibleTags.length && <li className="py-8 text-center text-sm text-gray-400">{t('没有匹配的标签')}</li>}
      </ul>
    </section>
  </div></ImagePreviewPortal>;
};
