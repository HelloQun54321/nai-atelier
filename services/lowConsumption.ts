import { useEffect, useSyncExternalStore } from 'react';
import type { NAIParams, ImageEditOperation } from '../types';
import type { NaiRuntimeConfig } from './naiRuntime';
import type { NovelaiSubscriptionInfo } from './naiUsage';
import { getRuntimeNaiModelInfo } from './naiModels';
import { fitLowConsumptionDimensions, lowConsumptionRuntimeHealthy, lowConsumptionStepLimit, lowConsumptionViolation } from '../worker/lowConsumptionPolicy.mjs';

export interface LowConsumptionPreferences { enabled: boolean }
const disabled: LowConsumptionPreferences = { enabled: false };
const preferences = new Map<string, LowConsumptionPreferences>();
const listeners = new Set<() => void>();
const revisions = new Map<string, number>();
const pendingReads = new Map<string, Promise<LowConsumptionPreferences>>();
const pendingWrites = new Map<string, Promise<LowConsumptionPreferences>>();
const activeKey = () => (sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '').trim();
const changed = () => listeners.forEach(listener => listener());
export const getCachedLowConsumption = () => preferences.get(activeKey()) || disabled;

const requestPreferences = async (apiKey: string, enabled?: boolean) => {
  if (!apiKey.trim()) {
    if (enabled !== undefined) throw new Error('请先配置 NovelAI Key');
    return disabled;
  }
  const revision = (revisions.get(apiKey.trim()) || 0) + 1;
  revisions.set(apiKey.trim(), revision);
  const response = await fetch('/api/low-consumption', {
    method: enabled === undefined ? 'GET' : 'PUT', cache: 'no-store',
    headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
    ...(enabled === undefined ? {} : { body: JSON.stringify({ enabled }) }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    if (response.status === 401 && failure?.code === 'LAN_ACCESS_REQUIRED') window.dispatchEvent(new CustomEvent('nai-lan-access-required'));
    throw new Error(failure?.error || '读取或保存低消耗设置失败');
  }
  const value = await response.json();
  if (typeof value.enabled !== 'boolean') throw new Error('低消耗设置响应无效');
  const next = { enabled: value.enabled };
  if (revisions.get(apiKey.trim()) === revision) {
    preferences.set(apiKey.trim(), next);
    changed();
  }
  return next;
};
export const getLowConsumption = async (apiKey = activeKey()) => {
  const key = apiKey.trim();
  await pendingWrites.get(key)?.catch(() => {});
  const existing = pendingReads.get(key);
  if (existing) return existing;
  const pending = requestPreferences(key);
  pendingReads.set(key, pending);
  try { return await pending; }
  finally { if (pendingReads.get(key) === pending) pendingReads.delete(key); }
};
export const setLowConsumption = async (enabled: boolean, apiKey = activeKey()) => {
  const key = apiKey.trim();
  pendingReads.delete(key);
  const pending = (pendingWrites.get(key) || Promise.resolve()).catch(() => {}).then(() => requestPreferences(key, enabled));
  pendingWrites.set(key, pending);
  try { return await pending; }
  finally { if (pendingWrites.get(key) === pending) pendingWrites.delete(key); }
};

export const useLowConsumption = () => {
  const value = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, getCachedLowConsumption, getCachedLowConsumption);
  useEffect(() => {
    const refresh = () => { changed(); void getLowConsumption().catch(() => {}); };
    refresh();
    window.addEventListener('nai-api-key-changed', refresh);
    window.addEventListener('nai-project-data-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('nai-api-key-changed', refresh);
      window.removeEventListener('nai-project-data-changed', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return value;
};

// 只计算实际生成参数，保留原草稿和资产配置；Strength、模型和 Seed 不由该策略改变。
export const applyLowConsumptionParams = (params: NAIParams, enabled: boolean, runtime: NaiRuntimeConfig, operation: 'text-to-image' | ImageEditOperation = 'text-to-image'): NAIParams => {
  if (!enabled) return params;
  return {
    ...params,
    steps: Math.min(params.steps, lowConsumptionStepLimit(params.model, runtime.freeMaxSteps)),
    ...(operation === 'text-to-image' ? fitLowConsumptionDimensions(params.width, params.height, runtime.freeMaxArea) : {}),
    ...(params.characterReferences ? { characterReferences: { ...params.characterReferences, enabled: false } } : {}),
  };
};

export const assertLowConsumptionEstimate = (params: NAIParams, operation: 'text-to-image' | ImageEditOperation,
  runtime: NaiRuntimeConfig, subscription: NovelaiSubscriptionInfo | null, estimatedCost: number, remaining: number, focused = false) => {
  const usageLimited = getRuntimeNaiModelInfo(params.model, runtime).opusUsageLimit;
  if (operation === 'text-to-image' && subscription?.active === true && subscription.tier < 3) throw new Error('低消耗模式：文生图零点数路径需要有效的 Opus 订阅');
  const violation = lowConsumptionViolation({ operation, model: params.model, steps: params.steps,
    freeMaxSteps: runtime.freeMaxSteps, width: params.width, height: params.height, freeMaxArea: runtime.freeMaxArea,
    referenceCount: params.characterReferences?.enabled ? params.characterReferences.slots.length : 0,
    vibeCount: operation === 'text-to-image' || operation === 'image-to-image' ? params.vibes?.enabled ? params.vibes.slots.length : 0 : 0,
    focused, estimatedCost, remaining, runtimeHealthy: lowConsumptionRuntimeHealthy(runtime),
    subscriptionKnown: subscription?.active === true && (!usageLimited || Number.isFinite(subscription?.usage?.percent)),
    usageLimited, usageExhausted: subscription?.usage?.isNegative === true || (subscription?.usage?.percent !== undefined && subscription.usage.percent <= 0) });
  if (violation) throw new Error(violation);
};
