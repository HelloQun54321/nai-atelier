export const CUPERTINO_WALLPAPERS = { light: '/themes/wallpapers/cupertino-day.webp', dark: '/themes/wallpapers/cupertino-night.webp' };

const MAX_IMAGE_LENGTH = 1_000_000;
const IMAGE_DATA = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const normalizeThemeBackground = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value;
  if (Object.keys(input).some(key => !['image', 'fit', 'opacity', 'tileSize'].includes(key))) return undefined;
  if (typeof input.image !== 'string' || input.image.length > MAX_IMAGE_LENGTH || (!IMAGE_DATA.test(input.image) && !Object.values(CUPERTINO_WALLPAPERS).includes(input.image))) return undefined;
  const fit = input.fit === undefined ? 'cover' : input.fit;
  const opacity = input.opacity === undefined ? 1 : input.opacity, tileSize = input.tileSize === undefined ? 128 : input.tileSize;
  if (!['cover', 'contain', 'tile'].includes(fit)
    || typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1
    || typeof tileSize !== 'number' || !Number.isInteger(tileSize) || tileSize < 32 || tileSize > 1024) return undefined;
  return { image: input.image, fit: fit, opacity, tileSize };
};
