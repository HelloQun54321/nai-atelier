import { emptyPromptLibraryCategoryTree, projectPromptLibraryCategoryTree, readPromptLibraryCategoryTree, removePromptLibraryCategory, renamePromptLibraryCategory, type PromptLibraryCategoryTreeState } from '../../services/promptLibraryCategoryTree';
import { getCustomChainTags } from '../../services/chainTags';
import { isContentRecord } from '../../services/contentRoll';
import { readPromptLibraryTagNames } from '../../services/promptLibraryTags';
import type { PromptChain } from '../../types';
import { error, json, type RouteContext } from './types';

/** 侧存分类父子关系，读取不补写；旧值比较防止多窗口互相覆盖。 */
export async function handlePromptLibraryCategoryTreeRoute(context: RouteContext): Promise<Response | null> {
  const { request, path, method, db, currentUser } = context;
  if (path === '/api/prompt-library-category-tree/actions') return handleCategoryAction(context);
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

/** 组合目录操作只改关系；部分成功保留逐项回执，重试不重复创建资料。 */
async function handleCategoryAction({ request, method, db, currentUser }: RouteContext): Promise<Response> {
  if (!['GET', 'POST'].includes(method)) return error('不支持的分类目录操作', 405);
  if (method === 'POST' && (!currentUser?.id || currentUser.role === 'guest')) return error('Forbidden', 403);
  const treeKey = `prompt_library_category_tree_v1:${currentUser.id}`;
  const namesKey = `prompt_library_tags_v1:${currentUser.id}`;
  type Entry = { id: string; tags: string | null; params: string | null };
  let treeRow: { value: string } | null, namesRow: { value: string } | null;
  let tree: PromptLibraryCategoryTreeState, names: string[], entries: Entry[];
  const parseEntry = (entry: Entry) => ({ id: entry.id, tags: JSON.parse(entry.tags ?? '[]'), params: JSON.parse(entry.params ?? '{}') }) as PromptChain;
  try {
    treeRow = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(treeKey).first<{ value: string }>();
    namesRow = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(namesKey).first<{ value: string }>();
    names = namesRow ? readPromptLibraryTagNames(JSON.parse(namesRow.value)) : [];
    entries = (await db.prepare('SELECT id, tags, params FROM chains WHERE user_id = ?').bind(currentUser.id).all<Entry>()).results;
    tree = projectPromptLibraryCategoryTree(entries.map(parseEntry), names, treeRow ? readPromptLibraryCategoryTree(JSON.parse(treeRow.value)) : emptyPromptLibraryCategoryTree());
  } catch { return error('组合目录或条目无法读取，请保留现有数据并检查备份', 503); }
  if (method === 'GET') return json({ tree }, 200, { 'Cache-Control': 'no-store' });
  let body;
  try {
    const text = await request.text();
    if (text.length > 1_000_000) return error('组合目录操作资料过大', 413);
    body = JSON.parse(text);
  } catch { return error('组合目录操作无效', 400); }
  const completedIds: string[] = [];
  const failedItems: { id: string; status: number; error: string }[] = [];
  const fail = (id: string, status: number, message: string) => failedItems.push({ id, status, error: message });
  const result = () => json({ ok: failedItems.length === 0, completedIds, failedItems, tree }, 200, { 'Cache-Control': 'no-store' });
  let next = tree, nextNames = names;
  let updates: { entry: Entry; tags: string[] }[] = [];
  try {
    if (!body || !['create', 'update', 'delete', 'memberships'].includes(body.action)) throw Error('组合目录操作无效');
    if (body.action === 'memberships') {
      const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= 500 && ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200);
      if (!validIds(body.itemIds) || !body.itemIds.length || !validIds(body.addDirectoryIds ?? []) || !validIds(body.removeDirectoryIds ?? [])) throw Error('组合归属数据无效（每批最多500项）');
      const add = [...new Set<string>(body.addDirectoryIds ?? [])], remove = [...new Set<string>(body.removeDirectoryIds ?? [])];
      if (!add.length && !remove.length || [...add, ...remove].some(id => !tree.nodes.some(node => node.id === id)) || add.some(id => remove.includes(id))) throw Error('请选择有效且不重复增减的组合目录');
      for (const id of new Set<string>(body.itemIds)) {
        const entry = entries.find(item => item.id === id);
        if (!entry) { fail(id, 404, '组合不存在或不属于当前用户'); continue; }
        const parsed = parseEntry(entry);
        if (!isContentRecord(parsed)) { fail(id, 400, '仅组合支持此目录归属'); continue; }
        updates.push({ entry, tags: [...new Set([...(parsed.tags || []).filter(tag => !remove.includes(tag.trim())), ...add])] });
      }
    } else {
      if (typeof body.id !== 'string' && body.action !== 'create') throw Error('组合目录身份无效');
      const source = tree.nodes.find(node => node.id === body.id);
      if (body.action === 'create') {
        const name = readPromptLibraryTagNames([body.name])[0];
        const parentId = body.parentId ?? null;
        const existing = tree.nodes.find(node => node.id === name);
        if (existing && existing.parentId !== parentId) throw Error('组合目录已存在');
        next = readPromptLibraryCategoryTree({ ...tree, nodes: existing ? tree.nodes : [...tree.nodes, { id: name, name, parentId }] });
        nextNames = [...new Set([...names, name])];
      } else if (body.action === 'delete') {
        next = removePromptLibraryCategory(tree, body.id);
        nextNames = names.filter(name => name !== body.id);
      } else {
        if (!source) throw Error('组合目录不存在');
        const to = body.name === undefined || body.name === body.id ? body.id : readPromptLibraryTagNames([body.name])[0];
        if (to !== body.id && tree.nodes.some(node => node.id === to)) throw Error('同名组合目录已存在，普通改名不能合并目录');
        next = renamePromptLibraryCategory(tree, body.id, to);
        if (body.parentId !== undefined) next = readPromptLibraryCategoryTree({ ...next, nodes: next.nodes.map(node => node.id === to ? { ...node, parentId: body.parentId } : node) });
        nextNames = [...new Set([...names.filter(name => name !== body.id), to])];
      }
      if (body.action === 'delete' || body.action === 'update' && body.name !== undefined && body.name !== body.id) {
        updates = entries.filter(entry => { const parsed = parseEntry(entry); return isContentRecord(parsed) && getCustomChainTags(parsed.tags).includes(body.id); })
          .map(entry => ({ entry, tags: [...new Set(parseEntry(entry).tags.flatMap(tag => tag.trim() === body.id ? body.action === 'delete' ? [] : [body.name.trim()] : [tag]))] }));
      }
    }
  } catch (cause) { return error(cause instanceof Error ? cause.message : '组合目录操作无效', 400); }
  for (const { entry, tags } of updates) {
    try {
      const saved = await db.prepare(`UPDATE chains SET tags = ?, updated_at = MAX(COALESCE(updated_at, 0) + 1, ?) WHERE id = ? AND user_id = ? AND tags IS ? AND params IS ?
        AND (SELECT value FROM settings WHERE key = ?) IS ? AND (SELECT value FROM settings WHERE key = ?) IS ?`)
        .bind(JSON.stringify(tags), Date.now(), entry.id, currentUser.id, entry.tags, entry.params, treeKey, treeRow?.value ?? null, namesKey, namesRow?.value ?? null).run();
      if (Number(saved.meta.changes) === 1) completedIds.push(entry.id);
      else fail(entry.id, 409, '组合或目录已更新，请重读后重试');
    } catch { fail(entry.id, 503, '组合归属保存失败'); }
  }
  if (body.action === 'memberships' || failedItems.length) return result();
  try {
    if (tree.revision === Number.MAX_SAFE_INTEGER) throw Error('组合目录版本已达上限');
    const saved = { ...next, revision: tree.revision + 1 };
    const removed = body.action === 'delete' || body.action === 'update' && body.name !== undefined && body.name !== body.id ? body.id : null;
    // 最后落树时核对全部现存组合，防止读取后新增的旧归属被误报为全部完成。
    const cleared = ` AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM chains c, json_each(CASE WHEN json_valid(c.tags) THEN c.tags ELSE '[]' END) tag
      WHERE c.user_id = ? AND json_extract(CASE WHEN json_valid(c.params) THEN c.params ELSE '{}' END, '$._rollContentSnapshot.format') = 'nai-roll-content' AND trim(tag.value) = ?))`;
    const treeResult = treeRow
      ? await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ? AND (SELECT value FROM settings WHERE key = ?) IS ?' + cleared).bind(JSON.stringify(saved), treeKey, treeRow.value, namesKey, namesRow?.value ?? null, removed, currentUser.id, removed).run()
      : await db.prepare('INSERT OR IGNORE INTO settings(key,value) SELECT ?,? WHERE (SELECT value FROM settings WHERE key = ?) IS ?' + cleared).bind(treeKey, JSON.stringify(saved), namesKey, namesRow?.value ?? null, removed, currentUser.id, removed).run();
    if (Number(treeResult.meta.changes) !== 1) { fail(body.id ?? body.name, 409, '组合目录已更新，请重读后重试'); return result(); }
    tree = saved;
    const namesResult = namesRow
      ? await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ? AND (SELECT value FROM settings WHERE key = ?) = ?').bind(JSON.stringify(nextNames), namesKey, namesRow.value, treeKey, JSON.stringify(saved)).run()
      : await db.prepare('INSERT OR IGNORE INTO settings(key,value) SELECT ?,? WHERE (SELECT value FROM settings WHERE key = ?) = ?').bind(namesKey, JSON.stringify(nextNames), treeKey, JSON.stringify(saved)).run();
    if (Number(namesResult.meta.changes) !== 1) fail(body.id ?? body.name, 409, '组合目录候选已更新，请重读后重试');
  } catch { fail(body.id ?? body.name, 503, '组合目录保存尚未全部完成，请重新读取'); }
  return result();
}
