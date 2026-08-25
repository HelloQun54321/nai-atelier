// Pixiv proxy / OAuth web login / token refresh / artist page + works scraping
// are implemented on the local gateway side:
//   - scripts/pixiv-local.mjs     (Pixiv OAuth, token refresh, artist scraping)
//   - scripts/media-gateway.mjs   (Pixiv image/media proxy)
// The worker domain currently has no matching /api routes, so this module
// registers an empty handler. index.ts still imports and calls it so the
// module boundary stays explicit; returning null keeps the 404 behavior
// identical to the original monolithic worker.
import type { RouteContext } from './types';

export async function handlePixivRoute(_ctx: RouteContext): Promise<Response | null> {
  return null;
}
