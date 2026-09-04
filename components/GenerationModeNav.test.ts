// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationModeNav } from './GenerationModeNav';

afterEach(() => cleanup());

describe('GenerationModeNav', () => {
  it('四种模式等分占满可用宽度并标记当前模式', () => {
    const onSelect = vi.fn();
    const { container } = render(React.createElement(GenerationModeNav, { activeMode: 'inpaint', onSelect }));

    const nav = screen.getByRole('navigation', { name: '生成模式' });
    expect(nav.className).toContain('w-full');
    expect(nav.className).toContain('max-w-3xl');
    expect(nav.className).toContain('grid-cols-4');
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '局部重绘' }).getAttribute('aria-current')).toBe('page');
    expect(container.querySelectorAll('.min-w-0')).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: '扩图' }));
    expect(onSelect).toHaveBeenCalledWith('outpaint');
  });

  it('生成进行中禁用模式切换：按钮不可点且不触发 onSelect', () => {
    const onSelect = vi.fn();
    render(React.createElement(GenerationModeNav, { activeMode: 'inpaint', onSelect, disabled: true }));

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    buttons.forEach(button => {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.className).toContain('disabled:cursor-not-allowed');
      expect(button.className).toContain('disabled:opacity-50');
    });

    fireEvent.click(screen.getByRole('button', { name: '扩图' }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
