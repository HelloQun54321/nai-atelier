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

/**
 * 漫画气泡形状（基于开源项目 jonigata/FramePlanner2 [MIT] 的专业日漫气泡引擎）。
 * 保留 oval / thought / caption 键名以兼容已保存的旧草稿。
 */
export type ComicBubbleShape =
  | 'soft'
  | 'oval'
  | 'rounded'
  | 'caption'
  | 'shout'
  | 'harsh'
  | 'thought'
  | 'ellipse-mind'
  | 'polygon'
  | 'concentration'
  | 'strokes'
  | 'double-strokes';

/**
 * 漫画嵌字字体 ID：支持内置 5 款 SIL OFL 1.1 开源漫画字体、本机导入的 custom-* 字体，
 * 以及旧草稿系统回退 ID。
 */
export type ComicFontFamily = string;

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
  /** 可视化气泡锚点在画布上的实际尺寸与尾巴/排布（不再是盲点圆点）。 */
  bubbleWidth?: number;
  bubbleHeight?: number;
  bubbleTailX?: number;
  bubbleTailY?: number;
  bubbleWritingMode?: 'horizontal' | 'vertical';
  bubbleFontSize?: number;
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
  /** 出血格标记（用于模板转 AI 引导格与导出提示）。 */
  bleed?: boolean;
  /** 画中画叠框标记（叠在常规格上层，AI 硬锁时自动描白外边 + 黑内框）。 */
  inset?: boolean;
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

export type ComicBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'soft-light'
  | 'hard-light'
  | 'difference';

export interface ComicDrawingLayerData {
  id: string;
  strokes: ComicStroke[];
}

export interface ComicImageLayerItem {
  id: string;
  name: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export type ComicLayerNodeKind = 'panels' | 'drawing' | 'bubble' | 'text' | 'sticker' | 'image' | 'group';

/** PS 风格独立图层节点（支持不透明度、混合模式、拖拽排序、文件夹分组与显隐锁定）。 */
export interface ComicLayerNode {
  id: string;
  kind: ComicLayerNodeKind;
  /** 指向底层实体 ID（panels 固定为 'panels'；drawing/bubble/text/sticker/image 对应其 ID；group 无 refId）。 */
  refId?: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1 */
  opacity: number;
  blendMode: ComicBlendMode;
  /** 所属图层组 ID（顶层为 undefined）。 */
  parentId?: string;
  /** 仅 group 使用：文件夹是否展开。 */
  expanded?: boolean;
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

export type ComicAiLayoutLockMode = 'infill' | 'img2img' | 'txt2img';
export type ComicAiGutterStyle = 'white' | 'black-flashback';

export interface ComicBreakoutZone {
  id: string;
  label: string;
  /** 归一化页面矩形包围盒（0..1）。 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 可选前景微色调底色；缺省使用中性灰不偏色。 */
  tintColor?: string;
  /** 可选绑定的角色/物件锚点 ID。 */
  anchorId?: string;
}

export interface ComicAiGuidePanel {
  id: string;
  label: string;
  summary: string;
  /** 英文镜头/景别/环境光影词，会在生图时馈入该格对应锚点，确保构图与氛围连贯。 */
  visualNote?: string;
  /** 相对整页的半透明构图引导区包围盒（0..1）。 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 可选任意多边形顶点（支持斜切分镜，向后兼容旧矩形 x/y/width/height）。 */
  points?: ComicPoint[];
  /** 出血格：紧贴画布边不留外白边。 */
  bleed?: boolean;
  /** 画中画叠框：叠在普通格上层，先描 14px 白外边再描 5px 黑内框。 */
  inset?: boolean;
  /** 无框区域：手动与 AI 锁框底图均不描黑边框，仅留格缝与构图区。 */
  borderless?: boolean;
  /** 格内预埋半透明放射速度线（#5c606b, opacity 0.55）。 */
  speedlines?: boolean;
  /** 可选格内自定义氛围底色；缺省使用中性灰 #b6b9c0（黑底回忆杀用 #6d7380）。 */
  fillColor?: string;
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
  /** 版式锁定策略：默认 infill 精准局部重绘锁框；可切回 img2img 图生图参考或 txt2img 自由文生图。 */
  layoutLockMode?: ComicAiLayoutLockMode;
  /** 精准锁框出图后自动用平滑矢量格缝与框线切齐外扩辅助边，默认开启。 */
  autoTrimFrames?: boolean;
  /** 图生图锁框重绘强度（缺省自动按全彩 0.85 / 黑白 0.82 / 含破格 0.86 取甜点值）。 */
  layoutLockStrength?: number;
  /** 格缝风格：白底常规 或 黑底回忆杀。 */
  gutterStyle?: ComicAiGutterStyle;
  /** 在气泡锚点处自动在底图预挖纯白无噪点避让椭圆，防人物遮脸。 */
  carveBubbleHoles?: boolean;
  /** 将手绘图层粗色块草图投影进底图分镜格内作构图/光影引导。 */
  projectSketchLayer?: boolean;
  /** 将页面拟声词轻压进底图交由 V5 融画渲染成手绘笔触音效字。 */
  projectSfxText?: boolean;
  /** 整页统一环境/光照英文词（自动补进未写背景的格主锚点，杜绝双区光照割裂）。 */
  sceneAtmosphere?: string;
  /** 叠在分镜边框最上层的破格前景块列表。 */
  breakoutZones?: ComicBreakoutZone[];
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
  /** 多手绘图层数据（旧版 strokes 自动迁移进首个手绘图层）。 */
  drawingLayers?: ComicDrawingLayerData[];
  /** 导入的独立图片图层（支持网点/参考/叠加特效图）。 */
  imageLayers?: ComicImageLayerItem[];
  /** PS 风格真实图层栈（数组顺序 = 从底到顶渲染顺序；面板展示按 PS 习惯从顶到底倒序显示）。 */
  layerStack?: ComicLayerNode[];
  layers: ComicLayerState;
  snapEnabled: boolean;
  updatedAt: number;
}

export type ComicSelection =
  | { kind: 'panel'; id: string }
  | { kind: 'ai-anchor'; id: string }
  | { kind: 'panel-anchor'; panelId: string; id: string }
  | { kind: 'breakout-zone'; id: string }
  | { kind: 'bubble'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'sticker'; id: string }
  | { kind: 'image'; id: string }
  | { kind: 'drawing'; id: string }
  | { kind: 'group'; id: string }
  | null;
