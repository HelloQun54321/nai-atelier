import { parseNovelAIMetadata } from '../../services/metadataService';
import { extractPngMetadata, hasCollectibleNaiMetadata } from '../../services/pngMetadata.mjs';
import { readImageDimensions } from '../imageDimensions.mjs';
import { UNTESTED_CHAIN_TAG } from '../../services/chainStatus';
import { prepareCollectedPrompt } from '../../services/collectedPrompt';
import { json, error, MAX_MANAGED_IMAGE_BYTES, parseStoredJson, type RouteContext } from './types';

const SESSION_KEY = 'style_collector_session_v1';
const POSITION_KEY = 'style_collector_position_v1';

function collectedMetadata(raw: string, mappings: unknown) {
  const parsed = parseNovelAIMetadata(raw, undefined, mappings as Parameters<typeof parseNovelAIMetadata>[2]);
  try {
    const source = JSON.parse(raw);
    if (source.v4_prompt?.caption) parsed.prompt = source.v4_prompt.caption.base_caption || '';
    else parsed.prompt = typeof source.prompt === 'string' ? source.prompt : '';
    parsed.negativePrompt = source.v4_negative_prompt?.caption?.base_caption ?? source.uc ?? '';
    parsed.params.qualityToggle = false; parsed.params.ucPreset = 4;
  } catch { /* 旧文本保持现有导入语义。 */ }
  return parsed;
}

/** 仅网关内部调用；网关禁止浏览器直通此命名空间。无需迁移表或改动存储键。 */
export async function handleStyleCollectorRoute(ctx: RouteContext): Promise<Response | null> {
  const { path, request, db, env, currentUser, method } = ctx;
  if (!path.startsWith('/api/internal/style-collector/')) return null;
  if (request.headers.get('x-nai-collector-control') !== 'true' || !['127.0.0.1', '::1'].includes(request.headers.get('x-nai-client-ip') || '')) return error('Forbidden', 403);
  if (path.endsWith('/position')) {
    if (method === 'GET') {
      const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(POSITION_KEY).first<{ value: string }>();
      return json(parseStoredJson(row?.value, {}));
    }
    if (method !== 'POST') return error('Method not allowed', 405);
    const body = await request.json() as { x?: number; y?: number; collapsed?: boolean };
    if (!Number.isFinite(body.x) || !Number.isFinite(body.y)) return error('Invalid position', 400);
    await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(POSITION_KEY, JSON.stringify({ x: body.x, y: body.y, collapsed: body.collapsed === true })).run();
    return json({ success: true });
  }
  if (method !== 'POST') return error('Method not allowed', 405);
  const body = await request.json() as any;
  if (path.endsWith('/session')) {
    const session = typeof body.session === 'string' ? body.session : '';
    if (session && !/^[a-f0-9-]{36}$/.test(session)) return error('Invalid session', 400);
    await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(SESSION_KEY, session).run();
    return json({ success: true });
  }
  const isActive = async () => (await db.prepare('SELECT value FROM settings WHERE key = ?').bind(SESSION_KEY).first<{ value: string }>())?.value === body.session;
  if (!body.session || !await isActive()) return error('收集已结束', 409);
  if (path.endsWith('/text')) {
    if (!/^[a-f0-9-]{36}$/.test(String(body.id || ''))) return error('Invalid collection ID', 400);
    let data;
    try { data = prepareCollectedPrompt(body.text, body.name, body.category); } catch (e) { return error((e as Error).message, 400); }
    const id = `collected-${body.id}`;
    const now = Date.now();
    const result = await db.prepare(`INSERT INTO chains (id, user_id, username, type, name, description, tags, preview_image, base_prompt, negative_prompt, modules, params, variable_values, guest_hidden, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, '', '[]', NULL, ?, '', '[]', ?, '{}', 0, ?, ?
      WHERE EXISTS (SELECT 1 FROM settings WHERE key = ? AND value = ?) AND NOT EXISTS (SELECT 1 FROM chains WHERE id = ?)`)
      .bind(id, currentUser.id, currentUser.username, data.type, data.name, data.basePrompt, JSON.stringify(data.params), now, now, SESSION_KEY, body.session, id).run();
    if (!Number(result.meta?.changes)) {
      const existing = await db.prepare('SELECT user_id, base_prompt, type, params FROM chains WHERE id = ?').bind(id).first<{ user_id: string; base_prompt: string; type: string; params: string }>();
      if (!existing || existing.user_id !== currentUser.id || existing.base_prompt !== data.basePrompt || existing.type !== data.type
        || parseStoredJson(existing.params, {})._collectedCategory !== (data.params as unknown as Record<string, unknown>)._collectedCategory) return error('收集已结束或记录冲突', 409);
    }
    return json({ outcome: 'saved', id });
  }
  const collection = path.endsWith('/collection');
  if ((!path.endsWith('/import') && !collection) || !env.BUCKET) return error('Collector storage unavailable', 503);
  if (typeof body.image !== 'string' || body.image.length > Math.ceil(MAX_MANAGED_IMAGE_BYTES * 4 / 3) + 4) return error('图片超过存储大小上限', 413);
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(body.image), c => c.charCodeAt(0)); } catch { return error('Invalid image', 400); }
  if (bytes.byteLength > MAX_MANAGED_IMAGE_BYTES) return error('图片超过存储大小上限', 413);
  if (collection) {
    if (!['png', 'jpeg', 'webp'].includes(body.format)) return error('仅支持 PNG、JPEG、WebP 图片', 400);
    try {
      const size = readImageDimensions(bytes, body.format === 'jpeg' ? 'jpg' : body.format);
      if (size.width * size.height > 40_000_000) return error('图片像素超过上限', 413);
    } catch { return error('图片内容无效', 400); }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)), b => b.toString(16).padStart(2, '0')).join('');
    const mappingKey = `collection_collector_hash_v1:${hash}`;
    const existing = async () => db.prepare('SELECT i.id, i.archived FROM settings s JOIN inspirations i ON i.id = s.value WHERE s.key = ? AND i.user_id = ?').bind(mappingKey, currentUser.id).first<{ id: string; archived: number }>();
    const previous = await existing();
    if (previous) {
      if (!previous.archived) return json({ outcome: 'skipped', reason: '图片已收藏' });
      const restored = await db.prepare('UPDATE inspirations SET archived = 0, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM settings WHERE key = ? AND value = ?)').bind(Date.now(), previous.id, SESSION_KEY, body.session).run();
      return Number(restored.meta?.changes) ? json({ outcome: 'saved', id: previous.id }) : error('收集已结束', 409);
    }
    const raw = typeof body.rawMetadata === 'string' && body.rawMetadata.length <= 4 * 1024 * 1024 && hasCollectibleNaiMetadata(body.rawMetadata) ? body.rawMetadata : null;
    const parsed = raw ? collectedMetadata(raw, body.metadataModelMappings) : null;
    const id = crypto.randomUUID(), now = Date.now();
    const key = `inspirations/collector/${crypto.randomUUID()}.${body.format}`;
    const title = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 160) : '剪贴板图片';
    const sourceUrl = typeof body.sourceUrl === 'string' && /^https:\/\//i.test(body.sourceUrl) ? body.sourceUrl : null;
    let committed = false;
    try {
      await env.BUCKET.put(key, bytes.slice().buffer, { httpMetadata: { contentType: `image/${body.format}` } });
      const results = await db.batch([
        db.prepare(`INSERT INTO inspirations (id, user_id, username, title, image_key, image_type, prompt, negative_prompt, params, tags, source_type, source_url, analysis, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'other', ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM settings WHERE key = ? AND value = ?)
          AND NOT EXISTS (SELECT 1 FROM settings s JOIN inspirations i ON i.id = s.value WHERE s.key = ?)`)
          .bind(id, currentUser.id, currentUser.username, title, key, `image/${body.format}`, parsed?.prompt || '', parsed?.negativePrompt || '', parsed ? JSON.stringify(parsed.params) : null, sourceUrl, JSON.stringify({ collectedAt: now, sha256: hash, ...(sourceUrl ? { collectionOriginalUrl: sourceUrl } : {}) }), now, now, SESSION_KEY, body.session, mappingKey),
        db.prepare('INSERT OR REPLACE INTO settings (key, value) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM inspirations WHERE id = ? AND image_key = ?)').bind(mappingKey, id, id, key),
      ]);
      committed = Number(results[0]?.meta?.changes) > 0;
      if (!committed) return await isActive() ? json({ outcome: 'skipped', reason: '图片已收藏' }) : error('收集已结束', 409);
      return json({ outcome: 'saved', id });
    } finally { if (!committed) await env.BUCKET.delete(key); }
  }
  let raw: string | null;
  if (typeof body.rawMetadata === 'string') {
    // 仅内部网关提供已完整解码、CRC 校验的结果；避免 Worker 重复分配数千万像素。
    if (body.rawMetadata.length > 4 * 1024 * 1024) return error('生成信息过大', 413);
    try {
      if (![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return error('Invalid PNG', 400);
      const size = readImageDimensions(bytes, 'png');
      if (size.width * size.height > 40_000_000) return error('图片像素超过上限', 413);
    } catch { return error('Invalid PNG', 400); }
    raw = body.rawMetadata;
  } else {
    raw = await extractPngMetadata(bytes, { validatePixels: true, collectibleOnly: true });
  }
  if (!raw || !hasCollectibleNaiMetadata(raw)) return json({ outcome: 'skipped', reason: '图片没有有效的 NovelAI 生成信息' });
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)), b => b.toString(16).padStart(2, '0')).join('');
  const mappingKey = `style_collector_hash_v1:${hash}`;
  const previous = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(mappingKey).first<{ value: string }>();
  if (previous?.value && await db.prepare('SELECT id FROM chains WHERE id = ?').bind(previous.value).first()) return json({ outcome: 'skipped', reason: '图片已收集' });
  const parsed = collectedMetadata(raw, body.metadataModelMappings);
  const id = crypto.randomUUID();
  const key = `covers/collector/${crypto.randomUUID()}.png`;
  const preview = `/api/assets/${key}`;
  const now = Date.now();
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : `收集 ${new Date(now).toISOString()}`;
  const provenance = JSON.stringify({ source: body.sourceUrl, finalUrl: body.finalUrl, collectedAt: now, sha256: hash, metadata: raw });
  let committed = false;
  try {
    await env.BUCKET.put(key, bytes.slice().buffer, { httpMetadata: { contentType: 'image/png' } });
    // 事务中的条件读取隔离结束与迟到提交；映射跟随同一次事务，不留下空风格串。
    const results = await db.batch([
      db.prepare(`INSERT INTO chains (id, user_id, username, type, name, description, tags, preview_image, base_prompt, negative_prompt, modules, params, variable_values, guest_hidden, created_at, updated_at)
        SELECT ?, ?, ?, 'style', ?, ?, ?, ?, ?, ?, '[]', ?, '{}', 0, ?, ? WHERE EXISTS (SELECT 1 FROM settings WHERE key = ? AND value = ?)
        AND NOT EXISTS (SELECT 1 FROM settings s JOIN chains c ON c.id = s.value WHERE s.key = ?)`)
        .bind(id, currentUser.id, currentUser.username, name, `自动收集原图\n${provenance}`, JSON.stringify([UNTESTED_CHAIN_TAG]), preview, parsed.prompt, parsed.negativePrompt, JSON.stringify(parsed.params), now, now, SESSION_KEY, body.session, mappingKey),
      db.prepare('INSERT OR REPLACE INTO settings (key, value) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM chains WHERE id = ? AND preview_image = ?)')
        .bind(mappingKey, id, id, preview),
    ]);
    committed = Number(results[0]?.meta?.changes) > 0;
    if (!committed) return await isActive() ? json({ outcome: 'skipped', reason: '图片已收集' }) : error('收集已结束', 409);
    return json({ outcome: 'saved', id });
  } finally {
    // 只回滚本次新分配的封面，绝不触及既有资产。
    if (!committed) await env.BUCKET.delete(key);
  }
}
