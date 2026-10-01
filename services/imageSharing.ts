import { useEffect, useState } from 'react';
import { beginImageClipboardCopy, rememberCopiedImage, type ImageGenerationData } from './imageClipboardContext';

export const IMAGE_SHARING_STORAGE_KEY = 'nai_clean_shared_images';
const CHANGE_EVENT = 'nai-image-sharing-changed';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
// 只保留像素、透明度及色彩解释所需块；未知附加块不带入分享副本。
const PIXEL_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
const COLOR_CHUNKS = new Set(['cHRM', 'gAMA', 'iCCP', 'sRGB', 'cICP', 'sBIT']);
const MAX_PIXELS = 40_000_000;

export const getCleanSharedImages = () => {
  try { return localStorage.getItem(IMAGE_SHARING_STORAGE_KEY) === 'true'; }
  catch { return false; }
};

export const setCleanSharedImages = (enabled: boolean) => {
  localStorage.setItem(IMAGE_SHARING_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const useCleanSharedImages = () => {
  const [enabled, setEnabled] = useState(getCleanSharedImages);
  useEffect(() => {
    const update = () => setEnabled(getCleanSharedImages());
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return enabled;
};

const isPng = (bytes: Uint8Array) => PNG_SIGNATURE.every((value, index) => bytes[index] === value);
const concat = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};

const readPngChunks = (bytes: Uint8Array) => {
  if (!isPng(bytes)) throw new Error('PNG 图片格式无效');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: { type: string; bytes: Uint8Array }[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + length + 12;
    if (end > bytes.length) throw new Error('PNG 图片内容不完整');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!chunks.length && (type !== 'IHDR' || length !== 13)) throw new Error('PNG 图片头无效');
    chunks.push({ type, bytes: bytes.slice(offset, end) });
    offset = end;
    if (type === 'IEND') return chunks; // 丢弃文件结束块后的任意附带内容。
  }
  throw new Error('PNG 图片缺少结束标记');
};

/** 创建独立 PNG 分享副本；无隐藏数据时原样保留像素流和色彩配置。 */
export const cleanPngForSharing = async (source: Uint8Array): Promise<Uint8Array> => {
  const chunks = readPngChunks(source);
  const header = new DataView(chunks[0].bytes.buffer);
  const width = header.getUint32(8);
  const height = header.getUint32(12);
  if (!width || !height || width * height > MAX_PIXELS) throw new Error('图片过大，无法安全创建分享副本');
  if (chunks.some(chunk => ['acTL', 'fcTL', 'fdAT'].includes(chunk.type))) throw new Error('暂不支持清洗动画 PNG，请下载原图');
  const signature = source.slice(0, 8);
  const kept = chunks.filter(chunk => PIXEL_CHUNKS.has(chunk.type) || COLOR_CHUNKS.has(chunk.type));
  const stripped = concat([signature, ...kept.map(chunk => chunk.bytes)]);
  const { decode, encode, convertIndexedToRgb } = await import('fast-png');
  const decoded = decode(stripped, { checkCrc: true });
  const png = decoded.palette?.[0]?.length === 4
    ? { ...decoded, data: convertIndexedToRgb(decoded), channels: 4, depth: 8 as const }
    : decoded;
  // NovelAI 隐藏参数按 x 优先顺序编码在 Alpha 最低位。也识别未压缩的 stealth_pnginfo。
  // 普通透明图片不改 Alpha；仅确认隐藏头后抹掉该通道载荷，保留 RGB 和透明背景。
  const magicLength = 'stealth_pngcomp'.length;
  if ((png.channels === 4 || png.channels === 2) && (png.depth === 8 || png.depth === 16) && width * height >= magicLength * 8) {
    const alpha = png.channels - 1;
    const shift = png.depth === 16 ? 8 : 0;
    let magic = '';
    for (let byte = 0; byte < magicLength; byte++) {
      let value = 0;
      for (let bit = 0; bit < 8; bit++) {
        const index = byte * 8 + bit;
        const x = Math.floor(index / height);
        const y = index % height;
        value = (value << 1) | ((png.data[(y * width + x) * png.channels + alpha] >>> shift) & 1);
      }
      magic += String.fromCharCode(value);
    }
    if (magic === 'stealth_pngcomp' || magic === 'stealth_pnginfo') {
      const data = png.data.slice();
      const max = png.depth === 16 ? 65535 : 255;
      const mask = 1 << shift;
      for (let index = alpha; index < data.length; index += png.channels) {
        // 将近乎不透明像素统一恢复为全不透明；其余透明度最多变化一个 8 位刻度。
        data[index] = data[index] >= max - mask ? max : data[index] & ~mask;
      }
      const encoded = readPngChunks(encode({ width, height, data, depth: png.depth, channels: png.channels }));
      return concat([signature, encoded[0].bytes, ...kept.filter(chunk => COLOR_CHUNKS.has(chunk.type) && !(decoded.palette && chunk.type === 'sBIT')).map(chunk => chunk.bytes), ...encoded.slice(1).map(chunk => chunk.bytes)]);
    }
  }
  return stripped;
};

const readImage = async (source: string) => {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`读取图片失败 (${response.status})`);
  return response.blob();
};

/** 非 PNG 图片复制／清洗时转为 PNG，浏览器负责应用原始方向与色彩配置。 */
const convertToPng = async (blob: Blob): Promise<Blob> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (isPng(bytes)) return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > MAX_PIXELS) throw new Error('图片过大，无法创建分享副本');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法处理图片');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('图片转换失败')), 'image/png',
    ));
  } finally { bitmap.close(); }
};

const prepareImageBlob = async (original: Blob, clean: boolean, pngRequired: boolean) => {
  if (!clean && !pngRequired) return original;
  const png = await convertToPng(original);
  if (!clean) return png.type === 'image/png' ? png : new Blob([await png.arrayBuffer()], { type: 'image/png' });
  const cleaned = await cleanPngForSharing(new Uint8Array(await png.arrayBuffer()));
  return new Blob([cleaned.slice().buffer], { type: 'image/png' });
};

const prepareImage = async (source: string, clean: boolean, pngRequired: boolean) => prepareImageBlob(await readImage(source), clean, pngRequired);

export const imageSharingFilename = (filename: string, blob: Blob, clean: boolean) => {
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
  const name = filename.replace(/\.[^.]+$/, '') || 'NAI';
  return `${name}${clean ? '-分享版' : ''}.${extension}`;
};

export const downloadSharedImage = async (source: string, filename: string, clean = getCleanSharedImages()) => {
  const blob = await prepareImage(source, clean, false);
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = imageSharingFilename(filename, blob, clean);
    document.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
  } finally {
    // 移动浏览器需要时间接管下载，不能在 click 后立即撤销。
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

export const copySharedImage = async (source: string, clean = getCleanSharedImages(), data?: ImageGenerationData) => {
  if (window.isSecureContext === false || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('当前浏览器无法复制图片，请使用电脑 localhost／HTTPS 打开，或下载后发送');
  }
  // 同步提交 ClipboardItem，异步读取图片留在 Promise 内，保留 Safari 的点击授权。
  const copyRevision = beginImageClipboardCopy();
  const original = readImage(source);
  const png = original.then(blob => prepareImageBlob(blob, clean, true));
  void png.catch(() => {}); // 浏览器拒绝剪贴板时仍接住尚未完成的图片读取错误。
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    await rememberCopiedImage(copyRevision, await png, await original, data);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') throw new Error('浏览器未允许复制图片，请允许剪贴板访问后重试，或下载后发送');
    throw error;
  }
};
