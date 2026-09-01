import { CharacterReferenceAsset } from '../types';
import { api } from './api';

const createThumbnailBlob = async (file: File) => {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob | undefined>(resolve => canvas.toBlob(blob => resolve(blob || undefined), 'image/webp', 0.72));
  } catch {
    return undefined;
  }
};

export const characterReferenceService = {
  list: async (query = '', archived = false): Promise<CharacterReferenceAsset[]> => {
    const result = await api.get(`/character-references?q=${encodeURIComponent(query)}&archived=${archived}`);
    return result.items || [];
  },

  create: async (file: File, name: string): Promise<{ item: CharacterReferenceAsset; duplicate?: boolean }> => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      throw new Error('只支持 PNG、JPEG 或 WebP 图片');
    }
    if (!file.size || file.size > 30 * 1024 * 1024) throw new Error('角色参考图大小必须在 30 MB 以内');
    const thumbnail = await createThumbnailBlob(file);
    const formData = new FormData();
    formData.append('name', name);
    formData.append('image', file);
    if (thumbnail) formData.append('thumbnail', thumbnail, 'thumbnail.webp');
    return api.postForm('/character-references', formData);
  },

  rename: (id: string, name: string, defaultStrength?: number, defaultFidelity?: number) =>
    api.put(`/character-references/${encodeURIComponent(id)}`, { name, defaultStrength, defaultFidelity }),

  archive: (id: string) => api.post(`/character-references/${encodeURIComponent(id)}/archive`, {}),
  restore: (id: string) => api.post(`/character-references/${encodeURIComponent(id)}/restore`, {}),
};
