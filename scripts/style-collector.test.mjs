import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from 'fast-png';
import { gzipSync } from 'node:zlib';
import { imageLink, publicIp, validateDownloadTarget, downloadCollectorImage, resolveCollectorPublicDns, collectorErrorReason } from './collector-download.mjs';
import { createServer } from 'node:http';
import { StyleCollector, collectorLocalRequest } from './style-collector.mjs';
import { extractPngMetadata, hasCollectibleNaiMetadata } from '../services/pngMetadata.mjs';

const generation = { prompt: 'artist:synthetic, scenery', uc: 'lowres', steps: 23, sampler: 'k_euler_ancestral', seed: 42, Source: 'NovelAI' };
const plain = () => Buffer.from(encode({ width: 64, height: 64, channels: 4, data: new Uint8Array(64 * 64 * 4).fill(255) }));
const hidden = (value = generation, magic = 'stealth_pngcomp') => {
  const bytes = Buffer.from(JSON.stringify({ Software: 'NovelAI', Comment: JSON.stringify(value) }));
  const payload = magic === 'stealth_pngcomp' ? gzipSync(bytes) : bytes;
  const length = Buffer.alloc(4); length.writeUInt32BE(payload.length * 8);
  const header = Buffer.concat([Buffer.from(magic), length, payload]);
  const data = new Uint8Array(64 * 64 * 4).fill(255);
  for (let i = 0; i < header.length * 8; i++) {
    const x = Math.floor(i / 64), y = i % 64;
    data[(y * 64 + x) * 4 + 3] = 254 | ((header[i >> 3] >> (7 - i % 8)) & 1);
  }
  return Buffer.from(encode({ width: 64, height: 64, channels: 4, data }));
};
const withComment = (source, value) => {
  const content = Buffer.from(`Comment\0${JSON.stringify(value)}`);
  const chunk = Buffer.alloc(content.length + 12); chunk.writeUInt32BE(content.length); chunk.write('tEXt', 4); content.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([source.subarray(0, -12), chunk, source.subarray(-12)]);
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const until = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); } throw new Error('condition timeout'); };
function harness(options = {}) {
  let receive, active = '', closed = 0;
  const imports = [];
  const manager = new StyleCollector({ platform: 'win32',
    listener: async ({ onEvent }) => { receive = onEvent; return { command: async () => {}, update: () => {}, close: () => closed++ }; },
    worker: async (action, body) => { if (action === 'position') return {}; if (action === 'session') { active = body.session; return {}; }
      assert.equal(body.session, active); imports.push(body); return { outcome: 'saved' }; },
    download: async url => ({ bytes: hidden(), finalUrl: url }), ...options,
  });
  return { manager, imports, copy: url => receive({ type: 'link', url }), event: event => receive(event), receiver: () => receive, closed: () => closed };
}

test('only complete image links qualify; signed query retained', () => {
  assert.equal(imageLink('hello'), null); assert.equal(imageLink('https://discord.com/channels/1/2/3'), null);
  assert.equal(imageLink('https://example.com/page'), null); assert.equal(imageLink('text https://example.com/a.png'), null);
  assert.equal(imageLink('https://example.com/a.png\nhttps://example.com/b.png'), null);
  assert.equal(imageLink(' https://cdn.discordapp.com/attachments/123/456/a.png?ex=abc&hm=def '), 'https://cdn.discordapp.com/attachments/123/456/a.png?ex=abc&hm=def');
});
test('local control rejects LAN clients, forged host and cross-origin pages', () => {
  const req = { socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' } };
  assert.equal(collectorLocalRequest(req), true);
  assert.equal(collectorLocalRequest({ ...req, socket: { remoteAddress: '192.168.1.2' } }), false);
  assert.equal(collectorLocalRequest({ ...req, headers: { ...req.headers, host: 'attacker.example:3000' } }), false);
  assert.equal(collectorLocalRequest({ ...req, headers: { ...req.headers, origin: 'http://localhost:4000' } }), false);
  assert.equal(collectorLocalRequest({ ...req, headers: { ...req.headers, 'sec-fetch-site': 'cross-site' } }), false);
});
test('DNS, IPv4 mapped IPv6 and redirect targets cannot reach private networks', async () => {
  for (const ip of ['127.0.0.1', '10.1.1.1', '172.31.1.1', '192.168.0.1', '::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:172.16.1.1', '::ffff:c0a8:1']) assert.equal(publicIp(ip), false, ip);
  assert.equal(publicIp('8.8.8.8'), true);
  await assert.rejects(validateDownloadTarget('https://example.com/a.png', async () => [{ address: '127.0.0.1', family: 4 }]));
  await assert.rejects(downloadCollectorImage('https://example.com/a.png', { lookupHost: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/a.png' } }) }));
});
test('bounded streaming download preserves bytes and rejects oversized content', async () => {
  const options = { lookupHost: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => new Response(new Uint8Array([1,2,3])) };
  assert.deepEqual((await downloadCollectorImage('https://example.com/a.png', options)).bytes, Buffer.from([1,2,3]));
  await assert.rejects(downloadCollectorImage('https://example.com/a.png', { ...options, maxBytes: 2 }), /上限/);
});
test('TUN synthetic DNS resolves to pinned public IP without allowing private targets', async () => {
  let resolutions = 0;
  const publicLookup = async host => { assert.equal(host, 'example.com'); resolutions++; return [{ address: '8.8.8.8', family: 4 }]; };
  const lookupHost = async () => [{ address: '198.18.1.73', family: 4 }];
  assert.equal((await validateDownloadTarget('https://example.com/a.png', lookupHost, publicLookup)).address.address, '8.8.8.8');
  await assert.rejects(validateDownloadTarget('http://198.18.1.73/a.png', lookupHost, publicLookup), /禁止/);
  await assert.rejects(validateDownloadTarget('https://example.com/a.png', async () => [{ address: '198.18.1.73', family: 4 }, { address: '127.0.0.1', family: 4 }], publicLookup), /禁止/);
  assert.equal(resolutions, 1);
  await assert.rejects(validateDownloadTarget('https://example.com/a.png', lookupHost, async () => [{ address: '192.168.1.1', family: 4 }]), /禁止/);
  await assert.rejects(downloadCollectorImage('https://example.com/a.png', { lookupHost, publicLookup, request: async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/a.png' } }) }), /禁止/);
});
test('public DNS query is bounded, signed image URL is not sent, and invalid answers reject', async () => {
  const request = async (url, options) => {
    assert.equal(url.origin, 'https://cloudflare-dns.com'); assert.equal(url.searchParams.get('name'), 'example.com');
    assert.equal(options.redirect, 'error');
    return Response.json({ Status: 0, Answer: [{ type: 5, data: 'cdn.example.com' }, { type: 1, data: '8.8.8.8' }] });
  };
  assert.deepEqual(await resolveCollectorPublicDns('example.com', { request }), [{ address: '8.8.8.8', family: 4 }]);
  for (const data of ['127.0.0.1', '198.18.1.73', 'not-an-ip']) await assert.rejects(resolveCollectorPublicDns('example.com', { request: async () => Response.json({ Status: 0, Answer: [{ type: 1, data }] }) }), /公网/);
  await assert.rejects(resolveCollectorPublicDns('example.com', { request: async () => new Response('x'.repeat(65537)) }), /响应异常/);
});
test('actual proxy tunnel pins validated IP and preserves HTTP host and signed query', async t => {
  let target, requestText = '';
  const proxy = createServer();
  proxy.on('connect', (req, socket) => {
    target = req.url; socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', data => { requestText = data.toString(); socket.end('HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nabc'); });
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const result = await downloadCollectorImage('http://example.com/a.png?signature=keep', { proxyUrl: `http://127.0.0.1:${proxy.address().port}`, lookupHost: async () => [{ address: '198.18.1.73', family: 4 }], publicLookup: async () => [{ address: '8.8.8.8', family: 4 }] });
  assert.equal(target, '8.8.8.8:80'); assert.match(requestText, /GET \/a.png\?signature=keep /); assert.match(requestText, /host: example.com/i); assert.equal(result.bytes.toString(), 'abc');
});
test('short errors distinguish timeout, DNS, proxy connection and expired links', async () => {
  assert.match(collectorErrorReason(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })), /域名解析/);
  assert.match(collectorErrorReason(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })), /连接被拒绝/);
  assert.match(collectorErrorReason(new DOMException('timeout', 'TimeoutError')), /下载超时/);
  assert.equal(collectorErrorReason(new Error('synthetic\nerror https://example.com/a.png?secret=1')), 'synthetic error 图片地址');
  await assert.rejects(downloadCollectorImage('https://example.com/a.png', { lookupHost: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => new Response(null, { status: 403 }) }), /过期/);
});
test('cancel also interrupts a stuck DNS lookup without waiting for resolution', async () => {
  for (const options of [{ lookupHost: () => new Promise(() => {}) }, { lookupHost: async () => [{ address: '198.18.1.73', family: 4 }], publicLookup: () => new Promise(() => {}) }]) {
    const controller = new AbortController();
    const download = downloadCollectorImage('https://example.com/a.png', { ...options, signal: controller.signal });
    controller.abort(); await assert.rejects(download);
  }
});
test('real PNG alpha payload decodes without Canvas in compressed and plain variants', async () => {
  for (const magic of ['stealth_pngcomp', 'stealth_pnginfo']) {
    const raw = await extractPngMetadata(hidden(generation, magic), { validatePixels: true });
    assert.equal(JSON.parse(raw).prompt, generation.prompt); assert.equal(hasCollectibleNaiMetadata(raw), true);
  }
  assert.equal(await extractPngMetadata(plain(), { validatePixels: true }), null);
  for (const value of [{ steps: 28 }, { Software: 'NovelAI' }, { prompt: 'x' }, { prompt: '', sampler: 'x', steps: 28, uc: '' }]) assert.equal(hasCollectibleNaiMetadata(JSON.stringify(value)), false);
  assert.equal(hasCollectibleNaiMetadata(JSON.stringify({ ...generation, prompt: '', v4_prompt: { caption: { base_caption: '', char_captions: [{ char_caption: '1girl' }] } } })), true);
});
test('ordinary text metadata works on Node Buffer; default-only comment cannot mask valid alpha metadata', async () => {
  const standard = await extractPngMetadata(withComment(plain(), generation), { validatePixels: true, collectibleOnly: true });
  assert.equal(JSON.parse(standard).prompt, generation.prompt);
  const fallback = await extractPngMetadata(withComment(hidden(), { steps: 28 }), { validatePixels: true, collectibleOnly: true });
  assert.equal(JSON.parse(fallback).prompt, generation.prompt);
  const damaged = withComment(plain(), generation); damaged[damaged.length - 13] ^= 1;
  await assert.rejects(extractPngMetadata(damaged, { validatePixels: true, collectibleOnly: true }), /校验/);
  const huge = plain(); huge.writeUInt32BE(40_000_001, 16);
  await assert.rejects(extractPngMetadata(huge), /像素/);
});
test('single listener, serial queue, same URL skips, ordinary text ignored', async () => {
  const gate = deferred(); let active = 0, maximum = 0;
  const h = harness({ download: async url => { active++; maximum = Math.max(maximum, active); await gate.promise; active--; return { bytes: hidden(), finalUrl: url }; } });
  await h.manager.command('start'); const session = h.manager.state().session;
  await h.manager.command('start'); assert.equal(h.manager.state().session, session);
  h.copy('ordinary text'); h.copy('https://example.com/a.png'); h.copy('https://example.com/b.png'); h.copy('https://example.com/a.png');
  assert.equal(h.manager.state().pending, 1); gate.resolve(); await until(() => h.manager.state().saved === 2);
  assert.equal(maximum, 1); assert.equal(h.manager.state().skipped, 1); await h.manager.command('stop'); assert.equal(h.closed(), 1);
});
test('pause ignores new copies but finishes queued jobs; resume only new events', async () => {
  const gate = deferred(); const h = harness({ download: async url => { await gate.promise; return { bytes: hidden(), finalUrl: url }; } });
  await h.manager.command('start'); h.copy('https://example.com/a.png'); h.copy('https://example.com/b.png'); await h.manager.command('pause');
  h.copy('https://example.com/paused.png'); gate.resolve(); await until(() => h.manager.state().saved === 2);
  assert.equal(h.manager.state().paused, true); await h.manager.command('resume'); h.copy('https://example.com/new.png');
  await until(() => h.manager.state().saved === 3); await h.manager.command('stop');
});
test('stop invalidates session and prevents late downloads; fresh start isolates old helper', async () => {
  const gate = deferred(); const h = harness({ download: async url => { await gate.promise; return { bytes: hidden(), finalUrl: url }; } });
  await h.manager.command('start'); const oldEvent = h.receiver(); h.copy('https://example.com/a.png');
  const stop = h.manager.command('stop'); await until(() => !h.manager.state().enabled); gate.resolve(); await stop;
  assert.equal(h.imports.length, 0); assert.equal(h.manager.state().failed, 0);
  await h.manager.command('start'); oldEvent({ type: 'link', url: 'https://example.com/old-listener.png' });
  assert.equal(h.manager.run.seen.size, 0); assert.equal(h.manager.state().saved, 0); await h.manager.command('stop');
});
test('no metadata skips; failures keep a reason without automatic or manual retries', async () => {
  let calls = 0; const h = harness({ download: async url => { calls++; if (url.includes('failed') && calls === 1) throw new Error('synthetic failure'); return { bytes: url.includes('plain') ? plain() : hidden(), finalUrl: url }; } });
  await h.manager.command('start'); h.copy('https://example.com/failed.png'); await until(() => h.manager.state().failed === 1);
  assert.equal(calls, 1); assert.equal(h.manager.state().saved, 0);
  assert.equal(h.manager.state().detail, '失败：synthetic failure');
  assert.equal('failures' in h.manager.state(), false);
  await assert.rejects(h.manager.command('retry', 'removed-task'), /未知收集操作/);
  assert.equal(calls, 1); assert.equal(h.imports.length, 0);
  h.copy('https://example.com/plain.png'); await until(() => h.manager.state().skipped === 1); await h.manager.command('stop');
  assert.equal(h.manager.state().detail, '跳过：未找到有效 NovelAI 生成信息');
});
test('failure detail survives idle, native state matches, fresh session clears it', async () => {
  const updates = [];
  const h = harness({ listener: async ({ onEvent }) => { h.receive = onEvent; return { command: async () => {}, update: state => updates.push(state), close: () => {} }; }, download: async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); } });
  await h.manager.command('start'); h.receive({ type: 'link', url: 'https://example.com/a.png' });
  await until(() => h.manager.state().failed === 1);
  assert.equal(h.manager.state().stage, '等待复制图片链接'); assert.match(h.manager.state().detail, /^失败：域名解析/);
  assert.equal(updates.at(-1).detail, h.manager.state().detail); assert.equal('failures' in h.manager.state(), false);
  await h.manager.command('stop'); await h.manager.command('start'); assert.equal(h.manager.state().detail, ''); await h.manager.command('stop');
});
test('skip detail distinguishes non-PNG responses, damaged images and stored duplicates', async () => {
  const damaged = withComment(plain(), generation); damaged[damaged.length - 13] ^= 1;
  const fixtures = [Buffer.from('<html>not an image</html>'), damaged, hidden()];
  for (const [index, bytes] of fixtures.entries()) {
    const h = harness({ download: async url => ({ bytes, finalUrl: url }), worker: async action => action === 'import' ? { outcome: 'skipped' } : {} });
    await h.manager.command('start'); h.copy('https://example.com/a.png'); await until(() => h.manager.state().skipped === 1);
    assert.match(h.manager.state().detail, [/不是支持收集的 PNG/, /PNG 校验失败/, /已经收集/][index]);
    assert.equal(h.manager.state().failed, 0); await h.manager.command('stop');
  }
});
test('native startup failures restore off; native disappearance stops monitoring', async () => {
  const failed = harness({ listener: async () => { throw new Error('synthetic native failure'); } });
  await assert.rejects(failed.manager.command('start')); assert.equal(failed.manager.state().enabled, false);
  const h = harness(); await h.manager.command('start'); h.event({ type: 'lost', error: 'window died' });
  await until(() => h.manager.run === null); assert.equal(h.manager.state().enabled, false);
});
test('appearance is remembered before startup and updates one active listener without resetting jobs', async () => {
  const updates = []; let initial;
  const h = harness({ listener: async ({ appearance }) => { initial = appearance; return { command: async () => {}, close: () => {}, update: state => updates.push(state) }; } });
  const light = { themeMode: 'light', isDark: false, accentColor: '#8B5CF6', motion: 'off' };
  await h.manager.command('appearance', light); assert.equal(h.manager.state().enabled, false);
  await h.manager.command('start'); assert.deepEqual(initial, { ...light, accentColor: '#8b5cf6' });
  const before = h.manager.state();
  await h.manager.command('appearance', { themeMode: 'dark', isDark: true, accentColor: '#0ea5e9', motion: 'full' });
  assert.equal(h.manager.state().session, before.session); assert.equal(h.manager.state().saved, before.saved); assert.equal(updates.at(-1).appearance.themeMode, 'dark');
  await assert.rejects(h.manager.command('appearance', { ...light, accentColor: 'red' }), /外观设置无效/);
  assert.equal(h.manager.state().appearance.themeMode, 'dark');
  await h.manager.command('stop'); await h.manager.command('start'); assert.equal(initial.themeMode, 'dark'); await h.manager.command('stop');
});
