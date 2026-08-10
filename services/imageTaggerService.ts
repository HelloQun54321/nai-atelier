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

const getStatus = async (): Promise<{ model: string; downloaded: boolean }> => {
  return readResponse(await fetch('/api/image-tagger/status', { cache: 'no-store' }));
};

const tagFile = async (file: File, options: { threshold?: number; characterThreshold?: number } = {}): Promise<ImageTaggerResult> => {
  const params = new URLSearchParams({
    threshold: String(options.threshold ?? 0.35),
    characterThreshold: String(options.characterThreshold ?? 0.85),
  });
  const result = await readResponse(await fetch(`/api/image-tagger?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'image/png' },
    body: file,
  })) as ImageTaggerResult;
  return addTranslations(result);
};

export const imageTaggerService = { getStatus, tagFile };
