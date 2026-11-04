import type { NAIParams, PromptChain } from '../types';
import { normalizeArtistUsageKey } from './artistParticipation';
import { ARTIST_SAMPLES_CHANGED, getArtistSampleLibrary, normalizeArtistSampleTag } from './artistSamples';
import { loadArtistSampleUrls } from './artistSampleUrls';
import { addArtistPreferences, type ArtistPreferenceBatchResult } from './collectionFavorites';
import { extractGenerationArtistTags, extractRollChainArtistTags } from './styleRollChainArtists';

/** Roll 候选自带画师名单；风格串与成图从实际正向（含角色栏）识别。 */
export type ArtistExtractionSource =
  | { kind: 'tags'; tags: readonly string[] }
  | { kind: 'chain'; chain: PromptChain }
  | { kind: 'prompt'; prompt?: string; params?: Partial<NAIParams> };

let knownArtists: Promise<Map<string, string>> | undefined;
let watchingSamples = false;

/** 画师目录只在点按时读取并复用，图包变化后重读；词库未就绪时仍识别 artist: 显式写法，下次点按重试。 */
function loadKnownArtists(): Promise<Map<string, string>> {
  if (!watchingSamples && typeof window !== 'undefined') {
    watchingSamples = true;
    window.addEventListener(ARTIST_SAMPLES_CHANGED, () => { knownArtists = undefined; });
  }
  knownArtists ||= getArtistSampleLibrary()
    .then(entries => new Map(entries.map(entry => [normalizeArtistUsageKey(entry.name), entry.name])))
    .catch(() => { knownArtists = undefined; return new Map<string, string>(); });
  return knownArtists;
}

/** 识别结果尽量换回画师库里的原名，收藏库标题与画师库一致。 */
export async function extractArtistTags(source: ArtistExtractionSource): Promise<string[]> {
  if (source.kind === 'tags') return [...source.tags];
  const known = await loadKnownArtists();
  const keys = new Set(known.keys());
  const tags = source.kind === 'chain' ? extractRollChainArtistTags(source.chain, keys) : extractGenerationArtistTags(source, keys);
  return tags.map(tag => known.get(tag) || tag);
}

/** 只补未收藏的画师，有样张时沿用画师库同一张封面。 */
export async function favoriteArtistsFrom(source: ArtistExtractionSource): Promise<ArtistPreferenceBatchResult> {
  const tags = await extractArtistTags(source);
  if (!tags.length) return { tags: [], added: [], existing: [], failed: [] };
  return addArtistPreferences(tags, async () => {
    const urls = await loadArtistSampleUrls().catch(() => new Map<string, string>());
    return tag => urls.get(normalizeArtistSampleTag(tag));
  });
}
