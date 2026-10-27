import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, Pencil, Plus, Trash2 } from 'lucide-react';
import { flattenDirectoryTree, type DirectoryTreeNode } from '../services/directoryTree.mjs';
import { t, useLanguage } from '../services/i18n';
import { ToolbarButton } from './DesignSystem';

export interface DirectoryTreeNavigationProps {
  id?: string;
  label: string;
  title: string;
  className?: string;
  asideProps?: React.HTMLAttributes<HTMLElement>;
  nodes: DirectoryTreeNode[];
  selectedId: string;
  selectedIds?: string[];
  onSelect: (id: string) => void;
  expanded: boolean;
  preferenceKey: string;
  counts?: ReadonlyMap<string, number | string>;
  totalCount?: number | string;
  unclassifiedCount?: number | string;
  allLabel?: string;
  unclassifiedLabel?: string;
  hideSpecial?: boolean;
  embedded?: boolean;
  disabled?: boolean;
  actionDisabled?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  onCreate?: (parentId: string | null) => void;
  onRename?: (id: string) => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string, parentId: string | null) => void;
  selectLabel?: string;
  createLabel?: string;
  renameLabel?: string;
  deleteLabel?: string;
  nodeProps?: (id: string) => React.HTMLAttributes<HTMLButtonElement>;
  nodeActions?: (id: string) => React.ReactNode;
  nodeLeading?: (id: string) => React.ReactNode;
}

const readBranches = (key: string): Record<string, boolean> => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')) : {};
  } catch { return {}; }
};
const DIRECTORY_DRAG_MIME = 'application/x-nai-directory-node-';

export function DirectoryTreeNavigation({ id, label, title, className, asideProps, nodes, selectedId, selectedIds, onSelect, expanded, preferenceKey, counts, totalCount, unclassifiedCount, allLabel, unclassifiedLabel, hideSpecial = false, embedded = false, disabled = false, actionDisabled = disabled, header, footer, onCreate, onRename, onDelete, onMove, selectLabel, createLabel, renameLabel, deleteLabel, nodeProps, nodeActions, nodeLeading }: DirectoryTreeNavigationProps) {
  useLanguage();
  const generatedId = useId();
  const navigationId = id || generatedId;
  const tree = useMemo(() => flattenDirectoryTree(nodes), [nodes]);
  const countIds = useMemo(() => new Map(['*', '', ...nodes.map(node => node.id)].map((value, index) => [value, `${navigationId}-count-${index}`])), [nodes, navigationId]);
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const parents = useMemo(() => new Set(nodes.map(node => node.parentId)), [nodes]);
  const dragMime = DIRECTORY_DRAG_MIME + generatedId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const drag = useRef<{ id: string; scope: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null | undefined>();
  const moveAvailable = Boolean(onMove) && !disabled && !actionDisabled;
  const clearDrag = () => { drag.current = null; setDraggingId(null); setDropTarget(undefined); };
  useEffect(() => {
    if (!moveAvailable || !expanded || drag.current && (drag.current.scope !== preferenceKey || !byId.has(drag.current.id))) {
      drag.current = null; setDraggingId(null); setDropTarget(undefined);
    }
  }, [moveAvailable, expanded, preferenceKey, byId]);
  const directoryPayload = (event: React.DragEvent) => Array.from(event.dataTransfer?.types || []).some(type => type.startsWith(DIRECTORY_DRAG_MIME));
  const canMove = (parentId: string | null) => {
    const source = drag.current && drag.current.scope === preferenceKey ? byId.get(drag.current.id) : undefined;
    if (!moveAvailable || !source || parentId !== null && !byId.has(parentId) || (source.parentId ?? null) === parentId) return false;
    for (let parent = parentId; parent !== null; parent = byId.get(parent)?.parentId ?? null) if (parent === source.id) return false;
    return true;
  };
  const hoverDirectory = (event: React.DragEvent, parentId: string | null | undefined) => {
    if (!directoryPayload(event)) return;
    event.preventDefault(); event.stopPropagation();
    const valid = parentId !== undefined && Array.from(event.dataTransfer.types).includes(dragMime) && canMove(parentId);
    event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    setDropTarget(valid ? parentId : undefined);
  };
  const dropDirectory = (event: React.DragEvent, parentId: string | null | undefined) => {
    if (!directoryPayload(event)) return;
    event.preventDefault(); event.stopPropagation();
    const source = drag.current;
    const valid = parentId !== undefined && Array.from(event.dataTransfer.types).includes(dragMime) && canMove(parentId) && event.dataTransfer.getData(dragMime) === source?.id;
    clearDrag();
    if (valid && source && parentId !== undefined) {
      if (parentId !== null) {
        const next = { ...branches, [parentId]: true };
        setView({ key: preferenceKey, branches: next });
        try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch { /* 本端偏好不可写时仍可展开。 */ }
      }
      onMove?.(source.id, parentId);
    }
  };
  const selectedKey = JSON.stringify(selectedIds ?? [selectedId]);
  const selected = useMemo(() => new Set<string>(JSON.parse(selectedKey)), [selectedKey]);
  const ancestors = useMemo(() => {
    const values = new Set<string>();
    for (const value of selected) for (let parent = byId.get(value)?.parentId; parent != null; parent = byId.get(parent)?.parentId) {
      if (values.has(parent)) break;
      values.add(parent);
    }
    return values;
  }, [selected, byId]);
  const [view, setView] = useState(() => ({ key: preferenceKey, branches: readBranches(preferenceKey) }));
  const branches = view.key === preferenceKey ? view.branches : readBranches(preferenceKey);
  useEffect(() => {
    setView(previous => {
      const current = previous.key === preferenceKey ? previous.branches : readBranches(preferenceKey);
      const changes = [...ancestors].filter(value => current[value] !== true);
      if (previous.key === preferenceKey && !changes.length) return previous;
      return { key: preferenceKey, branches: { ...current, ...Object.fromEntries(changes.map(value => [value, true])) } };
    });
  }, [ancestors, preferenceKey]);
  const open = (node: DirectoryTreeNode) => branches[node.id] ?? (node.parentId == null || ancestors.has(node.id));
  const toggleBranch = (node: DirectoryTreeNode) => {
    const next = { ...branches, [node.id]: !open(node) };
    setView({ key: preferenceKey, branches: next });
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch { /* 本端偏好不可写时仍可展开。 */ }
  };
  let hiddenBelow = Infinity;
  const visible = tree.filter(node => {
    if (node.depth > hiddenBelow) return false;
    hiddenBelow = open(node) ? Infinity : node.depth;
    return true;
  });
  const current = byId.get(selectedId);
  const currentSelection = tree.filter(node => selected.has(node.id));
  const selectionCount = currentSelection.length + Number(selected.has(''));
  const mobileValue = !hideSpecial && selected.has('*') ? '*' : selectionCount > 1 ? '#selected' : currentSelection[0]?.id ?? (!hideSpecial && selected.has('') ? '' : '#selected');
  const special = hideSpecial ? [] : [{ id: '*', name: allLabel ?? t('全部') }, { id: '', name: unclassifiedLabel ?? t('未归类') }];
  const count = (value: string) => value === '*' ? totalCount ?? counts?.get(value) : value === '' ? unclassifiedCount ?? counts?.get(value) : counts?.get(value);
  const countNode = (value: string) => count(value) === undefined ? null : <span id={countIds.get(value)} className="shrink-0 text-xs tabular-nums opacity-60">{count(value)}</span>;
  const row = (value: string, name: string, path: string, depth: number, node?: DirectoryTreeNode) => {
    const active = selected.has(value);
    const props = nodeProps?.(value) || {};
    const hasChildren = node && parents.has(value);
    return <div key={value} onDragOverCapture={event => hoverDirectory(event, node?.id)} onDropCapture={event => dropDirectory(event, node?.id)} onDragLeave={event => { if (directoryPayload(event) && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDropTarget(undefined); }} className={`directory-tree-row mobile-touch flex min-w-0 items-center gap-2 rounded-lg text-left text-sm ${active ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'} ${node && dropTarget === value ? 'ring-2 ring-indigo-500' : ''} ${disabled ? 'opacity-50' : ''}`} style={{ paddingLeft: 8 + Math.min(depth, 6) * 14 }}>
      {hasChildren ? <button type="button" disabled={disabled} aria-label={t(open(node) ? '收起目录「{0}」' : '展开目录「{0}」', [path])} aria-expanded={open(node)} onClick={event => { event.stopPropagation(); toggleBranch(node); }} className="flex h-11 w-4 flex-none items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-indigo-500"><>{open(node) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</></button> : node ? <span className="w-4 flex-none" /> : null}
      {nodeLeading?.(value)}
      <button {...props} type="button" disabled={disabled} draggable={node && onMove ? moveAvailable : props.draggable} onDragStart={event => {
        if (!node || !onMove) { props.onDragStart?.(event); return; }
        if (!moveAvailable) { event.preventDefault(); return; }
        event.stopPropagation(); event.dataTransfer.setData(dragMime, node.id); event.dataTransfer.effectAllowed = 'move';
        drag.current = { id: node.id, scope: preferenceKey }; setDraggingId(node.id); setDropTarget(undefined);
      }} onDragEnd={event => { if (drag.current) { event.stopPropagation(); clearDrag(); } else props.onDragEnd?.(event); }} aria-label={props['aria-label'] || path} title={props.title || path} aria-current={active ? 'page' : undefined} aria-describedby={props['aria-describedby'] || (count(value) !== undefined ? countIds.get(value) : undefined)} onClick={event => { if (disabled) return; props.onClick?.(event); if (!event.defaultPrevented) onSelect(value); }} className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pr-2 text-left focus-visible:outline-2 focus-visible:outline-indigo-500 ${props.className || ''}`}>
        <Folder className="h-4 w-4 flex-none" /><span className="min-w-0 flex-1 truncate">{name}</span>{countNode(value)}
      </button>
      {nodeActions?.(value)}
    </div>;
  };
  if (!expanded) return <aside id={navigationId} hidden aria-label={label} className="hidden" />;
  return <aside {...asideProps} id={navigationId} aria-label={label} className={`directory-tree-navigation min-h-0 ${embedded ? 'w-full' : 'workspace-category-navigation appearance-panel workspace-fixed-pane flex-none border-b border-gray-200 p-3 dark:border-gray-800 md:w-52 md:overflow-y-auto md:border-b-0 md:border-r'} ${className || ''} ${asideProps?.className || ''}`}>
    {header}
    <div className="mb-2 flex items-center justify-between gap-1"><span title={title} className="min-w-0 truncate text-xs font-semibold text-gray-500">{title}</span><div className="flex shrink-0 gap-1">
      {onCreate && <ToolbarButton aria-label={createLabel ?? t('新建目录')} title={createLabel ?? t('新建目录')} disabled={disabled || actionDisabled} onClick={() => onCreate(current?.id ?? null)} className="!px-2"><Plus className="h-4 w-4" /></ToolbarButton>}
      {current && onRename && <ToolbarButton aria-label={renameLabel ?? t('重命名目录')} title={renameLabel ?? t('重命名目录')} disabled={disabled || actionDisabled} onClick={() => onRename(current.id)} className="!px-2"><Pencil className="h-4 w-4" /></ToolbarButton>}
      {current && onDelete && <ToolbarButton aria-label={deleteLabel ?? t('删除目录')} title={deleteLabel ?? t('删除目录')} disabled={disabled || actionDisabled} onClick={() => onDelete(current.id)} className="!px-2"><Trash2 className="h-4 w-4" /></ToolbarButton>}
    </div></div>
    <select aria-label={selectLabel ?? t('选择目录')} value={mobileValue} disabled={disabled} onChange={event => { if (!disabled) onSelect(event.target.value); }} className="mobile-touch min-h-11 w-full min-w-0 rounded-lg border border-gray-300 bg-transparent px-2 py-2 text-sm dark:border-gray-700 md:hidden">
      {mobileValue === '#selected' && <option value="#selected" disabled>{t('已选 {0} 个目录', [selectionCount])}</option>}
      {special.map(node => <option key={node.id} value={node.id}>{node.name}{count(node.id) === undefined ? '' : ` (${count(node.id)})`}</option>)}
      {tree.map(node => <option key={node.id} value={node.id}>{node.path.join(' / ')}{count(node.id) === undefined ? '' : ` (${count(node.id)})`}</option>)}
    </select>
    <nav className="hidden space-y-1 md:block" onClickCapture={event => { if (disabled) { event.preventDefault(); event.stopPropagation(); } }} onDropCapture={event => { if (disabled) { event.preventDefault(); event.stopPropagation(); } }} onDragStartCapture={event => { if (disabled) { event.preventDefault(); event.stopPropagation(); } }}>
      {draggingId && moveAvailable && <div role="group" aria-label={t('移到根目录')} data-directory-root-drop="true" onDragOver={event => hoverDirectory(event, null)} onDrop={event => dropDirectory(event, null)} onDragLeave={() => setDropTarget(undefined)} className={`mb-2 rounded-lg border border-dashed px-2 py-2 text-xs ${dropTarget === null ? 'border-indigo-500 text-indigo-600 ring-2 ring-indigo-500 dark:text-indigo-300' : 'border-gray-300 text-gray-500 dark:border-gray-700'}`}>{t('移到根目录')}</div>}
      {special.map(node => row(node.id, node.name, node.name, 0))}{visible.map(node => row(node.id, node.name, node.path.join(' / '), node.depth, node))}
      {dropTarget !== undefined && dropTarget !== null && <p role="status" className="break-words px-2 pt-1 text-xs text-indigo-600 dark:text-indigo-300">{t('移入目录「{0}」', [tree.find(node => node.id === dropTarget)?.path.join(' / ') || ''])}</p>}
    </nav>
    {footer}
  </aside>;
}
