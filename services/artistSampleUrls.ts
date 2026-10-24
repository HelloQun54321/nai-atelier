import { buildArtistSampleImageUrl, getArtistSampleCatalog, getArtistSampleStatus, getArtistSampleCatalogImageIndices, isArtistOwnSampleRemoved, isArtistOwnSampleForPack, isArtistSampleSourceForPack, normalizeArtistSampleTag, type ArtistSamplePack } from './artistSamples';
import { getArtistSampleData } from './artistSampleDrafts';

/** 自建样张优先；指定版本时不借用另一版的图片，未指定则继续按两版回退。 */
export async function loadArtistSampleUrls(pack?: ArtistSamplePack): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const [status, data] = await Promise.all([
    getArtistSampleStatus().catch(() => null),
    getArtistSampleData(),
  ]);
  for (const sample of data.samples) if (isArtistOwnSampleForPack(sample, pack || sample.pack) && !isArtistOwnSampleRemoved(sample, data.removedSamples)) urls.set(normalizeArtistSampleTag(sample.tag), sample.imageUrl);
  const ready = (pack ? [pack] : ['v45', 'v5'] as const).filter(value => status?.packs.some(item => item.id === value && item.phase === 'ready' && isArtistSampleSourceForPack(value, item)));
  const catalogs = await Promise.all(ready.map(pack => getArtistSampleCatalog(pack).catch(() => null)));
  for (const [index, catalog] of catalogs.entries()) {
    if (!catalog || !isArtistSampleSourceForPack(catalog.pack, catalog)) continue;
    const names = new Map<string, number>();
    for (const tag of catalog.tags) { const key = normalizeArtistSampleTag(tag); names.set(key, (names.get(key) || 0) + 1); }
    for (const [tag, imageIndex] of getArtistSampleCatalogImageIndices(catalog, data.removedSamples)) {
      const normalized = normalizeArtistSampleTag(tag);
      if (imageIndex !== undefined && !urls.has(normalized) && names.get(normalized) === 1)
        urls.set(normalized, buildArtistSampleImageUrl(ready[index], tag, imageIndex, catalog.revision));
    }
  }
  return urls;
}
