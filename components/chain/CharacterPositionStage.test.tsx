// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterPositionStage } from './CharacterPositionStage';

const characters = [{ id: 'a', prompt: 'a', x: 0.5, y: 0.5 }, { id: 'b', prompt: 'b', x: 0.3, y: 0.7 }];
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('角色定位交互', () => {
  it.each([false, true])('freeform=%s 按实际画布边界定位，拖动越界钳制，结束后停止写入', freeform => {
    class PointerEvent extends MouseEvent { pointerId: number; constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId || 1; } }
    vi.stubGlobal('PointerEvent', PointerEvent);
    const onPosition = vi.fn();
    render(<CharacterPositionStage characters={characters} freeform={freeform} width={1600} height={800} image="blob:base" canEdit useCoords onPosition={onPosition} />);
    const canvas = screen.getByRole('group', { name: '角色定位画布' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 200, height: 100 } as DOMRect);
    expect(canvas.style.aspectRatio).toBe('2');
    expect(screen.getByAltText('角色定位底图').getAttribute('src')).toBe('blob:base');
    fireEvent.click(screen.getByRole('button', { name: '选择角色 2' }));
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 145, clientY: 129 });
    expect(onPosition).toHaveBeenLastCalledWith(1, freeform ? { x: 0.225, y: 0.79 } : { x: 0.3, y: 0.7 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 0, clientY: 999 });
    expect(onPosition).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 0, clientY: 999 });
    expect(onPosition).toHaveBeenLastCalledWith(1, freeform ? { x: 0, y: 1 } : { x: 0.1, y: 0.9 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 200, clientY: 100 });
    expect(onPosition).toHaveBeenCalledTimes(2);
  });

  it('V5 方向键微调，停用或删除选中角色后选择有效角色；空画布与只读均安全', () => {
    const onPosition = vi.fn();
    const props = { characters, freeform: true, width: 832, height: 1216, canEdit: true, useCoords: false, onPosition };
    const { rerender } = render(<CharacterPositionStage {...props} />);
    fireEvent.keyDown(screen.getByRole('button', { name: '定位角色 1' }), { key: 'ArrowDown' });
    expect(onPosition).toHaveBeenLastCalledWith(0, { x: 0.5, y: 0.51 });
    fireEvent.click(screen.getByRole('button', { name: '选择角色 2' }));
    rerender(<CharacterPositionStage {...props} characters={[characters[0], { ...characters[1], enabled: false }]} />);
    expect(screen.getByRole('button', { name: '定位角色 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: '定位角色 2' })).toBeNull();
    rerender(<CharacterPositionStage {...props} canEdit={false} />);
    fireEvent.keyDown(screen.getByRole('button', { name: '定位角色 1' }), { key: 'ArrowDown' });
    expect(onPosition).toHaveBeenCalledTimes(1);
    rerender(<CharacterPositionStage {...props} characters={[]} />);
    expect(screen.getByText('没有已启用的角色')).toBeTruthy();
  });
});
