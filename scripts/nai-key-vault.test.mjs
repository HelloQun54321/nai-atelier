// 密钥保管箱（P3-31：localStorage → local-data / D1 settings 表）单元测试。
//
// 被测文件内部都是不带扩展名的相对导入，node ESM 无法直接解析，因此在测试内
// 用 esbuild（项目既有 devDependency）把模块 bundle 后经 data: URL 导入——不改变
// 项目任何构建配置，也不触碰 worker 端产物。
//
// 覆盖两个层面：
//   1. worker 路由层（内存模拟 D1 prepared statement + 真实 Request）：
//      GET 空库 / POST 校验（empty / invalid / duplicate）/ 追加 / rename / delete /
//      整体迁移写入 / 404 语义；
//   2. 前端 service 层（stub globalThis.fetch + 内存 localStorage/sessionStorage）：
//      服务端可达的读写、localStorage 旧库一次性迁移（成功后仅一次 PUT、随后删除
//      本地副本）、服务端不可达时回退本地保管箱。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

/** 用 esbuild bundle 指定入口后经 data: URL 导入（format esm / platform browser）。 */
const loadModule = async (entryPoint) => {
  const esbuild = require('esbuild');
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  const source = result.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
};

// ---- 内存模拟 D1：settings 表就是一个 key → value 的 Map ----
const makeMemoryDb = () => {
  const store = new Map();
  const db = {
    prepare(sql) {
      // 本路由只用到两处固定 SQL，无需真正解析参数位置。
      const read = /SELECT value FROM settings WHERE key = \?/.test(sql);
      const write = /INSERT OR REPLACE INTO settings/.test(sql);
      let bound;
      const statement = {
        bind(...values) {
          bound = values;
          return statement;
        },
        async first() {
          if (read && bound?.[0] !== undefined) {
            const value = store.get(bound[0]);
            return value === undefined ? null : { value };
          }
          return null;
        },
        async run() {
          if (write && bound?.[0] !== undefined) store.set(bound[0], String(bound[1]));
          return { results: [], success: true, meta: {} };
        },
      };
      return statement;
    },
    _store: store,
  };
  return db;
};

const vaultApi = (method, body, path = '/api/nai-key-vault') =>
  new Request(`http://local.test${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const runRoute = async (db, method, body, path = '/api/nai-key-vault') => {
  const mod = await loadModule('worker/routes/naiKeyVaultRoutes.ts');
  const { handleNaiKeyVaultRoute } = mod;
  const request = vaultApi(method, body, path);
  const url = new URL(request.url);
  const ctx = {
    request,
    env: {},
    url,
    path,
    method,
    db,
    currentUser: { id: 'local', role: 'admin' },
    initDB: async () => {},
  };
  return handleNaiKeyVaultRoute(ctx);
};

test('路由 GET：空库返回空 entries', async () => {
  const db = makeMemoryDb();
  const response = await runRoute(db, 'GET');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { entries: [] });
});

test('路由 POST：空 key / 非 pst- 前缀返回 400 中文文案', async () => {
  const db = makeMemoryDb();
  for (const [body, expected] of [
    [{ name: '测试', key: '   ' }, '密钥不能为空'],
    [{ name: '测试', key: 'sk-123' }, 'pst- 开头'],
  ]) {
    const response = await runRoute(db, 'POST', body);
    assert.equal(response.status, 400);
    const errorText = (await response.json()).error;
    if (expected.startsWith('pst-')) assert.match(errorText, /pst-/);
    else assert.equal(errorText, expected);
  }
  // 校验失败不得写入任何条目。
  const list = await runRoute(db, 'GET');
  assert.deepEqual(await list.json(), { entries: [] });
});

test('路由 POST：合法密钥追加并返回序号默认名', async () => {
  const db = makeMemoryDb();
  const first = await runRoute(db, 'POST', { name: '', key: 'pst-AAAA' });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.status, 'added');
  assert.equal(firstBody.entry.name, '密钥 1');
  assert.equal(firstBody.entry.key, 'pst-AAAA');
  assert.ok(firstBody.entry.id);

  const second = await runRoute(db, 'POST', { name: '  备注  ', key: 'pst-BBBB' });
  const secondBody = await second.json();
  assert.equal(secondBody.entry.name, '备注');

  const list = await runRoute(db, 'GET');
  const entries = (await list.json()).entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[1].name, '备注');
});

test('路由 POST：重复密钥返回 400「已经在保管箱里」', async () => {
  const db = makeMemoryDb();
  await runRoute(db, 'POST', { name: '', key: 'pst-DUP' });
  const dup = await runRoute(db, 'POST', { name: '再来一次', key: '  pst-DUP  ' });
  assert.equal(dup.status, 400);
  assert.match((await dup.json()).error, /已经在保管箱/);
});

test('路由 PUT :id 改名并返回全量 entries', async () => {
  const db = makeMemoryDb();
  const added = await (await runRoute(db, 'POST', { name: '原名', key: 'pst-REN' })).json();
  const id = added.entry.id;
  const renamed = await runRoute(db, 'PUT', { name: '新备注' }, `/api/nai-key-vault/${id}`);
  assert.equal(renamed.status, 200);
  const body = await renamed.json();
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].name, '新备注');
  // 改名目标不存在 → 404。
  const missing = await runRoute(db, 'PUT', { name: 'x' }, '/api/nai-key-vault/no-such-id');
  assert.equal(missing.status, 404);
});

test('路由 DELETE 删除条目并返回剩余 entries', async () => {
  const db = makeMemoryDb();
  const a = await (await runRoute(db, 'POST', { name: 'A', key: 'pst-DEL-A' })).json();
  const b = await (await runRoute(db, 'POST', { name: 'B', key: 'pst-DEL-B' })).json();
  const removed = await runRoute(db, 'DELETE', undefined, `/api/nai-key-vault/${a.entry.id}`);
  assert.equal(removed.status, 200);
  const body = await removed.json();
  assert.deepEqual(body.entries.map(e => e.id), [b.entry.id]);
  // 删除不存在的条目 → 404。
  const missing = await runRoute(db, 'DELETE', undefined, '/api/nai-key-vault/ghost');
  assert.equal(missing.status, 404);
});

test('路由 PUT 整体替换：迁移写入 + 非 pst- 条目中止', async () => {
  const db = makeMemoryDb();
  const legacy = [
    { id: 'legacy-1', name: '旧密钥', key: 'pst-OLD', createdAt: 123 },
    { id: 'legacy-2', name: '', key: 'pst-OLD2', createdAt: 456 },
  ];
  const replaced = await runRoute(db, 'PUT', { entries: legacy });
  assert.equal(replaced.status, 200);
  const body = await replaced.json();
  assert.equal(body.entries.length, 2);
  assert.equal(body.entries[0].id, 'legacy-1');
  assert.equal(body.entries[0].name, '旧密钥');
  assert.equal(body.entries[0].key, 'pst-OLD');
  assert.equal(body.entries[1].name, '未命名密钥');

  // 带非法条目 → 400 且库内容保持迁移前状态。
  const poisoned = await runRoute(db, 'PUT', {
    entries: [...legacy, { id: 'x', name: '外部', key: 'sk-nope' }],
  });
  assert.equal(poisoned.status, 400);
  assert.match((await poisoned.json()).error, /pst-/);
  const list = await runRoute(db, 'GET');
  assert.equal((await list.json()).entries.length, 2);

  // 非数组整体替换 → 400。
  const badShape = await runRoute(db, 'PUT', { entries: 'not-an-array' });
  assert.equal(badShape.status, 400);
});

test('路由：非本域路径返回 null（交给下游 / 404）', async () => {
  const db = makeMemoryDb();
  const response = await runRoute(db, 'GET', undefined, '/api/other');
  assert.equal(response, null);
});

// ---- 前端 service 层：内存 localStorage / sessionStorage + stub fetch ----
const makeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    _map: map,
  };
};

const installBrowserGlobals = () => {
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  let dispatches = [];
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
  globalThis.window = {
    dispatchEvent: (event) => void dispatches.push(event),
  };
  const resetBrowser = () => {
    localStorage._map.clear();
    sessionStorage._map.clear();
    dispatches = [];
  };
  return { localStorage, sessionStorage, dispatches: () => dispatches, resetBrowser };
};

/** 单请求 stub：按 (method, path) 命中脚本化响应；prefix:true 的路由做前缀匹配（子路径）。 */
const makeFetchStub = (routes) => async (input, init = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  const url = typeof input === 'string' ? new URL(input, 'http://local.test') : new URL(input.url);
  const hit = routes.find(route => {
    if (route.method !== method) return false;
    if (route.prefix) return url.pathname.startsWith(route.path);
    return url.pathname === route.path;
  });
  if (!hit) return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
  if (hit.handler) return hit.handler(url, init);
  return new Response(JSON.stringify(hit.body), { status: hit.status || 200 });
};

const okJson = (body) => ({ status: 200, body });

test('service：服务端可达时 list/add/rename/remove 全链路', async () => {
  const g = installBrowserGlobals();
  const { naiKeyVault } = await loadModule('services/naiKeyVault.ts');
  try {
    let serverEntries = [];
    globalThis.fetch = makeFetchStub([
      {
        method: 'GET', path: '/api/nai-key-vault',
        handler: async () => new Response(JSON.stringify({ entries: serverEntries }), { status: 200 }),
      },
      {
        method: 'POST', path: '/api/nai-key-vault',
        handler: async (_u, init) => {
          const { name, key } = JSON.parse(init.body);
          const trimmed = String(key).trim();
          if (!trimmed) return new Response(JSON.stringify({ error: '密钥不能为空' }), { status: 400 });
          if (!trimmed.startsWith('pst-')) return new Response(JSON.stringify({ error: '这不像 NovelAI 密钥：官方密钥以 pst- 开头' }), { status: 400 });
          if (serverEntries.some(e => e.key === trimmed)) return new Response(JSON.stringify({ error: '这把密钥已经在保管箱里了' }), { status: 400 });
          const entry = { id: crypto.randomUUID(), name: String(name).trim().slice(0, 30) || `密钥 ${serverEntries.length + 1}`, key: trimmed, createdAt: Date.now() };
          serverEntries.push(entry);
          return new Response(JSON.stringify({ status: 'added', entry }), { status: 200 });
        },
      },
      {
        method: 'PUT', path: '/api/nai-key-vault',
        handler: async (_u, init) => {
          const { entries } = JSON.parse(init.body);
          serverEntries.length = 0;
          serverEntries.push(...entries);
          return new Response(JSON.stringify({ entries: serverEntries }), { status: 200 });
        },
      },
      {
        method: 'PUT', path: '/api/nai-key-vault/', prefix: true,
        handler: async (url, init) => {
          const id = decodeURIComponent(url.pathname.slice('/api/nai-key-vault/'.length));
          const { name } = JSON.parse(init.body);
          serverEntries = serverEntries.map(e => (e.id === id ? { ...e, name: String(name).trim().slice(0, 30) || e.name } : e));
          return new Response(JSON.stringify({ entries: serverEntries }), { status: 200 });
        },
      },
      {
        method: 'DELETE', path: '/api/nai-key-vault/', prefix: true,
        handler: async (url) => {
          const id = decodeURIComponent(url.pathname.slice('/api/nai-key-vault/'.length));
          serverEntries = serverEntries.filter(e => e.id !== id);
          return new Response(JSON.stringify({ entries: serverEntries }), { status: 200 });
        },
      },
    ]);

    assert.deepEqual(await naiKeyVault.list(), []);

    const added = await naiKeyVault.add('', 'pst-SVC-1');
    assert.equal(added.status, 'added');
    assert.equal(added.entry.name, '密钥 1');
    const added2 = await naiKeyVault.add('主力', 'pst-SVC-2');
    assert.equal(added2.status, 'added');
    assert.equal(added2.entry.name, '主力');
    assert.equal((await naiKeyVault.list()).length, 2);

    // 校验失败：服务端 400 映射回 status union。
    assert.equal((await naiKeyVault.add('', '')).status, 'empty');
    assert.equal((await naiKeyVault.add('', 'sk-bad')).status, 'invalid');
    assert.equal((await naiKeyVault.add('', 'pst-SVC-1')).status, 'duplicate');

    const renamed = await naiKeyVault.rename(added.entry.id, '新名字');
    assert.equal(renamed.length, 2);
    assert.equal(renamed.find(e => e.id === added.entry.id).name, '新名字');

    const rest = await naiKeyVault.remove(added.entry.id);
    assert.equal(rest.length, 1);
    assert.equal(rest[0].key, 'pst-SVC-2');
  } finally {
    g.resetBrowser();
    delete globalThis.fetch;
    delete globalThis.window;
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  }
});

test('service：首次 list() 把 localStorage 旧库一次性迁移到服务端后删除本地副本', async () => {
  const g = installBrowserGlobals();
  const legacy = [
    { id: 'old-1', name: '旧密钥', key: 'pst-LEGACY', createdAt: 1 },
  ];
  g.localStorage.setItem('nai_api_key_vault', JSON.stringify(legacy));
  const { naiKeyVault } = await loadModule('services/naiKeyVault.ts');
  try {
    let putCalls = 0;
    let serverState = null;
    globalThis.fetch = makeFetchStub([
      {
        method: 'GET', path: '/api/nai-key-vault',
        handler: async () => new Response(JSON.stringify({ entries: serverState ?? [] }), { status: 200 }),
      },
      {
        method: 'PUT', path: '/api/nai-key-vault',
        handler: async (_u, init) => {
          putCalls += 1;
          serverState = JSON.parse(init.body).entries;
          return new Response(JSON.stringify({ entries: serverState }), { status: 200 });
        },
      },
    ]);

    const entries = await naiKeyVault.list();
    // 迁移后的整箱直接由本次 list 返回（服务端镜像旧库）。
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, 'pst-LEGACY');
    assert.equal(g.localStorage.getItem('nai_api_key_vault'), null, '迁移成功后本地旧库应被删除');
    assert.equal(putCalls, 1);

    // 第二次 list：本地已空，不再触发迁移。
    await naiKeyVault.list();
    assert.equal(putCalls, 1, '迁移只应执行一次');
  } finally {
    g.resetBrowser();
    delete globalThis.fetch;
    delete globalThis.window;
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  }
});

test('service：迁移失败（服务端拒绝）不删除本地副本，下次 list 重试', async () => {
  const g = installBrowserGlobals();
  const legacy = [{ id: 'old-1', name: '旧密钥', key: 'sk-NOT-PST', createdAt: 1 }];
  g.localStorage.setItem('nai_api_key_vault', JSON.stringify(legacy));
  const { naiKeyVault } = await loadModule('services/naiKeyVault.ts');
  try {
    let putCount = 0;
    globalThis.fetch = makeFetchStub([
      {
        method: 'GET', path: '/api/nai-key-vault',
        handler: async () => new Response(JSON.stringify({ entries: [] }), { status: 200 }),
      },
      {
        method: 'PUT', path: '/api/nai-key-vault',
        handler: async () => {
          putCount += 1;
          return new Response(JSON.stringify({ error: '迁移数据包含非 NovelAI 密钥（应以 pst- 开头），已中止，本地数据未删除' }), { status: 400 });
        },
      },
    ]);

    const entries = await naiKeyVault.list();
    assert.equal(entries.length, 0, '迁移被拒时本次 list 返回服务端空库');
    assert.deepEqual(JSON.parse(g.localStorage.getItem('nai_api_key_vault')), legacy, '本地旧库必须原样保留');
    assert.equal(putCount, 1);
    // 本地仍然有残留 → 下次 list 再试一次迁移。
    await naiKeyVault.list();
    assert.equal(putCount, 2);
  } finally {
    g.resetBrowser();
    delete globalThis.fetch;
    delete globalThis.window;
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  }
});

test('service：服务端不可达时回退本地保管箱（网络异常）', async () => {
  const g = installBrowserGlobals();
  g.localStorage.setItem('nai_api_key_vault', JSON.stringify([]));
  const originalWarn = console.warn;
  console.warn = () => {};
  const { naiKeyVault } = await loadModule('services/naiKeyVault.ts');
  try {
    globalThis.fetch = async () => { throw new TypeError('fetch failed: connection refused'); };

    // list 回退：空库无 active → 空数组。
    assert.deepEqual(await naiKeyVault.list(), []);

    // add 回退：写入本地。
    const added = await naiKeyVault.add('降级密钥', 'pst-FALLBACK');
    assert.equal(added.status, 'added');
    assert.equal(added.entry.name, '降级密钥');
    assert.deepEqual(await naiKeyVault.list(), [added.entry]);
    assert.ok(g.localStorage.getItem('nai_api_key_vault')?.includes('pst-FALLBACK'));

    // rename / remove 回退：走本地库。
    const renamed = await naiKeyVault.rename(added.entry.id, '改名');
    assert.equal(renamed[0].name, '改名');
    const rest = await naiKeyVault.remove(added.entry.id);
    assert.deepEqual(rest, []);
    assert.equal(g.localStorage.getItem('nai_api_key_vault'), null);
  } finally {
    console.warn = originalWarn;
    g.resetBrowser();
    delete globalThis.fetch;
    delete globalThis.window;
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  }
});

test('service：activate/clearActive 仍同步管理 nai_api_key 槽位并广播', async () => {
  const g = installBrowserGlobals();
  const { naiKeyVault } = await loadModule('services/naiKeyVault.ts');
  try {
    const entry = { id: 'e1', name: '主力', key: 'pst-ACTIVE', createdAt: 1 };
    naiKeyVault.activate(entry, true);
    assert.equal(g.localStorage.getItem('nai_api_key'), 'pst-ACTIVE');
    assert.equal(g.sessionStorage.getItem('nai_api_key'), 'pst-ACTIVE');
    assert.ok(g.dispatches().some(e => e.type === 'nai-api-key-changed' && e.detail === 'pst-ACTIVE'));

    naiKeyVault.activate(entry, false);
    assert.equal(g.localStorage.getItem('nai_api_key'), null, '不记住时应清掉 localStorage 槽位');
    assert.equal(g.sessionStorage.getItem('nai_api_key'), 'pst-ACTIVE');

    naiKeyVault.clearActive();
    assert.equal(g.localStorage.getItem('nai_api_key'), null);
    assert.equal(g.sessionStorage.getItem('nai_api_key'), null);
    assert.ok(g.dispatches().some(e => e.type === 'nai-api-key-changed' && e.detail === ''));
  } finally {
    g.resetBrowser();
    delete globalThis.window;
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  }
});
