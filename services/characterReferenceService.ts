import { CharacterReferenceAsset } from '../types';
import { api } from './api';

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
  reader.readAsDataURL(file);
});

const createThumbnailDataUrl = async (file: File) => {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/webp', 0.72);
  } catch {
    return undefined;
  }
};

export const characterReferenceService = {
  list: async (query = '', archived = false): Promise<CharacterReferenceAsset[]> => {
    const result = await api.get(`/character-references?q=${encodeURIComponent(query)}&archived=${archived}`);
    return result.items || [];
  },

  get: async (id: string): Promise<CharacterReferenceAsset> => {
    const result = await api.get(`/character-references/${encodeURIComponent(id)}`);
    return result.item;
  },

  create: async (file: File, name: string): Promise<{ item: CharacterReferenceAsset; duplicate?: boolean }> => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      throw new Error('只支持 PNG、JPEG 或 WebP 图片');
    }
    if (!file.size || file.size > 30 * 1024 * 1024) throw new Error('角色参考图大小必须在 30 MB 以内');
    const [imageData, thumbnailData] = await Promise.all([fileToDataUrl(file), createThumbnailDataUrl(file)]);
    return api.post('/character-references', { name, imageData, thumbnailData });
  },

  rename: (id: string, name: string, defaultStrength?: number, defaultFidelity?: number) =>
    api.put(`/character-references/${encodeURIComponent(id)}`, { name, defaultStrength, defaultFidelity }),

  archive: (id: string) => api.post(`/character-references/${encodeURIComponent(id)}/archive`, {}),
  restore: (id: string) => api.post(`/character-references/${encodeURIComponent(id)}/restore`, {}),
};
