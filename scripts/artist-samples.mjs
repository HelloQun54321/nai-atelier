import { createReadStream } from 'node:fs';
import { open, stat, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { basename, dirname, join, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { downloadTaggerFile, fileSize } from './tagger-model-download.mjs';

export const ARTIST_SAMPLE_PACKS = [
  { id: 'v45', label: 'NAI V4.5', filename: 'artist_thumbnail_nai', sourcePath: 'NAIA/NAID4.5_artist_thumbnail_31000/artist_thumbnail_nai', size: 2725799839, sha256: 'd7b067a66af6924e60d4a2f3df557b84de2bbfecdd95228152129b830f480ad5', sourceUrl: 'https://huggingface.co/baqu2213/PoemForSmallFThings/blob/main/NAIA/NAID4.5_artist_thumbnail_31000/artist_thumbnail_nai' },
  { id: 'v5', label: 'NAI V5', filename: 'NAID5-33000-55000-Curated', sourcePath: 'NAIA/NAID5_artist_thumbnail/NAID5-33000-55000-Curated', size: 1030625005, sha256: '724ee2b0c906159c22ba28566f0d0aa2aee350e81896294ac0ded22c23144fac', sourceUrl: 'https://huggingface.co/baqu2213/PoemForSmallFThings/blob/main/NAIA/NAID5_artist_thumbnail/NAID5-33000-55000-Curated' },
];
const DOWNLOAD_MODEL = { id: 'baqu2213/PoemForSmallFThings', revision: '25e2826178464c2d49bdcca5ca6cbe44dcd9f162' };
const VERSION = 1;
const normalize = value => value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const whitespace = byte => [32, 9, 10, 13].includes(byte);
const failure = message => Object.assign(new Error(message), { status: 400 });
const signature = (path, info) => ({ path, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, ino: info.ino, dev: info.dev, version: VERSION });
const revisionFor = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

// 只扫描顶层对象及字符串数组的字节语法，不将整包或图片内容载入内存。
export async function indexArtistSampleFile(path, { signal, onProgress = () => {}, highWaterMark = 1024 * 1024 } = {}) {
  const entries = Object.create(null);
  let offset = 0, state = 'object', stringKind = '', escaped = false, unicodeLeft = 0;
  let keyBytes = [], key = '', start = 0, count = 0, canClose = true;
  const stream = createReadStream(path, { highWaterMark, signal });
  for await (const chunk of stream) {
    for (const byte of chunk) {
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
          } else { count++; state = 'arrayEnd'; }
          stringKind = '';
        } else if (byte < 32 || (stringKind === 'image' && byte > 127)) throw failure('图包包含无效的图片字符串');
      } else if (!whitespace(byte)) {
        if (state === 'object' && byte === 123) state = 'key';
        else if (state === 'key' && byte === 34) { stringKind = 'key'; keyBytes = [34]; }
        else if (state === 'key' && byte === 125 && canClose) state = 'done';
        else if (state === 'colon' && byte === 58) state = 'array';
        else if (state === 'array' && byte === 91) { start = offset; count = 0; canClose = true; state = 'item'; }
        else if (state === 'item' && byte === 34) stringKind = 'image';
        else if ((state === 'arrayEnd' || (state === 'item' && canClose)) && byte === 93) {
          entries[key] = { start, end: offset + 1, count }; state = 'entryEnd';
        } else if (state === 'arrayEnd' && byte === 44) { state = 'item'; canClose = false; }
        else if (state === 'entryEnd' && byte === 44) { state = 'key'; canClose = false; }
        else if (state === 'entryEnd' && byte === 125) state = 'done';
        else throw failure('图包不是完整的画师图片 JSON 对象');
      }
      offset++;
    }
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
  const packs = new Map(registry.map(pack => [pack.id, { ...pack, managed: false, download: { stage: 'missing', receivedBytes: 0, totalBytes: pack.size }, path: '', phase: 'unconfigured', progress: 0, processedBytes: 0, totalBytes: 0, count: 0, revision: '', entries: null, aliases: new Map(), controller: null }]));
  const get = id => { const pack = packs.get(id); if (!pack) throw failure('未知画师图包'); return pack; };
  const publish = (pack, entries) => {
    const aliases = new Map();
    for (const tag of Object.keys(entries)) { const name = normalize(tag); aliases.set(name, aliases.has(name) ? null : tag); }
    Object.assign(pack, { entries, aliases, count: Object.keys(entries).length, phase: 'ready', progress: 100, processedBytes: pack.totalBytes });
  };
  const invalidate = pack => { pack.controller?.abort(); Object.assign(pack, { entries: null, count: 0, phase: 'error', error: '图包文件已变化或不可读取，请重新建立索引' }); };
  const verify = async pack => {
    if (pack.phase !== 'ready') return false;
    try { if (revisionFor(signature(pack.path, await stat(pack.path))) !== pack.revision) { invalidate(pack); return false; } }
    catch { invalidate(pack); return false; }
    return true;
  };
  const start = async (pack, reuse = true) => {
    if (closed) return;
    pack.controller?.abort();
    const controller = new AbortController(); pack.controller = controller;
    Object.assign(pack, { phase: 'indexing', progress: 0, processedBytes: 0, count: 0, entries: null, error: undefined });
    try {
      const path = pack.path, info = await stat(path);
      if (controller.signal.aborted || pack.controller !== controller) return;
      if (!info.isFile()) throw failure('请选择图包文件');
      const identity = signature(path, info); pack.totalBytes = info.size; pack.revision = revisionFor(identity);
      const revision = pack.revision;
      const file = join(cacheDir, `${pack.id}-${pack.revision}.json`);
      if (reuse) {
        try {
          const saved = JSON.parse(await readFile(file, 'utf8'));
          if (JSON.stringify(saved.identity) === JSON.stringify(identity) && saved.entries && typeof saved.entries === 'object' && !Array.isArray(saved.entries)
            && Object.values(saved.entries).every(entry => Number.isSafeInteger(entry.start) && Number.isSafeInteger(entry.end) && entry.start >= 0 && entry.end > entry.start && entry.end <= info.size && Number.isSafeInteger(entry.count) && entry.count >= 0)) {
            if (controller.signal.aborted || pack.controller !== controller) return;
            publish(pack, saved.entries); return;
          }
        } catch { /* 缓存可丢弃，原包保持只读。 */ }
      }
      const entries = await indexArtistSampleFile(path, { signal: controller.signal, onProgress: bytes => { if (pack.controller === controller) { pack.processedBytes = bytes; pack.progress = info.size ? bytes / info.size * 100 : 0; } } });
      if (revisionFor(signature(path, await stat(path))) !== revision) throw failure('索引期间图包发生变化，请重新建立索引');
      if (controller.signal.aborted || pack.controller !== controller) return;
      await mkdir(cacheDir, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ identity, entries }));
      await rename(temporary, file);
      if (!controller.signal.aborted && pack.controller === controller) publish(pack, entries);
    } catch (error) { if (pack.controller === controller && !controller.signal.aborted) Object.assign(pack, { phase: 'error', error: error.code ? '图包文件不可读取，请重新选择文件' : error.message }); }
  };
  const initialized = (async () => {
    const preferences = await loadPreferences();
    if (closed) return;
    for (const pack of packs.values()) {
      const preference = preferences.artistSamplePacks?.[pack.id];
      const destination = join(downloadDirectory, pack.filename);
      const size = await fileSize(destination), partial = await fileSize(`${destination}.download`);
      if (closed) return;
      pack.download = { stage: size === pack.size ? 'ready' : partial ? 'paused' : 'missing', receivedBytes: size === pack.size ? size : partial, totalBytes: pack.size };
      pack.managed = preference === 'managed';
      const path = pack.managed ? destination : preference;
      if (typeof path === 'string' && isAbsolute(path)) { pack.path = path; void start(pack); }
    }
  })();
  const status = async canManage => {
    await initialized;
    await Promise.all([...packs.values()].map(verify));
    return { available: true, canManage, ...(canManage ? { downloadDirectory } : {}), packs: [...packs.values()].map(({ id, label, filename, path, managed, download, phase, progress, processedBytes, totalBytes, count, revision, error }) => ({ id, label, filename: path ? basename(path) : filename, managed, download: { ...download }, ...(canManage && path ? { path } : {}), phase, progress, processedBytes, totalBytes, count, revision, ...(error ? { error } : {}) })) };
  };
  const match = (pack, tag) => Object.hasOwn(pack.entries, tag) ? tag : pack.aliases.get(normalize(tag));
  const lookup = async (id, tag) => {
    await initialized; const pack = get(id); const ready = await verify(pack);
    const key = ready ? match(pack, tag) : null;
    return { pack: id, revision: pack.revision, tag, imageCount: key ? pack.entries[key].count : 0, sourceUrl: pack.sourceUrl };
  };
  const readImage = async source => {
    await initialized;
    const url = validateArtistSampleSource(source), pack = get(url.searchParams.get('pack'));
    if (!await verify(pack) || pack.revision !== url.searchParams.get('revision')) throw failure('画师图包索引失效，请刷新后重试');
    const key = match(pack, url.searchParams.get('tag')), entry = key && pack.entries[key];
    const index = Number(url.searchParams.get('index'));
    if (!entry || index >= entry.count) throw Object.assign(failure('未找到画师样张'), { status: 404 });
    // shortcut: 单画师数组限64MiB，上游出现更大条目时再增加数组内图片偏移索引。
    if (entry.end - entry.start > 64 * 1024 * 1024) throw failure('单个画师图片组过大');
    const handle = await open(pack.path, 'r').catch(() => { invalidate(pack); throw failure('画师图包文件不可读取，请重新选择'); });
    try {
      if (revisionFor(signature(pack.path, await handle.stat())) !== pack.revision) { invalidate(pack); throw failure('图包文件已变化'); }
      const bytes = Buffer.alloc(entry.end - entry.start); let read = 0;
      while (read < bytes.length) { const result = await handle.read(bytes, read, bytes.length - read, entry.start + read); if (!result.bytesRead) throw failure('图包文件不完整'); read += result.bytesRead; }
      if (!await verify(pack) || revisionFor(signature(pack.path, await handle.stat())) !== pack.revision) { invalidate(pack); throw failure('图包文件已变化'); }
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
      return { status: 200, buffer, headers: { 'content-type': contentType } };
    } catch (error) { if (error.code) { invalidate(pack); throw failure('画师图包文件不可读取，请重新建立索引'); } throw error; }
    finally { await handle.close(); }
  };
  const control = async (action, id) => {
    await initialized; const pack = get(id);
    if (closed) throw failure('工坊服务正在关闭，请重新打开后操作');
    if (action === 'pause') {
      if (activeDownload?.pack === pack) { const task = activeDownload; task.controller.abort(); await task.promise; }
      return {};
    }
    if (action === 'download') {
      if (activeDownload) {
        if (activeDownload.pack === pack) return {};
        throw Object.assign(failure('已有其他画师图包正在下载，请先暂停或等待完成'), { status: 409 });
      }
      if (pickerOpen) throw Object.assign(failure('请先完成文件选择'), { status: 409 });
      const task = { pack, controller: new AbortController(), promise: null };
      const idleController = new AbortController();
      const idleTimer = setTimeout(() => idleController.abort(new DOMException('画师图包下载长时间没有进展', 'TimeoutError')), downloadTimeoutMs);
      const signal = AbortSignal.any([task.controller.signal, idleController.signal]);
      activeDownload = task;
      pack.download = { stage: 'downloading', receivedBytes: pack.download.receivedBytes, totalBytes: pack.size };
      task.promise = (async () => {
        let verified = false, lastReceivedBytes = 0;
        try {
          await downloadTaggerFile({ model: DOWNLOAD_MODEL, file: { name: pack.filename, sourcePath: pack.sourcePath, size: pack.size, sha256: pack.sha256, label: '画师图包' }, directory: downloadDirectory, fetchRemote, signal,
            onProgress: (receivedBytes, stage) => {
              if (receivedBytes > lastReceivedBytes) idleTimer.refresh();
              lastReceivedBytes = receivedBytes;
              pack.download = { stage: stage === 'verified' ? 'verifying' : stage, receivedBytes, totalBytes: pack.size };
            } });
          verified = true;
          signal.throwIfAborted();
          const preferences = await loadPreferences();
          signal.throwIfAborted();
          await savePreferences({ artistSamplePacks: { ...preferences.artistSamplePacks, [id]: 'managed' } });
          signal.throwIfAborted();
          pack.path = join(downloadDirectory, pack.filename); pack.managed = true;
          void start(pack);
          pack.download = { stage: 'ready', receivedBytes: pack.size, totalBytes: pack.size };
        } catch (error) {
          const receivedBytes = verified ? pack.size : await fileSize(join(downloadDirectory, `${pack.filename}.download`)).catch(() => pack.download.receivedBytes);
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
        const preferences = await loadPreferences();
        await savePreferences({ artistSamplePacks: { ...preferences.artistSamplePacks, [id]: result.path } });
        pack.path = result.path; pack.managed = false; void start(pack); return { cancelled: false };
      } finally { pickerOpen = false; }
    }
    if (action === 'cancel') { pack.controller?.abort(); Object.assign(pack, { phase: pack.path ? 'error' : 'unconfigured', entries: null, count: 0, error: pack.path ? '索引已取消，可重新建立索引' : undefined }); }
    else if (action === 'reindex') { if (!pack.path) throw failure('请先选择图包文件'); void start(pack, false); }
    else if (action === 'remove') {
      const preferences = await loadPreferences(), configured = { ...preferences.artistSamplePacks }; delete configured[id];
      await savePreferences({ artistSamplePacks: configured }); pack.controller?.abort();
      Object.assign(pack, { path: '', managed: false, phase: 'unconfigured', entries: null, count: 0, revision: '', progress: 0, processedBytes: 0, totalBytes: 0, error: undefined });
    } else throw failure('未知图包操作');
    return {};
  };
  return { status, lookup, readImage, control, catalog: async id => { await initialized; const pack = get(id); return { pack: id, revision: pack.revision, tags: await verify(pack) ? Object.keys(pack.entries) : [] }; }, downloading: () => Boolean(activeDownload), busy: () => Boolean(activeDownload || pickerOpen || [...packs.values()].some(pack => pack.phase === 'indexing')), close: () => { closed = true; for (const pack of packs.values()) pack.controller?.abort(); activeDownload?.controller.abort(); return activeDownload?.promise || Promise.resolve(); } };
}

let picking = false;
// macOS 用 osascript 弹出系统「选择文件」面板；取消（-128）视为未选择，初始路径经环境变量传入。
const MAC_FILE_SCRIPT = ['on run', 'activate', 'set initialPath to system attribute "NAI_ARTIST_PICK_INITIAL"', 'try',
  'if initialPath is "" then', 'set picked to choose file with prompt "选择画师图包"', 'else', 'set picked to choose file with prompt "选择画师图包" default location (POSIX file initialPath)', 'end if',
  'on error number -128', 'return ""', 'end try', 'return POSIX path of picked', 'end run'];

export async function pickArtistSampleFile(initialPath = '', execute = promisify(execFile), platform = process.platform) {
  if (!['win32', 'darwin'].includes(platform)) throw failure('图包管理仅支持 Windows 或 macOS 电脑本机');
  if (picking) throw failure('已有文件选择窗口打开');
  picking = true;
  try {
    if (platform === 'darwin') {
      // 初始路径若是文件，面板定位到它所在的文件夹。
      const folder = initialPath && !initialPath.endsWith('/') ? dirname(initialPath) : initialPath;
      const { stdout } = await execute('/usr/bin/osascript', MAC_FILE_SCRIPT.flatMap(line => ['-e', line]), { timeout: 300000, maxBuffer: 32768, encoding: 'utf8', env: { ...process.env, NAI_ARTIST_PICK_INITIAL: folder } });
      const path = stdout.trim(); return { path, cancelled: !path };
    }
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
