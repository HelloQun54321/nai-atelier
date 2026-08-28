import { execFile as nodeExecFile } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { connect as connectSocket } from 'node:net';
import { availableParallelism, tmpdir, totalmem } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { PromptAgentService } from './prompt-agent.mjs';
import { StChatu8Bridge } from './st-chatu8-bridge.mjs';
import { ImageTaggerService } from './image-tagger.mjs';
import { MEDIA_REMOTE_HOSTS, LAN_ACCESS_COOKIE } from '../worker/sharedWhitelist.mjs';
import { PIXIV_IMAGE_HOST, PIXIV_REFERER, PixivGalleryService } from './pixiv-local.mjs';
import { PixivWebLoginOrchestrator } from './pixiv-web-login.mjs';
import { localBackupService, saveBackupConfig, openInExplorer } from './local-backup.mjs';

const CACHE_VERSION = 'v1';
const HISTORY_THUMBNAIL_CACHE_VERSION = 'v2';
const CACHE_DIR = join(process.cwd(), 'local-cache', 'thumbnails');
const CACHE_INDEX = join(CACHE_DIR, 'index.json');
const VIBE_RECOVERY_DIR = join(process.cwd(), 'local-data', 'vibe-recovery');
const CLOUD_QUEUE_CONFIG_FILE = join(process.cwd(), 'local-data', 'cloud-queue.json');
const CLOUD_QUEUE_CONFIG_VERSION = 2;
const LAN_CONFIG_FILE = join(process.cwd(), 'local-data', 'lan-access.json');
const CACHE_LIMIT = 1024 * 1024 * 1024;
const CACHE_PRUNE_TARGET = 900 * 1024 * 1024;
// pinned 封面缓存总量上限：封面单张数十 KB，正常画师/角色数量级远达不到；
// 一旦超过（如目录被批量刷新）按最久未访问淘汰，避免 pinned 无界增长
// 反噬普通缩略图缓存（prune 目标永不达成）和磁盘占用。
const PIN_CACHE_LIMIT = 256 * 1024 * 1024;
const PIN_CACHE_TARGET = 200 * 1024 * 1024;
const SOURCE_LIMIT = 2048;
const INPUT_LIMIT = 30 * 1024 * 1024;
const GENERATION_REQUEST_LIMIT = 20 * 1024 * 1024;
const VIBE_ENCODING_CACHE_LIMIT = 128 * 1024 * 1024;
const PRECISE_REFERENCE_CACHE_LIMIT = 128 * 1024 * 1024;
const NAI_GENERATE_URL = 'https://image.novelai.net/ai/generate-image';
const NAI_GENERATE_STREAM_URL = 'https://image.novelai.net/ai/generate-image-stream';
const NAI_ENCODE_VIBE_URL = 'https://image.novelai.net/ai/encode-vibe';
// api.novelai.net 的订阅接口会以 400 拒绝第三方工具并提示改用 image 域名（2026-08 实测）。
const NAI_SUBSCRIPTION_URL = 'https://image.novelai.net/user/subscription';
const CLOUD_QUEUE_URL = 'https://st-chatu-novelai-queue.hf.space';
const CLOUD_QUEUE_POLL_INTERVAL = 1000;
const CLOUD_QUEUE_MAX_FAILURES = 3;
const CLOUD_QUEUE_STATUS_TTL = 5 * 60 * 1000;
// 与 worker 共享的基础白名单（单一来源 worker/sharedWhitelist.mjs）；
// 网关额外允许 i.pximg.net，见 getValidatedSource 内注释。
const ALLOWED_REMOTE_HOSTS = new Set(MEDIA_REMOTE_HOSTS);
const ALLOWED_AITAG_API_PATHS = [
  /^\/api\/config$/,
  /^\/api\/ai_works_search$/,
  /^\/api\/rank\/monthly\/(?:real|fixed)$/,
  /^\/api\/work\/\d+$/,
];
const THUMB_WIDTHS = new Map([
  ['thumb-160', 160],
  ['thumb-240', 240],
  ['thumb-320', 320],
  ['thumb-480', 480],
  ['thumb-640', 640],
  ['thumb-960', 960],
]);
const execFile = promisify(nodeExecFile);
const AITAG_BROWSER_HEADERS = {
  accept: 'application/json, text/plain, */*',
  referer: 'https://aitag.win/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

export const selectThumbnailConcurrency = ({
  logicalProcessors = availableParallelism(),
  totalMemoryBytes = totalmem(),
} = {}) => {
  const memoryGb = totalMemoryBytes / (1024 ** 3);
  // 档位按"网络抓取为瓶颈"标定：远端图片单张 0.8-3s 纯 I/O 等待，sharp 缩放
  // （≤960px webp，effort 3-4）每张仅几十毫秒，按 CPU 保守分档会卡错资源，
  // 一页 40 张图在 4 并发下要 10s+ 才能填满。CPU 占用仍受档位上限约束。
  if (logicalProcessors >= 16 && memoryGb >= 24) return 16;
  if (logicalProcessors >= 12 && memoryGb >= 16) return 12;
  if (logicalProcessors >= 8 && memoryGb >= 12) return 8;
  return 4;
};

const THUMBNAIL_JOB_CONCURRENCY = selectThumbnailConcurrency();
const vibeEncodingJobs = new Map();
const pendingVibeRecoveries = new Map();
const vibeCacheHmacSecret = randomBytes(32);
const confirmedNovelAiVibeCacheKeys = new Set();
const preciseReferenceImageCache = new Map();
let preciseReferenceImageCacheSize = 0;
const preciseReferenceImageJobs = new Map();

export const normalizeCloudQueueServiceUrl = value => {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('公共队列服务地址不能为空');
  let url;
  try { url = new URL(raw); } catch { throw new Error('公共队列服务地址必须是完整的 HTTP(S) 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.hostname) {
    throw new Error('公共队列服务地址必须是无凭据、无查询参数的 HTTP(S) 地址');
  }
  return url.href.replace(/\/+$/, '');
};

export const normalizeCloudQueuePreferences = value => ({
  enabled: value?.enabled === true,
  greeting: String(value?.greeting || '正在生成中～').trim().slice(0, 15),
  showGreeting: value?.showGreeting !== false,
  serviceUrl: (() => {
    try { return normalizeCloudQueueServiceUrl(value?.serviceUrl || CLOUD_QUEUE_URL); } catch { return CLOUD_QUEUE_URL; }
  })(),
});

const isCloudQueuePreferenceObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && ('enabled' in value || 'greeting' in value || 'showGreeting' in value || 'serviceUrl' in value));

const normalizeCloudQueueStore = value => {
  const accounts = {};
  const rawAccounts = value?.version === CLOUD_QUEUE_CONFIG_VERSION && value.accounts && typeof value.accounts === 'object'
    ? value.accounts
    : {};
  for (const [keyHash, preferences] of Object.entries(rawAccounts)) {
    if (/^[0-9a-f]{16,128}$/.test(keyHash)) accounts[keyHash] = normalizeCloudQueuePreferences(preferences);
  }
  const legacy = value?.version === CLOUD_QUEUE_CONFIG_VERSION
    ? (isCloudQueuePreferenceObject(value.legacy) ? normalizeCloudQueuePreferences(value.legacy) : null)
    : (isCloudQueuePreferenceObject(value) ? normalizeCloudQueuePreferences(value) : null);
  return { version: CLOUD_QUEUE_CONFIG_VERSION, accounts, legacy };
};

const loadCloudQueuePreferences = async () => {
  try {
    return normalizeCloudQueueStore(JSON.parse(await readFile(CLOUD_QUEUE_CONFIG_FILE, 'utf8')));
  } catch {
    return normalizeCloudQueueStore(null);
  }
};

const keyHashFromAuthorization = authorization => {
  const value = String(authorization || '');
  if (!value.startsWith('Bearer ')) return '';
  const apiKey = value.slice(7).trim();
  return apiKey ? createHash('sha256').update(apiKey).digest('hex') : '';
};

const keyHashFromRequest = req => keyHashFromAuthorization(req?.headers?.authorization);

const resolveCloudQueuePreferences = (store, keyHash) => {
  if (keyHash && store.accounts[keyHash]) return { preferences: { ...store.accounts[keyHash] }, migrated: false };
  if (keyHash && store.legacy) {
    // 旧版本只有一份全局设置：首次带 Key 访问时迁移给该 Key，避免把历史设置悄悄丢掉。
    store.accounts[keyHash] = { ...store.legacy };
    store.legacy = null;
    return { preferences: { ...store.accounts[keyHash] }, migrated: true };
  }
  return { preferences: normalizeCloudQueuePreferences(null), migrated: false };
};

let cloudQueueConfigWrite = Promise.resolve();
const saveCloudQueuePreferences = store => {
  const snapshot = {
    version: CLOUD_QUEUE_CONFIG_VERSION,
    accounts: Object.fromEntries(Object.entries(store.accounts || {}).map(([keyHash, preferences]) => [keyHash, normalizeCloudQueuePreferences(preferences)])),
    ...(store.legacy ? { legacy: normalizeCloudQueuePreferences(store.legacy) } : {}),
  };
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
    this.baseUrl = normalizeCloudQueueServiceUrl(baseUrl);
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

  async post(path, body, serviceUrl = this.baseUrl) {
    return readQueueJson(await this.requestRemote(`${serviceUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    }));
  }

  async join({ apiKey, taskId, greeting = '', showGreeting = true, serviceUrl = this.baseUrl, signal }) {
    const queueUrl = normalizeCloudQueueServiceUrl(serviceUrl);
    const keyHash = createHash('sha256').update(apiKey).digest('hex');
    const userId = this.clientId;
    const common = { key_hash: keyHash, user_id: userId, task_id: taskId };
    this.update(taskId, { phase: 'joining', position: null, queueSize: null, greeting: null, cancelable: true });
    const joined = await this.post('/join-queue', { ...common, greeting: String(greeting).trim().slice(0, 15) || null }, queueUrl);
    if (signal?.aborted) {
      await this.post('/leave-queue', { ...common, lock_token: joined.lock_token || null }, queueUrl).catch(() => {});
      throw signal.reason || new DOMException('Aborted', 'AbortError');
    }
    this.update(taskId, {
      phase: joined.position === 0 && joined.lock_token ? 'ready' : 'waiting',
      position: Number(joined.position) || 0,
      queueSize: Number(joined.queue_size) || 1,
      cancelable: true,
    });
    if (joined.position === 0 && joined.lock_token) return { ...common, lockToken: joined.lock_token, serviceUrl: queueUrl };

    let failures = 0;
    try {
      while (true) {
        await delay(CLOUD_QUEUE_POLL_INTERVAL, signal);
        try {
        const query = new URLSearchParams(common).toString();
        const status = await readQueueJson(await this.requestRemote(`${queueUrl}/my-turn?${query}`, {
          signal: AbortSignal.timeout(15_000),
        }));
        failures = 0;
        if (status.is_my_turn && status.lock_token) {
          this.update(taskId, { phase: 'ready', position: 0, queueSize: Number(status.queue_size) || 1, cancelable: true });
          return { ...common, lockToken: status.lock_token, serviceUrl: queueUrl };
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
      await this.post('/leave-queue', { ...common, lock_token: null }, queueUrl).catch(() => {});
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
    }, lock.serviceUrl || this.baseUrl).catch(() => {});
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

export const classifyDanbooruRemoteTarget = value => {
  let target;
  try { target = new URL(value); } catch { return null; }
  if (target.protocol !== 'https:' || target.username || target.password) return null;
  const hostname = target.hostname.toLowerCase();
  if (hostname !== 'danbooru.donmai.us' && hostname !== 'safebooru.donmai.us') return null;
  return target.pathname === '/posts.json' ? 'json' : null;
};

const normalizeIp = value => String(value || '').replace(/^::ffff:/, '');
const isLoopbackIp = value => {
  const ip = normalizeIp(value).toLowerCase();
  return ip === '::1' || ip === 'localhost' || /^127\./.test(ip);
};
export const isPixivConnectionMutationAllowed = req => isLoopbackIp(req?.socket?.remoteAddress);
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
  const token = parseCookies(req.headers.cookie)[LAN_ACCESS_COOKIE];
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
const LAN_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
// 网关是手机访问 3000 端口的唯一入口，局域网密码校验/会话签发在这里承载；
// worker 的 /api/lan/unlock 保留给本机直连兜底（其 env.PIN 是启动时快照）。
// 密码每次校验实时读取配置文件，改密后立即生效，无需重启。
const lanAccessAttempts = new Map();

/** 读取局域网配置中的四位密码；文件缺失/损坏按未配置处理。 */
export const readLanPin = async (configFile = LAN_CONFIG_FILE) => {
  try {
    const saved = JSON.parse(await readFile(configFile, 'utf8'));
    if (/^\d{4}$/.test(String(saved.pin || ''))) return String(saved.pin);
  } catch { /* 未生成或损坏：按未配置处理。 */ }
  return null;
};

/** 原子写入新密码（临时文件 + 改名），保留 secret 等其他字段；非法输入抛出带 status 的错误。 */
export const writeLanPin = async (pin, configFile = LAN_CONFIG_FILE) => {
  if (!/^\d{4}$/.test(String(pin || ''))) {
    throw Object.assign(new Error('局域网密码必须是 4 位数字'), { status: 400 });
  }
  await mkdir(dirname(configFile), { recursive: true });
  const current = await readFile(configFile, 'utf8').then(
    text => { try { return JSON.parse(text); } catch { return {}; } },
    () => ({})
  );
  const next = { ...(current && typeof current === 'object' ? current : {}), pin: String(pin) };
  const temporary = `${configFile}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(temporary, configFile);
};

/** 与 worker 端 createLanAccessToken 完全一致的令牌格式：expiresAt.nonce.HMAC-SHA256(base64url)。 */
const createLanAccessToken = secret => {
  const expiresAt = Date.now() + LAN_SESSION_MAX_AGE_SECONDS * 1000;
  const nonce = randomUUID();
  const value = `${expiresAt}.${nonce}`;
  const signature = createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${signature}`;
};

const getLanAttemptKey = req =>
  normalizeIp(req.socket.remoteAddress) || req.headers['user-agent'] || 'lan-device';

/** 局域网解锁：本机回环直接放行；远端按配置文件实时密码校验，签发 30 天会话 Cookie。 */
export const handleLanUnlock = async (req, res, { secret, configFile = LAN_CONFIG_FILE } = {}) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (isLoopbackIp(req.socket.remoteAddress)) return sendJson(res, 200, { success: true, authorized: true });
  const configuredPin = await readLanPin(configFile);
  if (!configuredPin || !secret || secret.length < 16) {
    return sendJson(res, 503, { error: '局域网访问密码尚未正确配置，请重新启动电脑端服务' });
  }
  const attemptKey = getLanAttemptKey(req);
  const attempt = lanAccessAttempts.get(attemptKey) || { failures: 0, blockedUntil: 0 };
  if (attempt.blockedUntil > Date.now()) {
    return sendJson(res, 429, {
      error: '尝试次数过多，请一分钟后再试',
      code: 'LAN_ACCESS_BLOCKED',
      retryAfter: Math.ceil((attempt.blockedUntil - Date.now()) / 1000),
    });
  }
  const payload = await readJsonBody(req, 4096);
  const pin = String(payload.pin || '');
  if (!/^\d{4}$/.test(pin) || pin !== configuredPin) {
    const failures = attempt.failures + 1;
    const blockedUntil = failures >= 5 ? Date.now() + 60_000 : 0;
    lanAccessAttempts.set(attemptKey, { failures: blockedUntil ? 0 : failures, blockedUntil });
    return sendJson(res, blockedUntil ? 429 : 401, {
      error: blockedUntil ? '连续输错5次，请一分钟后再试' : '密码不正确',
      code: blockedUntil ? 'LAN_ACCESS_BLOCKED' : 'LAN_ACCESS_DENIED',
      attemptsRemaining: blockedUntil ? 0 : 5 - failures,
    });
  }
  lanAccessAttempts.delete(attemptKey);
  const body = Buffer.from(JSON.stringify({ success: true, authorized: true }));
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Set-Cookie': `${LAN_ACCESS_COOKIE}=${createLanAccessToken(secret)}; Max-Age=${LAN_SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Strict`,
  });
  res.end(body);
};

/** 修改局域网密码：需已有授权会话（本机回环直接放行），写入后立即生效。 */
export const handleLanPinUpdate = async (req, res, { secret, configFile = LAN_CONFIG_FILE } = {}) => {
  if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!hasValidLanCookie(req, secret)) {
    return sendJson(res, 401, { error: '需要先通过局域网密码验证才能修改', code: 'LAN_ACCESS_REQUIRED' });
  }
  const payload = await readJsonBody(req, 4096);
  try {
    await writeLanPin(String(payload.pin || ''), configFile);
  } catch (error) {
    return sendJson(res, Number(error.status) || 400, { error: error.message || '密码无效' });
  }
  return sendJson(res, 200, { success: true });
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
  req.on('end', () => {
    // body 读完后必须解除 socket 空闲超时：排队等待、上游生成、流式首帧都可能超过 30 秒，
    // 否则连接会被上面设置的空闲超时销毁（非流式路径甚至已扣费却送不出图）。
    req.setTimeout(0);
    resolve(Buffer.concat(chunks, size));
  });
  req.on('error', reject);
});

/** 解析 JSON 请求体；空 body 与非法 JSON 一律按空对象处理，避免未捕获异常击穿进程。 */
const readJsonBody = async (req, limit) => {
  const raw = (await readRequestBody(req, limit)).toString('utf8');
  try {
    return JSON.parse(raw || '{}') || {};
  } catch {
    return {};
  }
};

const requestWorkerJson = (path, req, workerPort, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const upstream = httpRequest({
    hostname: '127.0.0.1', port: workerPort, path, method,
    headers: {
      accept: 'application/json', 'content-type': 'application/json', cookie: req.headers.cookie || '',
      host: getForwardHost(req), 'user-agent': req.headers['user-agent'] || 'NAI-Atelier-MediaGateway',
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
    headers: {
      accept: 'application/json',
      origin: 'http://localhost:3000',
      'x-nai-local-control': 'true',
    },
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

/** 判断模型是否受官方同步得到的 Opus 免费额度限制。 */
export const isNaiUsageLimitedModel = (model, runtime = getNaiRuntime()) =>
  typeof model === 'string' && runtime.usageLimitedModels.includes(model);

const getNaiModelCapability = (model, runtime = getNaiRuntime()) => {
  const id = String(model || '').trim();
  const direct = runtime.modelCapabilities?.[id];
  if (direct) return direct;
  if (id.endsWith('-inpainting')) return runtime.modelCapabilities?.[id.slice(0, -'-inpainting'.length)];
  return undefined;
};

/** NovelAI's current V4/V4.5 cost formula for the generation features supported here. */
export const estimateNovelAiGenerationCost = (payload, opusUsageExhausted = false, opusSubscriber = false) => {
  const parameters = payload?.parameters || {};
  const width = Math.max(1, Number(parameters.width) || 1);
  const height = Math.max(1, Number(parameters.height) || 1);
  const area = Math.max(65_536, width * height);
  const steps = Math.max(1, Number(parameters.steps) || 1);
  const samples = Math.max(1, Math.floor(Number(parameters.n_samples) || 1));
  // 系数与免费档门槛来自官方 Web 应用常量同步（见 DEFAULT_NAI_RUNTIME / syncNaiRuntime）。
  const runtime = getNaiRuntime();
  const { costCoefficientArea, costCoefficientSteps, freeMaxArea, freeMaxSteps } = runtime;
  const raw = Math.ceil(costCoefficientArea * area + costCoefficientSteps * area * steps);
  const smeaMultiplier = parameters.sm_dyn ? 1.4 : parameters.sm ? 1.2 : 1;
  const strength = parameters.mask
    ? Number(parameters.inpaintImg2ImgStrength ?? 1)
    : parameters.image ? Number(parameters.strength ?? 1) : 1;
  const baseCost = Math.max(Math.ceil(raw * smeaMultiplier * Math.max(0, strength)), 2);
  const preciseReferences = Array.isArray(parameters.director_reference_images_cached)
    ? parameters.director_reference_images_cached.length
    : Array.isArray(parameters.director_reference_images) ? parameters.director_reference_images.length : 0;
  const vibeCount = Array.isArray(parameters.reference_image_multiple_cached)
    ? parameters.reference_image_multiple_cached.length
    : Array.isArray(parameters.reference_image_multiple) ? parameters.reference_image_multiple.length : 0;
  // Precise Reference is a per-reference surcharge, not an img2img base image.
  const isPlainGeneration = payload?.action === 'generate' && !parameters.image && !parameters.mask;
  const focusedEdit = parameters._local_focused_inpainting === true
    && payload?.action === 'infill'
    && parameters._local_edit_operation === 'inpaint'
    && opusSubscriber
    && !opusUsageExhausted
    && samples === 1
    && preciseReferences === 0
    && vibeCount === 0;
  // Opus 免费额度仅对高于 V4.5 的模型（V5 系）设限；透支后所有图都按 Anlas 计费。
  const isUsageLimitedModel = isNaiUsageLimitedModel(payload?.model, runtime);
  const freeSamples = focusedEdit
    ? 1
    : isPlainGeneration && !(opusUsageExhausted && isUsageLimitedModel) && area <= freeMaxArea && steps <= freeMaxSteps ? 1 : 0;
  const base = baseCost * Math.max(0, samples - freeSamples);
  return base + Math.max(0, vibeCount - 4) * 2 * samples + preciseReferences * 5 * samples;
};

/**
 * 成功生成后的个人用量增量（按密钥账号累计，供设置页展示）：
 * - anlasDelta：本次实际扣减的 Anlas（估算口径与本地预算一致）；
 * - opusImagesDelta：计入 Opus 免费额度的张数——仅“受限模型（V5 系）+ 免费档
 *   （单张、无底图、面积/步数达标）+ 未透支”的生成才消耗共享额度。
 */
export const computeGenerationPersonalUsage = (payload, estimatedCost, usageExhausted, runtime = getNaiRuntime(), generationSucceeded = true, opusSubscriber = false) => {
  if (!generationSucceeded) return { anlasDelta: 0, opusImagesDelta: 0 };
  const parameters = payload?.parameters || {};
  const samples = Math.max(1, Math.floor(Number(parameters.n_samples) || 1));
  const width = Math.max(1, Number(parameters.width) || 1);
  const height = Math.max(1, Number(parameters.height) || 1);
  const area = Math.max(65_536, width * height);
  const steps = Math.max(1, Number(parameters.steps) || 1);
  const isPlainGeneration = payload?.action === 'generate' && !parameters.image && !parameters.mask;
  const isUsageLimitedModel = isNaiUsageLimitedModel(payload?.model, runtime);
  const isFocusedEdit = parameters._local_focused_inpainting === true
    && payload?.action === 'infill'
    && parameters._local_edit_operation === 'inpaint'
    && opusSubscriber === true
    && samples === 1;
  const opusImagesDelta = !usageExhausted && (
    (isUsageLimitedModel && isPlainGeneration && area <= runtime.freeMaxArea && steps <= runtime.freeMaxSteps)
    || isFocusedEdit
  ) ? samples : 0;
  return { anlasDelta: Math.max(0, Math.floor(Number(estimatedCost) || 0)), opusImagesDelta };
};

const spendAnlasBudget = async (req, workerPort, amount, reason, personal = null) => {
  const hasAmount = Number.isFinite(amount) && amount > 0;
  const hasPersonal = personal && /^[0-9a-f]{16,128}$/.test(String(personal.keyHash || ''));
  if (!hasAmount && !hasPersonal) return null;
  try {
    return await requestWorkerJson('/api/anlas-budget', req, workerPort, {
      method: 'POST',
      body: {
        amount: hasAmount ? Math.floor(amount) : 0,
        reason,
        ...(hasPersonal ? {
          keyHash: personal.keyHash,
          anlasDelta: Math.max(0, Math.floor(Number(personal.anlasDelta) || 0)),
          opusImagesDelta: Math.max(0, Math.floor(Number(personal.opusImagesDelta) || 0)),
        } : {}),
      },
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

export const fetchNovelAiGenerationStream = (payload, authorization, signal = AbortSignal.timeout(300_000), requestRemote = fetch) => requestRemote(NAI_GENERATE_STREAM_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': authorization,
    'Accept': 'text/event-stream',
  },
  body: JSON.stringify(payload),
  signal,
});

/** 网关只需观察事件名；图片正文保持原字节流转发，避免二次编码。 */
export const createSseEventObserver = onEvent => {
  let buffer = '';
  const emit = frame => {
    const eventLine = frame.split(/\r?\n/).find(line => line.startsWith('event:'));
    onEvent(eventLine ? eventLine.slice(6).trim() || 'message' : 'message');
  };
  return {
    push(text) {
      buffer += text;
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || '\n\n';
        emit(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + separator.length);
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    },
    finish() {
      if (buffer.trim()) emit(buffer);
      buffer = '';
    },
  };
};

export const fetchNovelAiSubscription = (authorization, signal = AbortSignal.timeout(30_000), requestRemote = fetch) => requestRemote(NAI_SUBSCRIPTION_URL, {
  method: 'GET',
  headers: { 'Authorization': authorization },
  signal,
});

/**
 * 只保留前端需要的订阅字段，剥离 paymentProcessorData 等敏感/冗余数据，
 * usage 三个字段与 NovelAI Web 应用的 Opus 限额映射一一对应。
 */
export const sanitizeNovelAiSubscription = payload => {
  const usage = payload?.usage;
  const percent = Number(usage?.percent);
  const timeUntilNextPercent = Number(usage?.timeUntilNextPercent);
  return {
    tier: Number(payload?.tier) || 0,
    active: payload?.active === true,
    usage: usage && Number.isFinite(percent) ? {
      percent,
      isNegative: usage.isNegative === true,
      timeUntilNextPercent: Number.isFinite(timeUntilNextPercent) ? timeUntilNextPercent : 0,
    } : undefined,
  };
};

// 生图扣预算时的 Opus 透支快照；由最近的 /api/novelai-subscription 代理请求刷新。
// 拼车账号额度全员共享，但不同 NovelAI Key 可能属于不同账号，不能共用快照。
const lastKnownOpusUsage = new Map();
const OPUS_USAGE_STALE_MS = 30_000;

const setOpusUsageSnapshot = (keyHash, isNegative, opusSubscriber = false) => {
  if (!keyHash) return;
  lastKnownOpusUsage.set(keyHash, { exhausted: isNegative === true, opusSubscriber: opusSubscriber === true, updatedAt: Date.now() });
  if (lastKnownOpusUsage.size > 128) {
    const oldest = lastKnownOpusUsage.keys().next().value;
    if (oldest) lastKnownOpusUsage.delete(oldest);
  }
};

const getOpusUsageSnapshot = keyHash => lastKnownOpusUsage.get(keyHash) || { exhausted: false, opusSubscriber: false, updatedAt: 0 };

/** 成功生成统一走这里结算，保证 ZIP 与 SSE 使用同一 Key 隔离和个人用量口径。 */
const settleSuccessfulNovelAiGeneration = async ({ payload, authorization, keyHash, req, workerPort, requestRemote }) => {
  const runtime = getNaiRuntime();
  const isUsageLimitedModel = isNaiUsageLimitedModel(payload?.model, runtime);
  const isFocusedImageEdit = payload?.parameters?._local_focused_inpainting === true
    && payload?.action === 'infill'
    && payload?.parameters?._local_edit_operation === 'inpaint';
  const opusSnapshot = getOpusUsageSnapshot(keyHash);
  if ((isUsageLimitedModel || isFocusedImageEdit) && Date.now() - opusSnapshot.updatedAt > OPUS_USAGE_STALE_MS) {
    try {
      const subscription = await fetchNovelAiSubscription(authorization, AbortSignal.timeout(10_000), requestRemote);
      if (subscription.ok) {
        const sanitized = sanitizeNovelAiSubscription(await subscription.json());
        setOpusUsageSnapshot(keyHash, sanitized.usage?.isNegative === true, sanitized.tier === 4);
      }
    } catch {
      // 网络失败时沿用上次快照，不阻塞本次已经完成的生成结算。
    }
  }
  const usageExhausted = getOpusUsageSnapshot(keyHash).exhausted;
  const estimatedCost = estimateNovelAiGenerationCost(payload, usageExhausted, getOpusUsageSnapshot(keyHash).opusSubscriber === true);
  const personalUsage = computeGenerationPersonalUsage(payload, estimatedCost, usageExhausted, runtime, true, getOpusUsageSnapshot(keyHash).opusSubscriber === true);
  const anlasBudget = estimatedCost > 0 || personalUsage.opusImagesDelta > 0
    ? await spendAnlasBudget(req, workerPort, estimatedCost, 'generation', { keyHash, ...personalUsage })
    : null;
  return { estimatedCost, personalUsage, anlasBudget };
};

// ===== NovelAI Web 应用常量自动同步 =====
// 官方未提供这些规则的查询接口（模型清单、Opus 限额换算系数、免费档门槛、
// 成本公式系数均打包在官方 Web 应用 JS 内），因此定期抓取官方页面提取并缓存；
// 提取失败时回退内置默认值，扣费与展示始终有可用数值，官方调整后无需改代码。
const promptPreset = (id, name, extra = {}) => ({ id, name, ...extra });
const clonePromptPresets = presets => presets.map(item => ({ ...item }));
const makeNaiRuntimeCapability = (overrides = {}) => ({
  supportsVibes: false,
  supportsCharacterReferences: false,
  supportsCharacterReferenceInpainting: false,
  supportsStreamedResponses: true,
  supportsTransparentBackground: false,
  maxCharacters: 6,
  freeformCharacterPosition: false,
  qualityPresets: [],
  ucPresets: [],
  ...overrides,
});
const QUALITY_V5 = clonePromptPresets([
  promptPreset('standard', 'standard', { suffix: 'very aesthetic, masterpiece, no text' }),
  promptPreset('light', 'light', { suffix: 'very aesthetic, amazing quality, no text' }),
  promptPreset('none', 'none'),
]);
const QUALITY_V45_FULL = clonePromptPresets([
  promptPreset('standard', 'standard', { suffix: 'very aesthetic, masterpiece, no text' }),
  promptPreset('none', 'none'),
]);
const QUALITY_V45_CURATED = clonePromptPresets([
  promptPreset('standard', 'standard', { suffix: 'very aesthetic, masterpiece, no text, -0.8::feet::, rating:general' }),
  promptPreset('none', 'none'),
]);
const QUALITY_V4_FULL = clonePromptPresets([
  promptPreset('standard', 'standard', { suffix: 'no text, best quality, very aesthetic, absurdres' }),
  promptPreset('none', 'none'),
]);
const QUALITY_V4_CURATED = clonePromptPresets([
  promptPreset('standard', 'standard', { suffix: 'rating:general, best quality, very aesthetic, absurdres' }),
  promptPreset('none', 'none'),
]);
const UC_V5 = clonePromptPresets([
  promptPreset('heavy', 'heavy', { category: 'heavy', prefix: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page' }),
  promptPreset('light', 'light', { category: 'light', prefix: 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::' }),
  promptPreset('furryFocus', 'furryFocus', { category: 'furry', prefix: '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic' }),
  promptPreset('humanFocus', 'humanFocus', { category: 'human', prefix: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy' }),
  promptPreset('none', 'none', { category: 'none' }),
]);
const UC_V45_FULL = clonePromptPresets([
  promptPreset('heavy', 'heavy', { category: 'heavy', prefix: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page' }),
  promptPreset('light', 'light', { category: 'light', prefix: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page' }),
  promptPreset('furryFocus', 'furryFocus', { category: 'furry', prefix: '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic' }),
  promptPreset('humanFocus', 'humanFocus', { category: 'human', prefix: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy' }),
  promptPreset('none', 'none', { category: 'none' }),
]);
const UC_V45_CURATED = clonePromptPresets([
  promptPreset('heavy', 'heavy', { category: 'heavy', prefix: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page' }),
  promptPreset('light', 'light', { category: 'light', prefix: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page' }),
  promptPreset('humanFocus', 'humanFocus', { category: 'human', prefix: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page' }),
  promptPreset('none', 'none', { category: 'none' }),
]);
const UC_V4_FULL = clonePromptPresets([
  promptPreset('heavy', 'heavy', { category: 'heavy', prefix: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page' }),
  promptPreset('light', 'light', { category: 'light', prefix: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page' }),
  promptPreset('none', 'none', { category: 'none' }),
]);
const UC_V4_CURATED = clonePromptPresets([
  promptPreset('heavy', 'heavy', { category: 'heavy', prefix: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page' }),
  promptPreset('light', 'light', { category: 'light', prefix: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page' }),
  promptPreset('none', 'none', { category: 'none' }),
]);
const V5_CAPABILITY = makeNaiRuntimeCapability({ maxCharacters: 32, freeformCharacterPosition: true, supportsTransparentBackground: true, qualityPresets: QUALITY_V5, ucPresets: UC_V5 });
const V45_FULL_CAPABILITY = makeNaiRuntimeCapability({ supportsVibes: true, supportsCharacterReferences: true, supportsCharacterReferenceInpainting: true, qualityPresets: QUALITY_V45_FULL, ucPresets: UC_V45_FULL });
const V45_CURATED_CAPABILITY = makeNaiRuntimeCapability({ supportsVibes: true, supportsCharacterReferences: true, supportsCharacterReferenceInpainting: true, qualityPresets: QUALITY_V45_CURATED, ucPresets: UC_V45_CURATED });
const V4_FULL_CAPABILITY = makeNaiRuntimeCapability({ supportsVibes: true, qualityPresets: QUALITY_V4_FULL, ucPresets: UC_V4_FULL });
const V4_CURATED_CAPABILITY = makeNaiRuntimeCapability({ supportsVibes: true, qualityPresets: QUALITY_V4_CURATED, ucPresets: UC_V4_CURATED });
const pairNaiRuntimeCapability = (id, capability) => ({ [id]: capability, [`${id}-inpainting`]: capability });
const DEFAULT_NAI_MODEL_CAPABILITIES = {
  ...pairNaiRuntimeCapability('nai-diffusion-5-full', V5_CAPABILITY),
  ...pairNaiRuntimeCapability('nai-diffusion-5-curated', V5_CAPABILITY),
  ...pairNaiRuntimeCapability('nai-diffusion-4-5-full', V45_FULL_CAPABILITY),
  ...pairNaiRuntimeCapability('nai-diffusion-4-5-curated', V45_CURATED_CAPABILITY),
  ...pairNaiRuntimeCapability('nai-diffusion-4-full', V4_FULL_CAPABILITY),
  'nai-diffusion-4-curated-preview': V4_CURATED_CAPABILITY,
  'nai-diffusion-4-curated-inpainting': V4_CURATED_CAPABILITY,
};

export const DEFAULT_NAI_RUNTIME = {
  /** Opus 限额剩余张数换算系数（官方 round(系数 × 百分比)，2026-08 版为 17.3）。 */
  imagesPerPercent: 17.3,
  costCoefficientArea: 2.951823174884865e-6,
  costCoefficientSteps: 5.753298233447344e-7,
  /** Opus 免费档门槛：无角色参考、面积与步数不超过上限。 */
  freeMaxArea: 1_048_576,
  freeMaxSteps: 28,
  models: [
    'nai-diffusion-5-full', 'nai-diffusion-5-full-inpainting',
    'nai-diffusion-5-curated', 'nai-diffusion-5-curated-inpainting',
    'nai-diffusion-4-5-full', 'nai-diffusion-4-5-full-inpainting',
    'nai-diffusion-4-5-curated', 'nai-diffusion-4-5-curated-inpainting',
    'nai-diffusion-4-full', 'nai-diffusion-4-full-inpainting',
    'nai-diffusion-4-curated-preview',
  ],
  /** 受 Opus 免费限额约束的模型（官方仅对高于 V4.5 的模型启用）。 */
  usageLimitedModels: [
    'nai-diffusion-5-full', 'nai-diffusion-5-full-inpainting',
    'nai-diffusion-5-curated', 'nai-diffusion-5-curated-inpainting',
  ],
  /** 支持 SSE 中间帧的模型，由官方 streamedResponses 能力位同步。 */
  streamedModels: [
    'nai-diffusion-5-full', 'nai-diffusion-5-full-inpainting', 'nai-diffusion-5-curated', 'nai-diffusion-5-curated-inpainting',
    'nai-diffusion-4-5-full', 'nai-diffusion-4-5-full-inpainting', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-5-curated-inpainting',
    'nai-diffusion-4-full', 'nai-diffusion-4-full-inpainting', 'nai-diffusion-4-curated-preview',
  ],
  /** NovelAI PNG 的 Source 字段到 API model_version 的精确映射。 */
  metadataModelMappings: {
    'NovelAI Diffusion V5 657484A5': 'nai-diffusion-5-full',
    'NovelAI Diffusion V5 0ADF9AB7': 'nai-diffusion-5-full',
    'NovelAI Diffusion V4.5 4BDE2A90': 'nai-diffusion-4-5-full',
    'NovelAI Diffusion V4.5 1229B44F': 'nai-diffusion-4-5-full',
    'NovelAI Diffusion V4.5 B9F340FD': 'nai-diffusion-4-5-full',
    'NovelAI Diffusion V4.5 F3D95188': 'nai-diffusion-4-5-full',
    'NovelAI Diffusion V4.5 C02D4F98': 'nai-diffusion-4-5-curated',
    'NovelAI Diffusion V4.5 5AB81C7C': 'nai-diffusion-4-5-curated',
    'NovelAI Diffusion V4.5 B5A2A797': 'nai-diffusion-4-5-curated',
    'NovelAI Diffusion V4 5AB81C7C': 'nai-diffusion-4-5-curated',
    'NovelAI Diffusion V4 B5A2A797': 'nai-diffusion-4-5-curated',
    'NovelAI Diffusion V4 37442FCA': 'nai-diffusion-4-full',
    'NovelAI Diffusion V4 4F49EC75': 'nai-diffusion-4-full',
    'NovelAI Diffusion V4 CA4B7203': 'nai-diffusion-4-full',
    'NovelAI Diffusion V4 79F47848': 'nai-diffusion-4-full',
    'NovelAI Diffusion V4 F6302A9D': 'nai-diffusion-4-full',
    'NovelAI Diffusion V4 7ABFFA2A': 'nai-diffusion-4-curated-preview',
    'NovelAI Diffusion V4 C1CCBA86': 'nai-diffusion-4-curated-preview',
    'NovelAI Diffusion V4 770A9E12': 'nai-diffusion-4-curated-preview',
  },
  modelCapabilities: DEFAULT_NAI_MODEL_CAPABILITIES,
};

const NAI_WEBAPP_SOURCE = 'https://novelai.net/image';
const NAI_RUNTIME_SYNC_FILE = join(process.cwd(), 'local-data', 'novelai-webapp-sync.json');
const NAI_RUNTIME_SYNC_INTERVAL = 24 * 60 * 60 * 1000;
const NAI_RUNTIME_RETRY_INTERVAL = 5 * 60 * 1000;
const NAI_RUNTIME_REQUEST_RETRY_DELAYS_MS = [250, 1000];
const NAI_RUNTIME_REQUEST_TIMEOUT_MS = 30_000;
/** 首次同步在网关就绪后延迟触发，把启动带宽留给 D1/R2 恢复与页面加载。 */
const NAI_RUNTIME_SYNC_STARTUP_DELAY_MS = 30_000;
let naiRuntimeState = { ...DEFAULT_NAI_RUNTIME, syncedAt: 0, health: { ok: false, reason: 'pending' } };
let naiRuntimeSyncPromise = null;
let naiRuntimeSyncInitialized = false;
let naiRuntimeSyncTimer = null;

export const getNaiRuntime = () => naiRuntimeState;

/** 仅供测试与内部覆盖，生产路径通过 syncNaiRuntime 写入。 */
export const applyNaiRuntimeOverride = partial => {
  naiRuntimeState = { ...naiRuntimeState, ...partial };
};

export const extractNaiImagesPerPercent = text => {
  // 系数函数紧跟在 timeUntilNextPercent 的恢复速率函数之后，只在锚点后的小窗口
  // 内查找，避免误匹配其他模块里同样形如 Math.round(N*var) 的代码。
  const pattern = /Math\.round\((\d+(?:\.\d+)?)\*\w+\)\}/;
  for (const anchor of text.matchAll(/timeUntilNextPercent/g)) {
    const m = pattern.exec(text.slice(anchor.index, anchor.index + 400));
    const value = m ? Number(m[1]) : NaN;
    if (Number.isFinite(value) && value > 0 && value < 1000) return value;
  }
  return null;
};

export const extractNaiCostCoefficients = text => {
  const m = text.match(/Math\.ceil\((\d+(?:\.\d+)?e-?\d+)\*\w+\+(\d+(?:\.\d+)?e-?\d+)\*\w+\*\w+\)/);
  if (!m) return null;
  const costCoefficientArea = Number(m[1]);
  const costCoefficientSteps = Number(m[2]);
  return costCoefficientArea > 0 && costCoefficientSteps > 0 ? { costCoefficientArea, costCoefficientSteps } : null;
};

export const extractNaiFreeTierLimits = text => {
  const m = text.match(/!\w+\.characterRef&&\w+\.width\*\w+\.height<=(\d+)&&\w+\.steps<=(\d+)/);
  if (!m) return null;
  return { freeMaxArea: Number(m[1]), freeMaxSteps: Number(m[2]) };
};

/**
 * 官方模型能力表的结构是 switch-case 分组：`case"id":case"id":{...opusUsageLimit:!0}`，
 * 每个 case 组以一个 opusUsageLimit 结尾，据此归组得到全量模型清单与受限模型清单。
 */
export const extractNaiModelCapabilities = text => {
  const events = [...text.matchAll(/case"(nai-diffusion-[^"]+)":/g)]
    .map(m => ({ index: m.index, label: m[1] }));
  const limits = [...text.matchAll(/opusUsageLimit:(!0|!1)/g)]
    .map(m => ({ index: m.index, limited: m[1] === '!0' }));
  const models = [];
  const usageLimitedModels = [];
  const streamedModels = [];
  const modelCapabilities = {};
  let buffered = [];
  let bufferedStart = 0;
  const readBoolean = (source, key, fallback = false) => {
    const match = source.match(new RegExp(`${key}:(!0|!1)`));
    return match ? match[1] === '!0' : fallback;
  };
  const readNumber = (source, key, fallback = 0) => {
    const match = source.match(new RegExp(`${key}:(\\d+)`));
    return match ? Number(match[1]) : fallback;
  };
  for (const event of [...events, ...limits].sort((a, b) => a.index - b.index)) {
    if (event.label) {
      if (!buffered.length) bufferedStart = event.index;
      buffered.push(event.label);
      continue;
    }
    const source = text.slice(bufferedStart, event.index);
    const streamed = /streamedResponses:!0/.test(source);
    for (const label of buffered) {
      if (!models.includes(label)) models.push(label);
      if (event.limited && !usageLimitedModels.includes(label)) usageLimitedModels.push(label);
      if (streamed && !streamedModels.includes(label)) streamedModels.push(label);
      modelCapabilities[label] = {
        supportsVibes: readBoolean(source, 'vibetransfer'),
        supportsCharacterReferences: readBoolean(source, 'characterReferences'),
        supportsCharacterReferenceInpainting: readBoolean(source, 'charRefInpainting'),
        supportsStreamedResponses: streamed,
        supportsTransparentBackground: readBoolean(source, 'transparency'),
        maxCharacters: readNumber(source, 'maxCharacters', 0),
        freeformCharacterPosition: readBoolean(source, 'freeformCharacterPosition'),
        qualityPresets: [],
        ucPresets: [],
      };
    }
    buffered = [];
  }
  return { models, usageLimitedModels, streamedModels, modelCapabilities };
};

const officialModelEnumToId = value => {
  const raw = String(value || '').replace(/^.*\./, '');
  const inpainting = /Inpainting$/i.test(raw);
  const base = inpainting ? raw.slice(0, -'Inpainting'.length) : raw;
  const match = base.match(/^naiDiffusionv?(\d+)(?:_(\d+))?(Full|Curated)(Preview)?$/i);
  if (!match) return null;
  return `nai-diffusion-${match[1]}${match[2] ? `-${match[2]}` : ''}-${match[3].toLowerCase()}${match[4] ? '-preview' : ''}${inpainting ? '-inpainting' : ''}`;
};

const findBalancedEnd = (text, start, open = '[', close = ']') => {
  let depth = 0;
  let quote = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quote = false;
      continue;
    }
    if (character === '"') { quote = true; continue; }
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

const parsePromptPresetObjects = body => {
  const presets = [];
  let index = 0;
  while (index < body.length) {
    const start = body.indexOf('{', index);
    if (start < 0) break;
    const end = findBalancedEnd(body, start, '{', '}');
    if (end < 0) break;
    const object = body.slice(start, end + 1);
    const id = object.match(/id:"([^"]+)"/)?.[1];
    const name = object.match(/name:"([^"]+)"/)?.[1];
    if (id && name) {
      const preset = { id, name };
      for (const key of ['category', 'prefix', 'suffix']) {
        const value = object.match(new RegExp(`${key}:"([^\"]*)"`))?.[1];
        if (value !== undefined) preset[key] = value;
      }
      presets.push(preset);
    }
    index = end + 1;
  }
  return presets;
};

/** 从官方压缩 bundle 提取模型对应的质量预设和 Undesired Content 预设。 */
export const extractNaiPromptPresets = text => {
  const qualityPresets = {};
  const ucPresets = {};
  const matcher = /((?:case\s+[\w$.]+:)+)return\[/g;
  for (const match of text.matchAll(matcher)) {
    const arrayStart = match.index + match[0].lastIndexOf('[');
    const arrayEnd = findBalancedEnd(text, arrayStart);
    if (arrayEnd < 0) continue;
    const presets = parsePromptPresetObjects(text.slice(arrayStart + 1, arrayEnd));
    if (!presets.length) continue;
    const target = presets.some(item => item.category) ? ucPresets : presets.some(item => item.id === 'standard') ? qualityPresets : null;
    if (!target) continue;
    const models = [...match[1].matchAll(/case\s+([\w$.]+):/g)]
      .map(item => officialModelEnumToId(item[1]))
      .filter(Boolean);
    for (const model of models) target[model] = presets.map(item => ({ ...item }));
  }
  return { qualityPresets, ucPresets };
};

/**
 * 官方图片导入器以 Source（模型展示名 + 哈希）switch-case 还原 API 模型。
 * 这里只提取明确列出的哈希分支；每代未知哈希的默认分支由前端保守处理。
 */
export const extractNaiMetadataModelMappings = text => {
  const mappings = {};
  const groups = text.matchAll(/((?:case\s*"NovelAI Diffusion [^"]+"\s*:)+)\s*return\s+[\w$]+\.oM\.([\w$]+)/g);
  for (const group of groups) {
    const enumModel = group[2].match(/^naiDiffusionV?(\d+)(?:_(\d+))?(Full|Curated)(Preview)?$/i);
    const model = enumModel
      ? `nai-diffusion-${enumModel[1]}${enumModel[2] ? `-${enumModel[2]}` : ''}-${enumModel[3].toLowerCase()}${enumModel[4] ? '-preview' : ''}`
      : null;
    if (!model) continue;
    for (const source of group[1].matchAll(/case\s*"([^"]+)"\s*:/g)) {
      mappings[source[1]] = model;
    }
  }
  return mappings;
};

/** 带短暂退避的官方 bundle 文本请求；单个 chunk 抖动时不应直接污染整次同步。 */
export const fetchNaiRuntimeText = async (url, requestRemote = fetch, retryDelays = NAI_RUNTIME_REQUEST_RETRY_DELAYS_MS) => {
  let lastError = null;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const response = await requestRemote(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(NAI_RUNTIME_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retryDelays.length) await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
    }
  }
  throw lastError || new Error('官方 bundle 请求失败');
};

/**
 * 对官方 bundle 文本执行全部提取并生成健康记录：任何一项未命中都会记录到
 * health.missed（官方改版或提取器被改坏时，调用方据此向用户示警，而不是
 * 静默退回旧常量继续运行）。
 */
export const computeNaiRuntimeSync = text => {
  const next = { ...DEFAULT_NAI_RUNTIME };
  const health = { ok: true, extracted: [], missed: [] };
  const imagesPerPercent = extractNaiImagesPerPercent(text);
  if (imagesPerPercent) {
    next.imagesPerPercent = imagesPerPercent;
    health.extracted.push('imagesPerPercent');
  } else health.missed.push('imagesPerPercent');
  const coefficients = extractNaiCostCoefficients(text);
  if (coefficients) {
    Object.assign(next, coefficients);
    health.extracted.push('costCoefficients');
  } else health.missed.push('costCoefficients');
  const freeTier = extractNaiFreeTierLimits(text);
  if (freeTier) {
    Object.assign(next, freeTier);
    health.extracted.push('freeTier');
  } else health.missed.push('freeTier');
  const capabilities = extractNaiModelCapabilities(text);
  if (capabilities.models.length && capabilities.usageLimitedModels.every(id => capabilities.models.includes(id))) {
    next.models = capabilities.models;
    next.usageLimitedModels = capabilities.usageLimitedModels;
    health.extracted.push('models');
  } else health.missed.push('models');
  if (capabilities.streamedModels.length && capabilities.streamedModels.every(id => capabilities.models.includes(id))) {
    next.streamedModels = capabilities.streamedModels;
    health.extracted.push('streamedModels');
  } else health.missed.push('streamedModels');
  if (Object.keys(capabilities.modelCapabilities).length && capabilities.models.every(id => capabilities.modelCapabilities[id])) {
    next.modelCapabilities = { ...DEFAULT_NAI_RUNTIME.modelCapabilities, ...capabilities.modelCapabilities };
    health.extracted.push('modelCapabilities');
  } else health.missed.push('modelCapabilities');
  const promptPresets = extractNaiPromptPresets(text);
  const presetModels = new Set([...Object.keys(promptPresets.qualityPresets), ...Object.keys(promptPresets.ucPresets)]);
  const projectModelIds = capabilities.models.filter(id => /^nai-diffusion-\d+(?:-\d+)?-(?:full|curated)(?:-preview)?(?:-inpainting)?$/.test(id));
  if (presetModels.size && projectModelIds.length && projectModelIds.every(id => presetModels.has(id))) {
    next.modelCapabilities = Object.fromEntries(Object.entries(next.modelCapabilities).map(([id, capability]) => [id, {
      ...capability,
      ...(promptPresets.qualityPresets[id] ? { qualityPresets: promptPresets.qualityPresets[id] } : {}),
      ...(promptPresets.ucPresets[id] ? { ucPresets: promptPresets.ucPresets[id] } : {}),
    }]));
    health.extracted.push('promptPresets');
  } else health.missed.push('promptPresets');
  const metadataModelMappings = extractNaiMetadataModelMappings(text);
  if (Object.keys(metadataModelMappings).length) {
    next.metadataModelMappings = metadataModelMappings;
    health.extracted.push('metadataModels');
  } else health.missed.push('metadataModels');
  // 页面抓到了却一项都没提取到，几乎可以确定官方改版或提取器失效。
  health.ok = health.extracted.length > 0;
  return { runtime: next, health };
};

const persistNaiRuntimeState = async () => {
  try {
    await mkdir(dirname(NAI_RUNTIME_SYNC_FILE), { recursive: true });
    await writeFile(NAI_RUNTIME_SYNC_FILE, JSON.stringify({
      syncedAt: naiRuntimeState.syncedAt,
      runtime: {
        imagesPerPercent: naiRuntimeState.imagesPerPercent,
        costCoefficientArea: naiRuntimeState.costCoefficientArea,
        costCoefficientSteps: naiRuntimeState.costCoefficientSteps,
        freeMaxArea: naiRuntimeState.freeMaxArea,
        freeMaxSteps: naiRuntimeState.freeMaxSteps,
        models: naiRuntimeState.models,
        usageLimitedModels: naiRuntimeState.usageLimitedModels,
        streamedModels: naiRuntimeState.streamedModels,
        metadataModelMappings: naiRuntimeState.metadataModelMappings,
        modelCapabilities: naiRuntimeState.modelCapabilities,
      },
      health: naiRuntimeState.health,
    }, null, 2), 'utf8');
  } catch {
    // 持久化失败只影响下次启动的初值，同步结果仍在本进程内生效。
  }
};

const runNaiRuntimeSync = async (requestRemote = fetch) => {
  let html;
  try {
    html = await fetchNaiRuntimeText(NAI_WEBAPP_SOURCE, requestRemote);
  } catch (error) {
    naiRuntimeState = {
      ...naiRuntimeState,
      health: { ok: false, reason: 'fetch', error: error.message || String(error), attemptedAt: Date.now() },
    };
    await persistNaiRuntimeState();
    console.warn('[nai-runtime] 官方页面抓取失败，沿用最近可用常量：', error.message || error);
    return false;
  }
  const paths = [...new Set([...html.matchAll(/"(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map(m => m[1]))];
  if (!paths.length) {
    naiRuntimeState = {
      ...naiRuntimeState,
      health: { ok: false, reason: 'page', error: 'official page exposes no chunks', attemptedAt: Date.now() },
    };
    await persistNaiRuntimeState();
    console.warn('[nai-runtime] 官方页面结构变化（未找到 JS 包），沿用最近可用常量');
    return false;
  }
  const chunks = await Promise.all(paths.map(path =>
    fetchNaiRuntimeText(`https://novelai.net${path}`, requestRemote).catch(() => '')));
  const { runtime, health } = computeNaiRuntimeSync(chunks.join('\n'));
  if (health.missed.length) {
    // 部分提取不能替换上一次完整快照，否则一次 chunk 网络抖动会把默认值持久化一天。
    naiRuntimeState = {
      ...naiRuntimeState,
      health: { ...health, ok: false, reason: 'partial', attemptedAt: Date.now() },
    };
    await persistNaiRuntimeState();
    console.warn('[nai-runtime] 官方常量部分提取失效，将沿用最近完整快照并稍后重试：', health.missed.join(', '));
    return false;
  }
  naiRuntimeState = { ...runtime, syncedAt: Date.now(), health };
  await persistNaiRuntimeState();
  return true;
};

export const syncNaiRuntime = (requestRemote = fetch) => {
  if (naiRuntimeSyncPromise) return naiRuntimeSyncPromise;
  naiRuntimeSyncPromise = runNaiRuntimeSync(requestRemote).finally(() => {
    naiRuntimeSyncPromise = null;
  });
  return naiRuntimeSyncPromise;
};

const scheduleNaiRuntimeSync = (delay, requestRemote = fetch) => {
  if (naiRuntimeSyncTimer !== null) clearTimeout(naiRuntimeSyncTimer);
  naiRuntimeSyncTimer = setTimeout(async () => {
    naiRuntimeSyncTimer = null;
    let succeeded = false;
    try {
      succeeded = await syncNaiRuntime(requestRemote);
    } catch (error) {
      console.warn('[nai-runtime] 同步任务异常，将稍后重试：', error.message || error);
    }
    scheduleNaiRuntimeSync(succeeded ? NAI_RUNTIME_SYNC_INTERVAL : NAI_RUNTIME_RETRY_INTERVAL, requestRemote);
  }, delay);
  if (typeof naiRuntimeSyncTimer.unref === 'function') naiRuntimeSyncTimer.unref();
};

const initNaiRuntimeSync = async (requestRemote = fetch) => {
  if (naiRuntimeSyncInitialized) return;
  naiRuntimeSyncInitialized = true;
  try {
    const saved = JSON.parse(await readFile(NAI_RUNTIME_SYNC_FILE, 'utf8'));
    if (saved?.runtime) {
      naiRuntimeState = {
        ...DEFAULT_NAI_RUNTIME,
        ...saved.runtime,
        syncedAt: Number(saved.syncedAt) || 0,
        health: saved.health?.missed?.length
          ? { ...saved.health, ok: false, reason: 'partial' }
          : saved.health || { ok: true, extracted: [], missed: [] },
      };
    }
  } catch {
    // 无历史同步时直接使用内置默认值。
  }
  // 启动后延迟同步，失败时改为短间隔重试，完整成功后再恢复每日同步。
  scheduleNaiRuntimeSync(NAI_RUNTIME_SYNC_STARTUP_DELAY_MS, requestRemote);
};

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
  const keyHash = keyHashFromAuthorization(authorization);
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
  if (queueEnabled) cloudQueue.update(queueTaskId, { phase: 'preparing', cancelable: true, controller: requestController, keyHash });

  try {
    const rawBody = await readRequestBody(req, GENERATION_REQUEST_LIMIT);
    let payload;
    try { payload = JSON.parse(rawBody.toString('utf8')); } catch { return sendJson(res, 400, { error: '生图请求不是有效 JSON' }); }
    const localVibes = payload?.parameters?._local_vibes;
    const localCharacterReferences = payload?.parameters?._local_character_references;
    const runtime = getNaiRuntime();
    const capability = getNaiModelCapability(payload?.model, runtime) || {
      supportsVibes: false,
      supportsCharacterReferences: false,
      supportsCharacterReferenceInpainting: false,
      maxCharacters: 6,
    };
    const editOperation = String(payload?.parameters?._local_edit_operation || '');
    const isImageEdit = payload?.action === 'infill' || payload?.action === 'img2img'
      || editOperation === 'inpaint' || editOperation === 'outpaint' || editOperation === 'image-to-image';
    const allowsVibes = !isImageEdit || editOperation === 'image-to-image';
    const allowsCharacterReferences = isImageEdit && editOperation !== 'image-to-image'
      ? capability.supportsCharacterReferenceInpainting === true
      : capability.supportsCharacterReferences === true;
    const characterPromptCount = Array.isArray(payload?.parameters?.v4_prompt?.caption?.char_captions)
      ? payload.parameters.v4_prompt.caption.char_captions.length
      : 0;
    const maxCharacters = Math.max(1, Number(capability.maxCharacters) || 6);
    if (characterPromptCount > maxCharacters) {
      return sendJson(res, 400, { error: `当前模型最多支持 ${maxCharacters} 个角色提示词` });
    }
    if (localVibes?.enabled && localVibes?.slots?.length && !capability.supportsVibes) {
      return sendJson(res, 400, { error: '当前模型不支持 Vibe Transfer' });
    }
    if (localVibes?.enabled && localVibes?.slots?.length && !allowsVibes) {
      return sendJson(res, 400, { error: '局部重绘和扩图不发送 Vibe Transfer' });
    }
    if (localCharacterReferences?.enabled && localCharacterReferences?.slots?.length && !allowsCharacterReferences) {
      return sendJson(res, 400, { error: '当前模型或编辑模式不支持角色参考' });
    }
    if (localVibes?.enabled && localVibes?.slots?.length && localCharacterReferences?.enabled && localCharacterReferences?.slots?.length) {
      return sendJson(res, 400, { error: 'Vibe Transfer 与角色参考不能同时使用' });
    }
    let resolvedVibeEncodings = null;
    let vibeCacheKeysSentWithData = new Set();
    if (localVibes?.enabled && Array.isArray(localVibes.slots) && localVibes.slots.length) {
      const slots = localVibes.slots.slice(0, 16);
      if (localVibes.slots.length > 16) return sendJson(res, 400, { error: '一次最多使用 16 个 Vibe' });
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
        if (!allowsCharacterReferences) return sendJson(res, 400, { error: '当前模型或编辑模式不支持角色参考' });
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
    const settlementPayload = JSON.parse(JSON.stringify(payload));
    if (payload.parameters) {
      delete payload.parameters._local_edit_operation;
      delete payload.parameters._local_focused_inpainting;
      delete payload.parameters._local_minimum_context_area;
    }
    if (queueEnabled) {
      queueLock = await cloudQueue.join({
        apiKey: authorization.slice(7).trim(),
        taskId: queueTaskId,
        greeting: queueGreeting,
        showGreeting: showQueueGreeting,
        serviceUrl: queuePreferences.serviceUrl,
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
    const { estimatedCost, anlasBudget } = response.ok
      ? await settleSuccessfulNovelAiGeneration({ payload: settlementPayload, authorization, keyHash, req, workerPort, requestRemote })
      : { estimatedCost: 0, anlasBudget: null };
    const headers = {
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(anlasBudget ? { 'X-Nai-Anlas-Remaining': String(anlasBudget.remaining), 'X-Nai-Anlas-Estimated-Spent': String(estimatedCost) } : {}),
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

const handleGenerateStreamRequest = async (req, res, lanSecret, workerPort, cloudQueue, queuePreferences, requestRemote) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) return sendJson(res, 401, { error: '缺少 NovelAI API Key' });

  const queueEnabled = queuePreferences.enabled === true;
  const keyHash = keyHashFromAuthorization(authorization);
  const requestedTaskId = String(req.headers['x-nai-queue-task-id'] || '');
  const queueTaskId = /^[a-zA-Z0-9-]{8,80}$/.test(requestedTaskId) ? requestedTaskId : randomUUID();
  const requestController = new AbortController();
  const generationSignal = AbortSignal.any([requestController.signal, AbortSignal.timeout(300_000)]);
  let queueLock = null;
  let requestAborted = false;
  let responseCompleted = false;
  const abortRequest = () => {
    if (responseCompleted) return;
    requestAborted = true;
    requestController.abort(new DOMException('用户已取消生成', 'AbortError'));
  };
  req.once('aborted', abortRequest);
  res.once('close', abortRequest);
  if (queueEnabled) cloudQueue.update(queueTaskId, { phase: 'preparing', cancelable: true, controller: requestController, keyHash });

  try {
    const rawBody = await readRequestBody(req, GENERATION_REQUEST_LIMIT);
    let payload;
    try { payload = JSON.parse(rawBody.toString('utf8')); } catch { return sendJson(res, 400, { error: '生图请求不是有效 JSON' }); }
    const runtime = getNaiRuntime();
    if (!runtime.streamedModels.includes(payload?.model)) {
      return sendJson(res, 400, { error: '当前模型不支持生成过程预览，请关闭该设置后重试' });
    }
    const hasLocalVibes = payload?.parameters?._local_vibes?.enabled && payload.parameters._local_vibes.slots?.length;
    const hasLocalReferences = payload?.parameters?._local_character_references?.enabled && payload.parameters._local_character_references.slots?.length;
    if (hasLocalVibes || hasLocalReferences) {
      return sendJson(res, 400, { error: '当前参考图功能不支持生成过程预览，请关闭过程预览后重试' });
    }
    delete payload.parameters._local_vibes;
    delete payload.parameters._local_character_references;
    const settlementPayload = JSON.parse(JSON.stringify(payload));
    delete payload.parameters._local_edit_operation;
    delete payload.parameters._local_focused_inpainting;
    delete payload.parameters._local_minimum_context_area;
    payload.parameters.stream = 'sse';

    if (queueEnabled) {
      queueLock = await cloudQueue.join({
        apiKey: authorization.slice(7).trim(),
        taskId: queueTaskId,
        greeting: String(queuePreferences.greeting || '').slice(0, 15),
        showGreeting: queuePreferences.showGreeting !== false,
        serviceUrl: queuePreferences.serviceUrl,
        signal: requestController.signal,
      });
      cloudQueue.update(queueTaskId, { phase: 'generating', position: 0, cancelable: false, controller: requestController });
      await delay(1000, requestController.signal);
    }

    const upstream = await fetchNovelAiGenerationStream(payload, authorization, generationSignal, requestRemote);
    if (!upstream.ok) {
      const upstreamError = new Error(await upstream.text() || `NovelAI HTTP ${upstream.status}`);
      upstreamError.status = upstream.status;
      throw upstreamError;
    }
    if (!upstream.body) throw Object.assign(new Error('NovelAI 流式接口没有返回响应体'), { status: 502 });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
      ...(queueEnabled ? { 'X-Nai-Queue-Task-Id': queueTaskId } : {}),
    });
    const decoder = new TextDecoder();
    let finalSeen = false;
    let upstreamErrorSeen = false;
    const observer = createSseEventObserver(event => {
      if (event === 'final') finalSeen = true;
      if (event === 'error') upstreamErrorSeen = true;
    });
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      observer.push(decoder.decode(value, { stream: !done }));
      if (value?.byteLength) res.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      if (done) break;
    }
    observer.finish();

    if (!finalSeen) {
      const message = upstreamErrorSeen ? 'NovelAI 流式生成失败' : '流式响应结束但没有最终图片';
      if (queueEnabled) cloudQueue.update(queueTaskId, { phase: 'error', error: message, cancelable: false, controller: null });
      res.write(`\nevent: error\ndata: ${JSON.stringify({ message })}\n\n`);
      responseCompleted = true;
      return res.end();
    }

    try {
      const { estimatedCost, anlasBudget } = await settleSuccessfulNovelAiGeneration({
        payload: settlementPayload, authorization, keyHash, req, workerPort, requestRemote,
      });
      res.write(`\nevent: nai_usage\ndata: ${JSON.stringify({
        keyHash,
        remaining: anlasBudget?.remaining,
        estimatedSpent: estimatedCost,
        refreshPersonal: true,
      })}\n\n`);
    } catch (accountingError) {
      // 图片已经由 NovelAI 成功生成，结算异常单独上报，绝不能触发前端再次生图。
      res.write(`\nevent: nai_usage_error\ndata: ${JSON.stringify({ message: accountingError?.message || '本地用量结算失败' })}\n\n`);
    }
    if (queueEnabled) cloudQueue.update(queueTaskId, { phase: 'completed', cancelable: false, controller: null });
    responseCompleted = true;
    return res.end();
  } catch (error) {
    const cancelled = requestAborted || error?.name === 'AbortError';
    const message = cancelled ? '已取消生成' : (error?.message || '流式生成失败');
    if (queueEnabled) cloudQueue.update(queueTaskId, { phase: cancelled ? 'cancelled' : 'error', error: message, cancelable: false, controller: null });
    if (res.headersSent) {
      if (!res.destroyed) {
        res.write(`\nevent: error\ndata: ${JSON.stringify({ message })}\n\n`);
        responseCompleted = true;
        res.end();
      }
      return;
    }
    if (error?.code === 'CLOUD_QUEUE_UNAVAILABLE') return sendJson(res, 503, { error: `公共队列服务不可用：${error.message}`, code: error.code });
    if (cancelled) return sendJson(res, 499, { error: message, code: 'QUEUE_CANCELLED' });
    return sendJson(res, Number(error.status) || 502, { error: message });
  } finally {
    req.off('aborted', abortRequest);
    res.off('close', abortRequest);
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
        const encodeKeyHash = createHash('sha256').update(authorization.slice(7)).digest('hex');
        const anlasBudget = await spendAnlasBudget(req, workerPort, 2, 'vibe-encoding', { keyHash: encodeKeyHash, anlasDelta: 2, opusImagesDelta: 0 });
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

/** 图库浏览预热：feed/search 返回后，后台按低优先级把该批缩略图抓好写进磁盘缓存，
 *  用户滚动到对应图片时直接缓存命中（~3ms），消除首次抓取（0.8-3s）的等待。
 *  只预热桌面/常见布局实际使用的 thumb-320：高分屏所需的 640/960 按需首抓后同样入缓存，
 *  避免一半预热工作量生成用不到的档位。 */
const PREWARM_VARIANTS = ['thumb-320'];
const PREWARM_CONCURRENCY = 6;
const PREWARM_MAX_PENDING = 300;
/** 队列内部分辨“固定保留”任务的内部后缀（URL 之外的哨兵，不参与网络请求）。 */
const PIN_SUFFIX = '\u0001pin';

export const createThumbnailPreWarmer = ({
  cache,
  loadOriginal,
  concurrency = PREWARM_CONCURRENCY,
  maxPending = PREWARM_MAX_PENDING,
} = {}) => {
  const pending = new Set();
  let running = 0;
  // 即时调度：占用一个并发槽立即启动一个任务，完成后再补，无需定时器轮询限速。
  const pump = () => {
    while (running < concurrency && pending.size > 0) {
      const next = pending.values().next();
      if (next.done) break;
      pending.delete(next.value);
      running += 1;
      const pinned = next.value.endsWith(PIN_SUFFIX);
      const source = pinned ? next.value.slice(0, -PIN_SUFFIX.length) : next.value;
      Promise.allSettled(
        PREWARM_VARIANTS.map(variant => cache.get(source, variant, loadOriginal, { pinned }).catch(() => {})),
      ).finally(() => {
        running -= 1;
        pump();
      });
    }
  };
  return {
    /** 把一批来源加入预热队列（跳过已缓存/已在队列）；返回新加入数量。
     *  pinned=true 时跳过条件改为“已缓存且已固定保留”，并以此生成（封面图持久本地化）。 */
    enqueue(sources, { pinned = false } = {}) {
      let added = 0;
      for (const source of sources) {
        const queuedKey = pinned ? `${source}${PIN_SUFFIX}` : source;
        if (pending.size + added > maxPending) break;
        const skip = pinned
          ? PREWARM_VARIANTS.every(variant => cache.isPinned(source, variant))
          : PREWARM_VARIANTS.every(variant => cache.has(source, variant));
        if (skip) continue;
        if (pending.has(queuedKey)) continue;
        pending.add(queuedKey);
        added += 1;
      }
      if (added) pump();
      return added;
    },
    get pendingCount() { return pending.size; },
  };
};

export const getValidatedSource = value => {  const source = String(value || '');
  if (!source || source.length > SOURCE_LIMIT || /[\r\n]/.test(source)) throw new Error('Invalid image source');
  if (source.startsWith('/api/assets/')) return { type: 'local', source };
  if (/^\/api\/(?:local-history\/[^/]+\/image|inspirations\/[^/]+\/image|vibes\/[^/]+\/(?:image|thumbnail)|character-references\/[^/]+\/(?:image|thumbnail))(?:\?.*)?$/.test(source)) return { type: 'local', source };
  const stChatu8History = source.match(/^\/api\/integrations\/st-chatu8\/history\/([a-f0-9]{64})\/image$/i);
  if (stChatu8History) return { type: 'st-chatu8-history', source, externalId: stChatu8History[1].toLowerCase() };
  let url;
  try { url = new URL(source); } catch { throw new Error('Unsupported image source'); }
  const host = url.hostname.toLowerCase();
  // i.pximg.net 只在本机 media gateway 白名单内，worker 的 MEDIA_REMOTE_HOSTS 不包含它。
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || !(ALLOWED_REMOTE_HOSTS.has(host) || host === PIXIV_IMAGE_HOST)) throw new Error('Remote image host is not allowed');
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
      'user-agent': req.headers['user-agent'] || 'NAI-Atelier-MediaGateway',
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

export const requestRemoteBuffer = async (source, remoteFetch = fetch) => {
  let current = source;
  for (let redirects = 0; redirects < 4; redirects++) {
    const url = new URL(current);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || !(ALLOWED_REMOTE_HOSTS.has(host) || host === PIXIV_IMAGE_HOST)) throw new Error('Remote image redirect is not allowed');
    const headers = { accept: 'image/*', 'user-agent': 'NAI-Atelier-MediaGateway/1.0' };
    // Pixiv 图片必须携带官方 Referer，否则上游返回 403。
    if (host === PIXIV_IMAGE_HOST) headers.referer = PIXIV_REFERER;
    const response = await remoteFetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers,
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

const requestAitagWithCurl = async (target, targetType) => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'nai-aitag-'));
  const outputPath = join(tempDirectory, 'response.bin');
  const accept = targetType === 'json'
    ? AITAG_BROWSER_HEADERS.accept
    : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';

  try {
    const command = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const { stdout } = await execFile(command, [
      '--silent',
      '--show-error',
      '--connect-timeout', '10',
      '--max-time', '30',
      '--max-filesize', String(INPUT_LIMIT),
      '--proto', '=https',
      '--output', outputPath,
      '--write-out', '%{http_code}\n%{content_type}',
      '--header', `Accept: ${accept}`,
      '--header', `Referer: ${AITAG_BROWSER_HEADERS.referer}`,
      '--header', `User-Agent: ${AITAG_BROWSER_HEADERS['user-agent']}`,
      target.toString(),
    ], { windowsHide: true, timeout: 35_000, maxBuffer: 64 * 1024 });
    const [statusText, contentType = ''] = String(stdout).trim().split(/\r?\n/, 2);
    const status = Number(statusText);
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error('AITag curl returned an invalid status');
    const body = await readFile(outputPath);
    if (body.length > INPUT_LIMIT) throw new Error('AITag response is too large');
    return new Response(body, {
      status,
      headers: {
        'content-type': contentType || (targetType === 'json' ? 'application/json' : 'application/octet-stream'),
        'content-length': String(body.length),
      },
    });
  } finally {
    await unlink(outputPath).catch(() => {});
    await rmdir(tempDirectory).catch(() => {});
  }
};

export const fetchAitagRemoteResponse = async (target, targetType, remoteFetch, curlFetch = requestAitagWithCurl) => {
  const headers = {
    ...AITAG_BROWSER_HEADERS,
    accept: targetType === 'json'
      ? AITAG_BROWSER_HEADERS.accept
      : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };

  if (targetType === 'json') {
    try {
      return await curlFetch(target, targetType);
    } catch {
      return remoteFetch(target, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers });
    }
  }

  const response = await remoteFetch(target, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers });
  if (response.status !== 403) return response;
  return curlFetch(target, targetType);
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
    const response = await fetchAitagRemoteResponse(target, targetType, remoteFetch);
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

const handleDanbooruRemoteRequest = async (req, res, url, lanSecret, remoteFetch) => {
  const suppliedSecret = String(req.headers['x-nai-internal-secret'] || '');
  const expected = Buffer.from(lanSecret);
  const supplied = Buffer.from(suppliedSecret);
  if (!isLoopbackIp(req.socket.remoteAddress) || !lanSecret || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return sendJson(res, 404, { error: 'Not found' });
  }
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const target = new URL(url.searchParams.get('url') || '');
    if (!classifyDanbooruRemoteTarget(target.toString())) return sendJson(res, 400, { error: 'Invalid Danbooru target' });
    const response = await remoteFetch(target, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: 'application/json',
        'user-agent': 'NAI-Atelier/0.5 (+local personal use)',
      },
    });
    const contentType = response.headers.get('content-type') || '';
    const body = await readLimitedResponse(response);
    if (body.length > 16 * 1024 * 1024) return sendJson(res, 502, { error: 'Danbooru response is too large' });
    if (!contentType.toLowerCase().includes('json')) return sendJson(res, 502, { error: 'Danbooru returned a non-JSON response' });
    res.writeHead(response.status, {
      'Content-Type': contentType,
      'Content-Length': body.length,
      'Cache-Control': 'private, max-age=120',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(body);
  } catch (error) {
    return sendJson(res, error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 504 : 502, {
      error: `电脑无法连接 Danbooru：${error?.cause?.message || error?.message || '未知错误'}`,
    });
  }
};

export const handlePixivGalleryRequest = async (req, res, url, pixivGallery, pixivWebLogin, prewarmer) => {
  if (url.pathname === '/api/pixiv/status') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    return sendJson(res, 200, pixivGallery.status());
  }
  if (url.pathname === '/api/pixiv/login/start') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    if (!isPixivConnectionMutationAllowed(req)) {
      return sendJson(res, 403, { error: '请在运行 NAI Atelier 的电脑上登录；登录后手机可浏览', code: 'PIXIV_CONNECT_LOCAL_ONLY' });
    }
    return sendJson(res, 200, await pixivWebLogin.start());
  }
  if (url.pathname === '/api/pixiv/login/status') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    const state = pixivWebLogin.status(url.searchParams.get('id'));
    if (!state) return sendJson(res, 404, { error: '登录会话不存在', code: 'PIXIV_LOGIN_NOT_FOUND' });
    return sendJson(res, 200, state);
  }
  if (url.pathname === '/api/pixiv/login/complete') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    if (!isPixivConnectionMutationAllowed(req)) {
      return sendJson(res, 403, { error: '请在运行 NAI Atelier 的电脑上完成登录', code: 'PIXIV_CONNECT_LOCAL_ONLY' });
    }
    let body = {};
    try { body = JSON.parse((await readRequestBody(req, 8192)).toString('utf8') || '{}'); } catch {
      return sendJson(res, 400, { error: '请求体不是有效 JSON', code: 'PIXIV_INVALID_BODY' });
    }
    return sendJson(res, 200, await pixivWebLogin.complete(body.id, body.callbackUrl));
  }
  if (url.pathname === '/api/pixiv/login') {
    if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
    if (!isPixivConnectionMutationAllowed(req)) {
      return sendJson(res, 403, { error: '请在运行 NAI Atelier 的电脑上登录；登录后手机可浏览', code: 'PIXIV_CONNECT_LOCAL_ONLY' });
    }
    return sendJson(res, 200, await pixivWebLogin.cancel(url.searchParams.get('id')));
  }
  if (url.pathname === '/api/pixiv/connect') {
    if (!isPixivConnectionMutationAllowed(req)) {
      return sendJson(res, 403, { error: 'Pixiv 连接信息只能在本机电脑上修改', code: 'PIXIV_CONNECT_LOCAL_ONLY' });
    }
    if (req.method === 'POST') {
      let body = {};
      try { body = JSON.parse((await readRequestBody(req, 4096)).toString('utf8') || '{}'); } catch {
        return sendJson(res, 400, { error: '请求体不是有效 JSON', code: 'PIXIV_INVALID_BODY' });
      }
      return sendJson(res, 200, await pixivGallery.connect(body.refreshToken || body.refresh_token));
    }
    if (req.method === 'DELETE') {
      return sendJson(res, 200, await pixivGallery.disconnect());
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  if (url.pathname === '/api/pixiv/feed') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    const result = await pixivGallery.feed({
      mode: url.searchParams.get('mode'),
      cursor: url.searchParams.get('cursor'),
      params: Object.fromEntries(url.searchParams),
    });
    // 后台预热该批缩略图：滚动时缓存命中，不再等待首次抓取。
    // 取源顺序必须与卡片请求一致（medium 优先），否则预热缓存键 miss。
    if (prewarmer && Array.isArray(result.items)) {
      const sources = result.items
        .map(item => item.urls?.medium || item.urls?.large || item.urls?.thumb || '')
        .filter(Boolean);
      prewarmer.enqueue(sources);
    }
    return sendJson(res, 200, result);
  }
  if (url.pathname === '/api/pixiv/bookmark') {
    if (req.method === 'POST') {
      let body = {};
      try { body = JSON.parse((await readRequestBody(req, 4096)).toString('utf8') || '{}'); } catch {
        return sendJson(res, 400, { error: '请求体不是有效 JSON', code: 'PIXIV_INVALID_BODY' });
      }
      return sendJson(res, 200, await pixivGallery.addBookmark({ illustId: body.illust_id || body.illustId, restrict: body.restrict }));
    }
    if (req.method === 'DELETE') {
      let body = {};
      try { body = JSON.parse((await readRequestBody(req, 4096)).toString('utf8') || '{}'); } catch {
        body = {};
      }
      const illustId = body.illust_id || body.illustId || url.searchParams.get('illust_id') || url.searchParams.get('illustId');
      return sendJson(res, 200, await pixivGallery.deleteBookmark({ illustId }));
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  return sendJson(res, 404, { error: 'Pixiv 接口不存在', code: 'PIXIV_NOT_FOUND' });
};

class ThumbnailCache {
  constructor(concurrency = THUMBNAIL_JOB_CONCURRENCY) {
    this.entries = {};
    this.inFlight = new Map();
    this.sourceInFlight = new Map();
    this.activeJobs = 0;
    this.concurrency = concurrency;
    this.jobQueue = [];
    this.writeTimer = null;
    this.indexWritePromise = Promise.resolve();
  }

  async init() {
    await mkdir(CACHE_DIR, { recursive: true });
    try { this.entries = JSON.parse(await readFile(CACHE_INDEX, 'utf8')); } catch { this.entries = {}; }
    const files = new Set(await readdir(CACHE_DIR));
    const referencedFiles = new Set();
    for (const [key, entry] of Object.entries(this.entries)) {
      if (!entry?.file || !files.has(entry.file)) delete this.entries[key];
      else referencedFiles.add(entry.file);
    }
    for (const file of files) {
      if (file === 'index.json') continue;
      if (file.endsWith('.tmp')) {
        await unlink(join(CACHE_DIR, file)).catch(() => {});
        continue;
      }
      if (!referencedFiles.has(file)) await unlink(join(CACHE_DIR, file)).catch(() => {});
    }
    this.scheduleIndexWrite();
  }

  scheduleIndexWrite() {
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      const snapshot = `${JSON.stringify(this.entries)}\n`;
      this.indexWritePromise = this.indexWritePromise.catch(() => {}).then(async () => {
        const temporary = `${CACHE_INDEX}.${process.pid}.tmp`;
        await writeFile(temporary, snapshot, 'utf8');
        await rename(temporary, CACHE_INDEX);
      }).catch(() => {});
    }, 500);
    this.writeTimer.unref?.();
  }

  async withJobSlot(task) {
    if (this.activeJobs >= this.concurrency) await new Promise(resolve => this.jobQueue.push(resolve));
    this.activeJobs++;
    try { return await task(); } finally {
      this.activeJobs--;
      this.jobQueue.shift()?.();
    }
  }

  async prune() {
    // 先约束 pinned 总量：超过上限时按最久未访问淘汰固定封面
    let pinnedTotal = Object.values(this.entries).reduce((sum, entry) => entry.pinned ? sum + Number(entry.size || 0) : sum, 0);
    if (pinnedTotal > PIN_CACHE_LIMIT) {
      const pinnedOldest = Object.entries(this.entries)
        .filter(([, entry]) => entry.pinned)
        .sort((a, b) => Number(a[1].accessedAt || 0) - Number(b[1].accessedAt || 0));
      for (const [key, entry] of pinnedOldest) {
        await unlink(join(CACHE_DIR, entry.file)).catch(() => {});
        pinnedTotal -= Number(entry.size || 0);
        delete this.entries[key];
        if (pinnedTotal <= PIN_CACHE_TARGET) break;
      }
      console.warn(`[cache] pinned 封面缓存超过 ${PIN_CACHE_LIMIT >> 20}MB 上限，已按最久未访问淘汰到 ${PIN_CACHE_TARGET >> 20}MB 以内`);
      this.scheduleIndexWrite();
    }

    let total = Object.values(this.entries).reduce((sum, entry) => sum + Number(entry.size || 0), 0);
    if (total <= CACHE_LIMIT) return;
    // 只淘汰普通（非固定）缩略图；pinned 封面图（画师/角色 Tag 当前封面）永久保留，
    // 不受 1GB 容量限制影响。
    const oldest = Object.entries(this.entries)
      .filter(([, entry]) => !entry.pinned)
      .sort((a, b) => Number(a[1].accessedAt || 0) - Number(b[1].accessedAt || 0));
    for (const [key, entry] of oldest) {
      await unlink(join(CACHE_DIR, entry.file)).catch(() => {});
      total -= Number(entry.size || 0);
      delete this.entries[key];
      if (total <= CACHE_PRUNE_TARGET) break;
    }
    this.scheduleIndexWrite();
  }

  keyFor(source, variant) {
    const version = variant === 'thumb-960' && (
      /^\/api\/local-history\/[^/]+\/image$/i.test(source)
      || /^\/api\/integrations\/st-chatu8\/history\/[a-f0-9]{64}\/image$/i.test(source)
    ) ? HISTORY_THUMBNAIL_CACHE_VERSION : CACHE_VERSION;
    return createHash('sha256').update(`${version}|${variant}|${source}`).digest('hex');
  }

  has(source, variant) {
    return Boolean(this.entries[this.keyFor(source, variant)]);
  }

  stats() {
    return Object.values(this.entries).reduce((summary, entry) => {
      const size = Math.max(0, Number(entry?.size || 0));
      summary.count += 1;
      summary.bytes += size;
      if (entry?.pinned) {
        summary.pinnedCount += 1;
        summary.pinnedBytes += size;
      }
      return summary;
    }, {
      count: 0,
      bytes: 0,
      pinnedCount: 0,
      pinnedBytes: 0,
      limitBytes: CACHE_LIMIT,
      pinnedLimitBytes: PIN_CACHE_LIMIT,
    });
  }

  /** 该缩略图是否已标记为固定保留（封面图）。 */
  isPinned(source, variant) {
    return this.entries[this.keyFor(source, variant)]?.pinned === true;
  }

  async put(source, variant, buffer, { pinned = false } = {}) {
    const key = this.keyFor(source, variant);
    const file = `${key}.webp`;
    const temp = join(CACHE_DIR, `${key}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temp, buffer);
    await rename(temp, join(CACHE_DIR, file));
    this.entries[key] = { file, size: buffer.length, accessedAt: Date.now(), source, variant, pinned };
    this.scheduleIndexWrite();
    await this.prune();
    return { etag: `"nai-${key}"` };
  }

  async get(source, variant, loadOriginal, { pinned = false } = {}) {
    const key = this.keyFor(source, variant);
    const existing = this.entries[key];
    if (existing) {
      try {
        const buffer = await readFile(join(CACHE_DIR, existing.file));
        existing.accessedAt = Date.now();
        // 请求标记为固定保留时升级该条目的 pinned 状态（封面图不再被 LRU 淘汰）。
        if (pinned && !existing.pinned) {
          existing.pinned = true;
          this.scheduleIndexWrite();
        }
        return { buffer, etag: `"nai-${key}"` };
      } catch { delete this.entries[key]; }
    }
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const promise = this.withJobSlot(async () => {
      let originalPromise = this.sourceInFlight.get(source);
      if (!originalPromise) {
        originalPromise = Promise.resolve().then(loadOriginal).finally(() => this.sourceInFlight.delete(source));
        this.sourceInFlight.set(source, originalPromise);
      }
      const original = await originalPromise;
      if (original.status >= 400) {
        const error = new Error('Source image was not found');
        error.status = original.status;
        throw error;
      }
      const { default: sharp } = await import('sharp');
      const output = await sharp(original.buffer, { failOn: 'warning', limitInputPixels: 100_000_000 })
        .rotate()
        .resize({ width: THUMB_WIDTHS.get(variant), height: THUMB_WIDTHS.get(variant), fit: 'inside', withoutEnlargement: true })
        .webp({ quality: variant === 'thumb-960' ? 78 : 72, effort: variant === 'thumb-960' ? 3 : 4 })
        .toBuffer();
      const file = `${key}.webp`;
      const temp = join(CACHE_DIR, `${key}.${process.pid}.${Date.now()}.tmp`);
      await writeFile(temp, output);
      await rename(temp, join(CACHE_DIR, file));
      this.entries[key] = { file, size: output.length, accessedAt: Date.now(), source, variant, pinned };
      this.scheduleIndexWrite();
      await this.prune();
      return { buffer: output, etag: `"nai-${key}"` };
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

export async function createMediaGateway({ port = 3000, workerPort = 3001, lanSecret = '', outboundProxyUrl = '', pixivFetch, pixivTokenDir, pixivWebLogin } = {}) {
// 静态前端资源直接由网关从 dist/ 提供：页面与资源加载不依赖 workerd，也不占用其请求槽。
const STATIC_CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};
const DIST_ROOT = join(process.cwd(), 'dist');
const serveDistFile = async (req, res, url) => {
  let pathname = url.pathname;
  try { pathname = decodeURIComponent(pathname); } catch { return false; }
  if (pathname.includes('..') || pathname.includes('\0')) return false;
  const relative = pathname.replace(/^\/+/, '') || 'index.html';
  const filePath = join(DIST_ROOT, relative);
  if (!filePath.startsWith(DIST_ROOT)) return false;
  let data;
  try { data = await readFile(filePath); } catch { return false; }
  const ext = extname(filePath).toLowerCase();
  // 带内容哈希的构建产物可永久缓存；入口与清单文件禁用缓存。
  const immutable = relative.startsWith('assets/') || /[.-][a-f0-9]{8,}\./i.test(relative);
  res.writeHead(200, {
    'Content-Type': STATIC_CONTENT_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(data);
  return true;
};
  const proxyAgent = outboundProxyUrl ? new ProxyAgent(outboundProxyUrl) : null;
  const remoteFetch = (url, options = {}) => undiciFetch(url, { ...options, ...(proxyAgent ? { dispatcher: proxyAgent } : {}) });
  const cloudQueue = new CloudQueueCoordinator(remoteFetch);
  const imageTagger = new ImageTaggerService(remoteFetch);
  const cloudQueueStore = await loadCloudQueuePreferences();
  const getCloudQueueScope = async req => {
    const keyHash = keyHashFromRequest(req);
    const resolved = resolveCloudQueuePreferences(cloudQueueStore, keyHash);
    if (resolved.migrated) await saveCloudQueuePreferences(cloudQueueStore);
    return { keyHash, preferences: resolved.preferences };
  };
  const cache = new ThumbnailCache();
  // 图库浏览预热：feed/搜索返回后后台抓取缩略图写盘，滚动时缓存命中秒出。
  const thumbnailPreWarmer = createThumbnailPreWarmer({
    cache,
    loadOriginal: source => requestRemoteBuffer(source, remoteFetch),
  });
  const promptAgent = new PromptAgentService({ lanSecret, outboundProxyUrl });
  const stChatu8Bridge = new StChatu8Bridge({
    projectRoot: process.cwd(),
    requestWorkerJson: (path, options) => requestWorkerJson(path, internalWorkerRequest, workerPort, options),
    requestWorkerBuffer: path => requestWorkerBuffer(path, internalWorkerRequest, workerPort),
  });
  // Pixiv 图库只在本机 media gateway 提供：worker 部署不含任何 Pixiv 逻辑，
  // /api/pixiv 在 Cloudflare 上必然 401/404（fail closed）。
  const pixivGallery = new PixivGalleryService({
    fetch: pixivFetch || remoteFetch,
    tokenDir: pixivTokenDir || join(process.cwd(), 'local-data'),
  });
  // 网页登录编排器：成功令牌经 generation 防竞态写入并清 feed 缓存；gateway 退出也清理。
  const webLoginOrchestrator = pixivWebLogin || new PixivWebLoginOrchestrator({
    getGeneration: () => pixivGallery.store.generation,
    onTokens: async (tokens, session) => {
      await pixivGallery.importWebLoginTokens(tokens, { expectedGeneration: session.expectedGeneration });
    },
  });
  await cache.init();
  await promptAgent.init();
  await stChatu8Bridge.init();
  await pixivGallery.init();
  await recoverPendingVibeEncodings(workerPort);
  stChatu8Bridge.startHistorySync();
  // 后台同步官方 Web 应用常量（模型清单、限额换算、免费门槛、成本系数）。
  // 走网关代理分流（remoteFetch）：与订阅接口一致，避免直连被 TUN 出口抖动黑洞导致部分提取失败。
  void initNaiRuntimeSync(remoteFetch);

  // 用户会话最近一次请求时间：历史缩略图预热必须让行，避免抢占真实浏览的并发槽。
  let lastUserTrafficAt = 0;
  const markUserTraffic = () => { lastUserTrafficAt = Date.now(); };
  const historyIndexStatus = {
    running: false,
    total: 0,
    completed: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
    startedAt: 0,
    completedAt: 0,
  };
  let historyIndexPromise = null;

  const warmHistorySources = async (sources, variant = 'thumb-960', onProgress) => {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(THUMBNAIL_JOB_CONCURRENCY, sources.length) }, async () => {
      while (cursor < sources.length) {
        const source = sources[cursor++];
        if (cache.has(source, variant)) {
          onProgress?.('skipped');
          continue;
        }
        try {
      const validated = getValidatedSource(source);
      const loadOriginal = () => validated.type === 'local'
        ? requestWorkerBuffer(validated.source, internalWorkerRequest, workerPort)
        : validated.type === 'st-chatu8-history'
          ? stChatu8Bridge.readHistoryImage(validated.externalId).then(image => ({
            status: 200,
            buffer: image.buffer,
            headers: { 'content-type': image.contentType },
          }))
          : requestRemoteBuffer(validated.source, remoteFetch);
      await cache.get(validated.source, variant, loadOriginal);
          onProgress?.('generated');
        } catch {
          onProgress?.('failed');
        }
      }
    });
    await Promise.all(workers);
  };

  try {
    const recentHistory = await requestWorkerJson('/api/local-history/media-index?page=0&pageSize=20&includeCount=0', internalWorkerRequest, workerPort);
    await warmHistorySources((recentHistory.items || []).map(item => item.imageUrl).filter(Boolean));
  } catch {
    // History warming is an optimization and must never block local startup.
  }

  const buildHistoryIndex = () => {
    if (historyIndexPromise) return historyIndexPromise;
    historyIndexPromise = (async () => {
      Object.assign(historyIndexStatus, {
        running: true,
        total: 0,
        completed: 0,
        generated: 0,
        skipped: 0,
        failed: 0,
        startedAt: Date.now(),
        completedAt: 0,
      });
      for (let page = 0; ; page++) {
        // 用户正在使用时退避：把缩略图并发与 D1 查询让给真实浏览请求。
        while (Date.now() - lastUserTrafficAt < 3000) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        const result = await requestWorkerJson(`/api/local-history/media-index?page=${page}&pageSize=100&includeCount=${page === 0 ? '1' : '0'}`, internalWorkerRequest, workerPort);
        const items = result.items || [];
        if (page === 0) historyIndexStatus.total = Number(result.count || items.length);
        if (!items.length) break;
        await warmHistorySources(items.map(item => item.imageUrl).filter(Boolean), 'thumb-960', outcome => {
          historyIndexStatus.completed++;
          historyIndexStatus[outcome]++;
        });
        if (items.length < 100) break;
      }
      historyIndexStatus.running = false;
      historyIndexStatus.completedAt = Date.now();
    })().catch(() => {
      historyIndexStatus.running = false;
      historyIndexStatus.failed++;
      historyIndexStatus.completedAt = Date.now();
    }).finally(() => { historyIndexPromise = null; });
    return historyIndexPromise;
  };

  const server = createServer(async (req, res) => {
    markUserTraffic();
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
    // 局域网密码：解锁与改密由网关实时读取 local-data/lan-access.json 承载，
    // 改密后立即生效无需重启（worker 的 env.PIN 是启动快照，仅作本机直连兜底）。
    if (url.pathname === '/api/lan/unlock') return handleLanUnlock(req, res, { secret: lanSecret });
    if (url.pathname === '/api/lan/pin') return handleLanPinUpdate(req, res, { secret: lanSecret });
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
        if (url.pathname === '/api/prompt-agent/vision-selection') {
          if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
          const body = JSON.parse((await readRequestBody(req, 8 * 1024)).toString('utf8') || '{}');
          return sendJson(res, 200, await promptAgent.selectVisionModel(String(body.provider || ''), String(body.model || ''), body.mode === 'auto' ? 'auto' : 'manual'));
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
            const cloudQueueScope = await getCloudQueueScope(req);
            const result = await promptAgent.run(body, emit, undefined, {
              requestJson: (path, options) => requestWorkerJson(path, req, workerPort, options),
              getQueuePreferences: () => ({ ...cloudQueueScope.preferences }),
              setQueuePreferences: async next => {
                if (!cloudQueueScope.keyHash) throw new Error('请先配置 NovelAI API Key，再修改该密钥的公共队列设置');
                const preferences = normalizeCloudQueuePreferences({
                  ...cloudQueueScope.preferences,
                  ...next,
                  serviceUrl: normalizeCloudQueueServiceUrl(next.serviceUrl ?? cloudQueueScope.preferences.serviceUrl),
                });
                cloudQueueStore.accounts[cloudQueueScope.keyHash] = preferences;
                cloudQueueScope.preferences = preferences;
                await saveCloudQueuePreferences(cloudQueueStore);
                return { ...preferences };
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
    if (url.pathname === '/api/image-tagger/status') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      return sendJson(res, 200, await imageTagger.status());
    }
    if (url.pathname === '/api/image-tagger') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) return sendJson(res, 415, { error: '只支持 PNG、JPEG 和 WebP 图片' });
      try {
        const image = await readRequestBody(req, 20 * 1024 * 1024);
        if (!image.length) return sendJson(res, 400, { error: '图片内容为空' });
        const threshold = Math.min(0.95, Math.max(0.05, Number(url.searchParams.get('threshold') || 0.35)));
        const characterThreshold = Math.min(0.99, Math.max(0.05, Number(url.searchParams.get('characterThreshold') || 0.85)));
        return sendJson(res, 200, await imageTagger.tag(image, { threshold, characterThreshold }));
      } catch (error) {
        return sendJson(res, Number(error.status) || 500, { error: error.message || '图片反推 Tag 失败' });
      }
    }
    if (url.pathname === '/api/local-maintenance/status') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      let workerReady = false;
      try {
        const workerStatus = await requestWorkerJson('/api/lan/status', req, workerPort);
        workerReady = typeof workerStatus?.authorized === 'boolean';
      } catch {
        // 媒体网关仍可回应时，向设置页如实报告核心 Worker 未就绪。
      }
      return sendJson(res, 200, { gatewayReady: true, workerReady, thumbnailCache: cache.stats() });
    }
    if (url.pathname === '/api/local-maintenance/backup/status') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      try {
        const status = await localBackupService.getStatus();
        return sendJson(res, 200, status);
      } catch (error) {
        return sendJson(res, 500, { error: error.message || '无法获取备份状态' });
      }
    }
    if (url.pathname === '/api/local-maintenance/backup/start') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      try {
        const body = JSON.parse((await readRequestBody(req, 4096)).toString('utf8') || '{}');
        const result = await localBackupService.startBackup(body);
        return sendJson(res, 200, result);
      } catch (error) {
        return sendJson(res, Number(error.status) || 500, { error: error.message || '启动备份失败' });
      }
    }
    if (url.pathname === '/api/local-maintenance/backup/config') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      try {
        const body = JSON.parse((await readRequestBody(req, 4096)).toString('utf8') || '{}');
        const updated = await saveBackupConfig(body);
        return sendJson(res, 200, updated);
      } catch (error) {
        return sendJson(res, Number(error.status) || 400, { error: error.message || '保存备份配置失败' });
      }
    }
    if (url.pathname === '/api/local-maintenance/backup/open-folder') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      try {
        const body = JSON.parse((await readRequestBody(req, 4096)).toString('utf8') || '{}');
        const targetPath = body.path || (await localBackupService.getStatus()).targetDir;
        const result = await openInExplorer(targetPath);
        return sendJson(res, 200, result);
      } catch (error) {
        return sendJson(res, 400, { error: error.message || '无法打开目录' });
      }
    }
    if (url.pathname === '/api/tag-dictionary') {
      if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { error: '仅支持 GET 或 POST 请求' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      try {
        return sendJson(res, 200, await requestTagDictionaryControl(req.method));
      } catch (error) {
        return sendJson(res, Number(error.status) || 503, { error: error.message || 'Tag 词库服务不可用' });
      }
    }
    if (url.pathname.startsWith('/api/pixiv/')) {
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      try {
        return await handlePixivGalleryRequest(req, res, url, pixivGallery, webLoginOrchestrator, thumbnailPreWarmer);
      } catch (error) {
        const payload = { error: error.message || 'Pixiv 请求失败', code: error.code || 'PIXIV_ERROR' };
        if (error.upstreamStatus) payload.upstreamStatus = Number(error.upstreamStatus);
        return sendJson(res, Number(error.status) || 502, payload);
      }
    }
    if (url.pathname === '/__internal/aitag-fetch') return handleAitagRemoteRequest(req, res, url, lanSecret, remoteFetch);
    if (url.pathname === '/__internal/danbooru-fetch') return handleDanbooruRemoteRequest(req, res, url, lanSecret, remoteFetch);
    if (url.pathname === '/api/generate') {
      const { preferences } = await getCloudQueueScope(req);
      return handleGenerateRequest(req, res, lanSecret, workerPort, cloudQueue, preferences, remoteFetch);
    }
    if (url.pathname === '/api/generate-stream') {
      const { preferences } = await getCloudQueueScope(req);
      return handleGenerateStreamRequest(req, res, lanSecret, workerPort, cloudQueue, preferences, remoteFetch);
    }
    if (url.pathname === '/api/novelai-subscription') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      const authorization = String(req.headers.authorization || '');
      if (!authorization.startsWith('Bearer ')) return sendJson(res, 401, { error: '缺少 NovelAI API Key' });
      try {
        const upstream = await fetchNovelAiSubscription(authorization, undefined, remoteFetch);
        if (!upstream.ok) {
          return sendJson(res, 502, { error: 'NovelAI 订阅信息获取失败', upstreamStatus: upstream.status });
        }
        const payload = await upstream.json();
        const sanitized = sanitizeNovelAiSubscription(payload);
        setOpusUsageSnapshot(keyHashFromAuthorization(authorization), sanitized.usage?.isNegative === true, sanitized.tier === 4);
        return sendJson(res, 200, sanitized);
      } catch (error) {
        return sendJson(res, 502, { error: error.message || 'NovelAI 订阅信息获取失败' });
      }
    }
    if (url.pathname === '/api/novelai-runtime') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      return sendJson(res, 200, getNaiRuntime());
    }
    if (url.pathname === '/api/generation-queue/preferences') {
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      const scope = await getCloudQueueScope(req);
      if (req.method === 'GET') return sendJson(res, 200, scope.preferences);
      if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!scope.keyHash) return sendJson(res, 401, { error: '缺少 NovelAI API Key' });
      try {
        const body = JSON.parse((await readRequestBody(req, 4096)).toString('utf8') || '{}');
        const serviceUrl = normalizeCloudQueueServiceUrl(body.serviceUrl ?? scope.preferences.serviceUrl);
        const preferences = normalizeCloudQueuePreferences({ ...scope.preferences, ...body, serviceUrl });
        cloudQueueStore.accounts[scope.keyHash] = preferences;
        await saveCloudQueuePreferences(cloudQueueStore);
        return sendJson(res, 200, preferences);
      } catch (error) {
        return sendJson(res, Number(error.status) || 400, { error: error.message || '公共队列设置无效' });
      }
    }
    if (url.pathname === '/api/generation-queue/status') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      const keyHash = keyHashFromRequest(req);
      if (!keyHash) return sendJson(res, 401, { error: '缺少 NovelAI API Key' });
      const status = cloudQueue.get(url.searchParams.get('taskId') || '');
      if (!status || status.keyHash !== keyHash) return sendJson(res, 404, { error: '排队任务不存在' });
      const { controller, keyHash: _keyHash, ...safeStatus } = status;
      return sendJson(res, 200, safeStatus);
    }
    if (url.pathname === '/api/generation-queue/cancel') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      const keyHash = keyHashFromRequest(req);
      if (!keyHash) return sendJson(res, 401, { error: '缺少 NovelAI API Key' });
      const body = await readJsonBody(req, 4096);
      const status = cloudQueue.get(String(body.taskId || ''));
      if (status && status.keyHash !== keyHash) return sendJson(res, 404, { error: '排队任务不存在' });
      if (!status?.cancelable || !status.controller) return sendJson(res, 409, { error: '当前任务已不能取消' });
      status.controller.abort(new DOMException('用户已取消排队', 'AbortError'));
      cloudQueue.update(status.taskId, { phase: 'cancelled', cancelable: false, controller: null });
      return sendJson(res, 200, { status: 'ok' });
    }
    const vibeEncodeMatch = url.pathname.match(/^\/api\/vibes\/([^/]+)\/encodings$/);
    if (vibeEncodeMatch) return handleVibeEncodeRequest(req, res, lanSecret, workerPort, decodeURIComponent(vibeEncodeMatch[1]), remoteFetch);
    if (url.pathname === '/api/media/history-index/status') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      return sendJson(res, 200, historyIndexStatus);
    }
    if (url.pathname === '/api/media/cache') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      try {
        const variant = url.searchParams.get('variant') || '';
        if (!THUMB_WIDTHS.has(variant)) return sendJson(res, 400, { error: 'Invalid image variant' });
        const validated = getValidatedSource(url.searchParams.get('source'));
        if (validated.type !== 'local' || !/^\/api\/local-history\/[^/]+\/image$/i.test(validated.source)) {
          return sendJson(res, 400, { error: 'Only local history thumbnails can be cached' });
        }
        if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('image/webp')) {
          return sendJson(res, 415, { error: 'Only WebP thumbnails are supported' });
        }
        const thumbnail = await readRequestBody(req, 2 * 1024 * 1024);
        if (thumbnail.length < 12 || thumbnail.toString('ascii', 0, 4) !== 'RIFF' || thumbnail.toString('ascii', 8, 12) !== 'WEBP') {
          return sendJson(res, 400, { error: 'Invalid WebP thumbnail' });
        }
        const cached = await cache.put(validated.source, variant, thumbnail);
        return sendJson(res, 200, { cached: true, etag: cached.etag, bytes: thumbnail.length });
      } catch (error) {
        return sendJson(res, Number(error.status) || 500, { error: error.message || 'Unable to cache thumbnail' });
      }
    }
    if (url.pathname === '/api/media/prewarm') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
      try {
        const body = JSON.parse((await readRequestBody(req, 64 * 1024)).toString('utf8') || '{}');
        const rawSources = Array.isArray(body.sources) ? body.sources.slice(0, 120) : [];
        const sources = [];
        for (const value of rawSources) {
          try {
            const validated = getValidatedSource(value);
            if (validated.type === 'remote') sources.push(validated.source);
          } catch { /* 非法来源跳过 */ }
        }
        const queued = thumbnailPreWarmer.enqueue(sources, { pinned: body.pin === true });
        return sendJson(res, 200, { queued, pending: thumbnailPreWarmer.pendingCount });
      } catch (error) {
        return sendJson(res, 400, { error: error.message || 'Invalid prewarm request' });
      }
    }
    // 静态前端资源由网关直接提供，/api 与 /__internal 继续转发给 workerd。
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/__internal/') && await serveDistFile(req, res, url)) return;
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
        let isPixivOriginal = false;
        if (validated.type === 'remote') {
          try {
            const originalUrl = new URL(validated.source);
            isPixivOriginal = originalUrl.protocol === 'https:'
              && (!originalUrl.port || originalUrl.port === '443')
              && originalUrl.hostname.toLowerCase() === PIXIV_IMAGE_HOST;
          } catch {}
        }
        // Pixiv 原图不能 302 直出（浏览器不会带官方 Referer），由网关带 Referer 代理。
        if (validated.type === 'local' || (validated.type === 'remote' && !isPixivOriginal)) {
          const location = validated.type === 'local'
            ? new URL(validated.source, `http://${req.headers.host || 'localhost'}`).toString()
            : validated.source;
          res.writeHead(302, {
            Location: location,
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
          });
          return res.end();
        }
        const original = await loadOriginal();
        if (original.status >= 400) return sendJson(res, original.status, { error: 'Source image was not found' });
        res.writeHead(200, {
          'Content-Type': original.headers['content-type'] || 'application/octet-stream',
          'Content-Length': original.buffer.length,
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(original.buffer);
      }

      // pin=1 表示固定保留（画师/角色封面缩略图），不参与 LRU 淘汰。
      const pinned = url.searchParams.get('pin') === '1';
      const thumbnail = await cache.get(validated.source, variant, loadOriginal, { pinned });
      if (req.headers['if-none-match'] === thumbnail.etag) {
        res.writeHead(304, {
          ETag: thumbnail.etag,
          'Cache-Control': 'private, max-age=31536000, immutable',
        });
        return res.end();
      }
      res.writeHead(200, {
        'Content-Type': 'image/webp',
        'Content-Length': thumbnail.buffer.length,
        'Cache-Control': 'private, max-age=31536000, immutable',
        ETag: thumbnail.etag,
        'X-Nai-Thumbnail-Bytes': thumbnail.buffer.length,
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(thumbnail.buffer);
    } catch (error) {
      sendJson(res, Number(error.status) || 502, { error: error.message || 'Image processing failed' });
    }
  });
  server.on('close', () => {
    proxyAgent?.close().catch(() => {});
    void webLoginOrchestrator.shutdown?.();
  });

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
  // 历史缩略图预热延迟到页面与首次浏览就绪后再启动，避免抢占启动期资源。
  setTimeout(() => void buildHistoryIndex(), 35_000).unref?.();
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await createMediaGateway({
    port: Number(process.env.NAI_GATEWAY_PORT || 3000),
    workerPort: Number(process.env.NAI_WORKER_PORT || 3001),
    lanSecret: process.env.NAI_LAN_SECRET || '',
  });
  console.log(`NAI Atelier media gateway listening on ${server.address().port}`);
}
