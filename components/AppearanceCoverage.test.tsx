// @vitest-environment jsdom
import React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { compile } from '@tailwindcss/node';
import { parse } from 'postcss';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanAccessGate } from './LanAccessGate';
import {
  applyAppearancePreferences, appearanceScrollBehavior, DEFAULT_APPEARANCE_PREFERENCES,
  restoreAppearancePreferences, saveAppearancePreferences,
} from '../services/appearancePreferences';

const files = ['App.tsx', ...readdirSync('components', { recursive: true })
  .filter(file => typeof file === 'string' && file.endsWith('.tsx') && !file.includes('.test.'))
  .map(file => `components/${file}`)];
const sources = files.map(file => ({ file, text: readFileSync(resolve(file), 'utf8') }));
const css = readFileSync(resolve('index.css'), 'utf8');
const classes: { file: string; text: string }[] = [];
for (const source of sources) {
  const ast = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'className' && node.initializer) {
      classes.push({ file: source.file, text: node.initializer.getText(ast) });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
let generatedCss: string;
const declarations = (selector: string) => {
  const result: Record<string, string> = {};
  // 按生成后的源码顺序取最终规则；能识别 Tailwind 固定值被无层主题规则覆盖。
  parse(generatedCss).walkRules(rule => {
    if (rule.selectors.includes(selector)) rule.walkDecls(decl => { result[decl.prop] = decl.value; });
  });
  return result;
};
let systemDark: boolean;
let systemReduced: boolean;
beforeAll(async () => {
  const compiler = await compile(css, { base: process.cwd(), onDependency: () => {} });
  generatedCss = compiler.build(['rounded', 'rounded-xl', 'text-meta', 'text-tiny', 'bg-indigo-600', 'h-10', 'p-3']);
});
beforeEach(() => {
  systemDark = false; systemReduced = false;
  localStorage.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('color-scheme') ? systemDark : systemReduced }));
  applyAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES, false);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); applyAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES, false); });

describe('全局外观覆盖审计', () => {
  it('所有页面与组件的 JSX 类名没有固定像素字号或任意值圆角旁路', () => {
    const violations = classes.filter(item => /text-\[[\d.]+px\]|rounded(?:-[a-z]+)?-\[[\d.]+(?:px|rem)\]/.test(item.text));
    expect(violations).toEqual([]);
    // 深色背景下的正文不能仍使用浅色主题的深灰文字；图上白字与语义色另有用途。
    const darkTextViolations = classes.filter(item => /(?<![\w:-])text-gray-(?:[6-9]00|750|850|950)\b/.test(item.text) && !item.text.includes('dark:text-'));
    expect(darkTextViolations).toEqual([]);
    expect(files.length).toBeGreaterThan(70);
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
    expect(declarations('.agent-panel')['border-radius']).toBe('0'); // 桌面贴边，最后规则保持直角。
    expect(css).toMatch(/\.agent-panel\s*\{[^}]*border-radius: var\(--radius-2xl\) var\(--radius-2xl\) 0 0;/);
    expect(declarations('.agent-resize-handle-desktop:hover::after').background).toBe('var(--color-indigo-500)');
    expect(declarations('.mobile-detail-header').background).toBe('var(--nai-toolbar-surface)');
    expect(declarations('.mobile-detail-footer')['border-top']).toBe('1px solid var(--nai-panel-border)');
    expect(declarations('.mobile-detail').background).toBe('var(--nai-panel-surface)');
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
