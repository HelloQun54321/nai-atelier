import React, { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Folder, FolderPlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { createUuid } from '../services/id';
import { matchesCatalogGroup, removeCatalogGroup, updateCatalogGroupMemberships, type CatalogGroupKind, type CatalogGroupState } from '../services/catalogGroups';
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

export function useCatalogGroupBrowser(kind: CatalogGroupKind, selectedKeys: readonly string[], notify: Notify, scope: string = kind, catalogKeys?: readonly string[], navigationOptions?: { navigationHeader?: React.ReactNode; activeFilterLabel?: string }) {
  useLanguage();
  const data = useCatalogGroups(kind), navigationId = useId();
  const confirmAction = useConfirmDialog(), active = useContext(ImageActivityContext);
  const activeRef = useRef(active); activeRef.current = active;
  const [removing, setRemoving] = useState(false), [navigationError, setNavigationError] = useState('');
  const removingRef = useRef(false);
  const [view, setView] = useState(() => ({ scope, ...preference(scope) }));
  const current = view.scope === scope ? view : { scope, ...preference(scope) };
  const expanded = Boolean(current.expanded), requested = current.active ?? '*';
  const activeGroup = data.ready && requested !== '*' && requested !== '' && !data.state.groups.some(group => group.id === requested) ? '*' : requested;
  const [dialog, setDialog] = useState<{ scope: string; keys: string[]; editing?: string } | null>(null);
  const dragRef = useRef<{ kind: CatalogGroupKind; scope: string; keys: string[]; token: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null), [dropping, setDropping] = useState(false);
  const dropLock = useRef(false);
  useEffect(() => { if (!active || dialog || data.busy || !data.ready) { dragRef.current = null; setDragOver(null); } }, [active, dialog, data.busy, data.ready, kind, scope]);
  const update = (next: { expanded?: boolean; active?: string }) => {
    const value = { ...current, ...next }; setView(value);
    try { localStorage.setItem(`nai_catalog_groups_${scope}`, JSON.stringify(value)); } catch { /* 本端偏好不可写时仍可使用。 */ }
  };
  const selectGroup = (active: string) => update({ active });
  const matches = useCallback((key: string) => activeGroup === '*' || (data.ready && matchesCatalogGroup(data.state, activeGroup, key)), [data.ready, data.state, activeGroup]);
  const label = activeGroup === '*' ? t('全部') : activeGroup === '' ? t('未分组') : data.state.groups.find(group => group.id === activeGroup)?.name || t('全部');
  const counts = useMemo(() => {
    if (catalogKeys === undefined || !data.ready || data.error) return null;
    const values = new Map<string, number>([['*', 0], ['', 0], ...data.state.groups.map(group => [group.id, 0] as [string, number])]);
    for (const key of new Set(catalogKeys)) {
      if (key.length > 512 || !(kind === 'artist' ? /^artist:[^\u0000-\u001f\u007f]+$/u : /^(catalog|custom):[^\u0000-\u001f\u007f]+$/u).test(key) || !key.slice(key.indexOf(':') + 1).trim()) continue;
      values.set('*', values.get('*')! + 1);
      const memberships = data.state.memberships[key] || [];
      if (!memberships.length) values.set('', values.get('')! + 1);
      for (const id of memberships) if (values.has(id)) values.set(id, values.get(id)! + 1);
    }
    return values;
  }, [catalogKeys, data.ready, data.error, data.state, kind]);
  const count = (id: string) => counts?.get(id) ?? '—';
  const options = <><option value="*">{t('全部')} ({count('*')})</option><option value="">{t('未分组')} ({count('')})</option>{data.state.groups.map(group => <option key={group.id} value={group.id}>{group.name} ({count(group.id)})</option>)}</>;
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
    if (source.keys.every(key => data.state.memberships[key]?.includes(id))) return;
    dropLock.current = true; setDropping(true); setNavigationError('');
    try { await data.save(updateCatalogGroupMemberships(data.state, source.keys, { [id]: true })); notify(t('分组已保存'), 'success'); }
    catch (cause) { const message = cause instanceof Error ? cause.message : '分组保存失败'; setNavigationError(message); notify(t(message), 'error'); }
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
      {dialog?.scope === scope && <ImagePreviewPortal><GroupDialog key={dialog.editing ?? 'members'} keys={dialog.keys} editing={dialog.editing} state={data.state} save={data.save} busy={data.busy} onClose={() => setDialog(null)} onSaved={selectGroup} notify={notify} /></ImagePreviewPortal>}</>,
    navigation: expanded ? <aside id={navigationId} aria-label={t('分组导航')} onDragOver={event => hover(event, '*')} onDrop={event => void drop(event, '*')} className={`${scope === 'roll-artists' ? '' : 'workspace-fixed-pane'} catalog-group-navigation workspace-category-navigation appearance-panel min-h-0 flex-none border-b border-gray-200 p-3 dark:border-gray-800 md:w-52 md:overflow-y-auto md:border-b-0 md:border-r`}>
      {navigationOptions?.navigationHeader}
      <div className="mb-2 flex items-center justify-between gap-1"><span className="text-xs font-semibold text-gray-500">{t('分组')}</span><div className="flex gap-1">
        <ToolbarButton aria-label={t('新建分组')} title={t('新建分组')} disabled={blocked} className="!px-2" onClick={() => setDialog({ scope, keys: [], editing: 'new' })}><Plus className="h-4 w-4" /></ToolbarButton>
        {currentGroup && <><ToolbarButton aria-label={t('重命名分组')} title={t('重命名分组')} disabled={blocked} className="!px-2" onClick={() => setDialog({ scope, keys: [], editing: currentGroup.id })}><Pencil className="h-4 w-4" /></ToolbarButton><ToolbarButton aria-label={t('删除分组')} disabled={blocked} className="!px-2" onClick={() => void remove()}><Trash2 className="h-4 w-4" /></ToolbarButton></>}
      </div></div>
      <select aria-label={t('选择分组')} value={activeGroup} disabled={data.busy || removing} onChange={event => selectGroup(event.target.value)} className={`${field} w-full md:hidden`}>{options}</select>
      <nav className="hidden space-y-1 md:block">{[{ id: '*', name: t('全部') }, { id: '', name: t('未分组') }, ...data.state.groups].map((group, index) => <button key={group.id} type="button" aria-label={group.name} aria-describedby={`${navigationId}-count-${index}`} aria-current={group.id === activeGroup ? 'page' : undefined} disabled={data.busy || removing || dropping} onClick={() => selectGroup(group.id)} onDragOver={event => hover(event, group.id)} onDragLeave={() => setDragOver(current => current === group.id ? null : current)} onDrop={event => void drop(event, group.id)} className={`mobile-touch flex w-full min-w-0 items-center gap-2 rounded-lg py-2 pl-2 pr-2 text-left text-sm disabled:opacity-50 ${dragOver === group.id ? 'ring-2 ring-indigo-500' : ''} ${group.id === activeGroup ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}><Folder className="h-4 w-4 flex-none" /><span className="min-w-0 flex-1 truncate" title={group.name}>{group.name}</span><span id={`${navigationId}-count-${index}`} className="shrink-0 text-xs tabular-nums opacity-60">{count(group.id)}</span></button>)}</nav>
      {!data.ready && !data.error && <p role="status" className="text-xs text-gray-500">{t('加载中…')}</p>}
      {(data.error || navigationError) && <p role="alert" className="text-xs text-red-500">{t(data.error || navigationError)}<button type="button" onClick={() => void data.reload()}>{t('重新加载')}</button></p>}
    </aside> : null,
  };
}

function GroupCheck({ name, count, total, changed, onChange }: { name: string; count: number; total: number; changed?: boolean; onChange: (value: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = changed === undefined && count > 0 && count < total; }, [changed, count, total]);
  return <label className="mobile-touch flex items-center gap-2 py-2"><input ref={ref} type="checkbox" checked={changed ?? count === total} onChange={event => onChange(event.target.checked)} /><span>{name}</span></label>;
}

function GroupDialog({ keys, editing, state, save, busy, onClose, onSaved, notify }: { keys: string[]; editing?: string; state: CatalogGroupState; save: (next: CatalogGroupState) => Promise<void>; busy: boolean; onClose: () => void; onSaved: (id: string) => void; notify: Notify }) {
  const confirmAction = useConfirmDialog();
  const active = useContext(ImageActivityContext), dialog = useModalA11y<HTMLDivElement>(active);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [name, setName] = useState(() => editing && editing !== 'new' ? state.groups.find(group => group.id === editing)?.name || '' : '');
  const [names, setNames] = useState<Record<string, string>>({}), [changes, setChanges] = useState<Record<string, boolean>>({});
  const locked = pending || busy, lock = useRef(false);
  const close = useMobileHistoryLayer(active, () => { if (locked) return false; onClose(); }, 'catalog-groups');
  useEffect(() => {
    if (!active) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialog.current)) { event.preventDefault(); close(); } };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [active, close, dialog]);
  const perform = async (next: CatalogGroupState, done?: () => void) => {
    if (!active || locked || lock.current) return;
    lock.current = true; setPending(true); setError('');
    try { await save(next); done?.(); } catch (cause) { setError(cause instanceof Error ? cause.message : '分组保存失败'); } finally { lock.current = false; setPending(false); }
  };
  const remove = async (id: string) => {
    if (locked || !active || !await confirmAction({ title: t('确认删除分组'), message: t('删除分组仅移除分组归属，条目和图片仍保留。'), confirmLabel: t('删除'), tone: 'danger', rememberKey: 'delete-catalog-group' })) return;
    void perform(removeCatalogGroup(state, id), () => setChanges(current => { const next = { ...current }; delete next[id]; return next; }));
  };
  const title = editing ? editing === 'new' ? '新建分组' : '重命名分组' : '设置分组';
  const saveName = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || locked) return;
    try {
      const id = editing === 'new' ? createUuid() : editing!;
      if (editing !== 'new' && !state.groups.some(group => group.id === id)) throw new Error('分组数据无效');
      void perform({ ...state, groups: editing === 'new' ? [...state.groups, { id, name: name.trim() }] : state.groups.map(group => group.id === id ? { ...group, name: name.trim() } : group) }, () => { onSaved(id); notify(t('分组已保存'), 'success'); onClose(); });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分组保存失败'); }
  };
  return <div hidden={!active} className={active ? 'fixed inset-0 z-[1400] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm' : 'hidden'} onClick={event => { if (event.target === event.currentTarget && !locked) close(); }}><section ref={dialog} role="dialog" aria-modal="true" aria-label={t(title)} className="appearance-panel flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
    <header className="mb-4 flex items-center gap-2"><h2 className="flex-1 font-bold">{t(title)}</h2><IconButton label="关闭" disabled={locked} onClick={close}><X /></IconButton></header>
    {editing ? <form onSubmit={saveName}>
      <label className="mb-3 block text-xs text-gray-500">{t('分组名称')}<input aria-label={t('分组名称')} maxLength={60} value={name} disabled={locked} onChange={event => setName(event.target.value)} className={`${field} mt-2 w-full`} /></label>
      {error && <p role="alert" className="py-2 text-sm text-red-500">{t(error)}</p>}
      <div className="mt-5 flex justify-end gap-2"><ToolbarButton disabled={locked} onClick={close}>{t('取消')}</ToolbarButton><ToolbarButton type="submit" tone="primary" disabled={locked || !name.trim()}>{t('保存')}</ToolbarButton></div>
    </form> : <>
    <div className="min-h-0 flex-1 overflow-y-auto py-3"><fieldset disabled={locked}>
      {keys.length > 0 && <p className="text-xs text-gray-500">{t('已选 {0} 项', [keys.length])}</p>}
      {state.groups.map(group => <div key={group.id} className="border-b border-gray-200 py-2 dark:border-gray-800">
        {keys.length > 0 && <GroupCheck name={group.name} count={keys.filter(key => state.memberships[key]?.includes(group.id)).length} total={keys.length} changed={changes[group.id]} onChange={value => setChanges(current => ({ ...current, [group.id]: value }))} />}
        <div className="flex gap-2"><input aria-label={t('分组名称：{0}', [group.name])} maxLength={60} value={names[group.id] ?? group.name} onChange={event => setNames(current => ({ ...current, [group.id]: event.target.value }))} className={`${field} flex-1`} /><ToolbarButton disabled={!(names[group.id] ?? group.name).trim() || (names[group.id] ?? group.name).trim() === group.name} onClick={() => void perform({ ...state, groups: state.groups.map(item => item.id === group.id ? { ...item, name: names[group.id].trim() } : item) })}>{t('重命名')}</ToolbarButton><ToolbarButton onClick={() => void remove(group.id)}>{t('删除')}</ToolbarButton></div>
      </div>)}
      <div className="mt-3 flex gap-2"><input aria-label={t('新分组名称')} maxLength={60} value={name} onChange={event => setName(event.target.value)} className={`${field} flex-1`} /><ToolbarButton disabled={!name.trim()} onClick={() => void perform({ ...state, groups: [...state.groups, { id: createUuid(), name: name.trim() }] }, () => setName(''))}>{t('新建分组')}</ToolbarButton></div>
    </fieldset></div>
    {error && <p role="alert" className="py-2 text-sm text-red-500">{t(error)}</p>}
    <footer className="flex justify-end gap-2"><ToolbarButton disabled={locked} onClick={close}>{t('取消')}</ToolbarButton>{keys.length > 0 && <ToolbarButton tone="primary" disabled={locked || !Object.keys(changes).length} onClick={() => {
      try { void perform(updateCatalogGroupMemberships(state, keys, changes), () => { notify(t('分组已保存'), 'success'); onClose(); }); } catch (cause) { setError(cause instanceof Error ? cause.message : '分组保存失败'); }
    }}>{t('保存分组')}</ToolbarButton>}</footer>
    </>}
  </section></div>;
}
