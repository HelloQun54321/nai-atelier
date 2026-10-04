// @vitest-environment jsdom
import { Blob as NativeBlob } from 'node:buffer';
import { encode } from 'fast-png';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copySharedImage, downloadSharedImage, setCleanSharedImages } from '../../services/imageSharing';
import { extractNovelAiMetadataFromPng } from '../../services/metadataService';

class TestClipboardItem {
  constructor(public data: Record<string, Promise<Blob>>) {}
}
const png = encode({ width: 1, height: 1, data: new Uint8Array([4, 5, 6, 255]), text: { Comment: '{"prompt":"private style"}' } });
const original = new NativeBlob([png], { type: 'image/png' }) as unknown as Blob;
const response = (blob = original) => ({ ok: true, blob: async () => blob }) as Response;
let created: Blob[];
let filenames: string[];

beforeEach(() => {
  localStorage.clear();
  created = []; filenames = [];
  vi.stubGlobal('Blob', NativeBlob);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
  vi.stubGlobal('ClipboardItem', TestClipboardItem);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL(blob: Blob) { created.push(blob); return 'blob:test-share'; }
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filenames.push(this.download); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('分享输出与剪贴板', () => {
  it('开启清洗时输出另命名的分享版，显式原图下载仍与原字节完全一致', async () => {
    vi.useFakeTimers();
    setCleanSharedImages(true);
    await downloadSharedImage('/api/local-history/test/image', 'NAI.png');
    expect(filenames).toEqual(['NAI-分享版.png']);
    expect(await extractNovelAiMetadataFromPng(await created[0].arrayBuffer())).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await downloadSharedImage('/api/local-history/test/image', 'NAI.png', false);
    expect(filenames).toEqual(['NAI-分享版.png', 'NAI.png']);
    expect(new Uint8Array(await created[1].arrayBuffer())).toEqual(png);
    expect(document.querySelector('a')).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('关闭清洗时下载原文件，不触发图片解码或另存分享版', async () => {
    await downloadSharedImage('/image', 'NAI.png');
    expect(filenames).toEqual(['NAI.png']);
    expect(created[0]).toBe(original);
    expect(await extractNovelAiMetadataFromPng(await created[0].arrayBuffer())).toContain('private style');
  });

  it.each([false, true])('复制无需下载，清洗=%s 时提供对应 PNG，点击时立即提交剪贴板写入', async clean => {
    let resolveImage!: (res: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveImage = resolve; })));
    let copied!: Blob;
    const write = vi.fn(async (items: TestClipboardItem[]) => { copied = await items[0].data['image/png']; });
    vi.stubGlobal('navigator', { clipboard: { write } });
    const copying = copySharedImage('/image', clean);
    expect(write).toHaveBeenCalledTimes(1);
    resolveImage(response());
    await copying;
    expect(copied.type).toBe('image/png');
    const metadata = await extractNovelAiMetadataFromPng(await copied.arrayBuffer());
    if (clean) expect(metadata).toBeNull();
    else expect(metadata).toContain('private style');
    expect(filenames).toEqual([]);
    expect(created).toEqual([]);
  });

  it('不支持剪贴板时提示可用路径，不开始读图或自动下载', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copySharedImage('/image')).rejects.toThrow('localhost／HTTPS');
    expect(fetch).not.toHaveBeenCalled();
    expect(filenames).toEqual([]);
  });

  it('用户拒绝剪贴板权限时明确提示，不自动下载原图', async () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) } });
    await expect(copySharedImage('/image', true)).rejects.toThrow('浏览器未允许复制图片');
    expect(filenames).toEqual([]);
  });

  it('清洗失败或读取失败不落盘、不自动降级为原图', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(downloadSharedImage('/image', 'NAI.png', true)).rejects.toThrow('404');
    const damaged = new NativeBlob([png.slice(0, -1)], { type: 'image/png' }) as unknown as Blob;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(damaged)));
    await expect(downloadSharedImage('/image', 'NAI.png', true)).rejects.toThrow();
    expect(created).toEqual([]);
    expect(filenames).toEqual([]);
  });

  it('JPEG 分享转换为 PNG 后清洗，原图下载仍为 JPEG 且释放解码资源', async () => {
    const jpeg = new NativeBlob(['jpeg-fixture'], { type: 'image/jpeg' }) as unknown as Blob;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(jpeg)));
    const bitmap = { width: 1, height: 1, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(original));
    await downloadSharedImage('/image', 'photo.jpg', true);
    expect(filenames[0]).toBe('photo-分享版.png');
    expect(await extractNovelAiMetadataFromPng(await created[0].arrayBuffer())).toBeNull();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    await downloadSharedImage('/image', 'photo.png', false);
    expect(filenames[1]).toBe('photo.jpg');
    expect(created[1]).toBe(jpeg);
  });
});
