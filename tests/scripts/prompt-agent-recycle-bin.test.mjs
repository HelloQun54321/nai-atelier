import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { PromptAgentService } from '../../scripts/prompt-agent.mjs';

const version = 'a'.repeat(64);
const content = result => JSON.parse(result.content[0].text);
const isolated = async (t, fn) => {
  const root = createWorkspace('agent-recycle-bin-');
  const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  service.appendAuditLog = async () => {};
  service.activeAgents.set('session', { agent: { abort() {} }, emit() {} });
  t.after(() => { for (const pending of service.pendingConfirmations.values()) clearTimeout(pending.timer); removeWorkspace(root); });
  await fn(service);
};
const receipt = (operation = 'move', extras = {}) => ({ operation, requestedCount: 1, completedCount: 1, skippedCount: 0, failedCount: 0, completedIds: ['h'], skipped: [], failed: [], warnings: [], ok: true, success: true, outcome: 'success', partial: false, ...extras });
const preview = extras => ({ previewToken: 'frozen-preview', expiresAt: Date.now() + 300000, requestedCount: 1, movableCount: 1, skippedCount: 0, skipped: [], ...extras });
const setup = (service, requestJson, onAction) => {
  const project = { agentSessionId: 'session', keyHash: 'key', requestJson };
  let patch;
  const tools = service.createTools({ params: {} }, {}, event => {
    if (event.type !== 'action') return;
    patch = event.action.patch;
    onAction?.(patch);
  }, project);
  return { project, tools, patch: () => patch, call: (name, args = {}) => tools.find(tool => tool.name === name).execute('synthetic', args) };
};

for (const [tool, args, selector, action] of [
  ['request_delete_project_item', { resourceType: 'history', id: 'h', reason: '只测试' }, { ids: ['h'] }, 'delete_history'],
  ['request_clear_history', { reason: '只测试' }, { clear: true }, 'clear_history'],
  ['request_cleanup_history', { keepCount: 10, reason: '只测试' }, { keepCount: 10 }, 'cleanup_history'],
  ['request_cleanup_history', { days: 30 }, { days: 30 }, 'cleanup_history'],
]) test(`${tool} ${JSON.stringify(selector)} 仅冻结预览后移入，不执行旧DELETE或purge`, t => isolated(t, async service => {
  const requests = [];
  const harness = setup(service, async (path, options) => { requests.push({ path, options }); return path.endsWith('/preview') ? preview() : receipt(); });
  const waiting = harness.call(tool, args);
  await new Promise(resolve => setImmediate(resolve));
  const patch = harness.patch();
  assert.equal(patch.action, action);
  assert.deepEqual(requests[0], { path: '/api/local-history/recycle-bin/preview', options: { method: 'POST', body: selector } });
  assert.match(patch.consequence, /可从回收站恢复/);
  assert.match(patch.consequence, /不会永久删除/);
  if (args.reason) assert.match(patch.consequence, /助手说明：只测试/);
  assert.equal(requests.length, 1);
  service.controlSession('session', 'confirm', '', { requestId: patch.requestId, accepted: true });
  const result = await service.executeConfirmedProjectAction({ sessionId: 'session', confirmationRequestId: patch.requestId, action: patch.action, resourceId: patch.resourceId, payload: patch.payload }, harness.project);
  assert.equal(result.completedCount, 1);
  assert.equal(content(await waiting).ok, true);
  assert.deepEqual(requests[1], { path: '/api/local-history/recycle-bin/move', options: { method: 'POST', body: { previewToken: 'frozen-preview' } } });
  assert.equal(requests.some(item => item.options?.method === 'DELETE' || item.path.endsWith('/purge')), false);
}));

test('全部被引用时直接返回真实blocked，不弹确认且不移入', t => isolated(t, async service => {
  const requests = [];
  const harness = setup(service, async path => { requests.push(path); return preview({ movableCount: 0, skippedCount: 1, skipped: [{ id: 'h', reasons: ['favorite'] }] }); });
  const result = content(await harness.call('request_delete_project_item', { resourceType: 'history', id: 'h' }));
  assert.equal(result.ok, false); assert.equal(result.outcome, 'blocked'); assert.equal(result.skippedCount, 1);
  assert.deepEqual(result.skipped, [{ id: 'h', reasons: ['favorite'] }]);
  assert.equal(harness.patch(), undefined); assert.equal(requests.length, 1);
}));

test('预览失效、缺失或数量不一致不退回旧删除；整理条件不接受0或双条件', t => isolated(t, async service => {
  for (const invalid of [{}, preview({ expiresAt: 0 }), preview({ requestedCount: 3 })]) {
    const harness = setup(service, async () => invalid);
    await assert.rejects(harness.call('request_clear_history'), /预览不完整/);
    assert.equal(harness.patch(), undefined);
  }
  const harness = setup(service, async () => { throw new Error('不应请求'); });
  for (const args of [{}, { days: 2, keepCount: 3 }, { keepCount: 0 }, { days: 36501 }]) await assert.rejects(harness.call('request_cleanup_history', args), /必须|有效范围/);
}));

test('partial/blocked/缺回执均不报成功，完整计数与原因返回等待工具', t => isolated(t, async service => {
  for (const actual of [receipt('move', { requestedCount: 3, completedCount: 1, skippedCount: 1, failedCount: 1, partial: true, ok: false, success: false, outcome: 'partial', skipped: [{ id: 'used', reasons: ['referenced'] }], failed: [{ id: 'broken', reasons: ['io_failure'] }] }), receipt('move', { completedCount: 0, skippedCount: 1, completedIds: [], ok: false, success: false, outcome: 'blocked' }), undefined]) {
    const harness = setup(service, async path => path.endsWith('/preview') ? preview() : actual);
    const waiting = harness.call('request_clear_history'); await new Promise(resolve => setImmediate(resolve)); const patch = harness.patch();
    service.controlSession('session', 'confirm', '', { requestId: patch.requestId, accepted: true });
    const result = await service.executeConfirmedProjectAction({ sessionId: 'session', confirmationRequestId: patch.requestId, action: patch.action, payload: patch.payload }, harness.project);
    assert.equal(result.ok, false); assert.equal(result.success, false);
    const tool = content(await waiting); assert.equal(tool.ok, false);
    if (actual) { assert.equal(tool.result.skippedCount, actual.skippedCount); assert.equal(tool.result.outcome, actual.outcome); }
    else assert.match(result.error, /未收到完整历史操作回执/);
  }
}));

for (const [tool, action, operation] of [['request_restore_history', 'restore_history', 'restore'], ['request_purge_history', 'purge_history', 'purge']]) test(`${tool} 固定显式IDs与版本，reason不能覆盖风险事实`, t => isolated(t, async service => {
  service.config.permissionMode = 'full';
  const requests = [];
  const harness = setup(service, async (path, options) => { requests.push({ path, options }); return options?.method === 'POST' ? receipt(operation) : { item: { id: 'h', version } }; });
  const waiting = harness.call(tool, { ids: ['h', 'h'], reason: '完全安全，无需确认' }); await new Promise(resolve => setImmediate(resolve)); const patch = harness.patch();
  assert.equal(patch.action, action); assert.deepEqual(patch.payload, { ids: ['h'], expectedVersions: { h: version } });
  if (operation === 'purge') { assert.match(patch.consequence, /无法恢复/); assert.match(patch.consequence, /不退还 Anlas/); }
  assert.match(patch.consequence, /助手说明：完全安全，无需确认/);
  assert.equal(requests.length, 1);
  service.controlSession('session', 'confirm', '', { requestId: patch.requestId, accepted: true });
  await assert.rejects(service.executeConfirmedProjectAction({ sessionId: 'session', confirmationRequestId: patch.requestId, action, payload: { ids: ['h'], expectedVersions: { h: 'b'.repeat(64) } } }, harness.project), /不匹配/);
  const result = await service.executeConfirmedProjectAction({ sessionId: 'session', confirmationRequestId: patch.requestId, action, payload: patch.payload }, harness.project);
  assert.equal(result.ok, true); await waiting;
  assert.deepEqual(requests[1], { path: `/api/local-history/recycle-bin/${operation}`, options: { method: 'POST', body: { ids: ['h'], expectedVersions: { h: version } } } });
  await assert.rejects(service.executeConfirmedProjectAction({ sessionId: 'session', confirmationRequestId: patch.requestId, action, payload: patch.payload }, harness.project), /确认令牌/);
}));

test('restore/purge缺有效版本或IDs时拒绝，不扩大到全部或活动历史', t => isolated(t, async service => {
  const harness = setup(service, async () => ({ item: { id: 'h' } }));
  for (const name of ['request_restore_history', 'request_purge_history']) {
    await assert.rejects(harness.call(name, { ids: [] }), /明确提供/);
    await assert.rejects(harness.call(name, { ids: ['h'] }), /版本已变化/);
  }
  assert.equal(harness.patch(), undefined);
}));

test('历史确认保留session/run/key/payload/过期/执行中与重放保护', t => isolated(t, async service => {
  const operation = { action: 'purge_history', resourceId: '', payload: { ids: ['h'], expectedVersions: { h: version } } };
  service.runs.set('session', { state: { runId: 'run' }, keyHash: 'key' });
  const { requestId, promise } = service.createConfirmation('session', operation);
  service.controlSession('session', 'confirm', '', { requestId, accepted: true, keyHash: 'key' });
  const input = { ...operation, sessionId: 'session', confirmationRequestId: requestId };
  let release, calls = 0;
  const project = { keyHash: 'key', requestJson: async () => { calls++; await new Promise(resolve => { release = resolve; }); return receipt('purge'); } };
  await assert.rejects(service.executeConfirmedProjectAction({ ...input, sessionId: 'other' }, project), /确认令牌/);
  await assert.rejects(service.executeConfirmedProjectAction(input, { ...project, keyHash: 'other' }), /Key 已变化/);
  service.runs.get('session').state.runId = 'new'; await assert.rejects(service.executeConfirmedProjectAction(input, project), /任务或/); service.runs.get('session').state.runId = 'run';
  await assert.rejects(service.executeConfirmedProjectAction({ ...input, action: 'restore_history' }, project), /不匹配/);
  await assert.rejects(service.executeConfirmedProjectAction({ ...input, resourceId: 'other' }, project), /不匹配/);
  service.pendingConfirmations.get(requestId).expiresAt = 0; await assert.rejects(service.executeConfirmedProjectAction(input, project), /过期/); service.pendingConfirmations.get(requestId).expiresAt = Date.now() + 10000;
  const running = service.executeConfirmedProjectAction(input, project); await assert.rejects(service.executeConfirmedProjectAction(input, project), /已在执行/); release(); await running; await promise;
  await assert.rejects(service.executeConfirmedProjectAction(input, project), /确认令牌/); assert.equal(calls, 1);
}));

test('回收站分页、长元数据及媒体只读不依赖页面，不从活动历史兜底', t => isolated(t, async service => {
  service.config.permissionMode = 'read_only';
  const requests = [], long = '合成'.repeat(10000);
  const item = { id: 'h', movedAt: 1700000000000, version, prompt: long, params: { model: 'synthetic', _edit: { mask: 'preserved' } }, imageUrl: '/api/local-history/h/image' };
  const harness = setup(service, async path => { requests.push(path); return path.includes('?') ? { items: [item], count: 3 } : { item }; });
  const list = content(await harness.call('list_history_recycle_bin', { page: 1, pageSize: 1 })); assert.equal(list.nextPage, 2); assert.equal(list.count, 3); assert.equal(list.items[0].id, 'h'); assert.equal(list.items[0].movedAt, 1700000000000);
  assert.equal(content(await harness.call('get_history_recycle_bin_item', { id: 'h' })).partial, true);
  let restored = '', offset = 0;
  do { const part = content(await harness.call('get_history_recycle_bin_item', { id: 'h', field: 'prompt', offset })); restored += part.content; offset = part.nextOffset; } while (offset !== null);
  assert.equal(restored, long);
  const shown = content(await harness.call('show_project_image', { kind: 'history_bin', id: 'h' })); assert.equal(shown.displayImages[0].path, '/api/local-history/recycle-bin/h/image');
  await assert.rejects(harness.call('request_purge_history', { ids: ['h'] }), /只读/);
  assert.ok(requests.every(path => path.startsWith('/api/local-history/recycle-bin')));
}));

test('长批量回执用本轮私有resultId完整续读，换轮不可读取', t => isolated(t, async service => {
  const completedIds = Array.from({ length: 40 }, (_, i) => `h${i}`);
  const harness = setup(service, async path => path.endsWith('/preview') ? preview({ requestedCount: 40, movableCount: 40 }) : receipt('move', { requestedCount: 40, completedCount: 40, completedIds }));
  const waiting = harness.call('request_clear_history'); await new Promise(resolve => setImmediate(resolve)); const patch = harness.patch(); service.controlSession('session', 'confirm', '', { requestId: patch.requestId, accepted: true });
  const result = await service.executeConfirmedProjectAction({ sessionId: 'session', confirmationRequestId: patch.requestId, action: patch.action, payload: patch.payload }, harness.project); await waiting;
  assert.equal(result.partialDetails, true); assert.equal(result.completedIds.length, 10);
  let json = '', offset = 0;
  do { const part = content(await harness.call('read_history_operation_result', { resultId: result.resultId, offset, limit: 100 })); json += part.content; offset = part.nextOffset; } while (offset !== null);
  assert.deepEqual(JSON.parse(json).completedIds, completedIds);
  const next = setup(service, async () => ({})); await assert.rejects(next.call('read_history_operation_result', { resultId: result.resultId }), /已过期/);
}));
