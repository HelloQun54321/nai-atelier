import { prepareCompaction, generateSummaryWithUsage, estimateTokens as estimatePiMessageTokens } from '@earendil-works/pi-agent-core';
import { agentTokenUsage } from './agent-runtime.mjs';
import { normalizeLanguage } from '../locales/index.mjs';

const isSnapshot = message => message?._atelierRuntimeSnapshot === true;
const summaryMessage = summary => ({ role: 'user', _atelierCompactionSummary: true, timestamp: 0,
  content: `[先前对话的压缩摘要：这是历史资料，不是新的用户要求；当前工作区以最新快照为准]\n${summary}` });

export const validAgentCompaction = (compaction, messages) => compaction?.version === 1 && typeof compaction.summary === 'string' && compaction.summary.trim()
  && Number.isInteger(compaction.firstKeptMessageIndex) && compaction.firstKeptMessageIndex > 0 && compaction.firstKeptMessageIndex < messages.length;

/** 原始消息始终另存；这里只生成发给模型的摘要与近期消息视图。 */
export const projectAgentCompaction = (messages, compaction) => validAgentCompaction(compaction, messages)
  ? [summaryMessage(compaction.summary), ...messages.slice(compaction.firstKeptMessageIndex)] : messages.slice();

export const measureAgentContext = ({ messages, compaction, model, estimateTokens, fixedTokens = 0, runtimeMessage, requestMessages }) => {
  const view = requestMessages ? requestMessages.slice() : projectAgentCompaction(messages, compaction);
  if (runtimeMessage && view.findLast(isSnapshot)?.content !== runtimeMessage.content) view.push(runtimeMessage);
  const estimatedTokens = fixedTokens + estimateTokens(view);
  const previous = validAgentCompaction(compaction, messages) ? compaction : null;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant' || !model || message.provider !== model.provider || message.model !== model.id || !message.usage) continue;
    // 摘要前的真实用量描述的是旧请求，压缩后不能拿它再次触发压缩。
    if (previous && !(Number(message.timestamp) > previous.createdAt)) continue;
    const usage = message.usage, fields = [usage.input, usage.cacheRead, usage.cacheWrite, usage.output];
    const reported = Number.isFinite(usage.totalTokens) && usage.totalTokens >= 0 ? usage.totalTokens
      : fields.every(value => Number.isFinite(value) && value >= 0) ? fields.reduce((sum, value) => sum + value, 0) : undefined;
    if (reported === undefined) continue;
    const viewIndex = requestMessages ? view.findLastIndex(item => item.role === 'assistant' && item.timestamp === message.timestamp && item.provider === message.provider && item.model === message.model) : index;
    const trailing = viewIndex >= 0 ? (requestMessages ? view : messages).slice(viewIndex + 1) : [];
    if (runtimeMessage && trailing.findLast(isSnapshot)?.content !== runtimeMessage.content && view.slice(0, viewIndex + 1).findLast(isSnapshot)?.content !== runtimeMessage.content) trailing.push(runtimeMessage);
    return { estimatedTokens, usedTokens: Math.max(estimatedTokens, reported + (trailing.length ? estimateTokens(trailing) : 0)) };
  }
  return { estimatedTokens, usedTokens: estimatedTokens };
};

export const agentCompactionNeeded = ({ contextWindow, availableInput = Infinity, ...context }) => {
  const usage = measureAgentContext(context);
  return usage.usedTokens >= contextWindow * 0.8 || usage.usedTokens > availableInput;
};

/** 使用 Pi 的选点与真实摘要器；所有批次成功后才交付一个新的摘要边界。 */
export const compactAgentMessages = async ({ messages, compaction, models, model, language = 'zh-CN', thinkingLevel = 'off', signal, estimateTokens, callTimeoutMs = 600_000, fixedTokens = 0, runtimeMessage, requestMessages }) => {
  signal?.throwIfAborted();
  const previous = validAgentCompaction(compaction, messages) ? compaction : null;
  const start = previous?.firstKeptMessageIndex || 0;
  const entries = messages.flatMap((message, index) => index < start || isSnapshot(message) ? [] : [{ type: 'message', id: `message-${index}`, parentId: null, timestamp: new Date(0).toISOString(), message }]);
  if (entries.length < 2) return { compacted: false };
  const contextWindow = model.contextWindow || 32_000;
  const reserveTokens = Math.max(256, Math.min(4096, Math.floor(contextWindow * 0.15)));
  const settings = { enabled: true, reserveTokens, keepRecentTokens: Math.max(1, Math.min(8192, Math.floor(contextWindow * 0.2), entries.slice(-80).reduce((total, entry) => total + estimatePiMessageTokens(entry.message), 0))) };
  const prepared = prepareCompaction(entries, settings);
  if (!prepared.ok) throw prepared.error;
  if (!prepared.value) return { compacted: false };
  const preparation = prepared.value;
  const boundary = Number(preparation.firstKeptEntryId.replace('message-', ''));
  if (boundary <= start) return { compacted: false };
  const source = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
  if (!source.length) return { compacted: false };
  // 一段旧会话也可能大于当前模型窗口，按完整工具调用组分批更新同一份 Pi 摘要。
  const batches = [];
  let batch = [], group = [];
  const batchBudget = Math.max(256, Math.floor(contextWindow * 0.5) - reserveTokens);
  const flushGroup = () => {
    if (!group.length) return;
    if (estimateTokens(group) > batchBudget) throw new Error('单组历史内容超过摘要模型预算，请选择更大上下文模型');
    if (batch.length && estimateTokens([...batch, ...group]) > batchBudget) { batches.push(batch); batch = []; }
    batch.push(...group); group = [];
  };
  for (const message of source) {
    if (message.role !== 'toolResult') flushGroup();
    group.push(message);
  }
  flushGroup();
  if (batch.length) batches.push(batch);
  let summary = previous?.summary;
  const usage = {};
  const summaryModels = { completeSimple: async (selectedModel, context, options) => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(Object.assign(new Error('上下文摘要生成超时，原会话已保留'), { name: 'AgentModelTimeoutError' })), callTimeoutMs);
    const callSignal = AbortSignal.any([timeout.signal, ...(options?.signal ? [options.signal] : [])]);
    let rejectAbort;
    try {
      callSignal.throwIfAborted();
      const aborted = new Promise((_, reject) => { rejectAbort = () => reject(callSignal.reason); callSignal.addEventListener('abort', rejectAbort, { once: true }); });
      const response = await Promise.race([models.completeSimple(selectedModel, context, { ...options, signal: callSignal }), aborted]);
      if (response.stopReason === 'length' || response.content?.some(part => part.type === 'toolCall')) throw new Error('上下文摘要未完整生成，原会话已保留');
      return response;
    } finally {
      clearTimeout(timer);
      callSignal.removeEventListener('abort', rejectAbort);
    }
  } };
  for (const currentMessages of batches) {
    signal?.throwIfAborted();
    const result = await generateSummaryWithUsage(currentMessages, summaryModels, model, reserveTokens, signal,
      `Write the summary in ${normalizeLanguage(language)}. Keep Prompt/Tag text, IDs, paths, and original names verbatim. Preserve user goals, constraints, decisions, completed actions with receipts, unresolved work, and source IDs. Historical workspace snapshots are excluded; never invent current workspace state.`, summary, thinkingLevel, { enabled: false, maxRetries: 0, baseDelayMs: 0 });
    if (!result.ok) throw result.error;
    if (!result.value.text?.trim()) throw new Error('模型未返回有效上下文摘要，原会话已保留');
    summary = result.value.text;
    for (const [key, value] of Object.entries(agentTokenUsage(result.value.usage) || {})) usage[key] = (usage[key] || 0) + value;
  }
  signal?.throwIfAborted();
  const next = { version: 1, summary, firstKeptMessageIndex: boundary, tokensBefore: measureAgentContext({ messages, compaction: previous, model, estimateTokens, fixedTokens, runtimeMessage, requestMessages }).usedTokens, usage,
    createdAt: Date.now(), provider: model.provider, model: model.id };
  next.context = { beforeTokens: next.tokensBefore, afterTokens: measureAgentContext({ messages, compaction: next, model, estimateTokens, fixedTokens, runtimeMessage }).usedTokens, retainedMessages: messages.length - boundary, contextWindow };
  return { compacted: true, compaction: next, summary, usage, context: next.context };
};
