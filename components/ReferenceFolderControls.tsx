import React, { useEffect, useMemo, useState } from 'react';
import { t } from '../services/i18n';
import { createUuid } from '../services/id';
import {
  getReferenceFolderIds, referenceFolderTree, removeReferenceFolder, updateReferenceFolderMemberships,
  type ReferenceFolder,
} from '../services/referenceFolders';
import type { useReferenceFolders } from '../services/useReferenceFolders';
import { DirectoryNodeDialog } from './DirectoryNodeDialog';
import { DirectoryTreeChecklist } from './DirectoryTreeChecklist';
import { ToolbarButton } from './DesignSystem';
import { useConfirmDialog } from './ConfirmDialog';

type Store = ReturnType<typeof useReferenceFolders>;
type Notify = (message: string, type?: 'success' | 'error') => void;

/** 「全部目录」与「未归类」用两个不可能与真实目录 id 冲突的保留值。 */
export const REFERENCE_FOLDER_ALL = '*';
export const REFERENCE_FOLDER_NONE = '';

export function ReferenceFolderFilter({ store, value, onChange, disabled = false }: { store: Store; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const tree = useMemo(() => referenceFolderTree(store.state.folders), [store.state.folders]);
  return <select
    aria-label={t('按目录筛选')}
    value={value}
    disabled={disabled || !store.ready}
    onChange={event => onChange(event.target.value)}
    className="h-9 min-w-32 rounded-xl border border-gray-200 bg-transparent px-2 text-xs dark:border-gray-800"
  >
    <option value={REFERENCE_FOLDER_ALL}>{t('全部目录')}</option>
    <option value={REFERENCE_FOLDER_NONE}>{t('未归类')}</option>
    {tree.map(node => <option key={node.id} value={node.id}>{`${'　'.repeat(node.depth)}${node.name}`}</option>)}
  </select>;
}

/** 整理参考目录：新建、改名、删除与调整上级，全部沿用风格串目录的乐观锁保存。 */
export function ReferenceFolderDialog({ store, open, onClose, notify }: { store: Store; open: boolean; onClose: () => void; notify: Notify }) {
  const [editing, setEditing] = useState<ReferenceFolder | 'new' | null>(null);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const confirm = useConfirmDialog();
  const busy = store.busy;
  const blocked = busy || !store.ready || Boolean(store.error);
  const tree = useMemo(() => referenceFolderTree(store.state.folders), [store.state.folders]);

  useEffect(() => { if (!open) { setEditing(null); setName(''); setParentId(''); } }, [open]);

  const submit = async () => {
    if (!editing) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const folders = editing === 'new'
      ? [...store.state.folders, { id: createUuid(), name: trimmed, parentId: parentId || null }]
      : store.state.folders.map(folder => folder.id === editing.id ? { ...folder, name: trimmed, parentId: parentId || null } : folder);
    try { await store.save({ ...store.state, folders }); setEditing(null); setName(''); setParentId(''); notify(t('目录已保存'), 'success'); }
    catch (error: any) { notify(error?.message || t('目录保存失败'), 'error'); }
  };

  const remove = async (folder: ReferenceFolder) => {
    if (!await confirm({ title: t('删除目录「{0}」？', [folder.name]), message: t('只删除目录本身，里面的参考图会保留并变成未归类。'), confirmLabel: t('删除'), tone: 'danger' })) return;
    try { await store.save(removeReferenceFolder(store.state, folder.id)); notify(t('目录已删除'), 'success'); }
    catch (error: any) { notify(error?.message || t('目录删除失败'), 'error'); }
  };

  if (!open) return null;
  return <>
    <div className="fixed inset-0 z-[1260] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={t('整理参考目录')} className="appearance-panel max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t('整理参考目录')}</h2><ToolbarButton aria-label={t('关闭')} disabled={busy} onClick={onClose}>×</ToolbarButton></div>
        {store.error && <p role="alert" className="mb-3 text-xs text-red-600">{store.error}</p>}
        <div className="space-y-1">{tree.map(node => <div key={node.id} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800" style={{ paddingLeft: `${8 + node.depth * 16}px` }}>
          <span className="min-w-0 flex-1 truncate text-sm">{node.name}</span>
          <button type="button" disabled={blocked} onClick={() => { setEditing(node); setName(node.name); setParentId(node.parentId || ''); }} className="mobile-touch shrink-0 px-2 text-xs text-gray-500 disabled:opacity-40">{t('重命名')}</button>
          <button type="button" disabled={blocked} onClick={() => void remove(node)} className="mobile-touch shrink-0 px-2 text-xs text-red-600 disabled:opacity-40">{t('删除')}</button>
        </div>)}{!tree.length && <p className="py-6 text-center text-xs text-gray-500">{t('还没有目录，先新建一个')}</p>}</div>
        <button type="button" disabled={blocked} onClick={() => { setEditing('new'); setName(''); setParentId(''); }} className="mobile-touch mt-4 w-full rounded-xl border border-indigo-300 px-3 py-2 text-sm font-bold text-indigo-700 disabled:opacity-40 dark:border-indigo-800 dark:text-indigo-300">{t('新建目录')}</button>
      </div>
    </div>
    {editing && <DirectoryNodeDialog
      title={editing === 'new' ? '新建目录' : '重命名目录'}
      nodes={store.state.folders}
      name={name}
      parentId={parentId}
      editingId={editing === 'new' ? undefined : editing.id}
      busy={busy}
      disabled={blocked}
      onNameChange={setName}
      onParentChange={setParentId}
      onSubmit={submit}
      onClose={() => setEditing(null)}
    />}
  </>;
}

/** 详情页把某张参考放进一个或多个目录：与风格串一致，多归属即时保存。 */
export function ReferenceFolderChecklist({ store, assetId, notify }: { store: Store; assetId: string; notify: Notify }) {
  const selectedIds = getReferenceFolderIds(store.state, assetId);
  const toggle = async (id: string, checked: boolean) => {
    try { await store.save(updateReferenceFolderMemberships(store.state, [assetId], { [id]: checked })); }
    catch (error: any) { notify(error?.message || t('目录保存失败'), 'error'); }
  };
  return <DirectoryTreeChecklist
    nodes={store.state.folders}
    selectedIds={selectedIds}
    onToggle={(id, checked) => void toggle(id, checked)}
    disabled={store.busy || !store.ready || Boolean(store.error)}
    label={t('所在目录')}
    collapsible
  />;
}
