// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getToolbarPopoverPosition, ToolbarPopover } from './ToolbarPopover';

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 800);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const FilterExample = () => {
  const [favorite, setFavorite] = useState(false);
  return <ToolbarPopover title="筛选资料" count={Number(favorite)}>
    {(close, mobile) => <>
      {mobile && <label>分类<select defaultValue="all"><option value="all">全部</option></select></label>}
      <label><input type="checkbox" checked={favorite} onChange={event => setFavorite(event.target.checked)} />只看收藏</label>
      <button onClick={close}>查看结果</button>
    </>}
  </ToolbarPopover>;
};

describe('工具栏弹层位置与连续操作', () => {
  it('与触发器居中，两侧贴边时留出屏幕边距', () => {
    expect(getToolbarPopoverPosition({ left: 460, width: 80, bottom: 52 }, 400, 1000, 800)).toEqual({ left: 500, top: 60, width: 400, maxHeight: 728 });
    expect(getToolbarPopoverPosition({ left: 0, width: 40, bottom: 52 }, 400, 1000, 800).left).toBe(212);
    expect(getToolbarPopoverPosition({ left: 960, width: 40, bottom: 52 }, 400, 1000, 800).left).toBe(788);
  });

  it('限制面板宽高，窗口较小也不会裁掉操作区', () => {
    const position = getToolbarPopoverPosition({ left: 300, width: 80, bottom: 350 }, 544, 400, 400);
    expect(position.width).toBe(376);
    expect(position.left).toBe(200);
    expect(position.top + position.maxHeight).toBe(388);
    expect(position.maxHeight).toBeGreaterThan(0);
  });

  it('筛选内容脱离工作区隔离层，修改后标记数量且关闭不丢失条件', () => {
    const { container } = render(<div className="agent-stage"><div className="workspace-content"><FilterExample /></div></div>);
    const trigger = screen.getByRole('button', { name: '筛选' });
    trigger.focus(); fireEvent.click(trigger);
    const panel = screen.getByRole('dialog', { name: '筛选资料' });
    expect(panel.parentElement).toBe(container.querySelector('.agent-stage'));
    expect(panel.closest('.workspace-content')).toBeNull();
    fireEvent.click(within(panel).getByRole('checkbox', { name: '只看收藏' }));
    expect(screen.getByRole('button', { name: '筛选 1' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(panel).getByRole('button', { name: '查看结果' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect((screen.getByRole('checkbox', { name: '只看收藏' }) as HTMLInputElement).checked).toBe(true);
  });

  it('Tab 留在弹层，Escape 关闭并归还触发器焦点', () => {
    render(<FilterExample />);
    const trigger = screen.getByRole('button', { name: '筛选' });
    trigger.focus(); fireEvent.click(trigger);
    const checkbox = screen.getByRole('checkbox');
    const last = screen.getByRole('button', { name: '查看结果' });
    expect(document.activeElement).toBe(checkbox);
    last.focus(); fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(checkbox);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('桌面尺寸变化重新定位，跨手机断点后关闭，重开保留筛选并提供分类', () => {
    render(<FilterExample />);
    const trigger = screen.getByRole('button', { name: '筛选' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('checkbox'));
    vi.stubGlobal('innerWidth', 900); fireEvent(window, new Event('resize'));
    expect(screen.getByRole('dialog', { name: '筛选资料' }).style.width).toBe('384px');
    expect(screen.queryByRole('combobox', { name: '分类' })).toBeNull();
    vi.stubGlobal('innerWidth', 390); fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger);
    const panel = screen.getByRole('dialog', { name: '筛选资料' });
    expect(panel.classList.contains('mobile-sheet')).toBe(true);
    expect(within(panel).getByRole('combobox', { name: '分类' })).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(panel).getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
