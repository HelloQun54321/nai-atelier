import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import * as anlasBudget from './anlasBudget';
import { readActiveNaiKey, setActiveNaiKey } from './naiKeyStorage';
import { naiKeyVault, type NaiKeyEntry } from './naiKeyVault';
import * as naiUsage from './naiUsage';
import type { NovelaiSubscriptionInfo } from './naiUsage';

const USAGE_REFRESH_EVENT = 'nai-novelai-usage-refresh';
const USAGE_SNAPSHOT_EVENT = 'nai-novelai-usage-snapshot';
const safeFn = <T extends (...args: never[]) => unknown>(mod: Record<string, unknown>, key: string): T | null => {
  try {
    const value = mod[key];
    return typeof value === 'function' ? value as T : null;
  } catch {
    return null;
  }
};
const isOpusUsageLimitedModel = (model?: string) => {
  const fn = safeFn<(model?: string) => boolean>(anlasBudget, 'isOpusUsageLimitedModel');
  return fn ? fn(model) : Boolean(!model || model.startsWith('nai-diffusion-5-'));
};
const isActiveOpusSubscription = (info: NovelaiSubscriptionInfo | null | undefined) => {
  const fn = safeFn<(info: NovelaiSubscriptionInfo | null | undefined) => boolean>(naiUsage, 'isActiveOpusSubscription');
  return fn ? fn(info) : Boolean(info?.active === true && Number(info.tier) >= 3);
};
const usageRemainingPercent = (usage: NonNullable<NovelaiSubscriptionInfo['usage']>) => {
  const fn = safeFn<(usage: NonNullable<NovelaiSubscriptionInfo['usage']>) => number>(naiUsage, 'usageRemainingPercent');
  if (fn) return fn(usage);
  const percent = Number(usage.percent);
  return usage.isNegative || !Number.isFinite(percent) ? 0 : Math.max(0, percent);
};
const usageRingPercent = (usage: NonNullable<NovelaiSubscriptionInfo['usage']>) => {
  const fn = safeFn<(usage: NonNullable<NovelaiSubscriptionInfo['usage']>) => number>(naiUsage, 'usageRingPercent');
  if (fn) return fn(usage);
  const remaining = usageRemainingPercent(usage);
  const cap = Number(usage.capacity);
  return Math.min(100, (remaining / (Number.isFinite(cap) && cap > 0 ? cap : 100)) * 100);
};
const readUsageSnapshot = (apiKey: string) => {
  const fn = safeFn<(apiKey: string) => { info: NovelaiSubscriptionInfo; fetchedAt: number } | null>(naiUsage, 'getCachedNovelaiSubscriptionSnapshot');
  return fn ? fn(apiKey) : null;
};
const rememberUsageSnapshot = (apiKey: string, info: NovelaiSubscriptionInfo, fetchedAt: number) => {
  const fn = safeFn<(apiKey: string, info: NovelaiSubscriptionInfo, fetchedAt?: number) => void>(naiUsage, 'rememberNovelaiSubscriptionSnapshot');
  if (fn) fn(apiKey, info, fetchedAt);
};
const fetchSubscription = (apiKey: string) => naiUsage.requestNovelaiSubscription(apiKey);

export interface NaiKeyPoolConfig {
  enabled: boolean;
  memberIds: string[];
}

export interface PoolMemberStatus {
  /** 在 Key 池中的稳定序号（从 1 开始，按密钥保管箱上下顺序编号）。 */
  poolIndex: number;
  entry: NaiKeyEntry;
  info: NovelaiSubscriptionInfo | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number;
  fillRatio: number | null;
  remainingPercent: number | null;
  availableForOpus: boolean;
  cooldownUntil: number;
}

export interface PoolCandidateSnapshot {
  entry: NaiKeyEntry;
  info: NovelaiSubscriptionInfo | null;
  error?: string | null;
  cooldownUntil?: number;
}

export type PoolFailureCode = 'pool_empty' | 'pool_exhausted' | 'pool_unavailable' | 'pool_paid_blocked';

export type PoolSelectionResult =
  | { ok: true; entry: NaiKeyEntry; info: NovelaiSubscriptionInfo; fillRatio: number; remainingPercent: number; switched: boolean }
  | { ok: false; code: Exclude<PoolFailureCode, 'pool_paid_blocked'>; message: string };

export type PreparePoolGenerationResult =
  | { pooled: false }
  | { pooled: true; ok: true; key: string; entry: NaiKeyEntry; info: NovelaiSubscriptionInfo; switched: boolean }
  | { pooled: true; ok: false; code: PoolFailureCode; message: string };

export interface PoolGenerationCheck {
  model?: string;
  /** 按活跃 Opus + 有免费额度估算的单张费用；> 0 说明参数本身要花 Anlas。 */
  estimatedCostWithOpus: number;
  /** 最低剩余百分比要求（默认 0，连续 Roll 可传 stopAtPercent）。 */
  minPercent?: number;
  /** 已有任务排队中时保持当前活动 Key，不中途切换以免中断在途任务。 */
  preserveActiveKey?: boolean;
  /** 进入发车前同步联网轮询池额度时的阶段回调，供按钮精准展示当前动作。 */
  onStage?: (stage: 'checking_pool') => void;
}

const POOL_STORAGE_KEY = 'nai_key_pool_v1';
export const NAI_KEY_POOL_CHANGED = 'nai-key-pool-changed';
const POOL_SNAPSHOT_TTL = 60 * 1000;
const POOL_POLL_INTERVAL = 60 * 1000;
/** 候选最高剩余百分比高于该安全线时直接零阻塞发车，成图后再后台异步刷新。 */
const POOL_LOW_QUOTA_SYNC_THRESHOLD = 1.0;
const DEFAULT_HYSTERESIS = 0;

const isBrowser = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const sanitizePoolConfig = (raw: unknown, vault?: NaiKeyEntry[] | null): NaiKeyPoolConfig => {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const eligibleIds = vault
    ? new Set(vault.filter(entry => entry.billingMode !== 'per-use').map(entry => entry.id))
    : null;
  const memberIds: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rec.memberIds)) {
    for (const item of rec.memberIds) {
      if (typeof item !== 'string' || !item || seen.has(item)) continue;
      if (eligibleIds && !eligibleIds.has(item)) continue;
      seen.add(item);
      memberIds.push(item);
    }
  }
  return { enabled: rec.enabled === true && memberIds.length > 0, memberIds };
};

const readLocalPool = (vault?: NaiKeyEntry[] | null): NaiKeyPoolConfig => {
  if (!isBrowser()) return { enabled: false, memberIds: [] };
  try {
    return sanitizePoolConfig(JSON.parse(localStorage.getItem(POOL_STORAGE_KEY) || 'null'), vault);
  } catch {
    return { enabled: false, memberIds: [] };
  }
};

const writeLocalPool = (config: NaiKeyPoolConfig) => {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(POOL_STORAGE_KEY, JSON.stringify(config));
  } catch { /* ignore storage quota errors */ }
};

/**
 * 纯函数：按「满圈率优先」从候选池成员中选出最佳 Key。
 * - 优先消耗已满或最接近满额的 Key，避免满额停滞浪费回血；
 * - 差值在防抖阈值（默认 1%）内时优先沿用当前活动 Key，减少无谓切换；
 * - 同等满圈率下优先绝对剩余百分比更高者；
 * - 自动排除按次渠道、冷却中、未激活/非 Opus、额度耗尽或低于保护线的 Key。
 */
export const selectBestPoolMember = (
  candidates: PoolCandidateSnapshot[],
  activeKey: string,
  options: { requireOpusQuota?: boolean; minPercent?: number; hysteresis?: number; now?: number } = {},
): PoolSelectionResult => {
  const {
    requireOpusQuota = true,
    minPercent = 0,
    hysteresis = DEFAULT_HYSTERESIS,
    now = Date.now(),
  } = options;
  const normalizedActive = activeKey.trim();
  const validCandidates = candidates.filter(item => item.entry.billingMode !== 'per-use' && item.entry.key.trim());
  if (!validCandidates.length) {
    return {
      ok: false,
      code: 'pool_empty',
      message: 'Key 池中还没有可用密钥，请先在全局设置中选择入池密钥或关闭 Key 池',
    };
  }

  let hadExhausted = false;
  const eligible: Array<{ entry: NaiKeyEntry; info: NovelaiSubscriptionInfo; fillRatio: number; remainingPercent: number; order: number }> = [];

  validCandidates.forEach((item, order) => {
    if ((item.cooldownUntil || 0) > now) return;
    const info = item.info;
    if (!info || !isActiveOpusSubscription(info)) return;
    const usage = info.usage;
    const remainingPercent = usage ? usageRemainingPercent(usage) : 0;
    const fillRatio = usage ? usageRingPercent(usage) : 0;
    if (requireOpusQuota) {
      if (!usage || usage.isNegative || remainingPercent <= minPercent) {
        hadExhausted = true;
        return;
      }
    }
    eligible.push({ entry: item.entry, info, fillRatio, remainingPercent, order });
  });

  if (!eligible.length) {
    if (hadExhausted) {
      return {
        ok: false,
        code: 'pool_exhausted',
        message: minPercent > 0
          ? `Key 池中所有可用密钥的 Opus 额度均已低于 ${minPercent}%，已停止生成（未消耗 Anlas）`
          : 'Key 池中所有可用密钥的 Opus 额度均已耗尽，已停止生成（未消耗 Anlas）',
      };
    }
    return {
      ok: false,
      code: 'pool_unavailable',
      message: 'Key 池中当前没有可用的 Opus 密钥（可能已过期、冷却中或同步失败），已停止生成',
    };
  }

  eligible.sort((a, b) => {
    if (Math.abs(b.fillRatio - a.fillRatio) > 1e-6) return b.fillRatio - a.fillRatio;
    if (Math.abs(b.remainingPercent - a.remainingPercent) > 1e-6) return b.remainingPercent - a.remainingPercent;
    if (hysteresis <= 0 && normalizedActive) {
      const aIsCurrent = a.entry.key === normalizedActive;
      const bIsCurrent = b.entry.key === normalizedActive;
      if (aIsCurrent !== bIsCurrent) return aIsCurrent ? 1 : -1;
    }
    return a.order - b.order;
  });

  const best = eligible[0];
  const current = normalizedActive ? eligible.find(item => item.entry.key === normalizedActive) : undefined;
  if (hysteresis > 0 && current && best.fillRatio - current.fillRatio <= hysteresis) {
    return {
      ok: true,
      entry: current.entry,
      info: current.info,
      fillRatio: current.fillRatio,
      remainingPercent: current.remainingPercent,
      switched: false,
    };
  }

  return {
    ok: true,
    entry: best.entry,
    info: best.info,
    fillRatio: best.fillRatio,
    remainingPercent: best.remainingPercent,
    switched: best.entry.key !== normalizedActive,
  };
};

// ===== 模块级共享池状态与后台同步 =====

interface MemberRuntimeState {
  info: NovelaiSubscriptionInfo | null;
  fetchedAt: number;
  loading: boolean;
  error: string | null;
  cooldownUntil: number;
}

let cachedPoolConfig: NaiKeyPoolConfig | null = null;
let poolConfigLoaded = false;
let poolConfigPromise: Promise<NaiKeyPoolConfig> | null = null;
let cachedVaultEntries: NaiKeyEntry[] = [];
const memberStates = new Map<string, MemberRuntimeState>();
const listeners = new Set<() => void>();
let driverSubscribers = 0;
let driverAttached = false;
let pollTimer: number | null = null;

const emitChange = () => {
  listeners.forEach(listener => listener());
};

const getOrInitMemberState = (apiKey: string): MemberRuntimeState => {
  const key = apiKey.trim();
  const existing = memberStates.get(key);
  if (existing) return existing;
  const cached = readUsageSnapshot(key);
  const initial: MemberRuntimeState = {
    info: cached?.info || null,
    fetchedAt: cached?.fetchedAt || 0,
    loading: false,
    error: null,
    cooldownUntil: 0,
  };
  memberStates.set(key, initial);
  return initial;
};

const currentPoolMembers = (config = cachedPoolConfig, vault = cachedVaultEntries): NaiKeyEntry[] => {
  if (!config || !config.memberIds.length) return [];
  const memberSet = new Set(config.memberIds);
  // 按保管箱展示顺序排列，保证每把入池密钥的 #1/#2 序号与设置页上下顺序始终一致。
  return vault.filter(entry => entry.billingMode !== 'per-use' && memberSet.has(entry.id));
};

const buildMemberStatuses = (): PoolMemberStatus[] => {
  const now = Date.now();
  return currentPoolMembers().map((entry, index) => {
    const state = getOrInitMemberState(entry.key);
    const info = state.info;
    const usage = info?.usage;
    const remainingPercent = usage ? usageRemainingPercent(usage) : null;
    const fillRatio = usage ? usageRingPercent(usage) : null;
    const availableForOpus = Boolean(
      info
      && isActiveOpusSubscription(info)
      && usage
      && !usage.isNegative
      && remainingPercent !== null
      && remainingPercent > 0
      && state.cooldownUntil <= now,
    );
    return {
      poolIndex: index + 1,
      entry,
      info,
      loading: state.loading,
      error: state.error,
      fetchedAt: state.fetchedAt,
      fillRatio,
      remainingPercent,
      availableForOpus,
      cooldownUntil: state.cooldownUntil,
    };
  });
};

const refreshSingleMember = async (entry: NaiKeyEntry, force: boolean): Promise<void> => {
  const key = entry.key.trim();
  if (!key) return;
  const state = getOrInitMemberState(key);
  if (!force && state.info && !state.error && Date.now() - state.fetchedAt < POOL_SNAPSHOT_TTL) return;
  state.loading = true;
  emitChange();
  try {
    const info = await fetchSubscription(key);
    const now = Date.now();
    state.info = info;
    state.fetchedAt = now;
    state.error = null;
    state.loading = false;
    rememberUsageSnapshot(key, info, now);
  } catch (err) {
    state.error = err instanceof Error ? err.message.trim().slice(0, 200) : '订阅查询失败';
    state.loading = false;
  } finally {
    emitChange();
  }
};

export const refreshKeyPoolSnapshots = async (force = false, refreshKeys?: Set<string>): Promise<PoolMemberStatus[]> => {
  const [config, vault] = await Promise.all([naiKeyPoolService.get(), naiKeyVault.list()]);
  cachedVaultEntries = vault;
  cachedPoolConfig = sanitizePoolConfig(config, vault);
  const members = currentPoolMembers(cachedPoolConfig, cachedVaultEntries);
  if (members.length) {
    await Promise.allSettled(members.map(entry => refreshSingleMember(entry, force || Boolean(refreshKeys?.has(entry.key.trim())))));
  }
  emitChange();
  return buildMemberStatuses();
};

/** 标记某把池内密钥进入短暂冷却（如遇到 429 / 上游故障），避免立刻再次选中。 */
export const reportPoolKeyCooldown = (apiKey: string, durationMs = 45 * 1000) => {
  const key = apiKey.trim();
  if (!key) return;
  const state = getOrInitMemberState(key);
  state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + Math.max(1000, durationMs));
  emitChange();
};

/** 池模式下查询池内所有健康 Opus 密钥的最大剩余百分比，供连续 Roll 判定是否全部耗尽。 */
export const getPoolMaxOpusPercent = (): number | null => {
  if (!cachedPoolConfig?.enabled) return null;
  const members = buildMemberStatuses();
  if (!members.length) return null;
  const now = Date.now();
  let max: number | null = null;
  for (const member of members) {
    if (member.cooldownUntil > now || !member.info) continue;
    if (!isActiveOpusSubscription(member.info) || !member.info.usage) continue;
    const pct = member.info.usage.isNegative ? 0 : usageRemainingPercent(member.info.usage);
    if (max === null || pct > max) max = pct;
  }
  return max;
};

/**
 * 生图前统一入口：
 * - Key 池关闭 → 返回 { pooled: false }，沿用原有单 Key 流程；
 * - Key 池开启 → 若参数本身需要花 Anlas 直接停下提示；否则按满圈率优先选出最佳 Key 并切换。
 */
export const prepareGenerationWithPool = async (check: PoolGenerationCheck): Promise<PreparePoolGenerationResult> => {
  const cached = naiKeyPoolService.getCachedConfig();
  if (!cached.enabled) return { pooled: false };
  const config = poolConfigLoaded ? cached : await naiKeyPoolService.get();
  if (!config.enabled) return { pooled: false };

  if (check.estimatedCostWithOpus > 0) {
    return {
      pooled: true,
      ok: false,
      code: 'pool_paid_blocked',
      message: 'Key 池模式仅用于 Opus 免费额度生成，当前参数需要消耗 Anlas，已停止生成。如需付费生成，请先关闭 Key 池并指定单把密钥。',
    };
  }

  const activeKey = readActiveNaiKey().trim();
  const pickOptions = {
    requireOpusQuota: isOpusUsageLimitedModel(check.model),
    minPercent: check.minPercent ?? 0,
  };
  const pickFrom = (statuses: PoolMemberStatus[]) => selectBestPoolMember(
    statuses.map(item => ({
      entry: item.entry,
      info: item.info,
      error: item.error,
      cooldownUntil: item.cooldownUntil,
    })),
    activeKey,
    pickOptions,
  );
  // 快路径：只要缓存里存在高于 1% 安全线的可用 Opus 密钥，就直接秒选发车（即便看图超过 60 秒或有副 Key 上次失败也不卡住）；
  // 仅在冷启动完全无缓存、缓存显示全池耗尽、或最高余额跌入 ≤ 1% 低额警戒区时才发车前同步联网核对。
  const cachedStatuses = cachedVaultEntries.length ? buildMemberStatuses() : [];
  const cachedPicked = cachedStatuses.length > 0 ? pickFrom(cachedStatuses) : null;
  const safeFastStart = Boolean(
    cachedPicked?.ok
    && (!pickOptions.requireOpusQuota || cachedPicked.remainingPercent > POOL_LOW_QUOTA_SYNC_THRESHOLD),
  );
  let picked = safeFastStart ? cachedPicked : null;
  if (!picked || !picked.ok) {
    // 处于低额警戒区（≤ 1%）或缓存显示全池耗尽时，强制实时刷新核对，不受 60 秒 TTL 缓存跳过影响。
    check.onStage?.('checking_pool');
    const needsForceVerify = Boolean(
      cachedStatuses.length > 0
      && (!cachedPicked?.ok || (pickOptions.requireOpusQuota && cachedPicked.remainingPercent <= POOL_LOW_QUOTA_SYNC_THRESHOLD)),
    );
    const statuses = await refreshKeyPoolSnapshots(needsForceVerify);
    picked = pickFrom(statuses);
  }
  if (!picked.ok) {
    return { pooled: true, ok: false, code: picked.code, message: picked.message };
  }
  if (picked.switched && !check.preserveActiveKey) {
    setActiveNaiKey(picked.entry.key);
  }
  return {
    pooled: true,
    ok: true,
    key: picked.entry.key,
    entry: picked.entry,
    info: picked.info,
    switched: picked.switched,
  };
};

export const naiKeyPoolService = {
  getCachedConfig(): NaiKeyPoolConfig {
    return cachedPoolConfig ?? readLocalPool(cachedVaultEntries.length ? cachedVaultEntries : null);
  },

  async get(force = false): Promise<NaiKeyPoolConfig> {
    if (!force && poolConfigLoaded && cachedPoolConfig) return cachedPoolConfig;
    if (!force && poolConfigPromise) return poolConfigPromise;
    poolConfigPromise = (async () => {
      const vault = await naiKeyVault.list().catch(() => cachedVaultEntries);
      cachedVaultEntries = vault;
      try {
        const res = await api.get('/nai-key-vault/pool');
        const next = sanitizePoolConfig(res?.pool, vault);
        cachedPoolConfig = next;
        poolConfigLoaded = true;
        writeLocalPool(next);
        emitChange();
        return next;
      } catch {
        const local = readLocalPool(vault);
        cachedPoolConfig = local;
        poolConfigLoaded = true;
        emitChange();
        return local;
      } finally {
        poolConfigPromise = null;
      }
    })();
    return poolConfigPromise;
  },

  async set(config: NaiKeyPoolConfig): Promise<NaiKeyPoolConfig> {
    const vault = await naiKeyVault.list().catch(() => cachedVaultEntries);
    cachedVaultEntries = vault;
    const normalized = sanitizePoolConfig(config, vault);
    try {
      const res = await api.put('/nai-key-vault/pool', normalized);
      const saved = sanitizePoolConfig(res?.pool ?? normalized, vault);
      cachedPoolConfig = saved;
      poolConfigLoaded = true;
      writeLocalPool(saved);
    } catch {
      cachedPoolConfig = normalized;
      poolConfigLoaded = true;
      writeLocalPool(normalized);
    }
    if (isBrowser()) window.dispatchEvent(new Event(NAI_KEY_POOL_CHANGED));
    emitChange();
    if (cachedPoolConfig.enabled) {
      void refreshKeyPoolSnapshots(false).then(statuses => {
        if (!cachedPoolConfig?.enabled) return;
        const picked = selectBestPoolMember(
          statuses.map(item => ({ entry: item.entry, info: item.info, error: item.error, cooldownUntil: item.cooldownUntil })),
          readActiveNaiKey().trim(),
          { requireOpusQuota: true },
        );
        if (picked.ok && picked.switched) setActiveNaiKey(picked.entry.key);
      });
    }
    return cachedPoolConfig;
  },

  /** 测试用复位，不用于生产路径。 */
  _resetForTests() {
    cachedPoolConfig = null;
    poolConfigLoaded = false;
    poolConfigPromise = null;
    cachedVaultEntries = [];
    memberStates.clear();
  },
};

const pollPoolIfEnabled = () => {
  if (!cachedPoolConfig?.enabled) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  void refreshKeyPoolSnapshots(false);
};

const onUsageSnapshot = (event: Event) => {
  const detail = (event as CustomEvent<{ apiKey?: string; info?: NovelaiSubscriptionInfo }>).detail;
  const key = detail?.apiKey?.trim();
  if (!key || !detail?.info) return;
  const state = getOrInitMemberState(key);
  state.info = detail.info;
  state.fetchedAt = Date.now();
  state.error = null;
  state.loading = false;
  emitChange();
};

let lastPoolRefreshBroadcastAt = 0;
const onUsageRefresh = () => {
  if (!cachedPoolConfig?.enabled) return;
  const now = Date.now();
  if (now - lastPoolRefreshBroadcastAt < 5_000) return;
  lastPoolRefreshBroadcastAt = now;
  const activeKey = readActiveNaiKey().trim();
  // 只刷新当前激活密钥及已过期的成员，避免批量出图每张保存后并发强刷全池拖慢网关。
  void refreshKeyPoolSnapshots(false, activeKey ? new Set([activeKey]) : undefined);
};

const onVaultChanged = () => {
  if (!poolConfigLoaded && !readLocalPool().enabled) return;
  void naiKeyPoolService.get(true).then(config => {
    if (config.enabled) void refreshKeyPoolSnapshots(false);
  });
};

const onVisibilityChange = () => {
  if (document.visibilityState === 'hidden') {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  } else {
    pollPoolIfEnabled();
    if (pollTimer === null) pollTimer = window.setInterval(pollPoolIfEnabled, POOL_POLL_INTERVAL);
  }
};

const attachPoolDriver = () => {
  if (driverAttached || !isBrowser()) return;
  driverAttached = true;
  window.addEventListener(USAGE_SNAPSHOT_EVENT, onUsageSnapshot);
  window.addEventListener(USAGE_REFRESH_EVENT, onUsageRefresh);
  window.addEventListener('nai-key-vault-changed', onVaultChanged);
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (document.visibilityState !== 'hidden') {
    pollTimer = window.setInterval(pollPoolIfEnabled, POOL_POLL_INTERVAL);
  }
};

const detachPoolDriver = () => {
  if (!driverAttached || !isBrowser()) return;
  driverAttached = false;
  window.removeEventListener(USAGE_SNAPSHOT_EVENT, onUsageSnapshot);
  window.removeEventListener(USAGE_REFRESH_EVENT, onUsageRefresh);
  window.removeEventListener('nai-key-vault-changed', onVaultChanged);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
};

export const useNaiKeyPool = (options: { loadRemote?: boolean } = {}) => {
  const { loadRemote = false } = options;
  const [, setTick] = useState(0);
  useEffect(() => {
    const notify = () => setTick(value => value + 1);
    listeners.add(notify);
    driverSubscribers += 1;
    attachPoolDriver();
    if (loadRemote) {
      void naiKeyPoolService.get().then(config => {
        if (config.enabled) void refreshKeyPoolSnapshots(false);
      });
    } else if (naiKeyPoolService.getCachedConfig().enabled) {
      void refreshKeyPoolSnapshots(false);
    }
    return () => {
      listeners.delete(notify);
      driverSubscribers = Math.max(0, driverSubscribers - 1);
      if (driverSubscribers === 0) detachPoolDriver();
    };
  }, [loadRemote]);

  const config = naiKeyPoolService.getCachedConfig();
  const members = buildMemberStatuses();
  const activeKey = isBrowser() ? readActiveNaiKey().trim() : '';
  const activeMember = members.find(member => member.entry.key === activeKey) || null;
  const refresh = useCallback(() => refreshKeyPoolSnapshots(true), []);
  const setConfig = useCallback((next: NaiKeyPoolConfig) => naiKeyPoolService.set(next), []);
  const setEnabled = useCallback((enabled: boolean) => {
    const current = naiKeyPoolService.getCachedConfig();
    return naiKeyPoolService.set({ ...current, enabled });
  }, []);
  const toggleMember = useCallback((entryId: string) => {
    const current = naiKeyPoolService.getCachedConfig();
    const exists = current.memberIds.includes(entryId);
    const memberIds = exists
      ? current.memberIds.filter(id => id !== entryId)
      : [...current.memberIds, entryId];
    return naiKeyPoolService.set({
      enabled: memberIds.length > 0 ? current.enabled : false,
      memberIds,
    });
  }, []);

  return { config, members, activeMember, refresh, setConfig, setEnabled, toggleMember };
};
