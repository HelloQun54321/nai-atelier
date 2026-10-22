import type { CharacterParams, NAIParams } from '../types';
import { splitPromptSegments } from './promptTagFilter';

export const clampCharacterCoordinate = (value: unknown): number => {
  const number = typeof value === 'number' ? value : NaN;
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
};

/** 与官方网页一致：旧版按五等分所在格取中心，V5 保留自由坐标。 */
export const normalizeCharacterCoordinate = (value: unknown, freeform: boolean): number => {
  const coordinate = clampCharacterCoordinate(value);
  return freeform ? coordinate : [0.1, 0.3, 0.5, 0.7, 0.9][Math.min(4, Math.floor(coordinate * 5))];
};

/** 角色分栏的固定顺序：编译与展示都用这一份，避免各处顺序漂移。 */
export const CHARACTER_SECTION_KEYS = ['appearance', 'wardrobe', 'pose', 'expression'] as const;

const splitTags = (value: unknown): string[] =>
  splitPromptSegments(String(value ?? ''));

const probeTag = (value: string): string => String(value || '').trim().toLowerCase().replace(/[_\s]+/g, ' ');

/** 按归一化 tag 去重合并（与实验室其它合并口径一致）。 */
const joinTags = (lists: Array<string | undefined>): string => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const tag of splitTags(list)) {
      const probe = probeTag(tag);
      if (!probe || seen.has(probe)) continue;
      seen.add(probe);
      out.push(tag);
    }
  }
  return out.join(', ');
};

/** 角色是否写了任一栏内容（决定它是否算「有内容的角色」）。 */
export const hasCharacterSections = (character: CharacterParams): boolean =>
  CHARACTER_SECTION_KEYS.some(key => Boolean(String(character.sections?.[key] || '').trim()));

/**
 * 把分栏内容编译进**实际请求**：正文 = 四栏按固定顺序 + 手动补充正文；负面 = 四栏内容负面 + 角色负面。
 * 旧资料（没有 sections）原样返回，纯正文角色的行为完全不变。
 */
export const compileCharacterContent = (
  character: CharacterParams,
  legacyNegatives?: Record<string, unknown> | null,
): CharacterParams => {
  if (!hasCharacterSections(character)) return character;
  /* 旧格式：params._characterSectionsNegatives['角色id::分类']，新代码没读之前它会被静默丢掉 */
  const legacyOf = (key: string): string => {
    if (!legacyNegatives) return '';
    const scoped = legacyNegatives[String(character.id) + '::' + key];
    const direct = legacyNegatives[key];
    const value = scoped != null ? scoped : direct;
    if (value == null) return '';
    /* 旧数据里这一格可能是 { text, note } 这类对象，直接 String() 会变成 [object Object] */
    if (typeof value === 'object') {
      const record = value as { text?: unknown; note?: unknown; negative?: unknown };
      const text = record.text ?? record.negative ?? '';
      return String(text || '').trim() || String(record.note || '').trim();
    }
    return String(value).trim();
  };
  return {
    ...character,
    // AI 分类只整理原文，重复词也属于原配方，不能套用库片段的去重合并。
    prompt: Object.values(character.sectionMeta || {}).some(meta => meta?.source === 'ai')
      ? [...CHARACTER_SECTION_KEYS.map(key => character.sections?.[key]), character.prompt].map(value => value?.trim()).filter(Boolean).join(', ')
      : joinTags([...CHARACTER_SECTION_KEYS.map(key => character.sections?.[key]), character.prompt]),
    ...(() => {
      /* 没有负面时保持 undefined，不要把空串写进负数提示词字段 */
      const merged = joinTags([
        // 新分栏来源表示该栏已替换，缺少负面也不能复活旧格式负面。
        ...CHARACTER_SECTION_KEYS.map(key => character.sections?.[key]?.trim()
          ? character.sectionNegatives?.[key] ?? (character.sectionMeta?.[key] ? '' : legacyOf(key)) : ''),
        character.negativePrompt,
      ]);
      return merged ? { negativePrompt: merged } : {};
    })(),
  };
};

/** 正负提示词作为同一角色一起筛选，旧资料未记录 enabled 时默认启用；分栏有内容的角色同样参与请求。 */
export const getActiveCharacters = (characters?: CharacterParams[]): CharacterParams[] => (
  (characters || []).filter(character => character.enabled !== false
    && (Boolean(character.prompt?.trim()) || hasCharacterSections(character)))
);

/** 历史保留分栏与手写原文，编译留到实际 payload，避免再次取用后旧词重复混入。 */
export const withGenerationCharacters = (params: NAIParams, freeform: boolean): NAIParams => ({
  ...params,
  useCoords: params.useCoords === true,
  characters: getActiveCharacters(params.characters).map(character => ({
    ...character,
    x: normalizeCharacterCoordinate(character.x, freeform),
    y: normalizeCharacterCoordinate(character.y, freeform),
  })),
});

export const moveCharacter = (characters: CharacterParams[], index: number, direction: -1 | 1): CharacterParams[] => {
  const target = index + direction;
  if (index < 0 || index >= characters.length || target < 0 || target >= characters.length) return characters;
  const next = [...characters];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};
