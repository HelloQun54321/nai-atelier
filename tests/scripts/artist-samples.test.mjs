import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, readdir, unlink, mkdir, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
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
    assert.equal(pack.progress, 100); assert.equal(pack.processedBytes, pack.totalBytes);
    assert.equal((await service.lookup('v45', '画师 (a)')).imageCount, 2);
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
    service = createArtistSamples({ cacheDir: join(root, 'cache'), loadPreferences: async () => ({ artistSamplePacks: { v45: path } }), savePreferences: async () => {} });
    let observed = false;
    for (let i = 0; i < 1000; i++) {
      const pack = (await service.status(true)).packs[0];
      assert.ok(pack.progress >= 0 && pack.progress <= 100);
      if (pack.phase === 'indexing' && pack.processedBytes > 0 && pack.processedBytes < pack.totalBytes) {
        assert.equal(pack.progress, pack.processedBytes / pack.totalBytes * 100); observed = true;
      }
      if (pack.phase === 'ready') { assert.equal(pack.progress, 100); break; }
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(observed, true);
    assert.equal((await ready(service)).progress, 100);
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

test('macOS 图包文件选择使用系统面板，定位到原文件所在文件夹，取消与超时同 Windows', async () => {
  let call;
  const result = await pickArtistSampleFile('/Users/合成/图包/artist_thumbnail_nai', async (command, args, options) => {
    call = { command, args, options };
    return { stdout: '/Volumes/外置/artist_thumbnail_nai\n' };
  }, 'darwin');
  assert.deepEqual(result, { path: '/Volumes/外置/artist_thumbnail_nai', cancelled: false });
  assert.equal(call.command, '/usr/bin/osascript');
  assert.match(call.args.join('\n'), /choose file/); assert.match(call.args.join('\n'), /error number -128/);
  assert.equal(call.options.env.NAI_ARTIST_PICK_INITIAL, '/Users/合成/图包');
  assert.equal(call.options.timeout, 300000);
  await assert.rejects(pickArtistSampleFile('', async () => { throw Object.assign(new Error('timeout'), { killed: true }); }, 'darwin'), /超时/);
  assert.equal((await pickArtistSampleFile('', async () => ({ stdout: '\n' }), 'darwin')).cancelled, true);
  await assert.rejects(pickArtistSampleFile('', async () => ({ stdout: '/x' }), 'linux'), /Windows 或 macOS/);
});

const waitPack = async (service, predicate) => {
  for (let i = 0; i < 400; i++) {
    const pack = (await service.status(true)).packs[0];
    if (predicate(pack)) return pack;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('合成图包状态等待超时');
};
async function downloadableFixture(root) {
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
  const bytes = Buffer.from(JSON.stringify({ newtag: [image.toString('base64'), image.toString('base64')] }));
  const registry = ARTIST_SAMPLE_PACKS.map(pack => ({ ...pack, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
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
