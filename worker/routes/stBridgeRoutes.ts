// SillyTavern / st-chatu8 history bridge.
// Moved verbatim from worker/index.ts during the domain split; behavior unchanged.
//
// Note: localHistoryImageUrl() may emit
//   /api/integrations/st-chatu8/history/<external_id>/image
// URLs for imported rows. Those are intentionally NOT registered here; the
// local media gateway (scripts/media-gateway.mjs) serves them.
import { json, error, type RouteContext } from './types';
import { localHistoryEnabled, ensureLocalHistorySchema } from './historyRoutes';

export async function handleStBridgeRoute(ctx: RouteContext): Promise<Response | null> {
  const { request, env, db, path, method, currentUser } = ctx;

  if (path === '/api/integrations/st-chatu8/history/known' && method === 'POST') {
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
      await db.prepare(`INSERT OR IGNORE INTO local_generation_history (
        id, user_id, image_key, image_type, prompt, negative_prompt, params,
        source_chain_id, source_chain_name, source_chain_type, external_source, external_id, created_at
      ) VALUES (?, ?, '', ?, ?, ?, ?, NULL, ?, 'playground', 'st-chatu8', ?, ?)`)
        .bind(
          id, currentUser.id, String(item.imageType || 'image/png'), String(item.prompt || ''),
          String(item.negativePrompt || ''), JSON.stringify(item.params || {}),
          String(item.sourceName || 'st-chatu8'), externalId, Number(item.createdAt || Date.now())
        ).run();
      imported++;
    }
    return json({ imported, skipped });
  }

  return null;
}
