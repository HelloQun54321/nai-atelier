import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { handleStBridgeRoute } from '../../../worker/routes/stBridgeRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../../worker/routes/types';

function fixture(enabled = true) {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(INIT_SQL);
  sqlite.exec("INSERT INTO chains (id, name, type, base_prompt, preview_image) VALUES ('a', '风格', 'style', '原始正文', '/existing.png'), ('b', '角色', 'character', '', ''), ('legacy', '旧风格', NULL, '', '')");
  sqlite.exec("INSERT INTO settings (key, value) VALUES ('unrelated', 'preserve')");
  if (enabled) sqlite.exec(`INSERT INTO settings (key, value) VALUES ('st_chatu8_preferences_v1', '{"enabled":true}')`);
  sqlite.prepare('INSERT INTO chains (id, name, type, params) VALUES (?, ?, ?, ?)').run('v5', 'V5 原条目', 'style', JSON.stringify({ model: 'nai-diffusion-5-full' }));
  const db = { prepare(query: string) {
    let values: any[] = [];
    return { bind(...next: any[]) { values = next; return this; },
      async first() { return sqlite.prepare(query).get(...values) || null; },
      async all() { return { results: sqlite.prepare(query).all(...values) }; },
      async run() { return { success: true, meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }; },
    };
  } } as unknown as D1Database;
  const invoke = (method = 'GET', body?: unknown, role = 'user', path = '/api/st-chatu8/export-selection') => {
    const request = new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return handleStBridgeRoute({ path, method, request, db, env: { LOCAL_HISTORY_ENABLED: 'true' }, currentUser: { id: 'owner', role } } as RouteContext);
  };
  return { sqlite, invoke };
}
describe('本机持久化智慧姬同步设置与发送范围（隔离存储）', () => {
  it('初次为空；只保存现有风格及无 type 的旧风格，去重并跨请求保留', async () => {
    const f = fixture();
    expect(await (await f.invoke())?.json()).toEqual({ chainIds: [] });
    expect(await (await f.invoke('POST', { chainIds: ['a', 'a', 'b', 'legacy', 'deleted', 'v5'] }))?.json()).toEqual({ chainIds: ['a', 'legacy', 'v5'] });
    expect(await (await f.invoke())?.json()).toEqual({ chainIds: ['a', 'legacy', 'v5'] });
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
  it('V5 可选且保留原模型；已选条目改为 V4 时立即排除', async () => {
    const f = fixture();
    f.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('st_chatu8_export_selection_v1', JSON.stringify(['a', 'v5']));
    expect(await (await f.invoke())?.json()).toEqual({ chainIds: ['a', 'v5'] });
    f.sqlite.prepare("UPDATE chains SET params = ? WHERE id = 'a'").run(JSON.stringify({ model: 'nai-diffusion-4-full' }));
    expect(await (await f.invoke())?.json()).toEqual({ chainIds: ['v5'] });
    expect(JSON.parse(String(f.sqlite.prepare("SELECT params FROM chains WHERE id = 'v5'").get()?.params)).model).toBe('nai-diffusion-5-full');
    f.sqlite.close();
  });
  it('开关初次关闭，跨请求保存；关闭拒绝同步入库但保留范围与资产', async () => {
    const f = fixture(false);
    const pref = '/api/st-chatu8/preferences';
    expect(await (await f.invoke('GET', undefined, 'user', pref))?.json()).toEqual({ enabled: false });
    expect((await f.invoke('POST', { chainIds: ['a'] }))?.status).toBe(409);
    await f.invoke('POST', { enabled: true }, 'user', pref);
    await f.invoke('POST', { chainIds: ['a', 'v5'] });
    await f.invoke('POST', { enabled: false }, 'user', pref);
    for (const path of ['/api/integrations/st-chatu8/history/import', '/api/integrations/st-chatu8/history/known']) {
      expect((await f.invoke('POST', { items: [] }, 'user', path))?.status).toBe(409);
    }
    expect(await (await f.invoke())?.json()).toEqual({ chainIds: ['a', 'v5'] });
    expect(f.sqlite.prepare("SELECT base_prompt, preview_image FROM chains WHERE id = 'a'").get()).toMatchObject({ base_prompt: '原始正文', preview_image: '/existing.png' });
    await f.invoke('POST', { enabled: true }, 'user', pref);
    expect(await (await f.invoke('GET', undefined, 'user', pref))?.json()).toEqual({ enabled: true });
    expect(await (await f.invoke())?.json()).toEqual({ chainIds: ['a', 'v5'] });
    f.sqlite.close();
  });
  it('开关拒绝非法参数和游客；损坏或非布尔设置视为关闭', async () => {
    const f = fixture(false); const pref = '/api/st-chatu8/preferences';
    for (const body of [{}, { enabled: 'true' }, { enabled: 1 }, null]) expect((await f.invoke('POST', body, 'user', pref))?.status).toBe(400);
    expect((await f.invoke('POST', { enabled: true }, 'guest', pref))?.status).toBe(403);
    expect((await f.invoke('GET', undefined, 'guest', pref))?.status).toBe(403);
    expect((await f.invoke('PUT', { enabled: true }, 'user', pref))?.status).toBe(405);
    for (const saved of ['broken', '{"enabled":"true"}', 'null', 'true']) {
      f.sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('st_chatu8_preferences_v1', saved);
      expect(await (await f.invoke('GET', undefined, 'user', pref))?.json()).toEqual({ enabled: false });
    }
    f.sqlite.close();
  });
});
