import { open, stat, unlink } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';
import { getStoragePreferences, updateStoragePreferences } from './storage-locations.mjs';

export const EXPORT_MODES = ['system', 'directory', 'ask'];
export const MAX_EXPORT_BYTES = 2 * 1024 * 1024 * 1024;
export { getDefaultExportDirectory } from './storage-locations.mjs';

/** 原子占用新文件名；同名作品始终保留，不覆盖原件。 */
export async function saveExportFile({ data, filename, directory, signal, expectedLength }) {
  if (!filename || /[\\/\x00-\x1f<>:"|?*]/.test(filename) || filename === '.' || filename === '..' || /[. ]$/.test(filename)) throw new Error('导出文件名无效');
  if (!isAbsolute(directory || '') || !(await stat(directory)).isDirectory()) throw new Error('导出目录不可用，请重新选择');
  const extension = extname(filename), stem = filename.slice(0, filename.length - extension.length);
  for (let index = 0; index < 10000; index++) {
    const name = index ? `${stem} (${index})${extension}` : filename;
    const path = join(directory, name);
    let file;
    try { file = await open(path, 'wx'); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    try {
      signal?.throwIfAborted();
      if (data?.[Symbol.asyncIterator]) {
        let length = 0;
        for await (const chunk of data) {
          signal?.throwIfAborted();
          length += chunk.length;
          if (length > MAX_EXPORT_BYTES || length > expectedLength) throw new Error('导出文件超过传输长度上限');
          await file.writeFile(chunk);
        }
        if (length !== expectedLength) throw new Error('导出文件传输不完整');
      } else await file.writeFile(data);
      signal?.throwIfAborted();
      await file.sync();
      signal?.throwIfAborted();
    }
    catch (error) { await file.close(); await unlink(path); throw error; }
    await file.close();
    return { saved: true, cancelled: false, path, filename: name };
  }
  throw new Error('导出目录中的同名文件过多');
}

export async function exportWithPreferences({ data, filename, workspace, pickDirectory, systemDirectory, signal, expectedLength }) {
  const prefs = await getStoragePreferences(workspace);
  const mode = EXPORT_MODES.includes(prefs.exportMode) ? prefs.exportMode : 'system';
  if (mode === 'system' && !systemDirectory) return { saved: false, cancelled: false, browserDownload: true };
  let directory = mode === 'directory' ? prefs.exportDir : systemDirectory;
  if (mode === 'ask') {
    const result = await pickDirectory(prefs.exportDir || '');
    signal?.throwIfAborted();
    if (result.cancelled) return { saved: false, cancelled: true };
    directory = result.path;
  }
  if (!directory) throw new Error('请先选择导出目录');
  signal?.throwIfAborted();
  return saveExportFile({ data, filename, directory, signal, expectedLength });
}

const state = (prefs, canPickDirectory, systemDirectory = '') => ({ mode: EXPORT_MODES.includes(prefs.exportMode) ? prefs.exportMode : 'system', directory: prefs.exportDir || '', systemDirectory, canPickDirectory, canAsk: canPickDirectory, platform: systemDirectory ? 'desktop' : 'local' });
/** 仅由网关在本机维护授权后调用，LAN 页面不得写电脑目录。 */
export async function handleExportLocationRequest(req, res, { workspace, canManage, pickDirectory, systemDirectory = '' }) {
  if (new URL(req.url, 'http://localhost').pathname !== '/api/local-maintenance/export-location') return false;
  const reply = (status, body) => { if (res.destroyed) return; res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  if (!canManage) { reply(403, { error: '导出目录仅可由本机设置' }); return true; }
  const controller = new AbortController();
  const cancelled = () => controller.abort(new Error('导出设置请求已取消，未保存迟到结果'));
  req.once('aborted', cancelled); res.once?.('close', cancelled);
  let timer;
  try {
    const canPick = typeof pickDirectory === 'function' && process.platform === 'win32';
    if (req.method === 'GET') { reply(200, state(await getStoragePreferences(workspace), canPick, systemDirectory)); return true; }
    if (req.method !== 'POST') { reply(405, { error: '不支持的请求方法' }); return true; }
    if (req.headers?.['x-nai-local-control'] !== 'true') { reply(403, { error: '导出操作缺少本机维护授权' }); return true; }
    if (req.headers?.['content-type'] === 'application/octet-stream') {
      const expectedLength = Number(req.headers['x-nai-export-size']);
      if (!/^\d+$/.test(req.headers['x-nai-export-size'] || '') || !Number.isSafeInteger(expectedLength) || expectedLength > MAX_EXPORT_BYTES) throw new Error('导出文件超过 2 GiB 传输上限或长度无效');
      const filename = decodeURIComponent(req.headers['x-nai-export-filename'] || '');
      timer = setTimeout(() => { controller.abort(new Error('导出文件传输超时，请重试')); req.destroy(); }, 310_000);
      reply(200, await exportWithPreferences({ data: req, filename, workspace, pickDirectory, systemDirectory, expectedLength, signal: controller.signal }));
      return true;
    }
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 192 * 1024 * 1024) throw new Error('导出文件超过本机传输上限'); chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    timer = setTimeout(() => controller.abort(new Error('导出设置请求超时，请重试')), ['pick', 'save'].includes(body.action) ? 310_000 : 15_000);
    let prefs = await getStoragePreferences(workspace);
    controller.signal.throwIfAborted();
    if (body.action === 'pick') {
      if (!canPick) throw new Error('当前平台没有系统目录选择器');
      const result = await pickDirectory(prefs.exportDir || '');
      controller.signal.throwIfAborted();
      if (result.cancelled) { reply(200, { cancelled: true }); return true; }
      prefs = await updateStoragePreferences({ exportMode: 'directory', exportDir: result.path }, workspace, { signal: controller.signal });
    } else if (body.action === 'mode') {
      if (!EXPORT_MODES.includes(body.mode) || body.mode === 'ask' && !canPick) throw new Error('导出模式不可用');
      if (body.mode === 'directory' && !prefs.exportDir) throw new Error('请先选择导出目录');
      prefs = await updateStoragePreferences({ exportMode: body.mode }, workspace, { signal: controller.signal });
    } else if (body.action === 'clear') prefs = await updateStoragePreferences({ exportMode: 'system', exportDir: '' }, workspace, { signal: controller.signal });
    else if (body.action === 'save') {
      if (typeof body.data !== 'string' || body.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) throw new Error('导出文件内容无效');
      reply(200, await exportWithPreferences({ data: Buffer.from(body.data, 'base64'), filename: body.filename, workspace, pickDirectory, systemDirectory, signal: controller.signal })); return true;
    } else throw new Error('未知导出设置操作');
    reply(200, state(prefs, canPick, systemDirectory));
  } catch (error) { reply(400, { error: error.message }); }
  finally { clearTimeout(timer); req.off('aborted', cancelled); res.off?.('close', cancelled); }
  return true;
}
