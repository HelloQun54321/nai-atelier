import { parseStoredJson, type D1Database } from './routes/types';
import { isStChatu8ExportableChain } from './stChatu8Policy.mjs';

export interface StSyncEntry {
  chainId: string;
  requestId: string;
  status: 'pending' | 'synced' | 'removed';
  requestedAt: number;
  confirmedAt: number;
  lastVerifiedAt: number;
  removedAt?: number;
  error?: string;
  returnStatus?: 'synced' | 'removed';
}
export interface StSyncWorkspace { entries: StSyncEntry[]; lastSnapshotAt: number }
export interface StSyncUpdate {
  chainId: string; requestId: string;
  status?: 'synced' | 'removed';
  error?: string;
  onlyPending?: boolean;
}
const key = 'st_chatu8_sync_workspace_v1';
const legacyKey = 'st_chatu8_export_selection_v1';

const readStored = async (db: D1Database) => {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  if (row) {
    const value = parseStoredJson(row.value, {}) as Partial<StSyncWorkspace>;
    return { raw: row.value, workspace: { entries: Array.isArray(value?.entries) ? value.entries.filter(entry => entry && typeof entry.chainId === 'string' && typeof entry.requestId === 'string' && ['pending', 'synced', 'removed'].includes(entry.status)) : [], lastSnapshotAt: Number(value?.lastSnapshotAt) || 0 } };
  }
  const legacy = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(legacyKey).first<{ value: string }>();
  const ids = parseStoredJson(legacy?.value, []);
  // 旧范围没有接收凭据，先视为待同步；读取不改写旧数据。
  const entries: StSyncEntry[] = Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === 'string' && id))].map(chainId => ({
    chainId, requestId: `legacy:${chainId}`, status: 'pending', requestedAt: 0, confirmedAt: 0, lastVerifiedAt: 0,
  })) : [];
  return { raw: null, workspace: { entries, lastSnapshotAt: 0 } };
};

export async function readStSyncWorkspace(db: D1Database) {
  const { workspace } = await readStored(db);
  const rows = await readStSyncChains(db, workspace.entries.map(entry => entry.chainId));
  const existing = new Set(rows.map(row => row.id));
  const available = new Set(rows.filter(row => isStChatu8ExportableChain({ params: parseStoredJson(row.params, {}) })).map(row => row.id));
  const entries = workspace.entries.filter(entry => existing.has(entry.chainId));
  return { ...workspace, entries, chainIds: entries.filter(entry => entry.status === 'pending' && available.has(entry.chainId)).map(entry => entry.chainId) };
}

/** 核对只读取用户选过的条目，不为状态刷新反复扫描整座资料库。 */
export async function readStSyncChains(db: D1Database, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows: { id: string; params: string }[] = [];
  for (let offset = 0; offset < unique.length; offset += 80) {
    const batch = unique.slice(offset, offset + 80);
    const result = await db.prepare(`SELECT id, params FROM chains WHERE id IN (${batch.map(() => '?').join(',')}) AND (type = 'style' OR type IS NULL OR type = '')`).bind(...batch).all<{ id: string; params: string }>();
    rows.push(...result.results);
  }
  return rows;
}

/** 设置表内的条件写入保护跨页面操作，不覆盖同时到达的接收回执。 */
export async function updateStSyncWorkspace(db: D1Database, change: (workspace: StSyncWorkspace) => void) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { raw, workspace } = await readStored(db);
    change(workspace);
    const value = JSON.stringify(workspace);
    const result = raw === null
      ? await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run()
      : await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').bind(value, key, raw).run();
    if (result.meta?.changes) return readStSyncWorkspace(db);
  }
  throw new Error('同步列表正在更新，请稍后再操作');
}

export const enqueueStSync = (workspace: StSyncWorkspace, ids: string[], requeue = false) => {
  for (const chainId of ids) {
    const entry = workspace.entries.find(item => item.chainId === chainId);
    if (entry && (!requeue || (entry.status === 'pending' && !entry.error))) continue;
    const next: StSyncEntry = { ...entry, chainId, requestId: crypto.randomUUID(), status: 'pending', requestedAt: Date.now(), confirmedAt: entry?.confirmedAt || 0, lastVerifiedAt: entry?.lastVerifiedAt || 0, returnStatus: entry?.status === 'synced' || entry?.status === 'removed' ? entry.status : entry?.returnStatus, error: '' };
    if (entry) Object.assign(entry, next); else workspace.entries.push(next);
  }
};

export const removeStSyncPending = (workspace: StSyncWorkspace, ids: string[]) => {
  const remove = new Set(ids);
  workspace.entries = workspace.entries.filter(entry => {
    if (entry.status !== 'pending' || !remove.has(entry.chainId)) return true;
    if (!entry.confirmedAt) return false;
    entry.requestId = crypto.randomUUID();
    entry.status = entry.returnStatus || ((entry.removedAt || 0) > entry.confirmedAt ? 'removed' : 'synced');
    entry.error = '';
    return true;
  });
};

export const applyStSyncUpdates = (workspace: StSyncWorkspace, updates: StSyncUpdate[], verifiedAt: number) => {
  for (const update of updates) {
    const entry = workspace.entries.find(item => item.chainId === update.chainId && item.requestId === update.requestId);
    if (!entry) continue; // 取消或重新加入后的旧回执不能改变新任务。
    if (update.onlyPending && entry.status !== 'pending') continue;
    if (update.status === 'synced') {
      if (entry.status !== 'synced') entry.confirmedAt = verifiedAt;
      entry.status = 'synced'; entry.lastVerifiedAt = verifiedAt; entry.error = '';
      delete entry.returnStatus;
    } else if (update.status === 'removed' && entry.status !== 'pending') {
      if (entry.status !== 'removed') entry.removedAt = verifiedAt;
      entry.status = 'removed'; entry.lastVerifiedAt = verifiedAt; entry.error = '';
    } else if (typeof update.error === 'string' && entry.status === 'pending') entry.error = update.error.slice(0, 200);
  }
  if (verifiedAt) workspace.lastSnapshotAt = Math.max(workspace.lastSnapshotAt, verifiedAt);
};
