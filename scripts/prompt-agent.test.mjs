import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PromptAgentService, assemblePromptContext, estimateContextTokens, selectAgentTools, sanitizeAgentImages, detectModelCapabilities, sanitizeCustomProvider, customProviderRuntime, createPromptAgentModelRuntime } from './prompt-agent.mjs';
import { getSupportedThinkingLevels, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { createAgentThinkingMap } from '../services/agentThinking.mjs';

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

test('官方 DeepSeek 元数据贯通图片、真实思考档位、窗口与输出；声明优先于目录', () => {
  const raw = { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', context_window: 1048576, max_output_tokens: 393216, input_modalities: ['text', 'image'], output_modalities: ['text'], effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' }, capabilities: { tools: true } };
  const model = detectModelCapabilities(raw);
  assert.equal(model.imageInput, true); assert.equal(model.reasoning, true); assert.equal(model.tools, true);
  assert.equal(model.contextWindow, 1048576); assert.equal(model.maxTokens, 393216);
  assert.deepEqual(model.thinkingLevels, ['off', 'low', 'high', 'max']); assert.equal(model.thinkingLevelsSource, 'metadata');
  assert.equal(model.capabilityDetection.imageInput, 'metadata'); assert.equal(model.capabilityDetection.reasoning, 'metadata');
  assert.equal(detectModelCapabilities({ ...raw, input_modalities: ['text'], reasoning: false, tools: false }).imageInput, false);
  assert.equal(detectModelCapabilities({ ...raw, reasoning: false }).reasoning, false);
  for (const id of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) assert.equal(detectModelCapabilities(id).imageInput, true);
  const unknown = detectModelCapabilities({ id: 'brand-new', output_modalities: ['image'] });
  assert.equal(unknown.capabilityDetection.imageInput, 'unknown'); assert.equal(unknown.capabilityDetection.reasoning, 'unknown'); assert.equal(unknown.tools, undefined);
  const router = detectModelCapabilities({ id: 'routed', architecture: { modality: 'text+image->text' }, supported_parameters: ['tools', 'reasoning'] });
  assert.equal(router.imageInput, true); assert.equal(router.reasoning, true); assert.equal(router.tools, true);
});

test('空配置没有预设服务；旧连接统一编辑且保持 ID、Key 与会话引用', () => isolated(async service => {
  assert.deepEqual(service.listProviders(), []); assert.deepEqual(service.listCustomProviders(), []);
  await service.loginProvider('deepseek', { apiKey: 'synthetic-key' });
  const legacy = service.listCustomProviders()[0]; assert.equal(legacy.id, 'deepseek'); assert.equal(legacy.models.find(model => model.id === 'deepseek-v4-flash').imageInput, true);
  const session = await service.createSession({ creativeMode: false });
  await service.saveCustomProvider({ ...legacy, models: legacy.models, apiKey: '', select: true });
  assert.equal(service.getCredential('deepseek').key, 'synthetic-key'); assert.equal(service.listProviders().length, 1);
  assert.equal(service.listCustomProviders().length, 1); assert.equal(service.listAvailableModels().filter(model => model.id === 'deepseek-v4-flash').length, 1);
  assert.equal((await service.readSession(session.id)).meta.provider, 'deepseek');
}));

test('模型获取仅访问规范化列表端点，域名变化不复用旧密钥，迟到能力由前端忽略', () => isolated(async service => {
  const previous = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, options) => { requests.push({ url, headers: options.headers }); return Response.json({ data: [{ id: 'a', input_modalities: ['text', 'image'], effort: { supported_levels: ['low', 'high'] } }] }); };
  try {
    await service.saveCustomProvider({ ...customInput(), name: '', apiKey: 'synthetic-key' });
    for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
      const result = await service.fetchCustomProviderModels({ ...customInput(), name: '', api, baseUrl: 'http://127.0.0.1:1234/v1/' + (api === 'anthropic-messages' ? 'messages' : api === 'openai-responses' ? 'responses' : 'chat/completions') });
      assert.equal(result.models[0].imageInput, true); assert.equal(requests.at(-1).url, 'http://127.0.0.1:1234/v1/models');
    }
    assert.equal(requests.length, 3);
    await assert.rejects(service.fetchCustomProviderModels({ ...customInput(), baseUrl: 'https://other.example/v1' }), /域名已改变/);
    await assert.rejects(service.saveCustomProvider({ ...customInput(), baseUrl: 'https://other.example/v1' }), /域名已改变/);
    assert.equal(requests.length, 3); assert.equal(service.getCredential(customInput().id).key, 'synthetic-key');
  } finally { globalThis.fetch = previous; }
}));

test('只在根地址列表 404 时补 /v1，401 不重试；Flash 图片与 low 强度进入同一模型请求', () => isolated(async service => {
  const previous = globalThis.fetch, paths = [], bodies = [];
  globalThis.fetch = async (url, options) => {
    paths.push(String(url));
    if (String(url).endsWith('/models')) return String(url).endsWith('/v1/models') ? Response.json({ data: [{ id: 'deepseek-flash', input_modalities: ['text', 'image'], effort: { supported_levels: ['low', 'high', 'max'] } }] }) : new Response('', { status: 404 });
    bodies.push(JSON.parse(options.body));
    return new Response('data: ' + JSON.stringify({ id: 's', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: { role: 'assistant', content: '收到图片' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const found = await service.fetchCustomProviderModels({ ...customInput(), models: [], baseUrl: 'http://127.0.0.1:1234' });
    assert.equal(found.baseUrl, 'http://127.0.0.1:1234/v1'); assert.equal(paths.length, 2);
    await service.saveCustomProvider({ ...customInput(), baseUrl: found.baseUrl, models: found.models, apiKey: 'synthetic-key', select: true });
    const session = await service.createSession({ creativeMode: false, thinkingLevel: 'low' });
    await service.run({ sessionId: session.id, message: '看看图片', images: [{ data: 'YWJjZA==', mimeType: 'image/png' }], draft: { params: {} } }, () => {});
    assert.equal(bodies.length, 1); assert.equal(bodies[0].model, 'deepseek-flash'); assert.equal(bodies[0].reasoning_effort, 'low');
    assert.equal(bodies[0].thinking.type, 'enabled'); assert.match(JSON.stringify(bodies[0].messages), /data:image\/png;base64,YWJjZA==/);
    paths.length = 0; globalThis.fetch = async url => { paths.push(url); return new Response('', { status: 401 }); };
    await assert.rejects(service.fetchCustomProviderModels({ ...customInput(), baseUrl: 'http://127.0.0.1:1234' }), /401/); assert.equal(paths.length, 1);
  } finally { globalThis.fetch = previous; }
}));

test('模型声明的稀疏思考档位贯通发现、配置与三种协议运行模型', () => {
  const discovered = detectModelCapabilities({ id: 'synthetic-model', supported_reasoning_efforts: ['low', 'high', 'xhigh'], thinkingLevelMap: { low: 'basic', xhigh: 'extreme' } });
  assert.equal(discovered.reasoning, true); assert.equal(discovered.thinkingLevelsSource, 'metadata');
  assert.deepEqual(discovered.thinkingLevels, ['low', 'high', 'xhigh']);
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
    const provider = sanitizeCustomProvider({ ...customInput(), api, models: [discovered] });
    const runtime = customProviderRuntime(provider).getModels()[0];
    assert.deepEqual(provider.models[0].thinkingLevels, discovered.thinkingLevels);
    assert.deepEqual(getSupportedThinkingLevels(runtime), ['low', 'high', 'xhigh']);
    assert.equal(runtime.thinkingLevelMap.low, 'basic'); assert.equal(runtime.thinkingLevelMap.xhigh, 'extreme');
    assert.equal(runtime.thinkingLevelMap.off, null); assert.equal(runtime.thinkingLevelMap.medium, null); assert.equal(runtime.thinkingLevelMap.max, null);
  }
});
test('档位别名与映射元数据保留实际参数；明确禁用的档位不会重新出现', () => {
  const alias = detectModelCapabilities({ id: 'alias', parameters: { reasoning_effort: { enum: ['none', 'low', 'x-high', 'unknown'] } } });
  assert.deepEqual(alias.thinkingLevels, ['off', 'low', 'xhigh']);
  assert.equal(alias.thinkingLevelMap.off, 'none'); assert.equal(alias.thinkingLevelMap.xhigh, 'x-high');
  const mapped = detectModelCapabilities({ id: 'map', thinking_level_map: { off: null, minimal: null, low: 'basic', medium: null, high: 'advanced', xhigh: 'extreme', max: null } });
  assert.deepEqual(mapped.thinkingLevels, ['low', 'high', 'xhigh']);
  assert.deepEqual(detectModelCapabilities({ id: 'sparse-map', thinkingLevelMap: { low: 'basic', high: 'advanced' } }).thinkingLevels, ['low', 'high']);
  const metadataWins = detectModelCapabilities({ id: 'deepseek-v4-flash', thinkingLevels: ['low', 'high'], thinkingLevelMap: { high: null } });
  assert.deepEqual(metadataWins.thinkingLevels, ['low']); assert.equal(metadataWins.thinkingLevelsSource, 'metadata');
  assert.throws(() => sanitizeCustomProvider({ ...customInput(), models: [{ id: 'a', reasoning: true, thinkingLevels: [] }] }), /至少选择/);
  assert.throws(() => sanitizeCustomProvider({ ...customInput(), models: [{ id: 'a', reasoning: true, thinkingLevels: ['high'], thinkingLevelMap: { high: null } }] }), /全部不可用/);
});
test('目录补齐和未知兼容档位只在运行时生成，旧配置不补写能力字段', () => {
  const legacy = sanitizeCustomProvider({ ...customInput(), models: [{ id: 'a', reasoning: true }, { id: 'deepseek-v4-flash', reasoning: true }, { id: 'disabled', reasoning: false, thinkingLevels: ['high'] }] });
  assert.equal('thinkingLevels' in legacy.models[0], false); assert.equal('thinkingLevels' in legacy.models[1], false);
  const [unknown, catalog, disabled] = customProviderRuntime(legacy).getModels();
  assert.equal(unknown.thinkingLevelsSource, 'fallback'); assert.deepEqual(getSupportedThinkingLevels(unknown), ['off', 'minimal', 'low', 'medium', 'high']);
  assert.equal(unknown.thinkingLevelMap, undefined);
  assert.equal(catalog.thinkingLevelsSource, 'official_docs'); assert.deepEqual(getSupportedThinkingLevels(catalog), ['off', 'low', 'high', 'max']);
  assert.equal(catalog.compat.thinkingFormat, 'deepseek'); assert.deepEqual(getSupportedThinkingLevels(disabled), ['off']);
});
test('旧自动目录随官方能力更新，人工和接口否定保持，读取不改写配置', () => isolated(async service => {
  const stored = source => ({ id: 'deepseek-v4-flash', reasoning: true, imageInput: false, contextWindow: 1048576, maxTokens: 393216, thinkingLevels: ['off', 'high', 'max'], thinkingLevelsSource: source, capabilityDetection: { imageInput: source, reasoning: source } });
  for (const source of ['pi_catalog', 'manual', 'metadata']) {
    const provider = { ...customInput(), models: [stored(source)] };
    service.customProviders.set(provider.id, provider);
    const snapshot = JSON.stringify(provider);
    const shown = service.listCustomProviders()[0].models[0];
    const runtime = customProviderRuntime(provider).getModels()[0];
    assert.equal(shown.imageInput, source === 'pi_catalog');
    assert.deepEqual(runtime.input, source === 'pi_catalog' ? ['text', 'image'] : ['text']);
    assert.deepEqual(shown.thinkingLevels, source === 'pi_catalog' ? ['off', 'low', 'high', 'max'] : ['off', 'high', 'max']);
    assert.equal(JSON.stringify(provider), snapshot);
  }
}));

test('思考能力保存后重载保持，切换模型与非法旧档位按当前能力归一化', () => isolated(async service => {
  await service.init();
  const model = detectModelCapabilities({ id: 'a', thinkingLevels: ['low', 'high', 'xhigh'] });
  await service.saveCustomProvider({ ...customInput(), models: [model, { id: 'b', reasoning: false }], select: true });
  const before = await readFile(service.configFilePath(), 'utf8');
  const restored = new PromptAgentService({ lanSecret: 'synthetic', configFile: service.isolatedRoot }); await restored.init();
  assert.equal(await readFile(service.configFilePath(), 'utf8'), before);
  assert.deepEqual(restored.listAvailableModels()[0].thinkingLevels, ['low', 'high', 'xhigh']);
  const session = await restored.createSession({ thinkingLevel: 'xhigh', creativeMode: false }); assert.equal(session.thinkingLevel, 'xhigh');
  assert.equal((await restored.updateSession(session.id, { thinkingLevel: 'max' })).thinkingLevel, 'low');
  assert.equal((await restored.updateSession(session.id, { model: 'b' })).thinkingLevel, 'off');
}));
test('设置和聊天读取同一能力，未知模型的兼容展示不会改写旧关闭请求', () => isolated(async service => {
  await service.saveCustomProvider({ ...customInput(), models: [{ id: 'a', reasoning: true }, { id: 'deepseek-v4-flash', reasoning: true }], select: true });
  const shown = service.listCustomProviders()[0];
  assert.deepEqual(shown.models.map(model => model.thinkingLevels), service.listAvailableModels().map(model => model.thinkingLevels));
  assert.equal(shown.models[0].thinkingLevelsSource, 'fallback'); assert.equal(shown.models[1].thinkingLevelsSource, 'official_docs');
  const saved = sanitizeCustomProvider(shown);
  assert.equal('thinkingLevels' in saved.models[0], false);
  assert.equal(customProviderRuntime(saved).getModels()[0].thinkingLevelMap, undefined);
  assert.deepEqual(getSupportedThinkingLevels(customProviderRuntime(saved).getModels()[1]), ['off', 'low', 'high', 'max']);
  await service.saveCustomProvider({ ...customInput(), models: [{ id: 'a', reasoning: false, thinkingLevels: ['high'], thinkingLevelsSource: 'manual' }, { id: 'b', reasoning: false, thinkingLevels: [], thinkingLevelMap: createAgentThinkingMap([]) }] });
  const disabled = service.listCustomProviders()[0];
  assert.deepEqual(service.listAvailableModels()[0].thinkingLevels, ['off']);
  assert.deepEqual(disabled.models[0].thinkingLevels, ['high']);
  assert.deepEqual(sanitizeCustomProvider(disabled).models[0].thinkingLevels, ['high']);
  assert.equal('thinkingLevelMap' in service.config.customProviders[0].models[1], false);
}));
test('实际 Chat 请求使用保存的思考映射，关闭档位发送接口声明的 none', () => isolated(async service => {
  const model = detectModelCapabilities({ id: 'a', thinkingLevels: ['off', 'low', 'high', 'xhigh'], thinkingLevelMap: { xhigh: 'extreme' } });
  await service.saveCustomProvider({ ...customInput(), models: [model], select: true });
  const session = await service.createSession({ thinkingLevel: 'xhigh', creativeMode: false });
  const previous = globalThis.fetch, requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const chunk = { id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'a', choices: [{ index: 0, delta: { role: 'assistant', content: '合成完成' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
    return new Response('data: ' + JSON.stringify(chunk) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    await service.run({ sessionId: session.id, message: '你好', draft: { params: {} } }, () => {});
    assert.equal(requests[0].reasoning_effort, 'extreme'); assert.equal((await service.getTask(session.id)).status, 'completed');
    await service.updateSession(session.id, { thinkingLevel: 'off' });
    await service.run({ sessionId: session.id, message: '继续', draft: { params: {} } }, () => {});
    assert.equal(requests[1].reasoning_effort, 'none'); assert.equal((await service.getTask(session.id)).status, 'completed');
  } finally { globalThis.fetch = previous; }
}));
test('Responses 与 Anthropic 真实适配器构造请求时沿用思考映射，联网前截获', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('测试禁止联网'); };
  try {
    for (const api of ['openai-responses', 'anthropic-messages']) {
      const detected = detectModelCapabilities({ id: 'synthetic', supported_reasoning_efforts: ['low', 'high', 'xhigh'], thinkingLevelMap: { xhigh: 'extreme' } });
      const provider = sanitizeCustomProvider({ ...customInput(), api, models: [detected] });
      const credentials = new InMemoryCredentialStore(); await credentials.modify(provider.id, async () => ({ type: 'api_key', key: 'synthetic' }));
      const runtime = createPromptAgentModelRuntime(credentials, [provider]); const model = runtime.getModel(provider.id, detected.id);
      let payload;
      const stream = runtime.streamSimple(model, { messages: [{ role: 'user', content: '合成请求', timestamp: 1 }] }, { reasoning: 'xhigh', onPayload: value => { payload = value; throw new Error('合成测试在发送前结束'); } });
      for await (const _event of stream) { /* 消费适配器结束事件，不发出实际请求。 */ }
      assert.ok(payload);
      if (api === 'openai-responses') assert.equal(payload.reasoning.effort, 'extreme');
      else { assert.equal(payload.thinking.type, 'adaptive'); assert.equal(payload.output_config.effort, 'extreme'); }
    }
  } finally { globalThis.fetch = previous; }
});

test('权限档位持久化、旧配置默认标准，非法档位和失败写入不发布', () => isolated(async service => {
  assert.equal(service.publicConfig().permissionMode, 'standard');
  await service.setPermissionMode('full');
  assert.equal(JSON.parse(await readFile(service.configFilePath(), 'utf8')).permissionMode, 'full');
  const restored = new PromptAgentService({ lanSecret: 'synthetic', configFile: service.isolatedRoot }); await restored.init();
  assert.equal(restored.publicConfig().permissionMode, 'full');
  service.setCredential('deepseek', { type: 'api_key', key: 'synthetic-recovery-key' });
  const snapshot = structuredClone(service.config);
  await writeFile(service.configFilePath(), JSON.stringify({ encryptedKeys: {}, permissionMode: 'read_only' }));
  await service.setPermissionMode('full');
  assert.deepEqual(JSON.parse(await readFile(service.configFilePath(), 'utf8')), snapshot);
  await assert.rejects(service.setPermissionMode('unknown'), /无效/);
  service.activeAgents.set('running', {}); await assert.rejects(service.setPermissionMode('read_only'), /先停止/); service.activeAgents.clear();
  service.configFileOverride = join(service.isolatedRoot, 'blocked', 'config.json'); await writeFile(join(service.isolatedRoot, 'blocked'), 'synthetic');
  await assert.rejects(service.setPermissionMode('read_only'));
  assert.equal(service.publicConfig().permissionMode, 'full');
}));
test('会话落盘与历史接口不保存或返回费用，仅保留 Token 和旧视觉计数', () => isolated(async service => {
  const usage = { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { total: 99 } };
  const message = { role: 'assistant', content: [{ type: 'text', text: '合成回复' }], usage, timestamp: 1, visionUsage: [{ model: 'legacy', imageCount: 1, usage }] };
  await service.saveMessages('s', [message]);
  const stored = await service.readSession('s');
  assert.equal(stored.messages[0].usage.totalTokens, 12); assert.equal(JSON.stringify(stored.messages).includes('"cost"'), false);
  const history = await service.getSessionHistory('s'); assert.equal(history[0].usage.totalTokens, 12); assert.equal(history[0].visionUsage[0].imageCount, 1);
  assert.equal(JSON.stringify(history).includes('"cost"'), false); assert.equal(message.usage.cost.total, 99);
}));

test('只读在工具执行层阻止整个修改集合，完全访问创建图片目录不弹确认', () => isolated(async service => {
  await service.setPermissionMode('read_only'); const events = [], requests = [];
  const tools = service.createTools({ params: {} }, {}, event => events.push(event), { agentSessionId: 's', requestJson: async path => { requests.push(path); return {}; } }, {});
  const readTool = name => /^(get_|list_|search_|read_|inspect_|show_)/.test(name) || ['enable_tool_group', 'navigate_view'].includes(name);
  const mutations = tools.filter(tool => !readTool(tool.name)); assert.ok(mutations.length > 20);
  for (const tool of mutations) await assert.rejects(tool.execute('t', {}), /只读/);
  assert.equal(requests.length, 0); assert.equal(events.length, 0);
  const caps = JSON.parse((await tools.find(tool => tool.name === 'get_agent_capabilities').execute('t', {})).content[0].text);
  assert.equal(caps.permissionMode, 'read_only'); assert.equal(caps.localImages.timedExpiry, false);
  await service.setPermissionMode('full');
  const directory = join(service.isolatedRoot, 'automatic', 'images');
  await tools.find(tool => tool.name === 'request_local_image_folder_access').execute('t', { directory, access: 'write', create: true });
  assert.equal(events.length, 0); assert.equal(await service.localImages.folder(directory), directory);
}));
test('附件不静默截断或忽略，服务器和前端共享 4 张／6 MB 边界', () => {
  const image = { data: 'YWJjZA==', mimeType: 'image/png' };
  assert.equal(sanitizeAgentImages([image]).length, 1);
  assert.throws(() => sanitizeAgentImages(Array(5).fill(image)), /4 张/);
  assert.throws(() => sanitizeAgentImages([{ ...image, data: 'invalid base64' }]), /格式/);
  assert.throws(() => sanitizeAgentImages([{ ...image, data: Buffer.alloc(6 * 1024 * 1024 + 1).toString('base64') }]), /6 MB/);
});
test('空 Key 任务也绑定 Key 状态，确认期间新增 Key 不能沿用旧批准', () => isolated(async service => {
  service.runs.set('s', { state: { runId: 'r' }, keyHash: '', controller: new AbortController() });
  service.activeAgents.set('s', { agent: {}, emit() {} });
  const { requestId, promise } = service.createConfirmation('s', { action: 'set_anlas_budget', resourceId: '', payload: { remaining: 20 } });
  assert.throws(() => service.controlSession('s', 'confirm', '', { requestId, accepted: true, keyHash: 'new-key-hash' }), /Key 已变化/);
  assert.equal((await promise).accepted, false);
}));
test('连接测试反复调用工具时最多两次模型回复，结果只包含 Token 不包含费用', () => isolated(async service => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    const chunk = { id: 'probe', object: 'chat.completion.chunk', created: 1, model: 'a', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `tool-${calls}`, type: 'function', function: { name: 'capability_probe', arguments: '{"status":"ok"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
    return new Response('data: ' + JSON.stringify(chunk) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const result = await service.testCustomProvider({ ...customInput(), apiKey: 'synthetic', testModel: 'a' });
    assert.equal(calls, 2); assert.equal(result.checks.tools, 'passed');
    assert.ok(result.usage.every(usage => !('cost' in usage)));
  } finally { globalThis.fetch = previous; }
}));

test('预算提升和关闭队列等待确认，重复创建使用稳定操作 ID', () => isolated(async service => {
  service.activeAgents.set('s', { agent: {}, emit() {} });
  const events = [], requests = [];
  const project = { agentSessionId: 's', agentOperationScope: 's/1', requestJson: async (path, options) => { requests.push({ path, options }); return path === '/api/anlas-budget' ? { remaining: 10 } : { id: options?.body.id }; }, getQueuePreferences: () => ({ enabled: true }), setQueuePreferences: async () => { throw new Error('不能直接关闭'); } };
  const tools = service.createTools({ params: {}, modules: [] }, {}, event => events.push(event), project, {});
  assert.equal(tools.some(tool => tool.name === 'save_artist_profile'), false);
  assert.equal(tools.find(tool => tool.name === 'manage_aitag').parameters.properties.action.anyOf.some(value => value.const === 'index'), false);
  for (const [name, args] of [['set_anlas_budget', { remaining: 20 }], ['set_cloud_queue', { enabled: false }]]) {
    const pending = tools.find(tool => tool.name === name).execute('t', args);
    await new Promise(resolve => setImmediate(resolve));
    const requestId = events.at(-1).action.patch.requestId;
    service.controlSession('s', 'confirm', '', { requestId, accepted: false });
    await assert.rejects(pending, /取消/);
  }
  assert.equal(requests.some(request => request.options?.method === 'PUT'), false);
  const create = tools.find(tool => tool.name === 'create_chain');
  await create.execute('a', { type: 'style', name: 'synthetic' });
  await create.execute('b', { name: 'synthetic', type: 'style' });
  const bodies = requests.filter(request => request.options?.method === 'POST').map(request => request.options.body);
  assert.equal(bodies[0].id, bodies[1].id);
}));
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
test('并发配置写入合并且模型配置不保留价格', () => isolated(async service => {
  await Promise.all([service.saveCustomProvider(customInput('custom-synthetic-a')), service.saveCustomProvider(customInput('custom-synthetic-b'))]);
  assert.equal(service.listCustomProviders().length, 2);
  assert.equal(service.listCustomProviders()[0].models[0].cost, undefined);
}));
test('手填模型功能测试不请求 models，视觉用途不要求工具', () => isolated(async service => {
  const previous = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return new Response(JSON.stringify({ error: { message: 'synthetic rejection' } }), { status: 401, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await service.testCustomProvider({ ...customInput(), apiKey: 'synthetic' });
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
test('上下文取真实模型窗口，完整 schema 入账，超限不发送', () => {
  for (const contextWindow of [8192, 32768, 128000, 1000000]) {
    const assembled = assemblePromptContext({ model: { contextWindow, maxTokens: 32000 }, systemPolicy: 'rules', cleanMessages: [{ role: 'user', content: 'hello' }], toolDescriptors: [{ name: 'test', parameters: { description: 'schema '.repeat(100) } }] });
    assert.equal(assembled.budget.contextWindow, contextWindow);
    assert.ok(assembled.budget.outputReserve <= 8192);
    assert.ok(assembled.tokenEstimate.totalTokens > estimateContextTokens('rules'));
  }
  assert.throws(() => assemblePromptContext({ model: { contextWindow: 8192 }, systemPolicy: 'a'.repeat(50000) }), /超过/);
  assert.ok(estimateContextTokens([{ type: 'image', data: 'a'.repeat(1000000) }]) < 5000);
});
test('工具按任务范围提供，保留核心创作和按需知识', () => isolated(async service => {
  const tools = service.createTools({ params: {} }, {}, () => {});
  const names = selectAgentTools(tools, '修改提示词').map(tool => tool.name);
  assert.ok(names.includes('read_prompt_guidelines'));
  assert.ok(!names.includes('request_clear_history'));
  assert.ok(selectAgentTools(tools, '清理历史').some(tool => tool.name === 'request_clear_history'));
}));
test('真实流适配器遵守输出预算，并持久化唯一终态与目标草稿', () => isolated(async service => {
  await service.saveCustomProvider({ ...customInput(), models: [{ id: 'a', contextWindow: 32768, maxTokens: 32000 }], apiKey: 'synthetic', select: true });
  const session = await service.createSession({ creativeMode: false });
  const previous = globalThis.fetch;
  const requests = [], events = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const chunk = { id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'a', choices: [{ index: 0, delta: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
    return new Response('data: ' + JSON.stringify(chunk) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    await service.run({ sessionId: session.id, message: 'hello', draft: { target: { chainId: 'c', mode: 'text-to-image', fingerprint: 'f' }, params: {} } }, event => events.push(event));
    assert.equal(events.filter(event => event.type === 'done').length, 1);
    assert.ok(requests[0].max_tokens <= 8192 || requests[0].max_completion_tokens <= 8192);
    const task = await service.getTask(session.id);
    assert.equal(task.status, 'completed');
    assert.equal(task.finalDraft.target.chainId, 'c');
    assert.equal(task.events.at(-1).type, 'done');
  } finally { globalThis.fetch = previous; }
}));

test('附件只调用当前模型，旧视觉配置不能为纯文本模型代发', () => isolated(async service => {
  await service.saveCustomProvider({ ...customInput(), apiKey: 'synthetic', models: [{ id: 'a', imageInput: true }, { id: 'b', imageInput: false }], select: true });
  service.config.visionProvider = 'unused'; service.config.visionModel = 'unused';
  const previous = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    const chunk = { id: 'img', object: 'chat.completion.chunk', created: 1, model: 'a', choices: [{ index: 0, delta: { role: 'assistant', content: '看到了' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
    return new Response('data: ' + JSON.stringify(chunk) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const session = await service.createSession({ creativeMode: false });
    await service.run({ sessionId: session.id, message: '看看图片', images: [{ data: 'YWJjZA==', mimeType: 'image/png' }], draft: { params: {} } }, () => {});
    assert.equal(requests.length, 1); assert.equal(requests[0].body.model, 'a');
    assert.match(JSON.stringify(requests[0].body.messages), /data:image\/png;base64,YWJjZA==/);
    await service.updateSession(session.id, { model: 'b' });
    await assert.rejects(() => service.run({ sessionId: session.id, message: '看看', images: [{ data: 'YWJjZA==', mimeType: 'image/png' }], draft: { params: {} } }, () => {}), /不会调用其他模型/);
    assert.equal(requests.length, 1);
  } finally { globalThis.fetch = previous; }
}));

test('能力与时区查询、文字模型展示、长字段分段读取都有真实回执', () => isolated(async service => {
  const project = { requestJson: async () => ({ id: 'a', prompt: '原文'.repeat(10000), title: '作品' }) };
  const tools = service.createTools({ params: {} }, { clientSettings: { timeZone: 'Asia/Shanghai' } }, () => {}, project, { imageInput: false });
  const call = async (name, args = {}) => (await tools.find(tool => tool.name === name).execute('t', args));
  const time = JSON.parse((await call('get_local_time')).content[0].text); assert.equal(time.client.timeZone, 'Asia/Shanghai'); assert.ok(time.computer.utcTime);
  const caps = JSON.parse((await call('get_agent_capabilities')).content[0].text); assert.equal(caps.localImages.available, true); assert.equal(caps.model.separateVisionModel, false);
  const display = JSON.parse((await call('show_project_image', { kind: 'history', id: 'a' })).content[0].text);
  assert.equal(display.displayImages[0].path, '/api/local-history/a/image'); assert.equal(display.modelHasSeenImage, false);
  await assert.rejects(call('inspect_project_image', { kind: 'history', id: 'a' }), /当前模型不支持/);
  const field = JSON.parse((await call('read_project_text', { kind: 'history', id: 'a', field: 'prompt', offset: 3500 })).content[0].text);
  assert.equal(field.offset, 3500); assert.equal(field.nextOffset, 7000); assert.equal(field.totalChars, 20000); assert.equal(field.text, '原文'.repeat(10000).slice(3500, 7000));
}));

test('最近三张图均可展示，外部索引沿用真实图片路径；展示不要求识图', () => isolated(async service => {
  const path = `/api/integrations/st-chatu8/history/${'a'.repeat(64)}/image`;
  const items = ['a', 'b', 'c'].map(id => ({ id, imageUrl: id === 'c' ? path : `/api/local-history/${id}/image` }));
  const project = { requestJson: async url => url.includes('?') ? { items } : { item: items.find(item => url.endsWith('/' + item.id)) }, requestBuffer: async url => { assert.equal(url, path); return { buffer: Buffer.from('image'), mimeType: 'image/png' }; } };
  const tools = service.createTools({ params: {} }, {}, () => {}, project, { imageInput: false });
  const history = JSON.parse((await tools.find(tool => tool.name === 'list_generation_history').execute('t', { limit: 3 })).content[0].text);
  const shown = [];
  for (const item of history) shown.push(JSON.parse((await tools.find(tool => tool.name === 'show_project_image').execute('t', { kind: 'history', id: item.id })).content[0].text));
  assert.equal(shown.length, 3); assert.ok(shown.every(item => item.shown && item.modelHasSeenImage === false));
  assert.equal(shown[2].displayImages[0].path, path);
  const vision = service.createTools({ params: {} }, {}, () => {}, project, { imageInput: true });
  const inspected = await vision.find(tool => tool.name === 'inspect_generation_image').execute('t', { id: 'c' });
  assert.equal(JSON.parse(inspected.content[0].text).displayImages[0].path, path);
  assert.equal(inspected.content[1].type, 'image');
}));
test('目录确认绑定真实路径，保存工具落盘后才返回成功', () => isolated(async service => {
  const directory = join(service.isolatedRoot, 'images'); await mkdir(directory);
  service.runs.set('s', { state: { runId: 'r' }, keyHash: 'key', controller: new AbortController() });
  service.activeAgents.set('s', { agent: {}, emit() {} });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCX0AAAAASUVORK5CYII=', 'base64');
  const events = []; const project = { agentSessionId: 's', keyHash: 'key', requestJson: async () => ({ id: 'a' }), requestBuffer: async () => ({ buffer: png, mimeType: 'image/png' }) };
  const tools = service.createTools({ params: {} }, {}, event => events.push(event), project, {});
  const access = tools.find(tool => tool.name === 'request_local_image_folder_access');
  const waiting = access.execute('t', { directory, access: 'write' }); await new Promise(resolve => setTimeout(resolve, 10));
  const patch = events[0].action.patch;
  assert.equal(patch.payload.directory, directory); assert.match(patch.consequence, /不覆盖/);
  service.controlSession('s', 'confirm', '', { requestId: patch.requestId, accepted: true, keyHash: 'key' });
  await assert.rejects(service.executeConfirmedProjectAction({ sessionId: 's', confirmationRequestId: patch.requestId, action: patch.action, payload: { ...patch.payload, directory: service.isolatedRoot } }, project), /不匹配/);
  await service.executeConfirmedProjectAction({ sessionId: 's', confirmationRequestId: patch.requestId, action: patch.action, payload: patch.payload }, project); await waiting;
  const result = await tools.find(tool => tool.name === 'save_project_image_to_folder').execute('t', { kind: 'history', id: 'a', directory, filename: 'saved.png' });
  const receipt = JSON.parse(result.content[0].text); assert.equal(receipt.saved, true); assert.deepEqual(await readFile(receipt.path), png);
  await service.localImages.grant({ sessionId: 's', keyHash: 'key' }, directory, 'read');
  const shown = await tools.find(tool => tool.name === 'show_local_image').execute('t', { path: receipt.path });
  assert.equal(JSON.parse(shown.content[0].text).displayImages[0].kind, 'local');
  await writeFile(join(directory, 'fake.png'), 'invalid');
  await assert.rejects(tools.find(tool => tool.name === 'show_local_image').execute('t', { path: join(directory, 'fake.png') }), /内容不是/);
}));

test('直接保存自动完成目录确认，完全访问可一步创建目录并保存原图', () => isolated(async service => {
  const directory = join(service.isolatedRoot, 'new', 'images'); const events = [];
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCX0AAAAASUVORK5CYII=', 'base64');
  const project = { agentSessionId: 's', requestJson: async () => ({ id: 'a' }), requestBuffer: async () => ({ buffer: png }) };
  service.activeAgents.set('s', { agent: {}, emit() {} });
  const tools = service.createTools({ params: {} }, {}, event => events.push(event), project, {});
  const save = tools.find(tool => tool.name === 'save_project_image_to_folder');
  const writing = save.execute('t', { kind: 'history', id: 'a', directory, filename: 'standard.png' });
  while (!events.length) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(readFile(join(directory, 'standard.png')), { code: 'ENOENT' });
  const patch = events[0].action.patch; assert.equal(patch.payload.create, true);
  service.controlSession('s', 'confirm', '', { requestId: patch.requestId, accepted: true });
  await service.executeConfirmedProjectAction({ sessionId: 's', confirmationRequestId: patch.requestId, action: patch.action, payload: patch.payload }, project);
  assert.equal(JSON.parse((await writing).content[0].text).saved, true); assert.deepEqual(await readFile(join(directory, 'standard.png')), png);
  service.activeAgents.clear(); await service.setPermissionMode('full');
  const second = join(service.isolatedRoot, 'automatic', 'images');
  const result = await save.execute('t2', { kind: 'history', id: 'a', directory: second, filename: 'full.png' });
  assert.equal(events.length, 1); assert.equal(JSON.parse(result.content[0].text).path, join(second, 'full.png')); assert.deepEqual(await readFile(join(second, 'full.png')), png);
}));
test('真实 Pi 工具循环可以动态加载工具，日志只记录完整事件摘要', () => isolated(async service => {
  await service.saveCustomProvider({ ...customInput(), apiKey: 'synthetic', select: true });
  const session = await service.createSession({ creativeMode: false }); const previous = globalThis.fetch;
  const requests = [], audits = []; service.appendAuditLog = async (_session, entry) => { audits.push(entry); };
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body)); const step = requests.length;
    const delta = step === 1 ? { role: 'assistant', tool_calls: [{ index: 0, id: 'load', type: 'function', function: { name: 'enable_tool_group', arguments: '{"groups":["library"]}' } }] }
      : step === 2 ? { role: 'assistant', tool_calls: [{ index: 0, id: 'history', type: 'function', function: { name: 'list_generation_history', arguments: '{}' } }] }
      : { role: 'assistant', content: '完成' };
    const chunk = { id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'a', choices: [{ index: 0, delta, finish_reason: step < 3 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
    return new Response('data: ' + JSON.stringify(chunk) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  let reads = 0;
  try {
    await service.run({ sessionId: session.id, message: '你好', draft: { params: {} } }, () => {}, undefined, { requestJson: async () => { reads++; return { items: [{ id: 'a', params: { prompt: 'x'.repeat(400000) } }] }; } });
    assert.equal(requests.length, 3); assert.equal(reads, 1);
    assert.equal(requests[0].tools.some(tool => tool.function.name === 'list_generation_history'), false);
    assert.equal(requests[1].tools.some(tool => tool.function.name === 'list_generation_history'), true);
    assert.equal(audits.filter(entry => entry.type === 'model_response').length, 3);
    assert.equal(audits.filter(entry => entry.type === 'tool_completed').length, 2);
    assert.equal(JSON.stringify(audits).includes('"cost"'), false);
    assert.equal(JSON.stringify((await service.readSession(session.id)).messages).includes('"cost"'), false);
    assert.equal(JSON.stringify(await service.getTask(session.id)).includes('"cost"'), false);
    assert.equal(audits.some(entry => entry.type === 'agent_event' && entry.eventType === 'text_delta'), false);
    assert.ok(JSON.stringify(requests[2]).length < 100000);
  } finally { globalThis.fetch = previous; }
}));
