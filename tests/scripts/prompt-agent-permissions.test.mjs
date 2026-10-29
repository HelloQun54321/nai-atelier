import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PromptAgentService } from '../../scripts/prompt-agent.mjs';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';

const deferred = () => Promise.withResolvers();
const isolated = async work => {
  const root = createWorkspace('agent-permission-');
  const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  service.appendAuditLog = async () => {};
  try { await work(service, root); } finally { removeWorkspace(root); }
};
const prepareStart = (service, kind) => {
  const entered = deferred(), release = deferred();
  service.readSession = async () => { entered.resolve(service.publicConfig().permissionMode); await release.promise; throw new Error('synthetic stop before model'); };
  return { entered, release, start: () => kind === 'run'
    ? service.run({ sessionId: 'synthetic', message: 'synthetic' }, () => {})
    : service.compactSession('synthetic') };
};

for (const kind of ['run', 'compact']) {
  test(`${kind} 等权限写盘发布才准入，启动后新的切档拒绝`, () => isolated(async service => {
    await service.setPermissionMode('full');
    const saving = deferred(), publish = deferred();
    service.persistConfig = async () => { saving.resolve(); await publish.promise; };
    const changing = service.setPermissionMode('read_only'); await saving.promise;
    const task = prepareStart(service, kind), started = task.start();
    assert.equal(service.startingAgents.size, 0);
    publish.resolve(); await changing;
    assert.equal(await task.entered.promise, 'read_only');
    await assert.rejects(service.setPermissionMode('standard'), /先停止/);
    task.release.resolve(); await assert.rejects(started, /synthetic stop before model/);
    assert.equal(service.startingAgents.size, 0);
    await service.setPermissionMode('standard');
  }));

  test(`${kind} 先准入时切档拒绝，任务失败清除占位`, () => isolated(async service => {
    await service.setPermissionMode('full');
    const task = prepareStart(service, kind), started = task.start();
    assert.equal(await task.entered.promise, 'full');
    await assert.rejects(service.setPermissionMode('read_only'), /先停止/);
    assert.equal(service.publicConfig().permissionMode, 'full');
    task.release.resolve(); await assert.rejects(started, /synthetic stop before model/);
    await service.setPermissionMode('read_only');
  }));

  test(`${kind} 在权限写盘失败后使用旧成功配置且不死锁`, () => isolated(async (service, root) => {
    await service.setPermissionMode('full');
    const originalPath = service.configFilePath(), saving = deferred(), publish = deferred();
    service.persistConfig = async () => { saving.resolve(); await publish.promise; };
    await writeFile(join(root, 'blocked'), 'synthetic');
    service.configFileOverride = join(root, 'blocked', 'config.json');
    const changing = service.setPermissionMode('read_only');
    const rejected = assert.rejects(changing);
    await saving.promise;
    const task = prepareStart(service, kind), started = task.start();
    assert.equal(service.startingAgents.size, 0);
    publish.resolve(); await rejected;
    assert.equal(await task.entered.promise, 'full');
    task.release.resolve(); await assert.rejects(started, /synthetic stop before model/);
    service.configFileOverride = originalPath;
    await service.setPermissionMode('read_only');
    assert.equal(service.publicConfig().permissionMode, 'read_only');
  }));
}

test('准入等待期间新增的配置事务也发布后才启动', () => isolated(async service => {
  await service.setPermissionMode('full');
  const saving = deferred(), publish = deferred();
  service.persistConfig = async () => { saving.resolve(); await publish.promise; };
  const first = service.setPermissionMode('standard'); await saving.promise;
  const task = prepareStart(service, 'run'), started = task.start();
  const latest = service.setPermissionMode('read_only');
  publish.resolve(); await Promise.all([first, latest]);
  assert.equal(await task.entered.promise, 'read_only');
  task.release.resolve(); await assert.rejects(started, /synthetic stop before model/);
}));

test('只读免费搜索实际进入stub并允许后续网页读取，旧工具对象仍拒绝写操作', () => isolated(async service => {
  await service.setPermissionMode('full');
  const calls = [];
  service.fetchWebPage = async url => {
    calls.push(String(url));
    if (String(url).startsWith('https://html.duckduckgo.com/')) return { text: '<a class="result__a" href="https://example.com/source">Synthetic source</a><a class="result__snippet">Synthetic summary</a>', mimeType: 'text/html', finalUrl: String(url) };
    assert.equal(String(url), 'https://example.com/source');
    return { text: '<html><title>Synthetic page</title><body>Verified synthetic body.</body></html>', mimeType: 'text/html', finalUrl: String(url) };
  };
  const tools = service.createTools({ basePrompt: 'original', subjectPrompt: '', negativePrompt: '', modules: [], params: {} }, {}, () => {}, {});
  const execute = async (name, args = {}) => JSON.parse((await tools.find(tool => tool.name === name).execute('synthetic', args)).content[0].text);
  await service.setPermissionMode('read_only');
  const search = await execute('web_search', { query: 'synthetic query' });
  assert.equal(search.provider, 'duckduckgo'); assert.equal(search.results[0].url, 'https://example.com/source');
  const page = await execute('read_web_page', { url: search.results[0].url });
  assert.match(page.content, /Verified synthetic body/); assert.equal(calls.length, 2);
  for (const [name, args] of [['update_prompts', { basePrompt: 'changed' }], ['request_generation', {}], ['set_generation_params', { steps: 50 }], ['set_prompt_modules', { modules: [] }], ['save_tag_translations', { translations: [] }]]) await assert.rejects(execute(name, args), /只读/);
  await assert.rejects(execute('read_web_page', { url: 'https://example.com/not-from-search' }), /本轮/);
}));
