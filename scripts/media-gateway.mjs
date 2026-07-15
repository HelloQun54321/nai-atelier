import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { connect as connectSocket } from 'node:net';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const CACHE_VERSION = 'v1';
const CACHE_DIR = join(process.cwd(), 'local-cache', 'thumbnails');
const CACHE_INDEX = join(CACHE_DIR, 'index.json');
const CACHE_LIMIT = 1024 * 1024 * 1024;
const CACHE_PRUNE_TARGET = 900 * 1024 * 1024;
const SOURCE_LIMIT = 2048;
const INPUT_LIMIT = 30 * 1024 * 1024;
const GENERATION_REQUEST_LIMIT = 5 * 1024 * 1024;
const NAI_GENERATE_URL = 'https://image.novelai.net/ai/generate-image';
const ALLOWED_REMOTE_HOSTS = new Set(['ai-img.10118899.xyz', 'aitag.win']);
const THUMB_WIDTHS = new Map([['thumb-320', 320], ['thumb-640', 640]]);

const normalizeIp = value => String(value || '').replace(/^::ffff:/, '');
const isLoopbackIp = value => {
  const ip = normalizeIp(value).toLowerCase();
  return ip === '::1' || ip === 'localhost' || /^127\./.test(ip);
};
const isLoopbackHost = host => {
  const value = String(host || '').toLowerCase();
  const hostname = value.startsWith('[') ? value.slice(1, value.indexOf(']')) : value.split(':')[0];
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
};

const parseCookies = header => Object.fromEntries(String(header || '').split(';').map(part => {
  const index = part.indexOf('=');
  return index < 0 ? ['', ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
}).filter(([key]) => key));

const getForwardHost = req => {
  const requestedHost = req.headers.host || 'localhost:3000';
  if (isLoopbackIp(req.socket.remoteAddress) || !isLoopbackHost(requestedHost)) return requestedHost;
  const localAddress = normalizeIp(req.socket.localAddress) || '0.0.0.0';
  const port = requestedHost.match(/:(\d+)$/)?.[1] || '3000';
  return `${localAddress.includes(':') ? `[${localAddress}]` : localAddress}:${port}`;
};

const hasValidLanCookie = (req, secret) => {
  if (isLoopbackIp(req.socket.remoteAddress)) return true;
  if (!secret) return false;
  const token = parseCookies(req.headers.cookie).nai_lan_access;
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const [expiresAt, nonce, signature] = parts;
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Date.now() || !nonce || !signature) return false;
  const expected = createHmac('sha256', secret).update(`${expiresAt}.${nonce}`).digest('base64url');
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
};

const sendJson = (res, status, payload) => {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

const readRequestBody = (req, limit) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.setTimeout(30_000, () => req.destroy(new Error('Request body timed out')));
  req.on('data', chunk => {
    size += chunk.length;
    if (size > limit) {
      req.destroy();
      const error = new Error('Request body is too large');
      error.status = 413;
      reject(error);
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks, size)));
  req.on('error', reject);
});

const handleGenerateRequest = async (req, res, lanSecret) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) return sendJson(res, 401, { error: '缺少 NovelAI API Key' });

  try {
    const body = await readRequestBody(req, GENERATION_REQUEST_LIMIT);
    const response = await fetch(NAI_GENERATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
      },
      body,
      signal: AbortSignal.timeout(300_000),
    });
    const headers = {
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    const contentLength = response.headers.get('content-length');
    const contentDisposition = response.headers.get('content-disposition');
    if (contentLength) headers['Content-Length'] = contentLength;
    if (contentDisposition) headers['Content-Disposition'] = contentDisposition;
    res.writeHead(response.status, headers);
    if (!response.body) return res.end();
    Readable.fromWeb(response.body).on('error', error => res.destroy(error)).pipe(res);
  } catch (error) {
    if (res.headersSent) return res.destroy(error);
    if (Number(error.status)) return sendJson(res, Number(error.status), { error: error.message });
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return sendJson(res, timedOut ? 504 : 502, {
      error: timedOut
        ? '电脑连接 NovelAI 超时，请检查电脑 VPN 后重试'
        : '电脑无法连接 NovelAI，请检查电脑 VPN 是否正常连接',
      code: timedOut ? 'NAI_PROXY_TIMEOUT' : 'NAI_PROXY_UNREACHABLE',
    });
  }
};

const getValidatedSource = value => {
  const source = String(value || '');
  if (!source || source.length > SOURCE_LIMIT || /[\r\n]/.test(source)) throw new Error('Invalid image source');
  if (source.startsWith('/api/assets/')) return { type: 'local', source };
  if (/^\/api\/local-history\/[^/]+\/image(?:\?.*)?$/.test(source)) return { type: 'local', source };
  let url;
  try { url = new URL(source); } catch { throw new Error('Unsupported image source'); }
  if (url.protocol !== 'https:' || !ALLOWED_REMOTE_HOSTS.has(url.hostname.toLowerCase())) throw new Error('Remote image host is not allowed');
  return { type: 'remote', source: url.toString() };
};

const readLimitedResponse = async response => {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > INPUT_LIMIT) throw new Error('Image is too large');
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > INPUT_LIMIT) {
      await reader.cancel();
      throw new Error('Image is too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
};

const requestWorkerBuffer = (source, req, workerPort) => new Promise((resolve, reject) => {
  const upstream = httpRequest({
    hostname: '127.0.0.1',
    port: workerPort,
    path: source,
    method: 'GET',
    headers: {
      accept: 'image/*',
      cookie: req.headers.cookie || '',
      host: getForwardHost(req),
      'user-agent': req.headers['user-agent'] || 'NaiPromptManager-MediaGateway',
      'x-forwarded-for': normalizeIp(req.socket.remoteAddress),
    },
  }, async upstreamRes => {
    if ((upstreamRes.statusCode || 500) >= 400) {
      upstreamRes.resume();
      resolve({ status: upstreamRes.statusCode || 500, headers: upstreamRes.headers, buffer: Buffer.alloc(0) });
      return;
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of upstreamRes) {
        size += chunk.length;
        if (size > INPUT_LIMIT) throw new Error('Image is too large');
        chunks.push(chunk);
      }
      resolve({ status: upstreamRes.statusCode || 200, headers: upstreamRes.headers, buffer: Buffer.concat(chunks, size) });
    } catch (error) {
      upstreamRes.destroy();
      reject(error);
    }
  });
  upstream.setTimeout(20_000, () => upstream.destroy(new Error('Image request timed out')));
  upstream.on('error', reject);
  upstream.end();
});

const requestRemoteBuffer = async source => {
  let current = source;
  for (let redirects = 0; redirects < 4; redirects++) {
    const url = new URL(current);
    if (url.protocol !== 'https:' || !ALLOWED_REMOTE_HOSTS.has(url.hostname.toLowerCase())) throw new Error('Remote image redirect is not allowed');
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: { accept: 'image/*', 'user-agent': 'NaiPromptManager-MediaGateway/1.0' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Invalid image redirect');
      current = new URL(location, url).toString();
      continue;
    }
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (!response.ok) return { status: response.status, headers: { 'content-type': contentType }, buffer: Buffer.alloc(0) };
    if (!contentType.startsWith('image/')) throw new Error('Remote response is not an image');
    return { status: response.status, headers: { 'content-type': contentType }, buffer: await readLimitedResponse(response) };
  }
  throw new Error('Too many image redirects');
};

class ThumbnailCache {
  constructor() {
    this.entries = {};
    this.inFlight = new Map();
    this.activeJobs = 0;
    this.jobQueue = [];
    this.writeTimer = null;
  }

  async init() {
    await mkdir(CACHE_DIR, { recursive: true });
    try { this.entries = JSON.parse(await readFile(CACHE_INDEX, 'utf8')); } catch { this.entries = {}; }
    const files = new Set(await readdir(CACHE_DIR));
    for (const [key, entry] of Object.entries(this.entries)) {
      if (!entry?.file || !files.has(entry.file)) delete this.entries[key];
    }
    for (const file of files) {
      if (file === 'index.json' || file.endsWith('.tmp')) continue;
      if (!Object.values(this.entries).some(entry => entry.file === file)) await unlink(join(CACHE_DIR, file)).catch(() => {});
    }
    this.scheduleIndexWrite();
  }

  scheduleIndexWrite() {
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      writeFile(CACHE_INDEX, `${JSON.stringify(this.entries)}\n`, 'utf8').catch(() => {});
    }, 500);
    this.writeTimer.unref?.();
  }

  async withJobSlot(task) {
    if (this.activeJobs >= 2) await new Promise(resolve => this.jobQueue.push(resolve));
    this.activeJobs++;
    try { return await task(); } finally {
      this.activeJobs--;
      this.jobQueue.shift()?.();
    }
  }

  async prune() {
    let total = Object.values(this.entries).reduce((sum, entry) => sum + Number(entry.size || 0), 0);
    if (total <= CACHE_LIMIT) return;
    const oldest = Object.entries(this.entries).sort((a, b) => Number(a[1].accessedAt || 0) - Number(b[1].accessedAt || 0));
    for (const [key, entry] of oldest) {
      await unlink(join(CACHE_DIR, entry.file)).catch(() => {});
      total -= Number(entry.size || 0);
      delete this.entries[key];
      if (total <= CACHE_PRUNE_TARGET) break;
    }
    this.scheduleIndexWrite();
  }

  async get(source, variant, loadOriginal) {
    const key = createHash('sha256').update(`${CACHE_VERSION}|${variant}|${source}`).digest('hex');
    const existing = this.entries[key];
    if (existing) {
      try {
        const buffer = await readFile(join(CACHE_DIR, existing.file));
        existing.accessedAt = Date.now();
        this.scheduleIndexWrite();
        return buffer;
      } catch { delete this.entries[key]; }
    }
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const promise = this.withJobSlot(async () => {
      const original = await loadOriginal();
      if (original.status >= 400) {
        const error = new Error('Source image was not found');
        error.status = original.status;
        throw error;
      }
      const { default: sharp } = await import('sharp');
      const output = await sharp(original.buffer, { failOn: 'warning', limitInputPixels: 100_000_000 })
        .rotate()
        .resize({ width: THUMB_WIDTHS.get(variant), height: THUMB_WIDTHS.get(variant), fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72, effort: 4 })
        .toBuffer();
      const file = `${key}.webp`;
      const temp = join(CACHE_DIR, `${key}.${process.pid}.${Date.now()}.tmp`);
      await writeFile(temp, output);
      await rename(temp, join(CACHE_DIR, file));
      this.entries[key] = { file, size: output.length, accessedAt: Date.now(), source, variant };
      this.scheduleIndexWrite();
      await this.prune();
      return output;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
}

const proxyRequest = (req, res, workerPort) => {
  const headers = { ...req.headers };
  headers.host = getForwardHost(req);
  headers['x-forwarded-for'] = [headers['x-forwarded-for'], normalizeIp(req.socket.remoteAddress)].filter(Boolean).join(', ');
  const upstream = httpRequest({ hostname: '127.0.0.1', port: workerPort, path: req.url, method: req.method, headers }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', error => {
    if (!res.headersSent) sendJson(res, 502, { error: `Local service unavailable: ${error.message}` });
    else res.destroy(error);
  });
  req.pipe(upstream);
};

export async function createMediaGateway({ port = 3000, workerPort = 3001, lanSecret = '' } = {}) {
  const cache = new ThumbnailCache();
  await cache.init();
  const server = createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); } catch { return sendJson(res, 400, { error: 'Invalid request URL' }); }
    if (url.pathname === '/api/generate') return handleGenerateRequest(req, res, lanSecret);
    if (url.pathname !== '/api/media') return proxyRequest(req, res, workerPort);
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    if (!hasValidLanCookie(req, lanSecret)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });

    try {
      const variant = url.searchParams.get('variant') || '';
      if (variant !== 'original' && !THUMB_WIDTHS.has(variant)) return sendJson(res, 400, { error: 'Invalid image variant' });
      const validated = getValidatedSource(url.searchParams.get('source'));
      const loadOriginal = () => validated.type === 'local'
        ? requestWorkerBuffer(validated.source, req, workerPort)
        : requestRemoteBuffer(validated.source);

      if (variant === 'original') {
        const original = await loadOriginal();
        if (original.status >= 400) return sendJson(res, original.status, { error: 'Source image was not found' });
        res.writeHead(200, {
          'Content-Type': original.headers['content-type'] || 'application/octet-stream',
          'Content-Length': original.buffer.length,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(original.buffer);
      }

      const thumbnail = await cache.get(validated.source, variant, loadOriginal);
      res.writeHead(200, {
        'Content-Type': 'image/webp',
        'Content-Length': thumbnail.length,
        'Cache-Control': 'private, no-store',
        'X-Nai-Thumbnail-Bytes': thumbnail.length,
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(thumbnail);
    } catch (error) {
      sendJson(res, Number(error.status) || 502, { error: error.message || 'Image processing failed' });
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const upstream = connectSocket(workerPort, '127.0.0.1', () => {
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
      for (let i = 0; i < req.rawHeaders.length; i += 2) upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
      upstream.write('\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await createMediaGateway({
    port: Number(process.env.NAI_GATEWAY_PORT || 3000),
    workerPort: Number(process.env.NAI_WORKER_PORT || 3001),
    lanSecret: process.env.NAI_LAN_SECRET || '',
  });
  console.log(`NaiPromptManager media gateway listening on ${server.address().port}`);
}
