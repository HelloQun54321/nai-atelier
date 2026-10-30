// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleVibeRoute } from '../../../worker/routes/vibeRoutes';
import { INIT_SQL, type D1Database, type Env, type RouteContext } from '../../../worker/routes/types';

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=';
const encoding = Buffer.from('synthetic-vibe-encoding'.repeat(8)).toString('base64');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const variant = (information = 0.7, data = encoding) => ({ encoding: data, params: { information_extracted: information } });
const document = (encodings: Record<string, Record<string, unknown>> = { 'v4-5full': { a: variant() } }, extra: Record<string, unknown> = {}) => ({
  identifier: 'novelai-vibe-transfer', version: 1, type: 'image', id: hash(image), image, encodings,
  name: '合成 Vibe', importInfo: { model: 'nai-diffusion-4-5-full', information_extracted: 0.7, strength: 0.6 }, ...extra,
});

describe('Vibe 显式永久删除', () => {
  const archive = async (f: ReturnType<typeof fixture>, id: string) => f.request(`/api/vibes/${id}/archive`, {});
  const addLegacyEncoding = (f: ReturnType<typeof fixture>, vibeId: string) => {
    f.sqlite.prepare(`INSERT INTO vibe_encodings (id, vibe_id, model, model_key, information_extracted, encoding_key, encoding_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('legacy', vibeId, 'nai-diffusion-4-5-full', 'v4-5full', 1, 'legacy.bin', hash(Buffer.from(encoding, 'base64')), 1);
    f.files.set('legacy.bin', Uint8Array.from(Buffer.from(encoding, 'base64')).buffer);
  };

  it('普通资产不能删除，归档后只删除明确指定的资产及其旧新编码和图片', async () => {
    const f = fixture(true), result = await f.import(document(undefined, { thumbnail: `data:image/png;base64,${image}` }));
    const id = result.body.item.id; addLegacyEncoding(f, id);
    const original = new Map(f.files);
    expect((await f.request(`/api/vibes/${id}`, undefined, 'DELETE')).status).toBe(409);
    expect(f.files).toEqual(original);
    await archive(f, id);
    f.files.set('unrelated-private-image', new Uint8Array([1, 2, 3]).buffer);
    const deleted = await f.request(`/api/vibes/${id}`, undefined, 'DELETE');
    expect(deleted.status).toBe(200); expect(deleted.body).toEqual({ success: true, id });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM vibe_assets').get()?.count).toBe(0);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM vibe_encodings_all').get()?.count).toBe(0);
    expect([...f.files.keys()]).toEqual(['unrelated-private-image']);
    expect((await f.request(`/api/vibes/${id}`, undefined, 'DELETE')).status).toBe(404);
  });

  it('逐份删除旧新表编码，保留原图、其他编码和空资产；未归档拒绝', async () => {
    const f = fixture(true), result = await f.import(document());
    const id = result.body.item.id, currentId = result.body.item.encodings[0].id; addLegacyEncoding(f, id);
    expect((await f.request(`/api/vibes/${id}/encodings/legacy`, undefined, 'DELETE')).status).toBe(409);
    await archive(f, id);
    const originalKey = f.sqlite.prepare('SELECT original_key FROM vibe_assets WHERE id = ?').get(id)!.original_key as string;
    const original = f.files.get(originalKey);
    const deleted = await f.request(`/api/vibes/${id}/encodings/legacy`, undefined, 'DELETE');
    expect(deleted.status).toBe(200); expect(deleted.body).toMatchObject({ success: true, encodingId: 'legacy', item: { id, archived: true } });
    expect(deleted.body.item.encodings.map((item: any) => item.id)).toEqual([currentId]);
    expect(f.files.has('legacy.bin')).toBe(false); expect(f.files.get(originalKey)).toEqual(original);
    expect((await f.request(`/api/vibes/${id}/encodings/${currentId}`, undefined, 'DELETE')).body.item.encodings).toEqual([]);
    expect((await f.request(`/api/vibes/${id}`)).body.item.hasOriginal).toBe(true);
    expect(f.files.get(originalKey)).toEqual(original);
    expect((await f.request(`/api/vibes/${id}/encodings/${currentId}`, undefined, 'DELETE')).status).toBe(404);
  });

  it.each(['风格串', '历史', '收藏', '收藏分析', '组合', 'Roll 模板', '画师模板', '仅编码标识'])('%s 中的持久引用阻止资产及对应编码删除，禁用参考也保留', async source => {
    const f = fixture(true), result = await f.import(document()), id = result.body.item.id, encodingId = result.body.item.encodings[0].id;
    await archive(f, id);
    const params = { nested: { vibes: { enabled: false, slots: [{ vibeId: id, encodingId, strength: 0.6 }] } } };
    if (source === '风格串') f.sqlite.prepare('INSERT INTO chains (id, name, params) VALUES (?, ?, ?)').run('ref', '已保存', JSON.stringify(params));
    else if (source === '历史') f.sqlite.prepare('INSERT INTO local_generation_history (id, user_id, image_key, params, created_at) VALUES (?, ?, ?, ?, ?)').run('ref', 'owner', 'other.png', JSON.stringify(params), 1);
    else if (source === '收藏' || source === '收藏分析') f.sqlite.prepare(`INSERT INTO inspirations (id, title, ${source === '收藏' ? 'params' : 'analysis'}, archived) VALUES (?, ?, ?, ?)`).run('ref', '收藏', JSON.stringify(params), 1);
    else if (source === '组合') await f.request('/api/vibe-groups', { name: '组合', slots: result.body.slots });
    else f.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(source === 'Roll 模板' ? 'style_roll_v1:owner:test' : 'artist_sample_v1:owner:template:test', JSON.stringify(source === '仅编码标识' ? { nested: { encodingId } } : { template: { params } }));
    const before = new Map(f.files);
    for (const path of [`/api/vibes/${id}`, `/api/vibes/${id}/encodings/${encodingId}`]) {
      const deleted = await f.request(path, undefined, 'DELETE');
      expect(deleted.status).toBe(409); expect(deleted.body.error).toContain('引用');
    }
    expect(f.files).toEqual(before); expect((await f.request(`/api/vibes/${id}`)).body.item.encodings).toHaveLength(1);
  });

  it('同资产的另一编码被引用时，仍可删除未被引用的编码', async () => {
    const f = fixture(true), result = await f.import(document({ 'v4-5full': { a: variant(), b: variant(1) } }));
    const id = result.body.item.id, retained = result.body.item.encodings.find((item: any) => item.informationExtracted === 0.7);
    const removable = result.body.item.encodings.find((item: any) => item.informationExtracted === 1);
    await archive(f, id);
    f.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('template', JSON.stringify({ params: { vibes: { slots: [{ vibeId: id, encodingId: retained.id }] } } }));
    const deleted = await f.request(`/api/vibes/${id}/encodings/${removable.id}`, undefined, 'DELETE');
    expect(deleted.status).toBe(200); expect(deleted.body.item.encodings.map((item: any) => item.id)).toEqual([retained.id]);
  });

  it.each([undefined, '', 'missing-encoding'])('旧槽位只引用资产且编码为 %s 时，不能猜测另一变体而删除', async encodingId => {
    const f = fixture(true), result = await f.import(document()), id = result.body.item.id, currentId = result.body.item.encodings[0].id;
    await archive(f, id); const before = new Map(f.files);
    f.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('legacy-template', JSON.stringify({ vibes: { slots: [{ vibeId: id, encodingId }] } }));
    expect((await f.request(`/api/vibes/${id}/encodings/${currentId}`, undefined, 'DELETE')).status).toBe(409);
    expect(f.files).toEqual(before); expect((await f.request(`/api/vibes/${id}`)).body.item.encodings).toHaveLength(1);
  });

  it.each(['风格串', '历史', '收藏参数', '收藏分析', '组合', '模板', '画师样张', '错误结构'])('%s 资料损坏时无法核对引用，拒绝删除', async source => {
    const f = fixture(true), result = await f.import(document()), id = result.body.item.id, encodingId = result.body.item.encodings[0].id;
    await archive(f, id); const before = new Map(f.files);
    if (source === '风格串' || source === '错误结构') f.sqlite.prepare('INSERT INTO chains (id, name, params) VALUES (?, ?, ?)').run('bad', '损坏', source === '错误结构' ? '42' : '{broken');
    else if (source === '历史') f.sqlite.prepare('INSERT INTO local_generation_history (id, user_id, image_key, params, created_at) VALUES (?, ?, ?, ?, ?)').run('bad', 'owner', 'other.png', '{broken', 1);
    else if (source === '收藏参数' || source === '收藏分析') f.sqlite.prepare(`INSERT INTO inspirations (id, title, ${source === '收藏参数' ? 'params' : 'analysis'}) VALUES (?, ?, ?)`).run('bad', '损坏', '{broken');
    else if (source === '组合') f.sqlite.prepare('INSERT INTO vibe_groups (id, name, slots, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('bad', '损坏', '[broken', 1, 1);
    else if (source === '画师样张') f.sqlite.prepare('INSERT INTO artists (id, name, benchmarks) VALUES (?, ?, ?)').run('bad', '损坏', '[broken');
    else f.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('style_roll_v1:owner:bad', '{broken');
    for (const path of [`/api/vibes/${id}`, `/api/vibes/${id}/encodings/${encodingId}`]) {
      const response = await f.request(path, undefined, 'DELETE');
      expect(response.status).toBe(409); expect(response.body.error).toContain('无法核对');
    }
    expect(f.files).toEqual(before); expect((await f.request(`/api/vibes/${id}`)).body.item.encodings).toHaveLength(1);
  });

  it('普通字符串设置与空的旧参数不锁死无引用资产的显式删除', async () => {
    const f = fixture(true), result = await f.import(document()), id = result.body.item.id;
    await archive(f, id);
    f.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('text-setting', '普通文字');
    f.sqlite.prepare('INSERT INTO chains (id, name, params) VALUES (?, ?, ?)').run('empty', '旧条目', '');
    expect((await f.request(`/api/vibes/${id}`, undefined, 'DELETE')).status).toBe(200);
  });

  it.each(['风格串封面', '收藏原图', '画师原图', '画师预览', '画师样张', '提示词参考', '设置图片', '编码地址'])('%s 的 Vibe API 地址仍在使用时拒绝删除，查询参数不绕过引用', async source => {
    const f = fixture(true), result = await f.import(document()), id = result.body.item.id, encodingId = result.body.item.encodings[0].id;
    await archive(f, id);
    const url = source === '编码地址' ? `/api/vibes/${id}/encodings/${encodingId}/data?cache=1` : `/api/vibes/${id}/${source === '设置图片' ? 'thumbnail' : 'image'}?cache=1`;
    if (source === '风格串封面') f.sqlite.prepare('INSERT INTO chains (id, name, preview_image) VALUES (?, ?, ?)').run('ref', '封面', url);
    else if (source === '收藏原图') f.sqlite.prepare('INSERT INTO inspirations (id, title, image_url) VALUES (?, ?, ?)').run('ref', '收藏', url);
    else if (source.startsWith('画师')) f.sqlite.prepare(`INSERT INTO artists (id, name, ${source === '画师原图' ? 'image_url' : source === '画师预览' ? 'preview_url' : 'benchmarks'}) VALUES (?, ?, ?)`).run('ref', '画师', source === '画师样张' ? JSON.stringify([url]) : url);
    else f.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('reference', JSON.stringify(source === '提示词参考' ? { _promptLibrary: { references: [{ url }] } } : { imageUrl: url }));
    const before = new Map(f.files);
    expect((await f.request(`/api/vibes/${id}`, undefined, 'DELETE')).status).toBe(409);
    if (source === '编码地址') expect((await f.request(`/api/vibes/${id}/encodings/${encodingId}`, undefined, 'DELETE')).status).toBe(409);
    expect(f.files).toEqual(before);
  });

  it.each(['其他 Vibe', '角色参考', '历史图片', '收藏图片', '风格串封面', '设置图片', '共享编码'])('删除元数据后保留%s 共用的同一 R2 字节', async source => {
    const f = fixture(true), result = await f.import(document()), id = result.body.item.id;
    await archive(f, id);
    const asset = f.sqlite.prepare('SELECT * FROM vibe_assets WHERE id = ?').get(id)!;
    const sharedKey = source === '共享编码' ? f.sqlite.prepare('SELECT encoding_key FROM vibe_encodings_all WHERE vibe_id = ?').get(id)!.encoding_key as string : asset.original_key as string;
    const sharedBytes = f.files.get(sharedKey);
    if (source === '其他 Vibe' || source === '共享编码') {
      f.sqlite.prepare('INSERT INTO vibe_assets (id, name, source_hash, original_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('shared', '保留', 'shared-hash', source === '其他 Vibe' ? sharedKey : null, 1, 1);
      if (source === '共享编码') f.sqlite.prepare(`INSERT INTO vibe_encodings (id, vibe_id, model, model_key, information_extracted, encoding_key, encoding_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('shared-code', 'shared', 'nai-diffusion-4-5-full', 'v4-5full', 1, sharedKey, hash(Buffer.from(encoding, 'base64')), 1);
    } else if (source === '角色参考') f.sqlite.prepare('INSERT INTO character_reference_assets (id, name, source_hash, original_key, original_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('ref', '参考', 'reference-hash', sharedKey, 'image/png', 1, 1);
    else if (source === '历史图片') f.sqlite.prepare('INSERT INTO local_generation_history (id, user_id, image_key, created_at) VALUES (?, ?, ?, ?)').run('ref', 'owner', sharedKey, 1);
    else if (source === '收藏图片') f.sqlite.prepare('INSERT INTO inspirations (id, title, image_key) VALUES (?, ?, ?)').run('ref', '收藏', sharedKey);
    else if (source === '风格串封面') f.sqlite.prepare('INSERT INTO chains (id, name, preview_image) VALUES (?, ?, ?)').run('ref', '封面', `/api/assets/${encodeURIComponent(sharedKey)}`);
    else f.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('image', JSON.stringify({ imageUrl: `/api/assets/${sharedKey}?cache=1` }));
    const deleted = await f.request(`/api/vibes/${id}`, undefined, 'DELETE');
    expect(deleted.status).toBe(200); expect(f.files.get(sharedKey)).toEqual(sharedBytes);
    expect((await f.request(`/api/vibes/${id}`)).status).toBe(404);
  });

  it('引用在删除前迟到写入时，事务内再次核对并拒绝删除', async () => {
    const f = fixture(true), result = await f.import(document()), id = result.body.item.id;
    await archive(f, id); const before = new Map(f.files);
    f.beforeNextBatch(() => f.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('late', JSON.stringify({ params: { vibes: { slots: result.body.slots } } })));
    expect((await f.request(`/api/vibes/${id}`, undefined, 'DELETE')).status).toBe(409);
    expect(f.files).toEqual(before); expect((await f.request(`/api/vibes/${id}`)).body.item.encodings).toHaveLength(1);
  });

  it('数据库事务失败回滚旧新编码和资产，不先清理任何文件', async () => {
    const f = fixture(true), result = await f.import(document()), id = result.body.item.id;
    addLegacyEncoding(f, id); await archive(f, id); const before = new Map(f.files);
    f.sqlite.exec("CREATE TRIGGER block_vibe_delete BEFORE DELETE ON vibe_encoding_variants BEGIN SELECT RAISE(ABORT, 'synthetic deletion failure'); END");
    await expect(f.request(`/api/vibes/${id}`, undefined, 'DELETE')).rejects.toThrow('synthetic deletion failure');
    expect(f.files).toEqual(before); expect((await f.request(`/api/vibes/${id}`)).body.item.encodings).toHaveLength(2);
  });

  it('文件删除失败明确返回部分完成，不能伪报成功', async () => {
    const f = fixture(true), result = await f.import(document()), id = result.body.item.id;
    await archive(f, id); const before = new Map(f.files);
    vi.spyOn(f.bucket, 'delete').mockRejectedValue(new Error('synthetic R2 failure'));
    const response = await f.request(`/api/vibes/${id}`, undefined, 'DELETE');
    expect(response.status).toBe(503); expect(response.body.error).toContain('文件清理失败'); expect(response.body.success).not.toBe(true);
    expect(f.files).toEqual(before); expect((await f.request(`/api/vibes/${id}`)).status).toBe(404);
  });
});

function fixture(fullSchema = false) {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite);
  if (fullSchema) sqlite.exec(INIT_SQL);
  let beforeBatch: (() => void) | undefined;
  const files = new Map<string, ArrayBuffer>();
  const db = { prepare(sql: string) {
    let args: any[] = [];
    return { bind(...values: any[]) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { return { success: true, meta: { changes: sqlite.prepare(sql).run(...args).changes } }; } };
  }, async batch(statements: Array<{ run(): Promise<unknown> }>) {
    const before = beforeBatch; beforeBatch = undefined; before?.();
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  const bucket = {
    async put(key: string, body: BodyInit) { files.set(key, await new Response(body).arrayBuffer()); },
    async get(key: string) { const bytes = files.get(key); return bytes ? { body: new Response(bytes.slice(0)).body! } : null; },
    async delete(key: string) { files.delete(key); },
  };
  const env = { BUCKET: bucket } as unknown as Env;
  const request = async (path: string, body?: unknown, method = body ? 'POST' : 'GET') => {
    const req = new Request(`http://synthetic.test${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const response = await handleVibeRoute({ request: req, path, url: new URL(req.url), method, db, env } as RouteContext);
    if (!response) throw new Error(`未处理合成请求 ${path}`);
    return { status: response.status, body: await response.json() as any, headers: response.headers };
  };
  return { sqlite, files, bucket, db, env, request, beforeNextBatch: (callback: () => void) => { beforeBatch = callback; }, import: (value: unknown) => request('/api/vibes/import', { document: value }) };
}

describe('官方 Vibe 文件往返', () => {
  const different = Buffer.from('different-encoding'.repeat(10)).toString('base64');
  const bundle = (...vibes: unknown[]) => ({ identifier: 'novelai-vibe-transfer-bundle', version: 1, vibes });
  const encodedDocument = () => document(undefined, { type: 'encoding', image: undefined, id: hash(encoding) });

  it('同图四个提取量不选择变体也完整导出，并逐份恢复相同编码字节', async () => {
    const f = fixture();
    const variants = Object.fromEntries([0.6, 0.5, 0.4, 0.3].map(information => [String(information), variant(information,
      Buffer.from(`synthetic-${information}-`.repeat(16)).toString('base64'))]));
    const result = await f.import(document({ 'v4-5full': variants }));
    const exported = await f.request(`/api/vibes/${result.body.item.id}/file`);
    expect(exported.status).toBe(200); expect(Object.keys(exported.body.encodings['v4-5full'])).toHaveLength(4);
    for (const value of Object.values(variants)) expect(exported.body.encodings['v4-5full'][hash(`information_extracted:${value.params.information_extracted}`)]).toEqual(value);
    const target = fixture(), restored = await target.import(exported.body);
    expect(restored.body.item.encodings).toHaveLength(4);
    for (const item of restored.body.item.encodings) {
      const data = await target.request(`/api/vibes/${restored.body.item.id}/encodings/${item.id}/data`);
      expect(data.body.encoding).toBe(variants[String(item.informationExtracted)].encoding);
    }
  });

  it('组合末项与已有编码冲突时，前项不写 D1 或 R2', async () => {
    const f = fixture();
    await f.import(document());
    const before = new Map(f.files), put = vi.spyOn(f.env.BUCKET!, 'put');
    const response = await f.import(bundle(encodedDocument(), document({ 'v4-5full': { a: variant(0.7, different) } })));
    expect(response.status).toBe(400); expect(response.body.error).toContain('冲突');
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM vibe_assets').get()?.count).toBe(1);
    expect(put).not.toHaveBeenCalled(); expect(f.files).toEqual(before);
  });

  it('单文档末个变体冲突时，前面的新编码不产生孤儿对象', async () => {
    const f = fixture();
    await f.import(document());
    const before = new Map(f.files), put = vi.spyOn(f.env.BUCKET!, 'put');
    const response = await f.import(document({ 'v4-5full': { fresh: variant(1), conflict: variant(0.7, different) } }));
    expect(response.status).toBe(400); expect(response.body.error).toContain('冲突');
    expect(f.files).toEqual(before); expect(put).not.toHaveBeenCalled();
  });

  it('组合内部同图同参数冲突也在所有写入前拒绝', async () => {
    const f = fixture(), put = vi.spyOn(f.env.BUCKET!, 'put');
    const response = await f.import(bundle(document(), document({ 'v4-5full': { a: variant(0.7, different) } })));
    expect(response.status).toBe(400); expect(response.body.error).toContain('冲突');
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM vibe_assets').get()?.count).toBe(0);
    expect(f.files.size).toBe(0); expect(put).not.toHaveBeenCalled();
  });

  it('R2 写入中途失败清理整包新对象，保留旧对象并返回通用 500', async () => {
    const f = fixture();
    await f.import(document());
    const before = new Map(f.files), originalPut = f.env.BUCKET!.put.bind(f.env.BUCKET!);
    let calls = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(f.env.BUCKET!, 'put').mockImplementation(async (...args) => {
      await originalPut(...args);
      if (++calls === 2) throw new Error('R2 internal credential detail');
      return undefined;
    });
    const response = await f.import(bundle(document({ 'v4-5full': { a: variant(1) } }), encodedDocument()));
    expect(response).toMatchObject({ status: 500, body: { error: '请求处理失败，请查看本地服务日志' } });
    expect(f.files).toEqual(before);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM vibe_assets').get()?.count).toBe(1);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM vibe_encodings_all').get()?.count).toBe(1);
  });

  it('D1 提交失败整包回滚并清理原图、缩略图和编码，不泄露内部错误', async () => {
    const f = fixture();
    await f.request('/api/vibes');
    f.sqlite.exec(`CREATE TRIGGER fail_import BEFORE INSERT ON vibe_encoding_variants
      WHEN NEW.model = 'nai-diffusion-4-full' BEGIN SELECT RAISE(ABORT, 'D1 internal table detail'); END`);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await f.import(bundle(encodedDocument(), document({ v4full: { a: variant() } } as any, { thumbnail: `data:image/png;base64,${image}` })));
    expect(response).toMatchObject({ status: 500, body: { error: '请求处理失败，请查看本地服务日志' } });
    expect(f.files.size).toBe(0);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM vibe_assets').get()?.count).toBe(0);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM vibe_encodings_all').get()?.count).toBe(0);
  });

  it('失败补偿中一个 R2 删除失败仍继续清理剩余新对象', async () => {
    const f = fixture();
    await f.request('/api/vibes');
    f.sqlite.exec(`CREATE TRIGGER fail_import BEFORE INSERT ON vibe_encoding_variants BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);
    const originalDelete = f.env.BUCKET!.delete.bind(f.env.BUCKET!);
    const removed: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(f.env.BUCKET!, 'delete').mockImplementation(async key => {
      removed.push(String(key));
      if (removed.length === 1) throw new Error('synthetic delete failure');
      return originalDelete(key);
    });
    const response = await f.import(document(undefined, { thumbnail: `data:image/png;base64,${image}` }));
    expect(response.status).toBe(500); expect(removed).toHaveLength(3); expect(f.files.size).toBe(1);
  });

  it('非法 JSON 和图片仍作为校验错误返回 400', async () => {
    const f = fixture();
    expect((await f.request('/api/vibes/import', { fileText: '{broken' })).status).toBe(400);
    expect((await f.import(document(undefined, { image: 'broken%%%' }))).status).toBe(400);
    expect(f.files.size).toBe(0);
  });

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
