import { createUuid } from './id';
import { getRollArtistRange, getRollPinnedArtists, resolveRollArtists, rollCandidates, type RollExperiment, type RollRound } from './styleRoll';

export const currentRollRound = (e: RollExperiment) => e.rounds.at(-1);

export function beginRollRound(e: RollExperiment, library: string[], count: number, options: { blockedTags?: string[]; sampledOnly?: boolean; preferredTags?: string[] } = {}): RollExperiment {
  const pinnedArtists = getRollPinnedArtists(e);
  const source = { ...e, drawPlan: undefined, pinnedArtists, rules: { ...e.rules, ...getRollArtistRange(e) } };
  const resolved = resolveRollArtists(library, e.artists);
  const available = options.sampledOnly ? new Set(library.map(tag => tag.trim().replaceAll('_', ' ').toLowerCase())) : null;
  const added = rollCandidates({ ...source, artists: available ? resolved.filter(artist => artist.excluded || available.has(artist.tag.trim().replaceAll('_', ' ').toLowerCase())) : resolved }, count, options);
  const round: RollRound = {
    id: createUuid(), candidateIds: added.map(candidate => candidate.id), createdAt: Date.now(),
    snapshot: {
      rules: { ...source.rules }, pinnedArtists: [...pinnedArtists],
      ...(options.sampledOnly ? { sampledOnly: true } : {}),
    },
  };
  return { ...source, candidates: [...e.candidates, ...added], rounds: [...e.rounds, round] };
}
