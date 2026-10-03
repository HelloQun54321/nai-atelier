import { open, realpath, stat, readdir, mkdir } from 'node:fs/promises';
import { isAbsolute, resolve, relative, dirname, basename, extname, sep, join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

const MAX_BYTES = 30 * 1024 * 1024;
const TTL = 2 * 60 * 60 * 1000;
const inside = (root, target) => { const rel = relative(root, target); return !rel || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
export const imageMime = buffer => buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
  : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 ? 'image/jpeg'
  : ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString()) ? 'image/gif'
  : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : '';

/** 只开放用户确认的图片目录；权限与会话、Key 绑定，不提供任意文件或命令执行。 */
export class AgentLocalImages {
  constructor({ protectedRoot = resolve('local-data'), now = () => Date.now() } = {}) {
    this.protectedRoot = protectedRoot; this.now = now; this.grants = new Map(); this.images = new Map(); this.writes = new Map();
  }
  prune() {
    for (const map of [this.grants, this.images, this.writes]) {
      for (const [id, value] of map) if (value.expiresAt <= this.now()) map.delete(id);
      while (map.size > 512) map.delete(map.keys().next().value);
    }
  }
  async checkProtected(path) {
    const root = await realpath(this.protectedRoot).catch(() => resolve(this.protectedRoot));
    if (inside(root, path) || inside(resolve(this.protectedRoot), path)) throw new Error('local-data 是项目保护区，请通过项目图片工具访问，不能开放磁盘权限');
  }
  async folder(path, create = false) {
    if (typeof path !== 'string' || !isAbsolute(path) || /[\u0000-\u001f]/.test(path)) throw new Error('请提供电脑上的绝对文件夹路径');
    const target = resolve(path);
    await this.checkProtected(target);
    try {
      const actual = await realpath(target); await this.checkProtected(actual);
      if (!(await stat(actual)).isDirectory()) throw new Error('指定路径不是文件夹');
      return actual;
    } catch (error) {
      if (!create || error.code !== 'ENOENT') throw error;
      // 创建之前检查最近存在的父目录；确认时及创建后再校验真实路径。
      let parent = dirname(target);
      while (true) {
        try { const actual = await realpath(parent); await this.checkProtected(actual); return join(actual, relative(parent, target)); }
        catch (parentError) { if (parentError.code !== 'ENOENT' || dirname(parent) === parent) throw parentError; parent = dirname(parent); }
      }
    }
  }
  async grant(scope, path, access, create = false) {
    if (!['read', 'write'].includes(access) || !scope.sessionId) throw new Error('缺少有效的目录权限或会话');
    const canonical = await this.folder(path, create && access === 'write');
    if (create && access === 'write') await mkdir(canonical, { recursive: true });
    const actual = await this.folder(canonical);
    const id = randomBytes(16).toString('hex');
    this.prune(); this.grants.set(id, { ...scope, keyHash: scope.keyHash || '', path: actual, access, expiresAt: this.now() + TTL });
    return { directory: actual, access, expiresAt: this.now() + TTL, note: '本次会话两小时内有效；切换 Key 或重启服务后需要重新确认' };
  }
  async authorized(scope, target, access) {
    this.prune();
    const actual = await realpath(target); await this.checkProtected(actual);
    const grant = [...this.grants.values()].find(item => item.sessionId === scope.sessionId && item.keyHash === (scope.keyHash || '') && item.access === access && inside(item.path, actual));
    if (!grant) throw Object.assign(new Error(`此目录尚未获得${access === 'read' ? '读取' : '写入'}权限，请先请求用户确认目录用途`), { status: 403 });
    return actual;
  }
  async list(scope, directory, offset = 0, limit = 30) {
    const path = await this.authorized(scope, directory, 'read');
    const entries = (await readdir(path, { withFileTypes: true })).filter(item => item.isDirectory() || item.isSymbolicLink() || /\.(png|jpe?g|webp|gif)$/i.test(item.name)).sort((a,b) => a.name.localeCompare(b.name));
    offset = Math.max(0, Math.floor(Number(offset) || 0)); limit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 30)));
    const items = [];
    for (const entry of entries.slice(offset, offset + limit)) {
      try {
        const actual = await this.authorized(scope, join(path, entry.name), 'read'); const info = await stat(actual);
        if (info.isDirectory() || /\.(png|jpe?g|webp|gif)$/i.test(entry.name)) items.push({ name: entry.name, path: join(path, entry.name), kind: info.isDirectory() ? 'directory' : 'image', bytes: info.size, modifiedAt: info.mtime.toISOString() });
      } catch { /* 越界软链接和不可访问项不向模型开放。 */ }
    }
    return { directory: path, items, total: entries.length, nextOffset: offset + limit < entries.length ? offset + limit : null, recursive: false };
  }
  async read(scope, path) {
    const actual = await this.authorized(scope, path, 'read');
    const file = await open(actual, 'r');
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_BYTES) throw new Error('只接受 30 MB 以内的本地图片');
      // 即使文件同时增长，也不把无限字节读入进程。
      const buffer = Buffer.alloc(info.size + 1); let bytesRead = 0;
      while (bytesRead < buffer.length) { const chunk = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead); if (!chunk.bytesRead) break; bytesRead += chunk.bytesRead; }
      if (bytesRead > info.size) throw new Error('图片正在修改，请稍后重试');
      const bytes = buffer.subarray(0, bytesRead); const mimeType = imageMime(bytes);
      if (!mimeType) throw new Error('文件内容不是 PNG、JPEG、WebP 或 GIF 图片');
      return { buffer: bytes, mimeType, path: actual, name: basename(actual) };
    } finally { await file.close(); }
  }
  async register(scope, path) {
    const image = await this.read(scope, path); const id = randomBytes(16).toString('hex'); this.prune();
    this.images.set(id, { ...scope, keyHash: scope.keyHash || '', path: image.path, expiresAt: this.now() + TTL });
    return { kind: 'local', id, title: image.name, path: '/api/prompt-agent/local-image?sessionId=' + encodeURIComponent(scope.sessionId) + '&id=' + id, modelHasSeenImage: false };
  }
  async asset(scope, id) {
    this.prune(); const image = this.images.get(id);
    if (!image || image.sessionId !== scope.sessionId || image.keyHash !== (scope.keyHash || '')) throw Object.assign(new Error('本地图片权限已失效，请重新确认目录并展示图片'), { status: 403 });
    return this.read(scope, image.path);
  }
  async save(scope, directory, filename, buffer, operationId = '') {
    const path = await this.authorized(scope, directory, 'write'); const mime = imageMime(buffer);
    if (!mime || buffer.length > MAX_BYTES) throw new Error('只允许保存 30 MB 以内的 PNG、JPEG、WebP 或 GIF 图片');
    const suffix = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[mime];
    filename = String(filename || 'nai-image' + suffix).trim();
    if (filename.length > 180 || /[\\/:*?"<>|\u0000-\u001f]/.test(filename) || /[. ]$/.test(filename) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(filename) || filename.startsWith('.')) throw new Error('请使用普通图片文件名，不能包含目录、系统保留名称或特殊字符');
    const extension = extname(filename).toLowerCase();
    if (!extension) filename += suffix;
    else if (!(mime === 'image/jpeg' && ['.jpg', '.jpeg'].includes(extension)) && extension !== suffix) throw new Error('文件扩展名与实际图片格式不同，请使用 ' + suffix);
    const cacheKey = createHash('sha256').update(JSON.stringify([scope, path, filename, operationId])).update(buffer).digest('hex');
    this.prune();
    if (operationId && this.writes.has(cacheKey)) {
      const receipt = this.writes.get(cacheKey).receipt;
      const actual = await this.authorized(scope, receipt.path, 'write').catch(() => '');
      const file = actual ? await open(actual, 'r').catch(() => null) : null;
      if (file) {
        try { const info = await file.stat(); if (info.isFile() && info.size === buffer.length && (await file.readFile()).equals(buffer)) return receipt; }
        finally { await file.close(); }
      }
      this.writes.delete(cacheKey);
    }
    for (let index = 0; index < 1000; index++) {
      const name = index ? filename.slice(0, -extname(filename).length) + ' (' + index + ')' + extname(filename) : filename;
      const target = join(path, name); let file;
      try { file = await open(target, 'wx'); } catch (error) { if (error.code === 'EEXIST') continue; throw error; }
      try { await file.writeFile(buffer); await file.sync(); } finally { await file.close(); }
      const receipt = { saved: true, path: target, filename: name, bytes: buffer.length, overwritten: false };
      if (operationId) this.writes.set(cacheKey, { receipt, expiresAt: this.now() + TTL });
      return receipt;
    }
    throw new Error('同名图片过多，请换一个文件名');
  }
}
