import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentUiBridge } from '../../scripts/agent-ui-bridge.mjs';
import { applyAgentClientChanges, diffAgentClientDraft } from '../../services/agentLabSync.mjs';

test('页面 RPC 绑定会话和单次回执，跨会话与重复回执被拒绝', async () => {
  const bridge = new AgentUiBridge(); let request;
  const pending = bridge.request('a', { action: 'read' }, event => { request = event; });
  const result = { title: '生成历史', snapshotId: 'page-1', controls: [] };
  assert.throws(() => bridge.reply('b', { requestId: request.requestId, result }), /不属于/);
  assert.throws(() => bridge.reply('a', { requestId: request.requestId, result: {} }), /格式/);
  bridge.reply('a', { requestId: request.requestId, result }); assert.deepEqual(await pending, result);
  assert.throws(() => bridge.reply('a', { requestId: request.requestId, result }), /过期/); assert.equal(bridge.pending.size, 0);
});
test('重连只返回发起标签页的实时请求，认领一次且过期、错误令牌不能执行', async () => {
  const bridge = new AgentUiBridge(); let event;
  const pending = bridge.request('s', { action: 'click' }, item => { event = item; }, undefined, 1000, 'tab-a');
  assert.deepEqual(bridge.list('s', 'tab-b'), []); assert.equal(bridge.list('s', 'tab-a').length, 1);
  const payload = { requestId: event.requestId, clientId: 'tab-a' };
  assert.throws(() => bridge.claim('s', { ...payload, clientId: 'tab-b' }), /不属于/);
  const claim = bridge.claim('s', payload); assert.equal(claim.execute, true); assert.equal(bridge.claim('s', payload).execute, false);
  const result = { title: '筛选', snapshotId: 'p', controls: [] };
  assert.throws(() => bridge.reply('s', { ...payload, result, claimId: 'wrong' }), /令牌/);
  bridge.reply('s', { ...payload, result, claimId: claim.claimId }); await pending;
  assert.deepEqual(bridge.list('s', 'tab-a'), []); assert.throws(() => bridge.claim('s', payload), /过期/);
});
test('页面已提交改动按字段合并，用户选择优先，其他工作草稿修改不丢失', () => {
  const original = { basePrompt: '风格', params: { steps: 20, scale: 5 }, editContext: { strength: 0.5 } };
  const page = { basePrompt: '风格', params: { steps: 23, scale: 5 }, editContext: { strength: 0.7 } };
  const draft = { basePrompt: 'Agent 新风格', params: { steps: 28, scale: 7 }, editContext: { strength: 0.5 } };
  assert.deepEqual(applyAgentClientChanges(draft, diffAgentClientDraft(original, page)), ['params.steps']);
  assert.deepEqual(draft, { basePrompt: 'Agent 新风格', params: { steps: 23, scale: 7 }, editContext: { strength: 0.7 } });
  const before = structuredClone(draft);
  assert.throws(() => applyAgentClientChanges(draft, [{ path: ['params', '__proto__', 'evil'], after: true }]), /无效/); assert.deepEqual(draft, before);
});
test('浏览器未回应、任务停止及发送失败都会释放页面等待，不回退到旧草稿', async () => {
  const bridge = new AgentUiBridge(), abort = new AbortController();
  await assert.rejects(bridge.request('a', { action: 'read' }, () => {}, undefined, 5), /不能把旧实验室/);
  const pending = bridge.request('a', { action: 'read' }, () => {}, abort.signal); abort.abort(); await assert.rejects(pending, /停止/);
  await assert.rejects(bridge.request('a', { action: 'read' }, () => { throw new Error('断开'); }), /断开/);
  assert.equal(bridge.pending.size, 0);
});
import { AGENT_TOOL_GROUPS, agentOutputLimit, agentTokenUsage, boundAgentToolResult, compactAuditEntries, compactAgentValue, isProjectImagePath, localTimeInfo } from '../../scripts/agent-runtime.mjs';
import { agentStopInfo, createAgentLoopGuard, createAgentRunBudget, isAgentParallelTool, isAgentReadTool, streamModelWithGuards } from '../../scripts/agent-runtime.mjs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

test('复现日志：重复上下文超过 64k 仍允许继续，保护仅计算新输出', () => {
  for (const totals of [[16051, 19008, 20647, 21721], [24351, 24742, 26137]]) {
    const budget = createAgentRunBudget();
    for (const totalTokens of totals) assert.equal(budget.observe({ content: [{ type: 'toolCall' }], usage: { input: totalTokens - 300, output: 300, totalTokens } }), null);
  }
  const turns = createAgentRunBudget({ maxTurns: 3 });
  assert.equal(turns.observe({ content: [{ type: 'toolCall' }], usage: { output: 1 } }), null);
  assert.equal(turns.observe({ stopReason: 'aborted' }), null);
  assert.equal(turns.observe({ content: [{ type: 'toolCall' }] }), null);
  const reason = turns.observe({ content: [{ type: 'toolCall' }] });
  assert.equal(reason.code, 'turn_limit'); assert.match(agentStopInfo(reason).message, /继续/);
  const output = createAgentRunBudget({ maxOutputTokens: 10 });
  assert.equal(output.observe({ content: [{ type: 'toolCall' }], usage: { output: 9, reasoning: 9, input: 500000 } }), null);
  assert.equal(output.observe({ content: [{ type: 'toolCall' }], usage: { output: 1 } }).code, 'output_limit');
  assert.equal(createAgentRunBudget({ maxTurns: 1 }).observe({ content: [{ type: 'text', text: '完成' }] }), null);
  assert.equal(agentStopInfo(new DOMException('', 'TimeoutError')).code, 'timeout');
  assert.equal(agentStopInfo(new DOMException('用户停止了任务', 'AbortError')).code, 'user_stop');
  assert.equal(agentStopInfo(new DOMException('', 'AbortError')).code, 'aborted');
});

test('页面过期直接返回新回执，分页归零且写入不自动重放', async () => {
  const { createAgentPageTools } = await import('../../scripts/agent-page-tools.mjs');
  for (const action of ['read', 'click', 'fill', 'select']) {
    const operations = [];
    const tools = createAgentPageTools({ requestUI: async operation => {
      operations.push(operation);
      if (operations.length === 1) throw new Error(action === 'read' ? '页面已变化，请重新读取后继续' : '页面已变化，请重新读取后操作');
      return { title: '新的筛选面板', snapshotId: 'new', controls: [{ id: 'new-model', label: '模型' }] };
    } }, () => 'standard');
    const tool = tools.find(item => item.name === (action === 'read' ? 'read_current_page' : 'operate_current_page'));
    const page = JSON.parse((await tool.execute('t', { action, snapshotId: 'old', controlId: 'old-model', offset: 40, optionsOffset: 12, value: 'v5' })).content[0].text);
    assert.equal(operations.length, 2); assert.equal(operations[1].action, 'read');
    for (const key of ['snapshotId', 'controlId', 'offset', 'optionsOffset', 'value']) assert.equal(operations[1][key], undefined);
    assert.equal(page.snapshotId, 'new'); assert.equal(page.recovery.operationOutcome, action === 'read' ? 'read_refreshed' : 'not_executed');
  }
  let calls = 0;
  const tools = createAgentPageTools({ requestUI: async () => { calls++; throw new Error('当前页面未响应，结果未知'); } }, () => 'standard');
  await assert.rejects(tools[1].execute('t', { action: 'click' }), /结果未知/); assert.equal(calls, 1);
});

test('长资料、编码与成组结果有界，明确省略且不修改源资料', () => {
  const source = { name: '项目', data: 'a'.repeat(500000), prompt: '构图，'.repeat(20000), items: Array.from({ length: 100 }, (_, id) => ({ id, notes: '画面 '.repeat(1000) })) };
  const snapshot = structuredClone(source);
  const result = boundAgentToolResult({ content: [{ type: 'text', text: JSON.stringify(source) }], details: source });
  const value = JSON.parse(result.content[0].text);
  assert.match(value._agentNotice, /不得冒充完整/);
  assert.ok(result.content[0].text.length < 20000);
  assert.ok(JSON.stringify(result.details).length < 3000);
  assert.match(value.data.data, /二进制/);
  assert.deepEqual(source, snapshot);
  assert.deepEqual(compactAgentValue({ ok: true, id: 'receipt' }).value, { ok: true, id: 'receipt' });
});
test('工具分组只提供能力目录，思考输出预算保留原有边界', () => {
  assert.ok(AGENT_TOOL_GROUPS.creative.includes('update_prompts'));
  assert.ok(AGENT_TOOL_GROUPS.maintenance.includes('request_clear_history'));
  assert.ok(AGENT_TOOL_GROUPS.local_files.includes('save_project_image_to_folder'));
  assert.equal(AGENT_TOOL_GROUPS.library.includes('manage_artist_favorite'), false);
  assert.equal(agentOutputLimit('off'), 8192); assert.equal(agentOutputLimit('medium'), 16384); assert.equal(agentOutputLimit('max'), 32768);
});

const textResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

test('循环守卫允许成功查询重读与后台轮询，只拦连续失败的相同调用', () => {
  const guard = createAgentLoopGuard();
  const args = { query: 'smile', page: 1 };
  for (let index = 0; index < 2; index++) {
    assert.equal(guard.beforeCall('search_tags', args), null);
    // 快照编号、时间等易变字段不算结果变化。
    guard.afterCall('search_tags', { page: 1, query: 'smile' }, textResult({ items: ['smile'], snapshotId: 'p' + index, capturedAt: index }), false);
  }
  assert.equal(guard.beforeCall('search_tags', args), null);
  for (const name of ['get_generation_status', 'get_artist_sample_status', 'read_project_text']) {
    for (let index = 0; index < 4; index++) {
      assert.equal(guard.beforeCall(name, args), null);
      guard.afterCall(name, args, textResult({ status: 'running' }), false);
    }
  }
  assert.equal(guard.beforeCall('search_tags', { query: 'smile', page: 2 }), null);
  guard.afterCall('update_prompts', { basePrompt: 'x' }, textResult({ ok: true }), false);
  assert.equal(guard.beforeCall('search_tags', args), null);
  // 结果变化时重新计数。
  guard.afterCall('search_tags', args, textResult({ items: ['a'] }), false);
  guard.afterCall('search_tags', args, textResult({ items: ['b'] }), false);
  assert.equal(guard.beforeCall('search_tags', args), null);
  // 写操作以相同参数连续失败两次后不再重复。
  guard.afterCall('update_chain', { id: 'c' }, textResult('合成失败'), true);
  guard.afterCall('update_chain', { id: 'c' }, textResult('合成失败'), true);
  assert.match(guard.beforeCall('update_chain', { id: 'c' }), /连续失败 2 次/);
  guard.afterCall('update_prompts', {}, textResult({ ok: true }), false);
  assert.equal(guard.beforeCall('update_chain', { id: 'c' }), null);
});

test('连续三轮工具调用全部失败时停止，中间有成功即重新计数', () => {
  const guard = createAgentLoopGuard();
  const failed = [{ isError: true }, { isError: true }];
  assert.equal(guard.observeTurn([]), null);
  assert.equal(guard.observeTurn(failed), null);
  assert.equal(guard.observeTurn(failed), null);
  assert.equal(guard.observeTurn([{ isError: true }, { isError: false }]), null);
  assert.equal(guard.observeTurn(failed), null);
  assert.equal(guard.observeTurn(failed), null);
  const reason = guard.observeTurn(failed);
  assert.equal(reason.code, 'stalled'); assert.match(agentStopInfo(reason).message, /全部失败/);
});

test('只有不经页面、不导航工作区的查询可以并行，写操作与页面工具保持串行', () => {
  for (const name of ['search_tags', 'get_lab_state', 'read_novelai_doc', 'web_search', 'list_generation_history', 'get_prompt_library_directories', 'search_prompt_library_items']) assert.equal(isAgentParallelTool(name), true, name);
  for (const name of ['read_current_page', 'inspect_current_page_image', 'get_generation_status', 'get_roll_state', 'get_artist_sample_status', 'inspect_image_tags', 'get_agent_capabilities', 'operate_current_page', 'update_prompts', 'request_generation', 'navigate_view', 'unknown_future_tool']) assert.equal(isAgentParallelTool(name), false, name);
  assert.equal(isAgentReadTool('web_search'), true); assert.equal(isAgentReadTool('navigate_view'), false);
});

test('标签页认领、回执与轮询都记录为仍在线，迟到的认领同样计入', async () => {
  const bridge = new AgentUiBridge(); let request;
  const pending = bridge.request('s', { action: 'read' }, event => { request = event; }, undefined, 20, 'tab');
  const before = Date.now() - 1;
  assert.equal(bridge.seenSince('s', 'tab', before), false);
  await assert.rejects(pending, /未响应/);
  assert.throws(() => bridge.claim('s', { requestId: request.requestId, clientId: 'tab' }), /过期/);
  assert.equal(bridge.seenSince('s', 'tab', before), true);
  assert.equal(bridge.seenSince('other', 'tab', before), false);
  const later = Date.now();
  await new Promise(resolve => setTimeout(resolve, 2));
  bridge.list('s', 'tab');
  assert.equal(bridge.seenSince('s', 'tab', later), true);
});

test('工具调用连续被输出上限截断时停止，中间正常回复会重新计数', () => {
  const budget = createAgentRunBudget();
  const truncated = { stopReason: 'length', content: [{ type: 'toolCall' }] };
  assert.equal(budget.observe(truncated), null);
  assert.equal(budget.observe({ stopReason: 'toolUse', content: [{ type: 'toolCall' }] }), null);
  assert.equal(budget.observe(truncated), null);
  const reason = budget.observe(truncated);
  assert.equal(reason.code, 'output_truncated'); assert.match(agentStopInfo(reason).message, /输出上限/);
  // 最终文字回复被截断不在这里中止，由任务结束时如实标注。
  assert.equal(createAgentRunBudget({ maxTruncatedToolTurns: 1 }).observe({ stopReason: 'length', content: [{ type: 'text', text: '半句' }] }), null);
});

const syntheticMessage = (overrides = {}) => ({ role: 'assistant', content: [], api: 'openai-completions', provider: 'synthetic', model: 'a', usage: {}, stopReason: 'stop', timestamp: 1, ...overrides });
const syntheticSource = events => {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => { for (const event of events) stream.push(event); stream.end(); });
  return stream;
};
const replyEvents = text => {
  const message = syntheticMessage({ content: [{ type: 'text', text }] });
  return [{ type: 'start', partial: message }, { type: 'text_delta', contentIndex: 0, delta: text, partial: message }, { type: 'done', reason: 'stop', message }];
};
const errorEvent = (errorMessage, stopReason = 'error') => ({ type: 'error', reason: stopReason, error: syntheticMessage({ stopReason, errorMessage }) });
const collect = async stream => { const events = []; for await (const event of stream) events.push(event); return { events, result: await stream.result() }; };

test('模型调用在未收到任何输出时重试瞬时错误，连接建立后立即断开同样可重试', async () => {
  const sources = [[errorEvent('503 Service Unavailable')], [{ type: 'start', partial: syntheticMessage() }, errorEvent('Connection error.')], replyEvents('合成回复')];
  const retries = [];
  const { events, result } = await collect(streamModelWithGuards(() => syntheticSource(sources.shift()), { baseDelayMs: 1, onRetry: retry => retries.push(retry) }));
  assert.equal(sources.length, 0);
  assert.deepEqual(retries.map(retry => retry.attempt), [1, 2]);
  assert.deepEqual(events.map(event => event.type), ['start', 'text_delta', 'done']);
  assert.equal(result.content[0].text, '合成回复');
});

test('模型已开始输出、鉴权或额度错误与重试次数用尽都不再重试', async () => {
  for (const [source, attempts] of [
    [() => [...replyEvents('半').slice(0, 2), errorEvent('502 Bad Gateway')], 1],
    [() => [errorEvent('401 Unauthorized')], 1],
    [() => [errorEvent('429 insufficient_quota')], 1],
    [() => [errorEvent('500 Internal Server Error')], 3],
  ]) {
    let calls = 0;
    const { events, result } = await collect(streamModelWithGuards(() => { calls++; return syntheticSource(source()); }, { baseDelayMs: 1 }));
    assert.equal(calls, attempts);
    assert.equal(events.at(-1).type, 'error');
    assert.equal(result.stopReason, 'error');
  }
  const thrown = await collect(streamModelWithGuards(() => { throw new Error('合成 Key 缺失'); }, { model: { api: 'openai-completions', provider: 'synthetic', id: 'a' } }));
  assert.equal(thrown.result.errorMessage, '合成 Key 缺失'); assert.equal(thrown.result.provider, 'synthetic');
});

test('模型长时间没有任何流事件才按空闲超时中断，持续输出不受总时限以外的限制', async () => {
  let attemptSignal;
  const silent = signal => {
    const stream = createAssistantMessageEventStream();
    signal.addEventListener('abort', () => { stream.push(errorEvent('Request was aborted.', 'aborted')); stream.end(); }, { once: true });
    return stream;
  };
  const idle = await collect(streamModelWithGuards(silent, { idleMs: 20, baseDelayMs: 1, onAttempt: signal => { attemptSignal = signal; } }));
  assert.equal(idle.result.stopReason, 'aborted');
  assert.equal(agentStopInfo(attemptSignal.reason).code, 'model_idle');
  const capped = await collect(streamModelWithGuards(silent, { idleMs: 1_000, totalMs: 20, onAttempt: signal => { attemptSignal = signal; } }));
  assert.equal(capped.result.stopReason, 'aborted');
  assert.equal(agentStopInfo(attemptSignal.reason).code, 'model_timeout');
  // 每个流事件都会顺延空闲时限，慢但持续的回复不会被中断。
  const slow = signal => {
    const stream = createAssistantMessageEventStream();
    const message = syntheticMessage({ content: [{ type: 'text', text: 'abc' }] });
    void (async () => {
      stream.push({ type: 'start', partial: message });
      for (const delta of 'abc') { await new Promise(resolve => setTimeout(resolve, 15)); if (signal.aborted) return; stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: message }); }
      stream.push({ type: 'done', reason: 'stop', message }); stream.end();
    })();
    return stream;
  };
  assert.equal((await collect(streamModelWithGuards(slow, { idleMs: 40 }))).result.stopReason, 'stop');
});

test('模型服务不响应取消时，producer、流读取和最终回执等待仍受超时限制', async () => {
  const never = () => new Promise(() => {});
  const silent = () => createAssistantMessageEventStream();
  const noResult = () => ({ async *[Symbol.asyncIterator]() {}, result: never });
  for (const produce of [never, silent, noResult]) {
    const { result } = await collect(streamModelWithGuards(produce, { idleMs: 10, totalMs: 100 }));
    assert.equal(result.stopReason, 'aborted');
    assert.match(result.errorMessage, /没有任何输出/);
  }
  const capped = await collect(streamModelWithGuards(silent, { idleMs: 100, totalMs: 10 }));
  assert.match(capped.result.errorMessage, /单次模型回复超过/);
});

test('流抛错或不响应取消时保留已经收到的正文与 Token，不重复请求', async () => {
  for (const throws of [false, true]) {
    let calls = 0;
    const message = syntheticMessage({ content: [{ type: 'text', text: '半句' }], usage: { input: 12, output: 3, totalTokens: 15 } });
    const produce = () => {
      calls++;
      return { async *[Symbol.asyncIterator]() {
        yield { type: 'start', partial: message };
        yield { type: 'text_delta', delta: '半句', contentIndex: 0, partial: message };
        if (throws) throw new Error('Connection error.');
        await new Promise(() => {});
      } };
    };
    const { result } = await collect(streamModelWithGuards(produce, { idleMs: 10 }));
    assert.equal(calls, 1);
    assert.equal(result.content[0].text, '半句');
    assert.deepEqual(result.usage, message.usage);
    assert.equal(result.stopReason, throws ? 'error' : 'aborted');
  }
});

test('没有内容事件但错误已含正文或 Token 时保留回执，瞬时抛错可有限重试', async () => {
  for (const fields of [{ usage: { input: 5 } }, { content: [{ type: 'text', text: '已生成' }] }]) {
    let calls = 0;
    const error = syntheticMessage({ ...fields, stopReason: 'error', errorMessage: '503 Service Unavailable' });
    const { result } = await collect(streamModelWithGuards(() => { calls++; return syntheticSource([{ type: 'error', reason: 'error', error }]); }));
    assert.equal(calls, 1); assert.deepEqual(result, error);
  }
  let calls = 0;
  const retried = await collect(streamModelWithGuards(() => {
    if (++calls === 1) throw new Error('fetch failed');
    return syntheticSource(replyEvents('完成'));
  }, { baseDelayMs: 1 }));
  assert.equal(calls, 2); assert.equal(retried.result.content[0].text, '完成');
});

test('用户预先取消和退避期间取消都不会再次调用模型', async () => {
  const before = new AbortController(); before.abort(new Error('用户停止了任务'));
  let calls = 0;
  const stopped = await collect(streamModelWithGuards(() => { calls++; return syntheticSource(replyEvents('不应请求')); }, { signal: before.signal }));
  assert.equal(calls, 0); assert.equal(stopped.result.stopReason, 'aborted');
  const controller = new AbortController();
  const backedOff = await collect(streamModelWithGuards(() => { calls++; return syntheticSource([errorEvent('503')]); }, {
    signal: controller.signal, baseDelayMs: 100, onRetry: () => controller.abort(new Error('用户停止了任务')),
  }));
  assert.equal(calls, 1); assert.equal(backedOff.result.stopReason, 'aborted');
});
test('真实时区与夏令时偏移按日期计算', () => {
  const now = new Date('2026-10-03T11:50:00.000Z');
  assert.deepEqual(localTimeInfo(now, 'Asia/Shanghai'), { timeZone: 'Asia/Shanghai', localTime: '2026-10-03 19:50:00', utcTime: now.toISOString(), utcOffset: 'UTC+08:00' });
  assert.equal(localTimeInfo(new Date('2026-01-03T12:00:00Z'), 'America/New_York').utcOffset, 'UTC-05:00');
  assert.equal(localTimeInfo(new Date('2026-07-03T12:00:00Z'), 'America/New_York').utcOffset, 'UTC-04:00');
});
test('展示只接受项目图片，拒绝外链、路径穿越、编码控制字符', () => {
  assert.equal(isProjectImagePath('/api/local-history/a/image'), true);
  assert.equal(isProjectImagePath('/api/assets/covers/a.webp'), true);
  for (const path of ['https://example.com/a.png', 'file:///a.png', '/api/assets/../private', '/api/assets/%2e%2e/private', '/api/assets/%5cprivate', '/api/assets/a?secret=x']) assert.equal(isProjectImagePath(path), false);
});
test('旧日志重复片段只在导出时合并，原记录保留', () => {
  const entries = Array.from({ length: 40000 }, () => ({ type: 'agent_event', eventType: 'thinking_delta', runId: 'r' }));
  entries.push({ type: 'agent_event', eventType: 'response_end', runId: 'r' });
  const output = compactAuditEntries(entries);
  assert.equal(output.length, 2); assert.equal(output[0].thinkingChunks, 40000);
  assert.equal(entries.length, 40001);
});
test('Token 摘要与旧日志导出剔除金额，原资料不变，NovelAI Anlas 后果保留', () => {
  const usage = { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { total: 9 } };
  assert.deepEqual(agentTokenUsage(usage), { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 });
  const original = [{ type: 'model_response', usage, event: { visionUsage: [{ usage }] }, operation: { estimatedCost: 20 } }];
  const result = compactAuditEntries(original);
  assert.equal(JSON.stringify(result).includes('"cost"'), false); assert.equal(result[0].operation.estimatedCost, 20);
  assert.equal(original[0].usage.cost.total, 9);
});

test('大像素回执只允许观察操作，不能放宽普通控件回执', async () => {
  const bridge = new AgentUiBridge(); let event;
  const large = { title: '画布', snapshotId: 'p', controls: [], result: { image: { data: 'a'.repeat(100000), mimeType: 'image/jpeg' } } };
  const pending = bridge.request('s', { action: 'image' }, value => { event = value; });
  bridge.reply('s', { requestId: event.requestId, result: large }); assert.deepEqual(await pending, large);
  const ordinary = bridge.request('s', { action: 'click' }, value => { event = value; });
  assert.throws(() => bridge.reply('s', { requestId: event.requestId, result: large }), /无效/);
  bridge.reply('s', { requestId: event.requestId, result: { title: '页面', snapshotId: 'p', controls: [] } }); await ordinary;
});
