import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';

const path = '/st-baibai/preferences';
const disabled = { enabled: false, ready: false, busy: false, error: '' };
let value = disabled;
let revision = 0;
let reading: Promise<void> | undefined;
let writing: Promise<void> | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = (next: typeof disabled) => { value = next; listeners.forEach(listener => listener()); };
const readEnabled = (response: { enabled?: unknown }) => {
  if (typeof response?.enabled !== 'boolean') throw new Error('柏宝绘同步设置响应无效');
  return response.enabled;
};

export async function refreshStBaiBaiPreferences() {
  if (writing) await writing.catch(() => {});
  if (reading) return reading;
  const ticket = ++revision;
  const pending = (async () => {
    try {
      const enabled = readEnabled(await api.get(path, { cache: 'no-store' }));
      if (ticket === revision) publish({ enabled, ready: true, busy: false, error: '' });
    } catch (error) {
      if (ticket === revision) publish({ enabled: false, ready: true, busy: false, error: error instanceof Error ? error.message : '读取柏宝绘同步设置失败' });
    }
  })();
  reading = pending;
  try { await pending; }
  finally { if (reading === pending) reading = undefined; }
}

export async function setStBaiBaiEnabled(enabled: boolean) {
  if (writing) return writing;
  const ticket = ++revision;
  reading = undefined;
  publish({ ...value, busy: true, error: '' });
  const pending = (async () => {
    try {
      const saved = readEnabled(await api.post(path, { enabled }));
      if (ticket === revision) publish({ enabled: saved, ready: true, busy: false, error: '' });
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel('nai-baibai-sync');
          channel.postMessage('changed'); channel.close();
        }
      } catch { /* 浏览器禁用跨页通知时，仍可在回到前台时重读；保存结果不受影响。 */ }
    } catch (error) {
      if (ticket === revision) publish({ ...value, busy: false, error: error instanceof Error ? error.message : '保存柏宝绘同步设置失败' });
      throw error;
    }
  })();
  writing = pending;
  try { await pending; }
  finally { if (writing === pending) writing = undefined; }
}

/** 柏宝绘同步独立开关；与智慧姬同步互相隔离，互不干扰。 */
export function useStBaiBaiPreferences(active = true) {
  const preferences = useSyncExternalStore(subscribe, () => active ? value : disabled, () => disabled);
  useEffect(() => {
    if (!active) return;
    const refresh = () => { void refreshStBaiBaiPreferences(); };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('nai-project-data-changed', refresh);
    let channel: BroadcastChannel | undefined;
    try { if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel('nai-baibai-sync'); }
    catch { /* 受限浏览器使用焦点事件恢复。 */ }
    channel?.addEventListener('message', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('nai-project-data-changed', refresh);
      channel?.close();
    };
  }, [active]);
  return preferences;
}
