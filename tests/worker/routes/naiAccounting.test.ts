import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { handleSettingsRoute } from '../../../worker/routes/settingsRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../../worker/routes/types';

let sqlite: DatabaseSync;
let db: D1Database;
const hash = 'a'.repeat(64), other = 'b'.repeat(64);
const input = (patch = {}) => ({ receiptId: crypto.randomUUID(), keyHash: hash, action: 'generation', model: 'synthetic-v5', images: 1, cost: 2, opusImages: 0, ...patch });
const invoke = async (body: unknown) => {
  const request = new Request('http://localhost/api/nai-accounting', { method: 'POST', body: JSON.stringify(body) });
  return (await handleSettingsRoute({ request, url: new URL(request.url), path: '/api/nai-accounting', method: 'POST', db,
    env: { DB: db }, currentUser: { id: 'owner', role: 'admin' } } as RouteContext))!;
};
const personal = () => JSON.parse(String(sqlite.prepare("SELECT value FROM settings WHERE key = 'anlas_personal_usage_v1'").get()?.value || '{}'));
const budget = (key = hash) => Number(sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(`anlas_budget_remaining_v2:${key}`)?.value);

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:'); sqlite.exec(INIT_SQL);
  db = { prepare(sql: string) {
    let values: any[] = [];
    return { bind(...next: any[]) { values = next; return this; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      execute() { return { success: true, results: [], meta: sqlite.prepare(sql).run(...values) }; },
      async run() { return this.execute(); },
    };
  }, async batch(statements: { execute: () => unknown }[]) {
    sqlite.exec('BEGIN');
    try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(`anlas_budget_remaining_v2:${hash}`, '100');
});
afterEach(() => sqlite.close());

it('回执丢失后重复或并发重交只结算一次，冲突凭据明确拒绝', async () => {
  const receipt = input();
  expect((await invoke(receipt)).status).toBe(200);
  const repeated = await invoke(receipt);
  expect(repeated.status).toBe(200); expect((await repeated.json()).receiptId).toBe(receipt.receiptId);
  expect(budget()).toBe(98); expect(personal()[hash].anlasSpent).toBe(2);
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM local_usage_events').get()?.n).toBe(1);
  const next = input({ cost: 3 });
  // D1 的 batch 本身串行；让两个调用同时完成事务前准备，再验证同一凭据只增一次。
  expect((await Promise.all([invoke(next), invoke(next)])).map(r => r.status)).toEqual([200, 200]);
  expect(budget()).toBe(95); expect(personal()[hash].anlasSpent).toBe(5);
  expect((await invoke({ ...next, cost: 4 })).status).toBe(409);
  expect(budget()).toBe(95);
});

it('事务中用量写入失败时，预算、个人统计和凭据一起回滚；修复后同凭据可补交', async () => {
  sqlite.exec("CREATE TRIGGER reject_usage BEFORE INSERT ON local_usage_events BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  const receipt = input();
  await expect(invoke(receipt)).rejects.toThrow('synthetic failure');
  expect(budget()).toBe(100); expect(personal()).toEqual({});
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM local_usage_events').get()?.n).toBe(0);
  sqlite.exec('DROP TRIGGER reject_usage');
  expect((await invoke(receipt)).status).toBe(200); expect(budget()).toBe(98);
});

it('不同 Key 保留已有统计，零点数 Opus、付费编码与未知费用使用同一事务语义', async () => {
  sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('anlas_personal_usage_v1', JSON.stringify({ [other]: { anlasSpent: 7, opusImages: 4 } }));
  expect((await invoke(input({ cost: 0, opusImages: 1 }))).status).toBe(200);
  expect(budget()).toBe(100); expect(personal()[hash]).toMatchObject({ anlasSpent: 0, opusImages: 1 });
  expect((await invoke(input({ keyHash: other, action: 'encoding', images: 0 }))).status).toBe(200);
  expect(personal()[other]).toMatchObject({ anlasSpent: 9, opusImages: 4 });
  expect(personal()[hash].opusImages).toBe(1);
  expect((await invoke(input({ cost: undefined, opusImages: undefined }))).status).toBe(200);
  expect(budget()).toBe(100); expect(personal()[hash].opusImages).toBe(1);
  expect(sqlite.prepare('SELECT value FROM local_usage_events WHERE value IS NULL').all()).toHaveLength(1);
});

it.each([null, [], { [hash]: 3 }])('旧个人统计形状为 %s 时只修正本次目标，仍可原子累加', async stored => {
  sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('anlas_personal_usage_v1', JSON.stringify(stored));
  expect((await invoke(input())).status).toBe(200);
  expect(personal()[hash]).toMatchObject({ anlasSpent: 2, opusImages: 0 }); expect(budget()).toBe(98);
});

it.each([{ receiptId: '-'.repeat(36) }, { keyHash: 'bad' }, { cost: -1 }, { cost: null }, { images: 0 }, { opusImages: 2 }, { cost: undefined, opusImages: 1 }])('拒绝无效结算 %s，不新增用量或扣预算', async patch => {
  expect((await invoke(input(patch))).status).toBe(400); expect(budget()).toBe(100);
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM local_usage_events').get()?.n).toBe(0);
});
