import type { CharacterParams, PromptSections, PromptAgentDraft } from '../types';
export interface AgentClientDraftChange { path: string[]; before?: unknown; after?: unknown }
export function diffAgentClientDraft(before: PromptAgentDraft, after: PromptAgentDraft): AgentClientDraftChange[];
export function applyAgentClientChanges(draft: PromptAgentDraft, changes: AgentClientDraftChange[]): string[];

export function getGlobalPromptSectionKeys(sections?: PromptSections | null): Array<'presentation' | 'appearance' | 'wardrobe' | 'pose' | 'scene' | 'camera' | 'extra' | `directory:${string}` | import('./promptPurposes.mjs').PurposeSectionKey>;
export function mergePromptFields(basePrompt: string, subjectPrompt: string): string;
export function getEditableGlobalPrompt(basePrompt: string, subjectPrompt: string): string;
export function getEditableGlobalNegative(negative: string, sections?: PromptSections): string;
export const CHARACTER_SECTION_KEYS: readonly ['appearance', 'wardrobe', 'pose', 'expression'];
export function getCharacterSectionKeys(character: CharacterParams): Array<typeof CHARACTER_SECTION_KEYS[number] | `directory:${string}` | import('./promptPurposes.mjs').PurposeSectionKey>;
export function hasCharacterSections(character: CharacterParams): boolean;
export function compileCharacterContent(character: CharacterParams, legacyNegatives?: Record<string, unknown> | null): CharacterParams;

export function normalizeAgentLabDraft(draft: PromptAgentDraft): PromptAgentDraft;
export function restoreUnchangedAgentLabFields(stored: PromptAgentDraft, proposed: PromptAgentDraft): PromptAgentDraft;

export function compilePrompt(chain: Pick<import('../types').PromptChain, 'basePrompt' | 'modules'>, subjectPrompt?: string, activeModulesOnly?: boolean): string;
