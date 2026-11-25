// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { OPUS_FREE_PIXEL_LIMIT } from '../../services/aspectRatio';
import {
  buildTemplatePanelsForScope,
  COMIC_LAYOUT_TEMPLATES,
  COMIC_LAYOUT_TEMPLATE_CATEGORIES,
  createGuidePanelsFromTemplate,
  createInitialComicDraft,
  getPanelBoundingBox,
  matchFreeOpusResolution,
  polygonArea,
  rectToPolygon,
  slicePolygonByLine,
  snapComicPoint,
} from '../../services/comic/comicGeometry';
import {
  isPointStrictlyInsidePolygonPx,
  isUsablePolygonPx,
  moveNormalizedPolygonEdge,
  moveNormalizedPolygonVertex,
  placeComicPanelBadgePx,
  preservePanelImageAfterSplit,
  rescaleNormalizedPointsOnCanvasResize,
  sliceAnyPolygonByLine,
  snapComicPanelAngle,
  snapComicPanelDrag,
  splitNormalizedPolygonAlongPath,
} from '../../services/comic/comicSnapping';
import {
  assembleV5TextSafePrompt,
  buildComicPanelGenerationInput,
  COMIC_ANCHOR_HARD_LIMIT,
  COMIC_ANCHOR_SOFT_LIMIT,
  encodeDanbooruCastId,
  evaluateAnchorGuard,
  parseDanbooruCastId,
  resolveComicQualityPreset,
  stripColorTagsForMonochrome,
} from '../../services/comic/comicPromptBuilder';
import {
  buildAiPageZoneRequest,
  planComicAiZones,
} from '../../services/comic/comicAiPageEngine';
import {
  computeNormalizedAssetBox,
  parseSvgViewBoxSize,
  resolveBubbleTextBox,
} from '../../services/comic/comicAssets';
import {
  applyDeterministicSelectiveGrain,
  buildReversePixelLockMaskAlpha,
  collectHardLockedZoneBubbles,
  computeSafeBubbleHoleEllipse,
  getGuidePanelPolygon,
  hasAnySlantedEdge,
  hasSteepDiagonalPanels,
  insetLockPolygonForWideGutter,
  LAYOUT_LOCK_COLORS,
  LAYOUT_LOCK_DEFAULTS,
  LAYOUT_LOCK_PANEL_GRADIENTS,
  mapPagePointToZonePixels,
  quantizeCoverageBlockMaskRgba,
  renderComicZoneLayoutTemplate,
  resolveInfillMaskGeometryParams,
  resolveLayoutLockConfig,
} from '../../services/comic/comicLayoutTemplateRenderer';
import {
  buildEmbeddedBubbleTextItems,
  commitBubbleCandidates,
  detectWhiteBubblesFromPixels,
  prepareBubbleCandidates,
} from '../../services/comic/comicBubbleDetector';
import {
  buildComicBubbleRenderModel,
  buildCurvedTailPath,
  buildOrganicBubbleSvgPath,
  COMIC_BUBBLE_SHAPES,
  computeAutoFitFontSize,
} from '../../services/comic/comicArtwork';
import {
  deleteCustomComicTemplate,
  instantiateCustomTemplatePanels,
  loadCustomComicTemplates,
  saveCustomComicTemplate,
} from '../../services/comic/comicCustomTemplates';
import {
  buildComicInpaintRequest,
  createRectInpaintMaskDataUrl,
} from '../../services/comic/comicInpaintEngine';
import {
  buildComicStoryboardSystemPrompt,
  parseComicStoryboardResponse,
} from '../../services/comic/comicStoryboardAgent.mjs';
import { loadComicDraft, normalizeComicDraft, saveComicDraft } from '../../services/comic/comicStorage';
import {
  appendStrokeToDrawingLayer,
  createDrawingLayerInDraft,
  createGroupLayerInDraft,
  createImageLayerInDraft,
  deleteLayerInDraft,
  duplicateLayerInDraft,
  mergeLayerDownInDraft,
  reorderLayerStack,
  resolveEffectiveLayerProps,
  syncComicLayerStack,
} from '../../services/comic/comicLayers';
import type { ComicAiLayoutLockMode, ComicAnchor, ComicStroke } from '../../services/comic/comicTypes';

describe('comicGeometry & free Opus resolution matching', () => {
  it('matches Opus-free 64-aligned resolutions for portrait, landscape, square, and extreme strip panels', () => {
    const cases: Array<[number, number]> = [
      [400, 600],
      [800, 300],
      [500, 500],
      [200, 900],
      [1200, 260],
    ];
    for (const [w, h] of cases) {
      const matched = matchFreeOpusResolution(w, h);
      expect(matched.width % 64).toBe(0);
      expect(matched.height % 64).toBe(0);
      expect(matched.width * matched.height).toBeLessThanOrEqual(OPUS_FREE_PIXEL_LIMIT);
      expect(matched.width).toBeGreaterThanOrEqual(256);
      expect(matched.height).toBeGreaterThanOrEqual(256);
      // 纵横方向必须与目标画框一致
      if (w > h) expect(matched.width).toBeGreaterThan(matched.height);
      if (h > w) expect(matched.height).toBeGreaterThan(matched.width);
    }
  });

  it('slices a rectangular panel diagonally with gutter spacing and does not cut untouched panels', () => {
    const rect = rectToPolygon(0.1, 0.1, 0.8, 0.3);
    const untouchedBottom = rectToPolygon(0.1, 0.6, 0.8, 0.3);
    const result = slicePolygonByLine(rect, { x: 0.5, y: 0.08 }, { x: 0.5, y: 0.42 }, 0.02, 0.02);
    expect(result).not.toBeNull();
    const [polyA, polyB] = result!;
    expect(polyA.length).toBeGreaterThanOrEqual(3);
    expect(polyB.length).toBeGreaterThanOrEqual(3);
    // 线段只划过上方格，下方格绝不能被误切
    expect(slicePolygonByLine(untouchedBottom, { x: 0.5, y: 0.08 }, { x: 0.5, y: 0.42 }, 0.02, 0.02)).toBeNull();
  });

  it('snaps points to page margins and sibling panel edges when enabled', () => {
    const draft = createInitialComicDraft('grid-2x2');
    const bottomRowTopY = draft.panels[2].points[0].y;
    const snapped = snapComicPoint({ x: 0.045, y: bottomRowTopY + 0.002 }, draft.panels, true);
    expect(snapped.point.x).toBeCloseTo(0.04, 3);
    expect(snapped.point.y).toBeCloseTo(bottomRowTopY, 3);
    expect(snapped.guideX).toBeDefined();
    expect(snapped.guideY).toBeDefined();
  });

  it('computes accurate normalized bounding boxes (0..1) without clamping width/height to 1', () => {
    const draft = createInitialComicDraft('classic-4-121');
    const panel1Bounds = getPanelBoundingBox(draft.panels[0].points, 1, 1);
    expect(panel1Bounds.width).toBeCloseTo(0.92, 2);
    expect(panel1Bounds.height).toBeGreaterThan(0.2);
    expect(panel1Bounds.height).toBeLessThan(0.35);
    expect(panel1Bounds.cy).toBeLessThan(0.25);

    const guides = createGuidePanelsFromTemplate('classic-4-121', 832, 1216, 14);
    expect(guides).toHaveLength(4);
    expect(guides[0].height).toBeLessThan(0.35);
    expect(guides[1].width).toBeLessThan(0.5);
  });
});

describe('comicPromptBuilder V5 guardrails & monochrome protection', () => {
  it('strips color hue words on monochrome send copy without mutating original draft', () => {
    const original = '1girl, silver hair, blue eyes, red ribbon, navy sailor uniform, smiling';
    const stripped = stripColorTagsForMonochrome(original);
    expect(stripped).toContain('silver hair');
    expect(stripped).toContain('sailor uniform');
    expect(stripped.toLowerCase()).not.toContain('blue');
    expect(stripped.toLowerCase()).not.toContain('red');
    expect(stripped.toLowerCase()).not.toContain('navy');

    const draft = createInitialComicDraft('single-splash');
    draft.colorMode = 'monochrome';
    draft.globalBasePrompt = 'vibrant colors, masterpiece';
    draft.globalNegativePrompt = 'screentone, halftone, lowres';
    const panel = draft.panels[0];
    panel.prompt = 'standing in sunlit classroom';
    panel.anchors = [
      {
        id: 'c1',
        kind: 'character',
        label: '女主',
        prompt: original,
        negativePrompt: '',
        x: 0.4,
        y: 0.5,
        enabled: true,
      },
    ];

    const compiled = buildComicPanelGenerationInput(draft, panel);
    expect(compiled.prompt).toContain('monochrome');
    expect(compiled.prompt).toContain('screentone');
    expect(compiled.negative.toLowerCase()).not.toContain('screentone');
    expect(compiled.negative.toLowerCase()).toContain('colorful');
    expect(compiled.params.characters?.[0]?.prompt.toLowerCase()).not.toContain('red');
    // 原草稿角色词绝不被修改
    expect(panel.anchors[0].prompt).toBe(original);
  });

  it('merges no-humans background slots into panel description when a character anchor exists (anti-ghost-clone rule)', () => {
    const draft = createInitialComicDraft('single-splash');
    const panel = draft.panels[0];
    panel.anchors = [
      { id: 'c1', kind: 'character', label: '女主', prompt: '1girl, waving', negativePrompt: '', x: 0.35, y: 0.5, enabled: true },
      { id: 'bg1', kind: 'scene', label: '走廊背景', prompt: 'no humans, school hallway, sunset light', negativePrompt: '', x: 0.5, y: 0.5, enabled: true },
    ];

    const compiled = buildComicPanelGenerationInput(draft, panel);
    expect(compiled.params.characters).toHaveLength(1);
    expect(compiled.prompt).toContain('school hallway');
    expect(compiled.prompt.toLowerCase()).not.toContain('no humans');
    expect(compiled.warnings.length).toBeGreaterThan(0);
  });

  it('enforces 12-slot soft warning and 24-slot hard limit', () => {
    const makeAnchors = (count: number): ComicAnchor[] =>
      Array.from({ length: count }, (_, idx) => ({
        id: `a-${idx}`,
        kind: 'character',
        label: `角色 ${idx + 1}`,
        prompt: '1girl',
        negativePrompt: '',
        x: 0.5,
        y: 0.5,
        enabled: true,
      }));

    expect(evaluateAnchorGuard(makeAnchors(COMIC_ANCHOR_SOFT_LIMIT)).level).toBe('ok');
    expect(evaluateAnchorGuard(makeAnchors(COMIC_ANCHOR_SOFT_LIMIT + 1)).level).toBe('soft-warning');
    expect(evaluateAnchorGuard(makeAnchors(COMIC_ANCHOR_HARD_LIMIT)).level).toBe('soft-warning');
    expect(evaluateAnchorGuard(makeAnchors(COMIC_ANCHOR_HARD_LIMIT + 1)).level).toBe('hard-exceeded');
  });

  it('enforces V5 Medium 14 steps & zero cfgRescale automatically', () => {
    const draft = createInitialComicDraft('single-splash');
    draft.v5Model = 'nai-diffusion-5-full-medium';
    draft.steps = 28;
    draft.cfgRescale = 0.5;
    const compiled = buildComicPanelGenerationInput(draft, draft.panels[0]);
    expect(compiled.params.model).toBe('nai-diffusion-5-full-medium');
    expect(compiled.params.steps).toBe(14);
    expect(compiled.params.cfgRescale).toBe(0);
  });
});

describe('comicStorage auto-draft isolation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists and restores comic draft without touching lab session keys', () => {
    localStorage.setItem('nai_lab_workspace_session_playground', '{"untouched":true}');
    const draft = createInitialComicDraft('dynamic-l-shape');
    draft.title = '第 1 话草稿';
    draft.colorMode = 'monochrome';
    expect(saveComicDraft(draft)).toBe(true);

    const loaded = loadComicDraft();
    expect(loaded.title).toBe('第 1 话草稿');
    expect(loaded.colorMode).toBe('monochrome');
    expect(loaded.panels).toHaveLength(4);
    expect(localStorage.getItem('nai_lab_workspace_session_playground')).toBe('{"untouched":true}');
  });

  it('persists and restores aiPage storyboard plan & anchors safely', () => {
    const draft = createInitialComicDraft('4-manga');
    draft.creationMode = 'ai-page';
    draft.aiPage.storyPrompt = '雨夜车站重逢';
    draft.aiPage.splitMode = 'dual-vertical';
    draft.aiPage.anchors = [
      {
        id: 'ai-1',
        kind: 'character',
        label: '女主-格1',
        prompt: '1girl, silver hair, holding umbrella',
        negativePrompt: '',
        x: 0.35,
        y: 0.22,
        enabled: true,
      },
    ];
    expect(saveComicDraft(draft)).toBe(true);
    const loaded = loadComicDraft();
    expect(loaded.creationMode).toBe('ai-page');
    expect(loaded.aiPage.storyPrompt).toBe('雨夜车站重逢');
    expect(loaded.aiPage.splitMode).toBe('dual-vertical');
    expect(loaded.aiPage.anchors).toHaveLength(1);
    expect(loaded.aiPage.anchors[0].label).toBe('女主-格1');
  });

  it('auto-repairs corrupted overflowing guidePanels cached in localStorage', () => {
    const draft = createInitialComicDraft('classic-4-121');
    draft.creationMode = 'ai-page';
    draft.aiPage.guidePanels = [
      { id: 'bad-1', label: '第 1 格', summary: '', x: 0.04, y: 0.04, width: 1, height: 1 },
      { id: 'bad-2', label: '第 2 格', summary: '', x: 0.51, y: 0.35, width: 1, height: 1 },
    ];
    expect(saveComicDraft(draft)).toBe(true);
    const loaded = loadComicDraft();
    expect(loaded.aiPage.guidePanels.every(g => g.x + g.width <= 1.0 && g.y + g.height <= 1.0)).toBe(true);
  });
});

describe('comicStoryboardAgent & comicAiPageEngine (Phase 2)', () => {
  it('parses fenced JSON storyboard responses, clamps coords, and strips bubble anchors in clean-vector mode', () => {
    const raw = [
      '```json',
      JSON.stringify({
        title: '雨中递伞',
        layoutHint: '4-panel manga page, clean white gutters',
        guidePanels: [
          { label: '第 1 格', summary: '雨中教室门口', x: 0.04, y: 0.04, width: 0.92, height: 0.44 },
          { label: '第 2 格', summary: '递出透明雨伞', x: 0.04, y: 0.52, width: 0.92, height: 0.44 },
        ],
        anchors: [
          { kind: 'character', label: '女主-格1', prompt: '1girl, black hair, rain', x: 1.5, y: 0.22 },
          { kind: 'bubble', label: '台词-格2', prompt: 'tail pointing left', x: 0.72, y: 0.65, bubbleShape: 'oval', bubbleText: '一起走吧' },
        ],
      }),
      '```',
    ].join('\n');

    const emptyBubbleParsed = parseComicStoryboardResponse(raw, { dialogueMode: 'empty-bubble' });
    expect(emptyBubbleParsed.title).toBe('雨中递伞');
    expect(emptyBubbleParsed.guidePanels).toHaveLength(2);
    expect(emptyBubbleParsed.anchors).toHaveLength(2);
    expect(emptyBubbleParsed.anchors[0].x).toBeLessThanOrEqual(0.96);
    expect(emptyBubbleParsed.anchors[1].bubbleText).toBe('一起走吧');

    const cleanVectorParsed = parseComicStoryboardResponse(raw, { dialogueMode: 'clean-vector' });
    expect(cleanVectorParsed.anchors).toHaveLength(1);
    expect(cleanVectorParsed.anchors[0].kind).toBe('character');
  });

  it('auto-splits into 2 Opus-free zones when exceeding single-zone panel/slot sweet spot and remaps local coords', () => {
    const draft = createInitialComicDraft('6-grid');
    draft.creationMode = 'ai-page';
    draft.width = 832;
    draft.height = 1216;
    draft.aiPage.splitMode = 'auto';
    draft.aiPage.guidePanels = Array.from({ length: 6 }, (_, i) => ({
      id: `gp-${i}`,
      label: `第 ${i + 1} 格`,
      summary: `剧情 ${i + 1}`,
      x: i % 2 === 0 ? 0.04 : 0.52,
      y: 0.04 + Math.floor(i / 2) * 0.31,
      width: 0.44,
      height: 0.29,
    }));
    draft.aiPage.anchors = [
      { id: 'a1', kind: 'character', label: '上区角色', prompt: '1girl, waving', negativePrompt: '', x: 0.25, y: 0.18, enabled: true },
      { id: 'a2', kind: 'character', label: '下区角色', prompt: '1boy, surprised', negativePrompt: '', x: 0.72, y: 0.82, enabled: true },
    ];

    const plan = planComicAiZones(draft);
    expect(plan.effectiveSplit).toBe('dual-vertical');
    expect(plan.autoSplitTriggered).toBe(true);
    expect(plan.zones).toHaveLength(2);
    for (const z of plan.zones) {
      expect(z.resolution.width * z.resolution.height).toBeLessThanOrEqual(OPUS_FREE_PIXEL_LIMIT);
      expect(z.resolution.width % 64).toBe(0);
      expect(z.resolution.height % 64).toBe(0);
    }
    expect(plan.zones[0].localAnchors).toHaveLength(1);
    expect(plan.zones[1].localAnchors).toHaveLength(1);
    // 下区 y=0.82 重映射到局部坐标后应在 (0.2, 0.9) 之间
    expect(plan.zones[1].localAnchors[0].y).toBeGreaterThan(0.2);
    expect(plan.zones[1].localAnchors[0].y).toBeLessThan(0.95);
  });

  it('enforces anti-ghost-clone merging, monochrome send-copy stripping, and ai-text pinned Text: inside bubble slot', () => {
    const draft = createInitialComicDraft('4-manga');
    draft.creationMode = 'ai-page';
    draft.colorMode = 'monochrome';
    draft.dialogueMode = 'ai-text';
    draft.globalBasePrompt = 'vibrant colors, masterpiece';
    draft.aiPage.splitMode = 'single';
    draft.aiPage.guidePanels = [
      { id: 'gp-1', label: '第 1 格', summary: '走廊相遇', x: 0.04, y: 0.04, width: 0.92, height: 0.44 },
    ];
    const origCharPrompt = '1girl, blue eyes, red scarf, standing';
    draft.aiPage.anchors = [
      { id: 'c1', kind: 'character', label: '女主', prompt: origCharPrompt, negativePrompt: '', x: 0.35, y: 0.25, enabled: true },
      { id: 'bg1', kind: 'scene', label: '背景', prompt: 'no humans, rainy street, lamp post', negativePrompt: '', x: 0.5, y: 0.25, enabled: true },
      { id: 'b1', kind: 'bubble', label: '气泡', prompt: 'tail pointing left', negativePrompt: '', x: 0.72, y: 0.18, enabled: true, bubbleShape: 'shout', bubbleText: '等等!' },
    ];

    const plan = planComicAiZones(draft);
    const compiled = buildAiPageZoneRequest(draft, plan.zones[0], 1);
    // 同格 no humans 背景被合并进角色槽，不会出现独立幽灵背景槽
    expect(compiled.params.characters).toHaveLength(2);
    const charSlot = compiled.params.characters?.[0];
    const bubbleSlot = compiled.params.characters?.[1];
    expect(charSlot?.prompt).toContain('rainy street');
    expect(charSlot?.prompt.toLowerCase()).not.toContain('no humans');
    expect(charSlot?.prompt.toLowerCase()).not.toContain('red');
    expect(charSlot?.prompt.toLowerCase()).not.toContain('blue');
    // 原草稿不被污染
    expect(draft.aiPage.anchors[0].prompt).toBe(origCharPrompt);
    // 气泡锚点内置 Text: 短台词
    expect(bubbleSlot?.prompt).toContain('Text: 等等!');
    expect(bubbleSlot?.prompt).toContain('jagged speech bubble');
  });
});

describe('comicBubbleDetector & comicInpaintEngine (Phase 3)', () => {
  it('detects interior white speech bubbles while rejecting white page borders and matches anchor dialogue', () => {
    const w = 200;
    const h = 300;
    const pixels = new Uint8ClampedArray(w * h * 4);
    // 默认整张图填充白纸边距，再在中间铺灰暗漫画画格底色
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const inBorder = x < 8 || x >= w - 8 || y < 8 || y >= h - 8;
        const val = inBorder ? 255 : 90;
        pixels[idx] = val;
        pixels[idx + 1] = val;
        pixels[idx + 2] = val;
        pixels[idx + 3] = 255;
      }
    }
    const drawWhiteEllipse = (cx: number, cy: number, rx: number, ry: number) => {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          if (x < 0 || x >= w || y < 0 || y >= h) continue;
          const dx = (x - cx) / rx;
          const dy = (y - cy) / ry;
          if (dx * dx + dy * dy <= 1) {
            const idx = (y * w + x) * 4;
            pixels[idx] = 252;
            pixels[idx + 1] = 252;
            pixels[idx + 2] = 252;
            pixels[idx + 3] = 255;
          }
        }
      }
    };
    // 绘制 2 个内部纯白椭圆气泡（右上、左下）
    drawWhiteEllipse(145, 70, 26, 20);
    drawWhiteEllipse(60, 210, 28, 22);

    const detected = detectWhiteBubblesFromPixels(pixels, w, h);
    expect(detected).toHaveLength(2);
    expect(detected[0].x).toBeCloseTo(145 / w, 1);
    expect(detected[0].y).toBeCloseTo(70 / h, 1);
    expect(detected[1].x).toBeCloseTo(60 / w, 1);
    expect(detected[1].y).toBeCloseTo(210 / h, 1);

    const anchors: ComicAnchor[] = [
      { id: 'b1', kind: 'bubble', label: '台词1', prompt: '', negativePrompt: '', x: 0.72, y: 0.24, enabled: true, bubbleShape: 'oval', bubbleText: '下雨了呢' },
      { id: 'b2', kind: 'bubble', label: '台词2', prompt: '', negativePrompt: '', x: 0.30, y: 0.70, enabled: true, bubbleShape: 'shout', bubbleText: '快跑！' },
    ];
    const embedded = buildEmbeddedBubbleTextItems(detected, anchors, []);
    expect(embedded.matchedCount).toBe(2);
    expect(embedded.items).toHaveLength(2);
    expect(embedded.items[0].text).toBe('下雨了呢');
    expect(embedded.items[0].fillColor).toBe('transparent');
    expect(embedded.items[0].strokeWidth).toBe(0);
    expect(embedded.items[1].text).toBe('快跑！');
  });

  it('compiles single-panel inpaint requests with full-page anchor mapping, monochrome stripping, and anti-ghost merge', () => {
    const draft = createInitialComicDraft('classic-4-121');
    draft.creationMode = 'ai-page';
    draft.colorMode = 'monochrome';
    draft.v5Model = 'nai-diffusion-5-full-medium';
    draft.aiPage.generatedPageImage = { url: '/api/local-history/h1/image', width: 832, height: 1216 };

    const compiled = buildComicInpaintRequest(draft, {
      rect: { x: 0.04, y: 0.50, width: 0.44, height: 0.40 },
      prompt: 'red ribbon, fixing smiling expression',
      negativePrompt: '',
      strength: 0.85,
      focused: true,
      anchors: [
        { id: 'ic1', kind: 'character', label: '女主', prompt: '1girl, blue eyes, smiling', negativePrompt: '', x: 0.5, y: 0.5, enabled: true },
        { id: 'ib1', kind: 'scene', label: '背景', prompt: 'no humans, rain window', negativePrompt: '', x: 0.5, y: 0.5, enabled: true },
      ],
    });

    expect(compiled.params.steps).toBe(14);
    expect(compiled.params.characters).toHaveLength(1);
    expect(compiled.prompt).toContain('rain window');
    expect(compiled.prompt.toLowerCase()).not.toContain('red');
    expect(compiled.params.characters?.[0]?.x).toBeCloseTo(0.04 + 0.5 * 0.44, 2);
    expect(compiled.params.characters?.[0]?.y).toBeCloseTo(0.50 + 0.5 * 0.40, 2);
    expect(compiled.focusedRect.width).toBeGreaterThan(200);
  });
});

describe('Comic Studio polish upgrades (layout preservation, visualNote, smart bubble review, artwork, templates)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('locks existing canvas guidePanels when preserveExistingLayout is true and feeds visualNote + seed into V5 generation', () => {
    const existingGuidePanels = [
      { label: '第 1 格', x: 0.04, y: 0.04, width: 0.92, height: 0.30 },
      { label: '第 2 格', x: 0.04, y: 0.38, width: 0.92, height: 0.56 },
    ];
    const llmRaw = JSON.stringify({
      title: '雨夜交汇',
      layoutHint: '2-panel manga page, clean white gutters',
      guidePanels: [
        { label: '第 1 格', summary: '雨滴打在窗玻璃上', visualNote: 'extreme close-up, rain drops on classroom window, moody blue backlight', x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
        { label: '第 2 格', summary: '少女撑伞回眸', visualNote: 'medium shot, low angle, wet street reflection', x: 0.2, y: 0.6, width: 0.6, height: 0.3 },
      ],
      anchors: [
        { kind: 'character', label: '少女-格2', prompt: '1girl, silver hair, holding umbrella', x: 0.5, y: 0.66 },
      ],
    });
    const parsed = parseComicStoryboardResponse(llmRaw, {
      dialogueMode: 'clean-vector',
      existingGuidePanels,
      preserveExistingLayout: true,
    });
    // 严格锁定用户画布参考框几何，不被大模型坐标覆盖
    expect(parsed.guidePanels[0].x).toBe(0.04);
    expect(parsed.guidePanels[0].height).toBe(0.30);
    expect(parsed.guidePanels[0].visualNote).toContain('rain drops');
    expect(parsed.guidePanels[1].height).toBe(0.56);

    const draft = createInitialComicDraft('classic-4-121');
    draft.creationMode = 'ai-page';
    draft.seed = 424242;
    draft.aiPage.splitMode = 'single';
    draft.aiPage.guidePanels = parsed.guidePanels.map((gp, i) => ({ id: `g-${i}`, ...gp }));
    draft.aiPage.anchors = parsed.anchors.map((a, i) => ({ id: `a-${i}`, ...a }));

    const plan = planComicAiZones(draft);
    const compiled = buildAiPageZoneRequest(draft, plan.zones[0], 1);
    expect(compiled.params.seed).toBe(424242);
    // 第 1 格无角色锚点但有 visualNote，应自动合成 1 个场景锚点；第 2 格角色锚点自动融合该格 visualNote
    expect(compiled.params.characters).toHaveLength(2);
    const prompts = (compiled.params.characters || []).map(c => c.prompt);
    expect(prompts.some(p => p.includes('rain drops on classroom window'))).toBe(true);
    expect(prompts.some(p => p.includes('silver hair') && p.includes('medium shot'))).toBe(true);
  });

  it('rejects unoutlined white highlights in monochrome mode while accepting ink-bordered speech bubbles and visual candidate review', () => {
    const w = 200;
    const h = 240;
    const pixels = new Uint8ClampedArray(w * h * 4);
    // 整张黑白灰网点底色（亮度 185，较浅）
    for (let i = 0; i < w * h; i++) {
      pixels[i * 4] = 185;
      pixels[i * 4 + 1] = 185;
      pixels[i * 4 + 2] = 185;
      pixels[i * 4 + 3] = 255;
    }
    const drawEllipse = (cx: number, cy: number, rx: number, ry: number, borderInk: boolean) => {
      for (let y = Math.floor(cy - ry - 3); y <= Math.ceil(cy + ry + 3); y++) {
        for (let x = Math.floor(cx - rx - 3); x <= Math.ceil(cx + rx + 3); x++) {
          if (x < 0 || x >= w || y < 0 || y >= h) continue;
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
          const idx = (y * w + x) * 4;
          if (d <= 1) {
            pixels[idx] = 252;
            pixels[idx + 1] = 252;
            pixels[idx + 2] = 252;
          } else if (borderInk && d <= 1.25) {
            pixels[idx] = 20;
            pixels[idx + 1] = 20;
            pixels[idx + 2] = 20;
          }
        }
      }
    };
    // 上方：有黑墨线闭合边框的真气泡；下方：无黑线边框的人物白色衣服高光区
    drawEllipse(100, 60, 28, 20, true);
    drawEllipse(100, 170, 28, 20, false);

    const monoDetected = detectWhiteBubblesFromPixels(pixels, w, h, { colorMode: 'monochrome' });
    expect(monoDetected).toHaveLength(1);
    expect(monoDetected[0].y).toBeCloseTo(60 / h, 1);

    const candidates = prepareBubbleCandidates(monoDetected, [], []);
    expect(candidates).toHaveLength(1);
    candidates[0].text = '校对后的台词';
    candidates[0].selected = true;
    const committed = commitBubbleCandidates(candidates, { writingMode: 'vertical', pageHeight: 1216 });
    expect(committed).toHaveLength(1);
    expect(committed[0].text).toBe('校对后的台词');
    expect(committed[0].fillColor).toBe('transparent');
  });

  it('auto-fits long dialogue text, generates hand-drawn bubble/tail paths, custom templates, and Danbooru cast IDs', () => {
    const shortSize = computeAutoFitFontSize('你好', 26, 140, 90, 'horizontal');
    const longSize = computeAutoFitFontSize('这是一段非常非常长的漫画台词测试内容用来确认不会溢出截断', 26, 140, 90, 'horizontal');
    expect(shortSize).toBe(26);
    expect(longSize).toBeLessThan(shortSize);
    expect(longSize).toBeGreaterThanOrEqual(10);

    expect(COMIC_BUBBLE_SHAPES).toHaveLength(12);
    for (const shapeMeta of COMIC_BUBBLE_SHAPES) {
      const model = buildComicBubbleRenderModel(100, 60, 90, 50, shapeMeta.id, 'seed-1', {
        enabled: true,
        tx: 165,
        ty: 145,
      });
      expect(model.bodyPath.startsWith('M ')).toBe(true);
      expect(buildOrganicBubbleSvgPath(100, 60, 90, 50, shapeMeta.id, 'seed-1')).toBe(model.bodyPath);
      if (shapeMeta.id === 'concentration') expect(model.radialLines?.length).toBeGreaterThan(50);
      if (shapeMeta.id === 'strokes' || shapeMeta.id === 'double-strokes') expect(model.overrunLines?.length).toBeGreaterThan(4);
      if (shapeMeta.isMindTrail) expect(model.trailPaths).toHaveLength(4);
      else if (shapeMeta.supportsTail) expect(model.tailPath).toContain('Q ');
    }
    const tail = buildCurvedTailPath(100, 60, 90, 50, 150, 140);
    expect(tail).toContain('Q ');

    const draft = createInitialComicDraft('classic-4-121');
    const savedList = saveCustomComicTemplate('我的动作分镜', draft.panels);
    expect(savedList).toHaveLength(1);
    expect(loadCustomComicTemplates()).toHaveLength(1);
    const instantiated = instantiateCustomTemplatePanels(savedList[0]);
    expect(instantiated).toHaveLength(draft.panels.length);
    expect(instantiated[0].id).not.toBe(draft.panels[0].id);
    expect(deleteCustomComicTemplate(savedList[0].id)).toHaveLength(0);

    const encoded = encodeDanbooruCastId('hatsune_miku', '初音未来');
    const parsed = parseDanbooruCastId(encoded);
    expect(parsed).toEqual({ tag: 'hatsune_miku', label: '初音未来', prompt: 'hatsune miku' });
    expect(parseDanbooruCastId('custom-chain-1')).toBeNull();
  });
});

describe('PS-style independent comicLayers engine', () => {
  it('migrates legacy strokes into drawingLayers, synchronizes stack nodes, and cascades group properties', () => {
    const legacyStroke: ComicStroke = {
      id: 'st-1',
      tool: 'brush',
      color: '#111827',
      size: 4,
      opacity: 1,
      points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }],
    };
    const base = createInitialComicDraft('classic-4-121');
    base.strokes = [legacyStroke];
    base.drawingLayers = undefined;
    base.layerStack = undefined;

    const synced = syncComicLayerStack(base);
    expect(synced.drawingLayers).toHaveLength(1);
    expect(synced.drawingLayers?.[0].strokes).toHaveLength(1);
    expect(synced.layerStack?.some(n => n.kind === 'panels')).toBe(true);
    expect(synced.layerStack?.some(n => n.kind === 'drawing')).toBe(true);

    // 新建第二个手绘图层、导入图片图层与图层组
    const { draft: d2, drawingId: draw2Id, layer: draw2Node } = createDrawingLayerInDraft(synced, '网点层');
    expect(d2.drawingLayers).toHaveLength(2);
    const d2WithStroke = appendStrokeToDrawingLayer(d2, draw2Id, { ...legacyStroke, id: 'st-2' });
    expect(d2WithStroke.drawingLayers?.find(dl => dl.id === draw2Id)?.strokes).toHaveLength(1);

    const { draft: d3, layer: imgNode } = createImageLayerInDraft(d2WithStroke, {
      name: '集中线素材',
      url: 'data:image/png;base64,AAA',
      width: 0.5,
      height: 0.5,
    });
    expect(d3.imageLayers).toHaveLength(1);

    const { draft: d4, group } = createGroupLayerInDraft(d3, imgNode.id);
    const updatedStack = (d4.layerStack || []).map(n => (
      n.id === group.id ? { ...n, opacity: 0.5, blendMode: 'multiply' as const, locked: true } : n
    ));
    const childInGroup = updatedStack.find(n => n.id === imgNode.id)!;
    expect(childInGroup.parentId).toBe(group.id);
    const eff = resolveEffectiveLayerProps(childInGroup, updatedStack);
    expect(eff.opacity).toBeCloseTo(0.5, 4);
    expect(eff.blendMode).toBe('multiply');
    expect(eff.locked).toBe(true);
    expect(eff.depth).toBe(1);

    // 拖拽排序：把 draw2Node 移进组内，且禁止把组移入自身子孙
    const movedIntoGroup = reorderLayerStack(updatedStack, draw2Node.id, group.id, 'inside');
    expect(movedIntoGroup.find(n => n.id === draw2Node.id)?.parentId).toBe(group.id);
    const selfNestBlocked = reorderLayerStack(movedIntoGroup, group.id, draw2Node.id, 'inside');
    expect(selfNestBlocked.find(n => n.id === group.id)?.parentId).toBeUndefined();
  });

  it('duplicates, merges drawing layers down, and protects base panels and last drawing layer from deletion', () => {
    const base = syncComicLayerStack(createInitialComicDraft('classic-4-121'));
    const panelsNode = base.layerStack!.find(n => n.kind === 'panels')!;
    const draw1Node = base.layerStack!.find(n => n.kind === 'drawing')!;

    // 底图不可删除；删除最后一个手绘层时自动保留一个空白默认手绘层，确保画笔不失效
    expect(deleteLayerInDraft(base, panelsNode.id).deleted).toBe(false);
    const resetDraw = deleteLayerInDraft(base, draw1Node.id);
    expect(resetDraw.draft.drawingLayers).toHaveLength(1);
    expect(resetDraw.draft.drawingLayers?.[0].strokes).toHaveLength(0);

    // 写入笔画 -> 复制手绘图层 -> 向下合并两个相邻手绘图层
    const s1: ComicStroke = { id: 'a', tool: 'brush', color: '#000', size: 3, opacity: 1, points: [{ x: 0.2, y: 0.2 }] };
    const withStroke = appendStrokeToDrawingLayer(base, draw1Node.refId!, s1);
    const dup = duplicateLayerInDraft(withStroke, draw1Node.id);
    expect(dup.newLayer).toBeTruthy();
    expect(dup.draft.drawingLayers).toHaveLength(2);

    const merged = mergeLayerDownInDraft(dup.draft, dup.newLayer!.id);
    expect(merged.merged).toBe(true);
    expect(merged.draft.drawingLayers).toHaveLength(1);
    expect(merged.draft.drawingLayers?.[0].strokes).toHaveLength(2);
  });
});

describe('V5 img2img hard-lock layout template renderer & AI page upgrades', () => {
  it('applies deterministic selective grain without touching pure white gutters or pure black borders', () => {
    // 像素 0: 纯白格缝 (255,255,255); 像素 1: 纯黑边框 (10,10,10); 像素 2: 格内中性灰 (182,185,192)
    const bufA = new Uint8ClampedArray([
      255, 255, 255, 255,
      10, 10, 10, 255,
      182, 185, 192, 255,
      182, 185, 192, 255,
    ]);
    const bufB = new Uint8ClampedArray(bufA);

    applyDeterministicSelectiveGrain(bufA, 2026, LAYOUT_LOCK_DEFAULTS.grainAmplitude);
    applyDeterministicSelectiveGrain(bufB, 2026, LAYOUT_LOCK_DEFAULTS.grainAmplitude);

    // 确定性复现
    expect(Array.from(bufA)).toEqual(Array.from(bufB));
    // 纯白格缝与纯黑边框必须纹丝不动
    expect(Array.from(bufA.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(bufA.slice(4, 8))).toEqual([10, 10, 10, 255]);
    // 中性灰格内像素叠加 ±13 内亮度颗粒且保持 RGB 同步偏移
    const delta2 = bufA[8] - 182;
    expect(Math.abs(delta2)).toBeLessThanOrEqual(LAYOUT_LOCK_DEFAULTS.grainAmplitude);
    expect(bufA[9] - 185).toBe(delta2);
    expect(bufA[10] - 192).toBe(delta2);
  });

  it('insets bubble white-hole ellipses by >= 3% inside containing panel and maps dual-zone coordinates accurately', () => {
    const panels = [
      { id: 'p1', label: '第 1 格', summary: '', x: 0.04, y: 0.04, width: 0.92, height: 0.44 },
      { id: 'p2', label: '第 2 格', summary: '', x: 0.04, y: 0.52, width: 0.92, height: 0.44, bleed: true },
    ];
    // 故意把气泡点贴近第 1 格左上黑边框
    const edgeBubble: ComicAnchor = {
      id: 'b1',
      kind: 'bubble',
      label: '贴边气泡',
      prompt: '',
      negativePrompt: '',
      x: 0.05,
      y: 0.05,
      enabled: true,
      bubbleWidth: 0.3,
      bubbleHeight: 0.16,
    };

    const hole = computeSafeBubbleHoleEllipse(edgeBubble, panels, { x: 0, y: 0, width: 1, height: 1 }, 832, 1216);
    expect(hole).not.toBeNull();
    // 椭圆外沿必须严格内缩 >= 3% 远离面板边框（0.04 + 0.03 = 0.07）
    expect(hole!.normCx - hole!.normRx).toBeGreaterThanOrEqual(0.04 + 0.03 - 1e-6);
    expect(hole!.normCy - hole!.normRy).toBeGreaterThanOrEqual(0.04 + 0.03 - 1e-6);
    expect(hole!.normCx + hole!.normRx).toBeLessThanOrEqual(0.96 - 0.03 + 1e-6);
    expect(hole!.normCy + hole!.normRy).toBeLessThanOrEqual(0.48 - 0.03 + 1e-6);

    // 出血格紧贴页面边（0 / 1）
    const bleedPoly = getGuidePanelPolygon(panels[1]);
    expect(Math.min(...bleedPoly.map(p => p.x))).toBe(0);
    expect(Math.max(...bleedPoly.map(p => p.x))).toBe(1);
    expect(Math.max(...bleedPoly.map(p => p.y))).toBe(1);

    // 双区下半页坐标投影精确映射
    const mapped = mapPagePointToZonePixels({ x: 0.5, y: 0.75 }, { x: 0, y: 0.5, width: 1, height: 0.5 }, 832, 640);
    expect(mapped.x).toBeCloseTo(416, 1);
    expect(mapped.y).toBeCloseTo(320, 1);
  });

  it('renders black-flashback, inset double-borders, bubble holes, and breakout zones in exact layer order', () => {
    const draft = createInitialComicDraft('action-slash');
    draft.creationMode = 'ai-page';
    draft.aiPage.gutterStyle = 'black-flashback';
    draft.aiPage.carveBubbleHoles = true;
    draft.aiPage.guidePanels = [
      {
        id: 'g1',
        label: '斜切格1',
        summary: '',
        x: 0.04,
        y: 0.04,
        width: 0.92,
        height: 0.44,
        points: [{ x: 0.04, y: 0.04 }, { x: 0.96, y: 0.04 }, { x: 0.96, y: 0.42 }, { x: 0.04, y: 0.50 }],
        speedlines: true,
      },
      {
        id: 'g2',
        label: '画中画',
        summary: '',
        x: 0.55,
        y: 0.54,
        width: 0.36,
        height: 0.36,
        inset: true,
      },
    ];
    draft.aiPage.anchors = [
      { id: 'ab1', kind: 'bubble', label: '台词', prompt: '', negativePrompt: '', x: 0.25, y: 0.22, enabled: true },
    ];
    draft.aiPage.breakoutZones = [
      { id: 'bz1', label: '破格主角', x: 0.3, y: 0.2, width: 0.4, height: 0.55 },
    ];

    const ops: Array<{ op: string; style?: string; width?: number }> = [];
    const mockCtx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineJoin: 'miter',
      lineCap: 'butt',
      globalAlpha: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      clip: () => {},
      translate: () => {},
      rotate: () => {},
      fillRect: () => ops.push({ op: 'fillRect', style: mockCtx.fillStyle }),
      fill: () => ops.push({ op: 'fill', style: mockCtx.fillStyle }),
      stroke: () => ops.push({ op: 'stroke', style: mockCtx.strokeStyle, width: mockCtx.lineWidth }),
      ellipse: () => ops.push({ op: 'ellipse' }),
      strokeText: () => {},
      fillText: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
    };
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => mockCtx,
      toDataURL: () => 'data:image/png;base64,MOCK',
    } as unknown as HTMLCanvasElement;

    const plan = planComicAiZones(draft);
    const rendered = renderComicZoneLayoutTemplate(draft, plan.zones[0], { canvas: mockCanvas, seed: 42 });

    expect(rendered.dataUrl).toBe('data:image/png;base64,MOCK');
    expect(rendered.panelCount).toBe(1);
    expect(rendered.insetCount).toBe(1);
    expect(rendered.bubbleHoleCount).toBe(1);
    expect(rendered.breakoutCount).toBe(1);
    // 1. 黑底回忆杀底色
    expect(ops[0]).toEqual({ op: 'fillRect', style: LAYOUT_LOCK_COLORS.gutterFlashback });
    // 2. 画中画叠框先描 14px*2 白外边再描 5px 黑内框
    expect(ops.some(o => o.op === 'stroke' && o.style === LAYOUT_LOCK_COLORS.insetOuterBorderColor && o.width === LAYOUT_LOCK_DEFAULTS.insetOuterBorderWidth * 2)).toBe(true);
    expect(ops.some(o => o.op === 'stroke' && o.style === LAYOUT_LOCK_COLORS.insetInnerBorderColor && o.width === LAYOUT_LOCK_DEFAULTS.insetInnerBorderWidth)).toBe(true);
    // 3. 破格前景块 11px*2 白外边在最上层
    expect(ops.some(o => o.op === 'stroke' && o.style === LAYOUT_LOCK_COLORS.breakoutBorderColor && o.width === LAYOUT_LOCK_DEFAULTS.breakoutBorderWidth * 2)).toBe(true);
  });

  it('enforces V5 Text: tail-only syntax, dual-zone shared sceneAtmosphere/seed, breakout tags, and two-mode lock defaults', () => {
    // V5 Text: 永远在末尾，黑白模式绝不出现 `Text: BAM!, monochrome`
    const sfxCompiled = assembleV5TextSafePrompt(
      ['dynamic impact, red sparks, Text: BAM!', 'monochrome, greyscale'],
      { monochrome: true },
    );
    expect(sfxCompiled.endsWith('Text: BAM!')).toBe(true);
    expect(sfxCompiled).not.toMatch(/Text:.*monochrome/i);
    expect(sfxCompiled).toContain('monochrome');

    const draft = createInitialComicDraft('classic-4-121');
    expect(draft.dialogueMode).toBe('clean-vector');
    draft.creationMode = 'ai-page';
    draft.colorMode = 'monochrome';
    draft.dialogueMode = 'ai-text';
    draft.aiPage.splitMode = 'dual-vertical';
    draft.aiPage.layoutLockMode = 'infill';
    draft.aiPage.sceneAtmosphere = 'warm afternoon library sunlight';
    draft.aiPage.breakoutZones = [
      { id: 'bz-hero', label: '破格剑士', x: 0.2, y: 0.52, width: 0.5, height: 0.42, anchorId: 'c-bottom' },
    ];
    draft.aiPage.anchors = [
      { id: 'c-top', kind: 'character', label: '女主-上', prompt: '1girl, surprised, blue hair', negativePrompt: '', x: 0.35, y: 0.16, enabled: true },
      { id: 'b-top', kind: 'bubble', label: '音效-上', prompt: 'dramatic action, red flash', negativePrompt: '', x: 0.72, y: 0.18, enabled: true, bubbleShape: 'shout', bubbleText: 'BAM!' },
      { id: 'c-bottom', kind: 'character', label: '男主-下', prompt: '1boy, swinging katana', negativePrompt: '', x: 0.45, y: 0.78, enabled: true },
    ];

    const plan = planComicAiZones(draft);
    expect(plan.zones).toHaveLength(2);

    const req0 = buildAiPageZoneRequest(draft, plan.zones[0], 2, { sharedSeed: 987654 });
    const req1 = buildAiPageZoneRequest(draft, plan.zones[1], 2, { sharedSeed: 987654 });

    // 双区共享同一 Seed 与精准锁框 infill 参数
    expect(req0.params.seed).toBe(987654);
    expect(req1.params.seed).toBe(987654);
    expect(req0.layoutLock).toEqual({
      mode: 'infill',
      enabled: true,
      autoTrimFrames: true,
      strength: 1.0,
      noise: 0,
      colorCorrect: false,
      addOriginalImage: false,
      gutterStyle: 'white',
    });
    // V5 能力边界：不强行拼接 vibes 或 characterReferences
    expect(req0.params.vibes).toBeUndefined();
    expect(req0.params.characterReferences).toBeUndefined();

    // 双区光照一致性：上下两区未写背景的主锚点均自动注入 sceneAtmosphere
    expect(req0.params.characters?.find(c => c.id === 'c-top')?.prompt).toContain('library sunlight');
    expect(req1.params.characters?.find(c => c.id === 'c-bottom')?.prompt).toContain('library sunlight');
    // 破格前景块锚点自动附带 out of frame / breaking panel border
    expect(req1.params.characters?.find(c => c.id === 'c-bottom')?.prompt).toContain('out of frame, breaking panel border, overlapping panel borders');
    // 气泡直出字永远位于整段 caption 绝对末尾
    const bubbleCaption = req0.params.characters?.find(c => c.id === 'b-top')?.prompt || '';
    expect(bubbleCaption.endsWith('Text: BAM!')).toBe(true);
    expect(bubbleCaption).not.toMatch(/Text:.*,/);

    // 验证默认 infill 精准锁框、单大格 0.95、旧版 img2img 平滑迁入 infill 以及 txt2img 自由构图关闭锁框
    const defaultDraft = createInitialComicDraft('classic-4-121');
    expect(resolveLayoutLockConfig(defaultDraft)).toMatchObject({
      mode: 'infill',
      enabled: true,
      autoTrimFrames: true,
      strength: 1.0,
      noise: 0,
      addOriginalImage: false,
    });
    const splashDraft = createInitialComicDraft('single-splash');
    splashDraft.aiPage.guidePanels = createGuidePanelsFromTemplate('single-splash', 832, 1216, 14);
    expect(resolveLayoutLockConfig(splashDraft)).toMatchObject({
      mode: 'infill',
      enabled: true,
      strength: 0.95,
      noise: 0.02,
      addOriginalImage: false,
    });
    const legacyDraft = createInitialComicDraft('classic-4-121');
    legacyDraft.aiPage.layoutLockMode = 'img2img' as unknown as ComicAiLayoutLockMode;
    expect(resolveLayoutLockConfig(legacyDraft)).toMatchObject({
      mode: 'infill',
      enabled: true,
      strength: 1.0,
      noise: 0,
      addOriginalImage: false,
    });
    legacyDraft.aiPage.layoutLockMode = 'txt2img';
    expect(resolveLayoutLockConfig(legacyDraft)).toMatchObject({
      mode: 'txt2img',
      enabled: false,
    });
  });

  it('migrates legacy drafts without points or with img2img layoutLockMode backward-compatibly in comicStorage', () => {
    const legacyRaw = {
      version: 1,
      id: 'legacy-page-1',
      title: '旧版AI页',
      width: 832,
      height: 1216,
      creationMode: 'ai-page',
      aiPage: {
        storyPrompt: '旧版剧情',
        targetPanelCount: 2,
        castCharacterIds: ['c1'],
        splitMode: 'single',
        layoutHint: '2-panel manga page',
        guidePanels: [
          { id: 'gp-1', label: '第 1 格', summary: '上格', x: 0.04, y: 0.04, width: 0.92, height: 0.44 },
          { id: 'gp-2', label: '第 2 格', summary: '下格', x: 0.04, y: 0.52, width: 0.92, height: 0.44 },
        ],
        anchors: [],
        showGuideOverlay: true,
      },
    };
    const migrated = normalizeComicDraft(legacyRaw);
    expect(migrated.aiPage.layoutLockMode).toBe('infill');
    expect(migrated.aiPage.autoTrimFrames).toBe(true);
    expect(normalizeComicDraft({ ...legacyRaw, aiPage: { ...legacyRaw.aiPage, layoutLockMode: 'img2img' } }).aiPage.layoutLockMode).toBe('infill');
    expect(normalizeComicDraft({ ...legacyRaw, aiPage: { ...legacyRaw.aiPage, layoutLockMode: 'txt2img' } }).aiPage.layoutLockMode).toBe('txt2img');
    expect(migrated.aiPage.gutterStyle).toBe('white');
    expect(migrated.aiPage.breakoutZones).toEqual([]);
    expect(migrated.aiPage.guidePanels).toHaveLength(2);
    expect(migrated.aiPage.guidePanels[0].points).toBeUndefined();
    // 即使旧矩形无 points，底图渲染器也能无缝转成 4 点多边形
    expect(getGuidePanelPolygon(migrated.aiPage.guidePanels[0])).toHaveLength(4);
  });

  it('provides 45 unique categorized vertical layout presets with valid geometry and legacy ID preservation', () => {
    expect(COMIC_LAYOUT_TEMPLATES).toHaveLength(45);
    const ids = new Set(COMIC_LAYOUT_TEMPLATES.map(tpl => tpl.id));
    expect(ids.size).toBe(45);

    const legacyIds = [
      'classic-4-121',
      'grid-2x2',
      'yonkoma-vertical',
      'dynamic-l-shape',
      'slanted-action-5',
      'inset-overlay',
      'single-splash',
    ];
    for (const legacyId of legacyIds) {
      expect(ids.has(legacyId)).toBe(true);
    }

    const validCategories = new Set(COMIC_LAYOUT_TEMPLATE_CATEGORIES.map(c => c.id));
    const gx = 14 / 832;
    const gy = 14 / 1216;
    for (const tpl of COMIC_LAYOUT_TEMPLATES) {
      expect(validCategories.has(tpl.category)).toBe(true);
      const panels = tpl.buildPanels(gx, gy);
      expect(panels).toHaveLength(tpl.panelCount);
      for (const panel of panels) {
        expect(panel.points.length).toBeGreaterThanOrEqual(3);
        expect(polygonArea(panel.points)).toBeGreaterThan(0.005);
        for (const pt of panel.points) {
          expect(Number.isFinite(pt.x)).toBe(true);
          expect(Number.isFinite(pt.y)).toBe(true);
          expect(pt.x).toBeGreaterThanOrEqual(-0.001);
          expect(pt.x).toBeLessThanOrEqual(1.001);
          expect(pt.y).toBeGreaterThanOrEqual(-0.001);
          expect(pt.y).toBeLessThanOrEqual(1.001);
        }
      }
    }
  });

  it('propagates inset, bleed, and borderless flags to AI guide panels and skips borderless strokes in img2img lock templates', () => {
    const insetGuides = createGuidePanelsFromTemplate('inset-overlay', 832, 1216, 14);
    expect(insetGuides).toHaveLength(3);
    expect(insetGuides[0].inset).toBeUndefined();
    expect(insetGuides[1].inset).toBe(true);
    expect(insetGuides[2].inset).toBe(true);

    const bleedGuides = createGuidePanelsFromTemplate('fp-single-bleed', 832, 1216, 14);
    expect(bleedGuides).toHaveLength(1);
    expect(bleedGuides[0].bleed).toBe(true);
    expect(bleedGuides[0].borderless).toBe(true);

    const openHeroGuides = createGuidePanelsFromTemplate('open-hero', 832, 1216, 14);
    expect(openHeroGuides).toHaveLength(3);
    expect(openHeroGuides[0].borderless).toBe(true);
    expect(openHeroGuides[1].borderless).toBeUndefined();
    expect(openHeroGuides[2].borderless).toBeUndefined();

    const makeMockCanvas = () => {
      const ops: Array<{ op: string; style?: string; width?: number }> = [];
      const mockCtx = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        lineJoin: 'miter',
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        closePath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        fillRect: () => ops.push({ op: 'fillRect', style: mockCtx.fillStyle }),
        fill: () => ops.push({ op: 'fill', style: mockCtx.fillStyle }),
        stroke: () => ops.push({ op: 'stroke', style: mockCtx.strokeStyle, width: mockCtx.lineWidth }),
      };
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => mockCtx,
        toDataURL: () => 'data:image/png;base64,MOCK',
      } as unknown as HTMLCanvasElement;
      return { ops, canvas };
    };

    const borderlessDraft = createInitialComicDraft('classic-4-121');
    borderlessDraft.creationMode = 'ai-page';
    borderlessDraft.aiPage.guidePanels = createGuidePanelsFromTemplate('borderless-pair', 832, 1216, 14);
    const borderlessPlan = planComicAiZones(borderlessDraft);
    const mock1 = makeMockCanvas();
    const res1 = renderComicZoneLayoutTemplate(borderlessDraft, borderlessPlan.zones[0], { canvas: mock1.canvas, seed: 11 });
    expect(res1.panelCount).toBe(2);
    expect(mock1.ops.filter(o => o.op === 'stroke')).toHaveLength(0);

    const openDraft = createInitialComicDraft('classic-4-121');
    openDraft.creationMode = 'ai-page';
    openDraft.aiPage.guidePanels = openHeroGuides;
    const openPlan = planComicAiZones(openDraft);
    const mock2 = makeMockCanvas();
    const res2 = renderComicZoneLayoutTemplate(openDraft, openPlan.zones[0], { canvas: mock2.canvas, seed: 11 });
    expect(res2.panelCount).toBe(3);
    expect(mock2.ops.filter(o => o.op === 'stroke')).toHaveLength(2);
  });

  it('uses distinct per-panel gradients, widens narrow internal lock gutters, drops diagonal strength to 0.80, and keeps ai-text/inset prompt integrity', () => {
    // 1. 内缩扩缝算法：外页边距 (x=0.04) 纹丝不动，内部细切边向内收缩并保住安全面积
    const topLeftPanel = [
      { x: 0.04 * 832, y: 0.04 * 1216 },
      { x: 0.49 * 832, y: 0.04 * 1216 },
      { x: 0.49 * 832, y: 0.48 * 1216 },
      { x: 0.04 * 832, y: 0.48 * 1216 },
    ];
    const widened = insetLockPolygonForWideGutter(topLeftPanel, 5, 832, 1216, false);
    expect(widened[0].x).toBeCloseTo(topLeftPanel[0].x, 4);
    expect(widened[0].y).toBeCloseTo(topLeftPanel[0].y, 4);
    expect(widened[2].x).toBeCloseTo(topLeftPanel[2].x - 5, 3);
    expect(widened[2].y).toBeCloseTo(topLeftPanel[2].y - 5, 3);

    // 2. 分区渐变色阶与高反差破格填充
    const gradientsCreated: Array<Array<{ offset: number; color: string }>> = [];
    const fillStylesUsed: unknown[] = [];
    const gradCtx = {
      fillStyle: '' as unknown,
      strokeStyle: '',
      lineWidth: 0,
      lineJoin: 'miter',
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      createLinearGradient: () => {
        const stops: Array<{ offset: number; color: string }> = [];
        gradientsCreated.push(stops);
        return { addColorStop: (offset: number, color: string) => stops.push({ offset, color }) };
      },
      fillRect: () => {},
      fill: () => fillStylesUsed.push(gradCtx.fillStyle),
      stroke: () => {},
    };
    const gradCanvas = {
      width: 0,
      height: 0,
      getContext: () => gradCtx,
      toDataURL: () => 'data:image/png;base64,MOCK',
    } as unknown as HTMLCanvasElement;

    const gradDraft = createInitialComicDraft('classic-4-121');
    gradDraft.creationMode = 'ai-page';
    gradDraft.aiPage.splitMode = 'single';
    gradDraft.aiPage.guidePanels = createGuidePanelsFromTemplate('classic-4-121', 832, 1216, 14);
    gradDraft.aiPage.breakoutZones = [{ id: 'bz', label: '破格', x: 0.2, y: 0.2, width: 0.3, height: 0.5 }];
    const gradPlan = planComicAiZones(gradDraft);
    renderComicZoneLayoutTemplate(gradDraft, gradPlan.zones[0], { canvas: gradCanvas, seed: 77 });
    // 4 个分格应使用彼此区分的相邻渐变色带，而非全页同色平灰
    expect(gradientsCreated).toHaveLength(4);
    expect(gradientsCreated[0]).toEqual([
      { offset: 0, color: LAYOUT_LOCK_PANEL_GRADIENTS.color[0][0] },
      { offset: 1, color: LAYOUT_LOCK_PANEL_GRADIENTS.color[0][1] },
    ]);
    expect(gradientsCreated[1]).toEqual([
      { offset: 0, color: LAYOUT_LOCK_PANEL_GRADIENTS.color[1][0] },
      { offset: 1, color: LAYOUT_LOCK_PANEL_GRADIENTS.color[1][1] },
    ]);
    expect(fillStylesUsed).toContain(LAYOUT_LOCK_COLORS.breakoutFillWhite);

    // 3. 大角度交叉三角模板：infill 保持 1.0 强度且不发 `3-1 panel arrangement`
    const triDraft = createInitialComicDraft('triangle-impact');
    triDraft.creationMode = 'ai-page';
    triDraft.colorMode = 'monochrome';
    triDraft.aiPage.splitMode = 'single';
    triDraft.aiPage.guidePanels = createGuidePanelsFromTemplate('triangle-impact', 832, 1216, 14);
    expect(hasSteepDiagonalPanels(triDraft.aiPage.guidePanels)).toBe(true);
    expect(hasAnySlantedEdge(triDraft.aiPage.guidePanels)).toBe(true);
    expect(resolveLayoutLockConfig(triDraft).strength).toBe(1.0);

    const triPlan = planComicAiZones(triDraft);
    const triReq = buildAiPageZoneRequest(triDraft, triPlan.zones[0], 1);
    expect(triReq.prompt).toContain('dynamic diagonal manga page');
    expect(triReq.prompt).not.toMatch(/3-1 panel arrangement/i);

    // 4. 画中画叠框优先级 + ai-text 自动避开质量词中的 `no text`
    const insetDraft = createInitialComicDraft('inset-overlay');
    insetDraft.creationMode = 'ai-page';
    insetDraft.dialogueMode = 'ai-text';
    insetDraft.aiPage.splitMode = 'single';
    insetDraft.aiPage.guidePanels = createGuidePanelsFromTemplate('inset-overlay', 832, 1216, 14);
    insetDraft.aiPage.guidePanels[1].visualNote = 'warm reaction close-up inside inset';
    insetDraft.aiPage.anchors = [
      { id: 'hero', kind: 'character', label: '主角', prompt: '1boy, swinging sword', negativePrompt: '', x: 0.25, y: 0.5, enabled: true },
      { id: 'in1', kind: 'character', label: '右上叠框女主', prompt: '1girl, surprised portrait', negativePrompt: '', x: 0.74, y: 0.2, enabled: true },
      { id: 'b1', kind: 'bubble', label: '台词', prompt: 'shout bubble', negativePrompt: '', x: 0.55, y: 0.14, enabled: true, bubbleShape: 'shout', bubbleText: 'HEY!!' },
    ];
    const insetPlan = planComicAiZones(insetDraft);
    const insetReq = buildAiPageZoneRequest(insetDraft, insetPlan.zones[0], 1);
    expect(insetReq.prompt).toContain('floating inset panel');
    expect(insetReq.prompt).not.toMatch(/2-1 panel arrangement/i);
    // 右上叠框锚点直接归属于叠框 1（吸收 visualNote 且不再重复生成幽灵兜底槽）
    const charPrompts = insetReq.params.characters || [];
    expect(charPrompts.some(c => c.id === 'in1' && c.prompt.includes('warm reaction close-up inside inset'))).toBe(true);
    expect(charPrompts.some(c => c.id.startsWith('guide-cue-') && c.prompt.includes('warm reaction close-up inside inset'))).toBe(false);
    // ai-text 模式不再把 default quality preset 的 `no text` 塞给生图接口
    expect(resolveComicQualityPreset('standard', 'ai-text')).toEqual({
      qualityPresetId: 'none',
      extraQualityTags: 'very aesthetic, masterpiece',
    });
    expect(insetReq.params.qualityPresetId).toBe('none');
    expect(insetReq.prompt).toContain('very aesthetic, masterpiece');
  });

  it('quantizes 1/8 binary masks strictly opaque, locks mask=0 pixels with alpha=0, and prevents duplicate empty bubbles in infill mode', () => {
    // 1. 严格 1/8 覆盖率二值化：32x16 图分左格 [0..8) 与右格 [22..32)，中间 14px 窄缝在 1/8 (4x2 块) 中严格分离不粘连
    const w = 32;
    const h = 16;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const active = x < 8 || x >= 22;
        src[idx] = active ? 255 : 0;
        src[idx + 1] = active ? 255 : 0;
        src[idx + 2] = active ? 255 : 0;
        src[idx + 3] = 255;
      }
    }
    const narrowParams = resolveInfillMaskGeometryParams(14);
    expect(narrowParams).toEqual({
      guideOutPx: 8,
      maskExpandPx: 0,
      covThreshold: 0.42,
      borderWidth: 6,
    });
    expect(resolveInfillMaskGeometryParams(24)).toEqual({
      guideOutPx: 8,
      maskExpandPx: 3,
      covThreshold: 0.28,
      borderWidth: 8,
    });

    const { maskBinary, maskRgba } = quantizeCoverageBlockMaskRgba(src, w, h, narrowParams.covThreshold);
    // 绝不允许出现灰阶像素或半透明像素
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      expect(maskRgba[p] === 0 || maskRgba[p] === 255).toBe(true);
      expect(maskRgba[p + 3]).toBe(255);
    }
    // 左块 [0..7] 活跃，中间块 [8..15] 全黑隔离，右块 [24..31] 活跃
    expect(maskBinary[0]).toBe(1);
    expect(maskBinary[10]).toBe(0);
    expect(maskBinary[26]).toBe(1);

    // 2. 逆向像素锁 Alpha：maskBinary===0 区域像素 alpha 严格为 0，边界内侧紧凑线性羽化
    const revAlpha = buildReversePixelLockMaskAlpha(maskBinary, w, h, 2);
    for (let i = 0; i < w * h; i++) {
      if (maskBinary[i] === 0) expect(revAlpha[i]).toBe(0);
    }
    expect(revAlpha[4]).toBeGreaterThan(0);

    // 3. Variant C+ 防额外废泡 + 过滤几何形状误导词
    const draft = createInitialComicDraft('classic-4-121');
    draft.creationMode = 'ai-page';
    draft.dialogueMode = 'empty-bubble';
    draft.aiPage.layoutLockMode = 'infill';
    draft.aiPage.carveBubbleHoles = true;
    draft.aiPage.layoutHint = 'circular panel, 4-panel manga page';
    draft.aiPage.guidePanels = createGuidePanelsFromTemplate('classic-4-121', 832, 1216, 14);
    draft.aiPage.anchors = [
      { id: 'c1', kind: 'character', label: '角色', prompt: '1girl, smiling', negativePrompt: '', x: 0.5, y: 0.25, enabled: true },
      { id: 'b1', kind: 'bubble', label: '硬锁气泡', prompt: 'left tail', negativePrompt: '', x: 0.25, y: 0.2, enabled: true, bubbleShape: 'oval' },
    ];
    const plan = planComicAiZones(draft);
    expect(collectHardLockedZoneBubbles(draft, plan.zones[0].rect, 832, 1216)).toHaveLength(1);
    const req = buildAiPageZoneRequest(draft, plan.zones[0], 1);
    expect(req.prompt.toLowerCase()).not.toContain('blank speech bubbles');
    expect(req.prompt.toLowerCase()).not.toContain('circular panel');
    expect(req.negative.toLowerCase()).toContain('speech bubble');
    expect(req.params.characters?.some(c => c.id === 'b1')).toBe(false);

    // 4. 矩形局部重绘掩码：选区外透明 (alpha === 0)，不再误填不透明黑色
    const rectOps: string[] = [];
    let cleared = false;
    const mockCtx = {
      fillStyle: '',
      clearRect: () => { cleared = true; },
      fillRect: () => { rectOps.push(mockCtx.fillStyle); },
    };
    const origCreateElement = document.createElement.bind(document);
    const origGetCtx = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => mockCtx) as unknown as typeof origGetCtx;
    const origToDataUrl = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,MASK';
    try {
      const url = createRectInpaintMaskDataUrl(832, 1216, { x: 0.1, y: 0.1, width: 0.5, height: 0.3 });
      expect(url).toBe('data:image/png;base64,MASK');
      expect(cleared).toBe(true);
      expect(rectOps).toEqual(['#ffffff']);
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetCtx;
      HTMLCanvasElement.prototype.toDataURL = origToDataUrl;
      void origCreateElement;
    }
  });
});

describe('comicSnapping geometry, polyline slicing, smart snapping, and spread scoping', () => {
  it('validates polygon usability, rejects self-intersection / collapse on vertex & edge drag, and keeps pixel size on canvas resize', () => {
    // 非退化矩形可用，微小边/自交多边形不可用
    expect(isUsablePolygonPx([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }])).toBe(true);
    expect(isUsablePolygonPx([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }])).toBe(false);

    const rect = rectToPolygon(0.1, 0.1, 0.4, 0.4);
    // 把左上角拖拽跨过底边造成自交 -> 返回 null 拒绝
    expect(moveNormalizedPolygonVertex(rect, 0, { x: 0.4, y: 0.7 }, 1000, 1000)).toBeNull();
    // 合法斜角拖拽 -> 成功更新第 0 点
    const validVertex = moveNormalizedPolygonVertex(rect, 0, { x: 0.15, y: 0.08 }, 1000, 1000);
    expect(validVertex).not.toBeNull();
    expect(validVertex![0].x).toBeCloseTo(0.15, 2);

    // 整边向外推移 -> 扩大高度；向内推穿对边 -> 返回 null
    const movedEdge = moveNormalizedPolygonEdge(rect, 2, { x: 0, y: 0.1 }, 1000, 1000);
    expect(movedEdge).not.toBeNull();
    expect(movedEdge![2].y).toBeCloseTo(0.6, 2);
    expect(moveNormalizedPolygonEdge(rect, 0, { x: 0, y: 0.4 }, 1000, 1000)).toBeNull();
    expect(moveNormalizedPolygonEdge(rect, 0, { x: 0, y: 0.5 }, 1000, 1000)).toBeNull();

    // 画幅扩大为 2 倍时保持原像素尺寸（归一化坐标减半）
    const rescaled = rescaleNormalizedPointsOnCanvasResize(
      [{ x: 0.5, y: 0.5 }],
      800,
      1000,
      1600,
      1000,
    );
    expect(rescaled[0].x).toBeCloseTo(0.25, 3);
    expect(rescaled[0].y).toBeCloseTo(0.5, 3);
  });

  it('supports polyline L-bend cutting, concave polygon slicing, and concave-safe badge placement', () => {
    const pageW = 1000;
    const pageH = 1000;
    const square = rectToPolygon(0.1, 0.1, 0.8, 0.8);

    // 1. 直线两刀点折线切分（沿边框进出，带 20px 格缝）
    const straight = splitNormalizedPolygonAlongPath(
      square,
      [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
      20,
      pageW,
      pageH,
    );
    expect(straight).not.toBeNull();
    const boxA = getPanelBoundingBox(straight![0], pageW, pageH);
    const boxB = getPanelBoundingBox(straight![1], pageW, pageH);
    expect(Math.abs(Math.min(boxA.maxY, boxB.maxY) - Math.max(boxA.minY, boxB.minY))).toBeGreaterThan(18);

    // 2. 格内拐一次弯的 L 形折线切分（顶边 -> 中心折点 -> 右边）
    const bent = splitNormalizedPolygonAlongPath(
      square,
      [{ x: 0.4, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.6 }],
      16,
      pageW,
      pageH,
    );
    expect(bent).not.toBeNull();
    expect(bent!.some(poly => poly.length >= 4)).toBe(true);

    // 穿出画框到框外拐点后再穿回 -> 必须返回 null
    const invalidBent = splitNormalizedPolygonAlongPath(
      square,
      [{ x: 0.4, y: 0.1 }, { x: 0.02, y: 0.5 }, { x: 0.9, y: 0.6 }],
      16,
      pageW,
      pageH,
    );
    expect(invalidBent).toBeNull();

    // 3. 凹 L 形多边形：左上缺口 [0.1..0.5, 0.1..0.5]
    const concaveL = [
      { x: 0.5, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
      { x: 0.1, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ];
    // 角标定位必须避开外框左上角空洞，严格落入凹多边形实体像素内部
    const badge = placeComicPanelBadgePx(concaveL, pageW, pageH, 30, 20);
    expect(badge).not.toBeNull();
    const badgeCenterPx = {
      x: badge!.x + 15 * badge!.scale,
      y: badge!.y + 10 * badge!.scale,
    };
    expect(isPointStrictlyInsidePolygonPx(concaveL.map(p => ({ x: p.x * pageW, y: p.y * pageH })), badgeCenterPx)).toBe(true);

    // 凹多边形直线斜切仍成功产出两块合法分镜（上半保留 6 顶点凹 L 形，下半为梯形）
    const concaveSplit = sliceAnyPolygonByLine(
      concaveL,
      { x: 0.05, y: 0.75 },
      { x: 0.95, y: 0.55 },
      12,
      pageW,
      pageH,
    );
    expect(concaveSplit).not.toBeNull();
    expect(concaveSplit!.some(poly => poly.length === 6)).toBe(true);
  });

  it('provides equal-gutter measure guides, parallelogram symmetry snap, oblique snap, Shift axis lock, and angle snap', () => {
    const pageW = 1000;
    const pageH = 1000;
    const leftSibling = rectToPolygon(0.1, 0.2, 0.2, 0.4); // x: [100..300]
    const rightSibling = rectToPolygon(0.7, 0.2, 0.2, 0.4); // x: [700..900]
    const middleBox = rectToPolygon(0.396, 0.2, 0.2, 0.4); // center=496px, 居中应到 400..600 -> dx=+0.004 (4px)

    const equalGapSnap = snapComicPanelDrag({
      points: middleBox,
      kind: 'move',
      deltaNorm: { x: 0, y: 0 },
      siblingPolygons: [leftSibling, rightSibling],
      pageW,
      pageH,
      thresholdPx: 8,
    });
    expect(equalGapSnap.delta.x * pageW).toBeCloseTo(4, 1);
    expect(equalGapSnap.guides.some(g => g.measure)).toBe(true);

    // 平行四边形对称第 4 点吸附：顶边 (100,100)->(300,100), 右下 (340,300), 左下原 (100,300) 拖向 (143,302) 吸附到 (140,300)
    const almostParallelogram = [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.34, y: 0.3 },
      { x: 0.143, y: 0.302 },
    ];
    const paraSnap = snapComicPanelDrag({
      points: almostParallelogram,
      kind: 'vertex',
      index: 3,
      deltaNorm: { x: 0, y: 0 },
      siblingPolygons: [],
      pageW,
      pageH,
      thresholdPx: 7,
    });
    expect((almostParallelogram[3].x + paraSnap.delta.x) * pageW).toBeCloseTo(140, 1);
    expect((almostParallelogram[3].y + paraSnap.delta.y) * pageH).toBeCloseTo(300, 1);

    // Shift 轴锁定
    const shiftLocked = snapComicPanelDrag({
      points: middleBox,
      kind: 'move',
      deltaNorm: { x: 0.05, y: 0.01 },
      siblingPolygons: [],
      pageW,
      pageH,
      shift: true,
      enabled: false,
    });
    expect(shiftLocked.delta.y).toBe(0);

    // Shift 旋转 15° 吸附 & 邻框斜边角度对齐吸附
    expect(snapComicPanelAngle(14, [], pageW, pageH, true)).toEqual({ angle: 15, snapped: true });
    const diagSibling = [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.5 }, // 45 deg
      { x: 0.5, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
    const angleSnap = snapComicPanelAngle(43.5, [diagSibling], pageW, pageH, false, true);
    expect(angleSnap.snapped).toBe(true);
    expect(angleSnap.angle).toBeCloseTo(45, 1);
  });

  it('preserves image continuity after splitting and remaps spread half-page templates to left/right bounds', () => {
    const parent = rectToPolygon(0.1, 0.1, 0.8, 0.8);
    const upper = rectToPolygon(0.1, 0.1, 0.8, 0.38);
    const lower = rectToPolygon(0.1, 0.52, 0.8, 0.38);
    const origImg = {
      url: 'data:image/png;base64,AAA',
      width: 800,
      height: 800,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    };

    const topImg = preservePanelImageAfterSplit(origImg, parent, upper, 1000, 1000);
    const bottomImg = preservePanelImageAfterSplit(origImg, parent, lower, 1000, 1000);
    // 原图中心在 (500,500)，上半格中心 (500,290) -> offsetY > 0；下半格中心 (500,710) -> offsetY < 0
    expect(topImg.offsetY).toBeGreaterThan(0.4);
    expect(bottomImg.offsetY).toBeLessThan(-0.4);
    expect(topImg.scale).toBeCloseTo(1, 2);

    // 对开页左/右半页模板映射：所有顶点严格留在各自半区不跨中缝
    const leftPanels = buildTemplatePanelsForScope('classic-4-121', 1216, 832, 16, 'left');
    const rightPanels = buildTemplatePanelsForScope('classic-4-121', 1216, 832, 16, 'right');
    expect(leftPanels.every(p => p.points.every(pt => pt.x < 0.5))).toBe(true);
    expect(rightPanels.every(p => p.points.every(pt => pt.x > 0.5))).toBe(true);
  });

  it('compiles soft-panel txt2img prompts separately from spoiler-free infill and clamps storyboard anchors inside polygons', () => {
    const draft = createInitialComicDraft('inset-overlay');
    draft.creationMode = 'ai-page';
    draft.dialogueMode = 'ai-text';
    draft.aiPage.splitMode = 'single';
    draft.aiPage.sceneAtmosphere = 'golden sunset glow';
    draft.aiPage.guidePanels = createGuidePanelsFromTemplate('inset-overlay', 832, 1216, 24);
    draft.aiPage.guidePanels[0].visualNote = 'wide shot, school rooftop, wind';
    draft.aiPage.guidePanels[1].visualNote = 'close-up, surprised eyes';
    draft.aiPage.anchors = [
      {
        id: 'c1',
        kind: 'character',
        label: '主角',
        prompt: '1boy, source#pointing, rooftop',
        negativePrompt: '',
        x: 0.25,
        y: 0.45,
        enabled: true,
      },
      {
        id: 'c2',
        kind: 'character',
        label: '女主',
        prompt: '1girl, target#surprised, hair blowing',
        negativePrompt: '',
        x: 0.74,
        y: 0.20,
        enabled: true,
      },
      {
        id: 'b1',
        kind: 'bubble',
        label: '台词',
        prompt: 'tail pointing left, saying "Wait!"',
        negativePrompt: '',
        x: 0.55,
        y: 0.14,
        enabled: true,
        bubbleShape: 'oval',
        bubbleText: 'Wait!',
      },
    ];

    // 1. 精准锁框 infill 保持总词无剧透、角色锚点不加冗余 `panel N` 前缀
    draft.aiPage.layoutLockMode = 'infill';
    const infillZone = planComicAiZones(draft).zones[0];
    const infillReq = buildAiPageZoneRequest(draft, infillZone, 1);
    expect(infillReq.prompt).not.toContain('Panel 1 (');
    expect(infillReq.params.characters?.find(c => c.id === 'c1')?.prompt).not.toMatch(/^panel 1\b/i);

    // 2. 自由构图 txt2img 启用软分镜语法：总词带 `comic, multiple views`、`1.4::overlapping panels::` 与有序 `Panel N (...)`，角色槽带 `panel N` 与双人互动词，ai-text 剥离重复台词并保 `Text:` 末尾
    draft.aiPage.layoutLockMode = 'txt2img';
    const freeZone = planComicAiZones(draft).zones[0];
    const freeReq = buildAiPageZoneRequest(draft, freeZone, 1);
    expect(freeReq.layoutLock).toMatchObject({ mode: 'txt2img', enabled: false });
    expect(freeReq.prompt).toContain('comic, multiple views');
    expect(freeReq.prompt).toContain('1.4::overlapping panels::');
    expect(freeReq.prompt).toContain('Panel 1 (');
    expect(freeReq.prompt).toContain('Panel 2 (overlapping inset panel in upper right area): close-up, surprised eyes');
    expect(freeReq.prompt).toContain('golden sunset glow');

    const freeC1 = freeReq.params.characters?.find(c => c.id === 'c1')?.prompt || '';
    const freeC2 = freeReq.params.characters?.find(c => c.id === 'c2')?.prompt || '';
    const freeB1 = freeReq.params.characters?.find(c => c.id === 'b1')?.prompt || '';
    expect(freeC1.startsWith('panel 1,')).toBe(true);
    expect(freeC1).toContain('source#pointing');
    expect(freeC2.startsWith('panel 2,')).toBe(true);
    expect(freeC2).toContain('target#surprised');
    expect(freeB1.endsWith('Text: Wait!')).toBe(true);
    expect(freeB1.toLowerCase()).not.toContain('"wait!"');

    // 3. 分镜编排提示词规范 & 锚点防越界：白边/斜切三角形外部的越界锚点被拉回多边形内
    const sysPrompt = buildComicStoryboardSystemPrompt();
    expect(sysPrompt).toContain('source#<action>');
    expect(sysPrompt).toContain('target#<action>');
    expect(sysPrompt).toContain('mutual#<action>');
    expect(sysPrompt).toContain('dutch angle');

    const trianglePoly = [
      { x: 0.04, y: 0.04 },
      { x: 0.96, y: 0.04 },
      { x: 0.04, y: 0.88 },
    ];
    const parsedOutOfBounds = parseComicStoryboardResponse(JSON.stringify({
      title: '斜切钳位',
      layoutHint: '1-panel diagonal manga page',
      guidePanels: [
        { label: '第 1 格', summary: '三角冲击格', visualNote: 'dutch angle', x: 0.04, y: 0.04, width: 0.92, height: 0.84 },
      ],
      anchors: [
        { kind: 'character', label: '右下越界角色', prompt: '1girl, jumping', x: 0.86, y: 0.82 },
      ],
    }), {
      dialogueMode: 'clean-vector',
      preserveExistingLayout: true,
      existingGuidePanels: [
        { label: '第 1 格', x: 0.04, y: 0.04, width: 0.92, height: 0.84, points: trianglePoly },
      ],
    });
    expect(parsedOutOfBounds.anchors).toHaveLength(1);
    const clampedAnchor = parsedOutOfBounds.anchors[0];
    expect(isPointStrictlyInsidePolygonPx(trianglePoly.map(p => ({ x: p.x * 1000, y: p.y * 1000 })), { x: clampedAnchor.x * 1000, y: clampedAnchor.y * 1000 })).toBe(true);
  });
});

describe('comicAssets & custom bubble/transparent image layers', () => {
  it('parses SVG dimensions from viewBox and computes aspect-preserving normalized boxes', () => {
    expect(parseSvgViewBoxSize('<svg viewBox="0 0 800 400"></svg>')).toEqual({ width: 800, height: 400 });
    expect(parseSvgViewBoxSize('<svg width="320px" height="240px" viewBox="0 0 100 100"></svg>')).toEqual({ width: 320, height: 240 });
    expect(parseSvgViewBoxSize('<div>not svg</div>')).toBeNull();

    // 横图 2:1 放入竖页 832x1216 时，应保留原始纵横比而不是强行拉成正方形
    const box = computeNormalizedAssetBox(800, 400, 832, 1216, 0.5);
    expect(box.width).toBe(0.5);
    expect(box.height).toBeLessThan(0.2);
  });

  it('computes safe text box for custom bubbles and preserves flip/inset/aspect props when duplicating layers', () => {
    const defaultBox = resolveBubbleTextBox({ customImageUrl: undefined }, 100, 200, 50, 40);
    expect(defaultBox).toEqual({ x: 100 - 38.5, y: 200 - 30.8, width: 77, height: 61.6, cx: 100, cy: 200 });

    const customBox = resolveBubbleTextBox({
      customImageUrl: '/api/assets/comic-assets/u/b1.png',
      textInsetX: 0.2,
      textInsetY: 0.25,
      textOffsetX: 0.1,
      textOffsetY: -0.1,
    }, 100, 200, 50, 40);
    expect(customBox.width).toBe(60);
    expect(customBox.height).toBe(40);
    expect(customBox.cx).toBe(110);
    expect(customBox.cy).toBe(192);

    const draft = createInitialComicDraft('classic-4-121');
    const created = createImageLayerInDraft(draft, {
      name: '透明特效',
      url: '/api/assets/comic-assets/u/fx.png',
      width: 0.4,
      height: 0.3,
      assetId: 'ca_fx1',
      naturalWidth: 800,
      naturalHeight: 600,
      lockAspect: true,
      flipX: true,
    });
    expect(created.imageItem.assetId).toBe('ca_fx1');
    expect(created.imageItem.flipX).toBe(true);
    expect(created.imageItem.lockAspect).toBe(true);

    const dupImg = duplicateLayerInDraft(created.draft, created.layer.id);
    const copiedImg = dupImg.draft.imageLayers?.find(item => item.id === dupImg.newLayer?.refId);
    expect(copiedImg?.flipX).toBe(true);
    expect(copiedImg?.assetId).toBe('ca_fx1');
  });
});
