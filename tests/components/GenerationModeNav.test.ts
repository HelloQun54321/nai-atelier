// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationModeNav } from '../../components/GenerationModeNav';
const lowMode = vi.hoisted(() => ({ enabled: false }));
vi.mock('../../services/lowConsumption', () => ({ useLowConsumption: () => lowMode }));

afterEach(() => { cleanup(); lowMode.enabled = false; });

describe('GenerationModeNav', () => {
  it('低消耗真正移除图生图与扩图入口，两列布局，关闭后恢复四模式', () => {
    lowMode.enabled = true;
    const onSelect = vi.fn();
    const { rerender } = render(React.createElement(GenerationModeNav, { activeMode: 'inpaint', onSelect }));
    expect(screen.queryByRole('button', { name: '图生图' })).toBeNull();
    expect(screen.queryByRole('button', { name: '扩图' })).toBeNull();
    expect(screen.getAllByRole('button').map(item => item.textContent)).toEqual(['文生图', '局部重绘']);
    expect(screen.getByRole('navigation').className).toContain('grid-cols-2');
    expect(screen.getByRole('navigation').className).not.toContain('grid-cols-4');
    fireEvent.click(screen.getByRole('button', { name: '文生图' }));
    expect(onSelect).toHaveBeenCalledWith('text-to-image');
    lowMode.enabled = false;
    rerender(React.createElement(GenerationModeNav, { activeMode: 'outpaint', onSelect }));
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '扩图' }).getAttribute('aria-current')).toBe('page');
  });
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
