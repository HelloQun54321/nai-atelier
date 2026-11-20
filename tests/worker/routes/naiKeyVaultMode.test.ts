import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { handleNaiKeyVaultRoute } from '../../../worker/routes/naiKeyVaultRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../../worker/routes/types';

let sqlite: DatabaseSync;
let db: D1Database;

const invoke = async (method: string, path: string, body?: unknown) => {
  const request = new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  });
  return (await handleNaiKeyVaultRoute({
    request, url: new URL(request.url), path, method, db,
    env: { DB: db }, currentUser: { id: 'owner', role: 'admin' },
  } as RouteContext))!;
};

const entries = async () => (await (await invoke('GET', '/api/nai-key-vault')).json() as { entries: { key: string; gatewayUrl?: string; billingMode?: string }[] }).entries;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:'); sqlite.exec(INIT_SQL);
  db = {
    prepare(sql: string) {
      let values: any[] = [];
      return {
        bind(...next: any[]) { values = next; return this; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        execute() { return { success: true, results: [], meta: sqlite.prepare(sql).run(...values) }; },
        async run() { return this.execute(); },
      };
    },
    async batch(statements: { execute: () => unknown }[]) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
});
afterEach(() => sqlite.close());

it('按次渠道随 Key 保存生成地址与计费方式，读取时原样返回', async () => {
  const response = await invoke('POST', '/api/nai-key-vault', {
    name: '按次中转', key: 'STA1N-per-use', gatewayUrl: 'https://std.loliyc.com/novelai/ai/generate-image', billingMode: 'per-use',
  });
  expect(response.status).toBe(200);
  const saved = (await response.json() as { entry: { gatewayUrl: string; billingMode: string } }).entry;
  expect(saved.gatewayUrl).toBe('https://std.loliyc.com/novelai');
  expect(saved.billingMode).toBe('per-use');
  const stored = await entries();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ key: 'STA1N-per-use', gatewayUrl: 'https://std.loliyc.com/novelai', billingMode: 'per-use' });
});

it('按次渠道缺少生成地址时拒绝保存，普通网关不写入计费方式', async () => {
  const missing = await invoke('POST', '/api/nai-key-vault', { key: 'STA1N-no-url', billingMode: 'per-use' });
  expect(missing.status).toBe(400);
  expect((await missing.json() as { error: string }).error).toContain('按次渠道需要填写生成地址');
  expect(await entries()).toHaveLength(0);
  const gateway = await invoke('POST', '/api/nai-key-vault', { key: 'STA1N-gateway', gatewayUrl: 'https://gateway.example/v1' });
  expect(gateway.status).toBe(200);
  expect(await entries()).toMatchObject([{ key: 'STA1N-gateway', gatewayUrl: 'https://gateway.example/v1' }]);
  expect((await entries())[0].billingMode).toBeUndefined();
});

it('Key 池配置持久化到 settings，自动过滤按次渠道与无效 ID，删除密钥时同步清理', async () => {
  const k1 = ((await (await invoke('POST', '/api/nai-key-vault', { name: '主号', key: 'pst-pool-1' })).json()) as { entry: { id: string } }).entry.id;
  const k2 = ((await (await invoke('POST', '/api/nai-key-vault', { name: '车位2', key: 'STA1N-pool-2', gatewayUrl: 'https://g.example/v1' })).json()) as { entry: { id: string } }).entry.id;
  const perUse = ((await (await invoke('POST', '/api/nai-key-vault', { name: '按次', key: 'sk-pay', gatewayUrl: 'https://pay.example', billingMode: 'per-use' })).json()) as { entry: { id: string } }).entry.id;

  const initial = await (await invoke('GET', '/api/nai-key-vault/pool')).json() as { pool: { enabled: boolean; memberIds: string[] } };
  expect(initial.pool).toEqual({ enabled: false, memberIds: [] });

  const saved = await (await invoke('PUT', '/api/nai-key-vault/pool', { enabled: true, memberIds: [k1, k2, perUse, 'ghost-id', k1] })).json() as { pool: { enabled: boolean; memberIds: string[] } };
  expect(saved.pool).toEqual({ enabled: true, memberIds: [k1, k2] });

  // 删除池中某把密钥后自动移出池子；只剩 1 把仍保持有效，全删完自动关闭。
  await invoke('DELETE', `/api/nai-key-vault/${k1}`);
  const afterOne = await (await invoke('GET', '/api/nai-key-vault/pool')).json() as { pool: { enabled: boolean; memberIds: string[] } };
  expect(afterOne.pool).toEqual({ enabled: true, memberIds: [k2] });

  await invoke('DELETE', `/api/nai-key-vault/${k2}`);
  const afterAll = await (await invoke('GET', '/api/nai-key-vault/pool')).json() as { pool: { enabled: boolean; memberIds: string[] } };
  expect(afterAll.pool).toEqual({ enabled: false, memberIds: [] });
});
