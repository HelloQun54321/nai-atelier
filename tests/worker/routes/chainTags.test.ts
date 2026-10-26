import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleSettingsRoute } from '../../../worker/routes/settingsRoutes';
import { handleAgentRoute } from '../../../worker/routes/historyRoutes';
import { INIT_SQL, type D1Database, type Env, type R2Bucket, type RouteContext } from '../../../worker/routes/types';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const fixture = (bucket?: R2Bucket, envOverrides: Partial<Env> = {}) => {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite); sqlite.exec(INIT_SQL);
  let pendingBatch = Promise.resolve<unknown>(undefined);
  const db = { prepare(query: string) {
    let values: any[] = [];
    return {
      bind(...next: any[]) { values = next; return this; },
      async first() { return sqlite.prepare(query).get(...values) || null; },
      async all() { return { results: sqlite.prepare(query).all(...values) }; },
      async run() { return { success: true, meta: { changes: sqlite.prepare(query).run(...values).changes } }; },
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
  const initDB = vi.fn(async () => { throw new Error('不允许迁移'); });
  const assetRequests: string[] = [];
  const assets = { fetch: async (request: Request) => {
    const url = new URL(request.url); assetRequests.push(url.pathname);
    if (url.origin !== 'https://atelier.local') throw new Error('不允许访问真实资产');
    if (url.pathname === '/tag-data/manifest.json') return Response.json({ artistPages: ['artists-synthetic.json'] });
    if (url.pathname === '/tag-data/artist-pages/artists-synthetic.json') return Response.json([['synthetic_artist', 1]]);
    throw new Error('不允许访问真实资产');
  } };
  const invoke = async (path = '/api/chains', method = 'GET', body?: unknown, userId = 'test-owner') => {
    const request = new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const context: RouteContext = { request, path: new URL(request.url).pathname, method, url: new URL(request.url), db, currentUser: { id: userId, username: 'test', role: 'admin' }, env: { BUCKET: bucket, ASSETS: assets, ...envOverrides }, initDB };
    const response = path.startsWith('/api/agent/') ? await handleAgentRoute(context) : await handleSettingsRoute(context);
    return response!;
  };
  return { sqlite, invoke, initDB, assetRequests };
};

describe('风格串标签读写链路（隔离 SQLite）', () => {
  it('稳定创建身份在成功回执丢失后重试返回原条目，改过的条目不被覆盖', async () => {
    const f = fixture(); const payload = { creationId: 'b2b742fb-2ff1-4eaf-a726-083d24b8af63', name: '提取候选', type: 'scene', basePrompt: 'night sky', params: { seed: 17 } };
    await f.invoke('/api/chains', 'POST', payload); // 服务端成功，模拟客户端没有取得这次回执。
    const first = f.sqlite.prepare('SELECT id FROM chains').get()!;
    f.sqlite.prepare('UPDATE chains SET name = ? WHERE id = ?').run('用户后来改名', first.id);
    const replay = await f.invoke('/api/chains', 'POST', { ...payload, params: { seed: 17 } });
    expect(replay.status).toBe(200); const result = await replay.json() as any;
    expect(result).toMatchObject({ id: first.id, replayed: true, chain: { name: '用户后来改名', basePrompt: 'night sky' } });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM chains').get()?.n).toBe(1);
    expect((await f.invoke('/api/chains', 'POST', { ...payload, basePrompt: 'different content' })).status).toBe(409);
    expect(f.sqlite.prepare('SELECT base_prompt FROM chains').get()?.base_prompt).toBe('night sky');
    expect(f.initDB).not.toHaveBeenCalled();
  });

  it('并发同创建身份只有一个赢家，相同内容重放，不同内容冲突且不覆盖', async () => {
    const f = fixture(); const payload = { creationId: 'ed7244c1-3ff1-4eaf-a726-083d24b8af63', name: '并发候选', basePrompt: 'artist:synthetic_artist' };
    const equal = await Promise.all([f.invoke('/api/chains', 'POST', payload), f.invoke('/api/chains', 'POST', payload)]);
    expect(equal.map(response => response.status)).toEqual([200, 200]);
    expect((await equal[0].json() as any).id).toBe((await equal[1].json() as any).id);
    const next = { ...payload, creationId: 'fa7244c1-3ff1-4eaf-a726-083d24b8af63' };
    const conflict = await Promise.all([f.invoke('/api/chains', 'POST', next), f.invoke('/api/chains', 'POST', { ...next, name: '另一份内容' })]);
    expect(conflict.map(response => response.status).sort()).toEqual([200, 409]);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM chains').get()?.n).toBe(2);
  });

  it('创建身份按所有者隔离，非法身份不写入，普通创建不继承任意id', async () => {
    const f = fixture(); const payload = { creationId: 'ee7244c1-3ff1-4eaf-a726-083d24b8af63', name: '私人候选' };
    const first = await (await f.invoke('/api/chains', 'POST', payload)).json() as any;
    const other = await (await f.invoke('/api/chains', 'POST', { ...payload, name: '另一个人的候选' }, 'other-owner')).json() as any;
    expect(other.id).not.toBe(first.id); expect(other.chain.userId).toBe('other-owner'); expect(other.chain.name).toBe('另一个人的候选');
    for (const creationId of ['', '../bad', null, 12]) expect((await f.invoke('/api/chains', 'POST', { ...payload, creationId })).status).toBe(400);
    const copied = await (await f.invoke('/api/chains', 'POST', { id: first.id, name: '普通复制' })).json() as any;
    expect(copied.id).not.toBe(first.id); expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM chains').get()?.n).toBe(3);
  });
  it('分享来源随创建与读取保留，替换生成参数或普通编辑不会抹掉原出处', async () => {
    const f = fixture();
    const original = { author: '合成作者', sourceUrl: 'https://example.org/free', note: '免费分享' };
    const curator = { author: '合成整理者', sourceUrl: '', note: '整理说明' };
    const created = await (await f.invoke('/api/chains', 'POST', { name: '分享配方', params: { seed: 42, _styleBundleSources: [original] } })).json() as any;
    expect(created.chain.params._styleBundleSources).toEqual([original]);
    await f.invoke(`/api/chains/${created.id}`, 'PUT', { params: { seed: 17 } });
    expect((await (await f.invoke(`/api/chains/${created.id}`)).json() as any).params).toMatchObject({ seed: 17, _styleBundleSources: [original] });
    await f.invoke(`/api/chains/${created.id}`, 'PUT', { params: { seed: 18, _styleBundleSources: [original, curator] } });
    await f.invoke(`/api/chains/${created.id}`, 'PUT', { name: '新名称', description: '新描述' });
    const list = await (await f.invoke()).json() as any[];
    expect(list[0]).toMatchObject({ name: '新名称', description: '新描述', params: { seed: 18, _styleBundleSources: [original, curator] } });
    expect(f.initDB).not.toHaveBeenCalled();
  });

  it('Agent 检索在数据库分页，转义通配符并只返回有界摘要', async () => {
    const f = fixture();
    const insert = f.sqlite.prepare('INSERT INTO chains (id, name, base_prompt, updated_at) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < 205; i++) insert.run(String(i), `合成${i}`, 'long prompt '.repeat(3000), i);
    insert.run('literal', '100%_match', 'private full prompt', 1000);
    const first = await (await f.invoke('/api/agent/library?kind=chains&limit=20')).json() as any;
    const second = await (await f.invoke('/api/agent/library?kind=chains&limit=20&page=1')).json() as any;
    expect(first.chains).toHaveLength(20); expect(first.hasMore.chains).toBe(true);
    expect(second.chains.some((item: any) => first.chains.some((previous: any) => item.id === previous.id))).toBe(false);
    expect(JSON.stringify(first)).not.toContain('long prompt');
    const literal = await (await f.invoke('/api/agent/library?kind=chains&q=100%25_')).json() as any;
    expect(literal.chains.map((item: any) => item.id)).toEqual(['literal']);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM chains').get()?.count).toBe(206);
  });
  it.each(['agent', 'naia'])('同一 %s 创建操作不重复落库，也不覆盖之后的手动修改', async prefix => {
    const f = fixture(); const id = `${prefix}-${'a'.repeat(64)}`;
    await f.invoke('/api/chains', 'POST', { id, name: 'original' });
    await f.invoke(`/api/chains/${id}`, 'PUT', { name: 'manual' });
    const replay = await (await f.invoke('/api/chains', 'POST', { id, name: 'original' })).json() as any;
    expect(replay).toEqual({ id, replayed: true });
    expect(f.sqlite.prepare('SELECT name FROM chains WHERE id = ?').get(id)?.name).toBe('manual');
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM chains').get()?.count).toBe(1);
  });
  it('旧列表、详情与 Agent 返回统一清除自动标签，读取不修改私人数据或排序时间', async () => {
    const f = fixture();
    const tags = ['aitag', 'NAI', 'Pixiv', '收集中', '待实测', '我的分类'];
    f.sqlite.prepare('INSERT INTO chains (id, name, tags, updated_at) VALUES (?, ?, ?, ?)').run('legacy', '合成条目', JSON.stringify(tags), 42);
    const list = await (await f.invoke()).json() as any[];
    const detail = await (await f.invoke('/api/chains/legacy')).json() as any;
    const agent = await (await f.invoke('/api/agent/library?kind=chains')).json() as any;
    expect(list[0].tags).toEqual(['待实测', '我的分类']);
    expect(detail.tags).toEqual(list[0].tags);
    expect(agent.chains[0].tags).toEqual(list[0].tags);
    expect(f.sqlite.prepare("SELECT tags, updated_at FROM chains WHERE id = 'legacy'").get()).toEqual({ tags: JSON.stringify(tags), updated_at: 42 });
    expect(f.initDB).not.toHaveBeenCalled();
  });

  it('创建与更新均阻止自动标签回流，保留自定义分类和待实测生命周期', async () => {
    const f = fixture();
    const created = await (await f.invoke('/api/chains', 'POST', { name: '合成导入', tags: ['NAI', 'aitag', ' 夜景 ', '夜景', '待实测', '__character_catalog__'] })).json() as any;
    expect(JSON.parse(String(f.sqlite.prepare('SELECT tags FROM chains WHERE id = ?').get(created.id)?.tags))).toEqual(['夜景', '待实测', '__character_catalog__']);
    await f.invoke(`/api/chains/${created.id}`, 'PUT', { tags: ['Danbooru', '生成历史', '新分类', '待实测'] });
    expect(JSON.parse(String(f.sqlite.prepare('SELECT tags FROM chains WHERE id = ?').get(created.id)?.tags))).toEqual(['新分类', '待实测']);
    await f.invoke(`/api/chains/${created.id}`, 'PUT', { tags: ['新分类'] });
    const detail = await (await f.invoke(`/api/chains/${created.id}`)).json() as any;
    expect(detail.tags).toEqual(['新分类']);
    expect(f.initDB).not.toHaveBeenCalled();
  });

  it('保存含本地词库画师 Tag 的风格串时事务写入收录统计且只读合成词库', async () => {
    const f = fixture();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await f.invoke('/api/chains', 'POST', {
      name: '合成画师统计', basePrompt: 'synthetic_artist',
    });
    expect(response.status).toBe(200);
    const created = await response.json() as { id: string };
    expect(f.sqlite.prepare("SELECT CAST(value AS INTEGER) AS count FROM settings WHERE key = 'artist_chain_count_v1:synthetic artist'").get()).toEqual({ count: 1 });
    expect(JSON.parse(String(f.sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(`artist_chain_snapshot_v1:${created.id}`)?.value))).toEqual({
      version: expect.any(Number), type: 'style', artists: ['synthetic artist'],
    });
    expect(error.mock.calls.some(([message]) => String(message).includes('画师收录统计更新失败'))).toBe(false);
    expect(f.assetRequests).toEqual(['/tag-data/manifest.json', '/tag-data/artist-pages/artists-synthetic.json']);
    error.mockRestore();
  });
});

const bucketFixture = () => {
  const data = new Map<string, Uint8Array>([['aitag/synthetic.webp', new Uint8Array([1, 2, 3, 4])]]);
  const get = vi.fn(async (key: string) => data.has(key) ? {
    body: new Response(data.get(key)!.slice().buffer as ArrayBuffer).body!, httpEtag: 'synthetic',
    writeHttpMetadata(headers: Headers) { headers.set('content-type', 'image/webp'); },
  } : null);
  const put = vi.fn(async (key: string, body: ArrayBuffer) => { data.set(key, new Uint8Array(body)); });
  const del = vi.fn(async (key: string) => { data.delete(key); });
  return { data, get, put, del, bucket: { get, put, delete: del } as unknown as R2Bucket };
};

describe('新建风格串的立即打开与封面保存（隔离 SQLite／R2）', () => {
  it('回传实际落库内容，克隆本地 AITag 封面，不联网且不修改原图', async () => {
    const b = bucketFixture(); const f = fixture(b.bucket);
    const fetchMock = vi.fn(async () => { throw new Error('本地保存禁止联网'); }); vi.stubGlobal('fetch', fetchMock);
    const result = await f.invoke('/api/chains', 'POST', {
      name: '合成作品 P1', previewImage: '/api/assets/aitag/synthetic.webp', tags: ['NAI', '夜景'],
      basePrompt: 'synthetic prompt', negativePrompt: 'synthetic negative',
      params: { model: 'nai-diffusion-4-5-full', seed: 123, characters: [{ prompt: 'synthetic character', negative: 'synthetic constraint', x: 0.3, y: 0.7 }] }, variableValues: { subject: '' },
    });
    expect(result.status).toBe(200);
    const created = await result.json() as any;
    const detail = await (await f.invoke(`/api/chains/${created.id}`)).json();
    expect(created.chain).toEqual(detail);
    expect(created.chain).toMatchObject({ basePrompt: 'synthetic prompt', negativePrompt: 'synthetic negative', tags: ['夜景'], params: { seed: 123, steps: 28 } });
    expect(created.chain.previewImage).toMatch(/^\/api\/assets\/covers\/.+\.webp$/);
    expect(b.put).toHaveBeenCalledTimes(1); expect(b.del).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    expect(b.data.get(created.chain.previewImage.slice('/api/assets/'.length))).toEqual(b.data.get('aitag/synthetic.webp'));
    // 换封面只删除新串自己的副本，AITag 原图仍可继续浏览。
    await f.invoke(`/api/chains/${created.id}`, 'PUT', { previewImage: '' });
    expect(b.data.has('aitag/synthetic.webp')).toBe(true);
    expect(b.del).toHaveBeenCalledWith(created.chain.previewImage.slice('/api/assets/'.length));
    expect(f.initDB).not.toHaveBeenCalled();
  });

  it.each(['inspirations', 'local-history'])('同类 %s 图片路径按当前用户解析并保存独立封面', async source => {
    const b = bucketFixture(); const f = fixture(b.bucket);
    const table = source === 'inspirations' ? 'inspirations' : 'local_generation_history';
    const extra = source === 'inspirations' ? ', title' : '';
    f.sqlite.prepare(`INSERT INTO ${table} (id, user_id, image_key, image_type, created_at${extra}) VALUES (?, ?, ?, ?, ?${extra ? ', ?' : ''})`).run('source', 'test-owner', 'aitag/synthetic.webp', 'image/webp', 1, ...(extra ? ['合成灵感'] : []));
    const response = await f.invoke('/api/chains', 'POST', { name: '合成来源', previewImage: `/api/${source}/source/image` });
    expect(response.status).toBe(200);
    expect((await response.json() as any).chain.previewImage).toMatch(/^\/api\/assets\/covers\//);
    expect(b.get).toHaveBeenCalledWith('aitag/synthetic.webp'); expect(b.del).not.toHaveBeenCalled();
  });

  it('未缓存的外链图片经过现有校验下载一次，返回保存后的本地封面', async () => {
    const b = bucketFixture(); const f = fixture(b.bucket);
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([4, 3, 2, 1]), { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await f.invoke('/api/chains', 'POST', { name: '未缓存合成图片', previewImage: 'https://ai-img.10118899.xyz/nai/1/source.webp' });
    expect(result.status).toBe(200);
    expect((await result.json() as any).chain.previewImage).toMatch(/^\/api\/assets\/covers\/.+\.png$/);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(b.put).toHaveBeenCalledTimes(1);
  });

  it('图床要求防盗链头时仍能保存：缺少 Referer／浏览器 UA 的请求会返回 403', async () => {
    const b = bucketFixture(); const f = fixture(b.bucket, { LAN_ACCESS_SECRET: 'synthetic-internal-secret' });
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      const headers = new Headers(options.headers);
      if (headers.get('Referer') !== 'https://aitag.win/' || !headers.get('User-Agent')?.includes('Mozilla/5.0')) return new Response('Forbidden', { status: 403 });
      expect(headers.has('X-Nai-Internal-Secret')).toBe(false);
      return new Response(new Uint8Array([4, 3, 2, 1]), { headers: { 'Content-Type': 'image/webp' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await f.invoke('/api/chains', 'POST', { name: '防盗链回归', previewImage: 'https://ai-img.10118899.xyz/nai/1/123_p1.webp' });
    expect(result.status).toBe(200);
    expect((await result.json() as any).chain.previewImage).toMatch(/^\/api\/assets\/covers\//);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('本机模式走 AITag 专用代理及内部鉴权，沿用图床挑战恢复链路', async () => {
    const b = bucketFixture();
    const f = fixture(b.bucket, { AITAG_LOCAL_PROXY_URL: 'http://127.0.0.1:3001/__internal/aitag-fetch', LAN_ACCESS_SECRET: 'synthetic-internal-secret' });
    const source = 'https://ai-img.10118899.xyz/nai/1/123_p1.webp';
    const fetchMock = vi.fn(async (value: string, options: RequestInit) => {
      const target = new URL(value);
      if (target.origin !== 'http://127.0.0.1:3001') return new Response('Forbidden', { status: 403 });
      expect(target.pathname).toBe('/__internal/aitag-fetch'); expect(target.searchParams.get('url')).toBe(source);
      expect(new Headers(options.headers).get('X-Nai-Internal-Secret')).toBe('synthetic-internal-secret');
      return new Response(new Uint8Array([4, 3, 2, 1]), { headers: { 'Content-Type': 'image/webp' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await f.invoke('/api/chains', 'POST', { name: '本机代理回归', previewImage: source });
    expect(result.status).toBe(200); expect(fetchMock).toHaveBeenCalledTimes(1); expect(b.put).toHaveBeenCalledTimes(1);
  });

  it.each(['aitag-images/123/123_p0.webp', 'aitag-covers/123.webp'])('详情仍带外链时优先使用已落盘的 %s，不再次联网', async key => {
    const b = bucketFixture(); b.data.set(key, new Uint8Array([7, 8, 9])); const f = fixture(b.bucket);
    const fetchMock = vi.fn(async () => new Response('Forbidden', { status: 403 })); vi.stubGlobal('fetch', fetchMock);
    const result = await f.invoke('/api/chains', 'POST', { name: '迟到缓存回归', previewImage: 'https://ai-img.10118899.xyz/nai/1/123_p0.webp' });
    expect(result.status).toBe(200); expect(fetchMock).not.toHaveBeenCalled();
    const created = await result.json() as any;
    expect(b.data.get(created.chain.previewImage.slice('/api/assets/'.length))).toEqual(new Uint8Array([7, 8, 9]));
    expect(b.data.has(key)).toBe(true); expect(b.del).not.toHaveBeenCalled();
  });

  it('P1 不误用 P0 的首图缓存，跳转其他图床也不携带内部代理凭据', async () => {
    const b = bucketFixture(); b.data.set('aitag-covers/123.webp', new Uint8Array([7, 8, 9]));
    const f = fixture(b.bucket, { AITAG_LOCAL_PROXY_URL: 'http://127.0.0.1:3001/__internal/aitag-fetch', LAN_ACCESS_SECRET: 'synthetic-internal-secret' });
    const fetchMock = vi.fn(async (value: string, options: RequestInit) => {
      if (value.startsWith('http://127.0.0.1:3001')) return new Response(null, { status: 302, headers: { Location: 'https://cdn.donmai.us/synthetic.webp' } });
      expect(value).toBe('https://cdn.donmai.us/synthetic.webp');
      const headers = new Headers(options.headers);
      expect(headers.has('X-Nai-Internal-Secret')).toBe(false); expect(headers.has('Referer')).toBe(false);
      return new Response(new Uint8Array([4, 3, 2, 1]), { headers: { 'Content-Type': 'image/webp' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await f.invoke('/api/chains', 'POST', { name: '分图回归', previewImage: 'https://ai-img.10118899.xyz/nai/1/123_p1.webp' });
    expect(result.status).toBe(200); expect(b.get).not.toHaveBeenCalledWith('aitag-covers/123.webp');
    const created = await result.json() as any;
    expect(b.data.get(created.chain.previewImage.slice('/api/assets/'.length))).toEqual(new Uint8Array([4, 3, 2, 1]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('提示词库在详情选择历史封面时保存独立资产，保留原图与生图参数', async () => {
    const b = bucketFixture(), f = fixture(b.bucket);
    b.data.set('local-history/test-owner/synthetic.png', new Uint8Array([7, 8, 9]));
    f.sqlite.exec("CREATE TABLE IF NOT EXISTS local_generation_history (id TEXT, user_id TEXT, image_key TEXT, image_type TEXT)");
    f.sqlite.prepare('INSERT INTO local_generation_history (id,user_id,image_key,image_type,created_at) VALUES (?,?,?,?,1)')
      .run('cover-history', 'test-owner', 'local-history/test-owner/synthetic.png', 'image/png');
    const created = await (await f.invoke('/api/chains', 'POST', { name: 'synthetic', type: 'scene', params: { seed: 19 } })).json() as any;
    expect((await f.invoke(`/api/chains/${created.id}`, 'PUT', { previewImage: '/api/local-history/cover-history/image' })).status).toBe(200);
    const saved = await (await f.invoke(`/api/chains/${created.id}`)).json() as any;
    expect(saved.previewImage).toMatch(/^\/api\/assets\/covers\//);
    expect(saved.params.seed).toBe(19); expect(b.data.has('local-history/test-owner/synthetic.png')).toBe(true);
    expect(b.del).not.toHaveBeenCalled();
  });

  it.each(['/api/assets/missing.png', '/api/assets/../private.png', 'blob:synthetic', 'https://127.0.0.1/private.png'])('封面失败 %s 不创建半套条目或删除来源', async previewImage => {
    const b = bucketFixture(); const f = fixture(b.bucket);
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const result = await f.invoke('/api/chains', 'POST', { name: '合成失败', previewImage });
    expect(result.status).toBe(422);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM chains').get()?.count).toBe(0);
    expect(b.put).not.toHaveBeenCalled(); expect(b.del).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
});
