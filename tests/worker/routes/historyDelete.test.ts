// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleHistoryRoute } from '../../../worker/routes/historyRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../../worker/routes/types';

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });

async function fixture() {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite); sqlite.exec(INIT_SQL);
  const files = new Set<string>(), failures = new Set<string>(), attempted: string[] = [];
  const db = { prepare(sql: string) {
    let args: any[] = [];
    return { bind(...values: any[]) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { return { success: true, meta: { changes: sqlite.prepare(sql).run(...args).changes } }; } };
  }, async batch(statements: Array<{ run(): Promise<unknown> }>) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
  } } as unknown as D1Database;
  const bucket = { async delete(key: string) {
    attempted.push(key);
    if (failures.has(key)) throw new Error('synthetic R2 delete timeout');
    files.delete(key);
  } };
  const request = async (path: string, body?: unknown, method = body === undefined ? 'DELETE' : 'POST') => {
    const req = new Request(`http://synthetic.test${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return (await handleHistoryRoute({ request: req, url: new URL(req.url), path, method, db,
      currentUser: { id: 'owner', role: 'admin' }, env: { BUCKET: bucket, LOCAL_HISTORY_ENABLED: 'true' } } as unknown as RouteContext))!;
  };
  await request('/api/local-history/browse', undefined, 'GET');
  const addHistory = (id: string, key = `synthetic/${id}`, user = 'owner', created = 1) => {
    sqlite.prepare('INSERT INTO local_generation_history (id,user_id,image_key,created_at) VALUES (?,?,?,?)').run(id, user, key, created);
    files.add(key);
    return key;
  };
  const addInspiration = (id: string, key: string) => {
    sqlite.prepare('INSERT INTO inspirations (id,user_id,title,image_key,image_url,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, 'owner', '合成收藏', key, `/api/assets/${encodeURIComponent(key)}`, 1);
    files.add(key);
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return { sqlite, files, failures, attempted, request, addHistory, addInspiration };
}

describe('历史与收藏删除的 R2 容错（仅内存资料）', () => {
  it.each(['original', 'mask'])('历史批量删除的 %s 清理失败不阻断其他对象和历史', async failure => {
    const f = await fixture();
    const first = f.addHistory('first'), second = f.addHistory('second');
    const mask = 'local-history/owner/first.edit-mask';
    f.files.add(mask);
    f.failures.add(failure === 'original' ? first : mask);
    const response = await f.request('/api/local-history');
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ deletedCount: 2 });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM local_generation_history').get()?.count).toBe(0);
    expect(f.attempted).toContain(first); expect(f.attempted).toContain(second); expect(f.attempted).toContain(mask);
    expect(f.files.has(second)).toBe(false);
    expect(f.files.has(mask)).toBe(failure === 'mask');
    expect(f.files.has(first)).toBe(failure === 'original');
  });

  it.each(['history', 'collection', 'chain', 'promptReference', 'artist', 'sample'])('仍被 %s 引用的同内容原图不能删除', async reference => {
    const f = await fixture(), key = f.addHistory('removed'), url = `/api/assets/${encodeURIComponent(key)}`;
    if (reference === 'history') f.addHistory('other', key, 'other-owner');
    if (reference === 'collection') f.addInspiration('saved', key);
    if (reference === 'chain' || reference === 'promptReference') f.sqlite.prepare('INSERT INTO chains (id,name,preview_image,params) VALUES (?,?,?,?)')
      .run('chain', '合成资料', reference === 'chain' ? url : '', JSON.stringify({ _promptLibrary: { references: [{ url }] } }));
    if (reference === 'artist') f.sqlite.prepare('INSERT INTO artists (id,name,image_url) VALUES (?,?,?)').run('artist', '合成画师', url);
    if (reference === 'sample') f.sqlite.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('artist_sample_v1:synthetic', JSON.stringify({ imageUrl: url }));
    expect((await f.request('/api/local-history/removed')).status).toBe(200);
    expect(f.files.has(key)).toBe(true); expect(f.attempted).not.toContain(key);
    expect(f.sqlite.prepare('SELECT id FROM local_generation_history WHERE id = ?').get('removed')).toBeUndefined();
  });

  it('收藏批量删除遇到 R2 故障仍处理其余项，保留历史引用的原图', async () => {
    const f = await fixture();
    f.addInspiration('first', 'synthetic/first'); f.addInspiration('second', 'synthetic/second');
    const shared = f.addHistory('history'); f.addInspiration('shared', shared);
    f.failures.add('synthetic/first');
    const response = await f.request('/api/inspirations/bulk-delete', { ids: ['first', 'second', 'shared'] });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ deletedCount: 3 });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM inspirations').get()?.count).toBe(0);
    expect(f.files.has('synthetic/second')).toBe(false); expect(f.files.has(shared)).toBe(true);
    expect(f.attempted).toContain('synthetic/second'); expect(f.attempted).not.toContain(shared);
  });

  it('单项历史和收藏删除以已提交的数据库结果为准，R2 故障不改为失败', async () => {
    const f = await fixture(), key = f.addHistory('single'); f.failures.add(key);
    expect((await f.request('/api/local-history/single')).status).toBe(200);
    f.addInspiration('saved', key);
    expect((await f.request('/api/inspirations/saved')).status).toBe(200);
    expect(f.files.has(key)).toBe(true);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM inspirations').get()?.count).toBe(0);
  });

  it.each(['not-a-number', 'Infinity', {}, []])('cleanup 拒绝非法 keepCount %j 且不删除任何资料', async keepCount => {
    const f = await fixture(); f.addHistory('first'); f.addHistory('second');
    const response = await f.request('/api/local-history/cleanup', { keepCount });
    expect(response.status).toBe(400);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM local_generation_history').get()?.count).toBe(2);
    expect(f.attempted).toEqual([]);
  });
});
