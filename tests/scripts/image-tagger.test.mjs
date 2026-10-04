import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Readable } from 'node:stream';
import { handleImageTaggerRequest } from '../../scripts/media-gateway.mjs';
import { ImageTaggerService } from '../../scripts/image-tagger.mjs';
import { downloadTaggerFile, verifiedFile } from '../../scripts/tagger-model-download.mjs';
import { IMAGE_TAGGER_MODELS } from '../../services/imageTaggerModels.mjs';

const digest = data => createHash('sha256').update(data).digest('hex');
const csv = Buffer.from('tag_id,name,category\n0,safe,9\n1,blue_hair,0\n2,test_character,4\n');
const bytes = Buffer.from('synthetic-model-content-for-resume');
const definitions = IMAGE_TAGGER_MODELS.map(model => ({ ...model, files: [{ name: 'model.onnx', size: bytes.length, sha256: digest(bytes) }, { name: 'selected_tags.csv', size: csv.length, sha256: digest(csv) }] }));
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'atelier-tagger-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const model = definitions[0], file = model.files[0];
  const options = { model, file, directory, signal: new AbortController().signal, onProgress: () => {} };
  return { directory, model, file, options, path: join(directory, file.name) };
}

test('fixed registry keeps each model and matching tag vocabulary pinned', () => {
  for (const model of IMAGE_TAGGER_MODELS) {
    assert.match(model.revision, /^[a-f0-9]{40}$/);
    for (const file of model.files) { assert.match(file.sha256, /^[a-f0-9]{64}$/); assert.ok(file.size > 0); }
  }
  assert.equal(IMAGE_TAGGER_MODELS[2].threshold, 0.53);
});

test('fresh download reports bytes, verifies digest and atomically promotes files', async t => {
  const f = await fixture(t), progress = [];
  await downloadTaggerFile({ ...f.options, onProgress: (received, stage) => progress.push([received, stage]), fetchRemote: async url => {
    assert.ok(url.includes(f.model.revision)); return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
  } });
  assert.deepEqual(await readFile(f.path), bytes);
  assert.ok(progress.some(([count, stage]) => count === bytes.length && stage === 'verifying'));
  assert.equal(progress.at(-1)[1], 'verified');
  await assert.rejects(stat(`${f.path}.download`), { code: 'ENOENT' });
});

test('interrupted download resumes exact bytes; server ignoring Range restarts safely', async t => {
  const f = await fixture(t);
  for (const supportsRange of [true, false]) {
    await writeFile(`${f.path}.download`, bytes.subarray(0, 8));
    const destination = join(f.directory, `case-${supportsRange}`); await mkdir(destination);
    await writeFile(join(destination, 'model.onnx.download'), bytes.subarray(0, 8));
    await downloadTaggerFile({ ...f.options, directory: destination, fetchRemote: async (_url, options) => {
      assert.equal(options.headers.range, 'bytes=8-');
      return supportsRange ? new Response(bytes.subarray(8), { status: 206, headers: { 'content-range': `bytes 8-${bytes.length - 1}/${bytes.length}` } }) : new Response(bytes);
    } });
    assert.deepEqual(await readFile(join(destination, 'model.onnx')), bytes);
  }
});

test('bad ranges, mismatched lengths and oversize content never become ready files', async t => {
  const f = await fixture(t); await writeFile(`${f.path}.download`, bytes.subarray(0, 8));
  for (const response of [new Response(bytes.subarray(8), { status: 206, headers: { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` } }), new Response(bytes, { headers: { 'content-length': '999' } }), new Response(Buffer.alloc(bytes.length + 1))]) {
    await assert.rejects(downloadTaggerFile({ ...f.options, fetchRemote: async () => response }));
    await assert.rejects(stat(f.path), { code: 'ENOENT' });
  }
});

test('digest mismatch removes only the failed partial; unrelated files remain intact', async t => {
  const f = await fixture(t); await writeFile(join(f.directory, 'private-cover.png'), 'keep');
  await assert.rejects(downloadTaggerFile({ ...f.options, fetchRemote: async () => new Response(Buffer.alloc(bytes.length)) }), /SHA-256/);
  await assert.rejects(stat(`${f.path}.download`), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.directory, 'private-cover.png'), 'utf8'), 'keep');
});

test('verified existing and fully downloaded interrupted files need no network', async t => {
  const f = await fixture(t); await writeFile(`${f.path}.download`, bytes);
  const fetchRemote = () => { throw new Error('network must not be used'); };
  await downloadTaggerFile({ ...f.options, fetchRemote });
  await downloadTaggerFile({ ...f.options, fetchRemote });
  assert.equal(await verifiedFile(f.path, f.file), true);
  await writeFile(f.path, Buffer.alloc(bytes.length));
  assert.equal(await verifiedFile(f.path, f.file), false);
});

test('failed request preserves partial for manual retry and abort does not promote it', async t => {
  const f = await fixture(t); await writeFile(`${f.path}.download`, bytes.subarray(0, 8));
  await assert.rejects(downloadTaggerFile({ ...f.options, fetchRemote: async () => new Response(null, { status: 503 }) }), /HTTP 503/);
  assert.equal((await stat(`${f.path}.download`)).size, 8);
  await writeFile(`${f.path}.download`, bytes);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(downloadTaggerFile({ ...f.options, signal: controller.signal, fetchRemote: () => { throw new Error('unexpected'); } }), { name: 'AbortError' });
  await assert.rejects(stat(f.path), { code: 'ENOENT' });
});

test('selection persists, restores on restart and does not download before use', async t => {
  const f = await fixture(t); let preference;
  const options = { directory: f.directory, models: definitions, loadPreference: async () => preference, savePreference: async next => { preference = next; } };
  const manager = new ImageTaggerService(() => { throw new Error('no download'); }, options);
  assert.equal((await manager.status()).model, definitions[0].id);
  await manager.select(definitions[2].id);
  assert.equal((await manager.status()).downloaded, false);
  const restarted = new ImageTaggerService(undefined, options);
  assert.equal((await restarted.status()).model, definitions[2].id);
  await assert.rejects(manager.select('../invalid'), /不支持/);
  manager.savePreference = async () => { throw new Error('storage failure'); };
  await assert.rejects(manager.select(definitions[1].id), /storage failure/);
  assert.equal(manager.model, definitions[2].id);
});

test('downloads share one job, do not switch selection and show actual failure', async t => {
  const f = await fixture(t); let resolve;
  const held = new Promise(r => { resolve = r; });
  const manager = new ImageTaggerService(async () => { await held; return new Response(null, { status: 503 }); }, { directory: f.directory, models: definitions });
  const promise = manager.startDownload(definitions[1].id);
  assert.equal(manager.startDownload(definitions[1].id), promise);
  assert.throws(() => manager.startDownload(definitions[2].id), /已有模型/);
  assert.equal((await manager.status()).model, definitions[0].id);
  resolve(); await assert.rejects(promise, /HTTP 503/);
  const status = await manager.status(); assert.equal(status.downloadingModel, null);
  assert.match(status.models[1].error, /HTTP 503/); assert.equal(status.models[1].downloaded, false);
});

test('cancel download stops job and records resumable paused state', async t => {
  const f = await fixture(t);
  const manager = new ImageTaggerService((_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }), { directory: f.directory, models: definitions });
  manager.startDownload(definitions[0].id);
  await manager.pauseDownload();
  const status = await manager.status(); assert.equal(status.downloadingModel, null); assert.equal(status.models[0].stage, 'paused');
});

test('all models load matching files, use own defaults and reject stale model requests', async t => {
  const f = await fixture(t); const loads = [];
  const manager = new ImageTaggerService(async url => new Response(url.endsWith('.csv') ? csv : bytes), { directory: f.directory, models: definitions,
    loadRuntime: async () => ({ Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }, InferenceSession: { create: async path => {
      loads.push(path); return { inputNames: ['input'], outputNames: ['output'], inputMetadata: [{ shape: [1, 2, 2, 3] }], run: async () => ({ output: { data: [0.9, 0.5, 0.9] } }), release: async () => {} };
    } } }),
  });
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#0000ff' } }).png().toBuffer();
  for (const model of definitions) {
    await manager.select(model.id); const result = await manager.tag(image);
    assert.equal(result.model, model.id); assert.equal(result.threshold, model.threshold);
    assert.equal(result.character[0].name, 'test_character');
    assert.equal(result.general.length, model.threshold > 0.5 ? 0 : 1);
    assert.ok(loads.at(-1).includes(model.directory));
  }
  await assert.rejects(manager.tag(image, { model: definitions[0].id }), /已切换/);
});

test('active inference prevents concurrent recognition and selection', async t => {
  const f = await fixture(t); let release;
  const manager = new ImageTaggerService(undefined, { directory: f.directory, models: definitions });
  manager.init = () => new Promise(resolve => { release = resolve; });
  const pending = manager.tag(Buffer.from('invalid image'));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(manager.select(definitions[1].id), /正在识别/);
  await assert.rejects(manager.tag(Buffer.from('invalid image')), /已有图片/);
  release(); await assert.rejects(pending); assert.equal(manager.busy, false);
});

test('gateway protects controls, returns precise failures and leaves absent thresholds to model defaults', async () => {
  const calls = [];
  const manager = { status: async () => ({ model: 'synthetic' }), select: async id => { calls.push(id); }, startDownload: id => { calls.push(id); }, pauseDownload: async () => { calls.push('pause'); }, tag: async (_image, options) => { calls.push(options); return { tags: [] }; } };
  const invoke = async (path, body = '{}', overrides = {}) => {
    const req = Readable.from([Buffer.from(body)]); req.setTimeout = () => {}; req.method = path.endsWith('/status') ? 'GET' : 'POST';
    req.headers = { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'image/png' }; req.socket = { remoteAddress: '127.0.0.1' }; Object.assign(req, overrides);
    let code, payload; const res = { writeHead: value => { code = value; }, end: value => { payload = JSON.parse(value.toString()); } };
    await handleImageTaggerRequest(req, res, new URL(`http://localhost:3000${path}`), 'synthetic-secret', manager);
    return { code, payload };
  };
  assert.equal((await invoke('/api/image-tagger/model', '{"model":"selected"}')).code, 200); assert.equal(calls.at(-1), 'selected');
  assert.equal((await invoke('/api/image-tagger/download', '{"model":"downloaded"}')).code, 200); assert.equal(calls.at(-1), 'downloaded');
  assert.equal((await invoke('/api/image-tagger/pause')).code, 200); assert.equal(calls.at(-1), 'pause');
  assert.equal((await invoke('/api/image-tagger/model', '{}')).code, 400);
  assert.equal((await invoke('/api/image-tagger/model', '{}', { socket: { remoteAddress: '192.168.1.2' } })).code, 401);
  assert.equal((await invoke('/api/image-tagger/model', '{}', { headers: { host: 'localhost:3000', origin: 'http://evil.example' } })).code, 403);
  assert.equal((await invoke('/api/image-tagger/download', '{}', { method: 'GET' })).code, 405);
  assert.equal((await invoke('/api/image-tagger?threshold=invalid', 'image')).code, 400);
  assert.equal((await invoke('/api/image-tagger?model=selected', 'image')).code, 200);
  assert.deepEqual(calls.at(-1), { threshold: undefined, characterThreshold: undefined, model: 'selected' });
  manager.select = async () => { throw Object.assign(new Error('正在识别'), { status: 409 }); };
  assert.deepEqual(await invoke('/api/image-tagger/model', '{"model":"busy"}'), { code: 409, payload: { error: '正在识别' } });
});
