// @vitest-environment jsdom
import React, { useRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptHeightHandle } from '../../components/PromptHeightHandle';

afterEach(cleanup);
function Fixture() {
  const target = useRef<HTMLTextAreaElement>(null);
  return <><textarea ref={target} aria-label="原文" defaultValue="保留原词" disabled style={{ height: 100, minHeight: 40, maxHeight: 300 }} /><PromptHeightHandle targetRef={target} label="调整高度" /></>;
}
const pointer = (target: HTMLElement, type: string, y: number, pointerId = 1) => fireEvent(target,
  Object.assign(new Event(type, { bubbles: true, cancelable: true }), { button: 0, pointerType: 'touch', pointerId, clientY: y }));

it('触屏捕获拖拽并限制高度，不改文字；释放后停止，内容禁用不影响查看高度', () => {
  render(<Fixture />);
  const handle = screen.getByRole('button', { name: '调整高度' });
  const target = screen.getByRole('textbox', { name: '原文' }) as HTMLTextAreaElement;
  expect(handle.style.touchAction).toBe('none');
  handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = () => true; handle.releasePointerCapture = vi.fn();
  expect(pointer(handle, 'pointerdown', 200)).toBe(false);
  expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
  pointer(handle, 'pointermove', 260);
  expect(target.style.height).toBe('160px');
  pointer(handle, 'pointermove', 600, 2);
  expect(target.style.height).toBe('160px');
  pointer(handle, 'pointermove', 600);
  expect(target.style.height).toBe('300px');
  pointer(handle, 'pointermove', 0);
  expect(target.style.height).toBe('40px');
  pointer(handle, 'pointerup', 0);
  expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
  pointer(handle, 'pointermove', 250);
  expect(target.style.height).toBe('40px'); expect(target.value).toBe('保留原词');
});

it('第二根手指不抢拖拽，系统取消和捕获丢失后不继续调整', () => {
  render(<Fixture />);
  const handle = screen.getByRole('button', { name: '调整高度' });
  const target = screen.getByRole('textbox', { name: '原文' });
  pointer(handle, 'pointerdown', 200);
  pointer(handle, 'pointerdown', 400, 2);
  pointer(handle, 'pointermove', 230);
  expect(target.style.height).toBe('130px');
  pointer(handle, 'pointercancel', 230);
  pointer(handle, 'pointermove', 300);
  expect(target.style.height).toBe('130px');
  pointer(handle, 'pointerdown', 300);
  pointer(handle, 'lostpointercapture', 300);
  pointer(handle, 'pointermove', 350);
  expect(target.style.height).toBe('130px');
});

it('键盘上下调整有最小高度，普通点击和其他按键不更改内容或高度', () => {
  render(<Fixture />);
  const handle = screen.getByRole('button', { name: '调整高度' });
  const target = screen.getByRole('textbox', { name: '原文' });
  fireEvent.keyDown(handle, { key: 'ArrowDown' }); expect(target.style.height).toBe('132px');
  for (let index = 0; index < 10; index++) fireEvent.keyDown(handle, { key: 'ArrowUp' });
  expect(target.style.height).toBe('40px');
  fireEvent.click(handle); fireEvent.keyDown(handle, { key: 'Enter' });
  expect(target.style.height).toBe('40px');
});
