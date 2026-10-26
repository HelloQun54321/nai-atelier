import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { PromptAgentService } from '../../scripts/prompt-agent.mjs';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';

const isolated = async run => {
  const root = createWorkspace('agent-vibe-reference-');
  try { await run(new PromptAgentService({ lanSecret: 'synthetic', configFile: root })); }
  finally { removeWorkspace(root); }
};
const draft = (slot = { vibeId: 'vibe', encodingId: 'encoding' }) => ({ params: { vibes: { enabled: false, slots: [slot] } } });
const referenced = error => error.status === 409 && /仍在引用/.test(error.message);
const unreadable = error => error.status === 409 && /无法核对/.test(error.message);

test('Vibe 删除保护读取可恢复 finalDraft，保留原文件且忽略聊天/事件/审计和子串文字', () => isolated(async service => {
  await service.assertVibeNotReferenced('vibe');
  await mkdir(service.taskDirPath());
  await mkdir(service.sessionDirPath());
  await mkdir(service.auditDirPath());
  await writeFile(service.taskEventsFile('s'), 'not task JSON');
  await writeFile(service.sessionFile('s'), 'not conversation JSON');
  await writeFile(service.auditLogFile('s'), 'not audit JSON');
  await writeFile(service.taskFile('s'), JSON.stringify({ status: 'aborted', finalDraft: { params: {}, basePrompt: 'vibe encoding', note: JSON.stringify(draft()) } }));
  await service.assertVibeNotReferenced('vibe', 'encoding');
  const saved = JSON.stringify({ status: 'interrupted', finalDraft: draft() });
  await writeFile(service.taskFile('s'), saved);
  await assert.rejects(service.assertVibeNotReferenced('vibe'), referenced);
  await assert.rejects(service.assertVibeNotReferenced('vibe', 'encoding'), referenced);
  await assert.rejects(service.assertVibeNotReferenced('vibe', 'other-encoding'), referenced);
  await service.assertVibeNotReferenced('vibe', 'other-encoding', ['encoding', 'other-encoding']);
  await service.assertVibeNotReferenced('other-vibe');
  assert.equal(await readFile(service.taskFile('s'), 'utf8'), saved);
}));

test('Vibe 删除保护检查运行/页面/挂起草稿和待确认快照，未知编码保守保护整项资产', () => isolated(async service => {
  for (const run of [
    { draft: draft() }, { clientDraft: draft() }, { state: { finalDraft: draft() } },
    { suspendedDrafts: new Map([['s', { draft: draft() }]]) },
    { suspendedDrafts: new Map([['s', { client: draft() }]]) },
  ]) {
    service.runs.set('s', run);
    await assert.rejects(service.assertVibeNotReferenced('vibe', 'encoding'), referenced);
    await assert.rejects(service.assertVibeNotReferenced('vibe', 'other-encoding'), referenced);
    await service.assertVibeNotReferenced('vibe', 'other-encoding', ['encoding', 'other-encoding']);
    service.runs.clear();
  }
  for (const slot of [{ vibeId: 'vibe' }, { vibeId: 'vibe', encodingId: '' }, { vibeId: 'vibe', encodingId: null }, { vibeId: 'vibe', encodingId: 'missing-encoding' }]) {
    service.runs.set('s', { draft: draft(slot) });
    await assert.rejects(service.assertVibeNotReferenced('vibe', 'any-encoding', ['any-encoding', 'other-encoding']), referenced);
    service.runs.clear();
  }
  service.pendingConfirmations.set('p', { operation: { action: 'request_generation', payload: { draft: draft() } } });
  await assert.rejects(service.assertVibeNotReferenced('vibe', 'encoding'), referenced);
  await assert.rejects(service.assertVibeNotReferenced('vibe', 'other-encoding'), referenced);
  await service.assertVibeNotReferenced('vibe', 'other-encoding', ['encoding', 'other-encoding']);
  service.pendingConfirmations.set('p', { operation: { action: 'encode_vibe', resourceId: 'vibe', payload: {} } });
  await assert.rejects(service.assertVibeNotReferenced('vibe'), referenced);
  await service.assertVibeNotReferenced('other-vibe');
}));

test('Vibe 删除保护遇到无法读取目录、任务或非法快照时拒绝，不当作没有引用', () => isolated(async service => {
  await assert.rejects(service.assertVibeNotReferenced('vibe', 'encoding', 'invalid'), unreadable);
  await assert.rejects(service.assertVibeNotReferenced('vibe', 'encoding', [1]), unreadable);
  await writeFile(service.taskDirPath(), 'not a directory');
  await assert.rejects(service.assertVibeNotReferenced('vibe'), unreadable);
  await unlink(service.taskDirPath()); await mkdir(service.taskDirPath());
  await mkdir(service.taskFile('s'));
  await assert.rejects(service.assertVibeNotReferenced('vibe'), unreadable);
  await rmdir(service.taskFile('s'));
  for (const contents of ['{', 'null', '[]', '{"finalDraft":"invalid"}', '{"finalDraft":{"params":null}}']) {
    await writeFile(service.taskFile('s'), contents);
    await assert.rejects(service.assertVibeNotReferenced('vibe'), unreadable);
    assert.equal(await readFile(service.taskFile('s'), 'utf8'), contents);
  }
}));
