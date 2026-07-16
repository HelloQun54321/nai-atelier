import { NAIParams } from '../types';

const BUDGET_KEY = 'nai_anlas_budget';
const SPENT_KEY = 'nai_anlas_spent';
export const DEFAULT_SHARED_OPUS_BUDGET = 1666;

export interface AnlasEstimate {
  cost: number;
  free: boolean;
  reasons: string[];
}

const readNumber = (key: string, fallback: number) => {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
};

export const getAnlasBudget = () => readNumber(BUDGET_KEY, DEFAULT_SHARED_OPUS_BUDGET);
export const setAnlasBudget = (value: number) => {
  localStorage.setItem(BUDGET_KEY, String(Math.max(0, Math.floor(value || 0))));
  window.dispatchEvent(new Event('nai-anlas-changed'));
};
export const getAnlasSpent = () => readNumber(SPENT_KEY, 0);
export const setAnlasSpent = (value: number) => {
  localStorage.setItem(SPENT_KEY, String(Math.max(0, Math.floor(value || 0))));
  window.dispatchEvent(new Event('nai-anlas-changed'));
};
export const getAnlasRemaining = () => Math.max(0, getAnlasBudget() - getAnlasSpent());
export const recordAnlasSpend = (value: number) => setAnlasSpent(getAnlasSpent() + Math.max(0, Math.ceil(value)));

/** Opus 免费条件使用官方规则；付费数值为基于像素、步数和张数的生成前估算。 */
export const estimateAnlas = (params: NAIParams, hasBaseImage = false): AnlasEstimate => {
  const samples = Math.max(1, Math.min(4, Math.floor(params.nSamples ?? 1)));
  const pixels = Math.max(64, params.width) * Math.max(64, params.height);
  const reasons: string[] = [];
  if (samples > 1) reasons.push(`一次生成 ${samples} 张`);
  if (pixels > 1024 * 1024) reasons.push('尺寸超过 1024×1024 像素');
  if (params.steps > 28) reasons.push(`步数超过免费阈值（${params.steps} > 28）`);
  if (hasBaseImage) reasons.push('使用了基础图或参考图');

  const free = samples === 1 && pixels <= 1024 * 1024 && params.steps <= 28 && !hasBaseImage;
  if (free) return { cost: 0, free: true, reasons: [] };

  let multiplier = 1;
  if (params.smea === 'smea') multiplier = 1.2;
  if (params.smea === 'smea_dyn') multiplier = 1.4;
  if (params.smea === 'auto' && pixels > 1024 * 1024) multiplier = 1.2;
  const cost = Math.max(1, Math.ceil(pixels * Math.max(1, params.steps) * 0.0000005 * samples * multiplier));
  return { cost, free: false, reasons };
};

export const getTodayAnlasDismissKey = () => {
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `nai_anlas_warning_dismissed_${localDate}`;
};
