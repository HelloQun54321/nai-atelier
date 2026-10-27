import React, { useMemo } from 'react';
import { Folder } from 'lucide-react';
import { flattenDirectoryTree, type DirectoryTreeNode } from '../services/directoryTree.mjs';

export interface DirectoryTreeChecklistProps {
  nodes: DirectoryTreeNode[];
  selectedIds: string[];
  mixedIds?: string[];
  onToggle: (id: string, checked: boolean) => void;
  disabled?: boolean;
  disabledIds?: readonly string[];
  label?: string;
}

export function DirectoryTreeChecklist({ nodes, selectedIds, mixedIds = [], onToggle, disabled = false, disabledIds = [], label }: DirectoryTreeChecklistProps) {
  const tree = useMemo(() => flattenDirectoryTree(nodes), [nodes]);
  const selected = new Set(selectedIds), mixed = new Set(mixedIds), unavailable = new Set(disabledIds);
  return <fieldset disabled={disabled} aria-label={label} className="min-w-0 space-y-1">{tree.map(node => <label key={node.id} title={node.path.join(' / ')} className="mobile-touch flex min-h-11 min-w-0 items-center gap-2 rounded-lg py-2 pr-2 text-sm" style={{ paddingLeft: Math.min(node.depth, 6) * 14 }}>
    <input type="checkbox" disabled={disabled || unavailable.has(node.id)} aria-label={node.path.join(' / ')} checked={selected.has(node.id)} aria-checked={mixed.has(node.id) ? 'mixed' : selected.has(node.id)} ref={element => { if (element) element.indeterminate = mixed.has(node.id); }} onChange={event => { if (!disabled && !unavailable.has(node.id)) onToggle(node.id, event.target.checked); }} />
    <Folder className="h-4 w-4 flex-none" /><span className="min-w-0 truncate">{node.name}</span>
  </label>)}</fieldset>;
}
