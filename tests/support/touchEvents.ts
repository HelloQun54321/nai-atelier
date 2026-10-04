import { act, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

/** jsdom 不提供完整 PointerEvent；只补手势需要的公开字段。 */
export class TestPointerEvent extends MouseEvent {
  readonly pointerType: string;
  readonly pointerId: number;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? 'touch';
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
  }
}

export const installPointerEvents = () => vi.stubGlobal('PointerEvent', TestPointerEvent);

export const longPress = (target: Element) => {
  installPointerEvents();
  vi.useFakeTimers();
  fireEvent.pointerDown(target, { pointerType: 'touch', button: 0, clientX: 20, clientY: 20 });
  act(() => vi.advanceTimersByTime(450));
  fireEvent.pointerUp(target, { pointerType: 'touch' });
  fireEvent.click(target, { detail: 1 });
  vi.useRealTimers();
};
