// 提示词库条目 ↔ 生成历史的关联：命中识别、分批懒回填、按条目反查图片。
// 只新增 prompt_library_links 表，历史行与 chains 条目不改结构；
// 关联写入失败不影响历史保存（保存路径自行兜底，见 historyRoutes）。
import { ensureLocalHistorySchema, mapLocalHistoryRow } from './historyRoutes';
import { clampInt, error, json, parseStoredJson, type D1Database, type RouteContext } from './types';

/** 六个提示词库分类，与 chains.type 的取值一致。 */
const PROMPT_LIBRARY_KINDS = ['appearance', 'wardrobe', 'pose', 'expression', 'scene', 'camera'] as const;

/** 短于此长度的正文（如 "1girl"）几乎在任何 Prompt 里都出现，不参与归属识别。 */
const MIN_PROMPT_LIBRARY_LENGTH = 8;

/** 懒回填每次请求最多处理的历史行数：几千条历史一次跑完会阻塞请求数秒。 */
const BACKFILL_BATCH_ROWS = 200;

const backfillProgressKey = (userId: string) => `prompt_library_links_backfill_v1:${userId}`;

export interface PromptLibraryEntry {
  id: string;
  kind: string;
  name: string;
  /** 规范化后的正文，只用于匹配与长度比较 */
  text: string;
  createdAt: number;
}

export interface PromptLibraryLinkSource {
  id: string;
  kind: string;
  name: string;
  matched: number;
}

export interface PromptLibraryLinkMeta {
  version: 1;
  primaryId: string;
  linkedAt: number;
  sources: PromptLibraryLinkSource[];
}

export interface PromptLibraryLinkHint {
  /** 命中的库条目，长条目优先 */
  matches: PromptLibraryEntry[];
  /** 写回 params._promptLibrary 的元数据 */
  meta: PromptLibraryLinkMeta;
  /** 允许改写主来源时的主条目；来源受保护（风格串/角色/样张/Roll 等）时为 null */
  primary: PromptLibraryEntry | null;
}

export interface PromptLibraryLinkBackfillProgress {
  cursor: number;
  scanned: number;
  linked: number;
  done: boolean;
}

// 进程内标记：DDL 幂等但昂贵，同一实例只在首个请求跑一次。
// 语句全部是 IF NOT EXISTS，重复执行也只忽略已有表/索引，其它错误照常抛出。
let promptLibraryLinkSchemaEnsured = false;
export async function ensurePromptLibraryLinkSchema(db: D1Database) {
  if (promptLibraryLinkSchemaEnsured) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS prompt_library_links (
    history_id TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    chain_name TEXT,
    matched_length INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (history_id, chain_id)
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_prompt_library_links_chain
    ON prompt_library_links(chain_id, created_at DESC)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_prompt_library_links_history
    ON prompt_library_links(history_id)`).run();
  promptLibraryLinkSchemaEnsured = true;
}

/** 匹配用的规范化：折叠空白、去首尾、转小写；显式 0 之类的非字符串按空处理。 */
export function normalizePromptLibraryText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 历史行参与匹配的正文：整段 Prompt + 结构化基础/主体提示词 + 每个角色的正文与分栏。
 * 带结构化角色的图（V4.5/V5）里，人物/服饰/姿势/表情只存在于 `params.characters[*]`，
 * 只看整段 Prompt 会漏掉它们（例如苗族服饰），图墙里就会缺少这些条目。
 */
export function promptLibraryHistoryText(row: {
  prompt?: unknown;
  base_prompt?: unknown;
  subject_prompt?: unknown;
  /** 历史行里是 JSON 字符串；保存路径传入的是已解析的 params 对象。 */
  params?: unknown;
}) {
  const parts: unknown[] = [row.prompt, row.base_prompt, row.subject_prompt];
  const parsed = typeof row.params === 'string' ? parseStoredJson(row.params, null) : row.params;
  const characters = parsed && typeof parsed === 'object' && Array.isArray((parsed as { characters?: unknown }).characters)
    ? (parsed as { characters: unknown[] }).characters
    : [];
  for (const character of characters) {
    if (!character || typeof character !== 'object') continue;
    const record = character as { prompt?: unknown; sections?: unknown };
    parts.push(record.prompt);
    if (record.sections && typeof record.sections === 'object') parts.push(...Object.values(record.sections as Record<string, unknown>));
  }
  return parts
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .join(' ');
}

/**
 * 库条目自动封面：没有任何封面时，用「最早关联到的那张生成图」补上。
 * 手动换过的封面（`preview_image` 非空）一律不动；这里直接引用历史图 URL，不再复制一份资产。
 */
export async function syncPromptLibraryCover(db: D1Database, chainIds: unknown[]) {
  const ids = [...new Set((chainIds || []).map(value => String(value ?? '')).filter(Boolean))];
  let updated = 0;
  for (const chainId of ids) {
    try {
      const chain = await db.prepare('SELECT preview_image FROM chains WHERE id = ?').bind(chainId).first<{ preview_image: string | null }>();
      if (!chain) continue;
      if (String(chain.preview_image || '').trim()) continue;
      const first = await db.prepare(`SELECT h.id AS id FROM prompt_library_links l
        JOIN local_generation_history h ON h.id = l.history_id
        WHERE l.chain_id = ? ORDER BY h.created_at ASC, h.id ASC LIMIT 1`).bind(chainId).first<{ id: string }>();
      if (!first?.id) continue;
      await db.prepare(`UPDATE chains SET preview_image = ?
        WHERE id = ? AND COALESCE(TRIM(preview_image), '') = ''`).bind(`/api/local-history/${first.id}/image`, chainId).run();
      updated += 1;
    } catch (cause) {
      console.error('提示词库自动封面写入失败', cause);
    }
  }
  return updated;
}

/** 回填/重算后收尾：给所有「有生成图但没封面」的库条目补上自动封面。 */
export async function syncPromptLibraryCovers(db: D1Database) {
  const rows = await db.prepare(`SELECT c.id AS id FROM chains c
    WHERE COALESCE(TRIM(c.preview_image), '') = ''
      AND EXISTS (SELECT 1 FROM prompt_library_links l WHERE l.chain_id = c.id)`).all<{ id: string }>();
  return syncPromptLibraryCover(db, (rows.results || []).map(row => row.id));
}

/** 载入库条目：按正文长度降序、创建时间降序，长条目先命中，避免短条目抢归属。 */
export async function loadPromptLibraryEntries(db: D1Database): Promise<PromptLibraryEntry[]> {
  const placeholders = PROMPT_LIBRARY_KINDS.map(() => '?').join(', ');
  const result = await db.prepare(`SELECT id, type, name, base_prompt, created_at FROM chains WHERE type IN (${placeholders})`)
    .bind(...PROMPT_LIBRARY_KINDS).all<any>();
  return (result.results || [])
    .map(row => ({
      id: String(row.id || ''),
      kind: String(row.type || ''),
      name: String(row.name || ''),
      text: normalizePromptLibraryText(row.base_prompt),
      createdAt: Number(row.created_at) || 0,
    }))
    .filter(entry => entry.id !== '' && entry.text.length >= MIN_PROMPT_LIBRARY_LENGTH)
    .sort((left, right) => right.text.length - left.text.length || right.createdAt - left.createdAt);
}

/** 命中判定：规范化后的整段包含关系（不按逗号切分，保留多标签长条目的语义）。 */
export function matchPromptLibraryEntries(promptText: unknown, entries: PromptLibraryEntry[]) {
  const haystack = normalizePromptLibraryText(promptText);
  if (!haystack) return [];
  return entries.filter(entry => haystack.includes(entry.text));
}

/**
 * 主来源可覆盖：只有「空来源」与「自由实验室」这两种还没归属的情况才允许被库条目接管。
 * 一旦已经记了具体来源 id（风格串 / 角色 / 库条目 / Roll / 画师样张 / 外部导入），一律保留——
 * 即使类型为空也不改写：那种行是从某条串或某个样张来的，改成库条目会让原串的历史查不到自己的图。
 */
export function promptLibrarySourceOverridable(currentType: unknown, currentId: unknown = '') {
  const id = String(currentId || '').trim();
  if (id && id !== 'playground') return false;
  const type = String(currentType || '').trim();
  if (/^(artist-sample|roll):/i.test(type)) return false;
  if (!type || type === 'playground') return true;
  return (PROMPT_LIBRARY_KINDS as readonly string[]).includes(type);
}

/**
 * 识别本次生成用到了哪些库条目。
 * 未命中返回 null；命中但来源受保护时 primary 为 null（只记录关联，不改主来源）。
 */
export async function promptLibraryLinkHint(
  db: D1Database,
  prompt: string,
  options: { sourceChainType?: unknown; sourceChainId?: unknown } = {},
): Promise<PromptLibraryLinkHint | null> {
  const entries = await loadPromptLibraryEntries(db);
  if (!entries.length) return null;
  const matches = matchPromptLibraryEntries(prompt, entries);
  if (!matches.length) return null;
  return {
    matches,
    meta: {
      version: 1,
      primaryId: matches[0].id,
      linkedAt: Date.now(),
      sources: matches.map(entry => ({ id: entry.id, kind: entry.kind, name: entry.name, matched: entry.text.length })),
    },
    primary: promptLibrarySourceOverridable(options.sourceChainType, options.sourceChainId) ? matches[0] : null,
  };
}

/** 写入单条归属（不动同一张图的其它条目归属）。 */
async function upsertPromptLibraryLink(db: D1Database, historyId: string, entry: PromptLibraryEntry, createdAt: number) {
  const at = Number.isFinite(Number(createdAt)) && Number(createdAt) > 0 ? Number(createdAt) : Date.now();
  await db.prepare(`INSERT INTO prompt_library_links (history_id, chain_id, kind, chain_name, matched_length, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(history_id, chain_id) DO UPDATE SET
      kind = excluded.kind, chain_name = excluded.chain_name,
      matched_length = excluded.matched_length, created_at = excluded.created_at`)
    .bind(historyId, entry.id, entry.kind, entry.name, entry.text.length, at).run();
}

/**
 * 落关联表（每个命中条目一行），并清掉本次不再命中的旧行，
 * 这样同一条历史被重存（INSERT OR REPLACE）时不会留下过期归属。
 */
export async function writePromptLibraryLinks(
  db: D1Database,
  hint: { matches: PromptLibraryEntry[] },
  historyId: string,
  createdAt: number,
): Promise<number> {
  await ensurePromptLibraryLinkSchema(db);
  const ids = hint.matches.map(entry => entry.id);
  for (const entry of hint.matches) await upsertPromptLibraryLink(db, historyId, entry, createdAt);
  if (ids.length) {
    await db.prepare(`DELETE FROM prompt_library_links
      WHERE history_id = ? AND chain_id NOT IN (${ids.map(() => '?').join(', ')})`)
      .bind(historyId, ...ids).run();
  } else {
    await db.prepare('DELETE FROM prompt_library_links WHERE history_id = ?').bind(historyId).run();
  }
  return ids.length;
}

export async function deletePromptLibraryLinksByHistory(db: D1Database, historyId: string) {
  await ensurePromptLibraryLinkSchema(db);
  await db.prepare('DELETE FROM prompt_library_links WHERE history_id = ?').bind(historyId).run();
}

export async function deletePromptLibraryLinksByChain(db: D1Database, chainId: string) {
  await ensurePromptLibraryLinkSchema(db);
  await db.prepare('DELETE FROM prompt_library_links WHERE chain_id = ?').bind(chainId).run();
}

/**
 * 条目正文或名称变更后重算归属：只处理原先挂着该条目的图片，
 * 命中则重建关联，不再命中则清掉以它为主来源的来源字段。
 * 其它历史行若因正文加长而新命中，由 /rebuild 全量回填补齐。
 */
export async function recomputePromptLibraryLinksForChain(db: D1Database, chainId: string) {
  await ensurePromptLibraryLinkSchema(db);
  const chain = await db.prepare('SELECT id, type, name, base_prompt FROM chains WHERE id = ?').bind(chainId).first<any>();
  // 只有六类库条目参与归属；风格串/角色等正文不是库条目，
  // 扫它们挂着的上千条历史只会造出 kind 为 style 的假归属，这里只清理既有行。
  if (!chain || !(PROMPT_LIBRARY_KINDS as readonly string[]).includes(String(chain.type || ''))) {
    await deletePromptLibraryLinksByChain(db, chainId);
    return { scanned: 0, linked: 0, cleared: 0 };
  }
  const linked = await db.prepare('SELECT history_id FROM prompt_library_links WHERE chain_id = ?').bind(chainId).all<{ history_id: string }>();
  const sourced = await db.prepare('SELECT id FROM local_generation_history WHERE source_chain_id = ?').bind(chainId).all<{ id: string }>();
  const historyIds = [...new Set([
    ...(linked.results || []).map(row => String(row.history_id)),
    ...(sourced.results || []).map(row => String(row.id)),
  ])];
  await deletePromptLibraryLinksByChain(db, chainId);
  const text = normalizePromptLibraryText(chain.base_prompt);
  const usable = text.length >= MIN_PROMPT_LIBRARY_LENGTH;
  let linkedCount = 0;
  let cleared = 0;
  for (const historyId of historyIds) {
    const row = await db.prepare('SELECT id, prompt, base_prompt, subject_prompt, params, source_chain_id, created_at FROM local_generation_history WHERE id = ?')
      .bind(historyId).first<any>();
    if (!row) continue;
    if (usable && normalizePromptLibraryText(promptLibraryHistoryText(row)).includes(text)) {
      await upsertPromptLibraryLink(db, historyId, mapEntry(chain, text), Number(row.created_at) || 0);
      linkedCount += 1;
    } else if (String(row.source_chain_id || '') === chainId) {
      await db.prepare(`UPDATE local_generation_history
        SET source_chain_id = NULL, source_chain_name = NULL, source_chain_type = NULL
        WHERE id = ? AND source_chain_id = ?`).bind(historyId, chainId).run();
      cleared += 1;
    }
  }
  return { scanned: historyIds.length, linked: linkedCount, cleared };
}

function mapEntry(chain: any, text: string): PromptLibraryEntry {
  return {
    id: String(chain.id || ''),
    kind: String(chain.type || ''),
    name: String(chain.name || ''),
    text,
    createdAt: Number(chain.created_at) || 0,
  };
}

function normalizeBackfillProgress(value: unknown): PromptLibraryLinkBackfillProgress {
  const source = value && typeof value === 'object' ? value as any : {};
  const pick = (key: string) => (Number.isFinite(Number(source[key])) ? Math.max(0, Math.trunc(Number(source[key]))) : 0);
  return { cursor: pick('cursor'), scanned: pick('scanned'), linked: pick('linked'), done: source.done === true };
}

async function saveBackfillProgress(db: D1Database, key: string, progress: PromptLibraryLinkBackfillProgress) {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(progress)).run();
  return progress;
}

/**
 * 分批懒回填：一次只扫 BACKFILL_BATCH_ROWS 行，进度落 settings，下次请求接着跑。
 * restart 只在新一轮开始（上次已完成）时重置进度：正在进行的回填继续推进，
 * 否则反复调用 /rebuild 会一直停在第一页。
 */
export async function runPromptLibraryLinkBackfill(
  db: D1Database,
  userId: string,
  restart = false,
): Promise<PromptLibraryLinkBackfillProgress> {
  await ensurePromptLibraryLinkSchema(db);
  const key = backfillProgressKey(userId);
  const stored = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  let progress = normalizeBackfillProgress(parseStoredJson(stored?.value, null));
  if (restart && progress.done) progress = { cursor: 0, scanned: 0, linked: 0, done: false };
  if (progress.done) return progress;

  const total = Number((await db.prepare('SELECT COUNT(*) AS count FROM local_generation_history WHERE user_id = ?')
    .bind(userId).first<{ count: number }>())?.count || 0);
  if (progress.cursor >= total) return saveBackfillProgress(db, key, { ...progress, done: true });

  const rows = await db.prepare(`SELECT id, prompt, base_prompt, subject_prompt, params, created_at
    FROM local_generation_history WHERE user_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(userId, BACKFILL_BATCH_ROWS, progress.cursor).all<any>();
  const scanned = rows.results || [];
  const entries = await loadPromptLibraryEntries(db);
  let linkedCount = 0;
  for (const row of scanned) {
    const matches = matchPromptLibraryEntries(promptLibraryHistoryText(row), entries);
    if (!matches.length) continue;
    linkedCount += await writePromptLibraryLinks(db, { matches }, String(row.id), Number(row.created_at) || 0);
  }
  const next: PromptLibraryLinkBackfillProgress = {
    cursor: progress.cursor + scanned.length,
    scanned: progress.scanned + scanned.length,
    linked: progress.linked + linkedCount,
    done: scanned.length < BACKFILL_BATCH_ROWS || progress.cursor + scanned.length >= total,
  };
  // 补算完这一批：给「刚有图但仍没封面」的库条目补上自动封面。
  if (linkedCount > 0) {
    try { await syncPromptLibraryCovers(db); } catch (cause) { console.error('提示词库自动封面回填失败', cause); }
  }
  return saveBackfillProgress(db, key, next);
}

// /api/prompt-library-links/* 反查接口；未匹配的路径返回 null 交给后续路由。
export async function handlePromptLibraryLinkRoute(ctx: RouteContext): Promise<Response | null> {
  const { path, method, url, db, currentUser } = ctx;
  const known = path === '/api/prompt-library-links/summary'
    || path === '/api/prompt-library-links/images'
    || path === '/api/prompt-library-links/rebuild';
  if (!known) return null;

  await ensureLocalHistorySchema(db);
  await ensurePromptLibraryLinkSchema(db);

  if (path === '/api/prompt-library-links/summary' && method === 'GET') {
    // 顺手推进一批回填，几千条历史也能在几次打开面板后补齐。
    await runPromptLibraryLinkBackfill(db, currentUser.id);
    const placeholders = PROMPT_LIBRARY_KINDS.map(() => '?').join(', ');
    const [grouped, linkedImages, entries] = await Promise.all([
      db.prepare(`SELECT links.chain_id AS chainId, links.kind AS kind, MAX(links.chain_name) AS name,
        COUNT(*) AS count, MAX(links.created_at) AS lastAt
        FROM prompt_library_links links
        JOIN local_generation_history history ON history.id = links.history_id
        WHERE history.user_id = ?
        GROUP BY links.chain_id, links.kind
        ORDER BY count DESC, lastAt DESC`).bind(currentUser.id).all<any>(),
      db.prepare(`SELECT COUNT(DISTINCT links.history_id) AS count
        FROM prompt_library_links links
        JOIN local_generation_history history ON history.id = links.history_id
        WHERE history.user_id = ?`).bind(currentUser.id).first<{ count: number }>(),
      db.prepare(`SELECT COUNT(*) AS count FROM chains WHERE type IN (${placeholders})`)
        .bind(...PROMPT_LIBRARY_KINDS).first<{ count: number }>(),
    ]);
    return json({
      items: (grouped.results || []).map(row => ({
        chainId: String(row.chainId),
        kind: String(row.kind || ''),
        name: String(row.name || ''),
        count: Number(row.count) || 0,
        lastAt: Number(row.lastAt) || 0,
      })),
      linkedImages: Number(linkedImages?.count || 0),
      entries: Number(entries?.count || 0),
    });
  }

  if (path === '/api/prompt-library-links/images' && method === 'GET') {
    const chainId = (url.searchParams.get('chainId') || '').trim();
    if (!chainId || chainId.length > 200) return error('提示词库条目无效', 400);
    // 默认一屏 60 张，上限 200，避免一次拉整库原图索引。
    const limit = clampInt(url.searchParams.get('limit'), 60, 1, 200);
    const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1_000_000);
    await runPromptLibraryLinkBackfill(db, currentUser.id);
    const [rows, count] = await Promise.all([
      db.prepare(`SELECT history.*, links.kind AS link_kind, links.chain_name AS link_chain_name
        FROM prompt_library_links links
        JOIN local_generation_history history ON history.id = links.history_id
        WHERE history.user_id = ? AND links.chain_id = ?
        ORDER BY history.created_at DESC, history.id DESC
        LIMIT ? OFFSET ?`).bind(currentUser.id, chainId, limit, offset).all<any>(),
      db.prepare(`SELECT COUNT(*) AS count
        FROM prompt_library_links links
        JOIN local_generation_history history ON history.id = links.history_id
        WHERE history.user_id = ? AND links.chain_id = ?`).bind(currentUser.id, chainId).first<{ count: number }>(),
    ]);
    return json({
      items: (rows.results || []).map(row => ({
        ...mapLocalHistoryRow(row),
        linkKind: String(row.link_kind || ''),
        linkChainName: String(row.link_chain_name || ''),
      })),
      count: Number(count?.count || 0),
      limit,
      offset,
    });
  }

  if (path === '/api/prompt-library-links/rebuild' && method === 'POST') {
    if (currentUser.role === 'guest') return error('访客无法重建提示词库关联', 403);
    const progress = await runPromptLibraryLinkBackfill(db, currentUser.id, true);
    return json({ success: true, scanned: progress.scanned, linked: progress.linked, done: progress.done });
  }

  return error('Method not allowed', 405);
}
