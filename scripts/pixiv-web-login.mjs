import { spawn as nodeSpawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { PIXIV_APP_CLIENT_ID, PIXIV_APP_CLIENT_SECRET, PIXIV_HASH_SECRET, PIXIV_OAUTH_TOKEN_URL, PIXIV_USER_AGENT } from './pixiv-local.mjs';

// Windows 本机 Pixiv 网页登录：启动隔离的 Microsoft Edge 官方登录窗口，
// 通过 CDP 截获 OAuth 授权码并换 token。所有秘密（code/verifier/token/CDP ws）
// 只存在于内存会话中，任何响应/错误/日志都不携带。

export const PIXIV_LOGIN_URL_BASE = 'https://app-api.pixiv.net/web/v1/login';
export const PIXIV_CALLBACK_URL = 'https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback';
export const PIXIV_LOGIN_REDIRECT_URI = PIXIV_CALLBACK_URL;
export const PIXIV_LOGIN_SESSION_TTL_MS = 5 * 60 * 1000;
export const PIXIV_LOGIN_DEVTOOLS_TIMEOUT_MS = 10_000;
export const PIXIV_LOGIN_PROFILE_PREFIX = 'pixiv-login-';
export const MAX_PIXIV_CALLBACK_CODE_LENGTH = 1024;
export const PIXIV_LOGIN_ID_MAX_LENGTH = 64;

export const PIXIV_LOGIN_STATES = Object.freeze(['starting', 'awaiting-user', 'exchanging', 'connected', 'failed', 'canceled', 'timed-out']);
export const PIXIV_LOGIN_ACTIVE_STATES = new Set(['starting', 'awaiting-user', 'exchanging']);
export const PIXIV_LOGIN_TERMINAL_STATES = new Set(['connected', 'failed', 'canceled', 'timed-out']);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pixivLoginError = (message, code, status = 500, extra = {}) => Object.assign(new Error(message), { code, status, ...extra });

/** 脱敏文本：替换已知秘密、常见 query 形式的授权码以及 CDP ws 地址。 */
export const redactPixivLoginSecrets = (value, secrets = []) => {
  let text = String(value ?? '');
  for (const secret of secrets) {
    if (secret && text.includes(secret)) text = text.split(secret).join('[redacted]');
  }
  return text
    .replace(/\b(code|code_verifier|refresh_token|access_token|verifier)=[^&\s"]{8,}/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi, 'Bearer [redacted]')
    .replace(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[A-Za-z0-9._~-]+/gi, '[redacted]');
};

// ---- PKCE 与登录 URL（纯函数） ----

/** 生成 PKCE 对：verifier 为 32 字节随机 base64url，challenge 为 S256。 */
export const createPkcePair = (entropy = randomBytes) => {
  const verifier = entropy(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

/** 官方网页登录 URL：必须携带 code_challenge/code_challenge_method=S256/client=pixiv-android。 */
export const buildPixivLoginUrl = ({ codeChallenge, client = 'pixiv-android' } = {}) => {
  const query = new URLSearchParams({
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    client,
  });
  return `${PIXIV_LOGIN_URL_BASE}?${query.toString()}`;
};

/** 只解析顶层 OAuth callback URL；返回 { code } 或 null。code 必须有界。 */
export const parsePixivCallbackUrl = (value, { maxCodeLength = MAX_PIXIV_CALLBACK_CODE_LENGTH } = {}) => {
  let url;
  try { url = new URL(String(value || '')); } catch { return null; }
  if (url.username || url.password) return null;
  const isOfficialCallback = url.protocol === 'https:'
    && url.host === 'app-api.pixiv.net'
    && url.pathname === '/web/v1/users/auth/pixiv/callback';
  const isPixivScheme = url.protocol === 'pixiv:'
    && url.host === 'account'
    && url.pathname === '/login';
  if (!isOfficialCallback && !isPixivScheme) return null;
  const code = String(url.searchParams.get('code') || '');
  if (!code || code.length > maxCodeLength) return null;
  return { code };
};

/** 解析 Edge profile 的 DevToolsActivePort：首行端口、次行浏览器级 ws 路径。 */
export const parseDevToolsActivePort = value => {
  const lines = String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const port = Number(lines[0]);
  const browserPath = lines[1] || '';
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!/^\/devtools\/browser\/[A-Za-z0-9._~-]+$/.test(browserPath)) return null;
  return { port, browserPath };
};

// ---- Edge 路径探测与启动参数 ----

export const buildEdgeCandidatePaths = ({ localAppData, programFiles, programFilesX86, programW6432 } = {}) => {
  const candidates = [];
  const push = base => {
    if (base) candidates.push(join(String(base), 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  };
  push(localAppData);
  push(programFilesX86);
  push(programFiles);
  push(programW6432);
  return [...new Set(candidates)];
};

export const findEdgeExecutable = async ({ env = process.env } = {}) => {
  const candidates = buildEdgeCandidatePaths({
    localAppData: env.LOCALAPPDATA,
    programFiles: env.ProgramFiles,
    programFilesX86: env['ProgramFiles(x86)'],
    programW6432: env.ProgramW6432,
  });
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* 继续探测 */ }
  }
  return null;
};

/** Edge 启动参数：独立 profile、随机端口（只从 DevToolsActivePort 读）、可见窗口。 */
export const buildEdgeArgs = ({ profileDir, loginUrl }) => [
  `--user-data-dir=${profileDir}`,
  '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--no-default-browser-check',
  loginUrl,
];

// ---- authorization_code 换 token ----

export const buildTokenExchangeRequest = ({ code, codeVerifier, clientId = PIXIV_APP_CLIENT_ID, clientSecret = PIXIV_APP_CLIENT_SECRET, tokenUrl = PIXIV_OAUTH_TOKEN_URL, now = new Date() } = {}) => {
  const clientTime = now.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const clientHash = createHash('md5').update(`${clientTime}${PIXIV_HASH_SECRET}`).digest('hex');
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: PIXIV_LOGIN_REDIRECT_URI,
    include_policy: 'true',
  });
  return {
    url: tokenUrl,
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      'user-agent': PIXIV_USER_AGENT,
      'app-os': 'ios',
      'app-os-version': '14.6',
      'x-client-time': clientTime,
      'x-client-hash': clientHash,
    },
  };
};

export const exchangeAuthorizationCode = async ({ code, codeVerifier, fetch: requestFetch = globalThis.fetch, clientId, clientSecret, tokenUrl, timeoutMs = 30_000, now = () => new Date() } = {}) => {
  const request = buildTokenExchangeRequest({ code, codeVerifier, clientId, clientSecret, tokenUrl, now: now() });
  let response;
  try {
    response = await requestFetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw pixivLoginError('无法连接 Pixiv 认证服务', 'PIXIV_LOGIN_EXCHANGE_FAILED', 502);
  }
  const text = await response.text().catch(() => '');
  let payload = null;
  try { payload = JSON.parse(text || '{}'); } catch { payload = null; }
  const tokenPayload = payload?.response && typeof payload.response === 'object' ? payload.response : payload;
  if (!response.ok || !tokenPayload || !String(tokenPayload.access_token || '')) {
    throw pixivLoginError(
      response.status === 400 ? '登录已过期，请重新登录' : 'Pixiv 登录换取令牌失败',
      'PIXIV_LOGIN_EXCHANGE_FAILED',
      response.status === 400 ? 401 : 502,
      { upstreamStatus: response.status },
    );
  }
  const tokens = {
    refreshToken: String(tokenPayload.refresh_token || '').trim(),
    accessToken: String(tokenPayload.access_token || '').trim(),
    accessTokenExpiresAt: Number(tokenPayload.expires_in) > 0 ? Date.now() + Number(tokenPayload.expires_in) * 1000 : 0,
    updatedAt: Date.now(),
  };
  if (!tokens.refreshToken || !tokens.accessToken) {
    throw pixivLoginError('Pixiv 登录响应缺少令牌', 'PIXIV_LOGIN_EXCHANGE_FAILED', 502);
  }
  return tokens;
};

// ---- 公开状态（绝不包含任何秘密） ----

export const serializePixivLoginState = session => {
  if (!session) return null;
  const state = {
    id: session.id,
    state: session.state,
    message: session.message,
    expiresAt: session.expiresAt,
  };
  if (session.state === 'connected') state.connected = true;
  return state;
};

// ---- 进程与临时目录清理 ----

/** 只终止自己 spawn 的进程：Windows 用 taskkill /T 杀进程树，绝不扫全量 Edge。 */
export const killProcessTree = (child, spawnFn = nodeSpawn) => {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32' && typeof spawnFn === 'function') {
    try {
      const killer = spawnFn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      killer.unref?.();
    } catch { /* 回退到直接 kill */ }
  }
  try { child.kill(); } catch { /* 已退出 */ }
};

/** 校验临时 profile 在专用临时根下且命名匹配，然后重试删除。 */
export const removePixivLoginProfile = async (profileDir, { root, prefix = PIXIV_LOGIN_PROFILE_PREFIX, retries = 20, retryDelayMs = 250, sleepFn = sleep } = {}) => {
  if (!profileDir) return;
  const rootPath = resolve(root);
  const target = resolve(profileDir);
  if (!target.startsWith(rootPath + sep) || !basename(target).startsWith(prefix)) return;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch {
      if (attempt < retries - 1) await sleepFn(retryDelayMs);
    }
  }
};

/** 等待刚刚终止的 Edge 主进程退出，让 Windows 释放 profile 文件句柄。 */
export const waitForChildExit = async (child, { timeoutMs = 2500 } = {}) => {
  if (!child || child.exitCode !== null) return;
  await new Promise(resolveWait => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off?.('exit', done);
      child.off?.('close', done);
      resolveWait();
    };
    const timer = setTimeout(done, timeoutMs);
    timer.unref?.();
    child.once?.('exit', done);
    child.once?.('close', done);
  });
};

// ---- 编排器：状态机 starting/awaiting-user/exchanging/connected/failed/canceled/timed-out ----

export class PixivWebLoginOrchestrator {
  constructor({
    spawn = nodeSpawn,
    fetch: requestFetch = globalThis.fetch,
    WebSocketImpl = WebSocket,
    clock = () => Date.now(),
    sleepFn = sleep,
    tmpRoot = join(process.cwd(), 'local-data', 'pixiv-login'),
    findEdgePath = findEdgeExecutable,
    readDevToolsPort,
    exchange,
    onTokens,
    getGeneration,
    ttlMs = PIXIV_LOGIN_SESSION_TTL_MS,
    devToolsTimeoutMs = PIXIV_LOGIN_DEVTOOLS_TIMEOUT_MS,
    cleanupRetryMs = 300,
  } = {}) {
    this.spawn = spawn;
    this.requestFetch = requestFetch;
    this.WebSocketImpl = WebSocketImpl;
    this.clock = clock;
    this.sleepFn = sleepFn;
    this.tmpRoot = tmpRoot;
    this.findEdgePath = findEdgePath;
    this.readDevToolsPort = readDevToolsPort || ((profileDir, session) => this.pollDevToolsPort(profileDir, session));
    this.exchange = exchange || (({ code, codeVerifier }) => exchangeAuthorizationCode({ code, codeVerifier, fetch: this.requestFetch }));
    this.onTokens = onTokens || null;
    this.getGeneration = getGeneration || null;
    this.ttlMs = ttlMs;
    this.devToolsTimeoutMs = devToolsTimeoutMs;
    this.cleanupRetryMs = cleanupRetryMs;
    this.active = null;
  }

  async start() {
    if (this.active && PIXIV_LOGIN_ACTIVE_STATES.has(this.active.state)) {
      throw pixivLoginError('已有进行中的 Pixiv 登录', 'PIXIV_LOGIN_ACTIVE', 409);
    }
    const now = this.clock();
    const session = {
      id: randomBytes(12).toString('base64url'),
      state: 'starting',
      message: '正在启动登录窗口…',
      createdAt: now,
      expiresAt: now + this.ttlMs,
      expectedGeneration: this.getGeneration ? await this.getGeneration() : null,
      settled: false,
      pending: new Map(),
      commandId: 0,
      mainFrameId: null,
      cleanupPromise: null,
      timer: null,
    };
    this.active = session;
    try {
      session.edgePath = await this.findEdgePath();
      if (!session.edgePath) throw pixivLoginError('未找到 Microsoft Edge', 'PIXIV_EDGE_NOT_FOUND', 500);
      const pkce = createPkcePair(randomBytes);
      session.verifier = pkce.verifier;
      session.challenge = pkce.challenge;
      await mkdir(this.tmpRoot, { recursive: true });
      await this.cleanupStaleProfiles();
      session.profileDir = await mkdtemp(join(this.tmpRoot, PIXIV_LOGIN_PROFILE_PREFIX));
      const loginUrl = buildPixivLoginUrl({ codeChallenge: pkce.challenge });
      session.state = 'awaiting-user';
      session.message = '请在打开的 Pixiv 登录窗口中完成登录';
      const child = this.spawn(session.edgePath, buildEdgeArgs({ profileDir: session.profileDir, loginUrl }), { stdio: 'ignore' });
      session.child = child;
      child.unref?.();
      child.on?.('exit', () => this.handleChildExit(session));
      child.on?.('error', error => this.handleSpawnError(session, error));
      const endpoint = await this.readDevToolsPort(session.profileDir, session);
      if (!endpoint?.port || !endpoint?.browserPath) throw pixivLoginError('登录窗口启动失败', 'PIXIV_EDGE_START_FAILED', 500);
      session.wsUrl = `ws://127.0.0.1:${endpoint.port}${endpoint.browserPath}`;
      this.connectCdp(session);
      session.timer = setTimeout(() => void this.handleTimeout(session), Math.max(1, session.expiresAt - this.clock()));
      session.timer?.unref?.();
      return serializePixivLoginState(session);
    } catch (error) {
      await this.fail(session, error);
      return serializePixivLoginState(session);
    }
  }

  async pollDevToolsPort(profileDir, session) {
    const deadline = this.clock() + this.devToolsTimeoutMs;
    while (this.clock() < deadline) {
      if (session.child && session.child.exitCode !== null) {
        throw pixivLoginError('登录窗口已关闭', 'PIXIV_EDGE_CLOSED', 500);
      }
      try {
        const parsed = parseDevToolsActivePort(await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8'));
        if (parsed) return parsed;
      } catch { /* 尚未生成 */ }
      await this.sleepFn(100);
    }
    throw pixivLoginError('登录窗口启动失败', 'PIXIV_EDGE_START_FAILED', 500);
  }

  connectCdp(session) {
    let ws;
    try {
      ws = new this.WebSocketImpl(session.wsUrl);
    } catch (error) {
      void this.fail(session, pixivLoginError('登录窗口启动失败', 'PIXIV_EDGE_START_FAILED', 500, { cause: error }));
      return;
    }
    session.ws = ws;
    ws.addEventListener?.('open', () => {
      if (session.settled) return;
      this.sendCommand(session, 'Target.setDiscoverTargets', { discover: true }).catch(() => {});
    });
    ws.addEventListener?.('message', event => this.handleCdpMessage(session, event));
    ws.addEventListener?.('error', () => {
      if (!session.settled) void this.fail(session, pixivLoginError('登录窗口启动失败', 'PIXIV_EDGE_START_FAILED', 500));
    });
    ws.addEventListener?.('close', () => {
      if (!session.settled && session.state !== 'exchanging') {
        void this.fail(session, pixivLoginError('登录窗口启动失败', 'PIXIV_EDGE_START_FAILED', 500));
      }
    });
  }

  handleCdpMessage(session, event) {
    if (session.settled) return;
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.id !== undefined) {
      const pending = session.pending.get(message.id);
      if (pending) {
        session.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(String(message.error.message || 'CDP 命令失败')));
        else pending.resolve(message.result || {});
      }
      return;
    }
    if (message.method === 'Target.targetCreated' && message.params?.targetInfo?.type === 'page') {
      void this.attachPage(session, message.params.targetInfo.targetId);
      return;
    }
    if (message.method === 'Target.attachedToTarget' && message.params?.sessionId && message.params?.targetInfo?.type === 'page') {
      this.enablePageSession(session, message.params.sessionId);
      return;
    }
    if (message.method === 'Page.frameNavigated' && message.sessionId) {
      const frame = message.params?.frame;
      if (!frame) return;
      if (!frame.parentId) session.mainFrameId = frame.id;
      this.inspectNavigation(session, frame.url);
      return;
    }
    if (message.method === 'Network.requestWillBeSent' && message.sessionId) {
      const params = message.params || {};
      if (params.type !== 'Document' || !session.mainFrameId || params.frameId !== session.mainFrameId) return;
      this.inspectNavigation(session, params.request?.url);
    }
  }

  inspectNavigation(session, url) {
    if (session.settled) return;
    const parsed = parsePixivCallbackUrl(url);
    if (parsed) void this.handleCallback(session, parsed.code);
  }

  async attachPage(session, targetId) {
    try {
      const result = await this.sendCommand(session, 'Target.attachToTarget', { targetId, flatten: true });
      if (result?.sessionId) this.enablePageSession(session, result.sessionId);
    } catch { /* 目标可能已关闭 */ }
  }

  enablePageSession(session, sessionId) {
    this.sendSessionCommand(session, sessionId, 'Page.enable', {}).catch(() => {});
    this.sendSessionCommand(session, sessionId, 'Network.enable', {}).catch(() => {});
  }

  sendCommand(session, method, params = {}) {
    return this.sendCdp(session, null, method, params);
  }

  sendSessionCommand(session, sessionId, method, params = {}) {
    return this.sendCdp(session, sessionId, method, params);
  }

  sendCdp(session, sessionId, method, params) {
    const ws = session.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || session.settled) return Promise.resolve(null);
    const id = ++session.commandId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (session.pending.delete(id)) reject(new Error('CDP 命令超时'));
      }, 5000);
      timer.unref?.();
      session.pending.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify(payload));
      } catch (error) {
        session.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async handleCallback(session, code) {
    if (session.settled) return; // code 一次性
    session.settled = true;
    this.clearTimer(session);
    session.state = 'exchanging';
    session.message = '正在换取令牌…';
    this.closeWs(session);
    try {
      const tokens = await this.exchange({ code, codeVerifier: session.verifier });
      if (this.active !== session) return;
      if (this.onTokens) await this.onTokens(tokens, session);
      if (this.active !== session) return;
      await this.finish(session, 'connected', '登录成功');
    } catch (error) {
      await this.fail(session, error);
    }
  }

  handleChildExit(session) {
    if (session.settled || this.active !== session) return;
    void this.finish(session, 'canceled', '登录窗口已关闭');
  }

  handleSpawnError(session, error) {
    if (session.settled || this.active !== session) return;
    void this.fail(session, pixivLoginError('登录窗口启动失败', 'PIXIV_EDGE_START_FAILED', 500, { cause: error }));
  }

  handleTimeout(session) {
    if (session.settled || this.active !== session) return;
    void this.finish(session, 'timed-out', '登录超时，请重试');
  }

  async cancel(id) {
    const session = this.active;
    if (!session || session.id !== String(id || '') || String(id || '').length > PIXIV_LOGIN_ID_MAX_LENGTH) {
      throw pixivLoginError('登录会话不存在', 'PIXIV_LOGIN_NOT_FOUND', 404);
    }
    if (PIXIV_LOGIN_TERMINAL_STATES.has(session.state)) return serializePixivLoginState(session);
    return this.finish(session, 'canceled', '已取消登录');
  }

  status(id) {
    const session = this.active;
    if (!session || session.id !== String(id || '') || String(id || '').length > PIXIV_LOGIN_ID_MAX_LENGTH) return null;
    return serializePixivLoginState(session);
  }

  async fail(session, error) {
    const message = redactPixivLoginSecrets(error?.message, [session?.code, session?.verifier]);
    return this.finish(session, 'failed', message || '登录失败，请重试');
  }

  async finish(session, state, message) {
    if (session.settled && PIXIV_LOGIN_TERMINAL_STATES.has(session.state)) return serializePixivLoginState(session);
    session.settled = true;
    this.clearTimer(session);
    session.state = state;
    session.message = message;
    await this.cleanup(session);
    return serializePixivLoginState(session);
  }

  clearTimer(session) {
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
  }

  closeWs(session) {
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('CDP 连接已关闭'));
    }
    session.pending.clear();
    const ws = session.ws;
    if (!ws) return;
    try { ws.close(); } catch { /* 已关闭 */ }
  }

  killChild(session) {
    killProcessTree(session.child, this.spawn);
  }

  /** 清理上次异常退出留下的专用 profile；绝不触碰此前缀之外的目录。 */
  async cleanupStaleProfiles() {
    let entries = [];
    try { entries = await readdir(this.tmpRoot, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(PIXIV_LOGIN_PROFILE_PREFIX)) continue;
      await removePixivLoginProfile(join(this.tmpRoot, entry.name), {
        root: this.tmpRoot,
        retryDelayMs: this.cleanupRetryMs,
        sleepFn: this.sleepFn,
      });
    }
  }

  /** 终态幂等 cleanup：关闭 ws、只终止自己 spawn 的 PID 树、校验后重试删除临时 profile。 */
  cleanup(session) {
    if (session.cleanupPromise) return session.cleanupPromise;
    session.cleanupPromise = (async () => {
      try {
        this.closeWs(session);
        this.killChild(session);
        await waitForChildExit(session.child);
        await removePixivLoginProfile(session.profileDir, {
          root: this.tmpRoot,
          retryDelayMs: this.cleanupRetryMs,
          sleepFn: this.sleepFn,
        });
      } finally {
        // 终态只保留供前端轮询的公开状态；PKCE、CDP 与本机路径不继续驻留内存。
        session.verifier = undefined;
        session.challenge = undefined;
        session.wsUrl = undefined;
        session.ws = undefined;
        session.edgePath = undefined;
        session.profileDir = undefined;
      }
    })();
    return session.cleanupPromise;
  }

  /** gateway 退出时清理活动会话。 */
  shutdown() {
    const session = this.active;
    if (!session || PIXIV_LOGIN_TERMINAL_STATES.has(session.state)) return Promise.resolve();
    return this.finish(session, 'canceled', '登录已取消');
  }
}
