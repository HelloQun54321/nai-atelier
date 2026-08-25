// Local generation history (D1 + R2), inspiration boards/library, and the
// lightweight agent overview endpoints.
// Moved verbatim from worker/index.ts during the domain split; behavior unchanged.
import { json, error, clampInt, parseStoredJson, MAX_MANAGED_IMAGE_BYTES, type D1Database, type D1Result, type Env, type RouteContext } from './types';
import { parseImageData, parseUploadedImage, exactArrayBuffer } from './vibeRoutes';
import { deleteR2File, processImageUpload } from './settingsRoutes';

// 进程内标记：DDL 幂等但昂贵（1 CREATE TABLE + 16 ALTER + 3 INDEX），
// 同一实例只在首个请求跑一次，不再每个灵感请求都重复约 20 条语句。
let inspirationSchemaEnsured = false;
async function ensureInspirationSchema(db: D1Database) {
  if (inspirationSchemaEnsured) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS inspiration_boards (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1', sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`).run();
  for (const statement of [
    "ALTER TABLE inspirations ADD COLUMN board_id TEXT",
    "ALTER TABLE inspirations ADD COLUMN notes TEXT DEFAULT ''",
    "ALTER TABLE inspirations ADD COLUMN tags TEXT DEFAULT '[]'",
    "ALTER TABLE inspirations ADD COLUMN source_type TEXT",
    "ALTER TABLE inspirations ADD COLUMN source_id TEXT",
    "ALTER TABLE inspirations ADD COLUMN source_url TEXT",
    "ALTER TABLE inspirations ADD COLUMN rating INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inspirations ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inspirations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inspirations ADD COLUMN last_used_at INTEGER",
    "ALTER TABLE inspirations ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inspirations ADD COLUMN parent_id TEXT",
    "ALTER TABLE inspirations ADD COLUMN analysis TEXT DEFAULT '{}'",
    "ALTER TABLE inspirations ADD COLUMN image_key TEXT",
    "ALTER TABLE inspirations ADD COLUMN image_type TEXT",
    "ALTER TABLE inspirations ADD COLUMN updated_at INTEGER",
  ]) {
    try { await db.prepare(statement).run(); } catch { /* Column already exists. */ }
  }
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_inspirations_board ON inspirations(user_id, board_id, archived, is_pinned, created_at DESC)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_inspirations_source ON inspirations(user_id, source_type, source_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_inspiration_boards_sort ON inspiration_boards(user_id, sort_order, created_at)').run();
  inspirationSchemaEnsured = true;
}

/** 构建灵感字段更新的 SET 子句与绑定值；无任何可更新字段时返回 null。 */
function buildInspirationSetStatements(updates: any): { assignments: string[]; values: any[] } | null {
  const assignments: string[] = [];
  const values: any[] = [];
  const stringFields: Record<string, string> = {
    title: 'title', prompt: 'prompt', negativePrompt: 'negative_prompt', boardId: 'board_id', notes: 'notes',
    sourceType: 'source_type', sourceId: 'source_id', sourceUrl: 'source_url', parentId: 'parent_id',
  };
  for (const [key, column] of Object.entries(stringFields)) {
    if (updates[key] !== undefined) { assignments.push(`${column} = ?`); values.push(updates[key] || null); }
  }
  if (updates.tags !== undefined) { assignments.push('tags = ?'); values.push(JSON.stringify(Array.isArray(updates.tags) ? updates.tags.slice(0, 80) : [])); }
  if (updates.params !== undefined) { assignments.push('params = ?'); values.push(updates.params ? JSON.stringify(updates.params) : null); }
  if (updates.analysis !== undefined) { assignments.push('analysis = ?'); values.push(JSON.stringify(updates.analysis || {})); }
  if (updates.rating !== undefined) { assignments.push('rating = ?'); values.push(Math.max(0, Math.min(5, Math.floor(Number(updates.rating) || 0)))); }
  if (updates.isPinned !== undefined) { assignments.push('is_pinned = ?'); values.push(updates.isPinned ? 1 : 0); }
  if (updates.archived !== undefined) { assignments.push('archived = ?'); values.push(updates.archived ? 1 : 0); }
  if (!assignments.length) return null;
  return { assignments, values };
}

export async function ensureLocalHistorySchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS local_generation_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      image_key TEXT NOT NULL,
      image_type TEXT DEFAULT 'image/png',
      prompt TEXT DEFAULT '',
      negative_prompt TEXT DEFAULT '',
      params TEXT DEFAULT '{}',
      base_prompt TEXT DEFAULT '',
      subject_prompt TEXT DEFAULT '',
      modules TEXT DEFAULT '[]',
      structure_version INTEGER NOT NULL DEFAULT 0,
      source_chain_id TEXT,
      source_chain_name TEXT,
      source_chain_type TEXT,
      external_source TEXT,
      external_id TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      favorite_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `).run();
  for (const statement of [
    'ALTER TABLE local_generation_history ADD COLUMN external_source TEXT',
    'ALTER TABLE local_generation_history ADD COLUMN external_id TEXT',
    "ALTER TABLE local_generation_history ADD COLUMN base_prompt TEXT DEFAULT ''",
    "ALTER TABLE local_generation_history ADD COLUMN subject_prompt TEXT DEFAULT ''",
    "ALTER TABLE local_generation_history ADD COLUMN modules TEXT DEFAULT '[]'",
    'ALTER TABLE local_generation_history ADD COLUMN structure_version INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE local_generation_history ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE local_generation_history ADD COLUMN favorite_at INTEGER',
  ]) {
    try { await db.prepare(statement).run(); } catch { /* Column already exists. */ }
  }
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_local_history_user_created
    ON local_generation_history(user_id, created_at DESC)`).run();
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_local_history_external
    ON local_generation_history(user_id, external_source, external_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_local_history_user_favorite_created
    ON local_generation_history(user_id, is_favorite, created_at DESC)`).run();
  // Rows written before structured history existed have migration defaults
  // (empty strings and []).  They must continue to import their full prompt.
  // Preserve any older row that demonstrably contains structured information.
  await db.prepare(`UPDATE local_generation_history
    SET structure_version = 1
    WHERE COALESCE(structure_version, 0) = 0
      AND (
        TRIM(COALESCE(base_prompt, '')) != ''
        OR TRIM(COALESCE(subject_prompt, '')) != ''
        OR TRIM(COALESCE(modules, '')) NOT IN ('', '[]', 'null')
      )`).run();
}

export function localHistoryEnabled(env: Env) {
  return env.LOCAL_HISTORY_ENABLED === 'true';
}

export function localHistoryImageUrl(row: any) {
  return row.external_source === 'st-chatu8' && row.external_id
    ? `/api/integrations/st-chatu8/history/${encodeURIComponent(row.external_id)}/image`
    : `/api/local-history/${encodeURIComponent(row.id)}/image`;
}

function localHistoryEditMaskKey(userId: string, historyId: string) {
  return `local-history/${userId}/${historyId}.edit-mask`;
}

function sanitizeLocalHistoryEdit(edit: any) {
  if (!edit || typeof edit !== 'object') return undefined;
  const { maskData, actualCost, ...rest } = edit;
  return {
    ...rest,
    ...(rest.estimatedCost === undefined && Number.isFinite(Number(actualCost)) ? { estimatedCost: Number(actualCost) } : {}),
    ...(rest.maskAvailable === undefined && typeof maskData === 'string' && maskData.length > 0 ? { maskAvailable: true } : {}),
  };
}

function mapLocalHistoryRow(row: any) {
  const hasStructuredPrompt = Number(row.structure_version || 0) >= 1;
  const storedParams = parseStoredJson(row.params, {});
  const mappedParams = storedParams && typeof storedParams === 'object'
    ? { ...storedParams, ...(storedParams._local_edit ? { _local_edit: sanitizeLocalHistoryEdit(storedParams._local_edit) } : {}) }
    : {};
  return {
    id: row.id,
    imageUrl: localHistoryImageUrl(row),
    isFavorite: Number(row.is_favorite || 0) === 1,
    favoriteAt: row.favorite_at ? Number(row.favorite_at) : undefined,
    prompt: row.prompt || '',
    negativePrompt: row.negative_prompt || '',
    params: mappedParams,
    edit: sanitizeLocalHistoryEdit(storedParams?._local_edit),
    ...(hasStructuredPrompt ? {
      basePrompt: row.base_prompt || '',
      subjectPrompt: row.subject_prompt || '',
      modules: parseStoredJson(row.modules, []),
    } : {}),
    sourceChainId: row.source_chain_id || undefined,
    sourceChainName: row.source_chain_name || undefined,
    sourceChainType: row.source_chain_type || undefined,
    externalSource: row.external_source || undefined,
    externalId: row.external_id || undefined,
    createdAt: Number(row.created_at || 0),
  };
}

function inspirationImageUrl(row: any) {
  return row.image_key ? `/api/inspirations/${encodeURIComponent(row.id)}/image` : row.image_url;
}

function mapInspirationRow(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    title: row.title || '未命名灵感',
    imageUrl: inspirationImageUrl(row),
    prompt: row.prompt || '',
    negativePrompt: row.negative_prompt || '',
    params: parseStoredJson(row.params, undefined),
    boardId: row.board_id || undefined,
    notes: row.notes || '',
    tags: parseStoredJson(row.tags, []),
    sourceType: row.source_type || undefined,
    sourceId: row.source_id || undefined,
    sourceUrl: row.source_url || undefined,
    rating: Number(row.rating || 0),
    isPinned: Number(row.is_pinned || 0) === 1,
    archived: Number(row.archived || 0) === 1,
    lastUsedAt: row.last_used_at ? Number(row.last_used_at) : undefined,
    useCount: Number(row.use_count || 0),
    parentId: row.parent_id || undefined,
    analysis: parseStoredJson(row.analysis, {}),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || row.created_at || 0),
  };
}

function mapInspirationBoardRow(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: row.color || '#6366f1',
    sortOrder: Number(row.sort_order || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

// Lightweight project summary for the local Agent. Keep image/base64
// fields out of the response and let SQLite perform all counts.
export async function handleAgentRoute(ctx: RouteContext): Promise<Response | null> {
  const { request, db, path, method } = ctx;

  if (path === '/api/agent/project-overview' && method === 'GET') {
      await ensureInspirationSchema(db);
      const [chains, inspirations, artists, vibes, groups, characterReferences, history] = await Promise.all([
          db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN type = 'character' THEN 1 ELSE 0 END) AS characters FROM chains`).first<any>(),
          db.prepare('SELECT COUNT(*) AS total FROM inspirations').first<any>(),
          db.prepare('SELECT COUNT(*) AS total FROM artists').first<any>(),
          db.prepare('SELECT COUNT(*) AS total FROM vibe_assets').first<any>(),
          db.prepare('SELECT COUNT(*) AS total FROM vibe_groups').first<any>(),
          db.prepare('SELECT COUNT(*) AS total FROM character_reference_assets WHERE archived = 0').first<any>(),
          db.prepare(`SELECT id, prompt, negative_prompt, params, source_chain_id, source_chain_name, source_chain_type, created_at FROM local_generation_history ORDER BY created_at DESC LIMIT 5`).all<any>(),
      ]);
      const characterCount = Number(chains?.characters || 0);
      return json({
          styleChains: Math.max(0, Number(chains?.total || 0) - characterCount),
          characterChains: characterCount,
          inspirations: Number(inspirations?.total || 0),
          artists: Number(artists?.total || 0),
          vibes: Number(vibes?.total || 0),
          vibeGroups: Number(groups?.total || 0),
          characterReferences: Number(characterReferences?.total || 0),
          recentHistory: (history.results || []).map((item: any) => ({
              id: item.id,
              prompt: item.prompt,
              negativePrompt: item.negative_prompt,
              params: parseStoredJson(item.params, {}),
              sourceChainId: item.source_chain_id,
              sourceChainName: item.source_chain_name,
              sourceChainType: item.source_chain_type,
              createdAt: item.created_at,
          })),
      });
  }

  if (path === '/api/agent/library' && method === 'GET') {
      await ensureInspirationSchema(db);
      const kind = new URL(request.url).searchParams.get('kind') || 'all';
      const output: any = {};
      if (kind === 'all' || kind === 'chains') {
          const rows = await db.prepare(`SELECT id, type, name, description, tags, base_prompt, negative_prompt, variable_values, created_at, updated_at FROM chains ORDER BY updated_at DESC`).all<any>();
          output.chains = rows.results.map((item: any) => ({ ...item, tags: parseStoredJson(item.tags, []), variableValues: parseStoredJson(item.variable_values, {}), basePrompt: item.base_prompt, negativePrompt: item.negative_prompt, createdAt: item.created_at, updatedAt: item.updated_at }));
      }
      if (kind === 'all' || kind === 'inspirations') {
          const rows = await db.prepare(`SELECT id, title, prompt, negative_prompt, params, board_id, notes, tags, source_type, source_id, source_url, rating, is_pinned, archived, last_used_at, use_count, parent_id, analysis, created_at, updated_at FROM inspirations ORDER BY is_pinned DESC, created_at DESC`).all<any>();
          output.inspirations = rows.results.map((item: any) => ({
            id: item.id, title: item.title, prompt: item.prompt, negativePrompt: item.negative_prompt,
            params: parseStoredJson(item.params, undefined), boardId: item.board_id, notes: item.notes || '',
            tags: parseStoredJson(item.tags, []), sourceType: item.source_type, sourceId: item.source_id,
            sourceUrl: item.source_url, rating: Number(item.rating || 0), isPinned: Number(item.is_pinned || 0) === 1,
            archived: Number(item.archived || 0) === 1, lastUsedAt: item.last_used_at, useCount: Number(item.use_count || 0),
            parentId: item.parent_id, analysis: parseStoredJson(item.analysis, {}), createdAt: item.created_at, updatedAt: item.updated_at,
          }));
      }
      if (kind === 'all' || kind === 'artists') {
          const rows = await db.prepare(`SELECT id, name, benchmarks FROM artists ORDER BY name ASC`).all<any>();
          output.artists = rows.results.map((item: any) => ({ id: item.id, name: item.name, benchmarks: parseStoredJson(item.benchmarks, []).length }));
      }
      return json(output);
  }

  return null;
}

// /api/local-history/* and /api/inspiration-* /api/inspirations/* routes.
export async function handleHistoryRoute(ctx: RouteContext): Promise<Response | null> {
  const { request, env, url, path, method, db, currentUser } = ctx;

  if (path === '/api/local-history/status' && method === 'GET') {
    const enabled = localHistoryEnabled(env) && Boolean(env.BUCKET);
    if (enabled) await ensureLocalHistorySchema(db);
    return json({ enabled });
  }

  if (path.startsWith('/api/local-history')) {
    if (!localHistoryEnabled(env)) return error('Local history is disabled', 404);
    if (!env.BUCKET) return error('Local history storage is unavailable', 503);
    await ensureLocalHistorySchema(db);
    await ensureInspirationSchema(db);

    const deleteHistoryRows = async (rows: Array<{id: string, image_key: string}>) => {
      for (const row of rows) {
        if (row.image_key) {
          const reference = await db.prepare('SELECT COUNT(*) AS count FROM inspirations WHERE image_key = ?').bind(row.image_key).first<{count: number}>();
          if (Number(reference?.count || 0) === 0) await env.BUCKET!.delete(row.image_key);
        }
        await env.BUCKET!.delete(localHistoryEditMaskKey(currentUser.id, row.id));
        await db.prepare('DELETE FROM local_generation_history WHERE id = ? AND user_id = ?')
          .bind(row.id, currentUser.id).run();
      }
      return rows.length;
    };

    if (path === '/api/local-history/media-index' && method === 'GET') {
      const page = clampInt(url.searchParams.get('page'), 0, 0, 1000000);
      const pageSize = clampInt(url.searchParams.get('pageSize'), 100, 1, 250);
      const includeCount = url.searchParams.get('includeCount') !== '0';
      const count = includeCount
        ? await db.prepare('SELECT COUNT(*) AS count FROM local_generation_history WHERE user_id = ?')
            .bind(currentUser.id).first<{count: number}>()
        : null;
      const result = await db.prepare(`
        SELECT id, external_source, external_id
        FROM local_generation_history
        WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).bind(currentUser.id, pageSize, page * pageSize).all<any>();
      return json({
        items: result.results.map(row => ({ id: row.id, imageUrl: localHistoryImageUrl(row) })),
        ...(includeCount ? { count: Number(count?.count || 0) } : {}),
      });
    }

    const imageMatch = path.match(/^\/api\/local-history\/([^/]+)\/image$/);
    if (imageMatch && method === 'GET') {
      const id = decodeURIComponent(imageMatch[1]);
      const row = await db.prepare('SELECT image_key FROM local_generation_history WHERE id = ? AND user_id = ?')
        .bind(id, currentUser.id).first<{image_key: string}>();
      if (!row) return error('History image not found', 404);
      if (!row.image_key) return error('External history image is served by the local gateway', 404);
      const object = await env.BUCKET.get(row.image_key);
      if (!object) return error('History image file not found', 404);
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'private, max-age=31536000, immutable');
      return new Response(object.body, { headers });
    }

    const editMaskMatch = path.match(/^\/api\/local-history\/([^/]+)\/edit-mask$/);
    if (editMaskMatch && method === 'GET') {
      const id = decodeURIComponent(editMaskMatch[1]);
      const row = await db.prepare('SELECT params FROM local_generation_history WHERE id = ? AND user_id = ?')
        .bind(id, currentUser.id).first<{params: string}>();
      if (!row) return error('History edit mask not found', 404);
      const object = await env.BUCKET!.get(localHistoryEditMaskKey(currentUser.id, id));
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'private, max-age=31536000, immutable');
        return new Response(object.body, { headers });
      }
      const storedParams = parseStoredJson(row.params, {});
      const legacyEdit = storedParams?._local_edit;
      const legacyMask = legacyEdit?.maskData;
      if (typeof legacyMask === 'string' && legacyMask.startsWith('data:image/')) {
        try {
          const parsed = parseImageData(legacyMask);
          const editMaskKey = localHistoryEditMaskKey(currentUser.id, id);
          await env.BUCKET.put(editMaskKey, exactArrayBuffer(parsed.bytes), { httpMetadata: { contentType: parsed.contentType } });
          const normalizedEdit = sanitizeLocalHistoryEdit(legacyEdit);
          if (normalizedEdit) {
            await db.prepare('UPDATE local_generation_history SET params = ? WHERE id = ? AND user_id = ?')
              .bind(JSON.stringify({ ...storedParams, _local_edit: { ...normalizedEdit, maskAvailable: true } }), id, currentUser.id)
              .run();
          }
          return new Response(exactArrayBuffer(parsed.bytes), {
            headers: {
              'Content-Type': parsed.contentType,
              'Cache-Control': 'private, max-age=31536000, immutable',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        } catch { /* 旧蒙版损坏时按不存在处理。 */ }
      }
      return error('History edit mask not found', 404);
    }

    if (path === '/api/local-history' && method === 'GET') {
      const sourceChainId = url.searchParams.get('sourceChainId');
      if (sourceChainId) {
        const limit = clampInt(url.searchParams.get('limit'), 80, 1, 200);
        const result = await db.prepare(`
          SELECT * FROM local_generation_history
          WHERE user_id = ? AND source_chain_id = ?
          ORDER BY created_at DESC LIMIT ?
        `).bind(currentUser.id, sourceChainId, limit).all<any>();
        return json({ items: result.results.map(mapLocalHistoryRow) });
      }

      const page = clampInt(url.searchParams.get('page'), 0, 0, 1000000);
      const pageSize = clampInt(url.searchParams.get('pageSize'), 20, 1, 100);
      const from = Number(url.searchParams.get('from') || 0);
      const to = Number(url.searchParams.get('to') || 0);
      const includeCount = url.searchParams.get('includeCount') !== '0';
      const favoriteOnly = url.searchParams.get('favorite') === '1';
      const dateWhere = from || to ? ` AND created_at >= ? AND created_at <= ?` : '';
      const favoriteWhere = favoriteOnly ? ' AND COALESCE(is_favorite, 0) = 1' : '';
      const dateValues = from || to ? [from || 0, to || Number.MAX_SAFE_INTEGER] : [];
      const count = includeCount
        ? await db.prepare(`SELECT COUNT(*) AS count FROM local_generation_history WHERE user_id = ?${dateWhere}${favoriteWhere}`)
            .bind(currentUser.id, ...dateValues).first<{count: number}>()
        : null;
      const result = await db.prepare(`
        SELECT * FROM local_generation_history
        WHERE user_id = ?${dateWhere}${favoriteWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).bind(currentUser.id, ...dateValues, pageSize, page * pageSize).all<any>();
      return json({ items: result.results.map(mapLocalHistoryRow), ...(includeCount ? { count: Number(count?.count || 0) } : {}) });
    }

    if (path === '/api/local-history/count' && method === 'GET') {
      const from = Number(url.searchParams.get('from') || 0);
      const to = Number(url.searchParams.get('to') || 0);
      const favoriteOnly = url.searchParams.get('favorite') === '1';
      const dateWhere = from || to ? ' AND created_at >= ? AND created_at <= ?' : '';
      const favoriteWhere = favoriteOnly ? ' AND COALESCE(is_favorite, 0) = 1' : '';
      const dateValues = from || to ? [from || 0, to || Number.MAX_SAFE_INTEGER] : [];
      const result = await db.prepare(`SELECT COUNT(*) AS count FROM local_generation_history WHERE user_id = ?${dateWhere}${favoriteWhere}`)
        .bind(currentUser.id, ...dateValues).first<{count: number}>();
      return json({ count: Number(result?.count || 0) });
    }

    if (path === '/api/local-history/favorites' && method === 'POST') {
      const body = await request.json() as any;
      const ids = Array.from(new Set(
        (Array.isArray(body.ids) ? body.ids : [])
          .slice(0, 200)
          .map((id: any) => String(id || '').trim())
          .filter(Boolean)
      )) as string[];
      if (!ids.length) return json({ updatedCount: 0 });
      const favorite = Boolean(body.favorite);
      const placeholders = ids.map(() => '?').join(',');
      const result = await db.prepare(`
        UPDATE local_generation_history
        SET is_favorite = ?, favorite_at = ?
        WHERE user_id = ? AND id IN (${placeholders})
      `).bind(favorite ? 1 : 0, favorite ? Date.now() : null, currentUser.id, ...ids).run();
      return json({ updatedCount: Number(result.meta?.changes || 0), favorite });
    }

    if (path === '/api/local-history' && method === 'POST') {
      const multipart = request.headers.get('Content-Type')?.includes('multipart/form-data');
      const form = multipart ? await request.formData() : null;
      let body: any;
      try {
        body = multipart ? JSON.parse(String(form?.get('metadata') || '{}')) : await request.json();
      } catch {
        return error('Invalid history metadata', 400);
      }
      const id = String(body.id || crypto.randomUUID());
      const hasStructuredInput = typeof body.basePrompt === 'string' ||
        typeof body.subjectPrompt === 'string' || Array.isArray(body.modules);
      let bytes: Uint8Array;
      let imageType: string;
      let extension: string;
      let width: number;
      let height: number;
      let editMask: { bytes: Uint8Array; contentType: string } | null = null;
      if (multipart) {
        let parsed;
        try { parsed = await parseUploadedImage(form?.get('image') || null, MAX_MANAGED_IMAGE_BYTES); } catch (e: any) { return error(e.message, 400); }
        bytes = parsed.bytes;
        imageType = parsed.contentType;
        extension = parsed.format;
        width = parsed.width;
        height = parsed.height;
        const editMaskFile = form?.get('editMask');
        if (editMaskFile instanceof File) {
          try {
            const parsedMask = await parseUploadedImage(editMaskFile, MAX_MANAGED_IMAGE_BYTES);
            editMask = { bytes: parsedMask.bytes, contentType: parsedMask.contentType };
          } catch (e: any) {
            return error(`编辑蒙版无效：${e.message}`, 400);
          }
        }
      } else {
        let parsed;
        try { parsed = parseImageData(String(body.imageUrl || '')); } catch (e: any) { return error(e.message, 400); }
        bytes = parsed.bytes;
        imageType = parsed.contentType;
        extension = parsed.format;
        width = parsed.width;
        height = parsed.height;
      }
      if (bytes.byteLength > MAX_MANAGED_IMAGE_BYTES) {
        return error(`历史图片不能超过 ${Math.floor(MAX_MANAGED_IMAGE_BYTES / 1024 / 1024)}MB`, 413);
      }
      // 以图片真实尺寸为准覆盖宽高；保留 steps/scale/sampler/seed 等其他生成参数
      const rawParams = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};
      const normalizedEdit = sanitizeLocalHistoryEdit(body.edit);
      const editWithAvailability = normalizedEdit
        ? { ...normalizedEdit, ...(editMask ? { maskAvailable: true } : {}) }
        : undefined;
      const sanitizedRawParams = {
        ...rawParams,
        ...(rawParams._local_edit ? { _local_edit: sanitizeLocalHistoryEdit(rawParams._local_edit) } : {}),
      };
      const normalizedParams = {
        ...sanitizedRawParams,
        width,
        height,
        ...(editWithAvailability ? { _local_edit: editWithAvailability } : {}),
      };
      const imageKey = `local-history/${currentUser.id}/${id}.${extension}`;
      const existing = await db.prepare('SELECT image_key, is_favorite, favorite_at FROM local_generation_history WHERE id = ? AND user_id = ?')
        .bind(id, currentUser.id).first<{image_key: string, is_favorite: number, favorite_at: number | null}>();
      const isFavorite = body.isFavorite === undefined ? Number(existing?.is_favorite || 0) === 1 : Boolean(body.isFavorite);
      const favoriteAt = isFavorite ? Number(body.favoriteAt || existing?.favorite_at || Date.now()) : null;

      await env.BUCKET.put(imageKey, exactArrayBuffer(bytes), { httpMetadata: { contentType: imageType } });
      const editMaskKey = localHistoryEditMaskKey(currentUser.id, id);
      if (editMask) {
        await env.BUCKET.put(editMaskKey, exactArrayBuffer(editMask.bytes), { httpMetadata: { contentType: editMask.contentType } });
      }
      await db.prepare(`
        INSERT OR REPLACE INTO local_generation_history (
          id, user_id, image_key, image_type, prompt, negative_prompt, params,
          base_prompt, subject_prompt, modules, structure_version,
          source_chain_id, source_chain_name, source_chain_type, is_favorite, favorite_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, currentUser.id, imageKey, imageType, body.prompt || '', body.negativePrompt || '',
        JSON.stringify(normalizedParams), body.basePrompt || '', body.subjectPrompt || '', JSON.stringify(body.modules || []),
        hasStructuredInput ? 1 : 0,
        body.sourceChainId || null, body.sourceChainName || null, body.sourceChainType || null,
        isFavorite ? 1 : 0, favoriteAt,
        Number(body.createdAt || Date.now())
      ).run();
      if (existing?.image_key && existing.image_key !== imageKey) await env.BUCKET.delete(existing.image_key);
      if (!editMask) await env.BUCKET.delete(editMaskKey);
      return json({ item: mapLocalHistoryRow({
        id, image_key: imageKey, prompt: body.prompt, negative_prompt: body.negativePrompt,
        params: JSON.stringify(normalizedParams), base_prompt: body.basePrompt, subject_prompt: body.subjectPrompt,
        modules: JSON.stringify(body.modules || []), structure_version: hasStructuredInput ? 1 : 0, source_chain_id: body.sourceChainId,
        source_chain_name: body.sourceChainName, source_chain_type: body.sourceChainType,
        is_favorite: isFavorite ? 1 : 0, favorite_at: favoriteAt,
        created_at: Number(body.createdAt || Date.now())
      }) });
    }

    if (path === '/api/local-history' && method === 'DELETE') {
      const result = await db.prepare('SELECT id, image_key FROM local_generation_history WHERE user_id = ?')
        .bind(currentUser.id).all<{id: string, image_key: string}>();
      return json({ deletedCount: await deleteHistoryRows(result.results) });
    }

    if (path === '/api/local-history/cleanup' && method === 'POST') {
      const body = await request.json() as any;
      let result: D1Result<{id: string, image_key: string}>;
      if (Number.isFinite(body.days)) {
        const cutoff = Date.now() - Math.max(1, Math.floor(body.days)) * 86400000;
        result = await db.prepare('SELECT id, image_key FROM local_generation_history WHERE user_id = ? AND created_at < ?')
          .bind(currentUser.id, cutoff).all<{id: string, image_key: string}>();
      } else {
        const keepCount = Math.max(1, Math.floor(Number(body.keepCount || 1)));
        result = await db.prepare(`
          SELECT id, image_key FROM local_generation_history WHERE user_id = ?
          ORDER BY created_at DESC LIMIT -1 OFFSET ?
        `).bind(currentUser.id, keepCount).all<{id: string, image_key: string}>();
      }
      return json({ deletedCount: await deleteHistoryRows(result.results) });
    }

    if (path === '/api/local-history/count-older' && method === 'GET') {
      const days = clampInt(url.searchParams.get('days'), 7, 1, 36500);
      const cutoff = Date.now() - days * 86400000;
      const result = await db.prepare('SELECT COUNT(*) AS count FROM local_generation_history WHERE user_id = ? AND created_at < ?')
        .bind(currentUser.id, cutoff).first<{count: number}>();
      return json({ count: Number(result?.count || 0) });
    }

    if (path === '/api/local-history/unlink-source' && method === 'POST') {
      const { sourceChainId } = await request.json() as any;
      const result = await db.prepare(`
        UPDATE local_generation_history SET source_chain_id = NULL, source_chain_name = NULL, source_chain_type = NULL
        WHERE user_id = ? AND source_chain_id = ?
      `).bind(currentUser.id, sourceChainId).run();
      return json({ count: Number(result.meta?.changes || 0) });
    }

    const unlinkMatch = path.match(/^\/api\/local-history\/([^/]+)\/unlink$/);
    if (unlinkMatch && method === 'PUT') {
      const id = decodeURIComponent(unlinkMatch[1]);
      await db.prepare(`
        UPDATE local_generation_history SET source_chain_id = NULL, source_chain_name = NULL, source_chain_type = NULL
        WHERE id = ? AND user_id = ?
      `).bind(id, currentUser.id).run();
      const row = await db.prepare('SELECT * FROM local_generation_history WHERE id = ? AND user_id = ?')
        .bind(id, currentUser.id).first<any>();
      return json({ item: row ? mapLocalHistoryRow(row) : null });
    }

    const deleteMatch = path.match(/^\/api\/local-history\/([^/]+)$/);
    if (deleteMatch && method === 'DELETE') {
      const id = decodeURIComponent(deleteMatch[1]);
      const row = await db.prepare('SELECT id, image_key FROM local_generation_history WHERE id = ? AND user_id = ?')
        .bind(id, currentUser.id).first<{id: string, image_key: string}>();
      if (row) await deleteHistoryRows([row]);
      return json({ success: true });
    }
  }

  // Inspiration boards and curated inspiration library
  if (path.startsWith('/api/inspiration-boards') || path.startsWith('/api/inspirations')) {
    await ensureInspirationSchema(db);
  }

  if (path === '/api/inspiration-boards' && method === 'GET') {
    const result = await db.prepare('SELECT * FROM inspiration_boards WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC')
      .bind(currentUser.id).all<any>();
    return json({ items: result.results.map(mapInspirationBoardRow) });
  }
  if (path === '/api/inspiration-boards' && method === 'POST') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    const body = await request.json() as any;
    const now = Date.now();
    const id = String(body.id || crypto.randomUUID());
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) return error('Board name is required', 400);
    await db.prepare(`INSERT INTO inspiration_boards (id, user_id, name, color, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, currentUser.id, name, String(body.color || '#6366f1'), Number(body.sortOrder || 0), now, now).run();
    const row = await db.prepare('SELECT * FROM inspiration_boards WHERE id = ?').bind(id).first<any>();
    return json({ item: mapInspirationBoardRow(row) });
  }
  const boardMatch = path.match(/^\/api\/inspiration-boards\/([^/]+)$/);
  if (boardMatch && method === 'PUT') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    const id = decodeURIComponent(boardMatch[1]);
    const body = await request.json() as any;
    const current = await db.prepare('SELECT * FROM inspiration_boards WHERE id = ? AND user_id = ?').bind(id, currentUser.id).first<any>();
    if (!current) return error('Not Found', 404);
    await db.prepare('UPDATE inspiration_boards SET name = ?, color = ?, sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(
        typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : current.name,
        typeof body.color === 'string' ? body.color : current.color,
        Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : current.sort_order,
        Date.now(), id, currentUser.id,
      ).run();
    return json({ success: true });
  }
  if (boardMatch && method === 'DELETE') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    const id = decodeURIComponent(boardMatch[1]);
    const board = await db.prepare('SELECT id FROM inspiration_boards WHERE id = ? AND user_id = ?').bind(id, currentUser.id).first<any>();
    if (!board) return error('Not Found', 404);
    await db.prepare('UPDATE inspirations SET board_id = NULL, updated_at = ? WHERE board_id = ? AND user_id = ?').bind(Date.now(), id, currentUser.id).run();
    await db.prepare('DELETE FROM inspiration_boards WHERE id = ? AND user_id = ?').bind(id, currentUser.id).run();
    return json({ success: true });
  }

  const updateInspirationFields = async (id: string, updates: any) => {
    const built = buildInspirationSetStatements(updates);
    if (!built) return 0;
    const result = await db.prepare(`UPDATE inspirations SET ${built.assignments.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(...built.values, Date.now(), id, currentUser.id).run();
    return Number(result.meta?.changes || 0);
  };

  const deleteInspirationAsset = async (item: any) => {
    if (item.image_key) {
      const references = await db.prepare(`SELECT
        (SELECT COUNT(*) FROM local_generation_history WHERE image_key = ?) +
        (SELECT COUNT(*) FROM inspirations WHERE image_key = ? AND id != ?) AS count`)
        .bind(item.image_key, item.image_key, item.id).first<{count: number}>();
      if (Number(references?.count || 0) === 0 && env.BUCKET) await env.BUCKET.delete(item.image_key);
    } else if (item.image_url) {
      await deleteR2File(env, item.image_url);
    }
  };

  const inspirationImageMatch = path.match(/^\/api\/inspirations\/([^/]+)\/image$/);
  if (inspirationImageMatch && method === 'GET') {
    const id = decodeURIComponent(inspirationImageMatch[1]);
    const row = await db.prepare('SELECT image_key, image_type FROM inspirations WHERE id = ?').bind(id).first<any>();
    if (!row?.image_key || !env.BUCKET) return error('Inspiration image not found', 404);
    const object = await env.BUCKET.get(row.image_key);
    if (!object) return error('Inspiration image file not found', 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', row.image_type || headers.get('Content-Type') || 'image/png');
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'private, max-age=31536000, immutable');
    return new Response(object.body, { headers });
  }

  if (path === '/api/inspirations' && method === 'GET') {
    const result = await db.prepare('SELECT * FROM inspirations ORDER BY is_pinned DESC, created_at DESC').all<any>();
    return json(result.results.map(mapInspirationRow));
  }
  if (path === '/api/inspirations' && method === 'POST') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    const body = await request.json() as any;
    const id = String(body.id || crypto.randomUUID());
    const now = Number(body.createdAt || Date.now());
    let imageUrl = body.imageUrl || null;
    let imageKey: string | null = null;
    let imageType: string | null = null;
    if (body.sourceType === 'history' && body.sourceId) {
      const history = await db.prepare('SELECT image_key, image_type FROM local_generation_history WHERE id = ? AND user_id = ?')
        .bind(String(body.sourceId), currentUser.id).first<any>();
      if (history?.image_key) {
        imageKey = history.image_key;
        imageType = history.image_type || 'image/png';
        imageUrl = null;
      }
    }
    if (imageUrl && String(imageUrl).startsWith('data:')) {
      try { imageUrl = await processImageUpload(env, imageUrl, 'inspirations', id, currentUser); }
      catch (e: any) { return error(e.message, 413); }
    }
    await db.prepare(`INSERT OR REPLACE INTO inspirations (
      id, user_id, username, title, image_url, image_key, image_type, prompt, negative_prompt, params,
      board_id, notes, tags, source_type, source_id, source_url, rating, is_pinned, archived,
      last_used_at, use_count, parent_id, analysis, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id, currentUser.id, currentUser.username, String(body.title || '未命名灵感').slice(0, 160), imageUrl, imageKey, imageType,
        String(body.prompt || ''), String(body.negativePrompt || ''), body.params ? JSON.stringify(body.params) : null,
        body.boardId || null, String(body.notes || ''), JSON.stringify(Array.isArray(body.tags) ? body.tags.slice(0, 80) : []),
        body.sourceType || 'other', body.sourceId || null, body.sourceUrl || null,
        Math.max(0, Math.min(5, Math.floor(Number(body.rating) || 0))), body.isPinned ? 1 : 0, body.archived ? 1 : 0,
        body.lastUsedAt || null, Number(body.useCount || 0), body.parentId || null, JSON.stringify(body.analysis || {}), now, Number(body.updatedAt || now),
      ).run();
    const row = await db.prepare('SELECT * FROM inspirations WHERE id = ?').bind(id).first<any>();
    return json({ success: true, id, item: mapInspirationRow(row) });
  }
  if (path === '/api/inspirations/bulk-update' && method === 'POST') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    const body = await request.json() as any;
    const ids = Array.from(new Set((Array.isArray(body.ids) ? body.ids : []).slice(0, 500).map((id: any) => String(id)).filter(Boolean))) as string[];
    // 同一组字段更新 N 条：一次构建 SET 子句，db.batch 单往返执行，替代 N 次串行 UPDATE
    const updates = body.updates || {};
    const built = buildInspirationSetStatements(updates);
    if (!built || !ids.length) return json({ success: true, updatedCount: 0 });
    const results = await db.batch(ids.map(id =>
      db.prepare(`UPDATE inspirations SET ${built.assignments.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
        .bind(...built.values, Date.now(), id, currentUser.id)));
    const updatedCount = results.reduce((sum, result) => sum + Number((result.meta as any)?.changes || 0), 0);
    return json({ success: true, updatedCount });
  }
  if (path === '/api/inspirations/bulk-delete' && method === 'POST') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    const body = await request.json() as any;
    const ids = Array.from(new Set((Array.isArray(body.ids) ? body.ids : []).slice(0, 500).map((id: any) => String(id)).filter(Boolean))) as string[];
    // 分块 IN 查询（D1 单查询绑定参数上限）+ 批量 DELETE，替代 N 次 SELECT + N 次 DELETE 的串行往返
    const rows: any[] = [];
    for (let index = 0; index < ids.length; index += 90) {
      const chunk = ids.slice(index, index + 90);
      const found = await db.prepare(`SELECT * FROM inspirations WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<any>();
      rows.push(...found.results);
    }
    const valid = rows.filter(item => currentUser.role === 'admin' || item.user_id === currentUser.id);
    if (valid.length) {
      await db.batch(valid.map(item => db.prepare('DELETE FROM inspirations WHERE id = ?').bind(item.id)));
      for (const item of valid) await deleteInspirationAsset(item);
    }
    return json({ success: true, deletedCount: valid.length });
  }
  const inspirationUseMatch = path.match(/^\/api\/inspirations\/([^/]+)\/use$/);
  if (inspirationUseMatch && method === 'POST') {
    const id = decodeURIComponent(inspirationUseMatch[1]);
    await db.prepare('UPDATE inspirations SET use_count = COALESCE(use_count, 0) + 1, last_used_at = ?, updated_at = ? WHERE id = ?')
      .bind(Date.now(), Date.now(), id).run();
    return json({ success: true });
  }
  const inspirationMatch = path.match(/^\/api\/inspirations\/([^/]+)$/);
  if (inspirationMatch && method === 'PUT') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    const id = decodeURIComponent(inspirationMatch[1]);
    const item = await db.prepare('SELECT user_id FROM inspirations WHERE id = ?').bind(id).first<any>();
    if (!item) return error('Not Found', 404);
    if (item.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
    const updates = await request.json() as any;
    if (currentUser.role === 'admin' && item.user_id !== currentUser.id) {
      const ownerId = item.user_id;
      const statements: string[] = [];
      const values: any[] = [];
      if (typeof updates.title === 'string') { statements.push('title = ?'); values.push(updates.title.slice(0, 160)); }
      if (typeof updates.prompt === 'string') { statements.push('prompt = ?'); values.push(updates.prompt); }
      if (typeof updates.negativePrompt === 'string') { statements.push('negative_prompt = ?'); values.push(updates.negativePrompt); }
      if (statements.length) await db.prepare(`UPDATE inspirations SET ${statements.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).bind(...values, Date.now(), id, ownerId).run();
    } else {
      await updateInspirationFields(id, updates);
    }
    return json({ success: true });
  }
  if (inspirationMatch && method === 'DELETE') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    const id = decodeURIComponent(inspirationMatch[1]);
    const item = await db.prepare('SELECT * FROM inspirations WHERE id = ?').bind(id).first<any>();
    if (!item) return json({ success: true });
    if (item.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
    await db.prepare('DELETE FROM inspirations WHERE id = ?').bind(id).run();
    await deleteInspirationAsset(item);
    return json({ success: true });
  }

  return null;
}
