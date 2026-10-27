import type { PromptAgentDraft, PromptSectionSource } from '../types';
import { hasCharacterSections } from './characterPrompts';
import { mergePromptSections } from './labWorkspace';
import { compilePrompt } from './promptUtils';

export type ClassifiedPrompt = { id: string; kind: 'global' | 'character'; sections: Record<string, string>; sectionMeta?: Record<string, PromptSectionSource> };

export const getClassificationDocuments = (draft: PromptAgentDraft) => {
  const documents: Array<{ id: string; kind: 'global' | 'character'; prompt: string }> = [];
  if (!mergePromptSections(draft.params._promptSections).trim()) {
    const prompt = compilePrompt(draft, draft.subjectPrompt);
    if (prompt.trim()) documents.push({ id: 'global', kind: 'global', prompt });
  }
  for (const character of draft.params.characters || []) {
    if (!hasCharacterSections(character) && character.prompt.trim()) documents.push({ id: character.id, kind: 'character', prompt: character.prompt });
  }
  return documents;
};

export const applyPromptClassification = (draft: PromptAgentDraft, items: ClassifiedPrompt[]): PromptAgentDraft => {
  const global = items.find(item => item.kind === 'global');
  const sections = global ? {
    ...Object.fromEntries(Object.entries(global.sections).filter(([key]) => key !== 'style')),
    ...(draft.params._promptSections?.sectionNegatives ? { sectionNegatives: draft.params._promptSections.sectionNegatives } : {}),
    ...(global.sectionMeta && Object.keys(global.sectionMeta).length ? { sectionMeta: global.sectionMeta } : {}),
  } : draft.params._promptSections;
  return {
    ...draft,
    ...(global ? { basePrompt: global.sections.style || '', subjectPrompt: mergePromptSections(sections), modules: [] } : {}),
    params: {
      ...draft.params, _promptSections: sections,
      characters: draft.params.characters?.map(character => {
        const item = items.find(item => item.kind === 'character' && item.id === character.id);
        if (!item) return character;
        const { extra, ...sections } = item.sections;
        return { ...character, prompt: extra || '', sections,
          sectionMeta: Object.fromEntries(Object.keys(sections).map(key => [key, { ...item.sectionMeta?.[key], source: 'ai' }])),
        };
      }),
    },
  };
};
