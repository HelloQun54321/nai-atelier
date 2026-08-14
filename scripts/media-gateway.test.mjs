import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VibeEncodingMemoryCache,
  buildCachedVibeReferences,
  buildPreciseReferenceParameters,
  clearPreciseReferenceParameters,
  createThumbnailPreWarmer,
  generateWithVibeCacheRetry,
  getVibeCacheSecretKey,
  classifyAitagRemoteTarget,
  classifyDanbooruRemoteTarget,
  estimateNovelAiGenerationCost,
  normalizeVibeStrengths,
  parseInvalidVibeCacheKeys,
  requestRemoteBuffer,
  selectPreciseReferenceCanvas,
  CloudQueueCoordinator,
  fetchNovelAiGeneration,
  getValidatedSource,
  isPixivConnectionMutationAllowed,
  selectThumbnailConcurrency,
} from './media-gateway.mjs';
import { PromptAgentService, calculateAgentContextBudget, customProviderRuntime, detectModelCapabilities, estimateContextTokens, parseTranslationResponse, parseWebSearchResponse, sanitizeCustomProvider, trimContextMessages, validatePublicWebUrl } from './prompt-agent.mjs';
import { readImageDimensions } from '../worker/imageDimensions.mjs';

test('prompt agent discovers model capabilities from metadata, Pi catalog and conservative names', () => {
  const metadata = detectModelCapabilities({ id: 'vendor/model-x', display_name: 'Model X', input_modalities: ['text', 'image'], capabilities: { reasoning: true }, context_window: 262144, max_output_tokens: 32768 });
  assert.deepEqual({ imageInput: metadata.imageInput, reasoning: metadata.reasoning, contextWindow: metadata.contextWindow, maxTokens: metadata.maxTokens }, { imageInput: true, reasoning: true, contextWindow: 262144, maxTokens: 32768 });
  assert.deepEqual(metadata.capabilityDetection, { imageInput: 'metadata', reasoning: 'metadata' });
  const catalog = detectModelCapabilities('gemini-2.5-flash');
  assert.equal(catalog.imageInput, true);
  assert.equal(catalog.reasoning, true);
  assert.equal(catalog.capabilityDetection.imageInput, 'pi_catalog');
  const named = detectModelCapabilities('lab/deepseek-r1-vision');
  assert.equal(named.imageInput, true);
  assert.equal(named.reasoning, true);
  const unknown = detectModelCapabilities('lab/plain-custom-model');
  assert.equal(unknown.imageInput, false);
  assert.equal(unknown.reasoning, false);
  assert.equal(detectModelCapabilities({ name: 'Display label only' }), null);
  const clamped = detectModelCapabilities({ id: 'tiny', context_window: 2048, max_output_tokens: 999999 });
  assert.equal(clamped.maxTokens, 2048);
});

test('prompt agent automatically gives a text-only main model a configured vision model', () => {
  const sameProviderService = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  sameProviderService.setCredential('openai', { type: 'api_key', key: 'openai-key' });
  sameProviderService.setCredential('google', { type: 'api_key', key: 'google-key' });
  sameProviderService.config.provider = 'openai';
  sameProviderService.config.model = 'gpt-4';
  sameProviderService.config.visionMode = 'auto';
  const sameProviderVision = sameProviderService.syncAutomaticVisionSelection('openai', 'gpt-4');
  assert.equal(sameProviderVision.provider, 'openai');
  assert.equal(sameProviderVision.model, 'gpt-5-mini');

  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  service.setCredential('deepseek', { type: 'api_key', key: 'deepseek-key' });
  service.setCredential('google', { type: 'api_key', key: 'google-key' });
  service.config.provider = 'deepseek';
  service.config.model = 'deepseek-v4-flash';
  service.config.visionMode = 'auto';
  const vision = service.syncAutomaticVisionSelection('deepseek', 'deepseek-v4-flash');
  assert.equal(vision.provider, 'google');
  assert.equal(vision.info.imageInput, true);
  assert.equal(service.publicConfig().visionDedicated, true);
  assert.equal(service.publicConfig().visionMode, 'auto');

  service.config.visionMode = 'manual';
  service.config.visionProvider = 'missing-provider';
  service.config.visionModel = 'missing-model';
  service.syncAutomaticVisionSelection('deepseek', 'deepseek-v4-flash');
  assert.equal(service.config.visionMode, 'auto');
  assert.equal(service.config.visionProvider, 'google');

  const sessionMeta = service.publicSessionMeta({ id: 'session', provider: 'deepseek', model: 'deepseek-v4-flash' });
  assert.equal(sessionMeta.visionProvider, 'google');
  assert.equal(sessionMeta.visionDedicated, true);
});

test('prompt agent parses web results and blocks private web targets', async () => {
  const html = '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=x"><b>Example</b> docs</a><a class="result__snippet">Current documentation &amp; examples.</a></div>';
  assert.deepEqual(parseWebSearchResponse(html), [{ title: 'Example docs', url: 'https://example.com/docs', snippet: 'Current documentation & examples.' }]);
  const publicUrl = await validatePublicWebUrl('https://example.com/page#part', async () => [{ address: '93.184.216.34', family: 4 }]);
  assert.equal(publicUrl.toString(), 'https://example.com/page');
  assert.equal((await validatePublicWebUrl('https://example.com/proxied', async () => [{ address: '198.18.0.53', family: 4 }])).hostname, 'example.com');
  await assert.rejects(() => validatePublicWebUrl('https://198.18.0.53/page'), /保留网段/);
  await assert.rejects(() => validatePublicWebUrl('https://router.local/page', async () => [{ address: '192.168.1.1', family: 4 }]), /局域网/);
  await assert.rejects(() => validatePublicWebUrl('https://example.com:8443/page', async () => [{ address: '93.184.216.34', family: 4 }]), /自定义端口/);
  const tools = new PromptAgentService({ lanSecret: 'test-lan-secret' }).createTools({}, {}, () => {});
  assert.ok(tools.some(tool => tool.name === 'web_search'));
  assert.ok(tools.some(tool => tool.name === 'read_web_page'));
});

test('tag translation responses accept only requested tags and cached translations remain local', () => {
  const allowed = new Set(['custom phrase', 'artist name']);
  const parsed = parseTranslationResponse('```json\n[{"tag":"custom_phrase","chinese":"自定义短语"},{"tag":"unknown","chinese":"未知"},{"tag":"artist name","chinese":"画师名"}]\n```', allowed);
  assert.deepEqual([...parsed], [['custom phrase', '自定义短语'], ['artist name', '画师名']]);
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  service.tagTranslations = { 'custom phrase': { chinese: '自定义短语', updatedAt: 123 } };
  assert.deepEqual(service.lookupTagTranslations(['CUSTOM_phrase', 'missing']), [{ tag: 'custom phrase', chinese: '自定义短语', source: 'ai', updatedAt: 123 }]);
});

test('prompt agent custom providers use Pi runtime models and reject unsafe URLs', () => {
  const custom = sanitizeCustomProvider({
    id: 'custom-12345678', name: 'Local model', baseUrl: 'http://127.0.0.1:11434/v1/', api: 'openai-completions',
    headers: { 'HTTP-Referer': 'https://localhost.example' },
    models: [{ id: 'llama-local', reasoning: true, imageInput: true, contextWindow: 131072, maxTokens: 8192 }],
  });
  assert.equal(custom.baseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(custom.models[0].imageInput, true);
  const provider = customProviderRuntime(custom);
  assert.equal(provider.id, custom.id);
  assert.equal(provider.getModels()[0].api, 'openai-completions');
  assert.deepEqual(provider.getModels()[0].input, ['text', 'image']);
  assert.equal(provider.getModels()[0].headers['HTTP-Referer'], 'https://localhost.example');
  assert.throws(() => sanitizeCustomProvider({ name: 'bad', baseUrl: 'file:///secret', models: [{ id: 'x' }] }), /HTTP\/HTTPS/);
  assert.throws(() => sanitizeCustomProvider({ name: 'empty', baseUrl: 'https://example.com/v1', models: [] }), /至少添加一个模型/);
  assert.throws(() => sanitizeCustomProvider({ name: 'secret-header', baseUrl: 'https://example.com/v1', headers: { Authorization: 'secret' }, models: [{ id: 'x' }] }), /API Key/);
  assert.throws(() => sanitizeCustomProvider({ name: 'lan-http', baseUrl: 'http://192.168.1.8:8080/v1', models: [{ id: 'x' }] }), /HTTPS/);
  assert.throws(() => sanitizeCustomProvider({ name: 'public-http', baseUrl: 'http://example.com/v1', models: [{ id: 'x' }] }), /HTTPS/);
  const bounded = sanitizeCustomProvider({ name: 'bounded', baseUrl: 'https://example.com/v1', models: [{ id: 'x', contextWindow: 2048, maxTokens: 999999 }] });
  assert.equal(bounded.models[0].maxTokens, 2048);
});

test('prompt agent uses Pi-supported thinking levels and trims context at a real user boundary', () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  assert.equal(service.normalizeThinkingLevel('off', { reasoning: true }), 'off');
  assert.equal(service.normalizeThinkingLevel(undefined, { reasoning: true }), 'high');
  assert.equal(service.normalizeThinkingLevel(undefined, { thinkingLevels: ['off', 'high', 'max'] }), 'max');
  assert.equal(service.normalizeThinkingLevel('low', { thinkingLevels: ['off', 'high', 'max'] }), 'max');
  assert.deepEqual(service.getModels('deepseek').find(model => model.id === 'deepseek-v4-flash')?.thinkingLevels, ['off', 'high', 'max']);
  assert.ok(estimateContextTokens('中文上下文') >= 5);
  const messages = [
    { role: 'user', content: 'old request' },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'old-call', name: 'x', arguments: {} }] },
    { role: 'user', content: [{ type: 'toolResult', toolCallId: 'old-call', content: [{ type: 'text', text: 'old result' }] }] },
    { role: 'user', content: 'new request' },
    { role: 'assistant', content: 'new answer' },
  ];
  const trimmed = trimContextMessages(messages, estimateContextTokens(messages.at(-1)) + estimateContextTokens(messages.at(-2)) + 2);
  assert.equal(trimmed[0].content, 'new request');
  assert.equal(trimmed.some(message => JSON.stringify(message).includes('old-call')), false);
  const budget = calculateAgentContextBudget({ contextWindow: 4096, maxTokens: 2048 }, 'system'.repeat(100), []);
  assert.ok(budget.tokenBudget < 4096);
  assert.ok(budget.tokenBudget + budget.outputReserve + budget.systemTokens + budget.protocolReserve <= 4096);
  assert.throws(() => calculateAgentContextBudget({ contextWindow: 1024, maxTokens: 512 }, '系'.repeat(900), []), /上下文窗口/);
});

test('prompt agent locks a session creative mode after its first user message', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const session = await service.createSession({ creativeMode: false });
  try {
    const beforeStart = await service.updateSession(session.id, { creativeMode: true });
    assert.equal(beforeStart.creativeMode, true);
    await service.saveMessages(session.id, [{ role: 'user', content: 'first request' }]);
    await assert.rejects(() => service.updateSession(session.id, { creativeMode: false }), /对话已经开始/);
    await service.resetSession(session.id);
    await assert.rejects(() => service.updateSession(session.id, { creativeMode: false }), /对话已经开始/);
  } finally {
    await service.deleteSession(session.id);
  }
});

test('prompt agent titles a new session from the raw user input', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const session = await service.createSession({ creativeMode: true });
  try {
    await service.setInitialSessionTitle(session.id, '  给这个角色设计雨天的服装  ');
    const stored = await service.readSession(session.id);
    assert.equal(stored.meta.title, '给这个角色设计雨天的服装');
  } finally {
    await service.deleteSession(session.id);
  }
});

test('prompt agent preserves vision usage in history without feeding it back to the model', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const session = await service.createSession({ creativeMode: false });
  const firstMessages = [
    { role: 'user', content: 'inspect', timestamp: 1 },
    { role: 'assistant', content: 'done', timestamp: 2, provider: 'deepseek', model: 'deepseek-v4-flash', visionUsage: [{ provider: 'google', model: 'gemini-2.5-flash', imageCount: 1, usage: { totalTokens: 12, cost: { total: 0.001 } } }] },
  ];
  try {
    await service.saveMessages(session.id, firstMessages);
    const runtimeMessages = await service.loadMessages(session.id);
    assert.equal('visionUsage' in runtimeMessages[1], false);
    await service.saveMessages(session.id, [...runtimeMessages, { role: 'user', content: 'continue', timestamp: 3 }]);
    const history = await service.getSessionHistory(session.id);
    assert.equal(history.find(message => message.timestamp === 2).visionUsage[0].usage.totalTokens, 12);
  } finally {
    await service.deleteSession(session.id);
  }
});

test('prompt agent keeps API keys encrypted and out of its public config', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const encrypted = service.encrypt('private-llm-key');
  service.config.encryptedKeys.google = encrypted;
  assert.equal(service.decrypt(encrypted), 'private-llm-key');
  assert.equal(JSON.stringify(encrypted).includes('private-llm-key'), false);
  assert.equal(JSON.stringify(service.publicConfig()).includes('private-llm-key'), false);
  assert.deepEqual(service.publicConfig().configuredProviders, ['google']);
  assert.equal(service.publicConfig().configured, true);
  assert.equal(service.listProviders().find(provider => provider.id === 'google').configured, true);
  assert.equal(service.listProviders().some(provider => provider.id === 'deepseek'), true);
  assert.equal(service.listAvailableModels().every(model => model.provider === 'google'), true);
  assert.equal(service.listAvailableModels().some(model => model.id === 'gemini-2.5-flash'), true);
  const runtime = service.publicConfig();
  assert.match(runtime.policyVersion, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  assert.match(runtime.policyFingerprint, /^[a-f0-9]{12}$/);
  assert.ok(runtime.runtimeStartedAt <= Date.now());
  service.config.creativeMode = false;
  const standardRuntime = service.publicConfig();
  assert.equal(standardRuntime.creativeMode, false);
  assert.notEqual(standardRuntime.policyFingerprint, runtime.policyFingerprint);
  service.setCredential('deepseek', { type: 'api_key', key: 'deepseek-private' });
  assert.equal(service.getCredential('deepseek').key, 'deepseek-private');
  assert.equal(JSON.stringify(service.config.encryptedKeys.deepseek).includes('deepseek-private'), false);
  const loginStep = await service.loginProvider('deepseek', { answers: [] });
  assert.equal(loginStep.complete, false);
  assert.equal(loginStep.prompt.type, 'secret');
});

test('prompt agent exposes pi steering, follow-up, queue clearing and abort controls', () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const calls = [];
  const events = [];
  service.activeAgents.set('session', {
    emit: event => events.push(event),
    agent: {
      steer: message => calls.push(['steer', message]),
      followUp: message => calls.push(['followUp', message]),
      clearAllQueues: () => calls.push(['clear']),
      abort: () => calls.push(['abort']),
    },
  });
  service.controlSession('session', 'steer', 'change direction');
  service.controlSession('session', 'followUp', 'then summarize');
  service.controlSession('session', 'clear');
  service.controlSession('session', 'abort');
  assert.equal(calls[0][0], 'steer');
  assert.equal(calls[0][1].content, 'change direction');
  assert.equal(calls[1][0], 'followUp');
  assert.deepEqual(calls.slice(2), [['clear'], ['abort']]);
  assert.deepEqual(events.map(event => event.action), ['steer', 'followUp']);
});

test('prompt agent exports ordered local audit records and redacts secrets', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const sessionId = `audit-test-${Date.now()}`;
  await service.appendAuditLog(sessionId, { type: 'first_step', apiKey: 'must-not-export', image: { data: 'A'.repeat(2048) } });
  await service.appendAuditLog(sessionId, { type: 'second_step', value: 2 });
  const exported = await service.getAuditLog(sessionId);
  assert.equal(exported.schema, 'nai-prompt-agent-audit-export/v1');
  assert.deepEqual(exported.entries.map(entry => entry.type), ['first_step', 'second_step']);
  assert.equal(exported.entries[0].apiKey, '[redacted]');
  assert.match(exported.entries[0].image.data, /^\[image\/base64 omitted:/);
  await service.deleteSession(sessionId);
});

test('prompt agent Vibe tool accepts only known encodings and at most four slots', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const draft = { basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' } };
  const vibes = Array.from({ length: 5 }, (_, index) => ({ id: `v${index}`, name: `Vibe ${index}`, defaultStrength: 0.6, encodings: [{ id: `e${index}`, informationExtracted: 1 }] }));
  const actions = [];
  const tool = service.createTools(draft, { presets: [], vibes }, event => actions.push(event)).find(item => item.name === 'set_vibes');
  await tool.execute('call', { normalizeStrengths: true, slots: vibes.map((vibe, index) => ({ vibeId: vibe.id, encodingId: `e${index}`, informationExtracted: 1, strength: 0.6 })) });
  assert.equal(draft.params.vibes.slots.length, 4);
  assert.equal(actions.at(-1).action.kind, 'set_vibes');
});

test('prompt agent Character Reference tool accepts only project assets, limits four and disables Vibe', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const draft = {
    basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [],
    params: { vibes: { enabled: true, normalizeStrengths: true, slots: [{ vibeId: 'v1' }] } },
  };
  const known = new Map(Array.from({ length: 5 }, (_, index) => [`ref-${index}`, {
    id: `ref-${index}`, name: `Reference ${index}`, defaultStrength: 0.6, defaultFidelity: 0.7,
  }]));
  const project = {
    requestJson: async path => {
      const id = decodeURIComponent(path.split('/').at(-1));
      const item = known.get(id);
      if (!item) throw new Error('not found');
      return { item };
    },
  };
  const actions = [];
  const tool = service.createTools(draft, { presets: [], vibes: [] }, event => actions.push(event), project)
    .find(item => item.name === 'set_character_references');
  await tool.execute('call', { slots: [
    ...Array.from({ length: 5 }, (_, index) => ({ assetId: `ref-${index}`, type: 'character', strength: index === 0 ? -0.5 : 0.6, fidelity: index === 1 ? 1.5 : 0.7 })),
    { assetId: 'unknown', type: 'style', strength: 1, fidelity: 1 },
  ] });
  assert.equal(draft.params.characterReferences.slots.length, 4);
  assert.equal(draft.params.characterReferences.slots[0].strength, -0.5);
  assert.equal(draft.params.characterReferences.slots[1].fidelity, 1.5);
  assert.equal(draft.params.vibes.enabled, false);
  assert.equal(actions.at(-1).action.kind, 'set_character_references');
});

test('prompt agent Vibe selection disables Character Reference', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const draft = {
    basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [],
    params: { characterReferences: { enabled: true, slots: [{ assetId: 'ref-1' }] } },
  };
  const vibe = { id: 'v1', name: 'Vibe', defaultStrength: 0.6, encodings: [{ id: 'e1', informationExtracted: 1 }] };
  const tool = service.createTools(draft, { presets: [], vibes: [vibe] }, () => {}).find(item => item.name === 'set_vibes');
  await tool.execute('call', { slots: [{ vibeId: 'v1', encodingId: 'e1', informationExtracted: 1, strength: 0.6 }] });
  assert.equal(draft.params.vibes.enabled, true);
  assert.equal(draft.params.characterReferences.enabled, false);
});

test('prompt agent creates Character Reference only from a project history image', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const calls = [];
  const project = {
    requestJson: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/local-history/history-1') return { item: { id: 'history-1' } };
      if (path === '/api/character-references') return { item: { id: 'ref-1', name: options.body.name } };
      throw new Error(`unexpected ${path}`);
    },
    requestBuffer: async path => {
      assert.equal(path, '/api/local-history/history-1/image');
      return { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimeType: 'image/png' };
    },
  };
  const tool = service.createTools({ basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: {} }, { presets: [], vibes: [] }, () => {}, project)
    .find(item => item.name === 'create_character_reference_from_history');
  await tool.execute('call', { historyId: 'history-1', name: 'Latest character' });
  assert.equal(calls.at(-1).path, '/api/character-references');
  assert.match(calls.at(-1).options.body.imageData, /^data:image\/png;base64,/);
  assert.equal(calls.some(call => /^https?:/i.test(call.path)), false);
});

test('prompt agent imports only computer-cached AITag images into project libraries', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const calls = [];
  const detail = {
    work: { id: 123, title: 'Cached work' },
    images: [{ local_image_url: '/api/assets/aitag-covers/123.webp', ai_json: { v4_prompt: { caption: { base_caption: '1girl, sunset' } }, uc: 'bad anatomy', parameters: { steps: 28 } } }],
  };
  const project = {
    requestJson: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/aitag/work/123') return detail;
      if (path === '/api/inspirations' && options?.method === 'POST') return { success: true };
      throw new Error(`unexpected ${path}`);
    },
    requestBuffer: async path => {
      assert.equal(path, '/api/assets/aitag-covers/123.webp');
      return { buffer: Buffer.from([1, 2, 3]), mimeType: 'image/webp' };
    },
  };
  const tool = service.createTools({ basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: {} }, { clientSettings: {} }, () => {}, project)
    .find(item => item.name === 'import_aitag_image');
  await tool.execute('call', { workId: 123, target: 'inspiration', name: 'Imported' });
  const body = calls.at(-1).options.body;
  assert.equal(body.prompt, '1girl, sunset');
  assert.equal(body.negativePrompt, 'bad anatomy');
  assert.match(body.imageUrl, /^data:image\/webp;base64,/);
  detail.images[0] = { remote_image_url: 'https://images.aitag.win/remote.webp' };
  await assert.rejects(() => tool.execute('call', { workId: 123, target: 'vibe' }), /尚未保存到电脑/);
});

test('prompt agent history inspection returns the real image only to vision models', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const draft = { basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: {} };
  const history = { items: [{ id: 'history-1', prompt: '1girl', params: { seed: 7 }, createdAt: 123 }] };
  const project = {
    requestJson: async path => {
      assert.equal(path, '/api/local-history?page=0&pageSize=100');
      return history;
    },
    requestBuffer: async path => {
      assert.equal(path, '/api/local-history/history-1/image');
      return { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimeType: 'image/png' };
    },
  };
  const visionTool = service.createTools(draft, { presets: [], vibes: [] }, () => {}, project, { imageInput: true }).find(item => item.name === 'inspect_generation_image');
  const result = await visionTool.execute('call', { id: 'history-1' });
  assert.equal(result.content[1].type, 'image');
  assert.equal(result.content[1].mimeType, 'image/png');
  assert.equal(result.content[1].data, Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'));
  const textOnlyTool = service.createTools(draft, { presets: [], vibes: [] }, () => {}, project, { imageInput: false }).find(item => item.name === 'inspect_generation_image');
  await assert.rejects(() => textOnlyTool.execute('call', { id: 'history-1' }), /没有可用的视觉模型/);
  const routedTool = service.createTools(draft, { presets: [], vibes: [] }, () => {}, {
    ...project,
    visionModelLabel: 'google/gemini-vision',
    analyzeImages: async (images, focus) => {
      assert.equal(images[0].type, 'image');
      assert.match(focus, /构图/);
      return '画面构图稳定';
    },
  }, { imageInput: false }).find(item => item.name === 'inspect_generation_image');
  const routed = await routedTool.execute('call', { id: 'history-1', focus: '分析构图' });
  assert.equal(JSON.parse(routed.content[0].text).visualAnalysis, '画面构图稳定');
  assert.equal(JSON.parse(routed.content[0].text).visionModel, 'google/gemini-vision');
});

test('prompt agent destructive tools only emit confirmation requests', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const events = [];
  let workerCalls = 0;
  const tools = service.createTools({ basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: {} }, { presets: [], vibes: [] }, event => events.push(event), { requestJson: async () => { workerCalls++; } }, { imageInput: true });
  const pending = tools.find(item => item.name === 'request_clear_history').execute('call', { reason: 'test' });
  await new Promise(resolve => setImmediate(resolve));
  const request = [...service.pendingConfirmations.values()][0];
  assert.ok(request);
  clearTimeout(request.timer);
  service.pendingConfirmations.clear();
  request.resolve({ accepted: false, result: {} });
  await assert.rejects(() => pending, /取消/);
  assert.equal(workerCalls, 0);
  assert.equal(events.at(-1).action.kind, 'request_project_action');
  assert.equal(events.at(-1).action.patch.action, 'clear_history');
});

test('prompt agent keeps advanced generation fields when changing one parameter', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const draft = { basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', noiseSchedule: 'karras', sm: true, customAdvancedFlag: 7 } };
  const tool = service.createTools(draft, { presets: [], vibes: [] }, () => {}).find(item => item.name === 'set_generation_params');
  await tool.execute('call', { steps: 32 });
  assert.equal(draft.params.steps, 32);
  assert.equal(draft.params.noiseSchedule, 'karras');
  assert.equal(draft.params.sm, true);
  assert.equal(draft.params.customAdvancedFlag, 7);
});

test('prompt agent reads a complete chain and safely merges partial stored params', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const stored = {
    id: 'chain-1', name: 'Stored chain', type: 'style', basePrompt: 'artist:test', negativePrompt: 'bad anatomy',
    modules: [{ id: 'module-1', name: 'Lighting', content: 'rim lighting', isActive: true, position: 'post' }],
    variableValues: { subject: '1girl', retained: 'yes' },
    params: {
      width: 1024, height: 1024, steps: 28, sampler: 'k_dpmpp_2m', noiseSchedule: 'karras', customAdvancedFlag: 7,
      vibes: { enabled: true, normalizeStrengths: true, slots: [{ vibeId: 'v1', encodingId: 'e1', strength: 0.6 }] },
      characterReferences: { enabled: false, slots: [{ assetId: 'r1', strength: 0.5, fidelity: 0.7 }] },
    },
  };
  const calls = [];
  const project = { requestJson: async (path, options) => {
    calls.push({ path, options });
    if (path === '/api/chains/chain-1' && !options) return stored;
    if (path === '/api/chains/chain-1' && options?.method === 'PUT') return { success: true };
    throw new Error(`unexpected ${path}`);
  } };
  const tools = service.createTools({ basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: {} }, { clientSettings: {} }, () => {}, project);
  const full = await tools.find(item => item.name === 'get_chain').execute('call', { id: 'chain-1' });
  const fullPayload = JSON.parse(full.content[0].text);
  assert.equal(fullPayload.modules[0].content, 'rim lighting');
  assert.equal(fullPayload.params.vibes.slots[0].vibeId, 'v1');
  await tools.find(item => item.name === 'update_chain').execute('call', { id: 'chain-1', subjectPrompt: '2girls', params: { steps: 32 } });
  const update = calls.at(-1).options.body;
  assert.equal(update.params.steps, 32);
  assert.equal(update.params.width, 1024);
  assert.equal(update.params.noiseSchedule, 'karras');
  assert.equal(update.params.customAdvancedFlag, 7);
  assert.equal(update.params.vibes.slots[0].encodingId, 'e1');
  assert.equal(update.variableValues.retained, 'yes');
  assert.equal(update.variableValues.subject, '2girls');
});

test('prompt agent separates global subject text from single-character prompts', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const draft = { basePrompt: 'oil painting', subjectPrompt: 'standing in a garden', negativePrompt: '', modules: [], params: {} };
  const actions = [];
  const tools = service.createTools(draft, { presets: [], vibes: [] }, event => actions.push(event));
  const globalPromptTool = tools.find(item => item.name === 'update_prompts');
  const characterTool = tools.find(item => item.name === 'set_characters');
  assert.match(globalPromptTool.description, /不得存放角色专属/);
  assert.match(characterTool.description, /即使只有一个角色/);
  await characterTool.execute('call', { characters: [{ prompt: '1girl, blue hair, red dress', negativePrompt: 'extra arms', x: 0.5, y: 0.5 }] });
  assert.equal(draft.subjectPrompt, 'standing in a garden');
  assert.equal(draft.params.characters.length, 1);
  assert.equal(draft.params.characters[0].prompt, '1girl, blue hair, red dress');
  assert.equal(actions.at(-1).action.kind, 'set_characters');
});

test('prompt agent exposes project settings without exposing API keys', async () => {
  const service = new PromptAgentService({ lanSecret: 'test-lan-secret' });
  const calls = [];
  const project = {
    requestJson: async path => {
      calls.push(path);
      if (path === '/api/anlas-budget') return { remaining: 1666 };
      if (path === '/api/config/benchmarks') return { config: { slots: 3 } };
      throw new Error(`unexpected ${path}`);
    },
    getQueuePreferences: () => ({ enabled: true, greeting: 'test', showGreeting: true }),
  };
  const tools = service.createTools({ basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: {} }, { presets: [], vibes: [], clientSettings: { themeMode: 'dark', novelAiKeyConfigured: true } }, () => {}, project, { imageInput: true });
  const result = await tools.find(item => item.name === 'get_project_settings').execute('call', {});
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.anlasBudget.remaining, 1666);
  assert.equal(payload.client.novelAiKeyConfigured, true);
  assert.equal(JSON.stringify(payload).toLowerCase().includes('api_key'), false);
  assert.deepEqual(calls, ['/api/anlas-budget', '/api/config/benchmarks']);
});

test('NovelAI generation uses the computer outbound proxy transport', async () => {
  let captured;
  const requestRemote = async (url, options) => {
    captured = { url, options };
    return new Response('ok', { status: 200 });
  };
  const response = await fetchNovelAiGeneration({ action: 'generate' }, 'Bearer hidden', AbortSignal.timeout(1000), requestRemote);
  assert.equal(response.status, 200);
  assert.equal(captured.url, 'https://image.novelai.net/ai/generate-image');
  assert.equal(captured.options.headers.Authorization, 'Bearer hidden');
});

test('cloud queue uses st-chatu8 key hashing without sending the raw NovelAI key', async () => {
  const calls = [];
  const remote = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/join-queue')) return new Response(JSON.stringify({ position: 1, queue_size: 2 }), { status: 200 });
    if (url.includes('/my-turn?')) return new Response(JSON.stringify({ is_my_turn: true, position: 0, queue_size: 2, lock_token: 'lock' }), { status: 200 });
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  };
  const coordinator = new CloudQueueCoordinator(remote, 'https://queue.example');
  const lock = await coordinator.join({ apiKey: 'secret-key', taskId: 'task-12345678', greeting: '你好', signal: new AbortController().signal });
  await coordinator.release(lock);
  const joined = JSON.parse(calls[0].options.body);
  assert.equal(joined.key_hash, '85dbe15d75ef9308c7ae0f33c7a324cc6f4bf519a2ed2f3027bd33c140a4f9aa');
  assert.equal(calls.some(call => JSON.stringify(call).includes('secret-key')), false);
  assert.equal(calls.at(-1).url.endsWith('/complete'), true);
});

test('cancelling while waiting removes the task from the cloud queue', async () => {
  const calls = [];
  const remote = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/join-queue')) return new Response(JSON.stringify({ position: 2, queue_size: 3 }), { status: 200 });
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  };
  const coordinator = new CloudQueueCoordinator(remote, 'https://queue.example');
  const controller = new AbortController();
  const pending = coordinator.join({ apiKey: 'secret-key', taskId: 'task-cancel-123', signal: controller.signal });
  setTimeout(() => controller.abort(new DOMException('cancelled', 'AbortError')), 10);
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(calls.at(-1).url.endsWith('/leave-queue'), true);
});

test('AITag computer proxy only accepts known API and image targets', () => {
  assert.equal(classifyAitagRemoteTarget('https://aitag.win/api/ai_works_search?page=1'), 'json');
  assert.equal(classifyAitagRemoteTarget('https://aitag.win/api/work/147453358'), 'json');
  assert.equal(classifyAitagRemoteTarget('https://ai-img.10118899.xyz/NAI/1/example.webp'), 'image');
  assert.equal(classifyAitagRemoteTarget('https://aitag.win/admin'), null);
  assert.equal(classifyAitagRemoteTarget('https://example.com/api/work/1'), null);
  assert.equal(classifyAitagRemoteTarget('file:///etc/passwd'), null);
});

test('Danbooru computer proxy only accepts the Safebooru posts API', () => {
  assert.equal(classifyDanbooruRemoteTarget('https://safebooru.donmai.us/posts.json?tags=1girl'), 'json');
  assert.equal(classifyDanbooruRemoteTarget('https://safebooru.donmai.us/posts/1.json'), null);
  assert.equal(classifyDanbooruRemoteTarget('https://danbooru.donmai.us/posts.json'), null);
  assert.equal(classifyDanbooruRemoteTarget('https://safebooru.donmai.us.evil.example/posts.json'), null);
  assert.equal(classifyDanbooruRemoteTarget('file:///etc/passwd'), null);
});

test('media thumbnails accept project and st-chatu8 history sources without opening arbitrary local routes', () => {
  const externalId = 'a'.repeat(64);
  assert.deepEqual(getValidatedSource('/api/local-history/item-1/image'), {
    type: 'local', source: '/api/local-history/item-1/image',
  });
  assert.deepEqual(getValidatedSource('/api/character-references/ref-1/thumbnail'), {
    type: 'local', source: '/api/character-references/ref-1/thumbnail',
  });
  assert.deepEqual(getValidatedSource(`/api/integrations/st-chatu8/history/${externalId}/image`), {
    type: 'st-chatu8-history',
    source: `/api/integrations/st-chatu8/history/${externalId}/image`,
    externalId,
  });
  assert.throws(() => getValidatedSource('/api/integrations/st-chatu8/history/not-a-hash/image'), /Unsupported image source/);
  assert.throws(() => getValidatedSource('/api/integrations/st-chatu8/status'), /Unsupported image source/);
});

test('thumbnail generation concurrency scales conservatively with CPU and memory', () => {
  const gib = 1024 ** 3;
  assert.equal(selectThumbnailConcurrency({ logicalProcessors: 4, totalMemoryBytes: 8 * gib }), 2);
  assert.equal(selectThumbnailConcurrency({ logicalProcessors: 8, totalMemoryBytes: 16 * gib }), 4);
  assert.equal(selectThumbnailConcurrency({ logicalProcessors: 12, totalMemoryBytes: 16 * gib }), 8);
  assert.equal(selectThumbnailConcurrency({ logicalProcessors: 16, totalMemoryBytes: 32 * gib }), 12);
  assert.equal(selectThumbnailConcurrency({ logicalProcessors: 16, totalMemoryBytes: 8 * gib }), 2);
});

test('Vibe strengths are only scaled when their sum exceeds one', () => {
  assert.deepEqual(normalizeVibeStrengths([{ strength: 0.2 }, { strength: 0.3 }]), [0.2, 0.3]);
  assert.deepEqual(normalizeVibeStrengths([{ strength: 0.8 }, { strength: 0.8 }]), [0.5, 0.5]);
});

test('NovelAI V4.5 costs follow Opus free limits and current web formula', () => {
  const payload = { action: 'generate', parameters: { width: 832, height: 1216, steps: 23, n_samples: 1 } };
  assert.equal(estimateNovelAiGenerationCost(payload), 0);
  assert.equal(estimateNovelAiGenerationCost({ ...payload, parameters: { ...payload.parameters, steps: 29 } }), 20);
  assert.equal(estimateNovelAiGenerationCost({ ...payload, parameters: {
    ...payload.parameters,
    reference_image_multiple_cached: Array.from({ length: 5 }, (_, index) => ({ cache_secret_key: String(index) })),
  } }), 2);
  assert.equal(estimateNovelAiGenerationCost({ ...payload, parameters: {
    ...payload.parameters,
    director_reference_images_cached: [{ cache_secret_key: 'character' }],
  } }), 5);
});

test('Precise Reference uses official V4.5 director fields without local IDs', () => {
  const slots = [
    { assetId: 'local-a', type: 'character', strength: 0.65, fidelity: 0.8, informationExtracted: 0.9 },
    { assetId: 'local-b', type: 'character_style', strength: 0.4, fidelity: 0.25 },
  ];
  const resolved = [
    { mimeType: 'image/png', imageData: Buffer.from('a'.repeat(128)).toString('base64') },
    { mimeType: 'image/jpeg', data: `data:image/jpeg;base64,${Buffer.from('b'.repeat(128)).toString('base64')}` },
  ];
  const parameters = buildPreciseReferenceParameters(slots, resolved);
  assert.equal(parameters.director_reference_images.length, 2);
  assert.deepEqual(parameters.director_reference_descriptions.map(item => item.caption.base_caption), ['character', 'character&style']);
  assert.deepEqual(parameters.director_reference_information_extracted, [0.9, 1]);
  assert.deepEqual(parameters.director_reference_strength_values, [0.65, 0.4]);
  assert.ok(Math.abs(parameters.director_reference_secondary_strength_values[0] - 0.2) < Number.EPSILON);
  assert.equal(parameters.director_reference_secondary_strength_values[1], 0.75);
  assert.equal(JSON.stringify(parameters).includes('local-a'), false);
});

test('Precise Reference keeps official extended Strength/Fidelity ranges and clamps extraction only', () => {
  const slots = [
    { assetId: 'negative', type: 'style', strength: -0.5, fidelity: -0.25, informationExtracted: -1 },
    { assetId: 'boosted', type: 'character', strength: 1.75, fidelity: 1.5, informationExtracted: 2 },
  ];
  const image = Buffer.from('x'.repeat(128)).toString('base64');
  const parameters = buildPreciseReferenceParameters(slots, [
    { mimeType: 'image/png', imageData: image },
    { mimeType: 'image/png', imageData: image },
  ]);
  assert.deepEqual(parameters.director_reference_strength_values, [-0.5, 1.75]);
  assert.deepEqual(parameters.director_reference_secondary_strength_values, [1.25, -0.5]);
  assert.deepEqual(parameters.director_reference_information_extracted, [0, 1]);
});

test('Precise Reference chooses the nearest official portrait, square and landscape canvas', () => {
  assert.deepEqual(selectPreciseReferenceCanvas(800, 1200), { width: 1024, height: 1536 });
  assert.deepEqual(selectPreciseReferenceCanvas(1200, 1200), { width: 1472, height: 1472 });
  assert.deepEqual(selectPreciseReferenceCanvas(1600, 900), { width: 1536, height: 1024 });
});

test('Precise Reference strips spoofed browser fields and rejects invalid input', () => {
  const parameters = clearPreciseReferenceParameters({
    _local_character_references: { slots: [] },
    director_reference_images: ['untrusted'],
    director_reference_images_cached: [{ data: 'untrusted' }],
    director_reference_strength_values: [1],
    width: 832,
  });
  assert.deepEqual(parameters, { width: 832 });
  assert.throws(() => buildPreciseReferenceParameters(Array.from({ length: 5 }, () => ({})), []), /最多使用 4 个/);
  assert.throws(() => buildPreciseReferenceParameters(
    [{ assetId: 'x', type: 'invalid', strength: 1, fidelity: 1 }],
    [{ mimeType: 'image/png', data: Buffer.from('x'.repeat(128)).toString('base64') }],
  ), /参考类型无效/);
});

test('cached Vibe references use stable private keys and optionally include data', () => {
  const encodings = ['encoding-a', 'encoding-b'];
  const first = buildCachedVibeReferences(encodings);
  assert.equal(first[0].cache_secret_key, getVibeCacheSecretKey(encodings[0]));
  assert.equal(first[0].data, encodings[0]);

  const includeOnlySecond = new Set([getVibeCacheSecretKey(encodings[1])]);
  const retry = buildCachedVibeReferences(encodings, includeOnlySecond);
  assert.equal('data' in retry[0], false);
  assert.equal(retry[1].data, encodings[1]);
});

test('encoding memory cache merges concurrent loads and evicts least recently used data', async () => {
  const cache = new VibeEncodingMemoryCache(10);
  let loads = 0;
  const loader = async () => {
    loads++;
    return { encoding: Buffer.from('123456').toString('base64') };
  };
  const [first, second] = await Promise.all([cache.get('one', loader), cache.get('one', loader)]);
  assert.equal(first, second);
  assert.equal(loads, 1);
  await cache.get('two', async () => ({ encoding: Buffer.from('abcdef').toString('base64') }));
  assert.equal(cache.entries.has('one'), false);
  assert.equal(cache.entries.has('two'), true);
});

test('NovelAI invalid cache-key response is recognized without logging encoded data', async () => {
  const response = new Response(JSON.stringify({
    message: 'INVALID_CACHE_KEYS',
    details: { invalidKeys: ['key-a'] },
  }), { status: 400 });
  const parsed = await parseInvalidVibeCacheKeys(response);
  assert.deepEqual([...parsed.invalidKeys], ['key-a']);
});

test('generation retries once with encoded data when NovelAI cache has expired', async () => {
  const encoding = `retry-${'x'.repeat(128)}`;
  const cacheKey = getVibeCacheSecretKey(encoding);
  const payload = {
    parameters: {
      reference_image_multiple_cached: [{ cache_secret_key: cacheKey }],
      reference_strength_multiple: [0.6],
    },
  };
  const requests = [];
  const requestGeneration = async currentPayload => {
    requests.push(structuredClone(currentPayload));
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        message: 'INVALID_CACHE_KEYS',
        details: { invalidKeys: [cacheKey] },
      }), { status: 400 });
    }
    return new Response('zip', { status: 200 });
  };

  const response = await generateWithVibeCacheRetry(payload, 'Bearer test', [encoding], new Set(), requestGeneration);
  assert.equal(response.status, 200);
  assert.equal(requests.length, 2);
  assert.equal('data' in requests[0].parameters.reference_image_multiple_cached[0], false);
  assert.equal(requests[1].parameters.reference_image_multiple_cached[0].data, encoding);
});

// ---------- 图片真实尺寸解析（worker/imageDimensions.mjs） ----------

const buildPng = (width, height) => {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b[8] = 0; b[9] = 0; b[10] = 0; b[11] = 13; // IHDR 长度
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  b[16] = (width >>> 24) & 0xff; b[17] = (width >>> 16) & 0xff; b[18] = (width >>> 8) & 0xff; b[19] = width & 0xff;
  b[20] = (height >>> 24) & 0xff; b[21] = (height >>> 16) & 0xff; b[22] = (height >>> 8) & 0xff; b[23] = height & 0xff;
  return b;
};

const buildJpeg = (width, height) => {
  const b = new Uint8Array(20);
  b[0] = 0xff; b[1] = 0xd8; // SOI
  b[2] = 0xff; b[3] = 0xc0; // SOF0
  b[4] = 0; b[5] = 17; // 段长（含自身 2 字节）
  b[6] = 8; // 精度
  b[7] = (height >>> 8) & 0xff; b[8] = height & 0xff;
  b[9] = (width >>> 8) & 0xff; b[10] = width & 0xff;
  return b;
};

const buildWebpVp8 = (width, height) => {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  b.set([0x56, 0x50, 0x38, 0x20], 12); // VP8
  b[20] = 0x9d; b[21] = 0x01; b[22] = 0x2a;
  b[23] = width & 0xff; b[24] = (width >>> 8) & 0xff; b[25] = (width >>> 16) & 0xff;
  b[26] = height & 0xff; b[27] = (height >>> 8) & 0xff; b[28] = (height >>> 16) & 0xff;
  return b;
};

const buildWebpVp8l = (width, height) => {
  const b = new Uint8Array(25);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set([0x56, 0x50, 0x38, 0x4c], 12); // VP8L
  b[20] = 0x2f;
  const bits = (width - 1) | ((height - 1) << 14);
  b[21] = bits & 0xff; b[22] = (bits >>> 8) & 0xff; b[23] = (bits >>> 16) & 0xff; b[24] = (bits >>> 24) & 0xff;
  return b;
};

const buildWebpVp8x = (width, height) => {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  const w = width - 1; const h = height - 1;
  b[24] = w & 0xff; b[25] = (w >>> 8) & 0xff; b[26] = (w >>> 16) & 0xff;
  b[27] = h & 0xff; b[28] = (h >>> 8) & 0xff; b[29] = (h >>> 16) & 0xff;
  return b;
};

test('image dimensions: PNG reads landscape, portrait and square from IHDR', () => {
  assert.deepEqual(readImageDimensions(buildPng(1216, 832), 'png'), { width: 1216, height: 832 });
  assert.deepEqual(readImageDimensions(buildPng(832, 1216), 'png'), { width: 832, height: 1216 });
  assert.deepEqual(readImageDimensions(buildPng(1024, 1024), 'png'), { width: 1024, height: 1024 });
});

test('image dimensions: JPEG reads SOF0 width/height', () => {
  assert.deepEqual(readImageDimensions(buildJpeg(1216, 832), 'jpg'), { width: 1216, height: 832 });
  assert.deepEqual(readImageDimensions(buildJpeg(832, 1216), 'jpg'), { width: 832, height: 1216 });
});

test('image dimensions: WebP VP8/VP8L/VP8X read width/height', () => {
  assert.deepEqual(readImageDimensions(buildWebpVp8(1216, 832), 'webp'), { width: 1216, height: 832 });
  assert.deepEqual(readImageDimensions(buildWebpVp8l(832, 1216), 'webp'), { width: 832, height: 1216 });
  assert.deepEqual(readImageDimensions(buildWebpVp8x(1024, 1024), 'webp'), { width: 1024, height: 1024 });
});

test('image dimensions: truncated files are rejected', () => {
  assert.throws(() => readImageDimensions(buildPng(100, 100).subarray(0, 20), 'png'), /不完整/);
  assert.throws(() => readImageDimensions(buildJpeg(100, 100).subarray(0, 8), 'jpg'), /不完整/);
  assert.throws(() => readImageDimensions(buildWebpVp8(100, 100).subarray(0, 20), 'webp'), /不完整/);
});

test('image dimensions: forged signatures are rejected', () => {
  assert.throws(() => readImageDimensions(buildPng(100, 100), 'jpg'), /签名无效/);
  assert.throws(() => readImageDimensions(buildJpeg(100, 100), 'png'), /不完整|签名无效/);
  assert.throws(() => readImageDimensions(buildPng(100, 100), 'webp'), /签名无效/);
  assert.throws(() => readImageDimensions(buildJpeg(100, 100), 'webp'), /签名无效/);
  assert.throws(() => readImageDimensions(new Uint8Array([1, 2, 3, 4]), 'png'), /不完整|签名无效/);
});

test('image dimensions: zero and oversized dimensions are rejected', () => {
  assert.throws(() => readImageDimensions(buildPng(0, 832), 'png'), /尺寸无效/);
  assert.throws(() => readImageDimensions(buildPng(832, 0), 'png'), /尺寸无效/);
  assert.throws(() => readImageDimensions(buildJpeg(0, 832), 'jpg'), /尺寸无效/);
  assert.throws(() => readImageDimensions(buildPng(65537, 832), 'png'), /异常过大|尺寸无效/);
  assert.throws(() => readImageDimensions(buildWebpVp8(0, 832), 'webp'), /尺寸无效/);
});

test('image dimensions: unknown format is rejected', () => {
  assert.throws(() => readImageDimensions(buildPng(100, 100), 'gif'), /不支持的图片格式/);
});

// ---------- Danbooru 封面导入链路（媒体网关侧） ----------

test('media gateway allows cdn.donmai.us sources and rejects other hosts', () => {
  assert.deepEqual(getValidatedSource('https://cdn.donmai.us/sample/abc.webp'), {
    type: 'remote',
    source: 'https://cdn.donmai.us/sample/abc.webp',
  });
  assert.throws(() => getValidatedSource('http://cdn.donmai.us/sample.webp'), /not allowed/);
  assert.throws(() => getValidatedSource('https://cdn.donmai.us.evil.example/sample.webp'), /not allowed/);
  assert.throws(() => getValidatedSource('https://example.com/sample.webp'), /not allowed/);
});

test('media gateway allows i.pximg.net sources only through the local whitelist', () => {
  assert.deepEqual(getValidatedSource('https://i.pximg.net/img-master/img/2024/01/01/00/00/00/123_p0_master1200.jpg'), {
    type: 'remote',
    source: 'https://i.pximg.net/img-master/img/2024/01/01/00/00/00/123_p0_master1200.jpg',
  });
  assert.throws(() => getValidatedSource('http://i.pximg.net/x.jpg'), /not allowed/);
  assert.throws(() => getValidatedSource('https://i.pximg.net:444/x.jpg'), /not allowed/);
  assert.throws(() => getValidatedSource('https://i.pximg.net.evil.example/x.jpg'), /not allowed/);
});

test('Pixiv connection credentials can only be changed from loopback', () => {
  assert.equal(isPixivConnectionMutationAllowed({ socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(isPixivConnectionMutationAllowed({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
  assert.equal(isPixivConnectionMutationAllowed({ socket: { remoteAddress: '192.168.1.50' } }), false);
  assert.equal(isPixivConnectionMutationAllowed({ socket: { remoteAddress: '10.0.0.8' } }), false);
});

test('requestRemoteBuffer sends the Pixiv Referer for i.pximg.net and keeps it across redirects', async () => {
  const calls = [];
  const remoteFetch = async (url, opts) => {
    calls.push({ url: url.toString(), referer: opts.headers.referer });
    if (calls.length === 1) {
      return new Response(null, { status: 302, headers: { location: 'https://i.pximg.net/img-master/img/2024/01/01/00/00/00/123_p0_master1200.jpg?x=1' } });
    }
    return new Response(new Uint8Array([9, 8, 7]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  const result = await requestRemoteBuffer('https://i.pximg.net/img-master/img/2024/01/01/00/00/00/123_p0_master1200.jpg', remoteFetch);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.referer, 'https://www.pixiv.net/');
  assert.deepEqual([...result.buffer], [9, 8, 7]);
});

test('requestRemoteBuffer never sends a Referer for non-Pixiv hosts', async () => {
  const referers = [];
  await requestRemoteBuffer('https://cdn.donmai.us/sample.webp', async (url, opts) => {
    referers.push(opts.headers.referer);
    return new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/webp' } });
  });
  assert.equal(referers[0], undefined);
});

test('requestRemoteBuffer sends image Accept header and returns upstream original bytes', async () => {
  const calls = [];
  const remoteFetch = async (url, opts) => {
    calls.push({ url: url.toString(), headers: opts.headers });
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/webp' } });
  };
  const result = await requestRemoteBuffer('https://cdn.donmai.us/sample.webp', remoteFetch);
  assert.equal(result.status, 200);
  assert.deepEqual([...result.buffer], [1, 2, 3, 4]);
  assert.equal(calls[0].headers.accept, 'image/*');
  assert.match(calls[0].headers['user-agent'], /MediaGateway/);
});

test('requestRemoteBuffer never treats 403, non-image or oversized responses as images', async () => {
  const forbidden = await requestRemoteBuffer('https://cdn.donmai.us/x.webp', async () => new Response('denied', { status: 403, headers: { 'content-type': 'text/plain' } }));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.buffer.length, 0);
  await assert.rejects(() => requestRemoteBuffer('https://cdn.donmai.us/x.webp', async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })), /not an image/);
  await assert.rejects(() => requestRemoteBuffer('https://cdn.donmai.us/x.webp', async () => new Response('x', { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(31 * 1024 * 1024) } })), /too large/);
  await assert.rejects(() => requestRemoteBuffer('https://evil.example/x.webp', async () => new Response('x')), /not allowed/);
});

test('缩略图预热器：去重入队、并发消化、已缓存跳过', async () => {
  const generated = new Set();
  let loadCalls = 0;
  const cache = {
    has: (source, variant) => generated.has(`${source}|${variant}`),
    get: async (source, variant, loadOriginal) => {
      const key = `${source}|${variant}`;
      if (!generated.has(key)) {
        generated.add(key);
        await loadOriginal();
      }
      return { buffer: Buffer.from('x'), etag: `"${key}"` };
    },
  };
  const prewarmer = createThumbnailPreWarmer({ cache, loadOriginal: async () => { loadCalls += 1; }, concurrency: 2, maxPending: 10 });

  // 去重：同一 source 只入队一次；加入 2 个
  assert.equal(prewarmer.enqueue(['a', 'a', 'b', 'c']), 3);
  assert.ok(prewarmer.pendingCount <= 3, 'pump 同步消费,队列余量 <= 3');
  // 已入队的重复提交不再增加
  assert.equal(prewarmer.enqueue(['b']), 0);
  assert.ok(prewarmer.pendingCount <= 3);

  // 等待队列消化完成（两个 variant 都生成）
  const deadline = Date.now() + 2000;
  while (prewarmer.pendingCount > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(prewarmer.pendingCount, 0);
  assert.equal(generated.size, 3); // 3 sources × 1 variant（仅预热主用 thumb-320）
  assert.equal(loadCalls, 3);      // 每个 source 抓取一次；真实缓存内部对同一 source 单飞
  // 全部缓存后再次入队返回 0
  assert.equal(prewarmer.enqueue(['a', 'b', 'c', 'd']), 1);
  // 队列上限
  const full = createThumbnailPreWarmer({ cache, loadOriginal: async () => {}, concurrency: 1, maxPending: 2 });
  assert.equal(full.enqueue(['x1', 'x2', 'x3', 'x4']), 2);
});
