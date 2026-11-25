import { useEffect, useRef } from 'react';
import type { CharacterParams } from '../../types';
import { compileCharacterContent } from '../../services/characterPrompts';
import {
  detectCharacterTagName,
  isCharacterEligibleForAutoName,
  resolveCharacterAutoRenamePatch,
} from '../../services/characterAutoName';

interface UseCharacterAutoRenameOptions {
  characters: CharacterParams[];
  canEdit: boolean;
  legacyNegatives?: Record<string, unknown> | null;
  onRename: (index: number, patch: Partial<CharacterParams>) => void;
}

/**
 * 监听角色提示词变化并在离线词库命中角色 Tag 时自动更新角色名。
 * 仅对默认名或上次自动识别名生效，绝不覆盖用户手动修改过的角色名称。
 */
export function useCharacterAutoRename({
  characters,
  canEdit,
  legacyNegatives,
  onRename,
}: UseCharacterAutoRenameOptions) {
  const charactersRef = useRef(characters);
  charactersRef.current = characters;
  const onRenameRef = useRef(onRename);
  onRenameRef.current = onRename;
  const checkedPromptsRef = useRef(new Map<string, string>());

  const promptSignature = characters
    .map(character => `${character.id}:${character.name ?? ''}:${character.autoNamed ? '1' : '0'}:${compileCharacterContent(character, legacyNegatives).prompt}`)
    .join('\0');

  useEffect(() => {
    const liveIds = new Set(characters.map(character => character.id));
    for (const id of checkedPromptsRef.current.keys()) {
      if (!liveIds.has(id)) checkedPromptsRef.current.delete(id);
    }
    if (!canEdit) return;

    const pending: Array<{ id: string; prompt: string }> = [];
    for (const character of characters) {
      if (!isCharacterEligibleForAutoName(character)) continue;
      const compiledPrompt = compileCharacterContent(character, legacyNegatives).prompt;
      if (checkedPromptsRef.current.get(character.id) === compiledPrompt) continue;
      pending.push({ id: character.id, prompt: compiledPrompt });
    }
    if (!pending.length) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all(pending.map(async item => ({
        ...item,
        detected: await detectCharacterTagName(item.prompt),
      }))).then(results => {
        if (cancelled) return;
        for (const item of results) {
          if (item.detected === undefined) continue;
          const latestCharacters = charactersRef.current;
          const latestIndex = latestCharacters.findIndex(character => character.id === item.id);
          if (latestIndex < 0) continue;
          const latestPrompt = compileCharacterContent(latestCharacters[latestIndex], legacyNegatives).prompt;
          if (latestPrompt !== item.prompt) continue;
          checkedPromptsRef.current.set(item.id, item.prompt);
          const patch = resolveCharacterAutoRenamePatch(latestCharacters, item.id, item.detected);
          if (patch) {
            onRenameRef.current(latestIndex, patch);
          }
        }
      });
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [promptSignature, canEdit, legacyNegatives]);
}
