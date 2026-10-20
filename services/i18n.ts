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
// Apple 键盘以 ⌘ 为主修饰键；快捷键处理已同时接受 metaKey，这里只统一界面提示文案。
const APPLE_KEYBOARD = typeof navigator !== 'undefined' && /Mac|iPad/.test(navigator.platform || navigator.userAgent || '');
export const platformShortcutText = (text: string, apple = APPLE_KEYBOARD) => apple ? text.replace(/\bCtrl\s*\+\s*(?=[A-Za-z0-9])/g, '⌘').replace(/\bCtrl\b/g, '⌘') : text;
export const t = (message: string | number | null | undefined, values: readonly unknown[] = []) => platformShortcutText(translate(language, message, values));
if (typeof window !== 'undefined') {
  restoreLanguage();
  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === null) restoreLanguage(); });
}
