import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_GENERATION_MEMORY_PREFERENCES,
  DEFAULT_LAB_MODULE_COLLAPSED,
  DEFAULT_LAB_PAGE_LAYOUTS,
  loadAppearancePreferences,
  normalizeAppearancePreferences,
  parseAppearancePresetsFromJson,
  saveAppearancePreferences,
  validateAppearancePreset,
  appearanceMatchesPreset,
  appearanceValues,
  BUILTIN_APPEARANCE_PRESET,
  readAppearancePresetImport,
  serializeAppearancePresets,
} from '../../services/appearancePreferences';

const localStorageValues = new Map<string, string>();
beforeEach(() => {
  localStorageValues.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => { localStorageValues.set(key, value); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('appearance preferences', () => {
  it('随工程交付的暖纸示例可以直接导入并完整往返', () => {
    const presets = readAppearancePresetImport(readFileSync('public/themes/warm-paper.json', 'utf8'));
    expect(presets[0].palette).toMatchObject({ light: { canvas: '#f5ecdc' }, dark: { panel: '#352c25' } });
    expect(readAppearancePresetImport(serializeAppearancePresets(presets))).toEqual(presets);
  });
  it('外观预设只保存主题效果，保存恢复不改图库全局与页面覆盖', () => {
    const display = JSON.stringify({ layout: 'masonry', columns: 2, desktopColumns: 5, pages: { artists: { layout: 'square', columns: 1, desktopColumns: 3 } } });
    localStorageValues.set('nai_mobile_image_display', display);
    saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, themeMode: 'dark' });
    expect(loadAppearancePreferences().themeMode).toBe('dark');
    expect(localStorageValues.get('nai_mobile_image_display')).toBe(display);
    expect(validateAppearancePreset({ name: '主题', imageDisplay: JSON.parse(display) })).not.toHaveProperty('imageDisplay');
  });

  it('旧偏好及旧主题默认开启卡片效果和选中聚焦，开关分别保存并恢复', () => {
    expect(normalizeAppearancePreferences({ galleryFrostedCaption: 'false', galleryHoverFloat: null })).toMatchObject({ galleryFrostedCaption: true, galleryHoverFloat: true, gallerySelectionFocus: true });
    expect(validateAppearancePreset({ name: '旧主题' })).toMatchObject({ galleryFrostedCaption: true, galleryHoverFloat: true, gallerySelectionFocus: true });
    for (const galleryFrostedCaption of [false, true]) for (const galleryHoverFloat of [false, true]) {
      saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, galleryFrostedCaption, galleryHoverFloat });
      expect(loadAppearancePreferences()).toMatchObject({ galleryFrostedCaption, galleryHoverFloat });
      expect(parseAppearancePresetsFromJson(JSON.stringify({ name: '卡片主题', galleryFrostedCaption, galleryHoverFloat }))[0]).toMatchObject({ galleryFrostedCaption, galleryHoverFloat });
    }
    for (const gallerySelectionFocus of [false, true]) {
      saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, gallerySelectionFocus });
      expect(loadAppearancePreferences().gallerySelectionFocus).toBe(gallerySelectionFocus);
      expect(parseAppearancePresetsFromJson(JSON.stringify({ name: '聚焦模式', gallerySelectionFocus }))[0].gallerySelectionFocus).toBe(gallerySelectionFocus);
    }
  });
  it('旧生图偏好缺少连续生成字段时默认开启', () => {
    localStorageValues.set('nai_appearance_preferences', JSON.stringify({ generationStreamPreview: true }));
    expect(loadAppearancePreferences().continuousGenerationEnabled).toBe(true);
    expect(normalizeAppearancePreferences({}).continuousGenerationEnabled).toBe(true);
  });

  it('原文框与翻译区高度跟随默认开启，可分别关闭并保存，不进入外观预设', () => {
    expect(normalizeAppearancePreferences({}).promptInputAutoHeight).toBe(true);
    expect(normalizeAppearancePreferences({}).promptTranslationAutoHeight).toBe(true);
    expect(normalizeAppearancePreferences({ promptInputAutoHeight: 'false', promptTranslationAutoHeight: null })).toMatchObject({
      promptInputAutoHeight: true,
      promptTranslationAutoHeight: true,
    });
    saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, promptInputAutoHeight: false, promptTranslationAutoHeight: false });
    expect(loadAppearancePreferences()).toMatchObject({ promptInputAutoHeight: false, promptTranslationAutoHeight: false });
    expect(validateAppearancePreset({ name: '主题', promptInputAutoHeight: false, promptTranslationAutoHeight: false }))
      .not.toHaveProperty('promptInputAutoHeight');
    expect(validateAppearancePreset({ name: '主题', promptTranslationAutoHeight: true }))
      .not.toHaveProperty('promptTranslationAutoHeight');
    expect(appearanceMatchesPreset({ ...DEFAULT_APPEARANCE_PREFERENCES, promptInputAutoHeight: false }, BUILTIN_APPEARANCE_PRESET)).toBe(true);
  });

  it('读取旧实验室分类偏好时忽略，保存新偏好时不再写回', () => {
    localStorageValues.set('nai_appearance_preferences', JSON.stringify({ tagAssistEnabled: false, promptClassificationEnabled: true, autoClassifyMetadata: true }));
    expect(loadAppearancePreferences().tagAssistEnabled).toBe(false);
    expect(loadAppearancePreferences()).not.toHaveProperty('promptClassificationEnabled');
    expect(loadAppearancePreferences()).not.toHaveProperty('autoClassifyMetadata');
    saveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    const persisted = JSON.parse(localStorageValues.get('nai_appearance_preferences')!);
    expect(persisted).not.toHaveProperty('promptClassificationEnabled');
    expect(persisted).not.toHaveProperty('autoClassifyMetadata');
  });

  it('旧偏好默认记住生图设置，关闭后重载仍保持关闭且不进入外观预设', () => {
    expect(loadAppearancePreferences().rememberGenerationSettings).toBe(true);
    expect(normalizeAppearancePreferences({ rememberGenerationSettings: 'false' }).rememberGenerationSettings).toBe(true);
    saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, rememberGenerationSettings: false });
    expect(loadAppearancePreferences().rememberGenerationSettings).toBe(false);
    expect(validateAppearancePreset({ name: '主题', rememberGenerationSettings: true })).not.toHaveProperty('rememberGenerationSettings');
  });

  it('旧记忆默认保留全部内容，缺失或无效的范围分别补默认', () => {
    expect(loadAppearancePreferences().generationMemory).toEqual(DEFAULT_GENERATION_MEMORY_PREFERENCES);
    expect(normalizeAppearancePreferences({ generationMemory: { globalPrompt: false, parameters: null } }).generationMemory)
      .toEqual({ ...DEFAULT_GENERATION_MEMORY_PREFERENCES, globalPrompt: false });
    expect(normalizeAppearancePreferences({ generationMemory: null }).generationMemory).toEqual(DEFAULT_GENERATION_MEMORY_PREFERENCES);
  });

  it('记忆范围独立保存，关闭主开关后重载不丢选择，也不写入外观预设', () => {
    const generationMemory = { parameters: true, globalPrompt: false, negativePrompt: false, characterPrompt: false, characterNegativePrompt: false };
    saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, rememberGenerationSettings: false, generationMemory });
    expect(loadAppearancePreferences()).toMatchObject({ rememberGenerationSettings: false, generationMemory });
    expect(validateAppearancePreset({ name: '主题', generationMemory })).not.toHaveProperty('generationMemory');
  });

  it('关闭连续生成后保存并重载仍保持关闭', () => {
    saveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      continuousGenerationEnabled: false,
    });
    expect(JSON.parse(localStorageValues.get('nai_appearance_preferences')!).continuousGenerationEnabled).toBe(false);
    expect(loadAppearancePreferences().continuousGenerationEnabled).toBe(false);
  });
  it('accepts a complete supported theme customization', () => {
    const normalized = normalizeAppearancePreferences({
      designTheme: 'nai-atelier',
      themeMode: 'dark',
      accentColor: '#0EA5E9',
      density: 'compact',
      corners: 'sharp',
      surfaces: 'translucent',
      motion: 'reduced',
      fontScale: 'large',
      galleryFrostedCaption: true,
      galleryHoverFloat: true,
      gallerySelectionFocus: true,
      tagAssistEnabled: false,
      generationStreamPreview: true,
      rememberGenerationSettings: false,
      continuousGenerationEnabled: false,
      forceEmptySeed: true,
      enforceFreeStepLimit: false,
      labModuleOrder: ['params', 'prompt', 'negative', 'vibe', 'characters', 'characterReference'],
      labModuleCollapsed: {
        prompt: true,
        characters: false,
        params: true,
        negative: false,
        characterReference: false,
        vibe: true,
      },
    });
    expect(normalized).toEqual({
      designTheme: 'nai-atelier',
      themeMode: 'dark',
      accentColor: '#0ea5e9',
      density: 'compact',
      corners: 'sharp',
      surfaces: 'translucent',
      motion: 'reduced',
      fontScale: 'large',
      galleryFrostedCaption: true,
      galleryHoverFloat: true,
      gallerySelectionFocus: true,
      tagAssistEnabled: false,
      promptInputAutoHeight: true,
      promptTranslationAutoHeight: true,
      generationStreamPreview: true,
      rememberGenerationSettings: false,
      generationMemory: DEFAULT_GENERATION_MEMORY_PREFERENCES,
      continuousGenerationEnabled: false,
      forceEmptySeed: true,
      enforceFreeStepLimit: false,
      labPageLayouts: {
        ...DEFAULT_LAB_PAGE_LAYOUTS,
        'text-to-image': {
          collapsed: {
            prompt: true,
            characters: false,
            params: true,
            negative: false,
            characterReference: false,
            vibe: true,
          },
        },
      },
      customPresets: [],
      activePresetId: 'builtin-default',
    });
  });

  it('falls back safely when persisted values are malformed', () => {
    expect(normalizeAppearancePreferences({
      designTheme: 'unknown',
      themeMode: 'sepia',
      accentColor: 'red',
      density: 3,
      corners: null,
      surfaces: 'glassier',
      motion: 'fast',
      fontScale: 'huge',
      tagAssistEnabled: 'sometimes',
      generationStreamPreview: 'sometimes',
      labModuleOrder: 'anything',
      labModuleCollapsed: null,
    })).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('忽略旧排序并保留有效的旧默认展开偏好，保存后不再写回排序', () => {
    const normalized = normalizeAppearancePreferences({
      labModuleOrder: ['vibe', 'unknown', 'prompt', 'vibe'],
      labModuleCollapsed: { vibe: false, prompt: 'yes', unknown: true },
    });
    expect(normalized.labPageLayouts['text-to-image']).toEqual({
      collapsed: { ...DEFAULT_LAB_MODULE_COLLAPSED, vibe: false },
    });
    expect(normalized).not.toHaveProperty('labModuleOrder');
    expect(normalized).not.toHaveProperty('labModuleCollapsed');
    saveAppearancePreferences(normalized);
    expect(localStorageValues.get('nai_appearance_preferences')).not.toMatch(/labModuleOrder|labModuleCollapsed|"order"/);
    expect(loadAppearancePreferences().labPageLayouts).toEqual(normalized.labPageLayouts);
  });

  it('旧默认展开偏好只用于文生图，各编辑模式独立补齐默认值', () => {
    const normalized = normalizeAppearancePreferences({
      labModuleOrder: ['negative', 'prompt'],
      labModuleCollapsed: { negative: true },
    });
    expect(normalized.labPageLayouts['text-to-image'].collapsed.negative).toBe(true);
    expect(normalized.labPageLayouts['image-to-image']).toEqual(DEFAULT_LAB_PAGE_LAYOUTS['image-to-image']);
    normalized.labPageLayouts.inpaint.collapsed.prompt = true;
    expect(normalized.labPageLayouts.outpaint.collapsed.prompt).toBe(false);
    expect(DEFAULT_LAB_PAGE_LAYOUTS.inpaint.collapsed.prompt).toBe(false);
  });

  it('四模式忽略旧顺序，各自保留默认展开并过滤未知或无效字段', () => {
    const normalized = normalizeAppearancePreferences({
      labPageLayouts: {
        'text-to-image': { order: ['vibe', 'negative', 'prompt'], collapsed: { negative: true } },
        'image-to-image': { order: ['params', 'prompt'], collapsed: { prompt: true } },
        inpaint: { order: ['editSettings', 'unknown', 'prompt'], collapsed: { editSettings: true, prompt: 'yes', negative: true, unknown: true } },
        outpaint: { order: ['vibe', 'params'], collapsed: { baseImage: true } },
      },
    });
    expect(normalized.labPageLayouts).toEqual({
      'text-to-image': { collapsed: { ...DEFAULT_LAB_MODULE_COLLAPSED, negative: true } },
      'image-to-image': { collapsed: { ...DEFAULT_LAB_PAGE_LAYOUTS['image-to-image'].collapsed, prompt: true } },
      inpaint: { collapsed: { ...DEFAULT_LAB_PAGE_LAYOUTS.inpaint.collapsed, editSettings: true } },
      outpaint: { collapsed: { ...DEFAULT_LAB_PAGE_LAYOUTS.outpaint.collapsed, baseImage: true } },
    });
  });

  it('validates and normalizes appearance presets', () => {
    expect(validateAppearancePreset(null)).toBeNull();
    expect(validateAppearancePreset({})).toBeNull();
    expect(validateAppearancePreset({ name: '   ' })).toBeNull();

    const valid = validateAppearancePreset({
      name: '深夜极客',
      accentColor: '#14B8A6',
      themeMode: 'dark',
      density: 'compact',
      corners: 'sharp',
      surfaces: 'translucent',
      motion: 'reduced',
      fontScale: 'small',
    });
    expect(valid).not.toBeNull();
    expect(valid?.name).toBe('深夜极客');
    expect(valid?.accentColor).toBe('#14b8a6');
    expect(valid?.density).toBe('compact');
    expect(valid?.corners).toBe('sharp');
    expect(valid?.surfaces).toBe('translucent');
  });

  it('parses appearance presets from various JSON formats safely', () => {
    expect(parseAppearancePresetsFromJson('invalid json')).toEqual([]);

    const singleJson = JSON.stringify({
      name: '单项预设',
      accentColor: '#8b5cf6',
      themeMode: 'light',
    });
    const parsedSingle = parseAppearancePresetsFromJson(singleJson);
    expect(parsedSingle).toHaveLength(1);
    expect(parsedSingle[0].name).toBe('单项预设');
    expect(parsedSingle[0].accentColor).toBe('#8b5cf6');

    const arrayJson = JSON.stringify([
      { name: '预设 1', accentColor: '#0ea5e9' },
      { name: '预设 2', accentColor: '#e11d48' },
    ]);
    const parsedArray = parseAppearancePresetsFromJson(arrayJson);
    expect(parsedArray).toHaveLength(2);
    expect(parsedArray[0].name).toBe('预设 1');
    expect(parsedArray[1].name).toBe('预设 2');
    expect(() => readAppearancePresetImport('[{"name":"有效主题"},{"invalid":true}]')).toThrow('主题名称');

    const wrappedJson = JSON.stringify({
      presets: [
        { name: '包装预设', accentColor: '#d97706' },
      ],
    });
    const parsedWrapped = parseAppearancePresetsFromJson(wrappedJson);
    expect(parsedWrapped).toHaveLength(1);
    expect(parsedWrapped[0].name).toBe('包装预设');
  });

  it('preserves custom presets and active preset id in preferences', () => {
    const normalized = normalizeAppearancePreferences({
      customPresets: [
        { id: 'custom-1', name: '我的预设', accentColor: '#0ea5e9', createdAt: 1000 },
      ],
      activePresetId: 'custom-1',
    });
    expect(normalized.customPresets).toHaveLength(1);
    expect(normalized.customPresets[0].id).toBe('custom-1');
    expect(normalized.customPresets[0].name).toBe('我的预设');
    expect(normalized.activePresetId).toBe('custom-1');
  });

  it('默认主题和新配色导出后均能重新导入，文件不携带内置锁或生图偏好', () => {
    const palette = { light: { canvas: '#fff4dd' }, dark: { text: '#f5e8d3' } };
    const current = { ...DEFAULT_APPEARANCE_PREFERENCES, palette };
    const preset = { ...BUILTIN_APPEARANCE_PRESET, ...appearanceValues(current) };
    const json = serializeAppearancePresets([preset]);
    expect(JSON.parse(json).version).toBe(3);
    expect(json).not.toMatch(/isBuiltin|generationMemory|labPageLayouts/);
    const imported = readAppearancePresetImport(json)[0];
    expect(imported.palette).toEqual(palette);
    expect(appearanceMatchesPreset(current, imported)).toBe(true);
    saveAppearancePreferences({ ...current, customPresets: [imported] });
    expect(loadAppearancePreferences().palette).toEqual(palette);
    expect(loadAppearancePreferences().customPresets[0].palette).toEqual(palette);
    expect(readAppearancePresetImport(JSON.stringify([BUILTIN_APPEARANCE_PRESET]))[0].isBuiltin).toBeUndefined();
  });

  it('修改外观才标为修改，非外观偏好不影响主题身份，配色键顺序不影响比较', () => {
    expect(appearanceMatchesPreset(DEFAULT_APPEARANCE_PREFERENCES, BUILTIN_APPEARANCE_PRESET)).toBe(true);
    expect(appearanceMatchesPreset({ ...DEFAULT_APPEARANCE_PREFERENCES, forceEmptySeed: true }, BUILTIN_APPEARANCE_PRESET)).toBe(true);
    expect(appearanceMatchesPreset({ ...DEFAULT_APPEARANCE_PREFERENCES, accentColor: '#ffffff' }, BUILTIN_APPEARANCE_PRESET)).toBe(false);
    expect(appearanceMatchesPreset({ ...DEFAULT_APPEARANCE_PREFERENCES, themeMode: 'light' }, BUILTIN_APPEARANCE_PRESET)).toBe(false);
    expect(appearanceMatchesPreset({ ...DEFAULT_APPEARANCE_PREFERENCES, palette: { light: { panel: '#ffffff', text: '#112233' } } }, { ...BUILTIN_APPEARANCE_PRESET, palette: { light: { text: '#112233', panel: '#ffffff' } } })).toBe(true);
  });

  it('旧格式兼容；未知版本、无效选项和未支持的美化字段明确拒绝', () => {
    expect(readAppearancePresetImport('{"version":1,"presets":[{"name":"旧主题"}]}')[0].accentColor).toBe('#0ea5e9');
    for (const input of [
      { version: 999, presets: [{ name: '未来主题' }] },
      { version: 2, customCss: 'body{}', presets: [{ name: '不支持的样式' }] },
      { name: '无效颜色', accentColor: 'red' },
      { name: '无效选项', corners: 'round' },
      { name: '自定义代码', customCss: 'body{}' },
      { name: '自定义配色', palette: { light: { unknown: '#ffffff' } } },
      { name: '无效配色', palette: { light: { panel: 'url(https://example.invalid)' } } },
      { name: '错误模式', palette: { system: { panel: '#ffffff' } } },
      { version: 2, presets: [] },
    ]) expect(() => readAppearancePresetImport(JSON.stringify(input))).toThrow();
  });
});
