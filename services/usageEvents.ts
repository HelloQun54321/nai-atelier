import { api } from './api';
import type { UsageRange } from './usageStats';

export interface UsageEventInput {
  category: 'generation' | 'vibe' | 'agent' | 'external' | 'roll' | 'collection' | string;
  action: string;
  target?: string;
  amount?: number;
  value?: number;
  meta?: Record<string, unknown>;
}

export interface UsageEventTotal {
  category: string;
  action: string;
  count: number;
  amount: number;
  value: number;
}

export interface UsageEventDay extends UsageEventTotal {
  date: string;
}

export interface UsageEventStats {
  totals: UsageEventTotal[];
  daily: UsageEventDay[];
  keys: KeyUsageRow[];
  keyUsageFirstAt: number | null;
  generatedAt: number;
}

export interface KeyUsageRow {
  keyHash: string;
  name: string | null;
  images: number;
  models: { model: string; images: number }[];
  generationAnlas: number;
  encodingAnlas: number;
  opusImages: number;
  unknownBillingImages: number;
  /** 原有累计计数包含旧版本，不能与本周期明细相加。 */
  lifetime: { anlasSpent: number; opusImages: number } | null;
}

/** 失败、取消、编码等没有进入历史的事件只写轻量账本；不记录 Prompt 或聊天内容。 */
export const recordUsageEvent = (event: UsageEventInput) => {
  void api.post('/local-usage/events', event).catch(() => { /* 统计不阻断主流程。 */ });
};

const count = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const getUsageEventStats = async (range: UsageRange, signal?: AbortSignal, month?: string, year?: string, bounds?: { start: number; end: number }): Promise<UsageEventStats> => {
  const tzOffset = -new Date().getTimezoneOffset();
  const params = new URLSearchParams({ days: range, tzOffset: String(tzOffset) });
  if (range === 'month' && month) params.set('month', month);
  if (year) params.set('year', year);
  if (bounds) { params.set('from', String(bounds.start)); params.set('to', String(bounds.end)); }
  const payload = await api.get(`/local-usage/stats?${params.toString()}`, { cache: 'no-store', signal }) as Partial<UsageEventStats> | null;
  const normalize = (row: Partial<UsageEventTotal> & { date?: string }) => ({
    ...(row.date ? { date: row.date } : {}),
    category: String(row.category || ''),
    action: String(row.action || ''),
    count: count(row.count),
    amount: count(row.amount),
    value: count(row.value),
  });
  return {
    totals: Array.isArray(payload?.totals) ? payload.totals.map(normalize) as UsageEventTotal[] : [],
    daily: Array.isArray(payload?.daily) ? payload.daily.map(normalize) as UsageEventDay[] : [],
    keys: Array.isArray(payload?.keys) ? payload.keys : [],
    keyUsageFirstAt: count(payload?.keyUsageFirstAt) || null,
    generatedAt: count(payload?.generatedAt),
  };
};
