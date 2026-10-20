import { parseStoredJson, type D1Database } from './types';
import { readVault } from './naiKeyVaultRoutes';
import type { KeyUsageRow } from '../../services/usageEvents';

const count = (value: unknown) => Math.max(0, Number(value) || 0);

/** 只向页面交付别名与指纹；原 Key 留在保管箱，不联网查询余额。 */
export async function readNaiKeyUsage(db: D1Database, userId: string, from: number, to: number): Promise<{ keys: KeyUsageRow[]; firstAt: number | null }> {
  const [vault, personal, grouped, first] = await Promise.all([
    readVault(db),
    db.prepare("SELECT value FROM settings WHERE key = 'anlas_personal_usage_v1'").first<{ value: string }>(),
    db.prepare(`SELECT target AS keyHash, action, json_extract(meta, '$.model') AS model,
      SUM(amount) AS images, SUM(COALESCE(value, 0)) AS anlas,
      SUM(COALESCE(json_extract(meta, '$.opusImages'), 0)) AS opusImages,
      SUM(CASE WHEN json_extract(meta, '$.billingKnown') = 1 THEN 0 ELSE amount END) AS unknownBillingImages
      FROM local_usage_events WHERE user_id = ? AND category = 'nai'
      AND action IN ('generation', 'encoding') AND created_at >= ? AND created_at <= ?
      AND json_valid(meta) AND length(target) = 64 AND target NOT GLOB '*[^a-f0-9]*'
      GROUP BY target, action, model ORDER BY target, action, model`)
      .bind(userId, from, to).all<{ keyHash: string; action: string; model: string; images: number; anlas: number; opusImages: number; unknownBillingImages: number }>(),
    db.prepare("SELECT MIN(created_at) AS firstAt FROM local_usage_events WHERE user_id = ? AND category = 'nai' AND action IN ('generation', 'encoding')")
      .bind(userId).first<{ firstAt: number | null }>(),
  ]);
  const stored: unknown = parseStoredJson(personal?.value, {});
  const lifetime = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, { anlasSpent?: number; opusImages?: number }> : {};
  const rows = new Map<string, KeyUsageRow>();
  const ensure = (keyHash: string, name: string | null = null) => {
    let row = rows.get(keyHash);
    if (!row) {
      const previous = lifetime[keyHash];
      row = { keyHash, name, images: 0, models: [], generationAnlas: 0, encodingAnlas: 0, opusImages: 0, unknownBillingImages: 0,
        lifetime: previous && typeof previous === 'object' ? { anlasSpent: count(previous.anlasSpent), opusImages: count(previous.opusImages) } : null };
      rows.set(keyHash, row);
    }
    return row;
  };
  const aliases = await Promise.all(vault.map(async entry => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entry.key.trim()));
    return { keyHash: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''), name: entry.name };
  }));
  aliases.forEach(entry => ensure(entry.keyHash, entry.name));
  for (const keyHash of Object.keys(lifetime)) if (/^[a-f0-9]{64}$/.test(keyHash)) ensure(keyHash);
  for (const record of grouped.results) {
    const row = ensure(record.keyHash);
    if (record.action === 'encoding') row.encodingAnlas += count(record.anlas);
    else {
      row.images += count(record.images);
      row.generationAnlas += count(record.anlas);
      row.opusImages += count(record.opusImages);
      row.unknownBillingImages += count(record.unknownBillingImages);
      row.models.push({ model: record.model, images: count(record.images) });
    }
  }
  return { keys: [...rows.values()], firstAt: first?.firstAt ?? null };
}
