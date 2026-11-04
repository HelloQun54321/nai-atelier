import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { PromptAgentService } from '../../scripts/prompt-agent.mjs';

const stream = round => new Response('data: ' + JSON.stringify({
  id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'a',
  choices: [{ index: 0, delta: { role: 'assistant', ...(round.tool
    ? { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: round.tool, arguments: '{}' } }] }
    : { content: '合成任务完成' }) }, finish_reason: round.tool ? 'tool_calls' : 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020 },
}) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

test('插件片段只进入完全访问任务，循环保持快照，停用恢复，审计不泄露正文', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atelier-agent-test-'));
  const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  const previousFetch = globalThis.fetch;
  const audit = [], requests = [];
  let active = [];
  const block = { id: 'plugin_synthetic_body', pluginId: 'synthetic', title: '预览标题', text: 'SYNTHETIC_PRIVATE_PLUGIN_BODY' };
  service.appendAuditLog = async (_id, entry) => audit.push(entry);
  service.plugins.promptBlocks = async () => structuredClone(active);
  service.plugins.snapshotPromptBlocks = () => structuredClone(active);
  service.plugins.agentTools = async () => [];
  try {
    await service.saveCustomProvider({ id: 'custom-synthetic', name: 'synthetic', baseUrl: 'http://127.0.0.1:1234/v1', models: [{ id: 'a' }], apiKey: 'synthetic', select: true });
    service.config.permissionMode = 'full';
    const baselineFingerprint = service.publicConfig().policyFingerprint;
    active = [block];
    assert.notEqual(service.publicConfig().policyFingerprint, baselineFingerprint);
    const session = await service.createSession();
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      active = [];
      return requests.length === 1 ? stream({ tool: 'get_local_time' }) : stream({});
    };
    await service.run({ sessionId: session.id, message: 'synthetic first', draft: { params: {} } }, () => {});
    assert.equal(requests.length, 2);
    const first = requests[0].messages[0].content;
    assert.ok(first.includes(block.text));
    assert.ok(!first.includes(block.title));
    assert.ok(first.indexOf(block.text) < first.indexOf('[当前助手权限]'));
    assert.equal(requests[1].messages[0].content, first);
    await service.run({ sessionId: session.id, message: 'synthetic next', draft: { params: {} } }, () => {});
    const next = requests[2].messages[0].content;
    assert.equal(first.replace('\n' + block.text, ''), next);
    assert.equal(service.publicConfig().policyFingerprint, baselineFingerprint);
    assert.ok(!JSON.stringify(audit).includes(block.text));
    active = [block];
    for (const permissionMode of ['standard', 'read_only']) {
      service.config.permissionMode = permissionMode;
      service.plugins.promptBlocks = async () => { throw new Error('非完全权限不应启动插件'); };
      service.plugins.agentTools = async () => { throw new Error('非完全权限不应读取插件工具'); };
      await service.run({ sessionId: session.id, message: 'synthetic permission', draft: { params: {} } }, () => {});
      assert.ok(!requests.at(-1).messages[0].content.includes(block.text));
    }
  } finally {
    globalThis.fetch = previousFetch;
    for (const pending of service.pendingConfirmations.values()) clearTimeout(pending.timer);
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  }
});
