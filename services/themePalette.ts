export interface ThemePalette {
  canvas: string;
  sidebar: string;
  toolbar: string;
  panel: string;
  text: string;
  mutedText: string;
  border: string;
}

export type ThemePalettes = Partial<Record<'light' | 'dark', Partial<ThemePalette>>>;
export const THEME_PALETTE_KEYS = ['canvas', 'sidebar', 'toolbar', 'panel', 'text', 'mutedText', 'border'] as const;
export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
export const DEFAULT_THEME_PALETTES: Record<'light' | 'dark', ThemePalette> = {
  light: { canvas: '#f3f5fa', sidebar: '#fbfcff', toolbar: '#ffffff', panel: '#ffffff', text: '#171e2d', mutedText: '#58667d', border: '#b4bccf' },
  dark: { canvas: '#0d0f14', sidebar: '#12151c', toolbar: '#12151c', panel: '#171b24', text: '#f0f2f8', mutedText: '#939db5', border: '#2f3647' },
};

export const normalizeThemePalettes = (input: unknown): ThemePalettes | undefined => {
  if (!input || typeof input !== 'object') return undefined;
  const result: ThemePalettes = {};
  for (const mode of ['light', 'dark'] as const) {
    const palette = (input as ThemePalettes)[mode];
    if (!palette || typeof palette !== 'object') continue;
    const colors: Partial<ThemePalette> = {};
    for (const key of THEME_PALETTE_KEYS) {
      const color = palette[key];
      if (typeof color === 'string' && HEX_COLOR_PATTERN.test(color)) colors[key] = color.toLowerCase();
    }
    if (Object.keys(colors).length) result[mode] = colors;
  }
  return Object.keys(result).length ? result : undefined;
};

export const resolveThemePalette = (palettes: ThemePalettes | undefined, isDark: boolean): ThemePalette => {
  const mode = isDark ? 'dark' : 'light';
  return { ...DEFAULT_THEME_PALETTES[mode], ...normalizeThemePalettes(palettes)?.[mode] };
};

const channels = (hex: string) => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
export const mixThemeColor = (color: string, background: string, weight: number): string => {
  const back = channels(background);
  return '#' + channels(color).map((value, index) => Math.round(value * weight + back[index] * (1 - weight)).toString(16).padStart(2, '0')).join('');
};
const luminance = (color: string) => channels(color).reduce((sum, value, index) => {
  const channel = value / 255;
  return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
}, 0);
export const themeContrast = (first: string, second: string): number => {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
export const themeForeground = (background: string): string => themeContrast('#ffffff', background) >= themeContrast('#000000', background) ? '#ffffff' : '#000000';

// 保留色相，并给浅色选中底和透光材质留少量对比余量。
const readableText = (accent: string, panel: string) => {
  const target = themeForeground(panel);
  for (let step = 0; step <= 20; step++) {
    const color = mixThemeColor(target, accent, step / 20);
    if (themeContrast(color, panel) >= 4.8) return color;
  }
  return target;
};

export const themeAccentColors = (accent: string, isDark: boolean): Record<number, string> => {
  const shades = isDark
    ? [[50, .12], [100, .24], [200, .4], [300, .6], [400, .8], [500, 1], [600, .72], [700, .58], [800, .42], [900, .28], [950, .16]]
    : [[50, .08], [100, .16], [200, .3], [300, .5], [400, .76], [500, 1], [600, .82], [700, .68], [800, .52], [900, .38], [950, .22]];
  return Object.fromEntries(shades.map(([shade, weight]) => [shade, mixThemeColor(accent, shade < 500 ? '#ffffff' : isDark ? (shade === 600 ? '#11141b' : '#0d0f14') : '#000000', weight)]));
};

export const themePaletteVariables = (palettes: ThemePalettes | undefined, isDark: boolean, translucent: boolean): Record<string, string> => {
  const overrides = normalizeThemePalettes(palettes)?.[isDark ? 'dark' : 'light'];
  if (!overrides) return {};
  const palette = resolveThemePalette(palettes, isDark);
  const surface = (color: string, opacity: number) => translucent ? `color-mix(in srgb, ${color} ${opacity}%, transparent)` : color;
  const result: Record<string, string> = {
    '--nai-canvas': palette.canvas,
    '--nai-sidebar-surface': surface(palette.sidebar, 82),
    '--nai-toolbar-surface': surface(palette.toolbar, 78),
    '--nai-panel-surface': surface(palette.panel, 85),
    '--nai-panel-solid-surface': palette.panel,
    '--nai-panel-border': palette.border,
    '--nai-panel-shadow': `0 18px 55px color-mix(in srgb, ${palette.text} ${isDark ? 25 : 11}%, transparent)`,
    '--nai-white-surface': isDark ? DEFAULT_THEME_PALETTES.light.panel : palette.panel,
  };
  // 组件现有的中性色阶共同派生，避免只改变大面板而留下原来的输入框和文字。
  for (const [shade, weight] of [[50, 0], [100, .04], [200, .12], [300, .24], [400, .4], [500, .55], [600, .68], [700, .8], [750, .85], [800, .9], [850, .94], [900, .97], [950, 1]]) {
    result[`--color-gray-${shade}`] = mixThemeColor(isDark ? palette.panel : palette.text, isDark ? palette.text : palette.panel, !isDark && shade === 600 ? .75 : weight);
  }
  result[isDark ? '--color-gray-100' : '--color-gray-900'] = palette.text;
  result[isDark ? '--color-gray-400' : '--color-gray-500'] = palette.mutedText;
  if (isDark) result['--color-gray-500'] = readableText(result['--color-gray-500'], palette.panel);
  return result;
};

export const applyThemeColors = (root: HTMLElement, palettes: ThemePalettes | undefined, isDark: boolean, translucent: boolean, accent: string) => {
  const variables = themePaletteVariables(palettes, isDark, translucent);
  // 切回默认或另一明暗版本时清除上一主题的覆盖，不能留下旧色。
  for (const key of Object.keys(themePaletteVariables({ light: DEFAULT_THEME_PALETTES.light }, false, false))) root.style.removeProperty(key);
  for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value);
  root.dataset.customPalette = String(Object.keys(variables).length > 0);
  root.style.setProperty('--nai-on-accent', themeForeground(accent));
  root.style.setProperty('--nai-on-action', themeForeground(mixThemeColor(accent, isDark ? '#0d0f14' : '#000000', isDark ? .55 : .68)));
  const panel = resolveThemePalette(palettes, isDark).panel;
  for (const [shade, color] of Object.entries(themeAccentColors(accent, isDark))) {
    root.style.setProperty(`--nai-on-accent-${shade}`, themeForeground(color));
    root.style.setProperty(`--nai-accent-text-${shade}`, readableText(color, panel));
  }
};
