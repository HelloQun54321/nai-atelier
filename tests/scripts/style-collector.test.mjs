import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from 'fast-png';
import { gzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import sharp from 'sharp';
import { imageLink, publicIp, validateDownloadTarget, downloadCollectorImage, resolveCollectorPublicDns, collectorErrorReason } from '../../scripts/collector-download.mjs';
import { createServer } from 'node:http';
import { StyleCollector, collectorLocalRequest } from '../../scripts/style-collector.mjs';
import { extractPngMetadata, hasCollectibleNaiMetadata } from '../../services/pngMetadata.mjs';

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
  const imports = [], actions = [];
  const manager = new StyleCollector({ platform: 'win32',
    listener: async ({ onEvent }) => { receive = onEvent; return { command: async () => {}, update: () => {}, close: () => closed++ }; },
    worker: async (action, body) => { if (action === 'position') return {}; if (action === 'session') { active = body.session; return {}; }
      assert.equal(body.session, active); imports.push(body); actions.push(action); return { outcome: 'saved' }; },
    download: async url => ({ bytes: hidden(), finalUrl: url }), ...options,
  });
  return { manager, imports, actions, copy: url => receive({ type: 'link', url }), event: event => receive(event), receiver: () => receive, closed: () => closed };
}

test('collection mode saves metadata-free links; changing modes never reroutes queued images', async t => {
  const gate = deferred(); let downloads = 0;
  const h = harness({ download: async url => { downloads++; if (downloads === 1) await gate.promise; return { bytes: plain(), finalUrl: url }; } });
  t.after(() => h.manager.command('stop')); await h.manager.command('start');
  h.copy('https://example.com/same.png');
  await h.manager.command('mode', 'collection'); h.copy('https://example.com/same.png');
  await h.manager.command('mode', 'style'); gate.resolve(); await h.manager.run.processing;
  assert.equal(downloads, 2); assert.deepEqual(h.actions, ['collection']);
  assert.equal(h.imports[0].format, 'png'); assert.equal(h.imports[0].rawMetadata, null);
  assert.equal(h.manager.state().saved, 1); assert.equal(h.manager.state().collectionSaved, 1); assert.equal(h.manager.state().mode, 'style');
});

test('copied images follow the active mode: style extracts metadata, collection keeps bytes', async t => {
  const h = harness(); t.after(() => h.manager.command('stop')); await h.manager.command('start');
  h.event({ type: 'image', image: plain().toString('base64'), mode: 'style' }); await h.manager.run.processing;
  assert.equal(h.imports.length, 0); assert.equal(h.manager.state().skipped, 1);
  const hiddenBytes = hidden();
  h.event({ type: 'image', image: hiddenBytes.toString('base64'), mode: 'style' }); await h.manager.run.processing;
  assert.equal(h.actions.at(-1), 'import'); assert.equal(h.imports.at(-1).image, hiddenBytes.toString('base64'));
  assert.equal(h.manager.state().saved, 1);
  await h.manager.command('mode', 'collection');
  for (const bytes of [plain(), await sharp(plain()).jpeg().toBuffer(), await sharp(plain()).webp().toBuffer()]) {
    h.event({ type: 'image', image: bytes.toString('base64') }); await h.manager.run.processing;
    assert.equal(h.imports.at(-1).image, bytes.toString('base64'));
  }
  assert.deepEqual(h.actions, ['import', 'collection', 'collection', 'collection']);
  h.event({ type: 'image', image: 'aW52YWxpZA==' }); await h.manager.run.processing;
  assert.equal(h.manager.state().failed, 1); assert.equal(h.imports.length, 4);
  await h.manager.command('pause'); h.event({ type: 'image', image: plain().toString('base64') });
  assert.equal(h.imports.length, 4);
});

test('copied desktop files preserve original bytes, names and metadata in both modes', async t => {
  const root = createWorkspace('collector-files-');
  t.after(() => removeWorkspace(root));
  const fixtures = [
    ['桌面 原图.PNG', withComment(plain(), generation)],
    ['second.JpEg', await sharp(plain()).jpeg().toBuffer()],
    ['third.webp', await sharp(plain()).webp().toBuffer()],
  ];
  for (const [name, bytes] of fixtures) await writeFile(join(root, name), bytes);
  const h = harness({ download: () => { throw new Error('本地文件不应下载'); } });
  t.after(() => h.manager.command('stop')); await h.manager.command('start'); await h.manager.command('mode', 'collection');
  for (const [name] of fixtures) h.event({ type: 'file', path: join(root, name), mode: 'collection' });
  await h.manager.command('mode', 'style'); await h.manager.run.processing;
  assert.deepEqual(h.actions, ['collection', 'collection', 'collection']);
  for (const [index, [name, bytes]] of fixtures.entries()) {
    assert.equal(h.imports[index].name, name); assert.equal(h.imports[index].image, bytes.toString('base64'));
    assert.equal(h.imports[index].sourceUrl, undefined); assert.equal(JSON.stringify(h.imports[index]).includes(root), false);
    assert.deepEqual(await readFile(join(root, name)), bytes);
  }
  assert.equal(JSON.parse(h.imports[0].rawMetadata).prompt, generation.prompt);
  h.event({ type: 'file', path: join(root, fixtures[0][0]), mode: 'style' }); await h.manager.run.processing;
  assert.equal(h.actions.at(-1), 'import'); assert.equal(JSON.parse(h.imports.at(-1).rawMetadata).seed, generation.seed);
  assert.equal(h.manager.state().saved, 4);
});

test('unreadable and oversized copied files do not stop the batch; folders are not traversed and pause ignores new copies', async t => {
  const root = createWorkspace('collector-file-errors-'); t.after(() => removeWorkspace(root));
  await writeFile(join(root, 'large.png'), ''); await truncate(join(root, 'large.png'), 12 * 1024 * 1024 + 1);
  await mkdir(join(root, 'folder.png')); await writeFile(join(root, 'folder.png', 'inside.png'), plain());
  await writeFile(join(root, 'valid.png'), plain());
  const h = harness(); t.after(() => h.manager.command('stop')); await h.manager.command('start'); await h.manager.command('mode', 'collection');
  for (const name of ['missing.png', 'large.png', 'folder.png', 'ignore.txt', 'valid.png']) h.event({ type: 'file', path: join(root, name) });
  h.event({ type: 'file', path: 'relative.png' });
  await h.manager.run.processing;
  assert.equal(h.manager.state().failed, 3); assert.equal(h.manager.state().saved, 1);
  assert.deepEqual(h.imports.map(item => item.name), ['valid.png']);
  await h.manager.command('pause'); h.event({ type: 'file', path: join(root, 'valid.png') });
  assert.equal(h.manager.run.queue.length, 0); assert.equal(h.imports.length, 1);
  await h.manager.command('resume'); h.event({ type: 'file', path: join(root, 'missing.png') }); await h.manager.run.processing;
  assert.match(h.manager.state().detail, /图片文件无法读取/); assert.equal(h.manager.state().detail.includes(root), false);
});

test('content mode saves original prompts directly, deduplicates copies and respects pause', async t => {
  const h = harness(); t.after(() => h.manager.command('stop'));
  await h.manager.command('start');
  const original = '  {{snow}}\r\n[smile]  ';
  h.copy(original); assert.equal(h.imports.length, 0);
  await h.manager.command('mode', 'content');
  const event = { type: 'text', mode: 'content', text: original };
  h.event(event); h.event(event); await h.manager.run.processing;
  assert.equal(h.imports[0].text, original); assert.equal(h.imports[0].name, ''); assert.equal(h.imports[0].category, '');
  assert.match(h.imports[0].id, /^[a-f0-9-]{36}$/); assert.deepEqual(h.actions, ['text']);
  assert.equal(h.manager.state().saved, 1);
  assert.equal(h.manager.state().skipped, 1); assert.equal(h.manager.state().stage, '复制文字即可收录');
  assert.equal(JSON.stringify(h.manager.state()).includes(original), false);
  await h.manager.command('category', 'appearance');
  h.event({ ...event, category: 'appearance' }); await h.manager.run.processing;
  assert.equal(h.imports.at(-1).category, 'appearance');
  await h.manager.command('pause'); h.event({ ...event, text: 'paused' });
  assert.equal(h.imports.length, 2); assert.equal(h.manager.state().stage, '已暂停');
  await h.manager.command('resume');
  for (const invalid of [{ text: ' ' }, { text: 'x'.repeat(65537) }, { category: 'invalid' }]) h.event({ ...event, ...invalid });
  assert.equal(h.manager.state().failed, 2); assert.equal(h.imports.length, 2);
  h.event({ type: 'image', mode: 'content', image: plain().toString('base64') });
  h.event({ type: 'file', mode: 'content', path: 'C:\\synthetic\\image.png' }); h.copy('https://example.com/image.png');
  assert.equal(h.manager.run.queue.length, 0); assert.equal(h.imports.length, 2);
});

test('rapid copies queue in order and keep the category captured before a mode change', async t => {
  const pending = deferred(), bodies = [];
  const h = harness({ worker: async (action, body) => { if (action === 'text') { bodies.push(body); if (bodies.length === 1) await pending.promise; return { outcome: 'saved' }; } return {}; } });
  t.after(() => h.manager.command('stop')); await h.manager.command('start');
  await h.manager.command('mode', 'content');
  h.event({ type: 'text', mode: 'content', text: 'first', category: '' });
  h.event({ type: 'text', mode: 'content', text: 'second', category: 'scene' });
  h.event({ type: 'text', mode: 'content', text: 'third', category: 'pose' });
  await h.manager.command('mode', 'collection'); await h.manager.command('pause');
  assert.equal(h.manager.state().pending, 2); pending.resolve(); await h.manager.run.processing;
  assert.deepEqual(bodies.map(({ text, category }) => [text, category]), [['first', ''], ['second', 'scene'], ['third', 'pose']]);
  assert.equal(h.manager.state().saved, 3); assert.equal(h.manager.state().stage, '已暂停');
});

test('failed text can be recopied with the same id; shutdown ignores late success and clears remaining text', async t => {
  let pending = deferred(); const ids = [];
  const h = harness({ worker: async (action, body) => { if (action === 'text') { ids.push(body.id); return pending.promise; } return {}; } });
  t.after(() => h.manager.command('stop')); await h.manager.command('start'); await h.manager.command('mode', 'content');
  const event = { type: 'text', mode: 'content', text: 'test' };
  h.event(event); pending.resolve({ outcome: 'failed' }); await h.manager.run.processing;
  assert.equal(h.manager.state().failed, 1); assert.match(h.manager.state().detail, /保存失败/);
  pending = deferred(); h.event(event); pending.resolve({ outcome: 'saved' }); await h.manager.run.processing;
  assert.equal(ids[0], ids[1]); assert.equal(h.manager.state().saved, 1);
  pending = deferred(); h.event({ ...event, text: 'late' }); h.event({ ...event, text: 'queued' });
  const stopping = h.manager.command('stop'); await until(() => h.manager.run.abort.signal.aborted);
  pending.resolve({ outcome: 'saved' }); await stopping;
  assert.equal(ids.length, 3); assert.equal(h.manager.state().saved, 1); assert.equal(h.manager.state().pending, 0);
});

test('full text queue rejects only the excess copy and accepts it after the queue drains', async t => {
  const gate = deferred(); let saves = 0;
  const h = harness({ worker: async action => { if (action === 'text') { saves++; await gate.promise; return { outcome: 'saved' }; } return {}; } });
  t.after(() => h.manager.command('stop')); await h.manager.command('start'); await h.manager.command('mode', 'content');
  for (let i = 0; i < 202; i++) h.event({ type: 'text', mode: 'content', text: String(i) });
  assert.equal(h.manager.state().pending, 200); assert.equal(h.manager.state().failed, 1);
  gate.resolve(); await h.manager.run.processing;
  h.event({ type: 'text', mode: 'content', text: '201' }); await h.manager.run.processing;
  assert.equal(saves, 202); assert.equal(h.manager.state().saved, 202);
});

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

test('interrupted proxy body waits for a new copy; pending and saved links still deduplicate', async t => {
  const bytes = hidden(); let tunnels = 0, causeCode;
  const proxy = createServer();
  proxy.on('connect', (req, socket) => {
    assert.equal(req.url, '8.8.8.8:80');
    const attempt = ++tunnels;
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () => {
      if (attempt === 1) {
        socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n');
        setTimeout(() => socket.destroy(), 10);
      } else socket.end(Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${bytes.length}\r\nConnection: close\r\n\r\n`), bytes]));
    });
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const h = harness({ download: async (url, options) => {
    try { return await downloadCollectorImage(url, { ...options, proxyUrl: `http://127.0.0.1:${proxy.address().port}`, lookupHost: async () => [{ address: '8.8.8.8', family: 4 }] }); }
    catch (error) { causeCode = error.cause?.code; throw error; }
  } });
  t.after(() => h.manager.command('stop'));
  await h.manager.command('start');
  const url = 'http://example.com/synthetic.png';
  h.copy(url); h.copy(url); await h.manager.run.processing;
  assert.equal(causeCode, 'UND_ERR_SOCKET'); assert.equal(tunnels, 1);
  assert.equal(h.manager.state().failed, 1); assert.equal(h.manager.state().skipped, 1);
  assert.equal(h.manager.state().detail, '失败：连接中断，请检查网络或代理后重新复制图片链接');
  assert.equal(h.imports.length, 0); assert.equal(h.manager.run.seen.has(url), false);
  h.copy(url); await h.manager.run.processing;
  assert.equal(tunnels, 2); assert.equal(h.manager.state().saved, 1); assert.equal(h.imports.length, 1);
  h.copy(url);
  assert.equal(tunnels, 2); assert.equal(h.manager.state().skipped, 2);
});
test('short errors distinguish timeout, DNS, proxy connection and expired links', async () => {
  assert.match(collectorErrorReason(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })), /域名解析/);
  assert.match(collectorErrorReason(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })), /连接被拒绝/);
  assert.equal(collectorErrorReason(new TypeError('terminated', { cause: { code: 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH' } })), '连接中断，请检查网络或代理后重新复制图片链接');
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
  h.copy('https://example.com/failed.png'); await until(() => h.manager.state().saved === 1);
  assert.equal(calls, 2); assert.equal(h.imports.length, 1);
  h.copy('https://example.com/plain.png'); await until(() => h.manager.state().skipped === 1);
  assert.equal(h.manager.state().detail, '跳过：未找到有效 NovelAI 生成信息');
  h.copy('https://example.com/plain.png'); assert.equal(calls, 3); assert.equal(h.manager.state().skipped, 2);
  await h.manager.command('stop');
});

test('new copy after a lost save response lets the worker report the existing image', async () => {
  let imports = 0, stored = 0;
  const h = harness({ worker: async action => {
    if (action !== 'import') return {};
    imports++;
    if (!stored) { stored++; throw new Error('synthetic lost save response'); }
    return { outcome: 'skipped' };
  } });
  await h.manager.command('start'); const url = 'https://example.com/synthetic.png';
  h.copy(url); await h.manager.run.processing;
  assert.equal(h.manager.state().failed, 1); assert.equal(imports, 1); assert.equal(stored, 1);
  h.copy(url); await h.manager.run.processing;
  assert.equal(imports, 2); assert.equal(stored, 1); assert.equal(h.manager.state().saved, 0);
  assert.equal(h.manager.state().skipped, 1); assert.equal(h.manager.state().detail, '跳过：这张原图已经收集');
  h.copy(url); assert.equal(imports, 2); assert.equal(h.manager.state().skipped, 2);
  await h.manager.command('stop');
});

test('queue capacity rejection does not mark an unqueued link as received', async () => {
  const gate = deferred(); let calls = 0;
  const h = harness({ download: async url => { calls++; await gate.promise; return { bytes: Buffer.from('synthetic non-image'), finalUrl: url }; } });
  await h.manager.command('start');
  for (let index = 0; index <= 200; index++) h.copy(`https://example.com/synthetic-${index}.png`);
  const url = 'https://example.com/overflow.png'; h.copy(url);
  assert.equal(h.manager.state().pending, 200); assert.equal(h.manager.state().failed, 1);
  assert.equal(h.manager.run.seen.has(url), false);
  gate.resolve(); await h.manager.run.processing;
  assert.equal(calls, 201);
  h.copy(url); await h.manager.run.processing;
  assert.equal(calls, 202); assert.equal(h.manager.state().skipped, 202);
  await h.manager.command('stop');
});
test('failure detail survives idle, native state matches, fresh session clears it', async () => {
  const updates = [];
  const h = harness({ listener: async ({ onEvent }) => { h.receive = onEvent; return { command: async () => {}, update: state => updates.push(state), close: () => {} }; }, download: async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); } });
  await h.manager.command('start'); h.receive({ type: 'link', url: 'https://example.com/a.png' });
  await until(() => h.manager.state().failed === 1);
  assert.equal(h.manager.state().stage, '等待复制图片或图片链接'); assert.match(h.manager.state().detail, /^失败：域名解析/);
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
  await h.manager.command('start'); assert.deepEqual({ themeMode: initial.themeMode, isDark: initial.isDark, accentColor: initial.accentColor, motion: initial.motion }, { ...light, accentColor: '#8b5cf6' });
  assert.equal(initial.language, 'zh-CN');
  const before = h.manager.state();
  await h.manager.command('appearance', { ...light, language: 'en' });
  assert.equal(updates.at(-1).appearance.labels['已保存'], 'Saved');
  assert.equal(updates.at(-1).stage, '等待复制图片或图片链接');
  assert.equal(h.manager.state().session, before.session);
  await h.manager.command('appearance', { themeMode: 'dark', isDark: true, accentColor: '#0ea5e9', motion: 'full' });
  assert.equal(h.manager.state().session, before.session); assert.equal(h.manager.state().saved, before.saved); assert.equal(updates.at(-1).appearance.themeMode, 'dark');
  await assert.rejects(h.manager.command('appearance', { ...light, accentColor: 'red' }), /外观设置无效/);
  await assert.rejects(h.manager.command('appearance', { ...light, surfaces: 'unknown' }), /外观设置无效/);
  await assert.rejects(h.manager.command('appearance', { ...light, corners: 'unknown' }), /外观设置无效/);
  await assert.rejects(h.manager.command('appearance', { ...light, accents: { dark: 'red' } }), /外观配色无效/);
  assert.equal(h.manager.state().appearance.themeMode, 'dark');
  const palette = { light: { panel: '#fff4dd', text: '#362415' }, dark: { panel: '#352c25' } };
  await h.manager.command('appearance', { ...light, palette });
  assert.deepEqual(h.manager.state().appearance.palette, palette);
  await assert.rejects(h.manager.command('appearance', { ...light, palette: { light: { panel: 'url(https://example.invalid)' } } }), /外观配色无效/);
  assert.deepEqual(h.manager.state().appearance.palette, palette);
  await h.manager.command('appearance', { themeMode: 'dark', isDark: true, accentColor: '#0ea5e9', motion: 'full' });
  assert.equal(h.manager.state().appearance.palette, undefined);
  await h.manager.command('stop'); await h.manager.command('start'); assert.equal(initial.themeMode, 'dark'); await h.manager.command('stop');
});
