import { api } from './api';
import { readPromptLibraryTree, type PromptLibraryTreeState } from './promptLibraryTree.mjs';

export * from './promptLibraryTree.mjs';
export const PROMPT_LIBRARY_DIRECTORIES_CHANGED = 'prompt-library-directories-changed';

export async function loadPromptLibraryDirectories(signal?: AbortSignal): Promise<PromptLibraryTreeState> {
  return readPromptLibraryTree(await api.get('/prompt-library/directories', { cache: 'no-store', signal }));
}

export async function savePromptLibraryDirectories(state: PromptLibraryTreeState): Promise<PromptLibraryTreeState> {
  const saved = readPromptLibraryTree(await api.put('/prompt-library/directories', readPromptLibraryTree(state)));
  window.dispatchEvent(new CustomEvent(PROMPT_LIBRARY_DIRECTORIES_CHANGED, { detail: saved }));
  return saved;
}
