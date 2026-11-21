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
  evaluateAnchorGuard,
  stripColorTagsForMonochrome,
} from '../../services/comic/comicPromptBuilder';
import {
  buildAiPageZoneRequest,
  planComicAiZones,
} from '../../services/comic/comicAiPageEngine';
import { parseComicStoryboardResponse } from '../../services/comic/comicStoryboardAgent.mjs';
import { loadComicDraft, saveComicDraft } from '../../services/comic/comicStorage';
import type { ComicAnchor } from '../../services/comic/comicTypes';

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
