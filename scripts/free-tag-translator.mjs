import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

export const FREE_TAG_TRANSLATOR_PROVIDERS = ['microsoft', 'transmart', 'bilibili', 'google'];

const KNOWN_FREE_PROVIDERS = new Set(FREE_TAG_TRANSLATOR_PROVIDERS);

/** 过滤并去重用户传入的免费翻译线路列表，保留原有优先级顺序；空或全无效时回退默认四线。 */
export const normalizeFreeProviders = rawProviders => {
  if (!Array.isArray(rawProviders)) return [...FREE_TAG_TRANSLATOR_PROVIDERS];
  const filtered = [...new Set(rawProviders.map(item => String(item ?? '').trim()).filter(id => KNOWN_FREE_PROVIDERS.has(id)))];
  return filtered.length ? filtered : [...FREE_TAG_TRANSLATOR_PROVIDERS];
};

export const INTERACTION_PREFIX_LABELS = Object.freeze({
  source: '发起：',
  target: '接收：',
  mutual: '互相：',
});

const MICROSOFT_URL = 'https://edge.microsoft.com/translate/translatetext?from=&to=zh-Hans&isEnterpriseClient=false';
const TRANSMART_URL = 'https://transmart.qq.com/api/imt';
const BILIBILI_URL = 'https://index-translate.bilibili.com/v1/chat/completions';
const BILIBILI_MODEL = 'Index-Translate-35B-A3B';
const GOOGLE_LIST_URL = 'https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=zh-CN&dt=t';

const BLOCKED_COOLDOWN_MS = 300_000;
const FAILURE_BASE_COOLDOWN_MS = 30_000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 6_000;
const BILIBILI_TIMEOUT_MS = 12_000;
const TOTAL_DEADLINE_MS = 25_000;

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const ASCII_LETTERS_RE = /[a-z]/i;
const INTERACTION_PREFIX_RE = /^(source|target|mutual)#\s*(.+)$/i;
const ARTIST_PREFIX_RE = /^artists?\s*:\s*/i;

const providerHealth = new Map();
const inflightUpgrades = new WeakMap();
const upgradeLocks = new WeakMap();

export const normalizeTranslationTag = value => String(value ?? '')
  .replaceAll('_', ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

export const isNativeTagText = value => CJK_RE.test(String(value ?? ''));

export const isProtectedArtistTag = value => ARTIST_PREFIX_RE.test(String(value ?? '').trim());

/** 拆分 NovelAI V5 双人互动前缀（source# / target# / mutual#），仅翻主体动作后拼回。 */
export const splitInteractionPrefix = rawTag => {
  const normalized = normalizeTranslationTag(rawTag);
  const match = normalized.match(INTERACTION_PREFIX_RE);
  if (!match) return { prefix: '', label: '', body: normalized };
  const prefix = match[1].toLowerCase();
  const body = normalizeTranslationTag(match[2]);
  return { prefix, label: INTERACTION_PREFIX_LABELS[prefix] || '', body };
};

const escapeHtmlText = text => String(text)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const decodeHtmlText = text => String(text)
  .replace(/&#(?:0*39);|&#x0*27;/gi, "'")
  .replace(/&quot;/gi, '"')
  .replace(/&gt;/gi, '>')
  .replace(/&lt;/gi, '<')
  .replace(/&amp;/gi, '&');

const cleanTranslatedTag = value => String(value ?? '')
  .replace(/<think>[\s\S]*?<\/think>/gi, '')
  .replace(/[\r\n]+/g, ' ')
  .replace(/^["'「」『』《》]+|["'「」『』《》]+$/g, '')
  .trim();

const isUnchangedEnglish = (source, translated) => {
  const src = normalizeTranslationTag(source);
  const dst = normalizeTranslationTag(translated);
  return Boolean(src && dst && src === dst && !CJK_RE.test(translated) && ASCII_LETTERS_RE.test(source));
};

/** 整批英文都被原样回显时视为线路失效；单个纯符号/缩写如 3d 不误杀整批。 */
const validateTranslatedBatch = (sources, outputs) => {
  if (!Array.isArray(outputs) || outputs.length !== sources.length) {
    throw Object.assign(new Error('译文数量与输入不匹配'), { kind: 'format' });
  }
  const cleaned = outputs.map(cleanTranslatedTag);
  if (cleaned.some(item => !item || item.includes('<think>') || item.includes('</think>'))) {
    throw Object.assign(new Error('译文包含空项或未闭合标签'), { kind: 'format' });
  }
  const meaningfulSources = sources.filter(item => ASCII_LETTERS_RE.test(item) && item.replace(/[^a-z]/gi, '').length >= 4);
  if (meaningfulSources.length > 0) {
    const unchangedCount = sources.filter((src, index) => ASCII_LETTERS_RE.test(src) && src.replace(/[^a-z]/gi, '').length >= 4 && isUnchangedEnglish(src, cleaned[index])).length;
    if (unchangedCount === meaningfulSources.length) {
      throw Object.assign(new Error('翻译接口返回未翻译原文'), { kind: 'untranslated' });
    }
  }
  return cleaned;
};

const chunkTexts = (texts, maxItems, maxChars) => {
  const groups = [];
  let current = [];
  let chars = 0;
  for (const text of texts) {
    if (current.length > 0 && (current.length >= maxItems || chars + text.length > maxChars)) {
      groups.push(current);
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += text.length;
  }
  if (current.length > 0) groups.push(current);
  return groups;
};

const combineSignal = (timeoutMs, parentSignal) => {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）`));
  }, Math.max(200, timeoutMs));
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
};

const httpStatusError = (provider, status) => Object.assign(
  new Error(`${provider} 翻译请求失败（HTTP ${status}）`),
  { statusCode: status },
);

const fetchJsonWithTimeout = async (fetchImpl, url, init, timeoutMs, parentSignal, parseText = false) => {
  const ctx = combineSignal(timeoutMs, parentSignal);
  try {
    const response = await fetchImpl(url, { ...init, signal: ctx.signal });
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      throw httpStatusError(init?.providerLabel || '免费翻译', response.status);
    }
    if (parseText) return await response.text();
    return await response.json();
  } catch (error) {
    if (parentSignal?.aborted) throw parentSignal.reason || error;
    if (ctx.didTimeout()) throw Object.assign(new Error('请求超时'), { kind: 'timeout' });
    throw error;
  } finally {
    ctx.cleanup();
  }
};

const translateMicrosoftBatch = async (texts, fetchImpl, timeoutMs, signal) => {
  const results = [];
  for (const group of chunkTexts(texts, 32, 4_000)) {
    const data = await fetchJsonWithTimeout(fetchImpl, MICROSOFT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(group.map(escapeHtmlText)),
      providerLabel: '微软翻译',
    }, timeoutMs, signal);
    if (!Array.isArray(data) || data.length !== group.length) {
      throw Object.assign(new Error('微软翻译返回格式异常'), { kind: 'format' });
    }
    const translated = data.map(item => {
      const value = Array.isArray(item?.translations) ? item.translations[0]?.text : undefined;
      return typeof value === 'string' ? decodeHtmlText(value) : '';
    });
    results.push(...validateTranslatedBatch(group, translated));
  }
  return results;
};

const translateTransmartBatch = async (texts, fetchImpl, timeoutMs, signal) => {
  const results = [];
  for (const group of chunkTexts(texts, 20, 1_000)) {
    const data = await fetchJsonWithTimeout(fetchImpl, TRANSMART_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        header: {
          fn: 'auto_translation',
          client_key: `browser-chrome-110.0.0-Windows-${randomUUID()}-${Date.now()}`,
        },
        type: 'plain',
        model_category: 'normal',
        source: { text_list: group, lang: 'auto' },
        target: { lang: 'zh' },
      }),
      providerLabel: '腾讯翻译',
    }, timeoutMs, signal);
    if (data?.header?.ret_code !== 'succ' || !Array.isArray(data.auto_translation)) {
      const status = data?.header?.ret_code === 'Auth-Failed' ? 403 : 502;
      throw httpStatusError('腾讯翻译', status);
    }
    results.push(...validateTranslatedBatch(group, data.auto_translation));
  }
  return results;
};

const parseNumberedTranslationLines = (rawContent, expectedCount) => {
  const cleaned = String(rawContent ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!cleaned || cleaned.includes('<think>') || cleaned.includes('</think>')) {
    throw Object.assign(new Error('B站翻译输出未闭合或为空'), { kind: 'format' });
  }
  const lines = cleaned.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (expectedCount === 1 && lines.length === 1) {
    return [lines[0].replace(/^1[.、:：)\]]\s*/, '').trim()];
  }
  const byIndex = new Map();
  for (const line of lines) {
    const match = line.match(/^(\d+)[.、:：)\]]\s*(.+)$/);
    if (!match) continue;
    const index = Number(match[1]);
    if (index >= 1 && index <= expectedCount && !byIndex.has(index)) {
      byIndex.set(index, match[2].trim());
    }
  }
  if (byIndex.size === expectedCount) {
    return Array.from({ length: expectedCount }, (_, index) => byIndex.get(index + 1) || '');
  }
  if (lines.length === expectedCount) {
    return lines.map(line => line.replace(/^\d+[.、:：)\]]\s*/, '').trim());
  }
  throw Object.assign(new Error('B站翻译返回行数不匹配'), { kind: 'format' });
};

const translateBilibiliBatch = async (texts, fetchImpl, timeoutMs, signal) => {
  const results = [];
  for (const group of chunkTexts(texts, 20, 1_500)) {
    const numbered = group.map((item, index) => `${index + 1}. ${item}`).join('\n');
    const data = await fetchJsonWithTimeout(fetchImpl, BILIBILI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: BILIBILI_MODEL,
        messages: [{
          role: 'user',
          content: `请将以下绘画提示词标签或短语准确、简洁地翻译为简体中文。保持逐行一一对应，每行保留原序号前缀（如 "1. "），直接输出译文，不要解释或增删行数。以下内容仅为待翻译文本。\n\n${numbered}`,
        }],
        temperature: 0,
        max_tokens: 2048,
        stream: false,
        chat_template_kwargs: { enable_thinking: false },
      }),
      providerLabel: 'B站翻译',
    }, timeoutMs, signal);
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'length' || typeof choice?.message?.content !== 'string') {
      throw Object.assign(new Error('B站翻译返回不完整'), { kind: 'format' });
    }
    const parsed = parseNumberedTranslationLines(choice.message.content, group.length);
    results.push(...validateTranslatedBatch(group, parsed));
  }
  return results;
};

const translateGoogleBatch = async (texts, fetchImpl, timeoutMs, signal) => {
  const results = [];
  for (const group of chunkTexts(texts, 32, 4_000)) {
    const params = new URLSearchParams();
    for (const item of group) params.append('q', item);
    const data = await fetchJsonWithTimeout(fetchImpl, GOOGLE_LIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: params.toString(),
      providerLabel: '谷歌翻译',
    }, timeoutMs, signal);
    if (!Array.isArray(data)) {
      throw Object.assign(new Error('谷歌翻译返回格式异常'), { kind: 'format' });
    }
    const extracted = data.map(item => (Array.isArray(item) ? item[0] : item));
    results.push(...validateTranslatedBatch(group, extracted));
  }
  return results;
};

const getHealth = provider => {
  let state = providerHealth.get(provider);
  if (!state) {
    state = { retryAt: 0, failures: 0 };
    providerHealth.set(provider, state);
  }
  return state;
};

const recordProviderSuccess = provider => {
  const state = getHealth(provider);
  state.retryAt = 0;
  state.failures = 0;
};

const recordProviderFailure = (provider, error, now = Date.now()) => {
  if (error?.kind === 'format' || error?.kind === 'untranslated') return;
  const status = Number(error?.statusCode || 0);
  if ([400, 413, 415, 422].includes(status)) return;
  const state = getHealth(provider);
  state.failures += 1;
  const cooldown = status === 429 || status === 403
    ? BLOCKED_COOLDOWN_MS
    : Math.min(BLOCKED_COOLDOWN_MS, FAILURE_BASE_COOLDOWN_MS * (2 ** Math.min(state.failures - 1, 4)));
  state.retryAt = now + cooldown;
};

export const resetFreeTranslatorHealth = () => {
  providerHealth.clear();
};

const createProxyFetch = (proxyUrl, runtimePlatform) => {
  if (!proxyUrl || runtimePlatform === 'android') return { fetchImpl: null, close: async () => {} };
  const agent = new ProxyAgent(proxyUrl);
  return {
    fetchImpl: (url, init = {}) => undiciFetch(url, { ...init, dispatcher: agent }),
    close: () => agent.close().catch(() => {}),
  };
};

/**
 * 使用免费翻译四线池按序自动回退翻译英文 Tag：
 * 微软 Edge -> 腾讯 TranSmart -> B站 Index-Translate -> Google（有代理或 Android 系统网络时）。
 */
export async function translateTagsFree(rawTags, options = {}) {
  const {
    fetchImpl = null,
    outboundProxyUrl = '',
    runtimePlatform = 'desktop',
    protectedTags = [],
    cachedBodies = new Map(),
    providers = FREE_TAG_TRANSLATOR_PROVIDERS,
    signal,
    timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
    bilibiliTimeoutMs = BILIBILI_TIMEOUT_MS,
    totalDeadlineMs = TOTAL_DEADLINE_MS,
    now = () => Date.now(),
  } = options;

  const protectedSet = new Set((Array.isArray(protectedTags) ? protectedTags : [...protectedTags]).map(normalizeTranslationTag).filter(Boolean));
  const normalizedTags = [...new Set((Array.isArray(rawTags) ? rawTags : []).map(normalizeTranslationTag).filter(Boolean))];
  const translations = new Map();
  const skipped = [];
  const tagSpecs = [];
  const bodiesToTranslate = [];
  const seenBodies = new Set();

  for (const tag of normalizedTags) {
    if (isProtectedArtistTag(tag) || protectedSet.has(tag)) {
      skipped.push(tag);
      continue;
    }
    const { prefix, label, body } = splitInteractionPrefix(tag);
    if (!body || isProtectedArtistTag(body) || protectedSet.has(body)) {
      skipped.push(tag);
      continue;
    }
    if (isNativeTagText(body)) {
      translations.set(tag, prefix ? `${label}${body}` : body);
      continue;
    }
    tagSpecs.push({ tag, prefix, label, body });
    const cachedBody = cachedBodies instanceof Map ? cachedBodies.get(body) : cachedBodies?.[body];
    if (typeof cachedBody === 'string' && cachedBody.trim()) {
      translations.set(tag, prefix ? `${label}${cachedBody.trim()}` : cachedBody.trim());
      continue;
    }
    if (!seenBodies.has(body)) {
      seenBodies.add(body);
      bodiesToTranslate.push(body);
    }
  }

  if (!bodiesToTranslate.length) {
    return { translations, provider: 'cache', skipped };
  }

  const activeProviders = normalizeFreeProviders(providers);
  const directFetch = fetchImpl || ((url, init) => undiciFetch(url, init));
  const proxyHandle = fetchImpl ? { fetchImpl, close: async () => {} } : createProxyFetch(outboundProxyUrl, runtimePlatform);

  const deadline = now() + totalDeadlineMs;
  const failures = [];
  const runProvider = async (providerId, remainingMs) => {
    const baseTimeout = providerId === 'bilibili'
      ? bilibiliTimeoutMs
      : providerId === 'google' && !outboundProxyUrl && runtimePlatform !== 'android' && !fetchImpl
        ? Math.min(timeoutMs, 4_000)
        : timeoutMs;
    const providerTimeout = Math.min(remainingMs, baseTimeout);
    if (providerId === 'microsoft') {
      return translateMicrosoftBatch(bodiesToTranslate, directFetch, providerTimeout, signal);
    }
    if (providerId === 'transmart') {
      return translateTransmartBatch(bodiesToTranslate, directFetch, providerTimeout, signal);
    }
    if (providerId === 'bilibili') {
      return translateBilibiliBatch(bodiesToTranslate, directFetch, providerTimeout, signal);
    }
    if (providerId === 'google') {
      const googleFetch = proxyHandle.fetchImpl || directFetch;
      return translateGoogleBatch(bodiesToTranslate, googleFetch, providerTimeout, signal);
    }
    throw new Error(`未知免费翻译线路：${providerId}`);
  };

  try {
    // 优先尝试未冷却线路；若全部处于冷却中则仍兜底尝试一次最早到期的，避免彻底不可用。
    const currentNow = now();
    const ready = activeProviders.filter(id => getHealth(id).retryAt <= currentNow);
    const cooling = activeProviders
      .filter(id => getHealth(id).retryAt > currentNow)
      .sort((a, b) => getHealth(a).retryAt - getHealth(b).retryAt);
    const ordered = ready.length ? [...ready, ...cooling] : cooling;

    for (const providerId of ordered) {
      if (signal?.aborted) throw signal.reason || new Error('翻译已取消');
      const remainingMs = deadline - now();
      if (remainingMs <= 300) break;
      try {
        const translatedBodies = await runProvider(providerId, remainingMs);
        recordProviderSuccess(providerId);
        const bodyMap = new Map();
        bodiesToTranslate.forEach((body, index) => {
          bodyMap.set(body, translatedBodies[index]);
          translations.set(body, translatedBodies[index]);
        });
        for (const spec of tagSpecs) {
          const bodyZh = bodyMap.get(spec.body);
          if (bodyZh) translations.set(spec.tag, spec.prefix ? `${spec.label}${bodyZh}` : bodyZh);
        }
        return { translations, provider: providerId, skipped };
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        recordProviderFailure(providerId, error, now());
        failures.push(`${providerId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const detail = failures.length ? failures.join('；') : '翻译请求超时';
    throw Object.assign(new Error(`免费翻译暂不可用（${detail}），可在设置中切换为创作助手翻译`), { statusCode: 502, status: 502 });
  } finally {
    await proxyHandle.close();
  }
}

const getBackupMap = promptAgent => {
  let map = inflightUpgrades.get(promptAgent);
  if (!map) {
    map = new Map();
    inflightUpgrades.set(promptAgent, map);
  }
  return map;
};

const entrySource = entry => (entry?.source === 'free' ? 'free' : 'ai');

const atomicWriteJson = async (filePath, payload) => {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid || 1}.${randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
};

/** 查缓存并返回精确来源（free / ai）；AI 升级期间保留旧机翻兜底，不闪烁空白。 */
export function lookupPromptTagTranslations(promptAgent, rawTags) {
  const tags = [...new Set((Array.isArray(rawTags) ? rawTags : []).map(normalizeTranslationTag).filter(Boolean))].slice(0, 50);
  const store = promptAgent?.tagTranslations || {};
  const backup = getBackupMap(promptAgent);
  return tags.flatMap(tag => {
    const entry = store[tag] || backup.get(tag);
    const chinese = String(entry?.chinese ?? '').trim();
    if (!chinese) return [];
    return [{
      tag,
      chinese,
      source: entrySource(entry),
      ...(entry?.provider ? { provider: entry.provider } : {}),
      updatedAt: entry?.updatedAt,
    }];
  });
}

/**
 * 串行持久化译文缓存：
 * - free 译文绝不覆盖任何已有缓存（free 或 ai）；
 * - ai 译文在 overwriteFree 为 true 时可覆盖旧的 free 机翻，但绝不覆盖已有 ai 译文。
 */
export function savePromptTagTranslations(promptAgent, entries, metadata = {}) {
  const source = metadata.source === 'free' ? 'free' : 'ai';
  const overwriteFree = source === 'ai' && metadata.overwriteFree !== false;
  const previous = promptAgent.tagTranslationWriteTail || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const items = { ...(promptAgent.tagTranslations || {}) };
    const now = Date.now();
    let changed = false;
    for (const [rawTag, rawChinese] of entries) {
      const tag = normalizeTranslationTag(rawTag);
      const chinese = String(rawChinese ?? '').trim();
      if (!tag || !chinese) continue;
      const existing = items[tag];
      const hasExisting = Boolean(String(existing?.chinese ?? '').trim());
      if (hasExisting) {
        if (!overwriteFree || entrySource(existing) !== 'free') continue;
      }
      items[tag] = { ...metadata, source, chinese, updatedAt: now };
      changed = true;
    }
    if (!changed) return;
    await atomicWriteJson(promptAgent.tagTranslationFilePath(), { version: 1, updatedAt: now, items });
    promptAgent.tagTranslations = items;
  });
  promptAgent.tagTranslationWriteTail = next;
  return next;
}

const serializeUpgrade = (promptAgent, fn) => {
  const prev = upgradeLocks.get(promptAgent) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  upgradeLocks.set(promptAgent, next);
  return next;
};

/** 统一处理 /api/prompt-agent/tag-translations 路由请求（桌面网关与 Android 共用）。 */
export async function handleTagTranslationRequest(promptAgent, body = {}, options = {}) {
  const action = String(body?.action || '');
  if (action === 'lookup') {
    return { items: lookupPromptTagTranslations(promptAgent, body?.tags) };
  }
  if (action !== 'translate') {
    throw Object.assign(new Error('不支持的翻译操作'), { status: 400 });
  }

  const tags = [...new Set((Array.isArray(body?.tags) ? body.tags : []).map(normalizeTranslationTag).filter(Boolean))];
  if (!tags.length) throw Object.assign(new Error('没有需要翻译的提示词'), { status: 400 });
  if (tags.length > 50) throw Object.assign(new Error('一次最多翻译 50 个提示词'), { status: 400 });

  const mode = body?.mode === 'ai' ? 'ai' : 'free';
  const overwriteFree = body?.overwriteFree === true;
  const protectedTags = Array.isArray(body?.protectedTags) ? body.protectedTags : [];
  const providers = normalizeFreeProviders(body?.providers);

  if (mode === 'free') {
    const store = promptAgent.tagTranslations || {};
    const cachedBodies = new Map();
    const missing = [];
    for (const tag of tags) {
      if (String(store[tag]?.chinese ?? '').trim()) continue;
      const { body: bodyTag } = splitInteractionPrefix(tag);
      const bodyEntry = bodyTag && store[bodyTag];
      if (bodyEntry && String(bodyEntry.chinese ?? '').trim()) {
        cachedBodies.set(bodyTag, String(bodyEntry.chinese).trim());
      }
      missing.push(tag);
    }
    if (!missing.length) {
      return { items: lookupPromptTagTranslations(promptAgent, tags), mode: 'free', cached: true };
    }
    const result = await translateTagsFree(missing, {
      outboundProxyUrl: promptAgent.outboundProxyUrl || '',
      runtimePlatform: promptAgent.runtimePlatform || 'desktop',
      protectedTags,
      cachedBodies,
      providers,
      ...options,
    });
    if (result.translations.size > 0) {
      await savePromptTagTranslations(promptAgent, result.translations, {
        source: 'free',
        provider: result.provider,
      });
    }
    return {
      items: lookupPromptTagTranslations(promptAgent, tags),
      mode: 'free',
      provider: result.provider,
      skipped: result.skipped,
      cached: result.provider === 'cache',
    };
  }

  // AI 模式：支持直接翻译缺失项，并在 overwriteFree=true 时安全升级旧的 free 机翻缓存。
  return serializeUpgrade(promptAgent, async () => {
    const store = promptAgent.tagTranslations || {};
    const upgradeTargets = overwriteFree
      ? tags.filter(tag => String(store[tag]?.chinese ?? '').trim() && entrySource(store[tag]) === 'free')
      : [];
    const backup = getBackupMap(promptAgent);
    const savedOriginals = new Map();
    if (upgradeTargets.length) {
      await (promptAgent.tagTranslationWriteTail || Promise.resolve()).catch(() => {});
      const nextStore = { ...promptAgent.tagTranslations };
      for (const tag of upgradeTargets) {
        if (nextStore[tag] && entrySource(nextStore[tag]) === 'free') {
          savedOriginals.set(tag, nextStore[tag]);
          backup.set(tag, nextStore[tag]);
          delete nextStore[tag];
        }
      }
      promptAgent.tagTranslations = nextStore;
    }
    try {
      const response = await promptAgent.translateTags(tags);
      return {
        ...response,
        items: lookupPromptTagTranslations(promptAgent, tags),
        mode: 'ai',
      };
    } catch (error) {
      if (savedOriginals.size) {
        const restored = { ...promptAgent.tagTranslations };
        for (const [tag, entry] of savedOriginals) {
          if (!String(restored[tag]?.chinese ?? '').trim()) restored[tag] = entry;
        }
        promptAgent.tagTranslations = restored;
      }
      throw error;
    } finally {
      for (const tag of savedOriginals.keys()) backup.delete(tag);
    }
  });
}
