import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { handleStyleRollRoute } from '../../worker/routes/styleRollRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../worker/routes/types';
import { candidateFixture, rollFixture } from '../fixtures/styleRoll';
import { beginRollRound } from '../../services/styleRollWorkflow';
import { ROLL_MAX_ARTISTS, type RollPreset } from '../../services/styleRoll';

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); });
const fixture = () => {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite); sqlite.exec(INIT_SQL);
  const db = { prepare(query: string) { let values: any[] = []; return { bind(...next: any[]) { values = next; return this; },
    async first() { return sqlite.prepare(query).get(...values) || null; }, async all() { return { results: sqlite.prepare(query).all(...values) }; },
    async run() { return { success: true, meta: sqlite.prepare(query).run(...values) }; } }; } } as unknown as D1Database;
  const invoke = (body?: unknown, id = 'owner', role = 'admin', method = body === undefined ? 'GET' : 'PUT', path = '/api/style-roll') => {
    const request = new Request('http://localhost' + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return handleStyleRollRoute({ path: new URL(request.url).pathname, method, request, db, currentUser: { id, role } } as RouteContext);
  };
  return { sqlite, invoke };
};

const presetFixture = (id = 'one'): RollPreset => ({ id, name: `质量词 ${id}`, template: { ...rollFixture().template, characterPrompt: '独立角色提示词',
  params: { ...rollFixture().template.params, qualityToggle: true, ucPreset: 2, cfgRescale: 0.25, characters: [{ id: 'role', prompt: 'person', negativePrompt: 'sad', x: 0.2, y: 0.7 }] } }, revision: 0, createdAt: 1, updatedAt: 1 });
const presetPath = '/api/style-roll/presets';

it('超过单图人数的提取来源完整保存，清除当前来源不改历史轮次且空来源不回落', async () => {
  const f = fixture(), e = { ...rollFixture(), revision: 0 };
  e.pinnedArtists = ['alpha'];
  e.chainArtistSource = { chainIds: ['source-a', 'source-b'], artists: Array.from({ length: 70 }, (_, index) => ({ tag: `source artist ${index}`, count: index ? 1 : 2 })) };
  const first = await f.invoke(e); expect(first!.status).toBe(200);
  const { experiment: saved } = await first!.json() as any;
  const next = beginRollRound(saved, ['outside'], 2);
  expect(next.candidates.every(candidate => candidate.tags.length === 4 && candidate.tags.some(artist => artist.tag === 'alpha') && candidate.tags.every(artist => artist.tag === 'alpha' || artist.tag.startsWith('source artist ')))).toBe(true);
  const second = await f.invoke(next); expect(second!.status).toBe(200);
  const { experiment: withRound } = await second!.json() as any;
  expect(withRound.chainArtistSource).toEqual(e.chainArtistSource);
  expect(withRound.rounds[0].snapshot.chainArtistSource).toEqual(e.chainArtistSource);
  const changed = structuredClone(withRound); changed.rounds[0].snapshot.chainArtistSource.artists[0].count = 1;
  expect((await f.invoke(changed))!.status).toBe(400);
  const { experiment: cleared } = await (await f.invoke({ ...withRound, chainArtistSource: undefined }))!.json() as any;
  expect(cleared.chainArtistSource).toBeUndefined();
  expect(cleared.rounds[0].snapshot.chainArtistSource).toEqual(e.chainArtistSource);
  expect((await f.invoke({ ...cleared, chainArtistSource: { chainIds: [], artists: [] } }))!.status).toBe(200);
  const { experiments: [restored] } = await (await f.invoke())!.json() as any;
  expect(restored.chainArtistSource).toEqual({ chainIds: [], artists: [] });
  expect(() => beginRollRound(restored, e.artists.map(artist => artist.tag), 1)).toThrow('可用画师不足');
});

it.each([0, 1.5, 3])('来源次数必须是独立所选串数量内的正整数，坏次数=%s不写库', async count => {
  const f = fixture();
  const response = await f.invoke({ ...rollFixture(), revision: 0, chainArtistSource: { chainIds: ['source-a', 'source-b'], artists: [{ tag: 'alpha', count }] } });
  expect(response!.status).toBe(400);
  expect(f.sqlite.prepare('SELECT count(*) AS n FROM settings').get()?.n).toBe(0);
});

it('多套预设完整回读与独立更新删除，不携带抽取规则或影响记录和其他用户', async () => {
  const f = fixture(), first = presetFixture(), second = presetFixture('two');
  const invoke = (body?: unknown, owner = 'owner', method = body === undefined ? 'GET' : 'PUT', path = presetPath) => f.invoke(body, owner, 'admin', method, path);
  const saved = (await (await invoke({ ...first, rules: rollFixture().rules, candidates: [] }))!.json() as any).preset as RollPreset;
  await invoke(second);
  await f.invoke({ ...rollFixture(), revision: 0 });
  expect(saved.revision).toBe(1);
  expect(saved.template).toEqual(first.template);
  expect(saved).not.toHaveProperty('rules'); expect(saved).not.toHaveProperty('candidates');
  const updated = (await (await invoke({ ...saved, name: '更新', template: { ...saved.template, negativePrompt: 'new negative' } }))!.json() as any).preset as RollPreset;
  const presets = (await (await invoke())!.json() as any).presets as RollPreset[];
  expect(presets).toHaveLength(2);
  expect(presets.find(preset => preset.id === 'two')!.template).toEqual(second.template);
  expect(updated.revision).toBe(2); expect(updated.createdAt).toBe(first.createdAt);
  expect(await (await invoke(undefined, 'other'))!.json()).toEqual({ presets: [] });
  expect((await invoke(undefined, 'other', 'DELETE', `${presetPath}/one?revision=2`))!.status).toBe(404);
  expect(await (await invoke(undefined, 'owner', 'DELETE', `${presetPath}/one?revision=2`))!.json()).toEqual({ deleted: 'one' });
  expect((await (await invoke())!.json() as any).presets.map((preset: RollPreset) => preset.id)).toEqual(['two']);
  expect((await (await f.invoke())!.json() as any).experiments).toHaveLength(1);
});

it('预设旧版本覆盖或删除均冲突，CAS阻止同时更新静默覆盖', async () => {
  const f = fixture(), preset = presetFixture();
  const invoke = (body?: unknown, method = body === undefined ? 'GET' : 'PUT', path = presetPath) => f.invoke(body, 'owner', 'admin', method, path);
  const saved = (await (await invoke(preset))!.json() as any).preset as RollPreset;
  expect((await invoke(preset))!.status).toBe(409);
  expect((await invoke(undefined, 'DELETE', `${presetPath}/one?revision=0`))!.status).toBe(409);
  const results = await Promise.all([invoke({ ...saved, name: '同时更新一' }), invoke({ ...saved, name: '同时更新二' })]);
  expect(results.map(result => result!.status).sort()).toEqual([200, 409]);
  expect((await invoke(undefined, 'DELETE', `${presetPath}/one?revision=1`))!.status).toBe(409);
  expect((await (await invoke())!.json() as any).presets).toHaveLength(1);
});

it('预设无效模板、访客、坏存档和缺少删除版本均拒绝且不破坏资料', async () => {
  const f = fixture(), preset = presetFixture();
  expect((await f.invoke(preset, 'owner', 'guest', 'PUT', presetPath))!.status).toBe(403);
  expect((await f.invoke(undefined, 'owner', 'guest', 'GET', presetPath))!.status).toBe(403);
  expect((await f.invoke(undefined, 'owner', 'guest', 'DELETE', `${presetPath}/one?revision=1`))!.status).toBe(403);
  expect((await f.invoke({ ...preset, template: { ...preset.template, prompt: 'missing style' } }, 'owner', 'admin', 'PUT', presetPath))!.status).toBe(400);
  expect((await f.invoke(undefined, 'owner', 'admin', 'DELETE', `${presetPath}/one`))!.status).toBe(400);
  f.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('style_roll_preset_v1:owner:one', '{');
  expect((await f.invoke(undefined, 'owner', 'admin', 'GET', presetPath))!.status).toBe(500);
  expect((await f.invoke(preset, 'owner', 'admin', 'PUT', presetPath))!.status).toBe(500);
  expect((await f.invoke(undefined, 'owner', 'admin', 'DELETE', `${presetPath}/one?revision=1`))!.status).toBe(500);
  expect(f.sqlite.prepare('SELECT value FROM settings').get()?.value).toBe('{');
});

it('人数范围与偏好条件持久保存，无效保底和倍率被拒绝', async () => {
  const f = fixture(), experiment = { ...rollFixture(), revision: 0 };
  experiment.rules = { ...experiment.rules, minArtists: 4, maxArtists: 6, preferredMultiplier: 2.5, preferredMinArtists: 2, preferredOnly: true };
  const candidate = candidateFixture('strict');
  experiment.candidates = [candidate];
  experiment.rounds = [{ id: 'strict-round', candidateIds: [candidate.id], createdAt: 1, snapshot: { rules: { ...experiment.rules }, pinnedArtists: [] } }];
  const saved = await (await f.invoke(experiment))!.json() as any;
  expect(saved.experiment.rules).toEqual(experiment.rules);
  expect(saved.experiment.rounds[0].snapshot.rules.preferredOnly).toBe(true);
  const { experiments: [restored] } = await (await f.invoke())!.json() as any;
  expect(restored.rules.preferredOnly).toBe(true);
  expect(restored.rounds[0].snapshot.rules.preferredOnly).toBe(true);
  expect((await f.invoke({ ...restored, rules: { ...restored.rules, preferredOnly: 'true' } }))!.status).toBe(400);
  expect((await f.invoke({ ...saved.experiment, rules: { ...experiment.rules, preferredMinArtists: ROLL_MAX_ARTISTS + 1 } }))!.status).toBe(400);
  expect((await f.invoke({ ...saved.experiment, rules: { ...experiment.rules, preferredMultiplier: 0 } }))!.status).toBe(400);
});

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

it('旧模式记录可追加统一 Roll，历史快照及原配方不变，新固定项按总人数校验', async () => {
  const f = fixture(), e = { ...rollFixture(), revision: 0 };
  e.drawPlan = { mode: 'pinnedArtists', pinnedArtists: ['alpha', 'beta'] };
  e.artists[0].locked = true; e.artists[0].weight = 3;
  e.candidates = [candidateFixture('old')];
  e.rounds = [{ id: 'old-round', candidateIds: ['old'], createdAt: 1, snapshot: { rules: e.rules, mode: 'pinnedArtists', pinnedArtists: ['alpha', 'beta'] } }];
  const { experiment: saved } = await (await f.invoke(e))!.json() as any;
  const next = beginRollRound(saved, e.artists.map(artist => artist.tag), 3);
  expect((await f.invoke(next))!.status).toBe(200);
  const { experiments: [restored] } = await (await f.invoke())!.json() as any;
  expect(restored.rounds[0]).toEqual(e.rounds[0]); expect(restored.candidates[0]).toEqual(e.candidates[0]);
  expect(restored.pinnedArtists).toEqual(['alpha', 'beta']); expect(restored.drawPlan).toBeUndefined();
  expect(restored.candidates.slice(1).every((candidate: any) => candidate.tags.length === 4 && candidate.tags[0].weight <= 1.4)).toBe(true);
  expect((await f.invoke({ ...restored, pinnedArtists: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'] }))!.status).toBe(400);
  expect((await f.invoke({ ...restored, pinnedArtists: ['alpha', 'ALPHA'] }))!.status).toBe(400);
});
