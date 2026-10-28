import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PromptAgentService } from '../../scripts/prompt-agent.mjs';
import { createAgentPromptChange } from '../../services/agentPromptChanges.mjs';

const isolated = async work => {
  const root = await mkdtemp(join(tmpdir(), 'nai-prompt-changes-'));
  const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  service.appendAuditLog = async () => {};
  try { await work(service); } finally { await rm(root, { recursive: true, force: true }); }
};
const draft = { target: { chainId: 'lab', mode: 'text-to-image', fingerprint: 'before' }, basePrompt: 'old', subjectPrompt: '', negativePrompt: '', modules: [], params: {} };

test('差异随会话保留、回执可撤回重做，后续模型调用不携带差异元数据', () => isolated(async service => {
  const session = await service.createSession();
  const change = createAgentPromptChange(draft, { ...draft, basePrompt: 'new' }, 'run-1');
  await service.saveMessages(session.id, [{ role: 'user', content: 'modify' }, { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: 123, promptChange: change }]);
  assert.deepEqual((await service.getSessionHistory(session.id)).at(-1).promptChange, change);
  const runtime = await service.loadMessages(session.id);
  assert.equal(runtime.at(-1).promptChange, undefined);
  await service.updateSession(session.id, { promptChange: { id: 'run-1', status: 'applied', appliedChanges: change.changes } });
  await service.saveMessages(session.id, [...runtime, { role: 'user', content: 'next turn' }]);
  assert.equal((await service.getSessionHistory(session.id))[1].promptChange.status, 'applied');
  await service.updateSession(session.id, { promptChange: { id: 'run-1', status: 'undone' } });
  assert.equal((await service.getSessionHistory(session.id))[1].promptChange.status, 'undone');
  await service.updateSession(session.id, { promptChange: { id: 'run-1', status: 'applied' } });
  assert.equal((await service.getSessionHistory(session.id))[1].promptChange.status, 'applied');
  await service.resetSession(session.id);
  assert.deepEqual(await service.getSessionHistory(session.id), []);
}));

test('回执仅能保存原修改的实际应用子集，不接受其他字段与无效状态', () => isolated(async service => {
  const session = await service.createSession();
  const change = createAgentPromptChange(draft, { ...draft, basePrompt: 'new', negativePrompt: 'blur' }, 'run-2');
  await service.saveMessages(session.id, [{ role: 'assistant', content: [], timestamp: 42, promptChange: change }]);
  assert.equal((await service.getSessionHistory(session.id)).length, 1);
  const appliedChanges = [{ ...change.changes[0], before: 'manual draft reviewed by user' }];
  await service.updateSession(session.id, { promptChange: { id: 'run-2', status: 'applied', appliedChanges } });
  assert.deepEqual((await service.getSessionHistory(session.id))[0].promptChange.appliedChanges, appliedChanges);
  for (const patch of [
    { id: 'missing', status: 'applied', appliedChanges },
    { id: 'run-2', status: 'invalid', appliedChanges },
    { id: 'run-2', status: 'applied', appliedChanges: [{ path: ['params', 'steps'], before: 20, after: 30 }] },
    { id: 'run-2', status: 'applied', appliedChanges: [{ path: ['basePrompt'], after: 'forged' }] },
  ]) await assert.rejects(service.updateSession(session.id, { promptChange: patch }));
  assert.deepEqual((await service.getSessionHistory(session.id))[0].promptChange.appliedChanges, appliedChanges);
}));
