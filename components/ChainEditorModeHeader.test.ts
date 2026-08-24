// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorModeHeader } from './ChainEditorModeHeader';

afterEach(() => cleanup());

describe('ChainEditorModeHeader', () => {
  it('风格串详情隐藏模式导航，并按返回、铅笔、名称顺序显示截断标题', () => {
    const onEditInfo = vi.fn();
    const onBack = vi.fn();
    const { container } = render(React.createElement(ChainEditorModeHeader, {
      isLaboratory: false,
      chainName: '这是一个非常长的风格串名称，用于验证标题不会越过左侧参数区域',
      entityLabel: '风格串',
      isOwner: true,
      activeMode: 'inpaint',
      onSelectMode: vi.fn(),
      onEditInfo,
      onBack,
    }));

    expect(screen.queryByRole('navigation', { name: '生成模式' })).toBeNull();
    const backButton = screen.getByRole('button', { name: '返回风格串列表' });
    const editButton = screen.getByRole('button', { name: '编辑风格串信息' });
    const title = screen.getByRole('heading', { level: 1 });
    expect(backButton.compareDocumentPosition(editButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(editButton.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.className).toContain('flex-1');
    expect(title.className).toContain('truncate');
    expect(container.firstElementChild?.className).toContain('w-full');
    expect(title.getAttribute('title')).toBe(title.textContent);
    fireEvent.click(backButton);
    expect(onBack).toHaveBeenCalledOnce();
    fireEvent.click(editButton);
    expect(onEditInfo).toHaveBeenCalledOnce();
  });

  it('实验室仍显示四模式导航，不显示风格串名称与铅笔', () => {
    render(React.createElement(ChainEditorModeHeader, {
      isLaboratory: true,
      chainName: '不应显示',
      entityLabel: '风格串',
      isOwner: true,
      activeMode: 'text-to-image',
      onSelectMode: vi.fn(),
      onEditInfo: vi.fn(),
      onBack: vi.fn(),
    }));

    expect(screen.getByRole('navigation', { name: '生成模式' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: '编辑风格串信息' })).toBeNull();
    expect(screen.queryByText('不应显示')).toBeNull();
  });

  it('角色串详情使用对应的返回与编辑文案', () => {
    render(React.createElement(ChainEditorModeHeader, {
      isLaboratory: false,
      chainName: '角色串名称',
      entityLabel: '角色串',
      isOwner: true,
      activeMode: 'text-to-image',
      onSelectMode: vi.fn(),
      onEditInfo: vi.fn(),
      onBack: vi.fn(),
    }));

    expect(screen.getByRole('button', { name: '返回角色串列表' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '编辑角色串信息' })).toBeTruthy();
  });
});
