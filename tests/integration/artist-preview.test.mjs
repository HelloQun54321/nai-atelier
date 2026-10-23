import '../support/node-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { createMediaGateway } from '../../scripts/media-gateway.mjs';
import { updateStoragePreferences } from '../../scripts/storage-locations.mjs';

test('画师图包裁边只用于显式预览，缓存、数组图片和原图链路独立，不追裁画面深黑内容', async () => {
  const jpeg = async ({ width = 768, height = 768, margin = 80, rightMargin = margin, outer = 0, verticalMargin = 0, transition = false } = {}) => {
    const data = Buffer.alloc(width * height * 3, outer);
    for (let y = verticalMargin; y < height - verticalMargin; y++) for (let x = margin; x < width - rightMargin; x++) {
      const pixel = (y * width + x) * 3;
      data[pixel] = 180; data[pixel + 1] = 120; data[pixel + 2] = 60;
    }
    if (transition) for (let y = 0; y < height; y++) {
      for (const [right, values] of [[false, [2, 9, 9, 12, 14, 32]], [true, [4, 9, 10, 9, 6, 11, 15]]]) {
        values.forEach((value, offset) => {
          const pixel = (y * width + (right ? width - 80 - offset : 79 + offset)) * 3;
          data.fill(value, pixel, pixel + 3);
        });
      }
    }
    return sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
  };
  const padded = await jpeg(), plain = await jpeg({ margin: 0 });
  const fixtures = {
    padded: [padded, plain],
    compressed: [await jpeg({ margin: 85, rightMargin: 86, transition: true })],
    dark: [await jpeg({ margin: 160, verticalMargin: 80 })],
    noBorder: [plain],
    nearBlack: [await jpeg({ outer: 1 })],
    oneSide: [await jpeg({ rightMargin: 0 })],
    wrongSize: [await jpeg({ width: 640, height: 640 })],
    black: [await sharp({ create: { width: 768, height: 768, channels: 3, background: '#000000' } }).jpeg().toBuffer()],
    alpha: [await sharp({ create: { width: 768, height: 768, channels: 4, background: '#00000000' } }).png().toBuffer()],
    opaquePng: [await sharp(padded).png().toBuffer()],
  };
  const packJson = JSON.stringify(Object.fromEntries(Object.entries(fixtures).map(([tag, images]) => [tag, images.map(image => image.toString('base64'))])));
  const packPaths = Object.fromEntries(['v45', 'v5'].map(pack => [pack, join(process.cwd(), `${pack}-synthetic-pack`)]));
  for (const path of Object.values(packPaths)) await writeFile(path, packJson);
  await updateStoragePreferences({ artistSamplePacks: packPaths });
  const savedRequests = [];
  const worker = createServer((req, res) => {
    savedRequests.push(req.url);
    const tag = req.url.match(/\/([^/]+)\/image$/)?.[1] || req.url.split('/').at(-1).replace(/\.jpg$/, '');
    res.setHeader('Content-Type', tag === 'alpha' ? 'image/png' : 'image/jpeg');
    res.end(fixtures[tag]?.[0] || padded);
  });
  await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
  let gateway;
  try {
    gateway = await createMediaGateway({ port: 0, workerPort: worker.address().port });
    let base = `http://127.0.0.1:${gateway.address().port}`;
    let status;
    for (let i = 0; i < 200; i++) {
      status = await (await fetch(base + '/api/artist-samples/status')).json();
      if (status.packs.every(pack => pack.phase !== 'indexing')) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.deepEqual(status.packs.map(pack => pack.phase), ['ready', 'ready']);
    const sourceFor = (pack, tag = 'padded', index = 0) => `/api/artist-samples/image?pack=${pack.id}&tag=${tag}&index=${index}&revision=${pack.revision}`;
    const mediaUrl = (source, variant = 'thumb-960', preview = '') => `${base}/api/media?source=${encodeURIComponent(source)}&variant=${variant}${preview ? `&preview=${preview}` : ''}`;
    const dimensions = async response => {
      assert.equal(response.status, 200);
      const data = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(data).metadata();
      return { width: metadata.width, height: metadata.height, data };
    };
    const preview = 'artist-sample-padding-v2';
    for (const pack of status.packs) {
      const source = sourceFor(pack);
      const regularResponse = await fetch(mediaUrl(source));
      const regularEtag = regularResponse.headers.get('etag');
      const regular = await dimensions(regularResponse);
      assert.deepEqual([regular.width, regular.height], [768, 768]);
      const croppedResponse = await fetch(mediaUrl(source, 'thumb-960', preview));
      const croppedEtag = croppedResponse.headers.get('etag');
      assert.notEqual(croppedEtag, regularEtag);
      const cropped = await dimensions(croppedResponse);
      assert.deepEqual([cropped.width, cropped.height], [608, 768]);
      const legacyResponse = await fetch(mediaUrl(source, 'thumb-960', 'artist-sample-padding-v1'));
      assert.notEqual(legacyResponse.headers.get('etag'), croppedEtag);
      const legacy = await dimensions(legacyResponse);
      assert.deepEqual([legacy.width, legacy.height], [608, 768]);
      assert.equal((await fetch(mediaUrl(source, 'thumb-960', preview), { headers: { 'if-none-match': croppedEtag } })).status, 304);
      const regularAgain = await fetch(mediaUrl(source));
      assert.equal(regularAgain.headers.get('etag'), regularEtag);
      assert.deepEqual((await dimensions(regularAgain)).data, regular.data);
      const resized = await dimensions(await fetch(mediaUrl(source, 'thumb-320', preview)));
      assert.deepEqual([resized.width, resized.height], [253, 320]);
      const compressed = await dimensions(await fetch(mediaUrl(sourceFor(pack, 'compressed'), 'thumb-960', preview)));
      assert.deepEqual([compressed.width, compressed.height], [597, 768]);
      const compressedPixels = await sharp(compressed.data).removeAlpha().raw().toBuffer();
      assert.ok(compressedPixels[0] > 100);
      assert.ok(compressedPixels[(compressed.width - 1) * 3] > 100);
      assert.deepEqual(Buffer.from(await (await fetch(mediaUrl(sourceFor(pack, 'compressed'), 'original', preview))).arrayBuffer()), fixtures.compressed[0]);
      const dark = await dimensions(await fetch(mediaUrl(sourceFor(pack, 'dark'), 'thumb-960', preview)));
      assert.deepEqual([dark.width, dark.height], [610, 768]);
      const { data: darkPixels } = await sharp(dark.data).raw().toBuffer({ resolveWithObject: true });
      assert.equal(darkPixels[0], 0);
      assert.ok(darkPixels[(384 * 610 + 305) * 3] > 100);
      for (const [tag, width] of [['noBorder', 768], ['nearBlack', 768], ['oneSide', 768], ['wrongSize', 640], ['black', 768], ['alpha', 768], ['opaquePng', 768]]) {
        const image = await dimensions(await fetch(mediaUrl(sourceFor(pack, tag), 'thumb-960', preview)));
        assert.deepEqual([image.width, image.height], [width, width], `${pack.id}/${tag}`);
      }
      const lastImage = await dimensions(await fetch(mediaUrl(sourceFor(pack, 'padded', 1), 'thumb-960', preview)));
      assert.deepEqual([lastImage.width, lastImage.height], [768, 768]);
      for (const url of [base + source, mediaUrl(source, 'original'), mediaUrl(source, 'original', preview)]) {
        const response = await fetch(url);
        assert.equal(response.status, 200);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), padded);
      }
      assert.equal(await readFile(packPaths[pack.id], 'utf8'), packJson);
      assert.equal((await fetch(mediaUrl(source, 'thumb-960', 'unknown-transform'))).status, 400);
    }
    const customSource = '/api/assets/self-made.jpg';
    const custom = await dimensions(await fetch(mediaUrl(customSource)));
    assert.deepEqual([custom.width, custom.height], [768, 768]);
    const customPng = await dimensions(await fetch(mediaUrl('/api/assets/alpha.jpg', 'thumb-960', preview)));
    assert.deepEqual([customPng.width, customPng.height], [768, 768]);
    const prewarm = await fetch(base + '/api/media/prewarm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sources: status.packs.map(pack => sourceFor(pack)), preview }) });
    assert.equal((await prewarm.json()).queued, 0);

    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
    await updateStoragePreferences({ artistSamplePacks: { v45: '', v5: '' } });
    gateway = await createMediaGateway({ port: 0, workerPort: worker.address().port });
    base = `http://127.0.0.1:${gateway.address().port}`;
    const unlinked = await (await fetch(base + '/api/artist-samples/status')).json();
    assert.deepEqual(unlinked.packs.map(pack => pack.phase), ['unconfigured', 'unconfigured']);
    for (const savedSource of ['/api/inspirations/padded/image', '/api/assets/inspirations/padded.jpg']) {
      const regular = await dimensions(await fetch(mediaUrl(savedSource)));
      assert.deepEqual([regular.width, regular.height], [768, 768]);
      const croppedResponse = await fetch(mediaUrl(savedSource, 'thumb-960', preview));
      const previewEtag = croppedResponse.headers.get('etag');
      const cropped = await dimensions(croppedResponse);
      assert.deepEqual([cropped.width, cropped.height], [608, 768]);
      assert.equal((await fetch(mediaUrl(savedSource, 'thumb-960', preview), { headers: { 'if-none-match': previewEtag } })).status, 304);
      assert.deepEqual((await dimensions(await fetch(mediaUrl(savedSource)))).data, regular.data);
      for (const url of [base + savedSource, mediaUrl(savedSource, 'original'), mediaUrl(savedSource, 'original', preview)]) {
        assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), padded);
      }
    }
    assert.ok(savedRequests.includes('/api/inspirations/padded/image'));
    for (const [tag, width] of [['compressed', 597], ['dark', 610], ['noBorder', 768], ['nearBlack', 768], ['oneSide', 768], ['wrongSize', 640], ['black', 768], ['alpha', 768], ['opaquePng', 768]]) {
      const image = await dimensions(await fetch(mediaUrl(`/api/inspirations/${tag}/image`, 'thumb-960', preview)));
      assert.deepEqual([image.width, image.height], [width, tag === 'wrongSize' ? 640 : 768], `saved/${tag}`);
    }
    for (const source of ['/api/local-history/synthetic/image', '/api/vibes/synthetic/image', '/api/character-references/synthetic/image', 'https://ai-img.10118899.xyz/NAI/123/456.webp']) {
      assert.equal((await fetch(mediaUrl(source, 'thumb-960', preview))).status, 400);
    }
  } finally {
    gateway?.closeAllConnections();
    if (gateway) await new Promise(resolve => gateway.close(resolve));
    worker.closeAllConnections();
    await new Promise(resolve => worker.close(resolve));
  }
});
