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

  it('实验室显示四模式导航与手机端返回箭头，不显示风格串名称与铅笔', () => {
    const onBack = vi.fn();
    render(React.createElement(ChainEditorModeHeader, {
      isLaboratory: true,
      chainName: '不应显示',
      entityLabel: '风格串',
      isOwner: true,
      activeMode: 'text-to-image',
      onSelectMode: vi.fn(),
      onEditInfo: vi.fn(),
      onBack,
    }));

    expect(screen.getByRole('navigation', { name: '生成模式' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: '编辑风格串信息' })).toBeNull();
    expect(screen.queryByText('不应显示')).toBeNull();
    // 返回箭头只在无侧边栏的窄屏（<md）显示，桌面/平板由侧边栏承担退出，不造重复入口
    const backButton = screen.getByRole('button', { name: '退出实验室，返回上一页面' });
    expect(backButton.className).toContain('md:hidden');
    fireEvent.click(backButton);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('实验室生成进行中禁用四模式切换并透传到模式导航', () => {
    const onSelectMode = vi.fn();
    render(React.createElement(ChainEditorModeHeader, {
      isLaboratory: true,
      chainName: '不应显示',
      entityLabel: '风格串',
      isOwner: true,
      activeMode: 'outpaint',
      isGenerating: true,
      onSelectMode,
      onEditInfo: vi.fn(),
      onBack: vi.fn(),
    }));

    const nav = screen.getByRole('navigation', { name: '生成模式' });
    expect(nav).toBeTruthy();
    // 4 个模式按钮 + 1 个手机端返回箭头
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);
    const navButtons = nav.querySelectorAll('button');
    expect(navButtons).toHaveLength(4);
    navButtons.forEach(button => {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: '局部重绘' }));
    expect(onSelectMode).not.toHaveBeenCalled();
  });

  it('自定义角色详情使用对应的返回与编辑文案', () => {
    render(React.createElement(ChainEditorModeHeader, {
      isLaboratory: false,
      chainName: '自定义角色名称',
      entityLabel: '自定义角色',
      isOwner: true,
      activeMode: 'text-to-image',
      onSelectMode: vi.fn(),
      onEditInfo: vi.fn(),
      onBack: vi.fn(),
    }));

    expect(screen.getByRole('button', { name: '返回自定义角色列表' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '编辑自定义角色信息' })).toBeTruthy();
  });
});
