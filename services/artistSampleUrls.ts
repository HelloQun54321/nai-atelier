import { buildArtistSampleImageUrl, getArtistSampleCatalog, getArtistSampleStatus, normalizeArtistSampleTag, type ArtistSamplePack } from './artistSamples';
import { getArtistSampleData } from './artistSampleDrafts';

/** 自建样张优先；指定版本时不借用另一版的图片，未指定则继续按两版回退。 */
export async function loadArtistSampleUrls(pack?: ArtistSamplePack): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const [status, data] = await Promise.all([
    getArtistSampleStatus().catch(() => null),
    getArtistSampleData().catch(() => ({ templates: {}, samples: [] })),
  ]);
  for (const sample of data.samples) if (!pack || sample.pack === pack) urls.set(normalizeArtistSampleTag(sample.tag), sample.imageUrl);
  const ready = (pack ? [pack] : ['v45', 'v5'] as const).filter(value => status?.packs.some(item => item.id === value && item.phase === 'ready'));
  const catalogs = await Promise.all(ready.map(pack => getArtistSampleCatalog(pack).catch(() => null)));
  for (const [index, catalog] of catalogs.entries()) {
    if (!catalog) continue;
    for (const tag of catalog.tags) {
      const normalized = normalizeArtistSampleTag(tag);
      if (!urls.has(normalized)) urls.set(normalized, buildArtistSampleImageUrl(ready[index], tag, 0, catalog.revision));
    }
  }
  return urls;
}
