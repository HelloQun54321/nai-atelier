import React, { useContext, useEffect, useMemo, useState } from 'react';
import { FolderInput, X } from 'lucide-react';
import { t } from '../../services/i18n';
import { createUuid } from '../../services/id';
import { getChainFolderIds, removeChainFolder, type ChainFolder } from '../../services/chainFolders';
import type { useChainFolders } from '../../services/useChainFolders';
import { ToolbarButton } from '../DesignSystem';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { ImageActivityContext } from '../SmartImage';
import { useMobileHistoryLayer } from '../MobileUI';
import { useConfirmDialog } from '../ConfirmDialog';
import { DIRECTORY_FAVORITES_ID, DirectoryTreeNavigation } from '../DirectoryTreeNavigation';
import { DirectoryTreeChecklist } from '../DirectoryTreeChecklist';
import { DirectoryNodeDialog } from '../DirectoryNodeDialog';

export const CHAIN_FOLDER_DRAG_TYPE = 'application/x-novelai-style-chain-ids';
type Store = ReturnType<typeof useChainFolders>;
type Notify = (message: string, type?: 'success' | 'error') => void;

function FolderDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: React.ReactNode }) {
  const active = useContext(ImageActivityContext);
  const ref = useModalA11y<HTMLDivElement>(active);
  const close = () => { if (!active || busy || !isTopmostModal(ref.current)) return false; onClose(); };
  const requestClose = useMobileHistoryLayer(active, close, 'chain-folder');
  useEffect(() => {
    if (!active) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(ref.current)) { event.preventDefault(); if (!busy) requestClose(); } };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [active, busy, requestClose]);
  return <div hidden={!active} className={active ? "fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" : "hidden"} onMouseDown={event => { if (active && !busy && event.target === event.currentTarget) requestClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={t(title)} className="appearance-panel max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(title)}</h2><ToolbarButton aria-label={t('关闭')} disabled={busy} onClick={requestClose}><X /></ToolbarButton></div>{children}
    </div>
  </div>;
}

export function ChainFolderNavigation({ store, selected, onSelect, chainIds, favoriteCount, onMove, notify, disabled = false, expanded = true, countsPending = false }: {
  store: Store; selected: string; onSelect: (id: string) => void; chainIds: string[];
  favoriteCount?: number | string;
  countsPending?: boolean;
  onMove: (ids: string[], folderId: string) => Promise<void>; notify: Notify; disabled?: boolean; expanded?: boolean;
}) {
  const [editing, setEditing] = useState<ChainFolder | 'new' | null>(null);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const confirm = useConfirmDialog();
  const { folders } = store.state;
  const busy = disabled || store.busy;
  const blocked = busy || !store.ready || Boolean(store.error);
  const current = folders.find(folder => folder.id === selected);
  const counts = useMemo(() => {
    const result = new Map<string, number>(folders.map(folder => [folder.id, 0]));
    result.set('*', new Set(chainIds).size); result.set('', 0);
    const parents = new Map(folders.map(folder => [folder.id, folder.parentId]));
    for (const chainId of new Set(chainIds)) {
      const memberships = getChainFolderIds(store.state, chainId);
      if (!memberships.length) result.set('', (result.get('') || 0) + 1);
      const included = new Set<string>();
      for (const folder of memberships) {
        let cursor = folder;
        while (cursor) { included.add(cursor); cursor = parents.get(cursor) || ''; }
      }
      for (const folder of included) result.set(folder, (result.get(folder) || 0) + 1);
    }
    return new Map<string, number | string>([...result].map(([id, count]) => [id, countsPending ? '—' : count]));
  }, [chainIds, store.state, folders, countsPending]);
  const open = (folder: ChainFolder | 'new') => {
    setEditing(folder); setName(folder === 'new' ? '' : folder.name);
    setParentId(folder === 'new' ? current?.id || '' : folder.parentId || '');
  };
  const save = async () => {
    if (!editing || blocked || !name.trim()) return;
    try {
      // 手机经局域网 HTTP 打开时属于非安全上下文，部分浏览器不提供 crypto.randomUUID；
      // 这一句原本在 try 之外，同步抛错会绕过下方的错误反馈，表现为点「保存」毫无反应。
      // 改用项目统一的 createUuid，并把 ID 构造一起放进 try，任何准备阶段失败都能提示。
      const folder: ChainFolder = { id: editing === 'new' ? createUuid() : editing.id, name: name.trim(), parentId: parentId || null };
      await store.save({ ...store.state, folders: editing === 'new' ? [...folders, folder] : folders.map(item => item.id === folder.id ? folder : item) });
      setEditing(null); onSelect(folder.id); notify('文件夹已保存', 'success');
    } catch (cause) { notify(cause instanceof Error ? cause.message : '保存文件夹失败', 'error'); }
  };
  const remove = async () => {
    if (!current || blocked) return;
    if (!await confirm({ title: t('删除文件夹「{0}」？', [current.name]), message: t('仅移除本文件夹的归属，其他归属保留；无归属的风格串回到未整理。子文件夹移到上一级，同名时加编号。配方与图片保留。'), confirmLabel: t('删除文件夹'), tone: 'danger' })) return;
    try { await store.save(removeChainFolder(store.state, current.id)); onSelect(''); notify('文件夹已删除，风格串已保留', 'success'); }
    catch (cause) { notify(cause instanceof Error ? cause.message : '删除文件夹失败', 'error'); }
  };
  const moveFolder = async (id: string, targetParentId: string | null) => {
    if (blocked) return;
    try {
      await store.save({ ...store.state, folders: folders.map(folder => folder.id === id ? { ...folder, parentId: targetParentId } : folder) });
      notify('文件夹已保存', 'success');
    } catch (cause) { notify(cause instanceof Error ? cause.message : '保存文件夹失败', 'error'); }
  };
  const drop = (event: React.DragEvent, id: string) => {
    if (!event.dataTransfer.types.includes(CHAIN_FOLDER_DRAG_TYPE)) return;
    event.preventDefault(); setDragOver(null);
    if (blocked || !folders.some(folder => folder.id === id)) return;
    try {
      const ids: unknown = JSON.parse(event.dataTransfer.getData(CHAIN_FOLDER_DRAG_TYPE));
      if (Array.isArray(ids)) void onMove(ids.filter((item): item is string => typeof item === 'string' && chainIds.includes(item)), id);
    } catch { /* 外部文件和文字不作为风格串移动。 */ }
  };
  return <>
    <DirectoryTreeNavigation label={t('风格串文件夹')} title={t('文件夹')} nodes={folders} selectedId={selected} onSelect={onSelect} expanded={expanded} preferenceKey="nai-style-folder-branches" counts={new Map<string, number | string>([...counts, [DIRECTORY_FAVORITES_ID, favoriteCount ?? '—']])} virtualNodes={[{ id: DIRECTORY_FAVORITES_ID, name: t('收藏') }]} disabled={busy} actionDisabled={blocked}
      className="chain-folder-navigation" selectLabel={t('选择文件夹')} createLabel={t('新建文件夹')} renameLabel={t('编辑文件夹')} deleteLabel={t('删除文件夹')} unclassifiedLabel={t('未整理')}
      onCreate={() => open('new')} onRename={id => { const folder = folders.find(item => item.id === id); if (folder) open(folder); }} onDelete={() => void remove()}
      onMove={(id, targetParentId) => void moveFolder(id, targetParentId)}
      header={<>{!store.ready && !store.error && <p role="status" className="text-xs text-gray-500">{t('正在加载文件夹…')}</p>}{store.error && <div role="alert" className="mb-2 text-xs text-red-500">{t(store.error)}<button type="button" onClick={() => void store.reload()} className="mobile-touch ml-2 underline">{t('重新加载')}</button></div>}</>}
      nodeProps={id => ({
        onDragOver: event => { if (!blocked && folders.some(folder => folder.id === id) && event.dataTransfer.types.includes(CHAIN_FOLDER_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'link'; setDragOver(id); } },
        onDragLeave: () => setDragOver(null), onDrop: event => drop(event, id),
        className: dragOver === id ? 'ring-2 ring-indigo-500' : '',
      })}
    />
    {editing && <DirectoryNodeDialog title={editing === 'new' ? '新建文件夹' : '编辑文件夹'} nodes={folders} name={name} parentId={parentId} editingId={editing === 'new' ? undefined : editing.id} nameLabel={t('文件夹名称')} parentLabel={t('上级文件夹')} maxLength={60} busy={busy} disabled={blocked} onNameChange={setName} onParentChange={setParentId} onSubmit={save} onClose={() => setEditing(null)} />}
  </>;
}

export function ChainFolderMembershipDialog({ store, ids, onSave, onClose }: { store: Store; ids: string[]; onSave: (ids: string[], changes: Record<string, boolean>) => Promise<void>; onClose: () => void }) {
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const selectedIds: string[] = [], mixedIds: string[] = [];
  for (const folder of store.state.folders) {
    const count = ids.filter(id => getChainFolderIds(store.state, id).includes(folder.id)).length;
    const touched = Object.hasOwn(changes, folder.id);
    if (touched ? changes[folder.id] : count === ids.length) selectedIds.push(folder.id);
    if (!touched && count > 0 && count < ids.length) mixedIds.push(folder.id);
  }
  return <ImagePreviewPortal><FolderDialog title="设置文件夹" busy={store.busy} onClose={onClose}>
    <p className="mb-3 text-sm text-gray-500">{t('已选 {0} 条风格串', [ids.length])}</p>
    <DirectoryTreeChecklist nodes={store.state.folders} selectedIds={selectedIds} mixedIds={mixedIds} disabled={store.busy} onToggle={(id, checked) => setChanges(previous => ({ ...previous, [id]: checked }))} />
    <div className="mt-5 flex justify-end gap-2"><ToolbarButton disabled={store.busy} onClick={onClose}>{t('取消')}</ToolbarButton><ToolbarButton disabled={store.busy || !store.ready || Boolean(store.error) || !Object.keys(changes).length} tone="primary" onClick={() => void onSave(ids, changes)}><FolderInput />{t('保存')}</ToolbarButton></div>
  </FolderDialog></ImagePreviewPortal>;
}
