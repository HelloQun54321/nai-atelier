// 手机网页读取使用原生网络，与模型自定义连接分别校验。
export async function validateAgentWebTarget(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || /^(localhost|.*\.(localhost|local|internal))\.?$/.test(url.hostname) || /^\[|^\d+(\.\d+){3}$/.test(url.hostname)) throw new Error('只允许不含账号和自定义端口的 HTTPS 公网页面域名');
  url.hash='';
  return { url };
}
export async function fetchAgentWebPage(raw, { signal, maxBytes = 1024 * 1024, timeoutMs = 18000 } = {}) {
  const bounded = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  let current = raw;
  for (let hop=0; hop<6; hop++) {
    const { url } = await validateAgentWebTarget(current);
    const response = await fetch(url, { signal: bounded, redirect: 'manual', headers: { accept: 'text/html,text/plain,application/json,application/xml,application/rss+xml,application/xhtml+xml', 'x-atelier-public-web': '1' } });
    if ([301,302,303,307,308].includes(response.status)) { await response.body?.cancel(); current = new URL(response.headers.get('location'), url).href; continue; }
    const mimeType = (response.headers.get('content-type') || '').split(';')[0];
    if (!response.ok || !/^(text\/(html|plain|xml)|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml))$/.test(mimeType)) { await response.body?.cancel(); throw new Error('网页返回异常或不支持的内容类型'); }
    const reader=response.body.getReader(), chunks=[]; let size=0;
    try { for (;;) { const { value,done }=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new Error('网页内容超过读取上限');chunks.push(value); } }
    finally { await reader.cancel().catch(()=>{}); }
    return { text: await new Blob(chunks).text(), mimeType, finalUrl: response.url || url.href };
  }
  throw new Error('网页重定向次数过多');
}
