import '../support/node-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { createMediaGateway } from '../../scripts/media-gateway.mjs';

test('画师组串参考接口读取本地资源目录，数据按版本协商缓存，例图可进入缩略图链路且管理需本机控制头', async () => {
  const cacheDir = join(process.cwd(), 'local-cache', 'artist-reference');
  const webp = await sharp({ create: { width: 263, height: 384, channels: 3, background: '#446688' } }).webp().toBuffer();
  const data = { schema_version: 1, revision: 4, updated_at: '2026-10-24T00:00:00Z', entries: [{
    entry_id: 'alpha_0001', artist: 'alpha_artist', prompt_tag: 'artist:alpha_artist', tested_prompt: 'artist:alpha_artist', tester: '合成测试者', usability: '可用', fidelity: '高',
    tags: ['涂-厚涂'], roles: ['主'], expected_effects: ['合成作用'], possible_biases: ['合成偏向'], images: ['images/alpha_0001.webp'], thumbnails: ['thumbs/alpha_0001.webp'],
  }] };
  await mkdir(join(cacheDir, 'files', 'thumbs'), { recursive: true });
  await writeFile(join(cacheDir, 'library.json'), JSON.stringify({ version: 1, fetchedAt: 1700000000000, etag: '', sourceUrl: 'synthetic', data }));
  await writeFile(join(cacheDir, 'files', 'thumbs', 'alpha_0001.webp'), webp);
  const worker = createServer((_req, res) => { res.statusCode = 404; res.end(); });
  await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
  let gateway;
  try {
    gateway = await createMediaGateway({ port: 0, workerPort: worker.address().port });
    const base = `http://127.0.0.1:${gateway.address().port}`;
    const status = await (await fetch(base + '/api/artist-reference/status')).json();
    assert.equal(status.phase, 'ready'); assert.equal(status.count, 1); assert.equal(status.revision, 4);
    assert.deepEqual(status.thumbnails, { cached: 1, total: 1 });

    const first = await fetch(base + '/api/artist-reference/data');
    assert.equal(first.status, 200);
    const etag = first.headers.get('etag');
    assert.equal(etag, `"${status.version}"`);
    const body = await first.json();
    assert.equal(body.entries[0].tag, 'alpha_artist'); assert.equal(body.entries[0].effects[0], '合成作用');
    assert.equal((await fetch(base + '/api/artist-reference/data', { headers: { 'if-none-match': etag } })).status, 304);

    const source = '/api/artist-reference/image?file=thumbs%2Falpha_0001.webp';
    const image = await fetch(base + source);
    assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/webp');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), webp);
    const thumbnail = await fetch(`${base}/api/media?source=${encodeURIComponent(source)}&variant=thumb-160`);
    assert.equal(thumbnail.status, 200);
    const resized = await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata();
    assert.ok(resized.width < 263 && Math.max(resized.width, resized.height) <= 160);
    assert.equal((await fetch(base + '/api/artist-reference/image?file=thumbs%2Fother.webp')).status, 404);
    assert.equal((await fetch(base + '/api/artist-reference/image?file=..%2Flibrary.json')).status, 400);

    const denied = await fetch(base + '/api/artist-reference/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'remove' }) });
    assert.equal(denied.status, 403);
    assert.equal((await (await fetch(base + '/api/artist-reference/status')).json()).phase, 'ready');
    assert.equal((await fetch(base + '/api/artist-reference/unknown')).status, 404);
  } finally {
    gateway?.closeAllConnections();
    if (gateway) await new Promise(resolve => gateway.close(resolve));
    worker.closeAllConnections();
    await new Promise(resolve => worker.close(resolve));
  }
});
