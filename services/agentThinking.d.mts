export type AgentThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const AGENT_THINKING_LEVELS: AgentThinkingLevel[];
export const AGENT_THINKING_LABELS: Record<AgentThinkingLevel, string>;
export function normalizeAgentThinkingLevels(value: unknown): AgentThinkingLevel[];
export function normalizeAgentThinkingMap(value: unknown): Partial<Record<AgentThinkingLevel, string | null>>;
export function createAgentThinkingMap(levels: unknown, mapping?: unknown, advertised?: unknown): Record<AgentThinkingLevel, string | null>;
