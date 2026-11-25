import { api } from './api';
import { inferPurposesFromDirectoryIds, readPromptLibraryTree, type PromptLibraryTreeState } from './promptLibraryTree.mjs';
import { readPromptPurposes, type PromptPurposeId } from './promptPurposes.mjs';

export * from './promptLibraryTree.mjs';
export const PROMPT_LIBRARY_DIRECTORIES_CHANGED = 'prompt-library-directories-changed';

const samePurposeSet = (left: readonly string[], right: readonly string[]) => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every(id => rightSet.has(id));
};

/**
 * 目录变更时自动联动用途标注：当用途为空或仍等于旧目录默认推断时，自动切换为新目录用途；
 * 若用户已手动增改过多选用途，则保留人工标注不覆盖。
 */
export function syncPurposesWithDirectories(
  previousDirectoryIds: readonly string[],
  nextDirectoryIds: readonly string[],
  currentPurposes: readonly PromptPurposeId[],
  directories?: PromptLibraryTreeState,
): PromptPurposeId[] {
  const prevInferred = readPromptPurposes(inferPurposesFromDirectoryIds(previousDirectoryIds, directories));
  const nextInferred = readPromptPurposes(inferPurposesFromDirectoryIds(nextDirectoryIds, directories));
  if (!currentPurposes.length || samePurposeSet(currentPurposes, prevInferred)) {
    return nextInferred;
  }
  return [...currentPurposes];
}

/** 目录移动或编辑后重算显式用途：若原本未显式覆盖或等于旧目录推导值，清空以继续实时继承新目录；否则保留人工覆盖。 */
export function resolveExplicitPurposesAfterDirectoryMove(
  previousDirectoryIds: readonly string[],
  explicitPurposes: readonly PromptPurposeId[],
  directories?: PromptLibraryTreeState,
): PromptPurposeId[] {
  if (!explicitPurposes.length) return [];
  const prevInferred = readPromptPurposes(inferPurposesFromDirectoryIds(previousDirectoryIds, directories));
  return samePurposeSet(explicitPurposes, prevInferred) ? [] : [...explicitPurposes];
}

export async function loadPromptLibraryDirectories(signal?: AbortSignal): Promise<PromptLibraryTreeState> {
  return readPromptLibraryTree(await api.get('/prompt-library/directories', { cache: 'no-store', signal }));
}

export interface PromptLibraryDirectoryResetResult {
  tree: PromptLibraryTreeState;
  migratedCount: number;
  unclassifiedCount: number;
}

export async function savePromptLibraryDirectories(state: PromptLibraryTreeState): Promise<PromptLibraryTreeState> {
  const saved = readPromptLibraryTree(await api.put('/prompt-library/directories', readPromptLibraryTree(state)));
  window.dispatchEvent(new CustomEvent(PROMPT_LIBRARY_DIRECTORIES_CHANGED, { detail: saved }));
  return saved;
}

/** 恢复为默认目录树，并触发目录与条目的同步刷新。 */
export async function resetPromptLibraryDirectories(revision?: number): Promise<PromptLibraryDirectoryResetResult> {
  const payload = await api.post('/prompt-library/directories/reset', revision === undefined ? {} : { revision }) as {
    tree?: unknown;
    migratedCount?: unknown;
    unclassifiedCount?: unknown;
  };
  const saved = readPromptLibraryTree(payload?.tree);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROMPT_LIBRARY_DIRECTORIES_CHANGED, { detail: saved }));
    window.dispatchEvent(new CustomEvent('nai-project-data-changed'));
  }
  return {
    tree: saved,
    migratedCount: Number.isFinite(Number(payload?.migratedCount)) ? Number(payload.migratedCount) : 0,
    unclassifiedCount: Number.isFinite(Number(payload?.unclassifiedCount)) ? Number(payload.unclassifiedCount) : 0,
  };
}
