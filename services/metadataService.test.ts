import { describe, it, expect } from 'vitest';
import { deflateSync, gzipSync } from 'node:zlib';
import {
  extractNovelAiMetadataFromPng,
  extractNovelAiStealthMetadataFromRgba,
  extractRawMetadataFromJsonText,
  parseNovelAIMetadata,
} from './metadataService';

const encoder = new TextEncoder();

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

const uint32 = (value: number): Uint8Array => new Uint8Array([
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]);

const pngChunk = (type: string, data: Uint8Array): Uint8Array => concatBytes(
  uint32(data.byteLength),
  encoder.encode(type),
  data,
  new Uint8Array(4), // 解析器不依赖 CRC，测试夹具使用占位值。
);

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

const pngWithTextChunks = (...chunks: Uint8Array[]): ArrayBuffer => toArrayBuffer(concatBytes(
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ...chunks,
  pngChunk('IEND', new Uint8Array()),
));

const textChunk = (keyword: string, text: string): Uint8Array => pngChunk(
  'tEXt',
  concatBytes(encoder.encode(keyword), new Uint8Array([0]), encoder.encode(text)),
);

const compressedTextChunk = (keyword: string, text: string): Uint8Array => pngChunk(
  'zTXt',
  concatBytes(
    encoder.encode(keyword),
    new Uint8Array([0, 0]),
    new Uint8Array(deflateSync(encoder.encode(text))),
  ),
);

const internationalTextChunk = (keyword: string, text: string): Uint8Array => pngChunk(
  'iTXt',
  concatBytes(
    encoder.encode(keyword),
    new Uint8Array([0, 0, 0, 0, 0]), // 关键字终止、未压缩、空语言、空翻译关键字。
    encoder.encode(text),
  ),
);

const makeStealthRgba = (
  payload: Uint8Array,
  declaredBitLength = payload.byteLength * 8,
): { rgba: Uint8ClampedArray; width: number; height: number } => {
  const header = concatBytes(
    encoder.encode('stealth_pngcomp'),
    uint32(declaredBitLength),
    payload,
  );
  const height = 64;
  const width = Math.max(1, Math.ceil((header.byteLength * 8) / height));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) rgba[pixel * 4 + 3] = 254;

  for (let bitOffset = 0; bitOffset < header.byteLength * 8; bitOffset++) {
    const byte = header[Math.floor(bitOffset / 8)];
    const bit = (byte >>> (7 - (bitOffset % 8))) & 1;
    const x = Math.floor(bitOffset / height);
    const y = bitOffset % height;
    rgba[(y * width + x) * 4 + 3] |= bit;
  }
  return { rgba, width, height };
};

describe('extractRawMetadataFromJsonText', () => {
  it('Comment 为对象时序列化返回', () => {
    const comment = { prompt: 'a girl', steps: 28 };
    const out = extractRawMetadataFromJsonText(JSON.stringify({ Comment: comment, other: 1 }));
    expect(JSON.parse(out)).toEqual(comment);
  });

  it('comment 为字符串时直接返回', () => {
    expect(extractRawMetadataFromJsonText(JSON.stringify({ comment: 'raw meta text' }))).toBe('raw meta text');
  });

  it('空字符串 comment 不算有效值，继续走后续分支', () => {
    expect(extractRawMetadataFromJsonText(JSON.stringify({ comment: '  ', prompt: 'p' }))).toContain('"prompt"');
  });

  it('本身是生成参数 JSON 时整体返回', () => {
    const out = extractRawMetadataFromJsonText(JSON.stringify({ prompt: 'x', steps: 23, uc: 'y' }));
    expect(JSON.parse(out)).toEqual({ prompt: 'x', steps: 23, uc: 'y' });
  });

  it('Description 字段兜底', () => {
    expect(extractRawMetadataFromJsonText(JSON.stringify({ Description: 'legacy text' }))).toBe('legacy text');
  });

  it('非 JSON 纯文本原样返回（交给纯文本元数据解析）', () => {
    const plain = 'masterpiece, 1girl, best quality Negative prompt: lowres Steps: 28';
    expect(extractRawMetadataFromJsonText(plain)).toBe(plain);
  });

  it('对象但无任何已知字段时原样返回', () => {
    const raw = JSON.stringify({ foo: 'bar' });
    expect(extractRawMetadataFromJsonText(raw)).toBe(raw);
  });
});

describe('NovelAI 标准 PNG 元数据', () => {
  const comment = JSON.stringify({ prompt: '1girl', uc: 'lowres', steps: 28, seed: 123 });

  it('读取 tEXt Comment，并优先于 Description', async () => {
    const buffer = pngWithTextChunks(
      textChunk('Description', '这不是完整生成参数'),
      textChunk('Comment', comment),
    );
    expect(await extractNovelAiMetadataFromPng(buffer)).toBe(comment);
  });

  it('合并独立 Source 文本块，以便识别图片模型', async () => {
    const buffer = pngWithTextChunks(
      textChunk('Source', 'NovelAI Diffusion V5 0ADF9AB7'),
      textChunk('Comment', JSON.stringify({ prompt: '1girl', steps: 23 })),
    );
    const raw = await extractNovelAiMetadataFromPng(buffer);
    expect(JSON.parse(raw!)).toMatchObject({ Source: 'NovelAI Diffusion V5 0ADF9AB7' });
    expect(parseNovelAIMetadata(raw!).params.model).toBe('nai-diffusion-5-full');
  });

  it('读取 UTF-8 iTXt Comment', async () => {
    const unicodeComment = JSON.stringify({ prompt: '少女、夜空', steps: 23 });
    const buffer = pngWithTextChunks(internationalTextChunk('Comment', unicodeComment));
    expect(await extractNovelAiMetadataFromPng(buffer)).toBe(unicodeComment);
  });

  it('读取压缩 zTXt Comment', async () => {
    const buffer = pngWithTextChunks(compressedTextChunk('Comment', comment));
    expect(await extractNovelAiMetadataFromPng(buffer)).toBe(comment);
  });

  it('忽略没有生成参数的普通 PNG 文本', async () => {
    const buffer = pngWithTextChunks(textChunk('Comment', 'ordinary image comment'));
    expect(await extractNovelAiMetadataFromPng(buffer)).toBeNull();
  });

  it('损坏文本块不会越界或抛错', async () => {
    const truncated = toArrayBuffer(concatBytes(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      uint32(1000),
      encoder.encode('tEXt'),
      new Uint8Array([1, 2, 3]),
    ));
    expect(await extractNovelAiMetadataFromPng(truncated)).toBeNull();
  });
});

describe('NovelAI Stealth PNG 元数据', () => {
  const v5Comment = {
    prompt: '1girl, cinematic lighting',
    uc: 'lowres',
    steps: 23,
    width: 832,
    height: 1216,
    scale: 6.5,
    seed: 3908099454,
    sampler: 'k_euler_ancestral',
    model_name: 'NovelAI Diffusion V5',
    model_hash: '0ADF9AB7',
    v4_prompt: {
      use_coords: false,
      caption: { base_caption: '1girl, cinematic lighting', char_captions: [] },
    },
  };

  it('按官方 Alpha 列优先顺序解码 gzip Comment', async () => {
    const outer = JSON.stringify({
      Description: v5Comment.prompt,
      Software: 'NovelAI',
      Source: 'NovelAI Diffusion V5 0ADF9AB7',
      Comment: JSON.stringify(v5Comment),
    });
    const fixture = makeStealthRgba(new Uint8Array(gzipSync(encoder.encode(outer))));
    const raw = await extractNovelAiStealthMetadataFromRgba(fixture.rgba, fixture.width, fixture.height);

    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject(v5Comment);
    expect(parseNovelAIMetadata(raw!).params).toMatchObject({
      model: 'nai-diffusion-5-full',
      width: 832,
      height: 1216,
      steps: 23,
      scale: 6.5,
      seed: 3908099454,
      sampler: 'k_euler_ancestral',
    });
  });

  it('按官方 Source 哈希区分 Full / Curated，并允许运行时新增映射', () => {
    expect(parseNovelAIMetadata(JSON.stringify({
      prompt: '1girl',
      model_name: 'NovelAI Diffusion V4.5',
      model_hash: '4BDE2A90',
    })).params.model).toBe('nai-diffusion-4-5-full');
    expect(parseNovelAIMetadata(JSON.stringify({
      prompt: '1girl',
      model_name: 'NovelAI Diffusion V5',
      model_hash: 'UNKNOWN',
    })).params.model).toBe('nai-diffusion-5-curated');
    expect(parseNovelAIMetadata(JSON.stringify({
      prompt: '1girl',
      Source: 'NovelAI Diffusion V6 ABCDEF12',
    }), undefined, {
      'NovelAI Diffusion V6 ABCDEF12': 'nai-diffusion-6-full',
    }).params.model).toBe('nai-diffusion-6-full');
  });

  it('拒绝声明长度超过图片容量的载荷', async () => {
    const fixture = makeStealthRgba(new Uint8Array([1, 2, 3]), 8_000_000);
    expect(await extractNovelAiStealthMetadataFromRgba(fixture.rgba, fixture.width, fixture.height)).toBeNull();
  });

  it('损坏 gzip 返回 null', async () => {
    const fixture = makeStealthRgba(new Uint8Array([1, 2, 3, 4]));
    expect(await extractNovelAiStealthMetadataFromRgba(fixture.rgba, fixture.width, fixture.height)).toBeNull();
  });

  it('无 Stealth 签名返回 null', async () => {
    const rgba = new Uint8ClampedArray(64 * 64 * 4);
    expect(await extractNovelAiStealthMetadataFromRgba(rgba, 64, 64)).toBeNull();
  });
});
