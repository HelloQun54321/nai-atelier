import type { PromptChain } from '../../types';
import { extractChainArtistParticipation } from '../../services/artistParticipation';
import { parseStoredJson, type D1Database } from './types';

const SNAPSHOT = 'artist_chain_snapshot_v1:';
const COUNT = 'artist_chain_count_v1:';
type ChainRow = { id: string; type: string; updated_at: number | null; base_prompt: string; modules: string; params: string; variable_values: string };
type Snapshot = { version: number | null; type: string; artists: string[] };

/** 当前仍存在的共享风格串数量；删除、移除画师会扣减，不是历史累计收录次数。 */
export async function syncArtistChainUsage(db: D1Database, id: string, knownArtists?: ReadonlySet<string>) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await db.prepare('SELECT id, type, updated_at, base_prompt, modules, params, variable_values FROM chains WHERE id = ?').bind(id).first<ChainRow>();
    const key = SNAPSHOT + id;
    const saved = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (!row && !saved) return;
    if (row?.type !== 'style' && !saved) return;
    const old = parseStoredJson(saved?.value, { version: null, type: '', artists: [] }) as Snapshot;
    const artists = row?.type === 'style' ? [...new Set(extractChainArtistParticipation({
      id, type: 'style', basePrompt: row.base_prompt || '', modules: parseStoredJson(row.modules, []),
      params: parseStoredJson(row.params, {}), variableValues: parseStoredJson(row.variable_values, {}),
    } as PromptChain, knownArtists))].sort() : [];
    const next = row ? JSON.stringify({ version: row.updated_at, type: row.type, artists }) : null;
    if (next === saved?.value) return;
    // 同时核对源版本、正文与旧快照；整个 batch 内只有赢得 CAS 的一方可以加减计数。
    const sourceGuard = row ? 'EXISTS (SELECT 1 FROM chains WHERE id = ? AND type IS ? AND updated_at IS ? AND base_prompt IS ? AND modules IS ? AND params IS ? AND variable_values IS ?)'
      : 'NOT EXISTS (SELECT 1 FROM chains WHERE id = ?)';
    const sourceValues = row ? [id, row.type, row.updated_at, row.base_prompt, row.modules, row.params, row.variable_values] : [id];
    const guard = `${sourceGuard} AND ${saved ? 'EXISTS (SELECT 1 FROM settings WHERE key = ? AND value = ?)' : 'NOT EXISTS (SELECT 1 FROM settings WHERE key = ?)'} `;
    const guardValues = [...sourceValues, key, ...(saved ? [saved.value] : [])];
    const previous = new Set(old.artists);
    const current = new Set(artists);
    const statements = [...new Set([...previous, ...current])].flatMap(name => {
      const delta = Number(current.has(name)) - Number(previous.has(name));
      return delta ? [db.prepare(`INSERT INTO settings (key, value) SELECT ?, CAST(? AS TEXT) WHERE ${guard}
        ON CONFLICT(key) DO UPDATE SET value = CAST(MAX(0, CAST(settings.value AS INTEGER) + ?) AS TEXT)`)
        .bind(COUNT + name, Math.max(0, delta), ...guardValues, delta)] : [];
    });
    statements.push(next === null
      ? db.prepare(`DELETE FROM settings WHERE key = ? AND ${guard}`).bind(key, ...guardValues)
      : db.prepare(`INSERT INTO settings (key, value) SELECT ?, ? WHERE ${guard} ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, next, ...guardValues));
    const result = await db.batch(statements);
    if (Number(result.at(-1)?.meta?.changes)) return;
  }
  throw new Error('画师收录统计并发更新冲突');
}

export async function ensureArtistChainUsage(db: D1Database, knownArtists?: ReadonlySet<string>) {
  // 仅扫描 ID／版本定位差异，正文只读取一次或实际发生变更时读取；空集合同样有快照。
  for (;;) {
    const pending = await db.prepare(`SELECT c.id FROM chains c LEFT JOIN settings s ON s.key = ? || c.id
      WHERE (c.type = 'style' OR s.key IS NOT NULL) AND
      (s.key IS NULL OR json_extract(s.value, '$.version') IS NOT c.updated_at OR json_extract(s.value, '$.type') IS NOT c.type)
      UNION ALL SELECT substr(s.key, ?) AS id FROM settings s LEFT JOIN chains c ON s.key = ? || c.id
      WHERE substr(s.key, 1, ?) = ? AND c.id IS NULL LIMIT 100`)
      .bind(SNAPSHOT, SNAPSHOT.length + 1, SNAPSHOT, SNAPSHOT.length, SNAPSHOT).all<{ id: string }>();
    if (!pending.results.length) return;
    for (const row of pending.results) await syncArtistChainUsage(db, row.id, knownArtists);
  }
}

export async function readArtistChainCounts(db: D1Database): Promise<Record<string, number>> {
  const rows = await db.prepare('SELECT substr(key, ?) AS name, CAST(value AS INTEGER) AS count FROM settings WHERE substr(key, 1, ?) = ? AND CAST(value AS INTEGER) > 0')
    .bind(COUNT.length + 1, COUNT.length, COUNT).all<{ name: string; count: number }>();
  return Object.fromEntries(rows.results.map(row => [row.name, row.count]));
}
