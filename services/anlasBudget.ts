import { useCallback, useEffect, useState } from 'react';
import { NAIParams } from '../types';
import { api } from './api';
import { getNaiModelInfo } from './naiModels';

export const DEFAULT_ANLAS_BUDGET = 1666;
export const ANLAS_BUDGET_CHANGED_EVENT = 'nai-anlas-budget-changed';

export interface AnlasBudgetState {
  remaining: number;
  updatedAt?: number;
}

const clampBudget = (value: number) => Math.max(0, Math.min(1_000_000_000, Math.floor(Number(value) || 0)));

/**
 * Mirrors NovelAI's web cost calculator (V4/V4.5/V5 share the same formula)
 * for this project's supported generation fields. Since V5, free Opus
 * generations additionally require remaining Opus usage allowance: when the
 * allowance is overdrawn every image costs Anlas, so opusUsageExhausted
 * removes the free sample for limited models only.
 */
export const estimateV45GenerationCost = (params: NAIParams, opus = true, opusUsageExhausted = false) => {
  const width = Math.max(1, Number(params.width) || 1);
  const height = Math.max(1, Number(params.height) || 1);
  const area = Math.max(65_536, width * height);
  const steps = Math.max(1, Number(params.steps) || 1);
  const samples = 1;
  const vibeCount = params.vibes?.enabled ? params.vibes.slots.length : 0;
  const preciseReferenceCount = params.characterReferences?.enabled ? params.characterReferences.slots.length : 0;
  const baseRaw = Math.ceil(2.951823174884865e-6 * area + 5.753298233447344e-7 * area * steps);
  const baseCost = Math.max(baseRaw, 2);
  const allowanceBlocksFree = opusUsageExhausted && getNaiModelInfo(params.model).opusUsageLimit;
  const freeSamples = opus && !allowanceBlocksFree && area <= 1_048_576 && steps <= 28 ? 1 : 0;
  const generationCost = baseCost * Math.max(0, samples - freeSamples);
  const extraVibeCost = Math.max(0, vibeCount - 4) * 2 * samples;
  return generationCost + extraVibeCost + preciseReferenceCount * 5 * samples;
};

const broadcastBudget = (state: AnlasBudgetState) => {
  window.dispatchEvent(new CustomEvent<AnlasBudgetState>(ANLAS_BUDGET_CHANGED_EVENT, { detail: state }));
};

export const anlasBudgetService = {
  get: async (): Promise<AnlasBudgetState> => api.get('/anlas-budget'),
  set: async (remaining: number): Promise<AnlasBudgetState> => {
    const state = await api.put('/anlas-budget', { remaining: clampBudget(remaining) });
    broadcastBudget(state);
    return state;
  },
};

export const useAnlasBudget = () => {
  const [state, setState] = useState<AnlasBudgetState>({ remaining: DEFAULT_ANLAS_BUDGET });
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setState(await anlasBudgetService.get());
    } catch {
      // Keep the safe default visible while the local data service is starting.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const update = (event: Event) => setState((event as CustomEvent<AnlasBudgetState>).detail);
    const refreshProjectChange = () => void refresh();
    window.addEventListener(ANLAS_BUDGET_CHANGED_EVENT, update);
    window.addEventListener('nai-project-data-changed', refreshProjectChange);
    return () => {
      window.removeEventListener(ANLAS_BUDGET_CHANGED_EVENT, update);
      window.removeEventListener('nai-project-data-changed', refreshProjectChange);
    };
  }, [refresh]);

  return { ...state, loading, refresh };
};
