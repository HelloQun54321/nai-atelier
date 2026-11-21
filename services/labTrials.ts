import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptChain } from '../types';
import { LAB_DEFAULT_PARAMS } from './labWorkspace';
import { createUuid } from './id';
import type { GenerationMemoryPreferences } from './appearancePreferences';

export const isLabTrialId = (id?: string) => id === 'playground' || Boolean(id?.startsWith('playground:'));
const keyFor = (owner: string) => `nai-lab-trials-v1:${encodeURIComponent(owner)}`;
export const createLabTrial = (owner: string, name = '试画 1', source?: PromptChain): PromptChain => ({
  ...(source ? structuredClone(source) : { basePrompt: '', negativePrompt: '', modules: [], params: structuredClone(LAB_DEFAULT_PARAMS), variableValues: { subject: '' }, tags: [] }),
  id: `playground:${createUuid()}`, name, description: '', userId: owner, type: 'style', previewImage: undefined,
  createdAt: Date.now(), updatedAt: Date.now(),
});

export const loadLabTrials = (owner: string) => {
  try {
    const raw = sessionStorage.getItem(keyFor(owner)) || localStorage.getItem(keyFor(owner));
    const saved = raw ? JSON.parse(raw) : null;
    const seen = new Set<string>();
    const trials: PromptChain[] = (Array.isArray(saved?.trials) ? saved.trials : []).flatMap((item: any) => {
      if (!item || !isLabTrialId(item.id) || seen.has(item.id)) return [];
      seen.add(item.id);
      return [{ ...createLabTrial(owner, String(item.name || '试画').slice(0, 80)), id: item.id,
        modules: Array.isArray(item.modules) ? item.modules.filter((m: any) => m && typeof m.id === 'string' && typeof m.content === 'string') : [] }];
    });
    if (trials.length) return { trials, activeId: trials.some(trial => trial.id === saved.activeId) ? saved.activeId as string : trials[0].id };
  } catch { /* 损坏的分区索引不覆盖既有工作区草稿，保留旧实验室入口。 */ }
  return { trials: [{ ...createLabTrial(owner), id: 'playground' }], activeId: 'playground' };
};

export const saveLabTrials = (owner: string, state: { trials: PromptChain[]; activeId: string }, remember: boolean, memory: GenerationMemoryPreferences) => {
  const snapshot = (keepModules: boolean) => JSON.stringify({ activeId: state.activeId,
    trials: state.trials.map(trial => ({ id: trial.id, name: trial.name, ...(keepModules ? { modules: trial.modules } : {}) })) });
  try {
    sessionStorage.setItem(keyFor(owner), snapshot(true));
    // 正文与参数继续由既有的逐分区工作区记忆规则管理，这里只记名称及文字模块。
    localStorage.setItem(keyFor(owner), snapshot(remember && memory.globalPrompt));
    return true;
  } catch { return false; }
};

export function useLabTrials(owner: string, remember: boolean, memory: GenerationMemoryPreferences) {
  const [state, setState] = useState(() => ({ owner, ...loadLabTrials(owner) }));
  const live = useRef(state); live.current = state;
  const notifiedFailure = useRef(false);
  useEffect(() => {
    if (state.owner !== owner) { setState({ owner, ...loadLabTrials(owner) }); return; }
    notifiedFailure.current = !saveLabTrials(owner, state, remember, memory);
  }, [state, owner, remember, memory]);
  const update = useCallback((id: string, changes: Partial<PromptChain>) => {
    setState(previous => ({ ...previous, trials: previous.trials.map(trial => trial.id === id
      ? { ...trial, ...changes, id: trial.id, name: trial.name, userId: trial.userId } : trial) }));
  }, []);
  const add = (copy: boolean, name?: string) => {
    const current = live.current;
    const source = current.trials.find(trial => trial.id === current.activeId);
    const trial = createLabTrial(owner, name?.trim().slice(0, 80) || `试画 ${current.trials.length + 1}`, copy ? source : undefined);
    setState(previous => ({ ...previous, trials: [...previous.trials, trial], activeId: trial.id }));
    return trial.id;
  };
  const select = (id: string) => setState(previous => previous.trials.some(trial => trial.id === id) ? { ...previous, activeId: id } : previous);
  const rename = (id: string, name: string) => {
    if (!name.trim()) return;
    setState(previous => ({ ...previous, trials: previous.trials.map(trial => trial.id === id ? { ...trial, name: name.trim().slice(0, 80) } : trial) }));
  };
  const remove = (id: string) => setState(previous => {
    if (previous.trials.length < 2) return previous;
    const trials = previous.trials.filter(trial => trial.id !== id);
    return { ...previous, trials, activeId: previous.activeId === id ? trials[0].id : previous.activeId };
  });
  return { ...state, activeChain: state.trials.find(trial => trial.id === state.activeId)!, update, select, add, rename, remove, memoryFailed: notifiedFailure.current };
}
