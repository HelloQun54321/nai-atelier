import { rollCandidateModuleId, rollSourceId } from '../../services/styleRoll';
import { addColumnIfMissing, type D1Database } from './types';

const ROLL_KEY_PREFIX = 'style_roll_v1:';
export const rollExperimentKeyPrefix = (userId: string) => `${ROLL_KEY_PREFIX}${userId}:`;
const safeJson = (value: string) => `(CASE WHEN json_valid(${value}) THEN ${value} ELSE '{}' END)`;
const originalRollHistory = (row: string) => `${row}.structure_version >= 1
 AND COALESCE(json_type(${safeJson(`${row}.params`)}, '$._local_edit'), '') NOT IN ('object', 'array')`;

// 和 rollCandidateImages 一样，原图通过记录来源和第一个匹配的候选模块归位，不比较新旧模板。
const rollHistoryCandidate = (row: string, record: string) => `(SELECT candidate.value
 FROM json_each(${record}, '$.candidates') candidate
 WHERE candidate.type = 'object' AND EXISTS (
  SELECT 1 FROM json_each(${safeJson(`${row}.modules`)}) m WHERE m.type = 'object'
  AND json_extract(CASE WHEN m.type = 'object' THEN m.value END, '$.id') = '${rollCandidateModuleId('')}' || json_extract(CASE WHEN candidate.type = 'object' THEN candidate.value END, '$.id')
 ) ORDER BY candidate.key LIMIT 1)`;
const rollHistoryCandidateId = (row: string, record: string) => `json_extract(${rollHistoryCandidate(row, record)}, '$.id')`;

/** 仍被 Roll 使用的原图是入向引用；同一时刻的旧资料保守保留，不用 SQL 排序猜浏览器的 localeCompare。 */
export const liveRollHistoryReference = (row: string) => `(CASE WHEN ${row}.source_chain_id GLOB '${rollSourceId('')}*' AND ${originalRollHistory(row)} THEN EXISTS (
 SELECT 1 FROM settings roll, json_each(json_array(${rollHistoryCandidate(row, safeJson('roll.value'))})) matched
 WHERE roll.key = '${ROLL_KEY_PREFIX}' || ${row}.user_id || ':' || substr(${row}.source_chain_id, ${rollSourceId('').length + 1})
 AND json_extract(${safeJson('roll.value')}, '$.id') = substr(${row}.source_chain_id, ${rollSourceId('').length + 1})
 AND json_extract(${safeJson('roll.value')}, '$.archived') IS NOT 1
 AND json_extract(matched.value, '$.archived') = 0
 AND NOT EXISTS (
  SELECT 1 FROM local_generation_history earlier WHERE earlier.user_id = ${row}.user_id
  AND earlier.source_chain_id = ${row}.source_chain_id AND earlier.created_at < ${row}.created_at
  AND ${originalRollHistory('earlier')}
  AND ${rollHistoryCandidateId('earlier', safeJson('roll.value'))} = json_extract(matched.value, '$.id')
 )
) ELSE 0 END)`;

/** 仅检查新启用的候选；若移入抢先提交且无活动原图，保存不能把它当作从未生成。 */
export const newRollReferenceConflict = `SELECT 1 FROM (SELECT ? AS user_id, ? AS source_chain_id, ? AS value, ? AS new_ids) r
 JOIN local_generation_recycle_bin b ON b.user_id = r.user_id AND b.source_chain_id = r.source_chain_id
 JOIN json_each(r.new_ids) added ON added.value = ${rollHistoryCandidateId('b', 'r.value')}
 WHERE ${originalRollHistory('b')} AND NOT EXISTS (
  SELECT 1 FROM local_generation_history h WHERE h.user_id = r.user_id AND h.source_chain_id = r.source_chain_id
  AND ${originalRollHistory('h')} AND ${rollHistoryCandidateId('h', 'r.value')} = added.value
 )`;

export const HISTORY_COLUMNS = 'id,user_id,image_key,image_type,prompt,negative_prompt,params,base_prompt,subject_prompt,modules,structure_version,source_chain_id,source_chain_name,source_chain_type,external_source,external_id,is_favorite,favorite_at,created_at';
export const HISTORY_ALL = `(SELECT ${HISTORY_COLUMNS} FROM local_generation_history UNION ALL SELECT ${HISTORY_COLUMNS} FROM local_generation_recycle_bin)`;
export const RECYCLE_SCHEMA = `CREATE TABLE IF NOT EXISTS local_generation_recycle_bin (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, image_key TEXT NOT NULL, image_type TEXT DEFAULT 'image/png',
 prompt TEXT DEFAULT '', negative_prompt TEXT DEFAULT '', params TEXT DEFAULT '{}',
 base_prompt TEXT DEFAULT '', subject_prompt TEXT DEFAULT '', modules TEXT DEFAULT '[]', structure_version INTEGER NOT NULL DEFAULT 0,
 source_chain_id TEXT, source_chain_name TEXT, source_chain_type TEXT, external_source TEXT, external_id TEXT,
 is_favorite INTEGER NOT NULL DEFAULT 0, favorite_at INTEGER, created_at INTEGER NOT NULL, moved_at INTEGER NOT NULL, move_nonce TEXT
)`;
const schemas = new WeakMap<D1Database, Promise<void>>();
export function ensureHistoryRecycleSchema(db: D1Database): Promise<void> {
 let pending = schemas.get(db);
 if (!pending) {
  pending = (async () => {
   await db.prepare(RECYCLE_SCHEMA).run();
   await addColumnIfMissing(db,'ALTER TABLE local_generation_recycle_bin ADD COLUMN move_nonce TEXT');
   await db.prepare('CREATE INDEX IF NOT EXISTS idx_history_bin_moved ON local_generation_recycle_bin(user_id,moved_at DESC,id DESC)').run();
   await db.prepare('CREATE INDEX IF NOT EXISTS idx_history_bin_created ON local_generation_recycle_bin(user_id,created_at DESC)').run();
   await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_history_bin_external ON local_generation_recycle_bin(user_id,external_source,external_id)').run();
   // 移入后才到达的持久引用必须在同一 SQL 写入边界拒绝，不能留下指向活动历史的悬空地址。
   // 资料先写则 move 的引用谓词会跳过；move 先提交则触发器拒绝迟到写入。
   const tables = new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{name:string}>()).results.map(row=>row.name));
   for (const [table, document, direct, when] of [
    ['chains', "json_array(NEW.params)", 'NEW.preview_image', '1'],
    ['inspirations', 'json_array(NEW.params,NEW.analysis)', 'NEW.image_url', '1'],
    ['local_generation_history', 'json_array(NEW.params)', "''", '1'],
    ['artists', 'json_array(NEW.benchmarks)', 'NEW.image_url', '1'],
    ['settings', 'json_array(NEW.value)', "''", "NEW.key NOT LIKE 'history_write_v1:%' AND NEW.key NOT LIKE 'history_preview_v1:%' AND NEW.key NOT LIKE 'history_import_v1:%' AND NEW.key NOT LIKE 'artist_usage_v1:%'"],
   ]) {
    if (!tables.has(table)) continue;
    const pointer = table === 'inspirations' ? "OR NEW.image_key = NULLIF(b.image_key,'') OR (NEW.source_type IN ('history','local-history') AND NEW.source_id = b.id)"
      : table === 'artists' ? "OR NEW.preview_url IN (SELECT value FROM json_each(urls))" : '';
    for (const action of ['INSERT','UPDATE']) {
     await db.prepare(`CREATE TRIGGER IF NOT EXISTS history_bin_reference_${table}_${action.toLowerCase()} BEFORE ${action} ON ${table}
      WHEN ${when} AND EXISTS (SELECT 1 FROM (SELECT b.*, json_array('/api/local-history/' || b.id || '/image',
       '/api/assets/' || b.image_key,
       '/api/assets/' || replace(replace(replace(b.image_key,'%','%25'),'/','%2F'),' ','%20'),
       '/api/assets/' || replace(replace(b.image_key,'%','%25'),' ','%20'),
       CASE WHEN b.external_id IS NOT NULL AND b.external_id <> '' THEN '/api/integrations/st-chatu8/history/' || b.external_id || '/image' END) AS urls
       FROM local_generation_recycle_bin b) b
      WHERE ${direct} IN (SELECT value FROM json_each(urls)) ${pointer}
       OR EXISTS(SELECT 1 FROM json_each(${document}) docs,
        json_tree(CASE WHEN json_valid(docs.value) THEN docs.value ELSE '{}' END) n
        WHERE n.type = 'text' AND (EXISTS(SELECT 1 FROM json_each(urls) u WHERE n.atom = u.value OR (substr(n.atom,1,length(u.value)) = u.value AND substr(n.atom,length(u.value)+1,1) IN ('?','#'))) OR n.atom = NULLIF(b.image_key,'')
         OR (n.key IN ('historyId','history_id','sourceHistoryId') AND n.atom = b.id))))
      BEGIN SELECT RAISE(ABORT,'history_reference_target_recycled'); END`).run();
    }
   }
  })().catch(cause => { schemas.delete(db); throw cause; });
  schemas.set(db, pending);
 }
 return pending;
}

/** D1 唯一键协调跨请求写入；不以进程锁代替数据库原子性。异常中断后保守保留占用，不自动抢占仍可能写 R2 的请求。 */
export async function claimHistoryWrite(db: D1Database, id: string, user: string, externalSource?: string | null, externalId?: string | null) {
 const token = crypto.randomUUID();
 const keys = [`history_write_v1:id:${id}`, ...(externalSource && externalId ? [`history_write_v1:external:${encodeURIComponent(user)}:${encodeURIComponent(externalSource)}:${encodeURIComponent(externalId)}`] : [])];
 try {
  await db.batch(keys.map(key => db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').bind(key, token)));
 } catch { return null; }
 return async () => { await db.batch(keys.map(key => db.prepare('DELETE FROM settings WHERE key = ? AND value = ?').bind(key, token))); };
}
