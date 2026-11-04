// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { NAIParams } from '../../types';
import { buildPromptSampleDraft, createPromptSampleSnapshot, getPromptSampleSettings, normalizePromptSampleSettings, reloadPromptSampleSettings, updatePromptSampleSettings, type PromptSampleSettings } from '../../services/promptSampleSettings';

const original = {
  model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 42, useCoords: true,
  characters: [{ id: 'old', prompt: 'old girl', x: 0.2, y: 0.3 }],
  vibes: { enabled: true, normalizeStrengths: true, slots: [] },
  characterReferences: { enabled: true, slots: [] },
  _promptSections: { scene: 'old scene' },
} as unknown as NAIParams;
const settings = (patch: Partial<PromptSampleSettings> = {}): PromptSampleSettings => ({ source: 'original', main: '1girl, solo', characters: [], keepOriginalCharacters: false, originalSize: null, snapshot: null, ...patch });

beforeEach(() => { localStorage.clear(); reloadPromptSampleSettings(); });

describe('样张组装', () => {
  it('沿用原图设置：正向只有画风串与 main，角色换成样张角色，保留氛围参考、去掉精准参考与分栏', () => {
    const draft = buildPromptSampleDraft(' artist:a, masterpiece ', settings({ characters: ['blue hair', ' ', 'red dress'] }), { params: original, negativePrompt: 'lowres' });
    expect(draft).toMatchObject({ basePrompt: 'artist:a, masterpiece, 1girl, solo', subjectPrompt: '', negativePrompt: 'lowres', modules: [] });
    expect(draft.params).toMatchObject({ model: 'nai-diffusion-4-5-full', width: 832, steps: 28, seed: 42, useCoords: false, vibes: original.vibes });
    expect(draft.params.characters).toEqual([{ id: 'sample-1', enabled: true, prompt: 'blue hair', x: 0.5, y: 0.5 }, { id: 'sample-2', enabled: true, prompt: 'red dress', x: 0.5, y: 0.5 }]);
    expect(draft.params).not.toHaveProperty('characterReferences');
    expect(draft.params).not.toHaveProperty('_promptSections');
    expect(original.characters).toHaveLength(1);
  });

  it('用我的样张设置：参数与负面词来自面板设置，负面词留空沿用原图；不含角色与参考，没设置过时退回原图设置', () => {
    const snapshot = createPromptSampleSnapshot({ ...original, width: 1024, height: 1024, seed: undefined }, 'bad hands', 7);
    expect(snapshot.params).not.toHaveProperty('vibes');
    expect(snapshot.params).not.toHaveProperty('characters');
    expect(snapshot.savedAt).toBe(7);
    const draft = buildPromptSampleDraft('artist:a', settings({ source: 'mine', main: '', snapshot }), { params: original, negativePrompt: 'lowres' });
    expect(draft).toMatchObject({ basePrompt: 'artist:a', negativePrompt: 'bad hands', params: { width: 1024, height: 1024, characters: [] } });
    expect(draft.params).not.toHaveProperty('vibes');
    const blankNegative = { ...snapshot, negativePrompt: '  ' };
    expect(buildPromptSampleDraft('artist:a', settings({ source: 'mine', snapshot: blankNegative }), { params: original, negativePrompt: 'lowres' })).toMatchObject({ negativePrompt: 'lowres', params: { width: 1024 } });
    expect(buildPromptSampleDraft('artist:a', settings({ source: 'mine' }), { params: original, negativePrompt: 'lowres' }).params.width).toBe(832);
  });

  it('沿用原图设置时可单独换尺寸，其余参数不变；用我的样张设置时不受影响', () => {
    const resized = buildPromptSampleDraft('artist:a', settings({ originalSize: { width: 1024, height: 1024 } }), { params: original, negativePrompt: 'lowres' });
    expect(resized.params).toMatchObject({ width: 1024, height: 1024, steps: 28, seed: 42, model: 'nai-diffusion-4-5-full' });
    const snapshot = createPromptSampleSnapshot({ ...original, width: 1216, height: 832 }, '');
    expect(buildPromptSampleDraft('artist:a', settings({ source: 'mine', snapshot, originalSize: { width: 1024, height: 1024 } }), { params: original, negativePrompt: 'lowres' }).params).toMatchObject({ width: 1216, height: 832 });
  });

  it('沿用原图角色：角色、站位与精准参考按原图；所选模型不支持精准参考时只去掉参考', () => {
    const kept = buildPromptSampleDraft('artist:a', settings({ keepOriginalCharacters: true, characters: ['ignored'] }), { params: original, negativePrompt: 'lowres' });
    expect(kept.params).toMatchObject({ characters: original.characters, useCoords: true, characterReferences: original.characterReferences });
    expect(kept.params.characters).not.toBe(original.characters);
    const snapshot = createPromptSampleSnapshot({ ...original, model: 'nai-diffusion-5-full' }, '');
    const mine = buildPromptSampleDraft('artist:a', settings({ source: 'mine', snapshot, keepOriginalCharacters: true }), { params: original, negativePrompt: 'lowres' });
    expect(mine.params).toMatchObject({ model: 'nai-diffusion-5-full', characters: original.characters, useCoords: true });
    expect(mine.params).not.toHaveProperty('characterReferences');
  });
});

describe('样张设置保存', () => {
  it('按当前浏览器保存，读取时丢弃损坏的快照并限制角色数量', () => {
    updatePromptSampleSettings({ main: 'solo', characters: ['a', 'b'] });
    expect(JSON.parse(localStorage.getItem('nai_prompt_sample')!)).toMatchObject({ source: 'original', main: 'solo', characters: ['a', 'b'], snapshot: null });
    localStorage.setItem('nai_prompt_sample', JSON.stringify({ source: 'mine', characters: Array(9).fill('x'), snapshot: { params: { width: 'big' } } }));
    reloadPromptSampleSettings();
    expect(getPromptSampleSettings()).toEqual({ source: 'mine', main: '', characters: Array(6).fill('x'), keepOriginalCharacters: false, originalSize: null, snapshot: null });
    expect(normalizePromptSampleSettings('broken')).toEqual({ source: 'original', main: '', characters: [], keepOriginalCharacters: false, originalSize: null, snapshot: null });
    expect(normalizePromptSampleSettings({ originalSize: { width: 1024, height: 1024 } }).originalSize).toEqual({ width: 1024, height: 1024 });
    expect(normalizePromptSampleSettings({ originalSize: { width: 1.5, height: 99999 } }).originalSize).toBeNull();
  });
});
