import { useSyncExternalStore } from 'react';
import { DEFAULT_PROMPT_TIDY_SETTINGS, normalizePromptTidySettings, type PromptTidySettings } from './promptTidy';

/**
 * 提示词整理的上次设置与自定义快捷按钮，按当前浏览器保存。
 * 快捷按钮直接排在提示词工具栏里，数量受工具栏宽度限制。
 */
export interface PromptTidyPreset { id: string; name: string; settings: PromptTidySettings }
export interface PromptTidyState { draft: PromptTidySettings; presets: readonly PromptTidyPreset[] }

export const PROMPT_TIDY_PRESET_LIMIT = 4;
export const PROMPT_TIDY_NAME_LIMIT = 12;
const STORAGE_KEY = 'nai_prompt_tidy';
const listeners = new Set<() => void>();

const read = (): PromptTidyState => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as { draft?: unknown; presets?: unknown } | null;
    const stored: unknown[] = value && Array.isArray(value.presets) ? value.presets : [];
    const presets = stored.flatMap(item => {
      const preset = item as Partial<PromptTidyPreset> | null;
      const name = typeof preset?.name === 'string' ? preset.name.trim().slice(0, PROMPT_TIDY_NAME_LIMIT) : '';
      return typeof preset?.id === 'string' && name ? [{ id: preset.id, name, settings: normalizePromptTidySettings(preset.settings) }] : [];
    }).slice(0, PROMPT_TIDY_PRESET_LIMIT);
    return { draft: normalizePromptTidySettings(value?.draft ?? DEFAULT_PROMPT_TIDY_SETTINGS), presets };
  } catch {
    return { draft: { ...DEFAULT_PROMPT_TIDY_SETTINGS }, presets: [] };
  }
};

let state: PromptTidyState = typeof window === 'undefined' ? { draft: { ...DEFAULT_PROMPT_TIDY_SETTINGS }, presets: [] } : read();

const write = (next: PromptTidyState) => {
  state = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* 隐私模式仍保留本次会话状态 */ }
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return;
    state = read();
    listeners.forEach(listener => listener());
  });
}

export const getPromptTidyState = () => state;
export const usePromptTidyState = () => useSyncExternalStore(subscribe, getPromptTidyState);

export const setPromptTidyDraft = (draft: PromptTidySettings) => write({ ...state, draft: normalizePromptTidySettings(draft) });

export const addPromptTidyPreset = (name: string, settings: PromptTidySettings): PromptTidyPreset => {
  const trimmed = name.trim().slice(0, PROMPT_TIDY_NAME_LIMIT);
  if (!trimmed) throw new Error('请先给快捷按钮起个名字');
  if (state.presets.length >= PROMPT_TIDY_PRESET_LIMIT) throw new Error('快捷按钮已满，请先删掉一个');
  const preset = { id: `tidy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: trimmed, settings: normalizePromptTidySettings(settings) };
  write({ ...state, presets: [...state.presets, preset] });
  return preset;
};

export const removePromptTidyPreset = (id: string) => write({ ...state, presets: state.presets.filter(preset => preset.id !== id) });

/** 测试与跨标签页同步后重新读取存储。 */
export const reloadPromptTidyState = () => { state = read(); listeners.forEach(listener => listener()); };
