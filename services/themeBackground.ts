import { CUPERTINO_WALLPAPERS, normalizeThemeBackground, type ThemeBackground } from './themeBackgroundData.mjs';
export { normalizeThemeBackground, type ThemeBackground } from './themeBackgroundData.mjs';

export type BackgroundMode = 'light' | 'dark';
export type WorkspaceBackgrounds = Record<string, Partial<Record<BackgroundMode, ThemeBackground | null>>>;
/** 背景是本端按主题和明暗记住的独立覆盖，null 表示主动移除，缺省才取配套壁纸。 */
export const normalizeWorkspaceBackgrounds = (value: unknown): WorkspaceBackgrounds => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, entry]) => {
    if (!id.trim() || id.length > 200 || !entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const variants = Object.fromEntries((['light', 'dark'] as const).flatMap(mode => {
      const raw = (entry as Record<string, unknown>)[mode], background = normalizeThemeBackground(raw);
      return raw === null || background ? [[mode, background || null]] : [];
    }));
    return Object.keys(variants).length ? [[id, variants]] : [];
  }));
};

export const resolveWorkspaceBackground = (backgrounds: WorkspaceBackgrounds | undefined, id: string, mode: BackgroundMode, fallback?: ThemeBackground): ThemeBackground | undefined => {
  const entry = backgrounds?.[id];
  if (entry && Object.hasOwn(entry, mode)) return normalizeThemeBackground(entry[mode]);
  return normalizeThemeBackground(fallback) || (id === 'builtin-cupertino-liquid-glass' ? normalizeThemeBackground({ image: CUPERTINO_WALLPAPERS[mode] }) : undefined);
};

export const themeBackgroundStyle = (background: ThemeBackground | undefined, canvas: string) => {
  if (!background) return {};
  const veil = `color-mix(in srgb, ${canvas} ${(1 - background.opacity) * 100}%, transparent)`;
  return {
    backgroundImage: `linear-gradient(${veil}, ${veil}), url("${background.image}")`,
    backgroundSize: `auto, ${background.fit === 'tile' ? `${background.tileSize}px auto` : background.fit}`,
    backgroundRepeat: `no-repeat, ${background.fit === 'tile' ? 'repeat' : 'no-repeat'}`,
    backgroundPosition: 'center',
  };
};

export const applyThemeBackground = (root: HTMLElement, value: ThemeBackground | undefined) => {
  const background = normalizeThemeBackground(value);
  root.dataset.themeBackground = String(Boolean(background));
  const style = themeBackgroundStyle(background, 'var(--nai-canvas)');
  for (const [key, property] of [['--nai-background-image', 'backgroundImage'], ['--nai-background-size', 'backgroundSize'], ['--nai-background-repeat', 'backgroundRepeat']] as const) {
    if (style[property]) root.style.setProperty(key, style[property]); else root.style.removeProperty(key);
  }
};

/** 本端只保存压缩副本；去掉原图元数据，并控制浏览器存储体积。 */
export const prepareThemeBackground = async (file: File): Promise<ThemeBackground> => {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw Error('仅支持 PNG、JPEG 或 WebP 背景');
  if (file.size > 20 * 1024 * 1024) throw Error('背景图片不能超过 20 MB');
  const image = await createImageBitmap(file).catch(() => { throw Error('无法读取背景图片，请检查文件'); });
  try {
    const ratio = Math.min(1, 1920 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw Error('当前浏览器无法处理背景图片');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const background = normalizeThemeBackground({ image: canvas.toDataURL('image/webp', .8) });
    if (!background) throw Error('压缩后的背景仍过大，请先缩小图片');
    return background;
  } finally { image.close(); }
};
