import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'nai-canvas-export-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, '作品.png');
  await writeFile(target, '原有文件');
  const source = await readFile(new URL('../../desktop/main.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const canvasExportPreferenceFile');
  const end = source.indexOf('function prepareUpdate()', start);
  assert.ok(start >= 0 && end > start);
  const handlers = new Map();
  const frame = { url: 'http://localhost:3000' };
  const window = { webContents: { mainFrame: frame } };
  const event = { sender: window.webContents, senderFrame: frame };
  const dialog = { showSaveDialog: async () => ({ filePath: target }) };
  new Function('ipcMain', 'dialog', 'window', 'isDesktopNavigation', 'appUrl', 'dataRoot', 'readFile', 'writeFile', 'join', 'dirname', 'basename', 'app', 'randomUUID', 'open', 'rename', 'unlink', source.slice(start, end))(
    { handle: (name, handler) => handlers.set(name, handler) }, dialog, window, () => true, '', dir,
    readFile, writeFile, join, dirname, basename, { getPath: () => dir }, randomUUID, options.open || open, options.rename || rename, unlink,
  );
  const call = (name, ...args) => handlers.get(`atelier-canvas-export-${name}`)(event, ...args);
  const token = await call('begin', 'image', '作品.png');
  return { dir, target, call, token };
}

async function temporaryFiles(dir) {
  return (await readdir(dir)).filter(name => name.startsWith('.nai-canvas-') && name.endsWith('.tmp'));
}

test('取消分片写入保留原文件并清理临时文件', async t => {
  const { dir, target, call, token } = await fixture(t);
  await call('start', token);
  await call('chunk', token, new Uint8Array(Buffer.from('部分新文件')));
  assert.equal(await readFile(target, 'utf8'), '原有文件');
  assert.equal((await temporaryFiles(dir)).length, 1);
  await call('abort', token);
  assert.equal(await readFile(target, 'utf8'), '原有文件');
  assert.deepEqual(await temporaryFiles(dir), []);
});

test('写入失败或替换失败保留原文件并清理临时文件', async t => {
  const failingOpen = async (...args) => {
    const handle = await open(...args);
    return { writeFile: async bytes => { await handle.writeFile(bytes); throw new Error('磁盘写入失败'); }, close: () => handle.close() };
  };
  const first = await fixture(t, { open: failingOpen });
  await first.call('start', first.token);
  await assert.rejects(first.call('chunk', first.token, new Uint8Array([1, 2])), /磁盘写入失败/);
  await first.call('abort', first.token);
  assert.equal(await readFile(first.target, 'utf8'), '原有文件');
  assert.deepEqual(await temporaryFiles(first.dir), []);
  const second = await fixture(t, { rename: async () => { throw new Error('替换失败'); } });
  await second.call('start', second.token);
  await second.call('chunk', second.token, new Uint8Array([3, 4]));
  await assert.rejects(second.call('end', second.token), /替换失败/);
  await second.call('abort', second.token);
  assert.equal(await readFile(second.target, 'utf8'), '原有文件');
  assert.deepEqual(await temporaryFiles(second.dir), []);
});

test('完成全部分片后才替换用户选择的原文件', async t => {
  const { dir, target, call, token } = await fixture(t);
  await call('start', token);
  await call('chunk', token, new Uint8Array(Buffer.from('新的')));
  await call('chunk', token, new Uint8Array(Buffer.from('完整文件')));
  assert.equal(await readFile(target, 'utf8'), '原有文件');
  await call('end', token);
  assert.equal(await readFile(target, 'utf8'), '新的完整文件');
  assert.deepEqual(await temporaryFiles(dir), []);
});
