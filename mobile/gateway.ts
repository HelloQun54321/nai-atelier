import { native, bytesToBase64 } from './native';
import { db } from './storage';
import { runHandler } from './node-http';
import { json } from '../worker/routes/types';
import { thumbnailResponse } from './image';
import {
  getNaiRuntime, applyNaiRuntimeOverride, computeNaiRuntimeSync, fetchNaiRuntimeText,
  sanitizeNovelAiSubscription, cacheNovelAiSubscription, CloudQueueCoordinator,
  normalizeCloudQueuePreferences, keyHashFromAuthorization,
  handleGenerateRequest, handleGenerateStreamRequest, handleVibeEncodeRequest,
  recoverPendingVibeEncodings,
} from 'mobile:gateway';

const queue = new CloudQueueCoordinator((...args: any[]) => fetch(args[0], args[1]));
export async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<{ value: string }>();
  try { return row ? JSON.parse(row.value) : fallback; } catch { return fallback; }
}
export async function writeSetting(key: string, value: unknown) { await db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').bind(key, JSON.stringify(value)).run(); }
export async function initMobileRuntime() {
  const cached = await readSetting('mobile_nai_runtime', null);
  if (cached) applyNaiRuntimeOverride(cached);
  await recoverPendingVibeEncodings(0);
  // 记住的 Key 先进入工坊，官方同步在后台完成。
  setTimeout(() => refreshRuntime().catch(console.warn), 1000);
}
async function refreshRuntime() {
  const previous = getNaiRuntime();
  if (previous.health?.ok && Date.now() - previous.syncedAt < 86400000) return;
  try {
    const html = await fetchNaiRuntimeText('https://novelai.net/image');
    const paths = [...new Set<string>(Array.from(html.matchAll(/"(\/_next\/static\/chunks\/[^" ]+\.js)"/g), (item: RegExpMatchArray) => item[1]))];
    const texts = await Promise.all(paths.map(path => fetchNaiRuntimeText('https://novelai.net' + path)));
    const next = computeNaiRuntimeSync(texts.join('\n'));
    if (next.health.missed.length) throw new Error('官方规则未能完整提取：' + next.health.missed.join(', '));
    applyNaiRuntimeOverride({ ...next.runtime, syncedAt: Date.now(), health: next.health }); await writeSetting('mobile_nai_runtime', getNaiRuntime());
  } catch (error) {
    applyNaiRuntimeOverride({ health: { ok: false, reason: String(error) } });
    await writeSetting('mobile_nai_runtime', getNaiRuntime());
    setTimeout(() => refreshRuntime().catch(console.warn), 300000);
  }
}
export async function queuePreferences(authorization: string, next?: any) {
  const hash = keyHashFromAuthorization(authorization);
  const key = 'mobile_queue_' + hash;
  const old = normalizeCloudQueuePreferences(await readSetting(key, {}));
  if (next === undefined) return old;
  if (!hash) throw new Error('请先配置 NovelAI API Key');
  const value = normalizeCloudQueuePreferences({ ...old, ...next });
  if (next.enabled === true && !value.serviceUrl) throw new Error('请先填写公共队列服务地址');
  await writeSetting(key, value); return value;
}
export async function mobileGateway(request: Request): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname, authorization = request.headers.get('authorization') || '';
  if (path === '/api/novelai-runtime') return json(getNaiRuntime());
  if (path === '/api/novelai-subscription') {
    const response = await fetch('https://image.novelai.net/user/subscription', { headers: { authorization }, signal: request.signal });
    if (!response.ok) return response;
    const subscription = sanitizeNovelAiSubscription(await response.json()); cacheNovelAiSubscription(authorization, subscription); return json(subscription);
  }
  if (path === '/api/generation-queue/preferences') return json(await queuePreferences(authorization, request.method === 'PUT' ? await request.json() : undefined));
  if (path === '/api/generation-queue/status') { const item = queue.get(url.searchParams.get('taskId')); return item?.keyHash === keyHashFromAuthorization(authorization) ? json({ ...item, controller: undefined, keyHash: undefined }) : json({ error: '排队任务不存在' }, 404); }
  if (path === '/api/generation-queue/cancel') {
    const body = await request.json(), item = queue.get(body.taskId);
    if (item?.keyHash !== keyHashFromAuthorization(authorization)) return json({ error: '排队任务不存在' }, 404);
    if (!item.cancelable || !item.controller) return json({ error: '当前任务已不能取消' }, 409);
    item.controller.abort(new DOMException('已取消', 'AbortError'));
    queue.update(body.taskId, { phase: 'cancelled', cancelable: false, controller: null });
    return json({ status: 'ok' });
  }
  if (path === '/api/generate' || path === '/api/generate-stream') {
    const prefs = await queuePreferences(authorization);
    const handler = path.endsWith('-stream') ? handleGenerateStreamRequest : handleGenerateRequest;
    return runHandler(request, (req, res) => handler(req, res, '', 0, queue, prefs, (...args: any[]) => fetch(args[0], args[1])));
  }
  const encode = path.match(/^\/api\/vibes\/([^/]+)\/encodings$/);
  if (encode && request.method === 'POST') return runHandler(request, (req, res) => handleVibeEncodeRequest(req, res, '', 0, decodeURIComponent(encode[1]), (...args: any[]) => fetch(args[0], args[1])));
  if (path.startsWith('/api/image-tagger')) {
    const action = path === '/api/image-tagger' ? 'infer' : path.split('/').pop();
    const options = action === 'infer' ? { model: url.searchParams.get('model') || undefined, ...(url.searchParams.has('threshold') ? { threshold: Number(url.searchParams.get('threshold')) } : {}), ...(url.searchParams.has('characterThreshold') ? { characterThreshold: Number(url.searchParams.get('characterThreshold')) } : {}), data: bytesToBase64(new Uint8Array(await request.arrayBuffer())) } : request.method === 'POST' ? await request.json() : {};
    return json(await native.tagger({ action, ...options }));
  }
  if (path === '/api/media/prewarm') return json({ ok: true });
  if (path === '/api/media/cache') return json({ bytes: 0 });
  if (path === '/api/media') {
    const source = url.searchParams.get('source') || url.searchParams.get('url') || url.searchParams.get('src') || '';
    const variant = url.searchParams.get('variant') || 'original';
    if (source.startsWith('/api/')) {
      const {canUseMediaGateway}=await import('../services/mobileImageCache');
      if(!canUseMediaGateway(source))return json({error:'不支持的本地图片来源'},400);
      return thumbnailResponse(await fetch(new URL(source, location.origin),{signal:request.signal}),variant);
    }
    const { validateMediaSource } = await import('../worker/mediaValidation');
    const validated = validateMediaSource(source);
    if (!validated) return json({ error: '不支持的图片来源' }, 400);
    const headers:Record<string,string> = /pximg.net/.test(source) ? { referer: 'https://www.pixiv.net/' } : /10118899.xyz/.test(source) ? { referer: 'https://aitag.win/' } : {};
    const response = await fetch(source, { headers, signal: request.signal });
    if (!response.ok) return response;
    return thumbnailResponse(response,variant);
  }
  return null;
}
