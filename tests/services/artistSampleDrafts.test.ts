// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalGenItem } from '../../types';
import { api } from '../../services/api';
import { IMPORT_SESSION_KEY } from '../../services/metadataService';
import { buildArtistSamplePrompt, normalizeArtistSampleTemplate, canSaveArtistSample, getDefaultArtistSampleTemplate, prepareArtistSampleImport, saveArtistOwnSample, saveArtistSampleTemplate } from '../../services/artistSampleDrafts';
import { createDefaultRollTemplate } from '../../services/styleRoll';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';
import { deleteArtistSample, getArtistSampleData, getSampledArtistTags } from '../../services/artistSampleDrafts';
import * as artistSamples from '../../services/artistSamples';
import { ARTIST_SAMPLES_CHANGED } from '../../services/artistSamples';

vi.mock('../../services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), uploadFile: vi.fn() }, notifyLanAccessRequired: vi.fn(), parseErrorResponse: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); });

it('可用样张集合只计Full自建和可信Full目录，GET旧Curated资料仍原样可读', async () => {
  const samples = [
    { id: 'curated', pack: 'v5', tag: 'old curated', params: { model: 'nai-diffusion-5-curated' } },
    { id: 'full', pack: 'v5', tag: 'new full', params: { model: 'nai-diffusion-5-full' } },
    { id: 'medium', pack: 'v5', tag: 'medium', params: { model: 'nai-diffusion-5-full-medium' } },
  ];
  vi.mocked(api.get).mockResolvedValue({ templates: { v5: { prompt: 'old', params: { model: 'nai-diffusion-5-curated' } } }, samples });
  const status = vi.spyOn(artistSamples, 'getArtistSampleStatus').mockResolvedValue({ packs: [{ id: 'v5', phase: 'ready', model: 'nai-diffusion-5-full' }] } as any);
  const catalog = vi.spyOn(artistSamples, 'getArtistSampleCatalog').mockResolvedValue({ pack: 'v5', revision: 'one', tags: ['old pack'], model: 'nai-diffusion-5-curated' });
  try {
    expect((await getArtistSampleData()).samples).toEqual(samples);
    expect(await getSampledArtistTags()).toEqual(new Set(['new full', 'medium']));
    catalog.mockResolvedValue({ pack: 'v5', revision: 'two', tags: ['full pack'], model: 'nai-diffusion-5-full' });
    expect(await getSampledArtistTags()).toEqual(new Set(['new full', 'medium', 'full pack']));
  } finally { status.mockRestore(); catalog.mockRestore(); }
});

it('删除只提交样张移除标记，成功广播且GET过滤旧自建缓存，失败不广播', async () => {
  const removal = { source: 'own' as const, pack: 'v45' as const, tag: 'artist', id: 'sample' };
  const changed = vi.fn(); window.addEventListener(ARTIST_SAMPLES_CHANGED, changed);
  try {
    vi.mocked(api.post).mockResolvedValueOnce(undefined);
    await deleteArtistSample(removal);
    expect(api.post).toHaveBeenCalledWith('/artist-sample-data', { action: 'remove', pack: 'v45', removal });
    expect(changed).toHaveBeenCalledOnce();
    vi.mocked(api.get).mockResolvedValueOnce({ templates: {}, samples: [{ ...removal, imageUrl: '/old.png' }], removedSamples: [removal] });
    expect((await getArtistSampleData()).samples).toEqual([]);
    vi.mocked(api.post).mockRejectedValueOnce(new Error('failure'));
    await expect(deleteArtistSample(removal)).rejects.toThrow('failure'); expect(changed).toHaveBeenCalledOnce();
  } finally { window.removeEventListener(ARTIST_SAMPLES_CHANGED, changed); }
});

describe('按需自建画师样张', () => {
  it('只替换画师占位符并取用完整固定配置，准备草稿不提交生成或保存', () => {
    const template = getDefaultArtistSampleTemplate('v45');
    template.params.characters = [{ id: 'actor', prompt: 'blue hair', negativePrompt: '', x: 0.5, y: 0.5 }];
    prepareArtistSampleImport('sample_artist', 'v45', template);
    const draft = JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!);
    expect(draft.prompt).toBe(buildArtistSamplePrompt(template, 'sample_artist'));
    expect(draft).toMatchObject({ targetMode: 'text-to-image', fullMetadata: true, importSeed: true,
      params: template.params, artistSampleTarget: { id: expect.any(String), tag: 'sample_artist', pack: 'v45', historyIds: [] } });
    expect(api.post).not.toHaveBeenCalled();
    expect(template.prompt).toContain('{style}');
    expect(template.characterPrompt).toBe(createDefaultRollTemplate(DEFAULT_NAI_RUNTIME).characterPrompt);
    expect(draft.prompt).toContain(template.characterPrompt);
  });

  it('旧模板生成保持原权重，只有主动转换草稿才统一替换位与完整参数', () => {
    const legacy = { ...getDefaultArtistSampleTemplate('v45'), prompt: 'before, 1.3::artist:{artist} ::, after', characterPrompt: 'blue hair' };
    expect(buildArtistSamplePrompt(legacy, 'sample_artist')).toBe('before, 1.3::artist:sample_artist ::, after, blue hair');
    const normalized = normalizeArtistSampleTemplate(legacy);
    expect(normalized.prompt).toBe('before, 1.3::{style} ::, after');
    expect(normalized.params).toEqual(legacy.params);
    expect(normalized.params).not.toBe(legacy.params);
    expect(legacy.prompt).toContain('artist:{artist}');
    expect(buildArtistSamplePrompt(normalized, 'sample_artist')).toBe('before, 1.3::artist:sample_artist, blue hair ::, after');
    expect(normalizeArtistSampleTemplate({ ...legacy, prompt: 'before, {artist}, after' }).prompt).toBe('before, {style}, after');
  });

  it('规范角色替换位参与最终生成，保存完整三栏且拒绝重复、混用和角色内替换位', async () => {
    const template = { ...getDefaultArtistSampleTemplate('v5'), prompt: 'before, {character}, {style}, after', characterPrompt: 'blue hair' };
    expect(buildArtistSamplePrompt(template, 'sample_artist')).toBe('before, blue hair, artist:sample_artist, after');
    await saveArtistSampleTemplate('v5', template);
    expect(api.post).toHaveBeenCalledWith('/artist-sample-data', { action: 'template', pack: 'v5', template });
    for (const change of [{ prompt: '{style}, {artist}' }, { prompt: '{style}, {style}' }, { prompt: '{style}, {character}, {character}' }, { characterPrompt: '{style}' }, { characterPrompt: 'a'.repeat(32001) }]) {
      await expect(saveArtistSampleTemplate('v5', { ...template, ...change })).rejects.toThrow();
    }
  });

  it('规范化旧替换位保留花括号、方括号和数字权重作用域，不插入额外重置符', () => {
    const base = { ...getDefaultArtistSampleTemplate('v45'), characterPrompt: '' };
    for (const [prompt, expected] of [
      ['{artist:{artist}}, best quality', '{artist:sample_artist}, best quality'],
      ['[artist:{artist}], best quality', '[artist:sample_artist], best quality'],
      ['1.2::artist:{artist}::, best quality', '1.2::artist:sample_artist::, best quality'],
    ]) {
      const legacy = { ...base, prompt };
      expect(buildArtistSamplePrompt(legacy, 'sample_artist')).toBe(expected);
      expect(buildArtistSamplePrompt(normalizeArtistSampleTemplate(legacy), 'sample_artist')).toBe(expected);
    }
  });

  it('拒绝跨模型配置、随机Seed及无画师占位符配置', async () => {
    const template = getDefaultArtistSampleTemplate('v45');
    await expect(saveArtistSampleTemplate('v5', template)).rejects.toThrow('V5 Full');
    await expect(saveArtistSampleTemplate('v45', { ...template, prompt: 'solo' })).rejects.toThrow('占位符');
    await expect(saveArtistSampleTemplate('v45', { ...template, params: { ...template.params, seed: undefined } })).rejects.toThrow('Seed');
    expect(api.post).not.toHaveBeenCalled();
  });

  const item = (): LocalGenItem => ({ id: 'synthetic-history', imageUrl: '/api/assets/original.png', prompt: 'solo, artist:sample artist',
    negativePrompt: 'low quality', params: getDefaultArtistSampleTemplate('v45').params, createdAt: 20 } as LocalGenItem);
  const target = { id: 'synthetic-target', tag: 'sample_artist', pack: 'v45' as const, historyIds: ['synthetic-history'] };
  it('不能把补图前的旧图片、另一个模型或另一个画师当成当前样张', () => {
    expect(canSaveArtistSample(item(), target)).toBe(true);
    expect(canSaveArtistSample({ ...item(), id: 'previous-history', createdAt: 999999 }, target)).toBe(false);
    expect(canSaveArtistSample({ ...item(), createdAt: 1 }, target)).toBe(true);
    expect(canSaveArtistSample(item(), { ...target, pack: 'v5' })).toBe(false);
    expect(canSaveArtistSample(item(), { ...target, tag: 'another artist' })).toBe(false);
    expect(canSaveArtistSample({ ...item(), prompt: 'artist:sample artist extra' }, target)).toBe(false);
    expect(canSaveArtistSample({ ...item(), prompt: '1.2::artist:sample artist::' }, target)).toBe(true);
    expect(canSaveArtistSample({ ...item(), prompt: 'solo, sample_artist' }, target)).toBe(true);
    expect(canSaveArtistSample({ ...item(), prompt: 'solo' }, target)).toBe(false);
  });

  it('保存的是已生成图片的真实参数与持久原图地址，不覆盖图包', async () => {
    await saveArtistOwnSample(target, item());
    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith('/artist-sample-data', { action: 'sample', pack: 'v45', sample: {
      id: 'sample-v45-synthetic-history', tag: 'sample_artist', pack: 'v45', imageUrl: '/api/assets/original.png',
      prompt: item().prompt, negativePrompt: item().negativePrompt, params: item().params, createdAt: 20,
    } });
  });

  it('旧历史没有负面提示词时按空内容保存样张，不补造提示词', async () => {
    await saveArtistOwnSample(target, { ...item(), negativePrompt: undefined });
    expect(api.post).toHaveBeenCalledWith('/artist-sample-data', expect.objectContaining({ sample: expect.objectContaining({ negativePrompt: '' }) }));
  });
});
