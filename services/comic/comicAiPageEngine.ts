import type { CharacterParams, NAIParams } from '../../types';
import { getDefaultStepsForModel, isNaiMediumModel } from '../naiModels';
import { clampAnchorCoord, matchFreeOpusResolution } from './comicGeometry';
import {
  COMIC_ANCHOR_HARD_LIMIT,
  COMIC_ANCHOR_SOFT_LIMIT,
  sanitizeComicNegativeConflicts,
  stripColorTagsForMonochrome,
} from './comicPromptBuilder';
import type {
  ComicAiGuidePanel,
  ComicAnchor,
  ComicBubbleShape,
  ComicDialogueMode,
  ComicPageDraft,
} from './comicTypes';

export interface ComicAiZoneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComicAiCompiledZone {
  zoneIndex: 0 | 1;
  label: string;
  rect: ComicAiZoneRect;
  resolution: { width: number; height: number };
  guidePanels: ComicAiGuidePanel[];
  /** 已重映射到当前生成区局部坐标 (0..1) 的锚点列表。 */
  localAnchors: ComicAnchor[];
  activeSlotCount: number;
  mergedGhostBgCount: number;
  guardLevel: 'ok' | 'soft-warning' | 'hard-exceeded';
}

export interface ComicAiZonePlan {
  effectiveSplit: 'single' | 'dual-vertical' | 'dual-horizontal';
  splitRatio: number;
  autoSplitTriggered: boolean;
  recommendDualSplit: boolean;
  totalPanels: number;
  totalActiveAnchors: number;
  zones: ComicAiCompiledZone[];
  overallLevel: 'ok' | 'soft-warning' | 'hard-exceeded';
}

const MONOCHROME_NEGATIVE_TAGS = 'color, colored, colorful, vibrant colors, full color, chromatic, red, blue, green, yellow, pink, purple, orange';

const cleanCommaList = (text: string): string => text
  .split(',')
  .map(part => part.replace(/\s+/g, ' ').trim())
  .filter(Boolean)
  .join(', ');

const bubbleShapeTags = (shape: ComicBubbleShape | undefined): string => {
  switch (shape) {
    case 'shout':
      return 'jagged speech bubble, spiky shout bubble, white opaque bubble';
    case 'thought':
      return 'cloud thought bubble, fluffy thought bubble, white opaque bubble';
    case 'caption':
      return 'rectangular narration box, white caption box';
    case 'oval':
    default:
      return 'oval speech bubble, white opaque speech bubble';
  }
};

/** 寻找最贴近 0.5 且尽量不横穿任何引导区内部的自然分镜缝坐标。 */
const findCleanSplitRatio = (
  guidePanels: ComicAiGuidePanel[],
  axis: 'vertical' | 'horizontal',
): number => {
  if (guidePanels.length <= 1) return 0.5;
  const candidates = new Set<number>([0.5]);
  for (const p of guidePanels) {
    const start = axis === 'vertical' ? p.y : p.x;
    const end = axis === 'vertical' ? p.y + p.height : p.x + p.width;
    if (start > 0.25 && start < 0.75) candidates.add(Math.round(start * 1000) / 1000);
    if (end > 0.25 && end < 0.75) candidates.add(Math.round(end * 1000) / 1000);
  }
  let best = 0.5;
  let bestScore = Infinity;
  for (const c of candidates) {
    let cuts = 0;
    let countA = 0;
    let countB = 0;
    for (const p of guidePanels) {
      const start = axis === 'vertical' ? p.y : p.x;
      const end = axis === 'vertical' ? p.y + p.height : p.x + p.width;
      const mid = (start + end) / 2;
      if (start + 0.015 < c && end - 0.015 > c) cuts += 1;
      if (mid < c) countA += 1;
      else countB += 1;
    }
    const imbalance = Math.abs(countA - countB);
    const score = cuts * 10 + imbalance * 1.5 + Math.abs(c - 0.5) * 4;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return Math.min(0.72, Math.max(0.28, best));
};

const findContainingGuidePanelId = (
  anchor: ComicAnchor,
  panels: ComicAiGuidePanel[],
): string | null => {
  for (const panel of panels) {
    if (
      anchor.x >= panel.x - 0.01
      && anchor.x <= panel.x + panel.width + 0.01
      && anchor.y >= panel.y - 0.01
      && anchor.y <= panel.y + panel.height + 0.01
    ) {
      return panel.id;
    }
  }
  return null;
};

/**
 * 统计某区内有效槽位数并应用「有人格禁止独立 no humans 纯背景槽」防幽灵克隆规则。
 */
const filterZoneAnchorsWithGhostRule = (
  anchors: ComicAnchor[],
  panels: ComicAiGuidePanel[],
  dialogueMode: ComicDialogueMode,
): { kept: ComicAnchor[]; mergedBgNotes: Map<string, string[]>; mergedGhostBgCount: number } => {
  const active = anchors.filter(a => a.enabled && (dialogueMode !== 'clean-vector' || a.kind !== 'bubble'));
  const panelsWithChar = new Set<string>();
  for (const anchor of active) {
    if (anchor.kind === 'character') {
      const pid = findContainingGuidePanelId(anchor, panels);
      if (pid) panelsWithChar.add(pid);
    }
  }

  const kept: ComicAnchor[] = [];
  const mergedBgNotes = new Map<string, string[]>();
  let mergedGhostBgCount = 0;

  for (const anchor of active) {
    if (anchor.kind === 'scene' && /\bno\s+humans\b/i.test(anchor.prompt)) {
      const pid = findContainingGuidePanelId(anchor, panels);
      if (pid && panelsWithChar.has(pid)) {
        mergedGhostBgCount += 1;
        const cleaned = anchor.prompt.replace(/\bno\s+humans\b/gi, '').trim();
        if (cleaned) {
          mergedBgNotes.set(pid, [...(mergedBgNotes.get(pid) || []), cleaned]);
        }
        continue;
      }
    }
    kept.push(anchor);
  }
  return { kept, mergedBgNotes, mergedGhostBgCount };
};

/**
 * 根据整页画幅、分镜数量与四类空间锚点数，自动规划单区或上下/左右双区（均走 Opus 免费档）。
 */
export const planComicAiZones = (page: ComicPageDraft): ComicAiZonePlan => {
  const aiPage = page.aiPage;
  const isLandscape = page.width > page.height;
  const maxSinglePanels = isLandscape ? 6 : 5;
  const totalPanels = aiPage.guidePanels.length;

  const wholeFiltered = filterZoneAnchorsWithGhostRule(aiPage.anchors, aiPage.guidePanels, page.dialogueMode);
  const totalActiveAnchors = wholeFiltered.kept.length;

  const exceedSweetSpot = totalPanels > maxSinglePanels || totalActiveAnchors > COMIC_ANCHOR_SOFT_LIMIT;
  let effectiveSplit: 'single' | 'dual-vertical' | 'dual-horizontal';
  let autoSplitTriggered = false;

  if (aiPage.splitMode === 'single') {
    effectiveSplit = 'single';
  } else if (aiPage.splitMode === 'dual-vertical') {
    effectiveSplit = 'dual-vertical';
  } else if (aiPage.splitMode === 'dual-horizontal') {
    effectiveSplit = 'dual-horizontal';
  } else if (exceedSweetSpot) {
    effectiveSplit = isLandscape ? 'dual-horizontal' : 'dual-vertical';
    autoSplitTriggered = true;
  } else {
    effectiveSplit = 'single';
  }

  const buildZone = (zoneIndex: 0 | 1, label: string, rect: ComicAiZoneRect): ComicAiCompiledZone => {
    const zonePanels = aiPage.guidePanels.filter(p => {
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      return cx >= rect.x && cx <= rect.x + rect.width + 1e-6 && cy >= rect.y && cy <= rect.y + rect.height + 1e-6;
    });
    const zoneAnchors = aiPage.anchors
      .filter(a => {
        if (!a.enabled) return false;
        if (effectiveSplit === 'single') return true;
        if (effectiveSplit === 'dual-vertical') {
          return zoneIndex === 0 ? a.y < rect.y + rect.height : a.y >= rect.y;
        }
        return zoneIndex === 0 ? a.x < rect.x + rect.width : a.x >= rect.x;
      })
      .map(a => ({
        ...a,
        x: clampAnchorCoord((a.x - rect.x) / Math.max(0.05, rect.width)),
        y: clampAnchorCoord((a.y - rect.y) / Math.max(0.05, rect.height)),
      }));

    // 用局部坐标对应的简化引导区做防幽灵检测
    const localPanels = zonePanels.map(p => ({
      ...p,
      x: (p.x - rect.x) / Math.max(0.05, rect.width),
      y: (p.y - rect.y) / Math.max(0.05, rect.height),
      width: p.width / Math.max(0.05, rect.width),
      height: p.height / Math.max(0.05, rect.height),
    }));
    const filtered = filterZoneAnchorsWithGhostRule(zoneAnchors, localPanels, page.dialogueMode);
    const activeSlotCount = filtered.kept.length;
    const guardLevel = activeSlotCount > COMIC_ANCHOR_HARD_LIMIT
      ? 'hard-exceeded'
      : activeSlotCount > COMIC_ANCHOR_SOFT_LIMIT
        ? 'soft-warning'
        : 'ok';

    const resolution = matchFreeOpusResolution(page.width * rect.width, page.height * rect.height);
    return {
      zoneIndex,
      label,
      rect,
      resolution,
      guidePanels: zonePanels,
      localAnchors: zoneAnchors,
      activeSlotCount,
      mergedGhostBgCount: filtered.mergedGhostBgCount,
      guardLevel,
    };
  };

  let splitRatio = 0.5;
  let zones: ComicAiCompiledZone[];
  if (effectiveSplit === 'single') {
    zones = [buildZone(0, '整页单区', { x: 0, y: 0, width: 1, height: 1 })];
  } else if (effectiveSplit === 'dual-vertical') {
    splitRatio = findCleanSplitRatio(aiPage.guidePanels, 'vertical');
    zones = [
      buildZone(0, '上半页（区 1）', { x: 0, y: 0, width: 1, height: splitRatio }),
      buildZone(1, '下半页（区 2）', { x: 0, y: splitRatio, width: 1, height: 1 - splitRatio }),
    ];
  } else {
    splitRatio = findCleanSplitRatio(aiPage.guidePanels, 'horizontal');
    zones = [
      buildZone(0, '左半页（区 1）', { x: 0, y: 0, width: splitRatio, height: 1 }),
      buildZone(1, '右半页（区 2）', { x: splitRatio, y: 0, width: 1 - splitRatio, height: 1 }),
    ];
  }

  const overallLevel = zones.some(z => z.guardLevel === 'hard-exceeded')
    ? 'hard-exceeded'
    : zones.some(z => z.guardLevel === 'soft-warning')
      ? 'soft-warning'
      : 'ok';

  return {
    effectiveSplit,
    splitRatio,
    autoSplitTriggered,
    recommendDualSplit: effectiveSplit === 'single' && exceedSweetSpot,
    totalPanels,
    totalActiveAnchors,
    zones,
    overallLevel,
  };
};

export interface CompiledAiZoneRequest {
  prompt: string;
  negative: string;
  params: NAIParams;
  warnings: string[];
}

/** 根据本区引导格的相对位置生成不含人物剧透的结构化版式描述（如 top wide panel, middle split panels）。 */
const describeZoneLayoutGeometry = (localPanels: ComicAiGuidePanel[]): string => {
  if (!localPanels.length) return '';
  if (localPanels.length === 1) return 'single full-bleed comic panel';
  const sorted = [...localPanels].sort((a, b) => (Math.abs(a.y - b.y) > 0.08 ? a.y - b.y : a.x - b.x));
  const rowCounts: number[] = [];
  let lastY = sorted[0].y;
  let currentCount = 0;
  for (const p of sorted) {
    if (Math.abs(p.y - lastY) > 0.12 && currentCount > 0) {
      rowCounts.push(currentCount);
      currentCount = 0;
      lastY = p.y;
    }
    currentCount += 1;
  }
  if (currentCount > 0) rowCounts.push(currentCount);
  const pattern = rowCounts.length >= 2 ? `${rowCounts.join('-')} panel arrangement` : `${localPanels.length}-panel layout`;
  return `${pattern}, crisp panel borders, clean white gutters`;
};

const extractEnglishVisualCue = (panel: ComicAiGuidePanel): string => {
  const explicit = (panel.visualNote || '').trim();
  if (explicit) return explicit;
  const summary = (panel.summary || '').trim();
  // 若用户直接在引导格里写了英文镜头/环境描述也自动喂给 V5（纯中文剧情摘要不混入英文 Tag，避免乱码）
  if (summary && /[a-zA-Z]{3,}/.test(summary)) return summary;
  return '';
};

/**
 * 为 AI 整页的某一个生成区（单区整页或双区之一）编译 V5 请求。
 * 严格遵循：总词只写版式几何不剧透单格剧情、各格镜头环境词馈入对应格锚点（无锚点格自动补中点槽）、
 * 黑白净色仅作用于发送副本、有人格合并背景防幽灵克隆、气泡锚点支持空泡或短 Text:。
 */
export const buildAiPageZoneRequest = (
  page: ComicPageDraft,
  zone: ComicAiCompiledZone,
  totalZoneCount: number,
): CompiledAiZoneRequest => {
  const warnings: string[] = [];
  const monochrome = page.colorMode === 'monochrome';

  const localPanels = zone.guidePanels.map(p => ({
    ...p,
    x: (p.x - zone.rect.x) / Math.max(0.05, zone.rect.width),
    y: (p.y - zone.rect.y) / Math.max(0.05, zone.rect.height),
    width: p.width / Math.max(0.05, zone.rect.width),
    height: p.height / Math.max(0.05, zone.rect.height),
  }));

  const { kept, mergedBgNotes, mergedGhostBgCount } = filterZoneAnchorsWithGhostRule(
    zone.localAnchors,
    localPanels,
    page.dialogueMode,
  );
  if (mergedGhostBgCount > 0) {
    warnings.push(`${zone.label}已自动合并 ${mergedGhostBgCount} 个同格背景点，避免幽灵克隆`);
  }

  const panelVisualCueById = new Map<string, string>();
  for (const lp of localPanels) {
    const cue = extractEnglishVisualCue(lp);
    if (cue) panelVisualCueById.set(lp.id, cue);
  }
  const panelsCoveredByAnchors = new Set<string>();
  for (const anchor of kept) {
    if (anchor.kind === 'bubble') continue;
    const pid = findContainingGuidePanelId(anchor, localPanels);
    if (pid) panelsCoveredByAnchors.add(pid);
  }

  const capped = kept.slice(0, COMIC_ANCHOR_HARD_LIMIT);
  const stylePrompt = monochrome
    ? stripColorTagsForMonochrome(page.globalBasePrompt)
    : page.globalBasePrompt.trim();

  const panelCountInZone = Math.max(1, zone.guidePanels.length);
  const geometryCue = describeZoneLayoutGeometry(localPanels);
  const layoutShell = totalZoneCount === 1
    ? cleanCommaList([page.aiPage.layoutHint.trim() || `${panelCountInZone}-panel manga page`, geometryCue].filter(Boolean).join(', '))
    : cleanCommaList([`${panelCountInZone}-panel comic strip section`, geometryCue].filter(Boolean).join(', '));

  const framingTags: string[] = [layoutShell];
  if (monochrome) framingTags.push('monochrome, greyscale, manga, screentone, crisp black ink lineart');
  if (page.dialogueMode === 'clean-vector') framingTags.push('no speech bubbles, no text');
  if (page.dialogueMode === 'empty-bubble') framingTags.push('blank speech bubbles, no text');

  const globalNeg = sanitizeComicNegativeConflicts(page.globalNegativePrompt, monochrome);
  const negParts = [globalNeg];
  if (monochrome) negParts.push(MONOCHROME_NEGATIVE_TAGS);
  if (page.dialogueMode === 'clean-vector') negParts.push('speech bubble, dialogue, text, watermark, caption');
  if (page.dialogueMode === 'empty-bubble') negParts.push('text, letters, gibberish, speech text, japanese text, english text');

  const panelCueInjected = new Set<string>();
  const characters: CharacterParams[] = capped
    .map(anchor => {
      const pid = findContainingGuidePanelId(anchor, localPanels);
      const mergedNote = anchor.kind === 'character' && pid ? (mergedBgNotes.get(pid) || []).join(', ') : '';
      // 将所属引导格的英文镜头/环境词注入该格首个主要锚点，让每格镜头与光影衔接生效且绝不串格
      const panelCue = pid && (anchor.kind === 'character' || anchor.kind === 'scene') && !panelCueInjected.has(pid)
        ? (panelVisualCueById.get(pid) || '')
        : '';
      if (panelCue && pid) panelCueInjected.add(pid);
      const rawPrompt = [anchor.prompt, panelCue, mergedNote].filter(Boolean).join(', ');
      const cleanPrompt = monochrome ? stripColorTagsForMonochrome(rawPrompt) : rawPrompt.trim();
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
        compiledPrompt = cleanCommaList(['inset panel, white bordered close-up box, picture-in-picture', cleanPrompt].filter(Boolean).join(', '));
      }

      if (!compiledPrompt) return null;
      return {
        id: anchor.id,
        name: anchor.label,
        enabled: true,
        prompt: compiledPrompt,
        negativePrompt: compiledNeg,
        x: clampAnchorCoord(anchor.x),
        y: clampAnchorCoord(anchor.y),
      } satisfies CharacterParams;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // 若某个引导格写了镜头/环境词但未放置任何非气泡锚点，自动在其格心补一个场景锚点（不超过 24 硬上限）
  for (const lp of localPanels) {
    if (characters.length >= COMIC_ANCHOR_HARD_LIMIT) break;
    if (panelsCoveredByAnchors.has(lp.id)) continue;
    const cue = panelVisualCueById.get(lp.id);
    if (!cue) continue;
    const cleanCue = monochrome ? stripColorTagsForMonochrome(cue) : cue;
    if (!cleanCue) continue;
    characters.push({
      id: `guide-cue-${lp.id}`,
      name: lp.label,
      enabled: true,
      prompt: cleanCue,
      negativePrompt: monochrome ? MONOCHROME_NEGATIVE_TAGS : '',
      x: clampAnchorCoord(lp.x + lp.width / 2),
      y: clampAnchorCoord(lp.y + lp.height / 2),
    });
  }

  const isMedium = isNaiMediumModel(page.v5Model);
  const steps = isMedium ? 14 : (page.steps || getDefaultStepsForModel(page.v5Model));

  const params: NAIParams = {
    model: page.v5Model,
    width: zone.resolution.width,
    height: zone.resolution.height,
    steps,
    scale: page.scale || 5,
    sampler: isMedium ? 'k_euler_ancestral' : (page.sampler || 'k_euler_ancestral'),
    noiseSchedule: page.noiseSchedule || 'karras',
    cfgRescale: isMedium ? 0 : (page.cfgRescale ?? 0),
    variety: page.variety === true,
    qualityPresetId: page.qualityPresetId || 'standard',
    ucPresetId: isMedium ? 'heavy' : (page.ucPresetId || 'light'),
    ...(page.seed !== undefined ? { seed: page.seed } : {}),
    useCoords: characters.length > 0,
    characters,
  };

  return {
    prompt: cleanCommaList([stylePrompt, ...framingTags].filter(Boolean).join(', ')),
    negative: cleanCommaList(negParts.filter(Boolean).join(', ')),
    params,
    warnings,
  };
};

const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('加载分区成图失败'));
  img.src = url;
});

/**
 * 将自动拆双区依次生成的两张免费 V5 图片无缝拼合为一张完整高分辨率漫画整页 PNG Blob。
 */
export const stitchAiZoneImages = async (
  zoneImageUrls: [string, string],
  splitAxis: 'dual-vertical' | 'dual-horizontal',
  splitRatio: number,
  pageWidth: number,
  pageHeight: number,
  backgroundColor = '#ffffff',
  gutterPx = 10,
): Promise<Blob> => {
  const [imgA, imgB] = await Promise.all([loadImage(zoneImageUrls[0]), loadImage(zoneImageUrls[1])]);
  const canvas = document.createElement('canvas');
  canvas.width = pageWidth;
  canvas.height = pageHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画布初始化失败');

  ctx.fillStyle = backgroundColor || '#ffffff';
  ctx.fillRect(0, 0, pageWidth, pageHeight);

  const gap = Math.max(0, Math.min(24, gutterPx));
  const halfGap = gap / 2;

  const drawCover = (img: HTMLImageElement, dx: number, dy: number, dw: number, dh: number) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    const scale = Math.max(dw / img.naturalWidth, dh / img.naturalHeight);
    const rw = img.naturalWidth * scale;
    const rh = img.naturalHeight * scale;
    ctx.drawImage(img, dx + (dw - rw) / 2, dy + (dh - rh) / 2, rw, rh);
    ctx.restore();
  };

  if (splitAxis === 'dual-vertical') {
    const splitY = Math.round(pageHeight * splitRatio);
    drawCover(imgA, 0, 0, pageWidth, Math.max(1, splitY - halfGap));
    drawCover(imgB, 0, splitY + halfGap, pageWidth, Math.max(1, pageHeight - splitY - halfGap));
  } else {
    const splitX = Math.round(pageWidth * splitRatio);
    drawCover(imgA, 0, 0, Math.max(1, splitX - halfGap), pageHeight);
    drawCover(imgB, splitX + halfGap, 0, Math.max(1, pageWidth - splitX - halfGap), pageHeight);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('双区拼合导出失败'));
    }, 'image/png');
  });
};
