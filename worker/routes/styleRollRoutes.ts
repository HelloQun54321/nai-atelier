import { rollPrompt, rollSourceId, rollCandidateModuleId, validateRollBlocklist, validateRollExperiment, validateRollPreset, type RollExperiment, type RollPreset } from '../../services/styleRoll';
import { error, json, type RouteContext } from './types';

const blocklistKey = (userId: string) => `style_roll_blocklist_v1:${userId}`;

/** 复用私人 settings，无表结构变更；版本比较避免两端静默覆盖同一次实验。 */
export async function handleStyleRollRoute({ path, method, request, db, currentUser }: RouteContext): Promise<Response | null> {
  const presetCollection = path === '/api/style-roll/presets';
  const presetItem = path.match(/^\/api\/style-roll\/presets\/([^/]+)$/);
  if (path !== '/api/style-roll' && path !== '/api/style-roll/blocklist' && !presetCollection && !presetItem) return null;
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

  const prefix = `style_roll_v1:${currentUser.id}:`;
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
      const experiments = rows.results.map(row => { const value: unknown = JSON.parse(row.value); validateRollExperiment(value); return value; });
      return json({ experiments: experiments.sort((a, b) => b.updatedAt - a.updatedAt) });
    } catch { return error('Roll 串资料读取失败，请保留资料并检查备份', 500); }
  }
  if (method !== 'PUT') return error('Method not allowed', 405);
  const raw = await request.text();
  if (raw.length > 1_000_000) return error('Roll 串实验过大，请新建实验', 413);
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
    if (JSON.stringify(previous.template) !== JSON.stringify(experiment.template)) return error('已有候选的实验配置不可修改，请新建实验', 400);
    for (const candidate of previous.candidates) {
      const next = experiment.candidates.find(item => item.id === candidate.id);
      if (!next || JSON.stringify(candidate.tags) !== JSON.stringify(next.tags)) return error('已有候选不可覆盖或删除，请丢弃后重新抽取', 400);
    }
  }
  for (const round of previous?.rounds ?? []) {
    const next = experiment.rounds.find(item => item.id === round.id);
    if (!next || (round.closedAt !== undefined && next.closedAt !== round.closedAt) || JSON.stringify({ ...round, closedAt: undefined }) !== JSON.stringify({ ...next, closedAt: undefined })) return error('已有画风轮次不可覆盖或删除', 400);
  }
  const saved = { ...experiment, revision: experiment.revision + 1, updatedAt: Date.now() };
  // Android 的 D1 适配器没有 meta.changes，RETURNING 在两端直接确认本次写入。
  const result = row
    ? await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ? RETURNING key').bind(JSON.stringify(saved), key, row.value).first()
    : await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?) RETURNING key').bind(key, JSON.stringify(saved)).first();
  if (!result) return error('实验已在其他页面更新，请重新加载后继续', 409);
  return json({ experiment: saved });
}
