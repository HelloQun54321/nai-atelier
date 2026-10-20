import { buildArtistSampleImageUrl, getArtistSampleCatalog, getArtistSampleStatus, normalizeArtistSampleTag } from './artistSamples';
import { getArtistSampleData } from './artistSampleDrafts';

/** 取每位画师一张可展示的样张：自建样张优先，其次按 V4.5、V5 的图包目录。 */
export async function loadArtistSampleUrls(): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const [status, data] = await Promise.all([
    getArtistSampleStatus().catch(() => null),
    getArtistSampleData().catch(() => ({ templates: {}, samples: [] })),
  ]);
  for (const sample of data.samples) urls.set(normalizeArtistSampleTag(sample.tag), sample.imageUrl);
  const ready = (['v45', 'v5'] as const).filter(pack => status?.packs.some(item => item.id === pack && item.phase === 'ready'));
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
