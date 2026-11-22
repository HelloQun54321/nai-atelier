// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { OPUS_FREE_PIXEL_LIMIT } from '../../services/aspectRatio';
import {
  createGuidePanelsFromTemplate,
  createInitialComicDraft,
  getPanelBoundingBox,
  matchFreeOpusResolution,
  rectToPolygon,
  slicePolygonByLine,
  snapComicPoint,
} from '../../services/comic/comicGeometry';
import {
  buildComicPanelGenerationInput,
  COMIC_ANCHOR_HARD_LIMIT,
  COMIC_ANCHOR_SOFT_LIMIT,
  encodeDanbooruCastId,
  evaluateAnchorGuard,
  parseDanbooruCastId,
  stripColorTagsForMonochrome,
} from '../../services/comic/comicPromptBuilder';
import {
  buildAiPageZoneRequest,
  planComicAiZones,
} from '../../services/comic/comicAiPageEngine';
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
} from '../../services/comic/comicInpaintEngine';
import { parseComicStoryboardResponse } from '../../services/comic/comicStoryboardAgent.mjs';
import { loadComicDraft, saveComicDraft } from '../../services/comic/comicStorage';
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
import type { ComicAnchor, ComicStroke } from '../../services/comic/comicTypes';

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
