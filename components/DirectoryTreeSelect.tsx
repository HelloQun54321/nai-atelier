import React, { useMemo } from 'react';
import { flattenDirectoryTree, type DirectoryTreeNode } from '../services/directoryTree.mjs';

export interface DirectoryTreeSelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  nodes: DirectoryTreeNode[];
  rootLabel?: string;
  excludeIds?: readonly string[];
}

export function DirectoryTreeSelect({ nodes, rootLabel, excludeIds = [], ...props }: DirectoryTreeSelectProps) {
  const tree = useMemo(() => flattenDirectoryTree(nodes), [nodes]);
  const excluded = new Set(excludeIds);
  return <select {...props}>{rootLabel !== undefined && <option value="">{rootLabel}</option>}{tree.filter(node => !excluded.has(node.id)).map(node => <option key={node.id} value={node.id}>{node.path.join(' / ')}</option>)}</select>;
}
