import { test } from 'node:test';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { writeFile, readFile, readdir, unlink, mkdir, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import sharp from 'sharp';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { ARTIST_SAMPLE_PACKS, indexArtistSampleFile, createArtistSamples, validateArtistSampleSource, requestDesktopArtistSampleFile, pickArtistSampleFile } from '../../scripts/artist-samples.mjs';

const ready = async service => {
  for (let i = 0; i < 200; i++) {
    const pack = (await service.status(true)).packs[0];
    if (pack.phase !== 'indexing') return pack;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('合成索引超时');
};
const imageSource = (tag, revision, index = 0) => `/api/artist-samples/image?pack=v45&tag=${encodeURIComponent(tag)}&index=${index}&revision=${revision}`;

test('字节扫描跨每个 UTF-8、转义和数组边界，拒绝不完整或非图片数组 JSON', async () => {
  const root = createWorkspace('artist-scan-');
  try {
    const path = join(root, 'pack'), data = '{"画师\\u0020\\\"x":["YQ==","Yg=="],"empty":[],"__proto__":["Yw=="]}';
    await writeFile(path, data);
    const progress = [], entries = await indexArtistSampleFile(path, { highWaterMark: 1, onProgress: bytes => progress.push(bytes) });
    assert.equal(entries['画师 "x'].count, 2);
    const bytes = await readFile(path);
    assert.deepEqual(JSON.parse(bytes.subarray(entries['画师 "x'].start, entries['画师 "x'].end)), ['YQ==', 'Yg==']);
    assert.equal(entries.empty.count, 0); assert.equal(entries.__proto__.count, 1);
    assert.equal(progress.at(-1), bytes.length);
    for (const invalid of ['{"a":["x"]', '{"a":["x",]}', '{"a":[],}', '{"a":4}', '{"a":[4]}', '{"a":[],"a":[]}', '{"a":["\\q"]}', '{}x']) {
      await writeFile(path, invalid); await assert.rejects(indexArtistSampleFile(path, { highWaterMark: 1 }));
    }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(indexArtistSampleFile(path, { signal: controller.signal }), { name: 'AbortError' });
    await writeFile(path, data);
    const midway = new AbortController();
    await assert.rejects(indexArtistSampleFile(path, { highWaterMark: 1, signal: midway.signal, onProgress: () => midway.abort() }), { name: 'AbortError' });
  } finally { removeWorkspace(root); }
});

test('多图读取、来源、归一冲突、缓存重启、原包只读及文件变动失效', async () => {
  const root = createWorkspace('artist-service-'); let service;
  try {
    const path = join(root, 'artist_thumbnail_nai'), cacheDir = join(root, 'cache');
    const jpeg = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    const png = await sharp(jpeg).png().toBuffer();
    const raw = JSON.stringify({ '画师_(a)': [jpeg.toString('base64'), png.toString('base64')], 'A_B': [jpeg.toString('base64')], 'a b': [png.toString('base64')], corrupt: [Buffer.from([255,216,255,0]).toString('base64')], invalid: ['%%'], empty: [] });
    await writeFile(path, raw);
    let preferences = { artistSamplePacks: { v45: path } }, writes = 0;
    const options = { cacheDir, loadPreferences: async () => preferences, savePreferences: async patch => { writes++; preferences = { ...preferences, ...patch }; }, pickFile: async () => ({ cancelled: true }) };
    service = createArtistSamples(options);
    const pack = await ready(service); assert.equal(pack.phase, 'ready'); assert.equal(pack.count, 6);
    await assert.rejects(service.control('download', 'v45', 'artist_thumbnail_nai'), /无效的画师图包文件/);
    assert.equal(pack.progress, 100); assert.equal(pack.processedBytes, pack.totalBytes);
    assert.equal((await service.lookup('v45', '画师 (a)')).imageCount, 2);
    assert.equal((await service.lookup('v45', '画师 (a)')).canonicalTag, '画师_(a)');
    assert.equal((await service.lookup('v45', 'unknown')).canonicalTag, undefined);
    assert.equal((await service.lookup('v45', 'a_b')).imageCount, 0);
    assert.equal((await service.lookup('v45', 'A_B')).imageCount, 1);
    assert.equal((await service.lookup('v45', 'unknown')).imageCount, 0);
    assert.equal((await service.lookup('v5', '画师_(a)')).imageCount, 0);
    assert.match((await service.lookup('v45', '画师_(a)')).sourceUrl, /^https:\/\/huggingface.co\//);
    assert.deepEqual((await service.readImage(imageSource('画师_(a)', pack.revision, 0))).buffer, jpeg);
    assert.deepEqual((await service.readImage(imageSource('画师_(a)', pack.revision, 1))).buffer, png);
    await assert.rejects(service.readImage(imageSource('画师_(a)', pack.revision, 2)), /未找到/);
    await assert.rejects(service.readImage(imageSource('corrupt', pack.revision)), /损坏/);
    await assert.rejects(service.readImage(imageSource('invalid', pack.revision)), /Base64/);
    assert.equal((await service.status(false)).packs[0].path, undefined);
    assert.equal((await service.catalog('v45')).tags.length, 6);
    assert.equal((await service.control('pick', 'v45')).cancelled, true); assert.equal(writes, 0);
    service.close(); service = createArtistSamples(options);
    assert.equal((await ready(service)).revision, pack.revision); assert.equal(writes, 0);
    service.close();
    for (const file of await readdir(cacheDir)) await unlink(join(cacheDir, file));
    service = createArtistSamples(options); assert.equal((await ready(service)).phase, 'ready');
    assert.equal(await readFile(path, 'utf8'), raw);
    await writeFile(path, JSON.stringify({ changed: [] }));
    assert.equal((await service.lookup('v45', '画师_(a)')).imageCount, 0);
    assert.equal((await service.status(false)).packs[0].phase, 'error');
    await assert.rejects(service.readImage(imageSource('画师_(a)', pack.revision)), /失效/);
    await service.control('reindex', 'v45'); assert.equal((await ready(service)).count, 1);
    await service.control('remove', 'v45'); assert.equal((await service.status(true)).packs[0].phase, 'unconfigured');
    assert.equal(await readFile(path, 'utf8'), JSON.stringify({ changed: [] })); assert.equal(writes, 1);
  } finally { service?.close(); removeWorkspace(root); }
});

test('控制接口取消可重建，选择只保存注册路径，缓存损坏自动重新扫描', async () => {
  const root = createWorkspace('artist-control-'); let service;
  try {
    const path = join(root, 'NAID5-33000-55000-Curated'); await writeFile(path, '{"new":[]}');
    let preferences = {}, calls = 0;
    const cacheDir = join(root, 'cache');
    const options = { cacheDir, loadPreferences: async () => preferences, savePreferences: async patch => { preferences = { ...preferences, ...patch }; calls++; }, pickFile: async () => ({ path, cancelled: false }) };
    service = createArtistSamples(options);
    await service.control('pick', 'v45'); await service.control('cancel', 'v45');
    assert.equal((await service.status(true)).packs[0].phase, 'error'); assert.equal(calls, 1);
    await service.control('reindex', 'v45'); assert.equal((await ready(service)).phase, 'ready');
    assert.equal(preferences.artistSamplePacks.v45, path);
    service.close();
    for (const file of await readdir(cacheDir)) await writeFile(join(cacheDir, file), '{broken');
    service = createArtistSamples(options); assert.equal((await ready(service)).phase, 'ready');
    await assert.rejects(service.control('other', 'v45'), /未知/);
    await assert.rejects(service.lookup('other', 'new'), /未知/);
  } finally { service?.close(); removeWorkspace(root); }
});

test('索引中与完成状态统一使用0到100的字节进度百分比', async () => {
  const root = createWorkspace('artist-progress-'); let service;
  try {
    const path = join(root, 'pack');
    await writeFile(path, JSON.stringify({ synthetic: ['YQ=='.repeat(2 * 1024 * 1024)] }));
    const fileBytes = (await stat(path)).size, reports = [];
    await indexArtistSampleFile(path, { onProgress: bytes => reports.push(bytes) });
    assert.ok(reports.some(bytes => bytes > 0 && bytes < fileBytes));
    assert.equal(reports.at(-1), fileBytes);
    service = createArtistSamples({ cacheDir: join(root, 'cache'), loadPreferences: async () => ({ artistSamplePacks: { v45: path } }), savePreferences: async () => {} });
    for (let i = 0; i < 1000; i++) {
      const pack = (await service.status(true)).packs[0];
      assert.ok(pack.progress >= 0 && pack.progress <= 100);
      if (pack.phase === 'indexing' && pack.processedBytes > 0 && pack.processedBytes < pack.totalBytes) {
        assert.equal(pack.progress, pack.processedBytes / pack.totalBytes * 100);
      }
      if (pack.phase === 'ready') { assert.equal(pack.progress, 100); break; }
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    const completed = await ready(service);
    assert.equal(completed.progress, 100); assert.equal(completed.processedBytes, completed.totalBytes);
  } finally { service?.close(); removeWorkspace(root); }
});

test('图片地址只接受注册包、Tag、索引及版本，拒绝任意文件路径与重复参数', () => {
  const source = imageSource('画师_(a)', 'a'.repeat(24));
  assert.equal(validateArtistSampleSource(source).searchParams.get('tag'), '画师_(a)');
  for (const invalid of [source + '&path=C:/private', source + '&tag=other', source.replace('v45', 'v3'), source.replace('index=0', 'index=-1'), source.replace('a'.repeat(24), 'old'), '/api/artist-samples/image']) assert.throws(() => validateArtistSampleSource(invalid));
});

test('安装版文件选择器按请求关联取消、断开与超时并清理监听', async () => {
  const channel = new EventEmitter(); channel.connected = true; let request;
  channel.send = message => { request = message; };
  const pending = requestDesktopArtistSampleFile(channel, 'C:\\合成');
  channel.emit('message', { type: 'atelier-artist-file-result', requestId: 'wrong', result: { path: 'wrong' } });
  channel.emit('message', { type: 'atelier-artist-file-result', requestId: request.requestId, result: { cancelled: true, path: '' } });
  assert.deepEqual(await pending, { cancelled: true, path: '' }); assert.equal(channel.listenerCount('message'), 0);
  await assert.rejects(requestDesktopArtistSampleFile(channel, '', 1), /超时/);
  const disconnected = requestDesktopArtistSampleFile(channel); channel.emit('disconnect'); await assert.rejects(disconnected, /中断/);
  assert.equal(channel.listenerCount('message'), 0); assert.equal(channel.listenerCount('disconnect'), 0);
});

test('Windows源码无扩展名文件选择使用隐藏后台，取消不触发写入，超时释放锁', { skip: process.platform !== 'win32' }, async () => {
  const result = await pickArtistSampleFile('', async (_command, args, options) => {
    assert.equal(options.windowsHide, true); assert.equal(options.timeout, 300000);
    assert.match(Buffer.from(args.at(-1), 'base64').toString('utf16le'), /OpenFileDialog/);
    return { stdout: 'C:\\合成\\artist_thumbnail_nai' };
  });
  assert.equal(result.path, 'C:\\合成\\artist_thumbnail_nai');
  await assert.rejects(pickArtistSampleFile('', async () => { throw Object.assign(new Error('timeout'), { killed: true }); }), /超时/);
  assert.equal((await pickArtistSampleFile('', async () => ({ stdout: '' }))).cancelled, true);
});

const waitPack = async (service, predicate) => {
  for (let i = 0; i < 400; i++) {
    const pack = (await service.status(true)).packs[0];
    if (predicate(pack)) return pack;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('合成图包状态等待超时');
};
const waitForFileBytes = async (path, expected) => {
  for (let i = 0; i < 400; i++) {
    const size = await stat(path).then(info => info.size).catch(error => { if (error.code === 'ENOENT') return 0; throw error; });
    if (size >= expected) return size;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('合成续传副本写入等待超时');
};
async function downloadableFixture(root) {
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
  const bytes = Buffer.from(JSON.stringify({ newtag: [image.toString('base64'), image.toString('base64')] }));
  const registry = ARTIST_SAMPLE_PACKS.map(pack => ({ ...pack, ...(pack.files?.find(file => file.sourceId === 'v5-full-55000-q') || {}), files: undefined, sourceId: pack.id === 'v5' ? 'v5-full-55000-q' : pack.sourceId, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
  let preferences = {}, saves = 0;
  const options = { cacheDir: join(root, 'artist-samples'), registry, loadPreferences: async () => preferences, savePreferences: async patch => { preferences = { ...preferences, ...patch }; saves++; } };
  return { options, bytes, image, preferences: () => preferences, saves: () => saves, configure: next => { preferences = next; }, path: join(options.cacheDir, 'packs', registry[0].filename) };
}

test('工坊下载校验后自动关联并索引，多图取样与资源分盘跟随managed标记', async () => {
  const root = createWorkspace('artist-download-'); let service;
  try {
    const f = await downloadableFixture(root); let requests = 0;
    service = createArtistSamples({ ...f.options, fetchRemote: async url => {
      requests++; assert.match(url, /\/resolve\/25e2826178464c2d49bdcca5ca6cbe44dcd9f162\/NAIA\/NAID4\.5_artist_thumbnail_31000\/artist_thumbnail_nai$/);
      return new Response(f.bytes, { headers: { 'content-length': String(f.bytes.length) } });
    } });
    await service.control('download', 'v45');
    const pack = await waitPack(service, value => value.phase === 'ready' && value.download.stage === 'ready');
    assert.equal(pack.managed, true); assert.equal(pack.download.receivedBytes, f.bytes.length);
    assert.equal(f.preferences().artistSamplePacks.v45, 'managed'); assert.equal(f.saves(), 1);
    assert.equal(pack.path, f.path); assert.deepEqual(await readFile(f.path), f.bytes);
    assert.equal((await service.status(true)).downloadDirectory, join(f.options.cacheDir, 'packs'));
    assert.equal((await service.status(false)).downloadDirectory, undefined);
    assert.deepEqual((await service.readImage(imageSource('newtag', pack.revision, 1))).buffer, f.image);
    await service.close();
    const relocated = join(root, 'relocated', 'artist-samples'); await mkdir(join(relocated, 'packs'), { recursive: true });
    await copyFile(f.path, join(relocated, 'packs', f.options.registry[0].filename));
    service = createArtistSamples({ ...f.options, cacheDir: relocated, fetchRemote: () => { throw new Error('重启不得自动联网'); } });
    assert.equal((await ready(service)).phase, 'ready');
    assert.equal((await service.status(true)).packs[0].path, join(relocated, 'packs', f.options.registry[0].filename));
    assert.equal(requests, 1); assert.equal(f.saves(), 1);
    await service.control('remove', 'v45'); assert.deepEqual(await readFile(f.path), f.bytes);
    await assert.rejects(service.control('download', '../escape'), /未知/);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('大小与摘要失败不替换旧可用图包，不破坏浏览索引', async () => {
  const root = createWorkspace('artist-download-fail-'); let service;
  try {
    const f = await downloadableFixture(root); const old = Buffer.from(f.bytes.toString().replace('newtag', 'oldtag'));
    await mkdir(join(f.options.cacheDir, 'packs'), { recursive: true }); await writeFile(f.path, old);
    f.configure({ artistSamplePacks: { v45: 'managed' } });
    let lengthWrong = true;
    service = createArtistSamples({ ...f.options, fetchRemote: async () => lengthWrong ? new Response(f.bytes, { headers: { 'content-length': String(f.bytes.length + 1) } }) : new Response(Buffer.alloc(f.bytes.length)) });
    assert.equal((await ready(service)).phase, 'ready');
    await service.control('download', 'v45');
    let pack = await waitPack(service, value => value.download.stage === 'error');
    assert.match(pack.download.error, /长度/); assert.equal(pack.phase, 'ready'); assert.deepEqual(await readFile(f.path), old);
    lengthWrong = false; await service.control('download', 'v45');
    pack = await waitPack(service, value => value.download.stage === 'error');
    assert.match(pack.download.error, /SHA-256/); assert.equal(pack.phase, 'ready');
    assert.equal((await service.lookup('v45', 'oldtag')).imageCount, 2); assert.deepEqual(await readFile(f.path), old); assert.equal(f.saves(), 0);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('暂停与断流保留副本，重启仅显示可继续，Range续传完成且重复点击幂等', async () => {
  for (const mode of ['pause', 'network', 'close']) {
    const root = createWorkspace('artist-resume-'); let service;
    try {
      const f = await downloadableFixture(root); let requests = 0, streamController;
      service = createArtistSamples({ ...f.options, fetchRemote: async () => {
        requests++;
        return new Response(new ReadableStream({ start(controller) { streamController = controller; controller.enqueue(f.bytes.subarray(0, 16)); } }));
      } });
      await service.control('download', 'v45'); await waitPack(service, value => value.download.receivedBytes === 16);
      await waitForFileBytes(`${f.path}.download`, 16);
      await service.control('download', 'v45'); assert.equal(requests, 1);
      await assert.rejects(service.control('download', 'v5'), error => error.status === 409);
      await assert.rejects(service.control('remove', 'v5'), error => error.status === 409);
      await assert.rejects(service.control('pick', 'v45'), error => error.status === 409);
      if (mode === 'pause') await service.control('pause', 'v45');
      else if (mode === 'network') { streamController.error(new Error('合成网络断流')); await waitPack(service, value => value.download.stage === 'error'); }
      else await service.close();
      const pack = (await service.status(true)).packs[0]; assert.equal(pack.download.stage, mode === 'network' ? 'error' : 'paused');
      assert.equal((await stat(`${f.path}.download`)).size, 16); assert.equal(f.saves(), 0);
      await service.close();
      service = createArtistSamples({ ...f.options, fetchRemote: async (_url, options) => {
        requests++; assert.equal(options.headers.range, 'bytes=16-');
        return new Response(f.bytes.subarray(16), { status: 206, headers: { 'content-range': `bytes 16-${f.bytes.length - 1}/${f.bytes.length}`, 'content-length': String(f.bytes.length - 16) } });
      } });
      assert.equal((await service.status(true)).packs[0].download.stage, 'paused'); assert.equal(requests, 1);
      await service.control('download', 'v45'); await waitPack(service, value => value.phase === 'ready' && value.download.stage === 'ready');
      assert.equal(requests, 2); assert.deepEqual(await readFile(f.path), f.bytes); assert.equal(f.saves(), 1);
      await assert.rejects(stat(`${f.path}.download`), { code: 'ENOENT' });
    } finally { await service?.close(); removeWorkspace(root); }
  }
});

test('校验完成后的慢配置读写仍显示verifying，关联和索引开始后才ready', async () => {
  const root = createWorkspace('artist-associate-'); let service, releaseLoad, releaseSave;
  try {
    const f = await downloadableFixture(root); let loads = 0, saving = false;
    const loaded = new Promise(resolve => { releaseLoad = resolve; });
    const saved = new Promise(resolve => { releaseSave = resolve; });
    service = createArtistSamples({ ...f.options, fetchRemote: async () => new Response(f.bytes),
      loadPreferences: async () => { if (++loads > 1) await loaded; return f.preferences(); },
      savePreferences: async patch => { saving = true; await saved; await f.options.savePreferences(patch); } });
    await service.control('download', 'v45');
    let pack = await waitPack(service, value => loads === 2 && value.download.stage === 'verifying');
    assert.equal(pack.phase, 'unconfigured'); assert.equal(pack.managed, false); assert.equal(pack.download.receivedBytes, f.bytes.length);
    releaseLoad();
    pack = await waitPack(service, value => saving && value.download.stage === 'verifying');
    assert.equal(pack.phase, 'unconfigured'); assert.equal(pack.managed, false);
    releaseSave();
    pack = await waitPack(service, value => value.download.stage === 'ready');
    assert.equal(pack.managed, true); assert.ok(['indexing', 'ready'].includes(pack.phase));
    assert.equal((await ready(service)).phase, 'ready');
  } finally { releaseLoad?.(); releaseSave?.(); await service?.close(); removeWorkspace(root); }
});

test('下载超时是可继续错误而非用户暂停，并从实际已写入字节续传', async () => {
  const root = createWorkspace('artist-timeout-'); let service;
  try {
    const f = await downloadableFixture(root); let requests = 0;
    service = createArtistSamples({ ...f.options, downloadTimeoutMs: 100, fetchRemote: async (_url, options) => {
      if (++requests === 1) return new Response(new ReadableStream({ start(controller) { controller.enqueue(f.bytes.subarray(0, 16)); } }));
      assert.equal(options.headers.range, 'bytes=16-');
      return new Response(f.bytes.subarray(16), { status: 206, headers: { 'content-range': `bytes 16-${f.bytes.length - 1}/${f.bytes.length}` } });
    } });
    await service.control('download', 'v45');
    const pack = await waitPack(service, value => value.download.stage === 'error');
    assert.match(pack.download.error, /下载超时.*继续下载/);
    assert.equal(pack.download.receivedBytes, 16); assert.equal((await stat(`${f.path}.download`)).size, 16);
    await service.control('download', 'v45'); await waitPack(service, value => value.phase === 'ready');
    assert.equal(requests, 2); assert.deepEqual(await readFile(f.path), f.bytes);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('持续分块有进度的慢下载超过无进度期限仍完成校验与关联', async () => {
  const root = createWorkspace('artist-slow-progress-'); let service;
  try {
    const f = await downloadableFixture(root), timeoutMs = 150, startedAt = Date.now();
    service = createArtistSamples({ ...f.options, downloadTimeoutMs: timeoutMs, fetchRemote: async () => {
      let offset = 0;
      const chunkSize = Math.ceil(f.bytes.length / 6);
      return new Response(new ReadableStream({ async pull(controller) {
        await new Promise(resolve => setTimeout(resolve, 50));
        const end = Math.min(offset + chunkSize, f.bytes.length);
        controller.enqueue(f.bytes.subarray(offset, end)); offset = end;
        if (offset === f.bytes.length) controller.close();
      } }));
    } });
    await service.control('download', 'v45');
    const pack = await waitPack(service, value => value.phase === 'ready' || value.download.stage === 'error');
    assert.ok(Date.now() - startedAt > timeoutMs);
    assert.equal(pack.download.stage, 'ready'); assert.equal(pack.phase, 'ready'); assert.equal(pack.managed, true);
    assert.deepEqual(await readFile(f.path), f.bytes); assert.equal(f.saves(), 1);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('V5 Full 独立来源经摘要与索引确认后接入，旧 Curated 地址跨切换和重启仍读取原图', async () => {
  const root = createWorkspace('artist-v5-full-'); let service;
  try {
    const f = await downloadableFixture(root);
    const definition = f.options.registry.find(pack => pack.id === 'v5');
    const registry = [definition], options = { ...f.options, registry };
    const legacyPath = join(options.cacheDir, 'packs', 'NAID5-33000-55000-Curated');
    const legacyBytes = Buffer.from(f.bytes.toString().replace('newtag', 'oldtag'));
    await mkdir(join(options.cacheDir, 'packs'), { recursive: true });
    await writeFile(legacyPath, legacyBytes);
    f.configure({ artistSamplePacks: { v5: 'managed' } });
    service = createArtistSamples({ ...options, fetchRemote: async url => {
      assert.match(url, /NAID5F-55000-Q$/); return new Response(f.bytes);
    } });
    const legacy = await ready(service);
    assert.equal(legacy.model, undefined);
    assert.equal(legacy.filename, 'NAID5-33000-55000-Curated');
    assert.equal(legacy.download.stage, 'missing');
    assert.deepEqual((await service.catalog('v5')).tags, []);
    assert.equal((await service.lookup('v5', 'oldtag')).imageCount, 0);
    const oldSource = imageSource('oldtag', legacy.revision, 1).replace('pack=v45', 'pack=v5');
    assert.deepEqual((await service.readImage(oldSource)).buffer, f.image);
    await service.control('download', 'v5');
    const full = await waitPack(service, pack => pack.download.stage === 'ready' && pack.model === 'nai-diffusion-5-full');
    assert.equal(full.phase, 'ready'); assert.notEqual(full.revision, legacy.revision);
    assert.equal(f.preferences().artistSamplePacks.v5, 'managed:v5-full-55000-q');
    assert.equal((await service.catalog('v5')).model, 'nai-diffusion-5-full');
    assert.deepEqual((await service.catalog('v5')).tags, ['newtag']);
    assert.equal((await service.lookup('v5', 'newtag')).model, 'nai-diffusion-5-full');
    assert.deepEqual((await service.readImage(oldSource)).buffer, f.image);
    await service.close();
    service = createArtistSamples({ ...options, fetchRemote: () => { throw new Error('不得自动下载'); } });
    assert.equal((await ready(service)).model, 'nai-diffusion-5-full');
    assert.deepEqual((await service.readImage(oldSource)).buffer, f.image);
    assert.deepEqual(await readFile(legacyPath), legacyBytes);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('V5 未知文件不冒充 Full，选错来源不写偏好，下载失败保留旧来源与地址', async () => {
  const root = createWorkspace('artist-v5-wrong-'); let service;
  try {
    const f = await downloadableFixture(root), registry = [f.options.registry.find(pack => pack.id === 'v5')];
    const path = join(root, 'unknown-pack');
    const old = Buffer.from(f.bytes.toString().replace('newtag', 'oldtag'));
    await writeFile(path, old); f.configure({ artistSamplePacks: { v5: path } });
    service = createArtistSamples({ ...f.options, registry, pickFile: async () => ({ path, cancelled: false }), fetchRemote: async () => new Response(Buffer.alloc(f.bytes.length)) });
    const initial = await ready(service);
    assert.equal(initial.model, undefined); assert.deepEqual((await service.catalog('v5')).tags, []);
    const source = imageSource('oldtag', initial.revision).replace('pack=v45', 'pack=v5');
    await assert.rejects(service.control('pick', 'v5'), /已核实.*Full/);
    assert.equal(f.saves(), 0);
    await service.control('download', 'v5');
    const failed = await waitPack(service, pack => pack.download.stage === 'error');
    assert.equal(failed.model, undefined); assert.equal(failed.revision, initial.revision);
    assert.equal(f.preferences().artistSamplePacks.v5, path);
    assert.deepEqual((await service.readImage(source)).buffer, f.image);
    assert.deepEqual(await readFile(path), old);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('V5 本地已核实 Full 选择保留物理页，错误 JSON 不会激活或保存', async () => {
  const root = createWorkspace('artist-v5-pick-'); let service;
  try {
    const f = await downloadableFixture(root), definition = f.options.registry.find(pack => pack.id === 'v5');
    const path = join(root, 'full'); await writeFile(path, f.bytes);
    service = createArtistSamples({ ...f.options, registry: [definition], pickFile: async () => ({ path, cancelled: false }) });
    await service.control('pick', 'v5');
    const full = await ready(service); assert.equal(full.model, 'nai-diffusion-5-full'); assert.equal(full.managed, false);
    assert.equal((await service.lookup('v5', 'newtag')).imageCount, 2);
    const source = imageSource('newtag', full.revision, 1).replace('pack=v45', 'pack=v5');
    assert.deepEqual((await service.readImage(source)).buffer, f.image);
    assert.equal(f.preferences().artistSamplePacks.v5, path);
    await service.close();
    const broken = Buffer.from('{"broken":'); await writeFile(path, broken);
    const invalid = { ...definition, size: broken.length, sha256: createHash('sha256').update(broken).digest('hex') };
    f.configure({});
    service = createArtistSamples({ ...f.options, registry: [invalid], fetchRemote: async () => new Response(broken) });
    await service.control('download', 'v5');
    const pack = await waitPack(service, value => value.download.stage === 'error');
    assert.equal(pack.model, undefined); assert.equal(pack.phase, 'unconfigured');
    assert.equal(f.preferences().artistSamplePacks?.v5, undefined);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('V5 Full 暂停不改旧 managed，重建索引不能将改写文件冒充 Full', async () => {
  const root = createWorkspace('artist-v5-pause-'); let service;
  try {
    const f = await downloadableFixture(root), definition = f.options.registry.find(pack => pack.id === 'v5');
    const legacyPath = join(f.options.cacheDir, 'packs', 'NAID5-33000-55000-Curated');
    await mkdir(join(f.options.cacheDir, 'packs'), { recursive: true });
    await writeFile(legacyPath, f.bytes); f.configure({ artistSamplePacks: { v5: 'managed' } });
    service = createArtistSamples({ ...f.options, registry: [definition], fetchRemote: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(f.bytes.subarray(0, 16)); } })) });
    const legacy = await ready(service);
    await service.control('download', 'v5'); await waitPack(service, value => value.download.receivedBytes === 16);
    await service.control('pause', 'v5');
    const paused = await waitPack(service, value => value.download.stage === 'paused');
    assert.equal(paused.model, undefined); assert.equal(paused.revision, legacy.revision);
    assert.equal(f.preferences().artistSamplePacks.v5, 'managed'); assert.equal(f.saves(), 0);
    assert.deepEqual(await readFile(legacyPath), f.bytes);
    await service.close();
    const path = join(root, 'full'); await writeFile(path, f.bytes);
    f.configure({ artistSamplePacks: { v5: path } });
    service = createArtistSamples({ ...f.options, registry: [definition] });
    assert.equal((await ready(service)).model, 'nai-diffusion-5-full');
    await writeFile(path, Buffer.from(f.bytes.toString().replace('newtag', 'oldtag')));
    await service.control('reindex', 'v5');
    const failed = await ready(service); assert.equal(failed.phase, 'error');
    assert.match(failed.error, /来源校验失败/);
    assert.deepEqual((await service.catalog('v5')).tags, []);
    assert.equal((await service.lookup('v5', 'oldtag')).imageCount, 0);
  } finally { await service?.close(); removeWorkspace(root); }
});

async function groupedFixture(root) {
  const f = await downloadableFixture(root), single = f.options.registry.find(pack => pack.id === 'v5');
  const otherImage = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ee5577' } }).png().toBuffer();
  const firstBytes = Buffer.from(JSON.stringify({ newtag: [otherImage.toString('base64')], first: [otherImage.toString('base64')] }));
  const files = [
    { sourceId: 'v5-full-33000-q', filename: 'NAID5F-33000-Q', sourcePath: 'synthetic/NAID5F-33000-Q', size: firstBytes.length, sha256: createHash('sha256').update(firstBytes).digest('hex') },
    { ...single, files: undefined },
  ];
  const group = { ...single, sourceId: 'v5-full-33000-55000-q', files, size: files.reduce((sum, file) => sum + file.size, 0) };
  return { ...f, single, group, firstBytes, otherImage, options: { ...f.options, registry: [group] } };
}

test('Full 多片同名 Tag 稳定拼接物理页，保留旧单包地址并跨重启复用合集', async () => {
  const root = createWorkspace('artist-group-'); let service;
  try {
    const f = await groupedFixture(root);
    service = createArtistSamples({ ...f.options, registry: [f.single], fetchRemote: async () => new Response(f.bytes) });
    await service.control('download', 'v5');
    const single = await waitPack(service, pack => pack.phase === 'ready');
    const oldSource = imageSource('newtag', single.revision, 1).replace('pack=v45', 'pack=v5');
    await service.close();
    let calls = 0;
    service = createArtistSamples({ ...f.options, fetchRemote: async url => { calls++; assert.match(url, /NAID5F-33000-Q$/); return new Response(f.firstBytes); } });
    assert.deepEqual((await service.catalog('v5')).tags, []);
    assert.deepEqual((await service.readImage(oldSource)).buffer, f.image);
    await service.control('download', 'v5');
    const group = await waitPack(service, pack => pack.phase === 'ready' && pack.model === 'nai-diffusion-5-full' && !service.downloading());
    assert.equal(calls, 1); assert.equal(group.download.totalBytes, f.group.size);
    assert.equal(group.download.receivedBytes, f.group.size);
    assert.deepEqual(f.preferences().artistSamplePacks.v5, { sourceId: f.group.sourceId, files: Object.fromEntries(f.group.files.map(file => [file.filename, 'managed'])) });
    const lookup = await service.lookup('v5', 'newtag'); assert.equal(lookup.imageCount, 2);
    for (const index of [0, 1]) {
      const source = imageSource('newtag', group.revision, index).replace('pack=v45', 'pack=v5');
      assert.deepEqual((await service.readImage(source)).buffer, index === 0 ? f.otherImage : f.image);
    }
    assert.deepEqual((await service.readImage(oldSource)).buffer, f.image);
    await service.close();
    service = createArtistSamples({ ...f.options, fetchRemote: () => { throw new Error('不得联网'); } });
    const restarted = await ready(service); assert.equal(restarted.revision, group.revision);
    assert.equal((await service.lookup('v5', 'newtag')).imageCount, 2);
    assert.deepEqual((await service.readImage(oldSource)).buffer, f.image);
    await service.control('remove', 'v5');
    // 收藏中的合集原地址在解除当前关联后仍按原清单读取。
    const disconnected = (await service.status(true)).packs[0];
    assert.equal(disconnected.count, 0); assert.equal(disconnected.imageCount, undefined); assert.equal(disconnected.model, undefined);
    assert.deepEqual((await service.readImage(imageSource('newtag', group.revision, 0).replace('pack=v45', 'pack=v5'))).buffer, f.otherImage);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('Full 选择本地注册分片即接入，另一分片明确选择后追加', async () => {
  const root = createWorkspace('artist-group-pick-'); let service;
  try {
    const f = await groupedFixture(root), path = join(root, f.group.files[0].filename);
    await writeFile(path, f.firstBytes);
    let selected = path;
    service = createArtistSamples({ ...f.options, pickFile: async () => ({ path: selected, cancelled: false }) });
    await service.control('pick', 'v5');
    assert.equal(f.saves(), 1); assert.equal((await service.lookup('v5', 'newtag')).imageCount, 1);
    selected = join(root, f.group.files[1].filename);
    await writeFile(selected, f.bytes);
    await service.control('pick', 'v5');
    assert.equal((await ready(service)).model, 'nai-diffusion-5-full');
    assert.equal((await service.lookup('v5', 'newtag')).imageCount, 2);
    assert.deepEqual(f.preferences().artistSamplePacks.v5.files, Object.fromEntries(f.group.files.map(file => [file.filename, join(root, file.filename)])));
  } finally { await service?.close(); removeWorkspace(root); }
});

test('Full 多片后片暂停或校验失败保留前片、旧来源与聚合进度，不误报 ready', async () => {
  for (const mode of ['pause', 'error']) {
    const root = createWorkspace('artist-group-interrupt-'); let service;
    try {
      const f = await groupedFixture(root), legacy = join(f.options.cacheDir, 'packs', 'NAID5-33000-55000-Curated');
      await mkdir(dirname(legacy), { recursive: true }); await writeFile(legacy, f.bytes);
      f.configure({ artistSamplePacks: { v5: 'managed' } });
      service = createArtistSamples({ ...f.options, fetchRemote: async url => url.endsWith('NAID5F-33000-Q') ? new Response(f.firstBytes)
        : mode === 'error' ? new Response(Buffer.alloc(f.bytes.length)) : new Response(new ReadableStream({ start(controller) { controller.enqueue(f.bytes.subarray(0, 16)); } })) });
      const initial = await ready(service);
      await service.control('download', 'v5');
      if (mode === 'pause') {
        await waitPack(service, pack => pack.download.receivedBytes === f.firstBytes.length + 16);
        await waitForFileBytes(join(f.options.cacheDir, 'packs', `${f.group.files[1].filename}.download`), 16);
        await service.control('pause', 'v5');
      }
      const interrupted = await waitPack(service, pack => pack.download.stage === (mode === 'pause' ? 'paused' : 'error'));
      assert.equal(interrupted.model, 'nai-diffusion-5-full'); assert.notEqual(interrupted.revision, initial.revision);
      assert.equal(interrupted.files[0].active, true); assert.equal(interrupted.files[1].active, false);
      assert.equal(interrupted.download.totalBytes, f.group.size);
      const partialBytes = mode === 'pause' ? await stat(join(f.options.cacheDir, 'packs', `${f.group.files[1].filename}.download`)).then(info => info.size).catch(error => { if (error.code === 'ENOENT') return 0; throw error; }) : 0;
      assert.equal(partialBytes, mode === 'pause' ? 16 : 0);
      assert.equal(interrupted.download.receivedBytes, f.firstBytes.length + partialBytes);
      assert.deepEqual(f.preferences().artistSamplePacks.v5.files, { [f.group.files[0].filename]: 'managed' });
      assert.deepEqual(await readFile(join(f.options.cacheDir, 'packs', f.group.files[0].filename)), f.firstBytes);
      assert.deepEqual(await readFile(legacy), f.bytes);
    } finally { await service?.close(); removeWorkspace(root); }
  }
});

test('旧来源状态核验迟到时不能使刚接入的Full分片失效，暂停后重启保留前片', async t => {
  const root = createWorkspace('artist-group-stale-verify-'); let service, release;
  const originalStat = fsPromises.stat;
  try {
    const f = await groupedFixture(root), legacy = join(f.options.cacheDir, 'packs', 'NAID5-33000-55000-Curated');
    await mkdir(dirname(legacy), { recursive: true }); await writeFile(legacy, f.bytes);
    f.configure({ artistSamplePacks: { v5: 'managed' } });
    service = createArtistSamples({ ...f.options, fetchRemote: async url => url.endsWith('NAID5F-33000-Q') ? new Response(f.firstBytes)
      : new Response(new ReadableStream({ start(controller) { controller.enqueue(f.bytes.subarray(0, 16)); } })) });
    const initial = await ready(service);
    let reached; const checking = new Promise(resolve => { reached = resolve; });
    const resume = new Promise(resolve => { release = resolve; }); let delayed = 0;
    t.mock.method(fsPromises, 'stat', async (...args) => {
      const info = await originalStat(...args);
      if (delayed < 2 && args[0] === legacy) { delayed++; if (delayed === 2) reached(); await resume; }
      return info;
    }); syncBuiltinESMExports();
    const oldStatus = service.status(true), oldCatalog = service.catalog('v5'); await checking;
    await service.control('download', 'v5');
    await waitPack(service, pack => pack.download.receivedBytes === f.firstBytes.length + 16);
    release();
    const current = (await oldStatus).packs[0];
    assert.equal(current.phase, 'ready'); assert.equal(current.files[0].active, true);
    assert.notEqual(current.revision, initial.revision);
    const catalog = await oldCatalog;
    assert.equal(catalog.revision, current.revision); assert.deepEqual(catalog.tags, (await service.catalog('v5')).tags);
    await service.control('pause', 'v5');
    const paused = await ready(service); assert.equal(paused.files[0].active, true); assert.equal(paused.download.stage, 'paused');
    await service.close();
    t.mock.restoreAll(); syncBuiltinESMExports();
    service = createArtistSamples({ ...f.options, fetchRemote: () => { throw new Error('不得联网'); } });
    const restarted = await ready(service); assert.equal(restarted.files[0].active, true); assert.equal(restarted.revision, paused.revision);
    assert.deepEqual(await readFile(legacy), f.bytes);
  } finally { release?.(); t.mock.restoreAll(); syncBuiltinESMExports(); await service?.close(); removeWorkspace(root); }
});

test('旧图片句柄核验迟到不使新Full集合失效，旧地址重试仍读取原件', async t => {
  const root = createWorkspace('artist-stale-image-'); let service, release;
  const originalOpen = fsPromises.open;
  try {
    const f = await groupedFixture(root), legacy = join(f.options.cacheDir, 'packs', 'NAID5-33000-55000-Curated');
    await mkdir(dirname(legacy), { recursive: true }); await writeFile(legacy, f.bytes);
    f.configure({ artistSamplePacks: { v5: 'managed' } });
    service = createArtistSamples({ ...f.options, fetchRemote: async url => url.endsWith('NAID5F-33000-Q') ? new Response(f.firstBytes)
      : new Response(new ReadableStream({ start(controller) { controller.enqueue(f.bytes.subarray(0, 16)); } })) });
    const initial = await ready(service), source = imageSource('newtag', initial.revision, 1).replace('pack=v45', 'pack=v5');
    let reached; const checking = new Promise(resolve => { reached = resolve; });
    const resume = new Promise(resolve => { release = resolve; }); let delayed = false;
    t.mock.method(fsPromises, 'open', async (...args) => {
      const handle = await originalOpen(...args);
      if (!delayed && args[0] === legacy) {
        delayed = true; const originalStat = handle.stat.bind(handle);
        handle.stat = async () => { const info = await originalStat(); reached(); await resume; return info; };
      }
      return handle;
    }); syncBuiltinESMExports();
    const reading = service.readImage(source); const rejected = assert.rejects(reading, /变化|失效/); await checking;
    await service.control('download', 'v5');
    await waitPack(service, pack => pack.download.receivedBytes === f.firstBytes.length + 16);
    await service.control('pause', 'v5'); release(); await rejected;
    const current = await ready(service); assert.equal(current.phase, 'ready'); assert.equal(current.files[0].active, true);
    t.mock.restoreAll(); syncBuiltinESMExports();
    assert.deepEqual((await service.readImage(source)).buffer, f.image);
  } finally { release?.(); t.mock.restoreAll(); syncBuiltinESMExports(); await service?.close(); removeWorkspace(root); }
});

test('固定七个 Full 来源逐片索引并接入，同名图片不因 Tag 重叠省略，覆盖量排除空项', async () => {
  const root = createWorkspace('artist-all-six-'); let service;
  try {
    const original = ARTIST_SAMPLE_PACKS.find(pack => pack.id === 'v5');
    assert.deepEqual(original.files.map(file => file.filename), ['NAID5F-10000-Q', 'NAID5F-20000-Q', 'NAID5F-29000-E', 'NAID5F-33000-Q', 'NAID5F-44000-Q', 'NAID5F-55000-Q', 'NAID5-STYLISH-8000']);
    assert.equal(original.size, original.files.reduce((sum, file) => sum + file.size, 0));
    const images = [], payloads = new Map(), files = [];
    for (const [index, file] of original.files.entries()) {
      const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: index * 40, g: 80, b: 160 } } }).png().toBuffer();
      images.push(image);
      const bytes = Buffer.from(JSON.stringify({ shared: [image.toString('base64')], ['tag' + index]: [image.toString('base64')], empty: [] }));
      payloads.set(file.filename, bytes);
      files.push({ ...file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const group = { ...original, files, size: files.reduce((sum, file) => sum + file.size, 0) };
    let preferences = {}, requests = [];
    const options = { cacheDir: join(root, 'cache'), registry: [group], loadPreferences: async () => preferences, savePreferences: async patch => { preferences = { ...preferences, ...patch }; } };
    service = createArtistSamples({ ...options, fetchRemote: async url => { const name = url.split('/').at(-1); requests.push(name); return new Response(payloads.get(name)); } });
    await service.control('download', 'v5');
    const full = await waitPack(service, pack => pack.phase === 'ready' && !service.downloading());
    assert.deepEqual(requests, files.map(file => file.filename));
    assert.equal(full.filename, 'V5 Full（7个图包）'); assert.equal(full.count, 8); assert.equal(full.imageCount, 14);
    assert.equal(full.download.totalBytes, group.size); assert.equal(full.download.receivedBytes, group.size);
    assert.deepEqual(preferences.artistSamplePacks.v5, { sourceId: 'v5-full-seven-v1', files: Object.fromEntries(files.map(file => [file.filename, 'managed'])) });
    assert.equal((await service.catalog('v5')).tags.includes('empty'), false);
    assert.equal((await service.lookup('v5', 'shared')).imageCount, 7);
    for (let index = 0; index < 7; index++) {
      assert.deepEqual((await service.readImage(imageSource('shared', full.revision, index).replace('pack=v45', 'pack=v5'))).buffer, images[index]);
    }
    await service.close(); service = createArtistSamples(options);
    assert.equal((await ready(service)).revision, full.revision);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('Full 图片增量摘要跨 chunk 保持一致，普通索引不改变缓存结构', async () => {
  const root = createWorkspace('artist-image-hashes-');
  try {
    const path = join(root, 'pack'); await writeFile(path, '{"tag":["YQ==","Yg==","YQ=="],"empty":[]}');
    const plain = await indexArtistSampleFile(path, { highWaterMark: 1 }); assert.equal(plain.tag.hashes, undefined);
    for (const highWaterMark of [1, 7, 1024]) {
      const entries = await indexArtistSampleFile(path, { highWaterMark, hashImages: true });
      assert.deepEqual(entries.tag.hashes, ['YQ==', 'Yg==', 'YQ=='].map(value => createHash('sha256').update(value).digest('hex')));
      assert.deepEqual(entries.empty.hashes, []);
    }
    const rawImage = JSON.stringify('a"b\\c').slice(1, -1);
    await writeFile(path, `{"tag":["${rawImage}","YQ=="],"empty":[]}`);
    for (const highWaterMark of [1, 7]) {
      const entries = await indexArtistSampleFile(path, { highWaterMark, hashImages: true });
      assert.deepEqual(entries.tag.hashes, [rawImage, 'YQ=='].map(value => createHash('sha256').update(value).digest('hex')));
    }
  } finally { removeWorkspace(root); }
});

test('Full 三源精确去重保留首次页与不同图片，旧合集布局和单源缓存 revision 保持兼容', async () => {
  const root = createWorkspace('artist-group-dedup-'); let service;
  try {
    const f = await groupedFixture(root), images = [f.image, f.otherImage, await sharp(f.image).jpeg().toBuffer()];
    const lists = [[0, 0], [0, 1, 0], [0, 1, 2]], files = [];
    for (const [index, list] of lists.entries()) {
      const bytes = Buffer.from(JSON.stringify({ shared: list.map(image => images[image].toString('base64')), other: [images[0].toString('base64')], empty: [] }));
      const filename = `synthetic-${index}`; await writeFile(join(root, filename), bytes);
      files.push({ sourceId: `synthetic-${index}`, filename, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const definition = { ...f.group, files, size: files.reduce((sum, file) => sum + file.size, 0), layout: undefined };
    let preferences = { artistSamplePacks: { v5: join(root, files[0].filename) } };
    const options = { cacheDir: join(root, 'cache'), registry: [definition], loadPreferences: async () => preferences, savePreferences: async patch => { preferences = { ...preferences, ...patch }; } };
    service = createArtistSamples(options);
    const legacy = await ready(service); assert.equal((await service.lookup('v5', 'shared')).imageCount, 8);
    const oldSource = imageSource('shared', legacy.revision, 4).replace('pack=v45', 'pack=v5');
    assert.deepEqual((await service.readImage(oldSource)).buffer, images[0]);
    await service.close();
    // 模拟升级前无图片摘要的 Full 子索引，不修改源文件或旧 revision。
    const oldChildRevisions = [];
    for (const file of await readdir(options.cacheDir)) {
      const path = join(options.cacheDir, file), saved = JSON.parse(await readFile(path, 'utf8'));
      if (!saved.entries) continue;
      oldChildRevisions.push(file);
      for (const entry of Object.values(saved.entries)) delete entry.hashes;
      await writeFile(path, JSON.stringify(saved));
    }
    service = createArtistSamples({ ...options, registry: [{ ...definition, layout: 'exact-image-v1' }] });
    const current = await ready(service); assert.notEqual(current.revision, legacy.revision);
    assert.equal(current.count, 2); assert.equal(current.imageCount, 4);
    assert.equal((await service.lookup('v5', 'shared')).imageCount, 3);
    assert.equal((await service.lookup('v5', 'other')).imageCount, 1);
    for (let index = 0; index < 3; index++) {
      assert.deepEqual((await service.readImage(imageSource('shared', current.revision, index).replace('pack=v45', 'pack=v5'))).buffer, images[index]);
    }
    assert.deepEqual((await service.readImage(oldSource)).buffer, images[0]);
    assert.deepEqual((await service.readImage(imageSource('shared', legacy.revision, 7).replace('pack=v45', 'pack=v5'))).buffer, images[2]);
    for (const file of oldChildRevisions) {
      const saved = JSON.parse(await readFile(join(options.cacheDir, file), 'utf8'));
      assert.equal(saved.entries.shared.hashes.length, saved.entries.shared.count);
    }
    await service.close(); service = createArtistSamples({ ...options, registry: [{ ...definition, layout: 'exact-image-v1' }] });
    assert.equal((await ready(service)).revision, current.revision);
    assert.deepEqual((await service.readImage(oldSource)).buffer, images[0]);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('按注册 filename 独立下载恢复子集，拒绝越权 file 参数，磁盘额外文件不自动接入', async () => {
  const root = createWorkspace('artist-file-controls-'); let service;
  try {
    const f = await groupedFixture(root), first = f.group.files[0], second = f.group.files[1];
    const requests = [];
    const options = { ...f.options, fetchRemote: async url => { requests.push(url.split('/').at(-1)); return new Response(url.endsWith(first.filename) ? f.firstBytes : f.bytes); } };
    service = createArtistSamples(options);
    await assert.rejects(service.control('download', 'v5', '../private'), /无效/);
    await assert.rejects(service.control('download', 'v5', null), /无效/);
    await assert.rejects(service.control('reindex', 'v5', first.filename), /无效/);
    await service.control('download', 'v5', second.filename);
    const single = await waitPack(service, pack => pack.phase === 'ready' && !service.downloading());
    assert.deepEqual(requests, [second.filename]);
    assert.deepEqual(single.files.map(file => file.active), [false, true]);
    assert.equal(single.files[1].count, 1);
    const oldSource = imageSource('newtag', single.revision, 0).replace('pack=v45', 'pack=v5');
    assert.deepEqual((await service.readImage(oldSource)).buffer, f.image);
    await writeFile(join(f.options.cacheDir, 'packs', first.filename), f.firstBytes);
    await service.close(); service = createArtistSamples(options);
    const restored = await ready(service);
    assert.equal(restored.revision, single.revision); assert.deepEqual(restored.files.map(file => file.active), [false, true]);
    await service.control('download', 'v5', first.filename);
    const both = await waitPack(service, pack => pack.phase === 'ready' && !service.downloading());
    assert.deepEqual(both.files.map(file => file.active), [true, true]); assert.notEqual(both.revision, single.revision);
    assert.deepEqual((await service.readImage(oldSource)).buffer, f.image);
    await service.control('remove', 'v5'); await service.close(); service = createArtistSamples(options);
    const disconnected = await ready(service); assert.equal(disconnected.phase, 'unconfigured');
    assert.deepEqual(disconnected.files.map(file => file.active), [false, false]);
    assert.deepEqual((await service.catalog('v5')).tags, []);
    assert.deepEqual((await service.readImage(oldSource)).buffer, f.image);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('逐片下载暂停只作用当前片，保留已有可用集合，按 Range 继续并入', async () => {
  const root = createWorkspace('artist-file-resume-'); let service;
  try {
    const f = await groupedFixture(root), first = f.group.files[0], second = f.group.files[1];
    let resume = false;
    const options = { ...f.options, fetchRemote: async (url, request) => {
      if (url.endsWith(first.filename)) return new Response(f.firstBytes);
      if (resume) {
        const offset = Number(request.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0);
        return offset ? new Response(f.bytes.subarray(offset), { status: 206, headers: { 'content-range': `bytes ${offset}-${f.bytes.length - 1}/${f.bytes.length}` } }) : new Response(f.bytes);
      }
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(f.bytes.subarray(0, 16)); } }));
    } };
    service = createArtistSamples(options);
    await service.control('download', 'v5', first.filename);
    const original = await waitPack(service, pack => pack.phase === 'ready' && !service.downloading());
    await service.control('download', 'v5', second.filename);
    await waitPack(service, pack => pack.files[1].download.receivedBytes === 16);
    await waitForFileBytes(join(f.options.cacheDir, 'packs', `${second.filename}.download`), 16);
    await service.control('pause', 'v5', first.filename); assert.equal(service.downloading(), true);
    await assert.rejects(service.control('download', 'v5', first.filename), error => error.status === 409);
    await service.control('pause', 'v5', second.filename);
    const paused = (await service.status(true)).packs[0];
    assert.equal(paused.revision, original.revision); assert.equal(paused.phase, 'ready');
    assert.equal(paused.files[0].active, true); assert.equal(paused.files[1].active, false);
    assert.equal(paused.files[1].download.stage, 'paused');
    resume = true; await service.close(); service = createArtistSamples(options);
    assert.equal((await ready(service)).revision, original.revision);
    await service.control('download', 'v5', second.filename);
    const completed = await waitPack(service, pack => pack.phase === 'ready' && !service.downloading());
    assert.deepEqual(completed.files.map(file => file.active), [true, true]);
    assert.equal((await service.lookup('v5', 'newtag')).imageCount, 2);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('旧六片偏好按已有 exact 或 concat descriptor 保留 revision，不自动接入第七片', async () => {
  for (const layout of [undefined, 'exact-image-v1']) {
    const root = createWorkspace('artist-old-six-'); let service;
    try {
      const f = await groupedFixture(root), old = { ...f.group, sourceId: 'v5-full-all-six-v1', layout };
      await mkdir(join(f.options.cacheDir, 'packs'), { recursive: true });
      for (const file of old.files) await writeFile(join(f.options.cacheDir, 'packs', file.filename), file.filename === old.files[0].filename ? f.firstBytes : f.bytes);
      f.configure({ artistSamplePacks: { v5: 'managed:v5-full-all-six-v1' } });
      service = createArtistSamples({ ...f.options, registry: [old] });
      const previous = await ready(service), count = (await service.lookup('v5', 'newtag')).imageCount;
      const oldSource = imageSource('newtag', previous.revision, count - 1).replace('pack=v45', 'pack=v5');
      await service.close();
      const stylish = { ...old.files[1], filename: 'NAID5-STYLISH-8000', sourceId: 'v5-stylish-8000' };
      await writeFile(join(f.options.cacheDir, 'packs', stylish.filename), f.bytes);
      const next = { ...old, sourceId: 'v5-full-seven-v1', layout: 'exact-image-v1', files: [...old.files, stylish], size: old.size + stylish.size };
      service = createArtistSamples({ ...f.options, registry: [next], fetchRemote: () => { throw new Error('旧关联不得自动下载'); } });
      const restored = await ready(service);
      assert.equal(restored.revision, previous.revision); assert.equal((await service.lookup('v5', 'newtag')).imageCount, count);
      assert.deepEqual(restored.files.map(file => file.active), [true, true, false]);
      assert.deepEqual((await service.readImage(oldSource)).buffer, f.image);
      assert.equal(f.preferences().artistSamplePacks.v5, 'managed:v5-full-all-six-v1');
    } finally { await service?.close(); removeWorkspace(root); }
  }
});
