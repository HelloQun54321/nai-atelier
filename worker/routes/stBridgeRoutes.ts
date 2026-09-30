// SillyTavern / st-chatu8 history bridge.
// Moved verbatim from worker/index.ts during the domain split; behavior unchanged.
//
// Note: localHistoryImageUrl() may emit
//   /api/integrations/st-chatu8/history/<external_id>/image
// URLs for imported rows. Those are intentionally NOT registered here; the
// local media gateway (scripts/media-gateway.mjs) serves them.
import { json, error, parseStoredJson, type RouteContext } from './types';
import { localHistoryEnabled, ensureLocalHistorySchema } from './historyRoutes';
import { isStChatu8ExportableChain } from '../stChatu8Policy.mjs';

const preferenceKey = 'st_chatu8_preferences_v1';
const isEnabled = async (db: RouteContext['db']) => {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(preferenceKey).first<{ value: string }>();
  return parseStoredJson(row?.value, {})?.enabled === true;
};

export async function handleStBridgeRoute(ctx: RouteContext): Promise<Response | null> {
  const { request, env, db, path, method, currentUser } = ctx;

  if (path === '/api/st-chatu8/preferences') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    if (method === 'GET') return json({ enabled: await isEnabled(db) });
    if (method !== 'POST') return error('Method not allowed', 405);
    const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== 'boolean') return error('智慧姬同步开关无效', 400);
    await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(preferenceKey, JSON.stringify({ enabled: body.enabled })).run();
    return json({ enabled: body.enabled });
  }

  // 使用既有设置表保存发送范围；初次为空，不沿用过去的全量关联。
  if (path === '/api/st-chatu8/export-selection') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    const key = 'st_chatu8_export_selection_v1';
    const rows = await db.prepare("SELECT id, params FROM chains WHERE type = 'style' OR type IS NULL OR type = ''").all<{ id: string; params: string }>();
    const available = new Set(rows.results.filter(row => isStChatu8ExportableChain({ params: parseStoredJson(row.params, {}) })).map(row => row.id));
    if (method === 'GET') {
      const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
      const value = parseStoredJson(row?.value, []);
      return json({ chainIds: Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && available.has(id)))] : [] });
    }
    if (method !== 'POST') return error('Method not allowed', 405);
    if (!await isEnabled(db)) return error('请先在设置中开启智慧姬同步', 409);
    const body = await request.json() as { chainIds?: unknown };
    if (!Array.isArray(body?.chainIds) || body.chainIds.some(id => typeof id !== 'string' || !id || id.length > 200)) return error('同步范围无效', 400);
    const chainIds = [...new Set(body.chainIds.filter(id => available.has(id)))];
    await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(key, JSON.stringify(chainIds)).run();
    return json({ chainIds });
  }

  if (path === '/api/integrations/st-chatu8/history/known' && method === 'POST') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    if (!await isEnabled(db)) return error('智慧姬同步已关闭', 409);
    if (!localHistoryEnabled(env)) return error('Local history is disabled', 404);
    await ensureLocalHistorySchema(db);
    const body = await request.json() as any;
    const ids = Array.isArray(body.externalIds)
      ? body.externalIds.slice(0, 1000).map((id: any) => String(id)).filter((id: string) => /^[a-f0-9]{64}$/i.test(id))
      : [];
    if (!ids.length) return json({ externalIds: [] });
    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.prepare(`SELECT external_id FROM local_generation_history
      WHERE user_id = ? AND external_source = 'st-chatu8' AND external_id IN (${placeholders})`)
      .bind(currentUser.id, ...ids).all<{external_id: string}>();
    return json({ externalIds: rows.results.map(row => row.external_id) });
  }

  if (path === '/api/integrations/st-chatu8/history/import' && method === 'POST') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    if (!await isEnabled(db)) return error('智慧姬同步已关闭', 409);
    if (!localHistoryEnabled(env)) return error('Local history is disabled', 404);
    await ensureLocalHistorySchema(db);
    const body = await request.json() as any;
    const items = Array.isArray(body.items) ? body.items.slice(0, 500) : [];
    if (!items.length) return json({ imported: 0, skipped: 0 });
    let imported = 0;
    let skipped = 0;
    for (const item of items) {
      const externalId = String(item?.externalId || '').trim();
      if (!/^[a-f0-9]{64}$/i.test(externalId)) { skipped++; continue; }
      const existing = await db.prepare(`SELECT id FROM local_generation_history
        WHERE user_id = ? AND external_source = 'st-chatu8' AND external_id = ?`)
        .bind(currentUser.id, externalId).first<{id: string}>();
      if (existing) { skipped++; continue; }
      const id = `st-chatu8-${externalId.slice(0, 32)}`;
      const result = await db.prepare(`INSERT OR IGNORE INTO local_generation_history (
        id, user_id, image_key, image_type, prompt, negative_prompt, params,
        source_chain_id, source_chain_name, source_chain_type, external_source, external_id, created_at
      ) VALUES (?, ?, '', ?, ?, ?, ?, NULL, ?, 'playground', 'st-chatu8', ?, ?)`)
        .bind(
          id, currentUser.id, String(item.imageType || 'image/png'), String(item.prompt || ''),
          String(item.negativePrompt || ''), JSON.stringify(item.params || {}),
          String(item.sourceName || 'st-chatu8'), externalId, Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now()
        ).run();
      // INSERT OR IGNORE 可能因主键冲突静默忽略：按实际写入行数计数，统计才准确
      if ((result.meta?.changes || 0) > 0) imported++; else skipped++;
    }
    return json({ imported, skipped });
  }

  return null;
}
