import { createDefaultLayers, createInitialAiPagePlan, createInitialComicDraft } from './comicGeometry';
import { syncComicLayerStack } from './comicLayers';
import type { ComicAiPagePlan, ComicAiZoneSplitMode, ComicPageDraft } from './comicTypes';

const COMIC_DRAFT_STORAGE_KEY = 'nai_comic_studio_draft_v1';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const normalizeAiPage = (raw: unknown, width: number, height: number, gutterPx: number): ComicAiPagePlan => {
  const fallback = createInitialAiPagePlan(width, height, gutterPx);
  if (!isRecord(raw)) return fallback;
  const splitMode: ComicAiZoneSplitMode =
    raw.splitMode === 'single' || raw.splitMode === 'dual-vertical' || raw.splitMode === 'dual-horizontal'
      ? raw.splitMode
      : 'auto';
  const rawGuides = Array.isArray(raw.guidePanels) && raw.guidePanels.length > 0
    ? raw.guidePanels as ComicAiPagePlan['guidePanels']
    : fallback.guidePanels;
  // 自愈修复：若任何引导格越出画纸边界（如旧版 getPanelBoundingBox 产生的 1×1 溢出缓存）或尺寸非法，自动重建
  const hasCorruptedGuides = rawGuides.some(g => {
    const x = Number(g?.x);
    const y = Number(g?.y);
    const w = Number(g?.width);
    const h = Number(g?.height);
    return !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)
      || w <= 0.02 || h <= 0.02
      || x < 0 || y < 0
      || x + w > 1.005 || y + h > 1.005;
  });
  return {
    storyPrompt: typeof raw.storyPrompt === 'string' ? raw.storyPrompt : '',
    targetPanelCount: Number.isFinite(Number(raw.targetPanelCount)) ? Math.max(2, Math.min(8, Math.round(Number(raw.targetPanelCount)))) : 4,
    castCharacterIds: Array.isArray(raw.castCharacterIds) ? raw.castCharacterIds.filter((id): id is string => typeof id === 'string') : [],
    splitMode,
    layoutHint: typeof raw.layoutHint === 'string' && raw.layoutHint.trim() ? raw.layoutHint : fallback.layoutHint,
    guidePanels: hasCorruptedGuides ? fallback.guidePanels : rawGuides,
    anchors: Array.isArray(raw.anchors) ? raw.anchors as ComicAiPagePlan['anchors'] : [],
    generatedPageImage: isRecord(raw.generatedPageImage) && typeof raw.generatedPageImage.url === 'string'
      ? raw.generatedPageImage as unknown as ComicAiPagePlan['generatedPageImage']
      : undefined,
    originalGeneratedPageImage: isRecord(raw.originalGeneratedPageImage) && typeof raw.originalGeneratedPageImage.url === 'string'
      ? raw.originalGeneratedPageImage as unknown as ComicAiPagePlan['originalGeneratedPageImage']
      : undefined,
    zoneImages: isRecord(raw.zoneImages)
      ? raw.zoneImages as unknown as ComicAiPagePlan['zoneImages']
      : undefined,
    showGuideOverlay: raw.showGuideOverlay !== false,
  };
};

export const normalizeComicDraft = (raw: unknown): ComicPageDraft => {
  const fallback = createInitialComicDraft();
  if (!isRecord(raw) || raw.version !== 1) return fallback;
  const width = Number(raw.width);
  const height = Number(raw.height);
  const v5Model = raw.v5Model === 'nai-diffusion-5-full-medium' || raw.v5Model === 'nai-diffusion-5-curated'
    ? raw.v5Model
    : 'nai-diffusion-5-full';

  return syncComicLayerStack({
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
    seed: raw.seed !== undefined && raw.seed !== null && Number.isFinite(Number(raw.seed)) && Number(raw.seed) >= 0
      ? Math.floor(Number(raw.seed))
      : undefined,
    sampler: typeof raw.sampler === 'string' && raw.sampler ? raw.sampler : fallback.sampler,
    noiseSchedule: (typeof raw.noiseSchedule === 'string' && raw.noiseSchedule ? raw.noiseSchedule : fallback.noiseSchedule) as ComicPageDraft['noiseSchedule'],
    cfgRescale: Number.isFinite(Number(raw.cfgRescale)) ? Math.max(0, Math.min(1, Number(raw.cfgRescale))) : 0,
    variety: raw.variety === true,
    qualityPresetId: typeof raw.qualityPresetId === 'string' ? raw.qualityPresetId : fallback.qualityPresetId,
    ucPresetId: typeof raw.ucPresetId === 'string' ? raw.ucPresetId : fallback.ucPresetId,
    panels: Array.isArray(raw.panels) ? raw.panels : fallback.panels,
    aiPage: normalizeAiPage(
      raw.aiPage,
      Number.isFinite(width) && width >= 256 && width <= 4096 ? Math.round(width) : fallback.width,
      Number.isFinite(height) && height >= 256 && height <= 4096 ? Math.round(height) : fallback.height,
      Number.isFinite(Number(raw.gutterPx)) ? Math.max(0, Math.min(64, Number(raw.gutterPx))) : fallback.gutterPx,
    ),
    strokes: Array.isArray(raw.strokes) ? raw.strokes : [],
    bubbles: Array.isArray(raw.bubbles) ? raw.bubbles : [],
    texts: Array.isArray(raw.texts) ? raw.texts : [],
    stickers: Array.isArray(raw.stickers) ? raw.stickers : [],
    drawingLayers: Array.isArray(raw.drawingLayers) ? raw.drawingLayers as ComicPageDraft['drawingLayers'] : undefined,
    imageLayers: Array.isArray(raw.imageLayers) ? raw.imageLayers as ComicPageDraft['imageLayers'] : undefined,
    layerStack: Array.isArray(raw.layerStack) ? raw.layerStack as ComicPageDraft['layerStack'] : undefined,
    layers: isRecord(raw.layers) ? { ...createDefaultLayers(), ...(raw.layers as ComicPageDraft['layers']) } : createDefaultLayers(),
    snapEnabled: raw.snapEnabled !== false,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now(),
  });
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
