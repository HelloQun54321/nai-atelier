// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorHeader } from './ChainEditorHeader';

beforeEach(() => {
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
  vi.unstubAllGlobals();
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
  setShowImportPreset: vi.fn(),
  setTaggerOpen: vi.fn(),
  notify: vi.fn(),
  ...props,
  });
  const view = render(element);
  return { ...view, rerenderHeader: (next: Partial<Parameters<typeof ChainEditorHeader>[0]>) => view.rerender(React.createElement(ChainEditorHeader, { ...element.props, ...next })) };
};

describe('ChainEditorHeader 工具栏', () => {
  it('桌面操作行移动端隐藏，移动端仅显示更多按钮', () => {
    const { container, getByRole } = renderHeader();
    const actions = container.querySelector('.chain-editor-actions') as HTMLElement;
    expect(actions).toBeTruthy();
    // 移动端整行隐藏（hidden），md 起恢复右对齐工具行；auto 边距绝不能无断点前缀出现在移动端
    // ——grid 项的无前缀 ml-auto 会收缩行宽并钉右，是此前"居中不生效"的根因。
    expect(actions.className).toContain('hidden');
    expect(actions.className).toContain('md:flex');
    expect(actions.className).not.toMatch(/(^|\s)ml-auto(\s|$)/);
    const moreButton = getByRole('button', { name: '更多操作' });
    expect(moreButton.className).toContain('md:hidden');
  });

  it('更多按钮弹出底部操作面板，收齐全部低频动作，点击后关闭', () => {
    const handleReset = vi.fn();
    const { getByRole, queryByRole } = renderHeader({ handleReset });

    fireEvent.click(getByRole('button', { name: '更多操作' }));
    const dialog = getByRole('dialog', { name: '更多操作' });
    expect(within(dialog).getByRole('button', { name: '导入图片或 JSON 配置' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '引用预设' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '图片反推 Tag' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /^Tag 辅助/ })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '重置当前模式' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '保存到库' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: '重置当前模式' }));
    expect(handleReset).toHaveBeenCalledOnce();
    expect(queryByRole('dialog', { name: '更多操作' })).toBeNull();
  });

  it('Tag 辅助在面板内切换状态并回调通知', () => {
    const onTagAssistEnabledChange = vi.fn();
    const notify = vi.fn();
    const { getByRole } = renderHeader({ tagAssistEnabled: false, onTagAssistEnabledChange, notify });

    fireEvent.click(getByRole('button', { name: '更多操作' }));
    fireEvent.click(within(getByRole('dialog', { name: '更多操作' })).getByRole('button', { name: /^Tag 辅助/ }));
    expect(onTagAssistEnabledChange).toHaveBeenCalledWith(true);
    expect(notify).toHaveBeenCalledWith('Tag 辅助已开启');
  });

  it.each([false, true])('两种资料入口和自由实验室共用工具顺序，角色模式=%s', isCharacterMode => {
    const setShowImportPreset = vi.fn(); const setTaggerOpen = vi.fn(); const handleReset = vi.fn();
    const { container } = renderHeader({ chainId: 'asset-1', isCharacterMode, hasChanges: true, setShowImportPreset, setTaggerOpen, handleReset });
    const actions = container.querySelector('.chain-editor-actions') as HTMLElement;
    expect(within(actions).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
      '导入图片或 JSON 配置', '引用预设', '图片反推 Tag', '开启 Tag 辅助', '重置当前模式', isCharacterMode ? '保存自定义角色' : '保存风格串',
    ]);
    fireEvent.click(within(actions).getByRole('button', { name: '引用预设' }));
    expect(setShowImportPreset).toHaveBeenCalledWith(true);
    fireEvent.click(within(actions).getByRole('button', { name: '图片反推 Tag' }));
    expect(setTaggerOpen).toHaveBeenCalledWith(true);
    fireEvent.click(within(actions).getByRole('button', { name: '重置当前模式' }));
    expect(handleReset).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const more = screen.getByRole('dialog', { name: '更多操作' });
    expect(within(more).getAllByRole('button').map(button => button.textContent?.trim()).filter(Boolean)).toEqual([
      '导入图片或 JSON 配置', '引用预设', '图片反推 Tag', 'Tag 辅助已关闭', '重置当前模式',
    ]);
  });

  it.each([390, 1280])('保存菜单区分修改原串与另存新串，宽度=%s', width => {
    vi.stubGlobal('innerWidth', width);
    const handleSaveAll = vi.fn(); const handleFork = vi.fn();
    const { container } = renderHeader({ chainId: 'asset-1', hasChanges: true, handleSaveAll, handleFork });
    const save = width < 768
      ? screen.getAllByRole('button', { name: '保存风格串' }).find(button => button.classList.contains('md:hidden'))!
      : within(container.querySelector('.chain-editor-actions') as HTMLElement).getByRole('button', { name: '保存风格串' });
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
});
