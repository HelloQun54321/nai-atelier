/**
 * PNG/JPEG/WebP 真实尺寸解析（纯 JS，Worker 与 node 测试共用）。
 *
 * 不依赖文件扩展名或调用方声明，只从图片字节结构中读取真实宽高：
 * - PNG：IHDR 块中的大端 width/height；
 * - JPEG：遍历合法段，在 SOF0-15 中读取 height/width；
 * - WebP：覆盖 VP8（有损）、VP8L（无损）、VP8X（扩展）三种子格式。
 *
 * 所有读取都做边界检查；拒绝 0、负数、异常巨大或解析失败的尺寸。
 */

const MAX_DIMENSION = 65536;

/**
 * @param {Uint8Array} bytes
 * @param {'png' | 'jpg' | 'webp'} format
 * @returns {{ width: number, height: number }}
 */
export function readImageDimensions(bytes, format) {
  if (format === 'png') return readPng(bytes);
  if (format === 'webp') return readWebp(bytes);
  if (format === 'jpg') return readJpeg(bytes);
  throw new Error('不支持的图片格式');
}

/** @param {number} width @param {number} height */
function normalizeSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error('图片尺寸无效');
  if (width <= 0 || height <= 0) throw new Error('图片尺寸无效');
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) throw new Error('图片尺寸异常过大');
  return { width, height };
}

function readUint32BE(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readUint16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

/** @param {Uint8Array} bytes */
function readPng(bytes) {
  if (bytes.length < 24) throw new Error('PNG 数据不完整');
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (!isPng) throw new Error('PNG 签名无效');
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    throw new Error('PNG 缺少 IHDR');
  }
  return normalizeSize(readUint32BE(bytes, 16), readUint32BE(bytes, 20));
}

/** SOF0-15（排除 DHT C4、JPG C8、DAC CC） */
function isSofMarker(marker) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** @param {Uint8Array} bytes */
function readJpeg(bytes) {
  if (bytes.length < 4) throw new Error('JPEG 数据不完整');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('JPEG 签名无效');
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('JPEG 段解析失败');
    const marker = bytes[offset + 1];
    if (marker === 0xff) { offset += 1; continue; }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = readUint16BE(bytes, offset + 2);
    if (length < 2) throw new Error('JPEG 段长度无效');
    if (isSofMarker(marker)) {
      if (offset + 9 > bytes.length) throw new Error('JPEG SOF 数据不完整');
      return normalizeSize(readUint16BE(bytes, offset + 7), readUint16BE(bytes, offset + 5));
    }
    offset += 2 + length;
  }
  throw new Error('JPEG 中未找到尺寸信息');
}

const ascii = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));

/** @param {Uint8Array} bytes */
function readWebp(bytes) {
  if (bytes.length < 12) throw new Error('WebP 数据不完整');
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') throw new Error('WebP 签名无效');
  const tag = ascii(bytes, 12, 4);
  if (tag === 'VP8 ') {
    // 有损：帧头 0x9D 01 2A 后为 3 字节宽、3 字节高（小端，各取低 14 位）
    if (bytes.length < 29) throw new Error('WebP VP8 数据不完整');
    if (bytes[20] !== 0x9d || bytes[21] !== 0x01 || bytes[22] !== 0x2a) throw new Error('WebP VP8 帧头无效');
    const width = ((bytes[23] | (bytes[24] << 8) | (bytes[25] << 16)) & 0x3fff) >>> 0;
    const height = ((bytes[26] | (bytes[27] << 8) | (bytes[28] << 16)) & 0x3fff) >>> 0;
    return normalizeSize(width, height);
  }
  if (tag === 'VP8L') {
    // 无损：0x2F 签名后 4 字节位流：低 14 位宽、次 14 位高（各 +1）
    if (bytes.length < 25 || bytes[20] !== 0x2f) throw new Error('WebP VP8L 头无效');
    const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
    return normalizeSize((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (tag === 'VP8X') {
    // 扩展：flags 后 3 字节画布宽-1、3 字节画布高-1（小端）
    if (bytes.length < 30) throw new Error('WebP VP8X 数据不完整');
    const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    return normalizeSize(width, height);
  }
  throw new Error('未知的 WebP 子格式');
}
