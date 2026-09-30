import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { handleStBridgeRoute } from './stBridgeRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from './types';

function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(INIT_SQL);
  sqlite.exec("INSERT INTO chains (id, name, type, base_prompt, preview_image) VALUES ('a', '风格', 'style', '原始正文', '/existing.png'), ('b', '角色', 'character', '', ''), ('legacy', '旧风格', NULL, '', '')");
  sqlite.exec("INSERT INTO settings (key, value) VALUES ('unrelated', 'preserve')");
  sqlite.prepare('INSERT INTO chains (id, name, type, params) VALUES (?, ?, ?, ?)').run('v5', 'V5 原条目', 'style', JSON.stringify({ model: 'nai-diffusion-5-full' }));
  const db = { prepare(query: string) {
    let values: any[] = [];
    return { bind(...next: any[]) { values = next; return this; },
      async first() { return sqlite.prepare(query).get(...values) || null; },
      async all() { return { results: sqlite.prepare(query).all(...values) }; },
      async run() { return { success: true, meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }; },
    };
  } } as unknown as D1Database;
  const invoke = (method = 'GET', body?: unknown, role = 'user') => {
    const path = '/api/st-chatu8/export-selection';
    const request = new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return handleStBridgeRoute({ path, method, request, db, env: {}, currentUser: { id: 'owner', role } } as RouteContext);
  };
  return { sqlite, invoke };
}
describe('本机持久化酒馆发送范围（隔离存储）', () => {
  it('初次为空；只保存现有风格及无 type 的旧风格，去重并跨请求保留', async () => {
    const f = fixture();
    expect(await (await f.invoke())?.json()).toEqual({ chainIds: [] });
    expect(await (await f.invoke('POST', { chainIds: ['a', 'a', 'b', 'legacy', 'deleted', 'v5'] }))?.json()).toEqual({ chainIds: ['a', 'legacy'] });
    expect(await (await f.invoke())?.json()).toEqual({ chainIds: ['a', 'legacy'] });
    expect(f.sqlite.prepare("SELECT base_prompt, preview_image FROM chains WHERE id = 'a'").get()).toMatchObject({ base_prompt: '原始正文', preview_image: '/existing.png' });
    expect(f.sqlite.prepare("SELECT value FROM settings WHERE key = 'unrelated'").get()?.value).toBe('preserve');
    f.sqlite.close();
  });
  it('损坏设置回退为空；读取滤掉已删除 ID；空范围明确停止发送', async () => {
    const f = fixture();
    f.sqlite.exec("INSERT INTO settings (key, value) VALUES ('st_chatu8_export_selection_v1', 'broken')");
    expect(await (await f.invoke())?.json()).toEqual({ chainIds: [] });
    await f.invoke('POST', { chainIds: ['a', 'legacy'] }); f.sqlite.exec("DELETE FROM chains WHERE id = 'legacy'");
    expect(await (await f.invoke())?.json()).toEqual({ chainIds: ['a'] });
    await f.invoke('POST', { chainIds: [] }); expect(await (await f.invoke())?.json()).toEqual({ chainIds: [] });
    f.sqlite.close();
  });
  it('非法输入和游客不能改写范围，不修改风格串或其他设置', async () => {
    const f = fixture(); await f.invoke('POST', { chainIds: ['a'] });
    for (const body of [{}, { chainIds: 'a' }, { chainIds: [1] }, { chainIds: [''] }]) expect((await f.invoke('POST', body))?.status).toBe(400);
    expect((await f.invoke('POST', { chainIds: [] }, 'guest'))?.status).toBe(403);
    expect((await f.invoke('GET', undefined, 'guest'))?.status).toBe(403);
    expect((await f.invoke('PUT', { chainIds: [] }))?.status).toBe(405);
    expect(await (await f.invoke())?.json()).toEqual({ chainIds: ['a'] });
    f.sqlite.close();
  });
  it('旧选择记录含 V5 或已选条目后来切到 V5 时，读取立即过滤', async () => {
    const f = fixture();
    f.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('st_chatu8_export_selection_v1', JSON.stringify(['a', 'v5']));
    expect(await (await f.invoke())?.json()).toEqual({ chainIds: ['a'] });
    f.sqlite.prepare("UPDATE chains SET params = ? WHERE id = 'a'").run(JSON.stringify({ model: 'nai-diffusion-5-curated' }));
    expect(await (await f.invoke())?.json()).toEqual({ chainIds: [] });
    expect(JSON.parse(String(f.sqlite.prepare("SELECT params FROM chains WHERE id = 'v5'").get()?.params)).model).toBe('nai-diffusion-5-full');
    f.sqlite.close();
  });
});
