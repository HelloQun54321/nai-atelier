import type { LocalGenItem } from '../../types';
import { DEFAULT_ROLL_RULES, parseRollArtists, rollCandidateModuleId, rollPrompt, rollSourceId, type RollCandidate, type RollExperiment } from '../../services/styleRoll';

export const rollFixture = (): RollExperiment => ({
  version: 1, id: 'synthetic-experiment', name: '合成实验', revision: 1, createdAt: 1, updatedAt: 1,
  template: { prompt: '{style}, synthetic subject', negativePrompt: 'synthetic negative', params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 0, qualityToggle: false, ucPreset: 4 } },
  artists: parseRollArtists('alpha, beta, gamma, delta, epsilon, zeta, eta, theta'), rules: { ...DEFAULT_ROLL_RULES }, candidates: [], rounds: [],
});
export const candidateFixture = (id: string, tag = id): RollCandidate => ({ id, tags: [{ tag, weight: 1 }], createdAt: 1, archived: false });
export const rollImageFixture = (experiment: RollExperiment, candidate: RollCandidate, id = `history-${candidate.id}`): LocalGenItem => ({
  id, imageUrl: `/api/local-history/${id}/image`, prompt: rollPrompt(experiment.template, candidate.tags), negativePrompt: experiment.template.negativePrompt,
  params: structuredClone(experiment.template.params), createdAt: 1, sourceChainId: rollSourceId(experiment.id), sourceChainName: experiment.name, sourceChainType: 'style',
  modules: [{ id: rollCandidateModuleId(candidate.id), name: 'Roll 串', content: '', isActive: false }],
});
export const seededRandom = (seed = 42) => { let value = seed; return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; }; };
