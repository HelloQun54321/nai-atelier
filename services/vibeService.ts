import { NAIParams, VibeAsset, VibeGroup, VibeSelection } from '../types';
import { defaultVibeInformation, vibeBaseModel, vibeModelKey } from './vibeProtocol.mjs';
import { sha256 } from '@noble/hashes/sha2.js';
import { extractMetadata, parseNovelAIMetadata } from './metadataService';
import { api, parseErrorResponse, reportNaiAccountingError } from './api';
import { ANLAS_BUDGET_CHANGED_EVENT, hashNaiApiKey } from './anlasBudget';
import { NOVELAI_USAGE_REFRESH_EVENT } from './naiUsage';
import { beginExportTarget, type ExportReceipt } from './exportLocation';

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
// 局域网 HTTP 页面也能计算官方文本哈希，不依赖安全上下文的 SubtleCrypto。
const hashVibeText = (value: string) => Array.from(sha256(new TextEncoder().encode(value)), byte => byte.toString(16).padStart(2, '0')).join('');
export interface VibeImportResult { item: VibeAsset; items: VibeAsset[]; slots: VibeSelection[]; imported: number; bundle: boolean; normalizeStrengths: boolean }
let embeddedImports = new WeakMap<object, Promise<VibeImportResult>>();

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

  importFile: async (file: File, model?: string): Promise<VibeImportResult> => {
    if (file.size > 40 * 1024 * 1024) throw new Error('Vibe 文件不能超过 40 MB');
    if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
      const raw = await extractMetadata(file);
      if (!raw) throw new Error('图片没有可复用的 Vibe 编码');
      const params = parseNovelAIMetadata(raw, { model }).params;
      if (!params.vibes?.embedded) throw new Error('图片没有可复用的 Vibe 编码');
      return vibeService.importEmbedded(params.vibes.embedded, params.vibes.normalizeStrengths);
    }
    return api.post('/vibes/import', { fileText: await fileToText(file) });
  },

  importEmbedded: async (embedded: NonNullable<NonNullable<NAIParams['vibes']>['embedded']>, normalizeStrengths = true): Promise<VibeImportResult> => {
    const pending = embeddedImports.get(embedded);
    if (pending) return pending;
    const task = (async () => {
      if (!embedded.model) throw new Error('图片的 Vibe 编码缺少已知模型，无法安全复用');
      const model = vibeBaseModel(embedded.model), modelKey = vibeModelKey(model);
      if (!modelKey) throw new Error('图片的 Vibe 编码缺少已知模型，无法安全复用');
      if (!embedded.encodings.length || embedded.encodings.length > 16) throw new Error('一次最多使用 16 个 Vibe');
      const vibes = await Promise.all(embedded.encodings.map(async (encoding, index) => ({
        identifier: 'novelai-vibe-transfer', version: 1, type: 'encoding', id: await hashVibeText(encoding),
        encodings: { [modelKey]: { unknown: { encoding } } },
        importInfo: { model, information_extracted: embedded.information?.[index] ?? defaultVibeInformation(model), strength: embedded.strengths[index] ?? 0.6 },
      })));
      return api.post('/vibes/import', { document: { identifier: 'novelai-vibe-transfer-bundle', version: 1, vibes, normalizeStrengths } });
    })();
    embeddedImports.set(embedded, task);
    try { return await task; } catch (error) { embeddedImports.delete(embedded); throw error; }
  },

  resolveParams: async (params: NAIParams): Promise<NAIParams> => {
    if (!params.vibes?.embedded) return params;
    const result = await vibeService.importEmbedded(params.vibes.embedded, params.vibes.normalizeStrengths);
    return { ...params, vibes: { enabled: params.vibes.enabled, normalizeStrengths: result.normalizeStrengths, slots: result.slots } };
  },

  encode: async (vibeId: string, informationExtracted: number, apiKey: string, model = 'nai-diffusion-4-5-full'): Promise<{item: VibeAsset; duplicate?: boolean; anlasAccountingFailed?: boolean}> => {
    const response = await fetch(`/api/vibes/${encodeURIComponent(vibeId)}/encodings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ informationExtracted, model: vibeBaseModel(model) }),
    });
    if (!response.ok) throw await responseError(response);
    const result = await response.json();
    if (result.anlasBudget) {
      // 预算响应不携带 Key 标识，按发起编码的 Key 补齐，迟到事件由预算订阅过滤。
      const keyHash = await hashNaiApiKey(apiKey.trim());
      window.dispatchEvent(new CustomEvent(ANLAS_BUDGET_CHANGED_EVENT, { detail: { ...result.anlasBudget, keyHash } }));
    }
    if (result.anlasAccountingFailed) reportNaiAccountingError(await hashNaiApiKey(apiKey.trim()), typeof result.anlasAccountingError === 'string' ? result.anlasAccountingError : '');
    // 新编码成功后立即查询官方余额，不等待查询返回再交付资产；重复复用没有新消费。
    // 期间切 Key 时不因旧账号编码完成而刷新当前另一个账号。
    if (result.duplicate !== true && typeof window !== 'undefined') {
      const activeKey = (sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '').trim();
      if (activeKey === apiKey.trim()) window.dispatchEvent(new CustomEvent(NOVELAI_USAGE_REFRESH_EVENT));
    }
    return result;
  },

  archive: (id: string) => api.post(`/vibes/${encodeURIComponent(id)}/archive`, {}),
  restore: (id: string) => api.post(`/vibes/${encodeURIComponent(id)}/restore`, {}),
  delete: async (id: string): Promise<{ success: true; id: string }> => {
    try { return await api.delete(`/vibes/${encodeURIComponent(id)}`); }
    finally { embeddedImports = new WeakMap(); }
  },
  deleteEncoding: async (id: string, encodingId: string): Promise<{ success: true; item: VibeAsset; encodingId: string }> => {
    try { return await api.delete(`/vibes/${encodeURIComponent(id)}/encodings/${encodeURIComponent(encodingId)}`); }
    finally { embeddedImports = new WeakMap(); }
  },
  rename: (id: string, name: string, defaultStrength?: number) =>
    api.put(`/vibes/${encodeURIComponent(id)}`, { name, defaultStrength }),

  download: async (asset: VibeAsset): Promise<ExportReceipt> => {
    const exportTarget = beginExportTarget();
    const response = await fetch(`/api/vibes/${encodeURIComponent(asset.id)}/file`);
    if (!response.ok) throw await responseError(response);
    const { downloadFile } = await import('./fileDownload');
    const extension = response.headers.get('content-disposition')?.includes('naiv4vibeBundle') ? 'naiv4vibeBundle' : 'naiv4vibe';
    return downloadFile(await response.blob(), `${asset.name}.${extension}`, exportTarget);
  },

  downloadGroup: async (name: string, slots: VibeSelection[], normalizeStrengths: boolean): Promise<ExportReceipt> => {
    const exportTarget = beginExportTarget();
    const document = await api.post('/vibes/export', { slots, normalizeStrengths });
    const { downloadFile } = await import('./fileDownload');
    return downloadFile(new Blob([JSON.stringify(document)], { type: 'application/json' }), `${name || 'Vibe'}.naiv4vibeBundle`, exportTarget);
  },

  listGroups: async (): Promise<VibeGroup[]> => (await api.get('/vibe-groups')).items || [],
  createGroup: (name: string, slots: VibeSelection[], normalizeStrengths: boolean) =>
    api.post('/vibe-groups', { name, slots, normalizeStrengths }),
  updateGroup: (group: VibeGroup) => api.put(`/vibe-groups/${encodeURIComponent(group.id)}`, group),
  deleteGroup: (id: string) => api.delete(`/vibe-groups/${encodeURIComponent(id)}`),
};
