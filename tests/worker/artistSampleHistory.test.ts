import { DatabaseSync } from 'node:sqlite';
import { encode } from 'fast-png';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import worker from '../../worker/index';
import { handleHistoryRoute } from '../../worker/routes/historyRoutes';
import { handleArtistSampleRoute } from '../../worker/routes/artistSampleRoutes';
import { deleteR2File } from '../../worker/routes/settingsRoutes';
import { INIT_SQL, type D1Database, type Env, type RouteContext } from '../../worker/routes/types';

const sqlite = new DatabaseSync(':memory:');
let failArchive = false;
let pendingBatch = Promise.resolve<unknown>(undefined);
const db = { prepare(query: string) {
  let values: any[] = [];
  return {
    bind(...next: any[]) { values = next; return this; },
    async first() { return sqlite.prepare(query).get(...values) || null; },
    async all() { return { results: sqlite.prepare(query).all(...values) }; },
    async run() {
      if (failArchive && query.startsWith('INSERT INTO settings')) throw new Error('synthetic archive failure');
      return { success: true, meta: sqlite.prepare(query).run(...values) };
    },
  };
}, async batch(statements: { run(): Promise<unknown> }[]) {
  const result = pendingBatch.then(async () => {
    sqlite.exec('BEGIN');
    try {
      const output = [];
      for (const statement of statements) output.push(await statement.run());
      sqlite.exec('COMMIT');
      return output;
    } catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
  });
  pendingBatch = result.catch(() => {});
  return result;
} } as unknown as D1Database;
const images = new Map<string, Uint8Array>();
const bucket = {
  put: vi.fn(async (key: string, bytes: ArrayBuffer) => { images.set(key, new Uint8Array(bytes).slice()); }),
  get: vi.fn(async (key: string) => {
    const bytes = images.get(key);
    return bytes ? { body: bytes, httpEtag: 'synthetic', writeHttpMetadata(headers: Headers) { headers.set('Content-Type', 'image/png'); } } : null;
  }),
  delete: vi.fn(async (key: string) => { images.delete(key); }),
};
const env = { DB: db, LOCAL_HISTORY_ENABLED: 'true', BUCKET: bucket } as unknown as Env;
const png = encode({ width: 64, height: 64, channels: 4, data: new Uint8Array(64 * 64 * 4).fill(255) });
const params = { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 12 };
const target = { id: '12345678-1234-4234-8234-123456789abc', tag: 'Synthetic_Artist', pack: 'v45' };
const metadata = () => ({
  id: 'generated-1', imageUrl: `data:image/png;base64,${Buffer.from(png).toString('base64')}`, createdAt: 123,
  prompt: 'solo, {{artist:synthetic artist}}', negativePrompt: 'lowres', params: { ...params },
  sourceChainId: `artist-sample:${target.pack}:${encodeURIComponent(target.tag)}`,
  modules: [{ id: `artist-sample-target:${target.id}`, name: '画师样张', content: JSON.stringify(target), isActive: false }],
});
const invoke = async (path = '/api/local-history', method = 'GET', body?: unknown, userId = 'owner') => {
  const request = new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const context = { request, url: new URL(request.url), path, method, db, env, currentUser: { id: userId, username: userId, role: 'admin' } } as RouteContext;
  return (await handleArtistSampleRoute(context) || await handleHistoryRoute(context))!;
};
const samples = async (userId = 'owner') => (await (await invoke('/api/artist-sample-data', 'GET', undefined, userId)).json()).samples;
beforeAll(async () => { sqlite.exec(INIT_SQL); await invoke(); });
beforeEach(() => {
  sqlite.exec('DELETE FROM settings; DELETE FROM local_generation_history; DELETE FROM inspirations');
  images.clear(); failArchive = false; vi.clearAllMocks();
});
afterAll(() => sqlite.close());

it.each(['v45', 'v5'])('卡内 %s 后台保存历史即归档真实参数和原图，无前端保存请求', async pack => {
  const body = metadata();
  body.params.model = pack === 'v45' ? 'nai-diffusion-4-5-full' : 'nai-diffusion-5-full';
  body.sourceChainId = `artist-sample:${pack}:${encodeURIComponent(target.tag)}`;
  body.modules[0].content = JSON.stringify({ ...target, pack });
  expect((await invoke('/api/local-history', 'POST', body)).status).toBe(200);
  const saved = await samples();
  expect(saved).toEqual([{ id: `sample-${pack}-generated-1`, tag: target.tag, pack,
    imageUrl: '/api/assets/local-history%2Fowner%2Fgenerated-1.png', prompt: body.prompt, negativePrompt: 'lowres',
    params: { ...body.params, width: 64, height: 64 }, createdAt: 123 }]);
  expect(await samples('other')).toEqual([]);
  expect(bucket.put).toHaveBeenCalledTimes(1);
  const asset = await worker.fetch(new Request(`http://localhost${saved[0].imageUrl}`), env);
  expect(asset.status).toBe(200);
  expect(new Uint8Array(await asset.arrayBuffer())).toEqual(png);
  expect(await (await worker.fetch(new Request(`http://192.168.1.50${saved[0].imageUrl}`), env)).json()).toMatchObject({ code: 'LAN_ACCESS_REQUIRED' });
});

it.each([
  ['普通实验室', (body: any) => { delete body.sourceChainId; body.modules = []; }],
  ['Roll', (body: any) => { body.sourceChainId = 'style-roll:synthetic'; }],
  ['旧实验室目标无模块', (body: any) => { body.modules = []; }],
  ['多个目标', (body: any) => { body.modules.push(body.modules[0]); }],
  ['启用的目标模块', (body: any) => { body.modules[0].isActive = true; }],
  ['目标名称不符', (body: any) => { body.modules[0].name = '其他模块'; }],
  ['损坏JSON', (body: any) => { body.modules[0].content = '{'; }],
  ['空目标JSON', (body: any) => { body.modules[0].content = 'null'; }],
  ['目标ID不符', (body: any) => { body.modules[0].id += '-other'; }],
  ['非法目标ID', (body: any) => { body.modules[0].id = 'artist-sample-target:invalid'; body.modules[0].content = JSON.stringify({ ...target, id: 'invalid' }); }],
  ['目标画师不符', (body: any) => { body.modules[0].content = JSON.stringify({ ...target, tag: 'other' }); }],
  ['目标版本不符', (body: any) => { body.modules[0].content = JSON.stringify({ ...target, pack: 'v5' }); }],
  ['V4', (body: any) => { body.params.model = 'nai-diffusion-4-full'; }],
  ['V5对应错误版本', (body: any) => { body.params.model = 'nai-diffusion-5-full'; }],
  ['重绘模型', (body: any) => { body.params.model += '-inpainting'; }],
  ['编辑历史', (body: any) => { body.edit = { operation: 'img2img' }; }],
  ['参数编辑历史', (body: any) => { body.params._local_edit = { operation: 'inpaint' }; }],
  ['画师词只是子串', (body: any) => { body.prompt = 'artist:synthetic artist extra'; }],
] as const)('%s 历史保持保存且不自动入样张', async (_label, change) => {
  const body = metadata(); change(body);
  expect((await invoke('/api/local-history', 'POST', body)).status).toBe(200);
  expect(await samples()).toEqual([]);
  expect(sqlite.prepare('SELECT count(*) AS n FROM local_generation_history').get()?.n).toBe(1);
});

it('重复保存幂等，重新生成按新历史新增并保留之前样张，读取旧历史不触发补归档', async () => {
  const body = metadata();
  await invoke('/api/local-history', 'POST', body);
  const original = await samples();
  await invoke('/api/local-history', 'POST', body);
  expect(await samples()).toEqual(original);
  await invoke('/api/local-history', 'POST', { ...body, id: 'regenerated-2', params: { ...body.params, seed: 99 } });
  const saved = await samples();
  expect(saved).toHaveLength(2); expect(saved).toContainEqual(original[0]);
  expect(saved.find((sample: { id: string }) => sample.id.endsWith('regenerated-2')).params.seed).toBe(99);
  sqlite.prepare('DELETE FROM settings WHERE key LIKE ?').run('artist_sample_v1:%');
  await invoke('/api/local-history/generated-1');
  expect(await samples()).toEqual([]);
});

it('归档失败仍交付历史和原图，恢复后手动保存仅入库', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    failArchive = true;
    const response = await invoke('/api/local-history', 'POST', metadata());
    expect(response.status).toBe(200);
    const { item } = await response.json();
    expect(item.id).toBe('generated-1'); expect(await samples()).toEqual([]);
    const image = await invoke(item.imageUrl);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
    expect(log).toHaveBeenCalledWith('画师样张自动保存失败，生成历史已保留', expect.any(Error));
    failArchive = false;
    expect((await invoke('/api/artist-sample-data', 'POST', { action: 'sample', pack: 'v45', sample: {
      ...item, id: 'sample-v45-generated-1', tag: target.tag, pack: 'v45', imageUrl: '/api/assets/local-history%2Fowner%2Fgenerated-1.png',
    } })).status).toBe(200);
    expect(await samples()).toHaveLength(1); expect(bucket.put).toHaveBeenCalledTimes(1);
  } finally { log.mockRestore(); }
});

it.each([
  ['/api/local-history/generated-1', 'DELETE', undefined],
  ['/api/local-history', 'DELETE', undefined],
  ['/api/local-history/cleanup', 'POST', { mode: 'days', days: 1 }],
] as const)('%s %s 删除历史保留样张引用和原始字节', async (path, method, body) => {
  await invoke('/api/local-history', 'POST', metadata());
  const [sample] = await samples();
  expect((await invoke(path, method, body)).status).toBe(200);
  expect(sqlite.prepare('SELECT count(*) AS n FROM local_generation_history').get()?.n).toBe(0);
  expect(await samples()).toEqual([sample]);
  const image = await worker.fetch(new Request(`http://localhost${sample.imageUrl}`), env);
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
  expect(bucket.delete).not.toHaveBeenCalledWith('local-history/owner/generated-1.png');
});

it('最后一条灵感或其他资产引用释放后仍保留样张，未归档普通历史仍可正常释放原图', async () => {
  await invoke('/api/local-history', 'POST', metadata());
  await invoke('/api/inspirations', 'POST', { id: 'inspiration-1', sourceType: 'history', sourceId: 'generated-1' });
  await invoke('/api/local-history/generated-1', 'DELETE');
  await invoke('/api/inspirations/inspiration-1', 'DELETE');
  await deleteR2File(env, '/api/assets/local-history/owner/generated-1.png', db);
  expect(images.get('local-history/owner/generated-1.png')).toEqual(png);
  const ordinary = metadata(); ordinary.id = 'ordinary'; ordinary.modules = [];
  await invoke('/api/local-history', 'POST', ordinary);
  await invoke('/api/local-history/ordinary', 'DELETE');
  expect(images.has('local-history/owner/ordinary.png')).toBe(false);
});
