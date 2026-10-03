// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AgentContextRing } from './AgentContextRing';
afterEach(cleanup);
it('悬停展示紧凑上下文卡片及缓存命中率，离开隐藏', () => {
  render(<AgentContextRing usage={{ used: 160000, limit: 258000, cacheHitRate: 80 }} />);
  const ring = screen.getByRole('meter'); fireEvent.pointerEnter(ring);
  const tooltip = screen.getByRole('tooltip'); expect(tooltip.textContent).toContain('62% 已用'); expect(tooltip.textContent).toContain('已用 160k 标记，共 258k'); expect(tooltip.textContent).toContain('缓存命中率：80.0%');
  expect(ring.getAttribute('aria-describedby')).toBe(tooltip.id); expect(ring.getAttribute('title')).toBe('');
  fireEvent.pointerLeave(ring); expect(screen.queryByRole('tooltip')).toBeNull();
});
it('键盘聚焦与触屏可读取，Esc 收起，缺失数据不显示虚假的 0%', () => {
  const view = render(<AgentContextRing />); const ring = screen.getByRole('img'); fireEvent.focus(ring);
  expect(screen.getByRole('tooltip').textContent).toContain('用量未知'); expect(screen.getByRole('tooltip').textContent).toContain('缓存命中率：未知');
  fireEvent.keyDown(ring, { key: 'Escape' }); expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.click(ring); expect(screen.getByRole('tooltip')).toBeTruthy(); fireEvent.blur(ring); expect(screen.queryByRole('tooltip')).toBeNull();
  view.rerender(<AgentContextRing usage={{ used: 4000, limit: 10000, cacheHitRate: 0 }} />); fireEvent.pointerEnter(screen.getByRole('meter'));
  expect(screen.getByRole('tooltip').textContent).toContain('缓存命中率：0.0%');
});
