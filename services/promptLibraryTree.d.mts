export type PromptLibraryDirectoryTarget = 'global' | 'character';
export interface PromptLibraryDirectory { id: string; parentId: string | null; name: string; target?: PromptLibraryDirectoryTarget }
export interface PromptLibraryTreeState { revision: number; nodes: PromptLibraryDirectory[] }
export interface PromptLibraryDirectoryEntry { id: string; type?: string; params?: unknown }
export const PROMPT_LIBRARY_DIRECTORY_IDS_KEY: '_promptLibraryDirectoryIds';
export const LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS: Readonly<Record<'appearance' | 'wardrobe' | 'pose' | 'expression' | 'scene' | 'camera' | 'general', string>>;
export function createDefaultPromptLibraryTree(): PromptLibraryTreeState;
export function readPromptLibraryTree(value: unknown): PromptLibraryTreeState;
export function getPromptLibraryDirectoryPath(state: PromptLibraryTreeState, id: string): PromptLibraryDirectory[];
export function flattenPromptLibraryDirectories(state: PromptLibraryTreeState): Array<PromptLibraryDirectory & { depth: number }>;
export function getPromptLibraryDirectoryRollKey(id: string): string;
export function getPromptLibraryDefaultSelection(state: PromptLibraryTreeState): string[];
export function getPromptLibraryDescendantIds(state: PromptLibraryTreeState, id: string): string[];
export function normalizePromptLibraryDirectorySelection(state: PromptLibraryTreeState, ids: readonly string[] | null): string[];
export function getPromptLibraryDirectoryTarget(state: PromptLibraryTreeState, id: string): PromptLibraryDirectoryTarget;
export function getPromptLibraryDirectoryLegacyKind(state: PromptLibraryTreeState, id: string): 'appearance' | 'wardrobe' | 'pose' | 'expression' | 'scene' | 'camera' | 'general' | undefined;
export function isPromptLibraryFragmentEntry(entry: PromptLibraryDirectoryEntry): boolean;
export function getPromptLibraryEntryDirectoryIds(entry: PromptLibraryDirectoryEntry, state: PromptLibraryTreeState): string[];
export function selectPromptLibraryDirectoryEntries<T extends PromptLibraryDirectoryEntry>(entries: readonly T[], state: PromptLibraryTreeState, ids?: readonly string[] | null): T[];
export function removePromptLibraryDirectory(state: PromptLibraryTreeState, id: string): PromptLibraryTreeState;
