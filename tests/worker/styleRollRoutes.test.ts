import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { handleStyleRollRoute } from '../../worker/routes/styleRollRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../worker/routes/types';
import { candidateFixture, rollFixture } from '../fixtures/styleRoll';
import { beginRollRound } from '../../services/styleRollWorkflow';

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); });
const fixture = () => {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite); sqlite.exec(INIT_SQL);
  const db = { prepare(query: string) { let values: any[] = []; return { bind(...next: any[]) { values = next; return this; },
    async first() { return sqlite.prepare(query).get(...values) || null; }, async all() { return { results: sqlite.prepare(query).all(...values) }; },
    async run() { return { success: true, meta: sqlite.prepare(query).run(...values) }; } }; } } as unknown as D1Database;
  const invoke = (body?: unknown, id = 'owner', role = 'admin', method = body === undefined ? 'GET' : 'PUT', path = '/api/style-roll') => {
    const request = new Request('http://localhost' + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return handleStyleRollRoute({ path, method, request, db, currentUser: { id, role } } as RouteContext);
  };
  return { sqlite, invoke };
};

it('实验存在私人 settings，创建及更新回传版本号，其他工坊用户不可见', async () => {
  const f = fixture(), experiment = { ...rollFixture(), revision: 0 };
  const saved = await (await f.invoke(experiment))!.json() as any;
  expect(saved.experiment.revision).toBe(1);
  expect((await f.invoke({ ...saved.experiment, name: '改名' }))!.status).toBe(200);
  const list = await (await f.invoke())!.json() as any;
  expect(list.experiments[0].name).toBe('改名'); expect(list.experiments[0].revision).toBe(2);
  expect(await (await f.invoke(undefined, 'other'))!.json()).toEqual({ experiments: [] });
  expect(f.sqlite.prepare('SELECT count(*) AS n FROM settings').get()?.n).toBe(1);
});

it('旧版本写入和重复创建返回冲突，不覆盖已保存的记录或规则', async () => {
  const f = fixture(), experiment = { ...rollFixture(), revision: 0 };
  await f.invoke(experiment);
  expect((await f.invoke({ ...experiment, name: '旧页面' }))!.status).toBe(409);
  const list = await (await f.invoke())!.json() as any;
  expect(list.experiments[0].name).toBe(experiment.name);
});

it('已有候选配置和画师权重不可改写，归档可逆且不删除其他资料', async () => {
  const f = fixture(), experiment = { ...rollFixture(), revision: 0, candidates: [candidateFixture('one')] };
  const { experiment: saved } = await (await f.invoke(experiment))!.json() as any;
  expect((await f.invoke({ ...saved, template: { ...saved.template, prompt: '{style}, different' } }))!.status).toBe(400);
  expect((await f.invoke({ ...saved, candidates: [] }))!.status).toBe(400);
  expect((await f.invoke({ ...saved, candidates: [{ ...saved.candidates[0], tags: [{ tag: 'changed', weight: 1 }] }] }))!.status).toBe(400);
  expect((await f.invoke({ ...saved, candidates: [{ ...saved.candidates[0], archived: true }] }))!.status).toBe(200);
});

it('无效输入、访客、坏存档与未知方法均明确拒绝，不写空默认值', async () => {
  const f = fixture(), experiment = { ...rollFixture(), revision: 0 };
  expect((await f.invoke(experiment, 'owner', 'guest'))!.status).toBe(403);
  expect((await f.invoke(undefined, 'owner', 'guest'))!.status).toBe(403);
  expect((await f.invoke({ ...experiment, template: { ...experiment.template, params: { ...experiment.template.params, seed: -1 } } }))!.status).toBe(400);
  expect((await f.invoke(undefined, 'owner', 'admin', 'DELETE'))!.status).toBe(405);
  f.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('style_roll_v1:owner:broken', '{');
  expect((await f.invoke())!.status).toBe(500);
  expect(f.sqlite.prepare('SELECT value FROM settings').get()?.value).toBe('{');
});

it('普通轮次配方不可改写或删除，关闭后不能重新打开', async () => {
  const f = fixture(), e = { ...rollFixture(), revision: 0 };
  e.candidates = [candidateFixture('one'), candidateFixture('two')];
  e.rounds = [{ id: 'round', candidateIds: ['one'], createdAt: 1 }];
  const { experiment: saved } = await (await f.invoke(e))!.json() as any;
  expect((await f.invoke({ ...saved, rounds: [] }))!.status).toBe(400);
  expect((await f.invoke({ ...saved, rounds: [{ ...saved.rounds[0], candidateIds: ['two'] }] }))!.status).toBe(400);
  const { experiment: closed } = await (await f.invoke({ ...saved, rounds: [{ ...saved.rounds[0], closedAt: 2 }] }))!.json() as any;
  expect((await f.invoke({ ...closed, rounds: [{ ...closed.rounds[0], closedAt: undefined }] }))!.status).toBe(400);
  expect((await f.invoke({ ...closed, rounds: [{ ...closed.rounds[0], closedAt: 3 }] }))!.status).toBe(400);
});

it('普通出图批次沿用原私人存储，可保存偏好并完整回读', async () => {
  const f = fixture(), e = { ...rollFixture(), revision: 0, candidates: [candidateFixture('a')], rounds: [{ id: 'batch', candidateIds: ['a'], createdAt: 1 }] };
  const { experiment: saved } = await (await f.invoke(e))!.json() as any;
  expect((await f.invoke({ ...saved, candidates: [{ ...saved.candidates[0], savedChainId: 'kept-chain' }] }))!.status).toBe(200);
  const { experiments } = await (await f.invoke())!.json() as any; expect(experiments[0].candidates[0].savedChainId).toBe('kept-chain'); expect(experiments[0].rounds[0].candidateIds).toEqual(['a']);
});

it('当前记录可继续追加普通批次，原配方和轮次保留', async () => {
  const f = fixture(), e = { ...rollFixture(), revision: 0, candidates: [candidateFixture('a')] };
  e.rounds = [{ id: 'first', candidateIds: ['a'], createdAt: 1 }];
  const { experiment: saved } = await (await f.invoke(e))!.json() as any;
  const next = beginRollRound(saved, e.artists.map(artist => artist.tag), 4);
  expect((await f.invoke(next))!.status).toBe(200);
  const { experiments } = await (await f.invoke())!.json() as any, restored = experiments[0];
  expect(restored.candidates.slice(0, e.candidates.length)).toEqual(e.candidates);
  expect(restored.rounds.slice(0, e.rounds.length)).toEqual(e.rounds); expect(restored.rounds.at(-1).candidateIds).toHaveLength(4);
});

it('整条记录可移入和恢复回收站，候选、轮次和原存储键完整保留，坏标记拒绝写入', async () => {  const f = fixture(), e = { ...rollFixture(), revision: 0, candidates: [candidateFixture('a')] };
  const { experiment: saved } = await (await f.invoke(e))!.json() as any;
  const { experiment: archived } = await (await f.invoke({ ...saved, archived: true }))!.json() as any;
  expect(archived.archived).toBe(true); expect(archived.candidates).toEqual(e.candidates);
  expect((await f.invoke({ ...archived, archived: 'true' }))!.status).toBe(400);
  const { experiment: restored } = await (await f.invoke({ ...archived, archived: false }))!.json() as any;
  expect(restored.archived).toBe(false); expect(restored.candidates).toEqual(e.candidates);
  expect(f.sqlite.prepare('SELECT count(*) AS n FROM settings').get()?.n).toBe(1);
});

it('全局屏蔽名单独立保存，按用户隔离且坏数据拒绝', async () => {
  const f = fixture();
  expect((await f.invoke({ tags: ['deg', 'zill'] }, 'owner', 'admin', 'PUT', '/api/style-roll/blocklist'))!.status).toBe(200);
  expect(await (await f.invoke(undefined, 'owner', 'admin', 'GET', '/api/style-roll/blocklist'))!.json()).toEqual({ tags: ['deg', 'zill'] });
  expect(await (await f.invoke(undefined, 'other', 'admin', 'GET', '/api/style-roll/blocklist'))!.json()).toEqual({ tags: [] });
  expect((await f.invoke({ tags: ['bad,tag'] }, 'owner', 'admin', 'PUT', '/api/style-roll/blocklist'))!.status).toBe(400);
  expect((await f.invoke({ tags: ['deg'] }, 'owner', 'admin', 'PUT', '/api/style-roll/blocklist'))!.status).toBe(200);
  expect(await (await f.invoke(undefined, 'owner', 'admin', 'GET', '/api/style-roll/blocklist'))!.json()).toEqual({ tags: ['deg'] });
  expect((await f.invoke(undefined, 'owner', 'guest', 'GET', '/api/style-roll/blocklist'))!.status).toBe(403);
});

it('轮次快照随轮次一起不可改写', async () => {
  const f = fixture(), e = { ...rollFixture(), revision: 0 };
  e.candidates = [candidateFixture('one')];
  e.rounds = [{ id: 'round', candidateIds: ['one'], createdAt: 1, snapshot: { rules: e.rules, mode: 'random' } }];
  const { experiment: saved } = await (await f.invoke(e))!.json() as any;
  expect((await f.invoke({ ...saved, rounds: [{ ...saved.rounds[0], snapshot: { ...saved.rounds[0].snapshot, rules: { ...saved.rounds[0].snapshot.rules, minArtists: 5 } } }] }))!.status).toBe(400);
});
