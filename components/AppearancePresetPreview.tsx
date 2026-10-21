import React from 'react';
import { Dices, FileDown, FlaskConical, Heart, History, Languages, Layers, Library, Paintbrush, Palette, RotateCcw, Save, Settings, ShieldCheck, Sparkles, Users } from 'lucide-react';
import type { AppearancePreset } from '../services/appearancePreferences';
import { mixThemeColor, resolveThemePalette, themeAccentColors, themeForeground } from '../services/themePalette';
import { resolveThemeDetails } from '../services/themeDetails';
import { themeBackgroundStyle, resolveWorkspaceBackground, type WorkspaceBackgrounds } from '../services/themeBackground';
import { t } from '../services/i18n';

export const AppearancePresetPreview: React.FC<{ preset: AppearancePreset; isDark: boolean; backgrounds?: WorkspaceBackgrounds }> = ({ preset, isDark, backgrounds }) => {
  const activeDark = preset.themeMode === 'system' ? isDark : preset.themeMode === 'dark';
  return <div className="atelier-theme-preview grid w-full min-w-0 gap-4" aria-hidden="true">
    {[false, true].map(dark => {
      const colors = resolveThemePalette(preset.palette, dark);
      const details = resolveThemeDetails(preset.details, dark);
      const accent = details?.accentColor || preset.accentColor;
      const accentText = dark ? mixThemeColor(accent, colors.text, .25) : themeAccentColors(accent, false)[800];
      const action = themeAccentColors(accent, dark)[600], onAction = themeForeground(action);
      const radius = details?.panelRadius !== undefined ? details.panelRadius / 2 : preset.corners === 'sharp' ? 3 : preset.corners === 'soft' ? 12 : 8;
      // 统一按 960 × 600 的完整工作区比例缩放，窄屏也不删减导航或预览区。
      const unit = (value: number) => `${value / 9.6}cqw`;
      const controlRadius = details?.controlRadius ?? (preset.corners === 'sharp' ? 6 : preset.corners === 'soft' ? 12 : 8);
      const cardRadius = details?.cardRadius ?? controlRadius;
      const panelRadius = details?.panelRadius ?? radius * 2;
      const gap = (preset.density === 'compact' ? 6 : preset.density === 'comfortable' ? 14 : 10) * ((details?.spacing ?? .25) / .25);
      const inset = details?.chromeInset ?? 0;
      const translucent = preset.surfaces === 'translucent';
      const glass = translucent && details?.material === 'glass';
      const surface = (color: string, opacity: number) => translucent ? `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)` : color;
      const navigationFill = details?.controlStyle === 'filled' ? action : mixThemeColor(accent, colors.sidebar, dark ? .15 : .08);
      const navigationText = details?.controlStyle === 'filled' ? onAction : themeAccentColors(accent, dark)[dark ? 300 : 600];
      const border = mixThemeColor(colors.border, colors.panel, details?.borderOpacity ?? .45);
      const control = { borderRadius: unit(controlRadius), padding: `${unit(6)} ${unit(10)}`, minWidth: 0 };
      const filter = translucent ? `blur(${unit(details?.blur ?? 22)}) saturate(${details?.saturation ?? 130}%)` : undefined;
      const pane = (color: string, opacity: number): React.CSSProperties => ({
        backgroundColor: surface(color, opacity), backdropFilter: filter,
        borderRadius: unit(translucent ? panelRadius : 0),
        boxShadow: glass ? 'inset 0 1px 0 #ffffff80' : undefined,
      });
      const icon = { width: '1.15em', height: '1.15em', flexShrink: 0, strokeWidth: details?.iconStroke ?? 1.8 };
      return <div key={String(dark)} className="min-w-0" style={{ containerType: 'inline-size' }}>
        <div className="mb-2 text-xs text-gray-500 dark:text-gray-400" style={{ fontWeight: dark === activeDark ? 600 : 400 }}>{t(dark ? '深色' : '浅色')}</div>
        <div data-preview-mode={dark ? 'dark' : 'light'} data-preview-active={dark === activeDark} className="relative isolate grid min-w-0 overflow-hidden border" style={{
          aspectRatio: '8 / 5', gridTemplateColumns: '22% minmax(0, 1fr)', gap: unit(inset), padding: unit(inset),
          backgroundColor: colors.canvas, borderColor: border, borderRadius: radius,
          color: colors.text, fontFamily: details?.fontFamily || 'system-ui, sans-serif', fontSize: unit(details?.fontSize ?? 16),
          lineHeight: details?.lineHeight ?? 1.5, letterSpacing: `${details?.letterSpacing ?? 0}em`,
          boxShadow: glass ? 'inset 0 1px 0 #ffffff66' : undefined,
        }}>
          <div data-preview-part="background" className="theme-background-preview pointer-events-none absolute inset-0 -z-10" style={{ ...themeBackgroundStyle(resolveWorkspaceBackground(backgrounds, preset.id, dark ? 'dark' : 'light', preset.background), colors.canvas), '--nai-background-blur': '2px' } as React.CSSProperties & { '--nai-background-blur': string }} />
          <div data-preview-part="sidebar" className="flex min-h-0 min-w-0 flex-col overflow-hidden" style={{ ...pane(colors.sidebar, details?.globalOpacity ?? details?.sidebarOpacity ?? .82), padding: unit(gap) }}>
            <div className="flex items-center gap-2" style={{ padding: unit(gap), fontWeight: details?.strongWeight ?? 600 }}><Palette style={{ ...icon, color: accent }} /><span className="truncate">NAI Atelier</span></div>
            <div style={{ padding: `${unit(gap)} ${unit(8)}`, color: colors.mutedText, fontSize: '.75em' }}>{t('工作区')}</div>
            {[[Layers, '风格串'], [FlaskConical, '实验室'], [Dices, 'Roll 串'], [Paintbrush, '画师库'], [Users, '角色库'], [Library, '内容库'], [Heart, '收藏库'], [History, '历史']].map(([Icon, label]) => {
              const ItemIcon = Icon as typeof Layers, selected = label === '实验室';
              return <div key={label as string} data-preview-part={selected ? 'navigation-selected' : undefined} className="flex items-center gap-2" style={{ ...control, marginBottom: unit(3), backgroundColor: selected ? navigationFill : 'transparent', color: selected ? navigationText : colors.mutedText, fontWeight: selected ? details?.strongWeight ?? 600 : 400 }}><ItemIcon style={icon} /><span className="truncate">{t(label as string)}</span></div>;
            })}
            <div className="mt-auto min-w-0">
              <div className="flex items-center gap-2" style={{ ...control, backgroundColor: action, color: onAction, marginBottom: unit(gap), fontWeight: details?.strongWeight ?? 600 }}><Sparkles style={icon} /><span className="truncate">{t('创作助手')}</span></div>
              <div style={{ padding: unit(8), color: colors.mutedText, fontSize: '.8em' }}>Opus <span style={{ float: 'right', color: accentText }}>99%</span></div>
              <div className="flex items-center gap-2" style={{ padding: unit(8), color: colors.mutedText }}><ShieldCheck style={icon} /><span className="truncate">{t('安全模式')}</span></div>
              <div className="flex items-center gap-2" style={{ padding: unit(8), color: colors.mutedText }}><Settings style={icon} /><span className="truncate">{t('全局设置')}</span></div>
            </div>
          </div>
          <div className="grid min-h-0 min-w-0" style={{ gridTemplateRows: 'auto minmax(0, 1fr)' }}>
            <div data-preview-part="toolbar" className="grid grid-cols-2 items-center" style={{ ...pane(colors.toolbar, details?.globalOpacity ?? details?.toolbarOpacity ?? .78), padding: unit(6), gap: unit(4) }}>
              <div className="grid min-w-0 grid-cols-4" style={{ gap: unit(4) }}>{['文生图', '图生图', '局部重绘', '扩图'].map((label, index) => <span key={label} data-preview-part={index === 0 ? 'selected' : undefined} className="truncate text-center" style={{ ...control, padding: `${unit(6)} 0`, fontSize: '.8em', backgroundColor: index === 0 ? action : 'transparent', color: index === 0 ? onAction : colors.mutedText, fontWeight: index === 0 ? details?.strongWeight ?? 600 : 400 }}>{t(label)}</span>)}</div>
              <div className="flex items-center justify-end" style={{ gap: unit(18), paddingRight: unit(8), color: colors.mutedText }}>{[FileDown, Languages, RotateCcw, Save].map((ToolIcon, index) => <ToolIcon key={index} style={icon} />)}</div>
            </div>
            <div data-preview-part="workspace" className="grid min-h-0 min-w-0" style={{ gridTemplateColumns: '50% minmax(0, 1fr)', gap: unit(gap) }}>
              <div className="flex min-h-0 min-w-0 flex-col">
                <div className="grid grid-cols-3" style={{ ...pane(colors.toolbar, details?.globalOpacity ?? details?.toolbarOpacity ?? .78), padding: unit(4), marginBottom: unit(gap) }}>
                  {['全局', '角色', '参数'].map((label, index) => <span key={label} className="truncate text-center" style={{ ...control, fontSize: '.85em', backgroundColor: index === 0 ? action : 'transparent', color: index === 0 ? onAction : colors.mutedText }}>{t(label)}</span>)}
                </div>
                <div data-preview-part="content" className="min-h-0 min-w-0 flex-1 overflow-hidden" style={{ ...pane(colors.panel, details?.labEditorOpacity ?? (dark ? .6 : .425)), padding: unit(gap), border: `1px solid ${border}`, borderRadius: unit(panelRadius), marginBottom: unit(gap) }}>
                  <div style={{ fontWeight: details?.strongWeight ?? 600, marginBottom: unit(gap), fontSize: '.85em' }}>{t('全局提示词')}</div>
                  {[
                    ['画师串', 'masterpiece, best quality, soft light', 'masterpiece · best quality'],
                    ['人物', '1girl, blue eyes, long hair', '1girl · blue eyes'],
                    ['场景', 'outdoors, gentle breeze', 'outdoors · gentle breeze'],
                  ].map(([label, prompt, tags]) => <div key={label} style={{ marginBottom: unit(gap * 1.5) }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: unit(6), fontSize: '.85em' }}><span style={{ fontWeight: details?.strongWeight ?? 600 }}>{t(label)}</span><span data-preview-part="text-action" style={{ color: accentText }}>{t('复制')}</span></div>
                    <div data-preview-part="field" style={{ padding: unit(gap), border: `1px solid ${border}`, borderRadius: unit(cardRadius), minHeight: unit(58), fontSize: '.85em', fontFamily: 'monospace', backgroundColor: translucent ? surface(colors.panel, dark ? .32 : .16) : mixThemeColor(colors.text, colors.panel, .035) }}>{prompt}</div>
                    <div className="truncate" style={{ color: colors.mutedText, fontSize: '.7em', marginTop: unit(6) }}>{tags}</div>
                  </div>)}
                </div>
              </div>
              <div className="flex min-h-0 min-w-0 flex-col" style={{ paddingTop: unit(gap), paddingRight: unit(gap), paddingBottom: unit(gap) }}>
                <div data-preview-part="preview" className="flex min-h-0 flex-1 items-center justify-center text-center" style={{ border: `1px solid ${glass ? dark ? '#ffffff26' : '#ffffff99' : border}`, borderRadius: unit(panelRadius), color: colors.mutedText, fontSize: '.85em' }}>{t('暂无生成结果')}</div>
                <div className="flex justify-end" style={{ paddingTop: unit(gap) }}><span data-preview-part="action" className="truncate text-center" style={{ ...control, width: '80%', backgroundColor: action, color: onAction, fontWeight: details?.strongWeight ?? 600 }}>{t('生成')} · 1</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>;
    })}
  </div>;
};
