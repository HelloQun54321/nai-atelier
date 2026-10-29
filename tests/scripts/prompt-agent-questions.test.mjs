import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PromptAgentService } from '../../scripts/prompt-agent.mjs';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';

const questions = [{ id: 'direction', prompt: '请选择创作方向', options: [{ id: 'a', label: '方向甲' }, { id: 'b', label: '方向乙' }] }];
const isolated = async work => {
  const root = createWorkspace('agent-questions-');
  const service = new PromptAgentService({ configFile: root, lanSecret: 'synthetic' });
  service.appendAuditLog = async () => {};
  try { await work(service, root); }
  finally { for (const item of [...service.pendingQuestions.values()]) item.settle({ answered: false, code: 'test_cleanup' }); removeWorkspace(root); }
};
const runState = service => {
  const run = { controller: new AbortController(), keyHash: 'key', state: { runId: 'run', status: 'running' } };
  service.runs.set('session', run);
  return run;
};
const answer = (request, answers = [{ questionId: 'direction', optionId: 'b' }]) => ({ runId: request.runId, requestId: request.requestId, keyHash: 'key', answers });
const stream = round => new Response('data: ' + JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'a', choices: [{ index: 0, delta: { role: 'assistant', ...(round.tool ? { tool_calls: [{ index: 0, id: 'call-question', type: 'function', function: { name: round.tool, arguments: JSON.stringify(round.args) } }] } : { content: '按真实答案继续完成' }) }, finish_reason: round.tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

test('真实Pi同任务等待回答，poll可恢复，完整问题答案重启历史可读', () => isolated(async (service, root) => {
  await service.saveCustomProvider({ id: 'custom-synthetic', name: 'synthetic', baseUrl: 'http://127.0.0.1:1234/v1', models: [{ id: 'a' }], apiKey: 'synthetic', select: true });
  await service.setPermissionMode('read_only');
  const session = await service.createSession(), previous = globalThis.fetch;
  const customText = '完整自定义答案'.repeat(250).slice(0, 2000);
  const three = [0, 1, 2].map(index => ({ id: `q${index}`, prompt: `真实问题${index}`, options: [] }));
  const received = Promise.withResolvers(); let calls = 0, submitted, runId;
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (calls === 1) return stream({ tool: 'request_user_input', args: { questions: three } });
    const body = JSON.parse(options.body);
    assert.ok(JSON.stringify(body.messages).includes(customText));
    assert.equal(service.runs.get(session.id).state.runId, runId);
    return stream({});
  };
  try {
    const task = service.run({ sessionId: session.id, message: '先问我再继续', draft: { params: {} } }, event => { if (event.type === 'request_question') received.resolve(event.request); });
    const request = await received.promise; runId = request.runId;
    const polled = await service.getTask(session.id);
    assert.equal(polled.status, 'waiting_user_input'); assert.deepEqual(polled.pendingQuestions, [request]);
    const recovered = polled.events.find(event => event.type === 'request_question').request;
    assert.equal(recovered.requestId, request.requestId);
    assert.equal(service.pendingConfirmations.size, 0);
    submitted = { requestId: recovered.requestId, runId: recovered.runId, answers: three.map(q => ({ questionId: q.id, customText })) };
    const receipt = service.controlSession(session.id, 'answer', '', submitted);
    assert.equal(receipt.ok, true);
    assert.deepEqual(service.controlSession(session.id, 'answer', '', submitted), receipt);
    await task;
    const answered = (await service.getTask(session.id)).events.find(event => event.type === 'question_answered');
    assert.equal(answered.requestId, recovered.requestId); assert.equal(answered.answered, true);
    assert.equal(calls, 2);
    const restored = new PromptAgentService({ configFile: root, lanSecret: 'synthetic' });
    await restored.init();
    const history = await restored.getSessionHistory(session.id);
    const tool = history.flatMap(item => item.tools || []).find(item => item.name === 'request_user_input');
    const saved = JSON.parse(tool.result[0].text);
    assert.deepEqual(saved.questions, three); assert.equal(saved.answered, true);
    assert.deepEqual(saved.answers, submitted.answers);
    assert.equal((await restored.getTask(session.id)).pendingQuestions.length, 0);
    assert.deepEqual(service.controlSession(session.id, 'answer', '', submitted), receipt);
  } finally { globalThis.fetch = previous; }
}));

test('审计始终脱敏requestId，只有任务问答事件保留关联编号', () => isolated(async service => {
  const secret = 'synthetic-confirmation-token';
  assert.deepEqual(service.sanitizeAuditValue({ requestId: secret, nested: { requestId: secret } }), { requestId: '[redacted]', nested: { requestId: '[redacted]' } });
  assert.equal(service.sanitizeTaskEvent({ type: 'action', action: { patch: { requestId: secret } } }).action.patch.requestId, '[redacted]');
  for (const type of ['request_question', 'question_answered']) assert.equal(service.sanitizeTaskEvent({ type, requestId: 'question-id' }).requestId, 'question-id');
}));

test('回答校验完整选项与自定义，重答幂等且不可改答或跨任务扩权', () => isolated(async service => {
  runState(service); let request;
  const waiting = service.askUser('session', questions, event => { if (event.request) request = event.request; });
  for (const answers of [[], [{ questionId: 'direction', optionId: 'missing' }], [{ questionId: 'direction', optionId: 'a', customText: '混入' }], [{ questionId: 'direction', customText: ' ' }], [{ questionId: 'direction', customText: 'x'.repeat(2001) }]]) assert.throws(() => service.controlSession('session', 'answer', '', answer(request, answers)), /问题|答案|选项|自定义/);
  assert.throws(() => service.controlSession('session', 'answer', '', { ...answer(request), runId: 'other' }), /当前任务/);
  assert.equal(service.pendingQuestions.size, 1);
  const receipt = service.controlSession('session', 'answer', '', answer(request));
  assert.deepEqual(await waiting, { requestId: request.requestId, questions, answered: true, answers: receipt.answers });
  assert.deepEqual(service.controlSession('session', 'answer', '', answer(request)), receipt);
  assert.throws(() => service.controlSession('session', 'answer', '', answer(request, [{ questionId: 'direction', optionId: 'a' }])), /不同答案/);
  assert.equal(service.pendingConfirmations.size, 0);
}));

for (const cause of ['stop', 'run_timeout']) test(`真实Pi${cause}取消等待后历史仍保留未回答收据，不产生默认答案`, () => isolated(async service => {
  await service.saveCustomProvider({ id: 'custom-synthetic', name: 'synthetic', baseUrl: 'http://127.0.0.1:1234/v1', models: [{ id: 'a' }], apiKey: 'synthetic', select: true });
  const session = await service.createSession(), previous = globalThis.fetch;
  let calls = 0;
  const controller = new AbortController();
  globalThis.fetch = async () => { calls++; return stream({ tool: 'request_user_input', args: { questions } }); };
  try {
    await service.run({ sessionId: session.id, message: '先问我', draft: { params: {} } }, event => {
      if (event.type === 'request_question') {
        assert.equal(event.request.expiresAt, undefined);
        if (cause === 'stop') service.controlSession(session.id, 'abort');
        else controller.abort(new DOMException('synthetic run deadline', 'TimeoutError'));
      }
    }, controller.signal);
    assert.equal(calls, 1);
    const tool = (await service.getSessionHistory(session.id)).flatMap(item => item.tools || []).find(item => item.name === 'request_user_input');
    const saved = JSON.parse(tool.result[0].text);
    assert.equal(saved.answered, false); assert.equal(saved.code, 'task_interrupted');
    assert.equal(saved.answers, undefined); assert.deepEqual(saved.questions, questions);
  } finally { globalThis.fetch = previous; }
}));

test('停止、目标与Key变化取消问题且不代答', () => isolated(async service => {
  for (const cause of ['abort', 'target_changed', 'key_changed']) {
    const run = runState(service); let request;
    const waiting = service.askUser('session', questions, event => { if (event.request) request = event.request; });
    if (cause === 'abort') service.controlSession('session', 'abort');
    else if (cause === 'target_changed') {
      run.clientDraft = { target: { chainId: 'old', mode: 'text-to-image', fingerprint: 'old' } }; run.draft = { ...run.clientDraft };
      run.contextData = { clientSettings: { pageClientId: 'page' } };
      service.controlSession('session', 'ui_context', '', { clientId: 'page', page: { snapshotId: 'page', title: 'page' }, labRetarget: { targetBefore: run.clientDraft.target, draft: { target: { chainId: 'new', mode: 'text-to-image', fingerprint: 'new' }, params: {}, modules: [] } } });
    } else if (cause === 'key_changed') assert.throws(() => service.controlSession('session', 'answer', '', { ...answer(request), keyHash: 'other' }), /Key/);
    const result = await waiting;
    assert.equal(result.answered, false); assert.equal(result.answers, undefined);
    assert.equal(result.code, cause === 'abort' ? 'task_interrupted' : cause);
    assert.equal(service.pendingQuestions.size, 0);
    assert.throws(() => service.controlSession('session', 'answer', '', answer(request)), /已结束/);
  }
}));

test('问题参数边界拒绝且只读select转交页面二次判定', () => isolated(async service => {
  runState(service);
  for (const value of [[], Array(4).fill(questions[0]), [{ ...questions[0], options: questions[0].options.slice(0, 1) }], [questions[0], questions[0]]]) await assert.rejects(service.askUser('session', value, () => {}));
  service.config.permissionMode = 'read_only';
  const operations = [];
  const tools = service.createTools({ params: {} }, {}, () => {}, { requestUI: async operation => { operations.push(operation); if (operation.controlId === 'editable') throw new Error('页面只允许browse选择'); return { snapshotId: 'page', controls: [] }; } });
  const operate = tools.find(item => item.name === 'operate_current_page');
  await operate.execute('id', { action: 'select', controlId: 'browse', permissionMode: 'full' });
  assert.equal(operations[0].permissionMode, 'read_only');
  await assert.rejects(operate.execute('id', { action: 'select', controlId: 'editable' }), /browse/);
  await assert.rejects(operate.execute('id', { action: 'fill', controlId: 'browse' }), /只读/);
}));
