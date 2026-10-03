import type { PromptAgentGenerationResult } from '../types';
export function normalizeAgentGenerationResult(value: boolean | PromptAgentGenerationResult | void): PromptAgentGenerationResult;
export function agentOperationError(message: string, code?: string, outcome?: 'cancelled' | 'blocked' | 'failed'): Error & { code: string; outcome: 'cancelled' | 'blocked' | 'failed' };
export function agentGenerationFailure(error: unknown): PromptAgentGenerationResult;
