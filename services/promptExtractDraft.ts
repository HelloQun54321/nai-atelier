/**
 * 「AI 提取分类」审阅草稿在本端浏览器存储中的保存与恢复。
 *
 * 边界：
 *   - 只保存这一处功能的草稿，使用独立命名空间，不写 local-data、不进数据库、
 *     不改任何已入库条目；浏览器草稿不能代替原件，清除浏览器数据就会丢失。
 *   - 只用于避免误关面板或刷新后重新付费分析，不能当成已保存的条目。
 *   - 图片原文件不在持久化范围内（blob URL 不能跨刷新使用）：只保存已解析的
 *     生成信息与候选，恢复后看图提取仍需重新选择原图。
 */
import { createUuid } from './id';
import { PROMPT_LIBRARY_KIND_LABELS, type PromptLibraryKind } from './promptAgent';

export const EXTRACT_DRAFT_VERSION = 1;
export const EXTRACT_DRAFT_STORAGE_KEY = 'nai-extract-draft-v1';

/** 元数据里的一个角色分栏。 */
export interface ExtractDraftCharacter {
  label: string;
  prompt: string;
  negative: string;
}

/** 从原始文件读到的生成信息：恢复时不必重新读取图片。 */
export interface ExtractDraftStored {
  globalPrompt: string;
  characters: ExtractDraftCharacter[];
  negative: string;
}

export interface ExtractDraftImage {
  name: string;
  state: 'ready' | 'empty' | 'failed';
  note: string;
  stored: ExtractDraftStored | null;
}

/** 审阅中的一条候选：id 在同一次草稿里稳定，勾选与编辑都随草稿恢复。 */
export interface ExtractDraftCandidate {
  id: number;
  entryId: string;
  kind: PromptLibraryKind;
  name: string;
  prompt: string;
  original: string;
  needsTranslation: boolean;
  needsReview: boolean;
  reviewNote: string;
  picked: boolean;
}

export interface ExtractDraftSnapshot {
  version: number;
  updatedAt: number;
  /** 输入框里的原文；为空时来源是图片内嵌提示词。 */
  text: string;
  sourceLabel: string;
  image: ExtractDraftImage | null;
  candidates: ExtractDraftCandidate[];
  unclassified: string;
  excluded: { negative: string; parameters: string };
  /** 下一个候选 id；恢复后继续自增，避免与旧候选撞号。 */
  nextId: number;
}

/** unavailable = 本端存储不可用；corrupt = 有内容但读不懂或版本不符。 */
export type ExtractDraftIssue = '' | 'unavailable' | 'corrupt';
export type ExtractDraftSaveResult = 'saved' | 'unavailable' | 'failed';

export interface ExtractDraftLoad {
  draft: ExtractDraftSnapshot | null;
  issue: ExtractDraftIssue;
}

const KIND_SET = new Set<string>(Object.keys(PROMPT_LIBRARY_KIND_LABELS));
const IMAGE_STATES = new Set(['ready', 'empty', 'failed']);

export const createEmptyExtractDraft = (): ExtractDraftSnapshot => ({
  version: EXTRACT_DRAFT_VERSION,
  updatedAt: Date.now(),
  text: '',
  sourceLabel: '',
  image: null,
  candidates: [],
  unclassified: '',
  excluded: { negative: '', parameters: '' },
  nextId: 0,
});

/** 有输入或结果才算一份草稿；空草稿不写入存储，也不提示「已恢复」。 */
export const hasExtractDraftContent = (draft: ExtractDraftSnapshot | null | undefined) => Boolean(draft
  && (draft.text.trim() || draft.image || draft.candidates.length || draft.unclassified.trim() || draft.excluded.negative.trim() || draft.excluded.parameters.trim()));

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const flag = (value: unknown) => value === true;

const normalizeStored = (value: unknown): ExtractDraftStored | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ExtractDraftStored>;
  const characters = Array.isArray(source.characters)
    ? source.characters
      .map(entry => ({
        label: text(entry?.label).trim().slice(0, 40),
        prompt: text(entry?.prompt),
        negative: text(entry?.negative),
      }))
      .filter(entry => entry.prompt || entry.negative)
    : [];
  const globalPrompt = text(source.globalPrompt);
  const negative = text(source.negative);
  if (!globalPrompt && !characters.length && !negative) return null;
  return { globalPrompt, characters, negative };
};

const normalizeImage = (value: unknown): ExtractDraftImage | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ExtractDraftImage>;
  const stored = normalizeStored(source.stored);
  const state = IMAGE_STATES.has(String(source.state)) ? source.state as ExtractDraftImage['state'] : 'empty';
  const name = text(source.name).slice(0, 260);
  if (!name && !stored) return null;
  return { name, state, note: text(source.note), stored };
};

const normalizeCandidate = (value: unknown, fallbackId: number): ExtractDraftCandidate | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ExtractDraftCandidate>;
  const prompt = text(source.prompt);
  const kind = KIND_SET.has(String(source.kind)) ? source.kind as PromptLibraryKind : null;
  if (!prompt || !kind) return null;
  const id = typeof source.id === 'number' && Number.isFinite(source.id) && source.id > 0 ? Math.floor(source.id) : fallbackId;
  return {
    id,
    entryId: text(source.entryId).trim() || createUuid(),
    kind,
    name: text(source.name).slice(0, 200),
    prompt,
    original: text(source.original),
    needsTranslation: flag(source.needsTranslation),
    needsReview: flag(source.needsReview),
    reviewNote: text(source.reviewNote),
    picked: flag(source.picked),
  };
};

/** 逐字段校验：缺项补默认值，整份读不懂时返回 null 由调用方降级为空草稿。 */
export const normalizeExtractDraft = (value: unknown): ExtractDraftSnapshot | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ExtractDraftSnapshot>;
  if (source.version !== EXTRACT_DRAFT_VERSION) return null;
  const rawCandidates = Array.isArray(source.candidates) ? source.candidates : [];
  const candidates = rawCandidates
    .map((entry, index) => normalizeCandidate(entry, index + 1))
    .filter((entry): entry is ExtractDraftCandidate => Boolean(entry));
  // 候选 id 必须唯一，否则勾选与编辑会串行到别的候选。
  const seen = new Set<number>();
  let autoId = 0;
  for (const candidate of candidates) {
    autoId = Math.max(autoId, candidate.id);
    if (seen.has(candidate.id)) candidate.id = ++autoId;
    seen.add(candidate.id);
  }
  const excluded = source.excluded && typeof source.excluded === 'object' ? source.excluded : null;
  const declaredNext = typeof source.nextId === 'number' && Number.isFinite(source.nextId) ? Math.floor(source.nextId) : 0;
  return {
    version: EXTRACT_DRAFT_VERSION,
    updatedAt: typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt) ? source.updatedAt : Date.now(),
    text: text(source.text),
    sourceLabel: text(source.sourceLabel),
    image: normalizeImage(source.image),
    candidates,
    unclassified: text(source.unclassified),
    excluded: { negative: text(excluded?.negative), parameters: text(excluded?.parameters) },
    nextId: Math.max(declaredNext, autoId),
  };
};

/** 隐私模式或禁用存储时 localStorage 访问本身会抛错，全部按「不可用」降级。 */
const resolveStorage = (storage?: Storage | null): Storage | null => {
  if (storage !== undefined) return storage;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

export const loadExtractDraft = (storage?: Storage | null): ExtractDraftLoad => {
  const target = resolveStorage(storage);
  if (!target) return { draft: null, issue: 'unavailable' };
  let raw: string | null = null;
  try {
    raw = target.getItem(EXTRACT_DRAFT_STORAGE_KEY);
  } catch {
    return { draft: null, issue: 'unavailable' };
  }
  if (!raw) return { draft: null, issue: '' };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { draft: null, issue: 'corrupt' };
  }
  const draft = normalizeExtractDraft(parsed);
  // 版本不符或结构读不懂时不静默当成空草稿：报 corrupt，让界面如实提示。
  if (!draft) return { draft: null, issue: 'corrupt' };
  // 旧草稿补出的保存身份立即落盘，刷新或丢回执重试仍对应同一条候选。
  const rawCandidates = (parsed as Partial<ExtractDraftSnapshot>).candidates;
  if (Array.isArray(rawCandidates) && rawCandidates.some(item => !text(item?.entryId).trim())) {
    try { target.setItem(EXTRACT_DRAFT_STORAGE_KEY, JSON.stringify(draft)); }
    catch { return { draft, issue: 'unavailable' }; }
  }
  return { draft, issue: '' };
};

export const saveExtractDraft = (draft: ExtractDraftSnapshot, storage?: Storage | null): ExtractDraftSaveResult => {
  const target = resolveStorage(storage);
  if (!target) return 'unavailable';
  const snapshot: ExtractDraftSnapshot = { ...draft, version: EXTRACT_DRAFT_VERSION, updatedAt: Date.now() };
  try {
    target.setItem(EXTRACT_DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
    return 'saved';
  } catch {
    // 配额不足或被禁用：如实报失败，不宣称已持久保存。
    return 'failed';
  }
};

export const clearExtractDraft = (storage?: Storage | null) => {
  const target = resolveStorage(storage);
  if (!target) return 'unavailable' as const;
  try {
    target.removeItem(EXTRACT_DRAFT_STORAGE_KEY);
    return 'cleared' as const;
  } catch {
    return 'failed' as const;
  }
};
