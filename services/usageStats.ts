import { api } from './api';

export type UsageRange = '7' | '30' | '365' | 'all' | 'month';

export interface UsageTotals {
  images: number;
  activeDays: number;
  favoriteImages: number;
  firstAt: number | null;
  lastAt: number | null;
  currentStreak: number;
}

export interface UsageDailyPoint { date: string; images: number; }
export interface UsageChainRow { id: string; name: string; images: number; lastAt: number; }
export interface UsageArtistRow { name: string; images: number; lastAt: number; }
export interface UsageCharacterRow { id: string; name: string; images: number; lastAt: number; }
export interface UsageTagRow { name: string; images: number; }
export interface UsageSlotRow { images: number; slots: number; }
export interface UsageModelRow { model: string; images: number; }
export interface UsageSizeRow { width: number; height: number; images: number; }
export interface UsageStepsRow { steps: number; images: number; }
export interface UsageOperationRow { operation: string; images: number; }

export interface UsageStats {
  totals: UsageTotals;
  daily: UsageDailyPoint[];
  chains: UsageChainRow[];
  artists: UsageArtistRow[];
  characters: UsageCharacterRow[];
  tags: UsageTagRow[];
  characterUsage: UsageSlotRow;
  vibeUsage: UsageSlotRow;
  referenceUsage: UsageSlotRow;
  models: UsageModelRow[];
  sizes: UsageSizeRow[];
  steps: UsageStepsRow[];
  operations: UsageOperationRow[];
  uniqueChains: number;
  uniqueArtists: number;
  uniqueCharacters: number;
  artistScan: { scanned: number; truncated: boolean };
  generatedAt: number;
}

/** 足迹只需要计数和日期，不加载配方、参考编码或图片配置。 */
export interface UsageAssets {
  roll?: { id: string; name: string; archived?: boolean; updatedAt: number;
    candidates: { createdAt: number; savedChainId?: string; archived?: boolean }[];
    rounds: { createdAt: number }[] }[];
  vibes?: { createdAt: number; encodings: { model: string; createdAt: number }[] }[];
  vibeGroups?: { createdAt: number }[];
}

export const getUsageAssets = async (signal?: AbortSignal): Promise<UsageAssets> => {
  const payload = await api.get('/local-usage/assets', { cache: 'no-store', signal }) as UsageAssets | null;
  return {
    roll: Array.isArray(payload?.roll) ? payload.roll : undefined,
    vibes: Array.isArray(payload?.vibes) ? payload.vibes : undefined,
    vibeGroups: Array.isArray(payload?.vibeGroups) ? payload.vibeGroups : undefined,
  };
};

const count = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const rows = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

/** 只读取本地历史聚合；页面切换时由调用方中止，不缓存过期统计。 */
export const getUsageStats = async (range: UsageRange, signal?: AbortSignal, month?: string, year?: string, bounds?: { start: number; end: number }): Promise<UsageStats> => {
  const tzOffset = -new Date().getTimezoneOffset();
  const params = new URLSearchParams({ days: range, tzOffset: String(tzOffset) });
  if (range === 'month' && month) params.set('month', month);
  if (year) params.set('year', year);
  if (bounds) { params.set('from', String(bounds.start)); params.set('to', String(bounds.end)); }
  const payload = await api.get(`/local-history/stats?${params.toString()}`, { cache: 'no-store', signal }) as Partial<UsageStats> | null;
  const totals = payload?.totals;
  return {
    totals: {
      images: count(totals?.images),
      activeDays: count(totals?.activeDays),
      favoriteImages: count(totals?.favoriteImages),
      firstAt: totals?.firstAt ? Number(totals.firstAt) : null,
      lastAt: totals?.lastAt ? Number(totals.lastAt) : null,
      currentStreak: count(totals?.currentStreak),
    },
    daily: rows<UsageDailyPoint>(payload?.daily),
    chains: rows<UsageChainRow>(payload?.chains),
    artists: rows<UsageArtistRow>(payload?.artists),
    characters: rows<UsageCharacterRow>(payload?.characters),
    tags: rows<UsageTagRow>(payload?.tags),
    characterUsage: {
      images: count(payload?.characterUsage?.images),
      slots: count(payload?.characterUsage?.slots),
    },
    vibeUsage: {
      images: count(payload?.vibeUsage?.images),
      slots: count(payload?.vibeUsage?.slots),
    },
    referenceUsage: {
      images: count(payload?.referenceUsage?.images),
      slots: count(payload?.referenceUsage?.slots),
    },
    models: rows<UsageModelRow>(payload?.models),
    sizes: rows<UsageSizeRow>(payload?.sizes),
    steps: rows<UsageStepsRow>(payload?.steps),
    operations: rows<UsageOperationRow>(payload?.operations),
    uniqueChains: count(payload?.uniqueChains),
    uniqueArtists: count(payload?.uniqueArtists),
    uniqueCharacters: count(payload?.uniqueCharacters),
    artistScan: payload?.artistScan && typeof payload.artistScan === 'object'
      ? { scanned: count(payload.artistScan.scanned), truncated: Boolean(payload.artistScan.truncated) }
      : { scanned: 0, truncated: false },
    generatedAt: count(payload?.generatedAt),
  };
};
