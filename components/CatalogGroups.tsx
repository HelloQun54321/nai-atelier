import React, { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Folder, FolderPlus, X } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { createUuid } from '../services/id';
import { readCatalogGroups, removeCatalogGroup, updateCatalogGroupMemberships, type CatalogGroupKind, type CatalogGroupState } from '../services/catalogGroups';
import { flattenDirectoryTree, getDirectoryDescendantIds, getDirectoryPath } from '../services/directoryTree.mjs';
import { DIRECTORY_FAVORITES_ID, DirectoryTreeNavigation } from './DirectoryTreeNavigation';
import { DirectoryTreeSelect } from './DirectoryTreeSelect';
import { DirectoryTreeChecklist } from './DirectoryTreeChecklist';
import { DirectoryNodeDialog } from './DirectoryNodeDialog';
import { useCatalogGroups } from '../services/useCatalogGroups';
import { IconButton, ToolbarButton } from './DesignSystem';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { useConfirmDialog } from './ConfirmDialog';
import { ImageActivityContext } from './SmartImage';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';

type Notify = (message: string, type?: 'success' | 'error') => void;
const field = 'mobile-touch min-w-0 rounded-lg border border-gray-300 bg-transparent px-2 py-2 text-sm dark:border-gray-700';
const DRAG_TYPE = 'application/x-nai-catalog-group-entries';
const preference = (scope: string) => {
  try { return JSON.parse(localStorage.getItem(`nai_catalog_groups_${scope}`) || '{}') as { expanded?: boolean; active?: string }; } catch { return {}; }
};

export function useCatalogGroupBrowser(kind: CatalogGroupKind, selectedKeys: readonly string[], notify: Notify, scope: string = kind, catalogKeys?: readonly string[], navigationOptions?: { navigationHeader?: React.ReactNode; activeFilterLabel?: string; favorites?: { matches: (key: string) => boolean; count?: number }; virtualGroups?: readonly { id: string; name: string; matches: (key: string) => boolean; count?: number }[]; resolveMembershipKeys?: (keys: readonly string[]) => readonly string[] }) {
  useLanguage();
  const data = useCatalogGroups(kind), navigationId = useId();
  const confirmAction = useConfirmDialog(), active = useContext(ImageActivityContext);
  const activeRef = useRef(active); activeRef.current = active;
  const [removing, setRemoving] = useState(false), [navigationError, setNavigationError] = useState('');
  const removingRef = useRef(false);
  const [view, setView] = useState(() => ({ scope, ...preference(scope) }));
  const current = view.scope === scope ? view : { scope, ...preference(scope) };
  const expanded = Boolean(current.expanded), requested = current.active ?? '*';
  const virtualGroups = [...(navigationOptions?.favorites ? [{ id: DIRECTORY_FAVORITES_ID, name: t('收藏'), ...navigationOptions.favorites }] : []), ...(navigationOptions?.virtualGroups ?? [])];
  const virtualGroup = virtualGroups?.find(group => group.id === requested);
  const activeGroup = !virtualGroup && data.ready && requested !== '*' && requested !== '' && !data.state.groups.some(group => group.id === requested) ? '*' : requested;
  const [dialog, setDialog] = useState<{ scope: string; keys: string[]; editing?: string; parentId?: string | null } | null>(null);
  const dragRef = useRef<{ kind: CatalogGroupKind; scope: string; keys: string[]; token: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null), [dropping, setDropping] = useState(false);
  const dropLock = useRef(false);
  useEffect(() => { if (!active || dialog || data.busy || !data.ready) { dragRef.current = null; setDragOver(null); } }, [active, dialog, data.busy, data.ready, kind, scope]);
  const update = (next: { expanded?: boolean; active?: string }) => {
    const value = { ...current, ...next }; setView(value);
    try { localStorage.setItem(`nai_catalog_groups_${scope}`, JSON.stringify(value)); } catch { /* 本端偏好不可写时仍可使用。 */ }
  };
  const selectGroup = (active: string) => update({ active });
  const activeIds = useMemo(() => data.ready && activeGroup !== '*' && activeGroup !== '' ? getDirectoryDescendantIds(data.state.groups, activeGroup) : new Set<string>(), [data.ready, data.state.groups, activeGroup]);
  const matches = useCallback((key: string) => activeGroup === '*' || (virtualGroup ? virtualGroup.matches(key) : (data.ready && (activeGroup === '' ? !data.state.memberships[key]?.length : data.state.memberships[key]?.some(id => activeIds.has(id)) === true))), [data.ready, data.state, activeGroup, activeIds, virtualGroup]);
  const label = virtualGroup?.name ?? (activeGroup === '*' ? t('全部') : activeGroup === '' ? t('未分组') : data.state.groups.find(group => group.id === activeGroup)?.name || t('全部'));
  const counts = useMemo(() => {
    if (catalogKeys === undefined || !data.ready || data.error) return null;
    const values = new Map<string, number>([['*', 0], ['', 0], ...data.state.groups.map(group => [group.id, 0] as [string, number])]);
    const ancestors = new Map(data.state.groups.map(group => [group.id, getDirectoryPath(data.state.groups, group.id).map(node => node.id)]));
    for (const key of new Set(catalogKeys)) {
      if (key.length > 512 || !(kind === 'artist' ? /^artist:[^\u0000-\u001f\u007f]+$/u : /^(catalog|custom):[^\u0000-\u001f\u007f]+$/u).test(key) || !key.slice(key.indexOf(':') + 1).trim()) continue;
      values.set('*', values.get('*')! + 1);
      const memberships = data.state.memberships[key] || [];
      if (!memberships.length) values.set('', values.get('')! + 1);
      for (const id of new Set(memberships.flatMap(id => ancestors.get(id) || []))) values.set(id, values.get(id)! + 1);
    }
    return values;
  }, [catalogKeys, data.ready, data.error, data.state, kind]);
  const navigationCounts = new Map<string, number | string>(counts ?? [['*', '—'], ['', '—'], ...data.state.groups.map(group => [group.id, '—'] as [string, string])]);
  for (const group of virtualGroups ?? []) navigationCounts.set(group.id, group.count ?? '—');
  const currentGroup = data.state.groups.find(group => group.id === activeGroup);
  const blocked = !data.ready || data.busy || removing || dropping || Boolean(data.error);
  const dragBlocked = blocked || !active || Boolean(dialog);
  const acceptsKey = (key: string) => kind === 'artist' ? key.startsWith('artist:') : key.startsWith('catalog:') || key.startsWith('custom:');
  const internalDrag = (transfer: DataTransfer) => Boolean(dragRef.current && dragRef.current.kind === kind && dragRef.current.scope === scope && Array.from(transfer.types).includes(DRAG_TYPE));
  const cardDragProps = (key: string): React.HTMLAttributes<HTMLElement> => ({
    draggable: !dragBlocked && acceptsKey(key),
    onDragStart: event => {
      if (dragBlocked || !acceptsKey(key)) { event.preventDefault(); return; }
      const keys = [...new Set(selectedKeys.includes(key) ? selectedKeys : [key])];
      if (keys.some(value => !acceptsKey(value))) { event.preventDefault(); return; }
      const token = createUuid(); dragRef.current = { kind, scope, keys, token }; setDragOver(null);
      event.dataTransfer.setData(DRAG_TYPE, token); event.dataTransfer.effectAllowed = 'copy'; event.stopPropagation();
    },
    onDragEnd: () => { dragRef.current = null; setDragOver(null); },
  });
  const hover = (event: React.DragEvent, id: string) => {
    if (!internalDrag(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation();
    const valid = !dragBlocked && data.state.groups.some(group => group.id === id);
    event.dataTransfer.dropEffect = valid ? 'copy' : 'none'; setDragOver(valid ? id : null);
  };
  const drop = async (event: React.DragEvent, id: string) => {
    if (!internalDrag(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation(); setDragOver(null);
    const source = dragRef.current; dragRef.current = null;
    if (!source || event.dataTransfer.getData(DRAG_TYPE) !== source.token || dragBlocked || dropLock.current || !data.state.groups.some(group => group.id === id)) return;
    dropLock.current = true; setDropping(true); setNavigationError('');
    try {
      const keys = navigationOptions?.resolveMembershipKeys?.(source.keys) ?? source.keys;
      if (keys.every(key => data.state.memberships[key]?.includes(id))) return;
      await data.save(updateCatalogGroupMemberships(data.state, keys, { [id]: true })); notify(t('分组已保存'), 'success');
    }
    catch (cause) { const message = cause instanceof Error ? cause.message : '分组保存失败'; setNavigationError(message); notify(t(message), 'error'); }
    finally { dropLock.current = false; setDropping(false); }
  };
  const move = async (id: string, parentId: string | null) => {
    const group = data.state.groups.find(item => item.id === id);
    if (dragBlocked || dropLock.current || !group || (group.parentId ?? null) === parentId) return;
    dropLock.current = true; setDropping(true); setNavigationError('');
    try {
      await data.save(readCatalogGroups({ ...data.state, groups: data.state.groups.map(item => item.id === id ? { ...item, parentId } : item) }));
      notify(t('分组已保存'), 'success');
    } catch (cause) { const message = cause instanceof Error ? cause.message : '分组保存失败'; setNavigationError(message); notify(t(message), 'error'); }
    finally { dropLock.current = false; setDropping(false); }
  };
  const remove = async () => {
    if (!currentGroup || blocked || !active || removingRef.current) return;
    removingRef.current = true; setRemoving(true); setNavigationError('');
    try {
      if (!await confirmAction({ title: t('确认删除分组'), message: t('删除分组仅移除分组归属，条目和图片仍保留。'), confirmLabel: t('删除'), tone: 'danger', rememberKey: 'delete-catalog-group' }) || !activeRef.current) return;
      await data.save(removeCatalogGroup(data.state, currentGroup.id)); selectGroup('');
      notify(t('分组已保存'), 'success');
    } catch (cause) { setNavigationError(cause instanceof Error ? cause.message : '分组保存失败'); }
    finally { removingRef.current = false; setRemoving(false); }
  };
  return {
    ...data, activeGroup, selectGroup, expanded,
    matches, cardDragProps,
    toolbar: <><ToolbarButton aria-label={t('分组导航')} title={[t(expanded ? '收起分类' : '展开分类'), label, navigationOptions?.activeFilterLabel].filter(Boolean).join(' · ')} aria-controls={navigationId} aria-expanded={expanded} active={expanded || activeGroup !== '*' || Boolean(navigationOptions?.activeFilterLabel)} onClick={() => update({ expanded: !expanded })}><Folder /></ToolbarButton>
      {selectedKeys.length > 0 && <ToolbarButton aria-label={t('设置分组')} title={t('设置分组')} disabled={!data.ready || data.busy || Boolean(data.error)} onClick={() => setDialog({ scope, keys: [...new Set(selectedKeys)] })}><FolderPlus /></ToolbarButton>}
      {dialog?.scope === scope && <GroupDialog key={dialog.editing ?? 'members'} keys={dialog.keys} resolveMembershipKeys={navigationOptions?.resolveMembershipKeys} editing={dialog.editing} parentId={dialog.parentId} state={data.state} save={data.save} busy={data.busy} onClose={() => setDialog(null)} onSaved={selectGroup} notify={notify} />}</>,
    navigation: <DirectoryTreeNavigation id={navigationId} label={t('分组导航')} title={t('分组')} nodes={data.state.groups} selectedId={activeGroup} onSelect={selectGroup} expanded={expanded}
      preferenceKey={`nai_catalog_group_branches_${scope}`} counts={navigationCounts} virtualNodes={virtualGroups}
      unclassifiedLabel={t('未分组')} embedded={scope === 'roll-artists'} className={scope === 'roll-artists' ? 'flex-none md:w-52' : undefined} disabled={blocked} header={navigationOptions?.navigationHeader}
      createLabel={t('新建分组')} renameLabel={t('重命名分组')} deleteLabel={t('删除分组')} selectLabel={t('选择分组')}
      asideProps={{ onDragOver: event => hover(event, '*'), onDrop: event => void drop(event, '*'), className: 'catalog-group-navigation' }}
      onCreate={parentId => setDialog({ scope, keys: [], editing: 'new', parentId })}
      onRename={id => setDialog({ scope, keys: [], editing: id })} onDelete={() => void remove()}
      onMove={dragBlocked ? undefined : (id, parentId) => void move(id, parentId)}
      nodeProps={id => ({ onDragOver: event => hover(event, id), onDragLeave: () => setDragOver(current => current === id ? null : current), onDrop: event => void drop(event, id), className: dragOver === id ? 'ring-2 ring-indigo-500' : '' })}
      footer={<>
        {!data.ready && !data.error && <p role="status" className="text-xs text-gray-500">{t('加载中…')}</p>}
        {(data.error || navigationError) && <p role="alert" className="text-xs text-red-500">{t(data.error || navigationError)}<button type="button" onClick={() => void data.reload()}>{t('重新加载')}</button></p>}
      </>} />,
  };
}

function GroupDialog({ keys, resolveMembershipKeys, editing, parentId: initialParentId, state, save, busy, onClose, onSaved, notify }: { keys: string[]; resolveMembershipKeys?: (keys: readonly string[]) => readonly string[]; editing?: string; parentId?: string | null; state: CatalogGroupState; save: (next: CatalogGroupState) => Promise<void>; busy: boolean; onClose: () => void; onSaved: (id: string) => void; notify: Notify }) {
  const confirmAction = useConfirmDialog();
  const active = useContext(ImageActivityContext), dialog = useModalA11y<HTMLDivElement>(active && !editing);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [name, setName] = useState(() => editing && editing !== 'new' ? state.groups.find(group => group.id === editing)?.name || '' : '');
  const [parentId, setParentId] = useState(() => editing && editing !== 'new' ? state.groups.find(group => group.id === editing)?.parentId ?? '' : initialParentId ?? '');
  const [parents, setParents] = useState<Record<string, string>>({});
  const tree = useMemo(() => flattenDirectoryTree(state.groups), [state.groups]);
  const excludedParents = (id: string) => [...getDirectoryDescendantIds(state.groups, id)];
  const parentField = (value: string, onChange: (value: string) => void, excludeIds: string[] = [], label = t('上级目录')) => <DirectoryTreeSelect aria-label={label} nodes={state.groups} rootLabel={t('根目录')} value={value} disabled={locked} excludeIds={excludeIds} onChange={event => onChange(event.target.value)} className={`${field} w-full`} />;
  const [names, setNames] = useState<Record<string, string>>({}), [changes, setChanges] = useState<Record<string, boolean>>({});
  let membershipKeys: readonly string[] = keys;
  try { membershipKeys = resolveMembershipKeys?.(keys) ?? keys; } catch { /* 新增保存时明确报错，已有归属仍可查看和移除。 */ }
  const locked = pending || busy, lock = useRef(false);
  const close = useMobileHistoryLayer(active && !editing, () => { if (locked) return false; onClose(); }, 'catalog-groups');
  useEffect(() => {
    if (!active || editing) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialog.current)) { event.preventDefault(); close(); } };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [active, editing, close, dialog]);
  const perform = async (next: CatalogGroupState, done?: () => void) => {
    if (!active || locked || lock.current) return;
    lock.current = true; setPending(true); setError('');
    try { await save(readCatalogGroups(next)); done?.(); } catch (cause) { setError(cause instanceof Error ? cause.message : '分组保存失败'); } finally { lock.current = false; setPending(false); }
  };
  const remove = async (id: string) => {
    if (locked || !active || !await confirmAction({ title: t('确认删除分组'), message: t('删除分组仅移除分组归属，条目和图片仍保留。'), confirmLabel: t('删除'), tone: 'danger', rememberKey: 'delete-catalog-group' })) return;
    void perform(removeCatalogGroup(state, id), () => setChanges(current => { const next = { ...current }; delete next[id]; return next; }));
  };
  const title = editing ? editing === 'new' ? '新建分组' : '重命名分组' : '设置分组';
  const saveName = () => {
    if (!name.trim() || locked) return;
    try {
      const id = editing === 'new' ? createUuid() : editing!;
      if (editing !== 'new' && !state.groups.some(group => group.id === id)) throw new Error('分组数据无效');
      void perform({ ...state, groups: editing === 'new' ? [...state.groups, { id, name: name.trim(), ...(parentId ? { parentId } : {}) }] : state.groups.map(group => group.id === id ? { ...group, name: name.trim(), ...(parentId ? { parentId } : group.parentId === undefined ? {} : { parentId: null }) } : group) }, () => { onSaved(id); notify(t('分组已保存'), 'success'); onClose(); });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分组保存失败'); }
  };
  if (editing) return <DirectoryNodeDialog title={t(title)} nodes={state.groups} name={name} parentId={parentId} editingId={editing === 'new' ? undefined : editing}
    busy={locked} error={error} onNameChange={setName} onParentChange={setParentId} onSubmit={saveName} onClose={onClose} nameLabel={t('分组名称')} rootLabel={t('根目录')} maxLength={60} />;
  return <ImagePreviewPortal><div hidden={!active} className={active ? 'fixed inset-0 z-[1400] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm' : 'hidden'} onClick={event => { if (event.target === event.currentTarget && !locked) close(); }}><section ref={dialog} role="dialog" aria-modal="true" aria-label={t(title)} className="appearance-panel flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
    <header className="mb-4 flex items-center gap-2"><h2 className="flex-1 font-bold">{t(title)}</h2><IconButton label="关闭" disabled={locked} onClick={close}><X /></IconButton></header>
    <div className="min-h-0 flex-1 overflow-y-auto py-3"><fieldset disabled={locked}>
      {keys.length > 0 && <p className="text-xs text-gray-500">{t('已选 {0} 项', [membershipKeys.length])}</p>}
      {keys.length > 0 && <DirectoryTreeChecklist nodes={state.groups}
        selectedIds={state.groups.filter(group => changes[group.id] ?? membershipKeys.every(key => state.memberships[key]?.includes(group.id))).map(group => group.id)}
        mixedIds={state.groups.filter(group => changes[group.id] === undefined && membershipKeys.some(key => state.memberships[key]?.includes(group.id)) && !membershipKeys.every(key => state.memberships[key]?.includes(group.id))).map(group => group.id)}
        onToggle={(id, value) => setChanges(current => ({ ...current, [id]: value }))} disabled={locked} />}
      {tree.map(group => <div key={group.id} className="space-y-2 border-b border-gray-200 py-2 dark:border-gray-800">
        <div className="flex gap-2"><input aria-label={t('分组名称：{0}', [group.path.join(' / ')])} maxLength={60} value={names[group.id] ?? group.name} onChange={event => setNames(current => ({ ...current, [group.id]: event.target.value }))} className={`${field} flex-1`} /><ToolbarButton disabled={!(names[group.id] ?? group.name).trim() || ((names[group.id] ?? group.name).trim() === group.name && (parents[group.id] ?? group.parentId ?? '') === (group.parentId ?? ''))} onClick={() => void perform({ ...state, groups: state.groups.map(item => item.id === group.id ? { ...item, name: (names[group.id] ?? group.name).trim(), ...((parents[group.id] ?? group.parentId) ? { parentId: parents[group.id] ?? group.parentId } : item.parentId === undefined ? {} : { parentId: null }) } : item) })}>{t('重命名')}</ToolbarButton><ToolbarButton onClick={() => void remove(group.id)}>{t('删除')}</ToolbarButton></div>
        {parentField(parents[group.id] ?? group.parentId ?? '', value => setParents(current => ({ ...current, [group.id]: value })), excludedParents(group.id), t('上级目录：{0}', [group.path.join(' / ')]))}
      </div>)}
      <div className="mt-3 flex gap-2"><input aria-label={t('新分组名称')} maxLength={60} value={name} onChange={event => setName(event.target.value)} className={`${field} flex-1`} /><ToolbarButton disabled={!name.trim()} onClick={() => void perform({ ...state, groups: [...state.groups, { id: createUuid(), name: name.trim(), ...(parentId ? { parentId } : {}) }] }, () => setName(''))}>{t('新建分组')}</ToolbarButton></div>
      {parentField(parentId, setParentId)}
    </fieldset></div>
    {error && <p role="alert" className="py-2 text-sm text-red-500">{t(error)}</p>}
    <footer className="flex justify-end gap-2"><ToolbarButton disabled={locked} onClick={close}>{t('取消')}</ToolbarButton>{keys.length > 0 && <ToolbarButton tone="primary" disabled={locked || !Object.keys(changes).length} onClick={() => {
      try {
        const additions = Object.fromEntries(Object.entries(changes).filter(([, value]) => value));
        const removals = Object.fromEntries(Object.entries(changes).filter(([, value]) => !value));
        let next = state;
        if (Object.keys(additions).length) next = updateCatalogGroupMemberships(next, resolveMembershipKeys?.(keys) ?? keys, additions);
        if (Object.keys(removals).length) next = updateCatalogGroupMemberships(next, keys, removals);
        void perform(next, () => { notify(t('分组已保存'), 'success'); onClose(); });
      } catch (cause) { setError(cause instanceof Error ? cause.message : '分组保存失败'); }
    }}>{t('保存分组')}</ToolbarButton>}</footer>
  </section></div></ImagePreviewPortal>;
}
