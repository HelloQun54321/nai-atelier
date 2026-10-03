import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleSettingsRoute } from './settingsRoutes';
import { handleAgentRoute } from './historyRoutes';
import { INIT_SQL, type D1Database, type R2Bucket, type RouteContext } from './types';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); vi.unstubAllGlobals(); });

const fixture = (bucket?: R2Bucket) => {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite); sqlite.exec(INIT_SQL);
  const db = { prepare(query: string) {
    let values: any[] = [];
    return {
      bind(...next: any[]) { values = next; return this; },
      async first() { return sqlite.prepare(query).get(...values) || null; },
      async all() { return { results: sqlite.prepare(query).all(...values) }; },
      async run() { return { success: true, meta: { changes: sqlite.prepare(query).run(...values).changes } }; },
    };
  } } as unknown as D1Database;
  const initDB = vi.fn(async () => { throw new Error('不允许迁移'); });
  const invoke = async (path = '/api/chains', method = 'GET', body?: unknown) => {
    const request = new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const context: RouteContext = { request, path: new URL(request.url).pathname, method, url: new URL(request.url), db, currentUser: { id: 'test-owner', username: 'test', role: 'admin' }, env: { BUCKET: bucket, ASSETS: { fetch: async () => { throw new Error('不允许访问真实资产'); } } }, initDB };
    const response = path.startsWith('/api/agent/') ? await handleAgentRoute(context) : await handleSettingsRoute(context);
    return response!;
  };
  return { sqlite, invoke, initDB };
};

describe('风格串标签读写链路（隔离 SQLite）', () => {
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

  it.each(['/api/assets/missing.png', '/api/assets/../private.png', 'blob:synthetic', 'https://127.0.0.1/private.png'])('封面失败 %s 不创建半套条目或删除来源', async previewImage => {
    const b = bucketFixture(); const f = fixture(b.bucket);
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const result = await f.invoke('/api/chains', 'POST', { name: '合成失败', previewImage });
    expect(result.status).toBe(422);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM chains').get()?.count).toBe(0);
    expect(b.put).not.toHaveBeenCalled(); expect(b.del).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
});
