import type { CharacterParams, NAIParams } from '../../types';
import { getDefaultStepsForModel, isNaiMediumModel } from '../naiModels';
import { clampAnchorCoord, matchFreeOpusResolution } from './comicGeometry';
import {
  COMIC_ANCHOR_HARD_LIMIT,
  resolveComicQualityPreset,
  sanitizeComicNegativeConflicts,
  stripColorTagsForMonochrome,
} from './comicPromptBuilder';
import type { ComicAnchor, ComicBubbleShape, ComicPageDraft } from './comicTypes';

export interface ComicInpaintRect {
  /** 相对整页的归一化区域 (0..1) */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComicInpaintDraft {
  rect: ComicInpaintRect;
  prompt: string;
  negativePrompt: string;
  /** 重绘幅度 0.4 ~ 0.99（默认 0.85） */
  strength: number;
  /** 开启聚焦裁剪局部重绘（放大重绘局部细节后像素级无缝回贴原图） */
  focused: boolean;
  /** 重绘区内部空间锚点（坐标 0..1 相对重绘矩形 rect） */
  anchors: ComicAnchor[];
}

const MONOCHROME_NEGATIVE_TAGS = 'color, colored, colorful, vibrant colors, full color, chromatic, red, blue, green, yellow, pink, purple, orange';

const cleanCommaList = (text: string): string => text
  .split(',')
  .map(part => part.replace(/\s+/g, ' ').trim())
  .filter(Boolean)
  .join(', ');

const bubbleShapeTags = (shape: ComicBubbleShape | undefined): string => {
  switch (shape) {
    case 'shout': return 'jagged speech bubble, spiky shout bubble, white opaque bubble';
    case 'thought': return 'cloud thought bubble, fluffy thought bubble, white opaque bubble';
    case 'caption': return 'rectangular narration box, white caption box';
    case 'oval':
    default:
      return 'oval speech bubble, white opaque speech bubble';
  }
};

export const clampInpaintRect = (rect: ComicInpaintRect): ComicInpaintRect => {
  const width = Math.max(0.08, Math.min(1, Number.isFinite(rect.width) ? rect.width : 0.4));
  const height = Math.max(0.08, Math.min(1, Number.isFinite(rect.height) ? rect.height : 0.3));
  const x = Math.max(0, Math.min(1 - width, Number.isFinite(rect.x) ? rect.x : 0.1));
  const y = Math.max(0, Math.min(1 - height, Number.isFinite(rect.y) ? rect.y : 0.1));
  return {
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
    width: Math.round(width * 1000) / 1000,
    height: Math.round(height * 1000) / 1000,
  };
};

/**
 * 为整页局部重绘生成黑白 PNG 蒙版 DataURL：重绘矩形内为纯白 (#ffffff)，其余保持纯黑 (#000000)。
 */
export const createRectInpaintMaskDataUrl = (
  pageWidth: number,
  pageHeight: number,
  rect: ComicInpaintRect,
): string => {
  const safeRect = clampInpaintRect(rect);
  const w = Math.max(64, Math.round(pageWidth));
  const h = Math.max(64, Math.round(pageHeight));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('蒙版画布初始化失败');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(
    Math.round(safeRect.x * w),
    Math.round(safeRect.y * h),
    Math.max(8, Math.round(safeRect.width * w)),
    Math.max(8, Math.round(safeRect.height * h)),
  );
  return canvas.toDataURL('image/png');
};

export interface CompiledComicInpaintRequest {
  prompt: string;
  negative: string;
  params: NAIParams;
  strength: number;
  focused: boolean;
  focusedRect: { x: number; y: number; width: number; height: number };
  warnings: string[];
}

/**
 * 编译「AI 整页单格局部重绘」V5 请求：
 * - 自动把重绘框内锚点坐标映射到整页底图坐标系（交由 buildGenerationJobDescriptor 的 Focused 裁剪统一转换）；
 * - 遵守黑白净色、防幽灵克隆与 V5 Medium 固定步数规则。
 */
export const buildComicInpaintRequest = (
  page: ComicPageDraft,
  inpaint: ComicInpaintDraft,
): CompiledComicInpaintRequest => {
  const safeRect = clampInpaintRect(inpaint.rect);
  const monochrome = page.colorMode === 'monochrome';
  const warnings: string[] = [];

  const activeAnchors = inpaint.anchors.filter(a => a.enabled && (page.dialogueMode !== 'clean-vector' || a.kind !== 'bubble'));
  const hasChar = activeAnchors.some(a => a.kind === 'character');
  const mergedBgNotes: string[] = [];
  const kept: ComicAnchor[] = [];
  for (const anchor of activeAnchors) {
    if (hasChar && anchor.kind === 'scene' && /\bno\s+humans\b/i.test(anchor.prompt)) {
      const cleaned = anchor.prompt.replace(/\bno\s+humans\b/gi, '').trim();
      if (cleaned) mergedBgNotes.push(cleaned);
      continue;
    }
    kept.push(anchor);
  }
  if (mergedBgNotes.length > 0) {
    warnings.push('已自动合并重绘区内的纯背景锚点，避免幽灵克隆');
  }

  const stylePrompt = monochrome ? stripColorTagsForMonochrome(page.globalBasePrompt) : page.globalBasePrompt.trim();
  const regionPrompt = monochrome ? stripColorTagsForMonochrome(inpaint.prompt) : inpaint.prompt.trim();
  const mergedBg = monochrome ? stripColorTagsForMonochrome(mergedBgNotes.join(', ')) : mergedBgNotes.join(', ');

  const quality = resolveComicQualityPreset(page.qualityPresetId, page.dialogueMode);

  const framingTags: string[] = [];
  if (monochrome) framingTags.push('monochrome, greyscale, manga, screentone, crisp black ink lineart');
  if (page.dialogueMode === 'clean-vector') framingTags.push('no speech bubbles, no text');
  if (page.dialogueMode === 'empty-bubble') framingTags.push('blank speech bubbles, no text');
  if (quality.extraQualityTags) framingTags.push(quality.extraQualityTags);

  const characters: CharacterParams[] = kept
    .slice(0, COMIC_ANCHOR_HARD_LIMIT)
    .map(anchor => {
      const cleanPrompt = monochrome ? stripColorTagsForMonochrome(anchor.prompt) : anchor.prompt.trim();
      const baseNeg = anchor.negativePrompt.trim();
      let compiledPrompt = cleanPrompt;
      let compiledNeg = monochrome ? cleanCommaList([baseNeg, MONOCHROME_NEGATIVE_TAGS].filter(Boolean).join(', ')) : baseNeg;

      if (anchor.kind === 'bubble') {
        const shape = bubbleShapeTags(anchor.bubbleShape);
        if (page.dialogueMode === 'ai-text' && anchor.bubbleText?.trim()) {
          compiledPrompt = cleanCommaList([shape, cleanPrompt, `Text: ${anchor.bubbleText.trim()}`].filter(Boolean).join(', '));
          compiledNeg = baseNeg;
        } else {
          compiledPrompt = cleanCommaList([shape, 'empty speech bubble, blank speech bubble, no text inside bubble', cleanPrompt].filter(Boolean).join(', '));
          compiledNeg = cleanCommaList([baseNeg, 'text, letters, gibberish, watermark'].filter(Boolean).join(', '));
        }
      } else if (anchor.kind === 'inset') {
        compiledPrompt = cleanCommaList(['inset panel, white bordered close-up box', cleanPrompt].filter(Boolean).join(', '));
      }

      if (!compiledPrompt) return null;
      // 映射到整页底图归一化坐标（Focused 重绘由 naiService.ts 自动转换为裁剪局部坐标）
      const pageX = clampAnchorCoord(safeRect.x + clampAnchorCoord(anchor.x) * safeRect.width);
      const pageY = clampAnchorCoord(safeRect.y + clampAnchorCoord(anchor.y) * safeRect.height);
      return {
        id: anchor.id,
        name: anchor.label,
        enabled: true,
        prompt: compiledPrompt,
        negativePrompt: compiledNeg,
        x: pageX,
        y: pageY,
      } satisfies CharacterParams;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const globalNeg = sanitizeComicNegativeConflicts(page.globalNegativePrompt, monochrome);
  const negParts = [globalNeg, inpaint.negativePrompt.trim()];
  if (monochrome) negParts.push(MONOCHROME_NEGATIVE_TAGS);
  if (page.dialogueMode === 'clean-vector') negParts.push('speech bubble, dialogue, text, watermark');
  if (page.dialogueMode === 'empty-bubble') negParts.push('text, letters, gibberish, speech text');

  const isMedium = isNaiMediumModel(page.v5Model);
  const steps = isMedium ? 14 : (page.steps || getDefaultStepsForModel(page.v5Model));
  const targetRes = inpaint.focused
    ? matchFreeOpusResolution(page.width * safeRect.width, page.height * safeRect.height)
    : matchFreeOpusResolution(page.width, page.height);

  const params: NAIParams = {
    model: page.v5Model,
    width: targetRes.width,
    height: targetRes.height,
    steps,
    scale: page.scale || 5,
    sampler: isMedium ? 'k_euler_ancestral' : (page.sampler || 'k_euler_ancestral'),
    noiseSchedule: page.noiseSchedule || 'karras',
    cfgRescale: isMedium ? 0 : (page.cfgRescale ?? 0),
    variety: page.variety === true,
    qualityPresetId: quality.qualityPresetId,
    ucPresetId: isMedium ? 'heavy' : (page.ucPresetId || 'light'),
    useCoords: characters.length > 0,
    characters,
  };

  // focusedRect 采用底层 prepareImageEdit 期望的像素坐标或归一化？核对 imageEdit.ts 规范：
  // 留给调用方用自然图宽高换算为像素矩形，或此处直接按 page.width/height 换算。
  const imgW = page.aiPage.generatedPageImage?.width || page.width;
  const imgH = page.aiPage.generatedPageImage?.height || page.height;
  // 围绕蒙版向外扩 12% 上下文边距，确保重绘边缘自然融合画格边框
  const padX = safeRect.width * 0.12;
  const padY = safeRect.height * 0.12;
  const fx = Math.max(0, safeRect.x - padX);
  const fy = Math.max(0, safeRect.y - padY);
  const fw = Math.min(1 - fx, safeRect.width + padX * 2);
  const fh = Math.min(1 - fy, safeRect.height + padY * 2);

  return {
    prompt: cleanCommaList([stylePrompt, regionPrompt, mergedBg, ...framingTags].filter(Boolean).join(', ')),
    negative: cleanCommaList(negParts.filter(Boolean).join(', ')),
    params,
    strength: Math.max(0.4, Math.min(0.99, Number.isFinite(inpaint.strength) ? inpaint.strength : 0.85)),
    focused: Boolean(inpaint.focused),
    focusedRect: {
      x: Math.round(fx * imgW),
      y: Math.round(fy * imgH),
      width: Math.max(64, Math.round(fw * imgW)),
      height: Math.max(64, Math.round(fh * imgH)),
    },
    warnings,
  };
};

/**
 * 将已生成的整页图片 URL 转为 DataURL 并读出其真实像素尺寸（供 prepareImageEdit 与蒙版精确对齐）。
 */
export const loadImageAsDataUrl = async (url: string): Promise<{ dataUrl: string; width: number; height: number }> => {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('加载底图失败，无法启动局部重绘'));
    el.src = url;
  });
  const width = Math.max(64, img.naturalWidth || 832);
  const height = Math.max(64, img.naturalHeight || 1216);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('重绘底图画布初始化失败');
  ctx.drawImage(img, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL('image/png'), width, height };
};

