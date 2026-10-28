import type { PromptAgentDraft } from '../types';
export interface AgentPromptFieldChange { path: string[]; before?: unknown; after?: unknown; index?: number; hidden?: boolean; directoryName?: string; ownerIndex?: number; ownerName?: string }
export interface AgentPromptChange {
  id: string;
  target?: Pick<NonNullable<PromptAgentDraft['target']>, 'chainId' | 'mode'>;
  status: 'pending' | 'applied' | 'undone';
  changes: AgentPromptFieldChange[];
  appliedChanges?: AgentPromptFieldChange[];
  /** 仅本端保存回执失败时使用，不写入模型上下文。 */
  savePending?: boolean;
}
export function createAgentPromptChange(before: PromptAgentDraft, after: PromptAgentDraft, id?: string): AgentPromptChange;
export function validateAgentPromptChanges(changes: unknown): void;
export function applyAgentPromptChange(current: PromptAgentDraft, change: AgentPromptChange, direction: 'apply' | 'undo' | 'redo'): PromptAgentDraft;
export function diffPromptText(before: string, after: string): Array<{ kind: 'equal' | 'delete' | 'insert'; text: string }>;
