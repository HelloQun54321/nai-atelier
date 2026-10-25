// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceChrome } from '../../components/DesignSystem';
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
  expect(collapse.querySelector('span')?.className).toContain('border-b-[6px]');

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
  expect(expand.querySelector('span')?.className).toContain('border-t-[6px]');

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
