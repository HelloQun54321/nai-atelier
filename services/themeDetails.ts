import { HEX_COLOR_PATTERN, resolveThemePalette, ThemePalettes } from './themePalette';

export const THEME_DETAIL_NUMBERS = {
  fontSize: [14, 20, 16, .5],
  strongWeight: [400, 800, 600, 100],
  lineHeight: [1.2, 1.8, 1.5, .05],
  letterSpacing: [-.04, .08, 0, .005],
  iconStroke: [1, 2.5, 1.8, .1],
  controlHeight: [32, 48, 40, 1],
  controlRadius: [0, 999, 12, 1],
  panelRadius: [0, 36, 16, 1],
  cardRadius: [0, 32, 16, 1],
  spacing: [.2, .3, .25, .005],
  toolbarHeight: [44, 72, 56, 1],
  chromeInset: [0, 16, 0, 1],
  blur: [0, 40, 22, 1],
  saturation: [100, 200, 130, 5],
  opacity: [0, 1, .85, .01],
  globalOpacity: [0, 1, .6, .01],
  sidebarOpacity: [0, 1, .76, .01],
  toolbarOpacity: [0, 1, .82, .01],
  panelOpacity: [0, 1, .94, .01],
  labEditorOpacity: [0, 1, .6, .01],
  borderOpacity: [0, 1, .45, .05],
  controlShadow: [0, 1, .25, .05],
  highlight: [0, 1, .5, .05],
  shadow: [0, 2, 1, .05],
  refraction: [0, 24, 0, 1],
  duration: [100, 400, 180, 10],
} as const;

export type ThemeDetailNumber = keyof typeof THEME_DETAIL_NUMBERS;
export type ThemeDetailVariant = Partial<Record<ThemeDetailNumber, number>> & { accentColor?: string };
export type ThemeDetails = Partial<Record<ThemeDetailNumber, number>> & {
  fontFamily?: string;
  material?: 'frosted' | 'glass';
  motionCurve?: 'smooth' | 'spring';
  controlStyle?: 'outlined' | 'filled';
  light?: ThemeDetailVariant;
  dark?: ThemeDetailVariant;
};
const FONT_FAMILY = /^[\p{L}\p{N}\s,'"_-]{1,220}$/u;
const normalizeDetailVariant = (input: unknown): ThemeDetailVariant | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const source = input as Record<string, unknown>;
  const result: ThemeDetailVariant = {};
  for (const key of Object.keys(THEME_DETAIL_NUMBERS) as ThemeDetailNumber[]) {
    const value = source[key];
    const [min, max] = THEME_DETAIL_NUMBERS[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) result[key] = value;
  }
  if (typeof source.accentColor === 'string' && HEX_COLOR_PATTERN.test(source.accentColor)) result.accentColor = source.accentColor;
  return Object.keys(result).length ? result : undefined;
};
export const normalizeThemeDetails = (input: unknown): ThemeDetails | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const source = input as Record<string, unknown>;
  const numbers = normalizeDetailVariant(input) || {};
  delete numbers.accentColor;
  const result: ThemeDetails = numbers;
  if (typeof source.fontFamily === 'string' && FONT_FAMILY.test(source.fontFamily) && source.fontFamily.trim()) result.fontFamily = source.fontFamily.trim();
  if (source.material === 'frosted' || source.material === 'glass') result.material = source.material;
  if (source.motionCurve === 'smooth' || source.motionCurve === 'spring') result.motionCurve = source.motionCurve;
  if (source.controlStyle === 'outlined' || source.controlStyle === 'filled') result.controlStyle = source.controlStyle;
  for (const mode of ['light', 'dark'] as const) {
    const variant = normalizeDetailVariant(source[mode]);
    if (variant) result[mode] = variant;
  }
  return Object.keys(result).length ? result : undefined;
};

export const resolveThemeDetails = (input: ThemeDetails | undefined, isDark: boolean) => {
  const details = normalizeThemeDetails(input);
  if (!details) return undefined;
  const { light, dark, ...common } = details;
  const resolved = { ...common, ...(isDark ? dark : light) };
  return {
    ...resolved,
    labEditorOpacity: resolved.labEditorOpacity ?? (isDark ? .6 : (resolved.panelOpacity ?? resolved.opacity ?? .85) * .5),
  };
};

const DETAIL_VARIABLES = ['--font-sans', '--spacing', '--workspace-toolbar-height', '--workspace-control-radius', '--workspace-card-radius', '--nai-control-height', '--nai-panel-radius', '--nai-chrome-inset', '--nai-icon-stroke', '--nai-line-height', '--nai-letter-spacing', '--nai-strong-weight', '--nai-glass-sidebar', '--nai-glass-toolbar', '--nai-glass-blur', '--nai-glass-saturation', '--nai-glass-opacity', '--nai-glass-highlight', '--nai-shadow-strength', '--nai-motion-duration', '--nai-motion-curve'];

export const applyThemeDetails = (root: HTMLElement, input: ThemeDetails | undefined, options: { fontScale: string; density: string; surfaces: string; palette?: ThemePalettes }) => {
  const details = resolveThemeDetails(input, root.classList.contains('dark'));
  root.style.removeProperty('--nai-glass-refraction');
  for (const field of ['globalOpacity', 'sidebarOpacity', 'toolbarOpacity', 'panelOpacity', 'labEditorOpacity', 'borderOpacity', 'controlShadow']) root.style.removeProperty('--nai-' + field.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()));
  for (const key of DETAIL_VARIABLES) root.style.removeProperty(key);
  root.style.removeProperty('font-size');
  delete root.dataset.themeDetails;
  delete root.dataset.themeMaterial;
  delete root.dataset.themeRefraction;
  delete root.dataset.controlStyle;
  if (!details) return;
  root.dataset.themeDetails = 'true';
  if (details.controlStyle) root.dataset.controlStyle = details.controlStyle;
  root.dataset.themeMaterial = options.surfaces === 'translucent' ? details.material || 'frosted' : 'solid';
  const density = options.density === 'compact' ? .9 : options.density === 'comfortable' ? 1.1 : 1;
  const set = (key: string, value: string | number) => root.style.setProperty(key, String(value));
  const palette = resolveThemePalette(options.palette, root.classList.contains('dark'));
  set('--nai-glass-sidebar', palette.sidebar);
  set('--nai-glass-toolbar', palette.toolbar);
  if (details.fontFamily) set('--font-sans', details.fontFamily);
  if (details.fontSize !== undefined) root.style.fontSize = `${details.fontSize * (options.fontScale === 'small' ? 15 / 16 : options.fontScale === 'large' ? 17 / 16 : 1)}px`;
  if (details.strongWeight !== undefined) set('--nai-strong-weight', details.strongWeight);
  if (details.spacing !== undefined) set('--spacing', `${details.spacing * density}rem`);
  if (details.toolbarHeight !== undefined) set('--workspace-toolbar-height', `${details.toolbarHeight * density}px`);
  if (details.controlRadius !== undefined) set('--workspace-control-radius', `${details.controlRadius}px`);
  if (details.cardRadius !== undefined) set('--workspace-card-radius', `${details.cardRadius}px`);
  if (details.controlHeight !== undefined) set('--nai-control-height', `${details.controlHeight * density}px`);
  if (details.panelRadius !== undefined) set('--nai-panel-radius', `${details.panelRadius}px`);
  if (details.chromeInset !== undefined) set('--nai-chrome-inset', `${details.chromeInset}px`);
  if (details.iconStroke !== undefined) set('--nai-icon-stroke', details.iconStroke);
  if (details.lineHeight !== undefined) set('--nai-line-height', details.lineHeight);
  if (details.letterSpacing !== undefined) set('--nai-letter-spacing', `${details.letterSpacing}em`);
  if (details.refraction !== undefined) set('--nai-glass-refraction', details.refraction);
  if (details.blur !== undefined) set('--nai-glass-blur', `${details.blur}px`);
  if (details.saturation !== undefined) set('--nai-glass-saturation', `${details.saturation}%`);
  if (details.opacity !== undefined) set('--nai-glass-opacity', `${details.opacity * 100}%`);
  for (const field of ['globalOpacity', 'sidebarOpacity', 'toolbarOpacity', 'panelOpacity', 'labEditorOpacity', 'borderOpacity', 'controlShadow'] as const) {
    if (details[field] !== undefined) set('--nai-' + field.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), field.endsWith('Opacity') ? `${details[field] * 100}%` : details[field]);
  }
  if (details.highlight !== undefined) set('--nai-glass-highlight', details.highlight);
  if (details.shadow !== undefined) set('--nai-shadow-strength', details.shadow);
  if (details.duration !== undefined) set('--nai-motion-duration', `${details.duration}ms`);
  if (details.motionCurve) set('--nai-motion-curve', details.motionCurve === 'spring' ? 'cubic-bezier(.2,.8,.2,1.15)' : 'cubic-bezier(.22,.61,.36,1)');
  if (root.dataset.themeMaterial === 'glass' && details.refraction) {
    root.dataset.themeRefraction = 'true';
  }
};

export const initThemeLight = () => {
  let frame = 0;
  let active: HTMLElement | null = null;
  let light: HTMLDivElement | null = null;
  const move = (event: PointerEvent) => {
    if (document.documentElement.dataset.themeMaterial !== 'glass' || document.documentElement.dataset.motion !== 'full' || event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce)').matches) { clear(); return; }
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-appearance="control"][data-tone="neutral"], .workspace-command-bar, .app-sidebar, .settings-navigation, .app-mobile-nav, .mobile-page-header, .mobile-detail-header, .mobile-detail-footer') : null;
    if (!target) { clear(); return; }
    if (active !== target) { clear(); active = target; }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (active !== target) return;
      frame = 0;
      if (!target.isConnected) { clear(); return; }
      const rect = target.getBoundingClientRect();
      if (!light) {
        light = document.createElement('div');
        light.className = 'nai-theme-light'; light.dataset.themeLight = 'true';
        light.setAttribute('aria-hidden', 'true'); document.body.append(light);
      }
      // 动态光斑只画在独立无滤镜层，不改玻璃节点的背景，避免触发整片背景重绘。
      light.dataset.lightKind = target.matches('[data-appearance="control"]') ? 'control' : 'chrome';
      Object.assign(light.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: getComputedStyle(target).borderRadius });
      light.style.setProperty('--nai-light-x', `${event.clientX - rect.left}px`);
      light.style.setProperty('--nai-light-y', `${event.clientY - rect.top}px`);
    });
  };
  const clear = () => {
    cancelAnimationFrame(frame); frame = 0;
    light?.remove(); light = null;
    active = null;
  };
  const leave = (event: PointerEvent) => { if (!event.relatedTarget) clear(); };
  const visibility = () => { if (document.hidden) clear(); };
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerout', leave);
  document.addEventListener('pointerleave', clear);
  document.addEventListener('pointercancel', clear);
  document.addEventListener('pointerdown', clear, true);
  document.addEventListener('keydown', clear, true);
  document.addEventListener('focusin', clear);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('scroll', clear, true);
  window.addEventListener('blur', clear);
  window.addEventListener('resize', clear);
  window.addEventListener('pagehide', clear);
  return () => {
    clear(); document.removeEventListener('pointermove', move); document.removeEventListener('pointerout', leave);
    document.removeEventListener('pointerleave', clear); document.removeEventListener('pointercancel', clear);
    document.removeEventListener('pointerdown', clear, true); document.removeEventListener('keydown', clear, true);
    document.removeEventListener('focusin', clear);
    document.removeEventListener('visibilitychange', visibility); document.removeEventListener('scroll', clear, true);
    window.removeEventListener('blur', clear); window.removeEventListener('resize', clear); window.removeEventListener('pagehide', clear);
  };
};
