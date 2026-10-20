import type { LocalGenItem, PromptChain } from '../types';
import { api, notifyLanAccessRequired, parseErrorResponse } from './api';
import { IMPORT_SESSION_KEY } from './metadataService';
import { compilePrompt } from './promptUtils';
import { parsePromptTags } from './tagTranslations';
import { createUuid } from './id';
import { broadcastArtistSamplesChanged, getArtistSampleCatalog, getArtistSampleStatus, normalizeArtistSampleTag, type ArtistSamplePack, type ArtistSampleTemplate, type ArtistOwnSample } from './artistSamples';

export type { ArtistSampleTemplate, ArtistOwnSample } from './artistSamples';
export interface ArtistSampleData { templates: Partial<Record<ArtistSamplePack, ArtistSampleTemplate>>; samples: ArtistOwnSample[] }
export interface ArtistSampleTarget { id: string; tag: string; pack: ArtistSamplePack; historyIds: string[] }

export const getArtistSampleData = (): Promise<ArtistSampleData> => api.get('/artist-sample-data');

/** 有可用样张的画师集合（图包 + 自建样张），归一化后用于抽取过滤。 */
export async function getSampledArtistTags(): Promise<Set<string>> {
  const [status, data] = await Promise.all([
    getArtistSampleStatus().catch(() => null),
    getArtistSampleData().catch(() => ({ templates: {}, samples: [] } as ArtistSampleData)),
  ]);
  const tags = new Set<string>();
  for (const sample of data.samples) tags.add(normalizeArtistSampleTag(sample.tag));
  const ready = (['v45', 'v5'] as const).filter(pack => status?.packs.some(item => item.id === pack && item.phase === 'ready'));
  const catalogs = await Promise.all(ready.map(pack => getArtistSampleCatalog(pack).catch(() => null)));
  for (const catalog of catalogs) for (const tag of catalog?.tags || []) tags.add(normalizeArtistSampleTag(tag));
  return tags;
}

/** 自建起点，绝不声称是外部图包的原始配方。 */
export const getDefaultArtistSampleTemplate = (pack: ArtistSamplePack): ArtistSampleTemplate => ({
  prompt: '1girl, solo, upper body, simple background, looking at viewer, artist:{artist}',
  negativePrompt: '',
  params: { model: pack === 'v45' ? 'nai-diffusion-4-5-full' : 'nai-diffusion-5-full', width: 832, height: 1216,
    steps: pack === 'v45' ? 28 : 23, scale: 5, sampler: 'k_euler_ancestral', seed: 0,
    qualityToggle: false, ucPreset: 4, characters: [] },
});

export function buildArtistSampleTemplateFromChain(chain: PromptChain): ArtistSampleTemplate {
  const prompt = compilePrompt(chain, chain.variableValues?.subject || '');
  return { prompt: prompt.includes('{artist}') ? prompt : `${prompt}${prompt ? ', ' : ''}artist:{artist}`,
    negativePrompt: chain.negativePrompt, params: structuredClone(chain.params) };
}

export const artistSampleModelMatches = (pack: ArtistSamplePack, model = '') =>
  !model.endsWith('-inpainting') && (pack === 'v45' ? /^nai-diffusion-4-5-/.test(model) : /^nai-diffusion-5-/.test(model));

export function validateArtistSampleTemplate(pack: ArtistSamplePack, template: ArtistSampleTemplate) {
  if (!template.prompt.includes('{artist}')) throw new Error('公共提示词必须包含 {artist} 占位符');
  if (!artistSampleModelMatches(pack, template.params.model)) throw new Error('样张配置的模型与所选版本不一致');
  if (!Number.isSafeInteger(template.params.seed) || template.params.seed! < 0) throw new Error('样张配置需要固定的非负 Seed');
}

export async function saveArtistSampleTemplate(pack: ArtistSamplePack, template: ArtistSampleTemplate): Promise<void> {
  validateArtistSampleTemplate(pack, template);
  await api.post('/artist-sample-data', { action: 'template', pack, template });
  broadcastArtistSamplesChanged();
}

/** 只准备用户可编辑的实验室草稿，生成仍由既有按钮与费用确认触发。 */
export function prepareArtistSampleImport(tag: string, pack: ArtistSamplePack, template: ArtistSampleTemplate): void {
  validateArtistSampleTemplate(pack, template);
  const artistSampleTarget: ArtistSampleTarget = { id: createUuid(), tag, pack, historyIds: [] };
  sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify({
    mode: 'prompt-fragments', targetMode: 'text-to-image', fullMetadata: true, replace: true,
    prompt: template.prompt.replaceAll('{artist}', tag), negativePrompt: template.negativePrompt,
    params: structuredClone(template.params), importSettings: true, importSeed: true, importModel: true, artistSampleTarget,
  }));
}

export function canSaveArtistSample(item: LocalGenItem | undefined, target: ArtistSampleTarget | null): boolean {
  if (!item || !target || item.edit || !target.historyIds.includes(item.id) || !artistSampleModelMatches(target.pack, item.params.model)) return false;
  return parsePromptTags(item.prompt).some(token => token.lookupTag === normalizeArtistSampleTag(target.tag));
}

export async function saveArtistOwnSample(target: ArtistSampleTarget, item: LocalGenItem): Promise<void> {
  if (!canSaveArtistSample(item, target)) throw new Error('当前图片与补图目标不一致，请使用对应画师和模型生成的新图片');
  let imageUrl = item.imageUrl;
  if (!imageUrl.startsWith('/api/assets/')) {
    if (!/^\/api\/local-history\/[^/]+\/image(?:\?.*)?$/.test(imageUrl)) throw new Error('请使用已保存的本地生成图片');
    const response = await fetch(imageUrl);
    notifyLanAccessRequired(response);
    if (!response.ok) throw await parseErrorResponse(response);
    const blob = await response.blob();
    imageUrl = (await api.uploadFile(new File([blob], 'artist-sample.png', { type: blob.type || 'image/png' }), 'artist-samples')).url;
  }
  const sample: ArtistOwnSample = { id: `sample-${target.pack}-${item.id}`, tag: target.tag, pack: target.pack,
    imageUrl, prompt: item.prompt, negativePrompt: item.negativePrompt ?? '', params: structuredClone(item.params), createdAt: item.createdAt };
  await api.post('/artist-sample-data', { action: 'sample', pack: target.pack, sample });
  broadcastArtistSamplesChanged();
}
