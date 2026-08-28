// LAN access, anlas budget, admin endpoints, NAI proxy (generate/upload),
// chains and artists CRUD.
// Moved verbatim from worker/index.ts during the domain split; behavior unchanged.
import { LAN_ACCESS_COOKIE } from '../sharedWhitelist.mjs';
import { MEDIA_VARIANTS, validateMediaSource } from '../mediaValidation';
import { json, error, parseStoredJson, MAX_MANAGED_IMAGE_BYTES, type D1Database, type Env, type RouteContext } from './types';

const LAN_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const lanAccessAttempts = new Map<string, { failures: number; blockedUntil: number }>();

export const isLoopbackHostname = (hostname: string) => {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};

export const encodeBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
};

export const signLanAccessValue = async (value: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return encodeBase64Url(new Uint8Array(signature));
};

const createLanAccessToken = async (secret: string) => {
  const expiresAt = Date.now() + LAN_SESSION_MAX_AGE_SECONDS * 1000;
  const nonce = crypto.randomUUID();
  const value = `${expiresAt}.${nonce}`;
  return `${value}.${await signLanAccessValue(value, secret)}`;
};

export const hasValidLanAccess = async (request: Request, secret: string) => {
  if (!secret) return false;
  const token = parseCookies(request)[LAN_ACCESS_COOKIE];
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expiresAt, nonce, signature] = parts;
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Date.now() || !nonce || !signature) return false;
  const expected = await signLanAccessValue(`${expiresAt}.${nonce}`, secret);
  if (expected.length !== signature.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return difference === 0;
};

const getLanAttemptKey = (request: Request) =>
  // CF-Connecting-IP 由 Cloudflare 边缘写入、客户端不可伪造，部署在 CF 上时优先采用；
  // X-Nai-Client-IP 在本地形态下由 media gateway 用 socket 地址覆写（同样可信），
  // 但在 CF 形态下客户端可伪造，故排在 CF-Connecting-IP 之后。
  // 不要把任意客户端提供的 X-Forwarded-For 当作限流主键。
  request.headers.get('CF-Connecting-IP') ||
  request.headers.get('X-Nai-Client-IP') ||
  request.headers.get('X-Forwarded-For')?.split(',').at(-1)?.trim() ||
  request.headers.get('User-Agent') ||
  'lan-device';

export const lanAccessRequired = () => json({ error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' }, 401);

// LAN gate routes run BEFORE the DB is available (original dispatch order).
export async function handleLanRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;
  const isLocalComputer = isLoopbackHostname(url.hostname);

  if (path === '/api/lan/status' && method === 'GET') {
    return json({ required: !isLocalComputer, authorized: isLocalComputer || await hasValidLanAccess(request, env.LAN_ACCESS_SECRET || '') });
  }

  if (path === '/api/lan/unlock' && method === 'POST') {
    if (isLocalComputer) return json({ success: true, authorized: true });
    const configuredPin = String(env.LAN_ACCESS_PIN || '');
    const secret = String(env.LAN_ACCESS_SECRET || '');
    if (!/^\d{4}$/.test(configuredPin) || secret.length < 16) {
      return error('局域网访问密码尚未正确配置，请重新启动电脑端服务', 503);
    }

    const attemptKey = getLanAttemptKey(request);
    const attempt = lanAccessAttempts.get(attemptKey) || { failures: 0, blockedUntil: 0 };
    if (attempt.blockedUntil > Date.now()) {
      return json({ error: '尝试次数过多，请一分钟后再试', code: 'LAN_ACCESS_BLOCKED', retryAfter: Math.ceil((attempt.blockedUntil - Date.now()) / 1000) }, 429);
    }

    const payload = await request.json().catch(() => ({})) as { pin?: string };
    if (!/^\d{4}$/.test(payload.pin || '') || payload.pin !== configuredPin) {
      const failures = attempt.failures + 1;
      const blockedUntil = failures >= 5 ? Date.now() + 60_000 : 0;
      lanAccessAttempts.set(attemptKey, { failures: blockedUntil ? 0 : failures, blockedUntil });
      return json({
        error: blockedUntil ? '连续输错5次，请一分钟后再试' : '密码不正确',
        code: blockedUntil ? 'LAN_ACCESS_BLOCKED' : 'LAN_ACCESS_DENIED',
        attemptsRemaining: blockedUntil ? 0 : 5 - failures,
      }, blockedUntil ? 429 : 401);
    }

    lanAccessAttempts.delete(attemptKey);
    const token = await createLanAccessToken(secret);
    return json({ success: true, authorized: true }, 200, {
      'Set-Cookie': `${LAN_ACCESS_COOKIE}=${token}; Max-Age=${LAN_SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Strict`,
    });
  }

  if (path === '/api/lan/lock' && method === 'POST') {
    return json({ success: true }, 200, {
      'Set-Cookie': `${LAN_ACCESS_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`,
    });
  }

  return null;
}

export async function getLocalOwner(db: D1Database) {
  const savedOwner = await db.prepare("SELECT value FROM settings WHERE key = 'personal_owner_id_v2'")
    .first<{value: string}>();
  let owner = savedOwner?.value
    ? await db.prepare('SELECT id, username, role FROM users WHERE id = ?')
        .bind(savedOwner.value).first<any>()
    : null;

  if (!owner) {
    try {
      owner = await db.prepare(`
        SELECT id, username, role
        FROM users u WHERE role != 'guest'
        ORDER BY
          (SELECT COUNT(*) FROM local_generation_history h WHERE h.user_id = u.id) DESC,
          (SELECT COUNT(*) FROM chains c WHERE c.user_id = u.id) DESC,
          (SELECT COUNT(*) FROM inspirations i WHERE i.user_id = u.id) DESC,
          CASE WHEN role = 'admin' THEN 0 ELSE 1 END,
          created_at ASC
        LIMIT 1
      `).first<any>();
    } catch {
      owner = await db.prepare(`
        SELECT id, username, role
        FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1
      `).first<any>();
    }
  }
  if (!owner) {
    const id = 'local-owner';
    await db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password, role, created_at)
      VALUES (?, 'local', '', 'admin', ?)
    `).bind(id, Date.now()).run();
    owner = await db.prepare('SELECT id, username, role FROM users WHERE id = ?')
      .bind(id).first<any>();
  }
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('personal_owner_id_v2', ?)")
    .bind(owner!.id).run();
  return owner!;
}

export async function removeLegacyLoggingStorage(db: D1Database) {
  const marker = await db.prepare("SELECT value FROM settings WHERE key = 'personal_logging_removed_v1'")
    .first<{value: string}>();
  if (marker?.value === '1') return;
  await db.prepare('DROP TABLE IF EXISTS access_logs').run();
  await db.prepare('DROP TABLE IF EXISTS daily_stats').run();
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('personal_logging_removed_v1', '1')").run();
}

export async function removeLegacyArtistLibrary(env: Env, db: D1Database) {
  const marker = await db.prepare("SELECT value FROM settings WHERE key = 'artist_catalog_local_v2'")
    .first<{value: string}>();
  if (marker?.value === '1') return;
  // This migration used to erase every artist and its R2 assets.  A missing
  // marker is also possible after restoring an older backup, so it must never
  // be interpreted as permission to destroy user data.
  void env;
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('artist_catalog_local_v2', '1')").run();
}

// Constants
const MAX_STORAGE_QUOTA = 300 * 1024 * 1024; // 300MB

// Helper: Parse Cookies
export function parseCookies(request: Request) {
  const cookieHeader = request.headers.get('Cookie');
  const cookies: Record<string, string> = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.split('=').map(c => c.trim());
      cookies[name] = value;
    });
  }
  return cookies;
}

// Helper: 判断是否为缺失列错误（SQLite/D1 不同版本的报错格式）
function isMissingColumnError(e: any): boolean {
  if (!e || !e.message) return false;
  const msg = e.message;
  // SQLite 可能报 'no column named xxx' 或 'no such column: xxx'
  return msg.includes('no column named') || msg.includes('no such column');
}

// Helper: Delete File from R2
export async function deleteR2File(env: Env, url: string) {
    if (!env.BUCKET || !url) return;
    // Check if it is a local API asset URL
    if (url.startsWith('/api/assets/')) {
        const key = url.replace('/api/assets/', '');
        try {
            await env.BUCKET.delete(decodeURIComponent(key));
            console.log(`Deleted old file: ${key}`);
        } catch (e) {
            console.error(`Failed to delete file ${key}`, e);
        }
    }
}

const isPrivateOrLocalImageHost = (hostname: string) => {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') return true;
    if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;
    const octets = ipv4.slice(1).map(Number);
    if (octets.some(value => value > 255)) return true;
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
};

const validateExternalImageUrl = (value: string) => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('外链图片地址无效'); }
    if (url.protocol !== 'https:' || url.username || url.password || isPrivateOrLocalImageHost(url.hostname)) {
        throw new Error('外链图片必须是可公开访问的 HTTPS 图片地址');
    }
    return url;
};

const readLimitedImageBody = async (response: Response) => {
    const advertisedLength = Number(response.headers.get('content-length') || 0);
    if (advertisedLength > MAX_MANAGED_IMAGE_BYTES) throw new Error(`图片不能超过 ${Math.floor(MAX_MANAGED_IMAGE_BYTES / 1024 / 1024)}MB`);
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_MANAGED_IMAGE_BYTES) {
                await reader.cancel();
                throw new Error(`图片不能超过 ${Math.floor(MAX_MANAGED_IMAGE_BYTES / 1024 / 1024)}MB`);
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
};

// Helper: Process Base64 Image and Upload to R2 with Quota Check
export async function processImageUpload(
    env: Env,
    imageData: string,
    folder: string,
    id: string,
    user?: { id: string, role: string }
): Promise<string> {
    if (imageData.startsWith('http') || imageData.startsWith('/api/')) return imageData;

    if (!env.BUCKET) {
        throw new Error("R2 Bucket not configured");
    }

    const matches = imageData.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    if (!matches || matches.length !== 3) {
        throw new Error("Invalid image data format");
    }

    const ext = matches[1].toLowerCase() === 'jpg' ? 'jpeg' : matches[1].toLowerCase();
    const base64Data = matches[2];
    const filename = `${folder}/${id}_${Date.now()}.${ext}`;

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
        const fileSize = bytes.length;
    if (fileSize > MAX_MANAGED_IMAGE_BYTES) {
        throw new Error(`图片不能超过 ${Math.floor(MAX_MANAGED_IMAGE_BYTES / 1024 / 1024)}MB`);
    }

    await env.BUCKET.put(filename, bytes.buffer, {
        httpMetadata: { contentType: `image/${ext}` }
    });

    return `/api/assets/${filename}`;
}

// Helper: Fetch External Image URL and Upload to R2
export async function fetchAndUploadImage(
    env: Env,
    imageUrl: string,
    folder: string,
    id: string,
    user?: { id: string, role: string }
): Promise<string> {
    if (!imageUrl.startsWith('http')) return imageUrl;
    
    if (!env.BUCKET) {
        throw new Error("R2 Bucket not configured");
    }

    try {
        let target = validateExternalImageUrl(imageUrl);
        let response: Response | null = null;
        for (let redirects = 0; redirects <= 3; redirects++) {
            response = await fetch(target.toString(), { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
            if (![301, 302, 303, 307, 308].includes(response.status)) break;
            const location = response.headers.get('location');
            if (!location) throw new Error('外链图片重定向地址无效');
            target = validateExternalImageUrl(new URL(location, target).toString());
            response = null;
        }
        if (!response) throw new Error('外链图片重定向次数过多');
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);

        const contentType = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
        const extensionByType: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
        const ext = extensionByType[contentType];
        if (!ext) throw new Error('外链响应不是支持的 PNG、JPEG 或 WebP 图片');
        const bytes = await readLimitedImageBody(response);
        const fileSize = bytes.byteLength;
        
        // Generate filename（id 来自请求体，净化为单段安全字符，防止拼接出任意前缀的 R2 key）
        const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'asset';
        const filename = `${folder}/${safeId}_${Date.now()}.${ext}`;

        await env.BUCKET.put(filename, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
            httpMetadata: { contentType }
        });

        return `/api/assets/${filename}`;
    } catch (error: any) {
        throw new Error(`Failed to fetch and store external image: ${error.message}`);
    }
}

// All settings-domain routes that run AFTER currentUser is resolved.
export async function handleSettingsRoute(ctx: RouteContext): Promise<Response | null> {
  const { request, env, url, path, method, db, currentUser, initDB } = ctx;

  // --- Local Anlas budget tracker + per-account personal usage ---
  if (path === '/api/anlas-budget') {
    const legacyKey = 'anlas_budget_remaining_v1';
    // 新版本每把 Key 使用独立 settings 行，扣减可以继续走 SQL 原子更新，
    // 避免多个设备同时生成时 JSON 读改写互相覆盖。
    const scopedKey = 'anlas_budget_remaining_v2';
    const migrationKey = 'anlas_budget_migrated_v2';
    const personalKey = 'anlas_personal_usage_v1';
    const defaultBudget = 1666;
    const validKeyHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{16,128}$/.test(value);
    await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(legacyKey, String(defaultBudget)).run();
    await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(scopedKey, '{}').run();
    await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(migrationKey, '0').run();

    type PersonalUsageMap = Record<string, { anlasSpent: number; opusImages: number; updatedAt: number }>;
    type BudgetMap = Record<string, number>;
    const readPersonalMap = async (): Promise<PersonalUsageMap> => {
      const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(personalKey).first<{value: string}>();
      try {
        const parsed = JSON.parse(row?.value || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const map: PersonalUsageMap = {};
        for (const [hash, entry] of Object.entries(parsed as Record<string, any>)) {
          if (!/^[0-9a-f]{16,128}$/.test(hash) || !entry || typeof entry !== 'object') continue;
          map[hash] = {
            anlasSpent: Math.max(0, Math.floor(Number(entry.anlasSpent) || 0)),
            opusImages: Math.max(0, Math.floor(Number(entry.opusImages) || 0)),
            updatedAt: Number(entry.updatedAt) || Date.now(),
          };
        }
        return map;
      } catch {
        return {};
      }
    };
    const writePersonalMap = async (map: PersonalUsageMap) => {
      await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .bind(personalKey, JSON.stringify(map)).run();
    };
    const readBudgetMap = async (): Promise<BudgetMap> => {
      const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(scopedKey).first<{value: string}>();
      try {
        const parsed = JSON.parse(row?.value || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const map: BudgetMap = {};
        for (const [hash, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (validKeyHash(hash) && Number.isFinite(Number(value))) map[hash] = Math.max(0, Math.min(1_000_000_000, Math.floor(Number(value))));
        }
        return map;
      } catch {
        return {};
      }
    };
    const scopedBudgetKey = (keyHash: string) => `${scopedKey}:${keyHash}`;
    const readLegacyRemaining = async () => {
      const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(legacyKey).first<{value: string}>();
      return Math.max(0, Math.min(1_000_000_000, Number.parseInt(row?.value || String(defaultBudget), 10) || 0));
    };
    const ensureScopedRemaining = async (keyHash: string) => {
      const settingKey = scopedBudgetKey(keyHash);
      const existing = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(settingKey).first<{value: string}>();
      if (existing) return Math.max(0, Math.min(1_000_000_000, Number.parseInt(existing.value, 10) || 0));
      const map = await readBudgetMap();
      const migration = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(migrationKey).first<{value: string}>();
      const initial = Object.prototype.hasOwnProperty.call(map, keyHash)
        ? map[keyHash]
        : migration?.value === '1' ? defaultBudget : await readLegacyRemaining();
      await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(settingKey, String(initial)).run();
      if (migration?.value !== '1') {
        await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').bind('1', migrationKey, '0').run();
      }
      const created = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(settingKey).first<{value: string}>();
      return Math.max(0, Math.min(1_000_000_000, Number.parseInt(created?.value || String(defaultBudget), 10) || 0));
    };
    const readRemaining = async (keyHash: string) => keyHash ? ensureScopedRemaining(keyHash) : readLegacyRemaining();
    const writeRemaining = async (keyHash: string, remaining: number) => {
      if (!keyHash) {
        await db.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(String(remaining), legacyKey).run();
        return;
      }
      await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .bind(scopedBudgetKey(keyHash), String(remaining)).run();
    };
    const readPersonalForKey = async (keyHash: string) => {
      if (!validKeyHash(keyHash)) return {};
      const map = await readPersonalMap();
      return map[keyHash] ? { [keyHash]: map[keyHash] } : {};
    };

    const body = method === 'GET' ? {} : await request.json() as any;
    const keyHashValue = body.keyHash || url.searchParams.get('keyHash') || '';
    const keyHash = validKeyHash(keyHashValue) ? keyHashValue : '';
    if (method === 'GET') {
      return json({ remaining: await readRemaining(keyHash), personal: await readPersonalForKey(keyHash) });
    }
    if (method === 'PUT') {
      const remaining = Math.max(0, Math.min(1_000_000_000, Math.floor(Number(body.remaining))));
      if (!Number.isFinite(remaining)) return error('点数必须是有效整数', 400);
      await writeRemaining(keyHash, remaining);
      return json({ remaining, personal: await readPersonalForKey(keyHash), updatedAt: Date.now() });
    }
    if (method === 'POST') {
      const amount = Math.max(0, Math.min(1_000_000, Math.floor(Number(body.amount))));
      if (!Number.isFinite(amount)) return error('扣除点数必须是有效整数', 400);
      if (keyHash) {
        await ensureScopedRemaining(keyHash);
        await db.prepare(`UPDATE settings
          SET value = CAST(MAX(0, CAST(value AS INTEGER) - ?) AS TEXT)
          WHERE key = ?`).bind(amount, scopedBudgetKey(keyHash)).run();
      } else {
        await db.prepare(`UPDATE settings
          SET value = CAST(MAX(0, CAST(value AS INTEGER) - ?) AS TEXT)
          WHERE key = ?`).bind(amount, legacyKey).run();
      }
      // 个人用量按密钥哈希分账号累计（用于设置页的“我个人用了多少”统计）。
      if (keyHash) {
        const map = await readPersonalMap();
        const previous = map[keyHash] || { anlasSpent: 0, opusImages: 0, updatedAt: 0 };
        map[keyHash] = {
          anlasSpent: previous.anlasSpent + Math.max(0, Math.floor(Number(body.anlasDelta) || 0)),
          opusImages: previous.opusImages + Math.max(0, Math.floor(Number(body.opusImagesDelta) || 0)),
          updatedAt: Date.now(),
        };
        await writePersonalMap(map);
      }
      return json({ remaining: await readRemaining(keyHash), spent: amount, personal: await readPersonalForKey(keyHash), updatedAt: Date.now() });
    }
    if (method === 'DELETE') {
      if (keyHash) {
        const map = await readPersonalMap();
        delete map[keyHash];
        await writePersonalMap(map);
      }
      return json({ remaining: await readRemaining(keyHash), personal: await readPersonalForKey(keyHash) });
    }
    return error('Method not allowed', 405);
  }

  // --- ADMIN: Global Settings (Benchmark Config) ---
  if (path === '/api/config/benchmarks' && method === 'PUT') {
      if (currentUser.role !== 'admin') return error('Forbidden', 403);
      const { config } = await request.json() as any;
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('benchmark_config', JSON.stringify(config)).run();
      return json({ success: true });
  }

  // --- NAI Proxy ---
  if (path === '/api/generate' && method === 'POST') {
    const startedAt = Date.now();
    const body = await request.json();
    const clientAuth = request.headers.get('Authorization');
    const generationMeta = {
      model: body?.model,
      action: body?.action,
      width: body?.parameters?.width,
      height: body?.parameters?.height,
      steps: body?.parameters?.steps,
      scale: body?.parameters?.scale,
      sampler: body?.parameters?.sampler,
      seed: body?.parameters?.seed ?? 'random',
      promptLength: typeof body?.input === 'string' ? body.input.length : 0,
      negativeLength: typeof body?.parameters?.negative_prompt === 'string' ? body.parameters.negative_prompt.length : 0,
      characters: Array.isArray(body?.parameters?.v4_prompt?.caption?.char_captions) ? body.parameters.v4_prompt.caption.char_captions.length : 0,
    };
    if (!clientAuth) {
      return error('Missing API Key', 401);
    }
    const naiRes = await fetch("https://image.novelai.net/ai/generate-image", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": clientAuth }, body: JSON.stringify(body) });
    if (!naiRes.ok) {
      const errText = await naiRes.text();
      return error(errText, naiRes.status);
    }
    const blob = await naiRes.blob();
    return new Response(blob, { headers: { 'Content-Type': 'application/zip' } });
  }

  if (path === '/api/generate-stream' && method === 'POST') {
    const body = await request.json();
    const clientAuth = request.headers.get('Authorization');
    if (!clientAuth) return error('Missing API Key', 401);
    const naiRes = await fetch('https://image.novelai.net/ai/generate-image-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': clientAuth,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });
    if (!naiRes.ok) return error(await naiRes.text(), naiRes.status);
    return new Response(naiRes.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'private, no-store',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // --- File Upload ---
  if (path === '/api/upload' && method === 'POST') {
      if (!env.BUCKET) return error('R2 Bucket not configured', 503);
      if (currentUser.role === 'guest') {
        return error('Guests cannot upload files', 403);
      }
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file || !(file instanceof File)) return error('Invalid file', 400);
      // folder/ext 净化为单段安全字符：两者都来自客户端，直接拼接可写出任意前缀的 R2 key
      const folder = String(formData.get('folder') || 'misc').replace(/[^a-zA-Z0-9_-]/g, '') || 'misc';
      const ext = String(file.name.split('.').pop() || 'png').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';
      const filename = `${folder}/${currentUser.id}_${Date.now()}.${ext}`;
      const fileSize = file.size;
      await env.BUCKET.put(filename, file.stream(), { httpMetadata: { contentType: file.type } });
      return json({ url: `/api/assets/${filename}`, size: fileSize });
  }

  // --- CRUD Routes ---

  const DEFAULT_CHAIN_PARAMS = {
    width: 832,
    height: 1216,
    steps: 28,
    scale: 5,
    sampler: 'k_euler_ancestral',
    qualityToggle: true,
    ucPreset: 4,
    characters: [],
  };

  const parseChainParams = (raw: string | null | undefined) => {
    const parsed = parseStoredJson(raw, {});
    return { ...DEFAULT_CHAIN_PARAMS, ...parsed };
  };

  // Chains
  if (path === '/api/chains' && method === 'GET') {
    // 游客不返回 guest_hidden=1 的记录
    const isGuestUser = currentUser.role === 'guest';
    let chainsResult;
    try {
      if (isGuestUser) {
        chainsResult = await db.prepare('SELECT * FROM chains WHERE guest_hidden = 0 ORDER BY updated_at DESC').all();
      } else {
        chainsResult = await db.prepare('SELECT * FROM chains ORDER BY updated_at DESC').all();
      }
    } catch (e: any) {
      if (isMissingColumnError(e)) {
        await initDB();
        if (isGuestUser) {
          chainsResult = await db.prepare('SELECT * FROM chains WHERE guest_hidden = 0 ORDER BY updated_at DESC').all();
        } else {
          chainsResult = await db.prepare('SELECT * FROM chains ORDER BY updated_at DESC').all();
        }
      } else {
        throw e;
      }
    }
    const data = chainsResult.results.map((c: any) => ({
      id: c.id, userId: c.user_id, username: c.username, type: c.type || 'style', name: c.name, description: c.description,
      tags: parseStoredJson(c.tags, []), previewImage: c.preview_image, base_prompt: c.base_prompt, // raw DB column needed? No, mapping below
      basePrompt: c.base_prompt,
      negativePrompt: c.negative_prompt, modules: parseStoredJson(c.modules, []), params: parseChainParams(c.params),
      variableValues: parseStoredJson(c.variable_values, {}), guestHidden: c.guest_hidden === 1, createdAt: c.created_at, updatedAt: c.updated_at
    }));
    return json(data);
  }
  if (path === '/api/chains' && method === 'POST') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    const body = await request.json() as any;
    const id = crypto.randomUUID();
    const type = body.type || 'style'; // Default to style
    const guestHidden = body.guestHidden ? 1 : 0;
    // Sanitize and validate tags
    let tags = '[]';
    if (Array.isArray(body.tags)) {
      const sanitizedTags = (body.tags as unknown[])
        .map(tag => typeof tag === 'string' ? tag.trim().substring(0, 50) : '')
        .filter(tag => tag.length > 0);
      tags = JSON.stringify(sanitizedTags);
    }
    const paramsToStore = JSON.stringify({ ...DEFAULT_CHAIN_PARAMS, ...(body.params && typeof body.params === 'object' ? body.params : {}) });
    try {
      await db.prepare(`INSERT INTO chains (id, user_id, username, type, name, description, tags, preview_image, base_prompt, negative_prompt, modules, params, variable_values, guest_hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, currentUser.id, currentUser.username, type, body.name, body.description, tags, null, body.basePrompt || '', body.negativePrompt || '', body.modules ? JSON.stringify(body.modules) : '[]', paramsToStore, body.variableValues ? JSON.stringify(body.variableValues) : '{}', guestHidden, Date.now(), Date.now()).run();
      return json({ id });
    } catch (e: any) {
      if (isMissingColumnError(e)) {
        await initDB();
        await db.prepare(`INSERT INTO chains (id, user_id, username, type, name, description, tags, preview_image, base_prompt, negative_prompt, modules, params, variable_values, guest_hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, currentUser.id, currentUser.username, type, body.name, body.description, tags, null, body.basePrompt || '', body.negativePrompt || '', body.modules ? JSON.stringify(body.modules) : '[]', paramsToStore, body.variableValues ? JSON.stringify(body.variableValues) : '{}', guestHidden, Date.now(), Date.now()).run();
        return json({ id });
      }
      throw e;
    }
  }
  const chainIdMatch = path.match(/^\/api\/chains\/([^\/]+)$/);
  if (chainIdMatch && method === 'GET') {
    const id = decodeURIComponent(chainIdMatch[1]);
    const chain = await db.prepare('SELECT * FROM chains WHERE id = ?').bind(id).first<any>();
    if (!chain) return error('Not Found', 404);
    if (currentUser.role === 'guest' && chain.guest_hidden === 1) return error('Not Found', 404);
    return json({
      id: chain.id,
      userId: chain.user_id,
      username: chain.username,
      type: chain.type || 'style',
      name: chain.name,
      description: chain.description,
      tags: parseStoredJson(chain.tags, []),
      previewImage: chain.preview_image,
      basePrompt: chain.base_prompt || '',
      negativePrompt: chain.negative_prompt || '',
      modules: parseStoredJson(chain.modules, []),
      params: parseChainParams(chain.params),
      variableValues: parseStoredJson(chain.variable_values, {}),
      guestHidden: chain.guest_hidden === 1,
      createdAt: chain.created_at,
      updatedAt: chain.updated_at,
    });
  }
  if (chainIdMatch && method === 'PUT') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    const id = chainIdMatch[1];
    const updates = await request.json() as any;
    const chain = await db.prepare('SELECT user_id, preview_image, name, type FROM chains WHERE id = ?').bind(id).first<{user_id: string, preview_image: string, name: string, type: string}>();
    if (!chain) return error('Not Found', 404);
    if (chain.user_id && chain.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
    
    // Handle Chain Cover Cleanup
    if (updates.previewImage && updates.previewImage.startsWith('data:')) {
         try { 
              const newUrl = await processImageUpload(env, updates.previewImage, 'covers', id, currentUser);
              updates.previewImage = newUrl;
         } catch (e: any) { return error(e.message, 413); }
    } else if (updates.previewImage && updates.previewImage.startsWith('http')) {
         try {
              const previewSource = new URL(updates.previewImage);
              if (previewSource.protocol !== 'https:' || previewSource.hostname.toLowerCase() !== 'cdn.donmai.us') {
                return error('角色 Tag 外部封面仅允许 Danbooru 图片地址', 422);
              }
              updates.previewImage = await fetchAndUploadImage(env, updates.previewImage, 'covers', id, currentUser);
         } catch (e: any) { return error(e.message, 422); }
    }

    const fields = []; const values = [];
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.previewImage !== undefined) { fields.push('preview_image = ?'); values.push(updates.previewImage); }
    if (updates.basePrompt !== undefined) { fields.push('base_prompt = ?'); values.push(updates.basePrompt); }
    if (updates.negativePrompt !== undefined) { fields.push('negative_prompt = ?'); values.push(updates.negativePrompt); }
    if (updates.modules !== undefined) { fields.push('modules = ?'); values.push(JSON.stringify(updates.modules)); }
    if (updates.params !== undefined) { fields.push('params = ?'); values.push(JSON.stringify(updates.params)); }
    if (updates.variableValues !== undefined) { fields.push('variable_values = ?'); values.push(JSON.stringify(updates.variableValues)); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
    if (updates.guestHidden !== undefined) { fields.push('guest_hidden = ?'); values.push(updates.guestHidden ? 1 : 0); }
    if (fields.length > 0) {
      fields.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);
      try {
        await db.prepare(`UPDATE chains SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
      } catch (e: any) {
        if (isMissingColumnError(e)) {
          await initDB();
          await db.prepare(`UPDATE chains SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
        } else {
          throw e;
        }
      }
    }
    // Delete only after the new reference has committed.  This covers
    // replacement, clearing a cover, and future non-base64 cover sources.
    if (updates.previewImage !== undefined && chain.preview_image && chain.preview_image !== updates.previewImage) {
      await deleteR2File(env, chain.preview_image);
    }
    return json({ success: true });
  }
  if (chainIdMatch && method === 'DELETE') {
    if (currentUser.role === 'guest') return error('Forbidden', 403);
    const id = chainIdMatch[1];
    const chain = await db.prepare('SELECT user_id, preview_image, name, type FROM chains WHERE id = ?').bind(id).first<{user_id: string, preview_image: string, name: string, type: string}>();
    if (chain) {
        if (chain.user_id && chain.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
        // Delete Cover
        if (chain.preview_image) await deleteR2File(env, chain.preview_image);
        await db.prepare('DELETE FROM chains WHERE id = ?').bind(id).run();
    }
    return json({ success: true });
  }

  // Artists (Updated with Deletion Logic)
  if (path === '/api/artists' && method === 'GET') {
     const res = await db.prepare('SELECT * FROM artists ORDER BY name ASC').all();
     return json(res.results.map((a: any) => ({ id: a.id, name: a.name, imageUrl: a.image_url, previewUrl: a.preview_url, benchmarks: parseStoredJson(a.benchmarks, []) })));
  }
  if (path === '/api/artists' && method === 'POST') {
    const body = await request.json() as any;
    const id = body.id || crypto.randomUUID();
    
    // Fetch existing artist to compare for deletions
    const existing = await db.prepare('SELECT name, benchmarks, preview_url, image_url FROM artists WHERE id = ?').bind(id).first<{name: string, benchmarks: string, preview_url: string, image_url: string}>();
    const oldBenchmarks = existing && existing.benchmarks ? JSON.parse(existing.benchmarks) : [];

    // Process image URL - handle both Base64 and external URL
    let imageUrl = body.imageUrl;
    if (imageUrl && imageUrl.startsWith('data:')) {
        imageUrl = await processImageUpload(env, imageUrl, 'artists', id, currentUser);
    } else if (imageUrl && imageUrl.startsWith('http')) {
        // Fetch external image URL and store in R2
        imageUrl = await fetchAndUploadImage(env, imageUrl, 'artists', id, currentUser);
    }

    // Process benchmarks - handle both Base64 and external URLs
    const benchmarks = body.benchmarks || [];
    if (Array.isArray(benchmarks)) {
        for (let i = 0; i < benchmarks.length; i++) {
            if (benchmarks[i] && benchmarks[i].startsWith('data:')) {
                // Upload new file
                const newUrl = await processImageUpload(env, benchmarks[i], `artists/benchmarks_${i}`, id);
                benchmarks[i] = newUrl;
                
            } else if (benchmarks[i] && benchmarks[i].startsWith('http')) {
                // Fetch external image URL and store in R2
                const newUrl = await fetchAndUploadImage(env, benchmarks[i], `artists/benchmarks_${i}`, id, currentUser);
                benchmarks[i] = newUrl;
                
            }
        }
    }
    
    // Handle undefined values - convert to null or default
    const previewUrl = body.previewUrl ?? null;
    const benchmarksJson = JSON.stringify(benchmarks || []);
    const sanitizedName = body.name ? body.name.trim() : '';
    
    await db.prepare(`INSERT INTO artists (id, name, image_url, benchmarks, preview_url) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, image_url = excluded.image_url, benchmarks = excluded.benchmarks, preview_url = excluded.preview_url`).bind(id, sanitizedName, imageUrl, benchmarksJson, previewUrl).run();
    // A database update must become durable before any old asset is
    // removed.  This also cleans up benchmarks that were removed from the
    // edited list instead of leaving them orphaned forever.
    const retainedAssets = new Set([imageUrl, previewUrl, ...benchmarks].filter((url): url is string => typeof url === 'string' && url.length > 0));
    const previousAssets = [existing?.image_url, existing?.preview_url, ...oldBenchmarks]
      .filter((url): url is string => typeof url === 'string' && url.length > 0);
    for (const oldUrl of new Set(previousAssets)) {
      if (!retainedAssets.has(oldUrl)) await deleteR2File(env, oldUrl);
    }
    return json({ success: true, benchmarks });
  }
  if (path.startsWith('/api/artists/') && method === 'DELETE') {
    const id = path.split('/').pop();
    const artist = await db.prepare('SELECT name, benchmarks, preview_url, image_url FROM artists WHERE id = ?').bind(id).first<{name: string, benchmarks: string, preview_url: string, image_url: string}>();
    if (artist) {
        // Delete all associated files
        await deleteR2File(env, artist.image_url);
        if (artist.preview_url) await deleteR2File(env, artist.preview_url);
        if (artist.benchmarks) {
            // benchmarks 列损坏时回退为空数组，保证画师条目本身仍能删除
            const bms = parseStoredJson(artist.benchmarks, []);
            for (const url of Array.isArray(bms) ? bms : []) {
                if (url) await deleteR2File(env, url);
            }
        }
    }
    await db.prepare('DELETE FROM artists WHERE id = ?').bind(id).run();
    return json({ success: true });
  }

  // Dead code preserved verbatim: this path is intercepted earlier by the
  // account-management 410 short-circuit in index.ts.
  if (path === '/api/client-logs' && method === 'POST') {
    const body = await request.json() as any;
    return json({ success: true });
  }

  return null;
}

// --- Media proxy (originally in worker/index.ts; kept with LAN/media domain) ---
export const handleMediaRequest = async (request: Request, env: Env, url: URL) => {
  if (request.method !== 'GET') return error('Method not allowed', 405);
  const variant = url.searchParams.get('variant') || '';
  if (!MEDIA_VARIANTS.has(variant)) return error('Invalid image variant', 400);
  let validated: { source: string; internal: boolean };
  try {
    validated = validateMediaSource(url.searchParams.get('source'));
  } catch (mediaError: any) {
    return error(mediaError?.message || 'Invalid image source', 400);
  }

  const assetMatch = validated.source.match(/^\/api\/assets\/(.+?)(?:\?.*)?$/);
  if (assetMatch && env.BUCKET) {
    let key = '';
    try { key = decodeURIComponent(assetMatch[1]); } catch { return error('Invalid asset key', 400); }
    const object = await env.BUCKET.get(key);
    if (!object) return error('File not found', 404);
    if (request.headers.get('If-None-Match') === object.httpEtag) {
      return new Response(null, { status: 304, headers: {
        ETag: object.httpEtag,
        'Cache-Control': 'private, max-age=31536000, immutable',
      }});
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Cache-Control', 'private, max-age=31536000, immutable');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(object.body, { headers });
  }

  const target = validated.internal ? new URL(validated.source, url.origin).toString() : validated.source;
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      'Cache-Control': variant === 'original' ? 'private, max-age=3600' : 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
