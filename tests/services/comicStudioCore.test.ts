// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { OPUS_FREE_PIXEL_LIMIT } from '../../services/aspectRatio';
import {
  createInitialComicDraft,
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

  it('slices a rectangular panel diagonally with gutter spacing', () => {
    const rect = rectToPolygon(0.1, 0.1, 0.8, 0.8);
    const result = slicePolygonByLine(rect, { x: 0.05, y: 0.35 }, { x: 0.95, y: 0.65 }, 0.02, 0.02);
    expect(result).not.toBeNull();
    const [polyA, polyB] = result!;
    expect(polyA.length).toBeGreaterThanOrEqual(3);
    expect(polyB.length).toBeGreaterThanOrEqual(3);
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
});
