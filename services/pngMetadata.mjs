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
const normalizeNovelAiMetadataCandidate = (text, inheritedSource) => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed);
      if (!json || typeof json !== "object" || Array.isArray(json)) return null;
      const source = typeof json.Source === "string" ? json.Source.trim() : typeof json.source === "string" ? json.source.trim() : inheritedSource;
      const withSource = (value) => JSON.stringify(
        source && typeof value.Source !== "string" && typeof value.source !== "string" ? { ...value, Source: source } : value
      );
      const comment = json.Comment ?? json.comment;
      if (comment && typeof comment === "object") {
        return hasNovelAiGenerationFields(comment) ? withSource(comment) : null;
      }
      if (typeof comment === "string") {
        const normalizedComment = normalizeNovelAiMetadataCandidate(comment, source);
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
