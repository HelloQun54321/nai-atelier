import { emptyPromptLibraryCategoryTree, readPromptLibraryCategoryTree, type PromptLibraryCategoryTreeState } from '../../services/promptLibraryCategoryTree';
import { error, json, type RouteContext } from './types';

/** 侧存分类父子关系，读取不补写；旧值比较防止多窗口互相覆盖。 */
export async function handlePromptLibraryCategoryTreeRoute({ request, path, method, db, currentUser }: RouteContext): Promise<Response | null> {
  if (path !== '/api/prompt-library-category-tree') return null;
  if (method !== 'GET' && method !== 'PUT') return error('不支持的分类目录操作', 405);
  if (method === 'PUT' && currentUser.role === 'guest') return error('Forbidden', 403);
  const key = `prompt_library_category_tree_v1:${currentUser.id}`;
  let row: { value: string } | null;
  let stored: PromptLibraryCategoryTreeState;
  try {
    row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
    stored = row ? readPromptLibraryCategoryTree(JSON.parse(row.value)) : emptyPromptLibraryCategoryTree();
  } catch { return error('组合分类树无法读取，请保留现有数据并检查备份', 503); }
  if (method === 'GET') return json(stored, 200, { 'Cache-Control': 'no-store' });
  let next: PromptLibraryCategoryTreeState;
  try {
    const text = await request.text();
    if (text.length > 1_000_000) return error('组合分类树资料过大', 413);
    next = readPromptLibraryCategoryTree(JSON.parse(text));
  } catch (cause) { return error(cause instanceof Error ? cause.message : '组合分类树无效', 400); }
  if (next.revision !== stored.revision || stored.revision === Number.MAX_SAFE_INTEGER) return error('组合分类树已在其他窗口更新，请读取最新目录后重试', 409);
  const saved = { ...next, revision: stored.revision + 1 };
  const value = JSON.stringify(saved);
  const result = row
    ? await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').bind(value, key, row.value).run()
    : await db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)').bind(key, value).run();
  if (Number(result.meta.changes) !== 1) return error('组合分类树已在其他窗口更新，请读取最新目录后重试', 409);
  return json(saved, 200, { 'Cache-Control': 'no-store' });
}
