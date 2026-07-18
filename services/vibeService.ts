import { VibeAsset, VibeGroup, VibeSelection } from '../types';
import { api } from './api';

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
  reader.readAsDataURL(file);
});

const fileToText = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
  reader.readAsText(file, 'utf-8');
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
  } catch { return undefined; }
};

const responseError = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  throw new Error(payload?.error || `请求失败 (${response.status})`);
};

export const vibeService = {
  list: async (query = '', archived = false): Promise<VibeAsset[]> => {
    const result = await api.get(`/vibes?q=${encodeURIComponent(query)}&archived=${archived}`);
    return result.items || [];
  },

  create: async (file: File, name: string): Promise<{item: VibeAsset; duplicate?: boolean}> => {
    if (file.size > 30 * 1024 * 1024) throw new Error('参考图不能超过 30 MB');
    const [imageData, thumbnailData] = await Promise.all([fileToDataUrl(file), createThumbnailDataUrl(file)]);
    return api.post('/vibes', { name, imageData, thumbnailData });
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
    if (!response.ok) return responseError(response) as never;
    return response.json();
  },

  archive: (id: string) => api.post(`/vibes/${encodeURIComponent(id)}/archive`, {}),
  restore: (id: string) => api.post(`/vibes/${encodeURIComponent(id)}/restore`, {}),
  rename: (id: string, name: string, defaultStrength?: number) =>
    api.put(`/vibes/${encodeURIComponent(id)}`, { name, defaultStrength }),

  download: async (asset: VibeAsset) => {
    const response = await fetch(`/api/vibes/${encodeURIComponent(asset.id)}/file`);
    if (!response.ok) return responseError(response);
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
