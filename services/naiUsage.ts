import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * NovelAI Opus 免费生成限额（2026-08-21 随 V5 引入）。
 *
 * 规则（与官方说明一致）：Opus 订阅在「单张、无底图、≤1024x1024、≤28 步」条件下
 * 可免费生成；该免费额度对高于 V4.5 的模型（即 V5）有限额，透支后所有生图都会
 * 消耗 Anlas，额度随时间自动恢复。V4.5 及以下不受限额影响。
 */
export interface NovelaiUsageState {
  /** 剩余百分比（0–100）。 */
  percent: number;
  /** 是否已透支（透支后所有生图消耗 Anlas，直到额度恢复为正）。 */
  isNegative: boolean;
  /** 恢复 1% 额度所需的秒数。 */
  timeUntilNextPercent: number;
}

export interface NovelaiSubscriptionInfo {
  /** 订阅等级：0 Paper / 1 Tablet / 2 Scroll / 3 Opus（兼容 1~4 序号）。 */
  tier: number;
  active: boolean;
  /** 仅 Opus 订阅会返回 usage。 */
  usage?: NovelaiUsageState;
}

// ===== 官方接口字段映射 =====

/**
 * 真实剩余百分比：透支显示 0，其余保留官方原始上限。
 *
 * NovelAI 会通过活动加成让 Opus 额度超过 100%；侧栏必须显示真实返回值，
 * 不能把 196% 截断成 100% 后同时低估剩余可生成张数。
 */
export const usageRemainingPercent = (usage: NovelaiUsageState): number => {
  const percent = Number(usage.percent);
  return usage.isNegative || !Number.isFinite(percent) ? 0 : Math.max(0, percent);
};

/** 剩余可生成张数 ≈ 系数 × 官方真实百分比（系数由网关自动同步）。 */
export const usageRemainingImages = (usage: NovelaiUsageState, imagesPerPercent = 17.3): number =>
  Math.round(imagesPerPercent * usageRemainingPercent(usage));

export const NOVELAI_USAGE_REFRESH_EVENT = 'nai-novelai-usage-refresh';

/**
 * 拼车共享账号：其他成员的生图也会消耗同一份额度，轮询需要比单账号更勤，
 * 生成前的关键校验则由调用方显式 await refresh() 获取最新值。
 */
const SUBSCRIPTION_REFRESH_INTERVAL = 60 * 1000;

/** 生图费用判定前，快照超过该时长即视为过期，需要重新拉取。 */
export const USAGE_SNAPSHOT_TTL = 15 * 1000;

/** 同一把 Key 的并发刷新共用一个请求，避免切换事件与多个组件重复打到订阅接口。 */
const inFlightUsageRequests = new Map<string, Promise<NovelaiSubscriptionInfo>>();

/**
 * 模块级共享订阅驱动：多个 keep-alive 页面各自 useNovelaiUsage 时只维护
 * 一个 interval 与一份事件监听（引用计数：首个订阅启动、末个卸载停止），
 * 并遵循 document.hidden：页面隐藏暂停轮询，恢复可见立即刷新一次再重启。
 */
type UsageSubscriber = { poll: () => void };
const usageSubscribers = new Set<UsageSubscriber>();
let usageDriverAttached = false;
let usagePollTimer: number | null = null;

const usagePollAll = () => {
  usageSubscribers.forEach(subscriber => subscriber.poll());
};

const onUsageVisibilityChange = () => {
  if (document.visibilityState === 'hidden') {
    // 页面隐藏（切后台）：暂停轮询，节省请求；事件驱动的刷新不受影响
    if (usagePollTimer !== null) {
      window.clearInterval(usagePollTimer);
      usagePollTimer = null;
    }
  } else {
    // 恢复可见：立即刷新一次并重启轮询
    usagePollAll();
    startUsagePollTimer();
  }
};

const startUsagePollTimer = () => {
  if (usagePollTimer !== null) return;
  usagePollTimer = window.setInterval(usagePollAll, SUBSCRIPTION_REFRESH_INTERVAL);
};

const startUsageDriver = () => {
  if (usageDriverAttached) return;
  usageDriverAttached = true;
  window.addEventListener(NOVELAI_USAGE_REFRESH_EVENT, usagePollAll);
  window.addEventListener('nai-api-key-changed', usagePollAll);
  window.addEventListener('focus', usagePollAll);
  document.addEventListener('visibilitychange', onUsageVisibilityChange);
  // 后台标签页打开时不空转轮询，等恢复可见再刷新
  if (document.visibilityState === 'hidden') return;
  startUsagePollTimer();
};

const stopUsageDriver = () => {
  if (!usageDriverAttached) return;
  usageDriverAttached = false;
  window.removeEventListener(NOVELAI_USAGE_REFRESH_EVENT, usagePollAll);
  window.removeEventListener('nai-api-key-changed', usagePollAll);
  window.removeEventListener('focus', usagePollAll);
  document.removeEventListener('visibilitychange', onUsageVisibilityChange);
  if (usagePollTimer !== null) {
    window.clearInterval(usagePollTimer);
    usagePollTimer = null;
  }
};

const requestNovelaiSubscription = (apiKey: string): Promise<NovelaiSubscriptionInfo> => {
  const existing = inFlightUsageRequests.get(apiKey);
  if (existing) return existing;

  const request = fetch(`/api/novelai-subscription?_t=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Authorization': `Bearer ${apiKey}` },
  }).then(async response => {
    if (!response.ok) throw new Error(await response.text());
    return await response.json() as NovelaiSubscriptionInfo;
  });
  inFlightUsageRequests.set(apiKey, request);
  request.then(
    () => { if (inFlightUsageRequests.get(apiKey) === request) inFlightUsageRequests.delete(apiKey); },
    () => { if (inFlightUsageRequests.get(apiKey) === request) inFlightUsageRequests.delete(apiKey); },
  );
  return request;
};

/** 生图完成后（以及定期）刷新 NovelAI 订阅限额状态；返回本次拉到的最新快照。 */
export const useNovelaiUsage = () => {
  const [info, setInfo] = useState<NovelaiSubscriptionInfo | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const infoRef = useRef<NovelaiSubscriptionInfo | null>(null);
  const fetchedAtRef = useRef(0);
  const activeKeyRef = useRef('');

  const refresh = useCallback(async (): Promise<NovelaiSubscriptionInfo | null> => {
    // 与 GlobalSettings 相同的读取顺序，保证设置里改 Key 后下一次刷新即生效。
    const apiKey = (sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '').trim();
    if (activeKeyRef.current !== apiKey) {
      activeKeyRef.current = apiKey;
      infoRef.current = null;
      fetchedAtRef.current = 0;
      setInfo(null);
      setFetchedAt(0);
      setError(null);
    }
    if (!apiKey) {
      infoRef.current = null;
      fetchedAtRef.current = 0;
      setInfo(null);
      setFetchedAt(0);
      setError(null);
      setLoading(false);
      return null;
    }
    setError(null);
    setLoading(true);
    try {
      const next = await requestNovelaiSubscription(apiKey);
      // Key 在请求期间切换时，丢弃旧账号的响应，避免额度短暂串到新账号。
      if (activeKeyRef.current !== apiKey) return null;
      infoRef.current = next;
      fetchedAtRef.current = Date.now();
      setInfo(next);
      setFetchedAt(fetchedAtRef.current);
      setError(null);
      return next;
    } catch (requestError) {
      // 同一 Key 的旧快照仍保留，但必须显式暴露失败状态；切 Key 后没有旧快照时，
      // 侧栏也应显示红色错误行，而不是把 Opus 限额整行静默隐藏。
      if (activeKeyRef.current === apiKey) {
        const message = requestError instanceof Error ? requestError.message.trim() : '';
        setError(message.slice(0, 300) || 'NovelAI 订阅信息请求失败');
      }
      return activeKeyRef.current === apiKey ? infoRef.current : null;
    } finally {
      if (activeKeyRef.current === apiKey) setLoading(false);
    }
  }, []);

  /** 快照仍在有效期内时直接复用，避免生成前无谓等待。 */
  const refreshIfStale = useCallback(async (): Promise<NovelaiSubscriptionInfo | null> => {
    if (Date.now() - fetchedAtRef.current < USAGE_SNAPSHOT_TTL) return infoRef.current;
    return refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
    // 订阅共享驱动：interval、visibilitychange 与全局事件只由驱动维护一份；
    // 驱动 tick 时唤醒各实例刷新（实例各自持有自己的 state/key refs）
    const subscriber: UsageSubscriber = { poll: () => void refresh() };
    usageSubscribers.add(subscriber);
    startUsageDriver();
    return () => {
      usageSubscribers.delete(subscriber);
      if (usageSubscribers.size === 0) stopUsageDriver();
    };
  }, [refresh]);

  return { info, usage: info?.usage, loading, error, fetchedAt, refresh, refreshIfStale };
};
