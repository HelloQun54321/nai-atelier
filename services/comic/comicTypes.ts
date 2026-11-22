import type { NaiNoiseSchedule } from '../naiNoiseSchedule';

export type ComicV5ModelId =
  | 'nai-diffusion-5-full'
  | 'nai-diffusion-5-full-medium'
  | 'nai-diffusion-5-curated';

export type ComicColorMode = 'color' | 'monochrome';

export type ComicCreationMode = 'manual' | 'ai-page';

export type ComicDialogueMode = 'clean-vector' | 'empty-bubble' | 'ai-text';

export type ComicTool =
  | 'select'
  | 'hand'
  | 'zoom'
  | 'draw-panel'
  | 'slice'
  | 'frame-image'
  | 'bubble'
  | 'text'
  | 'sticker'
  | 'brush'
  | 'eraser';

export interface ComicPoint {
  /** 相对页面宽度的归一化坐标（0..1）。 */
  x: number;
  /** 相对页面高度的归一化坐标（0..1）。 */
  y: number;
}

export type ComicAnchorKind = 'character' | 'scene' | 'bubble' | 'inset';

export type ComicBubbleShape = 'oval' | 'shout' | 'thought' | 'caption';

export type ComicFontFamily = 'comic-sans' | 'round' | 'hand' | 'bold' | 'impact';

export interface ComicAnchor {
  id: string;
  kind: ComicAnchorKind;
  label: string;
  prompt: string;
  negativePrompt: string;
  /** 相对当前格（手动模式）或整页（AI 模式）的归一化坐标（0..1）。 */
  x: number;
  y: number;
  enabled: boolean;
  bubbleShape?: ComicBubbleShape;
  bubbleText?: string;
  sourceCharacterId?: string;
}

export interface ComicPanelImage {
  url: string;
  historyId?: string;
  width?: number;
  height?: number;
  /** 图内水平偏移（相对画格宽度的归一化偏移，0 表示居中）。 */
  offsetX: number;
  /** 图内垂直偏移（相对画格高度的归一化偏移，0 表示居中）。 */
  offsetY: number;
  /** 图内缩放倍率（1 = 刚好铺满画格）。 */
  scale: number;
}

export interface ComicPanel {
  id: string;
  name: string;
  /** 多边形顶点（顺时针，归一化页面坐标 0..1）。 */
  points: ComicPoint[];
  /** 围绕多边形包围盒中心的旋转角度（度）。 */
  rotation: number;
  zIndex: number;
  borderColor: string;
  borderWidth: number;
  backgroundColor: string;
  prompt: string;
  negativePrompt: string;
  anchors: ComicAnchor[];
  useCoords: boolean;
  /** 若用户手动覆盖了该格尺寸则记录；缺省按画格比例自动匹配 Opus 免费分辨率。 */
  customWidth?: number;
  customHeight?: number;
  image?: ComicPanelImage;
  locked?: boolean;
}

export interface ComicStroke {
  id: string;
  tool: 'brush' | 'eraser';
  color: string;
  /** 相对画布像素基准的线宽。 */
  size: number;
  opacity: number;
  points: ComicPoint[];
}

export interface ComicBubbleItem {
  id: string;
  shape: ComicBubbleShape;
  /** 包围盒中心（归一化页面坐标 0..1）。 */
  x: number;
  y: number;
  width: number;
  height: number;
  hasTail: boolean;
  /** 气泡尾巴尖端坐标（归一化页面坐标 0..1）。 */
  tailX: number;
  tailY: number;
  text: string;
  writingMode: 'horizontal' | 'vertical';
  fontFamily?: ComicFontFamily;
  fontSize: number;
  textColor: string;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  rotation: number;
}

export interface ComicTextItem {
  id: string;
  x: number;
  y: number;
  text: string;
  writingMode: 'horizontal' | 'vertical';
  fontFamily?: ComicFontFamily;
  fontSize: number;
  color: string;
  strokeColor: string;
  rotation: number;
  bold: boolean;
}

export type ComicStickerKind =
  | 'speedlines'
  | 'sweat'
  | 'anger'
  | 'sparkle'
  | 'exclamation'
  | 'question'
  | 'shock'
  | 'heart';

export interface ComicStickerItem {
  id: string;
  kind: ComicStickerKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  opacity: number;
}

export type ComicLayerId = 'panels' | 'drawing' | 'bubbles' | 'stickers';

export interface ComicLayerConfig {
  visible: boolean;
  locked: boolean;
  order: number;
}

export type ComicLayerState = Record<ComicLayerId, ComicLayerConfig>;

export interface ComicPaperPreset {
  id: string;
  label: string;
  description: string;
  width: number;
  height: number;
}

export type ComicAiZoneSplitMode = 'auto' | 'single' | 'dual-vertical' | 'dual-horizontal';

export interface ComicAiGuidePanel {
  id: string;
  label: string;
  summary: string;
  /** 英文镜头/景别/环境光影词，会在生图时馈入该格对应锚点，确保构图与氛围连贯。 */
  visualNote?: string;
  /** 相对整页的半透明构图引导区（0..1）。 */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComicAiGeneratedPageImage {
  url: string;
  historyId?: string;
  width: number;
  height: number;
  zoneHistoryIds?: string[];
}

export interface ComicAiPagePlan {
  storyPrompt: string;
  targetPanelCount: number;
  castCharacterIds: string[];
  splitMode: ComicAiZoneSplitMode;
  layoutHint: string;
  guidePanels: ComicAiGuidePanel[];
  anchors: ComicAnchor[];
  generatedPageImage?: ComicAiGeneratedPageImage;
  /** 首次整页生成原图留底，局部重绘后可随时对比或一键恢复。 */
  originalGeneratedPageImage?: ComicAiGeneratedPageImage;
  /** 双区模式下分别保留区 1 / 区 2 已生成成图，支持单区重画与中途断点保留。 */
  zoneImages?: Partial<Record<'0' | '1', ComicAiGeneratedPageImage>>;
  showGuideOverlay: boolean;
}

export interface ComicPageDraft {
  version: 1;
  id: string;
  title: string;
  paperPresetId: string;
  width: number;
  height: number;
  backgroundColor: string;
  gutterPx: number;
  creationMode: ComicCreationMode;
  dialogueMode: ComicDialogueMode;
  colorMode: ComicColorMode;
  v5Model: ComicV5ModelId;
  styleChainId?: string;
  globalBasePrompt: string;
  globalNegativePrompt: string;
  steps: number;
  scale: number;
  seed?: number;
  sampler: string;
  noiseSchedule: NaiNoiseSchedule;
  cfgRescale: number;
  variety: boolean;
  qualityPresetId: string;
  ucPresetId: string;
  panels: ComicPanel[];
  aiPage: ComicAiPagePlan;
  strokes: ComicStroke[];
  bubbles: ComicBubbleItem[];
  texts: ComicTextItem[];
  stickers: ComicStickerItem[];
  layers: ComicLayerState;
  snapEnabled: boolean;
  updatedAt: number;
}

export type ComicSelection =
  | { kind: 'panel'; id: string }
  | { kind: 'ai-anchor'; id: string }
  | { kind: 'bubble'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'sticker'; id: string }
  | null;
