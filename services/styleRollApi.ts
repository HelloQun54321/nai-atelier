import type { LocalGenItem } from '../types';
import { api } from './api';
import { localHistory } from './localHistory';
import { rollCandidateModuleId, rollPrompt, rollSourceId, validateRollBlocklist, validateRollExperiment, type RollExperiment } from './styleRoll';

export async function loadRollExperiments(): Promise<RollExperiment[]> {
  const result = await api.get('/style-roll', { cache: 'no-store' });
  if (!Array.isArray(result.experiments)) throw new Error('Roll 串资料读取失败');
  for (const experiment of result.experiments) validateRollExperiment(experiment);
  return result.experiments;
}

export async function saveRollExperiment(experiment: RollExperiment): Promise<RollExperiment> {
  const result = await api.put('/style-roll', experiment);
  validateRollExperiment(result.experiment);
  return result.experiment;
}

export async function loadRollBlocklist(): Promise<string[]> {
  const result = await api.get('/style-roll/blocklist', { cache: 'no-store' });
  if (!Array.isArray(result.tags)) throw new Error('屏蔽画师列表读取失败');
  validateRollBlocklist(result.tags);
  return result.tags;
}

export async function saveRollBlocklist(tags: string[]): Promise<string[]> {
  validateRollBlocklist(tags);
  const result = await api.put('/style-roll/blocklist', { tags });
  if (!Array.isArray(result.tags)) throw new Error('屏蔽画师列表读取失败');
  validateRollBlocklist(result.tags);
  return result.tags;
}

export async function loadRollHistory(experimentId: string): Promise<LocalGenItem[]> {
  const order = await localHistory.getBrowseOrder({ source: rollSourceId(experimentId), sort: 'oldest' });
  const result: LocalGenItem[] = [];
  for (let page = 0; page * 100 < order.ids.length; page++) result.push(...(await localHistory.getPage(page, 100, { orderIds: order.ids }, false)).items);
  return result;
}

export function rollCandidateImages(experiment: RollExperiment, history: LocalGenItem[]): Map<string, LocalGenItem> {
  const images = new Map<string, LocalGenItem>();
  for (const item of [...history].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    if (item.sourceChainId !== rollSourceId(experiment.id) || item.edit) continue;
    const candidate = experiment.candidates.find(candidate => item.modules?.some(module => module.id === rollCandidateModuleId(candidate.id)));
    if (candidate && !images.has(candidate.id) &&
      item.prompt === rollPrompt(experiment.template, candidate.tags) && item.params.seed === experiment.template.params.seed) images.set(candidate.id, item);
  }
  return images;
}
