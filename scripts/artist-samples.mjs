import { createReadStream } from 'node:fs';
import { open, stat, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { basename, dirname, join, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { downloadTaggerFile, fileSize, verifiedFile } from './tagger-model-download.mjs';

export const ARTIST_SAMPLE_PACKS = [
  { id: 'v45', label: 'NAI V4.5', filename: 'artist_thumbnail_nai', sourcePath: 'NAIA/NAID4.5_artist_thumbnail_31000/artist_thumbnail_nai', size: 2725799839, sha256: 'd7b067a66af6924e60d4a2f3df557b84de2bbfecdd95228152129b830f480ad5', sourceUrl: 'https://huggingface.co/baqu2213/PoemForSmallFThings/blob/main/NAIA/NAID4.5_artist_thumbnail_31000/artist_thumbnail_nai' },
  { id: 'v5', label: 'NAI V5 Full', model: 'nai-diffusion-5-full', sourceId: 'v5-full-seven-v1', layout: 'exact-image-v1', files: [
    { sourceId: 'v5-full-10000-q', filename: 'NAID5F-10000-Q', sourcePath: 'NAIA/NAID5_artist_thumbnail/NAID5F-10000-Q', size: 1373203772, sha256: '54252858fff8193ee6a6be0601a2e9c52d94bdeaefcd414ad860b174c53baf19' },
    { sourceId: 'v5-full-20000-q', filename: 'NAID5F-20000-Q', sourcePath: 'NAIA/NAID5_artist_thumbnail/NAID5F-20000-Q', size: 2633376969, sha256: '9997e0fa2509d7eb19ac7eabc0cc11faceeec0ffa97d2c4975e5e88418ecf547' },
    { sourceId: 'v5-full-29000-e', filename: 'NAID5F-29000-E', sourcePath: 'NAIA/NAID5_artist_thumbnail/NAID5F-29000-E', size: 1760716984, sha256: 'f160a89c2ab742462c731fd129982b49ca37947f2098602f0d3a05716033b1c8' },
    { sourceId: 'v5-full-33000-q', filename: 'NAID5F-33000-Q', sourcePath: 'NAIA/NAID5_artist_thumbnail/NAID5F-33000-Q', size: 4622809235, sha256: '05ad02b12af90ba3debf4e25542b2e6a4e9fcc148ad6739fbd062433ec4c1ed5' },
    { sourceId: 'v5-full-44000-q', filename: 'NAID5F-44000-Q', sourcePath: 'NAIA/NAID5_artist_thumbnail/NAID5F-44000-Q', size: 1586883239, sha256: 'd1ae623893f949d5cc592c29d96a03738a83dad6fc0e45ad23e188044860678f' },
    { sourceId: 'v5-full-55000-q', filename: 'NAID5F-55000-Q', sourcePath: 'NAIA/NAID5_artist_thumbnail/NAID5F-55000-Q', size: 3194676902, sha256: '5f0b435149706fe3caf2bd166647554293e82e05b0fc760fb6ed1a6269e3c92b' },
    { sourceId: 'v5-stylish-8000', filename: 'NAID5-STYLISH-8000', sourcePath: 'NAIA/NAID5_artist_thumbnail/NAID5-STYLISH-8000', size: 1335470826, sha256: '2ac41fdc117e51eac2a853167a67647112953fe8886f6b6bfacfc01d4a02a6db' },
  ], filename: 'V5 Full（7个图包）', size: 16507137927, sourceUrl: 'https://huggingface.co/baqu2213/PoemForSmallFThings/tree/25e2826178464c2d49bdcca5ca6cbe44dcd9f162/NAIA/NAID5_artist_thumbnail' },
];
const DOWNLOAD_MODEL = { id: 'baqu2213/PoemForSmallFThings', revision: '25e2826178464c2d49bdcca5ca6cbe44dcd9f162' };
const VERSION = 1;
const LEGACY_V5_FILENAME = 'NAID5-33000-55000-Curated';
const managedPreference = pack => pack.sourceId ? `managed:${pack.sourceId}` : 'managed';
const identityFor = (pack, info) => ({ ...signature(pack.path, info), ...(pack.model ? { sourceId: pack.sourceId, sha256: pack.sha256 } : {}) });
const normalize = value => value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const whitespace = byte => [32, 9, 10, 13].includes(byte);
const failure = message => Object.assign(new Error(message), { status: 400 });
const signature = (path, info) => ({ path, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, ino: info.ino, dev: info.dev, version: VERSION });
const revisionFor = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

// 只扫描顶层对象及字符串数组的字节语法，不将整包或图片内容载入内存。
export async function indexArtistSampleFile(path, { signal, onProgress = () => {}, highWaterMark = 1024 * 1024, hashImages = false } = {}) {
  const entries = Object.create(null);
  let offset = 0, state = 'object', stringKind = '', escaped = false, unicodeLeft = 0;
  let keyBytes = [], key = '', start = 0, count = 0, canClose = true;
  let imageHash, hashes = [];
  const stream = createReadStream(path, { highWaterMark, signal });
  for await (const chunk of stream) {
    let hashStart = imageHash ? 0 : -1;
    for (let chunkIndex = 0; chunkIndex < chunk.length; chunkIndex++) {
      const byte = chunk[chunkIndex];
      if (stringKind) {
        if (stringKind === 'key') {
          keyBytes.push(byte);
          if (keyBytes.length > 16384) throw failure('画师名称过长');
        }
        if (unicodeLeft) {
          if (!/[0-9a-f]/i.test(String.fromCharCode(byte))) throw failure('图包包含无效的 JSON 转义');
          unicodeLeft--;
        } else if (escaped) {
          if (byte === 117) unicodeLeft = 4;
          else if (![34, 92, 47, 98, 102, 110, 114, 116].includes(byte)) throw failure('图包包含无效的 JSON 转义');
          escaped = false;
        } else if (byte === 92) escaped = true;
        else if (byte === 34) {
          if (stringKind === 'key') {
            key = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(keyBytes)));
            if (Object.hasOwn(entries, key)) throw failure('图包包含重复画师名称');
            state = 'colon';
          } else {
            if (imageHash) { imageHash.update(chunk.subarray(hashStart, chunkIndex)); hashes.push(imageHash.digest('hex')); imageHash = undefined; hashStart = -1; }
            count++; state = 'arrayEnd';
          }
          stringKind = '';
        } else if (byte < 32 || (stringKind === 'image' && byte > 127)) throw failure('图包包含无效的图片字符串');
      } else if (!whitespace(byte)) {
        if (state === 'object' && byte === 123) state = 'key';
        else if (state === 'key' && byte === 34) { stringKind = 'key'; keyBytes = [34]; }
        else if (state === 'key' && byte === 125 && canClose) state = 'done';
        else if (state === 'colon' && byte === 58) state = 'array';
        else if (state === 'array' && byte === 91) { start = offset; count = 0; hashes = []; canClose = true; state = 'item'; }
        else if (state === 'item' && byte === 34) { stringKind = 'image'; if (hashImages) { imageHash = createHash('sha256'); hashStart = chunkIndex + 1; } }
        else if ((state === 'arrayEnd' || (state === 'item' && canClose)) && byte === 93) {
          entries[key] = { start, end: offset + 1, count, ...(hashImages ? { hashes } : {}) }; state = 'entryEnd';
        } else if (state === 'arrayEnd' && byte === 44) { state = 'item'; canClose = false; }
        else if (state === 'entryEnd' && byte === 44) { state = 'key'; canClose = false; }
        else if (state === 'entryEnd' && byte === 125) state = 'done';
        else throw failure('图包不是完整的画师图片 JSON 对象');
      }
      offset++;
    }
    if (imageHash) imageHash.update(chunk.subarray(hashStart));
    onProgress(offset);
  }
  if (state !== 'done' || stringKind) throw failure('图包 JSON 不完整');
  return entries;
}

export function validateArtistSampleSource(source) {
  const url = new URL(source, 'http://localhost');
  if (!source.startsWith('/api/artist-samples/image?') || url.pathname !== '/api/artist-samples/image'
    || [...url.searchParams.keys()].some(key => !['pack', 'tag', 'index', 'revision'].includes(key))
    || ['pack', 'tag', 'index', 'revision'].some(key => url.searchParams.getAll(key).length !== 1)
    || !ARTIST_SAMPLE_PACKS.some(pack => pack.id === url.searchParams.get('pack'))
    || !url.searchParams.get('tag') || url.searchParams.get('tag').length > 4096
    || !/^\d{1,6}$/.test(url.searchParams.get('index') || '') || !/^[a-f0-9]{24}$/.test(url.searchParams.get('revision') || '') || url.hash) throw failure('无效的画师样张地址');
  return url;
}

export function createArtistSamples({ cacheDir, loadPreferences, savePreferences, pickFile = pickArtistSampleFile, fetchRemote = fetch, registry = ARTIST_SAMPLE_PACKS, downloadTimeoutMs = 20 * 60 * 1000 }) {
  let closed = false, pickerOpen = false, activeDownload = null;
  const downloadDirectory = join(cacheDir, 'packs');
  const historical = new Map();
  const fileStates = new Map();
  const targetModel = new Map(registry.map(pack => [pack.id, pack.model]));
  const visible = pack => !targetModel.get(pack.id) || pack.model === targetModel.get(pack.id);
  const packs = new Map(registry.map(pack => [pack.id, { ...pack, managed: false, download: { stage: 'missing', receivedBytes: 0, totalBytes: pack.size }, path: '', phase: 'unconfigured', progress: 0, processedBytes: 0, totalBytes: 0, count: 0, revision: '', entries: null, aliases: new Map(), controller: null }]));
  const get = id => { const pack = packs.get(id); if (!pack) throw failure('未知画师图包'); return pack; };
  const publish = (pack, entries) => {
    const aliases = new Map();
    for (const tag of Object.keys(entries)) { const name = normalize(tag); aliases.set(name, aliases.has(name) ? null : tag); }
    Object.assign(pack, { entries, aliases, count: Object.keys(entries).length, phase: 'ready', progress: 100, processedBytes: pack.totalBytes });
    if (pack.model) pack.sampleTagCount = Object.values(entries).filter(entry => entry.count > 0).length;
  };
  const invalidate = pack => { pack.controller?.abort(); Object.assign(pack, { entries: null, count: 0, phase: 'error', error: '图包文件已变化或不可读取，请重新建立索引' }); };
  const verify = async pack => {
    if (pack.phase !== 'ready') return false;
    const { revision, path, children, controller } = pack;
    // 核验期间可能接入下一分片；旧文件的 stat 结果不能使新集合失效。
    const unchanged = () => pack.phase === 'ready' && pack.revision === revision && pack.path === path && pack.children === children && pack.controller === controller;
    if (children) {
      const valid = (await Promise.all(children.map(verify))).every(Boolean);
      if (!unchanged()) return verify(pack);
      if (valid) return true;
      invalidate(pack); return false;
    }
    try {
      const info = await stat(path);
      if (!unchanged()) return verify(pack);
      if (revisionFor(identityFor(pack, info)) !== revision) { invalidate(pack); return false; }
    }
    catch { if (!unchanged()) return verify(pack); invalidate(pack); return false; }
    return true;
  };
  const start = async (pack, reuse = true, onProgress = () => {}) => {
    if (closed) return;
    if (pack.files && pack.model) return startGroup(pack, reuse);
    pack.controller?.abort();
    const controller = new AbortController(); pack.controller = controller;
    Object.assign(pack, { phase: 'indexing', progress: 0, processedBytes: 0, count: 0, entries: null, error: undefined });
    try {
      const path = pack.path;
      if (pack.model && !await verifiedFull(path, pack, controller.signal)) throw failure('V5 Full 图包来源校验失败，请重新选择或下载');
      const info = await stat(path);
      if (controller.signal.aborted || pack.controller !== controller) return;
      if (!info.isFile()) throw failure('请选择图包文件');
      const identity = identityFor(pack, info); pack.totalBytes = info.size; pack.revision = revisionFor(identity);
      const revision = pack.revision;
      const file = join(cacheDir, `${pack.id}-${pack.revision}.json`);
      if (reuse) {
        try {
          const saved = JSON.parse(await readFile(file, 'utf8'));
          if (JSON.stringify(saved.identity) === JSON.stringify(identity) && saved.entries && typeof saved.entries === 'object' && !Array.isArray(saved.entries)
            && Object.values(saved.entries).every(entry => Number.isSafeInteger(entry.start) && Number.isSafeInteger(entry.end) && entry.start >= 0 && entry.end > entry.start && entry.end <= info.size && Number.isSafeInteger(entry.count) && entry.count >= 0
              && (!pack.model || (Array.isArray(entry.hashes) && entry.hashes.length === entry.count && entry.hashes.every(hash => /^[a-f0-9]{64}$/.test(hash)))))) {
            if (controller.signal.aborted || pack.controller !== controller) return;
            publish(pack, saved.entries); return;
          }
        } catch { /* 缓存可丢弃，原包保持只读。 */ }
      }
      const entries = await indexArtistSampleFile(path, { signal: controller.signal, hashImages: Boolean(pack.model), onProgress: bytes => { if (pack.controller === controller) { pack.processedBytes = bytes; pack.progress = info.size ? bytes / info.size * 100 : 0; onProgress(); } } });
      if (revisionFor(identityFor(pack, await stat(path))) !== revision) throw failure('索引期间图包发生变化，请重新建立索引');
      if (controller.signal.aborted || pack.controller !== controller) return;
      await mkdir(cacheDir, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ identity, entries }));
      await rename(temporary, file);
      if (!controller.signal.aborted && pack.controller === controller) publish(pack, entries);
    } catch (error) { if (pack.controller === controller && !controller.signal.aborted) Object.assign(pack, { phase: 'error', error: error.code ? '图包文件不可读取，请重新选择文件' : error.message }); }
  };
  // 固定清单只合并轻量偏移；图片仍从原分片读取，页码按清单顺序保持稳定。
  const startGroup = async (pack, reuse = true) => {
    pack.controller?.abort();
    const controller = new AbortController(); pack.controller = controller;
    Object.assign(pack, { phase: 'indexing', entries: null, count: 0, progress: 0, processedBytes: 0, totalBytes: pack.size, error: undefined });
    try {
      const children = [], entries = Object.create(null), seen = new Map();
      let processed = 0;
      for (const file of pack.files) {
        const child = { ...file, id: pack.id, model: pack.model, path: file.path || join(dirname(pack.path), file.filename) };
        controller.signal.throwIfAborted();
        controller.signal.addEventListener('abort', () => child.controller?.abort(), { once: true });
        await start(child, reuse, () => { pack.processedBytes = processed + child.processedBytes; pack.progress = pack.processedBytes / pack.size * 100; });
        controller.signal.throwIfAborted();
        if (child.phase !== 'ready') throw failure(`Full 分片 ${file.filename} 不可用：${child.error || '请确认文件齐备'}`);
        const childIndex = children.length; children.push(child);
        for (const [tag, entry] of Object.entries(child.entries)) {
          if (!entry.count) continue;
          const combined = entries[tag] ||= { count: 0, segments: [] };
          if (pack.layout === 'exact-image-v1') {
            const hashes = seen.get(tag) || new Set(); seen.set(tag, hashes);
            const indices = [];
            entry.hashes.forEach((hash, index) => { if (!hashes.has(hash)) { hashes.add(hash); indices.push(index); } });
            if (indices.length) combined.segments.push({ childIndex, entry, indices });
            combined.count += indices.length;
          } else { combined.segments.push({ childIndex, entry }); combined.count += entry.count; }
        }
        processed += child.totalBytes; pack.processedBytes = processed; pack.progress = processed / pack.size * 100;
      }
      const identity = { sourceId: pack.sourceId, version: VERSION, ...(pack.layout === 'exact-image-v1' ? { layout: pack.layout } : {}), children: await Promise.all(children.map(async child => identityFor(child, await stat(child.path)))) };
      const revision = revisionFor(identity);
      await mkdir(cacheDir, { recursive: true });
      const file = join(cacheDir, `${pack.id}-${revision}.json`), temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ identity })); await rename(temporary, file);
      controller.signal.throwIfAborted();
      if (!(await Promise.all(children.map(verify))).every(Boolean)) throw failure('索引期间 Full 分片发生变化');
      if (pack.controller !== controller) return;
      Object.assign(pack, { children, revision, imageCount: Object.values(entries).reduce((sum, entry) => sum + entry.count, 0) }); publish(pack, entries);
    } catch (error) { if (pack.controller === controller && !controller.signal.aborted) Object.assign(pack, { phase: 'error', error: error.code ? 'Full 分片缺失或不可读取，请确认同目录文件齐备' : error.message }); }
  };
  const downloadFiles = pack => pack.files || [pack];
  const downloadedBytes = async pack => (await Promise.all(downloadFiles(pack).map(async file => {
    const destination = join(downloadDirectory, file.filename), size = await fileSize(destination);
    return size === file.size ? size : await fileSize(`${destination}.download`);
  }))).reduce((sum, bytes) => sum + bytes, 0);
  // 已核实来源的索引只在文件身份与固定摘要均未变化时复用，避免每次启动重读数 GB。
  const verifiedFull = async (path, definition, signal) => {
    signal?.throwIfAborted();
    try {
      const identity = identityFor({ ...definition, path }, await stat(path));
      const saved = JSON.parse(await readFile(join(cacheDir, `${definition.id}-${revisionFor(identity)}.json`), 'utf8'));
      if (JSON.stringify(saved.identity) === JSON.stringify(identity)) return true;
    } catch { /* 首次关联或文件变化时重新核实原文件。 */ }
    const before = identityFor({ ...definition, path }, await stat(path));
    const verified = await verifiedFile(path, definition, signal);
    return verified && JSON.stringify(before) === JSON.stringify(identityFor({ ...definition, path }, await stat(path)));
  };
  const currentSources = pack => Object.fromEntries((pack.children || []).map(child => [child.filename, child.path]));
  const subset = (definition, sources, sourceId = definition.sourceId) => {
    const files = definition.files.filter(file => sources[file.filename]).map(file => ({ ...file, path: sources[file.filename] }));
    if (!files.length) throw failure('没有已选择的画师图包');
    return { ...definition, sourceId, files, size: files.reduce((sum, file) => sum + file.size, 0), path: files[0].path };
  };
  const activate = async (pack, definition, sources, signal) => {
    const candidate = subset(definition, sources);
    signal?.throwIfAborted();
    signal?.addEventListener('abort', () => candidate.controller?.abort(), { once: true });
    await start(candidate);
    signal?.throwIfAborted();
    if (candidate.phase !== 'ready') throw failure(candidate.error || '图包索引失败');
    const preferences = await loadPreferences();
    const files = Object.fromEntries(Object.entries(sources).map(([filename, path]) => [filename, path === join(downloadDirectory, filename) ? 'managed' : path]));
    signal?.throwIfAborted();
    await savePreferences({ artistSamplePacks: { ...preferences.artistSamplePacks, [pack.id]: { sourceId: definition.sourceId, files } } });
    // 保存成功即完成本片接入；迟到的暂停不能让磁盘偏好与当前可用集合分叉。
    Object.assign(pack, candidate, { managed: Object.values(files).every(path => path === 'managed') });
  };
  const initialized = (async () => {
    const preferences = await loadPreferences();
    if (closed) return;
    for (const pack of packs.values()) {
      const preference = preferences.artistSamplePacks?.[pack.id];
      if (pack.files) {
        const states = new Map(); fileStates.set(pack.id, states);
        for (const file of pack.files) {
          const size = await fileSize(join(downloadDirectory, file.filename)), partial = await fileSize(join(downloadDirectory, `${file.filename}.download`));
          states.set(file.filename, { filename: file.filename, size: file.size, download: { stage: size === file.size ? 'ready' : partial ? 'paused' : 'missing', receivedBytes: size === file.size ? size : partial, totalBytes: file.size } });
        }
        const receivedBytes = [...states.values()].reduce((sum, file) => sum + file.download.receivedBytes, 0);
        pack.download = { stage: receivedBytes === pack.size ? 'ready' : receivedBytes ? 'paused' : 'missing', receivedBytes, totalBytes: pack.size };
        let sources, sourceId = pack.sourceId;
        if (preference && typeof preference === 'object' && preference.files && typeof preference.files === 'object' && !Array.isArray(preference.files)) {
          sources = {};
          for (const [filename, path] of Object.entries(preference.files)) {
            if (!states.has(filename) || (path !== 'managed' && (typeof path !== 'string' || !isAbsolute(path)))) throw failure('图包关联配置无效，请保留资料并检查设置');
            sources[filename] = path === 'managed' ? join(downloadDirectory, filename) : path;
          }
          sourceId = preference.sourceId;
        } else if (preference === managedPreference(pack) || preference === 'managed:v5-full-all-six-v1') {
          sourceId = preference.slice('managed:'.length);
          sources = Object.fromEntries(pack.files.filter(file => preference !== 'managed:v5-full-all-six-v1' || file.filename !== 'NAID5-STYLISH-8000').map(file => [file.filename, join(downloadDirectory, file.filename)]));
        } else if (typeof preference === 'string' && isAbsolute(preference) && pack.files.some(file => file.filename === basename(preference))) {
          const previous = pack.files.filter(file => file.filename !== 'NAID5-STYLISH-8000');
          sources = Object.fromEntries(previous.map(file => [file.filename, join(dirname(preference), file.filename)]));
          if (pack.files.length === 7) sourceId = 'v5-full-all-six-v1';
        }
        if (sources && Object.keys(sources).length) {
          const candidate = subset(pack, sources, sourceId);
          if (sourceId === 'v5-full-all-six-v1') {
            // 旧偏好未单独记录布局；优先复用已有精确布局，只有旧 concat 描述时保留原页序。
            try {
              const children = await Promise.all(candidate.files.map(async file => identityFor({ ...file, id: pack.id, model: pack.model, path: file.path }, await stat(file.path))));
              const exact = { sourceId, version: VERSION, layout: 'exact-image-v1', children }, concat = { sourceId, version: VERSION, children };
              if (!await fileSize(join(cacheDir, `${pack.id}-${revisionFor(exact)}.json`)) && await fileSize(join(cacheDir, `${pack.id}-${revisionFor(concat)}.json`))) candidate.layout = undefined;
            } catch { /* 缺文件由正常索引状态明确反馈，不自动下载。 */ }
          }
          Object.assign(pack, candidate, { managed: Object.values(sources).every(path => dirname(path) === downloadDirectory) });
          void start(pack); continue;
        }
      }
      const destination = join(downloadDirectory, pack.files?.[0].filename || pack.filename);
      const size = pack.files ? await downloadedBytes(pack) : await fileSize(destination), partial = pack.files ? size : await fileSize(`${destination}.download`);
      if (closed) return;
      pack.download = { stage: size === pack.size ? 'ready' : partial ? 'paused' : 'missing', receivedBytes: size === pack.size ? size : partial, totalBytes: pack.size };
      pack.managed = preference === managedPreference(pack) || preference === 'managed';
      if (pack.files && pack.managed && preference !== 'managed') { pack.path = destination; void start(pack); continue; }
      const path = preference === 'managed' && pack.id === 'v5' && pack.sourceId
        ? join(downloadDirectory, LEGACY_V5_FILENAME) : pack.managed ? destination : preference;
      if (typeof path === 'string' && isAbsolute(path)) {
        pack.path = path;
        if (targetModel.get(pack.id)) {
          if (pack.files && preference !== 'managed' && pack.files.some(file => file.filename === basename(path))) { void start(pack); continue; }
          const full = preference !== 'managed' && !pack.files && await verifiedFull(path, pack).catch(() => false);
          if (!full) {
            delete pack.model; delete pack.sourceId;
            pack.label = preference === 'managed' ? 'NAI V5 Curated（旧来源）' : 'NAI V5（未核实来源）';
            pack.sourceUrl = preference === 'managed' ? `https://huggingface.co/${DOWNLOAD_MODEL.id}/blob/${DOWNLOAD_MODEL.revision}/NAIA/NAID5_artist_thumbnail/${LEGACY_V5_FILENAME}` : '';
          }
        }
        void start(pack);
      } else if (targetModel.get(pack.id)) { delete pack.model; delete pack.sourceId; }
    }
  })();
  const status = async canManage => {
    await initialized;
    await Promise.all([...packs.values()].map(verify));
    return { available: true, canManage, ...(canManage ? { downloadDirectory } : {}), packs: [...packs.values()].map(({ id, label, filename, path, managed, download, phase, progress, processedBytes, totalBytes, count, revision, error, model, imageCount, children }) => ({ id, ...(model ? { model } : {}), label, filename: children ? `V5 Full（${children.length}个图包）` : path ? basename(path) : filename, ...(children ? { imageCount } : {}), managed, download: { ...download }, ...(fileStates.has(id) ? { files: [...fileStates.get(id).values()].map(file => {
      const child = phase === 'ready' && children?.find(child => child.filename === file.filename);
      return { ...file, download: { ...file.download }, active: Boolean(child), ...(child ? { count: child.sampleTagCount } : {}) };
    }) } : {}), ...(canManage && path ? { path } : {}), phase, progress, processedBytes, totalBytes, count, revision, ...(error ? { error } : {}) })) };
  };
  const match = (pack, tag) => Object.hasOwn(pack.entries, tag) ? tag : pack.aliases.get(normalize(tag));
  const lookup = async (id, tag) => {
    await initialized; const pack = get(id); const ready = await verify(pack);
    const key = ready && visible(pack) ? match(pack, tag) : null;
    return { pack: id, ...(pack.model ? { model: pack.model } : {}), revision: pack.revision, tag, ...(key ? { canonicalTag: key } : {}), imageCount: key ? pack.entries[key].count : 0, sourceUrl: pack.sourceUrl };
  };
  const readImage = async source => {
    await initialized;
    const url = validateArtistSampleSource(source), active = get(url.searchParams.get('pack'));
    const requestedRevision = url.searchParams.get('revision');
    let pack = active;
    if (active.id === 'v5' && active.revision !== requestedRevision) {
      const key = `${active.id}-${requestedRevision}`;
      if (!historical.has(key)) historical.set(key, (async () => {
        const saved = JSON.parse(await readFile(join(cacheDir, `${key}.json`), 'utf8'));
        if (!saved.identity || (!saved.identity.children && !isAbsolute(saved.identity.path || '')) || revisionFor(saved.identity) !== requestedRevision) throw failure('画师图包索引失效，请刷新后重试');
        const original = saved.identity.children ? { id: active.id, model: targetModel.get(active.id), sourceId: saved.identity.sourceId, layout: saved.identity.layout, size: saved.identity.children.reduce((sum, child) => sum + child.size, 0), path: saved.identity.children[0]?.path, files: saved.identity.children.map(child => ({ ...child, filename: basename(child.path) })) } : { id: active.id, path: saved.identity.path, ...(saved.identity.sourceId ? { sourceId: saved.identity.sourceId, model: targetModel.get(active.id), sha256: saved.identity.sha256, size: saved.identity.size } : {}) };
        await start(original);
        return original;
      })().catch(error => { historical.delete(key); throw error; }));
      try { pack = await historical.get(key); } catch { throw failure('画师图包索引失效，请刷新后重试'); }
    }
    if (!await verify(pack) || pack.revision !== requestedRevision) throw failure('画师图包索引失效，请刷新后重试');
    const key = match(pack, url.searchParams.get('tag'));
    let entry = key && pack.entries[key], index = Number(url.searchParams.get('index'));
    if (!entry || index >= entry.count) throw Object.assign(failure('未找到画师样张'), { status: 404 });
    if (entry.segments) {
      const group = pack;
      for (const segment of entry.segments) {
        const count = segment.indices?.length ?? segment.entry.count;
        if (index < count) { pack = group.children[segment.childIndex]; entry = segment.entry; index = segment.indices?.[index] ?? index; break; }
        index -= count;
      }
    }
    // shortcut: 单画师数组限64MiB，上游出现更大条目时再增加数组内图片偏移索引。
    if (entry.end - entry.start > 64 * 1024 * 1024) throw failure('单个画师图片组过大');
    const { path, revision, controller, children } = pack;
    const unchanged = () => pack.path === path && pack.revision === revision && pack.controller === controller && pack.children === children;
    const assertCurrent = () => { if (!unchanged()) throw failure('画师图包索引失效，请刷新后重试'); };
    const handle = await open(path, 'r').catch(() => { assertCurrent(); invalidate(pack); throw failure('画师图包文件不可读取，请重新选择'); });
    const verifyHandle = async () => {
      const info = await handle.stat(); assertCurrent();
      if (revisionFor(identityFor(pack, info)) !== revision) { invalidate(pack); throw failure('图包文件已变化'); }
    };
    try {
      assertCurrent(); await verifyHandle();
      const bytes = Buffer.alloc(entry.end - entry.start); let read = 0;
      while (read < bytes.length) { const result = await handle.read(bytes, read, bytes.length - read, entry.start + read); if (!result.bytesRead) throw failure('图包文件不完整'); read += result.bytesRead; }
      const valid = await verify(pack); assertCurrent();
      if (!valid) { invalidate(pack); throw failure('图包文件已变化'); }
      await verifyHandle();
      const images = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(images) || images.length !== entry.count || typeof images[index] !== 'string') throw failure('画师图片组无效');
      const encoded = images[index].replace(/^data:image\/(?:jpeg|png|webp);base64,/, '');
      if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw failure('画师样张 Base64 无效');
      const buffer = Buffer.from(encoded, 'base64');
      const contentType = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 ? 'image/jpeg'
        : buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
        : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : '';
      if (!contentType) throw failure('画师样张不是受支持的图片');
      const { default: sharp } = await import('sharp');
      try { await sharp(buffer, { failOn: 'warning', limitInputPixels: 16000000 }).stats(); }
      catch { throw failure('画师样张图片损坏或尺寸过大'); }
      assertCurrent(); return { status: 200, buffer, headers: { 'content-type': contentType } };
    } catch (error) { assertCurrent(); if (error.code) { invalidate(pack); throw failure('画师图包文件不可读取，请重新建立索引'); } throw error; }
    finally { await handle.close(); }
  };
  const downloadGroup = (pack, definition, filename) => {
    const states = fileStates.get(pack.id), selected = filename ? definition.files.filter(file => file.filename === filename) : definition.files;
    const task = { pack, file: filename, currentFilename: selected[0].filename, controller: new AbortController(), promise: null };
    const idle = new AbortController(), timer = setTimeout(() => idle.abort(new DOMException('图包下载无进度', 'TimeoutError')), downloadTimeoutMs);
    const signal = AbortSignal.any([task.controller.signal, idle.signal]);
    const summarize = (stage, error) => { pack.download = { stage, receivedBytes: [...states.values()].reduce((sum, file) => sum + file.download.receivedBytes, 0), totalBytes: definition.size, ...(error ? { error } : {}) }; };
    activeDownload = task; summarize('downloading');
    task.promise = (async () => {
      try {
        for (const file of selected) {
          task.currentFilename = file.filename;
          const state = states.get(file.filename); let previous = 0;
          await downloadTaggerFile({ model: DOWNLOAD_MODEL, file: { ...file, name: file.filename, label: '画师图包' }, directory: downloadDirectory, fetchRemote, signal,
            onProgress: (receivedBytes, stage) => {
              if (receivedBytes > previous) timer.refresh(); previous = receivedBytes;
              state.download = { stage: stage === 'verified' ? 'verifying' : stage, receivedBytes, totalBytes: file.size };
              summarize(state.download.stage);
            } });
          signal.throwIfAborted();
          const sources = { ...currentSources(pack), [file.filename]: join(downloadDirectory, file.filename) };
          await activate(pack, definition, sources, signal);
          state.download = { stage: 'ready', receivedBytes: file.size, totalBytes: file.size };
          summarize('downloading');
        }
        summarize('ready');
      } catch (error) {
        const state = states.get(task.currentFilename), file = definition.files.find(file => file.filename === task.currentFilename);
        const receivedBytes = await downloadedBytes(file).catch(() => state.download.receivedBytes);
        const message = signal.aborted && signal.reason?.name === 'TimeoutError' ? '画师图包下载超时，已保留下载内容，请点击继续下载'
          : error.code ? '画师图包下载失败，请检查网络与资源目录后重试' : error.message;
        state.download = { stage: task.controller.signal.aborted ? 'paused' : 'error', receivedBytes, totalBytes: file.size, ...(task.controller.signal.aborted ? {} : { error: message }) };
        summarize(state.download.stage, state.download.error);
      } finally { clearTimeout(timer); if (activeDownload === task) activeDownload = null; }
    })();
  };
  const control = async (action, id, filename) => {
    await initialized; const pack = get(id);
    const definition = registry.find(item => item.id === id);
    if (filename !== undefined && (!['download', 'pause'].includes(action) || typeof filename !== 'string' || !definition.files?.some(file => file.filename === filename))) throw failure('无效的画师图包文件');
    if (closed) throw failure('工坊服务正在关闭，请重新打开后操作');
    if (action === 'pause') {
      if (activeDownload?.pack === pack && (filename === undefined || activeDownload.currentFilename === filename)) { const task = activeDownload; task.controller.abort(); await task.promise; }
      return {};
    }
    if (action === 'download') {
      if (activeDownload) {
        if (activeDownload.pack === pack && (filename === undefined || activeDownload.file === filename)) return {};
        throw Object.assign(failure('已有其他画师图包正在下载，请先暂停或等待完成'), { status: 409 });
      }
      if (pickerOpen) throw Object.assign(failure('请先完成文件选择'), { status: 409 });
      if (definition.files) { downloadGroup(pack, definition, filename); return {}; }
      const task = { pack, controller: new AbortController(), promise: null };
      const idleController = new AbortController();
      const idleTimer = setTimeout(() => idleController.abort(new DOMException('画师图包下载长时间没有进展', 'TimeoutError')), downloadTimeoutMs);
      const signal = AbortSignal.any([task.controller.signal, idleController.signal]);
      activeDownload = task;
      pack.download = { stage: 'downloading', receivedBytes: pack.download.receivedBytes, totalBytes: pack.size };
      task.promise = (async () => {
        let verified = false, lastReceivedBytes = 0;
        try {
          const files = downloadFiles(definition), received = await Promise.all(files.map(file => downloadedBytes(file)));
          for (const [fileIndex, file] of files.entries()) {
            let fileReceived = 0;
            await downloadTaggerFile({ model: DOWNLOAD_MODEL, file: { ...file, name: file.filename, label: '画师图包' }, directory: downloadDirectory, fetchRemote, signal,
              onProgress: (receivedBytes, stage) => {
                if (receivedBytes > fileReceived) idleTimer.refresh();
                fileReceived = receivedBytes; received[fileIndex] = receivedBytes; lastReceivedBytes = received.reduce((sum, bytes) => sum + bytes, 0);
                pack.download = { stage: stage === 'verified' ? 'verifying' : stage, receivedBytes: lastReceivedBytes, totalBytes: definition.size };
              } });
          }
          verified = true;
          signal.throwIfAborted();
          const preferences = await loadPreferences();
          signal.throwIfAborted();
          let indexed;
          if (definition.model) {
            indexed = { ...definition, path: join(downloadDirectory, definition.files?.[0].filename || definition.filename) };
            signal.addEventListener('abort', () => indexed.controller?.abort(), { once: true });
            await start(indexed);
            signal.throwIfAborted();
            if (indexed.phase !== 'ready') throw failure(indexed.error || 'Full 图包索引失败');
          }
          await savePreferences({ artistSamplePacks: { ...preferences.artistSamplePacks, [id]: managedPreference(definition) } });
          signal.throwIfAborted();
          if (indexed) Object.assign(pack, indexed, { managed: true });
          else { pack.path = join(downloadDirectory, pack.filename); pack.managed = true; void start(pack); }
          pack.download = { stage: 'ready', receivedBytes: pack.size, totalBytes: pack.size };
        } catch (error) {
          const receivedBytes = verified ? pack.size : await downloadedBytes(definition).catch(() => pack.download.receivedBytes);
          pack.download = { stage: task.controller.signal.aborted ? 'paused' : 'error', receivedBytes, totalBytes: pack.size,
            ...(task.controller.signal.aborted ? {} : { error: signal.aborted && signal.reason?.name === 'TimeoutError'
              ? '画师图包下载超时，已保留下载内容，请点击继续下载'
              : error.code ? '画师图包下载失败，请检查网络与资源目录后重试' : error.message }) };
        } finally { clearTimeout(idleTimer); if (activeDownload === task) activeDownload = null; }
      })();
      return {};
    }
    if (activeDownload && ['pick', 'remove'].includes(action)) throw Object.assign(failure('请先暂停图包下载，再更改关联'), { status: 409 });
    if (activeDownload?.pack === pack && action === 'reindex') throw Object.assign(failure('请先暂停当前图包下载'), { status: 409 });
    if (action === 'pick') {
      if (pickerOpen) throw failure('已有文件选择窗口，请先完成或取消选择');
      pickerOpen = true;
      try {
        const result = await pickFile(pack.path);
        if (result.cancelled || !result.path) return { cancelled: true };
        if (!isAbsolute(result.path) || !(await stat(result.path)).isFile()) throw failure('请选择普通图包文件');
        const definition = registry.find(item => item.id === id);
        if (definition.files) {
          if (!definition.files.some(file => file.filename === basename(result.path))) throw failure('请选择注册的画师图包文件');
          await activate(pack, definition, { ...currentSources(pack), [basename(result.path)]: result.path });
          return { cancelled: false };
        }
        let indexed;
        if (definition.model) {
          if (definition.files && !definition.files.some(file => file.filename === basename(result.path))) throw failure('请选择注册的 Full 分片，并将全部必需分片放在同一目录');
          if (!definition.files && !await verifiedFull(result.path, definition)) throw failure('请选择已核实的 NAI V5 Full 图包（NAID5F-55000-Q）');
          indexed = { ...definition, path: result.path };
          await start(indexed);
          if (indexed.phase !== 'ready') throw failure(indexed.error || 'Full 图包索引失败');
        }
        const preferences = await loadPreferences();
        await savePreferences({ artistSamplePacks: { ...preferences.artistSamplePacks, [id]: result.path } });
        if (indexed) Object.assign(pack, indexed, { managed: false });
        else { pack.path = result.path; pack.managed = false; void start(pack); }
        return { cancelled: false };
      } finally { pickerOpen = false; }
    }
    if (action === 'cancel') { pack.controller?.abort(); Object.assign(pack, { phase: pack.path ? 'error' : 'unconfigured', entries: null, count: 0, error: pack.path ? '索引已取消，可重新建立索引' : undefined }); }
    else if (action === 'reindex') { if (!pack.path) throw failure('请先选择图包文件'); void start(pack, false); }
    else if (action === 'remove') {
      const preferences = await loadPreferences(), configured = { ...preferences.artistSamplePacks }; delete configured[id];
      await savePreferences({ artistSamplePacks: configured }); pack.controller?.abort();
      Object.assign(pack, { path: '', managed: false, phase: 'unconfigured', entries: null, children: undefined, imageCount: undefined, count: 0, revision: '', progress: 0, processedBytes: 0, totalBytes: 0, error: undefined });
      if (targetModel.get(id)) { delete pack.model; delete pack.sourceId; }
    } else throw failure('未知图包操作');
    return {};
  };
  return { status, lookup, readImage, control, catalog: async id => { await initialized; const pack = get(id), ready = await verify(pack); return { pack: id, ...(pack.model ? { model: pack.model } : {}), revision: pack.revision, tags: ready && visible(pack) ? Object.keys(pack.entries) : [] }; }, downloading: () => Boolean(activeDownload), busy: () => Boolean(activeDownload || pickerOpen || [...packs.values()].some(pack => pack.phase === 'indexing')), close: () => { closed = true; for (const pack of packs.values()) pack.controller?.abort(); activeDownload?.controller.abort(); return activeDownload?.promise || Promise.resolve(); } };
}

let picking = false;
export async function pickArtistSampleFile(initialPath = '', execute = promisify(execFile)) {
  if (process.platform !== 'win32') throw failure('图包管理仅支持 Windows 电脑本机');
  if (picking) throw failure('已有文件选择窗口打开');
  picking = true;
  try {
    // 隐藏控制台，透明置顶 owner 保持系统文件窗口可见；路径通过环境传入。
    const script = '[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding; Add-Type -AssemblyName System.Windows.Forms; $owner=New-Object System.Windows.Forms.Form; $owner.TopMost=$true; $owner.Opacity=0; $owner.ShowInTaskbar=$false; $owner.StartPosition="CenterScreen"; $picker=New-Object System.Windows.Forms.OpenFileDialog; $picker.Title="选择画师图包"; $picker.Filter="所有文件 (*.*)|*.*"; $picker.FileName=$env:NAI_ARTIST_PICK_INITIAL; try { $owner.Show(); $owner.Activate(); if($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Write($picker.FileName)} } finally { $picker.Dispose(); $owner.Dispose() }';
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 300000, maxBuffer: 32768, encoding: 'utf8', env: { ...process.env, NAI_ARTIST_PICK_INITIAL: initialPath } });
    const path = stdout.trim(); return { path, cancelled: !path };
  } catch (error) { if (error.killed) throw failure('文件选择等待超时，请重新选择'); throw failure('系统文件选择失败，请重新选择图包'); }
  finally { picking = false; }
}

export function requestDesktopArtistSampleFile(channel = process, initialPath = '', timeout = 300000) {
  if (!channel.connected) return Promise.reject(failure('桌面应用连接中断'));
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const finish = (error, result) => { clearTimeout(timer); channel.off('message', receive); channel.off('disconnect', disconnected); error ? reject(error) : resolve(result); };
    const receive = message => { if (message?.type === 'atelier-artist-file-result' && message.requestId === requestId) finish(message.error ? failure(message.error) : null, message.result); };
    const disconnected = () => finish(failure('桌面应用连接中断'));
    const timer = setTimeout(() => finish(failure('文件选择等待超时，请重新选择')), timeout);
    channel.on('message', receive); channel.once('disconnect', disconnected);
    try { channel.send({ type: 'atelier-artist-file-pick', requestId, initialPath }); } catch (error) { finish(error); }
  });
}
