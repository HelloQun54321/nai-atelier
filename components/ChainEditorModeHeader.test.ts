// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorModeHeader } from './ChainEditorModeHeader';

afterEach(() => cleanup());

describe('ChainEditorModeHeader', () => {
  it.each(['风格串', '自定义角色'] as const)('%s 工作台只保留返回与模式导航，四模式共用剩余宽度', entityLabel => {
    const onBack = vi.fn();
    const onSelectMode = vi.fn();
    const { container } = render(React.createElement(ChainEditorModeHeader, {
      isLaboratory: false, entityLabel, activeMode: 'inpaint', onSelectMode, onBack,
    }));

    const nav = screen.getByRole('navigation', { name: '生成模式' });
    expect(screen.getByRole('button', { name: '局部重绘' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: '扩图' }));
    expect(onSelectMode).toHaveBeenCalledWith('outpaint');
    const back = screen.getByRole('button', { name: `返回${entityLabel}列表` });
    expect(back.className).not.toContain('md:hidden');
    expect(back.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('button', { name: /编辑.*信息/ })).toBeNull();
    expect(container.firstElementChild?.className).not.toContain('flex-wrap');
    expect(nav.parentElement?.className).toContain('min-w-0 flex-1');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('实验室保留仅手机端的返回箭头', () => {
    const onBack = vi.fn();
    render(React.createElement(ChainEditorModeHeader, {
      isLaboratory: true, entityLabel: '风格串', activeMode: 'text-to-image',
      onSelectMode: vi.fn(), onBack,
    }));
    const back = screen.getByRole('button', { name: '退出实验室，返回上一页面' });
    expect(back.className).toContain('md:hidden');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it.each([true, false])('生成中禁用全部模式切换：实验室=%s', isLaboratory => {
    const onSelectMode = vi.fn();
    render(React.createElement(ChainEditorModeHeader, {
      isLaboratory, entityLabel: '风格串', activeMode: 'outpaint', isGenerating: true,
      onSelectMode, onBack: vi.fn(),
    }));
    const buttons = screen.getByRole('navigation', { name: '生成模式' }).querySelectorAll('button');
    expect(buttons).toHaveLength(4);
    buttons.forEach(button => expect(button.disabled).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '局部重绘' }));
    expect(onSelectMode).not.toHaveBeenCalled();
  });
});
