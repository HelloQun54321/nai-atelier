import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, Heart, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { flattenDirectoryTree, type DirectoryTreeNode } from '../services/directoryTree.mjs';
import { t, useLanguage } from '../services/i18n';
import { ToolbarButton } from './DesignSystem';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { MobileBottomSheet } from './MobileUI';

export const DIRECTORY_FAVORITES_ID = '#favorites';

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
  virtualNodes?: readonly { id: string; name: string }[];
  embedded?: boolean;
  widthClassName?: string;
  disabled?: boolean;
  actionDisabled?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  onCreate?: (parentId: string | null) => void;
  onRename?: (id: string) => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string, parentId: string | null) => void;
  onReset?: () => void;
  /** 手机直达底部选择面板：展开即打开图二，关闭／选中后回调以收起顶栏展开态；未传则保留嵌入路径条（如筛选内目录）。 */
  onRequestClose?: () => void;
  selectLabel?: string;
  createLabel?: string;
  renameLabel?: string;
  deleteLabel?: string;
  resetLabel?: string;
  nodeProps?: (id: string) => React.HTMLAttributes<HTMLButtonElement>;
  nodeMeta?: (id: string) => React.ReactNode;
  nodeActions?: (id: string, context?: { closePicker?: () => void }) => React.ReactNode;
  nodeLeading?: (id: string) => React.ReactNode;
}

const readBranches = (key: string): Record<string, boolean> => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')) : {};
  } catch { return {}; }
};
const DIRECTORY_DRAG_MIME = 'application/x-nai-directory-node-';

export function DirectoryTreeNavigation({ id, label, title, className, asideProps, nodes, selectedId, selectedIds, onSelect, expanded, preferenceKey, counts, totalCount, unclassifiedCount, allLabel, unclassifiedLabel, hideSpecial = false, virtualNodes = [], embedded = false, widthClassName = 'md:w-52', disabled = false, actionDisabled = disabled, header, footer, onCreate, onRename, onDelete, onMove, onReset, onRequestClose, selectLabel, createLabel, renameLabel, deleteLabel, resetLabel, nodeProps, nodeMeta, nodeActions, nodeLeading }: DirectoryTreeNavigationProps) {
  useLanguage();
  const generatedId = useId();
  const navigationId = id || generatedId;
  const tree = useMemo(() => flattenDirectoryTree(nodes), [nodes]);
  const countIds = useMemo(() => new Map(['*', '', ...virtualNodes.map(node => node.id), ...nodes.map(node => node.id)].map((value, index) => [value, `${navigationId}-count-${index}`])), [nodes, virtualNodes, navigationId]);
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const parents = useMemo(() => new Set(nodes.map(node => node.parentId)), [nodes]);
  const dragMime = DIRECTORY_DRAG_MIME + generatedId.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  const drag = useRef<{ id: string; scope: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null | undefined>();
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches);
  const moveAvailable = Boolean(onMove) && !disabled && !actionDisabled;
  const mobileDirectSheet = Boolean(onRequestClose);
  const clearDrag = () => { drag.current = null; setDraggingId(null); setDropTarget(undefined); };
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const branches = view.key === preferenceKey ? view.branches : readBranches(preferenceKey);
  useEffect(() => {
    if (!expanded || disabled) {
      setPickerOpen(false);
      return;
    }
    // 直达模式：手机展开即打开选择面板，不再经过中间路径条。
    if (mobileDirectSheet && isMobile) setPickerOpen(true);
  }, [expanded, disabled, mobileDirectSheet, isMobile]);
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
  const selectedVirtual = virtualNodes.filter(node => selected.has(node.id));
  const selectionCount = currentSelection.length + selectedVirtual.length + Number(selected.has(''));
  const mobileValue = !hideSpecial && selected.has('*') ? '*' : selectionCount > 1 ? '#selected' : currentSelection[0]?.id ?? selectedVirtual[0]?.id ?? (!hideSpecial && selected.has('') ? '' : '#selected');
  const special = [...(hideSpecial ? [] : [{ id: '*', name: allLabel ?? t('全部') }, { id: '', name: unclassifiedLabel ?? t('未归类') }]), ...virtualNodes];
  const count = (value: string) => value === '*' ? totalCount ?? counts?.get(value) : value === '' ? unclassifiedCount ?? counts?.get(value) : counts?.get(value);
  const countNode = (value: string) => count(value) === undefined ? null : <span id={countIds.get(value)} className="shrink-0 text-xs tabular-nums opacity-60">{count(value)}</span>;
  const optionLabel = (value: string, name: string) => count(value) === undefined ? name : `${name} (${count(value)})`;
  const mobileOptions = [
    ...(mobileValue === '#selected' ? [{ id: '#selected', name: t('已选 {0} 个目录', [selectionCount]), disabled: true as const }] : []),
    ...special.map(node => ({ id: node.id, name: optionLabel(node.id, node.name), disabled: false as const })),
    ...tree.map(node => ({ id: node.id, name: optionLabel(node.id, node.path.join(' / ')), disabled: false as const })),
  ];
  const mobileLabel = mobileOptions.find(option => option.id === mobileValue)?.name
    ?? (mobileValue === '#selected' ? t('已选 {0} 个目录', [selectionCount]) : selectLabel ?? t('选择目录'));
  const pickerTitle = selectLabel ?? t('选择目录');
  const closePicker = () => {
    setPickerOpen(false);
    // 仅手机直达面板关闭／选中后收起顶栏展开态；电脑侧栏上顺带打开的路径面板不影响展开。
    if (mobileDirectSheet && isMobile) onRequestClose?.();
  };
  const pickDirectory = (value: string) => {
    if (disabled || value === '#selected') return;
    onSelect(value);
    closePicker();
  };
  const openManagement = (action: () => void) => {
    // 先收起选择面板，避免与新建／编辑窗口叠两层；不回调 onRequestClose，以便编辑取消后顶栏仍保持展开语义。
    setPickerOpen(false);
    action();
  };
  const managementButtons = <>
    {onCreate && <ToolbarButton aria-label={createLabel ?? t('新建目录')} title={createLabel ?? t('新建目录')} disabled={disabled || actionDisabled} onClick={() => openManagement(() => onCreate(current?.id ?? null))} className="!px-2"><Plus className="h-4 w-4" /></ToolbarButton>}
    {current && onRename && <ToolbarButton aria-label={renameLabel ?? t('重命名目录')} title={renameLabel ?? t('重命名目录')} disabled={disabled || actionDisabled} onClick={() => openManagement(() => onRename(current.id))} className="!px-2"><Pencil className="h-4 w-4" /></ToolbarButton>}
    {current && onDelete && <ToolbarButton aria-label={deleteLabel ?? t('删除目录')} title={deleteLabel ?? t('删除目录')} disabled={disabled || actionDisabled} onClick={() => openManagement(() => onDelete(current.id))} className="!px-2"><Trash2 className="h-4 w-4" /></ToolbarButton>}
    {onReset && <ToolbarButton aria-label={resetLabel ?? t('恢复默认目录树')} title={resetLabel ?? t('恢复默认目录树')} disabled={disabled || actionDisabled} onClick={() => openManagement(onReset)} className="!px-2"><RotateCcw className="h-4 w-4" /></ToolbarButton>}
  </>;
  const hasManagement = !!(onCreate || onRename && current || onDelete && current || onReset);
  const renderNodeLabel = (text: string, metaNode?: React.ReactNode) => metaNode ? (
    <span className="min-w-0 flex-1">
      <span className="block truncate leading-tight">{text}</span>
      <span className="mt-1 flex items-center gap-1 truncate">{metaNode}</span>
    </span>
  ) : (
    <span className="min-w-0 flex-1 truncate">{text}</span>
  );
  const pickerSheet = (
    <ImagePreviewPortal>
      <MobileBottomSheet open={pickerOpen} title={pickerTitle} onClose={closePicker} headerActions={mobileDirectSheet && hasManagement ? managementButtons : undefined}>
        <div role="listbox" aria-label={pickerTitle} data-directory-selected={mobileValue} className="space-y-1">
          {mobileOptions.map(option => {
            const active = !option.disabled && option.id === mobileValue;
            const meta = !option.disabled ? nodeMeta?.(option.id) : null;
            const actions = !option.disabled ? nodeActions?.(option.id, { closePicker: () => setPickerOpen(false) }) : null;
            const rowClass = `mobile-touch flex min-h-11 ${actions ? 'min-w-0 flex-1' : 'w-full min-w-0'} items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${active ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'} ${option.disabled || disabled ? 'opacity-60' : ''}`;
            const icon = option.id === DIRECTORY_FAVORITES_ID ? <Heart className="h-4 w-4 flex-none" /> : <Folder className="h-4 w-4 flex-none" />;
            // 多选摘要行只用 aria-disabled，避免 disabled 从无障碍树里消失导致测试／读屏找不到。
            if (option.disabled) return <div key={`${option.id}:${option.name}`} role="option" data-value={option.id} aria-selected={false} aria-disabled="true" className={rowClass}>{icon}<span className="min-w-0 flex-1 truncate">{option.name}</span></div>;
            const button = <button key={actions ? undefined : `${option.id}:${option.name}`} type="button" role="option" data-agent-action="browse" data-value={option.id} aria-label={option.name} aria-selected={active} disabled={disabled} onClick={() => pickDirectory(option.id)} className={rowClass}>{icon}{renderNodeLabel(option.name, meta)}</button>;
            return actions
              ? <div key={`${option.id}:${option.name}`} className="flex min-w-0 items-center gap-1">{button}{actions}</div>
              : button;
          })}
        </div>
      </MobileBottomSheet>
    </ImagePreviewPortal>
  );
  const row = (value: string, name: string, path: string, depth: number, node?: DirectoryTreeNode) => {
    const active = selected.has(value);
    const props = nodeProps?.(value) || {};
    const meta = nodeMeta?.(value);
    const hasChildren = node && parents.has(value);
    return <div key={value} onDragOverCapture={event => hoverDirectory(event, node?.id)} onDropCapture={event => dropDirectory(event, node?.id)} onDragLeave={event => { if (directoryPayload(event) && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDropTarget(undefined); }} className={`directory-tree-row group mobile-touch flex min-w-0 items-center gap-2 rounded-lg text-left text-sm ${active ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'} ${node && dropTarget === value ? 'ring-2 ring-indigo-500' : ''} ${disabled ? 'opacity-50' : ''}`} style={{ paddingLeft: 8 + Math.min(depth, 6) * 14 }}>
      {hasChildren ? <button data-agent-action="browse" type="button" disabled={disabled} aria-label={t(open(node) ? '收起目录「{0}」' : '展开目录「{0}」', [path])} aria-expanded={open(node)} onClick={event => { event.stopPropagation(); toggleBranch(node); }} className="flex h-11 w-4 flex-none items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-indigo-500"><>{open(node) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</></button> : <span aria-hidden="true" className="w-4 flex-none" />}
      {nodeLeading?.(value)}
      <button {...props} data-agent-action="browse" type="button" disabled={disabled} draggable={node && onMove ? moveAvailable : props.draggable} onDragStart={event => {
        if (!node || !onMove) { props.onDragStart?.(event); return; }
        if (!moveAvailable) { event.preventDefault(); return; }
        event.stopPropagation(); event.dataTransfer.setData(dragMime, node.id); event.dataTransfer.effectAllowed = 'move';
        drag.current = { id: node.id, scope: preferenceKey }; setDraggingId(node.id); setDropTarget(undefined);
      }} onDragEnd={event => { if (drag.current) { event.stopPropagation(); clearDrag(); } else props.onDragEnd?.(event); }} aria-label={props['aria-label'] || path} title={props.title || path} aria-current={active ? 'page' : undefined} aria-describedby={props['aria-describedby'] || (count(value) !== undefined ? countIds.get(value) : undefined)} onClick={event => { if (disabled) return; props.onClick?.(event); if (!event.defaultPrevented) onSelect(value); }} className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pr-2 text-left focus-visible:outline-2 focus-visible:outline-indigo-500 ${props.className || ''}`}>
        {value === DIRECTORY_FAVORITES_ID ? <Heart className="h-4 w-4 flex-none" /> : <Folder className="h-4 w-4 flex-none" />}{renderNodeLabel(name, meta)}{countNode(value)}
      </button>
      {nodeActions?.(value)}
    </div>;
  };
  if (!expanded) return <aside id={navigationId} hidden aria-label={label} className="hidden" data-directory-selected={mobileValue} />;
  // 手机直达：只挂选择面板，不占顶栏下方中间条；电脑仍展开侧栏树。
  if (mobileDirectSheet && isMobile) {
    return <>
      <aside id={navigationId} hidden aria-label={label} className="hidden" data-directory-selected={mobileValue} />
      {pickerSheet}
    </>;
  }
  return <aside {...asideProps} id={navigationId} aria-label={label} data-directory-selected={mobileValue} className={`directory-tree-navigation flex min-h-0 flex-col overflow-hidden ${embedded ? 'w-full md:h-full' : `workspace-category-navigation appearance-panel workspace-fixed-pane flex-none border-b border-gray-200 p-3 dark:border-gray-800 ${widthClassName} md:border-b-0 md:border-r`} ${className || ''} ${asideProps?.className || ''}`}>
    <div className="directory-tree-header shrink-0">{header}
    <div className="mb-2 flex items-center justify-between gap-1"><span title={title} className="min-w-0 truncate text-xs font-semibold text-gray-500">{title}</span><div className="flex shrink-0 gap-1">
      {onCreate && <ToolbarButton aria-label={createLabel ?? t('新建目录')} title={createLabel ?? t('新建目录')} disabled={disabled || actionDisabled} onClick={() => onCreate(current?.id ?? null)} className="!px-2"><Plus className="h-4 w-4" /></ToolbarButton>}
      {current && onRename && <ToolbarButton aria-label={renameLabel ?? t('重命名目录')} title={renameLabel ?? t('重命名目录')} disabled={disabled || actionDisabled} onClick={() => onRename(current.id)} className="!px-2"><Pencil className="h-4 w-4" /></ToolbarButton>}
      {current && onDelete && <ToolbarButton aria-label={deleteLabel ?? t('删除目录')} title={deleteLabel ?? t('删除目录')} disabled={disabled || actionDisabled} onClick={() => onDelete(current.id)} className="!px-2"><Trash2 className="h-4 w-4" /></ToolbarButton>}
      {onReset && <ToolbarButton aria-label={resetLabel ?? t('恢复默认目录树')} title={resetLabel ?? t('恢复默认目录树')} disabled={disabled || actionDisabled} onClick={onReset} className="!px-2"><RotateCcw className="h-4 w-4" /></ToolbarButton>}
    </div></div></div>
    {/* 嵌入模式在手机侧栏内显示路径条；直达模式仅桌面走到这里，路径条用 md:hidden 藏起（真机不占位，无 Tailwind 的单测仍可点开）。 */}
    <button type="button" data-agent-action="browse" data-appearance="control" data-tone="neutral" data-value={mobileValue} aria-label={pickerTitle} title={pickerTitle} aria-haspopup="dialog" aria-expanded={pickerOpen} disabled={disabled} onClick={() => { if (!disabled) setPickerOpen(true); }} className="mobile-touch flex min-h-11 w-full min-w-0 shrink-0 items-center gap-2 rounded-lg border border-gray-300 bg-transparent px-2 py-2 text-left text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200 md:hidden">
      <span className="min-w-0 flex-1 truncate">{mobileLabel}</span>
      <ChevronDown className="h-4 w-4 flex-none opacity-60" aria-hidden="true" />
    </button>
    {pickerSheet}
    <nav className="directory-tree-scroll-viewport hidden min-h-0 space-y-1 md:block md:flex-1 md:overflow-y-auto" onClickCapture={event => { if (disabled) { event.preventDefault(); event.stopPropagation(); } }} onDropCapture={event => { if (disabled) { event.preventDefault(); event.stopPropagation(); } }} onDragStartCapture={event => { if (disabled) { event.preventDefault(); event.stopPropagation(); } }}>
      {draggingId && moveAvailable && <div role="group" aria-label={t('移到根目录')} data-directory-root-drop="true" onDragOver={event => hoverDirectory(event, null)} onDrop={event => dropDirectory(event, null)} onDragLeave={() => setDropTarget(undefined)} className={`mb-2 rounded-lg border border-dashed px-2 py-2 text-xs ${dropTarget === null ? 'border-indigo-500 text-indigo-600 ring-2 ring-indigo-500 dark:text-indigo-300' : 'border-gray-300 text-gray-500 dark:border-gray-700'}`}>{t('移到根目录')}</div>}
      {special.map(node => row(node.id, node.name, node.name, 0))}{visible.map(node => row(node.id, node.name, node.path.join(' / '), node.depth, node))}
      {dropTarget !== undefined && dropTarget !== null && <p role="status" className="break-words px-2 pt-1 text-xs text-indigo-600 dark:text-indigo-300">{t('移入目录「{0}」', [tree.find(node => node.id === dropTarget)?.path.join(' / ') || ''])}</p>}
    </nav>
    {footer && <div className="shrink-0">{footer}</div>}
  </aside>;
}
