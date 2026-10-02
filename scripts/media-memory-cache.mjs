/** 网关短期响应缓存：有界内存、LRU、同请求合并；不把失败或受限响应写成成功缓存。 */
export const createResponseMemoryCache = ({ maxEntries = 128, maxBytes = 32 * 1024 * 1024, cacheable = value => value.status === 200, now = Date.now } = {}) => {
  const entries = new Map();
  const pending = new Map();
  let bytes = 0;
  const remove = key => { bytes -= entries.get(key)?.bytes || 0; entries.delete(key); };
  return {
    async get(key, load, ttl) {
      if (ttl <= 0) return load();
      const saved = entries.get(key);
      if (saved?.expires > now()) { entries.delete(key); entries.set(key, saved); return saved.value; }
      remove(key);
      if (pending.has(key)) return pending.get(key);
      const request = Promise.resolve().then(load).then(value => {
        const size = value.buffer?.length ?? value.body?.length ?? 0;
        if (cacheable(value) && size <= maxBytes) {
          entries.set(key, { value, expires: now() + ttl, bytes: size }); bytes += size;
          while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value);
        }
        return value;
      }).finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
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
