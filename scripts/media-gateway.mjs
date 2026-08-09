import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { connect as connectSocket } from 'node:net';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { PromptAgentService } from './prompt-agent.mjs';
import { StChatu8Bridge } from './st-chatu8-bridge.mjs';

const CACHE_VERSION = 'v1';
const CACHE_DIR = join(process.cwd(), 'local-cache', 'thumbnails');
const CACHE_INDEX = join(CACHE_DIR, 'index.json');
const VIBE_RECOVERY_DIR = join(process.cwd(), 'local-data', 'vibe-recovery');
const CLOUD_QUEUE_CONFIG_FILE = join(process.cwd(), 'local-data', 'cloud-queue.json');
const CACHE_LIMIT = 1024 * 1024 * 1024;
const CACHE_PRUNE_TARGET = 900 * 1024 * 1024;
const SOURCE_LIMIT = 2048;
const INPUT_LIMIT = 30 * 1024 * 1024;
const GENERATION_REQUEST_LIMIT = 20 * 1024 * 1024;
const VIBE_ENCODING_CACHE_LIMIT = 128 * 1024 * 1024;
const PRECISE_REFERENCE_CACHE_LIMIT = 128 * 1024 * 1024;
const NAI_GENERATE_URL = 'https://image.novelai.net/ai/generate-image';
const NAI_ENCODE_VIBE_URL = 'https://image.novelai.net/ai/encode-vibe';
const CLOUD_QUEUE_URL = 'https://st-chatu-novelai-queue.hf.space';
const CLOUD_QUEUE_POLL_INTERVAL = 1000;
const CLOUD_QUEUE_MAX_FAILURES = 3;
const CLOUD_QUEUE_STATUS_TTL = 5 * 60 * 1000;
const ALLOWED_REMOTE_HOSTS = new Set(['ai-img.10118899.xyz', 'aitag.win']);
const ALLOWED_AITAG_API_PATHS = [
  /^\/api\/config$/,
  /^\/api\/ai_works_search$/,
  /^\/api\/rank\/monthly\/(?:real|fixed)$/,
  /^\/api\/work\/\d+$/,
];
const THUMB_WIDTHS = new Map([['thumb-320', 320], ['thumb-640', 640]]);
const vibeEncodingJobs = new Map();
const pendingVibeRecoveries = new Map();
const vibeCacheHmacSecret = randomBytes(32);
const confirmedNovelAiVibeCacheKeys = new Set();
const preciseReferenceImageCache = new Map();
let preciseReferenceImageCacheSize = 0;
const preciseReferenceImageJobs = new Map();

const loadCloudQueuePreferences = async () => {
  try {
    const saved = JSON.parse(await readFile(CLOUD_QUEUE_CONFIG_FILE, 'utf8'));
    return {
      enabled: saved.enabled === true,
      greeting: String(saved.greeting || '正在生成中～').trim().slice(0, 15),
      showGreeting: saved.showGreeting !== false,
    };
  } catch {
    return { enabled: false, greeting: '正在生成中～', showGreeting: true };
  }
};

let cloudQueueConfigWrite = Promise.resolve();
const saveCloudQueuePreferences = preferences => {
  const snapshot = { ...preferences };
  cloudQueueConfigWrite = cloudQueueConfigWrite.catch(() => {}).then(async () => {
    await mkdir(join(process.cwd(), 'local-data'), { recursive: true });
    const temporary = `${CLOUD_QUEUE_CONFIG_FILE}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await rename(temporary, CLOUD_QUEUE_CONFIG_FILE);
  });
  return cloudQueueConfigWrite;
};

const delay = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  const finish = () => {
    signal?.removeEventListener('abort', abort);
    resolve();
  };
  const timer = setTimeout(finish, milliseconds);
  const abort = () => {
    clearTimeout(timer);
    reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  };
  signal?.addEventListener('abort', abort, { once: true });
});

const readQueueJson = async response => {
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text || '{}'); } catch { payload = null; }
  if (!response.ok) {
    const error = new Error(payload?.detail || text || `队列服务返回 ${response.status}`);
    error.status = 503;
    error.code = 'CLOUD_QUEUE_UNAVAILABLE';
    throw error;
  }
  return payload || {};
};

export class CloudQueueCoordinator {
  constructor(requestRemote, baseUrl = CLOUD_QUEUE_URL) {
    this.requestRemote = requestRemote;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.clientId = randomUUID();
    this.tasks = new Map();
  }

  update(taskId, patch) {
    const previous = this.tasks.get(taskId) || { taskId };
    const next = { ...previous, ...patch, updatedAt: Date.now() };
    this.tasks.set(taskId, next);
    for (const [id, status] of this.tasks) {
      if (Date.now() - status.updatedAt > CLOUD_QUEUE_STATUS_TTL) this.tasks.delete(id);
    }
    return next;
  }

  get(taskId) {
    return this.tasks.get(taskId) || null;
  }

  async post(path, body) {
    return readQueueJson(await this.requestRemote(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    }));
  }

  async join({ apiKey, taskId, greeting = '', showGreeting = true, signal }) {
    const keyHash = createHash('sha256').update(apiKey).digest('hex');
    const userId = this.clientId;
    const common = { key_hash: keyHash, user_id: userId, task_id: taskId };
    this.update(taskId, { phase: 'joining', position: null, queueSize: null, greeting: null, cancelable: true });
    const joined = await this.post('/join-queue', { ...common, greeting: String(greeting).trim().slice(0, 15) || null });
    if (signal?.aborted) {
      await this.post('/leave-queue', { ...common, lock_token: joined.lock_token || null }).catch(() => {});
      throw signal.reason || new DOMException('Aborted', 'AbortError');
    }
    this.update(taskId, {
      phase: joined.position === 0 && joined.lock_token ? 'ready' : 'waiting',
      position: Number(joined.position) || 0,
      queueSize: Number(joined.queue_size) || 1,
      cancelable: true,
    });
    if (joined.position === 0 && joined.lock_token) return { ...common, lockToken: joined.lock_token };

    let failures = 0;
    try {
      while (true) {
        await delay(CLOUD_QUEUE_POLL_INTERVAL, signal);
        try {
        const query = new URLSearchParams(common).toString();
        const status = await readQueueJson(await this.requestRemote(`${this.baseUrl}/my-turn?${query}`, {
          signal: AbortSignal.timeout(15_000),
        }));
        failures = 0;
        if (status.is_my_turn && status.lock_token) {
          this.update(taskId, { phase: 'ready', position: 0, queueSize: Number(status.queue_size) || 1, cancelable: true });
          return { ...common, lockToken: status.lock_token };
        }
        this.update(taskId, {
          phase: 'waiting',
          position: Number(status.position) || 0,
          queueSize: Number(status.queue_size) || 1,
          greeting: showGreeting ? String(status.current_greeting || '').slice(0, 15) : null,
          cancelable: true,
        });
        } catch (error) {
          failures++;
          if (failures >= CLOUD_QUEUE_MAX_FAILURES) throw error;
        }
      }
    } catch (error) {
      await this.post('/leave-queue', { ...common, lock_token: null }).catch(() => {});
      throw error;
    }
  }

  async release(lock, leave = false) {
    if (!lock) return;
    const path = leave ? '/leave-queue' : '/complete';
    await this.post(path, {
      key_hash: lock.key_hash,
      user_id: lock.user_id,
      task_id: lock.task_id,
      lock_token: lock.lockToken || null,
    }).catch(() => {});
  }
}

export const classifyAitagRemoteTarget = value => {
  let target;
  try { target = new URL(value); } catch { return null; }
  if (target.protocol !== 'https:' || target.username || target.password) return null;
  const hostname = target.hostname.toLowerCase();
  if (hostname === 'aitag.win' && ALLOWED_AITAG_API_PATHS.some(pattern => pattern.test(target.pathname))) return 'json';
  if (hostname === 'ai-img.10118899.xyz' && target.pathname.startsWith('/')) return 'image';
  return null;
};

const normalizeIp = value => String(value || '').replace(/^::ffff:/, '');
const isLoopbackIp = value => {
  const ip = normalizeIp(value).toLowerCase();
  return ip === '::1' || ip === 'localhost' || /^127\./.test(ip);
};
const isLoopbackHost = host => {
  const value = String(host || '').toLowerCase();
  const hostname = value.startsWith('[') ? value.slice(1, value.indexOf(']')) : value.split(':')[0];
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
};

const parseCookies = header => Object.fromEntries(String(header || '').split(';').map(part => {
  const index = part.indexOf('=');
  return index < 0 ? ['', ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
}).filter(([key]) => key));

const getForwardHost = req => {
  const requestedHost = req.headers.host || 'localhost:3000';
  if (isLoopbackIp(req.socket.remoteAddress) || !isLoopbackHost(requestedHost)) return requestedHost;
  const localAddress = normalizeIp(req.socket.localAddress) || '0.0.0.0';
  const port = requestedHost.match(/:(\d+)$/)?.[1] || '3000';
  return `${localAddress.includes(':') ? `[${localAddress}]` : localAddress}:${port}`;
};

const hasValidLanCookie = (req, secret) => {
  if (isLoopbackIp(req.socket.remoteAddress)) return true;
  if (!secret) return false;
  const token = parseCookies(req.headers.cookie).nai_lan_access;
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const [expiresAt, nonce, signature] = parts;
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Date.now() || !nonce || !signature) return false;
  const expected = createHmac('sha256', secret).update(`${expiresAt}.${nonce}`).digest('base64url');
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
};

const sendJson = (res, status, payload) => {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

const isLoopbackOrigin = value => {
  try {
    const url = new URL(String(value || ''));
    return (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(url.hostname);
  } catch { return false; }
};

const sendBridgeJson = (req, res, status, payload) => {
  const body = Buffer.from(JSON.stringify(payload));
  const origin = isLoopbackOrigin(req.headers.origin) ? req.headers.origin : '';
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  res.end(body);
};

const readRequestBody = (req, limit) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.setTimeout(30_000, () => req.destroy(new Error('Request body timed out')));
  req.on('data', chunk => {
    size += chunk.length;
    if (size > limit) {
      req.destroy();
      const error = new Error('Request body is too large');
      error.status = 413;
      reject(error);
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks, size)));
  req.on('error', reject);
});

const requestWorkerJson = (path, req, workerPort, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const upstream = httpRequest({
    hostname: '127.0.0.1', port: workerPort, path, method,
    headers: {
      accept: 'application/json', 'content-type': 'application/json', cookie: req.headers.cookie || '',
      host: getForwardHost(req), 'user-agent': req.headers['user-agent'] || 'NaiPromptManager-MediaGateway',
      'x-forwarded-for': normalizeIp(req.socket.remoteAddress),
      'x-nai-client-ip': normalizeIp(req.socket.remoteAddress),
      ...(payload ? { 'content-length': payload.length } : {}),
    },
  }, async upstreamRes => {
    const chunks = [];
    for await (const chunk of upstreamRes) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    let parsed;
    try { parsed = JSON.parse(text || '{}'); } catch { parsed = { error: text || '电脑数据服务返回异常' }; }
    if ((upstreamRes.statusCode || 500) >= 400) {
      const error = new Error(parsed.error || '电脑数据服务请求失败');
      error.status = upstreamRes.statusCode || 500;
      reject(error);
    } else resolve(parsed);
  });
  upstream.setTimeout(30_000, () => upstream.destroy(new Error('电脑数据服务超时')));
  upstream.on('error', reject);
  if (payload) upstream.write(payload);
  upstream.end();
});

const requestTagDictionaryControl = method => new Promise((resolve, reject) => {
  const upstream = httpRequest({
    hostname: '127.0.0.1', port: 3002, path: '/tag-dictionary', method,
    headers: { accept: 'application/json', 'x-nai-local-control': 'true' },
  }, async upstreamRes => {
    const chunks = [];
    for await (const chunk of upstreamRes) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let parsed;
    try { parsed = JSON.parse(raw || '{}'); } catch { parsed = { error: raw || 'Tag更新服务返回异常' }; }
    if ((upstreamRes.statusCode || 500) >= 400) reject(Object.assign(new Error(parsed.error || 'Tag更新服务请求失败'), { status: upstreamRes.statusCode || 500 }));
    else resolve(parsed);
  });
  upstream.setTimeout(10_000, () => upstream.destroy(new Error('Tag更新服务超时')));
  upstream.on('error', error => reject(Object.assign(new Error(`Tag更新服务不可用：${error.message}`), { status: 503 })));
  upstream.end();
});

export const normalizeVibeStrengths = slots => {
  const values = slots.map(slot => Math.max(0, Math.min(1, Number(slot.strength) || 0)));
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 1 ? values.map(value => value / total) : values;
};

const PRECISE_REFERENCE_TYPES = new Map([
  ['character', 'character'],
  ['style', 'style'],
  ['character_style', 'character&style'],
]);

const PRECISE_REFERENCE_CANVASES = [
  { width: 1024, height: 1536 },
  { width: 1472, height: 1472 },
  { width: 1536, height: 1024 },
];

export const selectPreciseReferenceCanvas = (width, height) => {
  const ratio = Math.max(1, Number(width) || 1) / Math.max(1, Number(height) || 1);
  const selected = PRECISE_REFERENCE_CANVASES.reduce((best, candidate) => {
    const distance = Math.abs(Math.log(ratio / (candidate.width / candidate.height)));
    return distance < best.distance ? { ...candidate, distance } : best;
  }, { ...PRECISE_REFERENCE_CANVASES[0], distance: Number.POSITIVE_INFINITY });
  return { width: selected.width, height: selected.height };
};

const preparePreciseReferenceImage = async (key, buffer) => {
  const cached = preciseReferenceImageCache.get(key);
  if (cached) {
    preciseReferenceImageCache.delete(key);
    preciseReferenceImageCache.set(key, cached);
    return cached.data;
  }
  if (preciseReferenceImageJobs.has(key)) return preciseReferenceImageJobs.get(key);
  const job = (async () => {
    const { default: sharp } = await import('sharp');
    const source = sharp(buffer, { failOn: 'warning', limitInputPixels: 100_000_000 }).rotate();
    const metadata = await source.metadata();
    if (!metadata.width || !metadata.height) throw new Error('角色参考图片尺寸无效');
    const canvas = selectPreciseReferenceCanvas(metadata.width, metadata.height);
    const output = await source
      .resize({ width: canvas.width, height: canvas.height, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .png({ compressionLevel: 7, adaptiveFiltering: true })
      .toBuffer();
    const data = output.toString('base64');
    const size = output.length;
    while (preciseReferenceImageCacheSize + size > PRECISE_REFERENCE_CACHE_LIMIT && preciseReferenceImageCache.size) {
      const oldestKey = preciseReferenceImageCache.keys().next().value;
      const oldest = preciseReferenceImageCache.get(oldestKey);
      preciseReferenceImageCache.delete(oldestKey);
      preciseReferenceImageCacheSize -= oldest.size;
    }
    if (size <= PRECISE_REFERENCE_CACHE_LIMIT) {
      preciseReferenceImageCache.set(key, { data, size });
      preciseReferenceImageCacheSize += size;
    }
    return data;
  })().finally(() => preciseReferenceImageJobs.delete(key));
  preciseReferenceImageJobs.set(key, job);
  return job;
};

const clampRange = (value, fallback, minimum, maximum) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
};

const stripImageDataUrl = value => {
  const input = String(value || '');
  const match = input.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  return match ? { mimeType: match[1].toLowerCase(), data: match[2].replace(/\s+/g, '') } : { data: input.replace(/\s+/g, '') };
};

/** Build official NovelAI V4.5 Precise Reference fields from trusted Worker data. */
export const buildPreciseReferenceParameters = (slots, resolvedAssets) => {
  if (!Array.isArray(slots) || !slots.length) return {};
  if (slots.length > 4) throw new Error('一次最多使用 4 个角色参考');
  if (!Array.isArray(resolvedAssets) || resolvedAssets.length !== slots.length) throw new Error('角色参考图片数量不一致');
  const images = resolvedAssets.map((item, index) => {
    const parsed = stripImageDataUrl(item?.imageData ?? item?.data);
    const mimeType = String(item?.mimeType || parsed.mimeType || '').toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error(`角色参考 ${index + 1} 的图片格式不受支持`);
    if (!parsed.data || parsed.data.length < 100) throw new Error(`角色参考 ${index + 1} 的图片缺失或已损坏`);
    return parsed.data;
  });
  const descriptions = slots.map((slot, index) => {
    const baseCaption = PRECISE_REFERENCE_TYPES.get(slot?.type);
    if (!baseCaption) throw new Error(`角色参考 ${index + 1} 的参考类型无效`);
    return { caption: { base_caption: baseCaption, char_captions: [] }, legacy_uc: false };
  });
  // NovelAI's numeric inputs accept values below zero when entered directly.
  // Keep the UI's conservative -1..2 guard while leaving information extracted
  // on its own documented 0..1 scale.
  const fidelity = slots.map(slot => clampRange(slot?.fidelity, 0.6, -1, 2));
  return {
    director_reference_images: images,
    director_reference_descriptions: descriptions,
    director_reference_information_extracted: slots.map(slot => clampRange(slot?.informationExtracted, 1, 0, 1)),
    director_reference_strength_values: slots.map(slot => clampRange(slot?.strength, 0.6, -1, 2)),
    director_reference_secondary_strength_values: fidelity.map(value => 1 - value),
  };
};

/** Remove every browser-controlled Precise Reference field before rebuilding it. */
export const clearPreciseReferenceParameters = parameters => {
  for (const key of [
    '_local_character_references',
    'director_reference_images',
    'director_reference_images_cached',
    'director_reference_descriptions',
    'director_reference_information_extracted',
    'director_reference_strength_values',
    'director_reference_secondary_strength_values',
  ]) delete parameters[key];
  return parameters;
};

/** NovelAI's current V4/V4.5 cost formula for the generation features supported here. */
export const estimateNovelAiGenerationCost = payload => {
  const parameters = payload?.parameters || {};
  const width = Math.max(1, Number(parameters.width) || 1);
  const height = Math.max(1, Number(parameters.height) || 1);
  const area = Math.max(65_536, width * height);
  const steps = Math.max(1, Number(parameters.steps) || 1);
  const samples = Math.max(1, Math.floor(Number(parameters.n_samples) || 1));
  const raw = Math.ceil(2.951823174884865e-6 * area + 5.753298233447344e-7 * area * steps);
  const smeaMultiplier = parameters.sm_dyn ? 1.4 : parameters.sm ? 1.2 : 1;
  const strength = parameters.mask
    ? Number(parameters.inpaintImg2ImgStrength ?? 1)
    : parameters.image ? Number(parameters.strength ?? 1) : 1;
  const baseCost = Math.max(Math.ceil(raw * smeaMultiplier * Math.max(0, strength)), 2);
  const preciseReferences = Array.isArray(parameters.director_reference_images_cached)
    ? parameters.director_reference_images_cached.length
    : Array.isArray(parameters.director_reference_images) ? parameters.director_reference_images.length : 0;
  // Precise Reference is a per-reference surcharge, not an img2img base image.
  const isPlainGeneration = payload?.action === 'generate' && !parameters.image && !parameters.mask;
  const freeSamples = isPlainGeneration && area <= 1_048_576 && steps <= 28 ? 1 : 0;
  const base = baseCost * Math.max(0, samples - freeSamples);
  const vibeCount = Array.isArray(parameters.reference_image_multiple_cached)
    ? parameters.reference_image_multiple_cached.length
    : Array.isArray(parameters.reference_image_multiple) ? parameters.reference_image_multiple.length : 0;
  return base + Math.max(0, vibeCount - 4) * 2 * samples + preciseReferences * 5 * samples;
};

const spendAnlasBudget = async (req, workerPort, amount, reason) => {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  try {
    return await requestWorkerJson('/api/anlas-budget', req, workerPort, {
      method: 'POST',
      body: { amount: Math.floor(amount), reason },
    });
  } catch {
    // Budget tracking must never discard an image or paid Vibe encoding.
    return null;
  }
};

export class VibeEncodingMemoryCache {
  constructor(limit = VIBE_ENCODING_CACHE_LIMIT) {
    this.limit = limit;
    this.total = 0;
    this.entries = new Map();
    this.inFlight = new Map();
  }

  async get(key, loader) {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.value;
    }
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const promise = Promise.resolve().then(loader).then(value => {
      const encoding = String(value?.encoding || '');
      const size = Buffer.byteLength(encoding, 'base64');
      if (encoding && size > 0 && size <= this.limit) {
        while (this.total + size > this.limit && this.entries.size) {
          const oldestKey = this.entries.keys().next().value;
          const oldest = this.entries.get(oldestKey);
          this.entries.delete(oldestKey);
          this.total -= oldest.size;
        }
        this.entries.set(key, { value, size });
        this.total += size;
      }
      return value;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
}

const vibeEncodingMemoryCache = new VibeEncodingMemoryCache();

export const getVibeCacheSecretKey = encoding => createHmac('sha256', vibeCacheHmacSecret)
  .update(String(encoding || ''))
  .digest('hex');

export const buildCachedVibeReferences = (encodings, includeDataFor = null) => encodings.map(encoding => {
  const cacheSecretKey = getVibeCacheSecretKey(encoding);
  const includeData = includeDataFor
    ? includeDataFor.has(cacheSecretKey)
    : !confirmedNovelAiVibeCacheKeys.has(cacheSecretKey);
  return {
    cache_secret_key: cacheSecretKey,
    ...(includeData ? { data: encoding } : {}),
  };
});

export const parseInvalidVibeCacheKeys = async response => {
  if (response.status !== 400) return null;
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    if (payload?.message === 'INVALID_CACHE_KEYS' && Array.isArray(payload?.details?.invalidKeys)) {
      return { invalidKeys: new Set(payload.details.invalidKeys.map(String)), text };
    }
  } catch {
    // The caller will return the original non-JSON error body.
  }
  return { invalidKeys: null, text };
};

export const fetchNovelAiGeneration = (payload, authorization, signal = AbortSignal.timeout(300_000), requestRemote = fetch) => requestRemote(NAI_GENERATE_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': authorization,
  },
  body: JSON.stringify(payload),
  signal,
});

export const generateWithVibeCacheRetry = async (
  payload,
  authorization,
  encodings,
  cacheKeysSentWithData,
  requestGeneration = fetchNovelAiGeneration,
) => {
  let response = await requestGeneration(payload, authorization);
  if (response.status === 400) {
    const parsed = await parseInvalidVibeCacheKeys(response);
    if (parsed?.invalidKeys?.size) {
      const knownKeys = new Set(encodings.map(getVibeCacheSecretKey));
      const invalidKeys = new Set([...parsed.invalidKeys].filter(key => knownKeys.has(key)));
      if (invalidKeys.size) {
        for (const key of invalidKeys) confirmedNovelAiVibeCacheKeys.delete(key);
        const retryWithData = new Set([...cacheKeysSentWithData, ...invalidKeys]);
        payload.parameters.reference_image_multiple_cached = buildCachedVibeReferences(encodings, retryWithData);
        response = await requestGeneration(payload, authorization);
      } else {
        return new Response(parsed.text, { status: 400, headers: response.headers });
      }
    } else if (parsed) {
      return new Response(parsed.text, { status: 400, headers: response.headers });
    }
  }
  if (response.ok) {
    for (const key of cacheKeysSentWithData) confirmedNovelAiVibeCacheKeys.add(key);
    for (const item of payload.parameters.reference_image_multiple_cached || []) {
      if (item.data) confirmedNovelAiVibeCacheKeys.add(item.cache_secret_key);
    }
  }
  return response;
};

const internalWorkerRequest = {
  headers: {},
  socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' },
};

const saveVibeRecovery = async recovery => {
  await mkdir(VIBE_RECOVERY_DIR, { recursive: true });
  const key = `${recovery.vibeId}:nai-diffusion-4-5-full:${Number(recovery.informationExtracted).toFixed(2)}`;
  const file = join(VIBE_RECOVERY_DIR, `${createHash('sha256').update(key).digest('hex')}.json`);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(recovery), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
  pendingVibeRecoveries.set(key, { ...recovery, file });
};

const commitVibeRecovery = async (recovery, req, workerPort) => {
  const stored = await requestWorkerJson(`/api/vibes/${encodeURIComponent(recovery.vibeId)}/encoding-result`, req, workerPort, {
    method: 'POST',
    body: { informationExtracted: recovery.informationExtracted, encodingBase64: recovery.encodingBase64 },
  });
  if (recovery.file) await unlink(recovery.file).catch(() => {});
  const key = `${recovery.vibeId}:nai-diffusion-4-5-full:${Number(recovery.informationExtracted).toFixed(2)}`;
  pendingVibeRecoveries.delete(key);
  return stored;
};

const recoverPendingVibeEncodings = async workerPort => {
  await mkdir(VIBE_RECOVERY_DIR, { recursive: true });
  for (const name of await readdir(VIBE_RECOVERY_DIR).catch(() => [])) {
    if (!name.endsWith('.json')) continue;
    const file = join(VIBE_RECOVERY_DIR, name);
    try {
      const recovery = { ...JSON.parse(await readFile(file, 'utf8')), file };
      const key = `${recovery.vibeId}:nai-diffusion-4-5-full:${Number(recovery.informationExtracted).toFixed(2)}`;
      pendingVibeRecoveries.set(key, recovery);
      await commitVibeRecovery(recovery, internalWorkerRequest, workerPort);
    } catch {
      // Keep the paid encoding for the next startup or retry. Never log its contents.
    }
  }
};

const handleGenerateRequest = async (req, res, lanSecret, workerPort, cloudQueue, queuePreferences, requestRemote) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) return sendJson(res, 401, { error: '缺少 NovelAI API Key' });

  const queueEnabled = queuePreferences.enabled === true;
  const requestedTaskId = String(req.headers['x-nai-queue-task-id'] || '');
  const queueTaskId = /^[a-zA-Z0-9-]{8,80}$/.test(requestedTaskId) ? requestedTaskId : randomUUID();
  const queueGreeting = String(queuePreferences.greeting || '').slice(0, 15);
  const showQueueGreeting = queuePreferences.showGreeting !== false;
  const requestController = new AbortController();
  const generationSignal = AbortSignal.any([requestController.signal, AbortSignal.timeout(300_000)]);
  let queueLock = null;
  let requestAborted = false;
  const abortRequest = () => {
    requestAborted = true;
    requestController.abort(new DOMException('用户已取消排队', 'AbortError'));
  };
  req.once('aborted', abortRequest);
  if (queueEnabled) cloudQueue.update(queueTaskId, { phase: 'preparing', cancelable: true, controller: requestController });

  try {
    const rawBody = await readRequestBody(req, GENERATION_REQUEST_LIMIT);
    let payload;
    try { payload = JSON.parse(rawBody.toString('utf8')); } catch { return sendJson(res, 400, { error: '生图请求不是有效 JSON' }); }
    const localVibes = payload?.parameters?._local_vibes;
    const localCharacterReferences = payload?.parameters?._local_character_references;
    if (localVibes?.enabled && localVibes?.slots?.length && localCharacterReferences?.enabled && localCharacterReferences?.slots?.length) {
      return sendJson(res, 400, { error: 'Vibe Transfer 与角色参考不能同时使用' });
    }
    let resolvedVibeEncodings = null;
    let vibeCacheKeysSentWithData = new Set();
    if (localVibes?.enabled && Array.isArray(localVibes.slots) && localVibes.slots.length) {
      const slots = localVibes.slots.slice(0, 4);
      if (localVibes.slots.length > 4) return sendJson(res, 400, { error: '一次最多使用 4 个 Vibe' });
      const resolved = await Promise.all(slots.map(slot => vibeEncodingMemoryCache.get(
        `${slot.vibeId}:${slot.encodingId}`,
        () => requestWorkerJson(`/api/vibes/${encodeURIComponent(slot.vibeId)}/encodings/${encodeURIComponent(slot.encodingId)}/data`, req, workerPort)
      )));
      for (const item of resolved) {
        if (item.variant?.model !== 'nai-diffusion-4-5-full') return sendJson(res, 400, { error: 'Vibe 缺少 V4.5 Full 编码' });
        if (typeof item.encoding !== 'string' || item.encoding.length < 100) return sendJson(res, 400, { error: 'Vibe 永久编码缺失或已损坏' });
      }
      resolvedVibeEncodings = resolved.map(item => item.encoding);
      delete payload.parameters.reference_image_multiple;
      delete payload.parameters.reference_information_extracted_multiple;
      delete payload.parameters.reference_image_multiple_cached;
      payload.parameters.reference_image_multiple_cached = buildCachedVibeReferences(resolvedVibeEncodings);
      payload.parameters.reference_strength_multiple = localVibes.normalizeStrengths === false
        ? slots.map(slot => Math.max(0, Math.min(1, Number(slot.strength) || 0)))
        : normalizeVibeStrengths(slots);
      payload.parameters.normalize_reference_strength_multiple = false;
      if (payload.parameters.reference_image_multiple_cached.length !== payload.parameters.reference_strength_multiple.length) {
        return sendJson(res, 400, { error: 'Vibe 编码与强度数量不一致' });
      }
      vibeCacheKeysSentWithData = new Set(payload.parameters.reference_image_multiple_cached
        .filter(item => item.data)
        .map(item => item.cache_secret_key));
    }
    if (payload?.parameters) {
      delete payload.parameters._local_vibes;
      const characterSlots = localCharacterReferences?.enabled && Array.isArray(localCharacterReferences.slots)
        ? localCharacterReferences.slots
        : [];
      clearPreciseReferenceParameters(payload.parameters);
      if (characterSlots.length) {
        if (payload.model !== 'nai-diffusion-4-5-full') return sendJson(res, 400, { error: '角色参考仅支持 NovelAI V4.5 Full' });
        if (characterSlots.length > 4) return sendJson(res, 400, { error: '一次最多使用 4 个角色参考' });
        if (characterSlots.some(slot => typeof slot?.assetId !== 'string' || !slot.assetId.trim())) {
          return sendJson(res, 400, { error: '角色参考缺少有效的本地资产 ID' });
        }
        const resolved = await Promise.all(characterSlots.map(async slot => {
          const image = await requestWorkerBuffer(
            `/api/character-references/${encodeURIComponent(slot.assetId)}/image`, req, workerPort
          );
          if (image.status >= 400 || !image.buffer.length) {
            throw Object.assign(new Error(`角色参考“${slot.assetName || slot.assetId}”的原图不存在`), { status: image.status || 404 });
          }
          const etag = String(image.headers.etag || image.headers['last-modified'] || 'immutable');
          return {
            data: await preparePreciseReferenceImage(`${slot.assetId}:${etag}`, image.buffer),
            mimeType: 'image/png',
          };
        }));
        try {
          Object.assign(payload.parameters, buildPreciseReferenceParameters(characterSlots, resolved));
        } catch (error) {
          return sendJson(res, 400, { error: error?.message || '角色参考参数无效' });
        }
      }
    }
    if (queueEnabled) {
      queueLock = await cloudQueue.join({
        apiKey: authorization.slice(7).trim(),
        taskId: queueTaskId,
        greeting: queueGreeting,
        showGreeting: showQueueGreeting,
        signal: requestController.signal,
      });
      cloudQueue.update(queueTaskId, { phase: 'generating', position: 0, cancelable: false, controller: requestController });
      await delay(1000, requestController.signal);
    }
    const response = resolvedVibeEncodings
      ? await generateWithVibeCacheRetry(
        payload,
        authorization,
        resolvedVibeEncodings,
        vibeCacheKeysSentWithData,
        (nextPayload, nextAuthorization) => fetchNovelAiGeneration(nextPayload, nextAuthorization, generationSignal, requestRemote),
      )
      : await fetchNovelAiGeneration(payload, authorization, generationSignal, requestRemote);
    const estimatedCost = response.ok ? estimateNovelAiGenerationCost(payload) : 0;
    const anlasBudget = estimatedCost > 0
      ? await spendAnlasBudget(req, workerPort, estimatedCost, 'generation')
      : null;
    const headers = {
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(anlasBudget ? { 'X-Nai-Anlas-Remaining': String(anlasBudget.remaining), 'X-Nai-Anlas-Spent': String(estimatedCost) } : {}),
    };
    const contentLength = response.headers.get('content-length');
    const contentDisposition = response.headers.get('content-disposition');
    if (contentLength) headers['Content-Length'] = contentLength;
    if (contentDisposition) headers['Content-Disposition'] = contentDisposition;
    if (queueEnabled) headers['X-Nai-Queue-Task-Id'] = queueTaskId;
    if (queueEnabled) cloudQueue.update(queueTaskId, { phase: 'completed', cancelable: false, controller: null });
    res.writeHead(response.status, headers);
    if (!response.body) return res.end();
    Readable.fromWeb(response.body).on('error', error => res.destroy(error)).pipe(res);
  } catch (error) {
    if (queueEnabled) cloudQueue.update(queueTaskId, {
      phase: requestAborted || error?.name === 'AbortError' ? 'cancelled' : 'error',
      error: requestAborted ? '已取消排队' : (error.message || '队列服务不可用'),
      cancelable: false,
      controller: null,
    });
    if (res.headersSent) return res.destroy(error);
    if (error?.code === 'CLOUD_QUEUE_UNAVAILABLE') return sendJson(res, 503, { error: `公共队列服务不可用：${error.message}`, code: error.code });
    if (requestAborted || error?.name === 'AbortError') return sendJson(res, 499, { error: '已取消排队', code: 'QUEUE_CANCELLED' });
    if (Number(error.status)) return sendJson(res, Number(error.status), { error: error.message });
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return sendJson(res, timedOut ? 504 : 502, {
      error: timedOut
        ? '电脑连接 NovelAI 超时，请检查电脑 VPN 后重试'
        : '电脑无法连接 NovelAI，请检查电脑 VPN 是否正常连接',
      code: timedOut ? 'NAI_PROXY_TIMEOUT' : 'NAI_PROXY_UNREACHABLE',
    });
  } finally {
    req.off('aborted', abortRequest);
    if (queueLock) await cloudQueue.release(queueLock, requestAborted);
  }
};

const handleVibeEncodeRequest = async (req, res, lanSecret, workerPort, vibeId, requestRemote) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) return sendJson(res, 401, { error: '缺少 NovelAI API Key' });
  try {
    const body = JSON.parse((await readRequestBody(req, 64 * 1024)).toString('utf8'));
    const informationExtracted = Math.round(Number(body.informationExtracted) * 100) / 100;
    if (!Number.isFinite(informationExtracted) || informationExtracted < 0 || informationExtracted > 1) {
      return sendJson(res, 400, { error: '信息提取量必须在 0 到 1 之间' });
    }
    const asset = await requestWorkerJson(`/api/vibes/${encodeURIComponent(vibeId)}`, req, workerPort);
    const existing = asset.item?.encodings?.find(item => Math.abs(Number(item.informationExtracted) - informationExtracted) < 0.001 && item.model === 'nai-diffusion-4-5-full');
    if (existing) return sendJson(res, 200, { item: asset.item, duplicate: true });

    const taskKey = `${vibeId}:nai-diffusion-4-5-full:${informationExtracted.toFixed(2)}`;
    const pendingRecovery = pendingVibeRecoveries.get(taskKey);
    if (pendingRecovery) {
      const stored = await commitVibeRecovery(pendingRecovery, req, workerPort);
      return sendJson(res, 200, { ...stored, recovered: true });
    }
    let task = vibeEncodingJobs.get(taskKey);
    if (!task) {
      task = (async () => {
        const original = await requestWorkerBuffer(`/api/vibes/${encodeURIComponent(vibeId)}/image`, req, workerPort);
        if (original.status >= 400 || !original.buffer.length) {
          const error = new Error('Vibe 原图不存在');
          error.status = original.status || 404;
          throw error;
        }
        const response = await requestRemote(NAI_ENCODE_VIBE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': authorization },
          body: JSON.stringify({ image: original.buffer.toString('base64'), information_extracted: informationExtracted, model: 'nai-diffusion-4-5-full' }),
          signal: AbortSignal.timeout(300_000),
        });
        if (!response.ok) {
          const detail = await response.text();
          const error = new Error(response.status === 401 ? 'NovelAI API Key 无效' : response.status === 402 ? 'NovelAI Anlas 不足' : (detail || `NovelAI 编码失败 (${response.status})`));
          error.status = response.status;
          throw error;
        }
        const encoding = Buffer.from(await response.arrayBuffer());
        if (encoding.length < 64 || encoding.length > 12 * 1024 * 1024) {
          const error = new Error('NovelAI 返回的 Vibe 编码大小异常');
          error.status = 502;
          throw error;
        }
        const anlasBudget = await spendAnlasBudget(req, workerPort, 2, 'vibe-encoding');
        const recovery = { vibeId, informationExtracted, encodingBase64: encoding.toString('base64'), createdAt: Date.now() };
        try {
          const stored = await commitVibeRecovery(recovery, req, workerPort);
          return { ...stored, anlasBudget };
        } catch (storageError) {
          await saveVibeRecovery(recovery);
          const error = new Error('付费编码已由电脑安全保留，但暂时无法写入资料库；请勿重新编码，重启项目后会自动恢复');
          error.status = 503;
          throw error;
        }
      })().finally(() => vibeEncodingJobs.delete(taskKey));
      vibeEncodingJobs.set(taskKey, task);
    }
    const stored = await task;
    return sendJson(res, 200, stored);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return sendJson(res, Number(error.status) || (timedOut ? 504 : 502), {
      error: timedOut ? '电脑连接 NovelAI 编码服务超时，请检查电脑 VPN' : (error.message || 'Vibe 编码失败'),
    });
  }
};

export const getValidatedSource = value => {
  const source = String(value || '');
  if (!source || source.length > SOURCE_LIMIT || /[\r\n]/.test(source)) throw new Error('Invalid image source');
  if (source.startsWith('/api/assets/')) return { type: 'local', source };
  if (/^\/api\/(?:local-history\/[^/]+\/image|vibes\/[^/]+\/(?:image|thumbnail))(?:\?.*)?$/.test(source)) return { type: 'local', source };
  const stChatu8History = source.match(/^\/api\/integrations\/st-chatu8\/history\/([a-f0-9]{64})\/image$/i);
  if (stChatu8History) return { type: 'st-chatu8-history', source, externalId: stChatu8History[1].toLowerCase() };
  let url;
  try { url = new URL(source); } catch { throw new Error('Unsupported image source'); }
  if (url.protocol !== 'https:' || !ALLOWED_REMOTE_HOSTS.has(url.hostname.toLowerCase())) throw new Error('Remote image host is not allowed');
  return { type: 'remote', source: url.toString() };
};

const readLimitedResponse = async response => {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > INPUT_LIMIT) throw new Error('Image is too large');
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > INPUT_LIMIT) {
      await reader.cancel();
      throw new Error('Image is too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
};

const requestWorkerBuffer = (source, req, workerPort) => new Promise((resolve, reject) => {
  const upstream = httpRequest({
    hostname: '127.0.0.1',
    port: workerPort,
    path: source,
    method: 'GET',
    headers: {
      accept: 'image/*',
      cookie: req.headers.cookie || '',
      host: getForwardHost(req),
      'user-agent': req.headers['user-agent'] || 'NaiPromptManager-MediaGateway',
      'x-forwarded-for': normalizeIp(req.socket.remoteAddress),
      'x-nai-client-ip': normalizeIp(req.socket.remoteAddress),
    },
  }, async upstreamRes => {
    if ((upstreamRes.statusCode || 500) >= 400) {
      upstreamRes.resume();
      resolve({ status: upstreamRes.statusCode || 500, headers: upstreamRes.headers, buffer: Buffer.alloc(0) });
      return;
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of upstreamRes) {
        size += chunk.length;
        if (size > INPUT_LIMIT) throw new Error('Image is too large');
        chunks.push(chunk);
      }
      resolve({ status: upstreamRes.statusCode || 200, headers: upstreamRes.headers, buffer: Buffer.concat(chunks, size) });
    } catch (error) {
      upstreamRes.destroy();
      reject(error);
    }
  });
  upstream.setTimeout(20_000, () => upstream.destroy(new Error('Image request timed out')));
  upstream.on('error', reject);
  upstream.end();
});

const requestRemoteBuffer = async (source, remoteFetch = fetch) => {
  let current = source;
  for (let redirects = 0; redirects < 4; redirects++) {
    const url = new URL(current);
    if (url.protocol !== 'https:' || !ALLOWED_REMOTE_HOSTS.has(url.hostname.toLowerCase())) throw new Error('Remote image redirect is not allowed');
    const response = await remoteFetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: { accept: 'image/*', 'user-agent': 'NaiPromptManager-MediaGateway/1.0' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Invalid image redirect');
      current = new URL(location, url).toString();
      continue;
    }
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (!response.ok) return { status: response.status, headers: { 'content-type': contentType }, buffer: Buffer.alloc(0) };
    if (!contentType.startsWith('image/')) throw new Error('Remote response is not an image');
    return { status: response.status, headers: { 'content-type': contentType }, buffer: await readLimitedResponse(response) };
  }
  throw new Error('Too many image redirects');
};

const handleAitagRemoteRequest = async (req, res, url, lanSecret, remoteFetch) => {
  const suppliedSecret = String(req.headers['x-nai-internal-secret'] || '');
  const expected = Buffer.from(lanSecret);
  const supplied = Buffer.from(suppliedSecret);
  if (!isLoopbackIp(req.socket.remoteAddress) || !lanSecret || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return sendJson(res, 404, { error: 'Not found' });
  }
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const target = new URL(url.searchParams.get('url') || '');
    const targetType = classifyAitagRemoteTarget(target.toString());
    if (!targetType) return sendJson(res, 400, { error: 'Invalid AITag target' });
    const isJsonApi = targetType === 'json';
    const isImage = targetType === 'image';
    const response = await remoteFetch(target, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: isJsonApi ? 'application/json' : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'user-agent': 'NaiPromptManager-Qun/0.5 (+local personal use)',
      },
    });
    const contentType = response.headers.get('content-type') || '';
    const body = await readLimitedResponse(response);
    if (isJsonApi && body.length > 16 * 1024 * 1024) return sendJson(res, 502, { error: 'AITag response is too large' });
    if (isJsonApi && !contentType.toLowerCase().includes('json')) return sendJson(res, 502, { error: 'AITag returned a non-JSON response' });
    if (isImage && !contentType.toLowerCase().startsWith('image/')) return sendJson(res, 502, { error: 'AITag returned a non-image response' });
    res.writeHead(response.status, {
      'Content-Type': contentType,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(body);
  } catch (error) {
    return sendJson(res, error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 504 : 502, {
      error: `电脑无法连接 AITag：${error?.cause?.message || error?.message || '未知错误'}`,
    });
  }
};

class ThumbnailCache {
  constructor() {
    this.entries = {};
    this.inFlight = new Map();
    this.activeJobs = 0;
    this.jobQueue = [];
    this.writeTimer = null;
  }

  async init() {
    await mkdir(CACHE_DIR, { recursive: true });
    try { this.entries = JSON.parse(await readFile(CACHE_INDEX, 'utf8')); } catch { this.entries = {}; }
    const files = new Set(await readdir(CACHE_DIR));
    for (const [key, entry] of Object.entries(this.entries)) {
      if (!entry?.file || !files.has(entry.file)) delete this.entries[key];
    }
    for (const file of files) {
      if (file === 'index.json' || file.endsWith('.tmp')) continue;
      if (!Object.values(this.entries).some(entry => entry.file === file)) await unlink(join(CACHE_DIR, file)).catch(() => {});
    }
    this.scheduleIndexWrite();
  }

  scheduleIndexWrite() {
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      writeFile(CACHE_INDEX, `${JSON.stringify(this.entries)}\n`, 'utf8').catch(() => {});
    }, 500);
    this.writeTimer.unref?.();
  }

  async withJobSlot(task) {
    if (this.activeJobs >= 2) await new Promise(resolve => this.jobQueue.push(resolve));
    this.activeJobs++;
    try { return await task(); } finally {
      this.activeJobs--;
      this.jobQueue.shift()?.();
    }
  }

  async prune() {
    let total = Object.values(this.entries).reduce((sum, entry) => sum + Number(entry.size || 0), 0);
    if (total <= CACHE_LIMIT) return;
    const oldest = Object.entries(this.entries).sort((a, b) => Number(a[1].accessedAt || 0) - Number(b[1].accessedAt || 0));
    for (const [key, entry] of oldest) {
      await unlink(join(CACHE_DIR, entry.file)).catch(() => {});
      total -= Number(entry.size || 0);
      delete this.entries[key];
      if (total <= CACHE_PRUNE_TARGET) break;
    }
    this.scheduleIndexWrite();
  }

  async get(source, variant, loadOriginal) {
    const key = createHash('sha256').update(`${CACHE_VERSION}|${variant}|${source}`).digest('hex');
    const existing = this.entries[key];
    if (existing) {
      try {
        const buffer = await readFile(join(CACHE_DIR, existing.file));
        existing.accessedAt = Date.now();
        this.scheduleIndexWrite();
        return buffer;
      } catch { delete this.entries[key]; }
    }
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const promise = this.withJobSlot(async () => {
      const original = await loadOriginal();
      if (original.status >= 400) {
        const error = new Error('Source image was not found');
        error.status = original.status;
        throw error;
      }
      const { default: sharp } = await import('sharp');
      const output = await sharp(original.buffer, { failOn: 'warning', limitInputPixels: 100_000_000 })
        .rotate()
        .resize({ width: THUMB_WIDTHS.get(variant), height: THUMB_WIDTHS.get(variant), fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72, effort: 4 })
        .toBuffer();
      const file = `${key}.webp`;
      const temp = join(CACHE_DIR, `${key}.${process.pid}.${Date.now()}.tmp`);
      await writeFile(temp, output);
      await rename(temp, join(CACHE_DIR, file));
      this.entries[key] = { file, size: output.length, accessedAt: Date.now(), source, variant };
      this.scheduleIndexWrite();
      await this.prune();
      return output;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
}

const proxyRequest = (req, res, workerPort) => {
  const headers = { ...req.headers };
  headers.host = getForwardHost(req);
  // The Worker uses this address for the LAN PIN rate limit.  Never retain a
  // client supplied forwarding chain here: otherwise a LAN client can change
  // X-Forwarded-For on every attempt and bypass the PIN lockout.
  headers['x-forwarded-for'] = normalizeIp(req.socket.remoteAddress);
  headers['x-nai-client-ip'] = normalizeIp(req.socket.remoteAddress);
  const upstream = httpRequest({ hostname: '127.0.0.1', port: workerPort, path: req.url, method: req.method, headers }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', error => {
    if (!res.headersSent) sendJson(res, 502, { error: `Local service unavailable: ${error.message}` });
    else res.destroy(error);
  });
  req.pipe(upstream);
};

export async function createMediaGateway({ port = 3000, workerPort = 3001, lanSecret = '', outboundProxyUrl = '' } = {}) {
  const proxyAgent = outboundProxyUrl ? new ProxyAgent(outboundProxyUrl) : null;
  const remoteFetch = (url, options = {}) => undiciFetch(url, { ...options, ...(proxyAgent ? { dispatcher: proxyAgent } : {}) });
  const cloudQueue = new CloudQueueCoordinator(remoteFetch);
  const cloudQueuePreferences = await loadCloudQueuePreferences();
  const cache = new ThumbnailCache();
  const promptAgent = new PromptAgentService({ lanSecret, outboundProxyUrl });
  const stChatu8Bridge = new StChatu8Bridge({
    projectRoot: process.cwd(),
    requestWorkerJson: (path, options) => requestWorkerJson(path, internalWorkerRequest, workerPort, options),
    requestWorkerBuffer: path => requestWorkerBuffer(path, internalWorkerRequest, workerPort),
  });
  await cache.init();
  await promptAgent.init();
  await stChatu8Bridge.init();
  await recoverPendingVibeEncodings(workerPort);
  stChatu8Bridge.startHistorySync();
  const server = createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); } catch { return sendJson(res, 400, { error: 'Invalid request URL' }); }
    if (url.pathname.startsWith('/api/integrations/st-chatu8/')) {
      const isLocalRequest = isLoopbackIp(req.socket.remoteAddress);
      const isHistoryImage = /^\/api\/integrations\/st-chatu8\/history\/[a-f0-9]{64}\/image$/i.test(url.pathname);
      if (req.method === 'OPTIONS') {
        if (!isLocalRequest || !isLoopbackOrigin(req.headers.origin)) return sendJson(res, 403, { error: 'Forbidden' });
        res.writeHead(204, {
          'Access-Control-Allow-Origin': req.headers.origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        });
        return res.end();
      }
      if (isHistoryImage) {
        if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
        try {
          const externalId = decodeURIComponent(url.pathname.split('/')[5]);
          const image = await stChatu8Bridge.readHistoryImage(externalId);
          res.writeHead(200, {
            'Content-Type': image.contentType,
            'Content-Length': image.buffer.length,
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
          });
          return res.end(image.buffer);
        } catch (error) {
          return sendJson(res, Number(error.status) || 404, { error: error.message || 'st-chatu8 原图不存在' });
        }
      }
      if (!isLocalRequest) return sendJson(res, 403, { error: 'st-chatu8 桥接只允许本机 SillyTavern 使用' });
      try {
        if (url.pathname === '/api/integrations/st-chatu8/status' && req.method === 'GET') {
          return sendBridgeJson(req, res, 200, stChatu8Bridge.status());
        }
        if (url.pathname === '/api/integrations/st-chatu8/sync' && req.method === 'POST') {
          const payload = JSON.parse((await readRequestBody(req, 64 * 1024 * 1024)).toString('utf8') || '{}');
          return sendBridgeJson(req, res, 200, await stChatu8Bridge.sync(payload));
        }
        const vibeFileMatch = url.pathname.match(/^\/api\/integrations\/st-chatu8\/vibes\/([^/]+)\/file$/);
        if (vibeFileMatch && req.method === 'GET') {
          const file = await stChatu8Bridge.readVibeFile(decodeURIComponent(vibeFileMatch[1]));
          const origin = isLoopbackOrigin(req.headers.origin) ? req.headers.origin : '';
          res.writeHead(200, {
            'Content-Type': file.contentType,
            'Content-Length': file.buffer.length,
            'Cache-Control': 'no-store',
            ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
          });
          return res.end(file.buffer);
        }
        return sendBridgeJson(req, res, 404, { error: 'st-chatu8 桥接接口不存在' });
      } catch (error) {
        return sendBridgeJson(req, res, Number(error.status) || 400, { error: error.message || 'st-chatu8 同步失败' });
      }
    }
    if (url.pathname.startsWith('/api/prompt-agent/')) {
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      try {
        if (url.pathname === '/api/prompt-agent/providers') {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
          return sendJson(res, 200, { items: promptAgent.listProviders() });
        }
        if (url.pathname === '/api/prompt-agent/custom-providers') {
          if (req.method === 'GET') return sendJson(res, 200, { items: promptAgent.listCustomProviders() });
          if (req.method === 'POST' || req.method === 'PUT') {
            const body = JSON.parse((await readRequestBody(req, 128 * 1024)).toString('utf8') || '{}');
            return sendJson(res, req.method === 'POST' ? 201 : 200, await promptAgent.saveCustomProvider(body));
          }
          return sendJson(res, 405, { error: 'Method not allowed' });
        }
        if (url.pathname === '/api/prompt-agent/custom-providers/test') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          const body = JSON.parse((await readRequestBody(req, 128 * 1024)).toString('utf8') || '{}');
          return sendJson(res, 200, await promptAgent.testCustomProvider(body));
        }
        if (url.pathname === '/api/prompt-agent/custom-providers/models') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          const body = JSON.parse((await readRequestBody(req, 128 * 1024)).toString('utf8') || '{}');
          return sendJson(res, 200, await promptAgent.fetchCustomProviderModels(body));
        }
        if (url.pathname.startsWith('/api/prompt-agent/custom-providers/')) {
          if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
          const providerId = decodeURIComponent(url.pathname.slice('/api/prompt-agent/custom-providers/'.length));
          return sendJson(res, 200, await promptAgent.deleteCustomProvider(providerId));
        }
        if (url.pathname === '/api/prompt-agent/auth/login') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          const body = JSON.parse((await readRequestBody(req, 32 * 1024)).toString('utf8') || '{}');
          return sendJson(res, 200, await promptAgent.loginProvider(String(body.provider || ''), body));
        }
        if (url.pathname === '/api/prompt-agent/auth/logout') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          const body = JSON.parse((await readRequestBody(req, 8 * 1024)).toString('utf8') || '{}');
          return sendJson(res, 200, await promptAgent.logoutProvider(String(body.provider || '')));
        }
        if (url.pathname === '/api/prompt-agent/available-models') {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
          return sendJson(res, 200, { items: promptAgent.listAvailableModels() });
        }
        if (url.pathname === '/api/prompt-agent/selection') {
          if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
          const body = JSON.parse((await readRequestBody(req, 8 * 1024)).toString('utf8') || '{}');
          return sendJson(res, 200, await promptAgent.selectModel(String(body.provider || ''), String(body.model || '')));
        }
        if (url.pathname === '/api/prompt-agent/config') {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
          return sendJson(res, 200, promptAgent.publicConfig());
        }
        if (url.pathname === '/api/prompt-agent/tag-translations') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          const body = JSON.parse((await readRequestBody(req, 16 * 1024)).toString('utf8') || '{}');
          if (body.action === 'lookup') return sendJson(res, 200, { items: promptAgent.lookupTagTranslations(body.tags) });
          if (body.action === 'translate') return sendJson(res, 200, await promptAgent.translateTags(body.tags));
          return sendJson(res, 400, { error: '不支持的翻译操作' });
        }
        if (url.pathname === '/api/prompt-agent/models') {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
          return sendJson(res, 200, { items: promptAgent.getModels(url.searchParams.get('provider') || '') });
        }
        if (url.pathname === '/api/prompt-agent/sessions') {
          if (req.method === 'GET') return sendJson(res, 200, { items: await promptAgent.listSessions() });
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          const body = JSON.parse((await readRequestBody(req, 8 * 1024)).toString('utf8') || '{}');
          return sendJson(res, 201, await promptAgent.createSession(body));
        }
        if (url.pathname.startsWith('/api/prompt-agent/sessions/')) {
          const sessionId = decodeURIComponent(url.pathname.slice('/api/prompt-agent/sessions/'.length));
          if (req.method === 'PATCH') {
            const body = JSON.parse((await readRequestBody(req, 8 * 1024)).toString('utf8') || '{}');
            return sendJson(res, 200, await promptAgent.updateSession(sessionId, body));
          }
          if (req.method === 'DELETE') {
            await promptAgent.deleteSession(sessionId);
            return sendJson(res, 200, { ok: true });
          }
          return sendJson(res, 405, { error: 'Method not allowed' });
        }
        if (url.pathname === '/api/prompt-agent/control') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          const body = JSON.parse((await readRequestBody(req, 16 * 1024)).toString('utf8') || '{}');
          return sendJson(res, 200, promptAgent.controlSession(String(body.sessionId || ''), String(body.action || ''), String(body.message || ''), body));
        }
        if (url.pathname === '/api/prompt-agent/session/reset') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          const body = JSON.parse((await readRequestBody(req, 8 * 1024)).toString('utf8') || '{}');
          await promptAgent.resetSession(body.sessionId);
          return sendJson(res, 200, { ok: true });
        }
        if (url.pathname === '/api/prompt-agent/session/revise') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          const body = JSON.parse((await readRequestBody(req, 16 * 1024)).toString('utf8') || '{}');
          return sendJson(res, 200, { items: await promptAgent.reviseSessionMessage(String(body.sessionId || ''), String(body.messageId || ''), String(body.content || '')) });
        }
        if (url.pathname === '/api/prompt-agent/session') {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
          return sendJson(res, 200, { items: await promptAgent.getSessionHistory(url.searchParams.get('sessionId') || '') });
        }
        if (url.pathname === '/api/prompt-agent/task') {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
          return sendJson(res, 200, await promptAgent.getTask(url.searchParams.get('sessionId') || ''));
        }
        if (url.pathname === '/api/prompt-agent/log') {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
          return sendJson(res, 200, await promptAgent.getAuditLog(url.searchParams.get('sessionId') || ''));
        }
        if (url.pathname === '/api/prompt-agent/project-action') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          const body = JSON.parse((await readRequestBody(req, 32 * 1024)).toString('utf8') || '{}');
          return sendJson(res, 200, await promptAgent.executeConfirmedProjectAction(body, {
            requestJson: (path, options) => requestWorkerJson(path, req, workerPort, options),
            tagDictionary: method => requestTagDictionaryControl(method),
          }));
        }
        if (url.pathname === '/api/prompt-agent/run') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          // Four 6 MB images become roughly 32 MB after Base64 encoding; leave
          // room for JSON and metadata while keeping a hard upper bound.
          const body = JSON.parse((await readRequestBody(req, 48 * 1024 * 1024)).toString('utf8') || '{}');
          if (body.mode !== 'retry' && !String(body.message || '').trim() && (!Array.isArray(body.images) || body.images.length === 0)) return sendJson(res, 400, { error: '请先告诉 Agent 你想做什么' });
          // A phone changing network or a browser refresh must not kill the
          // computer-side Agent. If the lost client owned a confirmation,
          // cancel only that pending confirmation so the task can fail cleanly.
          const disconnect = () => promptAgent.cancelSessionConfirmations(String(body.sessionId || ''));
          req.once('aborted', disconnect);
          res.once('close', () => { if (!res.writableEnded) disconnect(); });
          res.writeHead(200, {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          const emit = event => { if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
          try {
            const result = await promptAgent.run(body, emit, undefined, {
              requestJson: (path, options) => requestWorkerJson(path, req, workerPort, options),
              getQueuePreferences: () => ({ ...cloudQueuePreferences }),
              setQueuePreferences: async next => {
                cloudQueuePreferences.enabled = next.enabled === true;
                cloudQueuePreferences.greeting = String(next.greeting || '正在生成中～').trim().slice(0, 15);
                cloudQueuePreferences.showGreeting = next.showGreeting !== false;
                await saveCloudQueuePreferences(cloudQueuePreferences);
                return { ...cloudQueuePreferences };
              },
              tagDictionary: method => requestTagDictionaryControl(method),
              requestBuffer: async (path, maxBytes) => {
                const result = await requestWorkerBuffer(path, req, workerPort);
                if (result.status >= 400) throw Object.assign(new Error('读取项目图片失败'), { status: result.status });
                if (result.buffer.length > maxBytes) throw Object.assign(new Error('图片过大，无法交给当前模型识别'), { status: 413 });
                const header = result.headers['content-type'];
                const mimeType = (Array.isArray(header) ? header[0] : header || 'image/png').split(';')[0].trim();
                if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(mimeType)) throw new Error('历史文件不是支持的图片格式');
                return { buffer: result.buffer, mimeType };
              },
            });
            emit({ type: 'done', ...result });
          } catch (error) {
            emit({ type: 'error', error: error.message || 'Agent 执行失败' });
          } finally {
            req.removeListener('aborted', disconnect);
            if (!res.writableEnded) res.end();
          }
          return;
        }
        return sendJson(res, 404, { error: 'Agent interface not found' });
      } catch (error) {
        return sendJson(res, Number(error.status) || 400, { error: error.message || 'Agent 请求失败' });
      }
    }
    if (url.pathname === '/__internal/aitag-fetch') return handleAitagRemoteRequest(req, res, url, lanSecret, remoteFetch);
    if (url.pathname === '/api/generate') return handleGenerateRequest(req, res, lanSecret, workerPort, cloudQueue, cloudQueuePreferences, remoteFetch);
    if (url.pathname === '/api/generation-queue/preferences') {
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      if (req.method === 'GET') return sendJson(res, 200, cloudQueuePreferences);
      if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
      const body = JSON.parse((await readRequestBody(req, 4096)).toString('utf8') || '{}');
      cloudQueuePreferences.enabled = body.enabled === true;
      cloudQueuePreferences.greeting = String(body.greeting || '正在生成中～').trim().slice(0, 15);
      cloudQueuePreferences.showGreeting = body.showGreeting !== false;
      await saveCloudQueuePreferences(cloudQueuePreferences);
      return sendJson(res, 200, cloudQueuePreferences);
    }
    if (url.pathname === '/api/generation-queue/status') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      const status = cloudQueue.get(url.searchParams.get('taskId') || '');
      if (!status) return sendJson(res, 404, { error: '排队任务不存在' });
      const { controller, ...safeStatus } = status;
      return sendJson(res, 200, safeStatus);
    }
    if (url.pathname === '/api/generation-queue/cancel') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      const body = JSON.parse((await readRequestBody(req, 4096)).toString('utf8') || '{}');
      const status = cloudQueue.get(String(body.taskId || ''));
      if (!status?.cancelable || !status.controller) return sendJson(res, 409, { error: '当前任务已不能取消' });
      status.controller.abort(new DOMException('用户已取消排队', 'AbortError'));
      cloudQueue.update(status.taskId, { phase: 'cancelled', cancelable: false, controller: null });
      return sendJson(res, 200, { status: 'ok' });
    }
    const vibeEncodeMatch = url.pathname.match(/^\/api\/vibes\/([^/]+)\/encodings$/);
    if (vibeEncodeMatch) return handleVibeEncodeRequest(req, res, lanSecret, workerPort, decodeURIComponent(vibeEncodeMatch[1]), remoteFetch);
    if (url.pathname !== '/api/media') return proxyRequest(req, res, workerPort);
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });

    try {
      const variant = url.searchParams.get('variant') || '';
      if (variant !== 'original' && !THUMB_WIDTHS.has(variant)) return sendJson(res, 400, { error: 'Invalid image variant' });
      const validated = getValidatedSource(url.searchParams.get('source'));
      const loadOriginal = () => validated.type === 'local'
        ? requestWorkerBuffer(validated.source, req, workerPort)
        : validated.type === 'st-chatu8-history'
          ? stChatu8Bridge.readHistoryImage(validated.externalId).then(image => ({
            status: 200,
            buffer: image.buffer,
            headers: { 'content-type': image.contentType },
          }))
        : requestRemoteBuffer(validated.source, remoteFetch);

      if (variant === 'original') {
        const original = await loadOriginal();
        if (original.status >= 400) return sendJson(res, original.status, { error: 'Source image was not found' });
        res.writeHead(200, {
          'Content-Type': original.headers['content-type'] || 'application/octet-stream',
          'Content-Length': original.buffer.length,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(original.buffer);
      }

      const thumbnail = await cache.get(validated.source, variant, loadOriginal);
      res.writeHead(200, {
        'Content-Type': 'image/webp',
        'Content-Length': thumbnail.length,
        'Cache-Control': 'private, no-store',
        'X-Nai-Thumbnail-Bytes': thumbnail.length,
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(thumbnail);
    } catch (error) {
      sendJson(res, Number(error.status) || 502, { error: error.message || 'Image processing failed' });
    }
  });
  server.on('close', () => { proxyAgent?.close().catch(() => {}); });

  server.on('upgrade', (req, socket, head) => {
    const upstream = connectSocket(workerPort, '127.0.0.1', () => {
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
      for (let i = 0; i < req.rawHeaders.length; i += 2) upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
      upstream.write('\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await createMediaGateway({
    port: Number(process.env.NAI_GATEWAY_PORT || 3000),
    workerPort: Number(process.env.NAI_WORKER_PORT || 3001),
    lanSecret: process.env.NAI_LAN_SECRET || '',
  });
  console.log(`NaiPromptManager media gateway listening on ${server.address().port}`);
}
