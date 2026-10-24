// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { beginExportTarget, getExportLocation, openExportDirectory, pickExportDirectory, saveExportBlob, setExportMode } from '../../services/exportLocation';

beforeEach(() => { localStorage.clear(); vi.stubGlobal('location', { hostname: 'phone-on-lan.invalid' }); });
afterEach(() => { vi.useRealTimers(); delete window.atelierExports; delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  ['D:\\exports\\work.naia', 'D:\\exports'], ['C:\\work.naia', 'C:\\'], ['C:/work.naia', 'C:/'],
  ['/exports/work.naia', '/exports'], ['/work.naia', '/'], ['\\\\server\\share\\work.naia', '\\\\server\\share'],
])('打开本次真实回执的父目录 %s，不受后来设置变化影响', async (path, directory) => {
  vi.stubGlobal('location', { hostname: 'localhost' });
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }); vi.stubGlobal('fetch', fetch);
  await openExportDirectory({ saved: true, cancelled: false, path });
  expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: 'openDirectory', path: directory });
});
it('没有成功回执时复用实际配置目录，取消失败路径不冒充已保存位置', async () => {
  vi.stubGlobal('location', { hostname: 'localhost' });
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  for (const receipt of [undefined, { saved: false, cancelled: true, path: 'Z:\\cancelled\\x.naia' }, { saved: false, cancelled: false, path: 'Z:\\failed\\x.naia' }]) {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ mode: 'directory', directory: 'E:\\configured' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    await openExportDirectory(receipt);
    expect(JSON.parse(fetch.mock.calls.at(-1)![1].body).path).toBe('E:\\configured');
  }
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ mode: 'system', systemDirectory: 'E:\\Downloads' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
  await openExportDirectory(); expect(JSON.parse(fetch.mock.calls.at(-1)![1].body).path).toBe('E:\\Downloads');
});
it('未知浏览器下载、相对目录和每次询问不猜测路径，LAN及Android不请求电脑目录', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(openExportDirectory({ saved: true, cancelled: false, path: 'D:\\host\\x.naia' })).rejects.toThrow('当前设备');
  expect(fetch).not.toHaveBeenCalled();
  vi.stubGlobal('location', { hostname: 'localhost' });
  await expect(openExportDirectory({ saved: false, cancelled: false, browserDownload: true })).rejects.toThrow('下载记录');
  expect(fetch).not.toHaveBeenCalled();
  for (const state of [{ mode: 'system' }, { mode: 'directory', directory: 'Handle name' }, { mode: 'ask', directory: 'E:\\old-choice' }]) {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => state });
    await expect(openExportDirectory()).rejects.toThrow('下载记录');
  }
  fetch.mockClear();
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true); vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
  await expect(openExportDirectory({ saved: true, cancelled: false, path: '/storage/downloads/x.naia' })).rejects.toThrow('当前设备');
  expect(fetch).not.toHaveBeenCalled();
});
it('文件夹打开失败透传错误，负回执也不算成功', async () => {
  vi.stubGlobal('location', { hostname: 'localhost' });
  const receipt = { saved: true, cancelled: false, path: '/exports/work.naia' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) })
    .mockResolvedValueOnce({ ok: false, status: 400, clone: () => ({ text: async () => JSON.stringify({ error: 'directory missing' }) }) }));
  await expect(openExportDirectory(receipt)).rejects.toThrow('未打开');
  await expect(openExportDirectory(receipt)).rejects.toThrow('directory missing');
});

it('桌面只展示后台实际下载目录，普通浏览器不猜测系统目录', async () => {
  vi.stubGlobal('location', { hostname: 'localhost' });
  window.atelierExports = { save: vi.fn() };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: 'system', directory: '', systemDirectory: 'E:\\用户下载', platform: 'desktop' }) }));
  expect(await getExportLocation()).toMatchObject({ systemDirectory: 'E:\\用户下载', platform: 'desktop' });
  vi.stubGlobal('location', { hostname: 'phone-on-lan.invalid' });
  expect((await getExportLocation()).systemDirectory).toBeUndefined();
});

it('偏好请求15秒超时中止HTTP，目录选择保留五分钟用户等待', async () => {
  vi.useFakeTimers(); vi.stubGlobal('location', { hostname: 'localhost' });
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url, options) => { signal = options.signal; return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))); }));
  const changing = setExportMode('system'); const rejected = expect(changing).rejects.toThrow('请求超时');
  await vi.advanceTimersByTimeAsync(15_000); await rejected; expect(signal!.aborted).toBe(true);
  let finish: (value: unknown) => void = () => {};
  vi.stubGlobal('fetch', vi.fn((_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); }));
  const picking = pickExportDirectory();
  await vi.advanceTimersByTimeAsync(300_000); expect(signal!.aborted).toBe(false);
  finish({ ok: true, json: async () => ({ cancelled: true }) }); expect(await picking).toBeNull();
});

it('局域网浏览器没有目录能力时准确禁用，不请求电脑文件接口', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect(await getExportLocation()).toMatchObject({ mode: 'system', platform: 'browser', canPickDirectory: false, canAsk: false });
  await expect(setExportMode('ask')).rejects.toThrow('下载设置');
  expect(fetch).not.toHaveBeenCalled();
});
it('每次询问同步启动选择器，目录中的原件不覆盖，close成功才完成', async () => {
  const write = vi.fn().mockResolvedValue(undefined), abort = vi.fn(); let finish = () => {};
  const close = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const handle = { name: 'Phone pictures', queryPermission: vi.fn().mockResolvedValue('granted'), getFileHandle: vi.fn(async (name: string, options?: { create: boolean }) => {
    if (name === 'work.png' || options?.create) return { createWritable: async () => ({ write, close, abort }) };
    throw new DOMException('missing', 'NotFoundError');
  }), removeEntry: vi.fn() };
  const choose = vi.fn().mockResolvedValue(handle);
  Object.assign(window, { showDirectoryPicker: choose });
  await setExportMode('ask');
  const target = beginExportTarget(); expect(choose).toHaveBeenCalledOnce();
  let completed = false;
  const pending = saveExportBlob(new Blob(['cleaned-copy']), 'work.png', target).then(result => { completed = true; return result; });
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(completed).toBe(false); expect(handle.getFileHandle).toHaveBeenCalledWith('work (1).png', { create: true });
  finish(); expect(await pending).toMatchObject({ saved: true, filename: 'work (1).png' });
  expect(write.mock.calls[0][0].size).toBe(12); expect(abort).not.toHaveBeenCalled();
});
it('选择目录取消不改变模式，下载取消不伪造成功', async () => {
  const choose = vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError'));
  Object.assign(window, { showDirectoryPicker: choose });
  expect(await pickExportDirectory()).toBeNull(); expect((await getExportLocation()).mode).toBe('system');
  await setExportMode('ask'); await expect(saveExportBlob(new Blob(['x']), 'x.png')).rejects.toMatchObject({ name: 'AbortError' });
});
it('桌面只接受真实写入回执，取消和失败不返回完成', async () => {
  const save = vi.fn().mockResolvedValue({ saved: true, cancelled: false, path: 'D:\\synthetic\\x.json' });
  window.atelierExports = { save };
  expect(await saveExportBlob(new Blob(['{}']), 'x.json')).toMatchObject({ saved: true });
  expect(save).toHaveBeenCalledWith({ data: 'e30=', filename: 'x.json' });
  save.mockResolvedValue({ saved: false, cancelled: true });
  await expect(saveExportBlob(new Blob(['{}']), 'x.json')).rejects.toMatchObject({ name: 'AbortError' });
  save.mockResolvedValue({ saved: false, cancelled: false });
  await expect(saveExportBlob(new Blob(['{}']), 'x.json')).rejects.toThrow('未写入');
});
it('桌面大文件直接传Blob并沿用后台目录回执，取消不假成功', async () => {
  vi.stubGlobal('location', { hostname: 'localhost' });
  const save = vi.fn(); window.atelierExports = { save };
  const blob = new Blob(['synthetic']); Object.defineProperty(blob, 'size', { value: 33 * 1024 * 1024, configurable: true });
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ mode: 'system', systemDirectory: 'E:\\exports' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ saved: true, cancelled: false, filename: '分享.naia' }) });
  vi.stubGlobal('fetch', fetch);
  expect(await saveExportBlob(blob, '分享.naia')).toMatchObject({ saved: true });
  expect(fetch.mock.calls[1][1]).toMatchObject({ body: blob, headers: { 'content-type': 'application/octet-stream', 'x-nai-export-filename': encodeURIComponent('分享.naia'), 'x-nai-export-size': String(blob.size), 'x-nai-local-control': 'true' } });
  expect(save).not.toHaveBeenCalled();
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ mode: 'ask' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ saved: false, cancelled: true }) });
  await expect(saveExportBlob(blob, '分享.naia')).rejects.toMatchObject({ name: 'AbortError' });
  Object.defineProperty(blob, 'size', { value: 2 * 1024 * 1024 * 1024 + 1 });
  await expect(saveExportBlob(blob, '分享.naia')).rejects.toThrow('2 GiB');
});
it('目录写入失败清除本次不完整副本并返回错误', async () => {
  const abort = vi.fn().mockResolvedValue(undefined), removeEntry = vi.fn().mockResolvedValue(undefined);
  const handle = { name: 'synthetic', queryPermission: vi.fn().mockResolvedValue('granted'), getFileHandle: vi.fn(async (_name: string, options?: { create: boolean }) => {
    if (!options) throw new DOMException('missing', 'NotFoundError');
    return { createWritable: async () => ({ write: async () => { throw new Error('disk full'); }, close: vi.fn(), abort }) };
  }), removeEntry };
  Object.assign(window, { showDirectoryPicker: vi.fn().mockResolvedValue(handle) });
  await setExportMode('ask'); await expect(saveExportBlob(new Blob(['x']), 'x.png')).rejects.toThrow('disk full');
  expect(abort).toHaveBeenCalledOnce(); expect(removeEntry).toHaveBeenCalledWith('x.png');
});
it('刷新后未打开设置也在本次下载前读取记住的句柄并请求权限，不重选目录', async () => {
  vi.resetModules();
  const fresh = await import('../../services/exportLocation');
  const write = vi.fn().mockResolvedValue(undefined);
  const handle = { name: 'remembered', requestPermission: vi.fn().mockResolvedValue('granted'), queryPermission: vi.fn().mockResolvedValue('granted'), getFileHandle: vi.fn(async (_name: string, options?: { create: boolean }) => {
    if (!options) throw new DOMException('missing', 'NotFoundError');
    return { createWritable: async () => ({ write, close: vi.fn().mockResolvedValue(undefined), abort: vi.fn() }) };
  }), removeEntry: vi.fn() };
  const choose = vi.fn(); Object.assign(window, { showDirectoryPicker: choose });
  vi.stubGlobal('indexedDB', { open: vi.fn(() => {
    const opening = { result: { close: vi.fn(), transaction: () => {
      const transaction = { objectStore: () => ({ get: () => ({ result: handle }) }), oncomplete: () => {} };
      queueMicrotask(() => transaction.oncomplete()); return transaction;
    } }, onsuccess: () => {} };
    queueMicrotask(() => opening.onsuccess()); return opening;
  }) });
  localStorage.setItem('nai_export_mode', 'directory'); localStorage.setItem('nai_export_directory', 'remembered');
  const target = fresh.beginExportTarget();
  await target;expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' }); expect(choose).not.toHaveBeenCalled();
  expect(await fresh.saveExportBlob(new Blob(['copy']), 'work.png', target)).toMatchObject({ saved: true });
  handle.requestPermission.mockResolvedValue('denied');
  await expect(fresh.saveExportBlob(new Blob(['copy']), 'blocked.png')).rejects.toThrow('写入权限未允许');
  expect(write).toHaveBeenCalledTimes(1);
});
