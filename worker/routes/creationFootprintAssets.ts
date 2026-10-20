import { validateRollExperiment } from '../../services/styleRoll';
import type { UsageAssets } from '../../services/usageStats';
import type { D1Database } from './types';

/** 资产目录的只读摘要；各分组失败独立保留，不向足迹发送完整创作配置。 */
export async function readCreationFootprintAssets(db: D1Database, userId: string): Promise<UsageAssets> {
  const prefix = `style_roll_v1:${userId}:`;
  const [roll, vibes, groups] = await Promise.allSettled([
    (async () => {
      const rows = await db.prepare('SELECT value FROM settings WHERE key >= ? AND key < ?').bind(prefix, prefix + '\uffff').all<{ value: string }>();
      return rows.results.map(row => {
        const value: unknown = JSON.parse(row.value);
        validateRollExperiment(value);
        return { id: value.id, name: value.name, archived: value.archived, updatedAt: value.updatedAt,
          candidates: value.candidates.map(item => ({ createdAt: item.createdAt, savedChainId: item.savedChainId, archived: item.archived })),
          rounds: value.rounds.map(item => ({ createdAt: item.createdAt })) };
      }).sort((a, b) => b.updatedAt - a.updatedAt);
    })(),
    (async () => {
      const rows = await db.prepare(`SELECT a.id, a.created_at AS assetAt, e.model, e.created_at AS encodingAt
        FROM vibe_assets a LEFT JOIN vibe_encodings e ON e.vibe_id = a.id
        WHERE a.archived = 0 ORDER BY a.updated_at DESC, e.information_extracted DESC`)
        .all<{ id: string; assetAt: number; model: string | null; encodingAt: number | null }>();
      const assets = new Map<string, NonNullable<UsageAssets['vibes']>[number]>();
      for (const row of rows.results) {
        let asset = assets.get(row.id);
        if (!asset) { asset = { createdAt: row.assetAt, encodings: [] }; assets.set(row.id, asset); }
        if (row.model !== null && row.encodingAt !== null) asset.encodings.push({ model: row.model, createdAt: row.encodingAt });
      }
      return [...assets.values()];
    })(),
    db.prepare('SELECT created_at AS createdAt FROM vibe_groups ORDER BY updated_at DESC').all<{ createdAt: number }>(),
  ]);
  return {
    roll: roll.status === 'fulfilled' ? roll.value : undefined,
    vibes: vibes.status === 'fulfilled' ? vibes.value : undefined,
    vibeGroups: groups.status === 'fulfilled' ? groups.value.results : undefined,
  };
}
