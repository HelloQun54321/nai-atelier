/** 查询共享：每个使用者独立取消，最后一个离开才中止实际请求；失败和取消不缓存。 */
export const createDanbooruRequestPool = <T>(maxEntries = 128, maxBytes = 8 * 1024 * 1024) => {
  const values = new Map<string, { value: T; expires: number; bytes: number }>();
  const pending = new Map<string, { controller: AbortController; promise: Promise<T>; users: number; done: boolean }>();
  let totalBytes = 0;
  const remove = (key: string) => {
    const item = values.get(key);
    if (item) totalBytes -= item.bytes;
    values.delete(key);
  };
  return (key: string, load: (signal: AbortSignal) => Promise<T>, ttl: number | ((value: T) => number), signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    const saved = values.get(key);
    if (saved && saved.expires > Date.now()) {
      values.delete(key); values.set(key, saved);
      return Promise.resolve(saved.value);
    }
    remove(key);
    let request = pending.get(key);
    if (!request) {
      const controller = new AbortController();
      const created: { controller: AbortController; users: number; done: boolean; promise: Promise<T> } = {
        controller, users: 0, done: false, promise: Promise.resolve(undefined as T),
      };
      created.promise = Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return load(controller.signal);
      }).then(value => {
        const lifetime = typeof ttl === 'function' ? ttl(value) : ttl;
        if (!controller.signal.aborted && lifetime > 0) {
          const bytes = JSON.stringify(value).length * 2;
          if (bytes <= maxBytes) {
            remove(key);
            values.set(key, { value, expires: Date.now() + lifetime, bytes }); totalBytes += bytes;
            while (values.size > maxEntries || totalBytes > maxBytes) remove(values.keys().next().value!);
          }
        }
        return value;
      }).finally(() => {
        created.done = true;
        if (pending.get(key) === created) pending.delete(key);
      });
      request = created; pending.set(key, created);
    }
    const shared = request;
    shared.users++;
    return new Promise<T>((resolve, reject) => {
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
  };
};
