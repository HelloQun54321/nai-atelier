// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type ChangeListener = (event: { matches: boolean }) => void;

/** 手机端不渲染把手，所以断点切换必须同时翻转「是否收起」并广播给订阅者。 */
const stubViewport = (initial: boolean) => {
  const listeners = new Set<ChangeListener>();
  const query = {
    media: '(max-width: 1023px)',
    matches: initial,
    onchange: null,
    addEventListener: (_type: string, listener: ChangeListener) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: ChangeListener) => { listeners.delete(listener); },
    addListener: (listener: ChangeListener) => { listeners.add(listener); },
    removeListener: (listener: ChangeListener) => { listeners.delete(listener); },
    dispatchEvent: () => false,
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    resize(next: boolean) {
      query.matches = next;
      listeners.forEach(listener => listener({ matches: next }));
    },
  };
};

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('手机视口没有把手，收起状态不生效但选择保留，回到宽屏立即恢复', async () => {
  const viewport = stubViewport(true);
  vi.resetModules();
  const topbar = await import('../../services/workspaceTopbar');
  expect(topbar.getTopbarCollapsed()).toBe(false);
  // 手机上即便存了收起，也按展开处理，不会出现顶栏消失却没有恢复入口。
  topbar.setTopbarCollapsed(true);
  expect(localStorage.getItem('nai_workspace_topbar_collapsed')).toBe('true');
  expect(topbar.getTopbarCollapsed()).toBe(false);
  // 跨回宽屏后沿用用户此前的选择，把手照常出现。
  viewport.resize(false);
  expect(topbar.getTopbarCollapsed()).toBe(true);
  topbar.setTopbarCollapsed(false);
  expect(topbar.getTopbarCollapsed()).toBe(false);
});

it('宽屏收起后缩到手机宽度自动展开，再拉宽回到收起', async () => {
  const viewport = stubViewport(false);
  vi.resetModules();
  const topbar = await import('../../services/workspaceTopbar');
  topbar.setTopbarCollapsed(true);
  expect(topbar.getTopbarCollapsed()).toBe(true);
  viewport.resize(true);
  expect(topbar.getTopbarCollapsed()).toBe(false);
  viewport.resize(false);
  expect(topbar.getTopbarCollapsed()).toBe(true);
  // 手机状态下写入展开同样落到存储，两个方向都不算空操作。
  viewport.resize(true);
  topbar.setTopbarCollapsed(false);
  expect(localStorage.getItem('nai_workspace_topbar_collapsed')).toBe('false');
});
