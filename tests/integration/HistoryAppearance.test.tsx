// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from '@tailwindcss/node';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryBrowseControls } from '../../components/HistoryBrowseControls';
import { TOOLBAR_CONTROL_CLASS } from '../../components/DesignSystem';
import { applyAppearancePreferences, DEFAULT_APPEARANCE_PREFERENCES } from '../../services/appearancePreferences';

const appCss = readFileSync(resolve('index.css'), 'utf8');
const toolbarCss = readFileSync(resolve('components/historyToolbar.css'), 'utf8');
const viewerCss = readFileSync(resolve('components/historyViewer.css'), 'utf8');
const dialogCss = readFileSync(resolve('components/operationDialog.css'), 'utf8');
let generatedCss: string;
let workWidth: number;
const rule = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const result = css.match(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`));
  if (!result) throw new Error(`缺少规则：${selector}`);
  return result[1];
};
const property = (css: string, name: string) => {
  const result = css.match(new RegExp(`(?:^|[;\\n])\\s*${name}\\s*:\\s*([^;]+)`));
  if (!result) throw new Error(`缺少属性：${name}`);
  return result[1].trim();
};
beforeAll(async () => {
  // 只编译相关 CSS 候选，不执行打包或浏览器；检查真实生成的样式与主题变量绑定。
  const compiler = await compile(appCss, { base: process.cwd(), onDependency: () => {} });
  generatedCss = compiler.build(TOOLBAR_CONTROL_CLASS.split(' '));
});
beforeEach(() => {
  workWidth = 1200;
  document.documentElement.removeAttribute('style');
  applyAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES, false);
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: HTMLElement) {
      if (element.classList.contains('history-toolbar-shell')) this.callback([{ contentRect: { width: workWidth } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    disconnect() {}
  });
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals();
  document.documentElement.removeAttribute('style');
  applyAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES, false);
});
const setup = () => render(<div className="agent-stage"><header><div className="history-toolbar-shell"><HistoryBrowseControls query={{ sort: 'newest', model: 'model-a' }} options={{ models: ['model-a'], sources: [] }} mobile={false} onApply={vi.fn()} /></div></header></div>);

describe('历史控件主题链路', () => {
  it('全部顶栏按钮与排序选择器共用样式，选择器不再由局部 CSS 固定圆角、字体或颜色', () => {
    const { container } = setup();
    for (const element of container.querySelectorAll('button, select')) {
      for (const name of TOOLBAR_CONTROL_CLASS.split(' ')) expect(element.classList.contains(name)).toBe(true);
    }
    const sort = screen.getByRole('combobox', { name: '历史排序' });
    expect(sort.classList.contains('appearance-none')).toBe(true);
    expect(sort.parentElement?.querySelectorAll('svg')).toHaveLength(2);
    expect(toolbarCss).not.toContain('history-sort-select');
    expect(rule(toolbarCss, '.history-sort-control')).not.toMatch(/border-radius|font-size|background|color/);
  });

  it.each([
    ['compact', 'sharp', 'small', 33.75, 5.25],
    ['standard', 'standard', 'standard', 40, 12],
    ['comfortable', 'soft', 'large', 46.75, 18.7],
  ])('%s 密度／%s 圆角／%s 字号共同控制按钮与排序的编译样式', (density, corners, font, expectedHeight, expectedRadius) => {
    setup();
    expect(property(rule(generatedCss, '.h-10'), 'height')).toBe('calc(var(--spacing) * 10)');
    expect(property(rule(generatedCss, '.rounded-xl'), 'border-radius')).toBe('var(--radius-xl)');
    expect(property(rule(generatedCss, '.text-sm'), 'font-size')).toBe('var(--text-sm)');
    const fontSize = parseFloat(property(rule(generatedCss, `html[data-font-scale='${font}']`), 'font-size'));
    const spacing = parseFloat(property(rule(generatedCss, `html[data-density='${density}']`), '--spacing'));
    const radius = parseFloat(property(rule(generatedCss, `html[data-corners='${corners}']`), '--radius-xl'));
    expect(spacing * fontSize * 10).toBeCloseTo(Number(expectedHeight));
    expect(radius * fontSize).toBeCloseTo(Number(expectedRadius));
    expect(toolbarCss).toContain('min-width: 44px');
    expect(appCss).toMatch(/button,\s*select,\s*input[^{}]*\{\s*min-height: 44px;/);
  });

  it('主题切换即时影响颜色、材质和动画属性，已打开弹层及其草稿保持连续', async () => {
    setup(); fireEvent.click(screen.getByRole('button', { name: '更多筛选 1' }));
    fireEvent.change(screen.getByPlaceholderText('可选关键词…'), { target: { value: '未应用草稿' } });
    const panel = screen.getByRole('dialog', { name: '更多筛选' });
    await act(async () => applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, accentColor: '#14b8a6', density: 'compact', corners: 'sharp', surfaces: 'translucent', motion: 'off', fontScale: 'large' }, true));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--nai-accent')).toBe('#14b8a6');
    expect(document.documentElement.dataset).toMatchObject({ density: 'compact', corners: 'sharp', surfaces: 'translucent', motion: 'off', fontScale: 'large' });
    expect(screen.getByRole('dialog', { name: '更多筛选' })).toBe(panel);
    expect(panel.classList.contains('appearance-panel')).toBe(true);
    expect((screen.getByPlaceholderText('可选关键词…') as HTMLInputElement).value).toBe('未应用草稿');
    expect(appCss).toContain('--color-indigo-500: var(--nai-accent)');
    expect(appCss).toMatch(/\.appearance-panel\s*\{[^}]*background-color: var\(--nai-panel-surface\)/);
    expect(appCss).toMatch(/html\[data-surfaces='translucent'\][^{}]*\.appearance-panel\s*\{[^}]*backdrop-filter:/);
    expect(appCss).toMatch(/html\[data-motion='off'\][^{}]*\{[^}]*transition-duration: 0\.01ms !important;/);
  });

  it('放大字号后按同等 rem 阈值收纳日期，顶栏保持单行，剩余条件仍可达', async () => {
    workWidth = 720; setup();
    expect(screen.getByRole('button', { name: '时间范围：全部时间' })).toBeTruthy();
    // jsdom 不布局 Tailwind；用编译样式中的实际字号模拟根字号变更。
    const largeFont = property(rule(generatedCss, "html[data-font-scale='large']"), 'font-size');
    await act(async () => { document.documentElement.style.fontSize = largeFont; });
    expect(screen.queryByRole('button', { name: /^时间范围：/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多筛选 1' }));
    expect(screen.getByLabelText('开始日期')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '历史模型' })).toBeTruthy();
    expect(rule(toolbarCss, '.history-browse-controls')).toContain('white-space: nowrap');
    expect(toolbarCss).not.toContain('flex-wrap: wrap');
  });

  it('大图、详情、分享和操作窗口使用主题颜色、圆角与相对字号，固定外框保持原尺度', () => {
    expect(viewerCss).not.toMatch(/#[\da-f]{3,8}\b/i);
    for (const size of viewerCss.matchAll(/font-size:\s*([^;]+)/g)) expect(size[1]).toMatch(/rem$/);
    expect(viewerCss).toContain('border-radius: var(--radius-xl)');
    expect(viewerCss).toContain('outline: 2px solid var(--color-indigo-500)');
    expect(viewerCss).toContain('.history-viewer-share button');
    expect(viewerCss).toContain('--viewer-surface: var(--nai-panel-surface');
    expect(dialogCss).toContain('border-radius: var(--radius-2xl)');
    expect(dialogCss).toContain('height: var(--workspace-toolbar-height)');
    expect(dialogCss).toContain('width: min(1120px');
    expect(dialogCss).toContain('height: min(760px');
    expect(appCss).toContain('border-radius: var(--radius-2xl) var(--radius-2xl) 0 0');
  });
});
