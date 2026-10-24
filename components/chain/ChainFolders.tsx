import React, { useEffect, useMemo, useState } from 'react';
import { Folder, FolderInput, Pencil, Plus, Trash2, X } from 'lucide-react';
import { t } from '../../services/i18n';
import { folderContains, folderTree, removeChainFolder, type ChainFolder } from '../../services/chainFolders';
import type { useChainFolders } from '../../services/useChainFolders';
import { ToolbarButton } from '../DesignSystem';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { useConfirmDialog } from '../ConfirmDialog';

export const CHAIN_FOLDER_DRAG_TYPE = 'application/x-novelai-style-chain-ids';
type Store = ReturnType<typeof useChainFolders>;
type Notify = (message: string, type?: 'success' | 'error') => void;
const field = 'mobile-touch w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900';

function FolderDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useModalA11y<HTMLDivElement>(true);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy && isTopmostModal(ref.current)) { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [busy, onClose]);
  return <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={t(title)} className="appearance-panel max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(title)}</h2><ToolbarButton aria-label={t('关闭')} disabled={busy} onClick={onClose}><X /></ToolbarButton></div>{children}
    </div>
  </div>;
}

export function ChainFolderNavigation({ store, selected, onSelect, chainIds, onMove, notify, disabled = false }: {
  store: Store; selected: string; onSelect: (id: string) => void; chainIds: string[];
  onMove: (ids: string[], folderId: string) => Promise<void>; notify: Notify; disabled?: boolean;
}) {
  const [editing, setEditing] = useState<ChainFolder | 'new' | null>(null);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const confirm = useConfirmDialog();
  const { folders, assignments } = store.state;
  const tree = folderTree(folders);
  const busy = disabled || store.busy;
  const blocked = busy || !store.ready || Boolean(store.error);
  const current = folders.find(folder => folder.id === selected);
  const choices = [ { id: '*', name: t('全部'), depth: 0 }, { id: '', name: t('未整理'), depth: 0 }, ...tree ];
  const counts = useMemo(() => {
    const result = new Map<string, number>([['*', chainIds.length], ['', 0]]);
    const parents = new Map(folders.map(folder => [folder.id, folder.parentId]));
    for (const chainId of chainIds) {
      let cursor = assignments[chainId];
      if (!cursor) result.set('', (result.get('') || 0) + 1);
      while (cursor) { result.set(cursor, (result.get(cursor) || 0) + 1); cursor = parents.get(cursor) || ''; }
    }
    return result;
  }, [chainIds, assignments, folders]);
  const count = (id: string) => counts.get(id) || 0;
  const open = (folder: ChainFolder | 'new') => {
    setEditing(folder); setName(folder === 'new' ? '' : folder.name);
    setParentId(folder === 'new' ? current?.id || '' : folder.parentId || '');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || blocked || !name.trim()) return;
    const folder = { id: editing === 'new' ? crypto.randomUUID() : editing.id, name: name.trim(), parentId: parentId || null };
    try {
      await store.save({ ...store.state, folders: editing === 'new' ? [...folders, folder] : folders.map(item => item.id === folder.id ? folder : item) });
      setEditing(null); onSelect(folder.id); notify('文件夹已保存', 'success');
    } catch (cause) { notify(cause instanceof Error ? cause.message : '保存文件夹失败', 'error'); }
  };
  const remove = async () => {
    if (!current || blocked) return;
    if (!await confirm({ title: t('删除文件夹「{0}」？', [current.name]), message: t('其中的风格串移回未整理，子文件夹移到上一级，同名时加编号。所有配方与图片保留。'), confirmLabel: t('删除文件夹'), tone: 'danger' })) return;
    try { await store.save(removeChainFolder(store.state, current.id)); onSelect(''); notify('文件夹已删除，风格串已保留', 'success'); }
    catch (cause) { notify(cause instanceof Error ? cause.message : '删除文件夹失败', 'error'); }
  };
  const drop = (event: React.DragEvent, id: string) => {
    event.preventDefault(); setDragOver(null);
    if (blocked || id === '*') return;
    try {
      const ids: unknown = JSON.parse(event.dataTransfer.getData(CHAIN_FOLDER_DRAG_TYPE));
      if (Array.isArray(ids)) void onMove(ids.filter((item): item is string => typeof item === 'string' && chainIds.includes(item)), id);
    } catch { /* 外部文件和文字不作为风格串移动。 */ }
  };
  return <aside aria-label={t('风格串文件夹')} className="appearance-panel flex-none border-b border-gray-200 p-3 dark:border-gray-800 md:w-52 md:overflow-y-auto md:border-b-0 md:border-r">
    <div className="mb-2 flex items-center justify-between gap-1"><span className="text-xs font-semibold text-gray-500">{t('文件夹')}</span><div className="flex gap-1">
      <ToolbarButton aria-label={t('新建文件夹')} title={t('新建文件夹')} disabled={blocked} onClick={() => open('new')} className="!px-2"><Plus className="h-4 w-4" /></ToolbarButton>
      {current && <><ToolbarButton aria-label={t('编辑文件夹')} title={t('重命名或移动文件夹')} disabled={blocked} onClick={() => open(current)} className="!px-2"><Pencil className="h-4 w-4" /></ToolbarButton><ToolbarButton aria-label={t('删除文件夹')} disabled={blocked} onClick={() => void remove()} className="!px-2"><Trash2 className="h-4 w-4" /></ToolbarButton></>}
    </div></div>
    {!store.ready && !store.error && <p role="status" className="text-xs text-gray-500">{t('正在加载文件夹…')}</p>}
    {store.error && <div role="alert" className="mb-2 text-xs text-red-500">{store.error}<button type="button" onClick={() => void store.reload()} className="mobile-touch ml-2 underline">{t('重新加载')}</button></div>}
    <select aria-label={t('选择文件夹')} value={selected} disabled={busy} onChange={event => onSelect(event.target.value)} className={`${field} md:hidden`}>{choices.map(item => <option key={item.id} value={item.id}>{'　'.repeat(item.depth)}{item.name} ({count(item.id)})</option>)}</select>
    <nav className="hidden space-y-1 md:block">{choices.map(item => <button key={item.id} type="button" aria-current={selected === item.id ? 'page' : undefined} disabled={busy} onClick={() => onSelect(item.id)}
      onDragOver={event => { if (!blocked && item.id !== '*' && event.dataTransfer.types.includes(CHAIN_FOLDER_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(item.id); } }} onDragLeave={() => setDragOver(null)} onDrop={event => drop(event, item.id)}
      className={`mobile-touch flex w-full min-w-0 items-center gap-2 rounded-lg py-2 pr-2 text-left text-sm disabled:opacity-50 ${dragOver === item.id ? 'ring-2 ring-indigo-500' : ''} ${selected === item.id ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`} style={{ paddingLeft: 8 + item.depth * 14 }}>
      <Folder className="h-4 w-4 flex-none" /><span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span><span className="text-xs opacity-60">{count(item.id)}</span>
    </button>)}</nav>
    {editing && <ImagePreviewPortal><FolderDialog title={editing === 'new' ? '新建文件夹' : '编辑文件夹'} busy={busy} onClose={() => setEditing(null)}><form onSubmit={event => void save(event)}>
      <label className="mb-3 block text-xs text-gray-500">{t('文件夹名称')}<input aria-label={t('文件夹名称')} autoFocus maxLength={60} value={name} disabled={busy} onChange={event => setName(event.target.value)} className={`${field} mt-2`} /></label>
      <label className="block text-xs text-gray-500">{t('上级文件夹')}<select aria-label={t('上级文件夹')} value={parentId} disabled={busy} onChange={event => setParentId(event.target.value)} className={`${field} mt-2`}><option value="">{t('顶层')}</option>{tree.filter(folder => editing === 'new' || !folderContains(folders, editing.id, folder.id)).map(folder => <option key={folder.id} value={folder.id}>{'　'.repeat(folder.depth)}{folder.name}</option>)}</select></label>
      <div className="mt-5 flex justify-end gap-2"><ToolbarButton disabled={busy} onClick={() => setEditing(null)}>{t('取消')}</ToolbarButton><ToolbarButton type="submit" disabled={blocked || !name.trim()} tone="primary">{t('保存')}</ToolbarButton></div>
    </form></FolderDialog></ImagePreviewPortal>}
  </aside>;
}

export function ChainFolderMoveDialog({ store, ids, onMove, onClose }: { store: Store; ids: string[]; onMove: (ids: string[], folderId: string) => Promise<void>; onClose: () => void }) {
  const [target, setTarget] = useState('');
  return <ImagePreviewPortal><FolderDialog title="移动到文件夹" busy={store.busy} onClose={onClose}>
    <p className="mb-3 text-sm text-gray-500">{t('已选 {0} 条风格串', [ids.length])}</p>
    <select aria-label={t('目标文件夹')} value={target} disabled={store.busy} onChange={event => setTarget(event.target.value)} className={field}><option value="">{t('未整理')}</option>{folderTree(store.state.folders).map(folder => <option key={folder.id} value={folder.id}>{'　'.repeat(folder.depth)}{folder.name}</option>)}</select>
    <div className="mt-5 flex justify-end gap-2"><ToolbarButton disabled={store.busy} onClick={onClose}>{t('取消')}</ToolbarButton><ToolbarButton disabled={store.busy || !store.ready || Boolean(store.error)} tone="primary" onClick={() => void onMove(ids, target)}><FolderInput />{t('移动')}</ToolbarButton></div>
  </FolderDialog></ImagePreviewPortal>;
}
