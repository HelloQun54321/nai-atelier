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
});
