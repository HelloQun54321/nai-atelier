// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CanvasSelectionOverlay, closeCanvasSelection } from '../../../components/canvas/CanvasSelectionOverlay';

describe('画布选区轮廓', () => {
  it('去除重复的闭合顶点，拒绝共线或单点轮廓', () => {
    const a = { x: 0, y: 0 }, b = { x: 10, y: 0 }, c = { x: 10, y: 10 };
    expect(closeCanvasSelection([a, b, c, c, a])).toEqual({ points: [a, b, c] });
    expect(closeCanvasSelection([a, b, { x: 20, y: 0 }])).toBeNull();
    expect(closeCanvasSelection([a, a, a])).toBeNull();
  });
  it('草绘多边形末端跟随鼠标，锁定轮廓以动态虚线显示', () => {
    const selection = { points: [{ x: 1, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 9 }] };
    const { container, rerender } = render(<CanvasSelectionOverlay width={100} height={100} zoom={1} selection={null} draft={null} polygon={selection.points} cursor={{ x: 12, y: 14 }} />);
    const draft = [...container.querySelectorAll('path')].at(-1)!;
    expect(draft.getAttribute('d')).toContain('L 12 14');
    expect(draft.getAttribute('d')).not.toContain(' Z');
    expect(draft.style.animation).toBe('');
    rerender(<CanvasSelectionOverlay width={100} height={100} zoom={1} selection={selection} draft={null} polygon={[]} cursor={null} />);
    const locked = [...container.querySelectorAll('path')].at(-1)!;
    expect(locked.getAttribute('d')).toMatch(/ Z$/);
    expect(locked.style.animation).toContain('canvas-selection-march');
  });
});
