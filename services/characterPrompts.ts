import { hasCharacterSections } from './agentLabSync.mjs';
import type { CharacterParams, NAIParams } from '../types';

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
