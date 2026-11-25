import { createDefaultPromptLibraryTree, getPromptLibraryEntryDirectoryIds, inferPurposesFromDirectoryIds, isPromptLibraryFragmentEntry, PROMPT_LIBRARY_DIRECTORY_IDS_KEY, readPromptLibraryTree, remapPromptLibraryDirectoryIds } from '../../services/promptLibraryTree.mjs';
import { getExplicitEntryPurposes, readPromptPurposes } from '../../services/promptPurposes.mjs';
import { error, json, type RouteContext } from './types';

/** 只存目录，不迁移或批量改写条目；reset 显式重置目录树并无损迁移片段归属与继承用途。 */
export async function handlePromptLibraryDirectoryRoute({ request, path, method, db, currentUser }: RouteContext): Promise<Response | null> {
  const memberships = path === '/api/prompt-library/directory-memberships';
  const reset = path === '/api/prompt-library/directories/reset';
  if (!memberships && !reset && path !== '/api/prompt-library/directories') return null;
  if (memberships || reset ? method !== 'POST' : method !== 'GET' && method !== 'PUT') return error('不支持的目录操作', 405);
  if ((memberships || reset) && (!currentUser?.id || currentUser.role === 'guest')) return error('访客不能整理提示词目录', 403);
  const key = `prompt_library_directories_v1:${currentUser.id}`;
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  let stored;
  try { stored = row ? readPromptLibraryTree(JSON.parse(row.value)) : createDefaultPromptLibraryTree(); }
  catch { return error('提示词目录无法读取，请保留现有数据并检查备份', 503); }
  if (memberships) {
    let body;
    try {
      const text = await request.text();
      if (text.length > 1_000_000) return error('提示词归属资料过大', 413);
      body = JSON.parse(text);
    } catch { return error('提示词归属数据无效', 400); }
    const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= 500 && ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 120);
    if (!body || !validIds(body.itemIds) || !body.itemIds.length
      || !validIds(body.addDirectoryIds ?? []) || !validIds(body.removeDirectoryIds ?? [])) return error('提示词归属数据无效（每批最多500项）', 400);
    const addIds: string[] = [...new Set<string>(body.addDirectoryIds ?? [])];
    const removeIds: string[] = [...new Set<string>(body.removeDirectoryIds ?? [])];
    const known = new Set(stored.nodes.map(node => node.id));
    if (!addIds.length && !removeIds.length || [...addIds, ...removeIds].some(id => !known.has(id)) || addIds.some(id => removeIds.includes(id))) return error('请选择有效且不重复增减的真实目录', 400);
    const completedIds: string[] = [];
    const failedItems: { id: string; status: number; error: string }[] = [];
    for (const id of new Set<string>(body.itemIds)) {
      try {
        const entry = await db.prepare('SELECT id, type, params FROM chains WHERE id = ? AND user_id = ?').bind(id, currentUser.id).first<{ id: string; type: string; params: string | null }>();
        if (!entry) { failedItems.push({ id, status: 404, error: '提示词条目不存在或不属于当前用户' }); continue; }
        const params = JSON.parse(entry.params ?? '{}');
        if (!params || typeof params !== 'object' || Array.isArray(params)) throw Error('提示词参数无法读取');
        if (!isPromptLibraryFragmentEntry(entry)) { failedItems.push({ id, status: 400, error: '仅提示词片段支持目录归属' }); continue; }
        const existing = Object.hasOwn(params, PROMPT_LIBRARY_DIRECTORY_IDS_KEY)
          ? params[PROMPT_LIBRARY_DIRECTORY_IDS_KEY] : getPromptLibraryEntryDirectoryIds(entry, stored);
        if (!Array.isArray(existing) || existing.some(value => typeof value !== 'string')) throw Error('提示词目录归属无法读取');
        const next = [...new Set<string>([...existing.filter(value => !removeIds.includes(value)), ...addIds])];
        // 条件更新只写目录字段；正文、其它参数或目录树并发变化时交给调用方重读。
        const result = await db.prepare(`UPDATE chains SET params = json_set(COALESCE(params, '{}'), '$._promptLibraryDirectoryIds', json(?)), updated_at = MAX(COALESCE(updated_at, 0) + 1, ?)
          WHERE id = ? AND user_id = ? AND params IS ? AND type = ?
          AND (SELECT value FROM settings WHERE key = ?) IS ?`)
          .bind(JSON.stringify(next), Date.now(), id, currentUser.id, entry.params, entry.type, key, row?.value ?? null).run();
        if (Number(result.meta.changes) !== 1) { failedItems.push({ id, status: 409, error: '条目或目录已更新，请重新读取后重试' }); continue; }
        completedIds.push(id);
      } catch (cause) {
        failedItems.push({ id, status: 503, error: cause instanceof Error ? cause.message : '提示词归属保存失败' });
      }
    }
    return json({ ok: failedItems.length === 0, completedIds, failedItems }, 200, { 'Cache-Control': 'no-store' });
  }
  if (reset) {
    let body: unknown = {};
    try {
      const text = await request.text();
      if (text.length > 10_000) return error('目录重置请求过大', 413);
      body = text.trim() ? JSON.parse(text) : {};
    } catch { return error('目录重置参数无效', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return error('目录重置参数无效', 400);
    const requestedRevision = (body as { revision?: unknown }).revision;
    if (requestedRevision !== undefined) {
      if (typeof requestedRevision !== 'number' || !Number.isInteger(requestedRevision)) return error('目录重置参数无效', 400);
      if (requestedRevision !== stored.revision) return error('提示词目录已在其他窗口更新，请读取最新目录后重试', 409);
    }
    const nextTree = { ...createDefaultPromptLibraryTree(), revision: stored.revision + 1 };
    const value = JSON.stringify(nextTree);
    const result = row
      ? await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').bind(value, key, row.value).run()
      : await db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)').bind(key, value).run();
    if (Number(result.meta.changes) !== 1) return error('提示词目录已在其他窗口更新，请读取最新目录后重试', 409);
    const knownIds = new Set(nextTree.nodes.map(node => node.id));
    const entries = await db.prepare('SELECT id, type, params FROM chains WHERE user_id = ?').bind(currentUser.id).all<{ id: string; type: string; params: string | null }>();
    let migratedCount = 0;
    let unclassifiedCount = 0;
    const now = Date.now();
    for (const entry of entries.results ?? []) {
      if (!isPromptLibraryFragmentEntry(entry)) continue;
      let params: Record<string, unknown>;
      try {
        const parsed = JSON.parse(entry.params ?? '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        params = parsed as Record<string, unknown>;
      } catch { continue; }
      const hasDirIdsKey = Object.hasOwn(params, PROMPT_LIBRARY_DIRECTORY_IDS_KEY);
      const storedRawIds = hasDirIdsKey && Array.isArray(params[PROMPT_LIBRARY_DIRECTORY_IDS_KEY])
        ? (params[PROMPT_LIBRARY_DIRECTORY_IDS_KEY] as unknown[]).filter((id): id is string => typeof id === 'string')
        : null;
      const currentIds = getPromptLibraryEntryDirectoryIds(entry, stored);
      const remappedIds = remapPromptLibraryDirectoryIds(storedRawIds ?? currentIds, knownIds);
      const prevInferred = readPromptPurposes(inferPurposesFromDirectoryIds(currentIds, stored));
      const nextInferred = readPromptPurposes(inferPurposesFromDirectoryIds(remappedIds, nextTree));
      const explicitPurposes = getExplicitEntryPurposes(entry);
      const samePurposes = prevInferred.length === nextInferred.length && prevInferred.every((id, index) => id === nextInferred[index]);
      const preservedPurposes = explicitPurposes.length === 0 && prevInferred.length > 0 && !samePurposes ? prevInferred : null;
      const dirsChanged = hasDirIdsKey
        ? (!storedRawIds || storedRawIds.length !== remappedIds.length || storedRawIds.some((id, index) => id !== remappedIds[index]))
        : remappedIds.length !== currentIds.length || remappedIds.some((id, index) => id !== currentIds[index]);
      if (!dirsChanged && !preservedPurposes) continue;
      const updateResult = preservedPurposes
        ? await db.prepare(`UPDATE chains SET params = json_set(COALESCE(params, '{}'), '$._promptLibraryDirectoryIds', json(?), '$._promptLibraryPurposes', json(?)), updated_at = MAX(COALESCE(updated_at, 0) + 1, ?) WHERE id = ? AND user_id = ? AND params IS ? AND type = ?`)
            .bind(JSON.stringify(remappedIds), JSON.stringify(preservedPurposes), now, entry.id, currentUser.id, entry.params, entry.type).run()
        : await db.prepare(`UPDATE chains SET params = json_set(COALESCE(params, '{}'), '$._promptLibraryDirectoryIds', json(?)), updated_at = MAX(COALESCE(updated_at, 0) + 1, ?) WHERE id = ? AND user_id = ? AND params IS ? AND type = ?`)
            .bind(JSON.stringify(remappedIds), now, entry.id, currentUser.id, entry.params, entry.type).run();
      if (Number(updateResult.meta.changes) === 1) {
        migratedCount += 1;
        if (remappedIds.length === 0) unclassifiedCount += 1;
      }
    }
    return json({ ok: true, tree: nextTree, migratedCount, unclassifiedCount }, 200, { 'Cache-Control': 'no-store' });
  }
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
