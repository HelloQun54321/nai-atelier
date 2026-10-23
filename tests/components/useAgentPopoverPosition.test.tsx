// @vitest-environment jsdom
import React, { Profiler, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAgentPopoverPosition } from '../../components/useAgentPopoverPosition';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const Example = ({ align = 'start', placement = 'auto', open = true }: {
  align?: 'start' | 'center' | 'end'; placement?: 'auto' | 'right'; open?: boolean;
}) => {
  const anchor = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const position = useAgentPopoverPosition(open, anchor, panel, 240, align, placement);
  return <><button ref={anchor}>锚点</button><div ref={panel} data-testid="panel" style={position} /></>;
};

it.each(['start', 'center', 'end', 'right'] as const)('%s 定位相同的滚动、窗口与内容测量不新增提交，真实变化立即跟随', mode => {
  let top = 500, left = 300, height = 120;
  const viewport = Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 0, width: 1000, height: 800 });
  vi.stubGlobal('visualViewport', viewport);
  const measured: ResizeObserverCallback[] = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { measured.push(callback); }
    observe() {} disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    left, top, right: left + 80, bottom: top + 40, width: 80, height: 40, x: left, y: top, toJSON() {},
  }));
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
  const commits = vi.fn();
  render(<Profiler id="position" onRender={commits}><Example align={mode === 'right' ? 'start' : mode} placement={mode === 'right' ? 'right' : 'auto'} /></Profiler>);
  const panel = screen.getByTestId('panel');
  const stableCommits = commits.mock.calls.length;
  for (let index = 0; index < 10; index++) {
    fireEvent.scroll(panel);
    fireEvent.resize(window);
    act(() => { viewport.dispatchEvent(new Event('scroll')); viewport.dispatchEvent(new Event('resize')); measured.forEach(callback => callback([], {} as ResizeObserver)); });
  }
  expect(commits).toHaveBeenCalledTimes(stableCommits);
  const previousLeft = panel.style.left;
  left += 20;
  fireEvent.scroll(window);
  expect(parseFloat(panel.style.left)).toBe(parseFloat(previousLeft) + 20);
  expect(commits).toHaveBeenCalledTimes(stableCommits + 1);
  const previousTop = panel.style.top;
  top -= 30;
  fireEvent.scroll(window);
  expect(parseFloat(panel.style.top)).toBe(parseFloat(previousTop) - 30);
  if (mode !== 'right') {
    const beforeHeight = panel.style.top;
    height += 40;
    act(() => measured.forEach(callback => callback([], {} as ResizeObserver)));
    expect(parseFloat(panel.style.top)).toBe(parseFloat(beforeHeight) - 40);
  }
  viewport.height = 350;
  act(() => viewport.dispatchEvent(new Event('resize')));
  expect(parseFloat(panel.style.top)).toBeLessThanOrEqual(342);
});

it('关闭后清除定位，再打开重新测量', () => {
  const view = render(<Example />);
  expect(screen.getByTestId('panel').style.position).toBe('fixed');
  view.rerender(<Example open={false} />);
  expect(screen.getByTestId('panel').style.position).toBe('');
  view.rerender(<Example />);
  expect(screen.getByTestId('panel').style.position).toBe('fixed');
});
