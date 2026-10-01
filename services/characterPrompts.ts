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

/** 正负提示词作为同一角色一起筛选，旧资料未记录 enabled 时默认启用。 */
export const getActiveCharacters = (characters?: CharacterParams[]): CharacterParams[] => (
  (characters || []).filter(character => character.enabled !== false && Boolean(character.prompt?.trim()))
);

/** 只归一化实际请求／结果快照，不修改包含停用角色的编辑草稿。 */
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
