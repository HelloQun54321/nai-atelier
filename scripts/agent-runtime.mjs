import { createHash } from 'node:crypto';
import { createAssistantMessageEventStream, isRetryableAssistantError } from '@earendil-works/pi-ai';

// 工具结果只携带完成当前判断所需的文字；图片和编码由资产引用承载。
/** Agent 仅保留 Token 计数；供应商费用不进入事件、会话或诊断记录。 */
export const agentTokenUsage = usage => usage && typeof usage === 'object'
  ? Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens', 'reasoning'].filter(key => typeof usage[key] === 'number' && Number.isFinite(usage[key])).map(key => [key, usage[key]]))
  : undefined;
const withoutUsageFees = value => Array.isArray(value) ? value.map(withoutUsageFees) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'usage' ? agentTokenUsage(item) : withoutUsageFees(item)])) : value;

export const compactAgentValue = (input, { maxChars = 16_000, maxString = 4_000, maxItems = 30 } = {}) => {
  let remaining = maxChars, nodes = 600, omitted = false;
  const visit = (value, depth = 0, key = '') => {
    if (--nodes < 0 || depth > 12 || remaining < 32) { omitted = true; return '[内容已省略]'; }
    if (typeof value === 'string') {
      if (/^data:[^;]+;base64,/i.test(value) || /data|encoding|encoded|buffer|bytes|image/i.test(key) && value.length > 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        omitted = true; return `[二进制数据已省略：${value.length} 字符]`;
      }
      const limit = Math.min(maxString, remaining);
      remaining -= Math.min(value.length, limit);
      if (value.length > limit) { omitted = true; return value.slice(0, limit) + '…[未读完，请缩小查询范围]'; }
      return value;
    }
    if (Array.isArray(value)) {
      const result = [];
      for (const item of value.slice(0, maxItems)) {
        if (remaining < 32 || nodes <= 0) { omitted = true; break; }
        result.push(visit(item, depth + 1));
      }
      if (result.length < value.length) omitted = true;
      return result;
    }
    if (value && typeof value === 'object') {
      const result = {};
      for (const [key, item] of Object.entries(value).slice(0, 60)) {
        if (remaining < 32 || nodes <= 0) { omitted = true; break; }
        remaining -= key.length + 4;
        result[key] = visit(item, depth + 1, key);
      }
      if (Object.keys(result).length < Object.keys(value).length) omitted = true;
      return result;
    }
    remaining -= 12;
    return value;
  };
  const value = visit(input);
  return { value, omitted };
};

export const boundAgentToolResult = result => {
  let remaining = 16_000;
  const content = (result?.content || []).slice(0, 6).map(part => {
    if (part.type !== 'text') return part;
    let value;
    try { value = JSON.parse(part.text); } catch { value = String(part.text || ''); }
    const compact = compactAgentValue(value, { maxChars: Math.max(256, remaining) });
    const bounded = compact.omitted ? { data: compact.value, _agentNotice: '返回内容包含摘要或省略项；不得冒充完整资料。请按 ID、字段或分页继续读取，不要用摘要覆盖原资料。' } : compact.value;
    const text = typeof bounded === 'string' ? bounded : JSON.stringify(bounded);
    remaining -= text.length;
    return { ...part, text };
  });
  const details = compactAgentValue(result?.details, { maxChars: 2_000, maxString: 500, maxItems: 8 }).value;
  return { ...result, content, ...(result?.details !== undefined ? { details } : {}) };
};

// 展示/历史接口不发送图片 Base64；模型的原生图片内容仍由运行链路保留。
export const publicAgentToolContent = content => (content || []).map(part => part.type === 'image' ? { type: 'image', mimeType: part.mimeType, note: '图片正文仅交给当前模型' } : part);

// 多数推理模型的输出上限同时计入思考内容；实际值仍受模型 maxTokens 与上下文 20% 约束。
export const agentOutputLimit = (thinkingLevel = 'medium') => ['high', 'xhigh', 'max'].includes(thinkingLevel) ? 32_768 : ['off', 'minimal', 'low'].includes(thinkingLevel) ? 8_192 : 16_384;

/** 上下文容量由每次请求的装配器控制；循环保护只统计新输出，不重复累计历史输入。 */
export const createAgentRunBudget = ({ maxTurns = 64, maxOutputTokens = 131_072, maxTruncatedToolTurns = 2 } = {}) => {
  let turns = 0, outputTokens = 0, truncatedToolTurns = 0;
  return {
    observe(message) {
      if (message?.stopReason === 'aborted') return null;
      turns++;
      outputTokens += Math.max(0, Number(message?.usage?.output) || 0);
      // 最终回复已完成时不把成功任务改成中止；限额约束的是继续执行。
      if (!message?.content?.some(part => part.type === 'toolCall')) return null;
      // 截断的工具调用由 Pi 回报失败让模型重发；同一上限下连续截断就停止，不反复消耗。
      truncatedToolTurns = message.stopReason === 'length' ? truncatedToolTurns + 1 : 0;
      const code = turns >= maxTurns ? 'turn_limit' : outputTokens >= maxOutputTokens ? 'output_limit' : truncatedToolTurns >= maxTruncatedToolTurns ? 'output_truncated' : '';
      if (!code) return null;
      return Object.assign(new Error(code === 'turn_limit'
        ? `本次任务已执行 ${turns} 轮模型回复，达到连续执行上限；可以发送“继续”接着处理。`
        : code === 'output_limit' ? '本次任务的新输出达到连续执行上限；可以发送“继续”接着处理。'
          : `模型连续 ${truncatedToolTurns} 次在工具调用中途达到输出上限，已停止；可以换用输出上限更大的模型，或发送“继续”重试。`), { name: 'AgentRunLimitError', code, turns, outputTokens });
    },
  };
};

/** 查询类工具：只读取资料或页面，不改变项目、草稿与页面状态。 */
export const isAgentReadTool = name => /^(get_|list_|search_|read_|inspect_|show_)/.test(String(name || '')) || name === 'web_search';
// 可与同批其他查询并行的工具：不经页面连接、不导航工作区、不占用本机反推。新增工具默认串行。
const PARALLEL_READ_TOOLS = new Set(['get_local_time', 'list_local_images', 'list_local_files', 'show_local_image', 'inspect_local_image', 'show_project_image', 'inspect_project_image', 'read_project_text', 'read_prompt_guidelines', 'search_novelai_docs', 'read_novelai_doc', 'web_search', 'read_web_page', 'get_lab_state', 'search_tags', 'search_character_catalog', 'search_vibes', 'search_character_references', 'get_project_overview', 'search_project_library', 'get_chain', 'get_inspiration', 'list_generation_history', 'inspect_generation_image', 'list_vibe_groups', 'search_aitag', 'get_aitag_work', 'get_project_settings', 'list_inspiration_boards']);
export const isAgentParallelTool = name => PARALLEL_READ_TOOLS.has(name);

// 时间戳、快照编号等每次读取都会变化的字段不参与“结果是否相同”的判断。
const VOLATILE_RESULT_KEYS = new Set(['snapshotId', 'capturedAt', 'timestamp', 'at', 'updatedAt', 'expiresAt', 'requestId', 'claimId', 'localTime', 'utcTime', 'elapsedMs']);
const stableJson = value => JSON.stringify(value ?? null, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().filter(key => !VOLATILE_RESULT_KEYS.has(key)).map(key => [key, item[key]])) : item);
const resultFingerprint = result => createHash('sha256').update(stableJson((result?.content || []).map(part => {
  if (part?.type !== 'text') return { type: part?.type, mimeType: part?.mimeType, size: String(part?.data || '').length };
  try { return JSON.parse(part.text); } catch { return String(part.text || ''); }
}))).digest('hex');

/**
 * 循环守卫：两次写操作之间，同一查询以相同参数连续得到相同结果，或同一调用连续失败，
 * 再次调用时直接拦下并说明原因；连续几轮工具调用全部失败则停止本次任务。
 * 写操作成功表示项目或页面已变化，之前的记录全部作废。
 */
export const createAgentLoopGuard = ({ maxRepeats = 2, maxFailedTurns = 3 } = {}) => {
  const calls = new Map();
  let failedTurns = 0;
  const keyOf = (name, args) => `${name}\u0000${stableJson(args)}`;
  return {
    beforeCall(name, args) {
      const entry = calls.get(keyOf(name, args));
      if (!entry || entry.count < maxRepeats) return null;
      return entry.isError
        ? `这个工具已用相同参数连续失败 ${entry.count} 次，不再重复调用；请根据错误回执换用其他方法，或向用户说明原因。`
        : `这个查询已用相同参数连续执行 ${entry.count} 次且结果没有变化；请直接使用已有结果、换用其他查询，或向用户说明当前情况。`;
    },
    afterCall(name, args, result, isError) {
      if (!isError && !isAgentReadTool(name)) { calls.clear(); return; }
      const key = keyOf(name, args), fingerprint = resultFingerprint(result), entry = calls.get(key);
      calls.set(key, entry && entry.fingerprint === fingerprint && entry.isError === isError ? { ...entry, count: entry.count + 1 } : { fingerprint, isError, count: 1 });
    },
    observeTurn(toolResults = []) {
      if (!toolResults.length) return null;
      failedTurns = toolResults.every(result => result?.isError) ? failedTurns + 1 : 0;
      if (failedTurns < maxFailedTurns) return null;
      return Object.assign(new Error(`连续 ${failedTurns} 轮工具调用全部失败，已停止；请查看工具回执后调整要求，或发送“继续”重试。`), { name: 'AgentRunLimitError', code: 'stalled', turns: failedTurns });
    },
  };
};

const zeroUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const modelStopError = (name, message) => Object.assign(new Error(message), { name });
const abortableDelay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
  const abort = () => { done(); reject(signal.reason); };
  const timer = setTimeout(() => { done(); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

/**
 * 单次模型调用的守卫：持续输出不设短时限，长时间没有任何流事件或超过总时限才中断；
 * 尚未收到任何输出的瞬时服务错误（断线、5xx、过载）按退避有限重试。
 * 已开始输出、鉴权／参数／额度错误与中断都不重试，避免重复消耗或掩盖真实原因。
 */
export const streamModelWithGuards = (produce, { model, signal, idleMs = 180_000, totalMs = 600_000, maxRetries = 2, baseDelayMs = 1_000, onAttempt, onRetry } = {}) => {
  const output = createAssistantMessageEventStream();
  const total = new AbortController();
  const totalTimer = setTimeout(() => total.abort(modelStopError('AgentModelTimeoutError', `单次模型回复超过 ${Math.round(totalMs / 60_000)} 分钟仍未结束，已停止；可以发送“继续”接着处理。`)), totalMs);
  const outer = AbortSignal.any([total.signal, ...(signal ? [signal] : [])]);
  const failure = (error, aborted) => ({ role: 'assistant', content: [], api: model?.api, provider: model?.provider, model: model?.id, usage: zeroUsage(), stopReason: aborted ? 'aborted' : 'error', ...(aborted ? {} : { errorMessage: error instanceof Error ? error.message : String(error) }), timestamp: Date.now() });
  void (async () => {
    for (let attempt = 0; ; attempt++) {
      const idle = new AbortController();
      const attemptSignal = AbortSignal.any([outer, idle.signal]);
      let idleTimer, pendingStart = null, forwarded = false, retryable = null;
      const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => idle.abort(modelStopError('AgentModelIdleError', `模型连续 ${Math.round(idleMs / 1000)} 秒没有任何输出，已停止；可以发送“继续”重试。`)), idleMs); };
      onAttempt?.(attemptSignal, attempt);
      touch();
      try {
        const source = await produce(attemptSignal);
        for await (const event of source) {
          touch();
          // start 只表示连接已建立；延后到首个内容事件再交给循环，连接后立即断开仍可安全重试。
          if (!forwarded && event.type === 'start') { pendingStart = event; continue; }
          if (!forwarded && event.type === 'error' && attempt < maxRetries && !attemptSignal.aborted && isRetryableAssistantError(event.error)) { retryable = event.error; break; }
          if (pendingStart) { output.push(pendingStart); pendingStart = null; }
          forwarded = true;
          output.push(event);
        }
        if (!retryable) {
          if (pendingStart) output.push(pendingStart);
          output.end(await source.result());
          return;
        }
      } catch (error) {
        output.push({ type: 'error', reason: attemptSignal.aborted ? 'aborted' : 'error', error: failure(error, attemptSignal.aborted) });
        output.end();
        return;
      } finally { clearTimeout(idleTimer); }
      const delayMs = baseDelayMs * 2 ** attempt;
      onRetry?.({ attempt: attempt + 1, maxRetries, delayMs, error: String(retryable.errorMessage || '').slice(0, 300) });
      try { await abortableDelay(delayMs, outer); }
      catch { output.push({ type: 'error', reason: 'aborted', error: { ...retryable, stopReason: 'aborted', errorMessage: undefined } }); output.end(); return; }
    }
  })().finally(() => clearTimeout(totalTimer));
  return output;
};

export const agentStopInfo = reason => {
  if (reason?.name === 'AgentRunLimitError') return { code: reason.code, message: reason.message };
  if (reason?.name === 'AgentModelIdleError') return { code: 'model_idle', message: reason.message };
  if (reason?.name === 'AgentModelTimeoutError') return { code: 'model_timeout', message: reason.message };
  if (reason?.name === 'TimeoutError') return { code: 'timeout', message: '本次任务等待超时，已停止；可以发送“继续”接着处理。' };
  if (reason?.message === '用户停止了任务') return { code: 'user_stop', message: '任务已停止。' };
  return { code: 'aborted', message: '任务已中断，尚未收到完整结果；请核对工具回执后继续。' };
};

export const AGENT_TOOL_GROUPS = {
  creative: ['get_lab_state', 'reuse_generation_history', 'update_prompts', 'set_characters', 'set_generation_params', 'request_generation', 'search_tags', 'search_novelai_docs', 'read_novelai_doc', 'read_prompt_guidelines', 'set_prompt_modules', 'set_vibes', 'set_character_references', 'get_generation_status', 'control_generation', 'get_roll_state', 'run_roll_round', 'generate_roll_pending', 'save_roll_candidate', 'get_artist_sample_status', 'generate_artist_sample', 'inspect_image_tags'],
  library: ['get_project_overview', 'search_project_library', 'get_chain', 'get_inspiration', 'read_project_text', 'list_generation_history', 'inspect_generation_image', 'show_project_image', 'inspect_project_image', 'search_character_catalog', 'search_vibes', 'search_character_references', 'create_chain', 'update_chain', 'create_inspiration', 'update_inspiration', 'list_vibe_groups', 'search_aitag', 'get_aitag_work', 'import_aitag_image', 'create_character_reference_from_history', 'create_vibe_from_history', 'create_vibe_from_local', 'create_character_reference_from_local', 'set_chain_cover_from_history', 'update_vibe', 'update_character_reference', 'save_vibe_group', 'request_vibe_encoding', 'list_inspiration_boards', 'create_inspiration_board', 'update_inspiration_board', 'reorder_inspiration_boards', 'delete_inspiration_board', 'create_prompt_library_item', 'update_prompt_library_item', 'navigate_view'],
  maintenance: ['get_project_settings', 'get_project_overview', 'request_delete_project_item', 'request_clear_history', 'request_cleanup_history', 'set_anlas_budget', 'set_cloud_queue', 'update_tag_dictionary', 'manage_aitag', 'set_client_preferences', 'request_clear_mobile_cache', 'navigate_view', 'open_settings'],
  web: ['web_search', 'read_web_page'],
  local_files: ['request_local_image_folder_access', 'list_local_images', 'list_local_files', 'show_local_image', 'inspect_local_image', 'save_project_image_to_folder', 'copy_local_image', 'attach_local_files', 'save_page_export_to_folder'],
};
export const localTimeInfo = (now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) => {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(now);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { timeZone, localTime: `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second}`, utcTime: now.toISOString(), utcOffset: fields.timeZoneName.replace('GMT', 'UTC').replace('−', '-') };
};

export const isProjectImagePath = path => {
  if (typeof path !== 'string' || path.length > 800 || /[\\?#\u0000-\u001f]/.test(path)) return false;
  try {
    const decoded = decodeURIComponent(path);
    if (/[\\?#\u0000-\u001f]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..')) return false;
    return /^\/api\/(?:assets\/.+|integrations\/st-chatu8\/history\/[a-f0-9]{64}\/image|(?:local-history|inspirations|vibes|character-references)\/[^/]+\/(?:image|thumbnail))$/.test(path);
  } catch { return false; }
};

/** 兼容旧日志的导出瘦身；原文件不迁移、不删除。 */
export const compactAuditEntries = entries => {
  const output = [], streams = new Map();
  const flush = key => {
    const summary = streams.get(key);
    if (summary) { output.push(summary); streams.delete(key); }
  };
  for (const entry of entries) {
    const key = entry.runId || '';
    if (entry.type === 'agent_event' && ['thinking_delta', 'text_delta'].includes(entry.eventType)) {
      const summary = streams.get(key) || { type: 'stream_summary', runId: key, at: entry.at, timestamp: entry.timestamp, thinkingChunks: 0, textChunks: 0 };
      summary[entry.eventType === 'thinking_delta' ? 'thinkingChunks' : 'textChunks']++;
      streams.set(key, summary);
    } else { flush(key); output.push(withoutUsageFees(entry)); }
  }
  for (const key of streams.keys()) flush(key);
  return output;
};
