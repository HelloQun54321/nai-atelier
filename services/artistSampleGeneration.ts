import type { LocalGenItem } from '../types';
import { isArtistOwnSampleForPack, isArtistOwnSampleRemoved, type ArtistSampleRemoval, type ArtistOwnSample, type ArtistSamplePack, type ArtistSampleTemplate } from './artistSamples';
import { buildArtistSamplePrompt, getArtistSampleData, saveArtistOwnSample, validateArtistSampleTemplate, type ArtistSampleTarget } from './artistSampleDrafts';
import { createUuid } from './id';
import { buildGenerationJobDescriptor } from './naiService';
import { beginGenerationSeries, subscribeGenerationSeries, type GenerationSeriesSession } from './generationSeries';
import { getRuntimeNaiModelInfo } from './naiModels';
import { getNaiRuntimeConfig } from './naiRuntime';

export interface ArtistSampleGeneration {
  target: ArtistSampleTarget;
  phase: 'preparing' | 'generating' | 'saving' | 'saved' | 'failed' | 'save_failed' | 'cancelled';
  session?: GenerationSeriesSession;
  item?: LocalGenItem;
  sample?: ArtistOwnSample;
  preview?: string;
  error?: string;
}
const states = new Map<string, ArtistSampleGeneration>();
const listeners = new Set<() => void>();
let revision = 0, watching = false;
let savedSamples: ArtistOwnSample[] = [];
const removedOwnSamples = new Set<string>();
const ownSampleKey = (sample: { pack: ArtistSamplePack; tag: string; id: string }) => JSON.stringify([sample.pack, sample.id]);
export const getGeneratedArtistSamples = () => savedSamples;
export function removeCachedArtistSample(removal: ArtistSampleRemoval) {
  if (removal.source !== 'own') return;
  removedOwnSamples.add(ownSampleKey(removal));
  savedSamples = savedSamples.filter(sample => !isArtistOwnSampleRemoved(sample, [removal]));
  for (const state of states.values()) if (state.sample && isArtistOwnSampleRemoved(state.sample, [removal])) {
    state.sample = undefined; state.preview = undefined;
  }
  publish();
}
const publish = () => { revision++; listeners.forEach(listener => listener()); };
export const artistSampleGenerationKey = (tag: string, pack: ArtistSamplePack) => `artist-sample:${pack}:${encodeURIComponent(tag)}`;
export const getArtistSampleGeneration = (tag: string, pack: ArtistSamplePack) => states.get(artistSampleGenerationKey(tag, pack));
export const artistSampleGenerationRevision = () => revision;
export const subscribeArtistSampleGeneration = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const readArtistSampleApiKey = () => (sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '').trim();
export const artistSampleGenerationBusy = (state?: ArtistSampleGeneration) => Boolean(state && ['preparing', 'generating', 'saving'].includes(state.phase));

/** 单张任务归属留在组件外；切页、筛选与卡片卸载只改变展示，不取消已确认任务。 */
export async function beginArtistSampleGeneration(tag: string, pack: ArtistSamplePack, template: ArtistSampleTemplate, key: string, approvedCost: number, stream: boolean, regenerate = false, isActive?: () => boolean): Promise<void> {
  const scope = artistSampleGenerationKey(tag, pack);
  if (artistSampleGenerationBusy(states.get(scope))) throw new Error('已有图片正在生成，请等待完成');
  validateArtistSampleTemplate(pack, template);
  if (!key || readArtistSampleApiKey() !== key) throw new Error('NovelAI Key 已变化，请重新发起生成');
  const target: ArtistSampleTarget = { id: createUuid(), tag, pack, historyIds: [] };
  const state: ArtistSampleGeneration = { target, phase: 'preparing' }; states.set(scope, state); publish();
  if (!watching) { watching = true; subscribeGenerationSeries(() => { if ([...states.values()].some(value => value.session)) publish(); }); }
  try {
    const runtime = await getNaiRuntimeConfig();
    const prompt = buildArtistSamplePrompt(template, tag);
    const descriptor = await buildGenerationJobDescriptor({ operation: 'text-to-image', prompt, negative: template.negativePrompt,
      params: structuredClone(template.params), forceEmptySeed: regenerate, stream: stream && getRuntimeNaiModelInfo(template.params.model, runtime).supportsStreamedResponses, approvedCost,
      history: { basePrompt: prompt, subjectPrompt: '', sourceChainId: scope, sourceChainName: tag, sourceChainType: 'style',
        modules: [{ id: `artist-sample-target:${target.id}`, name: '画师样张', content: JSON.stringify({ id: target.id, tag, pack }), isActive: false }] } });
    if (readArtistSampleApiKey() !== key) throw new Error('NovelAI Key 已变化，请重新发起生成');
    if (isActive && !isActive()) { state.phase = 'cancelled'; return; }
    const started = beginGenerationSeries({ scope, key, count: 1, agent: false, descriptor });
    state.session = started.session; state.phase = 'generating'; publish();
    const receipt = await started.settle;
    state.preview = started.session.preview?.image;
    state.item = started.session.lastSavedItem; target.historyIds = [...started.session.historyIds];
    if (!state.item) { state.phase = receipt.outcome === 'cancelled' ? 'cancelled' : 'failed'; state.error = receipt.outcome === 'cancelled' ? undefined : receipt.error || '生成失败'; return; }
    state.phase = 'saving'; publish();
    // 原图与历史由后台保存，样张同样由后台归档；这里只核对结果，不重复上传或生成。
    try {
      const data = await getArtistSampleData();
      data.samples = data.samples.filter(sample => isArtistOwnSampleForPack(sample) && !removedOwnSamples.has(ownSampleKey(sample)));
      state.sample = data.samples.find(sample => sample.id === `sample-${pack}-${state.item!.id}` && sample.pack === pack && sample.tag === tag);
      if (!state.sample) throw new Error('图片已保存到历史，但样张保存失败，请重试入库');
      savedSamples = data.samples;
      state.phase = 'saved';
      if (started.session.accountingFailed) state.error = '图片已保存，但本地记账异常，请核对额度后再继续' + (started.session.accountingError ? `：${started.session.accountingError}` : '');
      else if (started.session.cleanupError) state.error = started.session.cleanupError;
    } catch (cause) { state.phase = 'save_failed'; state.error = (cause as Error).message; }
  } catch (cause) { state.phase = 'failed'; state.error = (cause as Error).message; }
  finally { state.session = undefined; publish(); }
}

/** 保存失败的补救只复用真实历史，不再次投递收费任务。 */
export async function retryArtistSampleSave(tag: string, pack: ArtistSamplePack): Promise<void> {
  const state = getArtistSampleGeneration(tag, pack);
  if (!state?.item || state.phase !== 'save_failed') return;
  state.phase = 'saving'; state.error = undefined; publish();
  try {
    await saveArtistOwnSample(state.target, state.item);
    const data = await getArtistSampleData();
    data.samples = data.samples.filter(sample => isArtistOwnSampleForPack(sample) && !removedOwnSamples.has(ownSampleKey(sample)));
    state.sample = data.samples.find(sample => sample.id === `sample-${pack}-${state.item!.id}` && sample.pack === pack && sample.tag === tag);
    if (!state.sample) throw new Error('图片已保存到历史，但样张保存失败，请重试入库');
    savedSamples = data.samples;
    state.phase = 'saved';
  } catch (cause) { state.phase = 'save_failed'; state.error = (cause as Error).message; }
  finally { publish(); }
}
