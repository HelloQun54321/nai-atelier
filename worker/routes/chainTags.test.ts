import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleSettingsRoute } from './settingsRoutes';
import { handleAgentRoute } from './historyRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from './types';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

const fixture = () => {
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
    const context: RouteContext = { request, path: new URL(request.url).pathname, method, url: new URL(request.url), db, currentUser: { id: 'test-owner', username: 'test', role: 'admin' }, env: { ASSETS: { fetch: async () => { throw new Error('不允许访问真实资产'); } } }, initDB };
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
