import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PromptAgentService } from '../../scripts/prompt-agent.mjs';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { createAgentPromptChange } from '../../services/agentPromptChanges.mjs';
import { normalizeAgentLabDraft, restoreUnchangedAgentLabFields } from '../../services/agentLabSync.mjs';

const isolated = async work => {
  const root = createWorkspace('agent-versions-');
  const service = new PromptAgentService({ configFile: root, lanSecret: 'synthetic' });
  service.appendAuditLog = async () => {}; service.searchTags = async () => [];
  try { await work(service, root); } finally { removeWorkspace(root); }
};
const draft = () => ({ basePrompt: 'original', subjectPrompt: '', negativePrompt: 'blur', modules: [], target: { chainId: 'lab', mode: 'text-to-image', fingerprint: 'initial' }, params: { steps: 28, characters: [{ id: 'c', prompt: 'old character', negativePrompt: 'old negative', x: .2, y: .4 }] } });
const toolsFor = (service, value, sessionId, project = {}, events = []) => {
  const tools = service.createTools(value, {}, event => events.push(event), { agentSessionId: sessionId, ...project });
  return async (name, args = {}) => JSON.parse((await tools.find(item => item.name === name).execute('synthetic', args)).content[0].text);
};

test('每工具改写先留旧稿，备份失败不发布；异常任务仍可读完整版本', () => isolated(async service => {
  const session = await service.createSession(), value = draft(), events = [];
  const call = toolsFor(service, value, session.id, {}, events);
  await call('update_prompts', { basePrompt: 'second' });
  await call('update_prompts', { negativePrompt: 'new negative' });
  await call('set_characters', { characters: [{ id: 'c', prompt: 'new character' }] });
  const versions = (await service.readSession(session.id)).promptVersions;
  assert.equal(versions.length, 3); assert.equal(versions[0].content.basePrompt, 'original');
  assert.equal(versions[1].content.basePrompt, 'second'); assert.equal(versions[2].content.params.characters[0].prompt, 'old character');
  assert.equal(versions[0].content.params.steps, undefined); assert.equal(versions[0].content.params.characters[0].x, undefined);
  const previous = structuredClone(value), count = events.length;
  const save = service.savePromptVersion; service.savePromptVersion = async () => { throw new Error('synthetic backup write failure'); };
  await assert.rejects(call('update_prompts', { basePrompt: 'must not publish' }), /backup/);
  assert.deepEqual(value, previous); assert.equal(events.length, count);
  service.savePromptVersion = save;
  assert.equal((await call('list_prompt_versions')).total, 3);
  await service.saveMessages(session.id, [{ role: 'user', content: 'failed synthetic task' }]);
  assert.equal((await service.readSession(session.id)).promptVersions.length, 3);
}));

test('会话隔离、无固定裁剪、长正文分页及并发消息改名编辑不吞版本', () => isolated(async (service, root) => {
  const a = await service.createSession(), b = await service.createSession();
  const original = draft(); original.basePrompt = 'long original, '.repeat(2500);
  await service.saveMessages(a.id, [{ role: 'user', content: 'old message' }]);
  await Promise.all(Array.from({ length: 41 }, (_, index) => service.savePromptVersion(a.id, { draft: { ...original, subjectPrompt: `version ${index}` }, reason: 'synthetic' })));
  await Promise.all([service.saveMessages(a.id, [{ role: 'user', content: 'old message' }]), service.updateSession(a.id, { title: 'renamed' }), service.reviseSessionMessage(a.id, 'saved-0', 'revised')]);
  const restored = new PromptAgentService({ configFile: root, lanSecret: 'synthetic' });
  await restored.init();
  const call = toolsFor(restored, draft(), a.id), other = toolsFor(restored, draft(), b.id);
  const all = []; let offset = 0;
  do { const page = await call('list_prompt_versions', { offset, limit: 20 }); all.push(...page.items); offset = page.nextOffset; } while (offset !== null);
  assert.equal(all.length, 41); assert.equal(new Set(all.map(item => item.id)).size, 41);
  let json = ''; offset = 0;
  do { const page = await call('read_prompt_version', { id: all[0].id, offset }); json += page.text; offset = page.nextOffset; } while (offset !== null);
  assert.equal(JSON.parse(json).content.basePrompt, original.basePrompt);
  assert.equal((await other('list_prompt_versions')).total, 0);
  await assert.rejects(other('read_prompt_version', { id: all[0].id }), /本对话/);
  const beforeClear = await restored.readSession(a.id);
  await restored.resetSession(a.id); assert.equal((await restored.listPromptVersions(a.id)).total, 0);
  await restored.writeSession(a.id, beforeClear); assert.equal((await restored.listPromptVersions(a.id)).total, 0);
  await restored.savePromptVersion(b.id, { draft: draft() });
  const stale = await restored.readSession(b.id);
  await restored.deleteSession(b.id); await assert.rejects(restored.writeSession(b.id, stale), /已删除/);
  await assert.rejects(readFile(restored.sessionFile(b.id)), { code: 'ENOENT' });
}));

test('恢复前保存当前版，手改/错目标/只读拒绝且恢复仍静默补译', () => isolated(async service => {
  const session = await service.createSession(), value = draft();
  const call = toolsFor(service, value, session.id);
  await call('update_prompts', { basePrompt: 'edited' });
  const old = (await service.listPromptVersions(session.id)).items[0];
  await call('restore_prompt_version', { id: old.id });
  assert.equal(value.basePrompt, 'original'); assert.equal(value.params.steps, 28); assert.equal(value.params.characters[0].x, .2);
  assert.equal((await service.listPromptVersions(session.id)).total, 2);
  const result = await call('restore_prompt_version', { id: old.id });
  assert.ok(result.tagTranslations.missingTags.includes('original'));
  value.basePrompt = 'manual unknown';
  await assert.rejects(call('restore_prompt_version', { id: old.id, force: true }), /手改/);
  value.target.chainId = 'other'; await assert.rejects(call('restore_prompt_version', { id: old.id }), /作品/);
  service.config.permissionMode = 'read_only';
  await call('list_prompt_versions'); await call('read_prompt_version', { id: old.id });
  await assert.rejects(call('restore_prompt_version', { id: old.id }), /只读/);
}));

test('资产两入口写前保存，条件冲突不重试，恢复仅提示词并保留当前参数', () => isolated(async service => {
  const session = await service.createSession(), current = { id: 'asset', type: 'style', name: 'asset', basePrompt: 'asset old', negativePrompt: 'old negative', updatedAt: 100, modules: [], params: { steps: 28, _promptLibrary: { bilingual: '原对照', references: [] } } };
  const writes = []; let conflict = false;
  const project = { requestJson: async (_path, options) => {
    if (!options) return structuredClone(current);
    writes.push(options.body);
    assert.ok((await service.listPromptVersions(session.id)).total > 0);
    if (conflict) throw Object.assign(new Error('synthetic CAS conflict'), { status: 409 });
    assert.equal(options.body.expectedUpdatedAt, current.updatedAt);
    Object.assign(current, options.body, { updatedAt: current.updatedAt + 1 });
    return { success: true, updatedAt: current.updatedAt };
  } };
  const call = toolsFor(service, draft(), session.id, project);
  await call('update_chain', { id: 'asset', basePrompt: 'asset new' });
  const old = (await service.listPromptVersions(session.id)).items[0];
  current.params.steps = 35;
  await call('restore_prompt_version', { id: old.id });
  assert.equal(current.basePrompt, 'asset old'); assert.equal(current.params.steps, 35); assert.equal(writes.at(-1).previewImage, undefined);
  current.type = 'appearance';
  conflict = true; const before = writes.length;
  await assert.rejects(call('update_prompt_library_item', { id: 'asset', prompt: 'failed update' }), /CAS/);
  assert.equal(writes.length, before + 1); assert.equal(current.basePrompt, 'asset old');
  assert.equal((await service.listPromptVersions(session.id)).total, 3);
}));

test('重复浏览前置原稿去重，计划结果不能冒充真实已应用版本', () => isolated(async service => {
  const session = await service.createSession(), original = draft(), planned = { ...original, basePrompt: 'planned but never applied' };
  const first = await service.savePromptVersion(session.id, { draft: original, afterDraft: planned, source: 'page', reason: 'before_page_edit' });
  const again = await service.savePromptVersion(session.id, { draft: original, source: 'page', reason: 'before_page_edit' });
  assert.equal(first.id, again.id); assert.equal((await service.listPromptVersions(session.id)).total, 1);
  const version = (await service.readSession(session.id)).promptVersions[0];
  assert.equal(version.afterFingerprint, undefined); assert.ok(version.plannedFingerprint);
  const working = await service.savePromptVersion(session.id, { draft: original, afterDraft: planned, source: 'working' });
  const call = toolsFor(service, structuredClone(planned), session.id);
  await assert.rejects(call('restore_prompt_version', { id: working.id }), /手改/);
  await service.finishPromptVersion(session.id, working.id, planned);
  await call('restore_prompt_version', { id: working.id });
}));

test('真实应用回执取已存raw原稿，保存伴随正文修改的旧分栏清理', () => isolated(async service => {
  const session = await service.createSession(), before = draft();
  before.params._promptSections = { sectionNegatives: { 'purpose:clothing': 'coat' }, sectionMeta: { 'purpose:clothing': { source: 'library', entryId: 'old' } } };
  const proposed = normalizeAgentLabDraft(before); proposed.negativePrompt = 'new complete negative';
  const declared = createAgentPromptChange(normalizeAgentLabDraft(before), proposed, 'synthetic-run');
  await service.saveMessages(session.id, [{ role: 'assistant', content: [{ type: 'text', text: 'done' }], promptChange: declared }]);
  const saved = await service.savePromptVersion(session.id, { draft: before, source: 'page', reason: 'before_apply' });
  const after = restoreUnchangedAgentLabFields(before, proposed);
  await service.updateSession(session.id, { promptChange: { id: declared.id, status: 'applied', beforeVersionId: saved.id, rawAfter: after, selectedAfter: proposed } });
  const change = (await service.getSessionHistory(session.id))[0].promptChange;
  assert.ok(change.appliedChanges.some(item => item.path.includes('_promptSections')));
  await service.updateSession(session.id, { promptChange: { id: declared.id, status: 'undone' } });
  await service.updateSession(session.id, { promptChange: { id: declared.id, status: 'applied' } });
  assert.deepEqual((await service.getSessionHistory(session.id))[0].promptChange.appliedChanges, change.appliedChanges);
  assert.ok((await service.readSession(session.id)).promptVersions[0].afterFingerprint);
  await assert.rejects(service.updateSession(session.id, { promptChange: { id: declared.id, status: 'applied', beforeVersionId: saved.id, rawAfter: { ...after, basePrompt: 'unauthorized' }, selectedAfter: { ...proposed, basePrompt: 'unauthorized' } } }), /声明/);
}));

test('保存旧稿期间手改优先，页面恢复命令不能绕过业务版本校验', () => isolated(async service => {
  const session = await service.createSession(), value = draft(), events = [];
  const originalSave = service.savePromptVersion.bind(service);
  service.savePromptVersion = async (...args) => { const result = await originalSave(...args); value.basePrompt = 'manual during backup'; return result; };
  const call = toolsFor(service, value, session.id, {}, events);
  await assert.rejects(call('update_prompts', { basePrompt: 'outdated planned' }), /已变化/);
  assert.equal(value.basePrompt, 'manual during backup'); assert.equal(events.length, 0);
  await assert.rejects(call('operate_current_page', { action: 'command', command: 'restore_prompt_version', args: { content: { basePrompt: 'fake' }, versionId: 'fake' } }), /业务工具/);
}));

test('资产写后按Worker真实规范化回读记版本与补译，回读失败不重放或伪登记', () => isolated(async service => {
  const session = await service.createSession();
  let current = { id: 'asset', type: 'appearance', basePrompt: 'old', negativePrompt: '', updatedAt: 1, params: { _styleBundleSources: [{ id: 'old-source' }] }, modules: [] };
  let readsFail = false, writes = 0;
  const project = { requestJson: async (_path, options) => {
    if (!options) { if (readsFail) throw new Error('synthetic reread failure'); return structuredClone(current); }
    writes++;
    current = { ...current, ...options.body, negativePrompt: 'worker normalized negative', updatedAt: current.updatedAt + 1, params: { ...current.params, ...(options.body.params || {}), _styleBundleSources: [{ id: 'old-source' }, { id: 'worker-union' }] } };
    return { success: true, updatedAt: current.updatedAt };
  } };
  const call = toolsFor(service, draft(), session.id, project);
  const result = await call('update_chain', { id: 'asset', basePrompt: 'new' });
  assert.ok(result.tagTranslations.missingTags.includes('worker normalized negative'));
  assert.equal((await service.readSession(session.id)).promptVersions[0].afterFingerprint, service.promptVersionFingerprint(current));
  const priorRequest = project.requestJson;
  const broken = toolsFor(service, draft(), session.id, { requestJson: async (path, options) => { const value = await priorRequest(path, options); if (options) readsFail = true; return value; } });
  const failedRead = await broken('update_prompt_library_item', { id: 'asset', prompt: 'another' });
  assert.equal(failedRead.ok, true); assert.equal(failedRead.verified, false); assert.equal(failedRead.versionRecorded, false);
  assert.equal(writes, 2); assert.equal((await service.readSession(session.id)).promptVersions.at(-1).afterFingerprint, undefined);
}));

test('工作稿恢复回执失败仍按实际暂存成功报告，不伪报失败或覆盖保存期间手改', () => isolated(async service => {
  const session = await service.createSession(), value = draft(), events = [];
  const call = toolsFor(service, value, session.id, {}, events);
  await call('update_prompts', { basePrompt: 'edited' });
  const old = (await service.listPromptVersions(session.id)).items[0];
  const finish = service.finishPromptVersion;
  service.finishPromptVersion = async () => { throw new Error('synthetic receipt failure'); };
  const tools = service.createTools(value, {}, event => events.push(event), { agentSessionId: session.id });
  const restored = await tools.find(item => item.name === 'restore_prompt_version').execute('test', { id: old.id });
  assert.equal(value.basePrompt, 'original');
  assert.ok(restored.content.some(item => item.type === 'text' && JSON.parse(item.text).versionRecorded === false));
  service.finishPromptVersion = finish;
  const save = service.savePromptVersion.bind(service);
  service.savePromptVersion = async (...args) => { const saved = await save(...args); value.basePrompt = 'manual during restore'; return saved; };
  const count = events.length;
  await assert.rejects(call('restore_prompt_version', { id: old.id }), /已变化/);
  assert.equal(value.basePrompt, 'manual during restore'); assert.equal(events.length, count);
}));
