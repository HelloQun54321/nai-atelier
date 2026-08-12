import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildEdgeArgs,
  buildEdgeCandidatePaths,
  buildPixivLoginUrl,
  buildTokenExchangeRequest,
  createPkcePair,
  exchangeAuthorizationCode,
  parseDevToolsActivePort,
  parsePixivCallbackUrl,
  PixivWebLoginOrchestrator,
  redactPixivLoginSecrets,
  removePixivLoginProfile,
  serializePixivLoginState,
} from './pixiv-web-login.mjs';
import { PIXIV_HASH_SECRET, PixivGalleryService, PixivTokenStore } from './pixiv-local.mjs';
import { createMediaGateway, handlePixivGalleryRequest } from './media-gateway.mjs';

const CALLBACK_URL = 'https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=test-code-123456';
const FAKE_TOKENS = {
  refreshToken: 'rt-web-login-test-123456',
  accessToken: 'at-web-login-test-123456',
  accessTokenExpiresAt: Date.now() + 3600_000,
};

const makeFakeChild = () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.killed = false;
  child.exitCode = null;
  child.kill = () => {
    if (!child.killed) {
      child.killed = true;
      child.exitCode = 0;
    }
  };
  child.unref = () => {};
  return child;
};

/** 可脚本化 CDP websocket：对 attach/enable 自动应答，Page.enable 后触发顶层 callback 导航。 */
const makeCdpSession = ({ callbackUrl = CALLBACK_URL } = {}) => {
  const listeners = {};
  let attachedSessionId = null;
  const ws = {
    readyState: 1,
    sent: [],
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    emit(type, event) { for (const fn of listeners[type] || []) fn(event); },
    send(data) {
      ws.sent.push(String(data));
      const message = JSON.parse(String(data));
      if (message.method === 'Target.setDiscoverTargets') {
        ws.emit('message', { data: JSON.stringify({ method: 'Target.targetCreated', params: { targetInfo: { type: 'page', targetId: 't1' } } }) });
      } else if (message.method === 'Target.attachToTarget') {
        attachedSessionId = `session-${message.params.targetId}`;
        ws.emit('message', { data: JSON.stringify({ id: message.id, result: { sessionId: attachedSessionId } }) });
      } else if (message.method === 'Page.enable' || message.method === 'Network.enable') {
        ws.emit('message', { data: JSON.stringify({ id: message.id, result: {} }) });
        if (message.method === 'Page.enable' && callbackUrl) {
          ws.emit('message', { data: JSON.stringify({ sessionId: attachedSessionId, method: 'Page.frameNavigated', params: { frame: { id: 'f1', url: callbackUrl } } }) });
        }
      } else {
        ws.emit('message', { data: JSON.stringify({ id: message.id, result: {} }) });
      }
    },
    close() {
      ws.readyState = 3;
      ws.emit('close', {});
    },
  };
  return ws;
};

const makeWebSocketImpl = factory => class FakeWebSocket {
  constructor(url) { return factory(url); }
};

const makeTempRoot = async () => mkdtemp(join(tmpdir(), 'pixiv-login-test-root-'));

const waitForState = async (orchestrator, id, states, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = orchestrator.status(id);
    if (state && states.includes(state.state)) return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`登录状态未在时限内到达 ${states.join('/')}`);
};

/** 等待终态 cleanup（进程终止 + 临时 profile 删除）完成，避免与异步清理竞态。 */
const waitForCleanup = async (tempRoot, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  let entries = ['pending'];
  while (Date.now() < deadline) {
    try { entries = await readdir(tempRoot); } catch { entries = []; }
    if (entries.length === 0) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`临时目录未清空: ${entries.join(',')}`);
};

const makeHarness = (overrides = {}) => {
  const state = {
    children: [],
    sessions: [],
    exchanges: [],
    savedTokens: null,
    spawnArgs: [],
  };
  const options = {
    spawn: (path, args, opts) => {
      state.spawnArgs.push({ path, args, opts });
      const child = makeFakeChild();
      state.children.push(child);
      return child;
    },
    WebSocketImpl: makeWebSocketImpl(() => {
      const ws = makeCdpSession();
      state.sessions.push(ws);
      return ws;
    }),
    findEdgePath: async () => 'C:\\edge\\msedge.exe',
    readDevToolsPort: async () => ({ port: 9333, browserPath: '/devtools/browser/abc-123' }),
    exchange: async ({ code, codeVerifier }) => {
      state.exchanges.push({ code, codeVerifier });
      return { ...FAKE_TOKENS };
    },
    onTokens: async tokens => { state.savedTokens = tokens; },
    getGeneration: () => 1,
    tmpRoot: null,
    ttlMs: 60_000,
    cleanupRetryMs: 10,
    sleepFn: ms => new Promise(resolve => setTimeout(resolve, ms)),
    ...overrides,
  };
  const orchestrator = new PixivWebLoginOrchestrator(options);
  return { orchestrator, state };
};

// ---- 纯函数：PKCE / 登录 URL / callback 白名单 / DevToolsActivePort / 脱敏 ----

test('PKCE verifier 与 challenge 为 base64url 且 challenge 为 S256', () => {
  const { verifier, challenge } = createPkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  const fixed = createPkcePair(() => Buffer.alloc(32, 7));
  assert.equal(fixed.verifier, Buffer.alloc(32, 7).toString('base64url'));
  assert.equal(fixed.challenge, createHash('sha256').update(fixed.verifier).digest('base64url'));
});

test('登录 URL 固定为官方地址与参数', () => {
  const url = buildPixivLoginUrl({ codeChallenge: 'challenge-value' });
  const parsed = new URL(url);
  assert.equal(`${parsed.origin}${parsed.pathname}`, 'https://app-api.pixiv.net/web/v1/login');
  assert.equal(parsed.searchParams.get('code_challenge'), 'challenge-value');
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsed.searchParams.get('client'), 'pixiv-android');
  assert.deepEqual([...parsed.searchParams.keys()].sort(), ['client', 'code_challenge', 'code_challenge_method']);
});

test('callback 白名单只接受官方地址，code 有界', () => {
  assert.deepEqual(parsePixivCallbackUrl(CALLBACK_URL), { code: 'test-code-123456' });
  assert.deepEqual(parsePixivCallbackUrl('pixiv://account/login?code=abc123'), { code: 'abc123' });
  assert.deepEqual(
    parsePixivCallbackUrl(`https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=${'x'.repeat(1024)}`),
    { code: 'x'.repeat(1024) },
  );
  assert.equal(parsePixivCallbackUrl(`https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=${'x'.repeat(1025)}`), null);
  assert.equal(parsePixivCallbackUrl('https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback'), null);
  assert.equal(parsePixivCallbackUrl('https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?state=1'), null);
  assert.equal(parsePixivCallbackUrl('https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code='), null);
  assert.equal(parsePixivCallbackUrl('https://evil.example/web/v1/users/auth/pixiv/callback?code=abc'), null);
  assert.equal(parsePixivCallbackUrl('https://app-api.pixiv.net/other?code=abc'), null);
  assert.equal(parsePixivCallbackUrl('http://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=abc'), null);
  assert.equal(parsePixivCallbackUrl('pixiv://evil/login?code=abc'), null);
  assert.equal(parsePixivCallbackUrl('https://user:pass@app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=abc'), null);
  assert.equal(parsePixivCallbackUrl(''), null);
  assert.equal(parsePixivCallbackUrl('not a url'), null);
  assert.equal(parsePixivCallbackUrl('https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=123456789', { maxCodeLength: 8 }), null);
});

test('DevToolsActivePort 只接受“端口 + 浏览器级 ws 路径”', () => {
  assert.deepEqual(parseDevToolsActivePort('9229\n/devtools/browser/abc-123\n'), { port: 9229, browserPath: '/devtools/browser/abc-123' });
  assert.equal(parseDevToolsActivePort(''), null);
  assert.equal(parseDevToolsActivePort('abc\n/devtools/browser/x'), null);
  assert.equal(parseDevToolsActivePort('0\n/devtools/browser/x'), null);
  assert.equal(parseDevToolsActivePort('99999\n/devtools/browser/x'), null);
  assert.equal(parseDevToolsActivePort('9229\n/other/path'), null);
  assert.equal(parseDevToolsActivePort('9229\n'), null);
});

test('公开状态只含 id/state/message/expiresAt，不含任何秘密', () => {
  const session = {
    id: 'sid',
    state: 'awaiting-user',
    message: 'hi',
    expiresAt: 123,
    code: 'secret-code',
    verifier: 'secret-verifier',
    wsUrl: 'ws://127.0.0.1:9333/devtools/browser/abc-123',
    child: {},
    profileDir: 'C:\\profile',
    edgePath: 'C:\\edge.exe',
  };
  const state = serializePixivLoginState(session);
  assert.deepEqual(state, { id: 'sid', state: 'awaiting-user', message: 'hi', expiresAt: 123 });
  const text = JSON.stringify(state);
  for (const secret of ['secret-code', 'secret-verifier', 'ws://', 'profileDir', 'edgePath']) {
    assert.ok(!text.includes(secret), `公开状态泄露了 ${secret}`);
  }
  assert.equal(serializePixivLoginState({ ...session, state: 'connected' }).connected, true);
  assert.equal(serializePixivLoginState(null), null);
});

test('redactPixivLoginSecrets 掩盖 code/verifier/token/ws 地址', () => {
  const input = 'code=secret12345 code_verifier=vsecret12345 Bearer abcdef1234567890 ws://127.0.0.1:9229/devtools/browser/uuid-1';
  const redacted = redactPixivLoginSecrets(input, ['custom-secret']);
  assert.ok(!redacted.includes('secret12345'));
  assert.ok(!redacted.includes('vsecret12345'));
  assert.ok(!redacted.includes('abcdef1234567890'));
  assert.ok(!redacted.includes('ws://'));
  assert.equal(redactPixivLoginSecrets('bad custom-secret here', ['custom-secret']), 'bad [redacted] here');
});

test('Edge 启动参数：独立 profile、127.0.0.1、随机端口、可见、无 headless', () => {
  const args = buildEdgeArgs({ profileDir: 'C:\\profile-1', loginUrl: CALLBACK_URL });
  assert.ok(args.includes('--user-data-dir=C:\\profile-1'));
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(args.includes('--remote-debugging-port=0'));
  assert.ok(args.includes('--no-first-run'));
  assert.ok(args.includes('--no-default-browser-check'));
  assert.ok(args.includes(CALLBACK_URL));
  assert.ok(!args.some(arg => /headless/i.test(arg)));
  assert.ok(!args.some(arg => /windowsHide/i.test(arg)));
});

test('Edge 路径探测覆盖 LOCALAPPDATA / x86 / x64 并去重', () => {
  const paths = buildEdgeCandidatePaths({
    localAppData: 'C:\\la',
    programFiles: 'C:\\pf',
    programFilesX86: 'C:\\pf(x86)',
    programW6432: 'C:\\pf',
  });
  assert.ok(paths.includes('C:\\la\\Microsoft\\Edge\\Application\\msedge.exe'));
  assert.ok(paths.includes('C:\\pf(x86)\\Microsoft\\Edge\\Application\\msedge.exe'));
  assert.ok(paths.includes('C:\\pf\\Microsoft\\Edge\\Application\\msedge.exe'));
  assert.equal(paths.length, new Set(paths).size);
  assert.deepEqual(buildEdgeCandidatePaths({}), []);
});

// ---- authorization_code 换 token ----

test('换 token 请求包含全部必填字段与现有 X-Client-Time/Hash、UA 习惯', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const request = buildTokenExchangeRequest({ code: 'code123', codeVerifier: 'verifier123', now });
  assert.equal(request.url, 'https://oauth.secure.pixiv.net/auth/token');
  assert.equal(request.body.get('client_id'), 'MOBrBDS8blbauoSck0ZfDbtuzpyT');
  assert.equal(request.body.get('client_secret'), 'lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj');
  assert.equal(request.body.get('grant_type'), 'authorization_code');
  assert.equal(request.body.get('code'), 'code123');
  assert.equal(request.body.get('code_verifier'), 'verifier123');
  assert.equal(request.body.get('redirect_uri'), 'https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback');
  assert.equal(request.body.get('include_policy'), 'true');
  assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(request.headers['user-agent'], 'PixivIOSApp/7.13.3 (iOS 14.6; iPhone13,2)');
  assert.equal(request.headers['x-client-time'], '2026-01-01T00:00:00+00:00');
  assert.equal(
    request.headers['x-client-hash'],
    createHash('md5').update(`2026-01-01T00:00:00+00:00${PIXIV_HASH_SECRET}`).digest('hex'),
  );
});

test('exchangeAuthorizationCode 成功返回令牌、失败脱敏且不携带秘密', async () => {
  const tokens = await exchangeAuthorizationCode({
    code: 'c',
    codeVerifier: 'v',
    fetch: async () => new Response(JSON.stringify({ response: { access_token: 'at123', refresh_token: 'rt1234567890123456', expires_in: 3600 } }), { status: 200 }),
  });
  assert.equal(tokens.accessToken, 'at123');
  assert.equal(tokens.refreshToken, 'rt1234567890123456');
  await assert.rejects(
    () => exchangeAuthorizationCode({ code: 'c', codeVerifier: 'v', fetch: async () => new Response('{}', { status: 400 }) }),
    error => error.code === 'PIXIV_LOGIN_EXCHANGE_FAILED' && error.status === 401,
  );
  await assert.rejects(
    () => exchangeAuthorizationCode({ code: 'c', codeVerifier: 'v', fetch: async () => { throw new Error('boom'); } }),
    error => error.code === 'PIXIV_LOGIN_EXCHANGE_FAILED' && error.status === 502,
  );
});

// ---- profile 删除校验 ----

test('临时 profile 删除校验专用根与命名，越界路径拒绝删除', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pixiv-login-root-check-'));
  const good = await mkdtemp(join(root, 'pixiv-login-'));
  const outside = await mkdtemp(join(tmpdir(), 'pixiv-login-outside-check-'));
  await removePixivLoginProfile(good, { root, retries: 2, retryDelayMs: 1 });
  await assert.rejects(() => readdir(good), error => error.code === 'ENOENT');
  await removePixivLoginProfile(outside, { root, retries: 2, retryDelayMs: 1 });
  assert.ok((await readdir(outside)).length >= 0);
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

// ---- 编排器状态机（注入 spawn/CDP/exchange/clock） ----

test('网页登录成功：截获 code、换 token、写令牌、自动关闭窗口并清理', async () => {
  const tempRoot = await makeTempRoot();
  const { orchestrator, state } = makeHarness({ tmpRoot: tempRoot });
  const started = await orchestrator.start();
  assert.equal(started.state, 'awaiting-user');
  assert.ok(started.id);
  assert.ok(!JSON.stringify(started).includes('verifier'));
  assert.equal(state.spawnArgs[0].opts.stdio, 'ignore');
  assert.equal(state.spawnArgs[0].args.includes('--remote-debugging-port=0'), true);

  state.sessions[0].emit('open', {});
  const finalState = await waitForState(orchestrator, started.id, ['connected']);
  await waitForCleanup(tempRoot);
  assert.equal(finalState.state, 'connected');
  assert.equal(finalState.connected, true);
  assert.equal(state.exchanges.length, 1);
  assert.equal(state.exchanges[0].code, 'test-code-123456');
  assert.match(state.exchanges[0].codeVerifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(state.savedTokens.accessToken, 'at-web-login-test-123456');
  assert.equal(state.children[0].killed, true);
  assert.equal(state.sessions[0].readyState, 3);
  assert.deepEqual(await readdir(tempRoot), []);
  const body = JSON.stringify(finalState);
  for (const secret of ['at-web-login-test', 'rt-web-login-test', 'code', 'verifier', 'ws://']) {
    assert.ok(!body.includes(secret), `最终响应泄露了 ${secret}`);
  }
  await rm(tempRoot, { recursive: true, force: true });
});

test('授权码只兑换一次', async () => {
  const tempRoot = await makeTempRoot();
  const { orchestrator, state } = makeHarness({ tmpRoot: tempRoot });
  const started = await orchestrator.start();
  state.sessions[0].emit('open', {});
  await waitForState(orchestrator, started.id, ['connected']);
  await waitForCleanup(tempRoot);
  assert.equal(state.exchanges.length, 1);
  state.sessions[0].emit('message', {
    data: JSON.stringify({
      sessionId: 'session-t1',
      method: 'Page.frameNavigated',
      params: { frame: { id: 'f1', url: 'https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=second-code' } },
    }),
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(state.exchanges.length, 1);
  await rm(tempRoot, { recursive: true, force: true });
});

test('取消登录：状态 canceled、进程终止、清理幂等', async () => {
  const tempRoot = await makeTempRoot();
  const { orchestrator, state } = makeHarness({ tmpRoot: tempRoot });
  const started = await orchestrator.start();
  const canceled = await orchestrator.cancel(started.id);
  await waitForCleanup(tempRoot);
  assert.equal(canceled.state, 'canceled');
  assert.equal(state.children[0].killed, true);
  assert.deepEqual(await readdir(tempRoot), []);
  const again = await orchestrator.cancel(started.id);
  assert.equal(again.state, 'canceled');
  await assert.rejects(() => orchestrator.cancel('unknown-id'), error => error.code === 'PIXIV_LOGIN_NOT_FOUND' && error.status === 404);
  await rm(tempRoot, { recursive: true, force: true });
});

test('登录超时（TTL 5 分钟）转为 timed-out', async () => {
  const tempRoot = await makeTempRoot();
  const { orchestrator } = makeHarness({ tmpRoot: tempRoot, ttlMs: 80, cleanupRetryMs: 5 });
  const started = await orchestrator.start();
  const timedOut = await waitForState(orchestrator, started.id, ['timed-out']);
  await waitForCleanup(tempRoot);
  assert.equal(timedOut.state, 'timed-out');
  assert.ok(!JSON.stringify(timedOut).includes('verifier'));
  await rm(tempRoot, { recursive: true, force: true });
});

test('同一时刻只允许一个活动登录会话（并发 409）', async () => {
  const tempRoot = await makeTempRoot();
  const { orchestrator } = makeHarness({ tmpRoot: tempRoot });
  const first = await orchestrator.start();
  await assert.rejects(() => orchestrator.start(), error => error.code === 'PIXIV_LOGIN_ACTIVE' && error.status === 409);
  await orchestrator.cancel(first.id);
  const second = await orchestrator.start();
  assert.equal(second.state, 'awaiting-user');
  await orchestrator.cancel(second.id);
  await rm(tempRoot, { recursive: true, force: true });
});

test('Edge 自行关闭视为 canceled', async () => {
  const tempRoot = await makeTempRoot();
  const { orchestrator, state } = makeHarness({ tmpRoot: tempRoot });
  const started = await orchestrator.start();
  state.children[0].emit('exit', 0, null);
  const finalState = await waitForState(orchestrator, started.id, ['canceled']);
  await waitForCleanup(tempRoot);
  assert.equal(finalState.message, '登录窗口已关闭');
  await rm(tempRoot, { recursive: true, force: true });
});

test('未找到 Microsoft Edge 时给出普通中文错误', async () => {
  const tempRoot = await makeTempRoot();
  const { orchestrator } = makeHarness({ tmpRoot: tempRoot, findEdgePath: async () => null });
  const started = await orchestrator.start();
  assert.equal(started.state, 'failed');
  assert.equal(started.message, '未找到 Microsoft Edge');
  assert.deepEqual(await readdir(tempRoot), []);
  await rm(tempRoot, { recursive: true, force: true });
});

test('Edge/CDP 启动失败给出普通中文错误', async () => {
  const tempRoot = await makeTempRoot();
  const { orchestrator, state } = makeHarness({
    tmpRoot: tempRoot,
    spawn: () => {
      const child = makeFakeChild();
      state.children.push(child);
      // 只让 Edge 子进程报错；taskkill 等清理子进程不带 error 监听器，不能触发。
      if (!state.spawnErrorQueued) {
        state.spawnErrorQueued = true;
        queueMicrotask(() => child.emit('error', new Error('ENOENT')));
      }
      return child;
    },
  });
  const started = await orchestrator.start();
  const finalState = await waitForState(orchestrator, started.id, ['failed']);
  await waitForCleanup(tempRoot);
  assert.equal(finalState.message, '登录窗口启动失败');
  assert.ok(!JSON.stringify(finalState).includes('ENOENT'));
});

test('CDP ws 不可连接时失败并清理', async () => {
  const tempRoot = await makeTempRoot();
  const { orchestrator } = makeHarness({
    tmpRoot: tempRoot,
    WebSocketImpl: makeWebSocketImpl(() => { throw new Error('connect ECONNREFUSED'); }),
  });
  const started = await orchestrator.start();
  const finalState = await waitForState(orchestrator, started.id, ['failed']);
  await waitForCleanup(tempRoot);
  assert.equal(finalState.message, '登录窗口启动失败');
  await rm(tempRoot, { recursive: true, force: true });
});

test('登录期间连接状态改变：旧会话不得覆盖令牌', async () => {
  const tempRoot = await makeTempRoot();
  let capturedSession = null;
  const { orchestrator, state } = makeHarness({
    tmpRoot: tempRoot,
    getGeneration: () => 5,
    onTokens: async (tokens, session) => {
      capturedSession = session;
      throw Object.assign(new Error('Pixiv 连接状态已改变，已丢弃过期令牌'), { code: 'PIXIV_TOKEN_STATE_CHANGED', status: 409 });
    },
  });
  const started = await orchestrator.start();
  state.sessions[0].emit('open', {});
  const finalState = await waitForState(orchestrator, started.id, ['failed']);
  await waitForCleanup(tempRoot);
  assert.equal(capturedSession.expectedGeneration, 5);
  assert.ok(finalState.message.includes('连接状态已改变'));
  assert.ok(!JSON.stringify(finalState).includes('PIXIV_TOKEN_STATE_CHANGED'));
  await rm(tempRoot, { recursive: true, force: true });
});

// ---- importWebLoginTokens：generation 防竞态 + 清 feed 缓存 ----

test('importWebLoginTokens 沿用 generation 防竞态并清 feed 缓存', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pixiv-login-store-test-'));
  const store = new PixivTokenStore({ dir });
  await store.init();
  const gallery = new PixivGalleryService({ store });
  const startGeneration = store.generation;
  const result = await gallery.importWebLoginTokens(
    { ...FAKE_TOKENS, refreshToken: 'rt-import-test-1234567890', accessToken: 'at-import-test-123456' },
    { expectedGeneration: startGeneration },
  );
  assert.equal(result.connected, true);
  assert.equal(store.tokens.refreshToken, 'rt-import-test-1234567890');
  await assert.rejects(
    () => gallery.importWebLoginTokens(
      { refreshToken: 'rt-stale-test-1234567890', accessToken: 'at-stale-123456', accessTokenExpiresAt: 0 },
      { expectedGeneration: startGeneration },
    ),
    error => error.code === 'PIXIV_TOKEN_STATE_CHANGED',
  );
  assert.equal(store.tokens.refreshToken, 'rt-import-test-1234567890');
  await assert.rejects(
    () => gallery.importWebLoginTokens({ refreshToken: 'short', accessToken: 'at' }, { expectedGeneration: store.generation }),
    error => error.code === 'PIXIV_LOGIN_TOKENS_INVALID',
  );
  await rm(dir, { recursive: true, force: true });
});

// ---- gateway 路由 ----

const makeStubLogin = () => {
  const sessions = new Map();
  let next = 0;
  return {
    start: async () => {
      const id = `stub-login-${++next}`;
      const state = { id, state: 'awaiting-user', message: '请在打开的 Pixiv 登录窗口中完成登录', expiresAt: Date.now() + 300_000 };
      sessions.set(id, state);
      return state;
    },
    status: id => sessions.get(String(id)) || null,
    cancel: async id => {
      const session = sessions.get(String(id));
      if (!session) throw Object.assign(new Error('登录会话不存在'), { code: 'PIXIV_LOGIN_NOT_FOUND', status: 404 });
      const next = { ...session, state: 'canceled', message: '已取消登录' };
      sessions.set(String(id), next);
      return next;
    },
    shutdown: async () => {},
  };
};

test('gateway 登录路由：start/status/cancel，响应不含 token/code/verifier', async () => {
  const tokenDir = await mkdtemp(join(tmpdir(), 'pixiv-login-gw-token-'));
  const server = await createMediaGateway({
    port: 0,
    workerPort: 39998,
    lanSecret: 'test-lan-secret-0123456789abcdef',
    pixivWebLogin: makeStubLogin(),
    pixivTokenDir: tokenDir,
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let res = await fetch(`${base}/api/pixiv/login/start`, { method: 'POST' });
    assert.equal(res.status, 200);
    const started = await res.json();
    assert.equal(started.state, 'awaiting-user');
    assert.ok(started.id);
    assert.ok(started.expiresAt > 0);
    assert.ok(!JSON.stringify(started).includes('token'));
    assert.ok(!JSON.stringify(started).includes('verifier'));
    assert.ok(!JSON.stringify(started).includes('ws://'));

    res = await fetch(`${base}/api/pixiv/login/status?id=${started.id}`);
    assert.equal(res.status, 200);
    const status = await res.json();
    assert.equal(status.state, 'awaiting-user');
    assert.ok(!JSON.stringify(status).includes('secret'));

    res = await fetch(`${base}/api/pixiv/login/status?id=unknown-id`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'PIXIV_LOGIN_NOT_FOUND');

    res = await fetch(`${base}/api/pixiv/login?id=${started.id}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).state, 'canceled');

    res = await fetch(`${base}/api/pixiv/login?id=unknown-id`, { method: 'DELETE' });
    assert.equal(res.status, 404);

    res = await fetch(`${base}/api/pixiv/login/start`, { method: 'GET' });
    assert.equal(res.status, 405);
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
    await rm(tokenDir, { recursive: true, force: true });
  }
});

test('局域网不能发起/取消登录（loopback 403），状态可读', async () => {
  const stub = makeStubLogin();
  await stub.start();
  const captureRes = () => {
    const res = { status: null, payload: null };
    res.writeHead = function (status) { this.status = status; };
    res.end = function (payload) { this.payload = payload; };
    return res;
  };
  const lanReq = { method: 'POST', socket: { remoteAddress: '192.168.1.50' } };
  const res = captureRes();
  await handlePixivGalleryRequest(lanReq, res, new URL('http://localhost/api/pixiv/login/start'), { status: () => ({}) }, stub);
  assert.equal(res.status, 403);
  const body = JSON.parse(res.payload.toString());
  assert.equal(body.code, 'PIXIV_CONNECT_LOCAL_ONLY');
  assert.ok(body.error.includes('请在运行 NPM 的电脑上登录'));

  const res2 = captureRes();
  await handlePixivGalleryRequest(
    { method: 'DELETE', socket: { remoteAddress: '10.0.0.8' } },
    res2,
    new URL('http://localhost/api/pixiv/login?id=stub-login-1'),
    { status: () => ({}) },
    stub,
  );
  assert.equal(res2.status, 403);
  assert.equal(JSON.parse(res2.payload.toString()).code, 'PIXIV_CONNECT_LOCAL_ONLY');

  const res3 = captureRes();
  await handlePixivGalleryRequest(
    { method: 'GET', socket: { remoteAddress: '192.168.1.50' } },
    res3,
    new URL('http://localhost/api/pixiv/login/status?id=stub-login-1'),
    { status: () => ({}) },
    stub,
  );
  assert.equal(res3.status, 200);
  assert.equal(JSON.parse(res3.payload.toString()).id, 'stub-login-1');
});

test('gateway 退出时清理活动登录会话', async () => {
  const tokenDir = await mkdtemp(join(tmpdir(), 'pixiv-login-gw-exit-'));
  let shutdownCalls = 0;
  const stub = { ...makeStubLogin(), shutdown: async () => { shutdownCalls += 1; } };
  const server = await createMediaGateway({
    port: 0,
    workerPort: 39997,
    lanSecret: 'test-lan-secret-0123456789abcdef',
    pixivWebLogin: stub,
    pixivTokenDir: tokenDir,
  });
  await new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
  assert.equal(shutdownCalls, 1);
  await rm(tokenDir, { recursive: true, force: true });
});
