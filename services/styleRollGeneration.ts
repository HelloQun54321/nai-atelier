import { buildGenerationJobDescriptor } from './naiService';
import { beginGenerationSeries } from './generationSeries';
import { formatRollStyle, rollCandidateModuleId, rollGenerationParams, rollPrompt, rollSourceId, validateRollTemplate, type RollCandidate, type RollExperiment } from './styleRoll';

export const readRollApiKey = () => (sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '').trim();

/** 一轮有限配方一次提交，逐张保存与费用补充授权由既有后台任务负责。 */
export async function beginRollGeneration(experiment: RollExperiment, candidate: RollCandidate | RollCandidate[], key: string, approvedCost: number, stream: boolean) {
  validateRollTemplate(experiment.template);
  if (!key || readRollApiKey() !== key) throw new Error('NovelAI Key 已变化，请重新发起生成');
  const candidates = Array.isArray(candidate) ? candidate : [candidate];
  if (!candidates.length || candidates.length > 24) throw new Error('每轮可生成 1～24 张图片');
  const descriptors = [];
  for (const item of candidates) {
    const prompt = rollPrompt(experiment.template, item.tags);
    const descriptor = await buildGenerationJobDescriptor({
      operation: 'text-to-image', prompt, negative: experiment.template.negativePrompt,
      params: rollGenerationParams(experiment.template), forceEmptySeed: false, stream, approvedCost,
      history: { basePrompt: prompt, subjectPrompt: '',
        modules: [{ id: rollCandidateModuleId(item.id), name: 'Roll 串', content: formatRollStyle(item.tags), isActive: false }],
        sourceChainId: rollSourceId(experiment.id), sourceChainName: experiment.name, sourceChainType: 'style' },
    });
    descriptors.push(descriptor);
  }
  if (readRollApiKey() !== key) throw new Error('NovelAI Key 已变化，请重新发起生成');
  return beginGenerationSeries({ scope: rollSourceId(experiment.id), key, count: candidates.length, agent: false,
    descriptor: descriptors.length === 1 ? descriptors[0] : { ...descriptors[0], sequence: descriptors } });
}
