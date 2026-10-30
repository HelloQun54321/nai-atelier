import { describe, expect, it } from 'vitest';
import { applyRollSelection, type PromptLibraryWorkspaceState } from '../../services/promptLibraryApply';
import { compilePrompt } from '../../services/promptUtils';
import {
  addCustomZone, assembleVisualSubject, customSectionId, enterSectionedPrompt, pinPictureZone, pinnedPictureZones,
  projectSectionedPrompt, readLabSectionLayout, subjectFromSections,
} from '../../services/labSections';
import type { NAIParams } from '../../types';

const state = (patch: Partial<PromptLibraryWorkspaceState> = {}): PromptLibraryWorkspaceState => ({
  base: 'artist:keep, masterpiece',
  subject: 'blue eyes',
  negative: 'lowres',
  classified: false,
  sectioned: true,
  params: { model: 'nai-diffusion-4-5-full', characters: [{ id: 'one', prompt: 'handwritten', x: 0.5, y: 0.5 }], _promptSections: { appearance: '', wardrobe: '', pose: '', scene: 'blue eyes', camera: '', extra: '' } } as NAIParams,
  ...patch,
});

describe('分类编辑的栏位', () => {
  it('画风分栏并回全局，而且不会再拆开', () => {
    const first = projectSectionedPrompt('artist:keep', { appearance: '', wardrobe: '', pose: '', scene: 'garden', camera: '', extra: '', 'purpose:style': 'oil painting' });
    expect(first.base).toBe('artist:keep, oil painting');
    expect(first.sections['purpose:style']).toBeUndefined();
    expect(first.sections.scene).toBe('garden');
    const again = projectSectionedPrompt(first.base, first.sections);
    expect(again.base).toBe(first.base);
  });

  it('打开分类时不拆已经写在全局里的画风，对不上的画面放进补充', () => {
    const opened = enterSectionedPrompt('artist:keep, soft light', 'rainy street', 'lowres', undefined);
    expect(opened.base).toBe('artist:keep, soft light');
    expect(opened.sections.extra).toBe('rainy street');
    expect(opened.subject).toContain('rainy street');
    expect(opened.subject).not.toContain('artist:keep');
  });

  it('没有内容的场景不会占分页，添加之后会', () => {
    expect(pinnedPictureZones(undefined, undefined).map(zone => zone.id)).not.toContain('scene');
    const pinned = pinPictureZone(undefined, 'scene');
    expect(pinnedPictureZones(undefined, pinned).map(zone => zone.id)).toContain('scene');
    const customId = customSectionId('scene-2');
    const custom = addCustomZone(pinned, '夜景', customId);
    expect(readLabSectionLayout(custom).zones.map(zone => zone.label)).toContain('夜景');
  });

  it('默认仍按旧顺序拼接，避免只打开分类就改写已有稿', () => {
    const sections = { appearance: 'blue eyes', wardrobe: '', pose: '', scene: 'garden', camera: '', extra: '', 'purpose:place': 'forest' };
    expect(subjectFromSections(sections, undefined)).toBe('blue eyes, garden, forest');
    const visual = { ...readLabSectionLayout(undefined), assembly: 'visual' as const };
    expect(assembleVisualSubject(sections, visual)).toContain('blue eyes');
    expect(assembleVisualSubject(sections, visual).indexOf('forest')).toBeLessThan(assembleVisualSubject(sections, visual).indexOf('garden') === -1 ? 99 : assembleVisualSubject(sections, visual).indexOf('garden'));
  });
});

describe('分类编辑的 Roll', () => {
  it('场景写进自己的栏，画风整段不动', () => {
    const before = state();
    const applied = applyRollSelection(before, { 'purpose:place': { kind: 'purpose:place', scope: 'global', filled: true, text: 'shrine', negative: 'indoor' } }, { mode: 'global' });
    expect(applied.state.base).toBe('artist:keep, masterpiece');
    expect(applied.state.negative).toBe('lowres');
    expect(applied.state.params._promptSections?.['purpose:place']).toBe('shrine');
    expect(applied.state.params._promptSections?.sectionNegatives?.['purpose:place']).toBe('indoor');
    expect(applied.state.subject).toContain('shrine');
    expect(applied.state.subject).not.toContain('artist:keep');
    const sent = compilePrompt({ basePrompt: applied.state.base, modules: [] }, applied.state.subject);
    expect(sent.startsWith('artist:keep, masterpiece')).toBe(true);
    expect(sent).toContain('shrine');
  });

  it('画风用途即使被抽到也不写入', () => {
    const applied = applyRollSelection(state(), { 'purpose:style': { kind: 'purpose:style', scope: 'global', filled: true, text: 'messy style' } }, { mode: 'global' });
    expect(applied.state.base).toBe('artist:keep, masterpiece');
    expect(applied.state.params._promptSections?.['purpose:style']).toBeUndefined();
  });

  it('角色栏重抽只换这一栏，并跳过后来的手改', () => {
    const before = state();
    const first = applyRollSelection(before, { 'purpose:clothing': { kind: 'purpose:clothing', scope: 'character', filled: true, text: 'white dress', negative: 'armor' } }, { mode: 'existing', id: 'one' });
    expect(first.state.params.characters?.[0].sections?.['purpose:clothing']).toBe('white dress');
    expect(first.state.params.characters?.[0].prompt).toBe('handwritten');
    expect(first.state.base).toBe(before.base);
    const edited = { ...first.state, params: { ...first.state.params, characters: [{ ...first.state.params.characters![0], sections: { ...first.state.params.characters![0].sections, 'purpose:clothing': 'white dress, ribbon' } }] } };
    const next = applyRollSelection(edited, { 'purpose:clothing': { kind: 'purpose:clothing', scope: 'character', filled: true, text: 'black coat', negative: 'armor' } }, { mode: 'existing', id: 'one' }, first.receipt);
    expect(next.conflicts).toContain('character:one:facet:purpose:clothing');
    expect(next.state.params.characters?.[0].sections?.['purpose:clothing']).toBe('white dress, ribbon');
  });
});
