import type { LocalGenItem, PromptChain } from '../types';
import { applyPromptLibraryCoverFromHistory } from './promptLibraryCoverApi';
import {
  broadcastPromptLibraryCoverChanged, buildPromptLibraryCoverPrompt,
  promptLibraryCoverContent, validatePromptLibraryCoverTemplate, type PromptLibraryCoverTemplate,
} from './promptLibraryCoverTemplate';
import { buildGenerationJobDescriptor } from './naiService';
import { beginGenerationSeries, subscribeGenerationSeries, type GenerationSeriesSession } from './generationSeries';
import { getRuntimeNaiModelInfo } from './naiModels';
import { getNaiRuntimeConfig } from './naiRuntime';

export interface PromptLibraryCoverGeneration {
  chainId: string;
  phase: 'preparing' | 'generating' | 'saving' | 'saved' | 'failed' | 'save_failed' | 'cancelled';
  session?: GenerationSeriesSession;
  item?: LocalGenItem;
  previewImage?: string;
  preview?: string;
  error?: string;
}

const states = new Map<string, PromptLibraryCoverGeneration>();
const listeners = new Set<() => void>();
let revision = 0, watching = false;
const publish = () => { revision++; listeners.forEach(listener => listener()); };

export const promptLibraryCoverGenerationKey = (chainId: string) => `prompt-library-cover:${chainId}`;
export const getPromptLibraryCoverGeneration = (chainId: string) => states.get(promptLibraryCoverGenerationKey(chainId));
export const promptLibraryCoverGenerationRevision = () => revision;
export const subscribePromptLibraryCoverGeneration = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const readPromptLibraryCoverApiKey = () => (sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '').trim();
export const promptLibraryCoverGenerationBusy = (state?: PromptLibraryCoverGeneration) => Boolean(state && ['preparing', 'generating', 'saving'].includes(state.phase));

/** 单张任务归属留在组件外；切页、筛选与卡片卸载只改变展示，不取消已确认任务。 */
export async function beginPromptLibraryCoverGeneration(
  chain: PromptChain,
  template: PromptLibraryCoverTemplate,
  key: string,
  approvedCost: number,
  stream: boolean,
  regenerate = false,
  isActive?: () => boolean,
): Promise<void> {
  const chainId = chain.id;
  const scope = promptLibraryCoverGenerationKey(chainId);
  if (promptLibraryCoverGenerationBusy(states.get(scope))) throw new Error('已有封面正在生成，请等待完成');
  validatePromptLibraryCoverTemplate(template);
  if (!key || readPromptLibraryCoverApiKey() !== key) throw new Error('NovelAI Key 已变化，请重新发起生成');
  const content = promptLibraryCoverContent(chain);
  if (!content) throw new Error('这条记录还没有正文，无法生成封面');
  const state: PromptLibraryCoverGeneration = { chainId, phase: 'preparing' };
  states.set(scope, state);
  publish();
  if (!watching) {
    watching = true;
    subscribeGenerationSeries(() => { if ([...states.values()].some(value => value.session)) publish(); });
  }
  try {
    const runtime = await getNaiRuntimeConfig();
    const prompt = buildPromptLibraryCoverPrompt(template, content);
    const descriptor = await buildGenerationJobDescriptor({
      operation: 'text-to-image',
      prompt,
      negative: template.negativePrompt,
      params: structuredClone(template.params),
      forceEmptySeed: regenerate,
      stream: stream && getRuntimeNaiModelInfo(template.params.model, runtime).supportsStreamedResponses,
      approvedCost,
      history: {
        basePrompt: prompt,
        subjectPrompt: '',
        sourceChainId: scope,
        sourceChainName: chain.name || chainId,
        sourceChainType: chain.type || 'preset',
        modules: [{
          id: `prompt-library-cover-target:${chainId}`,
          name: '提示词库封面',
          content: JSON.stringify({ chainId }),
          isActive: false,
        }],
      },
    });
    if (readPromptLibraryCoverApiKey() !== key) throw new Error('NovelAI Key 已变化，请重新发起生成');
    if (isActive && !isActive()) { state.phase = 'cancelled'; return; }
    const started = beginGenerationSeries({ scope, key, count: 1, agent: false, descriptor });
    state.session = started.session;
    state.phase = 'generating';
    publish();
    const receipt = await started.settle;
    state.preview = started.session.preview?.image;
    state.item = started.session.lastSavedItem;
    if (!state.item) {
      state.phase = receipt.outcome === 'cancelled' ? 'cancelled' : 'failed';
      state.error = receipt.outcome === 'cancelled' ? undefined : receipt.error || '生成失败';
      return;
    }
    state.phase = 'saving';
    publish();
    try {
      const previewImage = await applyPromptLibraryCoverFromHistory(chainId, state.item.id);
      state.previewImage = previewImage;
      state.phase = 'saved';
      broadcastPromptLibraryCoverChanged(chainId, previewImage);
      const warnings = [
        started.session.accountingFailed ? '图片已保存，但本地记账异常，请核对额度后再继续' + (started.session.accountingError ? `：${started.session.accountingError}` : '') : '',
        started.session.cleanupError,
      ].filter(Boolean);
      if (warnings.length) state.error = warnings.join('；');
    } catch (cause) {
      state.phase = 'save_failed';
      state.error = (cause as Error).message;
    }
  } catch (cause) {
    state.phase = 'failed';
    state.error = (cause as Error).message;
  } finally {
    state.session = undefined;
    publish();
  }
}

/** 保存失败的补救只复用真实历史，不再次投递收费任务。 */
export async function retryPromptLibraryCoverSave(chainId: string): Promise<void> {
  const state = getPromptLibraryCoverGeneration(chainId);
  if (!state?.item || state.phase !== 'save_failed') return;
  state.phase = 'saving';
  state.error = undefined;
  publish();
  try {
    const previewImage = await applyPromptLibraryCoverFromHistory(chainId, state.item.id);
    state.previewImage = previewImage;
    state.phase = 'saved';
    broadcastPromptLibraryCoverChanged(chainId, previewImage);
  } catch (cause) {
    state.phase = 'save_failed';
    state.error = (cause as Error).message;
  } finally {
    publish();
  }
}
