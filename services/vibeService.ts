import { VibeAsset, VibeGroup, VibeSelection } from '../types';
import { api, parseErrorResponse } from './api';
import { ANLAS_BUDGET_CHANGED_EVENT } from './anlasBudget';

const fileToText = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
  reader.readAsText(file, 'utf-8');
});

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
  } catch { return undefined; }
};

const responseError = (response: Response) => parseErrorResponse(response);

export const vibeService = {
  list: async (query = '', archived = false): Promise<VibeAsset[]> => {
    const result = await api.get(`/vibes?q=${encodeURIComponent(query)}&archived=${archived}`);
    return result.items || [];
  },

  create: async (file: File, name: string): Promise<{item: VibeAsset; duplicate?: boolean}> => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('只支持 PNG、JPEG 或 WebP 图片');
    if (file.size > 30 * 1024 * 1024) throw new Error('参考图不能超过 30 MB');
    const thumbnail = await createThumbnailBlob(file);
    const formData = new FormData();
    formData.append('name', name);
    formData.append('image', file);
    if (thumbnail) formData.append('thumbnail', thumbnail, 'thumbnail.webp');
    return api.postForm('/vibes', formData);
  },

  importFile: async (file: File): Promise<{item: VibeAsset; imported: number}> => {
    if (file.size > 40 * 1024 * 1024) throw new Error('Vibe 文件不能超过 40 MB');
    return api.post('/vibes/import', { fileText: await fileToText(file) });
  },

  encode: async (vibeId: string, informationExtracted: number, apiKey: string): Promise<{item: VibeAsset; duplicate?: boolean}> => {
    const response = await fetch(`/api/vibes/${encodeURIComponent(vibeId)}/encodings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ informationExtracted }),
    });
    if (!response.ok) return await responseError(response) as never;
    const result = await response.json();
    if (result.anlasBudget) {
      window.dispatchEvent(new CustomEvent(ANLAS_BUDGET_CHANGED_EVENT, { detail: result.anlasBudget }));
    }
    return result;
  },

  archive: (id: string) => api.post(`/vibes/${encodeURIComponent(id)}/archive`, {}),
  restore: (id: string) => api.post(`/vibes/${encodeURIComponent(id)}/restore`, {}),
  rename: (id: string, name: string, defaultStrength?: number) =>
    api.put(`/vibes/${encodeURIComponent(id)}`, { name, defaultStrength }),

  download: async (asset: VibeAsset) => {
    const response = await fetch(`/api/vibes/${encodeURIComponent(asset.id)}/file`);
    if (!response.ok) return await responseError(response);
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${asset.name}.naiv4vibe`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  listGroups: async (): Promise<VibeGroup[]> => (await api.get('/vibe-groups')).items || [],
  createGroup: (name: string, slots: VibeSelection[], normalizeStrengths: boolean) =>
    api.post('/vibe-groups', { name, slots, normalizeStrengths }),
  updateGroup: (group: VibeGroup) => api.put(`/vibe-groups/${encodeURIComponent(group.id)}`, group),
  deleteGroup: (id: string) => api.delete(`/vibe-groups/${encodeURIComponent(id)}`),
};
