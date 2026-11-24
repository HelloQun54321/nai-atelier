import { extractImageMetadata, extractNovelAiMetadataFromPng, extractPngMetadata, extractWebpExifPayload } from './pngMetadata.mjs';

export interface ZipEntryRecord {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dataOffset?: number;
}

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const LOCAL_HEADER_SIG = 0x04034b50;
const MAX_EOCD_SEARCH = 65535 + 22;
const MAX_CD_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 50_000;
const MAX_META_CHUNK_BYTES = 4 * 1024 * 1024;

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('iso-8859-1');

const decodeName = (bytes: Uint8Array, utf8Flag: boolean): string => {
  if (utf8Flag) {
    try { return utf8Strict.decode(bytes); } catch { /* fall through */ }
  }
  try { return utf8Strict.decode(bytes); } catch { return latin1.decode(bytes); }
};

const readUint64Safe = (view: DataView, offset: number): number => {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  const value = high * 4294967296 + low;
  if (!Number.isSafeInteger(value)) throw new Error('ZIP 文件偏移超出安全范围');
  return value;
};

/** 归一化 ZIP 条目路径，过滤目录项、macOS 辅助文件与越权相对路径。 */
function normalizeEntryName(raw: string): string | null {
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.endsWith('/')) return null;
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  if (parts[0] === '__MACOSX' || parts[parts.length - 1].startsWith('._')) return null;
  return normalized;
}

/** 快速检测是否为 ZIP 容器魔数。 */
export async function isZipBlob(blob: Blob): Promise<boolean> {
  if (blob.size < 22) return false;
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b
    && ((head[2] === 0x03 && head[3] === 0x04) || (head[2] === 0x05 && head[3] === 0x06) || (head[2] === 0x07 && head[3] === 0x08));
}

/** 仅读取末尾目录表（支持 ZIP64），不把整个压缩包读入内存。 */
export async function listZipEntries(file: Blob): Promise<ZipEntryRecord[]> {
  if (file.size < 22) throw new Error('ZIP 文件不完整');
  const tailSize = Math.min(file.size, MAX_EOCD_SEARCH);
  const tailOffset = file.size - tailSize;
  const tail = new Uint8Array(await file.slice(tailOffset, file.size).arrayBuffer());
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  let eocdPos = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === EOCD_SIG) {
      const commentLength = tailView.getUint16(i + 20, true);
      if (i + 22 + commentLength === tail.length) {
        eocdPos = i;
        break;
      }
    }
  }
  if (eocdPos < 0) throw new Error('ZIP 目录表无效或已损坏');

  let entryCount = tailView.getUint16(eocdPos + 10, true);
  let cdSize = tailView.getUint32(eocdPos + 12, true);
  let cdOffset = tailView.getUint32(eocdPos + 16, true);

  // 处理 ZIP64 EOCD
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locatorFileOffset = tailOffset + eocdPos - 20;
    if (locatorFileOffset < 0) throw new Error('ZIP64 定位表无效');
    const locatorBytes = new Uint8Array(await file.slice(locatorFileOffset, locatorFileOffset + 20).arrayBuffer());
    const locatorView = new DataView(locatorBytes.buffer);
    if (locatorView.getUint32(0, true) !== ZIP64_LOCATOR_SIG) throw new Error('ZIP64 定位表损坏');
    const zip64Offset = readUint64Safe(locatorView, 8);
    if (zip64Offset + 56 > file.size) throw new Error('ZIP64 目录偏移越界');
    const zip64Bytes = new Uint8Array(await file.slice(zip64Offset, zip64Offset + 56).arrayBuffer());
    const zip64View = new DataView(zip64Bytes.buffer);
    if (zip64View.getUint32(0, true) !== ZIP64_EOCD_SIG) throw new Error('ZIP64 目录头损坏');
    entryCount = readUint64Safe(zip64View, 32);
    cdSize = readUint64Safe(zip64View, 40);
    cdOffset = readUint64Safe(zip64View, 48);
  }

  if (entryCount > MAX_ENTRIES) throw new Error('ZIP 条目数量超过上限');
  if (cdSize > MAX_CD_BYTES || cdOffset + cdSize > file.size) throw new Error('ZIP 目录表大小无效');

  const cdBytes = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const cdView = new DataView(cdBytes.buffer, cdBytes.byteOffset, cdBytes.byteLength);
  const entries: ZipEntryRecord[] = [];
  let offset = 0;

  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > cdBytes.length || cdView.getUint32(offset, true) !== CENTRAL_DIR_SIG) {
      throw new Error('ZIP 目录条目已损坏');
    }
    const flags = cdView.getUint16(offset + 8, true);
    const compressionMethod = cdView.getUint16(offset + 10, true);
    let compressedSize = cdView.getUint32(offset + 20, true);
    let uncompressedSize = cdView.getUint32(offset + 24, true);
    const nameLen = cdView.getUint16(offset + 28, true);
    const extraLen = cdView.getUint16(offset + 30, true);
    const commentLen = cdView.getUint16(offset + 32, true);
    let localHeaderOffset = cdView.getUint32(offset + 42, true);
    const nameEnd = offset + 46 + nameLen;
    const extraEnd = nameEnd + extraLen;
    const nextOffset = extraEnd + commentLen;
    if (nextOffset > cdBytes.length) throw new Error('ZIP 目录条目越界');

    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      let extraPos = nameEnd;
      while (extraPos + 4 <= extraEnd) {
        const headerId = cdView.getUint16(extraPos, true);
        const dataSize = cdView.getUint16(extraPos + 2, true);
        const fieldEnd = extraPos + 4 + dataSize;
        if (fieldEnd > extraEnd) break;
        if (headerId === 0x0001) {
          let cursor = extraPos + 4;
          if (uncompressedSize === 0xffffffff && cursor + 8 <= fieldEnd) { uncompressedSize = readUint64Safe(cdView, cursor); cursor += 8; }
          if (compressedSize === 0xffffffff && cursor + 8 <= fieldEnd) { compressedSize = readUint64Safe(cdView, cursor); cursor += 8; }
          if (localHeaderOffset === 0xffffffff && cursor + 8 <= fieldEnd) { localHeaderOffset = readUint64Safe(cdView, cursor); }
          break;
        }
        extraPos = fieldEnd;
      }
    }

    const rawName = decodeName(cdBytes.subarray(offset + 46, nameEnd), Boolean(flags & 0x0800));
    const name = normalizeEntryName(rawName);
    // 跳过加密条目与目录项
    if (name && !(flags & 0x0001)) {
      entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    }
    offset = nextOffset;
  }

  return entries;
}

/** 读取 Local File Header 计算条目数据体真实起始偏移并缓存。 */
export async function resolveZipEntryDataOffset(file: Blob, entry: ZipEntryRecord): Promise<number> {
  if (entry.dataOffset !== undefined) return entry.dataOffset;
  if (entry.localHeaderOffset + 30 > file.size) throw new Error('ZIP 条目头偏移越界');
  const header = new Uint8Array(await file.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).arrayBuffer());
  const view = new DataView(header.buffer);
  if (view.getUint32(0, true) !== LOCAL_HEADER_SIG) throw new Error('ZIP 条目头签名无效');
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const dataOffset = entry.localHeaderOffset + 30 + nameLen + extraLen;
  if (dataOffset + entry.compressedSize > file.size) throw new Error('ZIP 条目数据长度越界');
  entry.dataOffset = dataOffset;
  return dataOffset;
}

async function inflateRawBounded(blob: Blob, maxBytes: number): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') throw new Error('当前环境不支持解压 DEFLATE 压缩条目');
  const reader = blob.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('ZIP 条目解压体积超过上限');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** 按上限读取单个 ZIP 条目的完整解压字节。 */
export async function readZipEntryBytes(file: Blob, entry: ZipEntryRecord, maxBytes: number): Promise<Uint8Array> {
  if (entry.uncompressedSize > maxBytes) throw new Error('ZIP 条目体积超过读取上限');
  const dataOffset = await resolveZipEntryDataOffset(file, entry);
  const slice = file.slice(dataOffset, dataOffset + entry.compressedSize);
  if (entry.compressionMethod === 0) {
    return new Uint8Array(await slice.arrayBuffer());
  }
  if (entry.compressionMethod === 8) {
    return inflateRawBounded(slice, maxBytes);
  }
  throw new Error(`暂不支持的 ZIP 压缩方式 (${entry.compressionMethod})`);
}

/** 按上限读取单个 ZIP 条目为 Blob；未压缩条目零拷贝直接切片。 */
export async function readZipEntryBlob(file: Blob, entry: ZipEntryRecord, mime: string, maxBytes: number): Promise<Blob> {
  if (entry.uncompressedSize > maxBytes) throw new Error('ZIP 条目体积超过读取上限');
  const dataOffset = await resolveZipEntryDataOffset(file, entry);
  if (entry.compressionMethod === 0) {
    return file.slice(dataOffset, dataOffset + entry.compressedSize, mime);
  }
  const bytes = await readZipEntryBytes(file, entry, maxBytes);
  return new Blob([Uint8Array.from(bytes).buffer], { type: mime });
}

/**
 * 针对 ZIP_STORED WebP 跳读 RIFF 块头，只把 EXIF 块读入内存，避免扫描数千张图时读入数百 MB 像素数据。
 */
async function extractStoredWebpMetadata(slice: Blob): Promise<string | null> {
  if (slice.size < 20) return null;
  let offset = 12;
  let count = 0;
  while (offset + 8 <= slice.size && count++ < 512) {
    const chunkHead = new Uint8Array(await slice.slice(offset, offset + 8).arrayBuffer());
    const type = String.fromCharCode(chunkHead[0], chunkHead[1], chunkHead[2], chunkHead[3]);
    const size = new DataView(chunkHead.buffer).getUint32(4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > slice.size) break;
    if (type === 'EXIF') {
      if (size === 0 || size > MAX_META_CHUNK_BYTES) return null;
      // 构造极简 RIFF WEBP + EXIF 壳，复用统一 EXIF 解码逻辑
      const exif = new Uint8Array(await slice.slice(dataStart, dataEnd).arrayBuffer());
      const wrapper = new Uint8Array(20 + exif.length);
      wrapper.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x45, 0x58, 0x49, 0x46]);
      new DataView(wrapper.buffer).setUint32(4, 12 + exif.length, true);
      new DataView(wrapper.buffer).setUint32(16, exif.length, true);
      wrapper.set(exif, 20);
      return extractImageMetadata(wrapper);
    }
    offset = dataEnd + (size & 1);
  }
  return null;
}

/**
 * 针对 ZIP_STORED PNG 优先跳读文本块；若不含文本块且体积安全，再读取整张探测 Stealth 元数据。
 */
async function extractStoredPngMetadata(slice: Blob, maxFullBytes: number): Promise<string | null> {
  if (slice.size < 33) return null;
  const headerChunks: Uint8Array[] = [new Uint8Array(await slice.slice(0, 8).arrayBuffer())];
  let offset = 8;
  let count = 0;
  let metaBytes = 0;
  let hasTextChunk = false;
  while (offset + 12 <= slice.size && count++ < 4096) {
    const chunkHead = new Uint8Array(await slice.slice(offset, offset + 8).arrayBuffer());
    const length = new DataView(chunkHead.buffer).getUint32(0, false);
    const type = String.fromCharCode(chunkHead[4], chunkHead[5], chunkHead[6], chunkHead[7]);
    const chunkEnd = offset + 12 + length;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > slice.size) break;
    if (type === 'IHDR' || type === 'IEND' || type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
        metaBytes += length;
        if (metaBytes > MAX_META_CHUNK_BYTES) break;
        hasTextChunk = true;
      }
      headerChunks.push(new Uint8Array(await slice.slice(offset, chunkEnd).arrayBuffer()));
    }
    offset = chunkEnd;
    if (type === 'IEND') break;
  }
  if (hasTextChunk) {
    const total = headerChunks.reduce((sum, part) => sum + part.length, 0);
    const synthetic = new Uint8Array(total);
    let pos = 0;
    for (const part of headerChunks) { synthetic.set(part, pos); pos += part.length; }
    const direct = await extractNovelAiMetadataFromPng(synthetic.buffer);
    if (direct) return direct;
  }
  if (slice.size <= maxFullBytes) {
    const full = new Uint8Array(await slice.arrayBuffer());
    return extractPngMetadata(full);
  }
  return null;
}

/** 探测图片 MIME 与宽高（只读前 32 字节或 JPEG 段头）。 */
export async function inspectImageHeader(slice: Blob): Promise<{ mime: 'image/png' | 'image/webp' | 'image/jpeg'; width: number; height: number } | null> {
  if (slice.size < 16) return null;
  const bytes = new Uint8Array(await slice.slice(0, 32).arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes.length >= 24) {
    const width = view.getUint32(16), height = view.getUint32(20);
    return width > 0 && height > 0 ? { mime: 'image/png', width, height } : null;
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 && bytes.length >= 30) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    let width = 0, height = 0;
    if (chunk === 'VP8X') {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (chunk === 'VP8 ') {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (chunk === 'VP8L') {
      width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0xf) << 10);
    }
    return width > 0 && height > 0 ? { mime: 'image/webp', width, height } : null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    for (let count = 0; count < 2048 && offset + 4 <= slice.size; count++) {
      const part = new Uint8Array(await slice.slice(offset, offset + 9).arrayBuffer());
      if (part[0] !== 0xff) break;
      const marker = part[1];
      if (marker === 0xff) { offset++; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      const length = (part[2] << 8) | part[3];
      if (length < 2) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && part.length >= 9) {
        const height = (part[5] << 8) | part[6];
        const width = (part[7] << 8) | part[8];
        return width > 0 && height > 0 ? { mime: 'image/jpeg', width, height } : null;
      }
      offset += 2 + length;
    }
  }
  return null;
}

/** 从 ZIP 中的图片条目提取 MIME、尺寸与 NovelAI 原始元数据。 */
export async function inspectZipImageMetadata(
  file: Blob,
  entry: ZipEntryRecord,
  maxImageBytes: number,
): Promise<{ mime: 'image/png' | 'image/webp' | 'image/jpeg'; width: number; height: number; rawMetadata: string | null } | null> {
  if (entry.uncompressedSize <= 0 || entry.uncompressedSize > maxImageBytes) return null;
  const dataOffset = await resolveZipEntryDataOffset(file, entry);
  if (entry.compressionMethod === 0) {
    const slice = file.slice(dataOffset, dataOffset + entry.compressedSize);
    const info = await inspectImageHeader(slice);
    if (!info || info.width * info.height > 40_000_000) return null;
    let rawMetadata: string | null = null;
    if (info.mime === 'image/webp') {
      rawMetadata = await extractStoredWebpMetadata(slice);
    } else if (info.mime === 'image/png') {
      rawMetadata = await extractStoredPngMetadata(slice, maxImageBytes);
    } else {
      const full = new Uint8Array(await slice.arrayBuffer());
      rawMetadata = await extractImageMetadata(full);
    }
    return { ...info, rawMetadata };
  }
  if (entry.compressionMethod === 8) {
    const bytes = await readZipEntryBytes(file, entry, maxImageBytes);
    const blob = new Blob([Uint8Array.from(bytes).buffer]);
    const info = await inspectImageHeader(blob);
    if (!info || info.width * info.height > 40_000_000) return null;
    const rawMetadata = await extractImageMetadata(bytes);
    return { ...info, rawMetadata };
  }
  return null;
}

export { extractWebpExifPayload };
