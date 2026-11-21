import { createDefaultLayers, createInitialComicDraft } from './comicGeometry';
import type { ComicPageDraft } from './comicTypes';

const COMIC_DRAFT_STORAGE_KEY = 'nai_comic_studio_draft_v1';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const normalizeComicDraft = (raw: unknown): ComicPageDraft => {
  const fallback = createInitialComicDraft();
  if (!isRecord(raw) || raw.version !== 1) return fallback;
  const width = Number(raw.width);
  const height = Number(raw.height);
  const v5Model = raw.v5Model === 'nai-diffusion-5-full-medium' || raw.v5Model === 'nai-diffusion-5-curated'
    ? raw.v5Model
    : 'nai-diffusion-5-full';

  return {
    ...fallback,
    id: typeof raw.id === 'string' && raw.id ? raw.id : fallback.id,
    title: typeof raw.title === 'string' ? raw.title : fallback.title,
    paperPresetId: typeof raw.paperPresetId === 'string' ? raw.paperPresetId : fallback.paperPresetId,
    width: Number.isFinite(width) && width >= 256 && width <= 4096 ? Math.round(width) : fallback.width,
    height: Number.isFinite(height) && height >= 256 && height <= 4096 ? Math.round(height) : fallback.height,
    backgroundColor: typeof raw.backgroundColor === 'string' ? raw.backgroundColor : fallback.backgroundColor,
    gutterPx: Number.isFinite(Number(raw.gutterPx)) ? Math.max(0, Math.min(64, Number(raw.gutterPx))) : fallback.gutterPx,
    creationMode: raw.creationMode === 'ai-page' ? 'ai-page' : 'manual',
    dialogueMode: raw.dialogueMode === 'empty-bubble' || raw.dialogueMode === 'ai-text' ? raw.dialogueMode : 'clean-vector',
    colorMode: raw.colorMode === 'monochrome' ? 'monochrome' : 'color',
    v5Model,
    styleChainId: typeof raw.styleChainId === 'string' ? raw.styleChainId : undefined,
    globalBasePrompt: typeof raw.globalBasePrompt === 'string' ? raw.globalBasePrompt : '',
    globalNegativePrompt: typeof raw.globalNegativePrompt === 'string' ? raw.globalNegativePrompt : '',
    steps: Number.isFinite(Number(raw.steps)) ? Math.max(1, Math.min(50, Number(raw.steps))) : fallback.steps,
    scale: Number.isFinite(Number(raw.scale)) ? Math.max(1, Math.min(20, Number(raw.scale))) : fallback.scale,
    sampler: typeof raw.sampler === 'string' && raw.sampler ? raw.sampler : fallback.sampler,
    noiseSchedule: (typeof raw.noiseSchedule === 'string' && raw.noiseSchedule ? raw.noiseSchedule : fallback.noiseSchedule) as ComicPageDraft['noiseSchedule'],
    cfgRescale: Number.isFinite(Number(raw.cfgRescale)) ? Math.max(0, Math.min(1, Number(raw.cfgRescale))) : 0,
    variety: raw.variety === true,
    qualityPresetId: typeof raw.qualityPresetId === 'string' ? raw.qualityPresetId : fallback.qualityPresetId,
    ucPresetId: typeof raw.ucPresetId === 'string' ? raw.ucPresetId : fallback.ucPresetId,
    panels: Array.isArray(raw.panels) ? raw.panels : fallback.panels,
    strokes: Array.isArray(raw.strokes) ? raw.strokes : [],
    bubbles: Array.isArray(raw.bubbles) ? raw.bubbles : [],
    texts: Array.isArray(raw.texts) ? raw.texts : [],
    stickers: Array.isArray(raw.stickers) ? raw.stickers : [],
    layers: isRecord(raw.layers) ? { ...createDefaultLayers(), ...(raw.layers as ComicPageDraft['layers']) } : createDefaultLayers(),
    snapEnabled: raw.snapEnabled !== false,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now(),
  };
};

export const loadComicDraft = (): ComicPageDraft => {
  try {
    if (typeof localStorage === 'undefined') return createInitialComicDraft();
    const text = localStorage.getItem(COMIC_DRAFT_STORAGE_KEY);
    if (!text) return createInitialComicDraft();
    return normalizeComicDraft(JSON.parse(text));
  } catch {
    return createInitialComicDraft();
  }
};

export const saveComicDraft = (draft: ComicPageDraft): boolean => {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(COMIC_DRAFT_STORAGE_KEY, JSON.stringify({ ...draft, updatedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
};
