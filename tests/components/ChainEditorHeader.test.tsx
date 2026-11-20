// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorHeader } from '../../components/chain/ChainEditorHeader';

const baseProps = (patch: Partial<React.ComponentProps<typeof ChainEditorHeader>> = {}): React.ComponentProps<typeof ChainEditorHeader> => ({
  chainId: 'playground',
  isCharacterMode: false,
  isOwner: true,
  isGuest: false,
  canEdit: true,
  canSaveActiveModeToLibrary: true,
  canSaveCurrentChain: false,
  isUploading: false,
  hasChanges: false,
  hasPendingPreviewCover: false,
  tagAssistEnabled: false,
  onTagAssistEnabledChange: vi.fn(),
  activeGenerationMode: 'image-to-image',
  selectGenerationMode: vi.fn(),
  onBack: vi.fn(),
  handleReset: vi.fn(),
  handleFork: vi.fn(),
  handleSaveAll: vi.fn(),
  handleImportImage: vi.fn(),
  onTranslateMissingPrompts: vi.fn(),
  notify: vi.fn(),
  ...patch,
});

const setViewport = (width: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });

afterEach(() => {
  cleanup();
  setViewport(1024);
});

describe('实验室顶栏的反推入口', () => {
  it('编辑模式传回调时在工具排最左渲染反推按钮并交给上层处理', () => {
    const onReverseTag = vi.fn();
    render(<ChainEditorHeader {...baseProps({ onReverseTag })} />);
    const button = screen.getByRole('button', { name: '从图片反推 Tag' });
    const row = button.closest('.chain-editor-actions');
    // 反推位于这一排工具的最左，先于导入、翻译与 Tag 辅助。
    expect(row?.querySelector('button')).toBe(button);
    fireEvent.click(button);
    expect(onReverseTag).toHaveBeenCalledOnce();
  });

  it('没有回调时不渲染反推按钮，文生图保持原有工具排', () => {
    render(<ChainEditorHeader {...baseProps()} />);
    expect(screen.queryByRole('button', { name: '从图片反推 Tag' })).toBeNull();
    expect(screen.getByRole('button', { name: '导入图片或 JSON 配置' })).toBeTruthy();
  });

  it('窄屏收进更多操作面板，仍能从面板里发起反推', () => {
    setViewport(900);
    const onReverseTag = vi.fn();
    render(<ChainEditorHeader {...baseProps({ onReverseTag })} />);
    expect(screen.queryByRole('button', { name: '从图片反推 Tag' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: /从图片反推 Tag/ }));
    expect(onReverseTag).toHaveBeenCalledOnce();
  });

  it('桌面端将破坏性的重置当前模式收入更多操作，保存使用绿色 save 语义，Tag 辅助以激活态表达', () => {
    const handleReset = vi.fn();
    render(<ChainEditorHeader {...baseProps({ handleReset, tagAssistEnabled: true })} />);
    expect(screen.queryByRole('button', { name: '重置当前模式' })).toBeNull();
    expect(screen.getByRole('button', { name: '保存到库' }).getAttribute('data-tone')).toBe('save');
    const tagButton = screen.getByRole('button', { name: '关闭 Tag 辅助' });
    expect(tagButton.getAttribute('data-active')).toBe('true');
    expect(tagButton.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '重置当前模式' }));
    expect(handleReset).toHaveBeenCalledOnce();
  });
});
