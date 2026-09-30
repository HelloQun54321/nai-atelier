import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, Client, ProxyAgent, fetch } from 'undici';

// 比通用远程抓取更严格：DNS 与实际连接使用同一份地址，逐跳验证重定向。
const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2002::', 16], ['2001::', 32]]) blocked.addSubnet(address, prefix, 'ipv6');
blocked.addAddress('::1', 'ipv6');
export const publicIp = address => Boolean(isIP(address)) && !blocked.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');

export function imageLink(text) {
  if (typeof text !== 'string' || text.length > 8192 || /\s/.test(text.trim())) return null;
  try {
    const url = new URL(text.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const path = decodeURIComponent(url.pathname);
    const attachment = ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) && /^\/attachments\/\d+\/\d+\//.test(path);
    if (!/\.(png|jpe?g|webp|gif|avif)(?:$)/i.test(path) && !attachment) return null;
    return url.href;
  } catch { return null; }
}

export async function validateDownloadTarget(raw, lookupHost = lookup) {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('图片地址协议或端口不允许');
  if (!host || host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) throw new Error('禁止下载本机或内网图片');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookupHost(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(a => !publicIp(a.address))) throw new Error('禁止下载本机、内网或保留网段图片');
  return { url, address: addresses[0] };
}

export async function downloadCollectorImage(raw, { signal, maxBytes = 12 * 1024 * 1024, proxyUrl = '', lookupHost = lookup, request = fetch } = {}) {
  const timeout = AbortSignal.timeout(30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let current = raw;
  for (let hop = 0; hop < 6; hop++) {
    combined.throwIfAborted();
    let abortDns;
    const canceled = new Promise((_, reject) => { abortDns = () => reject(combined.reason); combined.addEventListener('abort', abortDns, { once: true }); });
    let target;
    try { target = await Promise.race([validateDownloadTarget(current, lookupHost), canceled]); }
    finally { combined.removeEventListener('abort', abortDns); }
    const { url, address } = target;
    const pinned = isIP(address.address) === 6 ? `[${address.address}]` : address.address;
    const dispatcher = proxyUrl ? new ProxyAgent({ uri: proxyUrl, clientFactory(origin, options) {
      const client = new Client(origin, options);
      const connect = client.connect.bind(client);
      // CONNECT 固定到已校验 IP，TLS 仍使用原图床域名；代理不能重新解析到内网。
      client.connect = (opts, callback) => connect({ ...opts, path: `${pinned}:${url.port || (url.protocol === 'https:' ? 443 : 80)}` }, callback);
      return client;
    } }) : new Agent({ connect: { lookup(_host, opts, callback) {
      if (opts.all) callback(null, [address]); else callback(null, address.address, address.family);
    } } });
    try {
      const response = await request(url, { dispatcher, signal: combined, redirect: 'manual', headers: { accept: 'image/*' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw new Error('图片重定向缺少目标');
        current = new URL(location, url).href;
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`图片下载失败 (${response.status})`); }
      if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('图片超过存储大小上限'); }
      const chunks = []; let size = 0;
      for await (const chunk of response.body || []) {
        combined.throwIfAborted(); size += chunk.length;
        if (size > maxBytes) throw new Error('图片超过存储大小上限');
        chunks.push(chunk);
      }
      return { bytes: Buffer.concat(chunks, size), finalUrl: url.href };
    } finally { await dispatcher.close(); }
  }
  throw new Error('图片重定向次数过多');
}
