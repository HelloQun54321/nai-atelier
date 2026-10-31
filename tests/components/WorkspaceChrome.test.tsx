// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { WorkspaceChrome, WorkspaceToolbar } from '../../components/DesignSystem';
import { getTopbarCollapsed, setTopbarCollapsed } from '../../services/workspaceTopbar';

let height = 72;
const callbacks = new Set<() => void>();
const disconnect = vi.fn();
beforeEach(() => {
  height = 72;
  callbacks.clear();
  disconnect.mockClear();
  localStorage.clear();
  setTopbarCollapsed(false);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('workspace-chrome') ? height : 0;
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) { callbacks.add(callback); }
    observe() {}
    disconnect() { callbacks.delete(this.callback); disconnect(); }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('首屏与状态行换行使用同一实际高度，隐藏缓存页不会清空高度', () => {
  const { getByTestId } = render(<div data-testid="host"><WorkspaceChrome><header>工具栏</header><p>状态行</p></WorkspaceChrome><main>作品</main></div>);
  const host = getByTestId('host');
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('72px');
  height = 116;
  act(() => callbacks.forEach(callback => callback()));
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('116px');
  height = 0;
  act(() => callbacks.forEach(callback => callback()));
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('116px');
  height = 80;
  act(() => callbacks.forEach(callback => callback()));
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('80px');
});

it('共用把手收起顶栏：内容隐藏、高度归零、方向与状态持久化', () => {
  const { getByTestId, getByRole } = render(<div data-testid="host"><WorkspaceChrome><header>工具栏</header><p>状态行</p></WorkspaceChrome><main>作品</main></div>);
  const host = getByTestId('host');
  const collapse = getByRole('button', { name: '收起顶栏' });
  const headerBefore = host.querySelector('header');
  expect(collapse.getAttribute('aria-expanded')).toBe('true');
  expect(host.textContent).toContain('工具栏');
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('72px');
  // 静止态不给隐藏文案留 gap；底色与顶栏共用 toolbar surface；展开指上、收起后指下。
  expect(collapse.className).toContain('leading-none');
  expect(collapse.className).toContain('bg-[var(--nai-toolbar-surface)]');
  expect(collapse.className).toContain('backdrop-blur-[18px]');
  expect(collapse.className).not.toMatch(/(?:^|\s)gap-1(?:\s|$)/);
  expect(collapse.querySelector('svg.lucide-chevron-up')).toBeTruthy();
  expect(collapse.querySelector('svg.lucide-chevron-down')).toBeNull();
  expect(collapse.querySelector('span:not([aria-hidden])')?.className).toContain('group-hover:ml-1');

  fireEvent.click(collapse);
  expect(getTopbarCollapsed()).toBe(true);
  expect(localStorage.getItem('nai_workspace_topbar_collapsed')).toBe('true');
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('0px');
  // 子树保留在 DOM 中供实验室三分区继续测量，只做视觉隐藏。
  const hiddenWrapper = host.querySelector<HTMLElement>('.workspace-chrome > .hidden');
  expect(hiddenWrapper?.textContent).toContain('工具栏');
  expect(hiddenWrapper?.textContent).toContain('状态行');
  // 顶栏节点保持同一身份：实验室三分区依赖它重新测量底板。
  expect(hiddenWrapper?.querySelector('header')).toBe(headerBefore);
  const expand = getByRole('button', { name: '展开顶栏' });
  expect(expand.getAttribute('aria-expanded')).toBe('false');
  expect(expand.querySelector('svg.lucide-chevron-down')).toBeTruthy();
  expect(expand.querySelector('svg.lucide-chevron-up')).toBeNull();

  fireEvent.click(expand);
  expect(getTopbarCollapsed()).toBe(false);
  expect(localStorage.getItem('nai_workspace_topbar_collapsed')).toBe('false');
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('72px');
  expect(host.textContent).toContain('工具栏');
  expect(host.querySelector('header')).toBe(headerBefore);
});

it('业务输入和操作独立于收起把手，折叠往返保留同一子树及输入状态', () => {
  const applied = vi.fn();
  const { getByRole, getByLabelText } = render(<div><WorkspaceChrome><header><input aria-label="来源搜索" defaultValue="旧值" /><button onClick={applied}>选取来源</button></header><p>状态</p></WorkspaceChrome></div>);
  const input = getByLabelText('来源搜索') as HTMLInputElement;
  const action = getByRole('button', { name: '选取来源' });
  fireEvent.change(input, { target: { value: '当前草稿' } });
  fireEvent.click(action);
  expect(applied).toHaveBeenCalledOnce();
  expect(getTopbarCollapsed()).toBe(false);
  fireEvent.click(getByRole('button', { name: '收起顶栏' }));
  expect(getByLabelText('来源搜索')).toBe(input);
  fireEvent.click(getByRole('button', { name: '展开顶栏' }));
  expect(getByRole('button', { name: '选取来源' })).toBe(action);
  expect(input.value).toBe('当前草稿');
  fireEvent.click(action);
  expect(applied).toHaveBeenCalledTimes(2);
  expect(getTopbarCollapsed()).toBe(false);
});

it('同时挂载的多个页面顶栏共用同一收起状态', () => {
  const { container } = render(<div><div data-testid="a"><WorkspaceChrome><header>页面 A</header></WorkspaceChrome></div><div data-testid="b"><WorkspaceChrome><header>页面 B</header></WorkspaceChrome></div></div>);
  const toggles = container.querySelectorAll('[data-workspace-topbar-toggle]');
  expect(toggles).toHaveLength(2);
  fireEvent.click(toggles[0]);
  expect(container.querySelectorAll('.workspace-chrome > .hidden')).toHaveLength(2);
  expect(container.querySelectorAll('[aria-label="展开顶栏"]')).toHaveLength(2);
});

it('卸载清理观察器并恢复宿主已有的高度值', () => {
  const style = { '--workspace-chrome-height': '40px' } as React.CSSProperties;
  const { getByTestId, rerender } = render(<div data-testid="host" style={style}><WorkspaceChrome><header>顶栏</header></WorkspaceChrome></div>);
  const host = getByTestId('host');
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('72px');
  rerender(<div data-testid="host" style={style} />);
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('40px');
  expect(disconnect).toHaveBeenCalledOnce();
});

it('手机顶栏放不下时整排横向滑动，按真实滚动位置只在仍有控件的一侧淡出', () => {
  let scrollWidth = 520;
  const clientWidth = 307;
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('workspace-toolbar-scroll') ? scrollWidth : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('workspace-toolbar-scroll') ? clientWidth : 0; });
  const { container } = render(<WorkspaceChrome><WorkspaceToolbar><button type="button">文件夹</button><input type="search" aria-label="搜索" /><button type="button">新建风格串</button></WorkspaceToolbar></WorkspaceChrome>);
  const scroller = container.querySelector<HTMLElement>('header > .workspace-toolbar-scroll')!;
  // 控件仍在同一排，电脑端此层用 contents 不改变原布局。
  expect(scroller.className).toContain('md:contents');
  expect(Array.from(scroller.children).map(child => child.textContent || child.getAttribute('aria-label'))).toEqual(['文件夹', '搜索', '新建风格串']);
  expect([scroller.hasAttribute('data-overflow-start'), scroller.hasAttribute('data-overflow-end')]).toEqual([false, true]);
  scroller.scrollLeft = 100; fireEvent.scroll(scroller);
  expect([scroller.hasAttribute('data-overflow-start'), scroller.hasAttribute('data-overflow-end')]).toEqual([true, true]);
  scroller.scrollLeft = scrollWidth - clientWidth; fireEvent.scroll(scroller);
  expect([scroller.hasAttribute('data-overflow-start'), scroller.hasAttribute('data-overflow-end')]).toEqual([true, false]);
  // 放得下（或跨到电脑断点）时不再标记，避免最后一个按钮被淡出。
  scrollWidth = 300; scroller.scrollLeft = 0; fireEvent(window, new Event('resize'));
  expect([scroller.hasAttribute('data-overflow-start'), scroller.hasAttribute('data-overflow-end')]).toEqual([false, false]);
});

it('自带窄屏排布的顶栏可关闭横滑，子元素仍是顶栏的直接子级', () => {
  const { container } = render(<WorkspaceToolbar scrollable={false} className="content-library-toolbar"><div role="tablist">范围</div></WorkspaceToolbar>);
  expect(container.querySelector('.workspace-toolbar-scroll')).toBeNull();
  expect(container.querySelector('header.content-library-toolbar > [role="tablist"]')).not.toBeNull();
});

it('手机把手与顶栏第一排控件垂直居中，横滑只在手机断点生效且搜索框保底宽度', () => {
  const css = readFileSync('index.css', 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 767px) {'));
  expect(mobile).toContain(".workspace-chrome > [data-workspace-topbar-toggle][aria-expanded='true'] { margin-top: calc(env(safe-area-inset-top) + (var(--workspace-toolbar-height) - 2.75rem) / 2); }");
  expect(mobile).toContain(".content-library > .workspace-chrome > [data-workspace-topbar-toggle][aria-expanded='true'] { align-self: center; margin-top: 0; }");
  expect(mobile).toMatch(/\.workspace-toolbar-scroll \{ overflow-x: auto; overflow-y: hidden;/);
  expect(css.slice(0, css.indexOf('@media (max-width: 767px) {'))).not.toContain('.workspace-toolbar-scroll');
  // 曾因搜索框被压到 0～16px、输入框溢出盖住筛选按钮而出现双层边框。
  for (const file of ['components/ChainList.tsx', 'components/InspirationGallery.tsx', 'components/CharacterLibrary.tsx']) expect(readFileSync(file, 'utf8'), file).toContain('max-md:min-w-[8.75rem]');
  expect(readFileSync('components/ContentLibraryPage.tsx', 'utf8')).toContain('<WorkspaceToolbar scrollable={false}');
});

it('收起后把手层级高于实验室分区条，手机分区条让出把手宽度', () => {
  // 曾因顶栏与分区条同为 z-30、分区条在后，收起后把手被「全局」盖住，顶栏再也展开不了。
  const { container } = render(<div><WorkspaceChrome><header>顶栏</header></WorkspaceChrome><nav className="workspace-mode-tabs relative z-30">分区</nav></div>);
  const chrome = container.querySelector('.workspace-chrome')!;
  expect(chrome.classList.contains('z-30')).toBe(true);
  fireEvent.click(container.querySelector('[data-workspace-topbar-toggle]')!);
  expect(chrome.classList.contains('z-[31]')).toBe(true);
  expect(chrome.classList.contains('z-30')).toBe(false);
  const css = readFileSync('index.css', 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 767px) {'));
  expect(mobile).toContain("html:root .chain-editor-workspace .workspace-mode-tabs[data-topbar-collapsed='true'] { margin-left: 2.75rem; }");
});
