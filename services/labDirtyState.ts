import { CharacterParams, NAIParams, PromptModule, PromptSections } from '../types';
import { normalizeParams, normalizePromptSections } from './labWorkspace';
import { getEditableGlobalPrompt, getGlobalPromptSectionKeys } from './promptUtils';

export interface LabDirtySnapshotInput {
  basePrompt: string;
  subjectPrompt: string;
  negativePrompt: string;
  params: Partial<NAIParams> | null | undefined;
  modules?: PromptModule[];
  activeModules?: Record<string, boolean>;
}

const stableSerialize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(item => stableSerialize(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, stableSerialize(entryValue)]));
  }
  return value;
};

const normalizeRecordText = (source: Record<string, unknown> | undefined | null): Record<string, string> | undefined => {
  if (!source || typeof source !== 'object') return undefined;
  const entries = Object.entries(source)
    .map(([key, value]) => [key, String(value ?? '').trim()] as const)
    .filter(([, value]) => Boolean(value))
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? Object.fromEntries(entries) : undefined;
};

const canonicalizeSections = (sections: PromptSections | null | undefined, subjectPrompt: string) => {
  const normalized = normalizePromptSections(sections);
  if (!normalized) return null;
  const content: Record<string, string> = {};
  for (const key of getGlobalPromptSectionKeys(normalized)) {
    const val = String((normalized as Record<string, unknown>)[key] ?? '');
    if (val.trim()) content[key] = val;
  }
  const sectionNegatives = normalizeRecordText(normalized.sectionNegatives as Record<string, unknown> | undefined);
  const contentKeys = Object.keys(content);
  if (!sectionNegatives && contentKeys.length === 1 && contentKeys[0] === 'extra' && content.extra.trim() === subjectPrompt.trim()) {
    return null;
  }
  if (!contentKeys.length && !sectionNegatives) return null;
  return {
    content,
    ...(sectionNegatives ? { sectionNegatives } : {}),
  };
};

const isBlankDefaultCharacter = (char: {
  prompt: string;
  negativePrompt: string;
  name: string;
  enabled: boolean;
  x: number;
  y: number;
  sections?: Record<string, string>;
  sectionNegatives?: Record<string, string>;
}) => (
  !char.prompt.trim()
  && !char.negativePrompt.trim()
  && !char.name.trim()
  && char.enabled
  && char.x === 0.5
  && char.y === 0.5
  && !char.sections
  && !char.sectionNegatives
);

const canonicalizeCharacters = (characters: CharacterParams[]) => characters
  .map(character => {
    const sections = normalizeRecordText(character.sections as Record<string, unknown> | undefined);
    const sectionNegatives = normalizeRecordText(character.sectionNegatives as Record<string, unknown> | undefined);
    return {
      prompt: String(character.prompt ?? ''),
      negativePrompt: String(character.negativePrompt ?? ''),
      name: String(character.name ?? ''),
      enabled: character.enabled !== false,
      x: character.x,
      y: character.y,
      ...(sections ? { sections } : {}),
      ...(sectionNegatives ? { sectionNegatives } : {}),
    };
  })
  .filter(character => !isBlankDefaultCharacter(character));

const canonicalizeVibes = (vibes: NAIParams['vibes']) => {
  if (!vibes?.slots?.length) return null;
  return {
    enabled: Boolean(vibes.enabled),
    normalizeStrengths: vibes.normalizeStrengths !== false,
    slots: vibes.slots,
  };
};

const canonicalizeReferences = (references: NAIParams['characterReferences']) => {
  if (!references?.slots?.length) return null;
  return {
    enabled: Boolean(references.enabled),
    slots: references.slots,
  };
};

/**
 * 构建实验室当前草稿的规范化指纹，用于和基线快照比较是否真的发生内容改动。
 * 忽略开关细分视图、空白默认角色槽、空布局调整、随机生成 ID 与字段键顺序差异。
 */
export const buildLabDirtyFingerprint = (input: LabDirtySnapshotInput): string => {
  const normalizedParams = normalizeParams(input.params);
  const {
    characters,
    _promptSections,
    _labSectionLayout: _ignoredLayout,
    _styleBundleSources: _ignoredSources,
    vibes,
    characterReferences,
    ...restParams
  } = normalizedParams;

  const rawBasePrompt = String(input.basePrompt ?? '');
  const subjectPrompt = String(input.subjectPrompt ?? '');
  const sections = canonicalizeSections(_promptSections, subjectPrompt);

  const snapshot = {
    basePrompt: sections ? rawBasePrompt : getEditableGlobalPrompt(rawBasePrompt, subjectPrompt),
    subjectPrompt: sections ? subjectPrompt : '',
    negativePrompt: String(input.negativePrompt ?? ''),
    sections,
    characters: canonicalizeCharacters(characters || []),
    vibes: canonicalizeVibes(vibes),
    characterReferences: canonicalizeReferences(characterReferences),
    params: {
      ...restParams,
      seed: normalizedParams.seed ?? null,
    },
    modules: (input.modules || []).map(module => ({
      id: module.id,
      name: module.name,
      content: module.content,
      position: module.position || 'post',
      group: module.group || '',
      isActive: input.activeModules?.[module.id] ?? module.isActive,
    })),
  };

  return JSON.stringify(stableSerialize(snapshot));
};
