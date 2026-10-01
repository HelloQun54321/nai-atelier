import { parseNovelAIMetadata } from '../../services/metadataService';
import { extractPngMetadata, hasCollectibleNaiMetadata } from '../../services/pngMetadata.mjs';
import { readImageDimensions } from '../imageDimensions.mjs';
import { UNTESTED_CHAIN_TAG } from '../../services/chainStatus';
import { json, error, MAX_MANAGED_IMAGE_BYTES, parseStoredJson, type RouteContext } from './types';

const SESSION_KEY = 'style_collector_session_v1';
const POSITION_KEY = 'style_collector_position_v1';

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
  if (!path.endsWith('/import') || !env.BUCKET) return error('Collector storage unavailable', 503);
  const isActive = async () => (await db.prepare('SELECT value FROM settings WHERE key = ?').bind(SESSION_KEY).first<{ value: string }>())?.value === body.session;
  if (!body.session || !await isActive()) return error('收集已结束', 409);
  if (typeof body.image !== 'string' || body.image.length > Math.ceil(MAX_MANAGED_IMAGE_BYTES * 4 / 3) + 4) return error('图片超过存储大小上限', 413);
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(body.image), c => c.charCodeAt(0)); } catch { return error('Invalid image', 400); }
  if (bytes.byteLength > MAX_MANAGED_IMAGE_BYTES) return error('图片超过存储大小上限', 413);
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
  const parsed = parseNovelAIMetadata(raw, undefined, body.metadataModelMappings);
  // 空的结构化全局提示词不能被解析器回退为 JSON 字面量。
  try {
    const source = JSON.parse(raw);
    if (source.v4_prompt?.caption) parsed.prompt = source.v4_prompt.caption.base_caption || '';
    else parsed.prompt = typeof source.prompt === 'string' ? source.prompt : '';
    parsed.negativePrompt = source.v4_negative_prompt?.caption?.base_caption ?? source.uc ?? '';
    parsed.params.qualityToggle = false; parsed.params.ucPreset = 4;
  } catch { /* 旧文本保持现有导入语义。 */ }
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
