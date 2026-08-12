import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  buildPixivLoginUrl,
  buildTokenExchangeRequest,
  createPkcePair,
  ensurePixivSchemeHandler,
  launchInDefaultBrowser,
  parsePixivCallbackUrl,
  PixivWebLoginOrchestrator,
  serializePixivLoginState,
  startPixivCallbackWatcher,
} from './pixiv-web-login.mjs';
import { PIXIV_HASH_SECRET } from './pixiv-local.mjs';

const CALLBACK = 'https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=test-code-123';
const PIXIV_SCHEME_CALLBACK = 'pixiv://account/login?code=scheme-code-456&via=login';

/** 测试环境不写注册表：统一注入 no-op 协议注册。 */
const noSchemeHandler = async () => false;

const makeChild = () => {
  const child = new EventEmitter();
  child.unref = () => {};
  return child;
};

const makeWatcher = () => ({
  exitCode: null,
  killed: false,
  kill() { this.killed = true; },
});

const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('等待状态超时');
};

test('PKCE 与登录 URL 使用官方 S256 流程', () => {
  const fixed = createPkcePair(() => Buffer.alloc(32, 7));
  assert.match(fixed.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(fixed.challenge, createHash('sha256').update(fixed.verifier).digest('base64url'));
  const url = new URL(buildPixivLoginUrl({ codeChallenge: fixed.challenge }));
  assert.equal(`${url.origin}${url.pathname}`, 'https://app-api.pixiv.net/web/v1/login');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('client'), 'pixiv-android');
});

test('回调只接受 Pixiv 官方 HTTPS callback 与 pixiv:// scheme', () => {
  assert.deepEqual(parsePixivCallbackUrl(CALLBACK), { code: 'test-code-123' });
  assert.deepEqual(parsePixivCallbackUrl('pixiv://account/login?code=abc123&via=login'), { code: 'abc123' });
  assert.equal(parsePixivCallbackUrl('pixiv://evil.example/login?code=abc'), null);
  assert.equal(parsePixivCallbackUrl('pixiv://account/login'), null);
  assert.equal(parsePixivCallbackUrl('https://evil.example/callback?code=abc'), null);
  assert.equal(parsePixivCallbackUrl('http://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=abc'), null);
  assert.equal(parsePixivCallbackUrl('https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback'), null);
  assert.equal(parsePixivCallbackUrl('x'.repeat(4097)), null);
});

test('默认浏览器启动不带调试、自动化或临时 profile 参数', async () => {
  const calls = [];
  const promise = launchInDefaultBrowser('https://example.com/login', {
    platform: 'win32',
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      const child = makeChild();
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  await promise;
  assert.equal(calls[0].command, 'rundll32.exe');
  assert.deepEqual(calls[0].args, ['url.dll,FileProtocolHandler', 'https://example.com/login']);
  const serialized = JSON.stringify(calls[0]);
  assert.ok(!/remote-debugging|user-data-dir|headless|msedge/i.test(serialized));
});

test('默认浏览器启动失败返回普通错误', async () => {
  await assert.rejects(
    () => launchInDefaultBrowser('https://example.com', { platform: 'win32', spawn: () => { throw new Error('secret path'); } }),
    error => error.code === 'PIXIV_BROWSER_OPEN_FAILED' && !error.message.includes('secret'),
  );
});

test('换 token 请求保持官方字段与 X-Client-Hash', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const request = buildTokenExchangeRequest({ code: 'code123', codeVerifier: 'verifier123', now });
  assert.equal(request.body.get('grant_type'), 'authorization_code');
  assert.equal(request.body.get('code'), 'code123');
  assert.equal(request.body.get('code_verifier'), 'verifier123');
  assert.equal(request.body.get('redirect_uri'), 'https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback');
  assert.equal(request.headers['x-client-hash'], createHash('md5').update(`2026-01-01T00:00:00+00:00${PIXIV_HASH_SECRET}`).digest('hex'));
});

test('编排器使用默认浏览器并通过粘贴回调完成登录', async () => {
  const launched = [];
  const exchanged = [];
  let saved = null;
  const orchestrator = new PixivWebLoginOrchestrator({
    ensureSchemeHandler: noSchemeHandler,
    launchBrowser: async url => { launched.push(url); },
    exchange: async input => {
      exchanged.push(input);
      return { refreshToken: 'refresh-token-test-123456', accessToken: 'access-token-test', accessTokenExpiresAt: Date.now() + 3600000 };
    },
    onTokens: async tokens => { saved = tokens; },
    getGeneration: () => 4,
    startWatcher: async () => { throw new Error('not available'); },
  });
  const started = await orchestrator.start();
  assert.equal(started.state, 'awaiting-user');
  assert.equal(launched.length, 1);
  assert.ok(!/remote-debugging|user-data-dir|headless/i.test(launched[0]));
  const completed = await orchestrator.complete(started.id, CALLBACK);
  assert.equal(completed.state, 'connected');
  assert.equal(exchanged[0].code, 'test-code-123');
  assert.match(exchanged[0].codeVerifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(saved.refreshToken, 'refresh-token-test-123456');
  const publicText = JSON.stringify(completed);
  assert.ok(!publicText.includes('test-code'));
  assert.ok(!publicText.includes('refresh-token'));
  assert.ok(!publicText.includes('verifier'));
});

test('无效回调不会结束会话，仍可重新粘贴正确地址', async () => {
  const orchestrator = new PixivWebLoginOrchestrator({
    ensureSchemeHandler: noSchemeHandler,
    launchBrowser: async () => {},
    exchange: async () => ({ refreshToken: 'refresh-token-test-123456', accessToken: 'access-token-test' }),
    startWatcher: async () => { throw new Error('not available'); },
  });
  const started = await orchestrator.start();
  await assert.rejects(() => orchestrator.complete(started.id, 'https://evil.example/?code=x'), error => error.code === 'PIXIV_LOGIN_CALLBACK_INVALID');
  assert.equal(orchestrator.status(started.id).state, 'awaiting-user');
  const completed = await orchestrator.complete(started.id, CALLBACK);
  assert.equal(completed.state, 'connected');
});

test('Windows 回调监听启动成功时公开状态标记为自动完成', async () => {
  const watcher = makeWatcher();
  const orchestrator = new PixivWebLoginOrchestrator({
    ensureSchemeHandler: noSchemeHandler,
    launchBrowser: async () => {},
    exchange: async () => ({ refreshToken: 'refresh-token-test-123456', accessToken: 'access-token-test' }),
    startWatcher: async () => watcher,
  });
  const started = await orchestrator.start();
  assert.equal(started.automaticCallback, true);
  const completed = await orchestrator.complete(started.id, CALLBACK);
  assert.equal(completed.state, 'connected');
  assert.equal(watcher.killed, true);
});

test('同一时刻只允许一个会话，取消后可重开', async () => {
  const orchestrator = new PixivWebLoginOrchestrator({
    ensureSchemeHandler: noSchemeHandler, launchBrowser: async () => {}, startWatcher: async () => makeWatcher() });
  const first = await orchestrator.start();
  await assert.rejects(() => orchestrator.start(), error => error.code === 'PIXIV_LOGIN_ACTIVE');
  assert.equal((await orchestrator.cancel(first.id)).state, 'canceled');
  assert.equal((await orchestrator.start()).state, 'awaiting-user');
});

test('超时清除 PKCE 并返回安全公开状态', async () => {
  const orchestrator = new PixivWebLoginOrchestrator({
    ensureSchemeHandler: noSchemeHandler, launchBrowser: async () => {}, ttlMs: 30, startWatcher: async () => makeWatcher() });
  const started = await orchestrator.start();
  const final = await waitFor(() => {
    const state = orchestrator.status(started.id);
    return state?.state === 'timed-out' ? state : null;
  });
  assert.deepEqual(Object.keys(final).sort(), ['automaticCallback', 'expiresAt', 'id', 'message', 'state']);
  assert.equal(serializePixivLoginState(orchestrator.active).state, 'timed-out');
  assert.equal(orchestrator.active.verifier, undefined);
});

test('Windows 地址栏监听只转交 Pixiv 官方 callback', async () => {
  const calls = [];
  const callbacks = [];
  const watcherPromise = startPixivCallbackWatcher({
    platform: 'win32',
    scriptPath: 'D:\\NPM\\scripts\\pixiv-edge-callback-watcher.ps1',
    onCallback: value => callbacks.push(value),
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      const child = makeChild();
      child.exitCode = null;
      child.killed = false;
      child.kill = () => { child.killed = true; };
      child.stdout = new EventEmitter();
      child.stdout.setEncoding = () => {};
      queueMicrotask(() => child.emit('spawn'));
      queueMicrotask(() => child.stdout.emit('data', 'NPM_PIXIV_WATCHER_READY\n'));
      queueMicrotask(() => child.stdout.emit('data', 'https://evil.example/?code=nope\n'));
      queueMicrotask(() => child.stdout.emit('data', `${CALLBACK}\n`));
      return child;
    },
  });
  await watcherPromise;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls[0].command, 'powershell.exe');
  assert.ok(calls[0].args.includes('D:\\NPM\\scripts\\pixiv-edge-callback-watcher.ps1'));
  assert.equal(calls[0].options.windowsHide, true);
  assert.deepEqual(callbacks, [CALLBACK]);
});

test('pixiv:// scheme 回调与 HTTPS callback 等效完成登录', async () => {
  const exchanged = [];
  const orchestrator = new PixivWebLoginOrchestrator({
    ensureSchemeHandler: noSchemeHandler,
    launchBrowser: async () => {},
    exchange: async input => {
      exchanged.push(input);
      return { refreshToken: 'refresh-token-test-123456', accessToken: 'access-token-test', accessTokenExpiresAt: Date.now() + 3600000 };
    },
    startWatcher: async () => makeWatcher(),
  });
  const started = await orchestrator.start();
  const completed = await orchestrator.complete(started.id, PIXIV_SCHEME_CALLBACK);
  assert.equal(completed.state, 'connected');
  assert.equal(exchanged[0].code, 'scheme-code-456');
  const publicText = JSON.stringify(completed);
  assert.ok(!publicText.includes('scheme-code'));
});

test('complete 可省略会话 id（协议处理器场景）', async () => {
  const orchestrator = new PixivWebLoginOrchestrator({
    ensureSchemeHandler: noSchemeHandler,
    launchBrowser: async () => {},
    exchange: async () => ({ refreshToken: 'refresh-token-test-123456', accessToken: 'access-token-test' }),
    startWatcher: async () => makeWatcher(),
  });
  const started = await orchestrator.start();
  const completed = await orchestrator.complete(undefined, PIXIV_SCHEME_CALLBACK);
  assert.equal(completed.state, 'connected');
  assert.equal(orchestrator.status(started.id).state, 'connected');
  await assert.rejects(() => orchestrator.complete('wrong-id', PIXIV_SCHEME_CALLBACK), error => error.code === 'PIXIV_LOGIN_NOT_FOUND');
});

test('ensurePixivSchemeHandler 注册 pixiv 协议并幂等', async () => {
  const calls = [];
  const execFile = async (command, args) => { calls.push({ command, args }); return ''; };
  const ok = await ensurePixivSchemeHandler({ execFile, platform: 'win32', nodePath: 'C:\\node\\node.exe' });
  assert.equal(ok, true);
  const first = calls[0];
  assert.equal(first.command, 'reg.exe');
  assert.deepEqual(first.args.slice(0, 2), ['add', 'HKCU\\Software\\Classes\\pixiv']);
  assert.ok(first.args.includes('/ve'));
  const urlProtocol = calls.find(call => call.args.includes('/v'));
  assert.ok(urlProtocol);
  assert.ok(urlProtocol.args.includes('URL Protocol'));
  const commandEntry = calls.find(call => call.args[1].endsWith('\\shell\\open\\command'));
  assert.ok(commandEntry);
  const commandIndex = commandEntry.args.indexOf('/d');
  assert.match(commandEntry.args[commandIndex + 1], /^"C:\\node\\node\.exe" ".*pixiv-scheme-handler\.mjs" "%1"$/);
  const okAgain = await ensurePixivSchemeHandler({ execFile, platform: 'win32', nodePath: 'C:\\node\\node.exe' });
  assert.equal(okAgain, true);
  assert.equal(calls.length, 6);
});

test('ensurePixivSchemeHandler 非 Windows 返回 false 且失败不抛出', async () => {
  const execFile = async () => { throw new Error('no reg'); };
  assert.equal(await ensurePixivSchemeHandler({ execFile, platform: 'linux' }), false);
  assert.equal(await ensurePixivSchemeHandler({ execFile, platform: 'win32', nodePath: 'C:\\node\\node.exe' }), false);
});
