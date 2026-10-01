// @vitest-environment jsdom
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { decode, encode } from 'fast-png';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copySharedImage } from './imageSharing';
import { readClipboardImage } from './imageClipboard';
import { beginImageClipboardCopy, getCopiedImageData, rememberCopiedImage } from './imageClipboardContext';
import { extractMetadata } from './metadataService';

const params = { width: 2, height: 1, steps: 23, scale: 5, sampler: 'k_euler_ancestral', useCoords: true,
  characters: [{ id: 'role', prompt: 'blue hair', negativePrompt: 'red hair', x: 0.3, y: 0.7 }] };
const generationData = { prompt: 'night sea', negativePrompt: '', params };
const pixels = new Uint8Array([30, 90, 150, 255, 100, 120, 140, 255]);
const image = (text?: Record<string, string>, different = false) => new Blob([encode({ width: 2, height: 1,
  data: different ? new Uint8Array([31, ...pixels.slice(1)]) : pixels, text }).slice().buffer as ArrayBuffer], { type: 'image/png' });
const file = (blob: Blob) => new File([blob], 'clipboard.png', { type: 'image/png' });

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  vi.stubGlobal('Blob', NativeBlob); vi.stubGlobal('File', NativeFile); vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => ({ ...decode(new Uint8Array(await blob.arrayBuffer())), close: vi.fn() })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    let data: Uint8Array;
    return { drawImage: (bitmap: { data: Uint8Array }) => { data = bitmap.data; }, getImageData: () => ({ data }) } as unknown as CanvasRenderingContext2D;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('主动复制图片的会话内生成配置', () => {
  it('复制关联尚未完成时立刻粘贴也能取得角色配置', async () => {
    const pending = rememberCopiedImage(beginImageClipboardCopy(), image(), image(), generationData);
    expect(await getCopiedImageData(file(image()))).toEqual(generationData);
    await pending;
  });
  it.each([false, true])('历史复制→系统重编码→读取：清洗=%s，角色正负词与空全局负面仍完整', async clean => {
    let pasted!: Blob;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => image({ Comment: JSON.stringify({ prompt: 'old embedded prompt' }) }) })));
    vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Promise<Blob>>) {} });
    vi.stubGlobal('navigator', { clipboard: {
      write: vi.fn(async (items: { data: Record<string, Promise<Blob>> }[]) => {
        // 模拟浏览器/系统重新编码，真实 PNG 像素保留，tEXt 元数据消失。
        const decoded = decode(new Uint8Array(await (await items[0].data['image/png']).arrayBuffer()));
        pasted = new Blob([encode({ width: decoded.width, height: decoded.height, data: decoded.data }).slice().buffer as ArrayBuffer], { type: 'image/png' });
      }),
      read: vi.fn(async () => [{ types: ['image/png'], getType: async () => pasted }]),
    } });
    await copySharedImage('/history-original', clean, generationData);
    const imported = await readClipboardImage();
    expect(await extractMetadata(imported)).toBeNull();
    expect(await getCopiedImageData(imported)).toEqual(generationData);
    expect(Object.keys(sessionStorage)).toEqual(['nai_last_copied_image']);
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('没有额外历史配置时，从原图解析结构化角色再关联清洗副本', async () => {
    const raw = { prompt: '', uc: '', v4_prompt: { caption: { base_caption: '', char_captions: [{ char_caption: 'blue hair', centers: [{ x: 0.3, y: 0.7 }] }] }, use_coords: true },
      v4_negative_prompt: { caption: { base_caption: '', char_captions: [{ char_caption: 'red hair' }] } } };
    await rememberCopiedImage(beginImageClipboardCopy(), image(), image({ Comment: JSON.stringify(raw) }));
    expect(await getCopiedImageData(file(image()))).toMatchObject({ prompt: '', negativePrompt: '', params: { useCoords: true,
      characters: [{ prompt: 'blue hair', negativePrompt: 'red hair', x: 0.3, y: 0.7 }] } });
  });

  it('其他像素、旧复制与失败复制不误用已有角色；同像素重编码仍能匹配', async () => {
    const old = beginImageClipboardCopy();
    await rememberCopiedImage(old, image(), image(), generationData);
    expect(await getCopiedImageData(file(image(undefined, true)))).toBeUndefined();
    const next = beginImageClipboardCopy();
    await rememberCopiedImage(old, image(), image(), generationData);
    expect(await getCopiedImageData(file(image()))).toBeUndefined();
    await rememberCopiedImage(next, image(), image(), { prompt: '', negativePrompt: '', params: { ...params, characters: [] } });
    expect((await getCopiedImageData(file(image())))?.params?.characters).toEqual([]);
    vi.stubGlobal('ClipboardItem', class {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => image() })));
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn(async () => { throw new Error('write failed'); }) } });
    await expect(copySharedImage('/image', false, generationData)).rejects.toThrow('write failed');
    expect(await getCopiedImageData(file(image()))).toBeUndefined();
  });

  it('旧记录未包含角色字段时明确导入空角色，缓存损坏时安全退回图片解析', async () => {
    await rememberCopiedImage(beginImageClipboardCopy(), image(), image(), { prompt: 'scene', params: { ...params, characters: undefined, useCoords: undefined } });
    expect((await getCopiedImageData(file(image())))?.params).toMatchObject({ characters: [], useCoords: false });
    sessionStorage.setItem('nai_last_copied_image', 'broken');
    expect(await getCopiedImageData(file(image()))).toBeUndefined();
  });

  it('带角色的旧复制记录缺省自动构图，复制关联保留临时停用项', async () => {
    const characters = [{ ...params.characters[0], enabled: false }];
    await rememberCopiedImage(beginImageClipboardCopy(), image(), image(), { prompt: '', params: { ...params, characters, useCoords: undefined } });
    expect((await getCopiedImageData(file(image())))?.params).toMatchObject({ characters, useCoords: false });
  });
});
