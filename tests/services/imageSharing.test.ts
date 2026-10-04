import { gzipSync, deflateSync } from 'node:zlib';
import { convertIndexedToRgb, decode, encode } from 'fast-png';
import { describe, expect, it } from 'vitest';
import { cleanPngForSharing, imageSharingFilename } from '../../services/imageSharing';
import { extractNovelAiMetadataFromPng, extractNovelAiStealthMetadataFromRgba } from '../../services/metadataService';

const encoder = new TextEncoder();
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
const uint32 = (value: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
};
const chunk = (type: string, data: Uint8Array) => {
  const content = join(encoder.encode(type), data);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return join(uint32(data.length), content, uint32((crc ^ 0xffffffff) >>> 0));
};
const insert = (png: Uint8Array, ...chunks: Uint8Array[]) => join(png.slice(0, 33), ...chunks, png.slice(33));
const toBuffer = (png: Uint8Array) => png.slice().buffer as ArrayBuffer;

describe('独立图片分享副本', () => {
  it('去除三类文本、EXIF、未知附加块及尾部载荷，保留色彩配置和原始像素', async () => {
    const pixels = new Uint8Array([10, 20, 30, 0, 40, 50, 60, 127, 70, 80, 90, 255]);
    const base = encode({ width: 3, height: 1, channels: 4, data: pixels });
    const comment = JSON.stringify({ prompt: 'private style', seed: 12 });
    const png = join(insert(base,
      chunk('tEXt', join(encoder.encode('Comment'), new Uint8Array([0]), encoder.encode(comment))),
      chunk('zTXt', join(encoder.encode('Description'), new Uint8Array([0, 0]), deflateSync('private style'))),
      chunk('iTXt', join(encoder.encode('parameters'), new Uint8Array(5), encoder.encode(comment))),
      chunk('eXIf', encoder.encode('private style')),
      chunk('npMd', encoder.encode('private style')),
      chunk('gAMA', uint32(45455)), chunk('sRGB', new Uint8Array([0])),
    ), encoder.encode('private tail'));
    const original = png.slice();
    expect(await extractNovelAiMetadataFromPng(toBuffer(png))).not.toBeNull();
    const cleaned = await cleanPngForSharing(png);
    expect(await extractNovelAiMetadataFromPng(toBuffer(cleaned))).toBeNull();
    expect(new TextDecoder().decode(cleaned)).not.toContain('private');
    expect(new TextDecoder().decode(cleaned)).toContain('gAMA');
    expect(new TextDecoder().decode(cleaned)).toContain('sRGB');
    expect(decode(cleaned, { checkCrc: true }).data).toEqual(pixels);
    expect(png).toEqual(original);
    expect(await extractNovelAiMetadataFromPng(toBuffer(png))).not.toBeNull();
  });

  it.each([
    ['stealth_pngcomp', false], ['stealth_pnginfo', false],
    ['stealth_pngcomp', true], ['stealth_pnginfo', true],
  ] as const)('移除 %s 隐藏载荷，调色板=%s，原图保留且透明背景不变白', async (magic, indexed) => {
    const width = 32, height = 64;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) { rgba.set([17, 39, 68, 254], i); }
    // 留出真实的全透明与半透明背景，验证清洗不会全局压成不透明。
    rgba.set([17, 39, 68, 0], rgba.length - 4);
    rgba.set([17, 39, 68, 127], rgba.length - 8);
    const payload = new Uint8Array(gzipSync(JSON.stringify({ Comment: JSON.stringify({ prompt: 'secret style', seed: 1 }) })));
    const hidden = join(encoder.encode(magic), uint32(payload.length * 8), payload);
    for (let bit = 0; bit < hidden.length * 8; bit++) {
      const x = Math.floor(bit / height), y = bit % height;
      rgba[(y * width + x) * 4 + 3] |= (hidden[bit >>> 3] >>> (7 - bit % 8)) & 1;
    }
    const indexedPixels = new Uint8Array(width * height).map((_, i) => {
      const alpha = rgba[i * 4 + 3];
      return alpha === 254 ? 0 : alpha === 255 ? 3 : alpha === 0 ? 1 : 2;
    });
    const png = insert(encode(indexed
      ? { width, height, data: indexedPixels, channels: 1, depth: 8, palette: [[17, 39, 68, 254], [17, 39, 68, 0], [17, 39, 68, 127], [17, 39, 68, 255]] }
      : { width, height, data: rgba, channels: 4 }), chunk('sRGB', new Uint8Array([0])));
    const original = png.slice();
    const originalPixels = indexed ? convertIndexedToRgb(decode(png)) : decode(png).data as Uint8Array;
    expect(originalPixels).toEqual(rgba);
    if (magic === 'stealth_pngcomp') expect(await extractNovelAiStealthMetadataFromRgba(originalPixels, width, height)).toContain('secret style');
    const cleaned = await cleanPngForSharing(png);
    const output = decode(cleaned, { checkCrc: true });
    expect(await extractNovelAiStealthMetadataFromRgba(output.data as Uint8Array, width, height)).toBeNull();
    for (let i = 0; i < rgba.length; i += 4) {
      expect(Array.from(output.data.slice(i, i + 3))).toEqual(Array.from(rgba.slice(i, i + 3)));
      expect(Math.abs(output.data[i + 3] - rgba[i + 3])).toBeLessThanOrEqual(1);
    }
    expect(output.data[rgba.length - 1]).toBe(0);
    expect(output.data[rgba.length - 5]).toBe(126);
    expect(new TextDecoder().decode(cleaned)).toContain('sRGB');
    expect(png).toEqual(original);
  });

  it.each([1, 2, 3, 4])('无隐藏参数的 16 位 %s 通道 PNG 保留原始深度及透明度', async channels => {
    const pixels = new Uint16Array(4 * channels).map((_, i) => (i * 7001) % 65536);
    const png = encode({ width: 2, height: 2, channels, depth: 16, data: pixels });
    const output = decode(await cleanPngForSharing(png), { checkCrc: true });
    expect(output.data).toEqual(pixels);
    expect(output.depth).toBe(16);
  });

  it('调色板与颜色键透明度按原像素流保留', async () => {
    const png = encode({ width: 2, height: 1, channels: 1, depth: 8, data: new Uint8Array([0, 1]), palette: [[0, 0, 0, 0], [80, 20, 40, 255]] });
    const output = decode(await cleanPngForSharing(png), { checkCrc: true });
    expect(output.palette).toEqual([[0, 0, 0, 0], [80, 20, 40, 255]]);
    expect(output.data).toEqual(new Uint8Array([0, 1]));
  });

  it('损坏、截断、超大和动画图片拒绝清洗，不能静默返回原图', async () => {
    const png = encode({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) });
    await expect(cleanPngForSharing(png.slice(0, -1))).rejects.toThrow();
    const corrupt = png.slice();
    corrupt[29] ^= 1;
    await expect(cleanPngForSharing(corrupt)).rejects.toThrow();
    const huge = png.slice();
    new DataView(huge.buffer).setUint32(16, 50_000_000);
    await expect(cleanPngForSharing(huge)).rejects.toThrow('图片过大');
    await expect(cleanPngForSharing(insert(png, chunk('acTL', join(uint32(1), uint32(0)))))).rejects.toThrow('动画');
  });

  it('分享版使用独立文件名，原图扩展名匹配实际 MIME', () => {
    expect(imageSharingFilename('NAI.png', new Blob([], { type: 'image/png' }), true)).toBe('NAI-分享版.png');
    expect(imageSharingFilename('inspiration.png', new Blob([], { type: 'image/jpeg' }), false)).toBe('inspiration.jpg');
  });
});
