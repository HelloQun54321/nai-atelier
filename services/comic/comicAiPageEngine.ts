import type { CharacterParams, NAIParams } from '../../types';
import { getDefaultStepsForModel, isNaiMediumModel } from '../naiModels';
import { clampAnchorCoord, matchFreeOpusResolution, pointInPolygon } from './comicGeometry';
import {
  collectHardLockedZoneBubbles,
  getGuidePanelPolygon,
  hasAnySlantedEdge,
  hasSteepDiagonalPanels,
  resolveLayoutLockConfig,
  sortGuidePanelsByPriority,
  type ResolvedLayoutLockConfig,
} from './comicLayoutTemplateRenderer';
import {
  assembleV5TextSafePrompt,
  COMIC_ANCHOR_HARD_LIMIT,
  COMIC_ANCHOR_SOFT_LIMIT,
  resolveComicQualityPreset,
  sanitizeComicNegativeConflicts,
} from './comicPromptBuilder';
import type {
  ComicAiGuidePanel,
  ComicAnchor,
  ComicBreakoutZone,
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
  const ordered = sortGuidePanelsByPriority(panels);
  for (const panel of ordered) {
    if (panel.points && panel.points.length >= 3) {
      if (pointInPolygon({ x: anchor.x, y: anchor.y }, panel.points)) {
        return panel.id;
      }
    }
  }
  for (const panel of ordered) {
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

const EXPLICIT_BACKGROUND_REGEX = /\b(?:background|indoor|outdoor|room|library|classroom|hallway|corridor|street|alley|city|sky|clouds|sunset|night|evening|rain|snow|forest|park|school|cafe|window|sunlight|moonlight|lighting|shadows|scenery|landscape|beach|train|station|rooftop|bridge|bedroom|kitchen)\b/i;

const BREAKOUT_PROMPT_TAGS = 'out of frame, breaking panel border, overlapping panel borders';

const isAnchorInBreakoutZone = (
  anchor: ComicAnchor,
  originalPageAnchor: ComicAnchor | undefined,
  breakoutZones: ComicBreakoutZone[] | undefined,
): boolean => {
  if (!breakoutZones?.length) return false;
  const pageX = originalPageAnchor?.x ?? anchor.x;
  const pageY = originalPageAnchor?.y ?? anchor.y;
  return breakoutZones.some(bz => (
    bz.anchorId === anchor.id
    || (pageX >= bz.x && pageX <= bz.x + bz.width && pageY >= bz.y && pageY <= bz.y + bz.height)
  ));
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
  layoutLock: ResolvedLayoutLockConfig;
}

/**
 * 根据本区引导格的相对位置生成结构化版式描述。
 * 对斜切、三角、悬浮画中画、无框与含破格页面故意不拼 `3-1 / 2-1 panel arrangement` 行列网格词，
 * 避免模型用平直正交网格理解推翻图生图底图上的非规整几何边界。
 */
const describeZoneLayoutGeometry = (
  localPanels: ComicAiGuidePanel[],
  isFlashback: boolean,
  hasBreakout = false,
): string => {
  if (!localPanels.length) return '';
  if (localPanels.length === 1) return 'single full-bleed comic panel';
  const borderCue = isFlashback
    ? 'crisp white panel borders, black gutters, flashback manga page'
    : 'crisp panel borders, clean wide white gutters';
  const hasInset = localPanels.some(p => Boolean(p.inset));
  const hasBorderless = localPanels.some(p => Boolean(p.borderless));
  const hasDiagonal = hasSteepDiagonalPanels(localPanels) || hasAnySlantedEdge(localPanels);

  if (hasInset || hasBorderless || hasBreakout || hasDiagonal) {
    if (hasInset) return `manga page with floating inset panel, ${borderCue}`;
    if (hasDiagonal) return `${localPanels.length}-panel dynamic diagonal manga page, ${borderCue}`;
    return `${localPanels.length}-panel manga page, ${borderCue}`;
  }

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
  return `${pattern}, ${borderCue}`;
};

const extractEnglishVisualCue = (panel: ComicAiGuidePanel): string => {
  const explicit = (panel.visualNote || '').trim();
  if (explicit) return explicit;
  const summary = (panel.summary || '').trim();
  // 若用户直接在引导格里写了英文镜头/环境描述也自动喂给 V5（纯中文剧情摘要不混入英文 Tag，避免乱码）
  if (summary && /[a-zA-Z]{3,}/.test(summary)) return summary;
  return '';
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 为「自由构图」模式生成单格在页面中的空间分区英文提示（参考 @YILING0013/novelai_local_web，AGPL-3.0）。
 */
const describePanelSpatialZone = (panel: ComicAiGuidePanel): string => {
  const pts = panel.points && panel.points.length >= 3 ? panel.points : null;
  const cx = pts
    ? pts.reduce((sum, pt) => sum + pt.x, 0) / pts.length
    : panel.x + panel.width / 2;
  const cy = pts
    ? pts.reduce((sum, pt) => sum + pt.y, 0) / pts.length
    : panel.y + panel.height / 2;
  const vBand = cy < 0.34 ? 'upper' : cy > 0.66 ? 'lower' : 'middle';
  const hBand = cx < 0.34 ? 'left' : cx > 0.66 ? 'right' : 'center';
  if (panel.inset) return `overlapping inset panel in ${vBand} ${hBand} area`;
  if (panel.width >= 0.72) return `${vBand} wide panel`;
  return `${vBand} ${hBand} area`;
};

/**
 * 启用 ai-text 时清理画面描述里重复引号台词，避免与末尾 `Text:` 冲突或被画进背景。
 */
const stripDuplicateBubbleDialogue = (prompt: string, bubbleText?: string): string => {
  const literal = (bubbleText || '').trim();
  if (!literal || !prompt.trim()) return prompt.trim();
  const escaped = escapeRegExp(literal);
  const dupPattern = new RegExp(
    `(?:\\b(?:saying|speaking|shouting|whispering|thinking)\\b\\s*)?(?:["'「『]${escaped}["'」』])`,
    'gi',
  );
  return cleanCommaList(prompt.replace(dupPattern, ''));
};

/**
 * 为 AI 整页的某一个生成区（单区整页或双区之一）编译 V5 请求。
 * 严格遵循：
 * - 总词只写版式几何不剧透单格剧情；
 * - 各格镜头环境词馈入对应格锚点，未写背景的格主锚点自动补入全页 sceneAtmosphere 杜绝双区光照割裂；
 * - 破格前景块内的锚点自动附带 out of frame / breaking panel border；
 * - 黑白净色仅作用于描述区副本，所有 `Text:` 永远放在整段 caption 绝对末尾；
 * - 双区可通过 options.sharedSeed 共享一致种子。
 */
export const buildAiPageZoneRequest = (
  page: ComicPageDraft,
  zone: ComicAiCompiledZone,
  totalZoneCount: number,
  options?: { sharedSeed?: number },
): CompiledAiZoneRequest => {
  const warnings: string[] = [];
  const monochrome = page.colorMode === 'monochrome';
  const layoutLock = resolveLayoutLockConfig(page);
  const isFlashback = layoutLock.gutterStyle === 'black-flashback';
  const sceneAtmosphere = (page.aiPage.sceneAtmosphere || '').trim();

  const localPanels: ComicAiGuidePanel[] = zone.guidePanels.map(p => {
    const poly = getGuidePanelPolygon(p);
    return {
      ...p,
      x: (p.x - zone.rect.x) / Math.max(0.05, zone.rect.width),
      y: (p.y - zone.rect.y) / Math.max(0.05, zone.rect.height),
      width: p.width / Math.max(0.05, zone.rect.width),
      height: p.height / Math.max(0.05, zone.rect.height),
      points: poly.map(pt => ({
        x: (pt.x - zone.rect.x) / Math.max(0.05, zone.rect.width),
        y: (pt.y - zone.rect.y) / Math.max(0.05, zone.rect.height),
      })),
    };
  });

  const originalAnchorById = new Map(page.aiPage.anchors.map(a => [a.id, a]));

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
  const panelsWithBackgroundCue = new Set<string>();
  for (const lp of localPanels) {
    const cue = panelVisualCueById.get(lp.id) || '';
    if (EXPLICIT_BACKGROUND_REGEX.test(cue)) panelsWithBackgroundCue.add(lp.id);
  }
  for (const anchor of kept) {
    if (anchor.kind === 'bubble') continue;
    const pid = findContainingGuidePanelId(anchor, localPanels);
    if (pid) {
      panelsCoveredByAnchors.add(pid);
      if (EXPLICIT_BACKGROUND_REGEX.test(anchor.prompt)) panelsWithBackgroundCue.add(pid);
    }
  }

  const capped = kept.slice(0, COMIC_ANCHOR_HARD_LIMIT);

  const isInfillLock = layoutLock.enabled && layoutLock.mode === 'infill';
  const isFreeTxt2Img = layoutLock.mode === 'txt2img';
  const panelNumberById = new Map<string, number>();
  localPanels.forEach((lp, idx) => panelNumberById.set(lp.id, idx + 1));

  const hasLockedBubbleShapes = isInfillLock
    && page.dialogueMode !== 'ai-text'
    && page.aiPage.carveBubbleHoles !== false
    && collectHardLockedZoneBubbles(page, zone.rect, zone.resolution.width, zone.resolution.height).length > 0;

  const panelCountInZone = Math.max(1, zone.guidePanels.length);
  const hasBreakout = (page.aiPage.breakoutZones?.length ?? 0) > 0;
  const geometryCue = describeZoneLayoutGeometry(localPanels, isFlashback, hasBreakout);
  const rawLayoutHint = page.aiPage.layoutHint.trim();
  const shapeCleanedHint = isInfillLock
    ? rawLayoutHint.replace(/\b(?:circular|round|rounded|oval)\s+panels?\b/gi, '')
    : rawLayoutHint;
  const normalizedLayoutHint = isFlashback
    ? shapeCleanedHint.replace(/\b(?:clean\s+)?white\s+gutters?\b/gi, 'black gutters')
    : shapeCleanedHint;
  const layoutShell = totalZoneCount === 1
    ? cleanCommaList([normalizedLayoutHint || `${panelCountInZone}-panel manga page`, geometryCue].filter(Boolean).join(', '))
    : cleanCommaList([`${panelCountInZone}-panel comic strip section`, geometryCue].filter(Boolean).join(', '));

  const quality = resolveComicQualityPreset(page.qualityPresetId, page.dialogueMode);

  const framingTags: string[] = [layoutShell];
  if (isFreeTxt2Img) {
    // 自由构图无物理掩码锁框：借鉴 @YILING0013/novelai_local_web 软分镜语法，在总词按序声明各格空间分区
    if (localPanels.length > 1 && !/\bmultiple\s+views\b/i.test(`${page.globalBasePrompt}, ${layoutShell}`)) {
      framingTags.push('comic, multiple views');
    }
    if (localPanels.some(p => Boolean(p.inset))) {
      framingTags.push('1.4::overlapping panels::');
    }
    if (localPanels.length > 1 || localPanels.some(lp => Boolean(panelVisualCueById.get(lp.id)))) {
      localPanels.forEach((lp, idx) => {
        const zoneDesc = describePanelSpatialZone(lp);
        const cue = panelVisualCueById.get(lp.id) || '';
        framingTags.push(cue ? `Panel ${idx + 1} (${zoneDesc}): ${cue}` : `Panel ${idx + 1} (${zoneDesc})`);
      });
    }
    if (sceneAtmosphere) {
      framingTags.push(sceneAtmosphere);
    }
  }
  if (isFlashback) framingTags.push('black background page, dark flashback framing');
  if (monochrome) framingTags.push('monochrome, greyscale, manga, screentone, crisp black ink lineart');
  if (page.dialogueMode === 'clean-vector' || hasLockedBubbleShapes) {
    framingTags.push('no speech bubbles, no text');
  } else if (page.dialogueMode === 'empty-bubble') {
    framingTags.push('blank speech bubbles, no text');
  }
  if (quality.extraQualityTags) framingTags.push(quality.extraQualityTags);

  const globalNeg = sanitizeComicNegativeConflicts(page.globalNegativePrompt, monochrome);
  const negParts = [globalNeg];
  if (monochrome) negParts.push(MONOCHROME_NEGATIVE_TAGS);
  if (page.dialogueMode === 'clean-vector' || hasLockedBubbleShapes) {
    negParts.push('speech bubble, dialogue bubble, dialogue, text, letters, gibberish, watermark, caption');
  } else if (page.dialogueMode === 'empty-bubble') {
    negParts.push('text, letters, gibberish, speech text, japanese text, english text');
  }

  const effectiveAnchorsForCaptions = hasLockedBubbleShapes
    ? capped.filter(a => a.kind !== 'bubble')
    : capped;

  const panelCueInjected = new Set<string>();
  const panelAtmosphereInjected = new Set<string>();
  const characters: CharacterParams[] = effectiveAnchorsForCaptions
    .map(anchor => {
      const pid = findContainingGuidePanelId(anchor, localPanels);
      const mergedNote = anchor.kind === 'character' && pid ? (mergedBgNotes.get(pid) || []).join(', ') : '';
      // 将所属引导格的英文镜头/环境词注入该格首个主要锚点，让每格镜头与光影衔接生效且绝不串格
      const panelCue = pid && (anchor.kind === 'character' || anchor.kind === 'scene') && !panelCueInjected.has(pid)
        ? (panelVisualCueById.get(pid) || '')
        : '';
      if (panelCue && pid) panelCueInjected.add(pid);

      // 双区光照一致性修复：若该格内锚点与镜头词均未写背景/光照描述，自动将全页 sceneAtmosphere 注入该格主锚点
      const needsAtmosphere = Boolean(
        sceneAtmosphere
        && pid
        && (anchor.kind === 'character' || anchor.kind === 'scene')
        && !panelsWithBackgroundCue.has(pid)
        && !panelAtmosphereInjected.has(pid),
      );
      if (needsAtmosphere && pid) panelAtmosphereInjected.add(pid);
      const atmosphereNote = needsAtmosphere ? sceneAtmosphere : '';

      // 破格前景块自动注入破格引导词
      const inBreakout = anchor.kind !== 'bubble'
        && isAnchorInBreakoutZone(anchor, originalAnchorById.get(anchor.id), page.aiPage.breakoutZones);
      const breakoutNote = inBreakout && !/\bout\s+of\s+frame\b/i.test(anchor.prompt)
        ? BREAKOUT_PROMPT_TAGS
        : '';

      const panelNum = pid ? panelNumberById.get(pid) : undefined;
      const panelPrefix = isFreeTxt2Img && panelNum !== undefined && !/\bpanel\s+\d+\b/i.test(anchor.prompt)
        ? `panel ${panelNum}`
        : '';

      const baseNeg = anchor.negativePrompt.trim();
      let compiledPrompt = '';
      let compiledNeg = monochrome ? cleanCommaList([baseNeg, MONOCHROME_NEGATIVE_TAGS].filter(Boolean).join(', ')) : baseNeg;

      if (anchor.kind === 'bubble') {
        const shape = bubbleShapeTags(anchor.bubbleShape);
        if (page.dialogueMode === 'ai-text' && anchor.bubbleText?.trim()) {
          const cleanedBubblePrompt = stripDuplicateBubbleDialogue(anchor.prompt, anchor.bubbleText);
          compiledPrompt = assembleV5TextSafePrompt([shape, cleanedBubblePrompt], {
            monochrome,
            explicitText: anchor.bubbleText.trim(),
          });
          compiledNeg = baseNeg;
        } else {
          compiledPrompt = assembleV5TextSafePrompt(
            [shape, 'empty speech bubble, blank speech bubble, no text inside bubble', anchor.prompt],
            { monochrome },
          );
          compiledNeg = cleanCommaList([baseNeg, 'text, letters, gibberish, watermark'].filter(Boolean).join(', '));
        }
      } else if (anchor.kind === 'inset') {
        compiledPrompt = assembleV5TextSafePrompt(
          [panelPrefix, 'inset panel, white bordered close-up box, picture-in-picture', anchor.prompt, breakoutNote],
          { monochrome },
        );
      } else {
        compiledPrompt = assembleV5TextSafePrompt(
          [panelPrefix, anchor.prompt, panelCue, atmosphereNote, mergedNote, breakoutNote],
          { monochrome },
        );
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
    const extraAtmosphere = sceneAtmosphere && !EXPLICIT_BACKGROUND_REGEX.test(cue) ? sceneAtmosphere : '';
    const panelNum = panelNumberById.get(lp.id);
    const panelPrefix = isFreeTxt2Img && panelNum !== undefined && !/\bpanel\s+\d+\b/i.test(cue)
      ? `panel ${panelNum}`
      : '';
    const compiledCue = assembleV5TextSafePrompt([panelPrefix, cue, extraAtmosphere], { monochrome });
    if (!compiledCue) continue;
    characters.push({
      id: `guide-cue-${lp.id}`,
      name: lp.label,
      enabled: true,
      prompt: compiledCue,
      negativePrompt: monochrome ? MONOCHROME_NEGATIVE_TAGS : '',
      x: clampAnchorCoord(lp.x + lp.width / 2),
      y: clampAnchorCoord(lp.y + lp.height / 2),
    });
  }

  const isMedium = isNaiMediumModel(page.v5Model);
  const steps = isMedium ? 14 : (page.steps || getDefaultStepsForModel(page.v5Model));
  const effectiveSeed = page.seed !== undefined ? page.seed : options?.sharedSeed;

  // 尊重 V5 能力边界：不拼接 vibes 或 characterReferences
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
    qualityPresetId: quality.qualityPresetId,
    ucPresetId: isMedium ? 'heavy' : (page.ucPresetId || 'light'),
    ...(effectiveSeed !== undefined ? { seed: effectiveSeed } : {}),
    useCoords: characters.length > 0,
    characters,
  };

  return {
    prompt: assembleV5TextSafePrompt([page.globalBasePrompt, ...framingTags], { monochrome }),
    negative: cleanCommaList(negParts.filter(Boolean).join(', ')),
    params,
    warnings,
    layoutLock,
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
