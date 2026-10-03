import type { PromptAgentModel, PromptAgentUsage } from './promptAgent';
export interface AgentContextUsage { used: number; limit: number; cacheHitRate?: number }

/** 上下文取最近一次请求的完整用量，不能累加整段会话的账面 Token。 */
export const getAgentContextUsage = (messages: readonly { role: string; model?: string; provider?: string; usage?: PromptAgentUsage }[], model?: PromptAgentModel) => {
  if (!model || !Number.isFinite(model.contextWindow) || model.contextWindow <= 0) return undefined;
  const latest = [...messages].reverse().find(message => message.role === 'agent' && message.model === model.id && message.provider === model.provider && message.usage);
  if (!latest?.usage) return undefined;
  const usage = latest.usage;
  // Pi 的 input 不含缓存；输出已包含 reasoning，不重复加思考 Token。
  const fields = [usage.input, usage.cacheRead, usage.cacheWrite, usage.output];
  const used = Number.isFinite(usage.totalTokens) && usage.totalTokens >= 0 ? usage.totalTokens : fields.every(value => Number.isFinite(value) && value >= 0) ? fields.reduce((sum, value) => sum + value, 0) : undefined;
  const inputs = [usage.input, usage.cacheRead, usage.cacheWrite];
  const inputTotal = inputs.every(value => Number.isFinite(value) && value >= 0) ? inputs.reduce((sum, value) => sum + value, 0) : 0;
  const cacheHitRate = inputTotal > 0 ? usage.cacheRead / inputTotal * 100 : undefined;
  return used === undefined ? undefined : { used, limit: model.contextWindow, cacheHitRate };
};
