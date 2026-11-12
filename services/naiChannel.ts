import { useSyncExternalStore } from 'react';
import { naiKeyVault, type NaiKeyEntry } from './naiKeyVault';
import { readActiveNaiKey } from './naiKeyStorage';

/**
 * 当前 Key 的接入渠道。
 *
 * 'per-use'（按次渠道）：用户自填 URL 的按调用计费中转，不提供官方点数/额度。
 * 生成请求仍按保存的网关地址发送，但订阅查询、本地预算与额度显示全部跳过。
 */
export type NaiChannelMode = 'official' | 'gateway' | 'per-use';

let mode: NaiChannelMode = 'official';
let resolving: Promise<NaiChannelMode> | null = null;
const listeners = new Set<() => void>();

const apply = (next: NaiChannelMode) => {
  if (next === mode) return;
  mode = next;
  listeners.forEach(listener => listener());
};

const modeOf = (entries: NaiKeyEntry[]): NaiChannelMode => {
  const key = readActiveNaiKey();
  const entry = entries.find(item => item.key === key);
  if (entry?.billingMode === 'per-use') return 'per-use';
  if (entry?.gatewayUrl) return 'gateway';
  return 'official';
};

/** 同步读取最近一次解析结果；首次渲染可能为 'official'，解析完成后自动更新。 */
export const getNaiChannelMode = () => mode;
export const isPerUseNaiChannel = () => mode === 'per-use';

/** 按当前活动 Key 重算渠道；并发调用合并为一次保管箱读取。 */
export const resolveNaiChannelMode = async (): Promise<NaiChannelMode> => {
  if (resolving) return resolving;
  resolving = (async () => {
    try { apply(modeOf(await naiKeyVault.list())); } catch { /* 保管箱不可达时保留上次结果。 */ }
    return mode;
  })().finally(() => { resolving = null; });
  return resolving;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const useNaiChannelMode = (): NaiChannelMode => useSyncExternalStore(subscribe, getNaiChannelMode, () => 'official');

if (typeof window !== 'undefined') {
  window.addEventListener('nai-api-key-changed', () => { void resolveNaiChannelMode(); });
  window.addEventListener('nai-key-vault-changed', () => { void resolveNaiChannelMode(); });
  void resolveNaiChannelMode();
}
