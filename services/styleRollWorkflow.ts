import { createUuid } from './id';
import { getRollArtistCount, getRollPinnedArtists, resolveRollArtists, rollCandidates, type RollExperiment, type RollRound } from './styleRoll';

export const currentRollRound = (e: RollExperiment) => e.rounds.at(-1);

export function beginRollRound(e: RollExperiment, library: string[], count: number, options: { blockedTags?: string[]; sampledOnly?: boolean } = {}): RollExperiment {
  const pinnedArtists = getRollPinnedArtists(e), total = getRollArtistCount(e);
  const source = { ...e, drawPlan: undefined, pinnedArtists, rules: { ...e.rules, minArtists: total, maxArtists: total } };
  const added = rollCandidates({ ...source, artists: resolveRollArtists(library, e.artists) }, count, { blockedTags: options.blockedTags });
  const round: RollRound = {
    id: createUuid(), candidateIds: added.map(candidate => candidate.id), createdAt: Date.now(),
    snapshot: {
      rules: { ...source.rules }, pinnedArtists: [...pinnedArtists],
      ...(options.sampledOnly ? { sampledOnly: true } : {}),
    },
  };
  return { ...source, candidates: [...e.candidates, ...added], rounds: [...e.rounds, round] };
}
