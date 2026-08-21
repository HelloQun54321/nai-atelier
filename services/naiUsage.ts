import { useCallback, useEffect, useState } from 'react';

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
  /** 订阅等级：1 Paper / 2 Tablet / 3 Scroll / 4 Opus。 */
  tier: number;
  active: boolean;
  /** 仅 Opus 订阅会返回 usage。 */
  usage?: NovelaiUsageState;
}

// ===== 官方映射（逐行对照 NovelAI Web 应用 2026-08-22 版 bundle，勿凭记忆修改）=====

/** 剩余百分比：透支显示 0，其余钳制在 0–100（官方 isNegative?0:min(100,max(0,percent))）。 */
export const clampUsagePercent = (usage: NovelaiUsageState): number =>
  usage.isNegative ? 0 : Math.min(100, Math.max(0, usage.percent));

/** 每天恢复的百分比：86400 / timeUntilNextPercent，保留一位小数（官方同式）。 */
export const usagePercentPerDay = (usage: NovelaiUsageState): number => {
  const seconds = Number(usage.timeUntilNextPercent);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round((86400 / seconds) * 10) / 10;
};

/** 剩余可生成张数 ≈ 17.3 × 钳制后的百分比（官方 round(17.3 × percent)）。 */
export const usageRemainingImages = (usage: NovelaiUsageState): number =>
  Math.round(17.3 * clampUsagePercent(usage));

export const NOVELAI_USAGE_REFRESH_EVENT = 'nai-novelai-usage-refresh';

const SUBSCRIPTION_REFRESH_INTERVAL = 5 * 60 * 1000;

/** 生图完成后（以及定期）刷新 NovelAI 订阅限额状态。 */
export const useNovelaiUsage = () => {
  const [info, setInfo] = useState<NovelaiSubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // 与 GlobalSettings 相同的读取顺序，保证设置里改 Key 后下一次刷新即生效。
    const apiKey = sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '';
    if (!apiKey) {
      setInfo(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/novelai-subscription', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(await res.text());
      setInfo(await res.json());
    } catch {
      // 保留上一次的状态；侧栏展示不因临时网络失败闪断。
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onRefresh = () => void refresh();
    const onFocus = () => void refresh();
    window.addEventListener(NOVELAI_USAGE_REFRESH_EVENT, onRefresh);
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(onRefresh, SUBSCRIPTION_REFRESH_INTERVAL);
    return () => {
      window.removeEventListener(NOVELAI_USAGE_REFRESH_EVENT, onRefresh);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { info, usage: info?.usage, loading, refresh };
};
