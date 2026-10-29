import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { flattenDirectoryTree, type DirectoryTreeNode } from '../services/directoryTree.mjs';
import { t } from '../services/i18n';

export interface DirectoryTreeChecklistProps {
  nodes: DirectoryTreeNode[];
  selectedIds: string[];
  mixedIds?: string[];
  onToggle: (id: string, checked: boolean) => void;
  disabled?: boolean;
  disabledIds?: readonly string[];
  label?: string;
  collapsible?: boolean;
}

export function DirectoryTreeChecklist({ nodes, selectedIds, mixedIds = [], onToggle, disabled = false, disabledIds = [], label, collapsible = false }: DirectoryTreeChecklistProps) {
  const tree = useMemo(() => flattenDirectoryTree(nodes), [nodes]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const parents = new Set(nodes.map(node => node.parentId));
  let hiddenBelow = Infinity;
  const visible = tree.filter(node => {
    if (!collapsible) return true;
    if (node.depth > hiddenBelow) return false;
    hiddenBelow = expanded.has(node.id) ? Infinity : node.depth;
    return true;
  });
  const selected = new Set(selectedIds), mixed = new Set(mixedIds), unavailable = new Set(disabledIds);
  return <fieldset disabled={disabled} aria-label={label} className="min-w-0 space-y-1">{visible.map(node => <div key={node.id} className="flex min-w-0 items-center" style={collapsible ? { paddingLeft: Math.min(node.depth, 6) * 14 } : undefined}>
    {collapsible && (parents.has(node.id) ? <button data-agent-action="browse" type="button" disabled={disabled} aria-label={t(expanded.has(node.id) ? '收起目录「{0}」' : '展开目录「{0}」', [node.path.join(' / ')])} aria-expanded={expanded.has(node.id)} className="flex h-11 w-6 shrink-0 items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-indigo-500" onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })}>{expanded.has(node.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button> : <span className="w-6 shrink-0" />)}
    <label title={node.path.join(' / ')} className="mobile-touch flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pr-2 text-sm" style={!collapsible ? { paddingLeft: Math.min(node.depth, 6) * 14 } : undefined}>
    <input type="checkbox" disabled={disabled || unavailable.has(node.id)} aria-label={node.path.join(' / ')} checked={selected.has(node.id)} aria-checked={mixed.has(node.id) ? 'mixed' : selected.has(node.id)} ref={element => { if (element) element.indeterminate = mixed.has(node.id); }} onChange={event => { if (!disabled && !unavailable.has(node.id)) onToggle(node.id, event.target.checked); }} />
    <Folder className="h-4 w-4 flex-none" /><span className="min-w-0 truncate">{node.name}</span>
  </label></div>)}</fieldset>;
}
