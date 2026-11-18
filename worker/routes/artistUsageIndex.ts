import { HISTORY_ALL, ensureHistoryRecycleSchema } from './historyRecycleSchema';
import { extractHistoryParticipation, normalizeArtistUsageKey } from '../../services/artistParticipation';
import type { D1Database, Env } from './types';

export interface ArtistHistorySnapshot {
  artists: string[]; tags: string[]; characters: { id: string; name: string }[];
  at: number; active: boolean; excluded: boolean; sample: boolean;
}
const prefix = (user: string, kind: string) => `artist_usage_v1:${encodeURIComponent(user)}:${kind}:`;
const receiptKey = (user: string, id: string) => prefix(user, 'history') + id;
const sourceVersion = "json_array(prompt, base_prompt, subject_prompt, CASE WHEN json_valid(params) THEN json_extract(params, '$.characters') END, created_at, source_chain_id, external_source, image_key)";
const readSource = async (db: D1Database, user: string, id: string) => {
  await ensureHistoryRecycleSchema(db);
  const rows = await db.prepare(`SELECT id, prompt, base_prompt, subject_prompt, created_at, source_chain_id, external_source,
    CASE WHEN json_valid(params) THEN json_extract(params, '$.characters') END AS characters, ${sourceVersion} AS version
    FROM ${HISTORY_ALL} WHERE id = ? AND user_id = ?`).bind(id, user).all<any>();
  if (rows.results.length > 1) throw new Error('历史与回收站身份冲突，统计未更新');
  return rows.results[0] || null;
};
const dictionaries = new WeakMap<object, Promise<ReadonlySet<string> | null>>();
export const ARTIST_DICTIONARY_UNAVAILABLE = '尚未安装 Tag 词库，暂时无法统计画师使用情况';

export function loadArtistUsageDictionary(env: Env): Promise<ReadonlySet<string> | null> {
  const origin = env.TAG_DICTIONARY_LOCAL_ORIGIN;
  if (!origin && !env.ASSETS) return Promise.resolve(new Set());
  const cacheKey = env.ASSETS || env;
  let pending = dictionaries.get(cacheKey);
  if (!pending) {
    const read = async (path: string): Promise<unknown> => {
      const request = new Request(new URL(`/tag-data/${path}`, origin || 'https://atelier.local'), { redirect: 'error' });
      // 词库随本机资源目录更新，完整本地启动时从网关读取当前词库。
      const response = origin ? await fetch(request) : await env.ASSETS.fetch(request);
      if (response.status === 404 || (response.ok && response.headers.get('content-type')?.toLowerCase().startsWith('text/html'))) {
        await response.body?.cancel();
        return undefined;
      }
      if (!response.ok) throw new Error('画师统计词库读取失败');
      return response.json().catch(() => { throw new Error('画师统计词库数据格式无效'); });
    };
    pending = (async () => {
      const manifest = await read('manifest.json') as { artistPages?: unknown } | null | undefined;
      if (manifest === undefined) return null;
      const files = manifest?.artistPages;
      if (!Array.isArray(files) || files.some(file => typeof file !== 'string' || !/^[\w.-]+\.json$/.test(file))) {
        throw new Error('画师统计词库清单格式无效');
      }
      const names = new Set<string>();
      for (const file of files) {
        const entries = await read(`artist-pages/${file}`);
        if (!Array.isArray(entries) || entries.some(entry => !Array.isArray(entry) || typeof entry[0] !== 'string')) {
          throw new Error('画师统计词库分页缺失或格式无效');
        }
        for (const entry of entries) names.add(normalizeArtistUsageKey(entry[0]));
      }
      return names;
    })().then(names => {
      if (names === null) dictionaries.delete(cacheKey);
      return names;
    }, cause => { dictionaries.delete(cacheKey); throw cause; });
    dictionaries.set(cacheKey, pending);
  }
  return pending;
}

export async function recordArtistHistory(db: D1Database, user: string, input: any, known?: ReadonlySet<string>) {
  const key = receiptKey(user, input.id);
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await db.prepare('SELECT key FROM settings WHERE key = ?').bind(key).first()) return;
    const row = await readSource(db, user, input.id);
    if (!row) return;
    const sample = String(row.source_chain_id || '').startsWith('artist-sample:');
    const excluded = sample || Boolean(row.external_source);
    const snapshot: ArtistHistorySnapshot = { ...extractHistoryParticipation(row, known), at: Number(row.created_at) || 0, active: true, excluded, sample };
    const guard = `NOT EXISTS (SELECT 1 FROM settings WHERE key = ?) AND EXISTS
      (SELECT 1 FROM ${HISTORY_ALL} WHERE id = ? AND user_id = ? AND ${sourceVersion} = ?)`;
    const values = [key, row.id, user, row.version];
    const statements = [];
    if (!excluded) for (const name of snapshot.artists) {
      statements.push(db.prepare(`INSERT INTO settings (key, value)
        SELECT ?, json_object('name', ?, 'images', 1, 'lastAt', ?) WHERE ${guard}
        ON CONFLICT(key) DO UPDATE SET value = json_set(settings.value,
          '$.images', json_extract(settings.value, '$.images') + 1,
          '$.lastAt', MAX(json_extract(settings.value, '$.lastAt'), ?))`)
        .bind(prefix(user, 'generated') + encodeURIComponent(name), name, snapshot.at, ...values, snapshot.at));
    }
    // 来源与凭据共同比较，迟到回填不能替同 ID 的新图片写入旧归因。
    statements.push(db.prepare(`INSERT OR IGNORE INTO settings (key, value) SELECT ?, ? WHERE ${guard}`)
      .bind(key, JSON.stringify(snapshot), ...values));
    const result = await db.batch(statements);
    if (Number(result.at(-1)?.meta?.changes)) return;
  }
  throw new Error('画师图片统计并发更新冲突');
}

export async function ensureArtistHistoryIndex(db: D1Database, user: string, env: Env) {
  await ensureHistoryRecycleSchema(db);
  const conflict = await db.prepare(`SELECT id FROM ${HISTORY_ALL} WHERE user_id = ? GROUP BY id HAVING COUNT(*) > 1 LIMIT 1`).bind(user).first();
  if (conflict) throw new Error('历史与回收站身份冲突，统计未更新');
  let known: ReadonlySet<string> | undefined;
  for (;;) {
    const rows = await db.prepare(`SELECT h.id, h.prompt, h.base_prompt, h.subject_prompt, h.created_at,
      h.source_chain_id, h.external_source,
      CASE WHEN json_valid(h.params) THEN json_extract(h.params, '$.characters') END AS characters
      FROM ${HISTORY_ALL} h
      WHERE h.user_id = ? AND NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = ? || h.id)
      ORDER BY h.id LIMIT 100`).bind(user, prefix(user, 'history')).all<any>();
    if (!rows.results.length) return;
    if (!known) {
      const dictionary = await loadArtistUsageDictionary(env);
      if (dictionary === null) throw new Error(ARTIST_DICTIONARY_UNAVAILABLE);
      known = dictionary;
    }
    for (const row of rows.results) await recordArtistHistory(db, user, row, known);
  }
}

export async function deactivateArtistHistory(db: D1Database, user: string, rows: { id: string; moved_at?: number }[], _env: Env, scope: 'active' | 'bin' = 'active') {
  const table = scope === 'bin' ? 'local_generation_recycle_bin' : 'local_generation_history';
  const deletedIds: string[] = [];
  for (const item of rows) {
    let completed = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await db.prepare(`SELECT *, ${sourceVersion} AS version FROM ${table} WHERE id = ? AND user_id = ?`).bind(item.id, user).first<any>();
      if (!row) { completed = true; break; }
      const key = receiptKey(user, row.id);
      const receipt = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
      const snapshot = receipt ? JSON.parse(receipt.value) as ArtistHistorySnapshot : null;
      const receiptGuard = receipt ? 'EXISTS (SELECT 1 FROM settings WHERE key = ? AND value = ?)' : 'NOT EXISTS (SELECT 1 FROM settings WHERE key = ?)';
      const receiptValues = receipt ? [key, receipt.value] : [key];
      if (scope === 'bin' && item.moved_at !== undefined && row.moved_at !== item.moved_at) { completed = true; break; }
      const guard = `${receiptGuard} AND EXISTS (SELECT 1 FROM ${table} WHERE id = ? AND user_id = ? AND ${sourceVersion} = ?${scope === 'bin' ? ' AND moved_at = ?' : ''})`;
      const values = [...receiptValues, row.id, user, row.version, ...(scope === 'bin' ? [row.moved_at] : [])];
      const statements = [];
      if (snapshot && !snapshot.excluded) for (const name of snapshot.artists) {
        statements.push(db.prepare(`UPDATE settings SET value = json_set(value, '$.images', MAX(0, json_extract(value, '$.images') - 1),
          '$.lastAt', COALESCE((SELECT MAX(json_extract(s.value, '$.at')) FROM settings s, json_each(s.value, '$.artists') a
            WHERE s.key >= ? AND s.key < ? AND s.key <> ? AND json_extract(s.value, '$.excluded') = 0 AND a.value = ?), 0))
          WHERE key = ? AND ${guard}`)
          .bind(prefix(user, 'history'), prefix(user, 'history') + '\uffff', key, name, prefix(user, 'generated') + encodeURIComponent(name), ...values));
      }
      statements.push(db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ? AND ${guard}`).bind(item.id, user, ...values));
      statements.push(db.prepare(`DELETE FROM settings WHERE key = ? AND ${receiptGuard}
        AND NOT EXISTS (SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?)`).bind(key, ...receiptValues, item.id, user));
      const result = await db.batch(statements);
      if (Number(result.at(-2)?.meta?.changes)) { deletedIds.push(item.id); completed = true; break; }
    }
    if (!completed) throw new Error('画师图片删除统计并发更新冲突');
  }
  return deletedIds;
}

export async function readArtistHistorySnapshots(db: D1Database, user: string, from: number, to: number) {
  const start = prefix(user, 'history');
  const rows = await db.prepare(`SELECT value FROM settings WHERE key >= ? AND key < ?
    AND json_extract(value, '$.active') = 1 AND json_extract(value, '$.sample') = 0
    AND json_extract(value, '$.at') >= ? AND json_extract(value, '$.at') <= ?`)
    .bind(start, start + '\uffff', from, to).all<{ value: string }>();
  return rows.results.map(row => JSON.parse(row.value) as ArtistHistorySnapshot);
}

export async function readArtistGenerationCounts(db: D1Database, user: string) {
  const start = prefix(user, 'generated');
  const rows = await db.prepare('SELECT value FROM settings WHERE key >= ? AND key < ?').bind(start, start + '\uffff').all<{ value: string }>();
  return rows.results.map(row => JSON.parse(row.value) as { name: string; images: number; lastAt: number });
}
