// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAppearancePreferences, appearanceMatchesPreset, appearanceValues, BUILTIN_APPEARANCE_PRESET, DEFAULT_APPEARANCE_PREFERENCES, loadAppearancePreferences, readAppearancePresetImport, saveAppearancePreferences, serializeAppearancePresets } from '../../services/appearancePreferences';
import { normalizeThemeBackground, normalizeWorkspaceBackgrounds, resolveWorkspaceBackground, prepareThemeBackground, themeBackgroundStyle } from '../../services/themeBackground';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); applyAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES, false); });

describe('自定义工作区背景', () => {
  it('每个预设的明暗背景独立保存，重新应用外观不覆盖背景，也不进入预设快照', () => {
    const light = normalizeThemeBackground({ image, opacity: .7 })!, dark = { ...light, opacity: .9 };
    const workspaceBackgrounds = { custom: { light, dark }, other: { light: null } };
    const preferences = { ...DEFAULT_APPEARANCE_PREFERENCES, activePresetId: 'custom', workspaceBackgrounds };
    expect(saveAppearancePreferences(preferences)).toBe(true);
    const reloaded = loadAppearancePreferences();
    expect(reloaded.workspaceBackgrounds).toEqual(workspaceBackgrounds);
    for (const isDark of [false, true]) {
      applyAppearancePreferences({ ...reloaded, ...BUILTIN_APPEARANCE_PRESET, activePresetId: 'custom' }, isDark);
      const applied = document.documentElement.style.getPropertyValue('--nai-background-image');
      expect(applied).toContain(image); expect(Number(applied.match(/([\d.]+)%/)![1])).toBeCloseTo(isDark ? 10 : 30);
    }
    expect(appearanceMatchesPreset(reloaded, { ...BUILTIN_APPEARANCE_PRESET, ...appearanceValues(DEFAULT_APPEARANCE_PREFERENCES) })).toBe(true);
    expect(serializeAppearancePresets([{ ...BUILTIN_APPEARANCE_PRESET, ...reloaded }])).not.toContain('workspaceBackgrounds');
  });
  it('旧单背景沿用到当前预设的两个版本，显式移除优先于旧背景和配套壁纸', () => {
    const background = normalizeThemeBackground({ image })!;
    saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, activePresetId: 'legacy', background });
    expect(loadAppearancePreferences().workspaceBackgrounds?.legacy).toEqual({ light: background, dark: background });
    expect(resolveWorkspaceBackground({ legacy: { light: null } }, 'legacy', 'light', background)).toBeUndefined();
    expect(resolveWorkspaceBackground({ 'builtin-cupertino-liquid-glass': { dark: null } }, 'builtin-cupertino-liquid-glass', 'dark')).toBeUndefined();
    expect(normalizeWorkspaceBackgrounds({ broken: [], valid: { light: null, dark: { image: 'https://bad.invalid/a.jpg' } } })).toEqual({ valid: { light: null } });
  });
  it('第二套主题自动使用配套明暗壁纸，默认主题不被改变且外链仍被拒绝', () => {
    for (const mode of ['light', 'dark'] as const) {
      const background = resolveWorkspaceBackground(undefined, 'builtin-cupertino-liquid-glass', mode)!;
      expect(background.image).toContain(mode === 'light' ? 'cupertino-day.webp' : 'cupertino-night.webp');
      expect(resolveWorkspaceBackground(undefined, 'builtin-default', mode)).toBeUndefined();
      applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, activePresetId: 'builtin-cupertino-liquid-glass' }, mode === 'dark');
      expect(document.documentElement.style.getPropertyValue('--nai-background-image')).toContain(background.image);
    }
    expect(normalizeThemeBackground({ image: '/themes/wallpapers/arbitrary.webp' })).toBeUndefined();
  });
  it('本端偏好、主题保存导入与明暗切换保留同一图片，恢复默认清除背景', () => {
    const background = normalizeThemeBackground({ image, fit: 'tile', opacity: .7, tileSize: 256 })!;
    const preset = { ...BUILTIN_APPEARANCE_PRESET, id: 'test', name: '带背景', isBuiltin: false, background };
    const preferences = { ...DEFAULT_APPEARANCE_PREFERENCES, ...preset };
    expect(saveAppearancePreferences(preferences)).toBe(true);
    expect(loadAppearancePreferences().background).toEqual(background);
    expect(readAppearancePresetImport(serializeAppearancePresets([preset]))[0].background).toEqual(background);
    expect(appearanceMatchesPreset(preferences, { ...preset, background: undefined })).toBe(false);
    for (const dark of [false, true]) {
      applyAppearancePreferences(preferences, dark);
      expect(document.documentElement.dataset.themeBackground).toBe('true');
      expect(document.documentElement.style.getPropertyValue('--nai-background-size')).toBe('auto, 256px auto');
      expect(document.documentElement.style.getPropertyValue('--nai-background-image')).toContain(image);
    }
    applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, ...appearanceValues(BUILTIN_APPEARANCE_PRESET), activePresetId: 'builtin-default' }, true);
    expect(document.documentElement.dataset.themeBackground).toBe('false');
    expect(document.documentElement.style.getPropertyValue('--nai-background-image')).toBe('');
    applyAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES, true);
    expect(document.documentElement.dataset.themeBackground).toBe('true');
    expect(document.documentElement.style.getPropertyValue('--nai-background-image')).toContain('cupertino-night.webp');
    expect(readAppearancePresetImport('{"name":"旧主题"}')[0].background).toBeUndefined();
  });
  it('背景不接受外链、SVG、任意 CSS、过大图片或非法显示参数', () => {
    for (const value of [
      { image: 'https://example.invalid/private.png' }, { image: 'data:image/svg+xml;base64,PHN2Zy8+' },
      { image: 'url(x); color:red' }, { image: 'data:image/png;base64,' + 'a'.repeat(1_000_000) },
      { image, fit: 'fixed' }, { image, fit: null }, { image, opacity: null }, { image, opacity: -1 }, { image, opacity: 1.1 },
      { image, tileSize: 0 }, { image, tileSize: 32.5 }, { image, css: 'bad' },
    ]) {
      expect(normalizeThemeBackground(value)).toBeUndefined();
      expect(() => readAppearancePresetImport(JSON.stringify({ name: '非法背景', background: value }))).toThrow();
    }
    expect(normalizeThemeBackground({ image })).toEqual({ image, fit: 'cover', opacity: 1, tileSize: 128 });
  });
  it('铺满、完整显示和平铺各自生效，降低强度使用随主题变化的画布色遮罩', () => {
    const background = normalizeThemeBackground({ image })!;
    expect(themeBackgroundStyle(background, '#123456')).toMatchObject({ backgroundSize: 'auto, cover', backgroundRepeat: 'no-repeat, no-repeat' });
    expect(themeBackgroundStyle({ ...background, fit: 'contain' }, '#123456').backgroundSize).toBe('auto, contain');
    expect(themeBackgroundStyle({ ...background, fit: 'tile', tileSize: 64, opacity: .25 }, '#123456')).toMatchObject({ backgroundSize: 'auto, 64px auto', backgroundRepeat: 'no-repeat, repeat' });
    expect(themeBackgroundStyle({ ...background, opacity: .25 }, '#123456').backgroundImage).toContain('#123456 75%');
  });
  it('上传只生成受限尺寸的副本，处理结束释放位图，失败不返回无效背景', async () => {
    const bitmap = { width: 3840, height: 2160, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(image);
    const file = new File(['synthetic'], 'test.png', { type: 'image/png' });
    expect((await prepareThemeBackground(file)).image).toBe(image);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1920, 1080);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue('data:,');
    await expect(prepareThemeBackground(file)).rejects.toThrow('压缩后的背景仍过大');
    expect(bitmap.close).toHaveBeenCalledTimes(2);
    await expect(prepareThemeBackground(new File(['x'], 'x.svg', { type: 'image/svg+xml' }))).rejects.toThrow('仅支持');
  });
  it('本端存储满时明确返回失败，旧偏好仍可读取', () => {
    saveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    expect(saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, background: normalizeThemeBackground({ image }) })).toBe(false);
    expect(loadAppearancePreferences().background).toBeUndefined();
  });
});
