/*
 * 一键 Roll · 六库抽取与随机流（纯逻辑核）
 * ---------------------------------------------------------------------------
 * 从「一键 Roll」补丁片段移植：池子（按 id 排序，与接口返回顺序无关）、
 * **每栏独立随机流**（seed + '#' + kind）、单栏重抽（可排除当前项）、按记录还原、证据。
 * 不碰 DOM / React / 请求 / 存储；抽中的条目只被读取，返回的是派生数据副本。
 *
 * 快照与四态约束见 services/contentRoll.ts。
 */

import { selectPromptLibraryDirectoryEntries, createDefaultPromptLibraryTree } from './promptLibraryTree.mjs';
import type { RollUnit, Json, ChainLike, RollRecordLike, RollDrawInput, RollRow, RollPicks, RollRng } from './contentRoll';
import { ALGO, LEGACY_ALGO, KINDS, META, REASON, clip, idOf, nameOf, textOf, negativeOf, bilingualOf, tagsOf, descriptionOf, previewOf, updatedAtOf, summaryOf, constraintsOf } from './contentRoll';

export const poolOf = (chains: ChainLike[] | null | undefined, kind: string) => {
  const list = Array.isArray(chains) ? chains : [];
  const out = [];
  for (const chain of list) {
    if (!chain || String(chain.type || '') !== String(kind)) continue;
    if (!idOf(chain)) continue;
    out.push(chain);
  }
  out.sort((a, b) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0));
  return out;
};
export const poolsOf = (chains: ChainLike[] | null | undefined) => {
  const out: Record<string, Json> = {};
  for (const kind of KINDS) out[kind] = poolOf(chains, kind);
  return out;
};
/* 候选池指纹：池变化（新增/删除/改名/改内容）时能一眼看出「同随机码也不该给同样结果」 */
export const shortHash = (text: string) => {
  let hash = 5381;
  const s = String(text == null ? '' : text);
  for (let i = 0; i < s.length; i++) hash = ((hash * 33) ^ s.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, '0');
};
export const poolFingerprint = (pool: ChainLike[]) => {
  const rows = (Array.isArray(pool) ? pool : []).map(c => [
    idOf(c), updatedAtOf(c) || 0, nameOf(c), shortHash(textOf(c)), shortHash(negativeOf(c))
  ].join(':'));
  return shortHash(rows.join('|'));
};

/* ---- 可复现的随机数：seed 字符串 → FNV-1a → mulberry32 ---- */
export const normalizeSeed = (seed: string | number | null | undefined) => {
  const text = String(seed == null ? '' : seed).trim();
  return text || 'r0';
};
export const hashSeed = (seed: string | number) => {
  const text = normalizeSeed(seed);
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};
export const rngOf = (seed: string | number) => {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
export const pickIndex = (rng: RollRng, size: number) => {
  const n = Number(size) || 0;
  if (n <= 0) return -1;
  const raw = Math.floor(rng() * n);
  return raw < 0 ? 0 : raw > n - 1 ? n - 1 : raw;
};

/* ---- 结果行（纯数据副本；不含条目对象本身，避免被顺手改到词库） ---- */
export const rowOf = (chain: ChainLike | null | undefined, kind: string, reason: string, locked: unknown, poolSize: number, unit?: RollUnit) => {
  const summary = chain ? summaryOf(chain) : { text: '', englishOnly: false };
  const constraints = chain ? constraintsOf(chain) : { facets: {}, absent: [], auto: [], values: [], unknown: [], notes: '', needsReview: false };
  return {
    kind,
    ...(unit ? { directoryId: unit.directoryId, directoryName: unit.name, directoryPath: unit.path.slice() } : {}),
    scope: unit?.scope || META[kind]?.scope || 'global',
    label: unit?.name || META[kind]?.short || kind,
    title: unit?.name || META[kind]?.title || kind,
    id: chain ? idOf(chain) : '',
    name: chain ? nameOf(chain) : '',
    text: chain ? textOf(chain) : '',
    negative: chain ? negativeOf(chain) : '',
    bilingual: chain ? bilingualOf(chain) : '',
    description: chain ? descriptionOf(chain) : '',
    previewImage: chain ? previewOf(chain) : '',
    updatedAt: chain ? updatedAtOf(chain) : null,
    tags: chain ? tagsOf(chain).slice(0, 8) : [],
    summary: summary.text,
    summaryEnglishOnly: !!summary.englishOnly,
    constraints,
    constraintNotes: constraints.notes,
    reason,
    reasonText: REASON[reason] || reason,
    locked: !!locked,
    poolSize: Number(poolSize) || 0,
    filled: !!(chain && (textOf(chain) || negativeOf(chain))),
    at: chain ? textOf(chain) : ''
  };
};

/* ---- 单栏抽取（所有路径共用；只在这里消耗随机数） ----
 * avoid = 要排除的条目 id（「再抽避开当前项」用它；候选不足时不排除，避免无限重试）
 * perKindSeed 是该栏自己的随机流种子（v2：每栏独立，互不影响）
 */
export const drawOne = (chains: ChainLike[] | null | undefined, kind: string, perKindSeed: string, avoid: Json) => {
  const pool = poolOf(chains, kind);
  if (!pool.length) return { row: rowOf(null, kind, 'empty', false, 0), note: 'pool_empty' };
  const skip = avoid ? pool.filter(c => idOf(c) !== String(avoid)) : [];
  const usable = skip.length ? skip : pool;
  const rng = rngOf(normalizeSeed(perKindSeed) + '#' + kind);
  const row = rowOf(usable[pickIndex(rng, usable.length)], kind, 'ok', false, pool.length);
  return { row, note: avoid && !skip.length ? 'avoid_short' : '' };
};

/** 动态目录只决定候选池；结果保存当时文字，锁定和旧草稿不随词库变化。 */
export const directoryPoolOf = (input: RollDrawInput, unit: RollUnit): ChainLike[] =>
  selectPromptLibraryDirectoryEntries((input.chains || []).filter((entry): entry is ChainLike & { id: string } => !!entry.id),
    input.directories || createDefaultPromptLibraryTree(), [unit.directoryId]).filter(entry => textOf(entry).trim()).sort((a, b) => idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0);

const directoryRow = (unit: RollUnit, chain: ChainLike | null, reason: string, locked: boolean, size: number): RollRow => ({
  ...rowOf(chain, unit.id, reason, locked, size, unit),
});
const drawDirectories = (input: RollDrawInput) => {
  const seed = normalizeSeed(input.seed), picks: RollPicks = { ...input.picks }, seeds: Record<string, string> = {}, notes: Json[] = [];
  const locked = input.locked || input.locks || {}, checks = input.checks || {};
  for (const unit of input.units || []) {
    const key = unit.id, previous = input.picks?.[key], pool = directoryPoolOf(input, unit);
    seeds[key] = seed;
    if (checks[key] === false) { if (!previous) picks[key] = directoryRow(unit, null, 'unchecked', false, pool.length); continue; }
    if (locked[key] && previous?.filled) { picks[key] = { ...previous, locked: true, reason: 'locked' }; continue; }
    if (locked[key]) {
      const held = pool.find(entry => idOf(entry) === locked[key]);
      if (held) { picks[key] = directoryRow(unit, held, 'locked', true, pool.length); continue; }
      notes.push({ kind: key, code: 'lock_missing', message: unit.name + '的固定来源已不可用，保留已有文字。' });
      picks[key] = previous || directoryRow(unit, null, 'empty', true, pool.length); continue;
    }
    if (!pool.length) {
      picks[key] = previous || directoryRow(unit, null, 'empty', false, 0);
      notes.push({ kind: key, code: 'pool_empty', message: unit.name + '当前没有候选，已有文字保持原样。' }); continue;
    }
    const avoid = input.avoid?.[key], alternatives = avoid ? pool.filter(entry => idOf(entry) !== avoid) : [];
    const candidates = alternatives.length ? alternatives : pool;
    picks[key] = directoryRow(unit, candidates[pickIndex(rngOf(seed + '#' + key), candidates.length)], 'ok', false, pool.length);
    if (avoid && !alternatives.length) notes.push({ kind: key, code: 'avoid_short', message: unit.name + '只有当前这一条候选。' });
  }
  return { algo: ALGO, seed, seeds, picks, notes, locked: { ...locked }, checks: { ...checks } };
};

/* ---- 主抽取：六库各抽 1 条 ----
 * input = { chains, checks, locked, seed, avoid }
 *   avoid = { [kind]: id } → 「再抽未固定项」时排除当前条目（候选不足则自动不排除，不做无限重试）
 * 每栏用独立随机流 → 固定/跳过某栏不影响其它栏（v2 算法）
 */
export const draw = (input: RollDrawInput) => {
  if (input?.units !== undefined) return drawDirectories(input);
  const opt = input && typeof input === 'object' ? input : {};
  const chains = Array.isArray(opt.chains) ? opt.chains : [];
  const checks = opt.checks && typeof opt.checks === 'object' ? opt.checks : {};
  const locked = opt.locked && typeof opt.locked === 'object' ? opt.locked : {};
  const avoid = opt.avoid && typeof opt.avoid === 'object' ? opt.avoid : {};
  const seed = normalizeSeed(opt.seed);
  const picks: Record<string, Json> = {};
  const seeds: Record<string, Json> = {};
  const notes: Json[] = [];
  for (const kind of KINDS) {
    const pool = poolOf(chains, kind);
    seeds[kind] = seed;
    if (checks[kind] === false) {
      picks[kind] = rowOf(null, kind, 'unchecked', false, pool.length);
      continue;
    }
    if (!pool.length) {
      picks[kind] = rowOf(null, kind, 'empty', false, 0);
      notes.push({ kind, code: 'pool_empty', message: META[kind].title + '库当前 0 条，该栏留空（不是错误）。' });
      continue;
    }
    const lockId = locked[kind] == null || locked[kind] === '' ? '' : String(locked[kind]);
    if (lockId) {
      const held = pool.find(chain => idOf(chain) === lockId);
      if (held) {
        picks[kind] = rowOf(held, kind, 'locked', true, pool.length);
        continue;
      }
      notes.push({ kind, code: 'lock_missing', message: META[kind].title + '的固定项已不在词库里，该栏改为重抽。' });
    }
    const avoidId = avoid[kind] == null ? '' : String(avoid[kind]);
    const out = drawOne(chains, kind, seed, avoidId);
    picks[kind] = out.row;
    if (out.note === 'avoid_short') {
      notes.push({ kind, code: 'avoid_short', message: META[kind].title + '只有当前这一条可换，已保留（不是失败）。' });
    }
  }
  return { algo: ALGO, seed, seeds, picks, notes, locked: Object.assign({}, locked), checks: Object.assign({}, checks) };
};

/* ---- 单栏重抽（「换一个」）----
 * 只动这一栏：排除当前条目（候选 >1 时），候选只有 1 条时**不换**并说明原因。
 * nextSeed 由调用方生成（核保持纯函数：不读时间、不读随机源）。
 */
export const rerollOne = (input: RollDrawInput, kind: string, nextSeed: string) => {
  if (input.units !== undefined) {
    const unit = input.units.find(item => item.id === kind);
    if (!unit) return { ok: false, code: 'unknown_kind', message: '目录已不存在，请重新选择范围' };
    if (input.checks?.[kind] === false) return { ok: false, code: 'unchecked', message: '本次未参与，先勾选再换' };
    if ((input.locked || input.locks)?.[kind]) return { ok: false, code: 'locked', message: '已固定，先解除固定再换' };
    const pool = directoryPoolOf(input, unit);
    if (!pool.length) return { ok: false, code: 'empty', message: '该目录当前没有候选，已有文字保持原样' };
    if (pool.length === 1 && idOf(pool[0]) === input.picks?.[kind]?.id) return { ok: false, code: 'single', message: '只有当前这一条候选' };
    const result = drawDirectories({ ...input, units: [unit], seed: nextSeed, avoid: { [kind]: input.picks?.[kind]?.id } });
    return { ok: true, seed: result.seed, row: result.picks[kind], note: result.notes[0]?.code || '', message: '已为' + unit.name + '换了一条' };
  }
  const opt = input && typeof input === 'object' ? input : {};
  const chains = Array.isArray(opt.chains) ? opt.chains : [];
  const checks = opt.checks && typeof opt.checks === 'object' ? opt.checks : {};
  const picks = opt.picks && typeof opt.picks === 'object' ? opt.picks : {};
  const locked = opt.locked && typeof opt.locked === 'object' ? opt.locked : {};
  const key = KINDS.indexOf(kind) >= 0 ? kind : '';
  if (!key) return { ok: false, code: 'unknown_kind', message: '未知分类' };
  if (checks[key] === false) return { ok: false, code: 'unchecked', message: META[key].title + '本次未参与，先勾选再换' };
  const lockId = locked[key] == null || locked[key] === '' ? '' : String(locked[key]);
  const current = picks[key] && picks[key].id ? String(picks[key].id) : '';
  if (lockId && lockId === current) return { ok: false, code: 'locked', message: META[key].title + '已固定，先解除固定再换' };
  const pool = poolOf(chains, key);
  if (!pool.length) return { ok: false, code: 'empty', message: META[key].title + '库当前 0 条，先去添加条目' };
  if (pool.length <= 1) return { ok: false, code: 'single', message: META[key].title + '只有 1 条候选，暂无其他可选' };
  const seed = normalizeSeed(nextSeed);
  const out = drawOne(chains, key, seed, current);
  return { ok: true, seed, row: out.row, note: out.note, message: '已为' + META[key].title + '换了一条' };
};

/* ---- 复现：按记录里的 seed + 条目 id 还原 ----
 * 条目还在 → 原样还原（reason = replay）；条目没了 → 用**该栏自己的**随机流重抽并回报 note。
 * 旧记录（无 algo / v1 顺序流）只走「按 id 还原」这条：不重放随机，避免算法差异被说成还原。
 */
export const replay = (input: RollDrawInput, record: RollRecordLike | null | undefined) => {
  if (input.units !== undefined) {
    const picks = { ...(record?.picks || {}) };
    const missing = input.units.filter(unit => !picks[unit.id]);
    const result = drawDirectories({ ...input, units: missing, picks, seed: record?.seed || input.seed });
    return { ...result, seeds: { ...record?.seeds, ...result.seeds }, restored: Object.keys(picks).length, redrawn: missing.length };
  }
  const opt = input && typeof input === 'object' ? input : {};
  const chains = Array.isArray(opt.chains) ? opt.chains : [];
  const checks = opt.checks && typeof opt.checks === 'object' ? opt.checks : {};
  const prev = (record && record.picks) || {};
  const seedsIn = (record && record.seeds && typeof record.seeds === 'object') ? record.seeds : {};
  const seed = normalizeSeed((record && record.seed) || opt.seed);
  const picks: Record<string, Json> = {};
  const seeds: Record<string, Json> = {};
  const notes: Json[] = [];
  let restored = 0;
  let redrawn = 0;
  for (const kind of KINDS) {
    const pool = poolOf(chains, kind);
    seeds[kind] = normalizeSeed(seedsIn[kind] || seed);
    if (checks[kind] === false) {
      picks[kind] = rowOf(null, kind, 'unchecked', false, pool.length);
      continue;
    }
    if (!pool.length) {
      picks[kind] = rowOf(null, kind, 'empty', false, 0);
      notes.push({ kind, code: 'pool_empty', message: META[kind].title + '库当前 0 条，该栏留空（不是错误）。' });
      continue;
    }
    const before = prev[kind] || null;
    const hit = before && before.id ? pool.find(chain => idOf(chain) === String(before.id)) : null;
    if (hit) {
      picks[kind] = rowOf(hit, kind, 'replay', !!before.locked, pool.length);
      restored++;
      continue;
    }
    if (before && before.id) {
      notes.push({ kind, code: 'entry_missing', message: META[kind].title + '上次用的条目已不在词库里，该栏按同一个随机码重抽。' });
    }
    picks[kind] = drawOne(chains, kind, seeds[kind], '').row;
    redrawn++;
  }
  return { algo: (record && record.algo) || LEGACY_ALGO, seed, seeds, picks, notes, restored, redrawn, locked: Object.assign({}, (record && record.locked) || {}), checks: Object.assign({}, checks) };
};

/* ---- 给 UI / 存为搭配 / 填入实验室 用的派生视图（全部只读派生） ---- */
/* 六栏 → 实验室落点：全局两栏进 params._promptSections，角色四栏进角色 sections */
export const toSections = (picks: RollPicks) => {
  const global: Record<string, Json> = {};
  const character: Record<string, Json> = {};
  const written = [];
  const rows = [];
  for (const kind of Object.keys(picks || {})) {
    const row = picks && picks[kind];
    if (!row || !row.filled) continue;
    if ((row.scope || META[kind]?.scope) === 'global') global[kind] = row.text;
    else character[kind] = row.text;
    written.push(kind);
    rows.push(row);
  }
  return { global, character, written, rows };
};
/* 可读的一行摘要（给 toast / 证据用） */
export const describe = (record: RollRecordLike | null | undefined) => (Object.keys(record?.picks || {}).some(key => key.startsWith('directory:')) ? Object.keys(record?.picks || {}) : KINDS).map((kind: string) => {
  const row = record && record.picks && record.picks[kind];
  if (!row) return (META[kind]?.short || record?.picks?.[kind]?.directoryName || kind) + '：—';
  return (META[kind]?.short || row.directoryName || kind) + '：' + (row.filled ? row.name + '「' + clip(row.summary || row.text, 40) + '」' : '（' + row.reasonText + '）');
}).join(' ｜ ');
/* 是否「和上一次同一组」（逐栏 id 全等） */
export const samePicks = (a: RollPicks, b: RollPicks) =>
  [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].every((kind: string) => {
    const left = a[kind] as RollRow | undefined;
    const right = b[kind] as RollRow | undefined;
    return String(left?.id || '') === String(right?.id || '') && (!kind.startsWith('directory:') || left?.text === right?.text && left?.negative === right?.negative);
  });
/* 技术证据：算法版本 + 随机码 + 每栏随机流 + 参与 + 固定 + 每栏条目 id/池指纹（需求 §7 的「证据」） */
export const evidenceOf = (record: RollRecordLike | null | undefined) => {
  const chains = Array.isArray(record?.chains) ? (record?.chains as ChainLike[]) : null;
  return {
    algo: String((record && record.algo) || ALGO),
    seed: String((record && record.seed) || ''),
    seeds: Object.assign({}, (record && record.seeds) || {}),
    at: Number((record && record.at) || 0) || null,
    checks: Object.assign({}, (record && record.checks) || {}),
    locked: Object.assign({}, (record && (record.locked || record.locks)) || {}),
    pools: (Object.keys(record?.picks || {}).some(key => key.startsWith('directory:')) ? Object.keys(record?.picks || {}) : KINDS).reduce((acc: Record<string, Json>, kind: string) => {
      const unit = record?.units?.find((item: RollUnit) => item.id === kind);
      const pool = chains ? unit ? directoryPoolOf({ chains, directories: record?.directories }, unit) : kind.startsWith('directory:') ? null : poolOf(chains, kind) : null;
      const fallback = record?.picks?.[kind]?.['poolSize'];
      acc[kind] = { size: pool ? pool.length : Number(fallback) || 0, fingerprint: pool ? poolFingerprint(pool) : '' };
      return acc;
    }, {} as Record<string, Json>),
    picks: (Object.keys(record?.picks || {}).some(key => key.startsWith('directory:')) ? Object.keys(record?.picks || {}) : KINDS).reduce((acc: Record<string, Json>, kind: string) => {
      const row = record && record.picks && record.picks[kind];
      acc[kind] = row ? {
        id: row.id, name: row.name, reason: row.reason, locked: !!row.locked,
        textHash: (() => { let h = 5381; const t = String(row.text || ''); for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); })()
      } : null;
      return acc;
    }, {} as Record<string, Json>)
  };
};
/* 保存搭配用的「条目快照」（R13：条目以后改名/改内容/被删，快照仍在） */
export const snapshotOf = (row: RollRow) => ({
  kind: row.kind, entryId: row.id, name: row.name, text: row.text, negative: row.negative,
  ...(row.directoryId ? { directoryId: row.directoryId, directoryName: row.directoryName, directoryPath: [...(row.directoryPath || [])], scope: row.scope } : {}),
  bilingual: row.bilingual, description: row.description, updatedAt: row.updatedAt,
  tags: (row.tags || []).slice(), summary: row.summary,
  constraints: row.constraints ? {
    facets: Object.assign({}, row.constraints.facets),
    absent: (row.constraints.absent || []).map(x => ({ key: x.key, label: x.label, known: !!x.known })),
    auto: (row.constraints.auto || []).map(x => ({ key: x.key, label: x.label, known: !!x.known })),
    unknown: (row.constraints.unknown || []).slice()
  } : null,
  constraintNotes: row.constraintNotes || ''
});
