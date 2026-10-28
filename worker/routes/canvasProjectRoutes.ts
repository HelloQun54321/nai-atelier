import { error, json, type RouteContext } from './types';
import type { CanvasProject } from '../../services/canvasTypes';

const PREFIX = 'canvas_project_v1:';
const OBJECT_PREFIX = 'canvas-projects/v1/';
const validId = (id: string) => /^[a-zA-Z0-9_-]+$/.test(id) && id.length <= 200;

export async function handleCanvasProjectRoute({ request, path, method, db, env }: RouteContext): Promise<Response | null> {
  const base = '/api/canvas-projects';
  if (path !== base && !path.startsWith(base + '/')) return null;
  if (path === base && method !== 'GET') return error('不支持的画布工程操作', 405);
  if (path !== base && !['GET', 'PUT', 'DELETE'].includes(method)) return error('不支持的画布工程操作', 405);
  if (!env.BUCKET) return error('画布工程存储不可用', 503);
  try {
    if (path === base) {
      const rows = await db.prepare('SELECT value FROM settings WHERE key >= ? AND key < ?')
        .bind(PREFIX, PREFIX + '\uffff').all<{ value: string }>();
      const projects = rows.results.map(row => JSON.parse(row.value) as { id: string; name: string; updatedAt: number });
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      return json({ projects }, 200, { 'Cache-Control': 'no-store' });
    }
    let id: string;
    try { id = decodeURIComponent(path.slice(base.length + 1)); } catch { return error('画布工程 ID 无效', 400); }
    if (!validId(id)) return error('画布工程 ID 无效', 400);
    const key = OBJECT_PREFIX + id + '.json';
    if (method === 'DELETE') {
      const record = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(PREFIX + id).first<{ value: string }>();
      if (!record) return error('画布工程不存在', 404);
      await db.prepare('DELETE FROM settings WHERE key = ?').bind(PREFIX + id).run();
      try {
        await env.BUCKET.delete(key);
      } catch (cause) {
        // 对象删除失败时恢复原摘要，避免尚在的工程无法从列表打开。
        try {
          await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .bind(PREFIX + id, record.value).run();
        } catch (restoreCause) {
          console.error('canvas project summary restore failed', restoreCause);
          return error('删除画布工程失败，工程列表恢复也失败，请查看本地服务日志', 500);
        }
        throw cause;
      }
      return json({ success: true });
    }
    if (method === 'GET') {
      const object = await env.BUCKET.get(key);
      if (!object) return error('画布工程不存在', 404);
      return new Response(object.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    let project: CanvasProject & { thumbnail?: string };
    try {
      project = await request.json() as CanvasProject & { thumbnail?: string };
      if (!project || project.version !== 1 || project.id !== id || typeof project.name !== 'string' ||
        !Number.isFinite(project.updatedAt) || !Number.isFinite(project.width) || project.width <= 0 ||
        !Number.isFinite(project.height) || project.height <= 0 || !project.background || !Array.isArray(project.layers) ||
        (project.thumbnail !== undefined && typeof project.thumbnail !== 'string')) throw Error();
    } catch { return error('画布工程数据无效', 400); }
    await env.BUCKET.put(key, JSON.stringify(project), { httpMetadata: { contentType: 'application/json' } });
    const summary = { id, name: project.name, updatedAt: project.updatedAt, ...(project.thumbnail === undefined ? {} : { thumbnail: project.thumbnail }) };
    await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(PREFIX + id, JSON.stringify(summary)).run();
    return json({ success: true });
  } catch (cause) {
    console.error('canvas project storage failed', cause);
    return error('画布工程存储失败，请查看本地服务日志', 500);
  }
}
