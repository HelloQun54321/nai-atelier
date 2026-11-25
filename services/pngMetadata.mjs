// PNG 元数据公共读取核心：浏览器、Worker 与本机网关共用。
import { decode, convertIndexedToRgb } from 'fast-png';

/** 自动收集只承认真正记录的生成字段；默认参数与软件名称不构成依据。 */
export function hasCollectibleNaiMetadata(raw) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (value.uc != null && typeof value.uc !== 'string') return false;
    const positive = value.v4_prompt?.caption;
    const hasPrompt = [value.prompt, positive?.base_caption, ...(Array.isArray(positive?.char_captions) ? positive.char_captions.map(c => c.char_caption) : [])]
      .some(text => typeof text === 'string' && text.trim().length > 0);
    const generated = Number.isFinite(value.steps) && value.steps > 0 && typeof value.sampler === 'string'
      && (typeof value.uc === 'string' || value.v4_prompt || /novelai|nai-diffusion|stable diffusion xl/i.test(String(value.Source || value.source || value.model || '')));
    return Boolean(hasPrompt && generated);
  } catch {
    // 旧文本格式只有带明确 NovelAI 来源的记录才自动收集，普通 SD 参数不能冒充 NAI。
    return /NovelAI/i.test(raw) && /^\S[\s\S]*Steps:\s*\d+/i.test(raw) && /Sampler:/.test(raw);
  }
}

/** 识别图片容器并提取 NovelAI 元数据：PNG 走文本块与隐写，WebP/JPEG 走 EXIF。 */
export async function extractImageMetadata(bytes, { validatePixels = false, collectibleOnly = false } = {}) {
  if (!bytes || bytes.length < 12) return null;
  if (PNG_SIGNATURE.every((v, i) => bytes[i] === v)) {
    return extractPngMetadata(bytes, { validatePixels, collectibleOnly });
  }
  const exif = extractWebpExifPayload(bytes) || extractJpegExifPayload(bytes);
  if (!exif) return null;
  const candidate = selectNovelAiGenerationMetadata(readExifTextEntries(exif));
  return !collectibleOnly || (candidate && hasCollectibleNaiMetadata(candidate)) ? candidate : null;
}

/** 判断 RIFF WebP 是否带有 Alpha 通道（VP8L、ALPH 块或带 alpha 标志的 VP8X）。 */
export function isWebpWithAlpha(bytes) {
  if (!bytes || bytes.length < 12) return false;
  if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) return false;
  if (bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12, count = 0;
  while (offset + 8 <= bytes.length && count++ < 4096) {
    const type = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > bytes.length) break;
    if (type === 'ALPH' || type === 'VP8L') return true;
    if (type === 'VP8X' && size >= 1 && (bytes[dataStart] & 0x10) !== 0) return true;
    offset = dataEnd + (size & 1);
  }
  return false;
}

/** 从 RIFF WebP 的 EXIF 块中提取原始 TIFF/Exif 载荷。 */
export function extractWebpExifPayload(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) return null;
  if (bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12, count = 0;
  while (offset + 8 <= bytes.length && count++ < 4096) {
    const type = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > bytes.length) break;
    if (type === 'EXIF' && size > 0 && size <= MAX_STEALTH_DECOMPRESSED_BYTES) {
      return bytes.subarray(dataStart, dataEnd);
    }
    offset = dataEnd + (size & 1);
  }
  return null;
}

/** 从 JPEG 的 APP1 (Exif) 段中提取原始 EXIF 载荷。 */
function extractJpegExifPayload(bytes) {
  if (!bytes || bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2, count = 0;
  while (offset + 4 <= bytes.length && count++ < 2048) {
    if (bytes[offset] !== 0xff) break;
    let markerOffset = offset + 1;
    while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset++;
    if (markerOffset >= bytes.length) break;
    const marker = bytes[markerOffset];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset = markerOffset + 1; continue; }
    if (markerOffset + 3 > bytes.length) break;
    const segmentLength = view.getUint16(markerOffset + 1, false);
    if (segmentLength < 2) break;
    const dataStart = markerOffset + 3;
    const dataEnd = markerOffset + 1 + segmentLength;
    if (dataEnd > bytes.length) break;
    if (marker === 0xe1 && dataEnd - dataStart > 6
      && bytes[dataStart] === 0x45 && bytes[dataStart + 1] === 0x78 && bytes[dataStart + 2] === 0x69
      && bytes[dataStart + 3] === 0x66 && bytes[dataStart + 4] === 0x00 && bytes[dataStart + 5] === 0x00) {
      return bytes.subarray(dataStart, dataEnd);
    }
    offset = dataEnd;
  }
  return null;
}

const EXIF_TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

/** 解析 TIFF/EXIF IFD0 与 ExifIFD 中的 UserComment、ImageDescription、Software 等文本字段。 */
function readExifTextEntries(payload) {
  if (!payload || payload.length < 8) return [];
  let tiffStart = 0;
  if (payload.length >= 14 && payload[0] === 0x45 && payload[1] === 0x78 && payload[2] === 0x69
    && payload[3] === 0x66 && payload[4] === 0x00 && payload[5] === 0x00) {
    tiffStart = 6;
  }
  const tiff = payload.subarray(tiffStart);
  if (tiff.length < 8) return [];
  let littleEndian;
  if (tiff[0] === 0x49 && tiff[1] === 0x49) littleEndian = true;
  else if (tiff[0] === 0x4d && tiff[1] === 0x4d) littleEndian = false;
  else return [];
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (view.getUint16(2, littleEndian) !== 42) return [];
  const ifd0Offset = view.getUint32(4, littleEndian);
  const entries = [];
  const visited = new Set();

  const readIfd = (ifdOffset) => {
    if (!Number.isSafeInteger(ifdOffset) || ifdOffset < 8 || ifdOffset + 2 > tiff.length || visited.has(ifdOffset)) return;
    visited.add(ifdOffset);
    const count = Math.min(view.getUint16(ifdOffset, littleEndian), 1024);
    for (let index = 0; index < count; index++) {
      const entryOffset = ifdOffset + 2 + index * 12;
      if (entryOffset + 12 > tiff.length) break;
      const tag = view.getUint16(entryOffset, littleEndian);
      const type = view.getUint16(entryOffset + 2, littleEndian);
      const valueCount = view.getUint32(entryOffset + 4, littleEndian);
      if (tag === 0x8769 && (type === 4 || type === 3) && valueCount >= 1) {
        const subOffset = type === 4 ? view.getUint32(entryOffset + 8, littleEndian) : view.getUint16(entryOffset + 8, littleEndian);
        readIfd(subOffset);
        continue;
      }
      if (tag !== 0x9286 && tag !== 0x010e && tag !== 0x0131) continue;
      const unitSize = EXIF_TYPE_SIZES[type];
      if (!unitSize) continue;
      const byteLength = valueCount * unitSize;
      if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > MAX_STEALTH_DECOMPRESSED_BYTES) continue;
      let raw;
      if (byteLength <= 4) {
        raw = tiff.subarray(entryOffset + 8, entryOffset + 8 + byteLength);
      } else {
        const valueOffset = view.getUint32(entryOffset + 8, littleEndian);
        if (!Number.isSafeInteger(valueOffset) || valueOffset + byteLength > tiff.length) continue;
        raw = tiff.subarray(valueOffset, valueOffset + byteLength);
      }
      if (tag === 0x9286) {
        const text = decodeExifUserComment(raw, littleEndian);
        if (text) entries.push({ keyword: 'Comment', text });
      } else if (tag === 0x010e) {
        const text = decodeUtf8OrLatin1(raw).replace(/\0+$/, '').trim();
        if (text) entries.push({ keyword: 'Description', text });
      } else if (tag === 0x0131) {
        const text = decodeUtf8OrLatin1(raw).replace(/\0+$/, '').trim();
        if (text) entries.push({ keyword: 'Software', text });
      }
    }
  };

  readIfd(ifd0Offset);
  return entries;
}

const stripTrailingNulls = (value) => value.replace(/\0+$/, '').trim();

/** 解码 EXIF UserComment：支持 UNICODE(UTF-16 BE/LE 与误写 UTF-8)、ASCII 与裸文本。 */
function decodeExifUserComment(raw, tiffLittleEndian) {
  if (!raw || !raw.length) return '';
  if (raw.length >= 8) {
    const prefix = String.fromCharCode(...raw.subarray(0, 8));
    const body = raw.subarray(8);
    if (prefix === 'UNICODE\0') {
      if (!body.length) return '';
      if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) {
        return stripTrailingNulls(new TextDecoder('utf-16be').decode(body.subarray(2)));
      }
      if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) {
        return stripTrailingNulls(new TextDecoder('utf-16le').decode(body.subarray(2)));
      }
      // 某些工具会在 UNICODE\0 后直接写入 UTF-8 JSON（如 `{"...`），先识别纯 UTF-8 特征。
      if (body.length >= 2 && body[0] === 0x7b && body[1] >= 0x20 && body[1] <= 0x7e) {
        const utf8 = stripTrailingNulls(decodeUtf8OrLatin1(body));
        if (utf8.startsWith('{')) return utf8;
      }
      const evenLen = body.length - (body.length & 1);
      const slice = evenLen === body.length ? body : body.subarray(0, evenLen);
      let evenZeros = 0, oddZeros = 0;
      const probeLimit = Math.min(slice.length, 256);
      for (let i = 0; i < probeLimit; i += 2) {
        if (slice[i] === 0) evenZeros++;
        if (slice[i + 1] === 0) oddZeros++;
      }
      const primary = evenZeros > oddZeros ? 'utf-16be' : oddZeros > evenZeros ? 'utf-16le' : (tiffLittleEndian ? 'utf-16le' : 'utf-16be');
      const fallback = primary === 'utf-16be' ? 'utf-16le' : 'utf-16be';
      const first = stripTrailingNulls(new TextDecoder(primary).decode(slice));
      if (first.startsWith('{') || first.includes('Steps:')) return first;
      const second = stripTrailingNulls(new TextDecoder(fallback).decode(slice));
      if (second.startsWith('{') || second.includes('Steps:')) return second;
      return first;
    }
    if (prefix === 'ASCII\0\0\0' || prefix === '\0\0\0\0\0\0\0\0') {
      return stripTrailingNulls(decodeUtf8OrLatin1(body));
    }
  }
  return stripTrailingNulls(decodeUtf8OrLatin1(raw));
}

/** 不借助 Canvas 解码 Alpha，避免预乘透明度破坏隐藏位。 */
export async function extractPngMetadata(bytes, { validatePixels = false, collectibleOnly = false } = {}) {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width * height > MAX_STEALTH_IMAGE_PIXELS) throw new Error('图片像素超过上限');
  const candidate = await extractNovelAiMetadataFromPng(Uint8Array.from(bytes).buffer);
  const standard = !collectibleOnly || (candidate && hasCollectibleNaiMetadata(candidate)) ? candidate : null;
  if (standard && !validatePixels) return standard;
  const pixels = await boundedPixelPng(bytes, width, height, validatePixels);
  const decoded = decode(pixels, { checkCrc: true });
  if (standard) return standard;
  const png = decoded.palette?.[0]?.length === 4
    ? { ...decoded, data: convertIndexedToRgb(decoded), channels: 4, depth: 8 } : decoded;
  if (![2, 4].includes(png.channels) || ![8, 16].includes(png.depth)) return null;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba[i * 4 + 3] = png.data[i * png.channels + png.channels - 1] >>> (png.depth === 16 ? 8 : 0);
  return extractNovelAiStealthMetadataFromRgba(rgba, width, height);
}

/** 去掉附加块再解码，避免第三方解码器再次展开不受限的压缩注释／色彩配置。 */
async function boundedPixelPng(bytes, width, height, strict) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept = [bytes.subarray(0, 8)], compressed = [];
  let endSeen = false;
  for (let offset = 8, count = 0; offset + 12 <= bytes.length; count++) {
    if (count > 4096) throw new Error('PNG 块数量异常');
    const size = view.getUint32(offset), end = offset + size + 12;
    if (end > bytes.length) throw new Error('PNG 内容不完整');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!count && (type !== 'IHDR' || size !== 13)) throw new Error('PNG 图片头无效');
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw new Error('暂不收集动画 PNG');
    if (strict) {
      let crc = 0xffffffff;
      for (const value of bytes.subarray(offset + 4, end - 4)) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ value) & 255];
      }
      if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4)) throw new Error('PNG 校验失败');
    }
    if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type)) kept.push(bytes.subarray(offset, end));
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
    offset = end;
  if (type === 'IEND') { endSeen = true; break; }
  }
  if (!endSeen || !compressed.length) throw new Error('PNG 缺少图像内容或结束标记');
  // 先按真实像素容量检查流，不累计解压数据，防止伪造小 IHDR 的压缩炸弹。
  const reader = new Blob(compressed.map(part => Uint8Array.from(part).buffer)).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let expanded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      expanded += value.length;
      if (expanded > width * height * 8 + (width + height) * 8 + 1024) { await reader.cancel(); throw new Error('PNG 像素数据超出声明尺寸'); }
    }
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of kept) { out.set(part, offset); offset += part.length; }
  return out;
}
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const STEALTH_MAGIC = "stealth_pngcomp";
const STEALTH_HEADER_BYTES = STEALTH_MAGIC.length + 4;
const MAX_STEALTH_COMPRESSED_BYTES = 1024 * 1024;
const MAX_STEALTH_DECOMPRESSED_BYTES = 4 * 1024 * 1024;
const MAX_STEALTH_IMAGE_PIXELS = 4e7;
const extractNovelAiMetadataFromPng = async (buffer) => {
  const entries = await readPngTextChunks(buffer);
  return selectNovelAiGenerationMetadata(entries);
};
const extractNovelAiStealthMetadataFromRgba = async (rgba, width, height) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_STEALTH_IMAGE_PIXELS) return null;
  if (rgba.byteLength < pixelCount * 4 || pixelCount < STEALTH_HEADER_BYTES * 8) return null;
  const availableBytes = Math.floor(pixelCount / 8);
  const readByte = (byteOffset) => {
    let value = 0;
    const firstBit = byteOffset * 8;
    for (let bit = 0; bit < 8; bit++) {
      const bitOffset = firstBit + bit;
      const x = Math.floor(bitOffset / height);
      const y = bitOffset % height;
      value = value << 1 | rgba[(y * width + x) * 4 + 3] & 1;
    }
    return value;
  };
  let magic = "";
  for (let i = 0; i < STEALTH_MAGIC.length; i++) magic += String.fromCharCode(readByte(i));
  if (magic !== STEALTH_MAGIC && magic !== 'stealth_pnginfo') return null;
  const lengthOffset = STEALTH_MAGIC.length;
  const payloadBits = readByte(lengthOffset) * 16777216 + readByte(lengthOffset + 1) * 65536 + readByte(lengthOffset + 2) * 256 + readByte(lengthOffset + 3);
  if (payloadBits % 8 !== 0) return null;
  const payloadBytes = payloadBits / 8;
  if (payloadBytes <= 0 || payloadBytes > MAX_STEALTH_COMPRESSED_BYTES || payloadBytes > availableBytes - STEALTH_HEADER_BYTES) return null;
  const compressed = new Uint8Array(payloadBytes);
  for (let i = 0; i < payloadBytes; i++) compressed[i] = readByte(STEALTH_HEADER_BYTES + i);
  try {
    const jsonBytes = magic === 'stealth_pnginfo' ? compressed : await decompressWithLimit(compressed, "gzip", MAX_STEALTH_DECOMPRESSED_BYTES);
    const outerMetadata = new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes);
    return selectNovelAiGenerationMetadata([{ keyword: "Stealth", text: outerMetadata }]);
  } catch {
    return null;
  }
};
const readPngTextChunks = async (buffer) => {
  if (buffer.byteLength < PNG_SIGNATURE.length) return [];
  const bytes = new Uint8Array(buffer);
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return [];
  const view = new DataView(buffer);
  const typeDecoder = new TextDecoder("iso-8859-1");
  const entries = [];
  let offset = PNG_SIGNATURE.length;
  let count = 0, textSize = 0;
  while (offset + 12 <= buffer.byteLength && count++ < 4096) {
    const length = view.getUint32(offset, false);
    const typeOffset = offset + 4;
    const dataOffset = typeOffset + 4;
    const dataEnd = dataOffset + length;
    const chunkEnd = dataEnd + 4;
    if (!Number.isSafeInteger(chunkEnd) || dataEnd < dataOffset || chunkEnd > buffer.byteLength) break;
    const type = typeDecoder.decode(bytes.subarray(typeOffset, dataOffset));
    const chunkData = bytes.subarray(dataOffset, dataEnd);
    try {
      const entry = await decodePngTextChunk(type, chunkData);
      if (entry) {
        textSize += entry.text.length;
        if (textSize > MAX_STEALTH_DECOMPRESSED_BYTES) break;
        entries.push(entry);
      }
    } catch {
    }
    offset = chunkEnd;
    if (type === "IEND") break;
  }
  return entries;
};
const decodePngTextChunk = async (type, data) => {
  if (type !== "tEXt" && type !== "zTXt" && type !== "iTXt") return null;
  if (data.length > MAX_STEALTH_DECOMPRESSED_BYTES) return null;
  const nullIndex = data.indexOf(0);
  if (nullIndex <= 0) return null;
  const keyword = new TextDecoder("iso-8859-1").decode(data.subarray(0, nullIndex));
  if (type === "tEXt") {
    return { keyword, text: decodeUtf8OrLatin1(data.subarray(nullIndex + 1)) };
  }
  if (type === "zTXt") {
    if (data[nullIndex + 1] !== 0) return null;
    const text = await decompressWithLimit(
      data.subarray(nullIndex + 2),
      "deflate",
      MAX_STEALTH_DECOMPRESSED_BYTES
    );
    return { keyword, text: decodeUtf8OrLatin1(text) };
  }
  if (type !== "iTXt" || nullIndex + 3 > data.length) return null;
  const compressionFlag = data[nullIndex + 1];
  const compressionMethod = data[nullIndex + 2];
  if (compressionFlag !== 0 && compressionFlag !== 1 || compressionMethod !== 0) return null;
  const languageEnd = data.indexOf(0, nullIndex + 3);
  if (languageEnd < 0) return null;
  const translatedKeywordEnd = data.indexOf(0, languageEnd + 1);
  if (translatedKeywordEnd < 0) return null;
  const textBytes = data.subarray(translatedKeywordEnd + 1);
  const decoded = compressionFlag === 1 ? await decompressWithLimit(textBytes, "deflate", MAX_STEALTH_DECOMPRESSED_BYTES) : textBytes;
  return { keyword, text: new TextDecoder("utf-8").decode(decoded) };
};
const selectNovelAiGenerationMetadata = (entries) => {
  const source = entries.find((entry) => entry.keyword === "Source")?.text.trim();
  const candidates = entries.filter((entry) => ["Comment", "Description", "Stealth"].includes(entry.keyword)).sort((left, right) => metadataKeywordPriority(left.keyword) - metadataKeywordPriority(right.keyword));
  for (const candidate of candidates) {
    const normalized = normalizeNovelAiMetadataCandidate(candidate.text, source);
    if (normalized) return normalized;
  }
  return null;
};
const metadataKeywordPriority = (keyword) => {
  if (keyword === "Comment") return 0;
  if (keyword === "Stealth") return 1;
  return 2;
};
const normalizeNovelAiMetadataCandidate = (text, inheritedSource, inheritedModel) => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed);
      if (!json || typeof json !== "object" || Array.isArray(json)) return null;
      const source = typeof json.Source === "string" ? json.Source.trim() : typeof json.source === "string" ? json.source.trim() : inheritedSource;
      const model = typeof json.model === "string" ? json.model.trim() : inheritedModel;
      const withSource = (value) => {
        const next = { ...value };
        if (source && typeof next.Source !== "string" && typeof next.source !== "string") next.Source = source;
        if (model && typeof next.model !== "string") next.model = model;
        return JSON.stringify(next);
      };
      const comment = json.Comment ?? json.comment;
      if (comment && typeof comment === "object") {
        return hasNovelAiGenerationFields(comment) ? withSource(comment) : null;
      }
      if (typeof comment === "string") {
        const normalizedComment = normalizeNovelAiMetadataCandidate(comment, source, model);
        if (normalizedComment) return normalizedComment;
      }
      if (hasNovelAiGenerationFields(json)) return withSource(json);
    } catch {
      return null;
    }
  }
  return trimmed.includes("Steps:") ? parseNaiGenerationData(trimmed) : null;
};
const hasNovelAiGenerationFields = (value) => Boolean(
  value.prompt || value.steps || value.v4_prompt || value.v4_negative_prompt || value.uc
);
const decodeUtf8OrLatin1 = (bytes) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("iso-8859-1").decode(bytes);
  }
};
const decompressWithLimit = async (bytes, format, maxBytes) => {
  if (typeof DecompressionStream !== "function") throw new Error("Browser does not support compressed metadata");
  const source = Uint8Array.from(bytes).buffer;
  const stream = new Blob([source]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Decompressed metadata is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};
const parseNaiGenerationData = (text) => {
  if (text.trim().startsWith("{")) {
    try {
      const json = JSON.parse(text);
      if (json.prompt || json.steps || json.v4_prompt) {
        return text;
      }
    } catch (e) {
    }
  }
  return text;
};
export {
  extractNovelAiMetadataFromPng,
  extractNovelAiStealthMetadataFromRgba
};
