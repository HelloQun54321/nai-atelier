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
const readComment = (png: Uint8Array) => {
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = new DataView(png.buffer, png.byteOffset).getUint32(offset);
    const type = new TextDecoder().decode(png.slice(offset + 4, offset + 8));
    const data = png.slice(offset + 8, offset + 8 + length);
    const end = data.indexOf(0);
    if (type === 'iTXt' && new TextDecoder().decode(data.slice(0, end)) === 'Comment') return JSON.parse(new TextDecoder().decode(data.slice(end + 5)));
    offset += length + 12;
  }
  return null;
};
const withStealth = (raw: Record<string, unknown>, magic: string) => {
  const width = 64, height = 128;
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < data.length; index += 4) data.set([12, 34, 56, 254], index);
  const json = encoder.encode(JSON.stringify(raw));
  const payload = magic === 'stealth_pngcomp' ? new Uint8Array(gzipSync(json)) : json;
  const hidden = join(encoder.encode(magic), uint32(payload.length * 8), payload);
  expect(hidden.length * 8).toBeLessThan(width * height);
  for (let bit = 0; bit < hidden.length * 8; bit++) {
    const x = Math.floor(bit / height), y = bit % height;
    data[(y * width + x) * 4 + 3] |= (hidden[bit >>> 3] >>> (7 - bit % 8)) & 1;
  }
  data.set([12, 34, 56, 0], data.length - 4);
  return encode({ width, height, data });
};

describe('独立图片分享副本', () => {
  it('仅清提示词也移除分栏和库对照等隐藏副本，保留真实生成参数', async () => {
    const base = encode({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]), text: {
      Comment: JSON.stringify({ prompt: 'private prompt', steps: 28, width: 832, height: 1216,
        _promptSections: { wardrobe: 'private wardrobe' }, _promptLibrary: { bilingual: 'private translation', references: [{ prompt: 'private reference' }] },
        params: { _promptSections: { extra: 'nested private scene' } } }),
    } });
    const cleaned = readComment(await cleanPngForSharing(base, '', 'prompts'));
    expect(cleaned).toMatchObject({ steps: 28, width: 832, height: 1216 });
    expect(JSON.stringify(cleaned)).not.toContain('private');
    expect(cleaned).not.toHaveProperty('_promptSections');
    expect(cleaned).not.toHaveProperty('_promptLibrary');
  });

  it('用户提供的 NAI 样例保留已记录参数与空值，移除提示词、生成耗时和签名', async () => {
    const comment = { prompt: '👻👻👻', uc: '', steps: 28, width: 1024, height: 1024, scale: 5, uncond_scale: 1, cfg_rescale: 0, seed: null,
      n_samples: 1, noise_schedule: 'native', sampler: 'k_euler_ancestral', request_type: 'PromptGenerateRequest', signed_hash: '',
      reference_information_extracted_multiple: [], reference_strength_multiple: [], sm: false, sm_dyn: false, legacy: false, legacy_v3_extend: false,
      hide_debug_overlay: false, dynamic_thresholding: false, dynamic_thresholding_percentile: 0, dynamic_thresholding_mimic_scale: 0,
      skip_cfg_above_sigma: null, skip_cfg_below_sigma: 0, controlnet_model: null, lora_unet_weights: null, lora_clip_weights: null,
      inpaintImg2ImgStrength: 0, noise: 0, color_correct: false, img2img: { strength: 0, color_correct: true, prompt: 'secret nested', image: 'secret image' } };
    const base = insert(encode({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]), text: {
      Software: 'NovelAI', Source: 'Stable Diffusion XL 9CC2F394', 'Generation time': '11.4514' } }),
      chunk('iTXt', join(encoder.encode('Description'), new Uint8Array(5), encoder.encode('👻👻👻'))),
      chunk('iTXt', join(encoder.encode('Comment'), new Uint8Array(5), encoder.encode(JSON.stringify(comment)))));
    const { prompt: _prompt, uc: _uc, signed_hash: _signature, img2img: _edit, ...expected } = comment;
    expect(readComment(await cleanPngForSharing(base, '', 'prompts'))).toEqual({ ...expected, Source: 'Stable Diffusion XL 9CC2F394', img2img: { strength: 0, color_correct: true } });
    const cleaned = await cleanPngForSharing(base, '🐷', 'prompts');
    expect(readComment(cleaned)).toEqual({ ...expected, Source: 'Stable Diffusion XL 9CC2F394', img2img: { strength: 0, color_correct: true }, prompt: '🐷' });
    expect(new TextDecoder().decode(cleaned)).not.toMatch(/👻|secret|signed_hash|Generation time|11\.4514|Software/);
  });
  it.each(['tEXt', 'zTXt', 'iTXt'])('仅提示词从 %s 保留实际参数，完整移除整图和角色文本，不补缺失值', async type => {
    const value = { prompt: 'secret style', uc: 'secret negative', negativePrompt: 'secret alias', Description: 'secret description', steps: 0, seed: 0, cfg_rescale: 0, sm: false, skip_cfg_above_sigma: null, sampler: 'k_euler', signed_hash: 'secret signature', unknown: 'secret unknown',
      v4_prompt: { use_coords: false, caption: { base_caption: 'secret base', char_captions: [{ char_caption: 'secret role', centers: [{ x: 0, y: 0.5 }] }] } },
      v4_negative_prompt: { legacy_uc: false, caption: { base_caption: 'secret uc base', char_captions: [{ char_caption: 'secret role negative', centers: [{ x: 0, y: 0.5 }] }] } },
      v5_prompt: { caption: { base_caption: 'secret v5', char_captions: [{ char_caption: 'secret v5 role' }] } },
      characters: [{ prompt: 'secret direct role', negativePrompt: 'secret direct negative', name: 'secret name', x: 0, y: 1, enabled: false }] };
    const json = encoder.encode(JSON.stringify(value));
    const text = type === 'tEXt' ? join(encoder.encode('Comment'), new Uint8Array(1), json)
      : type === 'zTXt' ? join(encoder.encode('Comment'), new Uint8Array(2), deflateSync(json))
      : join(encoder.encode('Comment'), new Uint8Array(5), json);
    const pixels = new Uint8Array([10, 20, 30, 0, 40, 50, 60, 127]);
    const source = insert(encode({ width: 2, height: 1, data: pixels }), chunk(type, text),
      chunk('tEXt', join(encoder.encode('Source'), new Uint8Array(1), encoder.encode('actual model source'))), chunk('gAMA', uint32(45455)));
    const original = source.slice();
    const expected = { steps: 0, seed: 0, cfg_rescale: 0, sm: false, skip_cfg_above_sigma: null, sampler: 'k_euler', Source: 'actual model source',
      v4_prompt: { use_coords: false, caption: { char_captions: [{ centers: [{ x: 0, y: 0.5 }] }] } },
      v4_negative_prompt: { legacy_uc: false, caption: { char_captions: [{ centers: [{ x: 0, y: 0.5 }] }] } },
      v5_prompt: { caption: { char_captions: [{}] } }, characters: [{ x: 0, y: 1, enabled: false }] };
    for (const customText of ['', '  👻 "新词"  ']) {
      const cleaned = await cleanPngForSharing(source, customText, 'prompts');
      expect(readComment(cleaned)).toEqual(customText ? { ...expected, prompt: customText } : expected);
      expect(new TextDecoder().decode(cleaned)).not.toContain('secret');
      expect(decode(cleaned, { checkCrc: true }).data).toEqual(pixels);
      expect(new TextDecoder().decode(cleaned)).toContain('gAMA');
    }
    expect(await extractNovelAiMetadataFromPng(toBuffer(await cleanPngForSharing(source)))).toBeNull();
    expect(source).toEqual(original);
  });

  it.each(['stealth_pngcomp', 'stealth_pnginfo'])('仅提示词保留 %s 参数并补普通信息缺失项，旧隐藏载荷消失', async magic => {
    const hidden = { Source: 'hidden model', Comment: JSON.stringify({ prompt: 'secret hidden', uc: 'secret hidden negative', seed: 0, steps: 24, scale: 0, sm: false, width: 64, height: 128, signed_hash: 'secret hash' }) };
    const source = withStealth(hidden, magic);
    const original = source.slice();
    const hiddenOnly = await cleanPngForSharing(source, '', 'prompts');
    expect(readComment(hiddenOnly)).toEqual({ Source: 'hidden model', seed: 0, steps: 24, scale: 0, sm: false, width: 64, height: 128 });
    const combined = insert(source, chunk('tEXt', join(encoder.encode('Comment'), new Uint8Array(1), encoder.encode('{"prompt":"secret regular","steps":12}'))));
    const cleaned = await cleanPngForSharing(combined, '🐷', 'prompts');
    expect(readComment(cleaned)).toEqual({ prompt: '🐷', Source: 'hidden model', seed: 0, steps: 12, scale: 0, sm: false, width: 64, height: 128 });
    const pixels = decode(cleaned, { checkCrc: true }).data as Uint8Array;
    expect(await extractNovelAiStealthMetadataFromRgba(pixels, 64, 128)).toBeNull();
    const before = decode(source).data;
    for (let index = 0; index < pixels.length; index += 4) {
      expect(pixels.slice(index, index + 3)).toEqual(before.slice(index, index + 3));
      expect(Math.abs(pixels[index + 3] - before[index + 3])).toBeLessThanOrEqual(1);
    }
    expect(pixels[pixels.length - 1]).toBe(0);
    expect(source).toEqual(original);
  });

  it('旧 Steps 文本只提取确实记录的参数，未知／损坏信息清除且不伪造默认值', async () => {
    const base = encode({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) });
    const legacy = insert(base, chunk('tEXt', join(encoder.encode('Comment'), new Uint8Array(1), encoder.encode('secret style\nNegative prompt: secret uc\nSteps: 12, Sampler: Euler a, CFG scale: 0, Seed: 0, Size: 640x832'))));
    expect(readComment(await cleanPngForSharing(legacy, '', 'prompts'))).toEqual({ steps: 12, sampler: 'Euler a', scale: 0, seed: 0, width: 640, height: 832 });
    const withSchedule = insert(base, chunk('tEXt', join(encoder.encode('Comment'), new Uint8Array(1), encoder.encode('style\nNegative prompt: uc\nSteps: 23, Sampler: k_dpmpp_2m (exponential), CFG scale: 5, Seed: 1, Size: 832x1216'))));
    expect(readComment(await cleanPngForSharing(withSchedule, '', 'prompts'))).toMatchObject({ steps: 23, sampler: 'k_dpmpp_2m', noise_schedule: 'exponential', scale: 5, seed: 1, width: 832, height: 1216 });
    for (const raw of ['{"prompt":"secret"}', '{"prompt":broken}', '{"node":{"text":"secret"}}', 'secret arbitrary']) {
      const source = insert(base, chunk('tEXt', join(encoder.encode('Comment'), new Uint8Array(1), encoder.encode(raw))));
      const cleaned = await cleanPngForSharing(source, '', 'prompts');
      expect(readComment(cleaned)).toBeNull();
      expect(new TextDecoder().decode(cleaned)).not.toContain('secret');
      expect(cleaned).toEqual(base);
    }
  });
  it('空白文本与纯清洗字节一致，Unicode、emoji、引号原文写入两个合法 iTXt', async () => {
    const pixels = new Uint8Array([10, 20, 30, 0, 40, 50, 60, 127]);
    const source = encode({ width: 2, height: 1, channels: 4, data: pixels, text: { Comment: '{"prompt":"secret","seed":12}', Source: 'old source' } });
    const original = source.slice();
    const pure = await cleanPngForSharing(source);
    expect(await cleanPngForSharing(source, '')).toEqual(pure);
    expect(await cleanPngForSharing(source, ' \n\t')).toEqual(pure);
    const text = '  中文「🐷🐷🐷」 "quote" \\ slash\n第二行  ';
    const cleaned = await cleanPngForSharing(source, text);
    const entries: Record<string, string> = {};
    for (let offset = 8; offset < cleaned.length;) {
      const length = new DataView(cleaned.buffer, cleaned.byteOffset).getUint32(offset);
      const type = new TextDecoder().decode(cleaned.slice(offset + 4, offset + 8));
      const data = cleaned.slice(offset + 8, offset + 8 + length);
      expect(cleaned.slice(offset, offset + length + 12)).toEqual(chunk(type, data));
      if (type === 'iTXt') {
        const end = data.indexOf(0);
        expect(data.slice(end, end + 5)).toEqual(new Uint8Array(5));
        entries[new TextDecoder().decode(data.slice(0, end))] = new TextDecoder('utf-8', { fatal: true }).decode(data.slice(end + 5));
      }
      offset += length + 12;
    }
    expect(entries).toEqual({ Description: text, Comment: JSON.stringify({ prompt: text }) });
    expect(JSON.parse((await extractNovelAiMetadataFromPng(toBuffer(cleaned)))!)).toEqual({ prompt: text });
    expect(new TextDecoder().decode(cleaned)).not.toMatch(/secret|old source|seed/);
    expect(decode(cleaned, { checkCrc: true }).data).toEqual(pixels);
    expect(source).toEqual(original);
    await expect(cleanPngForSharing(source, 'invalid\0text')).rejects.toThrow('空字符');
  });
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
      : { width, height, data: rgba, channels: 4 }), chunk('sRGB', new Uint8Array([0])),
      chunk('tEXt', join(encoder.encode('Comment'), new Uint8Array([0]), encoder.encode('{"prompt":"secret style","seed":1}'))));
    const original = png.slice();
    const originalPixels = indexed ? convertIndexedToRgb(decode(png)) : decode(png).data as Uint8Array;
    expect(originalPixels).toEqual(rgba);
    if (magic === 'stealth_pngcomp') expect(await extractNovelAiStealthMetadataFromRgba(originalPixels, width, height)).toContain('secret style');
    const pure = await cleanPngForSharing(png);
    expect(await extractNovelAiMetadataFromPng(toBuffer(pure))).toBeNull();
    expect(await extractNovelAiStealthMetadataFromRgba(decode(pure).data as Uint8Array, width, height)).toBeNull();
    const cleaned = await cleanPngForSharing(png, '👻👻👻');
    expect(JSON.parse((await extractNovelAiMetadataFromPng(toBuffer(cleaned)))!)).toEqual({ prompt: '👻👻👻' });
    expect(new TextDecoder().decode(cleaned)).not.toContain('secret style');
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
