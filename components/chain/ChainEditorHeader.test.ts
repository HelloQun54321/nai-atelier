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

const renderHeader = (props: Partial<Parameters<typeof ChainEditorHeader>[0]> = {}) => render(React.createElement(ChainEditorHeader, {
  chainId: 'playground',
  chainName: '实验室',
  chainDesc: '',
  chainTags: [],
  setChainName: vi.fn(),
  setChainDesc: vi.fn(),
  setChainTags: vi.fn(),
  isCharacterMode: false,
  isOwner: true,
  isGuest: false,
  canEdit: true,
  isEditingInfo: false,
  setIsEditingInfo: vi.fn(),
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
  markChange: vi.fn(),
  handleReset: vi.fn(),
  handleFork: vi.fn(),
  handleSaveAll: vi.fn(),
  handleImportImage: vi.fn(),
  setShowImportPreset: vi.fn(),
  setTaggerOpen: vi.fn(),
  notify: vi.fn(),
  ...props,
}));

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
    expect(within(dialog).getByRole('button', { name: '重置实验室' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '保存到库' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: '重置实验室' }));
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
});
