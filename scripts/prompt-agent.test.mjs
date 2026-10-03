import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PromptAgentService } from './prompt-agent.mjs';

const isolated = async fn => {
  const root = await mkdtemp(join(tmpdir(), 'nai-agent-test-'));
  const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  service.appendAuditLog = async () => {};
  try { await fn(service); }
  finally { for (const pending of service.pendingConfirmations.values()) clearTimeout(pending.timer); await rm(root, { recursive: true, force: true }); }
};
test('确认绑定完整后果，异步执行之前占用令牌', () => isolated(async service => {
  service.activeAgents.set('s', { agent: {}, emit() {} });
  const operation = { action: 'delete_chain', resourceId: 'chain-a', payload: {} };
  const { requestId, promise } = service.createConfirmation('s', operation);
  service.controlSession('s', 'confirm', '', { requestId, accepted: true });
  const input = { sessionId: 's', confirmationRequestId: requestId, ...operation };
  let count = 0, release;
  const project = { requestJson: async () => { count++; await new Promise(resolve => { release = resolve; }); } };
  await assert.rejects(service.executeConfirmedProjectAction({ ...input, action: 'clear_history' }, project), /不匹配/);
  await assert.rejects(service.executeConfirmedProjectAction({ ...input, resourceId: 'other' }, project), /不匹配/);
  const first = service.executeConfirmedProjectAction(input, project);
  await assert.rejects(service.executeConfirmedProjectAction(input, project), /已在执行/);
  release(); await first;
  assert.equal(count, 1); assert.equal((await promise).accepted, true);
}));
test('生图批准、失败回执、拒绝和停止均结束等待', () => isolated(async service => {
  service.activeAgents.set('s', { agent: { abort() {} }, emit() {} });
  for (const action of ['success', 'failure', 'decline', 'abort']) {
    const { requestId, promise } = service.createConfirmation('s', { action: 'request_generation', resourceId: '', payload: {} });
    if (action === 'decline') service.controlSession('s', 'confirm', '', { requestId, accepted: false });
    else if (action === 'abort') service.controlSession('s', 'abort');
    else {
      assert.throws(() => service.controlSession('s', 'finalize', '', { requestId, success: true }), /过期/);
      service.controlSession('s', 'confirm', '', { requestId, accepted: true });
      service.controlSession('s', 'finalize', '', { requestId, success: action === 'success' });
    }
    assert.equal((await promise).accepted, action === 'success');
    assert.equal(service.pendingConfirmations.size, 0);
  }
}));
test('初始化失败归还启动租约', () => isolated(async service => {
  service.readSession = async () => { throw new Error('synthetic IO'); };
  await assert.rejects(service.run({ sessionId: 's' }, () => {}), /synthetic IO/);
  assert.equal(service.startingAgents.size, 0);
}));
test('工具历史按实际回执展示失败和中断', () => isolated(async service => {
  service.readSession = async () => ({ messages: [
    { role: 'assistant', content: [{ type: 'toolCall', id: 'a', name: 'write', arguments: {} }, { type: 'toolCall', id: 'b', name: 'read', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'a', isError: true, content: [{ type: 'text', text: 'failed' }] },
  ] });
  assert.deepEqual((await service.getSessionHistory('s'))[0].tools.map(item => item.state), ['error', 'interrupted']);
}));
const customInput = (id = 'custom-synthetic-a') => ({ id, name: 'synthetic', baseUrl: 'http://127.0.0.1:1234/v1', models: [{ id: 'a' }, { id: 'b' }] });
test('服务实例注册表隔离，编辑保留默认模型，失败落盘不发布配置', () => isolated(async service => {
  await service.saveCustomProvider({ ...customInput(), select: true });
  await service.selectModel('custom-synthetic-a', 'b');
  await service.saveCustomProvider({ ...customInput(), name: 'edited' });
  assert.equal(service.publicConfig().model, 'b');
  const other = new PromptAgentService({ lanSecret: 'synthetic', configFile: join(service.isolatedRoot, 'other') });
  assert.equal(other.listCustomProviders().length, 0);
  service.configFileOverride = service.isolatedRoot; // 目录不可作为配置文件覆盖。
  await assert.rejects(service.saveCustomProvider(customInput('custom-synthetic-b')));
  assert.equal(service.listCustomProviders().length, 1);
}));
test('并发配置写入合并且未知模型价格不伪造免费', () => isolated(async service => {
  await Promise.all([service.saveCustomProvider(customInput('custom-synthetic-a')), service.saveCustomProvider(customInput('custom-synthetic-b'))]);
  assert.equal(service.listCustomProviders().length, 2);
  assert.equal(service.listCustomProviders()[0].models[0].cost, null);
}));
test('手填模型功能测试不请求 models，视觉用途不要求工具', () => isolated(async service => {
  const previous = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return new Response(JSON.stringify({ error: { message: 'synthetic rejection' } }), { status: 401, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await service.testCustomProvider({ ...customInput(), apiKey: 'synthetic', testRole: 'vision' });
    assert.equal(result.ok, false);
    assert.ok(urls.length > 0, result.message);
    assert.ok(urls.every(url => !url.endsWith('/models')));
    assert.equal(result.checks.tools, 'not_tested');
  } finally { globalThis.fetch = previous; }
}));
test('任务游标隔离运行，确认摘要可以恢复但事件不暴露令牌', () => isolated(async service => {
  const state = { sessionId: 's', runId: 'new', status: 'running' };
  service.runs.set('s', { state, controller: new AbortController() });
  await service.appendTaskEvent('s', { type: 'text_delta', delta: 'old', runId: 'old', seq: 1 });
  await service.appendTaskEvent('s', { type: 'text_delta', delta: 'new', runId: 'new', seq: 2 });
  const { requestId, promise } = service.createConfirmation('s', { action: 'request_generation', resourceId: '', payload: {} });
  await service.appendTaskEvent('s', { type: 'action', runId: 'new', seq: 3, action: { kind: 'request_generation', patch: { requestId } } });
  const task = await service.getTask('s', 1, 'new');
  assert.equal(task.status, 'waiting_confirmation');
  assert.deepEqual(task.events.map(event => event.seq), [2, 3]);
  assert.equal(task.events[1].action.patch.requestId, '[redacted]');
  assert.equal(task.pending[0].requestId, requestId);
  assert.equal((await service.getTask('s', 100, 'old')).reset, true);
  service.controlSession('s', 'abort');
  assert.equal((await promise).accepted, false);
  await service.flushTaskEvents('s');
}));
test('停止准备中的任务与挂起网络立即结束等待', () => isolated(async service => {
  const controller = new AbortController();
  service.runs.set('s', { state: { runId: 'r' }, controller });
  const waiting = service.withSignal(new Promise(() => {}), controller.signal);
  service.controlSession('s', 'abort');
  await assert.rejects(waiting, { name: 'AbortError' });
}));
