#!/usr/bin/env node
/**
 * pixiv:// URL 协议处理器（Windows 注册表协议回调）。
 *
 * Pixiv 登录成功后通过 pixiv://account/login?code=… 回调（custom scheme 流程）。
 * 本脚本由注册表命令启动（node pixiv-scheme-handler.mjs "%1"），
 * 解析 code 后立即转交本机 NaiStudio 网关 /api/pixiv/login/complete 完成登录。
 *
 * 安全与可靠性约定：
 * - 只接受 pixiv://account/login 官方来源，只转发 code，不落盘、不打印任何内容。
 * - 任何失败都静默退出（code 极短命，重试无意义；登录页可重新发起）。
 * - 网关不可达时静默失败，用户可回退到地址栏/手动粘贴流程。
 */
import { request } from 'node:http';

const GATEWAY_BASE = process.env.NAI_GATEWAY_URL || 'http://127.0.0.1:3000';

const raw = String(process.argv[2] || '').trim();
let url;
try { url = new URL(raw); } catch { process.exit(0); }
if (url.protocol !== 'pixiv:' || url.host !== 'account' || url.pathname !== '/login') process.exit(0);
const code = String(url.searchParams.get('code') || '');
if (!code || code.length > 1024) process.exit(0);

const payload = JSON.stringify({ callbackUrl: raw });
const req = request(`${GATEWAY_BASE}/api/pixiv/login/complete`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  },
  timeout: 15_000,
});
req.on('response', res => {
  res.resume();
  res.on('end', () => process.exit(0));
});
req.on('error', () => process.exit(0));
req.on('timeout', () => req.destroy());
req.end(payload);
