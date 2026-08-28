// @vitest-environment jsdom
import React, { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { ImageActivityContext } from './SmartImage';

const InnerView: React.FC<{ viewKey: string; clientHeight: number; scrollHeight: number }> = ({
  viewKey,
  clientHeight,
  scrollHeight,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const handleScroll = useKeepAliveScrollRestore(scrollRef, viewKey);

  const setNode = (node: HTMLDivElement | null) => {
    if (node) {
      Object.defineProperty(node, 'clientHeight', { value: clientHeight, configurable: true, writable: true });
      Object.defineProperty(node, 'scrollHeight', { value: scrollHeight, configurable: true, writable: true });
    }
    scrollRef.current = node;
  };

  if (scrollRef.current) {
    Object.defineProperty(scrollRef.current, 'clientHeight', { value: clientHeight, configurable: true, writable: true });
    Object.defineProperty(scrollRef.current, 'scrollHeight', { value: scrollHeight, configurable: true, writable: true });
  }

  return React.createElement('div', {
    ref: setNode,
    'data-testid': 'root',
    onScroll: handleScroll,
    style: { height: '500px', overflowY: 'auto' },
  }, React.createElement('div', { style: { height: '2000px' } }));
};

const Harness: React.FC<{ active?: boolean; viewKey?: string; clientHeight?: number; scrollHeight?: number }> = ({
  active = true,
  viewKey = 'test-view',
  clientHeight = 500,
  scrollHeight = 2000,
}) => {
  return React.createElement(
    ImageActivityContext.Provider,
    { value: active },
    React.createElement(InnerView, { viewKey, clientHeight, scrollHeight })
  );
};

afterEach(() => cleanup());

describe('useKeepAliveScrollRestore', () => {
  it('在激活状态下滚动时保存并正确记录位置', () => {
    const { getByTestId, unmount } = render(React.createElement(Harness, { active: true, viewKey: 'active-view' }));
    const root = getByTestId('root');
    root.scrollTop = 800;
    root.dispatchEvent(new Event('scroll'));
    unmount();

    // 重新挂载另一个同 key 的视图组件模拟切页返回
    const { getByTestId: getNewRoot } = render(React.createElement(Harness, { active: true, viewKey: 'active-view' }));
    const newRoot = getNewRoot('root');
    // 渲染后恢复 saved 位置
    expect(newRoot.scrollTop).toBe(800);
  });

  it('在未激活状态（或隐藏 display:none / clientHeight 为 0）时忽略清零 scroll 事件，不覆盖已有缓存', () => {
    // 1. 激活状态下滚动到 1200px 并记录
    const { getByTestId, rerender } = render(React.createElement(Harness, { active: true, viewKey: 'guard-view', clientHeight: 500, scrollHeight: 2000 }));
    const root = getByTestId('root');
    root.scrollTop = 1200;
    root.dispatchEvent(new Event('scroll'));

    // 2. 切到未激活状态（模拟切页至 edit），clientHeight 塌陷为 0，浏览器将 scrollTop 归零并触发 scroll 事件
    rerender(React.createElement(Harness, { active: false, viewKey: 'guard-view', clientHeight: 0, scrollHeight: 0 }));
    root.scrollTop = 0;
    root.dispatchEvent(new Event('scroll'));

    // 3. 重新切回激活状态，验证 1200px 缓存未被 0 冲掉，并成功恢复
    rerender(React.createElement(Harness, { active: true, viewKey: 'guard-view', clientHeight: 500, scrollHeight: 2000 }));
    expect(root.scrollTop).toBe(1200);
  });
});

