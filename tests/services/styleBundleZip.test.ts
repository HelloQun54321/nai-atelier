// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { api } from '../../services/api';
import { characterReferenceService } from '../../services/characterReferenceService';
import { extractMetadata, parseNovelAIMetadata } from '../../services/metadataService';
import { extractImageMetadata } from '../../services/pngMetadata.mjs';
import { getStyleBundleEntryPreview, importStyleBundle, loadStyleBundleEntryCoverBlob, readStyleBundle } from '../../services/styleBundle';

vi.mock('../../services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), uploadFile: vi.fn() } }));
vi.mock('../../services/characterReferenceService', () => ({ characterReferenceService: { create: vi.fn() } }));

const encoder = new TextEncoder();

function encodeUtf16(text: string, bigEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), !bigEndian);
  return bytes;
}

/** 构造与 Pillow `exif[37510] = b"UNICODE\x00" + json.encode("utf-16-be")` 一致的最小 WebP。 */
function buildWebpWithExif(
  userCommentBytes: Uint8Array,
  options: { width?: number; height?: number; inSubIfd?: boolean; withExifPrefix?: boolean; littleEndian?: boolean } = {},
): Uint8Array {
  const width = options.width ?? 832;
  const height = options.height ?? 1216;
  const le = options.littleEndian ?? true;
  const inSubIfd = options.inSubIfd ?? false;

  // 构造 TIFF 容器
  const tiffSize = inSubIfd
    ? 8 + 2 + 12 + 4 + 2 + 12 + 4 + userCommentBytes.length
    : 8 + 2 + 12 + 4 + userCommentBytes.length;
  const tiff = new Uint8Array(tiffSize);
  const tv = new DataView(tiff.buffer);
  tiff.set(le ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  tv.setUint16(2, 42, le);
  tv.setUint32(4, 8, le);

  if (inSubIfd) {
    // IFD0: 指向 ExifIFD (0x8769)
    tv.setUint16(8, 1, le);
    tv.setUint16(10, 0x8769, le);
    tv.setUint16(12, 4, le); // LONG
    tv.setUint32(14, 1, le);
    const subIfdOffset = 8 + 2 + 12 + 4;
    tv.setUint32(18, subIfdOffset, le);
    tv.setUint32(22, 0, le);
    // ExifIFD: 0x9286 UserComment
    tv.setUint16(subIfdOffset, 1, le);
    tv.setUint16(subIfdOffset + 2, 0x9286, le);
    tv.setUint16(subIfdOffset + 4, 7, le); // UNDEFINED
    tv.setUint32(subIfdOffset + 6, userCommentBytes.length, le);
    const dataOffset = subIfdOffset + 2 + 12 + 4;
    tv.setUint32(subIfdOffset + 10, dataOffset, le);
    tv.setUint32(subIfdOffset + 14, 0, le);
    tiff.set(userCommentBytes, dataOffset);
  } else {
    // IFD0 直接包含 0x9286 UserComment（与 Pillow Image.Exif() 一致）
    tv.setUint16(8, 1, le);
    tv.setUint16(10, 0x9286, le);
    tv.setUint16(12, 7, le);
    tv.setUint32(14, userCommentBytes.length, le);
    const dataOffset = 8 + 2 + 12 + 4;
    tv.setUint32(18, dataOffset, le);
    tv.setUint32(22, 0, le);
    tiff.set(userCommentBytes, dataOffset);
  }

  const exifBody = options.withExifPrefix
    ? new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff])
    : tiff;

  // VP8X (10 bytes) + 占位 VP8 像素块 (12 bytes) + EXIF 块（放在末尾，贴合真实 WebP 结构）
  const vp8xData = new Uint8Array(10);
  vp8xData[0] = 0x08; // EXIF flag
  const wMinus1 = width - 1, hMinus1 = height - 1;
  vp8xData[4] = wMinus1 & 0xff; vp8xData[5] = (wMinus1 >> 8) & 0xff; vp8xData[6] = (wMinus1 >> 16) & 0xff;
  vp8xData[7] = hMinus1 & 0xff; vp8xData[8] = (hMinus1 >> 8) & 0xff; vp8xData[9] = (hMinus1 >> 16) & 0xff;

  const makeChunk = (fourcc: string, data: Uint8Array) => {
    const pad = data.length & 1;
    const out = new Uint8Array(8 + data.length + pad);
    out.set(encoder.encode(fourcc), 0);
    new DataView(out.buffer).setUint32(4, data.length, true);
    out.set(data, 8);
    return out;
  };

  const vp8xChunk = makeChunk('VP8X', vp8xData);
  const vp8Chunk = makeChunk('VP8 ', new Uint8Array(16));
  const exifChunk = makeChunk('EXIF', exifBody);
  const riffSize = 4 + vp8xChunk.length + vp8Chunk.length + exifChunk.length;
  const webp = new Uint8Array(8 + riffSize);
  webp.set(encoder.encode('RIFF'), 0);
  new DataView(webp.buffer).setUint32(4, riffSize, true);
  webp.set(encoder.encode('WEBP'), 8);
  let pos = 12;
  for (const part of [vp8xChunk, vp8Chunk, exifChunk]) { webp.set(part, pos); pos += part.length; }
  return webp;
}

/** 构造带 tEXt 元数据块的最小 PNG。 */
function buildPngWithText(entries: Array<{ keyword: string; text: string }>, width = 832, height = 1216): Uint8Array {
  const makeChunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length, false);
    out.set(encoder.encode(type), 4);
    out.set(data, 8);
    return out;
  };
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width, false);
  iv.setUint32(4, height, false);
  ihdr[8] = 8; ihdr[9] = 2;
  const chunks = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    ...entries.map(item => makeChunk('tEXt', new Uint8Array([...encoder.encode(item.keyword), 0, ...encoder.encode(item.text)]))),
    makeChunk('IEND', new Uint8Array(0)),
  ];
  const total = chunks.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) { out.set(part, offset); offset += part.length; }
  return out;
}

/** 构造标准 ZIP（支持 STORE=0 与 DEFLATE=8）。 */
function buildZip(files: Array<{ name: string; data: Uint8Array; compress?: boolean }>): Blob {
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  for (const item of files) {
    const nameBytes = encoder.encode(item.name);
    const method = item.compress ? 8 : 0;
    const payload = item.compress ? new Uint8Array(deflateRawSync(item.data)) : item.data;

    const local = new Uint8Array(30 + nameBytes.length + payload.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8
    lv.setUint16(8, method, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, item.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(payload, 30 + nameBytes.length);
    localParts.push(local);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, item.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    cdParts.push(cd);

    offset += local.length;
  }

  const cdSize = cdParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...localParts, ...cdParts, eocd].map(part => Uint8Array.from(part).buffer), { type: 'application/zip' });
}

const createChain = vi.fn();

beforeEach(() => {
  createChain.mockReset().mockResolvedValue({ id: 'created-chain' });
  vi.mocked(api.post).mockImplementation(async (path, payload) => {
    if (path === '/chains') return createChain(payload);
    return {};
  });
  vi.mocked(api.uploadFile).mockResolvedValue({ url: '/api/assets/covers/imported.webp' });
});

afterEach(() => { vi.clearAllMocks(); });

describe('WebP EXIF UserComment 元数据解析', () => {
  const v5Json = {
    prompt: '1.2::artist:dino::, artist:ciloranko, 1girl, painterly, very aesthetic, masterpiece, no text',
    uc: 'lowres, bad anatomy',
    steps: 23,
    scale: 6,
    seed: 123456,
    width: 832,
    height: 1216,
    sampler: 'k_euler_ancestral',
    noise_schedule: 'karras',
    Source: 'NovelAI Diffusion V5 0ADF9AB7',
    v4_prompt: {
      use_coords: false,
      caption: {
        base_caption: '1.2::artist:dino::, artist:ciloranko, 1girl, painterly',
        char_captions: [{ char_caption: 'girl, white dress', centers: [{ x: 0.5, y: 0.5 }] }],
      },
    },
    v4_negative_prompt: {
      caption: {
        base_caption: 'lowres, bad anatomy',
        char_captions: [{ char_caption: 'hat', centers: [{ x: 0.5, y: 0.5 }] }],
      },
    },
  };

  it('解析 Pillow UTF-16 BE EXIF UserComment（IFD0 直接写入，贴合 NAImakeArtistGroup）', async () => {
    const userComment = new Uint8Array([...encoder.encode('UNICODE\0'), ...encodeUtf16(JSON.stringify(v5Json), true)]);
    const webp = buildWebpWithExif(userComment, { inSubIfd: false, withExifPrefix: false });
    const raw = await extractImageMetadata(webp);
    expect(raw).not.toBeNull();
    const parsed = parseNovelAIMetadata(raw!);
    expect(parsed.prompt).toContain('artist:dino');
    expect(parsed.negativePrompt).toBe('lowres, bad anatomy');
    expect(parsed.params).toMatchObject({
      model: 'nai-diffusion-5-full',
      steps: 23,
      scale: 6,
      sampler: 'k_euler_ancestral',
      noiseSchedule: 'karras',
      width: 832,
      height: 1216,
    });
    expect(parsed.params.characters?.[0]).toMatchObject({ prompt: 'girl, white dress', negativePrompt: 'hat' });
  });

  it('解析标准 ExifIFD 子表 UTF-16 LE UserComment 且 extractMetadata 支持 image/webp', async () => {
    const userComment = new Uint8Array([...encoder.encode('UNICODE\0'), ...encodeUtf16(JSON.stringify(v5Json), false)]);
    const webp = buildWebpWithExif(userComment, { inSubIfd: true, withExifPrefix: true });
    const file = new File([Uint8Array.from(webp).buffer], 'sample.webp', { type: 'image/webp' });
    const raw = await extractMetadata(file);
    expect(raw).not.toBeNull();
    expect(parseNovelAIMetadata(raw!).params.model).toBe('nai-diffusion-5-full');
  });
});

describe('.zip 画风包导入', () => {
  const makeV5Webp = (prompt: string) => {
    const json = {
      prompt,
      uc: 'lowres',
      steps: 23,
      scale: 5.5,
      width: 832,
      height: 1216,
      sampler: 'k_euler_ancestral',
      noise_schedule: 'karras',
      Source: 'NovelAI Diffusion V5 0ADF9AB7',
      v4_prompt: { use_coords: false, caption: { base_caption: prompt, char_captions: [] } },
      v4_negative_prompt: { caption: { base_caption: 'lowres', char_captions: [] } },
    };
    return buildWebpWithExif(new Uint8Array([...encoder.encode('UNICODE\0'), ...encodeUtf16(JSON.stringify(json), true)]));
  };

  const makeV45Png = (prompt: string) => buildPngWithText([
    { keyword: 'Source', text: 'NovelAI Diffusion V4.5 4BDE2A90' },
    {
      keyword: 'Comment',
      text: JSON.stringify({
        prompt,
        uc: 'worst quality',
        steps: 28,
        scale: 5,
        width: 1024,
        height: 1024,
        sampler: 'k_euler_ancestral',
        v4_prompt: { use_coords: false, caption: { base_caption: prompt, char_captions: [] } },
      }),
    },
  ], 1024, 1024);

  it('支持 ZIP_STORED（含 manifest.json 来源映射、混合模型、自动命名与零拷贝预览导入）', async () => {
    const hashName = 'a'.repeat(64) + '.webp';
    const v5Bytes = makeV5Webp('1.2::artist:dino::, {artist:ciloranko}, 1girl, painterly');
    const v45Bytes = makeV45Png('artist:wlop, watercolor, 1girl');
    const noMetaWebp = buildWebpWithExif(encoder.encode('plain comment without steps'));
    const manifest = {
      format: 'naimakeartistgroup-shared-images',
      version: 2,
      files: [
        { name: hashName, source_url: 'https://arca.live/b/aiart/123456' },
        { name: 'evil.png', source_url: 'http://localhost/private' },
      ],
    };

    const zip = buildZip([
      { name: `arca_style_images/${hashName}`, data: v5Bytes },
      { name: 'custom_folder/watercolor_style.png', data: v45Bytes },
      { name: 'arca_style_images/no_meta.webp', data: noMetaWebp },
      { name: '__MACOSX/._ignored.webp', data: v5Bytes },
      { name: '../traversal.webp', data: v5Bytes },
      { name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest)) },
    ]);

    const preview = await readStyleBundle(zip);
    expect(preview.sourceKind).toBe('zip');
    expect(preview.coverage).toBe('unrecorded');
    expect(preview.entries).toHaveLength(2);
    expect(preview.warnings.some(item => item.includes('跳过 1 张'))).toBe(true);

    // 第一条：哈希文件名自动取画师名，保留 manifest.json 的公网 source_url，同步零拷贝拿到 WebP 封面
    expect(preview.entries[0]).toMatchObject({
      name: 'dino, ciloranko',
      model: 'nai-diffusion-5-full',
      cover: true,
      sources: [{ author: '', sourceUrl: 'https://arca.live/b/aiart/123456', note: '' }],
    });
    // 第二条：非哈希文件名保留可读名
    expect(preview.entries[1]).toMatchObject({
      name: 'watercolor style',
      model: 'nai-diffusion-4-5-full',
      cover: true,
    });

    const snap0 = getStyleBundleEntryPreview(preview, preview.entries[0].id);
    expect(snap0.coverBlob?.type).toBe('image/webp');
    expect(new Uint8Array(await snap0.coverBlob!.arrayBuffer())).toEqual(v5Bytes);

    const imported = await importStyleBundle(preview, [preview.entries[0].id]);
    expect(imported.failed).toEqual([]);
    expect(imported.importedEntryIds).toEqual([preview.entries[0].id]);
    expect(api.uploadFile).toHaveBeenCalledTimes(1);
    expect(createChain.mock.calls[0][0]).toMatchObject({
      name: 'dino, ciloranko',
      type: 'style',
      previewImage: '/api/assets/covers/imported.webp',
      params: {
        model: 'nai-diffusion-5-full',
        noiseSchedule: 'karras',
        _styleBundleSources: [{ author: '', sourceUrl: 'https://arca.live/b/aiart/123456', note: '' }],
      },
    });
  });

  it('支持 ZIP_DEFLATE 按需异步解压封面并完成导入', async () => {
    const v5Bytes = makeV5Webp('artist:mika_pikazo, vivid colors');
    const zip = buildZip([{ name: 'vivid.webp', data: v5Bytes, compress: true }]);
    const preview = await readStyleBundle(zip);
    expect(preview.entries).toHaveLength(1);
    const syncSnap = getStyleBundleEntryPreview(preview, preview.entries[0].id);
    expect(syncSnap.hasCover).toBe(true);
    expect(syncSnap.coverBlob).toBeUndefined();

    const asyncBlob = await loadStyleBundleEntryCoverBlob(preview, preview.entries[0].id);
    expect(asyncBlob?.type).toBe('image/webp');
    expect(new Uint8Array(await asyncBlob!.arrayBuffer())).toEqual(v5Bytes);

    const imported = await importStyleBundle(preview, [preview.entries[0].id]);
    expect(imported.failed).toEqual([]);
    expect(api.uploadFile).toHaveBeenCalledTimes(1);
  });

  it('不含有效 NovelAI 元数据的 ZIP 或损坏 ZIP 明确拒绝', async () => {
    const emptyMetaZip = buildZip([{ name: 'plain.webp', data: buildWebpWithExif(encoder.encode('hello')) }]);
    await expect(readStyleBundle(emptyMetaZip)).rejects.toThrow('NovelAI');
    await expect(readStyleBundle(new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])]))).rejects.toThrow('ZIP');
  });
});
