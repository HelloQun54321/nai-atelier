import { lookupTagTranslations, normalizeTagQuery } from './tagDictionary';

export interface ImageTaggerTag {
  name: string;
  confidence: number;
  category: 'general' | 'character' | 'rating';
  chinese?: string;
}

export interface ImageTaggerResult {
  model: string;
  threshold: number;
  characterThreshold: number;
  rating: ImageTaggerTag | null;
  tags: ImageTaggerTag[];
  character: ImageTaggerTag[];
  general: ImageTaggerTag[];
}

export interface ImageTaggerModelStatus {
  id: string;
  label: string;
  description: string;
  threshold: number;
  characterThreshold: number;
  downloaded: boolean;
  totalBytes: number;
  receivedBytes: number;
  stage: 'missing' | 'downloading' | 'verifying' | 'ready' | 'paused' | 'error';
  error: string;
}
export interface ImageTaggerStatus {
  model: string;
  downloaded: boolean;
  models: ImageTaggerModelStatus[];
  busy: boolean;
  downloadingModel: string | null;
}

const readResponse = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  if (response.status === 401 && payload?.code === 'LAN_ACCESS_REQUIRED') {
    window.dispatchEvent(new CustomEvent('nai-lan-access-required'));
  }
  if (!response.ok) throw new Error(payload?.error || `图片反推 Tag 失败 (${response.status})`);
  return payload;
};

const addTranslations = async (result: ImageTaggerResult) => {
  const translations = await lookupTagTranslations(result.tags.map(item => item.name)).catch(() => new Map());
  const decorate = (item: ImageTaggerTag) => ({ ...item, chinese: translations.get(normalizeTagQuery(item.name))?.chinese || '' });
  return {
    ...result,
    rating: result.rating ? decorate(result.rating) : null,
    tags: result.tags.map(decorate),
    character: result.character.map(decorate),
    general: result.general.map(decorate),
  };
};

const getStatus = async (): Promise<ImageTaggerStatus> => {
  return readResponse(await fetch('/api/image-tagger/status', { cache: 'no-store' }));
};

const tagFile = async (file: File, options: { threshold?: number; characterThreshold?: number; model?: string } = {}): Promise<ImageTaggerResult> => {
  const params = new URLSearchParams();
  if (options.threshold !== undefined) params.set('threshold', String(options.threshold));
  if (options.characterThreshold !== undefined) params.set('characterThreshold', String(options.characterThreshold));
  if (options.model) params.set('model', options.model);
  const result = await readResponse(await fetch(`/api/image-tagger?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'image/png' },
    body: file,
  })) as ImageTaggerResult;
  return addTranslations(result);
};

const control = async (action: 'model' | 'download' | 'pause' | 'delete', model?: string) => {
  await readResponse(await fetch(`/api/image-tagger/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) }));
};

/**
 * 助手反推前的就绪检查：把服务端 500／409 的原文换成能照着做的说明。
 * 只读判断，不下载、不切换模型，也不改变正常反推流程。
 */
export const taggerReadinessIssue = (status: ImageTaggerStatus, modelId?: string): string | null => {
  const current = status.models?.find(model => model.id === status.model);
  const currentLabel = current?.label || status.model;
  if (modelId && modelId !== status.model) return `助手不能切换反推模型：当前是「${currentLabel}」，请省略 model 参数改用当前模型。`;
  if (!current) return `读取不到当前反推模型「${currentLabel}」的状态：请在反推面板里重新选择模型后再试。`;
  if (current.downloaded) return null;
  const hint = current.stage === 'downloading' || current.stage === 'verifying' ? '模型正在下载，下载完成后再试'
    : current.stage === 'paused' ? '模型下载已暂停，请在反推面板右上角「反推模型」里继续下载'
      : '请在反推面板右上角「反推模型」里下载完成后再试';
  return `反推模型「${currentLabel}」尚未就绪：${hint}。助手不会自动下载或切换模型。`;
};

export const imageTaggerService = { getStatus, tagFile, selectModel: (model: string) => control('model', model), downloadModel: (model: string) => control('download', model), pauseDownload: () => control('pause'), deleteModel: (model: string) => control('delete', model) };
