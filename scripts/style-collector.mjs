import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { extractPngMetadata, hasCollectibleNaiMetadata } from '../services/pngMetadata.mjs';
import { collectorErrorReason, downloadCollectorImage, imageLink } from './collector-download.mjs';

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

/** 协议只接收已经过 Windows 本机过滤的候选链接，不建立剪贴板历史。 */
export async function windowsCollector({ session, position, onEvent, selfTest = false, appearance }) {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./style-collector-window.ps1', import.meta.url)), ...(selfTest ? ['-SelfTest'] : []), ...(appearance ? ['-AppearanceJson', JSON.stringify(appearance)] : [])], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
    if (event.type === 'ready') { send({ command: 'start', position }); return; }
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
  const command = async action => {
    if (!alive) throw new Error('Windows 监听模块已停止');
    const id = randomUUID();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Windows 操作未确认')); }, 5000); timer.unref();
      pending.set(id, { resolve: () => { clearTimeout(timer); resolve(); }, reject: e => { clearTimeout(timer); reject(e); } });
      send({ command: action, id });
    });
  };
  try { await ready; } catch (error) { child.kill(); throw error; }
  return { update: state => send({ command: 'state', state }), command, close() { send({ command: 'stop' }); child.stdin.end(); setTimeout(() => { if (alive) child.kill(); }, 1500).unref(); } };
}

export class StyleCollector extends EventEmitter {
  constructor({ worker, download = downloadCollectorImage, listener = windowsCollector, platform = process.platform, proxyUrl = '', modelMappings = () => ({}) }) {
    super(); Object.assign(this, { worker, download, listener, platform, proxyUrl, modelMappings });
    this.run = null; this.control = Promise.resolve(); this.disposed = false;
    this.appearance = { themeMode: 'system', isDark: true, accentColor: '#0ea5e9', motion: 'full' };
    this.stopped = { enabled: false, paused: false, stage: '已关闭', pending: 0, saved: 0, skipped: 0, failed: 0, error: '', detail: '', session: '' };
  }
  state() {
    const state = this.run?.state || this.stopped;
    return { ...state, appearance: { ...this.appearance }, available: this.platform === 'win32' };
  }
  publish(run) {
    if (this.run !== run) return;
    run.state.pending = run.queue.length;
    run.native?.update(this.state()); this.emit('state', this.state());
  }
  command(action, id) {
    const operation = this.control.then(async () => {
      if (action === 'appearance') {
        if (!id || !['light', 'dark', 'system'].includes(id.themeMode) || typeof id.isDark !== 'boolean' || !/^#[a-f0-9]{6}$/i.test(id.accentColor || '') || !['full', 'reduced', 'off'].includes(id.motion)) throw new Error('外观设置无效');
        this.appearance = { themeMode: id.themeMode, isDark: id.isDark, accentColor: id.accentColor.toLowerCase(), motion: id.motion };
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
        if (!run.busy) run.state.stage = run.state.paused ? '已暂停' : '等待复制图片链接';
        this.publish(run);
      } else throw new Error('未知收集操作');
      return this.state();
    });
    this.control = operation.catch(() => {}); return operation;
  }
  async start() {
    if (this.disposed) throw new Error('本机服务已退出');
    if (this.run) return this.state();
    if (this.platform !== 'win32') throw new Error('收集模式仅支持 Windows 电脑本机');
    const run = { state: { ...this.stopped, enabled: false, paused: false, saved: 0, skipped: 0, failed: 0, error: '', detail: '', stage: '正在启动', session: randomUUID() }, queue: [], seen: new Set(), abort: new AbortController(), busy: false, native: null };
    this.run = run; this.publish(run);
    try {
      const position = await this.worker('position');
      await this.worker('session', { session: run.state.session });
      run.native = await this.listener({ session: run.state.session, position, appearance: { ...this.appearance }, onEvent: event => {
        if (this.run !== run || run.abort.signal.aborted) return;
        if (event.type === 'listening') { run.state.enabled = true; this.publish(run); }
        if (event.type === 'link') this.accept(run, event.url);
        if (event.type === 'pause' || event.type === 'resume') void this.command(event.type).catch(error => this.failListener(run, error));
        if (event.type === 'stop' || event.type === 'lost') {
          if (event.type === 'lost') run.state.error = event.error || 'Windows 监听已失效';
          void this.command('stop').catch(() => {});
        }
        if (event.type === 'position') void this.worker('position', { x: event.x, y: event.y, collapsed: event.collapsed }).catch(() => {});
      } });
      if (run.abort.signal.aborted || this.disposed) throw new Error('收集启动已取消');
      run.state.enabled = true; if (!run.busy) run.state.stage = '等待复制图片链接'; this.publish(run);
      return this.state();
    } catch (error) {
      run.abort.abort(); run.native?.close(); await this.worker('session', { session: '' }).catch(() => {});
      this.stopped = { ...run.state, enabled: false, stage: '已关闭', error: error.message }; this.run = null;
      this.emit('state', this.state()); throw error;
    }
  }
  failListener(run, error) { if (this.run === run) { run.state.error = error.message; void this.command('stop').catch(() => {}); } }
  accept(run, text) {
    if (this.run !== run || !run.state.enabled || run.abort.signal.aborted || run.state.paused) return;
    const url = imageLink(text); if (!url) return;
    if (run.seen.has(url)) { run.state.skipped++; run.state.detail = '跳过：本次已经接收过这个链接'; this.publish(run); return; }
    run.seen.add(url);
    if (run.queue.length >= 200) { run.state.failed++; run.state.error = '待处理链接过多，请暂停后等待队列完成'; this.publish(run); return; }
    let name = ''; try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { /* 无文件名。 */ }
    run.queue.push({ url, name }); this.publish(run);
    if (!run.busy) run.processing = this.process(run);
  }
  async process(run) {
    run.busy = true;
    while (run.queue.length && !run.abort.signal.aborted) {
      const item = run.queue.shift();
      try {
        run.state.stage = '正在下载图片'; run.state.detail = `处理：${item.name || '图片链接'}`; this.publish(run);
        const { bytes, finalUrl } = await this.download(item.url, { signal: run.abort.signal, proxyUrl: this.proxyUrl });
        run.abort.signal.throwIfAborted(); run.state.stage = '正在解析图片'; this.publish(run);
        let raw, skipReason = '未找到有效 NovelAI 生成信息';
        if (!Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) skipReason = '内容不是支持收集的 PNG 原图';
        try { raw = await extractPngMetadata(bytes, { validatePixels: true, collectibleOnly: true }); } catch (error) { raw = null; skipReason = collectorErrorReason(error); }
        run.abort.signal.throwIfAborted();
        if (!raw || !hasCollectibleNaiMetadata(raw)) { run.state.skipped++; run.state.detail = `跳过：${skipReason}`; }
        else {
          run.state.stage = '正在保存风格串'; this.publish(run);
          const result = await this.worker('import', { session: run.state.session, image: Buffer.from(bytes).toString('base64'), rawMetadata: raw, sourceUrl: item.url, finalUrl, name: item.name, metadataModelMappings: this.modelMappings() });
          if (result.outcome === 'saved') { run.state.saved++; run.state.detail = `已保存：${item.name || '图片风格串'}`; }
          else { run.state.skipped++; run.state.detail = '跳过：这张原图已经收集'; }
        }
      } catch (error) {
        if (!run.abort.signal.aborted) {
          const reason = collectorErrorReason(error);
          run.state.failed++; run.state.detail = `失败：${reason}`;
        }
      }
      this.publish(run);
    }
    run.busy = false;
    if (!run.abort.signal.aborted) { run.state.stage = run.state.paused ? '已暂停' : '等待复制图片链接'; this.publish(run); }
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
