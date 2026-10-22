import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { open } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { extractPngMetadata, hasCollectibleNaiMetadata } from '../services/pngMetadata.mjs';
import { collectorErrorReason, downloadCollectorImage, imageLink } from './collector-download.mjs';
import { normalizeLanguage, translate } from '../locales/index.mjs';
import { CUPERTINO_WALLPAPERS, normalizeThemeBackground } from '../services/themeBackgroundData.mjs';

const collectorLabels = language => Object.fromEntries(['风格串', '收藏库', '提示词库', '原文', '存入', '未整理', '已选中', '待处理', '已保存', '跳过', '失败', 'Atelier 收集', '正在启动', '等待本机服务确认', '等待复制图片或图片链接', '暂停', '继续', '暂停接收新复制，已入队内容继续处理', '继续接收之后的新复制', '折叠状态窗', '展开状态窗', '结束收集', '已暂停', '收集中', ' · 已保存 ', '失败：', '外貌', '服饰', '动作', '表情', '场景', '镜头', '通用'].map(message => [message, translate(language, message)]));
const collectorWindowScript = fileURLToPath(new URL('./style-collector-window.ps1', import.meta.url));
let collectorPreparation;
const collectorWallpapers = new Map();

/** 只解码经校验的主题图片；原始几何与材质留给 WPF 按窗口实际尺寸处理。 */
export async function loadCollectorWallpapers(backgrounds = {}) {
  return Object.fromEntries(await Promise.all(['light', 'dark'].map(async mode => {
    const image = backgrounds[mode]?.image;
    if (!image) { collectorWallpapers.delete(mode); return [mode, '']; }
    const cached = collectorWallpapers.get(mode);
    if (cached?.image === image) return [mode, cached.encoded];
    try {
      if (!normalizeThemeBackground(backgrounds[mode])) throw new Error('外观背景无效');
      const bytes = Object.values(CUPERTINO_WALLPAPERS).includes(image) ? fileURLToPath(new URL(`../public${image}`, import.meta.url)) : Buffer.from(image.split(',')[1], 'base64');
      if (Buffer.isBuffer(bytes) && !(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) || bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')) throw new Error('背景图片格式无效');
      const source = sharp(bytes, { limitInputPixels: 16_777_216 });
      const { hasAlpha } = await source.metadata();
      const display = source.resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true });
      // 只压缩小窗显示副本；保留透明通道，材质参数仍在原生端独立应用。
      const encoded = (await (hasAlpha ? display.png({ compressionLevel: 9 }) : display.jpeg({ quality: 85 })).toBuffer()).toString('base64');
      collectorWallpapers.set(mode, { image, encoded });
      return [mode, encoded];
    } catch { collectorWallpapers.delete(mode); return [mode, '']; }
  })));
}

/** 后台只准备程序集，不构造窗口、不注册剪贴板；同一服务共用一次准备。 */
export function prepareWindowsCollector() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  if (collectorPreparation) return collectorPreparation;
  collectorPreparation = new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', collectorWindowScript, '-LoadOnly'], { windowsHide: true, stdio: 'ignore' });
    const timeout = setTimeout(() => { child.kill(); resolve(false); }, 8000); timeout.unref(); child.unref();
    child.once('error', () => { clearTimeout(timeout); resolve(false); });
    child.once('exit', code => { clearTimeout(timeout); resolve(code === 0); });
  });
  return collectorPreparation;
}

async function readCopiedImage(path, signal) {
  let file;
  try {
    file = await open(path, 'r');
    const info = await file.stat();
    if (!info.isFile()) throw new Error('not-file');
    if (info.size > 12 * 1024 * 1024) throw new Error('图片超过存储大小上限');
    const buffer = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < buffer.length) {
      signal.throwIfAborted();
      const chunk = await file.read(buffer, size, buffer.length - size, size);
      if (!chunk.bytesRead) break;
      size += chunk.bytesRead;
    }
    if (size !== info.size) throw new Error('changed-file');
    return { bytes: buffer.subarray(0, size), finalUrl: '' };
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(error.message === '图片超过存储大小上限' ? error.message : '图片文件无法读取，请确认文件可用后重新复制');
  } finally { await file?.close(); }
}

export function collectorLocalRequest(req) {
  try {
    const address = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const origin = new URL(`http://${req.headers.host}`).origin;
    const host = new URL(origin).hostname;
    return (address === '::1' || /^127\./.test(address)) && ['localhost', '127.0.0.1', '[::1]'].includes(host)
      && (!req.headers.origin || req.headers.origin === origin)
      && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
  } catch { return false; }
}

/** 原生端按当前模式接收新复制；后台串行保存，不建立剪贴板历史。 */
export async function windowsCollector({ session, position, onEvent, selfTest = false, appearance, signal }) {
  signal?.throwIfAborted();
  await prepareWindowsCollector();
  signal?.throwIfAborted();
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', collectorWindowScript, ...(selfTest ? ['-SelfTest'] : [])], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let lastAppearance = appearance;
  const lines = createInterface({ input: child.stdout });
  let alive = true, lastPulse = Date.now(), errorText = '';
  const pending = new Map();
  const send = payload => { if (alive && child.stdin.writable && !child.stdin.writableEnded) child.stdin.write(`${JSON.stringify({ ...payload, session })}\n`); };
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const watchdog = setInterval(() => {
    if (Date.now() - lastPulse > 15_000) {
      rejectReady(new Error('Windows 监听模块无响应')); onEvent({ type: 'lost', error: 'Windows 监听模块无响应' }); child.kill();
    }
  }, 2000); watchdog.unref();
  const startup = setTimeout(() => { rejectReady(new Error(errorText || 'Windows 监听模块启动超时')); child.kill(); }, 30_000); startup.unref();
  lines.on('line', line => {
    let event; try { event = JSON.parse(line); } catch { return; }
    lastPulse = Date.now();
    if (event.type === 'ready') { send({ command: 'start', position, appearance }); return; }
    if (event.session !== session) return;
    if (event.type === 'listening') { clearTimeout(startup); resolveReady(); }
    if (event.type === 'ack') { pending.get(event.id)?.resolve(); pending.delete(event.id); }
    if (event.type === 'error') { rejectReady(new Error(event.error)); onEvent({ type: 'lost', error: event.error }); }
    if (event.type !== 'pulse') onEvent(event);
  });
  child.stderr.on('data', data => { errorText = `${errorText}${data}`.slice(-1200); });
  const ended = () => {
    if (!alive) return; alive = false;
    clearInterval(watchdog); clearTimeout(startup); lines.close();
    const error = new Error(errorText || 'Windows 状态窗已关闭');
    rejectReady(error); for (const item of pending.values()) item.reject(error); pending.clear();
    onEvent({ type: 'lost', error: error.message });
  };
  child.on('error', ended); child.on('exit', ended);
  child.stdin.on('error', ended);
  const command = async (action, payload = {}) => {
    if (!alive) throw new Error('Windows 监听模块已停止');
    const id = randomUUID();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Windows 操作未确认')); }, 5000); timer.unref();
      pending.set(id, { resolve: () => { clearTimeout(timer); resolve(); }, reject: e => { clearTimeout(timer); reject(e); } });
      send({ command: action, id, ...payload });
    });
  };
  const cancelStartup = () => { rejectReady(new Error('收集启动已取消')); child.kill(); };
  signal?.addEventListener('abort', cancelStartup, { once: true });
  try { await ready; } catch (error) { child.kill(); throw error; }
  finally { signal?.removeEventListener('abort', cancelStartup); }
  return { update: state => {
    const changed = state.appearance !== lastAppearance; lastAppearance = state.appearance;
    send({ command: 'state', state: { ...state, appearance: changed ? state.appearance : undefined, rawStage: state.stage, stage: translate(state.appearance.language, state.stage), detail: translate(state.appearance.language, state.detail), error: translate(state.appearance.language, state.error) } });
  }, command, close() { send({ command: 'stop' }); child.stdin.end(); setTimeout(() => { if (alive) child.kill(); }, 1500).unref(); } };
}

export class StyleCollector extends EventEmitter {
  constructor({ worker, download = downloadCollectorImage, listener = windowsCollector, platform = process.platform, proxyUrl = '', modelMappings = () => ({}) }) {
    super(); Object.assign(this, { worker, download, listener, platform, proxyUrl, modelMappings });
    this.run = null; this.control = Promise.resolve(); this.disposed = false;
    this.appearance = { themeMode: 'system', isDark: true, accentColor: '#0ea5e9', motion: 'full' };
    this.wallpapers = {};
    this.nativeAppearance = this.appearance;
    this.stopped = { enabled: false, paused: false, mode: 'style', category: '', collectionSaved: 0, stage: '已关闭', pending: 0, saved: 0, skipped: 0, failed: 0, error: '', detail: '', session: '' };
    if (platform === 'win32' && listener === windowsCollector) void prepareWindowsCollector();
  }
  state() {
    const state = this.run?.state || this.stopped;
    return { ...state, appearance: { ...this.appearance }, available: this.platform === 'win32' };
  }
  publish(run) {
    if (this.run !== run) return;
    const records = run.state.records;
    for (const [mode, record] of Object.entries(records)) record.pending = run.queue.filter(item => item.mode === mode).length;
    // API 总量继续用于资料库刷新，悬浮窗只显示当前收集目标的记录。
    for (const key of ['pending', 'saved', 'skipped', 'failed']) run.state[key] = Object.values(records).reduce((sum, record) => sum + record[key], 0);
    run.state.collectionSaved = records.collection.saved;
    const record = records[run.state.mode];
    if (run.state.enabled) run.state.stage = record.stage || this.idleStage(run);
    run.state.detail = record.detail;
    run.native?.update({ ...this.state(), ...record, stage: run.state.stage, appearance: this.nativeAppearance }); this.emit('state', this.state());
  }
  command(action, id) {
    const operation = this.control.then(async () => {
      if (action === 'appearance') {
        if (!id || !['light', 'dark', 'system'].includes(id.themeMode) || typeof id.isDark !== 'boolean' || !/^#[a-f0-9]{6}$/i.test(id.accentColor || '') || !['full', 'reduced', 'off'].includes(id.motion)) throw new Error('外观设置无效');
        const language = normalizeLanguage(id.language);
        const surfaces = id.surfaces ?? 'solid', corners = id.corners ?? 'standard';
        const backgrounds = {};
        if (id.backgrounds !== undefined) {
          if (!id.backgrounds || typeof id.backgrounds !== 'object' || Array.isArray(id.backgrounds) || Object.keys(id.backgrounds).some(mode => !['light', 'dark'].includes(mode))) throw new Error('外观背景无效');
          for (const [mode, value] of Object.entries(id.backgrounds)) {
            const normalized = normalizeThemeBackground(value);
            if (value !== null && !normalized) throw new Error('外观背景无效');
            backgrounds[mode] = normalized ?? null;
          }
        }
        if (!['solid', 'translucent'].includes(surfaces) || !['soft', 'standard', 'sharp'].includes(corners)) throw new Error('外观设置无效');
        const accents = id.accents ?? {};
        if (!accents || typeof accents !== 'object' || Array.isArray(accents) || Object.entries(accents).some(([key, value]) => !['light', 'dark'].includes(key) || !/^#[a-f0-9]{6}$/i.test(value || ''))) throw new Error('外观配色无效');
        let materials;
        if (id.materials !== undefined) {
          if (!id.materials || typeof id.materials !== 'object' || Array.isArray(id.materials) || Object.keys(id.materials).some(mode => !['light', 'dark'].includes(mode))) throw new Error('外观材质无效');
          materials = {};
          for (const [mode, value] of Object.entries(id.materials)) {
            const ranges = { opacity: [0, 1], highlight: [0, 1], borderOpacity: [0, 1], controlRadius: [0, 999], panelRadius: [0, 36], blur: [0, 40], saturation: [100, 200], refraction: [0, 24], controlShadow: [0, 1] };
            if (!value || typeof value !== 'object' || Array.isArray(value) || !['glass', 'frosted'].includes(value.kind) || Object.keys(value).some(key => key !== 'kind' && !Object.hasOwn(ranges, key)) || Object.entries(ranges).some(([key, [min, max]]) => !(['panelRadius', 'blur', 'saturation', 'refraction', 'controlShadow'].includes(key) && value[key] === undefined) && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max))) throw new Error('外观材质无效');
            materials[mode] = { ...value };
          }
        }
        let palette;
        if (id.palette !== undefined) {
          if (!id.palette || typeof id.palette !== 'object' || Array.isArray(id.palette) || Object.keys(id.palette).some(mode => !['light', 'dark'].includes(mode))) throw new Error('外观配色无效');
          palette = {};
          for (const [mode, colors] of Object.entries(id.palette)) {
            if (!colors || typeof colors !== 'object' || Array.isArray(colors) || Object.entries(colors).some(([key, color]) => !['canvas', 'sidebar', 'toolbar', 'panel', 'text', 'mutedText', 'border'].includes(key) || typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color))) throw new Error('外观配色无效');
            palette[mode] = { ...colors };
          }
        }
        this.wallpapers = await loadCollectorWallpapers(backgrounds);
        const metadata = Object.fromEntries(Object.entries(backgrounds).map(([mode, background]) => [mode, background ? { fit: background.fit, opacity: background.opacity, tileSize: background.tileSize } : null]));
        // 状态广播只带显示参数，避免每次收集都重复发送自选图片。
        this.appearance = { themeMode: id.themeMode, isDark: id.isDark, accentColor: id.accentColor.toLowerCase(), surfaces, corners, accents, motion: id.motion, language, labels: collectorLabels(language), backgrounds: metadata, ...(palette ? { palette } : {}), ...(materials ? { materials } : {}) };
        this.nativeAppearance = { ...this.appearance, images: this.wallpapers };
        if (this.run) this.publish(this.run); else this.emit('state', this.state());
        return this.state();
      }
      if (action === 'start') return this.start();
      if (action === 'stop') return this.stop();
      const run = this.run;
      if (!run?.state.enabled) throw new Error('请先开启收集模式');
      if (action === 'pause' || action === 'resume') {
        await run.native.command(action);
        run.state.paused = action === 'pause';
        if (!run.busy) run.state.stage = this.idleStage(run);
        this.publish(run);
      } else if (action === 'mode' && ['style', 'collection', 'content'].includes(id)) {
        run.state.mode = id; await run.native.command('mode', { mode: id });
        if (!run.busy) run.state.stage = this.idleStage(run);
        this.publish(run);
      } else if (action === 'category' && ['', 'appearance', 'wardrobe', 'pose', 'expression', 'scene', 'camera', 'general'].includes(id)) {
        run.state.category = id; await run.native.command('category', { category: id }); this.publish(run);
      } else throw new Error('未知收集操作');
      return this.state();
    });
    this.control = operation.catch(() => {}); return operation;
  }
  async start() {
    if (this.disposed) throw new Error('本机服务已退出');
    if (this.run) return this.state();
    if (this.platform !== 'win32') throw new Error('收集模式仅支持 Windows 电脑本机');
    const run = { state: { ...this.stopped, enabled: false, paused: false, mode: 'style', category: '', collectionSaved: 0, saved: 0, skipped: 0, failed: 0, error: '', detail: '', stage: '正在启动', session: randomUUID() }, queue: [], seen: new Set(), textIds: new Map(), abort: new AbortController(), busy: false, native: null };
    run.state.records = Object.fromEntries(['style', 'collection', 'content'].map(mode => [mode, { pending: 0, saved: 0, skipped: 0, failed: 0, stage: '', detail: '' }]));
    this.run = run; this.publish(run);
    try {
      const position = await this.worker('position');
      await this.worker('session', { session: run.state.session });
      run.native = await this.listener({ session: run.state.session, position, signal: run.abort.signal, appearance: this.nativeAppearance, onEvent: event => {
        if (this.run !== run || run.abort.signal.aborted) return;
        if (event.type === 'listening') { run.state.enabled = true; this.publish(run); }
        if (event.type === 'link') this.accept(run, event.url, event.mode);
        if (event.type === 'image') this.acceptImage(run, event.image, event.mode);
        if (event.type === 'file') this.acceptFile(run, event.path, event.mode);
        if (event.type === 'capture-error') { const record = run.state.records[event.mode] || run.state.records[run.state.mode]; record.failed++; record.detail = `失败：${collectorErrorReason(new Error(event.error))}`; this.publish(run); }
        if (event.type === 'mode') void this.command('mode', event.mode).catch(error => this.failListener(run, error));
        if (event.type === 'category') void this.command('category', event.category).catch(error => this.failListener(run, error));
        if (event.type === 'text') this.acceptText(run, event);
        if (event.type === 'pause' || event.type === 'resume') void this.command(event.type).catch(error => this.failListener(run, error));
        if (event.type === 'stop' || event.type === 'lost') {
          if (event.type === 'lost') run.state.error = event.error || 'Windows 监听已失效';
          void this.command('stop').catch(() => {});
        }
        if (event.type === 'position') void this.worker('position', { x: event.x, y: event.y, collapsed: event.collapsed }).catch(() => {});
      } });
      if (run.abort.signal.aborted || this.disposed) throw new Error('收集启动已取消');
      run.state.enabled = true; if (!run.busy) run.state.stage = '等待复制图片或图片链接'; this.publish(run);
      return this.state();
    } catch (error) {
      run.abort.abort(); run.native?.close(); await this.worker('session', { session: '' }).catch(() => {});
      this.stopped = { ...run.state, enabled: false, stage: '已关闭', error: error.message }; this.run = null;
      this.emit('state', this.state()); throw error;
    }
  }
  failListener(run, error) { if (this.run === run) { run.state.error = error.message; void this.command('stop').catch(() => {}); } }
  idleStage(run) { return run.state.paused ? '已暂停' : run.state.mode === 'content' ? '复制文字即可收录' : '等待复制图片或图片链接'; }
  acceptText(run, event) {
    if (this.run !== run || !run.state.enabled || run.abort.signal.aborted || run.state.paused || event.mode !== 'content') return;
    const record = run.state.records.content;
    const { text, category = '' } = event;
    if (typeof text !== 'string' || !text.trim()) return;
    if (text.length > 65536 || !['', 'appearance', 'wardrobe', 'pose', 'expression', 'scene', 'camera', 'general'].includes(category)) {
      record.failed++; record.detail = text.length > 65536 ? '失败：提示词过长，请分段收录' : '失败：分类无效'; this.publish(run); return;
    }
    const key = `text:${category}:` + createHash('sha256').update(text).digest('hex');
    if (run.seen.has(key)) { record.skipped++; record.detail = '跳过：这段提示词已经收录'; this.publish(run); return; }
    if (run.queue.length >= 200) { record.failed++; record.detail = '失败：待处理内容过多，请等待后重新复制'; this.publish(run); return; }
    const id = run.textIds.get(key) || randomUUID(); run.textIds.set(key, id); run.seen.add(key);
    run.queue.push({ type: 'text', mode: 'content', key, id, text, category }); this.publish(run);
    if (!run.busy) run.processing = this.process(run);
  }
  acceptImage(run, image, mode = run.state.mode) {
    if (this.run !== run || !run.state.enabled || run.abort.signal.aborted || run.state.paused) return;
    if (mode === 'content') return;
    mode = mode === 'collection' ? 'collection' : 'style';
    const record = run.state.records[mode];
    if (typeof image !== 'string' || image.length > 16 * 1024 * 1024) { record.failed++; record.detail = '失败：图片超过存储大小上限'; this.publish(run); return; }
    const bytes = Buffer.from(image, 'base64');
    if (run.queue.reduce((total, item) => total + (item.bytes?.length || 0), 0) + bytes.length > 48 * 1024 * 1024 || run.queue.length >= 200) {
      record.failed++; record.detail = '失败：待处理图片过多，请等待后重新复制'; this.publish(run); return;
    }
    const key = `${mode}:image:` + createHash('sha256').update(bytes).digest('hex');
    if (run.seen.has(key)) { record.skipped++; record.detail = '跳过：这张原图已经收集'; this.publish(run); return; }
    run.seen.add(key); run.queue.push({ bytes, key, mode, name: '剪贴板图片' }); this.publish(run);
    if (!run.busy) run.processing = this.process(run);
  }
  acceptFile(run, path, mode = run.state.mode) {
    if (this.run !== run || !run.state.enabled || run.abort.signal.aborted || run.state.paused) return;
    if (mode === 'content' || typeof path !== 'string' || !isAbsolute(path) || !/\.(png|jpe?g|webp)$/i.test(path)) return;
    mode = mode === 'collection' ? 'collection' : 'style';
    const record = run.state.records[mode];
    if (run.queue.length >= 200) { record.failed++; record.detail = '失败：待处理图片过多，请等待后重新复制'; this.publish(run); return; }
    run.queue.push({ path, name: basename(path), mode }); this.publish(run);
    if (!run.busy) run.processing = this.process(run);
  }
  accept(run, text, mode = run.state.mode) {
    if (this.run !== run || !run.state.enabled || run.abort.signal.aborted || run.state.paused) return;
    const url = imageLink(text); if (!url || mode === 'content') return;
    mode = mode === 'collection' ? 'collection' : 'style';
    const record = run.state.records[mode];
    const key = `${mode}:${url}`;
    if (run.seen.has(key)) { record.skipped++; record.detail = '跳过：本次已经接收过这个链接'; this.publish(run); return; }
    if (run.queue.length >= 200) { record.failed++; record.detail = '失败：待处理链接过多，请暂停后等待队列完成'; this.publish(run); return; }
    run.seen.add(key);
    let name = ''; try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { /* 无文件名。 */ }
    run.queue.push({ url, name, mode, key }); this.publish(run);
    if (!run.busy) run.processing = this.process(run);
  }
  async process(run) {
    run.busy = true;
    while (run.queue.length && !run.abort.signal.aborted) {
      const item = run.queue.shift();
      const record = run.state.records[item.mode];
      try {
        if (item.type === 'text') {
          record.stage = '正在收录提示词'; this.publish(run);
          const result = await this.worker('text', { session: run.state.session, id: item.id, name: '', text: item.text, category: item.category });
          if (result?.outcome !== 'saved') throw new Error('保存失败，请重新复制');
          run.abort.signal.throwIfAborted();
          record.saved++; record.detail = `已收录：${item.text.trim().split(/[\r\n]/)[0].slice(0, 42)}`;
          this.publish(run); continue;
        }
        record.stage = item.bytes || item.path ? '正在解析图片' : '正在下载图片'; record.detail = `处理：${item.name || '图片链接'}`; this.publish(run);
        const { bytes, finalUrl } = item.path ? await readCopiedImage(item.path, run.abort.signal)
          : item.bytes ? { bytes: item.bytes, finalUrl: '' } : await this.download(item.url, { signal: run.abort.signal, proxyUrl: this.proxyUrl });
        run.abort.signal.throwIfAborted(); record.stage = '正在解析图片'; this.publish(run);
        let raw, skipReason = '未找到有效 NovelAI 生成信息';
        if (!Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) skipReason = '内容不是支持收集的 PNG 原图';
        try { raw = await extractPngMetadata(bytes, { validatePixels: true, collectibleOnly: true }); } catch (error) { raw = null; skipReason = collectorErrorReason(error); }
        run.abort.signal.throwIfAborted();
        if (item.mode === 'collection') {
          const info = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
          if (!['png', 'jpeg', 'webp'].includes(info.format)) throw new Error('仅支持 PNG、JPEG、WebP 图片');
          run.abort.signal.throwIfAborted(); record.stage = '正在保存收藏'; this.publish(run);
          const result = await this.worker('collection', { session: run.state.session, image: Buffer.from(bytes).toString('base64'), format: info.format, rawMetadata: raw, sourceUrl: item.url, finalUrl, name: item.name, metadataModelMappings: this.modelMappings() });
          run.abort.signal.throwIfAborted();
          if (result.outcome === 'saved') { record.saved++; record.detail = `已收藏：${item.name || '图片'}`; }
          else { record.skipped++; record.detail = '跳过：这张原图已经收藏'; }
        }
        else if (!raw || !hasCollectibleNaiMetadata(raw)) { record.skipped++; record.detail = `跳过：${skipReason}`; }
        else {
          record.stage = '正在保存风格串'; this.publish(run);
          const result = await this.worker('import', { session: run.state.session, image: Buffer.from(bytes).toString('base64'), rawMetadata: raw, sourceUrl: item.url, finalUrl, name: item.name, metadataModelMappings: this.modelMappings() });
          run.abort.signal.throwIfAborted();
          if (result.outcome === 'saved') { record.saved++; record.detail = `已保存：${item.name || '图片风格串'}`; }
          else { record.skipped++; record.detail = '跳过：这张原图已经收集'; }
        }
      } catch (error) {
        if (!run.abort.signal.aborted) {
          if (item.key) run.seen.delete(item.key);
          const reason = collectorErrorReason(error);
          record.failed++; record.detail = `失败：${reason}`;
        }
      }
      finally { record.stage = ''; }
      this.publish(run);
    }
    run.busy = false;
    if (!run.abort.signal.aborted) this.publish(run);
  }
  async stop() {
    const run = this.run; if (!run) return this.state();
    run.state.enabled = false; run.state.stage = '正在结束'; run.abort.abort(); run.queue.length = 0;
    run.native?.close(); this.publish(run);
    try { await this.worker('session', { session: '' }); }
    catch (error) { run.state.error = `结束时数据服务连接失败：${error.message}`; }
    await run.processing;
    this.stopped = { ...run.state, enabled: false, paused: false, pending: 0, stage: '已关闭' };
    this.run = null; this.emit('state', this.state()); return this.state();
  }
  shutdown() {
    this.disposed = true;
    // 服务即将退出时同步关闭管道；原生模块在 EOF／父进程退出时自行撤销监听。
    this.run?.abort.abort(); this.run?.native?.close();
    void this.command('stop').catch(() => {});
  }
}
