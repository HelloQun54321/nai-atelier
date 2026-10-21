// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppearancePresetPreview } from '../../components/AppearancePresetPreview';
import { BUILTIN_APPEARANCE_PRESET } from '../../services/appearancePreferences';
import { themeAccentColors } from '../../services/themePalette';

afterEach(cleanup);
describe('主题卡片独立预览', () => {
  it('全局明暗覆盖预览导航透明度，正文样例仍按实验室独立值', () => {
    const preset = { ...BUILTIN_APPEARANCE_PRESET, surfaces: 'translucent' as const, details: { globalOpacity: .4, sidebarOpacity: .8, toolbarOpacity: .9, labEditorOpacity: .6, light: { globalOpacity: 0 } } };
    const view = render(<AppearancePresetPreview preset={preset} isDark />);
    for (const part of ['sidebar', 'toolbar']) {
      expect(view.container.querySelector(`[data-preview-mode="light"] [data-preview-part="${part}"]`)?.getAttribute('style')).toContain('0%, transparent');
      expect(view.container.querySelector(`[data-preview-mode="dark"] [data-preview-part="${part}"]`)?.getAttribute('style')).toContain('40%, transparent');
    }
    expect(view.container.querySelector('[data-preview-mode="dark"] [data-preview-part="content"]')?.getAttribute('style')).toContain('60%, transparent');
  });
  it('正文样例按保存的实验室明暗不透明度预览，零值不回落默认值', () => {
    const preset = { ...BUILTIN_APPEARANCE_PRESET, surfaces: 'translucent' as const, details: { labEditorOpacity: .6, light: { labEditorOpacity: 0 } } };
    const view = render(<AppearancePresetPreview preset={preset} isDark />);
    expect(view.container.querySelector('[data-preview-mode="light"] [data-preview-part="content"]')?.getAttribute('style')).toContain('0%, transparent');
    expect(view.container.querySelector('[data-preview-mode="dark"] [data-preview-part="content"]')?.getAttribute('style')).toContain('60%, transparent');
  });
  it('预览取保存的背景显示参数，缺少背景不残留之前的图片', () => {
    const background = { image: 'data:image/png;base64,AAAA', fit: 'tile' as const, opacity: .8, tileSize: 64 };
    const view = render(<AppearancePresetPreview preset={{ ...BUILTIN_APPEARANCE_PRESET, background }} isDark />);
    const preview = view.container.querySelector('[data-preview-mode="dark"] [data-preview-part="background"]') as HTMLElement;
    expect(preview.style.backgroundSize).toBe('auto, 64px auto');
    view.rerender(<AppearancePresetPreview preset={BUILTIN_APPEARANCE_PRESET} isDark />);
    expect(preview.style.backgroundSize).toBe('');
  });
  it('预览使用自己的明暗覆盖，不借用当前界面的强调色或几何', () => {
    const view = render(<AppearancePresetPreview preset={{ ...BUILTIN_APPEARANCE_PRESET, details: { panelRadius: 16, dark: { accentColor: '#123456', panelRadius: 24 } } }} isDark />);
    const preview = view.container.querySelector('[data-preview-mode="dark"]') as HTMLElement;
    expect(preview.style.borderRadius).toBe('12px');
    expect(preview.querySelector<HTMLElement>('[data-preview-part="action"]')?.style.backgroundColor).toBe(hexRgb(themeAccentColors('#123456', true)[600]));
  });
  it('同时展示明暗原件，当前模式只影响标记，不污染另一套配色', () => {
    const preset = { ...BUILTIN_APPEARANCE_PRESET, themeMode: 'light' as const, corners: 'sharp' as const, density: 'compact' as const, palette: { light: { canvas: '#fff4dd', sidebar: '#eee2ce', panel: '#fffaf0', text: '#362415', border: '#a08060' } } };
    const view = render(<AppearancePresetPreview preset={preset} isDark />);
    const preview = view.container.querySelector('[data-preview-mode="light"]') as HTMLElement;
    expect(preview.dataset.previewMode).toBe('light');
    expect(preview.style.backgroundColor).toBe('rgb(255, 244, 221)');
    expect(preview.style.borderRadius).toBe('3px');
    expect(view.container.querySelector('[style*="rgb(54, 36, 21)"]')).toBeTruthy();
    view.rerender(<AppearancePresetPreview preset={{ ...preset, themeMode: 'system', corners: 'soft' }} isDark />);
    expect(preview.dataset.previewMode).toBe('light');
    expect(preview.dataset.previewActive).toBe('false');
    expect(preview.style.backgroundColor).toBe('rgb(255, 244, 221)');
    expect(preview.style.borderRadius).toBe('12px');
    const dark = view.container.querySelector('[data-preview-mode="dark"]') as HTMLElement;
    expect(dark.dataset.previewActive).toBe('true');
    expect(dark.style.backgroundColor).toBe('rgb(13, 15, 20)');
  });
  it('高级面板、控件和卡片几何各自预览，实色不显示玻璃高光', () => {
    const preset = { ...BUILTIN_APPEARANCE_PRESET, details: { controlRadius: 999, panelRadius: 24, cardRadius: 8, spacing: .2, material: 'glass' as const } };
    const view = render(<AppearancePresetPreview preset={preset} isDark={false} />);
    const preview = view.container.querySelector('[data-preview-mode="light"]') as HTMLElement;
    expect(preview.style.borderRadius).toBe('12px');
    expect(preview.style.boxShadow).toBe('');
    expect(preview.querySelector('[data-preview-part="selected"]')?.getAttribute('style')).toContain('border-radius: 104.0625cqw');
    expect(parseFloat(preview.querySelector<HTMLElement>('[data-preview-part="field"]')!.style.borderRadius)).toBeCloseTo(8 / 9.6);
    view.rerender(<AppearancePresetPreview preset={{ ...preset, surfaces: 'translucent' }} isDark={false} />);
    expect(preview.style.boxShadow).toContain('inset');
    expect(preview.querySelector<HTMLElement>('[data-preview-part="toolbar"]')?.style.backdropFilter).toContain('blur(');
    expect(preview.querySelector('[data-preview-part="sidebar"]')?.getAttribute('style')).toContain('transparent');
    expect(preview.textContent).toContain('全局提示词');
    expect(preview.textContent).toContain('文生图');
    expect(preview.textContent).toContain('生成');
    expect(view.container.querySelector('button, input, [tabindex]')).toBeNull();
  });
  it('预览完整工作区并保持桌面比例，窄屏不会删掉侧栏、编辑区或作品区', () => {
    const view = render(<AppearancePresetPreview preset={BUILTIN_APPEARANCE_PRESET} isDark={false} />);
    for (const preview of view.container.querySelectorAll<HTMLElement>('[data-preview-mode]')) {
      expect(preview.style.aspectRatio).toBe('8 / 5');
      expect(preview.style.gridTemplateColumns).toBe('22% minmax(0, 1fr)');
      expect(preview.querySelector<HTMLElement>('[data-preview-part="workspace"]')?.style.gridTemplateColumns).toBe('50% minmax(0, 1fr)');
      for (const label of ['风格串', '实验室', '内容库', '收藏库', '安全模式', '全局设置', '文生图', '图生图', '局部重绘', '扩图', '全局', '角色', '参数', '暂无生成结果']) {
        expect(preview.textContent).toContain(label);
      }
      expect(preview.querySelectorAll('[data-preview-part="field"]')).toHaveLength(3);
      expect(preview.querySelector<HTMLElement>('[data-preview-part="text-action"]')?.style.color).not.toBe(hexRgb(BUILTIN_APPEARANCE_PRESET.accentColor));
      for (const part of ['sidebar', 'preview']) {
        expect([...preview.querySelector(`[data-preview-part="${part}"]`)!.classList].some(name => name === 'hidden' || name.endsWith(':hidden'))).toBe(false);
      }
    }
    expect(view.container.querySelector('button, input, [tabindex]')).toBeNull();
  });
  it('侧栏选中态区分普通主题和填充式控件，不把所有预设画成同一套样式', () => {
    const view = render(<AppearancePresetPreview preset={BUILTIN_APPEARANCE_PRESET} isDark={false} />);
    const selected = () => view.container.querySelector<HTMLElement>('[data-preview-mode="light"] [data-preview-part="navigation-selected"]')!;
    const original = selected().style.backgroundColor;
    view.rerender(<AppearancePresetPreview preset={{ ...BUILTIN_APPEARANCE_PRESET, details: { controlStyle: 'filled' } }} isDark={false} />);
    expect(selected().style.backgroundColor).not.toBe(original);
    expect(selected().style.backgroundColor).toBe(view.container.querySelector<HTMLElement>('[data-preview-mode="light"] [data-preview-part="action"]')!.style.backgroundColor);
  });
});

const hexRgb = (hex: string) => `rgb(${[1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)).join(', ')})`;
