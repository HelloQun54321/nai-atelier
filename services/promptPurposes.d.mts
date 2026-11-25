import type { PromptLibraryTreeState } from './promptLibraryTree.mjs';

export type PromptPurposeId = 'appearance' | 'clothing' | 'pose' | 'expression' | 'interaction' | 'place' | 'atmosphere' | 'camera' | 'format' | 'style';
/** 旧版细项与旧版画风细分仅在读取旧资料时出现，运行时归并到当前用途。 */
export type LegacyPromptPurposeId = 'identity' | 'object' | 'creature' | 'vehicle' | 'nature' | 'time' | 'lighting' | 'color' | 'composition' | 'text' | 'effect' | 'artist' | 'texture' | 'quality';
export type PurposeSectionKey = `purpose:${PromptPurposeId}`;
export type CustomSectionKey = `custom:${string}`;
export type CreativeSectionKey = PurposeSectionKey | `directory:${string}` | CustomSectionKey;
export const PROMPT_PURPOSES: ReadonlyArray<{ id: PromptPurposeId; label: string; description: string }>;
export const PROMPT_PURPOSE_GROUPS: ReadonlyArray<{ id: string; label: string; purposes: readonly PromptPurposeId[] }>;
export const PROMPT_PURPOSE_IDS: readonly PromptPurposeId[];
export const LEGACY_PROMPT_PURPOSE_MAP: Readonly<Record<LegacyPromptPurposeId, PromptPurposeId>>;
export const normalizePromptPurposeId: (id: string) => PromptPurposeId;
export const PROMPT_PURPOSES_KEY: '_promptLibraryPurposes';
export const PROMPT_PURPOSE_INSTRUCTION: string;
export function promptPurposeLabel(id: string): string;
export function purposeSectionKey(id: PromptPurposeId): PurposeSectionKey;
export function normalizePromptPurposeSectionKey(key: string): string;
export function isPurposeSectionKey(key: unknown): key is PurposeSectionKey;
export function isCustomSectionKey(key: unknown): key is CustomSectionKey;
export function isCreativeSectionKey(key: unknown): key is CreativeSectionKey;
export function readPromptPurposes(value: unknown): PromptPurposeId[];
export function getExplicitEntryPurposes(entry: { params?: unknown } | null | undefined): PromptPurposeId[];
export function getEntryPurposes(entry: { params?: unknown; type?: unknown } | null | undefined, directories?: PromptLibraryTreeState): PromptPurposeId[];
export type PromptPurposeCandidateReason = 'eligible' | 'non_fragment' | 'empty_prompt' | 'negative_only' | 'unmarked' | 'mixed' | 'purpose_mismatch';
export function getPromptPurposeCandidateStatus(entry: { params?: unknown; type?: unknown; basePrompt?: unknown } | null | undefined, purposeId?: PromptPurposeId, directories?: PromptLibraryTreeState): { eligible: boolean; reason: PromptPurposeCandidateReason; purposes: PromptPurposeId[] };
export function selectPurposeEntries<T extends { params?: unknown }>(entries: readonly T[], purposeId: PromptPurposeId, pure?: boolean, directories?: PromptLibraryTreeState): T[];
