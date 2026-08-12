import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  PIXIV_APP_CLIENT_ID,
  PIXIV_APP_CLIENT_SECRET,
  PIXIV_HASH_SECRET,
  PIXIV_OAUTH_TOKEN_URL,
  PIXIV_USER_AGENT,
} from './pixiv-local.mjs';

// Pixiv OAuth 必须在用户的普通默认浏览器中进行。不要给浏览器添加远程调试、
// 自动化或临时 profile 参数；Google 会拒绝这类受控浏览器，用户已有 Cookie 也会丢失。

export const PIXIV_LOGIN_URL_BASE = 'https://app-api.pixiv.net/web/v1/login';
export const PIXIV_CALLBACK_URL = 'https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback';
export const PIXIV_LOGIN_REDIRECT_URI = PIXIV_CALLBACK_URL;
export const PIXIV_LOGIN_SESSION_TTL_MS = 5 * 60 * 1000;
export const MAX_PIXIV_CALLBACK_URL_LENGTH = 4096;
export const PIXIV_LOGIN_ID_MAX_LENGTH = 64;
export const PIXIV_SCHEME_NAME = 'pixiv';
export const PIXIV_SCHEME_HANDLER_SCRIPT = 'pixiv-scheme-handler.mjs';
const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * 注册 pixiv:// URL 协议 → 本机 NPM 登录回调处理器（仅 Windows，HKCU 无需管理员）。
 * Pixiv 登录成功后通过 pixiv://account/login?code=… 回调（custom scheme 流程，
 * 旧流程为 app-api.pixiv.net HTTPS callback 白页）；未注册协议时浏览器无法处理，
 * 登录会卡在空白页。注册幂等，失败返回 false 且不阻断登录（退回地址栏监听/手动粘贴）。
 */
export const ensurePixivSchemeHandler = async ({
  execFile = promisify(nodeExecFile),
  platform = process.platform,
  nodePath = process.execPath,
} = {}) => {
  if (platform !== 'win32') return false;
  const scriptPath = resolve(moduleDir, PIXIV_SCHEME_HANDLER_SCRIPT);
  const command = `"${nodePath}" "${scriptPath}" "%1"`;
  const schemeKey = `HKCU\\Software\\Classes\\${PIXIV_SCHEME_NAME}`;
  const commands = [
    ['add', schemeKey, '/f', '/ve', '/d', 'URL:Pixiv Login Protocol'],
    ['add', schemeKey, '/f', '/v', 'URL Protocol', '/d', 'pixiv'],
    ['add', `${schemeKey}\\shell\\open\\command`, '/f', '/ve', '/d', command],
  ];
  try {
    for (const args of commands) {
      await execFile('reg.exe', args, { windowsHide: true });
    }
    return true;
  } catch {
    return false;
  }
};

export const PIXIV_LOGIN_STATES = Object.freeze(['starting', 'awaiting-user', 'exchanging', 'connected', 'failed', 'canceled', 'timed-out']);
export const PIXIV_LOGIN_ACTIVE_STATES = new Set(['starting', 'awaiting-user', 'exchanging']);
export const PIXIV_LOGIN_TERMINAL_STATES = new Set(['connected', 'failed', 'canceled', 'timed-out']);

const pixivLoginError = (message, code, status = 500, extra = {}) => Object.assign(new Error(message), { code, status, ...extra });

export const redactPixivLoginSecrets = (value, secrets = []) => {
  let text = String(value ?? '');
  for (const secret of secrets) {
    if (secret && text.includes(secret)) text = text.split(secret).join('[redacted]');
  }
  return text
    .replace(/\b(code|code_verifier|refresh_token|access_token|verifier)=[^&\s"]{8,}/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi, 'Bearer [redacted]');
};

export const createPkcePair = (entropy = randomBytes) => {
  const verifier = entropy(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

export const buildPixivLoginUrl = ({ codeChallenge, client = 'pixiv-android' } = {}) => {
  const query = new URLSearchParams({
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    client,
  });
  return `${PIXIV_LOGIN_URL_BASE}?${query.toString()}`;
};

/** Pixiv 登录成功后的两种回调载体：
 *  1. 官方 HTTPS callback 白页（旧流程）：https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=…
 *  2. custom scheme（Pixiv 新流程，pixiv 客户端/已注册处理器的桌面环境）：pixiv://account/login?code=…
 *  两者都只提取 code，且只接受 pixiv 官方来源。 */
export const parsePixivCallbackUrl = (value, { maxLength = MAX_PIXIV_CALLBACK_URL_LENGTH } = {}) => {
  const raw = String(value || '').trim();
  if (!raw || raw.length > maxLength) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.username || url.password) return null;
  const official = url.protocol === 'https:'
    ? url.host === 'app-api.pixiv.net' && url.pathname === '/web/v1/users/auth/pixiv/callback'
    : url.protocol === 'pixiv:' && url.host === 'account' && url.pathname === '/login';
  if (!official) return null;
  const code = String(url.searchParams.get('code') || '');
  if (!code || code.length > 1024) return null;
  return { code };
};

export const buildTokenExchangeRequest = ({
  code,
  codeVerifier,
  clientId = PIXIV_APP_CLIENT_ID,
  clientSecret = PIXIV_APP_CLIENT_SECRET,
  tokenUrl = PIXIV_OAUTH_TOKEN_URL,
  now = new Date(),
} = {}) => {
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

export const exchangeAuthorizationCode = async ({
  code,
  codeVerifier,
  fetch: requestFetch = globalThis.fetch,
  clientId,
  clientSecret,
  tokenUrl,
  timeoutMs = 30_000,
  now = () => new Date(),
} = {}) => {
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
      response.status === 400 ? '登录结果已过期，请重新登录' : 'Pixiv 登录换取令牌失败',
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

export const serializePixivLoginState = session => {
  if (!session) return null;
  const state = {
    id: session.id,
    state: session.state,
    message: session.message,
    expiresAt: session.expiresAt,
    automaticCallback: session.automaticCallback === true,
  };
  if (session.state === 'connected') state.connected = true;
  return state;
};

/** 使用系统默认浏览器；参数中绝不出现 remote-debugging/user-data-dir/headless。 */
export const launchInDefaultBrowser = (url, { spawn = nodeSpawn, platform = process.platform } = {}) => new Promise((resolve, reject) => {
  const command = platform === 'win32' ? 'rundll32.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  let child;
  try {
    child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  } catch {
    reject(pixivLoginError('无法打开默认浏览器', 'PIXIV_BROWSER_OPEN_FAILED', 500));
    return;
  }
  let settled = false;
  const done = error => {
    if (settled) return;
    settled = true;
    error ? reject(pixivLoginError('无法打开默认浏览器', 'PIXIV_BROWSER_OPEN_FAILED', 500)) : resolve();
  };
  child.once?.('error', done);
  child.once?.('spawn', () => done());
  child.unref?.();
  if (!child.once) done();
});

export const startPixivCallbackWatcher = ({
  onCallback,
  spawn = nodeSpawn,
  platform = process.platform,
  scriptPath = resolve(moduleDir, 'pixiv-edge-callback-watcher.ps1'),
} = {}) => new Promise((resolveWatcher, rejectWatcher) => {
  if (platform !== 'win32') {
    rejectWatcher(pixivLoginError('当前系统不支持自动捕获 Pixiv 登录结果', 'PIXIV_CALLBACK_WATCHER_UNAVAILABLE', 501));
    return;
  }
  let child;
  try {
    child = spawn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    rejectWatcher(pixivLoginError('无法启动 Pixiv 登录结果监听', 'PIXIV_CALLBACK_WATCHER_UNAVAILABLE', 500));
    return;
  }
  let ready = false;
  let readyTimer = null;
  let buffer = '';
  child.stdout?.setEncoding?.('utf8');
  child.stdout?.on?.('data', chunk => {
    buffer = `${buffer}${String(chunk)}`.slice(-MAX_PIXIV_CALLBACK_URL_LENGTH * 2);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const callbackUrl = line.trim();
      if (callbackUrl === 'NPM_PIXIV_WATCHER_READY') {
        if (!ready) {
          ready = true;
          if (readyTimer) clearTimeout(readyTimer);
          resolveWatcher(child);
        }
        continue;
      }
      if (parsePixivCallbackUrl(callbackUrl)) void onCallback?.(callbackUrl);
    }
  });
  child.once?.('error', () => {
    if (!ready) rejectWatcher(pixivLoginError('无法启动 Pixiv 登录结果监听', 'PIXIV_CALLBACK_WATCHER_UNAVAILABLE', 500));
  });
  child.once?.('spawn', () => {
    readyTimer = setTimeout(() => {
      if (ready) return;
      stopPixivCallbackWatcher(child);
      rejectWatcher(pixivLoginError('Pixiv 登录结果监听未能就绪', 'PIXIV_CALLBACK_WATCHER_UNAVAILABLE', 500));
    }, 5000);
    readyTimer.unref?.();
  });
  child.once?.('exit', () => {
    if (!ready) rejectWatcher(pixivLoginError('Pixiv 登录结果监听未能启动', 'PIXIV_CALLBACK_WATCHER_UNAVAILABLE', 500));
  });
});

const stopPixivCallbackWatcher = child => {
  if (!child || child.exitCode !== null || child.killed) return;
  try { child.kill(); } catch { /* 已退出 */ }
};

export class PixivWebLoginOrchestrator {
  constructor({
    fetch: requestFetch = globalThis.fetch,
    clock = () => Date.now(),
    launchBrowser = launchInDefaultBrowser,
    exchange,
    onTokens,
    getGeneration,
    ttlMs = PIXIV_LOGIN_SESSION_TTL_MS,
    startWatcher = startPixivCallbackWatcher,
    ensureSchemeHandler = ensurePixivSchemeHandler,
  } = {}) {
    this.requestFetch = requestFetch;
    this.clock = clock;
    this.launchBrowser = launchBrowser;
    this.exchange = exchange || (({ code, codeVerifier }) => exchangeAuthorizationCode({ code, codeVerifier, fetch: this.requestFetch }));
    this.onTokens = onTokens || null;
    this.getGeneration = getGeneration || null;
    this.ttlMs = ttlMs;
    this.startWatcher = startWatcher;
    this.ensureSchemeHandler = ensureSchemeHandler;
    this.active = null;
  }

  async start() {
    if (this.active && PIXIV_LOGIN_ACTIVE_STATES.has(this.active.state)) {
      throw pixivLoginError('已有进行中的 Pixiv 登录', 'PIXIV_LOGIN_ACTIVE', 409);
    }
    const now = this.clock();
    const pkce = createPkcePair();
    const session = {
      id: randomBytes(12).toString('base64url'),
      state: 'starting',
      message: '正在打开默认浏览器…',
      createdAt: now,
      expiresAt: now + this.ttlMs,
      verifier: pkce.verifier,
      expectedGeneration: this.getGeneration ? await this.getGeneration() : null,
      automaticCallback: false,
      settled: false,
      timer: null,
    };
    this.active = session;
    try {
      try {
        session.schemeHandler = await this.ensureSchemeHandler();
      } catch {
        session.schemeHandler = false;
      }
      try {
        session.watcher = await this.startWatcher({
          onCallback: callbackUrl => void this.complete(session.id, callbackUrl).catch(() => {}),
        });
        session.automaticCallback = true;
        session.watcher.once?.('exit', code => {
          if (code === 0 || this.active !== session || !PIXIV_LOGIN_ACTIVE_STATES.has(session.state)) return;
          session.automaticCallback = false;
          session.message = '自动识别暂时不可用；登录后请粘贴 Pixiv 白页地址';
        });
      } catch {
        session.automaticCallback = false;
      }
      await this.launchBrowser(buildPixivLoginUrl({ codeChallenge: pkce.challenge }));
      session.state = 'awaiting-user';
      session.message = session.automaticCallback
        ? '请在默认浏览器继续使用账号，NPM 会自动识别登录结果'
        : '登录完成后会出现 Pixiv 白页，请粘贴 callback 地址';
      session.timer = setTimeout(() => void this.finish(session, 'timed-out', '登录超时，请重试'), Math.max(1, session.expiresAt - this.clock()));
      session.timer.unref?.();
    } catch (error) {
      await this.fail(session, error);
    }
    return serializePixivLoginState(session);
  }

  status(id) {
    const session = this.active;
    if (!session || session.id !== String(id || '') || String(id || '').length > PIXIV_LOGIN_ID_MAX_LENGTH) return null;
    return serializePixivLoginState(session);
  }

  async complete(id, callbackUrl) {
    const session = this.active;
    const requestedId = String(id || '');
    if (requestedId.length > PIXIV_LOGIN_ID_MAX_LENGTH) {
      throw pixivLoginError('登录会话不存在或已结束', 'PIXIV_LOGIN_NOT_FOUND', 404);
    }
    // 协议处理器拿不到会话 id 时允许省略；显式 id 必须与当前会话一致。
    if (!session || (requestedId && session.id !== requestedId) || !PIXIV_LOGIN_ACTIVE_STATES.has(session.state)) {
      throw pixivLoginError('登录会话不存在或已结束', 'PIXIV_LOGIN_NOT_FOUND', 404);
    }
    const parsed = parsePixivCallbackUrl(callbackUrl);
    if (!parsed) throw pixivLoginError('请粘贴 Pixiv 登录完成后的完整地址', 'PIXIV_LOGIN_CALLBACK_INVALID', 400);
    if (session.settled) throw pixivLoginError('登录结果正在处理中', 'PIXIV_LOGIN_ACTIVE', 409);
    session.settled = true;
    this.clearTimer(session);
    session.state = 'exchanging';
    session.message = '正在完成连接…';
    try {
      const tokens = await this.exchange({ code: parsed.code, codeVerifier: session.verifier });
      if (this.active !== session) return serializePixivLoginState(session);
      if (this.onTokens) await this.onTokens(tokens, session);
      if (this.active !== session) return serializePixivLoginState(session);
      return this.finish(session, 'connected', '登录成功');
    } catch (error) {
      return this.fail(session, error);
    }
  }

  async cancel(id) {
    const session = this.active;
    if (!session || session.id !== String(id || '') || String(id || '').length > PIXIV_LOGIN_ID_MAX_LENGTH) {
      throw pixivLoginError('登录会话不存在', 'PIXIV_LOGIN_NOT_FOUND', 404);
    }
    if (PIXIV_LOGIN_TERMINAL_STATES.has(session.state)) return serializePixivLoginState(session);
    return this.finish(session, 'canceled', '已取消登录');
  }

  fail(session, error) {
    const message = redactPixivLoginSecrets(error?.message, [session?.verifier]);
    return this.finish(session, 'failed', message || '登录失败，请重试');
  }

  finish(session, state, message) {
    if (session.settled && PIXIV_LOGIN_TERMINAL_STATES.has(session.state)) return serializePixivLoginState(session);
    session.settled = true;
    this.clearTimer(session);
    session.state = state;
    session.message = message;
    session.verifier = undefined;
    stopPixivCallbackWatcher(session.watcher);
    session.watcher = null;
    return serializePixivLoginState(session);
  }

  clearTimer(session) {
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
  }

  shutdown() {
    const session = this.active;
    if (!session || PIXIV_LOGIN_TERMINAL_STATES.has(session.state)) return Promise.resolve();
    return Promise.resolve(this.finish(session, 'canceled', '登录已取消'));
  }
}
