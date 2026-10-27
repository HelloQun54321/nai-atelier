import type { LocalGenItem } from '../types';
import type { RollCandidate, RollExperiment } from './styleRoll';
import { currentRollRound } from './styleRollWorkflow';

export interface RollWorkspaceView { filter: string; roundId: string; query: string; sort: string }

const normalized = (value: string) => value.trim().toLowerCase().replaceAll('_', ' ');

/** 收藏只看已出图的候选：未出图的配方既不算已收藏，也不算未收藏图片。 */
export function rollFavoriteMatches(candidate: RollCandidate, images: Map<string, LocalGenItem>, favoriteIds: ReadonlySet<string>, favorite: boolean) {
  return images.has(candidate.id) && favoriteIds.has(candidate.id) === favorite;
}

export function rollWorkspaceCandidates(experiment: RollExperiment, images: Map<string, LocalGenItem>, view: RollWorkspaceView, chineseNames?: Map<string, string>, favoriteIds: ReadonlySet<string> = new Set()) {
  const round = experiment.rounds.find(item => item.id === view.roundId);
  const query = normalized(view.query);
  return experiment.candidates.filter((candidate, index) => {
    if (view.roundId && !round?.candidateIds.includes(candidate.id)) return false;
    if (view.filter === 'archived' ? !candidate.archived : candidate.archived) return false;
    if (view.filter === 'saved' && !candidate.savedChainId || view.filter === 'pending' && images.has(candidate.id)) return false;
    if (view.filter === 'unsaved' && (!images.has(candidate.id) || candidate.savedChainId)) return false;
    if ((view.filter === 'favorited' || view.filter === 'unfavorited') && !rollFavoriteMatches(candidate, images, favoriteIds, view.filter === 'favorited')) return false;
    return !query || String(index + 1) === query || `#${index + 1}` === query || candidate.tags.some(tag =>
      normalized(tag.tag).includes(query) || (chineseNames?.get(normalized(tag.tag)) || '').toLowerCase().includes(query));
  }).sort((a, b) => view.sort === 'old' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt || experiment.candidates.indexOf(b) - experiment.candidates.indexOf(a));
}

/** 展示按钮与实际提交使用同一范围，不把历史缺图冒充成本轮待生成。 */
export function rollPendingCandidates(experiment: RollExperiment, images: Map<string, LocalGenItem>, ids?: readonly string[]) {
  const round = currentRollRound(experiment);
  const scope = ids ?? (round && !round.closedAt ? round.candidateIds : []);
  return experiment.candidates.filter(candidate => scope.includes(candidate.id) && !candidate.archived && !images.has(candidate.id));
}
