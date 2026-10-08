#!/usr/bin/env node
/** 官方协议回调只转交本机工坊；确认安全保存成功后再打开完成页，不落盘或打印授权码。 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchInDefaultBrowser, parsePixivCallbackUrl } from './pixiv-web-login.mjs';

export async function completePixivSchemeLogin(callbackUrl, {
  gatewayUrl = process.env.NAI_GATEWAY_URL || 'http://127.0.0.1:3000',
  fetch: requestFetch = globalThis.fetch,
  launchBrowser = process.env.NAI_NO_BROWSER === '1' ? async () => {} : launchInDefaultBrowser,
} = {}) {
  let target;
  try { target = new URL(gatewayUrl); } catch { return false; }
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) return false;
  const raw = String(callbackUrl || '').trim();
  if (!raw.startsWith('pixiv:') || !parsePixivCallbackUrl(raw)) return false;
  const response = await requestFetch(`${target.origin}/api/pixiv/login/complete`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callbackUrl: raw }),
    signal: AbortSignal.timeout(15_000), redirect: 'error',
  });
  if (!response.ok || (await response.json()).state !== 'connected') return false;
  await launchBrowser(`${target.origin}/pixiv-login-complete`);
  return true;
}

// 浏览器启动的新进程不继承桌面工坊端口，注册命令通过第三个参数传入。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await completePixivSchemeLogin(process.argv[2], { gatewayUrl: process.argv[3] || process.env.NAI_GATEWAY_URL || 'http://127.0.0.1:3000' }).catch(() => {});
}
