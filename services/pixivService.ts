import { MediaVariant, buildMediaUrl, getMobileOriginalUrl } from './mobileImageCache';

export type PixivFeedMode =
  | 'recommended'
  | 'following'
  | 'bookmarks'
  | 'ranking'
  | 'search'
  | 'day'
  | 'week'
  | 'month'
  | 'user'
  | 'detail'
  | 'related'
  | 'trending';

export type PixivRankingSubMode =
  | 'day'
  | 'day_ai'
  | 'week_original'
  | 'day_rookie'
  | 'week'
  | 'month'
  | 'day_male'
  | 'day_female'
  | 'day_r18'
  | 'day_r18_ai';

export interface PixivUserInfo {
  id: string;
  name: string;
  account: string;
}

export interface PixivIllust {
  id: string;
  title: string;
  type: string;
  caption: string;
  restrict: number;
  xRestrict: number;
  isBookmarked?: boolean;
  tags: string[];
  pageCount: number;
  width: number;
  height: number;
  totalBookmarks: number;
  totalViews: number;
  createDate: string;
  user: PixivUserInfo;
  urls: {
    thumb: string;
    medium: string;
    large: string;
    original: string;
  };
  metaPages: string[];
}

export interface PixivConnectionStatus {
  connected: boolean;
  hasRefreshToken?: boolean;
  refreshCount?: number;
  server?: string;
  modes?: PixivFeedMode[];
  accessTokenExpiresAt?: number;
  updatedAt?: number;
}

export interface PixivFeedParams {
  word?: string;
  search_target?: string;
  sort?: string;
  duration?: string;
  date?: string;
  user_id?: string;
  type?: string;
  offset?: number | string;
  lang?: string;
  ranking_mode?: string;
  restrict?: string;
  tag?: string;
  illust_id?: string;
}

export interface PixivTrendingTag {
  tag: string;
  translatedName?: string;
  illust?: PixivIllust | null;
}

export interface PixivFeedResult<T = PixivIllust> {
  mode: PixivFeedMode;
  items: T[];
  nextUrl: string | null;
  nextCursor: string | null;
  fetchedAt: number;
}

export type PixivLoginState = 'starting' | 'awaiting-user' | 'exchanging' | 'connected' | 'failed' | 'canceled' | 'timed-out';

export interface PixivLoginStatus {
  id: string;
  state: PixivLoginState;
  message: string;
  expiresAt: number;
  connected?: boolean;
  automaticCallback?: boolean;
}

export interface PixivLoginError extends Error {
  code?: string;
}

const API_BASE = '/api/pixiv';

const requestJson = async (path: string, init?: RequestInit) => {
  const headers: Record<string, string> = {};
  if (init?.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (response.status === 401) {
    const payload = await response.clone().json().catch(() => null);
    if (payload?.code === 'LAN_ACCESS_REQUIRED' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nai-lan-access-required'));
    }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = text;
    let code = '';
    try {
      const payload = JSON.parse(text || '{}');
      if (payload?.error) message = payload.error;
      if (payload?.code) code = payload.code;
    } catch {
      // 保留原始文本作为错误信息
    }
    const error = new Error(message || 'Pixiv 请求失败') as PixivLoginError;
    if (code) error.code = code;
    throw error;
  }
  return response.json();
};

export const pixivService = {
  status: async (): Promise<PixivConnectionStatus> => requestJson('/status'),

  connect: async (refreshToken: string): Promise<{ connected: boolean }> =>
    requestJson('/connect', { method: 'POST', body: JSON.stringify({ refreshToken }) }),

  disconnect: async (): Promise<{ connected: boolean }> =>
    requestJson('/connect', { method: 'DELETE' }),

  startPixivLogin: async (): Promise<PixivLoginStatus> =>
    requestJson('/login/start', { method: 'POST' }),

  getPixivLoginStatus: async (id: string): Promise<PixivLoginStatus> =>
    requestJson(`/login/status?id=${encodeURIComponent(id)}`),

  completePixivLogin: async (id: string, callbackUrl: string): Promise<PixivLoginStatus> =>
    requestJson('/login/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, callbackUrl }),
    }),

  cancelPixivLogin: async (id: string): Promise<PixivLoginStatus> =>
    requestJson(`/login?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  feed: async <T = PixivIllust>(mode: PixivFeedMode, options: { cursor?: string; params?: PixivFeedParams } = {}): Promise<PixivFeedResult<T>> => {
    const query = new URLSearchParams({ mode });
    if (options.cursor) query.set('cursor', options.cursor);
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined && value !== null && String(value) !== '') query.set(key, String(value));
      }
    }
    return requestJson(`/feed?${query.toString()}`);
  },

  addBookmark: async (illustId: string, restrict: 'public' | 'private' = 'public'): Promise<{ success?: boolean }> =>
    requestJson('/bookmark', { method: 'POST', body: JSON.stringify({ illust_id: illustId, restrict }) }),

  deleteBookmark: async (illustId: string): Promise<{ success?: boolean }> =>
    requestJson(`/bookmark?illust_id=${encodeURIComponent(illustId)}`, { method: 'DELETE' }),

  getRelated: async (illustId: string): Promise<PixivIllust[]> => {
    const result = await pixivService.feed('related', { params: { illust_id: illustId } });
    return result.items || [];
  },

  getTrendingTags: async (): Promise<PixivTrendingTag[]> => {
    const result = await pixivService.feed<PixivTrendingTag>('trending');
    return result.items || [];
  },
};

export const pixivArtworkUrl = (illust: PixivIllust): string => `https://www.pixiv.net/artworks/${illust.id}`;

export const pixivUserUrl = (userId: string): string => `https://www.pixiv.net/users/${userId}`;

export const pixivPageCount = (illust: PixivIllust): number => Math.max(1, illust.metaPages.length || illust.pageCount || 1);

/** 多页作品第 pageIndex 页的原图 URL；单页作品回退到 original/large/medium。 */
export const getPixivCurrentPageUrl = (illust: PixivIllust, pageIndex = 0): string => {
  const pages = illust.metaPages.length ? illust.metaPages : [illust.urls.original, illust.urls.large, illust.urls.medium].filter(Boolean);
  const index = Math.min(Math.max(0, pageIndex), pages.length - 1);
  return pages[index] || illust.urls.original || '';
};

/** 详情/卡片的渐进预览源：优先 Pixiv large，其次 medium，最后回退当前页原图（由网关缩放）。 */
export const getPixivPreviewUrl = (illust: PixivIllust, pageIndex = 0): string => {
  if (pageIndex === 0) return illust.urls.large || illust.urls.medium || getPixivCurrentPageUrl(illust, 0);
  return getPixivCurrentPageUrl(illust, pageIndex) || illust.urls.large || illust.urls.medium || '';
};

/** 通过本机 /api/media 代理构建展示用媒体 URL（i.pximg.net 必须由网关携带官方 Referer 抓取）。 */
export const buildPixivMediaUrl = (illust: PixivIllust, pageIndex = 0, variant: MediaVariant = 'original'): string =>
  buildMediaUrl(getPixivCurrentPageUrl(illust, pageIndex), variant);

/** 通过本机 /api/media 构建预览媒体 URL：large/medium 清晰源经网关缩放，适合详情先出图。 */
export const buildPixivPreviewMediaUrl = (illust: PixivIllust, pageIndex = 0, variant: MediaVariant = 'thumb-960'): string =>
  buildMediaUrl(getPixivPreviewUrl(illust, pageIndex), variant);

/** 移动端缓存链路：允许 i.pximg.net 走本地媒体代理（缩略图/原图均可）。 */
export const getPixivCachedDisplayUrl = (source: string): string => getMobileOriginalUrl(source);

const PIXIV_IMAGE_HOST = 'i.pximg.net';
const MAX_PIXIV_IMAGE_BYTES = 12 * 1024 * 1024;
const PIXIV_IMAGE_TIMEOUT_MS = 20_000;

/**
 * 与 danbooruCoverImport 同款链路：经本机 /api/media 读取原图，转 data URL，
 * 用于灵感库持久保存（浏览器直连 i.pximg.net 会因缺少官方 Referer 返回 403）。
 */
export const importPixivImageAsDataUrl = async (source: string): Promise<string> => {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error('Pixiv 图片地址无效');
  }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.hostname.toLowerCase() !== PIXIV_IMAGE_HOST || url.username || url.password) {
    throw new Error('图片不是受信任的 Pixiv 来源');
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PIXIV_IMAGE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(buildMediaUrl(source, 'original'), { signal: controller.signal });
  } catch {
    throw new Error('无法通过本机图片服务读取这张 Pixiv 图片（网络错误或请求超时）');
  } finally {
    window.clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`无法通过本机图片服务读取这张 Pixiv 图片（HTTP ${response.status}）`);
  }
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(contentType)) {
    throw new Error('图片响应格式不是 PNG、JPEG、WebP 或 GIF');
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('图片内容为空');
  if (blob.size > MAX_PIXIV_IMAGE_BYTES) throw new Error('图片超过 12MB');

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取 Pixiv 图片失败'));
    reader.readAsDataURL(blob);
  });
};
