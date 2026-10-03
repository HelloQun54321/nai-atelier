import type { PromptAgentDraft } from '../types';
export interface AgentClientDraftChange { path: string[]; before?: unknown; after?: unknown }
export function diffAgentClientDraft(before: PromptAgentDraft, after: PromptAgentDraft): AgentClientDraftChange[];
export function applyAgentClientChanges(draft: PromptAgentDraft, changes: AgentClientDraftChange[]): string[];
