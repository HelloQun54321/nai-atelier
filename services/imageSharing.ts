import { useEffect, useState } from 'react';
import { beginImageClipboardCopy, rememberCopiedImage, type ImageGenerationData } from './imageClipboardContext';
import { extractNovelAiMetadataFromPng, extractNovelAiStealthMetadataFromRgba } from './pngMetadata.mjs';
import { beginExportTarget, saveExportBlob } from './exportLocation';

export const IMAGE_SHARING_STORAGE_KEY = 'nai_clean_shared_images';
export const IMAGE_SHARING_TEXT_STORAGE_KEY = 'nai_shared_image_custom_text';
export type SharedImageCleanContent = 'all' | 'prompts';
export const IMAGE_SHARING_CONTENT_STORAGE_KEY = 'nai_shared_image_clean_content';
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

export const getSharedImageCustomText = () => {
  try { return localStorage.getItem(IMAGE_SHARING_TEXT_STORAGE_KEY) ?? ''; }
  catch { return ''; }
};

export const setSharedImageCustomText = (text: string) => {
  localStorage.setItem(IMAGE_SHARING_TEXT_STORAGE_KEY, text);
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const getSharedImageCleanContent = (): SharedImageCleanContent => {
  try { return localStorage.getItem(IMAGE_SHARING_CONTENT_STORAGE_KEY) === 'prompts' ? 'prompts' : 'all'; }
  catch { return 'all'; }
};

export const setSharedImageCleanContent = (value: SharedImageCleanContent) => {
  localStorage.setItem(IMAGE_SHARING_CONTENT_STORAGE_KEY, value);
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const useSharedImageCleanContent = () => {
  const [content, setContent] = useState(getSharedImageCleanContent);
  useEffect(() => {
    const update = () => setContent(getSharedImageCleanContent());
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return content;
};

export const useSharedImageCustomText = () => {
  const [text, setText] = useState(getSharedImageCustomText);
  useEffect(() => {
    const update = () => setText(getSharedImageCustomText());
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return text;
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

const sharingTextChunks = (text: string, parameters: Record<string, unknown>) => {
  if (text.includes('\0')) throw new Error('自定义图片文本不能包含空字符');
  const entries: string[][] = [];
  if (text.trim()) { entries.push(['Description', text]); parameters.prompt = text; }
  if (Object.keys(parameters).length) entries.push(['Comment', JSON.stringify(parameters)]);
  const encoder = new TextEncoder();
  return entries.map(([keyword, value]) => {
    const data = concat([encoder.encode(keyword), new Uint8Array(5), encoder.encode(value)]);
    const chunk = new Uint8Array(data.length + 12);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set(encoder.encode('iTXt'), 4);
    chunk.set(data, 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, chunk.length - 4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
    return chunk;
  });
};

// 只重建已知参数，不携带未知文本、提示词、参考原料或原签名；缺失项不补默认值。
const sharingParameters = (rawSources: (string | null)[]) => {
  const sources: Record<string, unknown>[] = [];
  for (const raw of rawSources) {
    try {
      const value = JSON.parse(raw ?? 'null');
      if (value && typeof value === 'object' && !Array.isArray(value)) sources.push(value);
    } catch {
      if (!raw?.includes('Steps:')) continue;
      const value: Record<string, unknown> = {};
      const parameters = raw.slice(raw.indexOf('Steps:'));
      for (const [label, key] of [['Steps', 'steps'], ['CFG scale', 'scale'], ['Seed', 'seed']]) {
        const match = parameters.match(new RegExp(`${label}:\\s*([^,]+)`));
        if (match && match[1].trim() && Number.isFinite(Number(match[1]))) value[key] = Number(match[1]);
      }
      const sampler = parameters.match(/Sampler:\s*([^,]+)/)?.[1].trim();
      if (sampler) value.sampler = sampler;
      const size = parameters.match(/Size:\s*(\d+)x(\d+)/);
      if (size) { value.width = Number(size[1]); value.height = Number(size[2]); }
      sources.push(value);
    }
  }
  const pick = (records: Record<string, unknown>[], keys: string[], valid: (value: unknown) => boolean) => {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const record = records.find(source => Object.hasOwn(source, key) && valid(source[key]));
      if (record) result[key] = record[key];
    }
    return result;
  };
  const numeric = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));
  const flag = (value: unknown) => value === null || typeof value === 'boolean';
  const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const result = pick(sources, ['width', 'height', 'steps', 'seed', 'scale', 'cfg_rescale', 'cfgRescale', 'uncond_scale', 'n_samples', 'params_version', 'strength', 'noise', 'extra_noise_seed', 'skip_cfg_above_sigma', 'skip_cfg_below_sigma', 'dynamic_thresholding_percentile', 'dynamic_thresholding_mimic_scale', 'controlnet_strength', 'inpaint_width', 'inpaint_height', 'inpaint_strength', 'inpaint_noise', 'inpaintImg2ImgStrength', 'transparentWeight', 'ucPreset'], numeric);
  Object.assign(result, pick(sources, ['sm', 'sm_dyn', 'dynamic_thresholding', 'hide_debug_overlay', 'legacy', 'legacy_v3_extend', 'add_original_image', 'deliberate_euler_ancestral_bug', 'prefer_brownian', 'tag_hint_transparent_background', 'transparent', 'straight_alpha', 'use_coords', 'useCoords', 'use_order', 'variety', 'qualityToggle', 'normalize_reference_strength_multiple', 'image_normalize', 'color_correct'], flag));
  Object.assign(result, pick(sources, ['sampler', 'noise_schedule', 'Source', 'source', 'model', 'model_name', 'model_hash', 'model_version', 'alphaMode', 'qualityPresetId', 'ucPresetId', 'controlnet_model', 'request_type'], value => value === null || typeof value === 'string'));
  Object.assign(result, pick(sources, ['lora_unet_weights', 'lora_clip_weights'], value => value === null));
  Object.assign(result, pick(sources, ['reference_information_extracted_multiple', 'reference_strength_multiple', 'reference_fidelity_multiple'], value => Array.isArray(value) && value.every(numeric)));
  for (const key of ['v4_prompt', 'v4_negative_prompt', 'v5_prompt', 'v5_negative_prompt']) {
    const prompts = sources.map(source => source[key]).filter(object);
    const structured = pick(prompts, ['use_coords', 'use_order', 'legacy_uc'], flag);
    const captions = prompts.map(prompt => prompt.caption).filter(object);
    const characters = captions.map(caption => caption.char_captions).filter(Array.isArray);
    if (characters.length) {
      const slots = Array.from({ length: Math.max(...characters.map(list => list.length)) }, (_, index) => {
        const values = characters.map(list => list[index]).filter(object);
        const centers = values.map(value => value.centers).find(Array.isArray);
        return centers ? { centers: centers.filter(object).map(center => pick([center], ['x', 'y'], numeric)) } : {};
      });
      structured.caption = { char_captions: slots };
    }
    if (Object.keys(structured).length) result[key] = structured;
  }
  const characters = sources.map(source => source.characters).find(Array.isArray);
  if (characters) result.characters = characters.filter(object).map(character => ({ ...pick([character], ['x', 'y'], numeric), ...pick([character], ['enabled'], flag) }));
  const imageToImage = sources.map(source => source.img2img).filter(object);
  const edit = { ...pick(imageToImage, ['strength', 'noise'], numeric), ...pick(imageToImage, ['color_correct'], flag) };
  if (Object.keys(edit).length) result.img2img = edit;
  return result;
};

/** 创建独立 PNG 分享副本；自定义文本只从用户输入新建，不继承原信息。 */
export const cleanPngForSharing = async (source: Uint8Array, customText = '', content: SharedImageCleanContent = 'all'): Promise<Uint8Array> => {
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
  let parameters: Record<string, unknown> = {};
  if (content === 'prompts') {
    let hidden: string | null = null;
    if ((png.channels === 4 || png.channels === 2) && (png.depth === 8 || png.depth === 16)) {
      const rgba = png.channels === 4 && png.depth === 8 ? png.data as Uint8Array : new Uint8Array(width * height * 4);
      if (rgba !== png.data) {
        for (let index = 0; index < width * height; index++) rgba[index * 4 + 3] = png.data[index * png.channels + png.channels - 1] >>> (png.depth === 16 ? 8 : 0);
      }
      hidden = await extractNovelAiStealthMetadataFromRgba(rgba, width, height);
    }
    parameters = sharingParameters([await extractNovelAiMetadataFromPng(source.slice().buffer), hidden]);
  }
  const textChunks = sharingTextChunks(customText, parameters);
  const appendText = (cleaned: Uint8Array) => textChunks.length
    ? concat([cleaned.slice(0, -12), ...textChunks, cleaned.slice(-12)]) : cleaned;
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
      return appendText(concat([signature, encoded[0].bytes, ...kept.filter(chunk => COLOR_CHUNKS.has(chunk.type) && !(decoded.palette && chunk.type === 'sBIT')).map(chunk => chunk.bytes), ...encoded.slice(1).map(chunk => chunk.bytes)]));
    }
  }
  return appendText(stripped);
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

export const prepareImageBlob = async (original: Blob, clean: boolean, pngRequired: boolean, customText: string, content: SharedImageCleanContent) => {
  if (!clean && !pngRequired) return original;
  const png = await convertToPng(original);
  if (!clean) return png.type === 'image/png' ? png : new Blob([await png.arrayBuffer()], { type: 'image/png' });
  const cleaned = await cleanPngForSharing(new Uint8Array(await png.arrayBuffer()), customText, content);
  return new Blob([cleaned.slice().buffer], { type: 'image/png' });
};

const prepareImage = async (source: string, clean: boolean, pngRequired: boolean, customText: string, content: SharedImageCleanContent) => prepareImageBlob(await readImage(source), clean, pngRequired, customText, content);

export const imageSharingFilename = (filename: string, blob: Blob, clean: boolean) => {
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
  const name = filename.replace(/\.[^.]+$/, '') || 'NAI';
  return `${name}${clean ? '-分享版' : ''}.${extension}`;
};

export const downloadSharedImage = async (source: string, filename: string, clean = getCleanSharedImages()) => {
  const target = beginExportTarget();
  const blob = await prepareImage(source, clean, false, getSharedImageCustomText(), getSharedImageCleanContent());
  await saveExportBlob(blob, imageSharingFilename(filename, blob, clean), target);
};

export const copySharedImage = async (source: string, clean = getCleanSharedImages(), data?: ImageGenerationData) => {
  if (window.isSecureContext === false || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('当前浏览器无法复制图片，请使用电脑 localhost／HTTPS 打开，或下载后发送');
  }
  // 同步提交 ClipboardItem，异步读取图片留在 Promise 内，保留 Safari 的点击授权。
  const copyRevision = beginImageClipboardCopy();
  const customText = getSharedImageCustomText();
  const content = getSharedImageCleanContent();
  const original = readImage(source);
  const png = original.then(blob => prepareImageBlob(blob, clean, true, customText, content));
  void png.catch(() => {}); // 浏览器拒绝剪贴板时仍接住尚未完成的图片读取错误。
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    await rememberCopiedImage(copyRevision, await png, await original, data);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') throw new Error('浏览器未允许复制图片，请允许剪贴板访问后重试，或下载后发送');
    throw error;
  }
};
