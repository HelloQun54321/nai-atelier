// @vitest-environment jsdom
import React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { compile, optimize } from '@tailwindcss/node';
import { parse, type AtRule, type Node as PostCssNode } from 'postcss';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanAccessGate } from '../../components/LanAccessGate';
import {
  applyAppearancePreferences, appearanceScrollBehavior, DEFAULT_APPEARANCE_PREFERENCES,
  restoreAppearancePreferences, saveAppearancePreferences, useGalleryFrostedCaption,
  readAppearancePresetImport,
} from '../../services/appearancePreferences';
import { mixThemeColor, resolveThemePalette, themeAccentColors, themeContrast, themePaletteVariables } from '../../services/themePalette';
import { resolveThemeDetails } from '../../services/themeDetails';
import { FilterPill } from '../../components/DesignSystem';

const files = ['App.tsx', ...readdirSync('components', { recursive: true })
  .filter(file => typeof file === 'string' && file.endsWith('.tsx') && !file.includes('.test.'))
  .map(file => `components/${file}`)];
const sources = files.map(file => ({ file, text: readFileSync(resolve(file), 'utf8') }));
const css = readFileSync(resolve('index.css'), 'utf8');
const classes: { file: string; text: string; tag: string; role: string; control: boolean }[] = [];
for (const source of sources) {
  const ast = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'className' && node.initializer) {
      const element = node.parent.parent as ts.JsxOpeningElement;
      const attributes = element.attributes.properties.filter(ts.isJsxAttribute);
      classes.push({ file: source.file, text: node.initializer.getText(ast), tag: element.tagName.getText(ast),
        role: attributes.find(attr => attr.name.getText(ast) === 'role')?.initializer?.getText(ast) || '',
        control: attributes.some(attr => attr.name.getText(ast) === 'data-appearance'),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
let generatedCss: string;
const declarations = (selector: string, media?: string, source = generatedCss) => {
  const result: Record<string, string> = {};
  // 条件规则分别检查，不把无滤镜回退或手机规则混进普通桌面声明。
  parse(source).walkRules(rule => {
    const conditions: string[] = [];
    for (let parent: PostCssNode['parent'] = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule') {
        const atRule = parent as AtRule;
        if (atRule.name === 'media') conditions.push(atRule.params);
        if (atRule.name === 'supports') conditions.push(`@supports ${atRule.params}`);
      }
    }
    if (rule.selectors.includes(selector) && conditions.length === (media ? 1 : 0) && (!media || conditions[0] === media)) {
      for (const node of rule.nodes) if (node.type === 'decl') result[node.prop] = node.value;
    }
  });
  return result;
};
const hasDarkTextColor = (className: string) => /(?<![\w:-])dark:text-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black|current|transparent)\b/.test(className);
let systemDark: boolean;
let systemReduced: boolean;
beforeAll(async () => {
  const compiler = await compile(css, { base: process.cwd(), onDependency: () => {} });
  generatedCss = compiler.build(['rounded', 'rounded-xl', 'text-meta', 'text-tiny', 'text-mini', 'bg-indigo-600', 'h-10', 'p-3', '-translate-x-1/2', '-translate-y-full', 'ring-2', 'focus-visible:ring-2']);
});
beforeEach(() => {
  systemDark = false; systemReduced = false;
  localStorage.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('color-scheme') ? systemDark : systemReduced }));
  applyAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES, false);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); applyAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES, false); });

describe('全局外观覆盖审计', () => {
  it.each(['glass', 'frosted'])('%s 的嵌套浮层保留承托，设置内层内容仍不重复铺底', material => {
    document.documentElement.dataset.themeDetails = 'true';
    document.documentElement.dataset.themeMaterial = material;
    const detailCss = readFileSync('components/themeDetails.css', 'utf8');
    const root = "html:root[data-theme-details='true']:is([data-theme-material='glass'], [data-theme-material='frosted'])";
    const flattened = `${root} :is(.settings-dialog, .operation-dialog, .appearance-surface, .appearance-panel) .appearance-surface`;
    expect(declarations(flattened, undefined, detailCss)['background-color']).toBe('transparent');
    const overlay = "html[data-theme-details='true']:is([data-theme-material='glass'], [data-theme-material='frosted']) :is(.appearance-popover, .appearance-overlay)";
    expect(declarations(overlay, undefined, detailCss)['--nai-layer-opacity']).toBe('max(82%, var(--nai-global-opacity, var(--nai-panel-opacity, var(--nai-glass-opacity, 85%))))');
    const view = render(<div className="settings-dialog"><div className="settings-content">
      <div className="appearance-panel"><div className="appearance-surface" data-testid="inner-content" />
        <aside className="appearance-panel appearance-overlay" data-testid="drawer">
          <div className="appearance-panel appearance-overlay" data-testid="nested-menu" />
        </aside>
      </div>
    </div></div>);
    const clearRules: string[] = [];
    parse(detailCss).walkRules(rule => {
      if (rule.parent?.type !== 'root') return;
      if (rule.nodes.some(node => node.type === 'decl' && node.prop === 'background-color' && node.value === 'transparent')) clearRules.push(...rule.selectors);
    });
    for (const dark of [false, true]) {
      document.documentElement.classList.toggle('dark', dark);
      for (const id of ['drawer', 'nested-menu']) {
        const element = view.getByTestId(id);
        expect(clearRules.filter(selector => element.matches(selector)), `${material}/${dark}/${id}`).toEqual([]);
        expect(element.matches(flattened)).toBe(false);
        expect(element.matches(overlay)).toBe(true);
      }
      expect(view.getByTestId('inner-content').matches(flattened)).toBe(true);
    }
  });
  it('独立抽屉、菜单与工具条标明阅读承托，内层设置表单不冒充浮层', () => {
    const expected: Record<string, string> = {
      PromptAgentPanel: 'showSessions', PromptAgentSettings: 'agent-settings-subview',
      AgentModelControl: 'agent-model-popover', AgentPermissionSelect: 'z-[1300]', AgentContextRing: 'agent-context-tooltip',
      TagAutocompleteTextarea: 'touch-pan-y', TagSelectionBar: 'pointer-events-auto',
      'inspiration/InspirationDetail': 'bottom-12', InspirationGallery: 'hover-reveal-md absolute right-1',
      ImageEditCanvas: 'top-2 right-2', GenHistory: 'mobile-safe-bottom fixed', Layout: 'absolute bottom-',
    };
    for (const [file, token] of Object.entries(expected)) {
      const matches = classes.filter(item => item.file.replaceAll('\\', '/') === `components/${file}.tsx` && item.text.includes(token));
      expect(matches.length, file).toBe(1);
      expect(matches[0].text, file).toContain('appearance-panel appearance-overlay');
    }
    const agentMenus = classes.filter(item => item.file === 'components/PromptAgentPanel.tsx' && item.text.includes('appearance-panel absolute right-'));
    expect(agentMenus).toEqual([]);
    const agentSettingsPanels = classes.filter(item => item.file === 'components/PromptAgentSettings.tsx' && item.text.includes('appearance-panel'));
    expect(agentSettingsPanels).toHaveLength(1);
    expect(agentSettingsPanels[0].text).toContain('agent-settings-subview');
    expect(sources.find(item => item.file === 'components/AgentConnectionForm.tsx')!.text).toContain('agent-theme appearance-surface');
    expect(sources.find(item => item.file === 'components/PromptLibrarySettings.tsx')!.text).not.toContain('appearance-panel');
  });
  it('助手挤窄时不再由 1180px 容器查询强制纵排，字段和生成栏按剩余宽度收纳', () => {
    expect(css).not.toContain('@container workspace (max-width: 1180px)');
    expect(declarations('.chain-editor-model-grid', undefined, css)['grid-template-columns']).toBe('repeat(auto-fit, minmax(min(100%, 18rem), 1fr))');
    expect(declarations('.chain-editor-param-grid', undefined, css)['grid-template-columns']).toBe('repeat(auto-fit, minmax(min(100%, 10rem), 1fr))');
    expect(declarations('.agent-panel-docked .workspace-container.workspace-editor-compact .chain-editor-body', '(min-width: 1024px)', css)['flex-direction']).toBe('column');
    expect(declarations('.agent-panel-docked .chain-editor-param-grid', '(min-width: 1024px)', css)['grid-template-columns']).toBe('repeat(auto-fit, minmax(min(100%, 10rem), 1fr))');
    const count = '.agent-panel-docked .chain-editor-preview .generation-count-control';
    const container = parse(css).nodes.flatMap(node => node.type === 'atrule' ? node.nodes || [] : [])
      .find(node => node.type === 'atrule' && node.name === 'container' && node.params === 'workspace (max-width: 980px)');
    expect(container).toBeTruthy();
    const narrowCss = container!.toString();
    expect(declarations('.agent-panel-docked .chain-editor-header', undefined, narrowCss)['padding-inline']).toBe('.5rem');
    expect(declarations('.agent-panel-docked .chain-editor-header-main', undefined, narrowCss)['padding-right']).toBe('0');
    expect(declarations('.agent-panel-docked .chain-editor-header .generation-mode-nav > button', undefined, narrowCss)['padding-inline']).toBe('0');
    expect(declarations(count, undefined, narrowCss)).toMatchObject({ display: 'grid', width: '100%', 'max-width': '100%' });
    expect(declarations(`${count} > .generation-action-button`, undefined, narrowCss)).toMatchObject({ 'grid-column': '1 / -1', 'grid-row': '1' });
    expect(declarations(`${count} > :not(.generation-action-button)`, undefined, narrowCss)).toMatchObject({ position: 'static', 'grid-row': '2' });
    for (const file of ['ChainEditor.tsx', 'ImageEditControls.tsx', 'ChainEditorPreview.tsx']) {
      const text = readFileSync(`components/${file}`, 'utf8');
      expect(text).toMatch(/className="[^"]*chain-editor-(?:main|preview) [^"]*min-w-0/);
    }
  });
  it('角色动作行图标紧凑但保留触屏高度，正文不再有坐标侧栏或额外横向内边距', () => {
    const source = readFileSync('components/chain/ChainEditorCharacters.tsx', 'utf8');
    expect(source).not.toContain('sm:w-28');
    expect(source).toContain('className="lab-character relative min-w-0 py-3"');
    expect(declarations(".character-tools [data-appearance='control']", undefined, css)).toMatchObject({ height: '24px', width: '24px', background: 'transparent', border: '0' });
    expect(declarations(".character-tools button", '(pointer: coarse)', css)).toMatchObject({ height: '44px', 'min-height': '44px' });
  });
  it('电脑编辑分区占左栏且固定在滚动外，玻璃顶栏避让与助手窄栏同步', () => {
    const detailCss = readFileSync('components/themeDetails.css', 'utf8');
    expect(declarations('.workspace-mode-tabs', '(min-width: 1024px)', css)).toMatchObject({ width: 'var(--lab-tabs-width, calc(50% - 1.5rem))', height: 'var(--lab-tabs-height)', 'margin-left': 'var(--lab-tabs-left, .75rem)', 'margin-bottom': 'calc(var(--lab-tabs-chrome-gap, 0px) - var(--lab-tabs-height))' });
    expect(declarations('.chain-editor-workspace', '(min-width: 1024px)', css)).toMatchObject({ '--lab-tabs-height': '36px', '--lab-tabs-padding': '2px' });
    expect(declarations('.workspace-mode-tabs', undefined, css).height).toBe('44px');
    const root = "html[data-surfaces='translucent']";
    expect(declarations(`${root} .workspace-mode-tabs`, undefined, detailCss)['margin-bottom']).toBe('calc(-1 * (var(--workspace-chrome-height, 0px) + 44px))');
    expect(declarations(`${root} .chain-editor-workspace .chain-editor-main`, '(min-width: 1024px)', detailCss)['padding-top']).toBe('calc(var(--workspace-chrome-height, 0px) + var(--lab-tabs-height) - var(--lab-tabs-chrome-gap, 0px))');
    const tabs = declarations(`${root} .chain-editor-workspace .workspace-mode-tabs`, '(min-width: 1024px)', detailCss);
    expect(tabs['margin-top']).toBe('calc(var(--workspace-chrome-height, 0px) - var(--lab-tabs-chrome-gap, 0px))');
    expect(tabs['margin-bottom']).toBe('calc(var(--lab-tabs-chrome-gap, 0px) - var(--workspace-chrome-height, 0px) - var(--lab-tabs-height))');
    for (const file of ['ChainEditor.tsx', 'ImageEditControls.tsx', 'chain/ChainEditorCharacters.tsx', 'chain/ChainEditorPromptInputs.tsx']) {
      expect(readFileSync(`components/${file}`, 'utf8')).not.toContain("'hidden lg:block'");
    }
  });
  it('桌面两排导航只绘制一块连续底板，保留点击区域、选中颜色和触屏高度', () => {
    const root = 'html:root .chain-editor-workspace .workspace-mode-tabs';
    const nav = declarations(root, '(min-width: 1024px)', css);
    expect(nav).toMatchObject({ background: 'transparent', border: '0', 'border-radius': '0', padding: 'var(--lab-tabs-padding) 0', gap: '6px' });
    expect(css).not.toContain('.workspace-mode-tabs::before');
    const header = "html:root .chain-editor-workspace .chain-editor-header[data-lab-navigation='joined']";
    expect(declarations(header, '(min-width: 1024px)', css)).toMatchObject({ background: 'transparent', 'border-color': 'transparent', 'box-shadow': 'none', 'backdrop-filter': 'none' });
    const plate = "html:root .chain-editor-header[data-lab-navigation='joined'] .lab-navigation-surface";
    expect(declarations(plate, '(min-width: 1024px)', css)).toMatchObject({ display: 'block', 'pointer-events': 'none', height: 'auto', 'clip-path': 'var(--lab-navigation-outline)', bottom: 'calc(-1 * var(--lab-tabs-height))' });
    expect(declarations('.lab-navigation-surface', undefined, css).display).toBe('none');
    expect(declarations("html:root .chain-editor-header[data-lab-navigation='joined'] .generation-mode-nav", '(min-width: 1024px)', css)).toMatchObject({ background: 'transparent', 'border-color': 'transparent', 'box-shadow': 'none' });
    expect(declarations(`${root} > button`, '(min-width: 1024px)', css)['box-shadow']).toBeUndefined();
    expect(declarations(".workspace-mode-tabs > button[aria-selected='false'] + button[aria-selected='false']::before", undefined, css)).toMatchObject({ width: '1px', top: '28%', bottom: '28%', 'pointer-events': 'none', background: 'var(--nai-control-border, var(--color-gray-400))' });
    expect(declarations('.chain-editor-workspace', '(min-width: 1024px) and (any-pointer: coarse)', css)['--lab-tabs-height']).toBe('48px');
    expect(readFileSync('components/chain/ChainEditorHeader.tsx', 'utf8')).toContain('aria-hidden="true" className="lab-navigation-surface workspace-command-bar"');
  });
  it('全局透明度覆盖通用表面与嵌套填充，实验室隔离变量，历史手机详情独立承托', () => {
    const source = readFileSync('components/themeDetails.css', 'utf8');
    const root = "html:root[data-theme-details='true']:is([data-theme-material='glass'], [data-theme-material='frosted'])";
    for (const selector of [
      "html[data-theme-details='true'] :is(.appearance-panel, .settings-dialog, .operation-dialog)",
      "html[data-theme-details='true'] .app-sidebar",
      "html[data-theme-details='true'] :is(.workspace-command-bar, .app-mobile-nav, .mobile-page-header, .mobile-detail-header, .mobile-detail-footer)",
    ]) expect(declarations(selector, undefined, source)['--nai-layer-opacity']).toMatch(/^var\(--nai-global-opacity,/);
    const panels = declarations(`${root} :is(.appearance-surface, .appearance-group)`, undefined, source);
    expect(panels['background-color']).toContain('var(--nai-global-opacity,');
    expect(panels.opacity).toBeUndefined();
    const editor = declarations(`${root} .lab-editor-surface`, undefined, source);
    expect(editor['--nai-global-opacity']).toBe('initial');
    const moduleSurface = declarations(`${root} .lab-editor-surface .lab-module-section`, undefined, source);
    expect(moduleSurface['background-color']).toContain('--nai-lab-editor-opacity');
    expect(moduleSurface['background-color']).not.toContain('--nai-global-opacity');
    const mobileDetails = declarations(`${root} .history-viewer .history-viewer-details`, '(max-width: 767px)', source);
    expect(mobileDetails['background-color']).toContain('--nai-global-opacity');
    expect(mobileDetails['backdrop-filter']).toContain('blur(');
    expect(readFileSync('components/HistoryImageViewer.tsx', 'utf8')).toContain('className="history-viewer-details appearance-group"');
    for (const file of ['components/AitagGallery.tsx', 'components/CodexGallery.tsx', 'components/inspiration/InspirationDetail.tsx']) {
      const code = readFileSync(file, 'utf8');
      expect(code).toContain('className="appearance-content appearance-card');
      expect(code).toMatch(/<PressRevealSurface[^>]+className="appearance-media/);
    }
    for (const file of ['components/CharacterReferenceManager.tsx', 'components/VibeManager.tsx']) {
      expect(readFileSync(file, 'utf8')).toMatch(/<article key=\{asset\.id\} className=\{`appearance-group/);
    }
  });
  it('导航和筛选的选中填充与前景在状态层共同覆盖普通分组，明暗对比均可读', () => {
    const detailCss = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    const selector = "html:root[data-control-style='filled'] :is(.app-sidebar, .settings-navigation) button[aria-current]";
    let checked = false;
    parse(detailCss).walkRules(rule => {
      if (!rule.selectors.includes(selector)) return;
      expect((rule.parent as AtRule).params).toBe('theme-state');
      for (const prop of ['background-color', 'color']) {
        const declaration = rule.nodes.find(node => node.type === 'decl' && node.prop === prop);
        expect(declaration?.type === 'decl' && declaration.important).toBe(true);
      }
      checked = true;
    });
    expect(checked).toBe(true);
    const [preset] = readAppearancePresetImport(readFileSync('public/themes/cupertino-liquid-glass.json', 'utf8'));
    for (const dark of [false, true]) {
      applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, ...preset }, dark);
      const accent = preset.details?.[dark ? 'dark' : 'light']?.accentColor || preset.accentColor;
      expect(themeContrast(document.documentElement.style.getPropertyValue('--nai-on-accent-600'), themeAccentColors(accent, dark)[600])).toBeGreaterThanOrEqual(4.5);
      const palette = resolveThemePalette(preset.palette, dark);
      const gray = themePaletteVariables(preset.palette, dark, true)['--color-gray-400'];
      expect(themeContrast(palette.text, mixThemeColor(palette.panel, gray, .92))).toBeGreaterThanOrEqual(4.5);
    }
    const view = render(<FilterPill active>筛选</FilterPill>);
    expect(screen.getByRole('button', { name: '筛选' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '筛选' }).getAttribute('data-active')).toBe('true');
    view.rerender(<FilterPill>筛选</FilterPill>);
    expect(screen.getByRole('button', { name: '筛选' }).getAttribute('data-active')).toBeNull();
  });
  it('增强对比度优先于主题状态，系统强制颜色保留选中、禁用和焦点区别', () => {
    const source = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    const ast = parse(source);
    expect(ast.nodes.some(node => node.type === 'atrule' && node.name === 'layer' && node.params === 'theme-accessibility, theme-state')).toBe(true);
    const media: string[] = [];
    ast.walkAtRules('media', rule => {
      if (!['(prefers-contrast: more)', '(forced-colors: active)'].includes(rule.params)) return;
      expect((rule.parent as AtRule).params).toBe('theme-accessibility');
      expect(rule.toString()).not.toMatch(/\b(?:img|canvas)\s*[,{\]]/);
      media.push(rule.params);
    });
    expect(media).toEqual(['(prefers-contrast: more)', '(forced-colors: active)']);
    expect(declarations("html:root[data-design-theme] :is(button, input, select, textarea, [data-appearance='control']):disabled", '(forced-colors: active)', source).color).toBe('GrayText');
    expect(declarations("html:root[data-design-theme] :is(button, a, input, select, textarea, [tabindex]):focus-visible", '(forced-colors: active)', source).outline).toBe('3px solid Highlight');
  });
  it('高频控件字号与强调字重分层，顶栏背后不额外铺渐变遮罩', () => {
    const source = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    const root = "html[data-theme-details='true']";
    expect(declarations(`${root} :is(button, label, legend, summary, select):where(.text-xs, .text-meta, .text-micro)`, undefined, source)['font-size']).toBe('.8125rem');
    expect(declarations(`${root} .font-bold`, undefined, source)['font-weight']).toContain('+ 100');
    expect(declarations(`${root} .font-extrabold`, undefined, source)['font-weight']).toContain('+ 200');
    parse(source).walkRules(rule => {
      if (/\.workspace-chrome::(?:before|after)/.test(rule.selector)) {
        expect(rule.nodes.filter(node => node.type === 'decl' && /^(background|background-image)$/.test(node.prop))).toEqual([]);
      }
    });
  });
  it('所有页面顶栏共用滚动穿透与高度避让，分类、状态行和工作区不遗漏', () => {
    const detailCss = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    const root = "html[data-surfaces='translucent']";
    const chrome = declarations(`${root} .workspace-chrome`, undefined, detailCss);
    expect(chrome['margin-bottom']).toBe('calc(-1 * var(--workspace-chrome-height, 0px))');
    expect(chrome['backdrop-filter']).toBeUndefined();
    const viewport = declarations(`${root} .workspace-scroll-viewport`, undefined, detailCss);
    expect(viewport['padding-top']).toBe('calc(var(--workspace-chrome-height, 0px) + var(--workspace-scroll-gutter, 0px))');
    expect(viewport['scroll-padding-top']).toBe(viewport['padding-top']);
    for (const source of sources.filter(source => source.text.includes('<WorkspaceToolbar>'))) {
      expect(source.text, source.file).toContain('<WorkspaceChrome>');
      expect(source.text, source.file).toContain('workspace-scroll-viewport');
    }
    expect(readFileSync(resolve('components/roll/StyleRollGallery.tsx'), 'utf8')).toContain('workspace-scroll-viewport');
    expect(sources.find(source => source.file === 'components/PromptLibrary.tsx')!.text).toContain('<WorkspaceChrome>{categoryNavigation}');
    for (const file of ['ChainEditor', 'ImageEditPanel']) {
      expect(sources.find(source => source.file === `components/${file}.tsx`)!.text).toContain('<LabEditorTabs');
    }
    const desktop = declarations(`${root} .chain-editor-workspace :is(.chain-editor-main, .chain-editor-preview)`, '(min-width: 1024px)', detailCss);
    expect(desktop['padding-top']).toBe('var(--workspace-chrome-height, 0px)');
    const mobile = declarations(`${root} .chain-editor-workspace .chain-editor-body`, '(max-width: 1023px)', detailCss);
    expect(mobile['padding-top']).toBe('calc(var(--workspace-chrome-height, 0px) + 44px)');
    expect(declarations(`${root} .aitag-detail-panel`, undefined, detailCss)['margin-top']).toBeUndefined();
    expect(declarations(`${root} .aitag-detail-panel`, '(min-width: 1024px)', detailCss)['margin-top']).toBe('var(--workspace-chrome-height, 0px)');
  });
  it('全项目中性底板声明材质语义，图像衬底、状态和控件由各自规则接管', () => {
    const missing = classes.filter(({ text, tag, role, control }) => {
      if (!/(?<![\w:-])(?:dark:)?bg-(?:white|(?:gray|slate|zinc|neutral|stone)-\d{2,3})\b/.test(text)) return false;
      if (control || ['span', 'i', 'small', 'svg', 'img', 'canvas', 'input', 'textarea', 'select', 'option'].includes(tag)) return false;
      if (/Textarea|Input|Select|Search|IconButton|ToolbarButton|ActionIcon|IconLink|CloseButton|BackButton/.test(tag)) return false;
      if (/tablist|progressbar|status/.test(role)) return false;
      if (/appearance-(?:surface|content|group|panel|media|contrast|control-panel|segmented)|workspace-canvas|workspace-command-bar|app-(?:sidebar|workspace|mobile-nav)|settings-(?:content|navigation|dialog)|operation-dialog|mobile-(?:page-header|detail-header|detail-footer|sheet)|media-card|gallery-card-caption|atelier-theme-card/.test(text)) return false;
      if (/h-1\.5|h-0\.5|w-px|h-px|animate-pulse/.test(text)) return false;
      // 图片覆盖操作和深色遮罩保留独立对比度，不把它们当内容面板清空。
      if (/gallery-cover-navigation|IMAGE_PREVIEW_BUTTON_CLASS|bg-black\//.test(text)) return false;
      return !/(?<![\w:-])(?:dark:)?bg-(?!white\b|black\b|(?:gray|slate|zinc|neutral|stone)-\d{2,3}\b)[a-z]+-\d/.test(text);
    });
    expect(missing.map(({ file, text }) => ({ file, text }))).toEqual([]);
  });
  it('固定语义色操作不混用中性内容材质，避免收藏和危险按钮被刷灰', () => {
    const conflicts = classes.filter(({ text }) => /^["']/.test(text) &&
      /appearance-(?:group|surface)\b/.test(text) &&
      /(?<![\w:-])(?:dark:)?bg-(?:red|rose|emerald|green|amber|orange|violet|blue|indigo)-\d/.test(text));
    expect(conflicts.map(({ file, text }) => ({ file, text }))).toEqual([]);
  });
  it('保存与恢复的绿色实底使用足够深的色阶，悬停不退回浅绿白字', () => {
    const lowContrast = classes.filter(({ text }) => /(?:!text-white|\btext-white\b)/.test(text)
      && /(?:^|[\s'"`!])(?:dark:)?(?:hover:)?!?bg-emerald-(?:500|600)(?:[\s/'"`]|$)/.test(text));
    expect(lowContrast.map(({ file, text }) => ({ file, text }))).toEqual([]);
    const controls = sources.find(item => item.file === 'components/DesignSystem.tsx')!.text;
    expect(controls).toContain('bg-emerald-700 text-white hover:bg-emerald-800');
  });
  it('图片上的定位点、导入标记与拖入提示保留独立承托，不被中性分组清空', () => {
    const overlays = [
      ['components/chain/CharacterPositionStage.tsx', '定位点', /absolute flex h-7 w-7/, ['bg-white', 'bg-indigo-600']],
      ['components/chain/FolderBatchImportModal.tsx', '重复提示', /absolute right-1\.5 top-1\.5 max-w-/, ['bg-gray-900/85', 'text-amber-300']],
      ['components/ImageEditPanel.tsx', '拖入提示', /border-2 border-dashed border-white\/80/, ['bg-white/95', 'dark:bg-gray-900/95']],
    ] as const;
    for (const [file, label, pattern, colors] of overlays) {
      const overlay = classes.find(item => item.file.replaceAll('\\', '/') === file && pattern.test(item.text));
      expect(overlay, `${file} ${label}`).toBeTruthy();
      expect(overlay!.text).toContain('appearance-media');
      expect(overlay!.text).not.toContain('appearance-group');
      for (const color of colors) expect(overlay!.text).toContain(color);
    }
    const libraryCopy = classes.find(item => item.file === 'components/PromptLibrary.tsx' && item.text.includes('IMAGE_CARD_ACTION_CLASS'));
    expect(libraryCopy?.text).not.toContain('appearance-group');
    expect(libraryCopy).toBeTruthy();
  });
  it('全局背景连续，独立分组承载材质，作品预览不铺衬底', () => {
    const detailCss = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    const root = "html:root[data-theme-details='true']:is([data-theme-material='glass'], [data-theme-material='frosted'])";
    const surface = declarations(`${root} :is(.appearance-surface, .appearance-group)`, undefined, detailCss);
    expect(surface['background-color']).toContain('--nai-panel-opacity');
    expect(surface['background-color']).toContain('transparent');
    expect(surface['backdrop-filter']).toContain('--nai-glass-blur');
    const canvas = declarations(`${root} :is(.app-workspace, .workspace-canvas, .appearance-content)`, undefined, detailCss);
    expect(canvas['background-color']).toBe('transparent');
    expect(canvas['backdrop-filter']).toBeUndefined();
    expect(detailCss).not.toContain('.app-workspace::before');
    expect(declarations(`${root} .appearance-group:is(div, section, article, details)`, undefined, detailCss)['border-width']).toBe('0');
    const nested = declarations(`${root} :is(.app-sidebar, .appearance-surface, .appearance-panel, .appearance-group, .settings-dialog, .operation-dialog) .appearance-group`, undefined, detailCss);
    expect(nested['background-color']).toBe('transparent');
    expect(nested['backdrop-filter']).toBe('none');
    parse(detailCss).walkRules(rule => {
      if (rule.selector.includes('appearance-media')) throw new Error('图片和画布衬底不能进入玻璃覆盖选择器');
    });
    const preview = sources.find(source => source.file === 'components/ChainEditorPreview.tsx')!.text;
    expect(preview).not.toContain('lab-preview-image');
    expect(preview).not.toContain('nai-alpha-checker');
    for (const file of ['ChainEditor', 'ImageEditPanel', 'ImageEditControls', 'ChainEditorPreview']) {
      expect(sources.find(source => source.file === `components/${file}.tsx`)!.text).toContain('appearance-content chain-editor-');
    }
    const selected = "html[data-theme-material='glass'][data-control-style='filled'] :is([role='tablist'], .appearance-segmented) > button:is([aria-selected='true'], [aria-pressed='true'], [aria-current])";
    expect(declarations(selected, undefined, detailCss)['background-color']).toBe('var(--nai-control-surface)');
  });
  it('所有主题的卡片及图片信息分隔线无装饰边，悬停浮动也不恢复阴影或吞掉功能外圈', () => {
    const cards = 'html:root :is(.media-card, .gallery-image-card, .appearance-card, .atelier-theme-card, .appearance-control-panel)';
    const card = declarations(cards);
    expect(card['border-width']).toBe('0');
    expect(card['box-shadow']).toBe('var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000)');
    expect(card['box-shadow']).not.toContain('--tw-shadow');
    expect(declarations('html:root :is(.media-card, .gallery-image-card) :is(.mobile-gallery-frame, .gallery-card-caption)')['border-width']).toBe('0');
    const priority: Record<string, boolean> = {};
    parse(generatedCss).walkRules(rule => {
      if (rule.selector === cards) {
        for (const node of rule.nodes) if (node.type === 'decl') priority[node.prop] = Boolean(node.important);
      }
    });
    expect(priority).toEqual({ 'border-width': true, 'box-shadow': true });
    // 卡片规则继续使用功能性外圈变量，不能连键盘焦点一起抹掉。
    expect(generatedCss).toContain('.focus-visible\\:ring-2');
    const detailCss = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    const root = "html:root[data-theme-details='true']:is([data-theme-material='glass'], [data-theme-material='frosted'])";
    const photo = declarations(`${root} .gallery-image-card`, undefined, detailCss);
    expect(photo['background-color']).toBe('transparent');
    expect(photo['backdrop-filter']).toBe('none');
    expect(photo['-webkit-backdrop-filter']).toBe('none');
    const caption = declarations(`${root}:not([data-gallery-frosted-caption='true']) .gallery-image-card .gallery-card-caption`, undefined, detailCss);
    expect(caption['background-color']).toContain('--nai-panel-opacity');
    expect(caption['backdrop-filter']).toContain('--nai-glass-blur');
  });
  it('阅读底色只用于编辑内容和独立控件，生成区不铺整条底板且文字仍可辨认', () => {
    const detailCss = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    const root = "html:root[data-theme-details='true']:is([data-theme-material='glass'], [data-theme-material='frosted'])";
    const reading = declarations(`${root} .appearance-reading-surface`, undefined, detailCss);
    const floor = Number(reading['background-color'].match(/max\((\d+)%/)?.[1]) / 100;
    expect(floor).toBeGreaterThanOrEqual(.9);
    expect(reading['background-color']).toContain('--nai-panel-opacity');
    expect(reading['backdrop-filter']).toBeUndefined();
    expect(sources.find(source => source.file === 'components/LabModuleSection.tsx')!.text).toContain('appearance-reading-surface');
    for (const file of ['ChainEditor', 'ChainEditorPreview']) {
      const code = sources.find(source => source.file === `components/${file}.tsx`)!.text;
      expect(code).not.toContain('generation-action-surface');
    }
    expect(detailCss).not.toContain('.generation-action-surface');
    expect(sources.find(source => source.file === 'components/GenerationCountControl.tsx')!.text).toContain('appearance-reading-surface mobile-touch');
    const action = `${root} .generation-action-button--workbench:not(.generation-action-button--loading)`;
    expect(declarations(action, undefined, detailCss)['background-color']).toBe('var(--color-indigo-600)');
    expect(declarations(action, undefined, detailCss).color).toBe('var(--nai-on-accent-600)');
    expect(declarations(`${action} .generation-action-button__cost`, undefined, detailCss).color).toBe('inherit');
    const [preset] = readAppearancePresetImport(readFileSync('public/themes/cupertino-liquid-glass.json', 'utf8'));
    for (const dark of [false, true]) {
      const modeRoot = root + (dark ? '.dark' : '');
      const mutedClasses = dark ? ":is(.text-gray-400, .text-gray-500, [class~='dark:text-gray-400'], [class~='dark:text-gray-500'])" : ':is(.text-gray-400, .text-gray-500)';
      const foreground = declarations(`${modeRoot} .chain-editor-main ${mutedClasses}`, undefined, detailCss).color;
      const placeholder = declarations(`${modeRoot} .appearance-reading-surface :is(input, textarea)::placeholder`, undefined, detailCss).color;
      expect(placeholder).toBe(foreground);
      const palette = resolveThemePalette(preset.palette, dark);
      const variables = themePaletteVariables(preset.palette, dark, true);
      const muted = variables[foreground.slice(4, -1)];
      for (const background of ['#000000', '#ffffff']) {
        const surface = mixThemeColor(palette.panel, background, floor);
        expect(themeContrast(palette.text, surface)).toBeGreaterThanOrEqual(4.5);
        expect(themeContrast(muted, surface)).toBeGreaterThanOrEqual(4.5);
      }
      applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, ...preset }, dark);
      const actionFill = themeAccentColors(preset.details?.[dark ? 'dark' : 'light']?.accentColor || preset.accentColor, dark)[600];
      expect(themeContrast(document.documentElement.style.getPropertyValue('--nai-on-accent-600'), actionFill)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('白天玻璃的辅助文字、提示和文字操作具有阅读对比，不再沿用浅灰及亮蓝', () => {
    const detailCss = readFileSync('components/themeDetails.css', 'utf8');
    const root = "html:root[data-theme-details='true']:is([data-theme-material='glass'], [data-theme-material='frosted']):not(.dark)";
    expect(declarations(`${root} :where(.text-gray-300, .text-gray-400)`, undefined, detailCss).color).toBe('var(--color-gray-500)');
    expect(declarations(`${root} :is(input, textarea)::placeholder`, undefined, detailCss)).toMatchObject({ color: 'var(--color-gray-700)', opacity: '1' });
    expect(declarations(`${root} :is(button, a):not(:disabled)[class~='text-[var(--nai-accent)]']`, undefined, detailCss).color).toBe('var(--nai-accent-text-800)');
    const icon = "html:root[data-theme-material='glass'] [data-appearance='control'][data-control-kind='icon'][data-tone='neutral']:not([data-active='true']):not([aria-pressed='true'])";
    parse(detailCss).walkRules(rule => {
      if (rule.selector !== icon) return;
      expect((rule.parent as AtRule).params).toBe('utilities');
      expect(rule.nodes.some(node => node.type === 'decl' && node.prop === 'background-color' && node.value === 'transparent' && node.important)).toBe(true);
    });
    const [preset] = readAppearancePresetImport(readFileSync('public/themes/cupertino-liquid-glass.json', 'utf8'));
    const palette = resolveThemePalette(preset.palette, false);
    const variables = themePaletteVariables(preset.palette, false, true);
    applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, ...preset }, false);
    const opacity = preset.details!.light!.labEditorOpacity!;
    for (const backdrop of ['#000000', '#ffffff']) {
      const reading = mixThemeColor(palette.panel, backdrop, opacity);
      for (const text of [palette.text, variables['--color-gray-500'], variables['--color-gray-700'], document.documentElement.style.getPropertyValue('--nai-accent-text-800')]) {
        expect(themeContrast(text, reading), `${text} / ${reading}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('所有设置中性分组共用薄透表面，选中状态和实色模式保留', () => {
    const detailCss = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    const translucent = "html[data-theme-details='true']:is([data-theme-material='glass'], [data-theme-material='frosted']) .settings-content";
    const backdrop = "html[data-theme-details='true'][data-theme-material='glass'] .ui-backdrop-enter:has(> :is(.settings-dialog, .operation-dialog))";
    expect(declarations(backdrop, undefined, detailCss)['background-color']).toBe('rgb(0 0 0 / .18)');
    expect(declarations(backdrop, '(prefers-reduced-transparency: reduce)', detailCss)['background-color']).toBe('rgb(0 0 0 / .55)');
    expect(declarations(translucent, undefined, detailCss)['background-color']).toBe('transparent');
    const groupsRoot = translucent.replace('html[', 'html:root[');
    const groups = declarations(`${groupsRoot} :is(.appearance-group, .appearance-control-panel, .atelier-theme-card)`, undefined, detailCss);
    expect(groups['background-color']).toBe('color-mix(in srgb, var(--nai-panel-solid-surface) calc(var(--nai-global-opacity, 100%) * .18), transparent)');
    expect(groups['backdrop-filter']).toBeUndefined();
    expect(declarations(`${groupsRoot} :is(.appearance-group[data-active='true'], .atelier-theme-card[aria-pressed='true'])`, undefined, detailCss)['background-color']).toBe('color-mix(in srgb, var(--nai-accent) 8%, transparent)');
    expect(declarations("html[data-control-style='filled'] .settings-content", undefined, detailCss)['background-color']).toBe('var(--nai-canvas)');
    const fields = "html[data-theme-material='glass'][data-control-style='filled'] :is(input:not([type='range']):not([type='color']):not([type='checkbox']):not([type='radio']):not([type='file']):not([type='hidden']), select, textarea)";
    expect(declarations(fields, undefined, detailCss)['background-color']).toContain('--nai-panel-solid-surface');
    expect(declarations(fields, undefined, detailCss)['background-color']).not.toContain('--nai-canvas');
  });
  it('六类设置及嵌入模块的中性内容容器全部声明材质语义，进度和语义色不混用', () => {
    const modules = ['GlobalSettings', 'PromptAgentSettings', 'PromptLibrarySettings', 'AgentConnectionForm', 'AnlasBalanceBar', 'OpusUsageBar', 'ImageTaggerModelManager', 'DataBackupManager', 'StorageLocationManager', 'DesktopLauncherManager', 'AndroidStorageManager', 'SillyTavernBridgeExport', 'TagDictionaryUpdater', 'ArtistSampleManager', 'AppUpdateManager'];
    const missing: string[] = [];
    for (const name of modules) {
      const file = `components/${name}.tsx`;
      const ast = ts.createSourceFile(file, readFileSync(resolve(file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(ast);
          const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
          const classes = attributes.find(attr => attr.name.getText(ast) === 'className')?.initializer?.getText(ast) || '';
          const role = attributes.find(attr => attr.name.getText(ast) === 'role')?.initializer?.getText(ast) || '';
          // 只审计内容底板；控件轨道、色板、徽记和功能状态另有语义。
          if (['div', 'section', 'details', 'fieldset', 'pre', 'label'].includes(tag)
            && /(?<![\w:-])bg-(?:white|gray-\d{2,3})\b/.test(classes)
            && !/(?<![\w:-])bg-(?!white\b|gray-\d{2,3}\b)[a-z]+-\d/.test(classes)
            && !/progressbar|tablist/.test(role)
            && !/h-1\.5|appearance-(?:group|panel|control-panel|surface)|atelier-theme-card|settings-(?:dialog|navigation)|workspace-command-bar/.test(classes)) {
            missing.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`);
          }
          if (/appearance-group/.test(classes)) {
            expect(role, file).not.toContain('progressbar');
            expect(classes, file).not.toMatch(/appearance-surface\b/);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    expect(missing).toEqual([]);
    const settings = sources.find(source => source.file === 'components/GlobalSettings.tsx')!.text;
    expect(settings).toMatch(/key=\{entry\.id\} data-active=\{active\} className=\{`appearance-group/);
    expect(settings).toContain("safeMode ? 'bg-emerald-700 text-white'");
    expect(settings).toMatch(/h-5 w-5 rounded-full bg-white shadow-sm/);
  });
  it('壁纸在独立底层柔化，页面底板透明且不对 body、作品或安全模式加滤镜', () => {
    const body = declarations("html[data-theme-background='true'] body");
    expect(body.isolation).toBe('isolate');
    expect(body.filter).toBeUndefined();
    expect(body['background-image']).toBeUndefined();
    const wallpaper = declarations("html[data-theme-background='true'] body::before");
    expect(wallpaper['background-image']).toBe('var(--nai-background-image)');
    expect(wallpaper['background-size']).toBe('var(--nai-background-size)');
    expect(wallpaper['pointer-events']).toBe('none');
    expect(wallpaper['z-index']).toBe('-1');
    expect(wallpaper.filter).toContain('blur(');
    expect(wallpaper.opacity).toBeUndefined();
    expect(wallpaper.filter).not.toMatch(/brightness|saturate/);
    expect(declarations('.theme-background-preview').filter).toBe(wallpaper.filter);
    expect(declarations("html[data-theme-background='true'] body::before", '(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)').display).toBe('none');
    expect(declarations("html:root[data-theme-background='true'] :is(.workspace-canvas, .app-workspace)")['background-color']).toBe('transparent');
    parse(css).walkRules(rule => {
      if (rule.selector.includes('data-theme-background')) expect(rule.selector).not.toMatch(/safe-mode|\bimg\b|media-card|gallery-image/);
    });
  });
  it('四模式的编辑模块独立承托，外层与模块间隙透明，空预览及作品不铺衬底', () => {
    const source = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    const root = "html:root[data-theme-details='true']:is([data-theme-material='glass'], [data-theme-material='frosted'])";
    expect(declarations(`${root} .chain-editor-main`, undefined, source)['background-color']).toBe('transparent');
    expect(declarations(`${root} .chain-editor-preview`, undefined, source)['background-color']).toBeUndefined();
    const module = declarations(`${root} .lab-editor-surface .lab-module-section`, undefined, source);
    expect(module['background-color']).toBe('color-mix(in srgb, var(--nai-panel-solid-surface) var(--nai-lab-editor-opacity, 60%), transparent)');
    expect(module.border).toContain('1px solid');
    expect(module['border-radius']).toBe('var(--nai-panel-radius, 18px)');
    expect(module['backdrop-filter']).toContain('blur(var(--nai-glass-blur');
    expect(module.overflow).toBe('visible');
    for (const suffix of [' > summary', ' :is(div, section, article, fieldset).appearance-group:not([role]):not([data-active]):not(.appearance-segmented)']) {
      expect(declarations(`${root} .chain-editor-main .lab-module-section${suffix}`, undefined, source)).toMatchObject({ background: 'transparent', border: '0', 'backdrop-filter': 'none' });
    }
    expect(declarations('.lab-preview-stage', undefined, source)['backdrop-filter']).toBe('none');
    expect(declarations('.lab-preview-stage', undefined, source)['background-color']).toBeUndefined();
    expect(declarations("html[data-theme-material='glass'] .lab-preview-stage", undefined, source)['background-color']).toBeUndefined();
    expect(declarations("html[data-theme-material='glass']:not(.dark) .lab-preview-stage:has(.lab-preview-empty)", undefined, source)['background-color']).toContain('8%, transparent');
    expect(source).not.toContain('.lab-preview-image');
    const nav = declarations("html[data-control-style='filled'] .generation-mode-nav > button[aria-current='page']", undefined, source);
    expect(nav['background-color']).toBe('var(--color-indigo-600)');
    expect(nav.color).toBe('var(--nai-on-accent-600)');
    expect(declarations(`${root} .generation-action-button--workbench:not(.generation-action-button--loading) .generation-action-button__cost`, undefined, source)).toMatchObject({ color: 'inherit', background: 'transparent' });
    const secondary = declarations("html[data-control-style='filled'] .workspace-mode-tabs > button[aria-selected='true']", undefined, source);
    expect(secondary['background-color']).toBe('color-mix(in srgb, var(--nai-accent) 14%, var(--nai-control-surface))');
    expect(secondary.color).toBe('var(--nai-segment-text)');
    expect(secondary['box-shadow']).toContain('var(--nai-control-border)');
    expect(secondary['box-shadow']).toContain('var(--nai-glass-highlight, .3)');
    expect(declarations("html[data-control-style='filled'][data-theme-material='glass'] .workspace-mode-tabs > button[aria-selected='true']", undefined, source)['background-color']).toBe('color-mix(in srgb, var(--nai-accent) 14%, transparent)');
    const surface = declarations(`${root} .lab-editor-surface`, undefined, source);
    expect(surface.background).toBe('transparent');
    expect(surface.border).toBe('0');
    expect(surface['box-shadow']).toBe('none');
    expect(surface.width).toBe('calc(100% - 1.5rem)');
    expect(surface.padding).toBe('0');
    expect(surface.margin).toBe('.75rem auto calc(var(--spacing) * 36)');
    expect(surface.filter).toBeUndefined();
    expect(surface['backdrop-filter']).toBe('none');
    expect(declarations(`${root} .lab-editor-surface`, '(min-width: 768px)', source)['margin-bottom']).toBe('calc(var(--spacing) * 24)');
    expect(source).not.toContain('.app-shell');
    expect(declarations(`${root}.dark .chain-editor-workspace`, undefined, source)['background-color']).toBeUndefined();
    expect(declarations(`${root} .lab-editor-surface .lab-module-section`, '(prefers-reduced-transparency: reduce)', source)['background-color']).toBe('var(--nai-panel-solid-surface)');
    expect(source).not.toContain('.lab-editor-surface { background-color: var(--nai-panel-solid-surface)');
    expect(sources.find(item => item.file === 'components/ImageEditPreview.tsx')!.text).toContain('<ChainEditorPreview');
    for (const name of ['ChainEditor', 'ImageEditControls']) {
      const code = sources.find(item => item.file === `components/${name}.tsx`)!.text;
      expect(code).toContain('<LabModuleSection');
      expect(code.match(/className="lab-editor-surface/g)).toHaveLength(1);
      expect(code).toMatch(/className="lab-editor-surface[^\"]*gap-6/);
    }
  });
  it('默认明暗的辅助文字可读，导航与内容库标题不再使用过浅或过暗的字阶', () => {
    const light = declarations("html[data-design-theme='nai-atelier']");
    for (const shade of [400, 500]) expect(themeContrast(light[`--color-gray-${shade}`], light['--color-gray-100'])).toBeGreaterThanOrEqual(4.5);
    const dark = declarations("html[data-design-theme='nai-atelier'].dark");
    expect(themeContrast(dark['--color-gray-500'], dark['--color-gray-750'])).toBeGreaterThanOrEqual(4.5);
    const groupLabel = classes.find(item => item.file === 'components/Layout.tsx' && item.text.includes('tracking-[0.16em]'));
    expect(groupLabel?.text).toContain('text-gray-500 dark:text-gray-400');
    const libraryLabel = classes.find(item => item.file === 'components/PromptLibrary.tsx' && item.text.includes('md:mb-2 md:block'));
    expect(libraryLabel?.text).toContain('text-gray-500 dark:text-gray-400');
    expect(libraryLabel?.text).not.toContain('md:text-gray-400');
    expect(declarations('.generation-action-button').color).toBe('var(--nai-accent-text-800)');
    expect(declarations('.generation-action-button__cost')).toMatchObject({ color: 'var(--nai-accent-text-800)', background: 'transparent' });
  });
  it('夜间独立编辑模块沿用透明度与字段保护，输入文字在最亮壁纸上仍具备阅读对比度', () => {
    const source = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    const root = "html:root[data-theme-details='true']:is([data-theme-material='glass'], [data-theme-material='frosted'])";
    const night = `${root}.dark .lab-editor-surface`;
    const surface = declarations(night, undefined, source);
    expect(declarations(`${root} .lab-editor-surface .lab-module-section`, undefined, source)['background-color']).toBe('color-mix(in srgb, var(--nai-panel-solid-surface) var(--nai-lab-editor-opacity, 60%), transparent)');
    const fieldOpacity = parseFloat(surface['--nai-editor-field-fill']) / 100;
    const [preset] = readAppearancePresetImport(readFileSync('public/themes/cupertino-liquid-glass.json', 'utf8'));
    const palette = resolveThemePalette(preset.palette, true);
    const panelOpacity = resolveThemeDetails(preset.details, true)!.labEditorOpacity;
    expect(panelOpacity).toBeGreaterThanOrEqual(.5);
    expect(panelOpacity).toBeLessThanOrEqual(.6);
    const brightestPanel = mixThemeColor(palette.panel, '#ffffff', panelOpacity);
    const inputSurface = mixThemeColor(palette.panel, brightestPanel, fieldOpacity);
    expect(themeContrast(palette.text, inputSurface)).toBeGreaterThanOrEqual(4.5);
    expect(declarations(`${night} :is(input, textarea):enabled::placeholder`, undefined, source).color).toBe('var(--color-gray-100)');
    const action = declarations(`${night} button:not(:disabled):is([class~='text-[var(--nai-accent)]'], [class~='dark:text-indigo-300'], [class~='dark:text-indigo-400'])`, undefined, source);
    expect(action.color).toContain('var(--color-gray-100)');
    expect(action.opacity).toBeUndefined();
    expect(declarations(`${root} .lab-editor-surface`, undefined, source)['--nai-editor-field-fill']).toBeUndefined();
    expect(declarations(`${root}.dark .chain-editor-workspace`, undefined, source)['background-color']).toBeUndefined();
  });
  it('自定义画布色覆盖页面底板，保留卡片、图片与默认主题的独立表面', () => {
    expect(declarations("html[data-design-theme='nai-atelier'][data-custom-palette='true'] .workspace-canvas")['background-color']).toBe('var(--nai-canvas)');
    for (const name of ['Layout', 'ChainList', 'ArtistLibrary', 'CharacterLibrary', 'CreationFootprint', 'PromptLibrary', 'GenHistory', 'DanbooruGallery', 'PixivGallery', 'AitagGallery', 'ChainEditor', 'StyleRollPage']) {
      const source = sources.find(source => source.file === `components/${name}.tsx`)!;
      expect(source.text, name).toContain('workspace-canvas');
    }
    const artist = sources.find(source => source.file === 'components/ArtistLibrary.tsx')!.text;
    expect(artist.split('\n').find(line => line.includes('ref={scrollContainerRef}'))).toContain('className="workspace-canvas');
    expect(declarations("html[data-design-theme='nai-atelier'] .media-card")['background-color']).toBeUndefined();
    const detailCss = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    // alpha 的 min 两边保持相同数字类型，避免整条玻璃阴影失效。
    expect(declarations("html[data-theme-details='true'][data-theme-material='glass']", undefined, detailCss)['--nai-glass-edge']).toContain('min(.8,');
  });
  it('锚定展开适用于所有主题，玻璃只增强形态，系统减少动效时不播放', () => {
    const media = '(prefers-reduced-motion: no-preference)';
    expect(declarations("html[data-motion='full'] .appearance-popover", media, css).animation).toContain('ui-popover-in');
    expect(declarations("html[data-motion='reduced'] .appearance-popover", undefined, css).animation).toBeUndefined();
    const detailCss = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    expect(declarations("html[data-theme-material='glass'][data-motion='full'] .appearance-popover", media, detailCss)['animation-name']).toBe('nai-glass-popover-in');
    parse(css + detailCss).walkAtRules('keyframes', rule => {
      if (['ui-popover-in', 'nai-glass-popover-in'].includes(rule.params)) {
        expect(rule.toString()).toContain('transform: scale('); expect(rule.toString()).not.toMatch(/\btranslate:/);
      }
    });
    const horizontal = declarations('.-translate-x-1\\/2'), vertical = declarations('.-translate-y-full');
    expect(horizontal.translate).toContain('--tw-translate-x'); expect(horizontal['--tw-translate-x']).toBe('calc(calc(1/2 * 100%) * -1)');
    expect(vertical.translate).toContain('--tw-translate-y'); expect(vertical['--tw-translate-y']).toMatch(/-100%|100%.*-1/);
    expect(horizontal.transform).toBeUndefined(); expect(vertical.transform).toBeUndefined();
    const glassFrames = parse(detailCss).nodes.find(node => node.type === 'atrule' && node.name === 'keyframes' && node.params === 'nai-glass-popover-in');
    expect(glassFrames?.toString()).toContain('backdrop-filter: var(--nai-glass-filter)');
    expect(glassFrames?.toString()).not.toContain('url(');
    const base = "html:root[data-theme-details='true'][data-theme-material='glass'] :is(.app-sidebar, .workspace-command-bar, .app-mobile-nav, .appearance-panel, .settings-dialog, .operation-dialog, .mobile-page-header, .mobile-detail-header, .mobile-detail-footer)";
    expect(declarations(base, undefined, detailCss)['--nai-glass-contour']).toBe('initial');
  });
  it('生产 CSS 优化后保留标准背景滤镜、折射与关闭规则', () => {
    const source = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    const optimized = optimize(source, { file: 'components/themeDetails.css', minify: true }).code;
    const filters: string[] = [];
    parse(optimized).walkDecls('backdrop-filter', declaration => { filters.push(declaration.value); });
    expect(filters.some(value => value.includes('--nai-glass-blur'))).toBe(true);
    expect(filters).toContain('var(--nai-glass-filter)');
    expect(filters.some(value => /^var\(--nai-glass-filter\)\s*var\(--nai-glass-contour,/.test(value))).toBe(true);
    expect(filters.filter(value => value === 'none').length).toBeGreaterThanOrEqual(7);
  });
  it('追光只画在独立无滤镜层，不更新玻璃表面背景', () => {
    const selectors: string[] = [];
    parse(readFileSync(resolve('components/themeDetails.css'), 'utf8')).walkRules(rule => {
      rule.walkDecls('background-image', declaration => {
        if (declaration.value.includes('--nai-light-x')) selectors.push(rule.selector);
      });
    });
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector).toContain("[data-theme-light='true']");
      expect(selector).toContain("[data-theme-material='glass'][data-motion='full']");
      expect(selector).toContain('.nai-theme-light');
      expect(selector).not.toMatch(/\.(?:appearance-panel|appearance-control-panel|settings-content|settings-dialog|operation-dialog)\b/);
    }
    const layer = declarations('.nai-theme-light', undefined, readFileSync(resolve('components/themeDetails.css'), 'utf8'));
    expect(layer['pointer-events']).toBe('none');
    expect(layer.contain).toBe('strict');
    expect(layer['backdrop-filter']).toBeUndefined();
  });
  it('玻璃透光不会被实色输入框盖住，固定反光和既定追光范围分别保留', () => {
    const detailCss = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    const fields = "html[data-theme-material='glass'][data-control-style='filled'] :is(input:not([type='range']):not([type='color']):not([type='checkbox']):not([type='radio']):not([type='file']):not([type='hidden']), select, textarea)";
    expect(declarations(fields, undefined, detailCss)['background-color']).toContain('transparent');
    const fallback = "html[data-theme-material='glass'][data-control-style='filled'] :is(input, select, textarea)";
    expect(declarations(fallback, '(prefers-reduced-transparency: reduce)', detailCss)['background-color']).not.toContain('transparent');
    const toggle = "html[data-theme-material='glass'][data-control-style='filled'] :is(.appearance-popover, .mobile-sheet) button[aria-pressed='false']";
    expect(declarations(toggle, undefined, detailCss)['background-color']).toContain('transparent');
    expect(declarations(toggle, '(prefers-reduced-transparency: reduce)', detailCss)['background-color']).not.toContain('transparent');
    const root = "html[data-theme-details='true'][data-theme-material='glass']";
    expect(declarations(root, undefined, detailCss)['--nai-glass-control-sheen']).toContain('linear-gradient');
    const large = "html:root[data-theme-details='true'][data-theme-material='glass'] :is(.app-sidebar, .workspace-command-bar, .app-mobile-nav, .appearance-panel, .settings-dialog, .operation-dialog, .mobile-page-header, .mobile-detail-header, .mobile-detail-footer)";
    expect(declarations(large, undefined, detailCss)['background-image']).toBe('var(--nai-glass-surface-reflection)');
    const surface = declarations(root, undefined, detailCss)['--nai-glass-surface-sheen'];
    expect(surface).toContain('linear-gradient(180deg'); expect(surface).toContain('transparent 36px');
    expect(surface).not.toContain('%');
    expect(surface).not.toContain('38%');
    expect(surface).not.toContain('url(');
    expect(detailCss).not.toMatch(/nai-glass-grain|feTurbulence/);
    expect(declarations(`${root} .settings-navigation`, undefined, detailCss)['--nai-glass-surface-reflection']).toBe('none');
    parse(detailCss).walkRules(rule => rule.walkDecls('background-image', declaration => {
      if (declaration.value.includes('--nai-glass-control-sheen')) expect(rule.selector).not.toMatch(/\.(?:settings-dialog|settings-navigation|app-sidebar|workspace-command-bar|appearance-panel)\b/);
    }));
    const control = "html[data-theme-material='glass'][data-motion='full'] .nai-theme-light[data-theme-light='true'][data-light-kind='control']";
    const light = declarations(control, undefined, detailCss)['background-image'];
    expect(light).toContain('48px circle'); expect(light).not.toContain('var(--nai-glass-control-sheen)');
    const chrome = "html[data-theme-material='glass'][data-motion='full'] .nai-theme-light[data-theme-light='true'][data-light-kind='chrome']";
    expect(declarations(chrome, undefined, detailCss)['background-image']).toContain('96px circle');
    expect(declarations(chrome, undefined, detailCss)['background-image']).toContain('var(--nai-light-opacity) * .25');
    expect(declarations(chrome, undefined, detailCss)['background-image']).not.toContain('linear-gradient');
    expect(declarations(chrome, undefined, detailCss)['background-image']).not.toContain('--nai-glass-control-sheen');
    expect(declarations(chrome, undefined, detailCss)['background-image']).not.toContain('--nai-glass-surface-reflection');
    expect(declarations("html[data-theme-material='glass'].dark", undefined, detailCss)['--nai-light-opacity']).toBe('min(22%, calc(var(--nai-glass-highlight, .6) * 120%))');
  });
  it('高级玻璃只折射背景，触屏不缩小控件，减少透明度与动效优先', () => {
    const detailCss = readFileSync(resolve('components/themeDetails.css'), 'utf8');
    const root = "html[data-theme-details='true']";
    const touch = '(max-width: 767px), (any-pointer: coarse)';
    expect(declarations(`${root} [data-control-kind='icon']`, touch, detailCss)['min-width']).toBe('44px');
    expect(declarations(`${root} [data-appearance='control']`, touch, detailCss)['min-height']).toBe('44px');
    expect(declarations(`${root} .app-sidebar nav button`, touch, detailCss)['min-height']).toBe('44px');
    expect(declarations(`${root} [data-appearance='control']`, undefined, detailCss).height).toBe('var(--nai-control-height, revert-layer)');
    expect(detailCss).toContain("@supports (backdrop-filter: url('#nai-glass-lens') blur(1px))");
    const filteredSelectors: string[] = [];
    const lensOrder: string[] = [];
    parse(detailCss).walkRules(rule => {
      rule.walkDecls(/^(?:backdrop-)?filter$/, declaration => {
        if (declaration.value.includes('nai-glass-contour')) { filteredSelectors.push(rule.selector); lensOrder.push(declaration.value); }
      });
    });
    expect(filteredSelectors).toHaveLength(1);
    expect(lensOrder).toEqual(['var(--nai-glass-filter) var(--nai-glass-contour, )']);
    expect(filteredSelectors[0]).not.toMatch(/(?:img|canvas|media-card|gallery-image)/);
    for (const surface of ['.settings-dialog', '.operation-dialog', '.mobile-page-header', '.mobile-detail-header', '.mobile-detail-footer']) expect(filteredSelectors[0]).toContain(surface);
    const nested = "html:root[data-theme-details='true']:is([data-theme-material='glass'], [data-theme-material='frosted']) :is(.settings-dialog, .operation-dialog, .appearance-surface, .appearance-panel) .appearance-surface";
    expect(declarations(nested, undefined, detailCss)['backdrop-filter']).toBe('none');
    expect(declarations(nested, undefined, detailCss)['-webkit-backdrop-filter']).toBe('none');
    const button = "html[data-theme-material='glass'][data-control-style='filled'] [data-appearance='control'][data-tone='neutral']:not(input):not(select):not([data-active='true'])";
    expect(declarations(button, undefined, detailCss)['background-color']).toBe('transparent');
    expect(declarations(button, undefined, detailCss)['box-shadow']).not.toContain('--nai-glass-edge');
    expect(declarations(button, undefined, detailCss)['box-shadow']).toBe('none');
    expect(detailCss).toContain("[data-theme-material='glass'][data-motion='full']");
    const fallback = "html:root[data-theme-details='true']:is([data-theme-material='glass'], [data-theme-material='frosted']) :is(.app-sidebar, .workspace-command-bar, .app-mobile-nav, .appearance-surface, .appearance-group, .appearance-reading-surface, .appearance-panel, .settings-dialog, .operation-dialog, .mobile-page-header, .mobile-detail-header, .mobile-detail-footer)";
    expect(declarations(fallback, '(prefers-reduced-transparency: reduce)', detailCss)['backdrop-filter']).toBe('none');
    const reducedButton = "html[data-theme-material='glass'] [data-appearance='control'][data-tone='neutral']:not([data-active='true'])";
    expect(declarations(reducedButton, '(prefers-reduced-transparency: reduce)', detailCss)['background-color']).toBe('var(--nai-control-surface, var(--nai-panel-solid-surface))');
    const solid = "html[data-theme-details='true'][data-theme-material='solid'] :is(.app-sidebar, .workspace-command-bar, .app-mobile-nav, .appearance-panel, .settings-dialog, .operation-dialog, .mobile-page-header, .mobile-detail-header, .mobile-detail-footer)";
    expect(declarations(solid, undefined, detailCss)['backdrop-filter']).toBe('none');
  });
  it('内容库主操作使用深色强调底和配套前景，蓝色主题明暗模式均为白字', () => {
    const selector = "html:root[data-design-theme='nai-atelier'] .content-library [data-appearance='control'][data-tone='primary']";
    expect(declarations(selector)).toMatchObject({
      'background-color': 'var(--nai-action-deep)', 'border-color': 'var(--nai-action-deep)', color: 'var(--nai-on-action)',
    });
    for (const dark of [false, true]) {
      applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, accentColor: '#0ea5e9' }, dark);
      const foreground = document.documentElement.style.getPropertyValue('--nai-on-action');
      expect(foreground).toBe('#ffffff');
      expect(themeContrast(foreground, mixThemeColor('#0ea5e9', dark ? '#0d0f14' : '#000000', dark ? .55 : .68))).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('强调色控件和文字使用可读前景色，自定义面板接管白底但不改语义色与图片遮罩', () => {
    expect(declarations("html[data-design-theme='nai-atelier'] :is(.bg-indigo-600, .bg-violet-600).text-white").color).toBe('var(--nai-on-accent-600)');
    expect(declarations("html[data-design-theme='nai-atelier'] :is([class~='hover:bg-indigo-500'], [class~='hover:bg-violet-500']).text-white:hover:not(:disabled)").color).toBe('var(--nai-on-accent-500)');
    expect(declarations("html[data-design-theme='nai-atelier'].dark :where([class~='dark:text-indigo-300'], [class~='dark:text-violet-300'])").color).toBe('var(--nai-accent-text-300)');
    const surface = readFileSync(resolve('components/AgentSurface.css'), 'utf8');
    expect(surface).toContain('color: var(--nai-on-accent, white)');
    expect(css).toContain("html[data-custom-palette='true']:not(.dark)");
    expect(css).not.toContain('.bg-red-600.text-white');
    expect(css).not.toContain("[class~='bg-white/10']");
  });
  it('主导航内部过渡跟随原有宽度动效，折叠与拖宽不借助工作区缩放或位移', () => {
    expect(declarations('.app-sidebar-nav', undefined, css).transition).toContain('padding 200ms');
    const item = declarations('.app-sidebar[data-collapsed] .app-sidebar-nav-item', undefined, css);
    expect(item['transition-property']).toContain('padding');
    expect(item['transition-duration']).toBe('200ms');
    expect(declarations(".app-sidebar[data-collapsed='true'] .app-sidebar-label", undefined, css)).toMatchObject({ 'max-width': '0', opacity: '0' });
    expect(declarations(".app-sidebar[data-collapsed='true'] .app-sidebar-sources", undefined, css)['grid-template-rows']).toBe('0fr');
    expect(declarations('.app-sidebar-sources:not([hidden])', undefined, css)['grid-template-rows']).toBe('1fr');
    expect(declarations(".app-sidebar[data-resizing='true'] :is(.app-sidebar-nav, .app-sidebar-nav-item, .app-sidebar-label, .app-sidebar-group-label, .app-sidebar-sources)", undefined, css).transition).toBe('none');
    const workspace = declarations('.app-workspace', undefined, css);
    expect(workspace.transform).toBeUndefined();
    expect(workspace.scale).toBeUndefined();
  });

  it('Agent 侧栏保留桌面让位，但任何动效时长都不再让整个工作区逐帧改变宽度', () => {
    expect(declarations('.agent-stage')['transition-property']).toBe('none');
    const docked = '.agent-panel-docked .agent-stage';
    expect(declarations(docked, '(min-width: 1024px)')['padding-right']).toBe('var(--agent-docked-width, var(--agent-panel-width, 520px))');
    expect(declarations(docked)['padding-right']).toBeUndefined();
  });

  it('磨砂开关实时通知瀑布流，两个卡片开关独立映射到全局样式', () => {
    const { result } = renderHook(useGalleryFrostedCaption);
    for (const galleryFrostedCaption of [false, true]) for (const galleryHoverFloat of [false, true]) {
      act(() => applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, galleryFrostedCaption, galleryHoverFloat }, false));
      expect(result.current).toBe(galleryFrostedCaption);
      expect(document.documentElement.dataset.galleryFrostedCaption).toBe(String(galleryFrostedCaption));
      expect(document.documentElement.dataset.galleryHoverFloat).toBe(String(galleryHoverFloat));
    }
  });

  it('磨砂只叠放图文，悬停浮动仅在鼠标、完整动效与系统允许时启用', () => {
    const enabled = "html[data-gallery-frosted-caption='true']";
    expect(declarations(`${enabled} .gallery-card-visual`, undefined, css).display).toBe('grid');
    expect(declarations(`${enabled} .gallery-card-visual > .gallery-card-caption`, undefined, css)['grid-area']).toBe('1 / 1');
    const frost = declarations(`${enabled} .gallery-card-caption::before`, undefined, css);
    expect(frost['backdrop-filter']).toBe('blur(10px)');
    expect(frost['mask-image']).toContain('transparent');
    expect(frost['pointer-events']).toBe('none');
    expect(declarations(`${enabled} .gallery-card-caption`, undefined, css)['text-shadow']).toBe('none');
    const hover = "html[data-gallery-hover-float='true'][data-motion='full'] .gallery-image-card:not([data-press-input='touch']):not([data-press-input='pen']):hover";
    const media = '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
    expect(declarations(hover, media, css).translate).toBe('0 -3px');
    expect(declarations(`${hover} .mobile-gallery-frame img`, media, css).scale).toBe('1.035');
    expect(declarations(hover, undefined, css)).toEqual({});
    expect(declarations('.media-card:hover', undefined, css).transform).toBeUndefined();
  });
  it('磨砂标题优先于主题白底和文字映射，保留图标语义色及关闭后的普通底栏', () => {
    const root = "html[data-gallery-frosted-caption='true'] .gallery-card-caption";
    const expected = new Map([
      [root, { background: 'transparent', color: 'white' }],
      [`${root} :where(p, h2, h3, div, span, button)`, { color: 'inherit' }],
      [`${root} .gallery-card-meta`, { color: 'rgb(255 255 255 / .78)' }],
      [`${root} .gallery-card-badge`, { color: 'rgb(255 255 255 / .94)' }],
      [`${root} .gallery-chain-status`, { color: '#fcd34d' }],
    ]);
    for (const [selector, props] of expected) {
      const checked = new Set<string>();
      parse(generatedCss).walkRules(rule => {
        if (!rule.selectors.includes(selector)) return;
        for (const node of rule.nodes) {
          if (node.type !== 'decl' || !(node.prop in props)) continue;
          expect(node.important, `${selector} ${node.prop} 需要覆盖未分层的主题映射`).toBe(true);
          checked.add(node.prop);
        }
      });
      expect([...checked].sort()).toEqual(Object.keys(props).sort());
      expect(declarations(selector, undefined, css)).toMatchObject(props);
    }
    expect(declarations(`${root} :where(p, h2, h3, div, span, button, svg)`, undefined, css)).toEqual({});
    expect(declarations(`${root}::before`, undefined, css).background).toContain('rgb(12 16 24');
    expect(declarations("html[data-custom-palette='true']:not(.dark) :where(.bg-white, [class~='hover:bg-white']:hover, [class~='focus:bg-white']:focus, [class~='focus-within:bg-white']:focus-within)", undefined, css)['background-color']).toBe('var(--nai-white-surface)');
  });
  it('所有页面与组件的 JSX 类名没有固定像素字号或任意值圆角旁路', () => {
    const violations = classes.filter(item => /text-\[[\d.]+px\]|rounded(?:-[a-z]+)?-\[[\d.]+(?:px|rem)\]/.test(item.text));
    expect(violations).toEqual([]);
    // 深色背景下的正文不能仍使用浅色主题的深灰文字；图上白字与语义色另有用途。
    const darkTextViolations = classes.filter(item => /(?<![\w:-])text-gray-(?:[6-9]00|750|850|950)\b/.test(item.text) && !hasDarkTextColor(item.text));
    expect(darkTextViolations).toEqual([]);
    expect(files.length).toBeGreaterThan(70);
  });

  it('样式静态断言区分媒体块，字号、透明度和悬停色不能冒充暗色文字颜色', () => {
    const source = '.panel { border-radius: 12px; } @media (min-width: 1024px) { .panel { border-radius: 0; } }';
    expect(declarations('.panel', undefined, source)['border-radius']).toBe('12px');
    expect(declarations('.panel', '(min-width: 1024px)', source)['border-radius']).toBe('0');
    expect(declarations('.panel', '(max-width: 768px)', source)).toEqual({});
    expect(hasDarkTextColor('text-gray-900 dark:text-sm')).toBe(false);
    expect(hasDarkTextColor('text-gray-900 hover:dark:text-white')).toBe(false);
    expect(hasDarkTextColor('text-gray-900 dark:text-opacity-50')).toBe(false);
    expect(hasDarkTextColor('text-gray-900 dark:text-gray-100')).toBe(true);
    expect(hasDarkTextColor('text-gray-900 dark:text-blue-300/80')).toBe(true);
  });

  it('浮动中性面板全部接入主题材质，图片、拖入提示和语义状态保持独立', () => {
    const violations = classes.filter(item => /(?:["`\s])shadow-(?:xl|2xl)\b/.test(item.text)
      && /bg-white|bg-gray-/.test(item.text)
      && !/appearance-panel|operation-dialog|settings-dialog|border-dashed|bg-red-|queue-status-surface|generation-action-button|rounded-full/.test(item.text));
    expect(violations).toEqual([]);
    expect(declarations("html[data-design-theme='nai-atelier'] .appearance-panel")['background-color']).toBe('var(--nai-panel-surface)');
    expect(declarations("html[data-design-theme='nai-atelier'] .appearance-surface")['background-color']).toBe('var(--nai-panel-surface)');
  });

  it('默认圆角、字阶、主色及密度的实际编译产物引用全局变量', () => {
    expect(declarations('.rounded')['border-radius']).toBe('var(--radius-sm)');
    expect(declarations('.rounded-xl')['border-radius']).toBe('var(--radius-xl)');
    expect(declarations('.text-meta')['font-size']).toBe('var(--text-meta)');
    expect(declarations('.text-tiny')['font-size']).toBe('var(--text-tiny)');
    expect(declarations('.text-mini')['font-size']).toBe('var(--text-mini)');
    expect(declarations(':root')['--text-mini']).toBe('0.5625rem');
    expect(declarations('.bg-indigo-600')['background-color']).toBe('var(--color-indigo-600)');
    expect(declarations('.h-10').height).toBe('calc(var(--spacing) * 10)');
    expect(declarations('.p-3').padding).toBe('calc(var(--spacing) * 3)');
  });

  it('Agent 强度轨道沿用主题色，圆形发送和停止不受手机最小高度拉伸', () => {
    const modelCss = readFileSync(resolve('components/AgentModelControl.css'), 'utf8');
    const actionCss = readFileSync(resolve('components/AgentSurface.css'), 'utf8');
    const modelRules = parse(modelCss), actionRules = parse(actionCss);
    const ruleDecls = (root: ReturnType<typeof parse>, selector: string) => {
      const result: Record<string, string> = {};
      root.walkRules(rule => { if (rule.selectors.includes(selector)) rule.walkDecls(decl => { result[decl.prop] = decl.value; }); });
      return result;
    };
    expect(ruleDecls(modelRules, '.agent-thinking-fill').background).toBe('var(--nai-accent, #006fdf)');
    const particleSource = readFileSync(resolve('components/AgentThinkingParticles.tsx'), 'utf8');
    expect(particleSource).toContain("['off', 'reduced'].includes(document.documentElement.dataset.motion");
    expect(particleSource).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(particleSource).toContain('if (!reduced()) frame = requestAnimationFrame(tick)');
    const action = ruleDecls(actionRules, '.agent-composer-action');
    expect(action.width).toBe(action.height); expect(action['min-width']).toBe(action['min-height']);
    expect(action['border-radius']).toBe('50%'); expect(action.flex).toBe('0 0 var(--agent-action-size)');
    expect(actionCss).toContain('max(44px, 2.75rem)');
    const panel = sources.find(source => source.file === 'components/PromptAgentPanel.tsx')!.text;
    expect(panel.match(/className="agent-composer-action /g)?.length).toBe(2);
  });

  it('Agent 表单、工具栏和滑块跟随面板材质、边框与主色', () => {
    const surface = parse(readFileSync(resolve('components/AgentSurface.css'), 'utf8'));
    const rules: Record<string, Record<string, string>> = {};
    surface.walkRules(rule => { rule.walkDecls(decl => { (rules[rule.selector] ||= {})[decl.prop] = decl.value; }); });
    const fields = rules[".agent-theme :where(input:not([type='checkbox']):not([type='radio']):not([type='range']), textarea, select)"];
    expect(fields['background-color']).toContain('var(--nai-panel-surface)'); expect(fields['background-color']).toContain('var(--nai-accent)');
    expect(fields['border-color']).toBe('var(--nai-panel-border)');
    expect(rules['.agent-theme :where(header, .workspace-command-bar)']['background-color']).toBe('var(--nai-toolbar-surface)');
    const model = readFileSync(resolve('components/AgentModelControl.css'), 'utf8');
    expect(model).toMatch(/\.agent-thinking-thumb\s*\{[^}]*background:\s*var\(--nai-panel-solid-surface,\s*white\)/);
    expect(model).toMatch(/\.dark \.agent-thinking-thumb\s*\{[^}]*background:\s*var\(--nai-panel-solid-surface,\s*#171b24\)/);
    // 透光仅作用于面板；滑块圆钮仍使用对应主题的不透明底色。
    expect(declarations("html[data-design-theme='nai-atelier']")['--nai-panel-solid-surface']).toBe('#ffffff');
    expect(declarations("html[data-design-theme='nai-atelier'].dark")['--nai-panel-solid-surface']).toBe('#171b24');
    for (const selector of ["html[data-surfaces='translucent']", "html[data-surfaces='translucent'].dark"]) {
      expect(declarations(selector)['--nai-panel-surface']).toMatch(/rgb\(.+\/ 0\./);
      expect(declarations(selector)['--nai-panel-solid-surface']).toBeUndefined();
    }
  });

  it('Agent 手机圆角、拖拽强调色与手机详情栏使用主题变量，全屏边界保留直角', () => {
    expect(declarations('.agent-panel')['border-radius']).toBe('var(--radius-2xl) var(--radius-2xl) 0 0');
    expect(declarations('.agent-panel', '(min-width: 1024px)')['border-radius']).toBe('0');
    expect(declarations('.agent-panel--fullscreen')['border-radius']).toBe('0');
    expect(declarations('.agent-resize-handle-desktop:hover::after', '(min-width: 1024px)').background).toBe('var(--color-indigo-500)');
    expect(declarations('.mobile-detail-header', '(max-width: 767px)').background).toBe('var(--nai-toolbar-surface)');
    expect(declarations('.mobile-detail-footer', '(max-width: 767px)')['border-top']).toBe('1px solid var(--nai-panel-border)');
    expect(declarations('.mobile-detail', '(max-width: 767px)').background).toBe('var(--nai-panel-surface)');
    expect(css).toContain('--nai-scrollbar-size: 6px');
    expect(declarations('*::-webkit-scrollbar').width).toBe('var(--nai-scrollbar-size)');
  });

  it('减少动画停止装饰循环与悬停位移，不把功能性加载指示加速成闪烁', () => {
    expect(css).toMatch(/html\[data-motion='reduced'\] :is\(\.animate-pulse, \.animate-bounce, \.smart-image-shimmer\)[^{}]*\{ animation: none !important; \}/);
    expect(declarations("html[data-motion='reduced'] .animate-spin")['animation-duration']).toBe('1s');
    expect(declarations("html[data-motion='reduced'] .media-card:hover").transform).toBe('none');
    expect(declarations("html[data-motion='off'] .media-card:hover").transform).toBe('none');
    expect(sources.filter(source => /behavior:\s*'smooth'|behavior:[^\n]*:\s*'smooth'/.test(source.text))).toEqual([]);
  });

  it.each([
    ['light', true, false], ['dark', false, true], ['system', true, true], ['system', false, false],
  ] as const)('App 挂载前恢复 %s 模式，系统暗色 %s 时根主题为 %s', (themeMode, dark, expected) => {
    systemDark = dark;
    saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, themeMode, accentColor: '#14b8a6', density: 'compact', corners: 'sharp', surfaces: 'translucent', motion: 'off', fontScale: 'large' });
    restoreAppearancePreferences();
    expect(document.documentElement.classList.contains('dark')).toBe(expected);
    expect(document.documentElement.dataset).toMatchObject({ designTheme: 'nai-atelier', density: 'compact', corners: 'sharp', surfaces: 'translucent', motion: 'off', fontScale: 'large' });
    expect(document.documentElement.style.getPropertyValue('--nai-accent')).toBe('#14b8a6');
  });

  it('系统变化使用最新保存偏好，门禁与错误边界前即可生效', () => {
    saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, themeMode: 'system' });
    restoreAppearancePreferences(); expect(document.documentElement.classList.contains('dark')).toBe(false);
    saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, themeMode: 'system', accentColor: '#d97706' });
    systemDark = true; restoreAppearancePreferences();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--nai-accent')).toBe('#d97706');
    const entry = readFileSync(resolve('index.tsx'), 'utf8');
    expect(entry.indexOf('restoreAppearancePreferences();')).toBeLessThan(entry.indexOf('ReactDOM.createRoot('));
    expect(entry).toContain("addEventListener('change', restoreAppearancePreferences)");
  });

  it('禁止读取本地存储时仍能在 React 挂载前恢复默认主题', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('不可访问', 'SecurityError'); });
    expect(() => restoreAppearancePreferences()).not.toThrow();
    expect(document.documentElement.dataset).toMatchObject({ designTheme: 'nai-atelier', density: 'standard', corners: 'standard', fontScale: 'standard' });
    expect(document.documentElement.style.getPropertyValue('--nai-accent')).toBe(DEFAULT_APPEARANCE_PREFERENCES.accentColor);
  });

  it('未授权访问页沿用已恢复主题，密码输入与连接失败面板具备两套色阶', async () => {
    saveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, themeMode: 'light', corners: 'sharp' });
    restoreAppearancePreferences();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authorized: false }) }));
    const view = render(<LanAccessGate><div>已授权内容</div></LanAccessGate>);
    const pin = await screen.findByLabelText('四位数字密码');
    expect(pin.classList.contains('text-gray-900')).toBe(true);
    expect(pin.classList.contains('dark:text-gray-100')).toBe(true);
    expect(pin.closest('form')?.classList.contains('appearance-panel')).toBe(true);
    expect(screen.getByRole('button', { name: '进入项目' }).classList.contains('text-white')).toBe(true);
    expect(screen.queryByText('已授权内容')).toBeNull();
    view.unmount();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('连接失败')));
    render(<LanAccessGate><div>已授权内容</div></LanAccessGate>);
    expect((await screen.findByText('无法连接电脑端')).closest('.appearance-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新连接' }).classList.contains('text-white')).toBe(true);
  });

  it.each([
    ['full', false, 'smooth'], ['full', true, 'auto'], ['reduced', false, 'auto'],
    ['reduced', true, 'auto'], ['off', false, 'auto'], ['off', true, 'auto'],
  ] as const)('%s 动效／系统减少动画 %s 时，JS 滚动采用 %s', (motion, reduced, expected) => {
    systemReduced = reduced;
    applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, motion }, false);
    expect(appearanceScrollBehavior()).toBe(expected);
  });
});
