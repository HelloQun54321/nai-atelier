// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorHeader } from './ChainEditorHeader';

afterEach(() => cleanup());

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
  canEdit: false,
  isEditingInfo: false,
  setIsEditingInfo: vi.fn(),
  canSaveActiveModeToLibrary: false,
  canSaveCurrentChain: false,
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
  it('操作按钮行移动端整行居中，桌面端保持靠右', () => {
    const { container } = renderHeader();
    const actions = container.querySelector('.chain-editor-actions') as HTMLElement;
    expect(actions).toBeTruthy();
    expect(actions.className).toContain('justify-center');
    expect(actions.className).toContain('lg:justify-end');
    // 关键约束：ml-auto 不能不带断点前缀出现在移动端——grid 项的 auto 边距会收缩行宽并把整行钉到右侧，
    // 让 justify-center 完全失效（视觉上仍然靠右）；桌面端才允许 lg:ml-auto 恢复靠右。
    expect(actions.className).toMatch(/(^|\s)lg:ml-auto(\s|$)/);
    expect(actions.className).not.toMatch(/(^|\s)ml-auto(\s|$)/);
  });

  it('实验室模式展示重置与 Tag 辅助按钮，不展示保存/复制按钮', () => {
    const { getByRole, queryByRole } = renderHeader({ canSaveActiveModeToLibrary: false });
    expect(getByRole('button', { name: '重置实验室' })).toBeTruthy();
    expect(getByRole('button', { name: /Tag 辅助/ })).toBeTruthy();
    expect(queryByRole('button', { name: '保存到库' })).toBeNull();
    expect(queryByRole('button', { name: '保存修改' })).toBeNull();
  });
});
