import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Pixiv 内置图库后端：纯函数与本地安全基础。
// 只允许 app-api.pixiv.net 的少量 GET 接口；token 只以 AES-256-GCM 加密
// 保存在本机 local-data，任何响应/错误/日志都不携带 token。

export const PIXIV_API_HOST = 'app-api.pixiv.net';
export const PIXIV_OAUTH_TOKEN_URL = 'https://oauth.secure.pixiv.net/auth/token';
// Pixiv App 客户端公开固定凭据（Pixiv 官方 App 使用，用于 refresh token 授权）。
export const PIXIV_APP_CLIENT_ID = 'MOBrBDS8blbauoSck0ZfDbtuzpyT';
export const PIXIV_APP_CLIENT_SECRET = 'lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj';
export const PIXIV_HASH_SECRET = '28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c';
export const PIXIV_USER_AGENT = 'PixivIOSApp/7.13.3 (iOS 14.6; iPhone13,2)';
export const PIXIV_REFERER = 'https://www.pixiv.net/';
export const PIXIV_IMAGE_HOST = 'i.pximg.net';

export const PIXIV_ALLOWED_API_PATHS = new Map([
  ['/v1/illust/recommended', 'GET'],
  ['/v1/search/illust', 'GET'],
  ['/v1/illust/ranking', 'GET'],
  ['/v1/user/illusts', 'GET'],
  ['/v1/illust/detail', 'GET'],
]);

export const PIXIV_FEED_MODES = new Set(['recommended', 'search', 'day', 'week', 'month', 'user', 'detail']);
const MAX_CURSOR_LENGTH = 2048;
const MIN_REFRESH_TOKEN_LENGTH = 16;
const MAX_REFRESH_TOKEN_LENGTH = 2048;

const pixivError = (message, code, status = 502, extra = {}) => Object.assign(new Error(message), { code, status, ...extra });

const redactSensitive = (value, secrets = []) => {
  let text = String(value ?? '');
  for (const secret of secrets) {
    if (secret && text.includes(secret)) text = text.split(secret).join('[redacted]');
  }
  return text.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi, 'Bearer [redacted]');
};

// ---- Pixiv App API 允许列表与 next_url 清洗 ----

export const classifyPixivApiTarget = value => {
  let url;
  try { url = new URL(String(value || '')); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
  if (url.hostname.toLowerCase() !== PIXIV_API_HOST) return null;
  const method = PIXIV_ALLOWED_API_PATHS.get(url.pathname);
  return method ? { url, host: PIXIV_API_HOST, pathname: url.pathname, method } : null;
};

export const sanitizePixivNextUrl = value => {
  const target = classifyPixivApiTarget(value);
  if (!target) return null;
  for (const key of [...target.url.searchParams.keys()]) {
    if (target.url.searchParams.get(key) === '') target.url.searchParams.delete(key);
  }
  const cleaned = target.url.toString();
  return cleaned.length <= MAX_CURSOR_LENGTH ? cleaned : null;
};

// ---- Pixiv 响应规范化（年龄分级不做过滤，原样透传 x_restrict） ----

const normalizeIllust = illust => ({
  id: String(illust.id ?? ''),
  title: String(illust.title ?? ''),
  type: String(illust.type ?? 'illust'),
  caption: String(illust.caption ?? ''),
  restrict: Number(illust.restrict) || 0,
  xRestrict: Number(illust.x_restrict ?? illust.xRestrict) || 0,
  tags: Array.isArray(illust.tags)
    ? illust.tags.map(tag => String(typeof tag === 'string' ? tag : tag?.name ?? '')).filter(Boolean)
    : [],
  pageCount: Math.max(1, Number(illust.page_count) || 1),
  width: Number(illust.width) || 0,
  height: Number(illust.height) || 0,
  totalBookmarks: Number(illust.total_bookmarks) || 0,
  totalViews: Number(illust.total_view) || 0,
  createDate: String(illust.create_date ?? ''),
  user: {
    id: String(illust.user?.id ?? ''),
    name: String(illust.user?.name ?? ''),
    account: String(illust.user?.account ?? ''),
  },
  urls: {
    thumb: String(illust.image_urls?.square_medium ?? ''),
    medium: String(illust.image_urls?.medium ?? ''),
    large: String(illust.image_urls?.large ?? ''),
    original: String(illust.meta_single_page?.original_image_url ?? illust.meta_pages?.[0]?.image_urls?.original ?? ''),
  },
  metaPages: Array.isArray(illust.meta_pages)
    ? illust.meta_pages.map(page => String(page?.image_urls?.original ?? '')).filter(Boolean)
    : [],
});

export const normalizePixivResponse = (payload, mode) => {
  const raw = payload && typeof payload === 'object' ? payload : {};
  if (mode === 'detail') {
    const illust = raw.illust && typeof raw.illust === 'object' ? raw.illust : null;
    return { mode, items: illust ? [normalizeIllust(illust)] : [], nextUrl: null };
  }
  const items = Array.isArray(raw.illusts) ? raw.illusts.map(normalizeIllust) : [];
  const nextUrl = sanitizePixivNextUrl(raw.next_url);
  return { mode, items, nextUrl };
};

// ---- 本机 AES-256-GCM token 存储（独立 key、原子写入、0600） ----

export class PixivTokenStore {
  constructor({ dir = join(process.cwd(), 'local-data'), keyFile = 'pixiv.key', tokenFile = 'pixiv-tokens.json' } = {}) {
    this.dir = dir;
    this.keyPath = join(dir, keyFile);
    this.tokenPath = join(dir, tokenFile);
    this.key = null;
    this.tokens = null;
    this.generation = 0;
    this.mutationQueue = Promise.resolve();
  }

  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await this.loadKey();
    this.tokens = await this.readTokens();
  }

  async writeAtomic(file, content) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, file);
  }

  async loadKey() {
    try {
      const parsed = JSON.parse((await readFile(this.keyPath, 'utf8')).trim());
      const key = Buffer.from(String(parsed.key || ''), 'base64');
      if (key.length !== 32) throw new Error('Invalid key length');
      this.key = key;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const key = randomBytes(32);
      await this.writeAtomic(this.keyPath, `${JSON.stringify({ version: 1, key: key.toString('base64'), createdAt: Date.now() })}\n`);
      this.key = key;
    }
  }

  encryptTokens(tokens) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
    return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }

  decryptTokens(envelope) {
    if (!envelope?.iv || !envelope?.tag || !envelope?.data) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  async readTokens() {
    let envelope;
    try { envelope = JSON.parse(await readFile(this.tokenPath, 'utf8')); } catch { return null; }
    return this.decryptTokens(envelope);
  }

  async mutate(operation) {
    const pending = this.mutationQueue.then(operation, operation);
    this.mutationQueue = pending.catch(() => {});
    return pending;
  }

  async save(tokens, { expectedGeneration } = {}) {
    const normalized = {
      refreshToken: String(tokens.refreshToken || ''),
      accessToken: String(tokens.accessToken || ''),
      accessTokenExpiresAt: Number(tokens.accessTokenExpiresAt) || 0,
      updatedAt: Number(tokens.updatedAt) || Date.now(),
    };
    return this.mutate(async () => {
      if (expectedGeneration !== undefined && expectedGeneration !== this.generation) {
        throw pixivError('Pixiv 连接状态已改变，已丢弃过期令牌', 'PIXIV_TOKEN_STATE_CHANGED', 409);
      }
      await this.writeAtomic(this.tokenPath, `${JSON.stringify(this.encryptTokens(normalized))}\n`);
      this.tokens = normalized;
      this.generation += 1;
      return normalized;
    });
  }

  async clear({ expectedGeneration } = {}) {
    return this.mutate(async () => {
      if (expectedGeneration !== undefined && expectedGeneration !== this.generation) {
        throw pixivError('Pixiv 连接状态已改变', 'PIXIV_TOKEN_STATE_CHANGED', 409);
      }
      await unlink(this.tokenPath).catch(error => { if (error?.code !== 'ENOENT') throw error; });
      this.tokens = null;
      this.generation += 1;
    });
  }

  status() {
    return {
      connected: Boolean(this.tokens?.refreshToken),
      configured: Boolean(this.tokens?.refreshToken),
      updatedAt: Number(this.tokens?.updatedAt || 0),
      accessTokenExpiresAt: Number(this.tokens?.accessTokenExpiresAt || 0),
    };
  }
}

// ---- OAuth 刷新客户端（单飞刷新、401 最多重试一次、不泄露 token） ----

export class PixivOAuthClient {
  constructor({ fetch: requestFetch = globalThis.fetch, tokenUrl = PIXIV_OAUTH_TOKEN_URL, clientId = PIXIV_APP_CLIENT_ID, clientSecret = PIXIV_APP_CLIENT_SECRET, store, timeoutMs = 30_000 } = {}) {
    if (!store) throw new Error('PixivOAuthClient requires a token store');
    this.requestFetch = requestFetch;
    this.tokenUrl = tokenUrl;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.store = store;
    this.timeoutMs = timeoutMs;
    this.refreshPromise = null;
    this.refreshCount = 0;
  }

  status() {
    return { ...this.store.status(), refreshCount: this.refreshCount };
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async performRefresh() {
    const current = this.store.tokens;
    const expectedGeneration = this.store.generation;
    const refreshToken = String(current?.refreshToken || '').trim();
    if (!refreshToken) throw pixivError('尚未配置 Pixiv refresh token', 'PIXIV_NOT_CONFIGURED', 409);
    const clientTime = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
    const clientHash = createHash('md5').update(`${clientTime}${PIXIV_HASH_SECRET}`).digest('hex');
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      get_secure_url: '1',
    });
    let response;
    try {
      response = await this.requestFetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': PIXIV_USER_AGENT,
          'app-os': 'ios',
          'app-os-version': '14.6',
          'x-client-time': clientTime,
          'x-client-hash': clientHash,
        },
        body: body.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw pixivError(`无法连接 Pixiv 认证服务：${redactSensitive(error?.message)}`, 'PIXIV_REFRESH_FAILED', 502);
    }
    const text = await response.text().catch(() => '');
    let payload = null;
    try { payload = JSON.parse(text || '{}'); } catch { payload = null; }
    const tokenPayload = payload?.response && typeof payload.response === 'object' ? payload.response : payload;
    if (!response.ok || !tokenPayload || !String(tokenPayload.access_token || '')) {
      throw pixivError(
        response.status === 400 ? 'Pixiv refresh token 已失效，请重新连接' : 'Pixiv 刷新令牌失败',
        'PIXIV_REFRESH_FAILED',
        response.status === 400 ? 401 : 502,
        { upstreamStatus: response.status },
      );
    }
    const refreshed = {
      refreshToken: String(tokenPayload.refresh_token || current?.refreshToken || '').trim(),
      accessToken: String(tokenPayload.access_token || '').trim(),
      accessTokenExpiresAt: Number(tokenPayload.expires_in) > 0 ? Date.now() + Number(tokenPayload.expires_in) * 1000 : 0,
      updatedAt: Date.now(),
    };
    if (!refreshed.refreshToken) throw pixivError('Pixiv 刷新响应缺少 refresh_token', 'PIXIV_REFRESH_FAILED', 502);
    await this.store.save(refreshed, { expectedGeneration });
    this.refreshCount += 1;
    return refreshed;
  }

  async request(target, options = {}) {
    return this.requestOnce(target, options);
  }

  async requestOnce(target, options) {
    const url = String(target).startsWith('http')
      ? String(target)
      : `https://${PIXIV_API_HOST}${String(target).startsWith('/') ? '' : '/'}${target}`;
    const classified = classifyPixivApiTarget(url);
    if (!classified) throw pixivError('Pixiv 目标地址不在允许列表内', 'PIXIV_TARGET_NOT_ALLOWED', 400);
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== classified.method) throw pixivError('Pixiv 请求方法不在允许列表内', 'PIXIV_METHOD_NOT_ALLOWED', 405);
    const tokens = this.store.tokens;
    if (!tokens?.accessToken || (tokens.accessTokenExpiresAt && Date.now() > tokens.accessTokenExpiresAt - 60_000)) {
      await this.refresh();
    }
    const current = this.store.tokens;
    if (!current?.accessToken) throw pixivError('尚未配置 Pixiv 访问令牌', 'PIXIV_NOT_CONFIGURED', 409);
    let response;
    try {
      response = await this.requestFetch(classified.url.toString(), {
        method,
        headers: {
          accept: 'application/json',
          'user-agent': PIXIV_USER_AGENT,
          ...(options.headers || {}),
          authorization: `Bearer ${current.accessToken}`,
        },
        signal: options.signal || AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw pixivError(`无法连接 Pixiv API：${redactSensitive(error?.message)}`, 'PIXIV_UNAVAILABLE', 502);
    }
    if (response.status === 401 && method === 'GET' && !options._pixivRetried) {
      await this.refresh();
      return this.requestOnce(target, { ...options, _pixivRetried: true });
    }
    const text = await response.text().catch(() => '');
    let payload = null;
    try { payload = JSON.parse(text || '{}'); } catch { payload = null; }
    if (!response.ok) {
      throw pixivError(`Pixiv API 返回 ${response.status}`, 'PIXIV_API_ERROR', response.status === 401 ? 401 : 502, {
        upstreamStatus: response.status,
      });
    }
    return payload;
  }
}

// ---- 图库服务：连接/断开/feed，供本机网关使用 ----

export class PixivGalleryService {
  constructor({ fetch: requestFetch = globalThis.fetch, tokenDir, clientId, clientSecret, store, oauth } = {}) {
    this.store = store || new PixivTokenStore({ dir: tokenDir });
    this.oauth = oauth || new PixivOAuthClient({ fetch: requestFetch, store: this.store, clientId, clientSecret });
  }

  async init() {
    await this.store.init();
  }

  status() {
    return { ...this.oauth.status(), server: 'local', modes: [...PIXIV_FEED_MODES] };
  }

  async connect(refreshToken) {
    const token = String(refreshToken || '').trim();
    if (token.length < MIN_REFRESH_TOKEN_LENGTH || token.length > MAX_REFRESH_TOKEN_LENGTH) {
      throw pixivError('Pixiv refresh token 格式无效', 'PIXIV_REFRESH_TOKEN_REQUIRED', 400);
    }
    if (this.oauth.refreshPromise) await this.oauth.refreshPromise.catch(() => {});
    const previous = this.store.tokens ? { ...this.store.tokens } : null;
    await this.store.save({ refreshToken: token, accessToken: '', accessTokenExpiresAt: 0, updatedAt: Date.now() });
    const tentativeGeneration = this.store.generation;
    try {
      await this.oauth.refresh();
      return { connected: true };
    } catch (error) {
      try {
        if (previous) await this.store.save(previous, { expectedGeneration: tentativeGeneration });
        else await this.store.clear({ expectedGeneration: tentativeGeneration });
      } catch (restoreError) {
        if (restoreError?.code !== 'PIXIV_TOKEN_STATE_CHANGED') throw restoreError;
      }
      throw error;
    }
  }

  async disconnect() {
    await this.store.clear();
    return { connected: false };
  }

  async feed({ mode, cursor, params = {} } = {}) {
    const selectedMode = String(mode || '').trim();
    if (!PIXIV_FEED_MODES.has(selectedMode)) throw pixivError('不支持的 Pixiv feed 模式', 'PIXIV_INVALID_MODE', 400);
    let target;
    if (cursor) {
      target = sanitizePixivNextUrl(cursor);
      if (!target) throw pixivError('Pixiv cursor 不在允许列表内', 'PIXIV_INVALID_CURSOR', 400);
    } else {
      target = this.buildFeedUrl(selectedMode, params);
    }
    const payload = await this.oauth.request(target, { method: 'GET' });
    const normalized = normalizePixivResponse(payload, selectedMode);
    return {
      mode: selectedMode,
      items: normalized.items,
      nextUrl: normalized.nextUrl,
      nextCursor: normalized.nextUrl,
      fetchedAt: Date.now(),
    };
  }

  buildFeedUrl(mode, params = {}) {
    const search = new URLSearchParams();
    const set = (key, raw) => {
      const value = String(raw ?? '').trim();
      if (value) search.set(key, value);
    };
    set('lang', params.lang);
    if (mode === 'recommended') {
      set('offset', params.offset);
      return `https://${PIXIV_API_HOST}/v1/illust/recommended${search.size ? `?${search}` : ''}`;
    }
    if (mode === 'search') {
      const word = String(params.word || params.q || '').trim();
      if (!word) throw pixivError('搜索模式需要 word 参数', 'PIXIV_INVALID_PARAMS', 400);
      set('word', word);
      set('search_target', params.search_target || 'partial_match_for_tags');
      set('sort', params.sort);
      set('duration', params.duration);
      set('start_date', params.start_date);
      set('end_date', params.end_date);
      set('offset', params.offset);
      return `https://${PIXIV_API_HOST}/v1/search/illust${search.size ? `?${search}` : ''}`;
    }
    if (mode === 'day' || mode === 'week' || mode === 'month') {
      set('mode', mode);
      set('date', params.date);
      set('offset', params.offset);
      return `https://${PIXIV_API_HOST}/v1/illust/ranking${search.size ? `?${search}` : ''}`;
    }
    if (mode === 'user') {
      const userId = String(params.user_id || '').trim();
      if (!userId) throw pixivError('画师模式需要 user_id 参数', 'PIXIV_INVALID_PARAMS', 400);
      set('user_id', userId);
      set('type', params.type);
      set('offset', params.offset);
      return `https://${PIXIV_API_HOST}/v1/user/illusts${search.size ? `?${search}` : ''}`;
    }
    if (mode === 'detail') {
      const illustId = String(params.illust_id || '').trim();
      if (!illustId) throw pixivError('详情模式需要 illust_id 参数', 'PIXIV_INVALID_PARAMS', 400);
      set('illust_id', illustId);
      return `https://${PIXIV_API_HOST}/v1/illust/detail${search.size ? `?${search}` : ''}`;
    }
    throw pixivError('不支持的 Pixiv feed 模式', 'PIXIV_INVALID_MODE', 400);
  }
}
