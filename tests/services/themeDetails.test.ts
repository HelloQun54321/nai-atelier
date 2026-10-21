// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyAppearancePreferences, DEFAULT_APPEARANCE_PREFERENCES, appearanceValues, BUILTIN_APPEARANCE_PRESET, readAppearancePresetImport, serializeAppearancePresets, saveAppearancePreferences, loadAppearancePreferences } from '../../services/appearancePreferences';
import { initThemeLight, normalizeThemeDetails, resolveThemeDetails, THEME_DETAIL_NUMBERS, ThemeDetails } from '../../services/themeDetails';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); document.getElementById('nai-glass-optics')?.remove(); applyAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES, false); });
describe('可分享的高级主题能力', () => {
  it('全局不透明度单独保存、导出和清除，明暗覆盖不改写实验室与旧分层参数', () => {
    const details = { material: 'glass' as const, globalOpacity: .4, panelOpacity: .8, labEditorOpacity: .6, light: { globalOpacity: 0, labEditorOpacity: .3 }, dark: { globalOpacity: 1 } };
    saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, surfaces: 'translucent', details });
    const preferences = loadAppearancePreferences();
    expect(preferences.details).toEqual(details);
    expect(readAppearancePresetImport(serializeAppearancePresets([{ ...BUILTIN_APPEARANCE_PRESET, details }]))[0].details).toEqual(details);
    for (const [dark, global, lab] of [[false, '0%', '30%'], [true, '100%', '60%']] as const) {
      applyAppearancePreferences(preferences, dark);
      expect(document.documentElement.style.getPropertyValue('--nai-global-opacity')).toBe(global);
      expect(document.documentElement.style.getPropertyValue('--nai-lab-editor-opacity')).toBe(lab);
      expect(document.documentElement.style.getPropertyValue('--nai-panel-opacity')).toBe('80%');
    }
    applyAppearancePreferences({ ...preferences, details: { panelOpacity: .8 } }, true);
    expect(document.documentElement.style.getPropertyValue('--nai-global-opacity')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--nai-panel-opacity')).toBe('80%');
    expect(document.documentElement.style.getPropertyValue('--nai-lab-editor-opacity')).toBe('60%');
  });
  it('实验室暗度独立持久化与分享，旧主题默认深色 60%，清除后不残留覆盖', () => {
    const legacy = { material: 'glass' as const, panelOpacity: .8, sidebarOpacity: .7 };
    expect(resolveThemeDetails(legacy, true)?.labEditorOpacity).toBe(.6);
    expect(resolveThemeDetails(legacy, false)?.labEditorOpacity).toBe(.4);
    const details = { ...legacy, labEditorOpacity: .6, light: { labEditorOpacity: 0 }, dark: { labEditorOpacity: 1 } };
    saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, surfaces: 'translucent', details });
    const preferences = loadAppearancePreferences();
    expect(preferences.details).toEqual(details);
    const exported = serializeAppearancePresets([{ ...BUILTIN_APPEARANCE_PRESET, details }]);
    expect(readAppearancePresetImport(exported)[0].details).toEqual(details);
    for (const [dark, value] of [[false, '0%'], [true, '100%']] as const) {
      applyAppearancePreferences(preferences, dark);
      expect(document.documentElement.style.getPropertyValue('--nai-lab-editor-opacity')).toBe(value);
      expect(document.documentElement.style.getPropertyValue('--nai-panel-opacity')).toBe('80%');
      expect(document.documentElement.style.getPropertyValue('--nai-sidebar-opacity')).toBe('70%');
    }
    applyAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES, true);
    expect(document.documentElement.style.getPropertyValue('--nai-lab-editor-opacity')).toBe('');
  });
  it('交付的 Cupertino 示例通过真实导入器，并保留明暗覆盖与可分享参数', () => {
    const [preset] = readAppearancePresetImport(readFileSync('public/themes/cupertino-liquid-glass.json', 'utf8'));
    expect(preset.name).toBe('Cupertino Liquid Glass');
    expect(resolveThemeDetails(preset.details, false)?.accentColor).toBe('#007aff');
    expect(resolveThemeDetails(preset.details, true)?.accentColor).toBe('#0a84ff');
    expect(resolveThemeDetails(preset.details, true)?.controlStyle).toBe('filled');
    for (const dark of [false, true]) {
      const details = resolveThemeDetails(preset.details, dark)!;
      // 导航轻透，独立面板略厚；材料清楚分层，不再以统一灰白底覆盖全部表面。
      expect(details.panelOpacity).toBeLessThanOrEqual(.85);
      expect(details.toolbarOpacity).toBeLessThanOrEqual(.65);
      expect(details.blur).toBeGreaterThanOrEqual(16);
      expect(details.sidebarOpacity).toBeLessThan(details.panelOpacity!);
      expect(details.toolbarOpacity).toBeLessThan(details.panelOpacity!);
      applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, ...preset }, dark);
      expect(document.documentElement.style.getPropertyValue('--nai-panel-opacity')).toBe(`${details.panelOpacity! * 100}%`);
    }
    expect(resolveThemeDetails(preset.details, true)?.highlight).toBeLessThan(.4);
    expect(preset.details?.globalOpacity).toBeUndefined();
    expect(appearanceValues(readAppearancePresetImport(serializeAppearancePresets([preset]))[0])).toEqual(appearanceValues(preset));
  });
  it('明暗参数逐字段继承，导入完整验证并保留分层材质和控件风格', () => {
    const details: ThemeDetails = { controlStyle: 'filled', controlHeight: 36, blur: 24, sidebarOpacity: .75, toolbarOpacity: .85, panelOpacity: .96, borderOpacity: .3, controlShadow: .4, light: { accentColor: '#006adc', highlight: .5 }, dark: { accentColor: '#0a84ff', highlight: .15, controlShadow: .1 } };
    expect(resolveThemeDetails(details, true)).toMatchObject({ controlStyle: 'filled', controlHeight: 36, sidebarOpacity: .75, highlight: .15, controlShadow: .1 });
    expect(resolveThemeDetails(details, false)).toMatchObject({ highlight: .5, controlShadow: .4, accentColor: '#006adc' });
    const preset = { ...BUILTIN_APPEARANCE_PRESET, details };
    expect(readAppearancePresetImport(serializeAppearancePresets([preset]))[0].details).toEqual(details);
    for (const bad of [{ controlStyle: 'macOS' }, { accentColor: '#ffffff' }, { dark: { customCss: 'body{}' } }, { light: { opacity: -.1 } }, { dark: { accentColor: 'url(x)' } }, { light: [] }, { dark: { dark: {} } }]) {
      expect(() => readAppearancePresetImport(JSON.stringify({ name: '非法覆盖', details: bad }))).toThrow();
    }
  });

  it('切换明暗即时更新强调色和材质，清除高级主题不残留控件或分层覆盖', () => {
    const preferences = { ...DEFAULT_APPEARANCE_PREFERENCES, surfaces: 'translucent' as const, details: { controlStyle: 'filled' as const, sidebarOpacity: .72, toolbarOpacity: .84, panelOpacity: .96, dark: { accentColor: '#0a84ff', borderOpacity: .25 }, light: { accentColor: '#006adc', controlShadow: .4 } } };
    const root = document.documentElement;
    applyAppearancePreferences(preferences, true);
    expect(root.dataset.controlStyle).toBe('filled');
    expect(root.style.getPropertyValue('--nai-accent')).toBe('#0a84ff');
    expect(root.style.getPropertyValue('--nai-panel-opacity')).toBe('96%');
    expect(root.style.getPropertyValue('--nai-border-opacity')).toBe('25%');
    applyAppearancePreferences(preferences, false);
    expect(root.style.getPropertyValue('--nai-accent')).toBe('#006adc');
    expect(root.style.getPropertyValue('--nai-control-shadow')).toBe('0.4');
    expect(root.style.getPropertyValue('--nai-border-opacity')).toBe('');
    applyAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES, false);
    expect(root.dataset.controlStyle).toBeUndefined();
    for (const key of ['--nai-panel-opacity', '--nai-sidebar-opacity', '--nai-toolbar-opacity', '--nai-control-shadow']) expect(root.style.getPropertyValue(key)).toBe('');
    expect(root.style.getPropertyValue('--nai-accent')).toBe(DEFAULT_APPEARANCE_PREFERENCES.accentColor);
  });
  it('所有数字有边界，字体只引用已安装名称，不接受任意 CSS、URL 或脚本', () => {
    for (const [key, [min, max]] of Object.entries(THEME_DETAIL_NUMBERS)) {
      expect(normalizeThemeDetails({ [key]: min })).toEqual({ [key]: min });
      expect(normalizeThemeDetails({ [key]: max })).toEqual({ [key]: max });
      for (const value of [min - 1, max + 1, NaN, Infinity, '24']) expect(normalizeThemeDetails({ [key]: value })).toBeUndefined();
    }
    for (const fontFamily of ['url(https://example.invalid/a.woff)', 'system-ui; color:red', 'font{color:red}', '   ']) expect(normalizeThemeDetails({ fontFamily })).toBeUndefined();
    expect(normalizeThemeDetails({ fontFamily: '"本机字体", system-ui', customCss: 'body{}' })).toEqual({ fontFamily: '"本机字体", system-ui' });
    for (const details of [{ unknown: 1 }, { refraction: 25 }, { material: 'script' }, { duration: '220ms' }]) expect(() => readAppearancePresetImport(JSON.stringify({ version: 3, presets: [{ name: '能力验证', details }] }))).toThrow();
  });

  it('高级排版、几何、材质与动画完整往返，旧格式仍可读', () => {
    const details: ThemeDetails = { fontFamily: 'system-ui, sans-serif', fontSize: 15, strongWeight: 600, lineHeight: 1.4, letterSpacing: -.01, iconStroke: 1.6, controlHeight: 34, controlRadius: 999, panelRadius: 20, cardRadius: 12, spacing: .24, toolbarHeight: 52, chromeInset: 6, material: 'glass', blur: 20, saturation: 160, opacity: .8, highlight: .6, shadow: .7, refraction: 8, duration: 200, motionCurve: 'spring' };
    const preset = { ...BUILTIN_APPEARANCE_PRESET, details };
    const exported = serializeAppearancePresets([preset]);
    expect(JSON.parse(exported).version).toBe(3);
    expect(appearanceValues(readAppearancePresetImport(exported)[0])).toEqual(appearanceValues(preset));
    for (const version of [1, 2]) expect(readAppearancePresetImport(JSON.stringify({ version, presets: [{ name: '旧主题' }] }))[0].details).toBeUndefined();
  });

  it('切换主题清除所有高级覆盖，基础密度字号和实色／动效偏好仍有效', () => {
    const root = document.documentElement;
    applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, surfaces: 'translucent', fontScale: 'large', density: 'compact', palette: { light: { sidebar: '#fefefe', toolbar: '#dddddd' } }, details: { material: 'glass', fontSize: 16, strongWeight: 500, controlHeight: 40, controlRadius: 999, blur: 28, refraction: 10 } }, false);
    expect(root.style.fontSize).toBe('17px');
    expect(root.style.getPropertyValue('--nai-control-height')).toBe('36px');
    expect(root.style.getPropertyValue('--workspace-control-radius')).toBe('999px');
    expect(root.style.getPropertyValue('--nai-strong-weight')).toBe('500');
    expect(root.style.getPropertyValue('--nai-glass-sidebar')).toBe('#fefefe');
    expect(root.style.getPropertyValue('--nai-glass-toolbar')).toBe('#dddddd');
    expect(root.dataset.themeMaterial).toBe('glass');
    expect(document.querySelector('#nai-glass-optics')).toBeNull();
    expect(root.dataset.themeRefraction).toBe('true');
    applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, surfaces: 'solid', motion: 'off', details: { material: 'glass' } }, false);
    expect(root.dataset.themeMaterial).toBe('solid');
    expect(root.dataset.themeRefraction).toBeUndefined();
    expect(root.dataset.motion).toBe('off');
    applyAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES, true);
    expect(root.style.fontSize).toBe('');
    expect(root.style.getPropertyValue('--nai-control-height')).toBe('');
    expect(root.style.getPropertyValue('--workspace-control-radius')).toBe('');
    expect(root.dataset.themeDetails).toBeUndefined();
    expect(root.style.getPropertyValue('--nai-glass-refraction')).toBe('');
  });

  it('玻璃光照只响应鼠标和完整动效，减少动效与触屏不追踪，清理会移除监听', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const button = document.createElement('button');
    button.dataset.appearance = 'control'; button.dataset.tone = 'neutral'; document.body.append(button);
    const move = (pointerType: string) => { const event = new Event('pointermove', { bubbles: true }); Object.assign(event, { pointerType, clientX: 40, clientY: 20 }); button.dispatchEvent(event); };
    const cleanup = initThemeLight();
    const light = () => document.querySelector<HTMLElement>('.nai-theme-light');
    try {
      applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, surfaces: 'translucent', details: { material: 'glass' } }, false);
      move('touch'); expect(light()).toBeNull();
      move('mouse'); expect(light()?.style.getPropertyValue('--nai-light-x')).toBe('40px');
      expect(button.getAttribute('style')).toBeNull(); expect(button.dataset.themeLight).toBeUndefined();
      document.body.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), { pointerType: 'mouse' }));
      expect(light()).toBeNull();
      move('mouse');
      window.dispatchEvent(new Event('blur')); expect(light()).toBeNull();
      document.documentElement.dataset.motion = 'reduced'; move('mouse'); expect(light()).toBeNull();
      document.documentElement.dataset.motion = 'full'; vi.stubGlobal('matchMedia', () => ({ matches: true })); move('mouse'); expect(light()).toBeNull();
    } finally { cleanup(); button.remove(); }
  });

  it('大面板不追光，按钮与导航快速切换只点亮最后一个，滚动和离开清除旧光照', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };
    const panel = document.createElement('div'); panel.className = 'operation-dialog';
    const content = document.createElement('div'); content.className = 'settings-content'; panel.append(content);
    const group = document.createElement('div'); group.className = 'appearance-control-panel'; content.append(group);
    const sidebar = document.createElement('nav'); sidebar.className = 'settings-navigation'; panel.append(sidebar);
    const toolbar = document.createElement('header'); toolbar.className = 'workspace-command-bar'; group.append(toolbar);
    const first = document.createElement('button'), second = document.createElement('button'), icon = document.createElement('span');
    for (const button of [first, second]) { button.dataset.appearance = 'control'; button.dataset.tone = 'neutral'; toolbar.append(button); }
    first.append(icon); document.body.append(panel);
    const move = (target: Element, x = 40) => target.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), { pointerType: 'mouse', clientX: x, clientY: 20 }));
    const lit = () => [...document.querySelectorAll<HTMLElement>('.nai-theme-light')];
    const cleanup = initThemeLight();
    try {
      applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, surfaces: 'translucent', details: { material: 'glass' } }, false);
      for (const surface of [panel, content, group]) { move(surface); flush(); expect(lit()).toEqual([]); }
      move(sidebar); flush(); expect(lit()).toHaveLength(1); expect(lit()[0].dataset.lightKind).toBe('chrome');
      move(toolbar); flush(); expect(lit()).toHaveLength(1); expect(lit()[0].dataset.lightKind).toBe('chrome');
      expect(sidebar.style.getPropertyValue('--nai-light-x')).toBe('');
      move(first); move(icon, 50); move(second, 60);
      expect(lit()).toEqual([]);
      expect(panel.style.getPropertyValue('--nai-light-x')).toBe('');
      expect(frames.size).toBe(1);
      flush(); expect(lit()).toHaveLength(1); expect(lit()[0].dataset.lightKind).toBe('control');
      expect(lit()[0].style.getPropertyValue('--nai-light-x')).toBe('60px');
      for (const target of [panel, content, group, sidebar, toolbar, first, second]) {
        expect(target.getAttribute('style')).toBeNull(); expect(target.dataset.themeLight).toBeUndefined();
      }
      expect(first.style.getPropertyValue('--nai-light-x')).toBe('');
      move(toolbar); panel.dispatchEvent(new Event('scroll')); flush();
      expect(lit()).toEqual([]); expect(frames.size).toBe(0);
      move(first); flush(); move(content); flush(); expect(lit()).toEqual([]);
      move(first); flush();
      first.dispatchEvent(Object.assign(new Event('pointerout', { bubbles: true }), { relatedTarget: second }));
      expect(lit()).toHaveLength(1);
      first.dispatchEvent(Object.assign(new Event('pointerout', { bubbles: true }), { relatedTarget: null }));
      expect(lit()).toEqual([]);
      move(toolbar);
      toolbar.dispatchEvent(Object.assign(new Event('pointerout', { bubbles: true }), { relatedTarget: null }));
      flush(); expect(lit()).toEqual([]); expect(frames.size).toBe(0);
      for (const [target, type] of [[document, 'pointercancel'], [document, 'pointerdown'], [document, 'keydown'], [document, 'focusin'], [window, 'resize'], [window, 'pagehide']] as const) {
        move(first); flush(); expect(lit()).toHaveLength(1);
        target.dispatchEvent(new Event(type)); expect(lit()).toEqual([]);
        move(first); target.dispatchEvent(new Event(type)); flush();
        expect(lit()).toEqual([]); expect(frames.size).toBe(0);
      }
      move(first); flush();
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange')); expect(lit()).toEqual([]);
      hidden.mockRestore();
      move(first); second.remove(); first.remove(); flush(); expect(lit()).toEqual([]);
      toolbar.append(first, second);
      move(first); cleanup(); flush(); expect(lit()).toEqual([]);
      move(second); flush(); expect(lit()).toEqual([]);
    } finally { cleanup(); panel.remove(); }
  });
});
