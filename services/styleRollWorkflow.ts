import { createUuid } from './id';
import { normalizeRollArtistKey } from './styleRollSeed';
import { getRollArtistRange, getRollPinnedArtists, resolveRollArtists, rollCandidates, validateRollChainArtistSource, type RollExperiment, type RollRound } from './styleRoll';

export const currentRollRound = (e: RollExperiment) => e.rounds.at(-1);

export function beginRollRound(e: RollExperiment, library: string[], count: number, options: { blockedTags?: string[]; sampledOnly?: boolean; preferredTags?: string[] } = {}): RollExperiment {
  const pinnedArtists = getRollPinnedArtists(e);
  const source = { ...e, drawPlan: undefined, pinnedArtists, rules: { ...e.rules, ...getRollArtistRange(e) } };
  if (e.chainArtistSource !== undefined) validateRollChainArtistSource(e.chainArtistSource);
  const sourceKey = (tag: string) => normalizeRollArtistKey(tag.normalize('NFKC').replace(/\\([()])/g, '$1'));
  const sourceKeys = e.chainArtistSource === undefined ? null : new Set(e.chainArtistSource.artists.map(artist => sourceKey(artist.tag)));
  // 旧覆盖项允许存在全角等同义写法；合并时任何一个排除标记都不能被后来的别名清掉。
  const sourceOverrides = new Map<string, RollExperiment['artists'][number]>();
  if (sourceKeys) for (const artist of e.artists) {
    const tag = sourceKey(artist.tag);
    sourceOverrides.set(tag, { ...artist, tag, excluded: artist.excluded || sourceOverrides.get(tag)?.excluded === true });
  }
  const resolved = resolveRollArtists(e.chainArtistSource?.artists.map(artist => sourceKey(artist.tag)) ?? library,
    sourceKeys ? [...sourceOverrides.values()] : e.artists)
    .filter(artist => !sourceKeys || artist.excluded || sourceKeys.has(sourceKey(artist.tag)));
  const availableKey = sourceKeys ? sourceKey : (tag: string) => tag.trim().replaceAll('_', ' ').toLowerCase();
  const available = options.sampledOnly ? new Set(library.map(availableKey)) : null;
  const added = rollCandidates({ ...source, artists: available ? resolved.filter(artist => artist.excluded || available.has(availableKey(artist.tag))) : resolved }, count, options);
  const round: RollRound = {
    id: createUuid(), candidateIds: added.map(candidate => candidate.id), createdAt: Date.now(),
    snapshot: {
      rules: { ...source.rules }, pinnedArtists: [...pinnedArtists],
      ...(source.chainArtistSource === undefined ? {} : { chainArtistSource: { chainIds: [...source.chainArtistSource.chainIds], artists: source.chainArtistSource.artists.map(artist => ({ ...artist })) } }),
      ...(options.sampledOnly ? { sampledOnly: true } : {}),
    },
  };
  return { ...source, candidates: [...e.candidates, ...added], rounds: [...e.rounds, round] };
}
