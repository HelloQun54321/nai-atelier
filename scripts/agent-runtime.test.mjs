import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentUiBridge } from './agent-ui-bridge.mjs';
import { applyAgentClientChanges, diffAgentClientDraft } from '../services/agentLabSync.mjs';

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
import { agentOutputLimit, agentTokenUsage, boundAgentToolResult, compactAuditEntries, compactAgentValue, inferAgentToolGroups, isProjectImagePath, localTimeInfo, selectRuntimeTools } from './agent-runtime.mjs';

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
test('工具范围支持复合任务、接续与按需加载，能力问答和问候保持轻量', () => {
  assert.deepEqual(inferAgentToolGroups('你好'), []);
  assert.deepEqual(inferAgentToolGroups('你有什么能力'), []);
  assert.deepEqual(inferAgentToolGroups('全部改成蓝色'), []);
  assert.deepEqual(inferAgentToolGroups('修改提示词并保存到资料库'), ['creative', 'library']);
  assert.deepEqual(inferAgentToolGroups('继续', '查历史图片'), ['library']);
  assert.ok(inferAgentToolGroups('把上一张图保存到 D:\\Pictures').includes('local_files'));
  const tools = ['get_agent_capabilities', 'get_local_time', 'enable_tool_group', 'request_generation', 'request_clear_history'].map(name => ({ name }));
  assert.equal(selectRuntimeTools(tools, []).some(tool => tool.name === 'request_clear_history'), false);
  assert.equal(selectRuntimeTools(tools, ['creative']).some(tool => tool.name === 'request_generation'), true);
  assert.equal(agentOutputLimit('off'), 2048); assert.equal(agentOutputLimit('medium'), 4096); assert.equal(agentOutputLimit('max'), 8192);
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
