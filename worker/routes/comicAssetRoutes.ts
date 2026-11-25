import { comicBookKeyPrefix } from '../../services/comic/comicBookshelf';
import { error, json, MAX_MANAGED_IMAGE_BYTES, parseStoredJson, type RouteContext } from './types';

export type ComicCustomAssetKind = 'bubble' | 'image';

export interface ComicCustomAssetPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ComicCustomAssetRecord {
  id: string;
  kind: ComicCustomAssetKind;
  name: string;
  url: string;
  r2Key: string;
  mimeType: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  textPadding?: ComicCustomAssetPadding;
  createdAt: number;
  updatedAt?: number;
}

export const COMIC_ASSET_MAX_COUNT = 300;
const SAFE_ASSET_ID_RE = /^[a-zA-Z0-9_-]{4,80}$/;

export const comicAssetsSettingsKey = (userId: string) => `comic_assets_v1:${userId}`;

const clampPaddingValue = (value: unknown, fallback = 0.14): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.max(0.02, Math.min(0.42, n)) * 1000) / 1000;
};

export const normalizeAssetPadding = (raw: unknown): ComicCustomAssetPadding | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  return {
    top: clampPaddingValue(obj.top),
    right: clampPaddingValue(obj.right),
    bottom: clampPaddingValue(obj.bottom),
    left: clampPaddingValue(obj.left),
  };
};

const stripDangerousSvgContent = (svgSource: string): string => {
  let cleaned = svgSource
    .replace(/^\uFEFF/, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<foreignObject\b[^>]*\/>/gi, '')
    .replace(/<(iframe|object|embed|applet)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(iframe|object|embed|applet)\b[^>]*\/>/gi, '');

  // 移除所有 on* 事件属性与危险 URI（javascript: / vbscript: / data:text/html）
  cleaned = cleaned
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\b(href|xlink:href|src)\s*=\s*(["'])\s*(?:javascript:|vbscript:|data:text\/html)[\s\S]*?\2/gi, '$1=$2#$2');

  return cleaned.trim();
};

export const detectAndSanitizeComicAsset = (
  bytes: Uint8Array,
  filename = '',
  contentTypeHeader = '',
): { bytes: Uint8Array; mimeType: string; ext: string } => {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) {
    throw Object.assign(new Error('图片内容为空或格式无效'), { status: 400 });
  }
  if (bytes.byteLength > MAX_MANAGED_IMAGE_BYTES) {
    throw Object.assign(
      new Error(`图片体积超过 ${Math.round(MAX_MANAGED_IMAGE_BYTES / 1024 / 1024)} MB 上限`),
      { status: 413 },
    );
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A（完整保留 Alpha 透明通道）
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { bytes, mimeType: 'image/png', ext: 'png' };
  }

  // WebP: RIFF....WEBP（支持无损与透明通道）
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { bytes, mimeType: 'image/webp', ext: 'webp' };
  }

  // GIF: GIF87a / GIF89a（保留透明底与动图）
  if (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) {
    return { bytes, mimeType: 'image/gif', ext: 'gif' };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { bytes, mimeType: 'image/jpeg', ext: 'jpg' };
  }

  // SVG: 文本包含 <svg 根标签（同时兼容带 <?xml 头的导出文件）
  const looksLikeSvg = /\.svg$/i.test(filename)
    || contentTypeHeader.toLowerCase().includes('svg')
    || bytes[0] === 0x3c;
  if (looksLikeSvg) {
    const rawText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const trimmed = rawText.replace(/^\uFEFF/, '').trimStart();
    if (/^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(trimmed)) {
      const sanitized = stripDangerousSvgContent(rawText);
      if (!/<svg[\s>][\s\S]*<\/svg>/i.test(sanitized) && !/<svg[^>]*\/>/i.test(sanitized)) {
        throw Object.assign(new Error('SVG 文件结构不完整'), { status: 400 });
      }
      return {
        bytes: new TextEncoder().encode(sanitized),
        mimeType: 'image/svg+xml',
        ext: 'svg',
      };
    }
  }

  throw Object.assign(new Error('仅支持 PNG / WebP / GIF / JPG / SVG 图片'), { status: 400 });
};

const readStoredAssets = async (context: RouteContext): Promise<ComicCustomAssetRecord[]> => {
  const key = comicAssetsSettingsKey(context.currentUser.id);
  const row = await context.db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  const parsed = parseStoredJson(row?.value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is ComicCustomAssetRecord => (
    Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.url === 'string')
  ));
};

const writeStoredAssets = async (context: RouteContext, assets: ComicCustomAssetRecord[]): Promise<void> => {
  const key = comicAssetsSettingsKey(context.currentUser.id);
  await context.db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(assets))
    .run();
};

const decodeHeaderText = (raw: string | null, fallback = ''): string => {
  if (!raw) return fallback;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const parseOptionalDimension = (raw: string | null): number | undefined => {
  if (!raw) return undefined;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n > 0 && n <= 16384 ? n : undefined;
};

/** 清理素材名称：去掉扩展名、空白折叠、限制 48 字。 */
const sanitizeAssetName = (rawName: string, fallback: string): string => {
  const clean = rawName
    .replace(/\.(png|webp|gif|jpe?g|svg)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  return clean || fallback;
};

/**
 * 检查素材 URL 是否仍被用户已保存的漫画书架页面引用。
 * 若仍在被引用，删除素材库目录项时保留 R2 实体，避免旧作品打不开图片。
 */
const isAssetReferencedByComicBooks = async (context: RouteContext, assetUrl: string): Promise<boolean> => {
  const prefix = comicBookKeyPrefix(context.currentUser.id);
  const rows = await context.db
    .prepare('SELECT value FROM settings WHERE key >= ? AND key < ?')
    .bind(prefix, `${prefix}\uffff`)
    .all<{ value: string }>();
  for (const row of rows.results || []) {
    if (typeof row.value === 'string' && row.value.includes(assetUrl)) {
      return true;
    }
  }
  return false;
};

/**
 * 漫画自定义素材库（自定义气泡底图、透明底贴纸/网点/叠加图片）D1 + R2 路由。
 */
export async function handleComicAssetRoute(context: RouteContext): Promise<Response | null> {
  const { path, method, request, url, env, currentUser } = context;
  const isCollection = path === '/api/comic-assets';
  const itemMatch = path.match(/^\/api\/comic-assets\/([^/]+)$/);
  if (!isCollection && !itemMatch) return null;
  if (currentUser.role === 'guest') return error('访客无法管理漫画素材库', 403);

  if (isCollection) {
    if (method === 'GET') {
      const kindFilter = url.searchParams.get('kind');
      const assets = await readStoredAssets(context);
      const filtered = kindFilter === 'bubble' || kindFilter === 'image'
        ? assets.filter(item => item.kind === kindFilter)
        : assets;
      return json({ assets: filtered });
    }

    if (method === 'POST') {
      if (!env.BUCKET) return error('R2 存储尚未配置', 503);

      const rawKind = request.headers.get('X-Asset-Kind') || 'image';
      if (rawKind !== 'bubble' && rawKind !== 'image') {
        return error('素材分类必须是 bubble 或 image', 400);
      }
      const kind: ComicCustomAssetKind = rawKind;

      const filename = decodeHeaderText(request.headers.get('X-Asset-Filename'), 'asset.png');
      const customName = decodeHeaderText(request.headers.get('X-Asset-Name'), '');
      const width = parseOptionalDimension(request.headers.get('X-Asset-Width'));
      const height = parseOptionalDimension(request.headers.get('X-Asset-Height'));

      const rawBuffer = new Uint8Array(await request.arrayBuffer());
      let verified: { bytes: Uint8Array; mimeType: string; ext: string };
      try {
        verified = detectAndSanitizeComicAsset(
          rawBuffer,
          filename,
          request.headers.get('Content-Type') || '',
        );
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : '无效的图片文件';
        const status = (cause as { status?: number })?.status || 400;
        return error(msg, status);
      }

      const existing = await readStoredAssets(context);
      if (existing.length >= COMIC_ASSET_MAX_COUNT) {
        return error(`自定义素材库已达 ${COMIC_ASSET_MAX_COUNT} 条上限，请先清理闲置素材`, 400);
      }

      const id = `ca_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
      const r2Key = `comic-assets/${currentUser.id}/${id}.${verified.ext}`;
      const assetUrl = `/api/assets/${r2Key}`;
      const name = sanitizeAssetName(
        customName || filename,
        kind === 'bubble' ? '自定义气泡' : '自定义图片',
      );
      const now = Date.now();

      await env.BUCKET.put(r2Key, verified.bytes.buffer as ArrayBuffer, {
        httpMetadata: { contentType: verified.mimeType },
      });

      const record: ComicCustomAssetRecord = {
        id,
        kind,
        name,
        url: assetUrl,
        r2Key,
        mimeType: verified.mimeType,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        sizeBytes: verified.bytes.byteLength,
        createdAt: now,
        updatedAt: now,
      };
      const next = [record, ...existing];
      await writeStoredAssets(context, next);
      return json({ asset: record, assets: next });
    }

    return error('Method not allowed', 405);
  }

  const assetId = decodeURIComponent(itemMatch![1]);
  if (!SAFE_ASSET_ID_RE.test(assetId)) {
    return error('素材 ID 无效', 400);
  }

  if (method === 'PATCH') {
    const rawBody = await request.text();
    let payload: { name?: unknown; textPadding?: unknown };
    try {
      payload = JSON.parse(rawBody || '{}');
    } catch {
      return error('请求体必须是有效的 JSON', 400);
    }

    const existing = await readStoredAssets(context);
    const target = existing.find(item => item.id === assetId);
    if (!target) return error('未找到对应的素材', 404);

    let nextName = target.name;
    if (payload.name !== undefined) {
      const cleaned = String(payload.name || '').replace(/\s+/g, ' ').trim().slice(0, 48);
      if (!cleaned) return error('素材名称不能为空', 400);
      nextName = cleaned;
    }

    const nextPadding = payload.textPadding !== undefined
      ? normalizeAssetPadding(payload.textPadding)
      : target.textPadding;

    const updatedRecord: ComicCustomAssetRecord = {
      ...target,
      name: nextName,
      ...(nextPadding ? { textPadding: nextPadding } : {}),
      updatedAt: Date.now(),
    };
    const nextList = existing.map(item => (item.id === assetId ? updatedRecord : item));
    await writeStoredAssets(context, nextList);
    return json({ asset: updatedRecord, assets: nextList });
  }

  if (method === 'DELETE') {
    const existing = await readStoredAssets(context);
    const target = existing.find(item => item.id === assetId);
    if (!target) return error('未找到对应的素材', 404);

    const nextList = existing.filter(item => item.id !== assetId);
    await writeStoredAssets(context, nextList);

    let keptReferencedFile = false;
    if (env.BUCKET && target.r2Key) {
      const referenced = await isAssetReferencedByComicBooks(context, target.url);
      if (referenced) {
        keptReferencedFile = true;
      } else {
        await env.BUCKET.delete(target.r2Key).catch(() => {});
      }
    }

    return json({ deleted: assetId, keptReferencedFile, assets: nextList });
  }

  return error('Method not allowed', 405);
}
