import { DatabaseSync } from 'node:sqlite';
import { encode } from 'fast-png';
import { describe, it, expect } from 'vitest';
import { handleStyleCollectorRoute } from '../../../worker/routes/styleCollectorRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../../worker/routes/types';
import { isUntestedChain, UNTESTED_CHAIN_TAG } from '../../../services/chainStatus';

const metadata = { prompt: 'artist:synthetic, original scene', uc: 'lowres', steps: 23, sampler: 'k_euler_ancestral', seed: 42, Source: 'NovelAI' };
function png(value: unknown = metadata) {
  const source = Buffer.from(encode({ width: 64, height: 64, channels: 4, data: new Uint8Array(64 * 64 * 4).fill(255) }));
  const content = Buffer.from(`Comment\0${JSON.stringify(value)}`);
  const chunk = Buffer.alloc(content.length + 12); chunk.writeUInt32BE(content.length); chunk.write('tEXt', 4); content.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([source.subarray(0, -12), chunk, source.subarray(-12)]).toString('base64');
}
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(INIT_SQL);
  const prepare = (query: string) => {
    let values: any[] = [];
    return { bind(...next: any[]) { values = next; return this; },
      async first() { return sqlite.prepare(query).get(...values) || null; },
      async all() { return { results: sqlite.prepare(query).all(...values) }; },
      async run() { const info = sqlite.prepare(query).run(...values); return { success: true, results: [], meta: { changes: Number(info.changes) } }; },
    };
  };
  const db = { prepare, async batch(statements: { run: () => Promise<unknown> }[]) {
    sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  const assets = new Map<string, ArrayBuffer>();
  const bucket = { async put(key: string, bytes: ArrayBuffer) { assets.set(key, bytes); }, async delete(key: string) { assets.delete(key); } };
  const invoke = (action: string, body: unknown, headers: Record<string, string> = { 'x-nai-client-ip': '127.0.0.1', 'x-nai-collector-control': 'true' }) => {
    const path = `/api/internal/style-collector/${action}`;
    const request = new Request(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    return handleStyleCollectorRoute({ path, method: 'POST', request, db, env: { BUCKET: bucket }, currentUser: { id: 'test-owner', username: 'test-owner' } } as unknown as RouteContext);
  };
  const session = '00000000-0000-4000-8000-000000000001';
  const collect = (image = png(), sourceUrl = 'https://example.com/a.png?signature=1') => invoke('import', { session, image, sourceUrl, finalUrl: sourceUrl, name: 'synthetic.png' });
  return { sqlite, db, bucket, assets, invoke, session, collect };
}

describe('后台收集原子入库（隔离 SQLite 与内存封面）', () => {
  it('收藏模式保存没有生成信息的原图及来源，不补造配置；重复复制去重，取消收藏后可恢复', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    const image = png({ Software: '普通图片' });
    const body = { session: f.session, image, format: 'png', name: 'sample.png', sourceUrl: 'https://example.com/a.png?signature=1' };
    expect((await f.invoke('collection', body))?.status).toBe(200);
    const row = f.sqlite.prepare('SELECT * FROM inspirations').get() as any;
    expect(row.archived).toBe(0); expect(row.board_id).toBeNull(); expect(row.prompt).toBe(''); expect(row.params).toBeNull();
    expect(row.source_url).toBe(body.sourceUrl); expect(JSON.parse(row.tags)).toEqual([]);
    expect(Buffer.from(f.assets.get(row.image_key)!)).toEqual(Buffer.from(image, 'base64'));
    expect(await (await f.invoke('collection', { ...body, sourceUrl: 'https://example.com/a.png?signature=2' }))?.json()).toMatchObject({ outcome: 'skipped' });
    f.sqlite.prepare('UPDATE inspirations SET archived = 1, tags = ?').run('["自选标签"]');
    expect(await (await f.invoke('collection', body))?.json()).toMatchObject({ outcome: 'saved', id: row.id });
    expect(f.sqlite.prepare('SELECT archived, tags FROM inspirations').get()).toMatchObject({ archived: 0, tags: '["自选标签"]' });
    expect(f.assets.size).toBe(1); expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM chains').get()?.n).toBe(0); f.sqlite.close();
  });
  it('收藏有元数据时保留完整参数，图片非法或结束期间返回不残留新图片', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    const body = { session: f.session, image: png(), format: 'png', rawMetadata: JSON.stringify(metadata) };
    await f.invoke('collection', body);
    const row = f.sqlite.prepare('SELECT * FROM inspirations').get() as any;
    expect(row.prompt).toBe(metadata.prompt); expect(row.negative_prompt).toBe('lowres'); expect(JSON.parse(row.params)).toMatchObject({ seed: 42, steps: 23 });
    expect((await f.invoke('collection', { ...body, image: 'aW52YWxpZA==' }))?.status).toBe(400);
    expect((await f.invoke('collection', { ...body, format: 'gif' }))?.status).toBe(400);
    const put = f.bucket.put.bind(f.bucket);
    f.bucket.put = async (key, bytes) => { await put(key, bytes); await f.invoke('session', { session: '' }); };
    expect((await f.invoke('collection', { ...body, image: png({ ...metadata, seed: 43 }) }))?.status).toBe(409);
    expect(f.assets.size).toBe(1); expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM inspirations').get()?.n).toBe(1); f.sqlite.close();
  });
  it('收藏写库失败只回滚本次分配图片，保留已有资产', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    f.assets.set('existing', new ArrayBuffer(0)); f.db.batch = async () => { throw new Error('合成写库失败'); };
    await expect(f.invoke('collection', { session: f.session, image: png(), format: 'png' })).rejects.toThrow('合成写库失败');
    expect([...f.assets.keys()]).toEqual(['existing']); expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM inspirations').get()?.n).toBe(0); f.sqlite.close();
  });
  it('原文存入组合库，空白及权重逐字保留，同一操作重试只有一条，不生成封面或分类', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    const text = '  {{snow}}, 1.2::hair::\r\n[smile]  ';
    const body = { session: f.session, id: '00000000-0000-4000-8000-000000000002', text, name: '' };
    expect((await f.invoke('text', body))?.status).toBe(200);
    expect((await f.invoke('text', body))?.status).toBe(200);
    const rows = f.sqlite.prepare('SELECT * FROM chains').all() as any[];
    expect(rows).toHaveLength(1); expect(rows[0].type).toBe('preset'); expect(rows[0].base_prompt).toBe(text);
    expect(JSON.parse(rows[0].params)).toEqual({ _collectedPrompt: 1 }); expect(JSON.parse(rows[0].tags)).toEqual([]);
    expect(f.assets.size).toBe(0); f.sqlite.close();
  });
  it('原文可指定六类归属，逐字保留并落在对应条目库，未知分类拒绝', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    const text = '  {{snow}}, 1.2::hair::\r\n[smile]  ';
    const body = { session: f.session, id: '00000000-0000-4000-8000-000000000003', text, name: '雪天', category: 'appearance' };
    expect((await f.invoke('text', body))?.status).toBe(200);
    const rows = f.sqlite.prepare('SELECT * FROM chains').all() as any[];
    expect(rows).toHaveLength(1); expect(rows[0].type).toBe('appearance'); expect(rows[0].name).toBe('雪天');
    expect(rows[0].base_prompt).toBe(text);
    expect(JSON.parse(rows[0].params)).toEqual({ _collectedPrompt: 1, _collectedCategory: 'appearance' });
    for (const category of ['style', 'preset', 'nope']) {
      expect((await f.invoke('text', { ...body, id: '00000000-0000-4000-8000-000000000004', category }))?.status).toBe(400);
    }
    f.sqlite.close();
  });
  it('文字收录拒绝空白、超长、错误操作 ID 和已结束会话，不覆盖既有内容', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    const body = { session: f.session, id: '00000000-0000-4000-8000-000000000002', text: 'original' };
    for (const text of [null, ' \r\n', 'x'.repeat(65537)]) expect((await f.invoke('text', { ...body, text }))?.status).toBe(400);
    expect((await f.invoke('text', { ...body, id: 'bad' }))?.status).toBe(400);
    await f.invoke('text', body);
    expect((await f.invoke('text', { ...body, text: 'changed' }))?.status).toBe(409);
    await f.invoke('session', { session: '' });
    expect((await f.invoke('text', body))?.status).toBe(409);
    expect(f.sqlite.prepare('SELECT base_prompt FROM chains').get()?.base_prompt).toBe('original'); f.sqlite.close();
  });
  it('保存完整提示词、参数、封面与来源，仅添加待实测状态', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    const result = await f.collect(); expect(result?.status).toBe(200);
    const row = f.sqlite.prepare('SELECT * FROM chains').get() as any;
    expect(row.base_prompt).toBe(metadata.prompt); expect(row.negative_prompt).toBe('lowres');
    expect(JSON.parse(row.params)).toMatchObject({ steps: 23, seed: 42, qualityToggle: false, ucPreset: 4 });
    expect(JSON.parse(row.variable_values)).toEqual({}); expect(JSON.parse(row.tags)).toEqual([UNTESTED_CHAIN_TAG]);
    expect(isUntestedChain({ tags: JSON.parse(row.tags) })).toBe(true);
    expect(row.description).toContain('signature=1'); expect(f.assets.size).toBe(1); f.sqlite.close();
  });
  it('不同签名同内容、重启后同内容不重复；风格串删除后可重收', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session }); await f.collect();
    // 已完成实测的条目重复收集不能被重新标记为待实测。
    f.sqlite.prepare('UPDATE chains SET tags = ?').run(JSON.stringify(['个人分类']));
    await f.invoke('session', { session: '' }); await f.invoke('session', { session: f.session });
    const duplicate = await f.collect(png(), 'https://example.com/a.png?signature=2');
    expect(await duplicate?.json()).toMatchObject({ outcome: 'skipped' }); expect(f.assets.size).toBe(1);
    expect(JSON.parse(String(f.sqlite.prepare('SELECT tags FROM chains').get()?.tags))).toEqual(['个人分类']);
    const previousId = f.sqlite.prepare('SELECT id FROM chains').get()?.id;
    f.sqlite.exec('DELETE FROM chains'); await f.collect();
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM chains').get()?.n).toBe(1);
    expect(f.sqlite.prepare('SELECT id FROM chains').get()?.id).not.toBe(previousId);
    expect(JSON.parse(String(f.sqlite.prepare('SELECT tags FROM chains').get()?.tags))).toEqual([UNTESTED_CHAIN_TAG]); f.sqlite.close();
  });
  it('结构化角色提示词允许空全局正文，不存入 JSON 字面量', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    await f.collect(png({ ...metadata, prompt: '', v4_prompt: { caption: { base_caption: '', char_captions: [{ char_caption: '1girl, red hair', centers: [{ x: 0.2, y: 0.8 }] }] } }, v4_negative_prompt: { caption: { base_caption: 'bad anatomy', char_captions: [{ char_caption: 'blue hair' }] } } }));
    const row = f.sqlite.prepare('SELECT * FROM chains').get() as any;
    expect(row.base_prompt).toBe(''); expect(JSON.parse(row.params).characters[0]).toMatchObject({ prompt: '1girl, red hair', negativePrompt: 'blue hair', x: 0.2, y: 0.8 }); f.sqlite.close();
  });
  it('软件名称或仅默认参数的图片跳过，不写任何永久图片', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    expect(await (await f.collect(png({ Software: 'NovelAI', steps: 28 })))?.json()).toMatchObject({ outcome: 'skipped' });
    expect(f.assets.size).toBe(0); expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM chains').get()?.n).toBe(0); f.sqlite.close();
  });
  it('封面写入期间结束后事务无法新建条目，回滚本次副本', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    const put = f.bucket.put.bind(f.bucket);
    f.bucket.put = async (key, bytes) => { await put(key, bytes); await f.invoke('session', { session: '' }); };
    expect((await f.collect())?.status).toBe(409); expect(f.assets.size).toBe(0);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM chains').get()?.n).toBe(0); f.sqlite.close();
  });
  it('事务失败不残留空条目或封面，保留既有资产', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    f.assets.set('existing-user-image', new ArrayBuffer(0));
    f.db.batch = async () => { throw new Error('synthetic DB failure'); };
    await expect(f.collect()).rejects.toThrow('synthetic DB failure');
    expect([...f.assets.keys()]).toEqual(['existing-user-image']); expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM chains').get()?.n).toBe(0); f.sqlite.close();
  });
  it('检查后另一个请求已保存同内容，事务仍去重并回滚自己的封面', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    let raced = false; const put = f.bucket.put.bind(f.bucket);
    f.bucket.put = async (key, bytes) => { await put(key, bytes); if (!raced) { raced = true; await f.collect(); } };
    expect(await (await f.collect())?.json()).toMatchObject({ outcome: 'skipped' });
    expect(f.assets.size).toBe(1); expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM chains').get()?.n).toBe(1); f.sqlite.close();
  });
  it('旧会话和无内部校验的请求不入库', async () => {
    const f = fixture(); expect((await f.collect())?.status).toBe(409);
    expect((await f.invoke('session', { session: f.session }, {}))?.status).toBe(403); expect(f.assets.size).toBe(0); f.sqlite.close();
  });
  it('已校验的内部元数据避免再次解码像素，仍检查原图头和有效生成信息', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    const valid = await f.invoke('import', { session: f.session, image: png(), rawMetadata: JSON.stringify(metadata), name: 'synthetic.png' });
    expect(await valid?.json()).toMatchObject({ outcome: 'saved' });
    const invalid = await f.invoke('import', { session: f.session, image: Buffer.from('<html>not an image</html>').toString('base64'), rawMetadata: JSON.stringify(metadata) });
    expect(invalid?.status).toBe(400); expect(f.assets.size).toBe(1); f.sqlite.close();
  });
});
