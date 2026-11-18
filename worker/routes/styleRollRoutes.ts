import { rollExperimentSummary, rollPrompt, rollSourceId, rollCandidateModuleId, validateRollBlocklist, validateRollExperiment, validateRollPreset, type RollExperiment, type RollPreset } from '../../services/styleRoll';
import { error, json, type RouteContext } from './types';
import { ensureHistoryRecycleSchema, newRollReferenceConflict, rollExperimentKeyPrefix } from './historyRecycleSchema';

const blocklistKey = (userId: string) => `style_roll_blocklist_v1:${userId}`;

/** 复用私人 settings，无表结构变更；版本比较避免两端静默覆盖同一次实验。 */
export async function handleStyleRollRoute({ path, method, request, db, currentUser }: RouteContext): Promise<Response | null> {
  const presetCollection = path === '/api/style-roll/presets';
  const presetItem = path.match(/^\/api\/style-roll\/presets\/([^/]+)$/);
  const experimentItem = path.match(/^\/api\/style-roll\/([^/]+)$/);
  if (path !== '/api/style-roll' && path !== '/api/style-roll/blocklist' && !presetCollection && !presetItem && !experimentItem) return null;
  if (currentUser.role === 'guest') return error('访客无法访问 Roll 串实验', 403);

  if (presetCollection || presetItem) {
    const prefix = `style_roll_preset_v1:${currentUser.id}:`;
    if (presetCollection && method === 'GET') {
      const rows = await db.prepare('SELECT value FROM settings WHERE key >= ? AND key < ?').bind(prefix, prefix + '\uffff').all<{ value: string }>();
      try {
        const presets = rows.results.map(row => { const value: unknown = JSON.parse(row.value); validateRollPreset(value); return value; });
        return json({ presets: presets.sort((a, b) => b.updatedAt - a.updatedAt) });
      } catch { return error('Roll 预设读取失败，请保留资料并检查备份', 500); }
    }
    if (presetItem) {
      if (method !== 'DELETE') return error('Method not allowed', 405);
      const id = presetItem[1], revisionText = new URL(request.url).searchParams.get('revision');
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !revisionText || !/^\d+$/.test(revisionText) || !Number.isSafeInteger(Number(revisionText))) return error('Roll 预设版本无效', 400);
      const key = prefix + id;
      const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
      if (!row) return error('Roll 预设不存在', 404);
      let previous: RollPreset;
      try { const value: unknown = JSON.parse(row.value); validateRollPreset(value); previous = value; }
      catch { return error('Roll 预设读取失败，请保留资料并检查备份', 500); }
      if (previous.revision !== Number(revisionText)) return error('预设已在其他页面更新，请重新加载后继续', 409);
      const deleted = await db.prepare('DELETE FROM settings WHERE key = ? AND value = ? RETURNING key').bind(key, row.value).first();
      if (!deleted) return error('预设已在其他页面更新，请重新加载后继续', 409);
      return json({ deleted: id });
    }
    if (method !== 'PUT') return error('Method not allowed', 405);
    const raw = await request.text();
    if (raw.length > 1_000_000) return error('Roll 预设过大', 413);
    let preset: RollPreset;
    try { const value: unknown = JSON.parse(raw); validateRollPreset(value); preset = value; }
    catch (cause) { return error(cause instanceof Error ? cause.message : 'Roll 预设资料无效', 400); }
    const key = prefix + preset.id;
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
    let previous: RollPreset | undefined;
    if (row) {
      try { const value: unknown = JSON.parse(row.value); validateRollPreset(value); previous = value; }
      catch { return error('Roll 预设读取失败，请保留资料并检查备份', 500); }
    }
    if ((previous?.revision ?? 0) !== preset.revision || (!previous && preset.revision !== 0)) return error('预设已在其他页面更新，请重新加载后继续', 409);
    const saved: RollPreset = { id: preset.id, name: preset.name, template: preset.template, revision: preset.revision + 1, createdAt: previous?.createdAt ?? preset.createdAt, updatedAt: Date.now() };
    const result = row
      ? await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ? RETURNING key').bind(JSON.stringify(saved), key, row.value).first()
      : await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?) RETURNING key').bind(key, JSON.stringify(saved)).first();
    if (!result) return error('预设已在其他页面更新，请重新加载后继续', 409);
    return json({ preset: saved });
  }

  if (path === '/api/style-roll/blocklist') {
    const key = blocklistKey(currentUser.id);
    if (method === 'GET') {
      const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
      let tags: string[] = [];
      if (row) { try { const value: unknown = JSON.parse(row.value); validateRollBlocklist(value); tags = value; } catch { return error('屏蔽画师列表读取失败', 500); } }
      return json({ tags });
    }
    if (method !== 'PUT') return error('Method not allowed', 405);
    const raw = await request.text();
    if (raw.length > 200_000) return error('屏蔽画师列表过大', 413);
    let tags: string[];
    try { const value: unknown = JSON.parse(raw)?.tags; validateRollBlocklist(value); tags = value; }
    catch (cause) { return error(cause instanceof Error ? cause.message : '屏蔽画师列表无效', 400); }
    await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(tags)).run();
    return json({ tags });
  }

  const prefix = rollExperimentKeyPrefix(currentUser.id);
  // 记录删除与候选一致：二次确认后彻底移除，不再保留可恢复的回收站。
  if (experimentItem && method === 'DELETE') {
    const id = experimentItem[1], revisionText = new URL(request.url).searchParams.get('revision');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !revisionText || !/^\d+$/.test(revisionText) || !Number.isSafeInteger(Number(revisionText))) return error('Roll 记录版本无效', 400);
    const key = prefix + id;
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (!row) return error('Roll 记录不存在', 404);
    let previous: RollExperiment;
    try { const value: unknown = JSON.parse(row.value); validateRollExperiment(value); previous = value; }
    catch { return error('Roll 串资料读取失败，请保留资料并检查备份', 500); }
    if (previous.revision !== Number(revisionText)) return error('记录已在其他页面更新，请重新加载后继续', 409);
    const deleted = await db.prepare('DELETE FROM settings WHERE key = ? AND value = ? RETURNING key').bind(key, row.value).first();
    if (!deleted) return error('记录已在其他页面更新，请重新加载后继续', 409);
    return json({ deleted: id });
  }
  // 单条记录按需读取：列表只返回摘要，完整候选与轮次在选中记录时才搬运。
  if (experimentItem) {
    if (method !== 'GET') return error('Method not allowed', 405);
    const id = experimentItem[1];
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return error('Roll 记录 ID 无效', 400);
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(prefix + id).first<{ value: string }>();
    if (!row) return error('Roll 记录不存在', 404);
    try {
      const value: unknown = JSON.parse(row.value); validateRollExperiment(value);
      return json({ experiment: value });
    } catch { return error('Roll 串资料读取失败，请保留资料并检查备份', 500); }
  }
  if (method === 'GET' && new URL(request.url).searchParams.get('agentRead') === '1') {
    const query = new URL(request.url).searchParams;
    const experimentId = query.get('experimentId');
    const section = query.get('section') || 'candidates';
    const offset = Number(query.get('offset') || 0), limit = Number(query.get('limit') || 20);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 30 || !['candidates', 'rounds'].includes(section)) return error('Roll 读取分页无效', 400);
    if (experimentId && !/^[a-zA-Z0-9_-]{1,100}$/.test(experimentId)) return error('Roll 记录 ID 无效', 400);
    const page = <T,>(items: T[]) => ({ items: items.slice(offset, offset + limit), total: items.length, offset, limit, nextOffset: offset + limit < items.length ? offset + limit : null });
    try {
      if (!experimentId) {
        const rows = await db.prepare('SELECT value FROM settings WHERE key >= ? AND key < ?').bind(prefix, prefix + '\uffff').all<{ value: string }>();
        const experiments = rows.results.map(row => { const value: unknown = JSON.parse(row.value); validateRollExperiment(value); return value; });
        return json({ kind: 'experiments', ...page(experiments.sort((a, b) => b.updatedAt - a.updatedAt).map(item => ({ id: item.id, name: item.name, revision: item.revision, archived: item.archived === true, rounds: item.rounds.length, candidates: item.candidates.length, updatedAt: item.updatedAt }))) });
      }
      const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(prefix + experimentId).first<{ value: string }>();
      if (!row) return error('Roll 记录不存在', 404);
      const value: unknown = JSON.parse(row.value); validateRollExperiment(value);
      const experiment = value;
      const summary = { id: experiment.id, name: experiment.name, revision: experiment.revision, archived: experiment.archived === true, template: experiment.template, rules: experiment.rules, rounds: experiment.rounds.length, candidates: experiment.candidates.length };
      const itemId = query.get('itemId');
      const select = <T extends { id: string },>(items: T[]) => itemId ? { items: items.filter(item => item.id === itemId), total: items.some(item => item.id === itemId) ? 1 : 0, offset: 0, limit: 1, nextOffset: null } : page(items);
      if (section === 'rounds') return json({ kind: 'rounds', experiment: summary, ...select(experiment.rounds) });
      return json({ kind: 'candidates', experiment: summary, ...select(experiment.candidates.map(candidate => ({ ...candidate, expectedHistory: { sourceChainId: rollSourceId(experiment.id), moduleId: rollCandidateModuleId(candidate.id), prompt: rollPrompt(experiment.template, candidate.tags), seed: experiment.template.params.seed } }))) });
    } catch { return error('Roll 串资料读取失败，请保留资料并检查备份', 500); }
  }
  if (method === 'GET') {
    const rows = await db.prepare('SELECT value FROM settings WHERE key >= ? AND key < ?').bind(prefix, prefix + '\uffff').all<{ value: string }>();
    try {
      const experiments = rows.results.map(row => { const value: unknown = JSON.parse(row.value); validateRollExperiment(value); return rollExperimentSummary(value); });
      return json({ experiments: experiments.sort((a, b) => b.updatedAt - a.updatedAt) });
    } catch { return error('Roll 串资料读取失败，请保留资料并检查备份', 500); }
  }
  if (method !== 'PUT') return error('Method not allowed', 405);
  // 不再限制记录体积：候选与轮次数量上限已经约束了单条记录能装多少内容，体积不应成为 Roll 的门槛。
  const raw = await request.text();
  let experiment: RollExperiment;
  try { const value: unknown = JSON.parse(raw); validateRollExperiment(value); experiment = value; }
  catch (cause) { return error(cause instanceof Error ? cause.message : 'Roll 串资料无效', 400); }
  const key = prefix + experiment.id;
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  let previous: RollExperiment | undefined;
  if (row) {
    try { const value: unknown = JSON.parse(row.value); validateRollExperiment(value); previous = value; }
    catch { return error('Roll 串资料读取失败，请保留资料并检查备份', 500); }
  }
  if ((previous?.revision ?? 0) !== experiment.revision || (!previous && experiment.revision !== 0)) return error('实验已在其他页面更新，请重新加载后继续', 409);
  if (previous?.candidates.length) {
    for (const candidate of previous.candidates) {
      const next = experiment.candidates.find(item => item.id === candidate.id);
      // 删除候选是允许的：丢弃即彻底删除，删掉后容量立即回到记录上；但抽到的配方不能被悄悄改写。
      if (next && JSON.stringify(candidate.tags) !== JSON.stringify(next.tags)) return error('已有候选的画师配方不可改写，请删除后重新抽取', 400);
    }
  }
  for (const round of previous?.rounds ?? []) {
    const next = experiment.rounds.find(item => item.id === round.id);
    // 候选删光后空轮随之移除，所以轮次允许被删除；已记录的轮次内容与关闭时间仍不可改写。
    if (!next) continue;
    // 删除候选时轮次的 candidateIds 会跟着收缩，这不算改写；只允许减少，不允许新增或换人。
    const sameRound = JSON.stringify({ ...round, candidateIds: [], closedAt: undefined }) === JSON.stringify({ ...next, candidateIds: [], closedAt: undefined });
    const onlyRemoved = next.candidateIds.every(id => round.candidateIds.includes(id));
    if (!sameRound || !onlyRemoved || (round.closedAt !== undefined && next.closedAt !== round.closedAt)) return error('已有画风轮次不可改写', 400);
  }
  /**
   * 模板现在允许修改：旧候选的图片靠历史记录里的候选 ID 归位，不依赖模板指纹，
   * 所以这里不回写旧资料；新候选仍按抽取时的模板写入 configKey 作为来源信息。
   */
  const saved = { ...experiment, revision: experiment.revision + 1, updatedAt: Date.now() };
  const existing = new Set(previous?.archived ? [] : previous?.candidates.filter(candidate => !candidate.archived).map(candidate => candidate.id));
  const activated = saved.archived ? [] : saved.candidates.filter(candidate => !candidate.archived && !existing.has(candidate.id)).map(candidate => candidate.id);
  const value = JSON.stringify(saved);
  const checkBindings = activated.length ? [currentUser.id, rollSourceId(saved.id), value, JSON.stringify(activated)] : [];
  if (activated.length) await ensureHistoryRecycleSchema(db);
  // 与版本比较一起在 SQL 中验证，防止预览后迟到的写入重新启用已经移入回收站的原图。
  const guard = activated.length ? `NOT EXISTS (${newRollReferenceConflict})` : '1';
  const result = row
    ? await db.prepare(`UPDATE settings SET value = ? WHERE key = ? AND value = ? AND ${guard} RETURNING key`).bind(value, key, row.value, ...checkBindings).first()
    : await db.prepare(`INSERT OR IGNORE INTO settings (key, value) SELECT ?, ? WHERE ${guard} RETURNING key`).bind(key, value, ...checkBindings).first();
  if (!result) {
    if (activated.length && await db.prepare(newRollReferenceConflict).bind(...checkBindings).first()) return error('候选原图已在历史回收站，请先恢复原图', 409);
    return error('实验已在其他页面更新，请重新加载后继续', 409);
  }
  return json({ experiment: saved });
}
