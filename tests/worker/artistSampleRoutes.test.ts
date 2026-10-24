import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { handleArtistSampleRoute } from '../../worker/routes/artistSampleRoutes';
import { deleteR2File } from '../../worker/routes/settingsRoutes';
import { INIT_SQL, type D1Database, type Env, type RouteContext } from '../../worker/routes/types';

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); });
const fixture = () => {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite); sqlite.exec(INIT_SQL);
  const db = { prepare(query: string) { let values: any[] = []; return { bind(...next: any[]) { values = next; return this; },
    async first() { return sqlite.prepare(query).get(...values) || null; }, async all() { return { results: sqlite.prepare(query).all(...values) }; },
    async run() { return { success: true, meta: sqlite.prepare(query).run(...values) }; } }; } } as unknown as D1Database;
  const bucket = { get: vi.fn(async (_key: string) => ({ body: 'synthetic' })), delete: vi.fn() };
  const env = { DB: db, BUCKET: bucket } as unknown as Env;
  const invoke = (body?: unknown, userId = 'owner', role = 'admin') => {
    const method = body === undefined ? 'GET' : 'POST', path = '/api/artist-sample-data';
    const request = new Request('http://localhost' + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return handleArtistSampleRoute({ path, method, request, url: new URL(request.url), db, env, currentUser: { id: userId, role } } as RouteContext);
  };
  return { sqlite, db, bucket, env, invoke };
};
const params = { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 0 };
const template = { prompt: 'solo, artist:{artist}', negativePrompt: '', params };
const sample = { id: 'sample-1', tag: 'synthetic artist', pack: 'v45', imageUrl: '/api/assets/synthetic.png', prompt: 'solo, artist:synthetic artist', negativePrompt: '', params, createdAt: 1 };

it('V5旧Curated模板样张GET保留，新写Curated拒绝，Full与Medium通过且旧图片不删除', async () => {
  const f = fixture();
  const old = { ...sample, pack: 'v5', params: { ...params, model: 'nai-diffusion-5-curated' } };
  const oldTemplate = { ...template, params: old.params };
  f.sqlite.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('artist_sample_v1:owner:sample:v5:sample-1', JSON.stringify(old));
  f.sqlite.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('artist_sample_v1:owner:template:v5', JSON.stringify(oldTemplate));
  const data = await (await f.invoke())!.json();
  expect(data.samples).toContainEqual(old); expect(data.templates.v5).toEqual(oldTemplate);
  expect((await f.invoke({ action: 'sample', pack: 'v5', sample: { ...old, id: 'curated-new' } }))?.status).toBe(400);
  expect((await f.invoke({ action: 'template', pack: 'v5', template: oldTemplate }))?.status).toBe(400);
  for (const model of ['nai-diffusion-5-full', 'nai-diffusion-5-full-medium']) {
    expect((await f.invoke({ action: 'template', pack: 'v5', template: { ...template, params: { ...params, model } } }))?.status).toBe(200);
    expect((await f.invoke({ action: 'sample', pack: 'v5', sample: { ...old, id: model, params: { ...params, model } } }))?.status).toBe(200);
  }
  expect((await f.invoke({ action: 'remove', pack: 'v5', removal: { source: 'own', pack: 'v5', tag: old.tag, id: old.id } }))?.status).toBe(200);
  expect(f.bucket.delete).not.toHaveBeenCalled();
});

it('自建配置和样张按用户保存，重复保存同一张不会重复创建', async () => {
  const f = fixture();
  expect((await f.invoke({ action: 'template', pack: 'v45', template }))?.status).toBe(200);
  for (let count = 0; count < 2; count++) expect((await f.invoke({ action: 'sample', pack: 'v45', sample }))?.status).toBe(200);
  expect(await (await f.invoke())?.json()).toEqual({ templates: { v45: template }, samples: [sample], removedSamples: [] });
  expect(await (await f.invoke(undefined, 'other'))?.json()).toEqual({ templates: {}, samples: [], removedSamples: [] });
});

it('拒绝访客、错误模型、随机配置Seed、远程地址和未保存原图', async () => {
  const f = fixture();
  expect((await f.invoke({ action: 'template', pack: 'v45', template }, 'owner', 'guest'))?.status).toBe(403);
  expect((await f.invoke({ action: 'remove', pack: 'v45', removal: { source: 'pack', pack: 'v45', tag: 'synthetic artist', revision: 'a'.repeat(24), index: 0, imageCount: 1 } }, 'owner', 'guest'))?.status).toBe(403);
  expect((await f.invoke({ action: 'template', pack: 'v5', template }))?.status).toBe(400);
  expect((await f.invoke({ action: 'template', pack: 'v45', template: { ...template, params: { ...params, seed: undefined } } }))?.status).toBe(400);
  expect((await f.invoke({ action: 'sample', pack: 'v45', sample: { ...sample, imageUrl: 'https://example.com/image.png' } }))?.status).toBe(400);
  f.bucket.get.mockResolvedValueOnce(null as any);
  expect((await f.invoke({ action: 'sample', pack: 'v45', sample }))?.status).toBe(400);
  expect(f.sqlite.prepare('SELECT count(*) AS n FROM settings').get()?.n).toBe(0);
});

it('自建样张仍引用原图时，其他条目删除不能删掉共用图片', async () => {
  const f = fixture();
  await f.invoke({ action: 'sample', pack: 'v45', sample });
  await deleteR2File(f.env, sample.imageUrl, f.db);
  expect(f.bucket.delete).not.toHaveBeenCalled();
});
