import { createUuid } from './id';
import { resolveRollArtists, rollCandidates, type RollDrawPlan, type RollExperiment, type RollRound } from './styleRoll';

export const currentRollRound = (e: RollExperiment) => e.rounds.at(-1);

export function beginRollRound(e: RollExperiment, library: string[], count: number, options: { plan?: RollDrawPlan; blockedTags?: string[]; sampledOnly?: boolean } = {}): RollExperiment {
  const plan = options.plan;
  const added = rollCandidates({ ...e, artists: resolveRollArtists(library, e.artists) }, count, { plan, blockedTags: options.blockedTags });
  const round: RollRound = {
    id: createUuid(), candidateIds: added.map(candidate => candidate.id), createdAt: Date.now(),
    snapshot: {
      rules: { ...e.rules }, mode: plan?.mode ?? 'random',
      ...(plan?.mode === 'pinnedArtists' ? { pinnedArtists: [...plan.pinnedArtists!] } : {}),
      ...(options.sampledOnly ? { sampledOnly: true } : {}),
    },
  };
  return { ...e, candidates: [...e.candidates, ...added], rounds: [...e.rounds, round] };
}
