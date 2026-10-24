import type { LocalGenItem } from '../types';
import { api, notifyLanAccessRequired, parseErrorResponse } from './api';
import { IMPORT_SESSION_KEY } from './metadataService';
import { parsePromptTags } from './tagTranslations';
import { createUuid } from './id';
import { createDefaultRollTemplate } from './styleRoll';
import { applyNaiModelSettings } from './naiModels';
import { DEFAULT_NAI_RUNTIME, type NaiRuntimeConfig } from './naiRuntime';
import { buildArtistSamplePrompt, validateArtistSamplePlaceholders } from './artistSampleTemplate';
export { buildArtistSamplePrompt, normalizeArtistSampleTemplate } from './artistSampleTemplate';
import { broadcastArtistSamplesChanged, getArtistSampleCatalog, getArtistSampleStatus, getAvailableArtistSampleCatalogTags, isArtistOwnSampleRemoved, isArtistOwnSampleForPack, isArtistSampleModelForPack, isArtistSampleSourceForPack, normalizeArtistSampleTag, type ArtistSampleRemoval, type ArtistSamplePack, type ArtistSampleTemplate, type ArtistOwnSample } from './artistSamples';

export type { ArtistSampleTemplate, ArtistOwnSample } from './artistSamples';
export interface ArtistSampleData { templates: Partial<Record<ArtistSamplePack, ArtistSampleTemplate>>; samples: ArtistOwnSample[]; removedSamples?: ArtistSampleRemoval[] }
export interface ArtistSampleTarget { id: string; tag: string; pack: ArtistSamplePack; historyIds: string[] }

export const getArtistSampleData = async (): Promise<ArtistSampleData> => {
  const data = await api.get('/artist-sample-data') as ArtistSampleData;
  return { ...data, samples: data.samples.filter(sample => !isArtistOwnSampleRemoved(sample, data.removedSamples)) };
};

export async function deleteArtistSample(removal: ArtistSampleRemoval): Promise<void> {
  await api.post('/artist-sample-data', { action: 'remove', pack: removal.pack, removal });
  broadcastArtistSamplesChanged();
}

/** 有可用样张的画师集合（图包 + 自建样张），归一化后用于抽取过滤。 */
export async function getSampledArtistTags(): Promise<Set<string>> {
  const [status, data] = await Promise.all([
    getArtistSampleStatus().catch(() => null),
    getArtistSampleData(),
  ]);
  const tags = new Set<string>();
  for (const sample of data.samples) if (isArtistOwnSampleForPack(sample) && !isArtistOwnSampleRemoved(sample, data.removedSamples)) tags.add(normalizeArtistSampleTag(sample.tag));
  const ready = (['v45', 'v5'] as const).filter(pack => status?.packs.some(item => item.id === pack && item.phase === 'ready' && isArtistSampleSourceForPack(pack, item)));
  const catalogs = await Promise.all(ready.map(pack => getArtistSampleCatalog(pack).catch(() => null)));
  for (const catalog of catalogs) if (catalog && isArtistSampleSourceForPack(catalog.pack, catalog)) for (const tag of getAvailableArtistSampleCatalogTags(catalog, data.removedSamples)) tags.add(normalizeArtistSampleTag(tag));
  return tags;
}

/** 自建起点，绝不声称是外部图包的原始配方。 */
export const getDefaultArtistSampleTemplate = (pack: ArtistSamplePack, runtime: NaiRuntimeConfig = DEFAULT_NAI_RUNTIME): ArtistSampleTemplate => {
  const template = createDefaultRollTemplate(runtime);
  return { ...template, params: applyNaiModelSettings({ ...template.params,
    model: pack === 'v45' ? 'nai-diffusion-4-5-full' : 'nai-diffusion-5-full', steps: runtime.freeMaxSteps }, runtime) };
};

export const artistSampleModelMatches = isArtistSampleModelForPack;

export function validateArtistSampleTemplate(pack: ArtistSamplePack, template: ArtistSampleTemplate) {
  validateArtistSamplePlaceholders(template);
  if (!artistSampleModelMatches(pack, template.params.model)) throw new Error(pack === 'v5' ? '画师样张仅支持 V5 Full' : '样张配置的模型与所选版本不一致');
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
    prompt: buildArtistSamplePrompt(template, tag), negativePrompt: template.negativePrompt,
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
