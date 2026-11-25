import type { CharacterParams } from '../types';
import { isDefaultCharacterName, nextDefaultCharacterName } from './characterPrompts';
import { lookupTagCatalogEntries, normalizeTagQuery } from './tagDictionary';
import { parsePromptTags } from './tagTranslations';

/** 将 Danbooru 角色 Tag 转为去作品括号的英文展示名，如 `2b_(nier:automata)` -> `2b`。 */
export const formatCharacterTagDisplayName = (tagName: string): string => {
  const spaced = tagName.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spaced) return '';
  const stripped = spaced.replace(/(?:\s*\([^()]*\))+\s*$/, '').trim();
  return stripped || spaced;
};

/**
 * 在离线 Tag 词库中查找提示词里第一个命中的角色词（category === 4）。
 * - 返回 `string`：命中角色名（去括号英文）
 * - 返回 `null`：词库正常查询但未命中任何角色词（含空提示词）
 * - 返回 `undefined`：词库查询异常（例如离线资源不可用），调用方应跳过不改名
 */
export const detectCharacterTagName = async (prompt: string): Promise<string | null | undefined> => {
  if (!prompt.trim()) return null;
  const tokens = parsePromptTags(prompt);
  if (!tokens.length) return null;
  let entries;
  try {
    entries = await lookupTagCatalogEntries(tokens.map(token => token.lookupTag));
  } catch {
    return undefined;
  }
  for (const token of tokens) {
    const entry = entries.get(normalizeTagQuery(token.lookupTag));
    if (entry && entry.category === 4) {
      const formatted = formatCharacterTagDisplayName(entry.name);
      if (formatted) return formatted;
    }
  }
  return null;
};

/** 判断角色是否允许由词库自动命名：仅默认名、空名或上次自动识别名允许更新，手动改名锁定不覆盖。 */
export const isCharacterEligibleForAutoName = (character: CharacterParams): boolean => (
  !character.name?.trim() || isDefaultCharacterName(character.name) || character.autoNamed === true
);

/** 计算自动识别结果对应的更新补丁；无需变动或已手动锁定时返回 `null`。 */
export const resolveCharacterAutoRenamePatch = (
  characters: CharacterParams[],
  characterId: string,
  detectedName: string | null,
): Partial<CharacterParams> | null => {
  const current = characters.find(item => item.id === characterId);
  if (!current || !isCharacterEligibleForAutoName(current)) return null;

  if (detectedName) {
    if (current.name === detectedName && current.autoNamed === true) return null;
    return { name: detectedName, autoNamed: true };
  }

  if (current.autoNamed === true) {
    const others = characters.filter(item => item.id !== characterId);
    return { name: nextDefaultCharacterName(others), autoNamed: false };
  }
  return null;
};

/** 处理行内手动改名提交：输入新名即锁定不再被自动覆盖，清空则恢复默认编号并重新允许自动识别。 */
export const resolveManualCharacterNamePatch = (
  characters: CharacterParams[],
  characterId: string,
  draft: string,
): Partial<CharacterParams> => {
  const current = characters.find(item => item.id === characterId);
  const trimmed = draft.trim();
  if (!trimmed) {
    const others = characters.filter(item => item.id !== characterId);
    return { name: nextDefaultCharacterName(others), autoNamed: false };
  }
  if (current?.autoNamed && trimmed === current.name) {
    return { name: trimmed, autoNamed: true };
  }
  return { name: trimmed, autoNamed: false };
};
