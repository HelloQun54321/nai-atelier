// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CanvasAxisGuides } from '../../../components/canvas/CanvasAxisGuides';

describe('画布移动辅助线', () => {
  it('未锁轴时显示交于起点的两条虚线，锁轴后只保留对应方向', () => {
    const { container, rerender } = render(<CanvasAxisGuides width={300} height={200} origin={{ x: 40, y: 60 }} axis={null} />);
    const horizontal = container.querySelector('[data-axis-guide="x"] line')!;
    const vertical = container.querySelector('[data-axis-guide="y"] line')!;
    expect([horizontal.getAttribute('x1'), horizontal.getAttribute('y1'), horizontal.getAttribute('x2'), horizontal.getAttribute('y2')]).toEqual(['0', '60', '300', '60']);
    expect([vertical.getAttribute('x1'), vertical.getAttribute('y1'), vertical.getAttribute('x2'), vertical.getAttribute('y2')]).toEqual(['40', '0', '40', '200']);
    expect(container.querySelector('svg')?.classList.contains('pointer-events-none')).toBe(true);
    expect([...container.querySelectorAll('line')].every(element => element.getAttribute('vector-effect') === 'non-scaling-stroke' && element.getAttribute('stroke-dasharray') === '6 4')).toBe(true);
    rerender(<CanvasAxisGuides width={300} height={200} origin={{ x: 40, y: 60 }} axis="x" />);
    expect(container.querySelector('[data-axis-guide="x"]')).not.toBeNull();
    expect(container.querySelector('[data-axis-guide="y"]')).toBeNull();
    rerender(<CanvasAxisGuides width={300} height={200} origin={{ x: 40, y: 60 }} axis="y" />);
    expect(container.querySelector('[data-axis-guide="x"]')).toBeNull();
    expect(container.querySelector('[data-axis-guide="y"]')).not.toBeNull();
  });
});
