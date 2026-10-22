export interface ThemeBackground {
  image: string;
  fit: 'cover' | 'contain' | 'tile';
  opacity: number;
  tileSize: number;
}
export const CUPERTINO_WALLPAPERS: { light: string; dark: string };
export function normalizeThemeBackground(value: unknown): ThemeBackground | undefined;
