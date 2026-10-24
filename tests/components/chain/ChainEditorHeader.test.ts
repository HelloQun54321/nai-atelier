// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorHeader } from '../../../components/chain/ChainEditorHeader';

let workWidth: number;
let observers: Set<{ callback: ResizeObserverCallback; element?: HTMLElement }>;
const resizeWorkspace = (width: number, viewport = window.innerWidth) => act(() => {
  workWidth = width;
  vi.stubGlobal('innerWidth', viewport);
  document.querySelectorAll('.workspace-container').forEach(workspace => workspace.classList.toggle('workspace-editor-compact', width < 560));
  for (const observer of observers) if (observer.element) {
    observer.callback([{
      target: observer.element,
      contentRect: observer.element.getBoundingClientRect(),
      borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [],
    }], {} as ResizeObserver);
  }
  window.dispatchEvent(new Event('resize'));
});

beforeEach(() => {
  workWidth = 1400;
  observers = new Set();
  vi.stubGlobal('innerWidth', 1600);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains('chain-editor-header') ? workWidth : 0;
    return { x: 0, y: 0, left: 0, right: width, top: 0, bottom: 56, width, height: 56, toJSON: () => ({}) };
  });
  vi.stubGlobal('ResizeObserver', class {
    item: { callback: ResizeObserverCallback; element?: HTMLElement };
    constructor(callback: ResizeObserverCallback) { this.item = { callback }; observers.add(this.item); }
    observe(element: HTMLElement) { if (element.classList.contains('chain-editor-header')) this.item.element = element; }
    disconnect() { observers.delete(this.item); }
  });
  // jsdom 未实现 matchMedia；桩为不匹配使 useMobileHistoryLayer 走无副作用的早退分支
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('font-size');
});

const renderHeader = (props: Partial<Parameters<typeof ChainEditorHeader>[0]> = {}) => {
  const element = React.createElement(ChainEditorHeader, {
  chainId: 'playground',
  isCharacterMode: false,
  isOwner: true,
  isGuest: false,
  canEdit: true,
  canSaveActiveModeToLibrary: true,
  canSaveCurrentChain: true,
  isUploading: false,
  hasChanges: false,
  hasPendingPreviewCover: false,
  tagAssistEnabled: false,
  onTagAssistEnabledChange: vi.fn(),
  activeGenerationMode: 'text-to-image',
  selectGenerationMode: vi.fn(),
  onBack: vi.fn(),
  handleReset: vi.fn(),
  handleFork: vi.fn(),
  handleSaveAll: vi.fn(),
  handleImportImage: vi.fn(),
  onTranslateMissingPrompts: vi.fn(),
  notify: vi.fn(),
  ...props,
  });
  const shell = (content: React.ReactNode) => React.createElement('div', { className: 'agent-stage safe-mode dark' },
    React.createElement('aside', { className: 'relative z-40' }, '侧边栏'),
    React.createElement('main', { className: `workspace-container isolate overflow-hidden ${workWidth < 560 ? 'workspace-editor-compact' : ''}` }, content),
  );
  const view = render(shell(element));
  return { ...view, rerenderHeader: (next: Partial<Parameters<typeof ChainEditorHeader>[0]>) => view.rerender(shell(React.createElement(ChainEditorHeader, { ...element.props, ...next }))) };
};

describe('ChainEditorHeader 工具栏', () => {
  it('右上角图标切换编辑方式，保持无文字并同步外部偏好，随机槽位紧邻', () => {
    const change = vi.fn(), slot = vi.fn();
    const view = renderHeader({ onPromptClassificationEnabledChange: change, onPromptToolbarSlotChange: slot });
    expect(view.queryByRole('tablist', { name: '提示词编辑方式' })).toBeNull();
    const toggle = view.getByRole('button', { name: '切换为分类编辑' });
    expect(toggle.textContent).toBe('');
    expect(toggle.querySelector('.lucide-text-align-start')).not.toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.closest('.chain-editor-actions')).not.toBeNull();
    expect(slot.mock.lastCall?.[0]?.element).toBe(toggle.nextElementSibling);
    fireEvent.click(toggle); expect(change).toHaveBeenLastCalledWith(true);
    view.rerenderHeader({ promptClassificationEnabled: true });
    const classified = view.getByRole('button', { name: '切换为整段编辑' });
    expect(classified.querySelector('.lucide-list-tree')).not.toBeNull();
    expect(classified.textContent).toBe('');
    expect(classified.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(classified); expect(change).toHaveBeenLastCalledWith(false);
  });
  it('窄屏编辑方式沿用独占一行的文字操作，随机槽位也使用菜单行，关闭后释放槽位', () => {
    workWidth = 390; vi.stubGlobal('innerWidth', 390);
    const slot = vi.fn(), change = vi.fn();
    renderHeader({ promptClassificationEnabled: true, onPromptClassificationEnabledChange: change, onPromptToolbarSlotChange: slot });
    expect(screen.queryByRole('button', { name: '切换为整段编辑' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const dialog = screen.getByRole('dialog', { name: '更多操作' });
    const toggle = within(dialog).getByRole('button', { name: /^切换为整段编辑/ });
    expect(toggle.textContent).toContain('切换为整段编辑');
    expect(toggle.classList.contains('w-full')).toBe(true);
    expect(slot.mock.lastCall?.[0]?.variant).toBe('menu');
    expect(slot.mock.lastCall?.[0]?.element).toBe(toggle.nextElementSibling);
    fireEvent.click(toggle); expect(change).toHaveBeenLastCalledWith(false);
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog', { name: '更多操作' })).toBeNull();
    expect(slot.mock.lastCall?.[0]).toBeNull();
  });
  it('桌面宽栏直接显示动作，手机收纳且模式导航与更多保持同一行', () => {
    const { container, getByRole } = renderHeader();
    const actions = container.querySelector('.chain-editor-actions') as HTMLElement;
    expect(actions).toBeTruthy();
    expect(actions.classList.contains('flex')).toBe(true);
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
    expect(container.querySelector('header')?.classList.contains('grid-cols-2')).toBe(true);
    resizeWorkspace(390, 390);
    expect(container.querySelector('.chain-editor-actions')).toBeNull();
    const moreButton = getByRole('button', { name: '更多操作' });
    expect(moreButton.closest('.chain-editor-header-main')?.contains(getByRole('navigation', { name: '生成模式' }))).toBe(true);
    expect(container.querySelector('header')?.classList.contains('grid-cols-1')).toBe(true);
  });

  it('更多按钮弹出底部操作面板，收齐全部低频动作，点击后关闭', () => {
    workWidth = 390; vi.stubGlobal('innerWidth', 390);
    const handleReset = vi.fn();
    const { getByRole, queryByRole } = renderHeader({ handleReset });

    fireEvent.click(getByRole('button', { name: '更多操作' }));
    const dialog = getByRole('dialog', { name: '更多操作' });
    expect(dialog.closest('main')).toBeNull();
    expect(dialog.closest('.mobile-layer')?.parentElement).toBe(dialog.closest('.agent-stage'));
    expect(dialog.closest('.safe-mode.dark')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '导入图片或 JSON 配置' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '翻译所有未翻译提示词' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: '图片反推 Tag' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: /^Tag 辅助/ })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '重置当前模式' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '保存到库' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: '重置当前模式' }));
    expect(handleReset).toHaveBeenCalledOnce();
    expect(queryByRole('dialog', { name: '更多操作' })).toBeNull();
  });

  it('Tag 辅助在面板内切换状态并回调通知', () => {
    workWidth = 390; vi.stubGlobal('innerWidth', 390);
    const onTagAssistEnabledChange = vi.fn();
    const notify = vi.fn();
    const { getByRole } = renderHeader({ tagAssistEnabled: false, onTagAssistEnabledChange, notify });

    fireEvent.click(getByRole('button', { name: '更多操作' }));
    fireEvent.click(within(getByRole('dialog', { name: '更多操作' })).getByRole('button', { name: /^Tag 辅助/ }));
    expect(onTagAssistEnabledChange).toHaveBeenCalledWith(true);
    expect(notify).toHaveBeenCalledWith('Tag 辅助已开启');
  });

  it.each([false, true])('两种资料入口和自由实验室共用工具顺序，角色模式=%s', isCharacterMode => {
    const onTranslateMissingPrompts = vi.fn(); const handleReset = vi.fn();
    const { container } = renderHeader({ chainId: 'asset-1', isCharacterMode, hasChanges: true, onTranslateMissingPrompts, handleReset });
    const actions = container.querySelector('.chain-editor-actions') as HTMLElement;
    expect(within(actions).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
      '导入图片或 JSON 配置', '翻译所有未翻译提示词', '开启 Tag 辅助', '重置当前模式', isCharacterMode ? '保存自定义角色' : '保存风格串',
    ]);
    fireEvent.click(within(actions).getByRole('button', { name: '翻译所有未翻译提示词' }));
    expect(onTranslateMissingPrompts).toHaveBeenCalledOnce();
    fireEvent.click(within(actions).getByRole('button', { name: '重置当前模式' }));
    expect(handleReset).toHaveBeenCalledOnce();
    resizeWorkspace(550);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const more = screen.getByRole('dialog', { name: '更多操作' });
    expect(within(more).getAllByRole('button').map(button => button.textContent?.trim()).filter(Boolean)).toEqual([
      '导入图片或 JSON 配置', '翻译所有未翻译提示词', 'Tag 辅助已关闭', '重置当前模式',
    ]);
    fireEvent.click(within(more).getByRole('button', { name: '翻译所有未翻译提示词' }));
    expect(onTranslateMissingPrompts).toHaveBeenCalledTimes(2);
  });

  it.each([390, 1280])('保存菜单区分修改原串与另存新串，宽度=%s', width => {
    workWidth = width;
    vi.stubGlobal('innerWidth', width);
    const handleSaveAll = vi.fn(); const handleFork = vi.fn();
    renderHeader({ chainId: 'asset-1', hasChanges: true, handleSaveAll, handleFork });
    const save = screen.getByRole('button', { name: '保存风格串' });
    fireEvent.click(save);
    let dialog = screen.getByRole('dialog', { name: '保存风格串' });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存修改' }));
    expect(handleSaveAll).toHaveBeenCalledOnce();
    expect(handleFork).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(save);
    dialog = screen.getByRole('dialog', { name: '保存风格串' });
    fireEvent.click(within(dialog).getByRole('button', { name: '另存为新串' }));
    expect(handleFork).toHaveBeenCalledOnce();
    expect(handleSaveAll).toHaveBeenCalledOnce();
  });

  it('未修改时保存图标为中性，仍允许另存；切入编辑模式撤掉保存菜单', () => {
    const props = { chainId: 'asset-1', canSaveCurrentChain: false };
    const view = renderHeader(props);
    const save = within(view.container.querySelector('.chain-editor-actions') as HTMLElement).getByRole('button', { name: '保存风格串' });
    expect(save.className).not.toContain('!bg-emerald-50');
    expect(save.className).not.toContain('bg-indigo-600');
    fireEvent.click(save);
    const dialog = screen.getByRole('dialog', { name: '保存风格串' });
    expect((within(dialog).getByRole('button', { name: '已保存' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole('button', { name: '另存为新串' }) as HTMLButtonElement).disabled).toBe(false);
    view.rerenderHeader({ activeGenerationMode: 'inpaint', canSaveActiveModeToLibrary: false });
    expect(screen.queryByRole('button', { name: /保存风格串|保存到库|另存为新串/ })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('上传状态和访客权限禁用保存', () => {
    const view = renderHeader({ chainId: 'asset-1', isUploading: true });
    screen.getAllByRole('button', { name: '正在保存' }).forEach(button => expect((button as HTMLButtonElement).disabled).toBe(true));
    view.unmount();
    renderHeader({ chainId: 'asset-1', isOwner: false, isGuest: true, canEdit: false });
    expect(screen.queryByRole('button', { name: /另存为新串|保存风格串|导入/ })).toBeNull();
  });

  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('模式 %s 的顶栏跟随预览分栏，只有纵排时整组动作进入锚定菜单', activeGenerationMode => {
    const handleFork = vi.fn();
    const view = renderHeader({ activeGenerationMode, handleFork });
    expect(view.container.querySelector('.chain-editor-actions')).toBeTruthy();
    resizeWorkspace(1180);
    expect(window.innerWidth).toBe(1600);
    expect(view.container.querySelector('.chain-editor-actions')).toBeTruthy();
    expect(view.container.querySelector('header')?.classList.contains('grid-cols-2')).toBe(true);
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
    resizeWorkspace(560);
    expect(view.container.querySelector('.chain-editor-actions')).toBeTruthy();
    expect(view.container.querySelector('header')?.classList.contains('grid-cols-2')).toBe(true);
    resizeWorkspace(559);
    expect(view.container.querySelector('.chain-editor-actions')).toBeNull();
    expect(view.container.querySelector('header')?.classList.contains('grid-cols-1')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const dialog = screen.getByRole('dialog', { name: '更多操作' });
    expect(dialog.classList.contains('fixed')).toBe(true);
    expect(dialog.closest('.mobile-layer')).toBeNull();
    expect(dialog.closest('main')).toBeNull();
    expect(dialog.closest('.safe-mode.dark')).toBeTruthy();
    expect(within(dialog).getAllByRole('button').map(button => button.textContent?.trim())).toEqual([
      '导入图片或 JSON 配置', '翻译所有未翻译提示词', 'Tag 辅助已关闭', '重置当前模式', '保存到库',
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: '保存到库' }));
    expect(handleFork).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    resizeWorkspace(560);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
    expect(view.container.querySelector('header')?.classList.contains('grid-cols-2')).toBe(true);
    expect(view.container.querySelector('.chain-editor-actions')).toBeTruthy();
  });

  it.each([false, true])('桌面窄栏的预设保存入口仍直接可达并有有效锚点，角色模式=%s', isCharacterMode => {
    workWidth = 550;
    const handleSaveAll = vi.fn();
    renderHeader({ chainId: 'asset-1', isCharacterMode, handleSaveAll, hasChanges: true });
    const save = screen.getByRole('button', { name: isCharacterMode ? '保存自定义角色' : '保存风格串' });
    expect(save.closest('.chain-editor-header-main')).toBeTruthy();
    fireEvent.click(save);
    const dialog = screen.getByRole('dialog', { name: isCharacterMode ? '保存自定义角色' : '保存风格串' });
    expect(dialog.classList.contains('fixed')).toBe(true);
    expect(dialog.style.width).toBe('280px');
    fireEvent.click(within(dialog).getByRole('button', { name: '保存修改' }));
    expect(handleSaveAll).toHaveBeenCalledOnce();
  });

  it('字号不单独改变分栏，桌面切手机或模式切换关闭原菜单', async () => {
    const view = renderHeader();
    document.documentElement.style.fontSize = '20px';
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
    expect(view.container.querySelector('header')?.classList.contains('grid-cols-2')).toBe(true);
    resizeWorkspace(550);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    resizeWorkspace(390, 390);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('dialog').closest('.mobile-layer')).toBeTruthy();
    resizeWorkspace(550, 1600);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    view.rerenderHeader({ activeGenerationMode: 'inpaint', canSaveActiveModeToLibrary: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: '保存到库' })).toBeNull();
  });

  it('Layout 只更新分栏状态时顶栏同步，不依赖独立宽度阈值或窗口 resize', async () => {
    const view = renderHeader();
    const workspace = view.container.querySelector('.workspace-container')!;
    act(() => workspace.classList.add('workspace-editor-compact'));
    await waitFor(() => expect(screen.getByRole('button', { name: '更多操作' })).toBeTruthy());
    expect(view.container.querySelector('header')?.classList.contains('grid-cols-1')).toBe(true);
    act(() => workspace.classList.remove('workspace-editor-compact'));
    await waitFor(() => expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull());
    expect(view.container.querySelector('header')?.classList.contains('grid-cols-2')).toBe(true);
  });
});
