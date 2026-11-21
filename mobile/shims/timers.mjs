// 浏览器定时器适配：订阅只读重试复用桌面逻辑，支持取消且清理监听器。
export function setTimeout(delay, value, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const abort = () => { globalThis.clearTimeout(timer); reject(signal.reason); };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve(value);
    }, delay);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
