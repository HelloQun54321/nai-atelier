import { Agent } from '@earendil-works/pi-agent-core';
import { InMemoryCredentialStore, Type } from '@earendil-works/pi-ai';
import { builtinModels, builtinProviders, getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { getGlobalDispatcher, ProxyAgent, setGlobalDispatcher } from 'undici';

const CONFIG_FILE = 'local-data/prompt-agent.json';
const SESSION_DIR = 'local-data/prompt-agent-sessions';
const TAG_ROOT = 'public/tag-data';
const PROVIDER_CATALOG = new Map(builtinProviders().map(provider => [provider.id, provider]));
const PREFERRED_MODELS = {
  deepseek: 'deepseek-v4-flash', google: 'gemini-2.5-flash', xai: 'grok-4.3',
  openrouter: 'google/gemini-2.5-flash', openai: 'gpt-5-mini', anthropic: 'claude-sonnet-4-6',
};
const CATEGORY_LABELS = { 0: '普通', 1: '画师', 3: '作品', 4: '角色', 5: '元数据', 6: 'NovelAI' };
const MAX_SESSION_MESSAGES = 48;
let proxyRunCount = 0;
let previousDispatcher = null;
let sharedProxyDispatcher = null;

const enterOutboundProxy = proxyUrl => {
  if (!proxyUrl) return () => {};
  if (proxyRunCount === 0) {
    previousDispatcher = getGlobalDispatcher();
    sharedProxyDispatcher = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(sharedProxyDispatcher);
  }
  proxyRunCount += 1;
  return () => {
    proxyRunCount = Math.max(0, proxyRunCount - 1);
    if (proxyRunCount === 0 && previousDispatcher) {
      setGlobalDispatcher(previousDispatcher);
      sharedProxyDispatcher?.close().catch(() => {});
      sharedProxyDispatcher = null;
      previousDispatcher = null;
    }
  };
};

const clamp = (value, min, max, fallback = min) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};
const text = value => String(value ?? '').slice(0, 30_000);
const jsonText = value => [{ type: 'text', text: JSON.stringify(value) }];
const atomicJsonWrite = async (file, value) => {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
};

const normalizeProvider = value => PROVIDER_CATALOG.has(value) ? value : 'google';
const listModels = provider => {
  const normalized = normalizeProvider(provider);
  return getBuiltinModels(normalized).map(model => ({
    id: model.id,
    name: model.name || model.id,
    provider: normalized,
    reasoning: Boolean(model.reasoning),
    imageInput: Array.isArray(model.input) && model.input.includes('image'),
    contextWindow: Number(model.contextWindow) || 0,
    maxTokens: Number(model.maxTokens) || 0,
    cost: model.cost || null,
  }));
};
const defaultModelFor = provider => {
  const models = listModels(provider);
  return models.some(model => model.id === PREFERRED_MODELS[provider]) ? PREFERRED_MODELS[provider] : models[0]?.id || '';
};

const sanitizeParams = raw => {
  const value = raw && typeof raw === 'object' ? raw : {};
  const params = {
    width: Math.round(clamp(value.width, 64, 2048, 832) / 64) * 64,
    height: Math.round(clamp(value.height, 64, 2048, 1216) / 64) * 64,
    steps: Math.round(clamp(value.steps, 1, 50, 28)),
    scale: clamp(value.scale, 0, 10, 5),
    sampler: text(value.sampler || 'k_euler_ancestral').slice(0, 80),
    qualityToggle: value.qualityToggle !== false,
    ucPreset: Math.round(clamp(value.ucPreset, 0, 4, 4)),
    useCoords: value.useCoords === true,
    variety: value.variety === true,
    cfgRescale: clamp(value.cfgRescale, 0, 1, 0),
  };
  if (Number.isInteger(Number(value.seed)) && Number(value.seed) >= 0) params.seed = Number(value.seed);
  if (Array.isArray(value.characters)) params.characters = value.characters.slice(0, 6).map(character => ({
    id: text(character.id || randomBytes(8).toString('hex')).slice(0, 80),
    prompt: text(character.prompt),
    negativePrompt: text(character.negativePrompt),
    x: clamp(character.x, 0, 1, 0.5),
    y: clamp(character.y, 0, 1, 0.5),
  }));
  if (value.vibes && typeof value.vibes === 'object') params.vibes = value.vibes;
  return params;
};

const sanitizeDraft = raw => ({
  basePrompt: text(raw?.basePrompt),
  subjectPrompt: text(raw?.subjectPrompt),
  negativePrompt: text(raw?.negativePrompt),
  modules: Array.isArray(raw?.modules) ? raw.modules.slice(0, 80).map(module => ({
    id: text(module.id || randomBytes(8).toString('hex')).slice(0, 80),
    name: text(module.name).slice(0, 120),
    content: text(module.content),
    isActive: module.isActive !== false,
    position: module.position === 'pre' ? 'pre' : 'post',
    ...(module.group ? { group: text(module.group).slice(0, 80) } : {}),
  })) : [],
  params: sanitizeParams(raw?.params),
});

const systemPrompt = `你是 NaiPromptManager 的 NovelAI V4.5 生图 Agent。你的职责不是只给建议，而是使用工具直接修改实验室草稿。

规则：
1. NovelAI 提示词优先使用英文 Danbooru/NovelAI tag，以逗号分隔；给用户的解释使用中文。
2. 先理解用户意图，必要时搜索 Tag、预设或 Vibe，再调用修改工具。不要让用户复制粘贴。
3. 保留用户没有要求修改的内容。修改参数时遵守 V4.5 合理范围。
4. 用户明确要求“生成、出图、跑一张、试试看”等操作时，修改完成后调用 request_generation；否则不要擅自消耗 Anlas。
5. request_generation 只发出待确认请求，不能声称图片已经生成。
6. 不得要求或泄露 API Key，不得访问电脑文件、命令行或互联网。
7. 完成工具调用后，用简短中文总结你实际改了什么。`;

const extractAssistantText = messages => {
  const assistant = [...messages].reverse().find(message => message?.role === 'assistant');
  if (!assistant || !Array.isArray(assistant.content)) return '';
  return assistant.content.filter(item => item.type === 'text').map(item => item.text).join('').trim();
};

export class PromptAgentService {
  constructor({ lanSecret, outboundProxyUrl = '' }) {
    this.encryptionKey = createHash('sha256').update(`nai-prompt-agent|${lanSecret}`).digest();
    this.outboundProxyUrl = outboundProxyUrl;
    this.config = { version: 2, provider: 'google', model: defaultModelFor('google'), encryptedKeys: {} };
    this.runningSessions = new Set();
    this.tagManifest = null;
  }

  async init() {
    await mkdir(SESSION_DIR, { recursive: true });
    try {
      const stored = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
      this.config = { ...this.config, ...stored, encryptedKeys: stored.encryptedKeys || {} };
    } catch { /* First use. */ }
  }

  encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }

  decrypt(value) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(value.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
    } catch { return ''; }
  }

  getCredential(providerId) {
    const encrypted = this.config.encryptedKeys?.[providerId];
    if (!encrypted) return undefined;
    const raw = this.decrypt(encrypted);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.type === 'api_key' || parsed?.type === 'oauth') return parsed;
    } catch { /* Legacy entries stored the literal key. */ }
    return { type: 'api_key', key: raw };
  }

  setCredential(providerId, credential) {
    this.config.encryptedKeys[providerId] = this.encrypt(JSON.stringify(credential));
  }

  publicConfig() {
    const configuredProviders = this.configuredProviderIds();
    const requestedProvider = normalizeProvider(this.config.provider);
    const provider = configuredProviders.includes(requestedProvider) ? requestedProvider : configuredProviders[0] || requestedProvider;
    const models = listModels(provider);
    const model = models.some(item => item.id === this.config.model) ? this.config.model : defaultModelFor(provider);
    return {
      provider,
      model,
      configured: configuredProviders.includes(provider),
      configuredProviders,
    };
  }

  configuredProviderIds() {
    return Object.keys(this.config.encryptedKeys).filter(key => PROVIDER_CATALOG.has(key) && Boolean(this.getCredential(key)));
  }

  listProviders() {
    const configured = new Set(this.configuredProviderIds());
    return [...PROVIDER_CATALOG.values()]
      .filter(provider => provider.auth?.apiKey)
      .map(provider => ({
        id: provider.id,
        name: provider.name || provider.id,
        authType: 'api_key',
        configured: configured.has(provider.id),
        current: this.publicConfig().provider === provider.id && configured.has(provider.id),
        modelCount: listModels(provider.id).length,
      }))
      .sort((a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name));
  }

  listAvailableModels() {
    const current = this.publicConfig();
    return this.configuredProviderIds().flatMap(provider => listModels(provider).map(model => ({
      ...model,
      current: provider === current.provider && model.id === current.model,
    })));
  }

  async loginProvider(providerId, input) {
    const provider = PROVIDER_CATALOG.get(providerId);
    if (!provider?.auth?.apiKey) throw Object.assign(new Error('这个模型服务不支持 API Key 登录'), { status: 400 });
    const answers = Array.isArray(input?.answers) ? input.answers.map(value => String(value)) : [];
    if (typeof input?.apiKey === 'string' && input.apiKey.trim()) answers.push(input.apiKey.trim());
    let promptIndex = 0;
    const events = [];
    class PromptNeeded extends Error { constructor(prompt, index) { super('LOGIN_PROMPT_NEEDED'); this.prompt = prompt; this.index = index; } }
    let credential;
    try {
      if (provider.auth.apiKey.login) {
        credential = await provider.auth.apiKey.login({
          prompt: async prompt => {
            const index = promptIndex++;
            if (index < answers.length) return answers[index];
            throw new PromptNeeded(prompt, index);
          },
          notify: event => events.push(event),
        });
      } else {
        if (!answers[0]?.trim()) throw new PromptNeeded({ type: 'secret', message: provider.auth.apiKey.name || 'API Key' }, 0);
        credential = { type: 'api_key', key: answers[0].trim() };
      }
    } catch (error) {
      if (error instanceof PromptNeeded) return { complete: false, prompt: error.prompt, promptIndex: error.index, events };
      throw error;
    }
    if (!credential) throw Object.assign(new Error('模型服务没有返回有效凭据'), { status: 400 });
    this.setCredential(providerId, credential);
    if (!this.configuredProviderIds().includes(this.config.provider)) {
      this.config.provider = providerId;
      this.config.model = defaultModelFor(providerId);
    }
    this.config.version = 2;
    await atomicJsonWrite(CONFIG_FILE, this.config);
    return { complete: true, provider: this.listProviders().find(item => item.id === providerId), selection: this.publicConfig(), events };
  }

  async logoutProvider(providerId) {
    delete this.config.encryptedKeys[providerId];
    if (this.config.provider === providerId) {
      const next = this.configuredProviderIds()[0] || 'google';
      this.config.provider = next;
      this.config.model = defaultModelFor(next);
    }
    await atomicJsonWrite(CONFIG_FILE, this.config);
    return this.publicConfig();
  }

  async selectModel(providerId, modelId) {
    if (!this.configuredProviderIds().includes(providerId)) throw Object.assign(new Error('请先登录这个模型服务'), { status: 400 });
    if (!listModels(providerId).some(model => model.id === modelId)) throw Object.assign(new Error('选择的模型不存在'), { status: 400 });
    this.config.provider = providerId;
    this.config.model = modelId;
    await atomicJsonWrite(CONFIG_FILE, this.config);
    return this.publicConfig();
  }

  async saveConfig(input) {
    const provider = normalizeProvider(input?.provider);
    const models = listModels(provider);
    const model = models.some(item => item.id === input?.model) ? input.model : defaultModelFor(provider);
    this.config.provider = provider;
    this.config.model = model;
    if (input?.clearApiKey === true) delete this.config.encryptedKeys[provider];
    if (typeof input?.apiKey === 'string' && input.apiKey.trim()) this.setCredential(provider, { type: 'api_key', key: input.apiKey.trim() });
    await atomicJsonWrite(CONFIG_FILE, this.config);
    return this.publicConfig();
  }

  getModels(provider) { return listModels(provider); }

  sessionFile(sessionId) {
    const hash = createHash('sha256').update(String(sessionId || 'playground')).digest('hex');
    return join(SESSION_DIR, `${hash}.json`);
  }

  async loadMessages(sessionId) {
    try {
      const value = JSON.parse(await readFile(this.sessionFile(sessionId), 'utf8'));
      return Array.isArray(value.messages) ? value.messages.slice(-MAX_SESSION_MESSAGES) : [];
    } catch { return []; }
  }

  async saveMessages(sessionId, messages) {
    await atomicJsonWrite(this.sessionFile(sessionId), { version: 1, updatedAt: Date.now(), messages: messages.slice(-MAX_SESSION_MESSAGES) });
  }

  async resetSession(sessionId) {
    await unlink(this.sessionFile(sessionId)).catch(() => {});
  }

  async getSessionHistory(sessionId) {
    const messages = await this.loadMessages(sessionId);
    return messages.flatMap((message, index) => {
      if (message?.role !== 'user' && message?.role !== 'assistant') return [];
      const content = typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content)
          ? message.content.filter(item => item?.type === 'text').map(item => item.text).join('')
          : '';
      return content.trim() ? [{ id: `saved-${index}`, role: message.role === 'user' ? 'user' : 'agent', text: content.trim() }] : [];
    }).slice(-24);
  }

  async searchTags(rawQuery, limit = 16) {
    const query = text(rawQuery).replaceAll('_', ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!query) return [];
    this.tagManifest ||= JSON.parse(await readFile(join(TAG_ROOT, 'manifest.json'), 'utf8'));
    const isChinese = /[\u3400-\u9fff]/.test(query[0]);
    const key = isChinese
      ? (query.codePointAt(0) % 256).toString(16).padStart(2, '0')
      : query.slice(0, 2).padEnd(2, ' ');
    const filename = isChinese ? this.tagManifest.chineseShards?.[key] : this.tagManifest.shards?.[key];
    const entries = filename
      ? JSON.parse(await readFile(join(TAG_ROOT, isChinese ? 'zh-shards' : 'shards', filename), 'utf8'))
      : (!isChinese && query.length === 1 ? this.tagManifest.popular?.[query] || [] : []);
    return entries
      .filter(entry => String(isChinese ? entry[1] : entry[0]).toLowerCase().startsWith(query))
      .sort((a, b) => Number(b[4]) - Number(a[4]) || Number(b[3]) - Number(a[3]))
      .slice(0, clamp(limit, 1, 30, 16))
      .map(entry => ({ tag: entry[0], chinese: entry[1], category: CATEGORY_LABELS[entry[2]] || 'Tag', postCount: entry[3], novelAI: entry[4] === 1 }));
  }

  createTools(draft, contextData, emit) {
    const apply = (kind, patch) => {
      emit({ type: 'action', action: { kind, patch } });
      return { content: jsonText({ ok: true, applied: patch }), details: { kind, patch } };
    };
    return [
      {
        name: 'get_lab_state', label: '读取实验室', description: '读取当前实验室的提示词、模块、角色、参数和 Vibe。',
        parameters: Type.Object({}),
        execute: async () => ({ content: jsonText(draft), details: draft }),
      },
      {
        name: 'search_tags', label: '搜索 Tag', description: '按中文或英文搜索本地 Tag 词库。',
        parameters: Type.Object({ query: Type.String(), limit: Type.Optional(Type.Number()) }),
        execute: async (_id, args) => { const results = await this.searchTags(args.query, args.limit); return { content: jsonText(results), details: results }; },
      },
      {
        name: 'search_presets', label: '搜索预设', description: '搜索项目里的画师串和角色串预设。',
        parameters: Type.Object({ query: Type.String() }),
        execute: async (_id, args) => {
          const query = text(args.query).trim().toLowerCase();
          const results = (contextData.presets || []).filter(item => JSON.stringify(item).toLowerCase().includes(query)).slice(0, 20);
          return { content: jsonText(results), details: results };
        },
      },
      {
        name: 'search_vibes', label: '搜索 Vibe', description: '搜索电脑中已经永久保存的 Vibe。',
        parameters: Type.Object({ query: Type.String() }),
        execute: async (_id, args) => {
          const query = text(args.query).trim().toLowerCase();
          const results = (contextData.vibes || []).filter(item => !query || String(item.name).toLowerCase().includes(query)).slice(0, 20);
          return { content: jsonText(results), details: results };
        },
      },
      {
        name: 'update_prompts', label: '修改提示词', description: '直接修改基础画风、主题提示词或全局负面提示词。只传需要修改的字段。',
        parameters: Type.Object({
          basePrompt: Type.Optional(Type.String()), subjectPrompt: Type.Optional(Type.String()), negativePrompt: Type.Optional(Type.String()),
        }),
        execute: async (_id, args) => {
          const patch = {};
          for (const key of ['basePrompt', 'subjectPrompt', 'negativePrompt']) if (typeof args[key] === 'string') { draft[key] = text(args[key]); patch[key] = draft[key]; }
          return apply('update_prompts', patch);
        },
      },
      {
        name: 'set_prompt_modules', label: '设置提示词模块', description: '替换实验室的提示词模块列表。',
        parameters: Type.Object({ modules: Type.Array(Type.Object({ name: Type.String(), content: Type.String(), isActive: Type.Optional(Type.Boolean()), position: Type.Optional(Type.Union([Type.Literal('pre'), Type.Literal('post')])) })) }),
        execute: async (_id, args) => {
          draft.modules = sanitizeDraft({ modules: args.modules, params: draft.params }).modules;
          return apply('set_modules', { modules: draft.modules });
        },
      },
      {
        name: 'set_characters', label: '设置多角色', description: '替换多角色列表；每个角色使用英文 Tag，并可指定画面坐标。',
        parameters: Type.Object({ characters: Type.Array(Type.Object({ prompt: Type.String(), negativePrompt: Type.Optional(Type.String()), x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()) })) }),
        execute: async (_id, args) => {
          draft.params.characters = sanitizeParams({ ...draft.params, characters: args.characters }).characters || [];
          return apply('set_characters', { characters: draft.params.characters });
        },
      },
      {
        name: 'set_generation_params', label: '调整生成参数', description: '调整 NovelAI V4.5尺寸、步数、引导、采样器和其他参数，只传需要修改的字段。',
        parameters: Type.Object({
          width: Type.Optional(Type.Number()), height: Type.Optional(Type.Number()), steps: Type.Optional(Type.Number()), scale: Type.Optional(Type.Number()),
          sampler: Type.Optional(Type.String()), seed: Type.Optional(Type.Number()), qualityToggle: Type.Optional(Type.Boolean()), ucPreset: Type.Optional(Type.Number()),
          useCoords: Type.Optional(Type.Boolean()), variety: Type.Optional(Type.Boolean()), cfgRescale: Type.Optional(Type.Number()),
        }),
        execute: async (_id, args) => {
          draft.params = sanitizeParams({ ...draft.params, ...args });
          return apply('set_params', { params: draft.params });
        },
      },
      {
        name: 'set_vibes', label: '设置 Vibe', description: '选择最多4个已编码 Vibe及强度。Vibe和编码ID必须来自 search_vibes。',
        parameters: Type.Object({ normalizeStrengths: Type.Optional(Type.Boolean()), slots: Type.Array(Type.Object({ vibeId: Type.String(), vibeName: Type.Optional(Type.String()), encodingId: Type.String(), informationExtracted: Type.Number(), strength: Type.Number() }), { maxItems: 4 }) }),
        execute: async (_id, args) => {
          const available = new Map((contextData.vibes || []).map(item => [item.id, item]));
          const slots = args.slots.slice(0, 4).flatMap(slot => {
            const asset = available.get(slot.vibeId);
            const encoding = asset?.encodings?.find(item => item.id === slot.encodingId);
            return asset && encoding ? [{ vibeId: asset.id, vibeName: asset.name, encodingId: encoding.id, informationExtracted: encoding.informationExtracted, strength: clamp(slot.strength, 0, 1, asset.defaultStrength || 0.6) }] : [];
          });
          draft.params.vibes = { enabled: slots.length > 0, normalizeStrengths: args.normalizeStrengths !== false, slots };
          return apply('set_vibes', { vibes: draft.params.vibes });
        },
      },
      {
        name: 'request_generation', label: '请求生成', description: '用户明确要求出图时调用。前端将显示费用与二次确认，工具本身不会直接扣费。',
        parameters: Type.Object({ reason: Type.Optional(Type.String()) }),
        execute: async (_id, args) => apply('request_generation', { reason: text(args.reason).slice(0, 300) }),
      },
    ];
  }

  async run(input, emit, signal) {
    const sessionId = text(input?.sessionId || 'playground').slice(0, 200);
    if (this.runningSessions.has(sessionId)) throw Object.assign(new Error('这个实验室的 Agent 正在工作'), { status: 409 });
    const config = this.publicConfig();
    const storedCredential = this.getCredential(config.provider);
    if (!storedCredential) throw Object.assign(new Error(`请先使用“登录模型服务”配置 ${PROVIDER_CATALOG.get(config.provider)?.name || config.provider}`), { status: 400 });
    const models = listModels(config.provider);
    if (!models.some(item => item.id === config.model)) throw Object.assign(new Error('选择的模型已不可用，请在设置中重新选择'), { status: 400 });
    const draft = sanitizeDraft(input?.draft);
    const contextData = {
      presets: Array.isArray(input?.context?.presets) ? input.context.presets.slice(0, 200) : [],
      vibes: Array.isArray(input?.context?.vibes) ? input.context.vibes.slice(0, 200) : [],
    };
    this.runningSessions.add(sessionId);
    const leaveOutboundProxy = enterOutboundProxy(this.outboundProxyUrl);
    try {
      const credentials = new InMemoryCredentialStore();
      await credentials.modify(config.provider, async () => ({
        ...storedCredential,
        ...(this.outboundProxyUrl ? { env: { ...(storedCredential.env || {}), HTTPS_PROXY: this.outboundProxyUrl, HTTP_PROXY: this.outboundProxyUrl } } : {}),
      }));
      const modelRuntime = builtinModels({ credentials });
      const model = modelRuntime.getModel(config.provider, config.model);
      if (!model) throw new Error('无法加载所选模型');
      const agent = new Agent({
        initialState: {
          systemPrompt,
          model,
          thinkingLevel: model.reasoning ? 'low' : 'off',
          tools: this.createTools(draft, contextData, emit),
          messages: await this.loadMessages(sessionId),
        },
        streamFn: modelRuntime.streamSimple.bind(modelRuntime),
        sessionId: `nai-prompt-agent-${createHash('sha256').update(sessionId).digest('hex').slice(0, 20)}`,
        toolExecution: 'sequential',
      });
      const unsubscribe = agent.subscribe(event => {
        if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') emit({ type: 'text_delta', delta: event.assistantMessageEvent.delta });
        if (event.type === 'tool_execution_start') emit({ type: 'tool_start', toolName: event.toolName });
        if (event.type === 'tool_execution_end') emit({ type: 'tool_end', toolName: event.toolName, isError: event.isError });
      });
      const abort = () => agent.abort();
      signal?.addEventListener('abort', abort, { once: true });
      try { await agent.prompt(text(input?.message).slice(0, 8_000)); }
      finally { signal?.removeEventListener('abort', abort); unsubscribe(); }
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      await this.saveMessages(sessionId, agent.state.messages);
      return { draft, message: extractAssistantText(agent.state.messages), provider: config.provider, model: config.model };
    } finally {
      leaveOutboundProxy();
      this.runningSessions.delete(sessionId);
    }
  }
}
