import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, Client, ProxyAgent, fetch } from 'undici';

// 比通用远程抓取更严格：DNS 与实际连接使用同一份地址，逐跳验证重定向。
const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2002::', 16], ['2001::', 32]]) blocked.addSubnet(address, prefix, 'ipv6');
blocked.addAddress('::1', 'ipv6');
export const publicIp = address => Boolean(isIP(address)) && !blocked.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
const syntheticIp = address => /^198\.(18|19)\./.test(address);

/** 仅在 TUN 返回虚拟 DNS 地址时查询真实公网 IPv4，不能把虚拟网段直接放行。 */
export async function resolveCollectorPublicDns(host, { signal, proxyUrl = '', request = fetch } = {}) {
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const timeout = AbortSignal.timeout(10_000);
  try {
    const url = new URL('https://cloudflare-dns.com/dns-query');
    url.searchParams.set('name', host); url.searchParams.set('type', 'A');
    const response = await request(url, { dispatcher, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { accept: 'application/dns-json' } });
    if (!response.ok) { await response.body?.cancel(); throw new Error('公网 DNS 查询失败'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > 64 * 1024) throw new Error('公网 DNS 响应异常');
      chunks.push(chunk);
    }
    const result = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    const addresses = result.Answer?.filter(answer => answer.type === 1).map(answer => ({ address: answer.data, family: 4 })) || [];
    if (result.Status !== 0 || !addresses.length || addresses.some(a => isIP(a.address) !== 4 || !publicIp(a.address))) throw new Error('公网 DNS 未返回有效公网地址');
    return addresses;
  } finally { await dispatcher?.destroy(); }
}

/** 将网络底层错误变为可操作的一行原因，不把签名链接或堆栈带进状态窗。 */
export function collectorErrorReason(error) {
  const causes = [error, error?.cause, ...(error?.cause?.errors || [])];
  const codes = causes.flatMap(cause => [cause?.code, cause?.name]);
  if (codes.some(code => ['TimeoutError', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT'].includes(code))) return '下载超时，请检查代理或网络后手动重试';
  if (codes.some(code => ['ENOTFOUND', 'EAI_AGAIN'].includes(code))) return '域名解析失败，请检查网络或代理';
  if (codes.includes('ECONNREFUSED')) return '连接被拒绝，请检查本机服务或代理';
  if (codes.some(code => ['ECONNRESET', 'UND_ERR_SOCKET'].includes(code))) return '连接中断，请检查代理后手动重试';
  if (codes.some(code => /CERT|TLS/.test(code || ''))) return '图片连接证书校验失败';
  const message = error?.message === 'fetch failed' ? '网络请求失败，请检查代理后手动重试' : (error?.message || '处理失败');
  return message.replace(/https?:\/\/\S+/g, '图片地址').replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

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

export async function validateDownloadTarget(raw, lookupHost = lookup, publicLookup = resolveCollectorPublicDns) {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('图片地址协议或端口不允许');
  if (!host || host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) throw new Error('禁止下载本机或内网图片');
  let addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookupHost(host, { all: true, verbatim: true });
  if (!isIP(host) && addresses.some(a => syntheticIp(a.address)) && addresses.every(a => syntheticIp(a.address) || publicIp(a.address))) addresses = await publicLookup(host);
  if (!addresses.length || addresses.some(a => !publicIp(a.address))) throw new Error('禁止下载本机、内网或保留网段图片');
  return { url, address: addresses[0] };
}

export async function downloadCollectorImage(raw, { signal, maxBytes = 12 * 1024 * 1024, proxyUrl = '', lookupHost = lookup, request = fetch, publicLookup = resolveCollectorPublicDns } = {}) {
  const timeout = AbortSignal.timeout(30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let current = raw;
  for (let hop = 0; hop < 6; hop++) {
    combined.throwIfAborted();
    let abortDns;
    const canceled = new Promise((_, reject) => { abortDns = () => reject(combined.reason); combined.addEventListener('abort', abortDns, { once: true }); });
    let target;
    try { target = await Promise.race([validateDownloadTarget(current, lookupHost, host => publicLookup(host, { signal: combined, proxyUrl })), canceled]); }
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
      if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 403 ? '图片访问被拒绝 (403)，链接可能过期，请重新复制' : response.status === 404 ? '图片不存在 (404)，请重新复制链接' : `图片下载失败 (${response.status})`); }
      if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('图片超过存储大小上限'); }
      const chunks = []; let size = 0;
      for await (const chunk of response.body || []) {
        combined.throwIfAborted(); size += chunk.length;
        if (size > maxBytes) throw new Error('图片超过存储大小上限');
        chunks.push(chunk);
      }
      return { bytes: Buffer.concat(chunks, size), finalUrl: url.href };
    } finally { await dispatcher.destroy(); }
  }
  throw new Error('图片重定向次数过多');
}
