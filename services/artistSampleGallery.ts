import type { ArtistDictionaryEntry } from './tagDictionary';
import type { ArtistSampleData } from './artistSampleDrafts';
import { getAvailableArtistSampleCatalogTags, getSampledArtistDictionaryEntries, isArtistOwnSampleForPack, isArtistOwnSampleRemoved, matchArtistSampleTags, normalizeArtistSampleTag, type ArtistOwnSample, type ArtistSampleCatalog, type ArtistSamplePack } from './artistSamples';

/** 两个画师入口按同一套原名／无冲突别名规则匹配样张。 */
export function indexArtistSampleGallery(library: ArtistDictionaryEntry[], data: ArtistSampleData, catalogs: Partial<Record<ArtistSamplePack, ArtistSampleCatalog>>, generated: ArtistOwnSample[]) {
  const forPack = (pack: ArtistSamplePack) => {
    const own = [...new Map([...data.samples, ...generated].filter(sample => sample.pack === pack && isArtistOwnSampleForPack(sample, pack) && !isArtistOwnSampleRemoved(sample, data.removedSamples)).map(sample => [sample.id, sample])).values()].sort((left, right) => right.createdAt - left.createdAt);
    const catalog = catalogs[pack];
    const packed = getSampledArtistDictionaryEntries(library, catalog ? getAvailableArtistSampleCatalogTags(catalog, data.removedSamples) : []);
    const packTagNames = new Set(catalog?.tags || []), normalizedPackTags = new Map<string, string | undefined>();
    for (const tag of packTagNames) {
      const key = normalizeArtistSampleTag(tag);
      normalizedPackTags.set(key, normalizedPackTags.has(key) ? undefined : tag);
    }
    const ownArtists = matchArtistSampleTags(library, own.map(sample => sample.tag));
    return { own, packed, ownArtists, ownTags: new Set(own.map(sample => sample.tag)), packTagNames, normalizedPackTags, packedNames: new Set(packed.map(entry => entry.name)), ownNames: new Set(ownArtists.map(entry => entry.name)) };
  };
  return { v45: forPack('v45'), v5: forPack('v5') };
}
