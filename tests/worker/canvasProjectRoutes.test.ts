import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCanvasProjectRoute } from '../../worker/routes/canvasProjectRoutes';
import type { D1Database, D1PreparedStatement, RouteContext } from '../../worker/routes/types';
import type { CanvasProject } from '../../services/canvasTypes';
import worker from '../../worker';

let sqlite: DatabaseSync;
let db: D1Database;
let objects: Map<string, string>;
const project: CanvasProject = { version: 1, id: 'one', name: '拼图', width: 2048, height: 1024, updatedAt: 123,
  background: { kind: 'transparent', color: '#fff' }, layers: [{ id: 'layer', name: '人物', source: 'data:image/png;base64,AAAA', width: 10, height: 20, x: -30, y: 8, scaleX: -1, scaleY: 1, rotation: 15, opacity: .8, visible: true, locked: false, mask: 'data:image/png;base64,BBBB', crops: [{ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }] }] }] };
const invoke = async (method: string, suffix = '', body?: unknown, missingBucket = false) => {
  const url = new URL('http://localhost/api/canvas-projects' + suffix);
  const bucket = { put: async (key: string, value: string) => { objects.set(key, value); }, get: async (key: string) => objects.has(key) ? { body: new Response(objects.get(key)).body } : null, delete: async (key: string) => { objects.delete(key); } };
  return (await handleCanvasProjectRoute({ db, env: missingBucket ? {} : { BUCKET: bucket }, path: url.pathname, method,
    request: new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) } as unknown as RouteContext))!;
};
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('other', 'keep');");
  objects = new Map();
  const prepare = (sql: string, values: SQLInputValue[] = []): D1PreparedStatement => ({
    bind: (...next) => prepare(sql, next),
    first: async <T>() => (sqlite.prepare(sql).get(...values) ?? null) as T | null,
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...values) as T[], success: true, meta: {} }),
    run: async <T>() => ({ results: [] as T[], success: true, meta: sqlite.prepare(sql).run(...values) }),
    raw: async <T>() => [] as T[],
  });
  db = { prepare } as D1Database;
});
afterEach(() => sqlite.close());
describe('画布工程存储', () => {
  it('完整保存与重开素材、蒙版和裁剪，列表只保存元数据且不影响其他设置', async () => {
    expect((await invoke('PUT', '/one', project)).status).toBe(200);
    expect(await (await invoke('GET', '/one')).json()).toEqual(project);
    expect(await (await invoke('GET')).json()).toEqual({ projects: [{ id: 'one', name: '拼图', updatedAt: 123 }] });
    expect(sqlite.prepare("SELECT value FROM settings WHERE key = 'canvas_project_v1:one'").get()?.value).not.toContain('data:image');
    expect(sqlite.prepare("SELECT value FROM settings WHERE key = 'other'").get()?.value).toBe('keep');
    const changed = { ...project, name: '更新', updatedAt: 124 };
    await invoke('PUT', '/one', changed);
    expect(await (await invoke('GET', '/one')).json()).toEqual(changed);
  });
  it('不存在、存储不可用和不匹配 ID 均返回准确状态', async () => {
    expect((await invoke('GET', '/missing')).status).toBe(404);
    expect((await invoke('GET', '', undefined, true)).status).toBe(503);
    expect((await invoke('PUT', '/other', project)).status).toBe(400);
    expect((await invoke('DELETE', '/one')).status).toBe(404);
    expect(objects.size).toBe(0);
  });
  it('工程缩略图随摘要保存，旧工程无缩略图时仍可读取', async () => {
    const thumbnail = 'data:image/png;base64,thumb';
    await invoke('PUT', '/one', { ...project, thumbnail });
    expect(await (await invoke('GET')).json()).toEqual({ projects: [{ id: 'one', name: '拼图', updatedAt: 123, thumbnail }] });
    expect((await (await invoke('GET', '/one')).json() as { thumbnail: string }).thumbnail).toBe(thumbnail);
    await invoke('PUT', '/one', project);
    expect(await (await invoke('GET')).json()).toEqual({ projects: [{ id: 'one', name: '拼图', updatedAt: 123 }] });
  });
  it('删除指定工程的元数据及对象，其他工程和设置不变', async () => {
    await invoke('PUT', '/one', project);
    await invoke('PUT', '/two', { ...project, id: 'two' });
    expect((await invoke('DELETE', '/one')).status).toBe(200);
    expect((await invoke('GET', '/one')).status).toBe(404);
    expect(await (await invoke('GET')).json()).toEqual({ projects: [{ id: 'two', name: '拼图', updatedAt: 123 }] });
    expect((await invoke('GET', '/two')).status).toBe(200);
    expect(sqlite.prepare("SELECT value FROM settings WHERE key = 'other'").get()?.value).toBe('keep');
    expect((await invoke('DELETE', '/one')).status).toBe(404);
  });
  it('对象删除失败时保留工程并报告错误，重试可完成删除', async () => {
    const original = { ...project, thumbnail: 'data:image/png;base64,thumb' };
    await invoke('PUT', '/one', original);
    const url = new URL('http://localhost/api/canvas-projects/one');
    const result = await handleCanvasProjectRoute({ db, path: url.pathname, method: 'DELETE', request: new Request(url, { method: 'DELETE' }),
      env: { BUCKET: { delete: async () => { throw new Error('disk error'); } } } } as unknown as RouteContext);
    expect(result?.status).toBe(500);
    expect(await (await invoke('GET', '/one')).json()).toEqual(original);
    expect(await (await invoke('GET')).json()).toEqual({ projects: [{ id: 'one', name: '拼图', updatedAt: 123, thumbnail: original.thumbnail }] });
    expect((await invoke('DELETE', '/one')).status).toBe(200);
  });
  it('元数据删除失败时不触碰原图工程，重试可以完成删除', async () => {
    await invoke('PUT', '/one', project);
    const url = new URL('http://localhost/api/canvas-projects/one');
    const failingDb = { ...db, prepare: (sql: string) => sql.startsWith('DELETE') ? { bind: () => ({ run: async () => { throw new Error('database error'); } }) } : db.prepare(sql) };
    const deleteObject = vi.fn(async (key: string) => { objects.delete(key); });
    const result = await handleCanvasProjectRoute({ db: failingDb, path: url.pathname, method: 'DELETE', request: new Request(url, { method: 'DELETE' }),
      env: { BUCKET: { delete: deleteObject } } } as unknown as RouteContext);
    expect(result?.status).toBe(500);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(await (await invoke('GET', '/one')).json()).toEqual(project);
    expect((await (await invoke('GET')).json() as { projects: unknown[] }).projects).toHaveLength(1);
    expect((await invoke('DELETE', '/one')).status).toBe(200);
    expect(await (await invoke('GET')).json()).toEqual({ projects: [] });
  });
  it('对象删除失败且摘要恢复也失败时明确报告恢复失败', async () => {
    await invoke('PUT', '/one', project);
    const url = new URL('http://localhost/api/canvas-projects/one');
    const failingDb = { ...db, prepare: (sql: string) => sql.startsWith('INSERT') ? { bind: () => ({ run: async () => { throw new Error('restore error'); } }) } : db.prepare(sql) };
    const result = await handleCanvasProjectRoute({ db: failingDb, path: url.pathname, method: 'DELETE', request: new Request(url, { method: 'DELETE' }),
      env: { BUCKET: { delete: async () => { throw new Error('disk error'); } } } } as unknown as RouteContext);
    expect(result?.status).toBe(500);
    expect(await result?.json()).toEqual({ error: expect.stringContaining('恢复也失败') });
    expect(await (await invoke('GET', '/one')).json()).toEqual(project);
  });
  it('R2 写入失败时报告失败且不创建列表记录', async () => {
    const url = new URL('http://localhost/api/canvas-projects/one');
    const result = await handleCanvasProjectRoute({ db, path: url.pathname, method: 'PUT',
      request: new Request(url, { method: 'PUT', body: JSON.stringify(project) }),
      env: { BUCKET: { put: async () => { throw new Error('disk error'); } } },
    } as unknown as RouteContext);
    expect(result?.status).toBe(500);
    expect(await (await invoke('GET')).json()).toEqual({ projects: [] });
  });
  it('入口沿用局域网认证', async () => {
    const response = await worker.fetch(new Request('http://192.168.1.2/api/canvas-projects'), { LAN_ACCESS_SECRET: 'test-only', ASSETS: {} } as never);
    expect(response.status).toBe(401);
  });
});
