import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import worker from '../../worker';
import { handleHistoryRoute } from '../../worker/routes/historyRoutes';
import { deleteR2File, getLocalOwner, handleSettingsRoute } from '../../worker/routes/settingsRoutes';
import { addColumnIfMissing, INIT_SQL, type D1Database, type Env, type RouteContext } from '../../worker/routes/types';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks(); });
const fixture = () => {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite); sqlite.exec(INIT_SQL);
  const queries: string[] = [];
  let fail: RegExp | undefined;
  let pendingBatch = Promise.resolve<unknown>(undefined);
  const db = { prepare(query: string) {
    queries.push(query); let values: any[] = [];
    return {
      bind(...next: any[]) { values = next; return this; },
      async first() { return sqlite.prepare(query).get(...values) || null; },
      async all() { return { results: sqlite.prepare(query).all(...values) }; },
      async run() {
        if (fail?.test(query)) throw new Error('synthetic database failure');
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
  const bucket = { delete: vi.fn(async (_key: string) => {}), get: vi.fn(), put: vi.fn() };
  const env = { DB: db, BUCKET: bucket, PERSONAL_MODE_ENABLED: 'true', LOCAL_HISTORY_ENABLED: 'true' } as unknown as Env;
  const invoke = async (path: string, method = 'DELETE', body?: unknown) => {
    const request = new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const context = { request, url: new URL(request.url), path, method, db, env, currentUser: { id: 'owner', role: 'admin' } } as RouteContext;
    return path.startsWith('/api/local-history') || path.startsWith('/api/inspirations') ? handleHistoryRoute(context) : handleSettingsRoute(context);
  };
  return { sqlite, db, env, bucket, queries, invoke, fail: (pattern: RegExp) => { fail = pattern; } };
};

it('存储夹具批处理失败时回滚前序写入，后续批次仍可提交', async () => {
  const f = fixture();
  await expect(f.db.batch([
    f.db.prepare("INSERT INTO settings (key, value) VALUES ('batch-fixture', 'first')"),
    f.db.prepare("INSERT INTO settings (key, value) VALUES ('batch-fixture', 'duplicate')"),
  ])).rejects.toThrow();
  expect(f.sqlite.prepare("SELECT value FROM settings WHERE key = 'batch-fixture'").get()).toBeUndefined();
  await f.db.batch([f.db.prepare("INSERT INTO settings (key, value) VALUES ('batch-fixture', 'next')")]);
  expect(f.sqlite.prepare("SELECT value FROM settings WHERE key = 'batch-fixture'").get()?.value).toBe('next');
});

it('提示词库引用历史原件，删历史仍可用，最后一个库引用释放后才清理', async () => {
  const f = fixture(), key = 'local-history/owner/synthetic.png';
  f.sqlite.prepare('INSERT INTO local_generation_history (id,user_id,image_key,created_at) VALUES (?,?,?,1)').run('ref-history', 'owner', key);
  f.sqlite.exec("INSERT INTO chains (id,user_id,name,type) VALUES ('lib-a','owner','A','appearance'), ('lib-b','owner','B','scene')");
  const params = { seed: 19, _promptLibrary: { bilingual: 'synthetic', references: [{ id: 'ref-history', url: '/api/local-history/ref-history/image', prompt: 'synthetic' }] } };
  expect((await f.invoke('/api/chains/lib-a', 'PUT', { params }))?.status).toBe(200);
  const saved = JSON.parse(f.sqlite.prepare("SELECT params FROM chains WHERE id='lib-a'").get()!.params as string);
  expect(saved.seed).toBe(19); expect(saved._promptLibrary.references[0].url).toBe('/api/assets/' + encodeURIComponent(key));
  expect((await f.invoke('/api/chains/lib-b', 'PUT', { params: saved }))?.status).toBe(200);
  expect((await f.invoke('/api/local-history/ref-history'))?.status).toBe(200);
  expect(f.bucket.delete).not.toHaveBeenCalledWith(key);
  await f.invoke('/api/chains/lib-a'); expect(f.bucket.delete).not.toHaveBeenCalledWith(key);
  await f.invoke('/api/chains/lib-b'); expect(f.bucket.delete).toHaveBeenCalledWith(key);
});

it('提示词库参数保存失败保留旧参考图，非法或已删除的来源不覆盖旧参数', async () => {
  const f = fixture();
  const params = { seed: 17, _promptLibrary: { references: [{ id: 'original', url: '/api/assets/original.png' }] } };
  f.sqlite.prepare('INSERT INTO chains (id,user_id,name,type,params) VALUES (?,?,?,?,?)').run('lib', 'owner', 'synthetic', 'pose', JSON.stringify(params));
  f.fail(/UPDATE chains/);
  await expect(f.invoke('/api/chains/lib', 'PUT', { params: { ...params, _promptLibrary: { references: [] } } })).rejects.toThrow('synthetic database failure');
  expect(f.bucket.delete).not.toHaveBeenCalled();
  for (const url of ['/api/local-history/missing/image', 'https://example.com/synthetic.png']) {
    expect((await f.invoke('/api/chains/lib', 'PUT', { params: { _promptLibrary: { references: [{ url }] } } }))?.status).toBe(422);
  }
  expect(JSON.parse(f.sqlite.prepare("SELECT params FROM chains WHERE id='lib'").get()!.params as string)).toEqual(params);
});

it.each(['history', 'chain', 'artist'])('删除 %s 的数据库写入失败时保留记录和全部图片', async kind => {
  const f = fixture();
  f.sqlite.exec("INSERT INTO chains (id,user_id,name,preview_image) VALUES ('c','owner','synthetic','/api/assets/cover.png'); INSERT INTO artists (id,name,image_url,preview_url,benchmarks) VALUES ('a','synthetic','/api/assets/original.png','/api/assets/preview.png','[\"/api/assets/old-benchmark.png\"]'); INSERT INTO local_generation_history (id,user_id,image_key,created_at) VALUES ('h','owner','synthetic.png',1)");
  const [table, id, path] = kind === 'history' ? ['local_generation_history', 'h', '/api/local-history/h'] : kind === 'chain' ? ['chains', 'c', '/api/chains/c'] : ['artists', 'a', '/api/artists/a'];
  f.sqlite.exec(`CREATE TRIGGER block_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'synthetic deletion failure'); END`);
  await expect(f.invoke(path)).rejects.toThrow('synthetic deletion failure');
  expect(f.sqlite.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)?.id).toBe(id);
  expect(f.bucket.delete).not.toHaveBeenCalled();
});

it('删除历史保留灵感引用的原图，只清理已删除历史的蒙版', async () => {
  const f = fixture();
  f.sqlite.exec("INSERT INTO local_generation_history (id,user_id,image_key,created_at) VALUES ('h','owner','shared.png',1); INSERT INTO inspirations (id,user_id,title,image_key) VALUES ('i','owner','synthetic','shared.png')");
  expect((await f.invoke('/api/local-history/h'))?.status).toBe(200);
  expect(f.bucket.delete.mock.calls).toEqual([['local-history/owner/h.edit-mask']]);
  expect(f.sqlite.prepare('SELECT id FROM inspirations').get()?.id).toBe('i');
});

it.each([
  ['其他风格串', "INSERT INTO chains (id,user_id,name,preview_image) VALUES ('shared','owner','retained','/api/assets/cover.png')"],
  ['收藏原图地址', "INSERT INTO inspirations (id,user_id,title,image_url,archived) VALUES ('shared','owner','retained','/api/assets/cover.png',1)"],
  ['收藏原图键', "INSERT INTO inspirations (id,user_id,title,image_key) VALUES ('shared','owner','retained','cover.png')"],
  ['历史原图', "INSERT INTO local_generation_history (id,user_id,image_key,created_at) VALUES ('shared','owner','cover.png',1)"],
  ['画师原图', "INSERT INTO artists (id,name,image_url) VALUES ('shared','retained','/api/assets/cover.png')"],
  ['画师预览', "INSERT INTO artists (id,name,preview_url) VALUES ('shared','retained','/api/assets/cover.png')"],
  ['画师样张', "INSERT INTO artists (id,name,benchmarks) VALUES ('shared','retained','[\"/api/assets/cover.png\"]')"],
])('删除风格串保留%s仍引用的封面', async (_kind, retainedSql) => {
  const f = fixture();
  f.sqlite.exec("INSERT INTO chains (id,user_id,name,preview_image,base_prompt,params) VALUES ('c','owner','deleted','/api/assets/cover.png','original prompt','{\"seed\":123}')");
  f.sqlite.exec(retainedSql);
  const retained = ['chains', 'inspirations', 'local_generation_history', 'artists'].map(table => f.sqlite.prepare(`SELECT * FROM ${table} WHERE id = 'shared'`).get());
  expect((await f.invoke('/api/chains/c'))?.status).toBe(200);
  expect(f.sqlite.prepare("SELECT id FROM chains WHERE id = 'c'").get()).toBeUndefined();
  expect(f.bucket.delete).not.toHaveBeenCalled();
  expect(['chains', 'inspirations', 'local_generation_history', 'artists'].map(table => f.sqlite.prepare(`SELECT * FROM ${table} WHERE id = 'shared'`).get())).toEqual(retained);
});

it.each(['', '/api/assets/new-cover.png'])('清空或更换风格串封面为 %s 时保留收藏中的旧原图及信息', async previewImage => {
  const f = fixture();
  f.sqlite.exec("INSERT INTO chains (id,user_id,name,preview_image) VALUES ('c','owner','synthetic','/api/assets/old-cover.png'); INSERT INTO inspirations (id,user_id,title,image_url,prompt,params) VALUES ('i','owner','retained','/api/assets/old-cover.png','original prompt','{\"seed\":123}')");
  const original = f.sqlite.prepare("SELECT * FROM inspirations WHERE id = 'i'").get();
  expect((await f.invoke('/api/chains/c', 'PUT', { previewImage }))?.status).toBe(200);
  expect(f.sqlite.prepare("SELECT preview_image FROM chains WHERE id = 'c'").get()?.preview_image).toBe(previewImage);
  expect(f.sqlite.prepare("SELECT * FROM inspirations WHERE id = 'i'").get()).toEqual(original);
  expect(f.bucket.delete).not.toHaveBeenCalled();
});

it('逐条删除共用封面的风格串，只在最后一个引用消失后清理一次', async () => {
  const f = fixture();
  f.sqlite.exec("INSERT INTO chains (id,user_id,name,preview_image) VALUES ('c','owner','first','/api/assets/cover.png'), ('d','owner','second','/api/assets/cover.png'); INSERT INTO artists (id,name,benchmarks) VALUES ('broken','synthetic','damaged json')");
  await f.invoke('/api/chains/c');
  expect(f.bucket.delete).not.toHaveBeenCalled();
  await f.invoke('/api/chains/d');
  expect(f.bucket.delete.mock.calls).toEqual([['cover.png']]);
});

it('移除收藏引用不会清理仍用于风格串封面的原图', async () => {
  const f = fixture();
  f.sqlite.exec("INSERT INTO chains (id,user_id,name,preview_image) VALUES ('c','owner','retained','/api/assets/cover.png'); INSERT INTO inspirations (id,user_id,title,image_url) VALUES ('i','owner','removed','/api/assets/cover.png')");
  expect((await f.invoke('/api/inspirations/i'))?.status).toBe(200);
  expect(f.sqlite.prepare("SELECT id FROM inspirations WHERE id = 'i'").get()).toBeUndefined();
  expect(f.sqlite.prepare("SELECT preview_image FROM chains WHERE id = 'c'").get()?.preview_image).toBe('/api/assets/cover.png');
  expect(f.bucket.delete).not.toHaveBeenCalled();
});

it.each([
  ['/api/assets/covers/shared%20image.png', '/api/assets/covers/shared image.png'],
  ['/api/assets/covers/shared image.png', '/api/assets/covers/shared%20image.png'],
  ['/api/assets/covers/shared image.png', '/api/assets/covers%2Fshared%20image.png'],
])('封面 URL %s 与收藏 URL %s 的编码不同仍匹配同一张原图', async (coverUrl, favoriteUrl) => {
  const f = fixture();
  f.sqlite.prepare("INSERT INTO chains (id,user_id,name,preview_image) VALUES ('c','owner','removed',?)").run(coverUrl);
  f.sqlite.prepare("INSERT INTO inspirations (id,user_id,title,image_url) VALUES ('i','owner','retained',?)").run(favoriteUrl);
  await f.invoke('/api/chains/c');
  expect(f.bucket.delete).not.toHaveBeenCalled();
});

it('无法核对图片引用时不清理原图，并向调用方报告失败', async () => {
  const f = fixture();
  f.sqlite.exec("INSERT INTO chains (id,user_id,name,preview_image) VALUES ('c','owner','removed','/api/assets/cover.png')");
  const prepare = f.db.prepare.bind(f.db);
  vi.spyOn(f.db, 'prepare').mockImplementation(query => {
    if (query.includes('AS referenced')) throw new Error('synthetic reference lookup failure');
    return prepare(query);
  });
  await expect(f.invoke('/api/chains/c')).rejects.toThrow('synthetic reference lookup failure');
  expect(f.bucket.delete).not.toHaveBeenCalled();
});

it('旧画师图片与 benchmarks 仍正常清理，R2 失败不会伪报成功', async () => {
  const f = fixture();
  f.sqlite.exec("INSERT INTO artists (id,name,image_url,preview_url,benchmarks) VALUES ('a','synthetic','/api/assets/original.png','/api/assets/preview.png','[\"/api/assets/old-benchmark.png\"]')");
  expect((await f.invoke('/api/artists/a'))?.status).toBe(200);
  expect(f.bucket.delete.mock.calls.flat()).toEqual(['original.png', 'preview.png', 'old-benchmark.png']);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  f.bucket.delete.mockRejectedValueOnce(new Error('synthetic R2 failure'));
  await expect(deleteR2File(f.env, '/api/assets/blocked.png', f.db)).rejects.toThrow('synthetic R2 failure');
});

it.each([/CREATE TABLE IF NOT EXISTS users/, /ALTER TABLE chains/, /CREATE TABLE IF NOT EXISTS aitag_works/])('初始化中的真实错误 %s 返回失败', async pattern => {
  const f = fixture(); f.fail(pattern); vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await worker.fetch(new Request('http://localhost/api/init'), f.env);
  expect(response.status).toBe(500);
  expect(await response.json()).not.toHaveProperty('success', true);
});

it('旧表补列保留原数据，重复初始化只忽略已存在列', async () => {
  const f = fixture();
  f.sqlite.exec("CREATE TABLE legacy (id TEXT); INSERT INTO legacy VALUES ('original')");
  await addColumnIfMissing(f.db, 'ALTER TABLE legacy ADD COLUMN note TEXT');
  await addColumnIfMissing(f.db, 'ALTER TABLE legacy ADD COLUMN note TEXT');
  expect(f.sqlite.prepare('SELECT * FROM legacy').get()).toEqual({ id: 'original', note: null });
  for (let i = 0; i < 2; i++) expect((await worker.fetch(new Request('http://localhost/api/init'), f.env)).status).toBe(200);
});

it('实际旧风格串、灵感与画师表补列后保留内容，重复初始化兼容', async () => {
  const f = fixture();
  for (const [table, columns] of [
    ['chains', ['user_id', 'username', 'type', 'variable_values', 'guest_hidden']],
    ['inspirations', ['user_id', 'username', 'negative_prompt', 'params']],
    ['artists', ['preview_url', 'benchmarks']],
  ] as const) for (const column of columns) f.sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  f.sqlite.exec("INSERT INTO chains (id,name,base_prompt) VALUES ('c','legacy-chain','original prompt'); INSERT INTO inspirations (id,title,prompt) VALUES ('i','legacy-inspiration','original idea'); INSERT INTO artists (id,name,image_url) VALUES ('a','legacy-artist','/api/assets/legacy.png')");
  for (let i = 0; i < 2; i++) expect((await worker.fetch(new Request('http://localhost/api/init'), f.env)).status).toBe(200);
  expect(f.sqlite.prepare('SELECT id,name,base_prompt,type,variable_values,guest_hidden FROM chains').get()).toEqual({ id: 'c', name: 'legacy-chain', base_prompt: 'original prompt', type: 'style', variable_values: '{}', guest_hidden: 0 });
  expect(f.sqlite.prepare('SELECT id,prompt,negative_prompt,params FROM inspirations').get()).toEqual({ id: 'i', prompt: 'original idea', negative_prompt: '', params: null });
  expect(f.sqlite.prepare('SELECT id,image_url,preview_url,benchmarks FROM artists').get()).toEqual({ id: 'a', image_url: '/api/assets/legacy.png', preview_url: null, benchmarks: '[]' });
  expect(f.bucket.delete).not.toHaveBeenCalled();
});

it('旧个人用户统一运行权限，保留 ID、持久角色和资料归属，已保存标识不重复写入', async () => {
  const f = fixture();
  f.sqlite.exec("INSERT INTO users (id,username,password,role,created_at) VALUES ('legacy','synthetic','','user',1); INSERT INTO chains (id,user_id,name) VALUES ('c','legacy','synthetic')");
  expect(await getLocalOwner(f.db)).toMatchObject({ id: 'legacy', role: 'admin' });
  f.queries.length = 0;
  expect(await getLocalOwner(f.db)).toMatchObject({ id: 'legacy', role: 'admin' });
  expect(f.queries.some(query => query.startsWith('INSERT'))).toBe(false);
  expect(f.sqlite.prepare('SELECT role FROM users WHERE id = ?').get('legacy')?.role).toBe('user');
  expect(f.sqlite.prepare('SELECT user_id FROM chains').get()?.user_id).toBe('legacy');
});

it.each(['GET', 'PUT'])('废弃 benchmark 配置入口 %s 返回 404，旧配置不删除', async method => {
  const f = fixture(); f.sqlite.exec("INSERT INTO settings VALUES ('benchmark_config','{\"legacy\":true}')");
  const response = await worker.fetch(new Request('http://localhost/api/config/benchmarks', { method }), f.env);
  expect(response.status).toBe(404);
  expect(f.sqlite.prepare("SELECT value FROM settings WHERE key = 'benchmark_config'").get()?.value).toBe('{"legacy":true}');
});
