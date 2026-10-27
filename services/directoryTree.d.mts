export interface DirectoryTreeNode { id: string; name: string; parentId?: string | null }
export function validateDirectoryTree(nodes: readonly DirectoryTreeNode[]): void;
export function flattenDirectoryTree<T extends DirectoryTreeNode>(nodes: readonly T[]): Array<T & { depth: number; path: string[] }>;
export function getDirectoryPath<T extends DirectoryTreeNode>(nodes: readonly T[], id: string): T[];
export function getDirectoryDescendantIds(nodes: readonly DirectoryTreeNode[], id: string): Set<string>;
