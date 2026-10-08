import { useSyncExternalStore } from 'react';
import { LANGUAGES, normalizeLanguage, translate } from '../locales/index.mjs';

export type Language = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko';
export { LANGUAGES };
const STORAGE_KEY = 'nai_language';
const listeners = new Set<() => void>();
let language: Language = 'zh-CN';

const readLanguage = (): Language => {
  try { return normalizeLanguage(localStorage.getItem(STORAGE_KEY) || window.atelierLanguage?.initial) as Language; }
  catch { return 'zh-CN'; }
};
const applyLanguage = () => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
    document.title = translate(language, 'NAI Atelier · NovelAI 创作工坊');
  }
  listeners.forEach(listener => listener());
};
export const getLanguage = () => language;
const mirrorLanguage = () => {
  void window.atelierLanguage?.set(language).catch(() => { /* 桌面镜像失败不阻断界面切换。 */ });
};
export const restoreLanguage = () => { language = readLanguage(); applyLanguage(); mirrorLanguage(); };
export const setLanguage = (value: Language) => {
  language = normalizeLanguage(value) as Language;
  try { localStorage.setItem(STORAGE_KEY, language); } catch { /* 存储不可用时仍保留本次会话的选择。 */ }
  applyLanguage();
  mirrorLanguage();
};
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useLanguage = () => useSyncExternalStore(subscribe, getLanguage, () => 'zh-CN' as Language);
export const t = (message: string | number | null | undefined, values: readonly unknown[] = []) => translate(language, message, values);
if (typeof window !== 'undefined') {
  restoreLanguage();
  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === null) restoreLanguage(); });
}
