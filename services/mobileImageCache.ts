const DB_NAME = 'nai-mobile-image-cache';
const DB_VERSION = 2;
const THUMBNAIL_STORE = 'thumbnails';
const METADATA_STORE = 'metadata';
const ACCESS_INDEX = 'accessedAt';
const STATS_KEY = 'nai_mobile_thumbnail_cache_stats_v2';
const MIGRATION_KEY = 'nai_mobile_thumbnail_cache_migrated_v2';
const LEGACY_META_KEY = 'nai_mobile_thumbnail_cache_meta_v1';
const LIMIT_KEY = 'nai_mobile_image_cache_limit_mb';
const DEFAULT_LIMIT_MB = 100;
const PRUNE_RATIO = 0.9;
const ACCESS_FLUSH_DELAY_MS = 5_000;
const PRUNE_DELAY_MS = 2_000;

export type MediaVariant = 'thumb-160' | 'thumb-240' | 'thumb-320' | 'thumb-480' | 'thumb-640' | 'thumb-960' | 'original';

interface CacheStats {
  count: number;
  bytes: number;
}

interface ThumbnailRecord {
  url: string;
  blob: Blob;
}

interface MetadataRecord {
  url: string;
  size: number;
  accessedAt: number;
}

interface ActiveImageResource {
  promise: Promise<string>;
  controller: AbortController;
  references: number;
  objectUrl: string;
}

const activeResources = new Map<string, ActiveImageResource>();
const pendingAccessUpdates = new Map<string, number>();
let databasePromise: Promise<IDBDatabase> | null = null;
let accessFlushTimer: number | null = null;
let pruneTimer: number | null = null;
let migrationPromise: Promise<void> | null = null;

const emitCacheChanged = () => window.dispatchEvent(new CustomEvent('nai-mobile-cache-changed'));

const readStats = (): CacheStats => {
  try {
    const saved = JSON.parse(localStorage.getItem(STATS_KEY) || '{}') as Partial<CacheStats>;
    return {
      count: Number.isFinite(saved.count) ? Math.max(0, Number(saved.count)) : 0,
      bytes: Number.isFinite(saved.bytes) ? Math.max(0, Number(saved.bytes)) : 0,
    };
  } catch {
    return { count: 0, bytes: 0 };
  }
};

const writeStats = (stats: CacheStats) => {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify({
      count: Math.max(0, Math.round(stats.count)),
      bytes: Math.max(0, Math.round(stats.bytes)),
    }));
  } catch {
    // Cache statistics are best-effort and must never block image display.
  }
  emitCacheChanged();
};

const openCacheDatabase = () => {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable'));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(THUMBNAIL_STORE)) {
          database.createObjectStore(THUMBNAIL_STORE, { keyPath: 'url' });
        }
        if (!database.objectStoreNames.contains(METADATA_STORE)) {
          const metadata = database.createObjectStore(METADATA_STORE, { keyPath: 'url' });
          metadata.createIndex(ACCESS_INDEX, ACCESS_INDEX);
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
        window.setTimeout(() => void migrateLegacyMetadata().catch(() => {}), 0);
      };
      request.onerror = () => {
        databasePromise = null;
        reject(request.error || new Error('Unable to open image cache'));
      };
      request.onblocked = () => {
        databasePromise = null;
        reject(new Error('Image cache upgrade is blocked'));
      };
    });
  }
  return databasePromise;
};

const runTransaction = async <T>(stores: string[], mode: IDBTransactionMode, action: (transaction: IDBTransaction) => Promise<T> | T) => {
  const database = await openCacheDatabase();
  return await new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(stores, mode);
    let result: T;
    let actionError: unknown;
    Promise.resolve(action(transaction)).then(value => { result = value; }).catch(error => {
      actionError = error;
      transaction.abort();
    });
    transaction.oncomplete = () => resolve(result!);
    transaction.onerror = () => reject(actionError || transaction.error || new Error('Image cache operation failed'));
    transaction.onabort = () => reject(actionError || transaction.error || new Error('Image cache operation aborted'));
  });
};

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Image cache request failed'));
});

const getCachedBlob = async (url: string) => runTransaction([THUMBNAIL_STORE], 'readonly', async transaction => {
  const record = await requestResult<ThumbnailRecord | undefined>(transaction.objectStore(THUMBNAIL_STORE).get(url));
  return record?.blob;
});

const putCachedBlob = async (url: string, blob: Blob) => runTransaction([THUMBNAIL_STORE, METADATA_STORE], 'readwrite', async transaction => {
  const metadataStore = transaction.objectStore(METADATA_STORE);
  const previous = await requestResult<MetadataRecord | undefined>(metadataStore.get(url));
  transaction.objectStore(THUMBNAIL_STORE).put({ url, blob } satisfies ThumbnailRecord);
  metadataStore.put({ url, size: blob.size, accessedAt: Date.now() } satisfies MetadataRecord);
  return previous;
});

const flushAccessUpdates = async () => {
  accessFlushTimer = null;
  if (!pendingAccessUpdates.size || !('indexedDB' in window)) return;
  const updates = [...pendingAccessUpdates.entries()];
  pendingAccessUpdates.clear();
  await runTransaction([METADATA_STORE], 'readwrite', async transaction => {
    const store = transaction.objectStore(METADATA_STORE);
    for (const [url, accessedAt] of updates) {
      const record = await requestResult<MetadataRecord | undefined>(store.get(url));
      if (record) store.put({ ...record, accessedAt });
    }
  }).catch(() => {});
};

const scheduleAccessUpdate = (url: string) => {
  pendingAccessUpdates.set(url, Date.now());
  if (accessFlushTimer !== null) return;
  accessFlushTimer = window.setTimeout(() => void flushAccessUpdates(), ACCESS_FLUSH_DELAY_MS);
};

const schedulePrune = () => {
  if (pruneTimer !== null) return;
  const run = () => {
    pruneTimer = null;
    void pruneMobileThumbnailCache();
  };
  if ('requestIdleCallback' in window) {
    pruneTimer = window.setTimeout(() => window.requestIdleCallback(run, { timeout: 2_000 }), PRUNE_DELAY_MS);
  } else {
    pruneTimer = globalThis.setTimeout(run, PRUNE_DELAY_MS) as unknown as number;
  }
};

const migrateLegacyMetadata = async () => {
  if (localStorage.getItem(MIGRATION_KEY) === '1') return;
  if (migrationPromise) return migrationPromise;
  migrationPromise = runTransaction([THUMBNAIL_STORE, METADATA_STORE], 'readwrite', transaction => new Promise<CacheStats>((resolve, reject) => {
    const thumbnailStore = transaction.objectStore(THUMBNAIL_STORE);
    const metadataStore = transaction.objectStore(METADATA_STORE);
    const cursorRequest = thumbnailStore.openCursor();
    let count = 0;
    let bytes = 0;
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve({ count, bytes });
        return;
      }
      const legacy = cursor.value as ThumbnailRecord & Partial<MetadataRecord>;
      const size = Number(legacy.size || legacy.blob?.size || 0);
      metadataStore.put({
        url: legacy.url,
        size,
        accessedAt: Number(legacy.accessedAt || Date.now()),
      } satisfies MetadataRecord);
      count++;
      bytes += size;
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Unable to migrate image cache metadata'));
  })).then(stats => {
    localStorage.setItem(MIGRATION_KEY, '1');
    writeStats(stats);
  }).finally(() => { migrationPromise = null; });
  return migrationPromise;
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
  schedulePrune();
  emitCacheChanged();
};

export const getMobileCacheStats = () => ({ ...readStats(), limitMb: getMobileCacheLimitMb() });

export const refreshMobileCacheMetadata = async () => {
  if (!('indexedDB' in window)) return getMobileCacheStats();
  await migrateLegacyMetadata().catch(() => {});
  const stats = await runTransaction([METADATA_STORE], 'readonly', transaction => new Promise<CacheStats>((resolve, reject) => {
    const cursorRequest = transaction.objectStore(METADATA_STORE).openCursor();
    let count = 0;
    let bytes = 0;
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve({ count, bytes });
        return;
      }
      const record = cursor.value as MetadataRecord;
      count++;
      bytes += Number(record.size || 0);
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Unable to scan cache metadata'));
  })).catch(() => readStats());
  writeStats(stats);
  try { localStorage.removeItem(LEGACY_META_KEY); } catch { /* Ignore storage failures. */ }
  return { ...stats, limitMb: getMobileCacheLimitMb() };
};

export const clearMobileThumbnailCache = async () => {
  activeResources.forEach(resource => {
    resource.controller.abort();
    if (resource.objectUrl) URL.revokeObjectURL(resource.objectUrl);
  });
  activeResources.clear();
  pendingAccessUpdates.clear();
  if ('indexedDB' in window) {
    await runTransaction([THUMBNAIL_STORE, METADATA_STORE], 'readwrite', transaction => {
      transaction.objectStore(THUMBNAIL_STORE).clear();
      transaction.objectStore(METADATA_STORE).clear();
    }).catch(() => {});
  }
  try {
    localStorage.removeItem(STATS_KEY);
    localStorage.removeItem(LEGACY_META_KEY);
  } catch { /* Ignore storage failures. */ }
  emitCacheChanged();
};

export const pruneMobileThumbnailCache = async () => {
  if (!('indexedDB' in window)) return;
  const limit = getMobileCacheLimitMb() * 1024 * 1024;
  const current = readStats();
  if (limit > 0 && current.bytes <= limit) return;
  const target = Math.floor(limit * PRUNE_RATIO);
  let bytes = current.bytes;
  let count = current.count;
  await runTransaction([THUMBNAIL_STORE, METADATA_STORE], 'readwrite', transaction => new Promise<void>((resolve, reject) => {
    const thumbnailStore = transaction.objectStore(THUMBNAIL_STORE);
    const cursorRequest = transaction.objectStore(METADATA_STORE).index(ACCESS_INDEX).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || bytes <= target) {
        resolve();
        return;
      }
      const record = cursor.value as MetadataRecord;
      thumbnailStore.delete(record.url);
      cursor.delete();
      bytes = Math.max(0, bytes - Number(record.size || 0));
      count = Math.max(0, count - 1);
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Unable to prune image cache'));
  })).then(() => writeStats({ count, bytes })).catch(() => {});
};

const loadThumbnail = async (url: string, signal: AbortSignal): Promise<Blob> => {
  const limitMb = getMobileCacheLimitMb();
  const canPersist = 'indexedDB' in window && limitMb > 0;
  if (canPersist) {
    const cached = await getCachedBlob(url).catch(() => undefined);
    if (cached) {
      scheduleAccessUpdate(url);
      return cached;
    }
  }

  const response = await fetch(url, { cache: 'default', credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(response.status === 401 ? '局域网访问已失效' : '图片加载失败');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('返回内容不是图片');
  if (canPersist) {
    void putCachedBlob(url, blob).then(previous => {
      const stats = readStats();
      writeStats({
        count: stats.count + (previous ? 0 : 1),
        bytes: stats.bytes + blob.size - Number(previous?.size || 0),
      });
      schedulePrune();
    }).catch(() => {});
  }
  return blob;
};

export const acquireMobileThumbnailUrl = (url: string) => {
  let resource = activeResources.get(url);
  if (!resource) {
    const controller = new AbortController();
    const entry: ActiveImageResource = { promise: Promise.resolve(''), controller, references: 0, objectUrl: '' };
    entry.promise = loadThumbnail(url, controller.signal).then(blob => {
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      entry.objectUrl = URL.createObjectURL(blob);
      return entry.objectUrl;
    }).catch(error => {
      if (activeResources.get(url) === entry) activeResources.delete(url);
      throw error;
    });
    resource = entry;
    activeResources.set(url, resource);
  }
  resource.references++;
  let released = false;
  return {
    promise: resource.promise,
    release: () => {
      if (released) return;
      released = true;
      const current = activeResources.get(url);
      if (!current) return;
      current.references--;
      if (current.references > 0) return;
      activeResources.delete(url);
      current.controller.abort();
      if (current.objectUrl) URL.revokeObjectURL(current.objectUrl);
    },
  };
};

export const abortMobileThumbnailRequests = () => {
  activeResources.forEach(resource => {
    resource.controller.abort();
    if (resource.objectUrl) URL.revokeObjectURL(resource.objectUrl);
  });
  activeResources.clear();
};

export const isMobileViewport = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

export const canUseMediaGateway = (source: string) => {
  if (source.startsWith('/api/assets/') || /^\/api\/(?:local-history\/[^/]+\/image|vibes\/[^/]+\/(?:image|thumbnail)|character-references\/[^/]+\/(?:image|thumbnail)|integrations\/st-chatu8\/history\/[a-f0-9]{64}\/image)(?:\?.*)?$/i.test(source)) return true;
  try {
    const url = new URL(source, window.location.origin);
    return url.protocol === 'https:' && ['ai-img.10118899.xyz', 'aitag.win'].includes(url.hostname.toLowerCase());
  } catch { return false; }
};

export const selectThumbnailVariant = (width: number): Exclude<MediaVariant, 'original'> => {
  const target = Math.max(1, Math.ceil(width));
  if (target <= 160) return 'thumb-160';
  if (target <= 240) return 'thumb-240';
  if (target <= 320) return 'thumb-320';
  if (target <= 480) return 'thumb-480';
  if (target <= 640) return 'thumb-640';
  return 'thumb-960';
};

export const buildMediaUrl = (source: string, variant: MediaVariant) => `/api/media?source=${encodeURIComponent(source)}&variant=${variant}`;

export const getMobileOriginalUrl = (source: string) => {
  if (!isMobileViewport() || !canUseMediaGateway(source)) return source;
  try {
    const url = new URL(source, window.location.origin);
    if (url.origin === window.location.origin) return source;
  } catch {
    return source;
  }
  return buildMediaUrl(source, 'original');
};
