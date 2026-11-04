import { useSyncExternalStore } from 'react';
import type { CharacterParams, NAIParams, PromptModule } from '../types';
import { findNaiModelInfo } from './naiModels';

/**
 * 样张：画风串接上 main 与角色出一张图，参数沿用原图（当前编辑器）或用户存下的样张设置。
 * 只有 main 与角色两类提示词，不带原来的主体、模块与分栏；角色默认用样张面板里填的，
 * 也可沿用原图角色（含站位与精准参考）。设置按当前浏览器保存。
 */
export type PromptSampleSource = 'original' | 'mine';
export interface PromptSampleSnapshot { params: NAIParams; negativePrompt: string; savedAt: number }
export interface PromptSampleSize { width: number; height: number }
/** originalSize：沿用原图设置时单独改的尺寸，null 表示跟原图一致。 */
export interface PromptSampleSettings { source: PromptSampleSource; main: string; characters: string[]; keepOriginalCharacters: boolean; originalSize: PromptSampleSize | null; snapshot: PromptSampleSnapshot | null }
export interface PromptSampleDraft { basePrompt: string; subjectPrompt: string; negativePrompt: string; modules: PromptModule[]; params: NAIParams }
/** 编辑器提供的出图通道：generate 走与「生成」相同的扣费确认和历史保存。 */
export interface PromptSampleBridge {
  generate: (style: string) => Promise<boolean>;
  current: () => { params: NAIParams; negativePrompt: string };
  /** 「我的样张设置」可选的模型，与编辑器模型选择器一致。 */
  models: ReadonlyArray<{ id: string; label: string }>;
}

export const PROMPT_SAMPLE_CHARACTER_LIMIT = 6;
export const PROMPT_SAMPLE_TEXT_LIMIT = 4000;
const STORAGE_KEY = 'nai_prompt_sample';
const DEFAULT_SETTINGS: PromptSampleSettings = { source: 'original', main: '', characters: [], keepOriginalCharacters: false, originalSize: null, snapshot: null };
const listeners = new Set<() => void>();

/** 角色、精准参考、氛围参考与 `_` 开头的编辑器元数据都不进样张设置；氛围参考体积大，也不适合存进浏览器。 */
const stripParams = (params: NAIParams, keepVibes: boolean): NAIParams => {
  const next = Object.fromEntries(Object.entries(params).filter(([key]) => !key.startsWith('_') && key !== 'characters' && key !== 'characterReferences' && key !== 'useCoords' && (keepVibes || key !== 'vibes')));
  return structuredClone(next) as unknown as NAIParams;
};

export const createPromptSampleSnapshot = (params: NAIParams, negativePrompt: string, savedAt = Date.now()): PromptSampleSnapshot =>
  ({ params: stripParams(params, false), negativePrompt, savedAt });

const readSnapshot = (value: unknown): PromptSampleSnapshot | null => {
  const snapshot = value as Partial<PromptSampleSnapshot> | null;
  const params = snapshot?.params as Partial<NAIParams> | undefined;
  if (!params || typeof params !== 'object' || ![params.width, params.height, params.steps, params.scale].every(item => typeof item === 'number' && Number.isFinite(item)) || typeof params.sampler !== 'string') return null;
  return createPromptSampleSnapshot(params as NAIParams, typeof snapshot?.negativePrompt === 'string' ? snapshot.negativePrompt : '', typeof snapshot?.savedAt === 'number' ? snapshot.savedAt : 0);
};

const readSize = (value: unknown): PromptSampleSize | null => {
  const size = value as Partial<PromptSampleSize> | null;
  return size && [size.width, size.height].every(item => Number.isInteger(item) && item! >= 64 && item! <= 4096) ? { width: size.width!, height: size.height! } : null;
};

export function normalizePromptSampleSettings(value: unknown): PromptSampleSettings {
  const input = value && typeof value === 'object' ? value as Partial<Record<keyof PromptSampleSettings, unknown>> : {};
  return {
    source: input.source === 'mine' ? 'mine' : 'original',
    main: typeof input.main === 'string' ? input.main.slice(0, PROMPT_SAMPLE_TEXT_LIMIT) : '',
    characters: (Array.isArray(input.characters) ? input.characters : []).filter((item): item is string => typeof item === 'string')
      .map(item => item.slice(0, PROMPT_SAMPLE_TEXT_LIMIT)).slice(0, PROMPT_SAMPLE_CHARACTER_LIMIT),
    keepOriginalCharacters: input.keepOriginalCharacters === true,
    originalSize: readSize(input.originalSize),
    snapshot: readSnapshot(input.snapshot),
  };
}

/**
 * 最终正向＝画风串＋main，原图的主体和模块都不带；沿用原图设置时可单独换尺寸。角色默认用样张角色、由 AI 自动摆位；
 * 沿用原图角色时连同站位与精准参考一起带上，所选模型不支持精准参考时只去掉参考，避免整次请求被拒。
 */
export function buildPromptSampleDraft(style: string, settings: PromptSampleSettings, current: { params: NAIParams; negativePrompt: string }): PromptSampleDraft {
  const mine = settings.source === 'mine' && settings.snapshot;
  const base = mine ? settings.snapshot!.params : stripParams(current.params, true);
  const keep = settings.keepOriginalCharacters;
  const characters: CharacterParams[] = keep ? structuredClone(current.params.characters ?? [])
    : settings.characters.map(prompt => prompt.trim()).filter(Boolean).map((prompt, index) => ({ id: `sample-${index + 1}`, enabled: true, prompt, x: 0.5, y: 0.5 }));
  const params: NAIParams = { ...structuredClone(base), ...(!mine && settings.originalSize ? settings.originalSize : {}), characters, useCoords: keep ? current.params.useCoords : false };
  if (keep && current.params.characterReferences && findNaiModelInfo(params.model)?.supportsCharacterReferences) params.characterReferences = structuredClone(current.params.characterReferences);
  return {
    basePrompt: [style.trim(), settings.main.trim()].filter(Boolean).join(', '),
    subjectPrompt: '',
    // 我的样张设置里负面词留空时沿用原图（当前编辑器）的负面词。
    negativePrompt: mine && settings.snapshot!.negativePrompt.trim() ? settings.snapshot!.negativePrompt : current.negativePrompt,
    modules: [],
    params,
  };
}

const read = (): PromptSampleSettings => {
  try { return normalizePromptSampleSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); }
  catch { return { ...DEFAULT_SETTINGS }; }
};
let state: PromptSampleSettings = typeof window === 'undefined' ? { ...DEFAULT_SETTINGS } : read();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return;
    state = read();
    emit();
  });
}

export const getPromptSampleSettings = () => state;
export const usePromptSampleSettings = () => useSyncExternalStore(subscribe, getPromptSampleSettings);
export const updatePromptSampleSettings = (patch: Partial<PromptSampleSettings>) => {
  state = normalizePromptSampleSettings({ ...state, ...patch });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 隐私模式仍保留本次会话状态 */ }
  emit();
};
/** 测试与跨标签页同步后重新读取存储。 */
export const reloadPromptSampleSettings = () => { state = read(); emit(); };
