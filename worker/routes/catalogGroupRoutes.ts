import { emptyCatalogGroups, readCatalogGroups, type CatalogGroupKind } from '../../services/catalogGroups';
import { error, json, type RouteContext } from './types';

/** 按类型与所有者隔离，旧值条件更新保证多个窗口不会覆盖彼此。 */
export async function handleCatalogGroupRoute({ request, path, method, db, currentUser }: RouteContext): Promise<Response | null> {
  if (!path.startsWith('/api/catalog-groups/')) return null;
  const kind = path.slice('/api/catalog-groups/'.length) as CatalogGroupKind;
  if (kind !== 'artist' && kind !== 'character') return error('分组类型无效', 400);
  if (method !== 'GET' && method !== 'PUT') return error('不支持的分组操作', 405);
  const key = `catalog_groups_v1:${kind}:${currentUser.id}`;
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  const read = (value: unknown) => {
    const state = readCatalogGroups(value);
    if (Object.keys(state.memberships).some(id => kind === 'artist' ? !id.startsWith('artist:') : !id.startsWith('catalog:') && !id.startsWith('custom:'))) throw Error('分组归属无效');
    return state;
  };
  let stored;
  try { stored = row ? read(JSON.parse(row.value)) : emptyCatalogGroups(); }
  catch { return error('分组资料无法读取，请保留现有数据并检查备份', 503); }
  if (method === 'GET') return json(stored, 200, { 'Cache-Control': 'no-store' });
  let next;
  try {
    const text = await request.text();
    if (text.length > 4_000_000) return error('分组资料过大', 413);
    next = read(JSON.parse(text));
  } catch (cause) { return error(cause instanceof Error ? cause.message : '分组数据无效', 400); }
  if (next.revision !== stored.revision) return error('分组已在其他窗口更新，请按最新分组重试', 409);
  const saved = { ...next, revision: stored.revision + 1 };
  const value = JSON.stringify(saved);
  const result = row
    ? await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').bind(value, key, row.value).run()
    : await db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)').bind(key, value).run();
  if (Number(result.meta.changes) !== 1) return error('分组已在其他窗口更新，请按最新分组重试', 409);
  return json(saved, 200, { 'Cache-Control': 'no-store' });
}
