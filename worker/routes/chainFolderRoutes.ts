import { emptyChainFolders, readChainFolders } from '../../services/chainFolders';
import { error, json, type RouteContext } from './types';

/** 使用已有 settings 行，按版本原子更新，避免多个窗口互相覆盖。 */
export async function handleChainFolderRoute({ request, path, method, db, currentUser }: RouteContext): Promise<Response | null> {
  if (path !== '/api/chain-folders') return null;
  if (!['GET', 'PUT'].includes(method)) return error('不支持的文件夹操作', 405);
  const key = 'chain_folders_v1:' + currentUser.id;
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  let stored;
  try { stored = row ? readChainFolders(JSON.parse(row.value)) : emptyChainFolders(); }
  catch { return error('文件夹资料无法读取，请保留现有数据并检查备份', 503); }
  if (method === 'GET') return json(stored, 200, { 'Cache-Control': 'no-store' });
  let next;
  try {
    const text = await request.text();
    if (text.length > 4_000_000) return error('文件夹资料过大', 413);
    next = readChainFolders(JSON.parse(text));
  } catch (cause) { return error(cause instanceof Error ? cause.message : '文件夹数据无效', 400); }
  if (next.revision !== stored.revision) return error('文件夹已在其他窗口更新，请按最新目录重试', 409);
  const saved = { ...next, revision: stored.revision + 1 };
  const value = JSON.stringify(saved);
  const result = row
    ? await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').bind(value, key, row.value).run()
    : await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run();
  if (Number(result.meta.changes) !== 1) return error('文件夹已在其他窗口更新，请按最新目录重试', 409);
  return json(saved, 200, { 'Cache-Control': 'no-store' });
}
