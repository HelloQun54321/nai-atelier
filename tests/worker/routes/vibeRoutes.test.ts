// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { handleVibeRoute } from '../../../worker/routes/vibeRoutes';
import type { D1Database, Env, RouteContext } from '../../../worker/routes/types';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=';
const encoding = Buffer.from('synthetic-vibe-encoding'.repeat(8)).toString('base64');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const variant = (information = 0.7, data = encoding) => ({ encoding: data, params: { information_extracted: information } });
const document = (encodings = { 'v4-5full': { a: variant() } }, extra: Record<string, unknown> = {}) => ({
  identifier: 'novelai-vibe-transfer', version: 1, type: 'image', id: hash(image), image, encodings,
  name: '合成 Vibe', importInfo: { model: 'nai-diffusion-4-5-full', information_extracted: 0.7, strength: 0.6 }, ...extra,
});

function fixture() {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite);
  const files = new Map<string, ArrayBuffer>();
  const db = { prepare(sql: string) {
    let args: any[] = [];
    return { bind(...values: any[]) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { return { success: true, meta: { changes: sqlite.prepare(sql).run(...args).changes } }; } };
  }, async batch(statements: Array<{ run(): Promise<unknown> }>) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  const env = { BUCKET: {
    async put(key: string, body: BodyInit) { files.set(key, await new Response(body).arrayBuffer()); },
    async get(key: string) { const bytes = files.get(key); return bytes ? { body: new Response(bytes.slice(0)).body! } : null; },
  } } as unknown as Env;
  const request = async (path: string, body?: unknown, method = body ? 'POST' : 'GET') => {
    const req = new Request(`http://synthetic.test${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const response = await handleVibeRoute({ request: req, path, url: new URL(req.url), method, db, env } as RouteContext);
    if (!response) throw new Error(`未处理合成请求 ${path}`);
    return { status: response.status, body: await response.json() as any, headers: response.headers };
  };
  return { sqlite, files, request, import: (value: unknown) => request('/api/vibes/import', { document: value }) };
}

describe('官方 Vibe 文件往返', () => {
  it('多模型、多提取量独立保留，官方文本哈希与本地图片字节去重同时成立', async () => {
    const f = fixture();
    const result = await f.import(document({ 'v4-5full': { a: variant(), b: variant(1) }, v4full: { a: variant() }, 'v4-5curated': { a: variant() } } as any));
    expect(result.status).toBe(200); expect(result.body.imported).toBe(4);
    expect(result.body.item.encodings.map((e: any) => e.model).sort()).toEqual(['nai-diffusion-4-5-curated', 'nai-diffusion-4-5-full', 'nai-diffusion-4-5-full', 'nai-diffusion-4-full']);
    const exported = await f.request(`/api/vibes/${result.body.item.id}/file`);
    expect(exported.body.type).toBe('image'); expect(exported.body.id).toBe(hash(exported.body.image));
    expect(exported.body.encodings['v4-5full'][hash('information_extracted:0.7')]).toEqual(variant());
    const target = fixture(), restored = await target.import(exported.body);
    expect(restored.body.imported).toBe(4); expect((await f.import(exported.body)).body.imported).toBe(0);
    expect(restored.body.item.sourceHash).toBe(hash(Buffer.from(image, 'base64')));
  });

  it('仅编码的未知参数保持未知，导出通过官方编码哈希与 unknown 键规则', async () => {
    const f = fixture();
    const encoded = document({ 'v4-5full': { unknown: { encoding } } } as any, { type: 'encoding', image: undefined, id: hash(encoding) });
    const result = await f.import(encoded);
    expect(result.body.item.hasOriginal).toBe(false);
    expect(result.body.item.encodings[0]).toMatchObject({ informationKnown: false, parameters: null });
    const exported = await f.request(`/api/vibes/${result.body.item.id}/file`);
    expect(exported.body.type).toBe('encoding'); expect(exported.body.id).toBe(hash(encoding));
    expect(exported.body.encodings['v4-5full'].unknown).toEqual({ encoding });
    expect((await fixture().import(exported.body)).body.item.encodings[0].informationKnown).toBe(false);
  });

  it('导入官方组合、保留重复参考、负强度及非归一化设置，导出可再导入', async () => {
    const f = fixture();
    const a = document(undefined, { importInfo: { model: 'nai-diffusion-4-5-full', information_extracted: 0.7, strength: 1.5 } });
    const b = document(undefined, { importInfo: { model: 'nai-diffusion-4-5-full', information_extracted: 0.7, strength: -0.3 } });
    const result = await f.import({ identifier: 'novelai-vibe-transfer-bundle', version: 1, vibes: [a, b], normalizeStrengths: false });
    expect(result.body.slots.map((s: any) => s.strength)).toEqual([1.5, -0.3]);
    expect(result.body.slots[0].encodingId).toBe(result.body.slots[1].encodingId);
    const exported = await f.request('/api/vibes/export', { slots: result.body.slots, normalizeStrengths: false });
    expect(exported.body.vibes.map((v: any) => v.importInfo.strength)).toEqual([1.5, -0.3]);
    const restored = await fixture().import(exported.body);
    expect(restored.body.normalizeStrengths).toBe(false); expect(restored.body.slots).toHaveLength(2);
  });

  it('编码冲突不覆盖旧文件，损坏文件与损坏的组合末项不写入资产', async () => {
    const f = fixture(), saved = await f.import(document());
    const before = new Map(f.files);
    const conflict = await f.import(document({ 'v4-5full': { a: variant(0.7, Buffer.from('different-encoding'.repeat(10)).toString('base64')) } }));
    expect(conflict.status).toBe(400); expect(conflict.body.error).toContain('冲突'); expect(f.files).toEqual(before);
    const target = fixture();
    const invalid = await target.import({ identifier: 'novelai-vibe-transfer-bundle', version: 1, vibes: [document(), document({ 'v4-5full': { a: { encoding: 'broken' } } } as any)] });
    expect(invalid.status).toBe(400); expect(target.sqlite.prepare('SELECT COUNT(*) AS count FROM vibe_assets').get()?.count).toBe(0);
    expect((await f.request(`/api/vibes/${saved.body.item.id}`)).body.item.encodings).toHaveLength(1);
  });

  it('旧数据只补字段并保留原图、编码主键和字节，旧文件的字节哈希仍可导入', async () => {
    const f = fixture();
    f.sqlite.exec(`CREATE TABLE vibe_assets (id TEXT PRIMARY KEY, name TEXT NOT NULL, source_hash TEXT UNIQUE, original_key TEXT, original_type TEXT, default_strength REAL DEFAULT 0.6, archived INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE vibe_encodings (id TEXT PRIMARY KEY, vibe_id TEXT, model TEXT, model_key TEXT, information_extracted REAL, encoding_key TEXT, encoding_hash TEXT, created_at INTEGER, UNIQUE(vibe_id, model, information_extracted));`);
    const saved = await f.import(document(undefined, { id: hash(Buffer.from(image, 'base64')) }));
    const original = await f.request(`/api/vibes/${saved.body.item.id}/file`);
    const bytes = new Map(f.files), encodingId = saved.body.item.encodings[0].id;
    expect((await f.import(original.body)).body.item.encodings[0].id).toBe(encodingId); expect(f.files).toEqual(bytes);
  });

  it('新编码保存使用真实模型，并保留精确提取量', async () => {
    const f = fixture();
    const asset = await f.request('/api/vibes', { imageData: `data:image/png;base64,${image}`, name: '原图' });
    const result = await f.request(`/api/vibes/${asset.body.item.id}/encoding-result`, { model: 'nai-diffusion-4-curated-preview', informationExtracted: 0.705, encodingBase64: encoding });
    expect(result.body.item.encodings[0]).toMatchObject({ model: 'nai-diffusion-4-curated-preview', modelKey: 'v4curated', informationExtracted: 0.705 });
    expect((await f.request(`/api/vibes/${asset.body.item.id}/file`)).body.encodings.v4curated[hash('information_extracted:0.705')]).toBeTruthy();
  });

  it('同图同模型同提取量按完整参数保留 mask、普通和未知变体，并恢复所选变体', async () => {
    const f = fixture();
    const masked = { encoding, params: { information_extracted: 0.7, mask: image } };
    const result = await f.import(document({ 'v4-5full': { masked, plain: variant(), unknown: { encoding } } } as any,
      { importInfo: { model: 'nai-diffusion-4-5-full', information_extracted: 0.7, mask: image, strength: 0.6 } }));
    expect(result.status).toBe(200); expect(result.body.imported).toBe(3);
    expect(new Set(result.body.item.encodings.map((item: any) => item.id)).size).toBe(3);
    expect(result.body.item.encodings.every((item: any) => item.informationExtracted === 0.7)).toBe(true);
    expect(result.body.item.encodings.find((item: any) => item.id === result.body.slots[0].encodingId).parameters).toEqual(masked.params);
    const exported = await f.request(`/api/vibes/${result.body.item.id}/file`);
    expect(Object.values(exported.body.encodings['v4-5full'])).toEqual(expect.arrayContaining([masked, variant(), { encoding }]));
    const restored = await fixture().import(exported.body);
    expect(restored.status).toBe(200); expect(restored.body.item.encodings).toHaveLength(3);
    expect((await f.import(exported.body)).body.imported).toBe(0);
  });

  it('masked 和未知变体不挡住新普通编码，同参数冲突不改旧字节', async () => {
    const f = fixture();
    const asset = await f.import(document({ 'v4-5full': {
      masked: { encoding, params: { information_extracted: 0.7, mask: image } }, unknown: { encoding },
    } } as any));
    const path = `/api/vibes/${asset.body.item.id}/encoding-result`;
    const plain = Buffer.from('new-unmasked-encoding'.repeat(8)).toString('base64');
    const body = { model: 'nai-diffusion-4-5-full', informationExtracted: 0.7, encodingBase64: plain };
    const result = await f.request(path, body);
    expect(result.status).toBe(200); expect(result.body.duplicate).not.toBe(true);
    expect(result.body.item.encodings).toHaveLength(3);
    expect(result.body.item.encodings.find((item: any) => item.encodingHash === hash(Buffer.from(plain, 'base64')))).toMatchObject({
      informationExtracted: 0.7, informationKnown: true, parameters: { information_extracted: 0.7 },
    });
    expect((await f.request(path, body)).body.duplicate).toBe(true);
    const before = new Map(f.files);
    const conflict = await f.request(path, { ...body, encodingBase64: encoding });
    expect(conflict.status).toBe(409); expect(f.files).toEqual(before);
    expect((await f.request(`/api/vibes/${asset.body.item.id}`)).body.item.encodings).toHaveLength(3);
  });

  it('旧表的真实行及文件保持原样，新变体与旧编码通过同一视图读取', async () => {
    const f = fixture();
    f.sqlite.exec(`CREATE TABLE vibe_assets (id TEXT PRIMARY KEY, name TEXT NOT NULL, source_hash TEXT UNIQUE, original_key TEXT, original_type TEXT, default_strength REAL DEFAULT 0.6, archived INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE vibe_encodings (id TEXT PRIMARY KEY, vibe_id TEXT, model TEXT, model_key TEXT, information_extracted REAL, encoding_key TEXT, encoding_hash TEXT, created_at INTEGER, UNIQUE(vibe_id, model, information_extracted));`);
    f.sqlite.prepare('INSERT INTO vibe_assets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('legacy', '旧图', hash(Buffer.from(image, 'base64')), 'legacy.png', 'image/png', 0.6, 0, 1, 1);
    f.sqlite.prepare('INSERT INTO vibe_encodings VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('legacy-encoding', 'legacy', 'nai-diffusion-4-5-full', 'v4-5full', 0.7, 'legacy.bin', hash(Buffer.from(encoding, 'base64')), 1);
    f.files.set('legacy.png', Uint8Array.from(Buffer.from(image, 'base64')).buffer);
    f.files.set('legacy.bin', Uint8Array.from(Buffer.from(encoding, 'base64')).buffer);
    const legacy = f.sqlite.prepare('SELECT id, model, model_key, information_extracted, encoding_key, encoding_hash, created_at FROM vibe_encodings').get();
    const before = new Map(f.files);
    const result = await f.import(document({ 'v4-5full': { masked: { encoding, params: { information_extracted: 0.7, mask: image } } } } as any));
    expect(result.status).toBe(200); expect(result.body.item.id).toBe('legacy'); expect(result.body.item.encodings).toHaveLength(2);
    expect(f.sqlite.prepare('SELECT id, model, model_key, information_extracted, encoding_key, encoding_hash, created_at FROM vibe_encodings').get()).toEqual(legacy);
    for (const [key, bytes] of before) expect(f.files.get(key)).toEqual(bytes);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM vibe_encodings').get()?.count).toBe(1);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM vibe_encoding_variants').get()?.count).toBe(1);
    expect((await f.request('/api/vibes/legacy/encodings/legacy-encoding/data')).body.encoding).toBe(encoding);
    expect((await f.request('/api/vibes')).body.items[0].encodings).toHaveLength(2);
    expect((await f.request('/api/vibe-groups', { name: '兼容组合', slots: result.body.slots })).status).toBe(201);
  });

  it('组合保存核对实际编码，保留重复与负强度，缺失项不保存成无效组合', async () => {
    const f = fixture(), result = await f.import(document());
    const slot = { ...result.body.slots[0], informationExtracted: 0.1, strength: -1.5 };
    const created = await f.request('/api/vibe-groups', { name: '组合', slots: [slot, slot], normalizeStrengths: false });
    expect(created.body.item.slots).toHaveLength(2); expect(created.body.item.slots[0]).toMatchObject({ informationExtracted: 0.7, strength: -1.5 });
    const missing = await f.request('/api/vibe-groups', { name: '缺失', slots: [{ ...slot, encodingId: 'missing' }] });
    expect(missing.status).toBe(400); expect((await f.request('/api/vibe-groups')).body.items).toHaveLength(1);
  });
});
