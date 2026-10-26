// Vibe Transfer library + character reference library routes and image helpers.
// Moved verbatim from worker/index.ts during the domain split; behavior unchanged.
import { readImageDimensions } from '../imageDimensions.mjs';
import { VIBE_MODELS, defaultVibeInformation, vibeBaseModel, vibeModelKey, vibeParameterKey } from '../../services/vibeProtocol.mjs';
import { json, error, addColumnIfMissing, parseStoredJson, type D1Database, type Env, type RouteContext } from './types';

// 进程内标记：DDL 幂等但昂贵，同一实例只在首个请求跑一次。
const vibeSchemaEnsured = new WeakSet<object>();
export async function ensureVibeSchema(db: D1Database) {
  if (vibeSchemaEnsured.has(db)) return;
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
    'ALTER TABLE vibe_assets ADD COLUMN source_type TEXT',
    'ALTER TABLE vibe_assets ADD COLUMN import_info TEXT',
    'ALTER TABLE vibe_encodings ADD COLUMN parameters TEXT',
    'ALTER TABLE vibe_encodings ADD COLUMN information_known INTEGER NOT NULL DEFAULT 1',
  ]) {
    await addColumnIfMissing(db, statement);
  }
  // 旧表的三列唯一约束不能容纳 mask 或未知参数；新变体另存，旧行及文件保持原样。
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS vibe_encoding_variants (
      id TEXT PRIMARY KEY, vibe_id TEXT NOT NULL, model TEXT NOT NULL, model_key TEXT NOT NULL,
      information_extracted REAL NOT NULL, encoding_key TEXT NOT NULL, encoding_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, parameters TEXT, information_known INTEGER NOT NULL DEFAULT 1,
      parameter_key TEXT NOT NULL, UNIQUE(vibe_id, model, parameter_key)
    )`),
    db.prepare(`CREATE VIEW IF NOT EXISTS vibe_encodings_all AS
      SELECT id, vibe_id, model, model_key, information_extracted, encoding_key, encoding_hash, created_at, parameters, information_known FROM vibe_encodings
      UNION ALL
      SELECT id, vibe_id, model, model_key, information_extracted, encoding_key, encoding_hash, created_at, parameters, information_known FROM vibe_encoding_variants`),
  ]);
  vibeSchemaEnsured.add(db);
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
  await addColumnIfMissing(db, 'ALTER TABLE character_reference_assets ADD COLUMN default_fidelity REAL NOT NULL DEFAULT 0.6');
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
const hashVibeText = (value: string) => sha256Hex(new TextEncoder().encode(value));

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
  model: VIBE_MODELS[row.model_key] || row.model,
  modelKey: row.model_key,
  informationExtracted: Number(row.information_extracted),
  informationKnown: row.information_known !== 0,
  parameters: row.parameters ? parseStoredJson(row.parameters, null) : row.information_known === 0 ? null : { information_extracted: Number(row.information_extracted) },
  encodingHash: row.encoding_hash,
  createdAt: Number(row.created_at),
});

async function mapVibeAsset(db: D1Database, row: any, preloadedEncodings?: any[]) {
  const encodings = preloadedEncodings || (await db.prepare('SELECT * FROM vibe_encodings_all WHERE vibe_id = ? ORDER BY information_extracted DESC')
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
    sourceType: row.source_type || (row.original_key ? 'image' : 'encoding'),
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

async function prepareVibeDocument(document: any) {
  if (document?.identifier !== 'novelai-vibe-transfer' || document.version !== 1 || !document.encodings || Array.isArray(document.encodings)
    || typeof document.encodings !== 'object' || !['image', 'encoding', undefined].includes(document.type)) throw new Error('不是有效的 .naiv4vibe 文件');
  const image = document.image ? String(document.image).replace(/^data:image\/[^;]+;base64,/i, '') : '';
  let original: ReturnType<typeof parseImageData> | null = null;
  if (image) {
    const bytes = base64ToBytes(image);
    const format = bytes[0] === 0x89 ? 'png' : bytes[0] === 0xff ? 'jpeg' : 'webp';
    original = parseImageData(`data:image/${format};base64,${image}`);
  }
  const thumbnail = document.thumbnail ? parseImageData(String(document.thumbnail)) : null;
  if (thumbnail && thumbnail.bytes.length > 2 * 1024 * 1024) throw new Error('Vibe 文件中的缩略图过大');
  const declared = String(document.id || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(declared)) throw new Error('Vibe 文件缺少有效的图片标识');
  const sourceHash = original ? await sha256Hex(original.bytes) : declared;
  if (original && ![sourceHash, await hashVibeText(image), await hashVibeText(String(document.image))].includes(declared)) throw new Error('Vibe 文件的原图哈希不匹配');
  const encodings: { model: string; modelKey: string; information: number; known: boolean; parameters: Record<string, unknown> | null; bytes: Uint8Array; hash: string; text: string }[] = [];
  for (const [modelKey, variants] of Object.entries(document.encodings as Record<string, any>)) {
    if (!variants || typeof variants !== 'object' || Array.isArray(variants)) throw new Error('Vibe 编码列表无效');
    for (const variant of Object.values(variants) as any[]) {
      const text = variant?.encoding;
      if (typeof text !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('Vibe 编码数据无效');
      const bytes = base64ToBytes(text);
      if (bytes.length < 64 || bytes.length > 12 * 1024 * 1024) throw new Error('Vibe 编码大小异常');
      const parameters = variant.params ?? null;
      if (parameters !== null && (typeof parameters !== 'object' || Array.isArray(parameters))) throw new Error('Vibe 编码参数无效');
      const known = parameters?.information_extracted != null;
      const model = VIBE_MODELS[modelKey] || modelKey;
      const information = known ? parameters.information_extracted : document.importInfo?.information_extracted ?? defaultVibeInformation(model);
      if (typeof information !== 'number' || !Number.isFinite(information) || information < 0 || information > 1) throw new Error('信息提取量必须在 0 到 1 之间');
      encodings.push({ model, modelKey, information, known, parameters, bytes, hash: await sha256Hex(bytes), text });
    }
  }
  if (!encodings.length) throw new Error('Vibe 文件中没有可用编码');
  if (document.type === 'encoding' && await hashVibeText(encodings[0].text) !== declared) throw new Error('Vibe 文件的编码哈希不匹配');
  const strength = document.importInfo?.strength ?? 0.6;
  if (typeof strength !== 'number' || !Number.isFinite(strength)) throw new Error('Vibe 强度必须是有限数值');
  return { document, original, thumbnail, sourceHash, encodings, strength };
}

async function storeVibeDocument(db: D1Database, env: Env, prepared: Awaited<ReturnType<typeof prepareVibeDocument>>) {
  const { document, original, thumbnail, sourceHash, encodings, strength } = prepared;
  let asset = await db.prepare('SELECT * FROM vibe_assets WHERE source_hash = ?').bind(sourceHash).first<any>();
  const id = asset?.id || crypto.randomUUID(), now = Date.now();
  const statements = [];
  const existing = asset ? (await db.prepare('SELECT * FROM vibe_encodings_all WHERE vibe_id = ?').bind(id).all<any>()).results : [];
  let imported = 0;
  for (const item of encodings) {
    const parameterKey = vibeParameterKey(item.parameters);
    const previous = existing.find(row => mapVibeEncoding(row).model === item.model && vibeParameterKey(mapVibeEncoding(row).parameters) === parameterKey);
    if (previous) {
      if (previous.encoding_hash !== item.hash) {
        throw new Error('已有 Vibe 编码与导入文件冲突，已保留原编码');
      }
      continue;
    }
    const encodingId = crypto.randomUUID(), key = `vibes/encodings/${id}/${encodingId}.bin`;
    await env.BUCKET!.put(key, exactArrayBuffer(item.bytes), { httpMetadata: { contentType: 'application/octet-stream' } });
    statements.push(db.prepare(`INSERT INTO vibe_encoding_variants
      (id, vibe_id, model, model_key, information_extracted, encoding_key, encoding_hash, created_at, parameters, information_known, parameter_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(encodingId, id, item.model, item.modelKey, item.information, key, item.hash, now,
      item.parameters === null ? null : JSON.stringify(item.parameters), item.known ? 1 : 0, parameterKey));
    existing.push({ id: encodingId, model: item.model, information_extracted: item.information, encoding_hash: item.hash,
      parameters: item.parameters === null ? null : JSON.stringify(item.parameters), information_known: item.known ? 1 : 0 });
    imported++;
  }
  let originalKey = asset?.original_key || null, thumbnailKey = asset?.thumbnail_key || null;
  if (original && !originalKey) {
    originalKey = `vibes/originals/${id}.${original.format}`;
    await env.BUCKET!.put(originalKey, exactArrayBuffer(original.bytes), { httpMetadata: { contentType: original.contentType } });
  }
  if (thumbnail && !thumbnailKey) {
    thumbnailKey = `vibes/thumbnails/${id}.${thumbnail.format}`;
    await env.BUCKET!.put(thumbnailKey, exactArrayBuffer(thumbnail.bytes), { httpMetadata: { contentType: thumbnail.contentType } });
  }
  if (!asset) statements.unshift(db.prepare(`INSERT INTO vibe_assets
    (id, name, source_hash, original_key, original_type, thumbnail_key, thumbnail_type, default_strength, archived, created_at, updated_at, source_type, import_info)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`).bind(id, String(document.name || `Vibe ${sourceHash.slice(0, 8)}`).slice(0, 100),
    sourceHash, originalKey, original?.contentType || null, thumbnailKey, thumbnail?.contentType || null, strength, now, now,
    document.type || (original ? 'image' : 'encoding'), JSON.stringify(document.importInfo || {})));
  else statements.push(db.prepare(`UPDATE vibe_assets SET archived = 0, updated_at = ?, original_key = ?, original_type = COALESCE(original_type, ?),
    thumbnail_key = ?, thumbnail_type = COALESCE(thumbnail_type, ?) WHERE id = ?`).bind(now, originalKey, original?.contentType || null, thumbnailKey, thumbnail?.contentType || null, id));
  await db.batch(statements);
  asset = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(id).first<any>();
  const item = await mapVibeAsset(db, asset);
  const info = document.importInfo || {};
  const requestedParameters = { information_extracted: info.information_extracted, ...(info.mask ? { mask: info.mask } : {}) };
  const encoding = item.encodings.find((variant: any) => variant.model === vibeBaseModel(info.model)
    && vibeParameterKey(variant.parameters) === vibeParameterKey(requestedParameters))
    || item.encodings.find((variant: any) => variant.model === vibeBaseModel(info.model)) || item.encodings[0];
  return { item, imported, slot: { vibeId: id, vibeName: item.name, encodingId: encoding.id,
    informationExtracted: encoding.informationExtracted, informationKnown: encoding.informationKnown, strength } };
}

async function exportVibeDocuments(db: D1Database, env: Env, id: string, selection?: any) {
  const asset = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(id).first<any>();
  if (!asset) throw new Error('Vibe 不存在');
  const rows = (await db.prepare('SELECT * FROM vibe_encodings_all WHERE vibe_id = ? ORDER BY created_at').bind(id).all<any>()).results;
  if (!rows.length) throw new Error('Vibe 尚无编码');
  const preferred = selection ? rows.find(row => row.id === selection.encodingId) : rows[0];
  if (!preferred) throw new Error('组合中的 Vibe 编码缺失');
  const imageObject = asset.original_key ? await env.BUCKET!.get(asset.original_key) : null;
  if (asset.original_key && !imageObject) throw new Error('Vibe 原图文件不存在');
  const image = imageObject ? bytesToBase64(new Uint8Array(await new Response(imageObject.body).arrayBuffer())) : undefined;
  const thumbnailObject = asset.thumbnail_key ? await env.BUCKET!.get(asset.thumbnail_key) : null;
  const thumbnail = thumbnailObject ? `data:${asset.thumbnail_type};base64,${bytesToBase64(new Uint8Array(await new Response(thumbnailObject.body).arrayBuffer()))}` : undefined;
  const encodings: Record<string, Record<string, any>> = Object.create(null);
  const documents = [];
  for (const row of rows) {
    if (!image && selection && row.id !== preferred.id) continue;
    const object = await env.BUCKET!.get(row.encoding_key);
    if (!object) throw new Error('Vibe 编码文件不存在');
    const encoding = bytesToBase64(new Uint8Array(await new Response(object.body).arrayBuffer()));
    const variant = mapVibeEncoding(row), params = variant.parameters;
    const info = { model: variant.model, information_extracted: variant.informationExtracted, strength: selection?.strength ?? Number(asset.default_strength ?? 0.6), ...(params?.mask ? { mask: params.mask } : {}) };
    if (!image) documents.push({ identifier: 'novelai-vibe-transfer', version: 1, type: 'encoding', id: await hashVibeText(encoding),
      encodings: { [row.model_key]: { unknown: { encoding, ...(params ? { params } : {}) } } }, name: asset.name, createdAt: Number(asset.created_at), importInfo: info });
    else {
      const paramsKey = params ? await hashVibeText(vibeParameterKey(params)) : 'unknown';
      (encodings[row.model_key] ||= Object.create(null))[paramsKey] = { encoding, ...(params ? { params } : {}) };
    }
  }
  if (image) documents.push({ identifier: 'novelai-vibe-transfer', version: 1, type: 'image', image, thumbnail, id: await hashVibeText(image),
    encodings, name: asset.name, createdAt: Number(asset.created_at), importInfo: { model: mapVibeEncoding(preferred).model,
      information_extracted: Number(preferred.information_extracted), strength: selection?.strength ?? Number(asset.default_strength ?? 0.6),
      ...(mapVibeEncoding(preferred).parameters?.mask ? { mask: mapVibeEncoding(preferred).parameters!.mask } : {}) } });
  return documents;
}

async function validatedVibeSlots(db: D1Database, slots: any[]) {
  const result = [];
  for (const slot of slots) {
    if (typeof slot?.strength !== 'number' || !Number.isFinite(slot.strength)) throw new Error('Vibe 强度必须是有限数值');
    const row = await db.prepare(`SELECT e.*, a.name FROM vibe_encodings_all e JOIN vibe_assets a ON a.id = e.vibe_id WHERE e.id = ? AND e.vibe_id = ?`)
      .bind(String(slot.encodingId || ''), String(slot.vibeId || '')).first<any>();
    if (!row) throw new Error('组合中的 Vibe 编码缺失，请重新选择');
    const variant = mapVibeEncoding(row);
    result.push({ vibeId: row.vibe_id, vibeName: String(slot.vibeName || row.name), encodingId: row.id,
      informationExtracted: variant.informationExtracted, informationKnown: variant.informationKnown, strength: slot.strength });
  }
  return result;
}

// 包括禁用中的参考及嵌套模板；这里只返回引用来源，不读取或修改配置正文。
const vibeReferenceDocuments = `
  SELECT '风格串' AS source, params AS document, 1 AS requires_json FROM chains
  UNION ALL SELECT '历史', params, 1 FROM local_generation_history
  UNION ALL SELECT '收藏', params, 1 FROM inspirations
  UNION ALL SELECT '收藏', analysis, 1 FROM inspirations
  UNION ALL SELECT '组合', slots, 1 FROM vibe_groups
  UNION ALL SELECT '设置或模板', value, substr(ltrim(value), 1, 1) IN ('{', '[') FROM settings
  UNION ALL SELECT '风格串图片', json_quote(preview_image), 0 FROM chains
  UNION ALL SELECT '收藏图片', json_quote(image_url), 0 FROM inspirations
  UNION ALL SELECT '画师图片', json_quote(image_url), 0 FROM artists
  UNION ALL SELECT '画师图片', json_quote(preview_url), 0 FROM artists
  UNION ALL SELECT '画师图片', benchmarks, 1 FROM artists`;
const malformedVibeReferenceDocument = `d.requires_json = 1 AND d.document IS NOT NULL AND trim(d.document) <> '' AND
  (NOT json_valid(d.document) OR json_type(CASE WHEN json_valid(d.document) THEN d.document ELSE 'null' END) NOT IN ('object', 'array', 'null'))`;
const vibeReferenceQuery = `
  WITH target AS (SELECT ? AS vibe_id, ? AS encoding_id), documents AS (${vibeReferenceDocuments}),
  target_encodings AS (SELECT e.id FROM vibe_encodings_all e, target t
    WHERE e.vibe_id = t.vibe_id AND (t.encoding_id IS NULL OR e.id = t.encoding_id)),
  reference_urls AS (
    SELECT '/api/vibes/' || vibe_id || '/image' AS url FROM target WHERE encoding_id IS NULL
    UNION ALL SELECT '/api/vibes/' || vibe_id || '/thumbnail' FROM target WHERE encoding_id IS NULL
    UNION ALL SELECT '/api/vibes/' || t.vibe_id || '/encodings/' || e.id || '/data' FROM target t, target_encodings e
  )
  SELECT d.source, 1 AS unreadable FROM documents d WHERE ${malformedVibeReferenceDocument}
  UNION ALL
  SELECT d.source, 0 AS unreadable FROM documents d, json_tree(CASE WHEN json_valid(d.document) THEN d.document ELSE '{}' END) n, target t
  WHERE (n.key = 'vibeId' AND n.atom = t.vibe_id AND (t.encoding_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM vibe_encodings_all e WHERE e.vibe_id = t.vibe_id AND e.id <> t.encoding_id
        AND e.id = json_extract(CASE WHEN json_valid(d.document) THEN d.document ELSE '{}' END, n.path || '.encodingId'))))
    OR (n.key = 'encodingId' AND n.atom IN (SELECT id FROM target_encodings))
    OR (n.type = 'text' AND EXISTS(SELECT 1 FROM reference_urls r WHERE n.atom = r.url OR
      (substr(n.atom, 1, length(r.url)) = r.url AND substr(n.atom, length(r.url) + 1, 1) IN ('?', '#'))))
  LIMIT 1`;

async function deleteUnreferencedVibeFiles(db: D1Database, env: Env, keys: string[]) {
  for (const key of new Set(keys.filter(Boolean))) {
    const urls = [...new Set([`/api/assets/${key}`, `/api/assets/${encodeURIComponent(key)}`, `/api/assets/${key.split('/').map(encodeURIComponent).join('/')}`])];
    const reference = await db.prepare(`WITH target AS (SELECT ? AS object_key, ? AS urls),
      documents AS (${vibeReferenceDocuments}), pointers AS (
        SELECT original_key AS object_key FROM vibe_assets UNION ALL SELECT thumbnail_key FROM vibe_assets
        UNION ALL SELECT encoding_key FROM vibe_encodings_all
        UNION ALL SELECT original_key FROM character_reference_assets UNION ALL SELECT thumbnail_key FROM character_reference_assets
        UNION ALL SELECT image_key FROM local_generation_history UNION ALL SELECT image_key FROM inspirations
      ) SELECT EXISTS(SELECT 1 FROM pointers p, target t WHERE p.object_key = t.object_key) OR
        EXISTS(SELECT 1 FROM documents d WHERE ${malformedVibeReferenceDocument}) OR
        EXISTS(SELECT 1 FROM documents d, json_tree(CASE WHEN json_valid(d.document) THEN d.document ELSE '{}' END) n, target t
          WHERE n.type = 'text' AND (n.atom = t.object_key OR EXISTS(SELECT 1 FROM json_each(t.urls) u WHERE n.atom = u.value OR
            (substr(n.atom, 1, length(u.value)) = u.value AND substr(n.atom, length(u.value) + 1, 1) IN ('?', '#'))))) AS referenced`)
      .bind(key, JSON.stringify(urls)).first<{ referenced: number }>();
    if (!reference) throw new Error('无法核对 Vibe 文件引用');
    if (!reference.referenced) await env.BUCKET!.delete(key);
  }
}

async function permanentlyDeleteVibe(db: D1Database, env: Env, vibeId: string, encodingId?: string) {
  const asset = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(vibeId).first<any>();
  if (!asset) return error('Vibe 不存在', 404);
  if (asset.archived !== 1) return error('请先归档 Vibe，再永久删除', 409);
  const encodings = (await db.prepare('SELECT * FROM vibe_encodings_all WHERE vibe_id = ?').bind(vibeId).all<any>()).results;
  const selected = encodingId ? encodings.filter(row => row.id === encodingId) : encodings;
  if (encodingId && !selected.length) return error('Vibe 编码不存在', 404);
  const referenceArgs = [vibeId, encodingId || null];
  const where = encodingId ? 'vibe_id = ? AND id = ?' : 'vibe_id = ?';
  const rowArgs = encodingId ? [vibeId, encodingId] : [vibeId];
  // 引用校验与删除在同一事务中执行，迟到的持久引用不能穿过前置检查。
  const guard = `EXISTS(SELECT 1 FROM vibe_assets WHERE id = ? AND archived = 1) AND NOT EXISTS(${vibeReferenceQuery})`;
  const statements = ['vibe_encodings', 'vibe_encoding_variants'].map(table =>
    db.prepare(`DELETE FROM ${table} WHERE ${where} AND ${guard}`).bind(...rowArgs, vibeId, ...referenceArgs));
  statements.push(encodingId
    ? db.prepare(`UPDATE vibe_assets SET updated_at = ? WHERE id = ? AND archived = 1
        AND NOT EXISTS(SELECT 1 FROM vibe_encodings_all WHERE id = ? AND vibe_id = ?)`)
      .bind(Date.now(), vibeId, encodingId, vibeId)
    : db.prepare(`DELETE FROM vibe_assets WHERE id = ? AND archived = 1 AND NOT EXISTS(${vibeReferenceQuery})`).bind(vibeId, ...referenceArgs));
  const results = await db.batch(statements);
  const deleted = encodingId ? Number(results[0].meta.changes) + Number(results[1].meta.changes) : Number(results[2].meta.changes);
  if (!deleted) {
    const reference = await db.prepare(vibeReferenceQuery).bind(...referenceArgs).first<{ source: string; unreadable: number }>();
    if (reference?.unreadable) return error(`${reference.source}资料损坏，无法核对 Vibe 引用，未执行删除`, 409);
    return error(reference ? `这个 Vibe${encodingId ? ' 编码' : ''}仍被${reference.source}引用，不能永久删除` : 'Vibe 状态已变化，请刷新后重试', 409);
  }
  try {
    await deleteUnreferencedVibeFiles(db, env, [...(encodingId ? [] : [asset.original_key, asset.thumbnail_key]), ...selected.map(row => row.encoding_key)]);
  } catch { return error('Vibe 记录已删除，但部分文件清理失败', 503); }
  if (!encodingId) return json({ success: true, id: vibeId });
  const updated = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(vibeId).first<any>();
  return json({ success: true, item: await mapVibeAsset(db, updated), encodingId });
}

// Precise/Character Reference image library + Permanent Vibe Transfer library.
export async function handleVibeRoute(ctx: RouteContext): Promise<Response | null> {
  const { request, env, url, path, method, db } = ctx;

  // --- Precise/Character Reference image library ---
  if (path.startsWith('/api/character-references')) {
    if (!env.BUCKET) return error('精准参考图本地存储不可用', 503);
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

      const name = String(body.name || `精准参考 ${sourceHash.slice(0, 8)}`).trim().slice(0, 100)
        || `精准参考 ${sourceHash.slice(0, 8)}`;
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
      if (!row) return error('精准参考图不存在', 404);
      const object = await env.BUCKET.get(row.original_key);
      if (!object) return error('精准参考图文件不存在', 404);
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
      if (!row) return error('精准参考图不存在', 404);
      const key = row.thumbnail_key || row.original_key;
      const object = await env.BUCKET.get(key);
      if (!object) return error('精准参考图缩略图文件不存在', 404);
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
      if (!existing) return error('精准参考图不存在', 404);
      await db.prepare('UPDATE character_reference_assets SET archived = ?, updated_at = ? WHERE id = ?')
        .bind(archiveMatch[2] === 'archive' ? 1 : 0, Date.now(), id).run();
      return json({ success: true });
    }

    const assetMatch = path.match(/^\/api\/character-references\/([^/]+)$/);
    if (assetMatch && method === 'GET') {
      const row = await db.prepare('SELECT * FROM character_reference_assets WHERE id = ?')
        .bind(decodeURIComponent(assetMatch[1])).first<any>();
      if (!row) return error('精准参考图不存在', 404);
      return json({ item: mapCharacterReferenceAsset(row) });
    }
    if (assetMatch && method === 'PUT') {
      const id = decodeURIComponent(assetMatch[1]);
      const existing = await db.prepare('SELECT * FROM character_reference_assets WHERE id = ?').bind(id).first<any>();
      if (!existing) return error('精准参考图不存在', 404);
      const body = await request.json() as any;
      const name = String(body.name || '').trim().slice(0, 100);
      if (!name) return error('精准参考图名称不能为空', 400);
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

    return error('精准参考图接口不存在', 404);
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
        const encodings = await db.prepare(`SELECT * FROM vibe_encodings_all WHERE vibe_id IN (${placeholders}) ORDER BY information_extracted DESC`)
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
        if (!existing.original_key) {
          const key = `vibes/originals/${existing.id}.${parsed.format}`;
          await env.BUCKET.put(key, exactArrayBuffer(parsed.bytes), { httpMetadata: { contentType: parsed.contentType } });
          await db.prepare('UPDATE vibe_assets SET original_key = ?, original_type = ?, source_type = ?, updated_at = ? WHERE id = ?')
            .bind(key, parsed.contentType, 'image', Date.now(), existing.id).run();
          existing.original_key = key;
          existing.original_type = parsed.contentType;
          existing.source_type = 'image';
        }
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
      try {
        const document = typeof body.fileText === 'string' ? JSON.parse(body.fileText) : body.document;
        const bundle = document?.identifier === 'novelai-vibe-transfer-bundle';
        if (bundle && (document.version !== 1 || !Array.isArray(document.vibes) || !document.vibes.length || document.vibes.length > 16)) return error('Vibe 组合必须包含 1 到 16 项', 400);
        // 整份文件先校验；损坏的末项不能让前面的资料被部分导入。
        const prepared = await Promise.all((bundle ? document.vibes : [document]).map(prepareVibeDocument));
        const results = [];
        for (const entry of prepared) results.push(await storeVibeDocument(db, env, entry));
        const slots = results.map(result => result.slot);
        return json({ item: results[0].item, items: results.map(result => result.item), slots, bundle,
          normalizeStrengths: typeof document.normalizeStrengths === 'boolean' ? document.normalizeStrengths : slots.reduce((sum, slot) => sum + Math.abs(slot.strength), 0) <= 1.01,
          imported: results.reduce((sum, result) => sum + result.imported, 0) });
      } catch (cause) { return error(cause instanceof Error ? cause.message : 'Vibe 文件无效', 400); }
    }

    if (path === '/api/vibes/export' && method === 'POST') {
      const body = await request.json() as any;
      if (!Array.isArray(body.slots) || !body.slots.length || body.slots.length > 16) return error('Vibe 组合必须包含 1 到 16 项', 400);
      try {
        const vibes = [];
        for (const slot of body.slots) {
          if (typeof slot.strength !== 'number' || !Number.isFinite(slot.strength)) return error('Vibe 强度必须是有限数值', 400);
          vibes.push(...await exportVibeDocuments(db, env, String(slot.vibeId), slot));
        }
        return json({ identifier: 'novelai-vibe-transfer-bundle', version: 1, vibes, normalizeStrengths: body.normalizeStrengths !== false });
      } catch (cause) { return error(cause instanceof Error ? cause.message : '导出失败', 400); }
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
    if (assetMatch && method === 'DELETE') return permanentlyDeleteVibe(db, env, decodeURIComponent(assetMatch[1]));
    if (assetMatch && method === 'PUT') {
      const vibeId = decodeURIComponent(assetMatch[1]);
      const body = await request.json() as any;
      const name = String(body.name || '').trim().slice(0, 100);
      if (!name) return error('Vibe 名称不能为空', 400);
      // NaN 会穿透 Math.min/Math.max 直接 bind 抛错，先归一为有限数
      const rawStrength = Number(body.defaultStrength ?? 0.6);
      if (!Number.isFinite(rawStrength)) return error('Vibe 强度必须是有限数值', 400);
      const defaultStrength = rawStrength;
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
      const information = Number(body.informationExtracted);
      const model = vibeBaseModel(body.model);
      const modelKey = vibeModelKey(model);
      if (!modelKey) return error('当前模型没有已知 Vibe 编码格式', 400);
      if (!Number.isFinite(information) || information < 0 || information > 1) return error('信息提取量必须在 0 到 1 之间', 400);
      const asset = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(vibeId).first<any>();
      if (!asset) return error('Vibe 不存在', 404);
      let bytes: Uint8Array;
      try { bytes = base64ToBytes(String(body.encodingBase64 || '')); } catch { return error('编码数据无效', 400); }
      if (bytes.length < 64 || bytes.length > 12 * 1024 * 1024) return error('NovelAI 返回的编码大小异常', 400);
      const parameters = { information_extracted: information }, parameterKey = vibeParameterKey(parameters);
      const existing = (await db.prepare('SELECT * FROM vibe_encodings_all WHERE vibe_id = ?').bind(vibeId).all<any>()).results
        .find(row => mapVibeEncoding(row).model === model && vibeParameterKey(mapVibeEncoding(row).parameters) === parameterKey);
      const hash = await sha256Hex(bytes);
      if (existing) {
        if (existing.encoding_hash !== hash) return error('已有 Vibe 编码与返回结果冲突，已保留原编码', 409);
        return json({ item: await mapVibeAsset(db, asset), duplicate: true });
      }
      const encodingId = crypto.randomUUID();
      const key = `vibes/encodings/${vibeId}/${encodingId}.bin`;
      await env.BUCKET.put(key, exactArrayBuffer(bytes), { httpMetadata: { contentType: 'application/octet-stream' } });
      await db.prepare(`INSERT INTO vibe_encoding_variants
        (id, vibe_id, model, model_key, information_extracted, encoding_key, encoding_hash, created_at, parameters, information_known, parameter_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
        .bind(encodingId, vibeId, model, modelKey, information, key, hash, Date.now(), JSON.stringify(parameters), parameterKey).run();
      await db.prepare('UPDATE vibe_assets SET updated_at = ? WHERE id = ?').bind(Date.now(), vibeId).run();
      const updated = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(vibeId).first<any>();
      return json({ item: await mapVibeAsset(db, updated) });
    }

    const encodingDataMatch = path.match(/^\/api\/vibes\/([^/]+)\/encodings\/([^/]+)\/data$/);
    if (encodingDataMatch && method === 'GET') {
      const vibeId = decodeURIComponent(encodingDataMatch[1]);
      const encodingId = decodeURIComponent(encodingDataMatch[2]);
      const row = await db.prepare('SELECT * FROM vibe_encodings_all WHERE id = ? AND vibe_id = ?').bind(encodingId, vibeId).first<any>();
      if (!row) return error('Vibe 编码不存在', 404);
      const object = await env.BUCKET.get(row.encoding_key);
      if (!object) return error('Vibe 编码文件不存在', 404);
      const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
      return json({ encoding: bytesToBase64(bytes), variant: mapVibeEncoding(row) });
    }
    const encodingMatch = path.match(/^\/api\/vibes\/([^/]+)\/encodings\/([^/]+)$/);
    if (encodingMatch && method === 'DELETE') return permanentlyDeleteVibe(db, env, decodeURIComponent(encodingMatch[1]), decodeURIComponent(encodingMatch[2]));

    const fileMatch = path.match(/^\/api\/vibes\/([^/]+)\/file$/);
    if (fileMatch && method === 'GET') {
      try {
        const documents = await exportVibeDocuments(db, env, decodeURIComponent(fileMatch[1]));
        const document = documents.length === 1 ? documents[0] : { identifier: 'novelai-vibe-transfer-bundle', version: 1, vibes: documents };
        const extension = documents.length === 1 ? 'naiv4vibe' : 'naiv4vibeBundle';
        return new Response(JSON.stringify(document), { headers: {
          'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${documents[0].name}.${extension}`)}`,
          'Cache-Control': 'private, no-store',
        }});
      } catch (cause) { return error(cause instanceof Error ? cause.message : '导出失败', 400); }
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
      let slots;
      try { slots = await validatedVibeSlots(db, submittedSlots); } catch (cause) { return error(cause instanceof Error ? cause.message : '组合配置无效', 400); }
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
      let slots;
      try { slots = await validatedVibeSlots(db, submittedSlots); } catch (cause) { return error(cause instanceof Error ? cause.message : '组合配置无效', 400); }
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
