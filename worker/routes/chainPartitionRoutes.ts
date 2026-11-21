import type { PromptChain } from '../../types';
import { getBundlePartitions, hasLegacyChainPartition, LEGACY_BUNDLE_PARTITION, OWN_CHAIN_PARTITION } from '../../services/chainPartitions';
import { queuePromptLibraryLinkBackfill } from './promptLibraryLinkRoutes';
import { syncArtistChainUsage } from './artistChainUsage';
import { loadArtistUsageDictionary } from './artistUsageIndex';
import { error, json, type RouteContext } from './types';

/** 新建独立配置副本，复用原图与参考资产；原串及其历史关联保持原样。 */
export async function copyChainPartition({ request, db, currentUser, env }: RouteContext): Promise<Response> {
  if (currentUser.role === 'guest') return error('Forbidden', 403);
  const body = await request.json() as { ids?: unknown; target?: unknown; operation?: unknown };
  if (!Array.isArray(body?.ids) || !body.ids.length || body.ids.length > 10_000 || body.ids.some(id => typeof id !== 'string' || !id || id.length > 200) || typeof body.target !== 'string' || typeof body.operation !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(body.operation)) return error('复制选择无效', 400);
  const ids = [...new Set(body.ids as string[])];
  const copiedIds = await Promise.all(ids.map(async id => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([currentUser.id, body.operation, body.target, id])));
    return 'partition-copy-' + [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }));
  const result = await db.prepare("SELECT id, params FROM chains WHERE user_id = ? AND (type = 'style' OR type IS NULL OR type = '')").bind(currentUser.id).all<{ id: string; params: string }>();
  const chains: PromptChain[] = [];
  for (const row of result.results) {
    try {
      const params = JSON.parse(row.params);
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Invalid params');
      chains.push({ id: row.id, params } as PromptChain);
    } catch { if (ids.includes(row.id)) return error('风格串配置损坏，无法复制', 422); }
  }
  const owned = new Set(chains.map(chain => chain.id));
  const pending = ids.map((id, index) => ({ id, copyId: copiedIds[index] })).filter(item => !owned.has(item.copyId));
  if (pending.some(item => !owned.has(item.id))) return error('所选风格串不存在或无权复制', 404);
  const partitions = [{ id: OWN_CHAIN_PARTITION, name: '我的风格串' }, ...(hasLegacyChainPartition(chains) ? [{ id: LEGACY_BUNDLE_PARTITION, name: '旧分享包导入' }] : []), ...getBundlePartitions(chains)];
  const target = partitions.find(partition => partition.id === body.target);
  if (!target) return error('目标分区不存在，请刷新列表', 409);
  const encoded = JSON.stringify(target), now = Date.now(), statements = [];
  // 每块 40 对 ID，避免 D1 绑定上限；同一操作确定副本 ID，丢失回执后重试不重复创建。
  for (let offset = 0; offset < pending.length; offset += 40) {
    const chunk = pending.slice(offset, offset + 40);
    statements.push(db.prepare(`WITH selected(source_id, copy_id) AS (VALUES ${chunk.map(() => '(?, ?)').join(',')})
      INSERT INTO chains (id, user_id, username, type, name, description, tags, preview_image, base_prompt, negative_prompt, modules, params, variable_values, guest_hidden, created_at, updated_at)
      SELECT s.copy_id, c.user_id, c.username, c.type, c.name, c.description, c.tags, c.preview_image, c.base_prompt, c.negative_prompt, c.modules,
        json_set(c.params, '$._chainPartition', json(?)), c.variable_values, c.guest_hidden, ?, ?
      FROM chains c JOIN selected s ON c.id = s.source_id WHERE c.user_id = ? AND (c.type = 'style' OR c.type IS NULL OR c.type = '')
      ON CONFLICT(id) DO NOTHING`).bind(...chunk.flatMap(item => [item.id, item.copyId]), encoded, now, now, currentUser.id));
  }
  if (statements.length) await db.batch(statements);
  // 确认完整副本实际存在，再返回成功；不会覆盖先前副本的后续人工编辑。
  const existing = new Set<string>();
  for (let offset = 0; offset < copiedIds.length; offset += 80) {
    const chunk = copiedIds.slice(offset, offset + 80);
    const rows = await db.prepare(`SELECT id FROM chains WHERE user_id = ? AND id IN (${chunk.map(() => '?').join(',')})`).bind(currentUser.id, ...chunk).all<{ id: string }>();
    rows.results.forEach(row => existing.add(row.id));
  }
  if (copiedIds.some(id => !existing.has(id))) return error('记录已变化，请刷新后核对复制结果', 409);
  if (pending.length) {
    const dictionary = await loadArtistUsageDictionary(env).catch(() => new Set<string>());
    for (const { copyId } of pending) {
      try { await queuePromptLibraryLinkBackfill(db, currentUser.id, copyId, 'style'); await syncArtistChainUsage(db, copyId, dictionary); }
      catch { console.error('副本已保存，关联统计等待后续刷新'); }
    }
  }
  return json({ sourceIds: ids, copiedIds, partitionId: target.id });
}
