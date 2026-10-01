import type { NAIParams } from '../types';
import { extractMetadata, parseNovelAIMetadata } from './metadataService';

export interface ImageGenerationData {
  prompt?: string;
  negativePrompt?: string;
  params?: NAIParams;
}

const SESSION_KEY = 'nai_last_copied_image';
let revision = 0;
let pendingCopy: Promise<void> | undefined;

/** 只保存本页会话最后一次主动复制的配置，不监听剪贴板，也不保存图片或复制历史。 */
export const beginImageClipboardCopy = () => {
  pendingCopy = undefined;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* 会话缓存不可用时仍可复制图片。 */ }
  return ++revision;
};

/** 按浏览器解码后的像素匹配，PNG 文本块被系统重编码删除后仍能辨认同一张图。 */
const pixelFingerprint = async (blob: Blob) => {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    if (!width || !height || width * height > 40_000_000) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    try {
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, width, height).data;
      const hash = await crypto.subtle.digest('SHA-256', pixels);
      return `${width}x${height}:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    } finally { canvas.width = 0; canvas.height = 0; }
  } finally { bitmap.close(); }
};

const commitCopiedImage = async (copyRevision: number, shared: Blob, original: Blob, data?: ImageGenerationData) => {
  try {
    if (!data) {
      const raw = await extractMetadata(new File([original], 'original.png', { type: original.type }));
      if (raw) {
        const parsed = parseNovelAIMetadata(raw);
        if (parsed.prompt || parsed.params.characters?.some(character => character.prompt.trim())) data = parsed;
      }
    }
    if (!data || copyRevision !== revision) return;
    // 历史旧记录未写角色字段时代表没有角色，不能让目标草稿的旧角色混入。
    if (data.params) data = { ...data, params: { ...data.params, characters: data.params.characters ?? [], useCoords: data.params.useCoords === true } };
    const fingerprint = await pixelFingerprint(shared);
    if (fingerprint && copyRevision === revision) {
      // 配置只留在工坊当前标签页的会话缓存；清洗副本及系统剪贴板中均不附加私有参数。
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ fingerprint, data }));
    }
  } catch { /* 配置关联失败不影响分享；粘贴端仍会尝试读取图片自身元数据。 */ }
};

export const rememberCopiedImage = (copyRevision: number, shared: Blob, original: Blob, data?: ImageGenerationData) => {
  if (copyRevision !== revision) return Promise.resolve();
  const pending = commitCopiedImage(copyRevision, shared, original, data);
  pendingCopy = pending;
  return pending.finally(() => { if (pendingCopy === pending) pendingCopy = undefined; });
};

export const getCopiedImageData = async (file: File): Promise<ImageGenerationData | undefined> => {
  try {
    // 系统剪贴板已写入、像素摘要尚未完成时，立即粘贴仍等待这次复制的关联。
    await pendingCopy;
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return;
    const saved = JSON.parse(stored) as { fingerprint: string; data: ImageGenerationData };
    if (saved.fingerprint !== await pixelFingerprint(file)) return;
    // 读取期间再次复制时不能使用已过期的配置。
    if (sessionStorage.getItem(SESSION_KEY) !== stored) return;
    return saved.data;
  } catch { return; }
};
