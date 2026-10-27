// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getToolbarPopoverPosition, ToolbarPopover } from '../../components/ToolbarPopover';

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
  it.each([1280, 390])('%ipx 框内收纳入口可打开同一个筛选面板，关闭与跨端同步外部状态', width => {
    vi.stubGlobal('innerWidth', width);
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return <><button type="button" onClick={() => setOpen(true)}>其余条件</button><ToolbarPopover title="共用筛选" open={open} onOpenChange={setOpen}><button>条件内容</button></ToolbarPopover></>;
    };
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '筛选' });
    const more = screen.getByRole('button', { name: '其余条件' });
    more.focus(); fireEvent.click(more);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    if (width < 768) fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }));
    else fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(more);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger); expect(screen.getByRole('dialog')).toBeTruthy();
    vi.stubGlobal('innerWidth', width < 768 ? 1280 : 390); fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it.each([1280, 390])('嵌入管理窗口时 %ipx 筛选使用指定层级并保留返回焦点', width => {
    vi.stubGlobal('innerWidth', width);
    render(<ToolbarPopover title="管理窗口筛选" zIndex={1960}><button>合成条件</button></ToolbarPopover>);
    const trigger = screen.getByRole('button', { name: '筛选' });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '管理窗口筛选' });
    expect(width < 768 ? dialog.closest<HTMLElement>('.mobile-layer')!.style.zIndex : dialog.style.zIndex).toBe(width < 768 ? '1960' : '1961');
    if (width < 768) fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    else fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('图标触发器沿用紫色动作和禁用状态，启用后才可打开', () => {
    const draw = (disabled: boolean) => <ToolbarPopover label="用作底图" title="用作底图" iconOnly iconTone="edit" disabled={disabled}><button>图生图</button></ToolbarPopover>;
    const view = render(draw(true));
    const trigger = screen.getByRole('button', { name: '用作底图' });
    expect(trigger.classList.contains('bg-purple-600')).toBe(true);
    expect(trigger.classList.contains('dark:bg-purple-600/90')).toBe(true);
    fireEvent.click(trigger); expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(draw(false)); fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '用作底图' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('手机收起文字后仍显示筛选数量，无障碍名称只读一次数量', () => {
    vi.stubGlobal('innerWidth', 390);
    render(<ToolbarPopover title="筛选资料" count={2}><div /></ToolbarPopover>);
    const trigger = screen.getByRole('button', { name: '筛选 2' });
    expect(trigger.querySelector('span.sm\\:hidden')?.textContent).toBe('2');
    expect(trigger.querySelector('span.hidden')?.className).toContain('sm:inline');
  });
  it('次级选项可沿用紧凑图标触发，保留名称、焦点与 Escape 关闭', () => {
    render(<ToolbarPopover label="更多操作" title="更多操作" iconOnly icon={<svg />}><button>次级操作</button></ToolbarPopover>);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    expect(trigger.textContent).toBe(''); expect(trigger.className).toContain('w-10');
    trigger.focus(); fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: '更多操作' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it('与触发器居中，两侧贴边时留出屏幕边距', () => {
    expect(getToolbarPopoverPosition({ left: 460, width: 80, bottom: 52 }, 400, 1000, 800)).toEqual({ left: 500, top: 60, width: 400, maxHeight: 728, transformOrigin: '200px top' });
    expect(getToolbarPopoverPosition({ left: 0, width: 40, bottom: 52 }, 400, 1000, 800).left).toBe(212);
    expect(getToolbarPopoverPosition({ left: 960, width: 40, bottom: 52 }, 400, 1000, 800).left).toBe(788);
    expect(getToolbarPopoverPosition({ left: 0, width: 40, bottom: 52 }, 400, 1000, 800).transformOrigin).toBe('8px top');
    expect(getToolbarPopoverPosition({ left: 960, width: 40, bottom: 52 }, 400, 1000, 800).transformOrigin).toBe('392px top');
  });

  it('限制面板宽高，窗口较小也不会裁掉操作区', () => {
    const position = getToolbarPopoverPosition({ left: 300, width: 80, bottom: 350 }, 544, 400, 400);
    expect(position.width).toBe(376);
    expect(position.left).toBe(200);
    expect(position.top + position.maxHeight).toBe(388);
    expect(position.maxHeight).toBeGreaterThan(0);
  });
  it('贴底生成栏向上展开，保留可用高度与屏幕左右边界', () => {
    expect(getToolbarPopoverPosition({ left: 950, width: 44, top: 746, bottom: 790 }, 280, 1000, 800, true))
      .toEqual({ left: 848, top: 738, width: 280, maxHeight: 726, transformOrigin: '264px bottom' });
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
    expect(screen.getByRole('button', { name: '筛选 1' }).getAttribute('data-active')).toBe('true');
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
