import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import type { PromptChain } from '../../types';
import { db } from '../../services/dbService';
import { getCustomChainTags, isCustomChainTag, normalizeChainTags } from '../../services/chainTags';
import { t, useLanguage } from '../../services/i18n';
import { useConfirmDialog } from '../ConfirmDialog';
import { IconButton, ToolbarButton, ToolbarSearch, WorkspacePageState } from '../DesignSystem';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useMobileHistoryLayer } from '../MobileUI';
import { isTopmostModal, useModalA11y } from '../useModalA11y';

interface ChainTagManagerProps {
  chains: PromptChain[];
  isLoading?: boolean;
  loadError?: string;
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
  onTagChanged: (from: string, to?: string) => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}

export const ChainTagManager: React.FC<ChainTagManagerProps> = props => <ImagePreviewPortal><ChainTagPanel {...props} /></ImagePreviewPortal>;

const ChainTagPanel: React.FC<ChainTagManagerProps> = ({ chains, isLoading = false, loadError, onClose, onRefresh, onTagChanged, notify }) => {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const dialogRef = useModalA11y<HTMLElement>(true);
  const savingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ tag: string; value: string } | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const readPending = isLoading || Boolean(loadError);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    chains.forEach(chain => getCustomChainTags(chain.tags).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
    return Array.from(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [chains]);
  const close = () => { if (savingRef.current) return false; onClose(); };
  useMobileHistoryLayer(true, close, 'chain-tags');
  useEffect(() => { dialogRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus(); }, [dialogRef]);
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

  const reload = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setBusy(true);
    try { await onRefresh(); setNeedsReload(false); }
    catch (error) { notify(`${t('标签回读失败，请重新加载后再操作')}${error instanceof Error ? `：${error.message}` : ''}`, 'error'); }
    finally { savingRef.current = false; setBusy(false); }
  };

  const updateTag = async (from: string, replacement?: string) => {
    if (savingRef.current || readPending || needsReload || !isCustomChainTag(from)) return;
    const to = replacement?.trim();
    if (replacement !== undefined && (!to || to === from)) return;
    if (to && !isCustomChainTag(to)) { notify(t('来源、图片类型和状态不用作自定义标签'), 'error'); return; }
    const affected = chains.filter(chain => getCustomChainTags(chain.tags).includes(from));
    if (!affected.length) return;
    savingRef.current = true; setBusy(true);
    let updatesStarted = false;
    let refreshAttempted = false;
    try {
      const merging = Boolean(to && tagCounts.some(([tag]) => tag === to));
      if (!await confirmAction({
        rememberKey: `chain-tag.${to ? merging ? 'merge' : 'rename' : 'remove'}`, rememberScope: chains[0]?.type,
        title: to ? merging ? t('将「{0}」合并到「{1}」？', [from, to]) : t('将「{0}」重命名为「{1}」？', [from, to]) : t('移除标签「{0}」？', [from]),
        message: t('将更新 {0} 条资料的标签，提示词、图片和参数保持原样。', [affected.length]),
        confirmLabel: to ? merging ? t('合并标签') : t('重命名') : t('移除标签'), tone: to ? 'primary' : 'danger',
      })) return;
      updatesStarted = true;
      for (const chain of affected) {
        const tags = normalizeChainTags(normalizeChainTags(chain.tags).flatMap(tag => tag === from ? to ? [to] : [] : [tag]));
        await db.updateChain(chain.id, { tags });
      }
      refreshAttempted = true;
      await onRefresh();
      onTagChanged(from, to); setEditing(null);
      notify(t('标签已更新'));
    } catch (error) {
      // 部分条目可能已保存；只回读一次，失败时禁止用旧快照覆盖实际结果。
      let reloadFailed = refreshAttempted;
      if (updatesStarted && !refreshAttempted) {
        try { await onRefresh(); } catch { reloadFailed = true; }
      }
      if (reloadFailed) setNeedsReload(true);
      const message = error instanceof Error ? error.message : t('标签更新失败');
      notify(reloadFailed ? `${message} · ${t('标签回读失败，请重新加载后再操作')}` : message, 'error');
    } finally { savingRef.current = false; setBusy(false); }
  };

  const visibleTags = tagCounts.filter(([tag]) => tag.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-end justify-center bg-black/55 backdrop-blur-sm md:items-center md:p-4" onClick={close}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('管理标签')} aria-busy={busy} className="appearance-panel ui-sheet-enter mobile-safe-bottom flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900 md:rounded-2xl" onClick={event => event.stopPropagation()}>
      <header className="flex flex-none items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800"><h2 className="text-lg font-bold">{t('管理标签')}</h2><IconButton label={t('关闭')} disabled={busy} onClick={close}><X /></IconButton></header>
      <div className="flex-none p-3"><ToolbarSearch aria-label={t('搜索标签')} value={search} disabled={busy} onChange={event => setSearch(event.target.value)} placeholder={t('搜索标签')} /></div>
      {readPending && <WorkspacePageState role={isLoading ? 'status' : 'alert'} className="px-3 pb-3 text-center text-sm text-gray-500">{isLoading ? t('加载中…') : t(loadError || '')}{!isLoading && <ToolbarButton disabled={busy} onClick={() => void reload()}>{t('重试')}</ToolbarButton>}</WorkspacePageState>}
      {needsReload && <div className="px-3 pb-3"><p role="alert" className="mb-2 text-xs text-red-500">{t('标签回读失败，请重新加载后再操作')}</p><ToolbarButton disabled={busy} onClick={() => void reload()}>{t('重新加载标签')}</ToolbarButton></div>}
      <ul className="min-h-0 overflow-y-auto px-3 pb-3">
        {visibleTags.map(([tag, count]) => <li key={tag} className="flex min-h-12 items-center gap-2 border-b border-gray-100 py-1 dark:border-gray-800">
          {editing?.tag === tag ? <>
            <input autoFocus aria-label={t('标签名称')} value={editing.value} disabled={busy || readPending} onChange={event => setEditing({ tag, value: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void updateTag(tag, editing.value); } }} className="mobile-touch h-10 min-w-0 flex-1 rounded-xl border border-indigo-400 bg-transparent px-2 text-sm outline-none" />
            <IconButton label={t('保存')} disabled={busy || readPending || needsReload || !editing.value.trim() || editing.value.trim() === tag} onClick={() => void updateTag(tag, editing.value)}><Check /></IconButton>
            <IconButton label={t('取消')} disabled={busy} onClick={() => setEditing(null)}><X /></IconButton>
          </> : <>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={tag}>#{tag}</span><span className="whitespace-nowrap text-xs text-gray-400">{t('{0}条', [count])}</span>
            <IconButton label={t('重命名标签：{0}', [tag])} disabled={busy || readPending || needsReload} onClick={() => setEditing({ tag, value: tag })}><Pencil /></IconButton>
            <IconButton label={t('移除标签：{0}', [tag])} disabled={busy || readPending || needsReload} onClick={() => void updateTag(tag)} className="text-red-500"><Trash2 /></IconButton>
          </>}
        </li>)}
        {!visibleTags.length && !readPending && <li className="py-8 text-center text-sm text-gray-400">{t('没有匹配的标签')}</li>}
      </ul>
    </section>
  </div>;
};
