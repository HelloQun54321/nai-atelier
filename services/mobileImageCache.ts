const DB_NAME = 'nai-mobile-image-cache';
const DB_VERSION = 1;
const STORE_NAME = 'thumbnails';
const META_KEY = 'nai_mobile_thumbnail_cache_meta_v1';
const LIMIT_KEY = 'nai_mobile_image_cache_limit_mb';
const DEFAULT_LIMIT_MB = 100;
const PRUNE_RATIO = 0.9;

interface CacheMetaEntry {
  size: number;
  accessedAt: number;
}

type CacheMeta = Record<string, CacheMetaEntry>;

const activeRequests = new Map<string, {
  promise: Promise<Blob>;
  controller: AbortController;
  references: number;
}>();

interface ThumbnailRecord {
  url: string;
  blob: Blob;
  size: number;
  accessedAt: number;
}

let databasePromise: Promise<IDBDatabase> | null = null;

const openCacheDatabase = () => {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable'));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'url' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open image cache'));
    });
  }
  return databasePromise;
};

const runStoreRequest = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => {
  const database = await openCacheDatabase();
  return await new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Image cache operation failed'));
  });
};

const getCachedRecord = (url: string) => runStoreRequest<ThumbnailRecord | undefined>('readonly', store => store.get(url));
const getAllCachedRecords = () => runStoreRequest<ThumbnailRecord[]>('readonly', store => store.getAll());
const putCachedRecord = (record: ThumbnailRecord) => runStoreRequest<IDBValidKey>('readwrite', store => store.put(record));
const deleteCachedRecord = (url: string) => runStoreRequest<undefined>('readwrite', store => store.delete(url));
const clearCachedRecords = () => runStoreRequest<undefined>('readwrite', store => store.clear());

const readMeta = (): CacheMeta => {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
};

const writeMeta = (meta: CacheMeta) => {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
  window.dispatchEvent(new CustomEvent('nai-mobile-cache-changed'));
};

export const getMobileCacheLimitMb = () => {
  const saved = localStorage.getItem(LIMIT_KEY);
  if (saved === null) return DEFAULT_LIMIT_MB;
  const value = Number(saved);
  return [0, 25, 50, 100].includes(value) ? value : DEFAULT_LIMIT_MB;
};

export const setMobileCacheLimitMb = (value: number) => {
  const normalized = [0, 25, 50, 100].includes(value) ? value : DEFAULT_LIMIT_MB;
  localStorage.setItem(LIMIT_KEY, String(normalized));
  void pruneMobileThumbnailCache();
  window.dispatchEvent(new CustomEvent('nai-mobile-cache-changed'));
};

export const getMobileCacheStats = () => {
  const entries = Object.values(readMeta());
  return {
    count: entries.length,
    bytes: entries.reduce((sum, entry) => sum + Number(entry.size || 0), 0),
    limitMb: getMobileCacheLimitMb(),
  };
};

export const refreshMobileCacheMetadata = async () => {
  if (!('indexedDB' in window)) return getMobileCacheStats();
  const records: ThumbnailRecord[] = await getAllCachedRecords().catch((): ThumbnailRecord[] => []);
  const meta = Object.fromEntries(records.map(record => [record.url, { size: record.size, accessedAt: record.accessedAt }]));
  writeMeta(meta);
  return getMobileCacheStats();
};

export const clearMobileThumbnailCache = async () => {
  if ('indexedDB' in window) await clearCachedRecords().catch(() => {});
  localStorage.removeItem(META_KEY);
  window.dispatchEvent(new CustomEvent('nai-mobile-cache-changed'));
};

export const pruneMobileThumbnailCache = async () => {
  if (!('indexedDB' in window)) return;
  const limit = getMobileCacheLimitMb() * 1024 * 1024;
  const target = Math.floor(limit * PRUNE_RATIO);
  const records: ThumbnailRecord[] = await getAllCachedRecords().catch((): ThumbnailRecord[] => []);
  let total = records.reduce<number>((sum, record) => sum + Number(record.size || 0), 0);
  const kept = new Map<string, ThumbnailRecord>(records.map(record => [record.url, record]));
  if (limit === 0 || total > limit) {
    for (const record of records.sort((a, b) => a.accessedAt - b.accessedAt)) {
      await deleteCachedRecord(record.url).catch(() => {});
      kept.delete(record.url);
      total -= Number(record.size || 0);
      if (total <= target) break;
    }
  }
  const meta = Object.fromEntries([...kept.values()].map(record => [record.url, { size: record.size, accessedAt: record.accessedAt }]));
  writeMeta(meta);
};

const loadThumbnail = async (url: string, signal: AbortSignal): Promise<Blob> => {
  const limitMb = getMobileCacheLimitMb();
  const canPersist = 'indexedDB' in window;
  if (canPersist && limitMb > 0) {
    const cached = await getCachedRecord(url).catch(() => undefined);
    if (cached) {
      const meta = readMeta();
      meta[url] = { size: cached.size, accessedAt: Date.now() };
      writeMeta(meta);
      void putCachedRecord({ ...cached, accessedAt: Date.now() }).catch(() => {});
      return cached.blob;
    }
  }

  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(response.status === 401 ? '局域网访问已失效' : '图片加载失败');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('返回内容不是图片');
  if (canPersist && limitMb > 0) {
    await putCachedRecord({ url, blob, size: blob.size, accessedAt: Date.now() });
    const meta = readMeta();
    meta[url] = { size: blob.size, accessedAt: Date.now() };
    writeMeta(meta);
    await pruneMobileThumbnailCache();
  }
  return blob;
};

export const acquireMobileThumbnail = (url: string) => {
  let active = activeRequests.get(url);
  if (!active) {
    const controller = new AbortController();
    const entry = {
      promise: Promise.resolve(new Blob()),
      controller,
      references: 0,
    };
    entry.promise = loadThumbnail(url, controller.signal).finally(() => {
      if (activeRequests.get(url) === entry) activeRequests.delete(url);
    });
    active = entry;
    activeRequests.set(url, active);
  }
  active.references++;
  let released = false;
  return {
    promise: active.promise,
    release: () => {
      if (released) return;
      released = true;
      const current = activeRequests.get(url);
      if (!current) return;
      current.references--;
      if (current.references <= 0) {
        activeRequests.delete(url);
        current.controller.abort();
      }
    },
  };
};

export const abortMobileThumbnailRequests = () => {
  activeRequests.forEach(request => request.controller.abort());
  activeRequests.clear();
};

export const isMobileViewport = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

export const canUseMediaGateway = (source: string) => {
  if (source.startsWith('/api/assets/') || /^\/api\/(?:local-history\/[^/]+\/image|vibes\/[^/]+\/(?:image|thumbnail))/.test(source)) return true;
  try {
    const url = new URL(source, window.location.origin);
    return url.protocol === 'https:' && ['ai-img.10118899.xyz', 'aitag.win'].includes(url.hostname.toLowerCase());
  } catch { return false; }
};

export const buildMediaUrl = (source: string, variant: 'thumb-320' | 'thumb-640' | 'original') =>
  `/api/media?source=${encodeURIComponent(source)}&variant=${variant}`;

export const getMobileOriginalUrl = (source: string) =>
  isMobileViewport() && canUseMediaGateway(source) ? buildMediaUrl(source, 'original') : source;
