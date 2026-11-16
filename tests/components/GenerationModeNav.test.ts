// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenerationModeNav } from '../../components/GenerationModeNav';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});

describe('GenerationModeNav', () => {

  it('电脑四种模式等分占满可用宽度并标记当前模式', () => {
    const onSelect = vi.fn();
    const { container } = render(React.createElement(GenerationModeNav, { activeMode: 'inpaint', onSelect }));

    const nav = screen.getByRole('navigation', { name: '生成模式' });
    expect(nav.getAttribute('data-mode-chrome')).toBe('segmented');
    expect(nav.className).toContain('w-full');
    expect(nav.className).toContain('max-w-3xl');
    expect(nav.className).toContain('grid-cols-4');
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '局部重绘' }).getAttribute('aria-current')).toBe('page');
    expect(container.querySelectorAll('.min-w-0')).toHaveLength(4);
    screen.getAllByRole('button').forEach(button => expect(button.className).toContain('whitespace-nowrap'));

    fireEvent.click(screen.getByRole('button', { name: '扩图' }));
    expect(onSelect).toHaveBeenCalledWith('outpaint');
  });

  it('电脑生成进行中禁用模式切换：按钮不可点且不触发 onSelect', () => {
    const onSelect = vi.fn();
    render(React.createElement(GenerationModeNav, { activeMode: 'inpaint', onSelect, disabled: true }));

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    buttons.forEach(button => {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.className).toContain('disabled:cursor-not-allowed');
    });

    fireEvent.click(screen.getByRole('button', { name: '扩图' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('手机顶栏只显示当前模式，点开底部面板切换', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: String(query).includes('max-width: 767px'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    const onSelect = vi.fn();
    render(React.createElement(GenerationModeNav, { activeMode: 'text-to-image', onSelect }));

    const nav = screen.getByRole('navigation', { name: '生成模式' });
    expect(nav.getAttribute('data-mode-chrome')).toBe('compact');
    const trigger = screen.getByRole('button', { name: '文生图' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.queryByRole('button', { name: '图生图' })).toBeNull();

    fireEvent.click(trigger);
    const sheet = screen.getByRole('dialog', { name: '生成模式' });
    fireEvent.click(within(sheet).getByRole('option', { name: '局部重绘' }));
    expect(onSelect).toHaveBeenCalledWith('inpaint');
    expect(screen.queryByRole('dialog', { name: '生成模式' })).toBeNull();
  });

  it('手机生成进行中禁用打开模式面板', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: String(query).includes('max-width: 767px'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    const onSelect = vi.fn();
    render(React.createElement(GenerationModeNav, { activeMode: 'inpaint', onSelect, disabled: true }));
    const trigger = screen.getByRole('button', { name: '局部重绘' });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog', { name: '生成模式' })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
