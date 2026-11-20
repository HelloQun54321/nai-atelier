// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolbarCountBadge } from '../../components/ToolbarCountBadge';

describe('ToolbarCountBadge', () => {
  it('手机断点隐藏，电脑断点才显示', () => {
    const { container } = render(<ToolbarCountBadge loaded={3} total={7} />);
    const badge = container.querySelector('[data-toolbar-count-badge]');
    expect(badge).toBeTruthy();
    expect(badge?.className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'md:flex']));
  });

  it('inline 形态用于搜索框尾部，手机隐藏、电脑单行显示已加载与总数', () => {
    const { container } = render(<ToolbarCountBadge inline loaded={120} total={2400} />);
    const badge = container.querySelector('[data-toolbar-count-badge]');
    expect(badge?.getAttribute('data-inline')).toBe('true');
    expect(badge?.className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'md:inline-flex']));
    expect(badge?.textContent).toBe('120/2.4k');
    expect(badge?.getAttribute('title')).toBe('已加载 120 / 共 2400');
  });
});
