/** 网关短期响应缓存：有界内存、LRU、同请求合并；不把失败或受限响应写成成功缓存。 */
export const createResponseMemoryCache = ({ maxEntries = 128, maxBytes = 32 * 1024 * 1024, cacheable = value => value.status === 200, now = Date.now } = {}) => {
  const entries = new Map();
  const pending = new Map();
  let bytes = 0;
  const remove = key => { bytes -= entries.get(key)?.bytes || 0; entries.delete(key); };
  return {
    async get(key, load, ttl, signal) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (ttl <= 0) return load(signal);
      const saved = entries.get(key);
      if (saved?.expires > now()) { entries.delete(key); entries.set(key, saved); return saved.value; }
      remove(key);
      let shared = pending.get(key);
      if (!shared) {
        const controller = new AbortController();
        const created = { controller, users: 0, done: false, promise: null };
        created.promise = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return load(controller.signal); }).then(value => {
          const size = value.buffer?.length ?? value.body?.length ?? 0;
          if (!controller.signal.aborted && cacheable(value) && size <= maxBytes) {
            const expires = Math.min(now() + ttl, value.cachedUntil ?? Infinity);
            remove(key);
            entries.set(key, { value, expires, bytes: size }); bytes += size;
            while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value);
          }
          return value;
        }).finally(() => { created.done = true; if (pending.get(key) === created) pending.delete(key); });
        shared = created; pending.set(key, shared);
      }
      shared.users++;
      return new Promise((resolve, reject) => {
        let released = false;
        const release = () => {
          if (released) return;
          released = true; signal?.removeEventListener('abort', abort);
          if (--shared.users === 0 && !shared.done) {
            shared.controller.abort();
            if (pending.get(key) === shared) pending.delete(key);
          }
        };
        const abort = () => { release(); reject(new DOMException('Aborted', 'AbortError')); };
        signal?.addEventListener('abort', abort, { once: true });
        shared.promise.then(value => { if (!released) { release(); resolve(value); } }, error => { if (!released) { release(); reject(error); } });
      });
    },
    get size() { return entries.size; },
    get bytes() { return bytes; },
  };
};

export const danbooruResponseTtl = target => {
  const query = target.searchParams.get('tags') || '';
  if (/(?:^|\s)order:random(?:\s|$)/.test(query)) return 0;
  if (/ order:score -status:banned$/.test(query)) return 24 * 60 * 60 * 1000;
  return /order:|explore:/.test(query) && !/order:id_desc/.test(query) || target.pathname.includes('/popular') ? 120_000 : 15_000;
};
