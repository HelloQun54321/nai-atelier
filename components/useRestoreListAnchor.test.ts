// @vitest-environment jsdom
import React, { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRestoreListAnchor } from './useRestoreListAnchor';

const Harness: React.FC<{ targetId?: string; readyKey?: number }> = ({ targetId, readyKey }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  useRestoreListAnchor(scrollRef, targetId, readyKey);
  return React.createElement('div', { ref: scrollRef, 'data-testid': 'root' },
    React.createElement('article', { 'data-return-item-id': 'chain-1' }));
};

afterEach(() => cleanup());

describe('useRestoreListAnchor', () => {
  it('目标仍在原视口内时保持现有滚动位置', () => {
    const { getByTestId, container, rerender } = render(React.createElement(Harness));
    const root = getByTestId('root');
    const target = container.querySelector<HTMLElement>('[data-return-item-id="chain-1"]')!;
    root.getBoundingClientRect = () => ({ top: 0, bottom: 500 } as DOMRect);
    target.getBoundingClientRect = () => ({ top: 100, bottom: 300 } as DOMRect);

    rerender(React.createElement(Harness, { targetId: 'chain-1' }));
    expect(root.scrollTop).toBe(0);
  });

  it('目标仍有部分在原视口内时不会强制居中', () => {
    const { getByTestId, container, rerender } = render(React.createElement(Harness));
    const root = getByTestId('root');
    const target = container.querySelector<HTMLElement>('[data-return-item-id="chain-1"]')!;
    root.getBoundingClientRect = () => ({ top: 0, bottom: 500 } as DOMRect);
    target.getBoundingClientRect = () => ({ top: 450, bottom: 650 } as DOMRect);

    rerender(React.createElement(Harness, { targetId: 'chain-1' }));
    expect(root.scrollTop).toBe(0);
  });

  it('排序变化导致目标离开视口时将卡片居中，并允许下次返回再次定位', () => {
    const { getByTestId, container, rerender } = render(React.createElement(Harness));
    const root = getByTestId('root');
    const target = container.querySelector<HTMLElement>('[data-return-item-id="chain-1"]')!;
    root.scrollTop = 40;
    root.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 } as DOMRect);
    target.getBoundingClientRect = () => ({ top: 700, bottom: 900, height: 200 } as DOMRect);

    rerender(React.createElement(Harness, { targetId: 'chain-1', readyKey: 1 }));
    expect(root.scrollTop).toBe(590);

    rerender(React.createElement(Harness));
    root.scrollTop = 20;
    rerender(React.createElement(Harness, { targetId: 'chain-1', readyKey: 2 }));
    expect(root.scrollTop).toBe(570);
  });
});
