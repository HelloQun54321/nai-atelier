import { emptyReferenceFolders, readReferenceFolders, REFERENCE_FOLDER_KINDS, type ReferenceFolderKind } from '../../services/referenceFolders';
import { error, json, type RouteContext } from './types';

/**
 * 参考资料库目录：与风格串目录同一套乐观锁与 settings 存储，按资源类型分键，
 * 两种资料库各存一份，互不影响。只存目录与归属，不改动参考资产本身。
 */
export async function handleReferenceFolderRoute({ request, path, method, db, currentUser }: RouteContext): Promise<Response | null> {
  const match = path.match(/^\/api\/reference-folders\/([a-z-]+)$/);
  if (!match) return null;
  const kind = match[1] as ReferenceFolderKind;
  if (!REFERENCE_FOLDER_KINDS.includes(kind)) return error('不支持的参考资料库', 400);
  if (!['GET', 'PUT'].includes(method)) return error('不支持的目录操作', 405);
  if (!currentUser?.id) return error('未登录不能整理参考目录', 403);
  const key = `reference_folders_v1:${currentUser.id}:${kind}`;
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  let stored;
  try { stored = row ? readReferenceFolders(JSON.parse(row.value)) : emptyReferenceFolders(); }
  catch { return error('参考目录无法读取，请保留现有数据并检查备份', 503); }
  if (method === 'GET') return json(stored, 200, { 'Cache-Control': 'no-store' });
  let next;
  try {
    const text = await request.text();
    if (text.length > 4_000_000) return error('参考目录资料过大', 413);
    next = readReferenceFolders(JSON.parse(text));
  } catch (cause) { return error(cause instanceof Error ? cause.message : '参考目录数据无效', 400); }
  if (next.revision !== stored.revision) return error('参考目录已在其他窗口更新，请按最新目录重试', 409);
  const saved = { ...next, revision: stored.revision + 1 };
  const value = JSON.stringify(saved);
  const result = row
    ? await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').bind(value, key, row.value).run()
    : await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run();
  if (Number(result.meta.changes) !== 1) return error('参考目录已在其他窗口更新，请按最新目录重试', 409);
  return json(saved, 200, { 'Cache-Control': 'no-store' });
}
