import { createDefaultPromptLibraryTree, readPromptLibraryTree } from '../../services/promptLibraryTree.mjs';
import { error, json, type RouteContext } from './types';

/** 只存目录，不迁移或批量改写条目；旧值条件更新防止跨窗口覆盖。 */
export async function handlePromptLibraryDirectoryRoute({ request, path, method, db, currentUser }: RouteContext): Promise<Response | null> {
  if (path !== '/api/prompt-library/directories') return null;
  if (method !== 'GET' && method !== 'PUT') return error('不支持的目录操作', 405);
  const key = `prompt_library_directories_v1:${currentUser.id}`;
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  let stored;
  try { stored = row ? readPromptLibraryTree(JSON.parse(row.value)) : createDefaultPromptLibraryTree(); }
  catch { return error('提示词目录无法读取，请保留现有数据并检查备份', 503); }
  if (method === 'GET') return json(stored, 200, { 'Cache-Control': 'no-store' });
  let next;
  try {
    const text = await request.text();
    if (text.length > 1_000_000) return error('提示词目录资料过大', 413);
    next = readPromptLibraryTree(JSON.parse(text));
  } catch (cause) { return error(cause instanceof Error ? cause.message : '提示词目录数据无效', 400); }
  if (next.revision !== stored.revision) return error('提示词目录已在其他窗口更新，请读取最新目录后重试', 409);
  const saved = { ...next, revision: stored.revision + 1 };
  const value = JSON.stringify(saved);
  const result = row
    ? await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').bind(value, key, row.value).run()
    : await db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)').bind(key, value).run();
  if (Number(result.meta.changes) !== 1) return error('提示词目录已在其他窗口更新，请读取最新目录后重试', 409);
  return json(saved, 200, { 'Cache-Control': 'no-store' });
}
