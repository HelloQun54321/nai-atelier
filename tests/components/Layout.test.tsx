// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Layout } from '../../components/Layout';

vi.mock('../../services/anlasBudget', () => ({ useAnlasBudget: () => ({}) }));
vi.mock('../../services/naiUsage', () => ({ useNovelaiUsage: () => ({}) }));
vi.mock('../../components/AnlasBalanceBar', () => ({ AnlasBalanceBar: () => null }));
vi.mock('../../components/OpusUsageBar', () => ({ OpusUsageBar: () => null }));
vi.mock('../../components/CloudQueueStatus', () => ({ CloudQueueStatus: () => null }));

const createProps = (activeView = 'list') => ({
  children: <div>workspace</div>, onNavigate: vi.fn(), currentView: activeView, activeView,
  isDark: false, themeMode: 'light' as const, setThemeMode: vi.fn(), appearancePreferences: {} as any, setAppearancePreferences: vi.fn(),
  safeMode: false, safeModeStartup: false, safeModeHideTitles: false, setSafeModeStartup: vi.fn(), setSafeModeHideTitles: vi.fn(),
  toggleSafeMode: vi.fn(), notify: vi.fn(), onOpenAgent: vi.fn(),
});
const renderLayout = (activeView = 'list') => render(<div className="agent-stage"><Layout {...createProps(activeView)} /></div>);
const getSidebar = (container: HTMLElement) => container.querySelector('.app-sidebar') as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('innerWidth', 1024);
  vi.stubGlobal('innerHeight', 768);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.classList.remove('agent-panel-docked'); });

it('桌面助手打开后中间栏达到 560px 即保持并排，缩窄和再拉宽同步恢复', () => {
  localStorage.setItem('nai_sidebar_collapsed', 'true');
  document.documentElement.classList.add('agent-panel-docked');
  let availableWidth = 1180;
  let resizeWorkspace = () => {};
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('workspace-container') ? availableWidth : 0;
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe(element: HTMLElement) { if (element.classList.contains('workspace-container')) resizeWorkspace = this.callback; }
    disconnect() {}
  });
  const { container, rerender } = renderLayout('playground');
  const workspace = container.querySelector('.workspace-container')!;
  for (const width of [1180, 1000, 766, 680, 560, 559, 450, 560, 1000]) {
    availableWidth = width;
    act(() => resizeWorkspace());
    expect(workspace.classList.contains('workspace-editor-compact'), `剩余 ${width}px`).toBe(width < 560);
  }
  availableWidth = 680;
  rerender(<div className="agent-stage"><Layout {...createProps('edit')} /></div>);
  expect(workspace.classList.contains('workspace-editor-compact')).toBe(false);
  document.documentElement.classList.remove('agent-panel-docked');
  availableWidth = 450;
  act(() => resizeWorkspace());
  expect(workspace.classList.contains('workspace-editor-compact')).toBe(false);
});

it('素材浏览分组默认收起，手动展开状态跨Layout重挂载保存', () => {
  const first = renderLayout();
  const sidebar = getSidebar(first.container);
  const group = within(sidebar).getByRole('button', { name: '素材浏览' });
  expect(group.getAttribute('aria-expanded')).toBe('false');
  expect(group.getAttribute('aria-controls')).toBe('external-gallery-links');
  expect(within(sidebar).queryByRole('button', { name: 'AITag' })).toBeNull();
  fireEvent.click(group);
  expect(localStorage.getItem('nai_sidebar_external_gallery_expanded')).toBe('true');
  expect(within(sidebar).getByRole('button', { name: 'AITag' })).toBeTruthy();
  first.unmount();

  const secondProps = createProps();
  const second = render(<div className="agent-stage"><Layout {...secondProps} /></div>);
  const secondSidebar = getSidebar(second.container);
  expect(within(secondSidebar).getByRole('button', { name: 'Pixiv' })).toBeTruthy();
  second.rerender(<div className="agent-stage"><Layout {...createProps('pixiv')} /></div>);
  expect(within(secondSidebar).getByRole('button', { name: '素材浏览：Pixiv' }).getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(within(secondSidebar).getByRole('button', { name: '素材浏览：Pixiv' }));
  second.rerender(<div className="agent-stage"><Layout {...createProps('aitag')} /></div>);
  const collapsedGroup = within(secondSidebar).getByRole('button', { name: '素材浏览：AITag' });
  expect(collapsedGroup.getAttribute('aria-expanded')).toBe('false');
  expect(collapsedGroup.querySelector('.text-micro')?.textContent).toBe('AITag');
  expect(localStorage.getItem('nai_sidebar_external_gallery_expanded')).toBe('false');
});

it('记录组提供创作足迹独立入口并标为当前页', () => {
  const props = createProps('footprint');
  const { container } = render(<div className="agent-stage"><Layout {...props} /></div>);
  const item = within(getSidebar(container)).getByRole('button', { name: '创作足迹' });
  expect(item.getAttribute('aria-current')).toBe('page');
  fireEvent.click(item);
  expect(props.onNavigate).toHaveBeenCalledWith('footprint');
});

it.each([
  ['AITag', 'aitag'], ['法典', 'codex'], ['Danbooru', 'danbooru'], ['Pixiv', 'pixiv'],
] as const)('%s 仍可从展开分组导航并标为当前页', (label, view) => {
  localStorage.setItem('nai_sidebar_external_gallery_expanded', 'true');
  const props = createProps(view);
  const { container } = render(<div className="agent-stage"><Layout {...props} /></div>);
  const sidebar = getSidebar(container);
  const item = within(sidebar).getByRole('button', { name: label });
  expect(item.getAttribute('aria-current')).toBe('page');
  fireEvent.click(item);
  expect(props.onNavigate).toHaveBeenCalledWith(view);
});

it.each([
  ['AITag', 'aitag'], ['法典', 'codex'], ['Danbooru', 'danbooru'], ['Pixiv', 'pixiv'],
] as const)('收起侧栏后仍可从素材浏览菜单导航到%s', async (label, view) => {
  localStorage.setItem('nai_sidebar_collapsed', 'true');
  const props = createProps('list');
  props.onNavigate.mockImplementation(() => { expect(screen.queryByRole('dialog', { name: '素材浏览' })).toBeNull(); });
  const { container } = render(<div className="agent-stage"><Layout {...props} /></div>);
  const sidebar = getSidebar(container);
  fireEvent.click(within(sidebar).getByRole('button', { name: '素材浏览' }));
  const dialog = await screen.findByRole('dialog', { name: '素材浏览' });
  fireEvent.click(within(dialog).getByRole('button', { name: label }));
  await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith(view));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '素材浏览' })).toBeNull());
});

it('收起分组时父项仍显示来源选中态和当前位置小字', () => {
  const { container } = renderLayout('pixiv');
  const parent = within(getSidebar(container)).getByRole('button', { name: '素材浏览：Pixiv' });
  expect(parent.getAttribute('aria-current')).toBe('location');
  expect(parent.querySelector('.text-micro')?.textContent).toBe('Pixiv');
  expect(parent.getAttribute('aria-expanded')).toBe('false');
});

it('整体折叠后图标打开Portal来源菜单，Escape关闭并归还焦点', async () => {
  localStorage.setItem('nai_sidebar_collapsed', 'true');
  const { container } = renderLayout('codex');
  const sidebar = getSidebar(container);
  const trigger = within(sidebar).getByRole('button', { name: '素材浏览：法典' });
  expect(trigger.querySelector('svg rect[x="8"][y="2"]')).toBeTruthy();
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 230, width: 68, height: 44, left: 0, right: 68, top: 230, bottom: 274, toJSON() {} });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: '素材浏览' });
  expect(dialog.style.width).toBe('176px');
  expect(trigger.getAttribute('aria-controls')).toBe('external-gallery-popover');
  expect(dialog.parentElement?.className).toContain('agent-stage');
  const activeSource = within(dialog).getByRole('button', { name: '法典' });
  expect(activeSource.getAttribute('aria-current')).toBe('page');
  expect(activeSource.className).toContain('h-8');
  expect(activeSource.className).toContain('[@media(any-pointer:coarse)]:min-h-11');
  expect(activeSource.className).toContain('px-2');
  expect(activeSource.querySelector('svg')?.classList.contains('h-4')).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '素材浏览' })).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

it('折叠菜单点外关闭，展开侧栏或切到手机断点也关闭且不改分组偏好', async () => {
  localStorage.setItem('nai_sidebar_collapsed', 'true');
  localStorage.setItem('nai_sidebar_external_gallery_expanded', 'true');
  const { container } = renderLayout('aitag');
  const sidebar = getSidebar(container);
  const trigger = within(sidebar).getByRole('button', { name: '素材浏览：AITag' });
  fireEvent.click(trigger);
  expect(await screen.findByRole('dialog', { name: '素材浏览' })).toBeTruthy();
  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '素材浏览' })).toBeNull());

  fireEvent.click(trigger); expect(await screen.findByRole('dialog', { name: '素材浏览' })).toBeTruthy();
  fireEvent.click(within(sidebar).getAllByRole('button', { name: '展开侧边栏' })[0]);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '素材浏览' })).toBeNull());
  expect(localStorage.getItem('nai_sidebar_external_gallery_expanded')).toBe('true');

  fireEvent.click(within(sidebar).getByRole('button', { name: '折叠侧边栏' }));
  const collapsedBrowse = within(sidebar).getByRole('button', { name: '素材浏览：AITag' });
  fireEvent.click(collapsedBrowse);
  expect(await screen.findByRole('dialog', { name: '素材浏览' })).toBeTruthy();
  vi.stubGlobal('innerWidth', 390); fireEvent(window, new Event('resize'));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '素材浏览' })).toBeNull());
  expect(localStorage.getItem('nai_sidebar_external_gallery_expanded')).toBe('true');
});

it('手机底栏仍是五个入口，资源面板可达提示词库与原有资源', () => {
  vi.stubGlobal('innerWidth', 390);
  const { container } = renderLayout('list');
  const mobileNav = container.querySelector('.app-mobile-nav') as HTMLElement;
  expect(within(mobileNav).getAllByRole('button')).toHaveLength(5);
  fireEvent.click(within(mobileNav).getByRole('button', { name: '资源库' }));
  const resources = screen.getByRole('dialog', { name: '资源库菜单' });
  expect(within(resources).getAllByRole('button')).toHaveLength(10); // 九个入口与关闭按钮。
  expect(within(resources).getByRole('button', { name: '提示词库' })).toBeTruthy();
  expect(within(resources).queryByRole('button', { name: '一键 Roll' })).toBeNull();
  expect(within(resources).queryByRole('button', { name: 'Roll 提示词库' })).toBeNull();
  expect(within(resources).getByRole('button', { name: 'Roll 串' })).toBeTruthy();
  expect(within(resources).getByRole('button', { name: 'AITag' })).toBeTruthy();
});
