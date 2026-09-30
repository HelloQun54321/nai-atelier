import { DatabaseSync } from 'node:sqlite';
import { encode } from 'fast-png';
import { describe, it, expect } from 'vitest';
import { handleStyleCollectorRoute } from './styleCollectorRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from './types';

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
  it('保存完整提示词、参数、封面、来源及收集中标签', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session });
    const result = await f.collect(); expect(result?.status).toBe(200);
    const row = f.sqlite.prepare('SELECT * FROM chains').get() as any;
    expect(row.base_prompt).toBe(metadata.prompt); expect(row.negative_prompt).toBe('lowres');
    expect(JSON.parse(row.params)).toMatchObject({ steps: 23, seed: 42, qualityToggle: false, ucPreset: 4 });
    expect(JSON.parse(row.variable_values)).toEqual({}); expect(JSON.parse(row.tags)).toEqual(['收集中']);
    expect(row.description).toContain('signature=1'); expect(f.assets.size).toBe(1); f.sqlite.close();
  });
  it('不同签名同内容、重启后同内容不重复；风格串删除后可重收', async () => {
    const f = fixture(); await f.invoke('session', { session: f.session }); await f.collect();
    await f.invoke('session', { session: '' }); await f.invoke('session', { session: f.session });
    const duplicate = await f.collect(png(), 'https://example.com/a.png?signature=2');
    expect(await duplicate?.json()).toMatchObject({ outcome: 'skipped' }); expect(f.assets.size).toBe(1);
    const previousId = f.sqlite.prepare('SELECT id FROM chains').get()?.id;
    f.sqlite.exec('DELETE FROM chains'); await f.collect();
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM chains').get()?.n).toBe(1);
    expect(f.sqlite.prepare('SELECT id FROM chains').get()?.id).not.toBe(previousId); f.sqlite.close();
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
