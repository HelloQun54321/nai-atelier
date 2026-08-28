// Vibe Transfer library + character reference library routes and image helpers.
// Moved verbatim from worker/index.ts during the domain split; behavior unchanged.
import { readImageDimensions } from '../imageDimensions.mjs';
import { json, error, parseStoredJson, type D1Database, type Env, type RouteContext } from './types';

// 进程内标记：DDL 幂等但昂贵，同一实例只在首个请求跑一次。
let vibeSchemaEnsured = false;
export async function ensureVibeSchema(db: D1Database) {
  if (vibeSchemaEnsured) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS vibe_assets (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, source_hash TEXT NOT NULL UNIQUE,
      original_key TEXT, original_type TEXT, thumbnail_key TEXT, thumbnail_type TEXT, default_strength REAL NOT NULL DEFAULT 0.6,
      archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vibe_encodings (
      id TEXT PRIMARY KEY, vibe_id TEXT NOT NULL, model TEXT NOT NULL, model_key TEXT NOT NULL,
      information_extracted REAL NOT NULL, encoding_key TEXT NOT NULL, encoding_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, UNIQUE(vibe_id, model, information_extracted)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vibe_groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slots TEXT NOT NULL DEFAULT '[]',
      normalize_strengths INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
  ]);
  for (const statement of [
    'ALTER TABLE vibe_assets ADD COLUMN thumbnail_key TEXT',
    'ALTER TABLE vibe_assets ADD COLUMN thumbnail_type TEXT',
  ]) {
    try { await db.prepare(statement).run(); } catch { /* Column already exists. */ }
  }
  vibeSchemaEnsured = true;
}

let characterReferenceSchemaEnsured = false;
export async function ensureCharacterReferenceSchema(db: D1Database) {
  if (characterReferenceSchemaEnsured) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS character_reference_assets (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, source_hash TEXT NOT NULL UNIQUE,
    original_key TEXT NOT NULL, original_type TEXT NOT NULL,
    thumbnail_key TEXT, thumbnail_type TEXT,
    default_strength REAL NOT NULL DEFAULT 0.6,
    default_fidelity REAL NOT NULL DEFAULT 0.6,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_character_reference_assets_archived_updated
    ON character_reference_assets(archived, updated_at DESC)`).run();
  try {
    await db.prepare('ALTER TABLE character_reference_assets ADD COLUMN default_fidelity REAL NOT NULL DEFAULT 0.6').run();
  } catch { /* Column already exists. */ }
  characterReferenceSchemaEnsured = true;
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  }
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export const exactArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
) as ArrayBuffer;

const sha256Hex = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', exactArrayBuffer(bytes))))
  .map(value => value.toString(16).padStart(2, '0')).join('');

const VIBE_MODEL = 'nai-diffusion-4-5-full';
const VIBE_MODEL_KEY = 'v4-5full';
const VIBE_UPLOAD_LIMIT = 30 * 1024 * 1024;

export function parseImageData(value: string) {
  const match = String(value || '').match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('只支持 PNG、JPEG 或 WebP 图片');
  const bytes = base64ToBytes(match[2]);
  if (!bytes.length || bytes.length > VIBE_UPLOAD_LIMIT) throw new Error('参考图大小必须在 30 MB 以内');
  const format = match[1].toLowerCase().replace('jpeg', 'jpg') as 'png' | 'jpg' | 'webp';
  const valid = format === 'png'
    ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    : format === 'webp'
      ? String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
      : bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!valid) throw new Error('图片内容与文件格式不一致');
  return { bytes, format, contentType: format === 'jpg' ? 'image/jpeg' : `image/${format}`, ...readImageDimensions(bytes, format) };
}

export async function parseUploadedImage(value: FormDataEntryValue | null, limit = VIBE_UPLOAD_LIMIT) {
  if (!(value instanceof File)) throw new Error('缺少图片文件');
  const contentType = value.type.toLowerCase();
  const format = contentType === 'image/png' ? 'png'
    : contentType === 'image/jpeg' ? 'jpg'
      : contentType === 'image/webp' ? 'webp'
        : '';
  if (!format) throw new Error('只支持 PNG、JPEG 或 WebP 图片');
  if (!value.size || value.size > limit) throw new Error(`图片大小必须在 ${Math.floor(limit / 1024 / 1024)} MB 以内`);
  const bytes = new Uint8Array(await value.arrayBuffer());
  const valid = format === 'png'
    ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    : format === 'webp'
      ? String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
      : bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!valid) throw new Error('图片内容与文件格式不一致');
  return { bytes, format, contentType, ...readImageDimensions(bytes, format) };
}

const mapVibeEncoding = (row: any) => ({
  id: row.id,
  model: row.model,
  modelKey: row.model_key,
  informationExtracted: Number(row.information_extracted),
  encodingHash: row.encoding_hash,
  createdAt: Number(row.created_at),
});

async function mapVibeAsset(db: D1Database, row: any, preloadedEncodings?: any[]) {
  const encodings = preloadedEncodings || (await db.prepare('SELECT * FROM vibe_encodings WHERE vibe_id = ? ORDER BY information_extracted DESC')
    .bind(row.id).all<any>()).results;
  return {
    id: row.id,
    name: row.name,
    sourceHash: row.source_hash,
    originalImageUrl: row.original_key ? `/api/vibes/${encodeURIComponent(row.id)}/image` : undefined,
    thumbnailUrl: row.thumbnail_key
      ? `/api/vibes/${encodeURIComponent(row.id)}/thumbnail`
      : row.original_key ? `/api/vibes/${encodeURIComponent(row.id)}/image` : undefined,
    hasOriginal: Boolean(row.original_key),
    defaultStrength: Number(row.default_strength ?? 0.6),
    encodings: encodings.map(mapVibeEncoding),
    archived: row.archived === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapCharacterReferenceAsset(row: any) {
  return {
    id: row.id,
    name: row.name,
    sourceHash: row.source_hash,
    originalImageUrl: `/api/character-references/${encodeURIComponent(row.id)}/image`,
    thumbnailUrl: row.thumbnail_key
      ? `/api/character-references/${encodeURIComponent(row.id)}/thumbnail`
      : `/api/character-references/${encodeURIComponent(row.id)}/image`,
    defaultStrength: Number(row.default_strength ?? 0.6),
    defaultFidelity: Number(row.default_fidelity ?? 0.6),
    archived: row.archived === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

// Precise/Character Reference image library + Permanent Vibe Transfer library.
export async function handleVibeRoute(ctx: RouteContext): Promise<Response | null> {
  const { request, env, url, path, method, db } = ctx;

  // --- Precise/Character Reference image library ---
  if (path.startsWith('/api/character-references')) {
    if (!env.BUCKET) return error('角色参考图本地存储不可用', 503);
    await ensureCharacterReferenceSchema(db);

    if (path === '/api/character-references' && method === 'GET') {
      const includeArchived = url.searchParams.get('archived') === 'true';
      const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const rows = query
        ? await db.prepare(`SELECT * FROM character_reference_assets
            WHERE archived = ? AND LOWER(name) LIKE ? ORDER BY updated_at DESC`)
            .bind(includeArchived ? 1 : 0, `%${query}%`).all<any>()
        : await db.prepare(`SELECT * FROM character_reference_assets
            WHERE archived = ? ORDER BY updated_at DESC`)
            .bind(includeArchived ? 1 : 0).all<any>();
      return json({ items: rows.results.map(mapCharacterReferenceAsset) });
    }

    if (path === '/api/character-references' && method === 'POST') {
      const multipart = request.headers.get('Content-Type')?.includes('multipart/form-data');
      const form = multipart ? await request.formData() : null;
      const body = multipart ? { name: String(form?.get('name') || '') } : await request.json() as any;
      let original;
      try { original = multipart ? await parseUploadedImage(form?.get('image') || null) : parseImageData(body.imageData); } catch (e: any) { return error(e.message, 400); }
      const sourceHash = await sha256Hex(original.bytes);
      const existing = await db.prepare('SELECT * FROM character_reference_assets WHERE source_hash = ?')
        .bind(sourceHash).first<any>();
      if (existing) {
        if (existing.archived === 1) {
          const now = Date.now();
          await db.prepare('UPDATE character_reference_assets SET archived = 0, updated_at = ? WHERE id = ?')
            .bind(now, existing.id).run();
          existing.archived = 0;
          existing.updated_at = now;
        }
        return json({ item: mapCharacterReferenceAsset(existing), duplicate: true });
      }

      const id = crypto.randomUUID();
      const now = Date.now();
      const originalKey = `character-references/originals/${id}.${original.format}`;
      await env.BUCKET.put(originalKey, exactArrayBuffer(original.bytes), {
        httpMetadata: { contentType: original.contentType },
      });

      let thumbnailKey: string | null = null;
      let thumbnailType: string | null = null;
      if (multipart ? form?.get('thumbnail') instanceof File : body.thumbnailData) {
        try {
          const thumbnail = multipart
            ? await parseUploadedImage(form?.get('thumbnail') || null, 2 * 1024 * 1024)
            : parseImageData(body.thumbnailData);
          if (thumbnail.bytes.length <= 2 * 1024 * 1024) {
            thumbnailKey = `character-references/thumbnails/${id}.${thumbnail.format}`;
            thumbnailType = thumbnail.contentType;
            await env.BUCKET.put(thumbnailKey, exactArrayBuffer(thumbnail.bytes), {
              httpMetadata: { contentType: thumbnailType },
            });
          }
        } catch { /* A failed optional thumbnail must not discard the original. */ }
      }

      const name = String(body.name || `角色参考 ${sourceHash.slice(0, 8)}`).trim().slice(0, 100)
        || `角色参考 ${sourceHash.slice(0, 8)}`;
      await db.prepare(`INSERT INTO character_reference_assets
        (id, name, source_hash, original_key, original_type, thumbnail_key, thumbnail_type,
         default_strength, default_fidelity, archived, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
        .bind(id, name, sourceHash, originalKey, original.contentType, thumbnailKey, thumbnailType, 0.6, 0.6, now, now).run();
      const created = await db.prepare('SELECT * FROM character_reference_assets WHERE id = ?').bind(id).first<any>();
      return json({ item: mapCharacterReferenceAsset(created) }, 201);
    }

    const imageMatch = path.match(/^\/api\/character-references\/([^/]+)\/image$/);
    if (imageMatch && method === 'GET') {
      const row = await db.prepare('SELECT original_key, original_type FROM character_reference_assets WHERE id = ?')
        .bind(decodeURIComponent(imageMatch[1])).first<any>();
      if (!row) return error('角色参考图不存在', 404);
      const object = await env.BUCKET.get(row.original_key);
      if (!object) return error('角色参考图文件不存在', 404);
      return new Response(object.body, { headers: {
        'Content-Type': row.original_type || 'image/png',
        'Cache-Control': 'private, max-age=31536000, immutable',
        'ETag': object.httpEtag,
      }});
    }

    const thumbnailMatch = path.match(/^\/api\/character-references\/([^/]+)\/thumbnail$/);
    if (thumbnailMatch && method === 'GET') {
      const row = await db.prepare(`SELECT thumbnail_key, thumbnail_type, original_key, original_type
        FROM character_reference_assets WHERE id = ?`)
        .bind(decodeURIComponent(thumbnailMatch[1])).first<any>();
      if (!row) return error('角色参考图不存在', 404);
      const key = row.thumbnail_key || row.original_key;
      const object = await env.BUCKET.get(key);
      if (!object) return error('角色参考图缩略图文件不存在', 404);
      return new Response(object.body, { headers: {
        'Content-Type': row.thumbnail_key ? (row.thumbnail_type || 'image/webp') : (row.original_type || 'image/png'),
        'Cache-Control': 'private, max-age=31536000, immutable',
        'ETag': object.httpEtag,
      }});
    }

    const archiveMatch = path.match(/^\/api\/character-references\/([^/]+)\/(archive|restore)$/);
    if (archiveMatch && method === 'POST') {
      const id = decodeURIComponent(archiveMatch[1]);
      const existing = await db.prepare('SELECT id FROM character_reference_assets WHERE id = ?').bind(id).first<any>();
      if (!existing) return error('角色参考图不存在', 404);
      await db.prepare('UPDATE character_reference_assets SET archived = ?, updated_at = ? WHERE id = ?')
        .bind(archiveMatch[2] === 'archive' ? 1 : 0, Date.now(), id).run();
      return json({ success: true });
    }

    const assetMatch = path.match(/^\/api\/character-references\/([^/]+)$/);
    if (assetMatch && method === 'GET') {
      const row = await db.prepare('SELECT * FROM character_reference_assets WHERE id = ?')
        .bind(decodeURIComponent(assetMatch[1])).first<any>();
      if (!row) return error('角色参考图不存在', 404);
      return json({ item: mapCharacterReferenceAsset(row) });
    }
    if (assetMatch && method === 'PUT') {
      const id = decodeURIComponent(assetMatch[1]);
      const existing = await db.prepare('SELECT * FROM character_reference_assets WHERE id = ?').bind(id).first<any>();
      if (!existing) return error('角色参考图不存在', 404);
      const body = await request.json() as any;
      const name = String(body.name || '').trim().slice(0, 100);
      if (!name) return error('角色参考图名称不能为空', 400);
      const requestedStrength = body.defaultStrength === undefined
        ? Number(existing.default_strength ?? 0.6)
        : Number(body.defaultStrength);
      if (!Number.isFinite(requestedStrength) || requestedStrength < -1 || requestedStrength > 2) {
        return error('默认强度必须在 -1 到 2 之间', 400);
      }
      const requestedFidelity = body.defaultFidelity === undefined
        ? Number(existing.default_fidelity ?? 0.6)
        : Number(body.defaultFidelity);
      if (!Number.isFinite(requestedFidelity) || requestedFidelity < -1 || requestedFidelity > 2) {
        return error('默认保真度必须在 -1 到 2 之间', 400);
      }
      await db.prepare(`UPDATE character_reference_assets
        SET name = ?, default_strength = ?, default_fidelity = ?, updated_at = ? WHERE id = ?`)
        .bind(name, requestedStrength, requestedFidelity, Date.now(), id).run();
      const updated = await db.prepare('SELECT * FROM character_reference_assets WHERE id = ?').bind(id).first<any>();
      return json({ item: mapCharacterReferenceAsset(updated) });
    }

    return error('角色参考图接口不存在', 404);
  }

  // --- Permanent Vibe Transfer library ---
  if (path.startsWith('/api/vibes') || path.startsWith('/api/vibe-groups')) {
    if (!env.BUCKET) return error('Vibe 本地存储不可用', 503);
    await ensureVibeSchema(db);

    if (path === '/api/vibes' && method === 'GET') {
      const includeArchived = url.searchParams.get('archived') === 'true';
      const query = String(url.searchParams.get('q') || '').trim();
      const rows = query
        ? await db.prepare(`SELECT * FROM vibe_assets WHERE archived = ? AND LOWER(name) LIKE ? ORDER BY updated_at DESC`)
            .bind(includeArchived ? 1 : 0, `%${query.toLowerCase()}%`).all<any>()
        : await db.prepare('SELECT * FROM vibe_assets WHERE archived = ? ORDER BY updated_at DESC')
            .bind(includeArchived ? 1 : 0).all<any>();
      const vibeIds = rows.results.map(row => row.id);
      const encodingsByVibe = new Map<string, any[]>();
      for (let offset = 0; offset < vibeIds.length; offset += 80) {
        const batchIds = vibeIds.slice(offset, offset + 80);
        const placeholders = batchIds.map(() => '?').join(',');
        const encodings = await db.prepare(`SELECT * FROM vibe_encodings WHERE vibe_id IN (${placeholders}) ORDER BY information_extracted DESC`)
          .bind(...batchIds).all<any>();
        for (const encoding of encodings.results) {
          const grouped = encodingsByVibe.get(encoding.vibe_id) || [];
          grouped.push(encoding);
          encodingsByVibe.set(encoding.vibe_id, grouped);
        }
      }
      return json({ items: await Promise.all(rows.results.map(row => mapVibeAsset(db, row, encodingsByVibe.get(row.id) || []))) });
    }

    if (path === '/api/vibes' && method === 'POST') {
      const multipart = request.headers.get('Content-Type')?.includes('multipart/form-data');
      const form = multipart ? await request.formData() : null;
      const body = multipart ? { name: String(form?.get('name') || '') } : await request.json() as any;
      let parsed;
      try { parsed = multipart ? await parseUploadedImage(form?.get('image') || null) : parseImageData(body.imageData); } catch (e: any) { return error(e.message, 400); }
      const sourceHash = await sha256Hex(parsed.bytes);
      const existing = await db.prepare('SELECT * FROM vibe_assets WHERE source_hash = ?').bind(sourceHash).first<any>();
      if (existing) {
        if (existing.archived === 1) {
          await db.prepare('UPDATE vibe_assets SET archived = 0, updated_at = ? WHERE id = ?').bind(Date.now(), existing.id).run();
          existing.archived = 0;
        }
        return json({ item: await mapVibeAsset(db, existing), duplicate: true });
      }
      const id = crypto.randomUUID();
      const now = Date.now();
      const key = `vibes/originals/${id}.${parsed.format}`;
      await env.BUCKET.put(key, exactArrayBuffer(parsed.bytes), { httpMetadata: { contentType: parsed.contentType } });
      let thumbnailKey: string | null = null;
      let thumbnailType: string | null = null;
      if (multipart ? form?.get('thumbnail') instanceof File : body.thumbnailData) {
        try {
          const thumbnail = multipart
            ? await parseUploadedImage(form?.get('thumbnail') || null, 2 * 1024 * 1024)
            : parseImageData(body.thumbnailData);
          if (thumbnail.bytes.length <= 2 * 1024 * 1024) {
            thumbnailKey = `vibes/thumbnails/${id}.${thumbnail.format}`;
            thumbnailType = thumbnail.contentType;
            await env.BUCKET.put(thumbnailKey, exactArrayBuffer(thumbnail.bytes), { httpMetadata: { contentType: thumbnailType } });
          }
        } catch { /* The original remains usable if thumbnail creation failed. */ }
      }
      await db.prepare(`INSERT INTO vibe_assets
        (id, name, source_hash, original_key, original_type, thumbnail_key, thumbnail_type, default_strength, archived, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
        .bind(id, String(body.name || `Vibe ${sourceHash.slice(0, 8)}`).slice(0, 100), sourceHash, key, parsed.contentType, thumbnailKey, thumbnailType, 0.6, now, now).run();
      const row = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(id).first<any>();
      return json({ item: await mapVibeAsset(db, row) }, 201);
    }

    if (path === '/api/vibes/import' && method === 'POST') {
      const body = await request.json() as any;
      let document: any;
      try { document = typeof body.fileText === 'string' ? JSON.parse(body.fileText) : body.document; } catch { return error('Vibe 文件不是有效 JSON', 400); }
      if (document?.identifier !== 'novelai-vibe-transfer' || Number(document?.version) !== 1 || !document?.encodings || typeof document.encodings !== 'object') {
        return error('不是有效的 .naiv4vibe 文件', 400);
      }
      let original: {bytes: Uint8Array, format: string, contentType: string} | null = null;
      let thumbnail: {bytes: Uint8Array, format: string, contentType: string} | null = null;
      if (document.image) {
        const raw = String(document.image).replace(/^data:image\/[^;]+;base64,/i, '');
        try {
          const bytes = base64ToBytes(raw);
          const prefix = bytes[0] === 0x89 ? 'png' : bytes[0] === 0xff ? 'jpeg' : String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP' ? 'webp' : '';
          if (!prefix) throw new Error();
          original = parseImageData(`data:image/${prefix};base64,${raw}`);
        } catch { return error('Vibe 文件中的原图无效', 400); }
      }
      if (document.thumbnail) {
        try {
          thumbnail = parseImageData(String(document.thumbnail));
          if (thumbnail.bytes.length > 2 * 1024 * 1024) return error('Vibe 文件中的缩略图过大', 400);
        } catch { return error('Vibe 文件中的缩略图无效', 400); }
      }
      const actualSourceHash = original ? await sha256Hex(original.bytes) : '';
      const declaredSourceHash = String(document.id || actualSourceHash).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(declaredSourceHash)) return error('Vibe 文件缺少有效的图片标识', 400);
      if (actualSourceHash && declaredSourceHash !== actualSourceHash) {
        // st-chatu8 and some official-compatible exporters hash the Base64 text,
        // while NAI Atelier hashes the decoded image bytes. Accept both,
        // then keep the byte hash as the canonical deduplication key.
        const rawImage = String(document.image).replace(/^data:image\/[^;]+;base64,/i, '');
        const textHashes = new Set([
          await sha256Hex(new TextEncoder().encode(rawImage)),
          await sha256Hex(new TextEncoder().encode(String(document.image))),
        ]);
        if (!textHashes.has(declaredSourceHash)) return error('Vibe 文件的原图哈希不匹配', 400);
      }
      const sourceHash = actualSourceHash || declaredSourceHash;
      let asset = await db.prepare('SELECT * FROM vibe_assets WHERE source_hash = ?').bind(sourceHash).first<any>();
      const id = asset?.id || crypto.randomUUID();
      const now = Date.now();
      // 先校验再落库：全新 Vibe 若没有任何可用编码，直接 400 返回，
      // 避免先插入资产行/原图/缩略图后校验失败留下零编码脏数据
      const pendingEncodings: { model: string; modelKey: string; information: number; bytes: Uint8Array }[] = [];
      for (const [modelKey, variants] of Object.entries(document.encodings as Record<string, any>)) {
        if (!variants || typeof variants !== 'object') continue;
        const model = modelKey === 'v4-5full' ? VIBE_MODEL : String(document.importInfo?.model || modelKey);
        for (const variant of Object.values(variants as Record<string, any>)) {
          const information = Number((variant as any)?.params?.information_extracted);
          const encoding = String((variant as any)?.encoding || '');
          if (!Number.isFinite(information) || information < 0 || information > 1 || !/^[A-Za-z0-9+/=]+$/.test(encoding)) continue;
          const bytes = base64ToBytes(encoding);
          if (bytes.length < 64 || bytes.length > 12 * 1024 * 1024) continue;
          pendingEncodings.push({ model, modelKey, information, bytes });
        }
      }
      if (!asset && !pendingEncodings.length) return error('Vibe 文件中没有可用编码', 400);
      if (!asset) {
        let originalKey: string | null = null;
        let originalType: string | null = null;
        let thumbnailKey: string | null = null;
        let thumbnailType: string | null = null;
        if (original) {
          originalKey = `vibes/originals/${id}.${original.format}`;
          originalType = original.contentType;
          await env.BUCKET.put(originalKey, exactArrayBuffer(original.bytes), { httpMetadata: { contentType: originalType } });
        }
        if (thumbnail) {
          thumbnailKey = `vibes/thumbnails/${id}.${thumbnail.format}`;
          thumbnailType = thumbnail.contentType;
          await env.BUCKET.put(thumbnailKey, exactArrayBuffer(thumbnail.bytes), { httpMetadata: { contentType: thumbnailType } });
        }
        await db.prepare(`INSERT INTO vibe_assets
          (id, name, source_hash, original_key, original_type, thumbnail_key, thumbnail_type, default_strength, archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
          .bind(id, String(document.name || `Vibe ${sourceHash.slice(0, 8)}`).slice(0, 100), sourceHash, originalKey, originalType, thumbnailKey, thumbnailType,
            Math.max(0, Math.min(1, Number(document.importInfo?.strength ?? 0.6))), now, now).run();
      }
      let imported = 0;
      for (const item of pendingEncodings) {
        const exists = await db.prepare('SELECT id FROM vibe_encodings WHERE vibe_id = ? AND model = ? AND information_extracted = ?')
          .bind(id, item.model, item.information).first<any>();
        if (exists) continue;
        const encodingId = crypto.randomUUID();
        const encodingKey = `vibes/encodings/${id}/${encodingId}.bin`;
        const encodingHash = await sha256Hex(item.bytes);
        await env.BUCKET.put(encodingKey, exactArrayBuffer(item.bytes), { httpMetadata: { contentType: 'application/octet-stream' } });
        await db.prepare(`INSERT INTO vibe_encodings
          (id, vibe_id, model, model_key, information_extracted, encoding_key, encoding_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(encodingId, id, item.model, item.modelKey, item.information, encodingKey, encodingHash, now).run();
        imported++;
      }
      await db.prepare('UPDATE vibe_assets SET archived = 0, updated_at = ? WHERE id = ?').bind(now, id).run();
      asset = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(id).first<any>();
      return json({ item: await mapVibeAsset(db, asset), imported });
    }

    const imageMatch = path.match(/^\/api\/vibes\/([^/]+)\/image$/);
    if (imageMatch && method === 'GET') {
      const row = await db.prepare('SELECT original_key, original_type FROM vibe_assets WHERE id = ?').bind(decodeURIComponent(imageMatch[1])).first<any>();
      if (!row?.original_key) return error('Vibe 原图不存在', 404);
      const object = await env.BUCKET.get(row.original_key);
      if (!object) return error('Vibe 原图文件不存在', 404);
      return new Response(object.body, { headers: { 'Content-Type': row.original_type || 'image/png', 'Cache-Control': 'private, max-age=3600' } });
    }

    const thumbnailMatch = path.match(/^\/api\/vibes\/([^/]+)\/thumbnail$/);
    if (thumbnailMatch && method === 'GET') {
      const row = await db.prepare('SELECT thumbnail_key, thumbnail_type, original_key, original_type FROM vibe_assets WHERE id = ?').bind(decodeURIComponent(thumbnailMatch[1])).first<any>();
      const key = row?.thumbnail_key || row?.original_key;
      if (!key) return error('Vibe 缩略图不存在', 404);
      const object = await env.BUCKET.get(key);
      if (!object) return error('Vibe 缩略图文件不存在', 404);
      return new Response(object.body, { headers: { 'Content-Type': row.thumbnail_key ? (row.thumbnail_type || 'image/webp') : (row.original_type || 'image/png'), 'Cache-Control': 'private, max-age=3600' } });
    }

    const assetMatch = path.match(/^\/api\/vibes\/([^/]+)$/);
    if (assetMatch && method === 'GET') {
      const row = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(decodeURIComponent(assetMatch[1])).first<any>();
      if (!row) return error('Vibe 不存在', 404);
      return json({ item: await mapVibeAsset(db, row) });
    }
    if (assetMatch && method === 'PUT') {
      const vibeId = decodeURIComponent(assetMatch[1]);
      const body = await request.json() as any;
      const name = String(body.name || '').trim().slice(0, 100);
      if (!name) return error('Vibe 名称不能为空', 400);
      // NaN 会穿透 Math.min/Math.max 直接 bind 抛错，先归一为有限数
      const rawStrength = Number(body.defaultStrength ?? 0.6);
      const defaultStrength = Math.max(0, Math.min(1, Number.isFinite(rawStrength) ? rawStrength : 0.6));
      await db.prepare('UPDATE vibe_assets SET name = ?, default_strength = ?, updated_at = ? WHERE id = ?')
        .bind(name, defaultStrength, Date.now(), vibeId).run();
      const updated = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(vibeId).first<any>();
      if (!updated) return error('Vibe 不存在', 404);
      return json({ item: await mapVibeAsset(db, updated) });
    }

    const resultMatch = path.match(/^\/api\/vibes\/([^/]+)\/encoding-result$/);
    if (resultMatch && method === 'POST') {
      const vibeId = decodeURIComponent(resultMatch[1]);
      const body = await request.json() as any;
      const information = Math.round(Number(body.informationExtracted) * 100) / 100;
      if (!Number.isFinite(information) || information < 0 || information > 1) return error('信息提取量必须在 0 到 1 之间', 400);
      const asset = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(vibeId).first<any>();
      if (!asset) return error('Vibe 不存在', 404);
      const existing = await db.prepare('SELECT * FROM vibe_encodings WHERE vibe_id = ? AND model = ? AND information_extracted = ?')
        .bind(vibeId, VIBE_MODEL, information).first<any>();
      if (existing) return json({ item: await mapVibeAsset(db, asset), duplicate: true });
      let bytes: Uint8Array;
      try { bytes = base64ToBytes(String(body.encodingBase64 || '')); } catch { return error('编码数据无效', 400); }
      if (bytes.length < 64 || bytes.length > 12 * 1024 * 1024) return error('NovelAI 返回的编码大小异常', 400);
      const encodingId = crypto.randomUUID();
      const key = `vibes/encodings/${vibeId}/${encodingId}.bin`;
      const hash = await sha256Hex(bytes);
      await env.BUCKET.put(key, exactArrayBuffer(bytes), { httpMetadata: { contentType: 'application/octet-stream' } });
      await db.prepare(`INSERT INTO vibe_encodings
        (id, vibe_id, model, model_key, information_extracted, encoding_key, encoding_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(encodingId, vibeId, VIBE_MODEL, VIBE_MODEL_KEY, information, key, hash, Date.now()).run();
      await db.prepare('UPDATE vibe_assets SET updated_at = ? WHERE id = ?').bind(Date.now(), vibeId).run();
      const updated = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(vibeId).first<any>();
      return json({ item: await mapVibeAsset(db, updated) });
    }

    const encodingDataMatch = path.match(/^\/api\/vibes\/([^/]+)\/encodings\/([^/]+)\/data$/);
    if (encodingDataMatch && method === 'GET') {
      const vibeId = decodeURIComponent(encodingDataMatch[1]);
      const encodingId = decodeURIComponent(encodingDataMatch[2]);
      const row = await db.prepare('SELECT * FROM vibe_encodings WHERE id = ? AND vibe_id = ?').bind(encodingId, vibeId).first<any>();
      if (!row) return error('Vibe 编码不存在', 404);
      const object = await env.BUCKET.get(row.encoding_key);
      if (!object) return error('Vibe 编码文件不存在', 404);
      const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
      return json({ encoding: bytesToBase64(bytes), variant: mapVibeEncoding(row) });
    }

    const fileMatch = path.match(/^\/api\/vibes\/([^/]+)\/file$/);
    if (fileMatch && method === 'GET') {
      const vibeId = decodeURIComponent(fileMatch[1]);
      const asset = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(vibeId).first<any>();
      if (!asset) return error('Vibe 不存在', 404);
      const rows = await db.prepare('SELECT * FROM vibe_encodings WHERE vibe_id = ? ORDER BY created_at').bind(vibeId).all<any>();
      const encodings: Record<string, Record<string, any>> = {};
      for (const row of rows.results) {
        const object = await env.BUCKET.get(row.encoding_key);
        if (!object) continue;
        const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
        const paramsKey = await sha256Hex(new TextEncoder().encode(`information_extracted:${Number(row.information_extracted)}`));
        encodings[row.model_key] ||= {};
        encodings[row.model_key][paramsKey] = { encoding: bytesToBase64(bytes), params: { information_extracted: Number(row.information_extracted) } };
      }
      let image: string | undefined;
      let thumbnail: string | undefined;
      if (asset.original_key) {
        const object = await env.BUCKET.get(asset.original_key);
        if (object) image = bytesToBase64(new Uint8Array(await new Response(object.body).arrayBuffer()));
      }
      if (asset.thumbnail_key) {
        const object = await env.BUCKET.get(asset.thumbnail_key);
        if (object) thumbnail = `data:${asset.thumbnail_type || 'image/webp'};base64,${bytesToBase64(new Uint8Array(await new Response(object.body).arrayBuffer()))}`;
      }
      const preferred = rows.results.find(row => row.model === VIBE_MODEL) || rows.results[0];
      const document = {
        identifier: 'novelai-vibe-transfer', version: 1, type: 'image', image,
        id: asset.source_hash, encodings, name: asset.name, thumbnail,
        createdAt: Number(asset.created_at),
        importInfo: { model: preferred?.model || VIBE_MODEL, information_extracted: Number(preferred?.information_extracted ?? 1), strength: Number(asset.default_strength ?? 0.6) },
      };
      return new Response(JSON.stringify(document), { headers: {
        'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${asset.name}.naiv4vibe`)}`,
        'Cache-Control': 'private, no-store',
      }});
    }

    const archiveMatch = path.match(/^\/api\/vibes\/([^/]+)\/(archive|restore)$/);
    if (archiveMatch && method === 'POST') {
      await db.prepare('UPDATE vibe_assets SET archived = ?, updated_at = ? WHERE id = ?')
        .bind(archiveMatch[2] === 'archive' ? 1 : 0, Date.now(), decodeURIComponent(archiveMatch[1])).run();
      return json({ success: true });
    }

    if (path === '/api/vibe-groups' && method === 'GET') {
      const rows = await db.prepare('SELECT * FROM vibe_groups ORDER BY updated_at DESC').all<any>();
      return json({ items: rows.results.map(row => ({ id: row.id, name: row.name, slots: parseStoredJson(row.slots, []), normalizeStrengths: row.normalize_strengths === 1, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) })) });
    }
    if (path === '/api/vibe-groups' && method === 'POST') {
      const body = await request.json() as any;
      const submittedSlots = Array.isArray(body.slots) ? body.slots : [];
      if (submittedSlots.length > 16) return error('一个 Vibe 组合最多包含 16 个 Vibe', 400);
      const slots = submittedSlots;
      if (!slots.length) return error('组合至少需要一个 Vibe', 400);
      const id = crypto.randomUUID(); const now = Date.now();
      await db.prepare('INSERT INTO vibe_groups (id, name, slots, normalize_strengths, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, String(body.name || '未命名组合').slice(0, 100), JSON.stringify(slots), body.normalizeStrengths === false ? 0 : 1, now, now).run();
      return json({ item: { id, name: String(body.name || '未命名组合').slice(0, 100), slots, normalizeStrengths: body.normalizeStrengths !== false, createdAt: now, updatedAt: now } }, 201);
    }
    const groupMatch = path.match(/^\/api\/vibe-groups\/([^/]+)$/);
    if (groupMatch && method === 'PUT') {
      const body = await request.json() as any;
      const submittedSlots = Array.isArray(body.slots) ? body.slots : [];
      if (submittedSlots.length > 16) return error('一个 Vibe 组合最多包含 16 个 Vibe', 400);
      const slots = submittedSlots;
      await db.prepare('UPDATE vibe_groups SET name = ?, slots = ?, normalize_strengths = ?, updated_at = ? WHERE id = ?')
        .bind(String(body.name || '未命名组合').slice(0, 100), JSON.stringify(slots), body.normalizeStrengths === false ? 0 : 1, Date.now(), decodeURIComponent(groupMatch[1])).run();
      return json({ success: true });
    }
    if (groupMatch && method === 'DELETE') {
      await db.prepare('DELETE FROM vibe_groups WHERE id = ?').bind(decodeURIComponent(groupMatch[1])).run();
      return json({ success: true });
    }
  }

  return null;
}
