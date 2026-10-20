import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { handleHistoryRoute } from '../../worker/routes/historyRoutes';
import { INIT_SQL, type D1Database, type Env, type RouteContext } from '../../worker/routes/types';
import { candidateFixture, rollFixture } from '../fixtures/styleRoll';

const sqlite = new DatabaseSync(':memory:');
let readBytes = 0;
const db = { prepare(query: string) {
  let values: any[] = [];
  return {
    bind(...next: any[]) { values = next; return this; },
    async first() { return sqlite.prepare(query).get(...values) || null; },
    async all() { const results = sqlite.prepare(query).all(...values); readBytes += JSON.stringify(results).length; return { results }; },
    async run() { return { success: true, meta: sqlite.prepare(query).run(...values) }; },
  };
}, async batch(statements: { run: () => Promise<unknown> }[]) { return Promise.all(statements.map(statement => statement.run())); } } as unknown as D1Database;
const env = { DB: db, LOCAL_HISTORY_ENABLED: 'true', BUCKET: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } } as unknown as Env;
const TO = Date.UTC(2026, 9, 17, 12, 0, 0);
const DAY = 86400000;
const params = (model: string, steps: number, operation?: string) => JSON.stringify({
  model, width: 832, height: 1216, steps, scale: 5,
  ...(operation ? { _local_edit: { operation } } : {}),
});
const invoke = async (path: string, method = 'GET', body?: unknown) => {
  const request = new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const url = new URL(request.url);
  const context = { request, url, path: url.pathname, method, db, env, currentUser: { id: 'owner', username: 'owner', role: 'admin' } } as RouteContext;
  return (await handleHistoryRoute(context))!;
};
const insert = (id: string, userId: string, createdAt: number, prompt: string, options: { chain?: string; name?: string; favorite?: number; params?: string } = {}) => {
  sqlite.prepare(`INSERT INTO local_generation_history
    (id, user_id, image_key, prompt, negative_prompt, params, source_chain_id, source_chain_name, created_at, is_favorite)
    VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?)`)
    .run(id, userId, `local-history/${userId}/${id}.png`, prompt, options.params || params('nai-diffusion-4-5-full', 28), options.chain || 'chain-a', options.name || '厚涂冷色', createdAt, options.favorite || 0);
};

beforeAll(async () => { sqlite.exec(INIT_SQL); await invoke('/api/local-history/stats?days=30&to=' + TO); });
beforeEach(() => { sqlite.exec('DELETE FROM local_generation_history; DELETE FROM local_usage_events; DELETE FROM settings; DELETE FROM vibe_encodings; DELETE FROM vibe_assets; DELETE FROM vibe_groups'); readBytes = 0; });
afterAll(() => sqlite.close());

it('聚合本地历史的活动、风格串、画师与参数，并按用户隔离', async () => {
  insert('one', 'owner', TO, 'solo, artist:alpha_artist, artist:beta_artist', { favorite: 1 });
  insert('two', 'owner', TO - DAY, 'solo, artist:alpha_artist');
  insert('three', 'owner', TO - 3 * DAY, 'solo, artist:beta_artist', {
    chain: 'chain-b', name: '雨夜霓虹', params: params('nai-diffusion-5-full', 40, 'inpaint'),
  });
  insert('other', 'other', TO, 'solo, artist:alpha_artist');

  const response = await invoke(`/api/local-history/stats?days=30&tzOffset=480&to=${TO}`);
  const payload = await response.json();
  expect(payload.totals).toMatchObject({ images: 3, activeDays: 3, favoriteImages: 1, currentStreak: 2 });
  expect(payload.daily).toEqual([
    { date: '2026-10-14', images: 1 },
    { date: '2026-10-16', images: 1 },
    { date: '2026-10-17', images: 1 },
  ]);
  expect(payload.chains).toEqual([
    { id: 'chain-a', name: '厚涂冷色', images: 2, lastAt: TO },
    { id: 'chain-b', name: '雨夜霓虹', images: 1, lastAt: TO - 3 * DAY },
  ]);
  expect(payload.uniqueChains).toBe(2);
  expect(payload.artists).toEqual([
    { name: 'alpha_artist', images: 2, lastAt: TO },
    { name: 'beta_artist', images: 2, lastAt: TO },
  ]);
  expect(payload.uniqueArtists).toBe(2);
  expect(payload.artistScan).toEqual({ scanned: 3, truncated: false });
  expect(payload.models).toEqual([
    { model: 'nai-diffusion-4-5-full', images: 2 },
    { model: 'nai-diffusion-5-full', images: 1 },
  ]);
  expect(payload.sizes).toEqual([{ width: 832, height: 1216, images: 3 }]);
  expect(payload.steps).toEqual([
    { steps: 28, images: 2 },
    { steps: 40, images: 1 },
  ]);
  expect(payload.operations).toEqual([
    { operation: 'text-to-image', images: 2 },
    { operation: 'inpaint', images: 1 },
  ]);
});

it('时间范围之外的作品不进入当前统计', async () => {
  insert('recent', 'owner', TO, 'artist:alpha_artist');
  insert('old', 'owner', TO - 40 * DAY, 'artist:beta_artist');
  const payload = await (await invoke(`/api/local-history/stats?days=30&tzOffset=480&to=${TO}`)).json();
  expect(payload.totals.images).toBe(1);
  expect(payload.artists.map((row: { name: string }) => row.name)).toEqual(['alpha_artist']);
});

it('画师样张补全等辅助生成不进入创作足迹', async () => {
  insert('creative', 'owner', TO, 'artist:alpha_artist', { chain: 'chain-a', name: '厚涂冷色' });
  insert('sample', 'owner', TO - DAY, 'solo, artist:gamma_artist', { chain: 'artist-sample:v45:gamma_artist', name: 'gamma_artist' });
  const payload = await (await invoke(`/api/local-history/stats?days=30&tzOffset=480&to=${TO}`)).json();
  expect(payload.totals.images).toBe(1);
  expect(payload.daily).toEqual([{ date: '2026-10-17', images: 1 }]);
  expect(payload.chains.map((row: { id: string }) => row.id)).toEqual(['chain-a']);
  expect(payload.artists.map((row: { name: string }) => row.name)).toEqual(['alpha_artist']);
  expect(payload.uniqueChains).toBe(1);
  expect(payload.uniqueArtists).toBe(1);
  expect(payload.artistScan.scanned).toBe(1);
});

it('自由实验室与导入文件名不进入风格串排行', async () => {
  insert('free', 'owner', TO, 'artist:alpha_artist', { chain: 'playground', name: '生图实验室' });
  insert('file', 'owner', TO, 'artist:beta_artist', { chain: 'uuid-chain', name: '4a6caa72-6be4-4509-a2f7-9b285aa7c19f.png' });
  insert('real', 'owner', TO, 'artist:gamma_artist', { chain: 'chain-a', name: '厚涂冷色' });
  const payload = await (await invoke(`/api/local-history/stats?days=30&tzOffset=480&to=${TO}`)).json();
  expect(payload.totals.images).toBe(3);
  expect(payload.chains.map((row: { id: string }) => row.id)).toEqual(['chain-a']);
  expect(payload.uniqueChains).toBe(1);
  expect(payload.artists.map((row: { name: string }) => row.name).sort()).toEqual(['alpha_artist', 'beta_artist', 'gamma_artist']);
});

it('失败与取消事件写入轻量账本并按范围聚合', async () => {
  const saved = await invoke('/api/local-usage/events', 'POST', { events: [
    { category: 'generation', action: 'failed', amount: 2, meta: { model: 'nai-diffusion-4-5-full' } },
    { category: 'generation', action: 'cancelled', amount: 1 },
  ] });
  expect(saved.status).toBe(200);
  const payload = await (await invoke('/api/local-usage/stats?days=30&tzOffset=480')).json();
  expect(payload.totals).toEqual([
    { category: 'generation', action: 'cancelled', count: 1, amount: 1, value: 0 },
    { category: 'generation', action: 'failed', count: 1, amount: 2, value: 0 },
  ]);
  expect(payload.daily).toHaveLength(2);
});

it('结构化角色从 params.characters 派生，缺少角色库来源时也能排行', async () => {
  insert('character', 'owner', TO, 'solo, artist:alpha_artist', {
    chain: 'chain-a', name: '厚涂冷色',
    params: JSON.stringify({ model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, characters: [{ id: 'c1', prompt: 'girl, red hair' }] }),
  });
  const payload = await (await invoke(`/api/local-history/stats?days=30&tzOffset=480&to=${TO}`)).json();
  expect(payload.characters).toEqual([{ id: 'girl, red hair', name: 'girl, red hair', images: 1, lastAt: TO }]);
  expect(payload.uniqueCharacters).toBe(1);
  expect(payload.characterUsage).toEqual({ images: 1, slots: 1 });
});

it('按月范围只统计所选月份', async () => {
  insert('october', 'owner', TO, 'artist:alpha_artist');
  insert('september', 'owner', Date.UTC(2026, 8, 30, 12), 'artist:beta_artist');
  const payload = await (await invoke(`/api/local-history/stats?days=month&month=2026-10&tzOffset=480&to=${TO + 86400000}`)).json();
  expect(payload.totals.images).toBe(1);
  expect(payload.artists.map((row: { name: string }) => row.name)).toEqual(['alpha_artist']);
});

it('年份筛选只统计所选年份', async () => {
  insert('this-year', 'owner', TO, 'artist:alpha_artist');
  insert('last-year', 'owner', Date.UTC(2025, 11, 30, 12), 'artist:beta_artist');
  const payload = await (await invoke(`/api/local-history/stats?days=all&year=2026&tzOffset=480&to=${TO}`)).json();
  expect(payload.totals.images).toBe(1);
  expect(payload.artists.map((row: { name: string }) => row.name)).toEqual(['alpha_artist']);
});

it('显式 from/to 优先于 days，用于周视图', async () => {
  insert('in-week', 'owner', TO, 'artist:alpha_artist');
  insert('before-week', 'owner', TO - 8 * 86400000, 'artist:beta_artist');
  const from = TO - 6 * 86400000;
  const to = TO + 3600000;
  const payload = await (await invoke(`/api/local-history/stats?days=7&from=${from}&to=${to}&tzOffset=480`)).json();
  expect(payload.totals.images).toBe(1);
  expect(payload.artists.map((row: { name: string }) => row.name)).toEqual(['alpha_artist']);
});

it('没有历史时返回空聚合而不是错误', async () => {
  const payload = await (await invoke(`/api/local-history/stats?days=7&tzOffset=480&to=${TO}`)).json();
  expect(payload.totals).toMatchObject({ images: 0, activeDays: 0, currentStreak: 0 });
  expect(payload.daily).toEqual([]); expect(payload.chains).toEqual([]); expect(payload.artists).toEqual([]);
  expect(payload.artistScan).toEqual({ scanned: 0, truncated: false });
});

it('Key 用量按周期、模型和消费类型聚合，旧累计单列且不泄露密钥', async () => {
  const key = 'synthetic-footprint-key';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const keyHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  sqlite.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('nai_key_vault', JSON.stringify([{ id: 'a', name: '主号', key }]));
  sqlite.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('anlas_personal_usage_v1', JSON.stringify({ [keyHash]: { anlasSpent: 90, opusImages: 12 } }));
  const post = async (action: string, model: string, amount: number, value: number | undefined, opusImages: number | undefined) => {
    const response = await invoke('/api/local-usage/events', 'POST', { category: 'nai', action, target: keyHash, amount, value,
      meta: { model, billingKnown: value !== undefined, opusImages, prompt: '不得保存此内容' } });
    expect(response.status).toBe(200);
  };
  await post('generation', 'nai-diffusion-4-5-full', 2, 0, 0);
  await post('generation', 'nai-diffusion-5-full-medium', 1, 4, 1);
  await post('generation', 'nai-diffusion-5-full', 1, undefined, undefined);
  await post('encoding', 'nai-diffusion-4-5-full', 0, 2, 0);
  sqlite.exec(`UPDATE local_usage_events SET created_at = ${TO}`);
  // 另一用户、范围外事件和普通历史都不能增加此 Key 的用量。
  sqlite.prepare(`INSERT INTO local_usage_events SELECT 'other-user', 'other', category, action, target, amount, value, meta, created_at FROM local_usage_events LIMIT 1`).run();
  sqlite.prepare(`INSERT INTO local_usage_events SELECT 'old', user_id, category, action, target, 100, value, meta, ? FROM local_usage_events LIMIT 1`).run(TO - 40 * DAY);
  insert('not-a-usage-event', 'owner', TO, 'artist:alpha');
  const response = await invoke(`/api/local-usage/stats?days=month&month=2026-10&tzOffset=480&to=${TO + DAY}`);
  const payload = await response.json();
  expect(payload.keys).toEqual([{
    keyHash, name: '主号', images: 4,
    models: [{ model: 'nai-diffusion-4-5-full', images: 2 }, { model: 'nai-diffusion-5-full', images: 1 }, { model: 'nai-diffusion-5-full-medium', images: 1 }],
    generationAnlas: 4, encodingAnlas: 2, opusImages: 1, unknownBillingImages: 1,
    lifetime: { anlasSpent: 90, opusImages: 12 },
  }]);
  expect(JSON.stringify(payload)).not.toContain(key);
  expect(payload.keyUsageFirstAt).toBe(TO - 40 * DAY);
  expect(sqlite.prepare('SELECT meta FROM local_usage_events LIMIT 1').get()!.meta).not.toContain('不得保存');
  sqlite.exec('DELETE FROM local_generation_history');
  expect((await (await invoke(`/api/local-usage/stats?days=month&month=2026-10&to=${TO + DAY}`)).json()).keys[0].images).toBe(4);
  sqlite.exec("DELETE FROM settings WHERE key = 'nai_key_vault'");
  expect((await (await invoke(`/api/local-usage/stats?days=all&to=${TO + DAY}`)).json()).keys[0]).toMatchObject({ keyHash, name: null, images: 104 });
  const week = await (await invoke(`/api/local-usage/stats?days=all&from=${TO - DAY}&to=${TO + DAY}`)).json();
  expect(week.keys[0].images).toBe(4);
  const before = await (await invoke(`/api/local-usage/stats?days=all&year=2025&to=${TO + DAY}`)).json();
  expect(before.keys[0]).toMatchObject({ images: 0, generationAnlas: 0, lifetime: { anlasSpent: 90 } });
});

it('Key 用量拒绝原密钥、损坏计费字段和无效张数', async () => {
  const event = { category: 'nai', action: 'generation', target: 'a'.repeat(64), amount: 1, value: 0,
    meta: { model: 'nai-diffusion-5-full', billingKnown: true, opusImages: 1 } };
  for (const invalid of [
    { ...event, target: 'raw-key-should-not-be-stored' }, { ...event, amount: 0 }, { ...event, amount: 1.5 },
    { ...event, value: -1 }, { ...event, meta: { ...event.meta, opusImages: 2 } },
    { ...event, meta: { ...event.meta, billingKnown: 'true' } },
  ]) expect((await invoke('/api/local-usage/events', 'POST', invalid)).status).toBe(400);
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM local_usage_events').get()!.count).toBe(0);
});

it('两把 Key 的成功图片、编码费用和 Opus 张数独立聚合', async () => {
  for (const [keyHash, amount, cost, opusImages] of [['a'.repeat(64), 3, 8, 2], ['b'.repeat(64), 1, 0, 1]] as const) {
    expect((await invoke('/api/local-usage/events', 'POST', { category: 'nai', action: 'generation', target: keyHash, amount, value: cost,
      meta: { model: 'nai-diffusion-5-full', billingKnown: true, opusImages } })).status).toBe(200);
  }
  const { keys } = await (await invoke('/api/local-usage/stats?days=all')).json();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatchObject({ keyHash: 'a'.repeat(64), images: 3, generationAnlas: 8, opusImages: 2 });
  expect(keys[1]).toMatchObject({ keyHash: 'b'.repeat(64), images: 1, generationAnlas: 0, opusImages: 1 });
});

it('参数组合聚合保留各项总数，未启用参考与损坏参数不串入使用量，完整参数不读回统计进程', async () => {
  const first = { model: 'nai-diffusion-5-full', width: 832, height: 1216, steps: 28,
    characters: [{ prompt: 'girl' }, { prompt: 'disabled character', enabled: false }],
    vibes: { enabled: true, slots: [{}, {}] }, characterReferences: { enabled: false, slots: [{}] },
    unrelatedSnapshot: 'x'.repeat(100_000) };
  for (let index = 0; index < 12; index++) insert(`large-${index}`, 'owner', TO, 'solo, artist:alpha_artist', { params: JSON.stringify(first) });
  insert('other-params', 'owner', TO, 'solo', { params: JSON.stringify({ model: 'nai-diffusion-4-5-full', width: 1024, height: 1024, steps: 40,
    _local_edit: { operation: 'inpaint' }, characterReferences: { enabled: true, slots: [{}, {}, {}] }, vibes: { enabled: false, slots: [{}] } }) });
  insert('broken', 'owner', TO, 'solo', { params: '{broken' });
  insert('null', 'owner', TO, 'solo', { params: 'null' });
  const payload = await (await invoke(`/api/local-history/stats?days=all&to=${TO}`)).json();
  expect(payload.totals.images).toBe(15);
  expect(payload.models).toEqual([{ model: 'nai-diffusion-5-full', images: 12 }, { model: 'nai-diffusion-4-5-full', images: 1 }]);
  expect(payload.sizes).toEqual([{ width: 832, height: 1216, images: 12 }, { width: 1024, height: 1024, images: 1 }]);
  expect(payload.steps).toEqual([{ steps: 28, images: 12 }, { steps: 40, images: 1 }]);
  expect(payload.operations).toEqual([{ operation: 'text-to-image', images: 14 }, { operation: 'inpaint', images: 1 }]);
  expect(payload.characterUsage).toEqual({ images: 12, slots: 24 });
  expect(payload.vibeUsage).toEqual({ images: 12, slots: 24 });
  expect(payload.referenceUsage).toEqual({ images: 1, slots: 3 });
  expect(payload.characters).toEqual([{ id: 'girl', name: 'girl', images: 12, lastAt: TO }]);
  expect(readBytes).toBeLessThan(10_000);
});

it('资产摘要只返回统计字段，保留无编码资产并排除归档 Vibe 与其他用户的 Roll', async () => {
  const experiment = { ...rollFixture(), updatedAt: TO, candidates: [{ ...candidateFixture('one'), createdAt: TO, savedChainId: 'saved-chain' }],
    rounds: [{ id: 'round', candidateIds: ['one'], createdAt: TO }] };
  sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('style_roll_v1:owner:one', JSON.stringify(experiment));
  sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('style_roll_v1:other:one', JSON.stringify({ ...experiment, name: '其他用户' }));
  const asset = sqlite.prepare('INSERT INTO vibe_assets(id, name, source_hash, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  asset.run('one', '不应传输的素材名', 'hash-one', 0, TO, TO);
  asset.run('empty', '没有编码', 'hash-empty', 0, TO - DAY, TO - DAY);
  asset.run('archived', '归档素材', 'hash-archived', 1, TO, TO);
  const encoding = sqlite.prepare('INSERT INTO vibe_encodings VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  encoding.run('encoding', 'one', 'nai-diffusion-4-5-full', 'v45', 1, 'private-encoding-key', 'hash', TO);
  encoding.run('archived-encoding', 'archived', 'nai-diffusion-5-full', 'v5', 1, 'private-encoding-key', 'hash-two', TO);
  sqlite.prepare('INSERT INTO vibe_groups VALUES (?, ?, ?, ?, ?, ?)').run('group', 'private group name', '[{"private":"slots"}]', 1, TO, TO);
  const payload = await (await invoke('/api/local-usage/assets')).json();
  expect(payload.roll).toEqual([{ id: experiment.id, name: experiment.name, updatedAt: TO,
    candidates: [{ createdAt: TO, savedChainId: 'saved-chain', archived: false }], rounds: [{ createdAt: TO }] }]);
  expect(payload.vibes).toEqual([{ createdAt: TO, encodings: [{ model: 'nai-diffusion-4-5-full', createdAt: TO }] }, { createdAt: TO - DAY, encodings: [] }]);
  expect(payload.vibeGroups).toEqual([{ createdAt: TO }]);
  const text = JSON.stringify(payload);
  for (const privateValue of ['synthetic subject', 'private', '不应传输的素材名', '其他用户', 'sourceHash', 'template', 'tags']) expect(text).not.toContain(privateValue);
});

it('Roll 资料损坏不隐藏其他资产摘要，也不改写原记录', async () => {
  sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('style_roll_v1:owner:broken', '{broken');
  const payload = await (await invoke('/api/local-usage/assets')).json();
  expect(payload).toEqual({ vibes: [], vibeGroups: [] });
  expect(sqlite.prepare('SELECT value FROM settings').get()!.value).toBe('{broken');
});
