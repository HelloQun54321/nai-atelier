import { useCallback, useEffect, useState } from 'react';
import { ImageEditOperation, NAIParams } from '../types';
import { api } from './api';
import { getNaiModelInfo } from './naiModels';
import { DEFAULT_NAI_RUNTIME, NaiRuntimeConfig } from './naiRuntime';

export const DEFAULT_ANLAS_BUDGET = 1666;
export const ANLAS_BUDGET_CHANGED_EVENT = 'nai-anlas-budget-changed';

export interface AnlasPersonalUsage {
  /** 本机在该账号上累计花费的 Anlas（估算口径与本地预算扣减一致）。 */
  anlasSpent: number;
  /** 本机在该账号上计入 Opus 免费额度的生成张数（受限模型 + 免费档）。 */
  opusImages: number;
  updatedAt?: number;
}

export interface AnlasBudgetState {
  remaining: number;
  updatedAt?: number;
  /** 按密钥哈希分账号的个人用量统计（仅设置页展示用）。 */
  personal?: Record<string, AnlasPersonalUsage>;
}

const clampBudget = (value: number) => Math.max(0, Math.min(1_000_000_000, Math.floor(Number(value) || 0)));

const sha256Hex = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
};

/** 按 NovelAI Key 计算与网关一致的身份指纹。 */
export const hashNaiApiKey = async (apiKey: string) => {
  const normalized = apiKey.trim();
  return normalized ? sha256Hex(normalized) : '';
};

// 成本估算使用的官方常量由网关自动同步（services/naiRuntime.ts），默认值兜底。
let estimatorRuntime: NaiRuntimeConfig = DEFAULT_NAI_RUNTIME;
export const applyEstimatorRuntime = (config: NaiRuntimeConfig) => { estimatorRuntime = config; };

/** 生成按钮的费用提示：V5 等受限模型的免费档也会消耗 Opus 额度。 */
export const formatGenerationCostLabel = (cost: number, model?: string): string => {
  const usesOpusAllowance = getNaiModelInfo(model).opusUsageLimit
    || Boolean(model && estimatorRuntime.usageLimitedModels.includes(model));
  if (cost > 0) return `${cost} 点`;
  return usesOpusAllowance ? '消耗额度' : '免费';
};

/**
 * Mirrors NovelAI's web cost calculator for this project's supported generation
 * fields. Since V5, free Opus generations additionally require remaining Opus
 * usage allowance: when the allowance is overdrawn every image costs Anlas, so
 * opusUsageExhausted removes the free sample for limited models only.
 */
export const estimateV45GenerationCost = (params: NAIParams, opus = true, opusUsageExhausted = false) => {
  const width = Math.max(1, Number(params.width) || 1);
  const height = Math.max(1, Number(params.height) || 1);
  const area = Math.max(65_536, width * height);
  const steps = Math.max(1, Number(params.steps) || 1);
  const samples = 1;
  const vibeCount = params.vibes?.enabled ? params.vibes.slots.length : 0;
  const preciseReferenceCount = params.characterReferences?.enabled ? params.characterReferences.slots.length : 0;
  const baseRaw = Math.ceil(estimatorRuntime.costCoefficientArea * area + estimatorRuntime.costCoefficientSteps * area * steps);
  const baseCost = Math.max(baseRaw, 2);
  const allowanceBlocksFree = opusUsageExhausted
    && (estimatorRuntime.usageLimitedModels.includes(params.model ?? '') || getNaiModelInfo(params.model).opusUsageLimit);
  const freeSamples = opus && !allowanceBlocksFree && area <= estimatorRuntime.freeMaxArea && steps <= estimatorRuntime.freeMaxSteps ? 1 : 0;
  const generationCost = baseCost * Math.max(0, samples - freeSamples);
  const extraVibeCost = Math.max(0, vibeCount - 4) * 2 * samples;
  return generationCost + extraVibeCost + preciseReferenceCount * 5 * samples;
};

export const estimateImageEditCost = (
  params: NAIParams,
  operation: ImageEditOperation,
  strength: number,
  focused: boolean,
  opusTier?: number,
  opusUsageExhausted = false,
) => {
  const width = Math.max(1, Number(params.width) || 1);
  const height = Math.max(1, Number(params.height) || 1);
  const area = Math.max(65_536, width * height);
  const steps = Math.max(1, Number(params.steps) || 1);
  const raw = Math.ceil(estimatorRuntime.costCoefficientArea * area + estimatorRuntime.costCoefficientSteps * area * steps);
  const baseCost = Math.max(2, Math.ceil(raw * Math.max(0, Math.min(1, Number(strength) || 0))));
  const vibeCount = params.vibes?.enabled ? params.vibes.slots.length : 0;
  const preciseReferenceCount = params.characterReferences?.enabled ? params.characterReferences.slots.length : 0;
  const focusedFree = (operation === 'inpaint' || operation === 'outpaint')
    && focused
    && opusTier === 4
    && !opusUsageExhausted
    && vibeCount === 0
    && preciseReferenceCount === 0;
  const editCost = focusedFree ? 0 : baseCost;
  return editCost + Math.max(0, vibeCount - 4) * 2 + preciseReferenceCount * 5;
};

export const formatImageEditCostLabel = (cost: number, operation: ImageEditOperation, focused: boolean, opusTier?: number) => {
  if (focused && (operation === 'inpaint' || operation === 'outpaint')) {
    if (opusTier === 4 && cost === 0) return 'Opus 免费';
    if (opusTier === undefined) return '费用以官方返回为准';
  }
  return `${cost} 点`;
};

const broadcastBudget = (state: AnlasBudgetState, keyHash: string) => {
  window.dispatchEvent(new CustomEvent<AnlasBudgetState & { keyHash: string }>(ANLAS_BUDGET_CHANGED_EVENT, { detail: { ...state, keyHash } }));
};

/** 当前激活密钥的哈希（与网关侧 sha256 口径一致）。 */
export const getActiveKeyHash = async () => {
  const apiKey = (sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '').trim();
  return hashNaiApiKey(apiKey);
};

export const anlasBudgetService = {
  get: async (): Promise<AnlasBudgetState> => {
    const keyHash = await getActiveKeyHash();
    return api.get(`/anlas-budget${keyHash ? `?keyHash=${keyHash}` : ''}`);
  },
  set: async (remaining: number): Promise<AnlasBudgetState> => {
    const requestedKeyHash = await getActiveKeyHash();
    const state = await api.put('/anlas-budget', { remaining: clampBudget(remaining), ...(requestedKeyHash ? { keyHash: requestedKeyHash } : {}) });
    if (await getActiveKeyHash() !== requestedKeyHash) return anlasBudgetService.get();
    broadcastBudget(state, requestedKeyHash);
    return state;
  },
  /** 重置当前密钥账号的个人用量统计。 */
  resetPersonal: async (keyHash: string): Promise<AnlasBudgetState> => api.delete('/anlas-budget', { keyHash }),
};

export const useAnlasBudget = () => {
  const [state, setState] = useState<AnlasBudgetState>({ remaining: DEFAULT_ANLAS_BUDGET });
  const [personal, setPersonal] = useState<AnlasPersonalUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const requestedKeyHash = await getActiveKeyHash();
    try {
      const next = await anlasBudgetService.get();
      const currentKeyHash = await getActiveKeyHash();
      if (currentKeyHash !== requestedKeyHash) return;
      setState(next);
      setPersonal(requestedKeyHash ? next.personal?.[requestedKeyHash] || null : null);
    } catch {
      // Keep the safe default visible while the local data service is starting.
    } finally {
      if (await getActiveKeyHash() === requestedKeyHash) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const update = (event: Event) => {
      const detail = (event as CustomEvent<AnlasBudgetState & { keyHash?: string; refreshPersonal?: boolean }>).detail;
      const eventKeyHash = typeof detail?.keyHash === 'string' ? detail.keyHash : null;
      if (eventKeyHash === null) return;
      void getActiveKeyHash().then(currentKeyHash => {
        if (currentKeyHash !== eventKeyHash) return;
        const { keyHash: _keyHash, refreshPersonal: _refreshPersonal, ...stateDetail } = detail;
        setState(previous => ({ ...previous, ...stateDetail }));
        if (stateDetail.personal !== undefined) {
          setPersonal(eventKeyHash ? stateDetail.personal?.[eventKeyHash] || null : null);
        } else if (detail.refreshPersonal) {
          void refresh();
        }
      });
    };
    const refreshProjectChange = () => void refresh();
    const refreshKeyChange = () => {
      setState({ remaining: DEFAULT_ANLAS_BUDGET });
      setPersonal(null);
      setLoading(true);
      void refresh();
    };
    window.addEventListener(ANLAS_BUDGET_CHANGED_EVENT, update);
    window.addEventListener('nai-project-data-changed', refreshProjectChange);
    window.addEventListener('nai-api-key-changed', refreshKeyChange);
    return () => {
      window.removeEventListener(ANLAS_BUDGET_CHANGED_EVENT, update);
      window.removeEventListener('nai-project-data-changed', refreshProjectChange);
      window.removeEventListener('nai-api-key-changed', refreshKeyChange);
    };
  }, [refresh]);

  return { ...state, personal, loading, refresh };
};
