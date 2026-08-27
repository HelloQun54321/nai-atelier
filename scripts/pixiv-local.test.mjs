import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FeedCache,
  PIXIV_ALLOWED_API_PATHS,
  PIXIV_HASH_SECRET,
  PIXIV_OAUTH_TOKEN_URL,
  PIXIV_RETRY_AFTER_MAX_MS,
  classifyPixivApiTarget,
  normalizePixivResponse,
  PixivGalleryService,
  PixivOAuthClient,
  PixivTokenStore,
  resolvePixivRetryDelayMs,
  sanitizePixivNextUrl,
} from './pixiv-local.mjs';
import { createMediaGateway } from './media-gateway.mjs';

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json' },
});

const makeTokenDir = async () => {
  const dir = join(process.cwd(), 'local-data', `pixiv-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  return dir;
};

const makeConnectedStore = async (dir, { refreshToken = 'rt-cache-test-123456', accessToken = 'at-cache-test-123456' } = {}) => {
  const store = new PixivTokenStore({ dir });
  await store.init();
  await store.save({ refreshToken, accessToken, accessTokenExpiresAt: Date.now() + 3600_000, updatedAt: 1 });
  return store;
};

const feedResponse = (id, title = 'x', nextUrl = null) => jsonResponse({
  illusts: [{ id, title, user: { id: 'u', name: 'n' } }],
  next_url: nextUrl,
});

// ---------- host / path / method 允许列表 ----------

test('Pixiv API allowlist only permits whitelisted app-api.pixiv.net paths', () => {
  assert.equal(PIXIV_ALLOWED_API_PATHS.size, 11);
  for (const path of [
    '/v1/illust/recommended',
    '/v1/search/illust',
    '/v1/illust/ranking',
    '/v1/user/illusts',
    '/v1/illust/detail',
    '/v2/illust/follow',
    '/v1/user/bookmarks/illust',
    '/v2/illust/related',
    '/v1/trending-tags/illust',
  ]) {
    const target = classifyPixivApiTarget(`https://app-api.pixiv.net${path}`);
    assert.ok(target, path);
    assert.equal(target.host, 'app-api.pixiv.net');
    assert.equal(target.pathname, path);
    assert.equal(target.method, 'GET');
  }
  for (const path of ['/v2/illust/bookmark/add', '/v1/illust/bookmark/delete']) {
    const target = classifyPixivApiTarget(`https://app-api.pixiv.net${path}`);
    assert.ok(target, path);
    assert.equal(target.host, 'app-api.pixiv.net');
    assert.equal(target.pathname, path);
    assert.equal(target.method, 'POST');
  }
  assert.equal(classifyPixivApiTarget('https://app-api.pixiv.net/v1/illust/foo'), null);
  assert.equal(classifyPixivApiTarget('https://app-api.pixiv.net/v1/search/user'), null);
  assert.equal(classifyPixivApiTarget('https://app-api.pixiv.net/v2/illust/search'), null);
});

test('Pixiv API allowlist rejects foreign hosts, http, credentials and garbage', () => {
  assert.equal(classifyPixivApiTarget('https://i.pximg.net/v1/illust/recommended'), null);
  assert.equal(classifyPixivApiTarget('https://www.pixiv.net/v1/illust/recommended'), null);
  assert.equal(classifyPixivApiTarget('https://app-api.pixiv.net.evil.example/v1/illust/recommended'), null);
  assert.equal(classifyPixivApiTarget('https://app-api.pixiv.net@evil.example/v1/illust/recommended'), null);
  assert.equal(classifyPixivApiTarget('http://app-api.pixiv.net/v1/illust/recommended'), null);
  assert.equal(classifyPixivApiTarget('https://user:pass@app-api.pixiv.net/v1/illust/recommended'), null);
  assert.equal(classifyPixivApiTarget('https://app-api.pixiv.net:444/v1/illust/recommended'), null);
  assert.equal(classifyPixivApiTarget(''), null);
  assert.equal(classifyPixivApiTarget('not a url'), null);
  assert.equal(classifyPixivApiTarget(null), null);
});

// ---------- next_url / cursor 清洗 ----------

test('Pixiv next_url cursor is cleaned and re-validated against host/path/method', () => {
  const cleaned = sanitizePixivNextUrl('https://app-api.pixiv.net/v1/illust/recommended?offset=30&filter=&lang=zh');
  assert.equal(cleaned, 'https://app-api.pixiv.net/v1/illust/recommended?offset=30&lang=zh');
  assert.equal(sanitizePixivNextUrl(cleaned), cleaned);
  assert.equal(sanitizePixivNextUrl('https://app-api.pixiv.net/v1/illust/ranking?mode=day'), 'https://app-api.pixiv.net/v1/illust/ranking?mode=day');
  assert.equal(sanitizePixivNextUrl('https://evil.example/v1/illust/recommended?offset=30'), null);
  assert.equal(sanitizePixivNextUrl('https://i.pximg.net/v1/illust/recommended?offset=30'), null);
  assert.equal(sanitizePixivNextUrl('https://app-api.pixiv.net/v1/illust/foo?offset=30'), null);
  assert.equal(sanitizePixivNextUrl('https://app-api.pixiv.net/v1/search/user?offset=30'), null);
  assert.equal(sanitizePixivNextUrl('https://app-api.pixiv.net/v1/illust/ranking?x='.concat('a'.repeat(3000))), null);
});

test('Pixiv recommended 超长 next_url 裁剪 viewed 列表后仍可翻页', () => {
  // recommended 的 next_url 携带逐页累积 viewed[]，随翻页无限增长；超过长度上限时应
  // 裁剪掉最早的 viewed（保留最近部分）并重排索引为 0 起连续，而不是整个丢弃。
  const viewed = Array.from({ length: 200 }, (_, index) => `viewed[${index}]=${100000000 + index}`);
  const base = 'https://app-api.pixiv.net/v1/illust/recommended?min_bookmark_id_for_recent_illust=38306879721&max_bookmark_id_for_recommend=35633142820&offset=0&include_ranking_illusts=false&include_privacy_policy=false';
  const long = `${base}&${viewed.join('&')}`;
  assert.ok(long.length > 3000);
  const cleaned = sanitizePixivNextUrl(long);
  assert.ok(cleaned);
  assert.ok(cleaned.length <= 2048, `cleaned length ${cleaned.length}`);
  const parsed = new URL(cleaned);
  const viewedKeys = [...parsed.searchParams.keys()].filter(key => key.startsWith('viewed['));
  assert.ok(viewedKeys.length > 0);
  const indexes = viewedKeys.map(key => Number(key.slice(7, -1)));
  // 索引必须从 0 连续编号，否则 Pixiv 返回 400。
  assert.deepEqual(indexes, indexes.map((_, index) => index));
  // 保留的是最近（索引最大）的部分。
  assert.equal(parsed.searchParams.get('viewed[0]'), String(100000000 + 200 - viewedKeys.length));
  // 清洗结果可再次通过清洗（幂等）。
  assert.equal(sanitizePixivNextUrl(cleaned), cleaned);
  // viewed 数量适中时不做裁剪。
  const short = `${base}&viewed[0]=100000000&viewed[1]=100000001`;
  assert.equal(sanitizePixivNextUrl(short), short);
});

// ---------- 响应规范化（年龄分级原样透传） ----------

test('Pixiv responses normalize without filtering age rating', () => {
  const payload = {
    illusts: [
      {
        id: 1, title: 'a', type: 'illust', x_restrict: 0, tags: [{ name: 'x' }, 'y'], page_count: 2,
        width: 100, height: 200, user: { id: 'u1', name: 'n1' },
        image_urls: { medium: 'https://i.pximg.net/m.jpg' },
        meta_pages: [
          { image_urls: { original: 'https://i.pximg.net/o1.jpg' } },
          { image_urls: { original: 'https://i.pximg.net/o2.jpg' } },
        ],
      },
      { id: 2, title: 'b', x_restrict: 2, user: { id: 'u2', name: 'n2' }, meta_single_page: { original_image_url: 'https://i.pximg.net/o.jpg' } },
    ],
    next_url: 'https://app-api.pixiv.net/v1/illust/recommended?offset=30',
  };
  const result = normalizePixivResponse(payload, 'recommended');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].xRestrict, 0);
  assert.equal(result.items[1].xRestrict, 2);
  assert.equal(result.items[0].pageCount, 2);
  assert.deepEqual(result.items[0].tags, ['x', 'y']);
  assert.deepEqual(result.items[0].metaPages, ['https://i.pximg.net/o1.jpg', 'https://i.pximg.net/o2.jpg']);
  assert.equal(result.items[1].urls.original, 'https://i.pximg.net/o.jpg');
  assert.equal(result.nextUrl, 'https://app-api.pixiv.net/v1/illust/recommended?offset=30');

  const detail = normalizePixivResponse({ illust: { id: 9, title: 'd', x_restrict: 1 } }, 'detail');
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0].xRestrict, 1);
  assert.equal(detail.nextUrl, null);
  assert.deepEqual(normalizePixivResponse({ illusts: null }, 'search').items, []);
});

test('Pixiv feed builds whitelisted API URLs per mode', () => {
  const service = new PixivGalleryService({ store: new PixivTokenStore({ dir: join(process.cwd(), 'local-data') }) });
  const recommended = new URL(service.buildFeedUrl('recommended', {}));
  assert.equal(recommended.pathname, '/v1/illust/recommended');
  const search = new URL(service.buildFeedUrl('search', { word: '猫' }));
  assert.equal(search.pathname, '/v1/search/illust');
  assert.equal(search.searchParams.get('word'), '猫');
  assert.equal(search.searchParams.get('search_target'), 'partial_match_for_tags');
  const ranking = new URL(service.buildFeedUrl('day', { date: '2026-08-12' }));
  assert.equal(ranking.pathname, '/v1/illust/ranking');
  assert.equal(ranking.searchParams.get('mode'), 'day');
  assert.equal(ranking.searchParams.get('date'), '2026-08-12');
  const user = new URL(service.buildFeedUrl('user', { user_id: '12345' }));
  assert.equal(user.pathname, '/v1/user/illusts');
  assert.equal(user.searchParams.get('user_id'), '12345');
  const detail = new URL(service.buildFeedUrl('detail', { illust_id: '678' }));
  assert.equal(detail.pathname, '/v1/illust/detail');
  assert.equal(detail.searchParams.get('illust_id'), '678');
  assert.throws(() => service.buildFeedUrl('search', {}), error => error.code === 'PIXIV_INVALID_PARAMS');
  assert.throws(() => service.buildFeedUrl('user', {}), error => error.code === 'PIXIV_INVALID_PARAMS');
  assert.throws(() => service.buildFeedUrl('detail', {}), error => error.code === 'PIXIV_INVALID_PARAMS');
  assert.throws(() => service.buildFeedUrl('bogus', {}), error => error.code === 'PIXIV_INVALID_MODE');
});

// ---------- feed 缓存（TTL + LRU + 单飞 + 防串号） ----------

test('Pixiv feed cache serves repeated identical feeds from one upstream call', async () => {
  const dir = await makeTokenDir();
  try {
    const store = await makeConnectedStore(dir);
    let apiCalls = 0;
    const client = new PixivOAuthClient({
      store,
      fetch: async () => {
        apiCalls += 1;
        return feedResponse(21, 'cached');
      },
    });
    const service = new PixivGalleryService({ store, oauth: client });
    const first = await service.feed({ mode: 'recommended' });
    const second = await service.feed({ mode: 'recommended' });
    assert.equal(apiCalls, 1);
    assert.equal(first.items[0].id, '21');
    assert.deepEqual(second, first);
    assert.equal(second.fetchedAt, first.fetchedAt);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pixiv feed cache single-flights concurrent identical feed requests', async () => {
  const dir = await makeTokenDir();
  try {
    const store = await makeConnectedStore(dir);
    let apiCalls = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const client = new PixivOAuthClient({
      store,
      fetch: async () => {
        apiCalls += 1;
        await gate;
        return feedResponse(22, 'single-flight');
      },
    });
    const service = new PixivGalleryService({ store, oauth: client });
    const pending = [service.feed({ mode: 'recommended' }), service.feed({ mode: 'recommended' })];
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(apiCalls, 1);
    release();
    const [first, second] = await Promise.all(pending);
    assert.equal(apiCalls, 1);
    assert.deepEqual(first, second);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pixiv feed cache expires after TTL and evicts least-recently-used entries', async () => {
  const dir = await makeTokenDir();
  try {
    const store = await makeConnectedStore(dir);
    let apiCalls = 0;
    const client = new PixivOAuthClient({
      store,
      fetch: async (url) => {
        apiCalls += 1;
        const search = new URL(url).searchParams;
        return feedResponse(apiCalls, search.get('mode') || 'recommended');
      },
    });
    const service = new PixivGalleryService({ store, oauth: client, feedCacheTtlMs: 40, feedCacheMaxEntries: 2 });
    await service.feed({ mode: 'day' });
    await service.feed({ mode: 'week' });
    await service.feed({ mode: 'month' });
    assert.equal(apiCalls, 3); // month 插入后 day 被 LRU 逐出
    await service.feed({ mode: 'day' });
    assert.equal(apiCalls, 4); // day 已逐出 → 重新请求
    await service.feed({ mode: 'month' });
    assert.equal(apiCalls, 4); // month 仍在缓存
    await new Promise(resolve => setTimeout(resolve, 60));
    await service.feed({ mode: 'month' });
    assert.equal(apiCalls, 5); // month 已过期 → 重新请求
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pixiv feed cache is cleared on connect switch and disconnect to prevent cross-account leakage', async () => {
  const dir = await makeTokenDir();
  try {
    const store = new PixivTokenStore({ dir });
    await store.init();
    let apiCalls = 0;
    const client = new PixivOAuthClient({
      store,
      fetch: async (url, options) => {
        if (url === PIXIV_OAUTH_TOKEN_URL) {
          const body = new URLSearchParams(options.body);
          const token = body.get('refresh_token');
          return jsonResponse({ access_token: `at-${token}`, refresh_token: token, expires_in: 3600 });
        }
        apiCalls += 1;
        return feedResponse(apiCalls, 'account');
      },
    });
    const service = new PixivGalleryService({ store, oauth: client });
    await service.connect('rt-account-a-123456');
    await service.feed({ mode: 'recommended' });
    assert.equal(apiCalls, 1);
    await service.feed({ mode: 'recommended' });
    assert.equal(apiCalls, 1); // 命中缓存
    await service.connect('rt-account-b-123456');
    await service.feed({ mode: 'recommended' });
    assert.equal(apiCalls, 2); // 切换账号 → 缓存清空
    await service.disconnect();
    await service.connect('rt-account-a-123456');
    await service.feed({ mode: 'recommended' });
    assert.equal(apiCalls, 3); // 断开 → 缓存清空
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pixiv feed in flight during a token switch is not cached for the new account', async () => {
  const dir = await makeTokenDir();
  try {
    const store = new PixivTokenStore({ dir });
    await store.init();
    let apiCalls = 0;
    let releaseFeed;
    let markFeedStarted;
    const feedStarted = new Promise(resolve => { markFeedStarted = resolve; });
    const client = new PixivOAuthClient({
      store,
      fetch: async (url, options) => {
        if (url === PIXIV_OAUTH_TOKEN_URL) {
          const body = new URLSearchParams(options.body);
          const token = body.get('refresh_token');
          return jsonResponse({ access_token: `at-${token}`, refresh_token: token, expires_in: 3600 });
        }
        apiCalls += 1;
        if (apiCalls === 1) {
          markFeedStarted();
          await new Promise(resolve => { releaseFeed = resolve; });
        }
        return feedResponse(apiCalls, 'account');
      },
    });
    const service = new PixivGalleryService({ store, oauth: client });
    await service.connect('rt-account-a-123456');
    const pendingFeed = service.feed({ mode: 'recommended' });
    await feedStarted;
    await service.connect('rt-account-b-123456');
    releaseFeed();
    await pendingFeed;
    // 旧账号请求已完成，但新账号下的相同 feed 必须重新请求，不能命中旧账号缓存。
    await service.feed({ mode: 'recommended' });
    assert.equal(apiCalls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('FeedCache LRU keeps at most maxEntries entries and clears on demand', () => {
  const cache = new FeedCache({ ttlMs: 60_000, maxEntries: 2 });
  cache.put('a', 1);
  cache.put('b', 2);
  cache.put('c', 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('a'), undefined); // a 被逐出
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.get('b'), undefined);
});

test('FeedCache clear also detaches old in-flight requests during an account switch', () => {
  const cache = new FeedCache();
  const oldRequest = Promise.resolve('old-account');
  cache.inFlight.set('same-feed-url', oldRequest);
  cache.clear();
  assert.equal(cache.inFlight.has('same-feed-url'), false);
});

// ---------- GET 429 退避（最多 1 次、尊重 Retry-After、封顶、无无限重试） ----------

test('Pixiv retry delay parsing respects Retry-After and caps the wait', () => {
  assert.equal(resolvePixivRetryDelayMs('0', 0), 0);
  assert.equal(resolvePixivRetryDelayMs('2', 0), 2_000);
  assert.equal(resolvePixivRetryDelayMs('99999', 0), PIXIV_RETRY_AFTER_MAX_MS);
  assert.equal(resolvePixivRetryDelayMs(null, 123), 123);
  assert.equal(resolvePixivRetryDelayMs('', 123), 123);
  assert.equal(resolvePixivRetryDelayMs('not-a-date', 123), 123);
  const jittered = resolvePixivRetryDelayMs(null, undefined);
  assert.ok(jittered >= 500 && jittered <= 1_500, `jittered delay out of range: ${jittered}`);
  const future = new Date(Date.now() + 60_000).toUTCString();
  assert.equal(resolvePixivRetryDelayMs(future, 0), PIXIV_RETRY_AFTER_MAX_MS);
});

test('Pixiv GET 429 retries at most once and succeeds', async () => {
  const dir = await makeTokenDir();
  try {
    const store = await makeConnectedStore(dir);
    let apiCalls = 0;
    const client = new PixivOAuthClient({
      store,
      retryDelayMs: 0,
      fetch: async () => {
        apiCalls += 1;
        if (apiCalls === 1) return jsonResponse({ error: { message: 'rate limited' } }, 429);
        return feedResponse(31, 'after-429');
      },
    });
    const payload = await client.request('https://app-api.pixiv.net/v1/illust/recommended');
    assert.equal(apiCalls, 2);
    assert.equal(payload.illusts[0].id, 31);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pixiv GET stops after consecutive 429 responses', async () => {
  const dir = await makeTokenDir();
  try {
    const store = await makeConnectedStore(dir);
    let apiCalls = 0;
    const client = new PixivOAuthClient({
      store,
      retryDelayMs: 0,
      fetch: async () => {
        apiCalls += 1;
        return jsonResponse({ error: { message: 'rate limited' } }, 429);
      },
    });
    await assert.rejects(
      () => client.request('https://app-api.pixiv.net/v1/illust/recommended'),
      error => error.code === 'PIXIV_API_ERROR' && error.upstreamStatus === 429,
    );
    assert.equal(apiCalls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pixiv GET 429 respects Retry-After when present', async () => {
  const dir = await makeTokenDir();
  try {
    const store = await makeConnectedStore(dir);
    let apiCalls = 0;
    let firstAt = 0;
    const client = new PixivOAuthClient({
      store,
      retryDelayMs: 0,
      fetch: async () => {
        apiCalls += 1;
        if (apiCalls === 1) {
          firstAt = Date.now();
          return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '1' },
          });
        }
        return feedResponse(32, 'after-retry-after');
      },
    });
    const payload = await client.request('https://app-api.pixiv.net/v1/illust/recommended');
    assert.equal(apiCalls, 2);
    assert.ok(Date.now() - firstAt >= 900, 'retry should wait for Retry-After');
    assert.equal(payload.illusts[0].id, 32);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- 本机 AES-256-GCM token 存储 ----------

test('Pixiv tokens are AES-256-GCM encrypted with an independent key and atomic writes', async () => {
  const dir = await makeTokenDir();
  try {
    const store = new PixivTokenStore({ dir });
    await store.init();
    assert.equal(store.status().connected, false);
    await store.save({ refreshToken: 'rt-secret-token-abc', accessToken: 'at-secret-token-xyz', accessTokenExpiresAt: 0, updatedAt: 123 });

    const tokenFile = join(dir, 'pixiv-tokens.json');
    const keyFile = join(dir, 'pixiv.key');
    const raw = await readFile(tokenFile, 'utf8');
    assert.ok(!raw.includes('rt-secret-token-abc'));
    assert.ok(!raw.includes('at-secret-token-xyz'));
    const envelope = JSON.parse(raw);
    assert.ok(envelope.iv && envelope.tag && envelope.data);
    assert.equal(envelope.refreshToken, undefined);
    assert.equal(envelope.accessToken, undefined);
    const keyRaw = await readFile(keyFile, 'utf8');
    assert.ok(!keyRaw.includes('rt-secret-token-abc'));

    const reloaded = new PixivTokenStore({ dir });
    await reloaded.init();
    assert.equal(reloaded.tokens.refreshToken, 'rt-secret-token-abc');
    assert.equal(reloaded.tokens.accessToken, 'at-secret-token-xyz');
    assert.equal(store.key.toString('hex'), reloaded.key.toString('hex'));

    const leftovers = (await readdir(dir)).filter(name => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
    if (process.platform !== 'win32') {
      const mode = (await stat(tokenFile)).mode & 0o777;
      assert.equal(mode, 0o600);
      assert.equal((await stat(dir)).mode & 0o777, 0o700);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('corrupted Pixiv key fails closed and is never silently replaced', async () => {
  const dir = await makeTokenDir();
  try {
    const store = new PixivTokenStore({ dir });
    await store.init();
    const keyFile = join(dir, 'pixiv.key');
    await writeFile(keyFile, '{"version":1,"key":"broken"}\n', 'utf8');
    const broken = new PixivTokenStore({ dir });
    await assert.rejects(() => broken.init(), /Invalid key length/);
    assert.equal(await readFile(keyFile, 'utf8'), '{"version":1,"key":"broken"}\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('corrupted or tampered Pixiv token files are treated as disconnected', async () => {
  const dir = await makeTokenDir();
  try {
    const store = new PixivTokenStore({ dir });
    await store.init();
    await store.save({ refreshToken: 'rt-token-123456', accessToken: '', accessTokenExpiresAt: 0, updatedAt: 1 });
    await writeFile(join(dir, 'pixiv-tokens.json'), '{"version":1,"iv":"AA==","tag":"AA==","data":"AA=="}\n', 'utf8');
    const reloaded = new PixivTokenStore({ dir });
    await reloaded.init();
    assert.equal(reloaded.status().connected, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- OAuth 刷新客户端 ----------

test('Pixiv OAuth refresh is single-flight and stores tokens without exposing them', async () => {
  const dir = await makeTokenDir();
  try {
    const store = new PixivTokenStore({ dir });
    await store.init();
    await store.save({ refreshToken: 'rt-original-123456', accessToken: '', accessTokenExpiresAt: 0, updatedAt: 1 });
    let refreshCalls = 0;
    const client = new PixivOAuthClient({
      store,
      fetch: async (url, options) => {
        assert.equal(url, PIXIV_OAUTH_TOKEN_URL);
        const clientTime = options.headers['x-client-time'];
        assert.match(clientTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
        assert.equal(options.headers['x-client-hash'], createHash('md5').update(`${clientTime}${PIXIV_HASH_SECRET}`).digest('hex'));
        assert.equal(options.headers['app-os'], 'ios');
        assert.equal(options.headers['app-os-version'], '14.6');
        assert.match(options.headers['user-agent'], /^PixivIOSApp\//);
        const params = new URLSearchParams(options.body);
        assert.equal(params.get('get_secure_url'), '1');
        assert.equal(params.get('refresh_token'), 'rt-original-123456');
        refreshCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return jsonResponse({ response: { access_token: 'at-new-abcdef', refresh_token: 'rt-new-abcdef', expires_in: 3600 } });
      },
    });
    const [first, second] = await Promise.all([client.refresh(), client.refresh()]);
    assert.equal(refreshCalls, 1);
    assert.equal(first.accessToken, 'at-new-abcdef');
    assert.equal(second.accessToken, 'at-new-abcdef');
    assert.equal(store.tokens.refreshToken, 'rt-new-abcdef');
    const raw = await readFile(join(dir, 'pixiv-tokens.json'), 'utf8');
    assert.ok(!raw.includes('rt-new-abcdef'));
    assert.ok(!raw.includes('at-new-abcdef'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('disconnect wins over an in-flight Pixiv refresh', async () => {
  const dir = await makeTokenDir();
  try {
    const store = new PixivTokenStore({ dir });
    await store.init();
    await store.save({ refreshToken: 'rt-original-123456', accessToken: '', accessTokenExpiresAt: 0, updatedAt: 1 });
    let releaseRefresh;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    const client = new PixivOAuthClient({
      store,
      fetch: async () => {
        markStarted();
        await new Promise(resolve => { releaseRefresh = resolve; });
        return jsonResponse({ access_token: 'at-stale-result', refresh_token: 'rt-stale-result', expires_in: 3600 });
      },
    });
    const pending = client.refresh();
    await started;
    await store.clear();
    releaseRefresh();
    await assert.rejects(pending, error => error.code === 'PIXIV_TOKEN_STATE_CHANGED');
    assert.equal(store.status().connected, false);
    await assert.rejects(() => readFile(join(dir, 'pixiv-tokens.json'), 'utf8'), error => error.code === 'ENOENT');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('failed Pixiv connect restores the previous valid connection', async () => {
  const dir = await makeTokenDir();
  try {
    const store = new PixivTokenStore({ dir });
    await store.init();
    await store.save({ refreshToken: 'rt-previous-123456', accessToken: 'at-previous-123456', accessTokenExpiresAt: Date.now() + 3600_000, updatedAt: 1 });
    const oauth = new PixivOAuthClient({ store, fetch: async () => jsonResponse({ error: 'invalid_grant' }, 400) });
    const service = new PixivGalleryService({ store, oauth });
    await assert.rejects(() => service.connect('rt-invalid-new-123456'), error => error.code === 'PIXIV_REFRESH_FAILED');
    assert.equal(store.tokens.refreshToken, 'rt-previous-123456');
    assert.equal(store.tokens.accessToken, 'at-previous-123456');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pixiv refresh keeps the previous refresh_token when the response omits it', async () => {
  const dir = await makeTokenDir();
  try {
    const store = new PixivTokenStore({ dir });
    await store.init();
    await store.save({ refreshToken: 'rt-original-123456', accessToken: '', accessTokenExpiresAt: 0, updatedAt: 1 });
    let refreshCalls = 0;
    const client = new PixivOAuthClient({
      store,
      fetch: async () => {
        refreshCalls += 1;
        return refreshCalls === 1
          ? jsonResponse({ access_token: 'at-new-abcdef', refresh_token: 'rt-new-abcdef', expires_in: 3600 })
          : jsonResponse({ access_token: 'at-newer-uvwxyz', expires_in: 3600 });
      },
    });
    await client.refresh();
    await client.refresh();
    assert.equal(store.tokens.refreshToken, 'rt-new-abcdef');
    assert.equal(store.tokens.accessToken, 'at-newer-uvwxyz');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pixiv request retries at most once after a 401 refresh', async () => {
  const dir = await makeTokenDir();
  try {
    const store = new PixivTokenStore({ dir });
    await store.init();
    await store.save({ refreshToken: 'rt-original-123456', accessToken: 'at-stale-123456', accessTokenExpiresAt: Date.now() + 3600_000, updatedAt: 1 });
    let apiCalls = 0;
    let refreshCalls = 0;
    const seenAuthorizations = [];
    const client = new PixivOAuthClient({
      store,
      fetch: async (url, options) => {
        if (url === PIXIV_OAUTH_TOKEN_URL) {
          refreshCalls += 1;
          return jsonResponse({ access_token: 'at-fresh-789', refresh_token: 'rt-fresh-789', expires_in: 3600 });
        }
        apiCalls += 1;
        seenAuthorizations.push(options.headers.authorization);
        if (apiCalls === 1) return jsonResponse({ error: { message: 'expired access token' } }, 401);
        return jsonResponse({ illusts: [{ id: 7, title: 'x' }], next_url: null });
      },
    });
    const payload = await client.request('https://app-api.pixiv.net/v1/illust/recommended');
    assert.equal(apiCalls, 2);
    assert.equal(refreshCalls, 1);
    assert.equal(payload.illusts[0].id, 7);
    assert.deepEqual(seenAuthorizations, ['Bearer at-stale-123456', 'Bearer at-fresh-789']);
    assert.equal(store.tokens.accessToken, 'at-fresh-789');
    assert.equal(store.tokens.refreshToken, 'rt-fresh-789');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pixiv request never retries twice on repeated 401', async () => {
  const dir = await makeTokenDir();
  try {
    const store = new PixivTokenStore({ dir });
    await store.init();
    await store.save({ refreshToken: 'rt-original-123456', accessToken: 'at-stale-123456', accessTokenExpiresAt: Date.now() + 3600_000, updatedAt: 1 });
    let apiCalls = 0;
    let refreshCalls = 0;
    const client = new PixivOAuthClient({
      store,
      fetch: async (url) => {
        if (url === PIXIV_OAUTH_TOKEN_URL) {
          refreshCalls += 1;
          return jsonResponse({ access_token: 'at-fresh-789', refresh_token: 'rt-fresh-789', expires_in: 3600 });
        }
        apiCalls += 1;
        return jsonResponse({ error: { message: 'still expired' } }, 401);
      },
    });
    await assert.rejects(
      () => client.request('https://app-api.pixiv.net/v1/illust/recommended'),
      error => error.code === 'PIXIV_API_ERROR' && error.status === 401,
    );
    assert.equal(apiCalls, 2);
    assert.equal(refreshCalls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pixiv errors and requests never echo tokens', async () => {
  const dir = await makeTokenDir();
  try {
    const store = new PixivTokenStore({ dir });
    await store.init();
    await store.save({ refreshToken: 'RT_SECRET_123456', accessToken: 'AT_SECRET_123456', accessTokenExpiresAt: Date.now() + 3600_000, updatedAt: 1 });
    const client = new PixivOAuthClient({
      store,
      fetch: async (url, options) => {
        if (url === PIXIV_OAUTH_TOKEN_URL) {
          return jsonResponse({ error: { message: 'invalid_grant', user_message: 'RT_SECRET_123456 AT_SECRET_123456' } }, 400);
        }
        return jsonResponse({ error: { message: `bad token ${options.headers.authorization}` } }, 403);
      },
    });
    await assert.rejects(() => client.refresh(), error => {
      assert.equal(error.code, 'PIXIV_REFRESH_FAILED');
      assert.ok(!JSON.stringify(error).includes('RT_SECRET_123456'));
      assert.ok(!JSON.stringify(error).includes('AT_SECRET_123456'));
      return true;
    });
    await assert.rejects(() => client.request('https://app-api.pixiv.net/v1/illust/recommended'), error => {
      assert.equal(error.code, 'PIXIV_API_ERROR');
      assert.ok(!JSON.stringify(error).includes('RT_SECRET_123456'));
      assert.ok(!JSON.stringify(error).includes('AT_SECRET_123456'));
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pixiv request blocks disallowed targets and reports missing configuration', async () => {
  const dir = await makeTokenDir();
  try {
    const store = new PixivTokenStore({ dir });
    await store.init();
    await store.save({ refreshToken: 'rt-original-123456', accessToken: 'at-ok-123456', accessTokenExpiresAt: Date.now() + 3600_000, updatedAt: 1 });
    const client = new PixivOAuthClient({
      store,
      fetch: async () => { throw new Error('must not fetch'); },
    });
    await assert.rejects(
      () => client.request('https://i.pximg.net/v1/illust/recommended'),
      error => error.code === 'PIXIV_TARGET_NOT_ALLOWED' && error.status === 400,
    );
    await assert.rejects(
      () => client.request('https://app-api.pixiv.net/v1/illust/recommended', { method: 'POST' }),
      error => error.code === 'PIXIV_METHOD_NOT_ALLOWED' && error.status === 405,
    );
    await store.clear();
    await assert.rejects(
      () => client.request('https://app-api.pixiv.net/v1/illust/recommended'),
      error => error.code === 'PIXIV_NOT_CONFIGURED' && error.status === 409,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- 网关 HTTP 表面 ----------

test('media gateway Pixiv endpoints enforce allowlist, cursor and token privacy', async () => {
  const tokenDir = await makeTokenDir();
  const calls = [];
  const refreshToken = 'RT_HTTP_TEST_TOKEN_123456';
  const pixivFetch = async (url, options) => {
    calls.push({ url: url.toString(), authorization: options.headers?.authorization });
    if (url === PIXIV_OAUTH_TOKEN_URL) {
      return jsonResponse({ access_token: 'AT_HTTP_TEST_123456', refresh_token: 'RT_HTTP_REFRESHED_123456', expires_in: 3600 });
    }
    if (url.includes('/v1/illust/recommended')) {
      return jsonResponse({
        illusts: [{ id: 11, title: 'x', user: { id: 'u', name: 'n' }, x_restrict: 2 }],
        next_url: 'https://app-api.pixiv.net/v1/illust/recommended?offset=30',
      });
    }
    throw new Error(`unexpected Pixiv fetch ${url}`);
  };
  const server = await createMediaGateway({ port: 0, workerPort: 39999, lanSecret: 'test-lan-secret-0123456789abcdef', pixivFetch, pixivTokenDir: tokenDir });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    let res = await fetch(`${base}/api/pixiv/status`);
    let body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.connected, false);

    res = await fetch(`${base}/api/pixiv/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.connected, true);
    assert.ok(!JSON.stringify(body).includes(refreshToken));

    res = await fetch(`${base}/api/pixiv/status`);
    body = await res.json();
    assert.equal(body.connected, true);
    assert.ok(!JSON.stringify(body).includes(refreshToken));
    assert.ok(!JSON.stringify(body).includes('Bearer'));

    res = await fetch(`${base}/api/pixiv/feed?mode=recommended`);
    body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].id, '11');
    assert.equal(body.items[0].xRestrict, 2);
    assert.equal(body.nextCursor, 'https://app-api.pixiv.net/v1/illust/recommended?offset=30');
    assert.ok(!JSON.stringify(body).includes(refreshToken));
    assert.ok(!JSON.stringify(body).includes('Bearer'));

    res = await fetch(`${base}/api/pixiv/feed?mode=recommended&cursor=${encodeURIComponent(body.nextCursor)}`);
    assert.equal(res.status, 200);

    const raw = await readFile(join(tokenDir, 'pixiv-tokens.json'), 'utf8');
    assert.ok(!raw.includes(refreshToken));
    assert.ok(!raw.includes('RT_HTTP_REFRESHED_123456'));

    res = await fetch(`${base}/api/pixiv/feed?mode=recommended&cursor=${encodeURIComponent('https://evil.example/v1/illust/recommended?offset=30')}`);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'PIXIV_INVALID_CURSOR');

    res = await fetch(`${base}/api/pixiv/feed?mode=hacker`);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'PIXIV_INVALID_MODE');

    res = await fetch(`${base}/api/pixiv/connect`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).connected, false);

    res = await fetch(`${base}/api/pixiv/status`);
    body = await res.json();
    assert.equal(body.connected, false);

    res = await fetch(`${base}/api/pixiv/feed?mode=recommended`);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'PIXIV_NOT_CONFIGURED');

    await assert.rejects(() => readFile(join(tokenDir, 'pixiv-tokens.json'), 'utf8'), error => error.code === 'ENOENT');
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
    await rm(tokenDir, { recursive: true, force: true });
  }
});
