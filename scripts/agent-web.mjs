import { fetch } from 'undici';
import { createPinnedPublicDispatcher, validateDownloadTarget, resolveCollectorPublicDns } from './collector-download.mjs';

export async function validateAgentWebTarget(raw, lookupHost, publicLookup) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('只允许不含账号和自定义端口的 HTTPS 公网页面');
  const target = await validateDownloadTarget(url, lookupHost, publicLookup);
  target.url.hash = '';
  return target;
}

// DNS 校验与连接共享同一 IP，整个重定向链共享取消信号、时间和体积上限。
export async function fetchAgentWebPage(raw, { signal, proxyUrl = '', lookupHost, publicLookup = resolveCollectorPublicDns, request = fetch, maxBytes = 1024 * 1024, timeoutMs = 18_000 } = {}) {
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let current = raw;
  for (let hop = 0; hop < 6; hop++) {
    bounded.throwIfAborted();
    let cancel;
    const aborted = new Promise((_, reject) => { cancel = () => reject(bounded.reason); bounded.addEventListener('abort', cancel, { once: true }); });
    let target;
    try { target = await Promise.race([validateAgentWebTarget(current, lookupHost, host => publicLookup(host, { signal: bounded, proxyUrl })), aborted]); }
    finally { bounded.removeEventListener('abort', cancel); }
    bounded.throwIfAborted();
    const dispatcher = createPinnedPublicDispatcher(target.url, target.address, proxyUrl);
    try {
      const response = await request(target.url, { dispatcher, signal: bounded, redirect: 'manual', headers: { accept: 'text/html,text/plain,application/json,application/xml,application/rss+xml,application/xhtml+xml', 'user-agent': 'NAI-Atelier-Agent' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw new Error('网页重定向缺少目标');
        current = new URL(location, target.url).href;
        continue;
      }
      const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!response.ok || !(/^(text\/html|text\/plain|text\/xml|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml))$/.test(mimeType))) {
        await response.body?.cancel();
        throw new Error(!response.ok ? `网页返回 HTTP ${response.status}` : `不读取网页内容类型：${mimeType || '未声明'}`);
      }
      if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('网页内容超过读取上限'); }
      let size = 0; const chunks = [];
      for await (const chunk of response.body || []) {
        bounded.throwIfAborted(); size += chunk.length;
        if (size > maxBytes) { throw new Error('网页内容超过读取上限'); }
        chunks.push(chunk);
      }
      return { text: Buffer.concat(chunks, size).toString('utf8'), mimeType, finalUrl: target.url.href };
    } finally { await dispatcher.destroy(); }
  }
  throw new Error('网页重定向次数过多');
}
