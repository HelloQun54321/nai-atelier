import { hasCharacterSections } from './agentLabSync.mjs';
import { t } from './i18n';
import type { CharacterParams, NAIParams } from '../types';

const DEFAULT_CHARACTER_NAME_PATTERN = /^(?:角色|Character)\s+(\d+)$/i;

export const isDefaultCharacterName = (name?: string | null): boolean => (
  Boolean(name && DEFAULT_CHARACTER_NAME_PATTERN.test(name.trim()))
);

const collectUsedDefaultCharacterNumbers = (characters: CharacterParams[]): Set<number> => {
  const used = new Set<number>();
  characters.forEach((character, index) => {
    const trimmed = character.name?.trim();
    if (!trimmed) {
      used.add(index + 1);
      return;
    }
    const match = trimmed.match(DEFAULT_CHARACTER_NAME_PATTERN);
    if (match) used.add(Number(match[1]));
  });
  return used;
};

/** 为新建角色分配最小未占用的默认编号名，确保后续拖拽换位时名字固定跟随角色本身。 */
export const nextDefaultCharacterName = (characters: CharacterParams[] = []): string => {
  const used = collectUsedDefaultCharacterNumbers(characters);
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return t('角色 {0}', [candidate]);
};

/** 兼容尚未写入 name 的旧草稿：重排前先把未命名角色按当前序号固化默认名，避免拖动后名字随位置漂移或重号。 */
export const solidifyCharacterDefaultNames = (characters: CharacterParams[]): CharacterParams[] => {
  if (characters.every(character => Boolean(character.name?.trim()))) return characters;
  const used = new Set<number>();
  characters.forEach(character => {
    const match = character.name?.trim().match(DEFAULT_CHARACTER_NAME_PATTERN);
    if (match) used.add(Number(match[1]));
  });
  return characters.map((character, index) => {
    if (character.name?.trim()) return character;
    let candidate = index + 1;
    if (used.has(candidate)) {
      candidate = 1;
      while (used.has(candidate)) candidate += 1;
    }
    used.add(candidate);
    return { ...character, name: t('角色 {0}', [candidate]) };
  });
};

export const clampCharacterCoordinate = (value: unknown): number => {
  const number = typeof value === 'number' ? value : NaN;
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
};

/** 与官方网页一致：旧版按五等分所在格取中心，V5 保留自由坐标。 */
export const normalizeCharacterCoordinate = (value: unknown, freeform: boolean): number => {
  const coordinate = clampCharacterCoordinate(value);
  return freeform ? coordinate : [0.1, 0.3, 0.5, 0.7, 0.9][Math.min(4, Math.floor(coordinate * 5))];
};

export { CHARACTER_SECTION_KEYS, getCharacterSectionKeys, hasCharacterSections, compileCharacterContent } from './agentLabSync.mjs';

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

/** 按指针拖拽或键盘排序的目标索引重排角色列表，越界或同位置保持原数组引用；重排前固化未命名角色的默认名。 */
export const reorderCharacter = (characters: CharacterParams[], fromIndex: number, toIndex: number): CharacterParams[] => {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= characters.length || toIndex < 0 || toIndex >= characters.length) {
    return characters;
  }
  const next = [...solidifyCharacterDefaultNames(characters)];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};
