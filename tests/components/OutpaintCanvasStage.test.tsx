// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutpaintCanvasStage } from '../../components/OutpaintCanvasStage';

afterEach(cleanup);

describe('扩图模拟画幅', () => {
  it('原图尺寸不变时应用后的扩展量不被自动改写，重新选比例仍基于原图', () => {
    const props = { sourceWidth: 832, sourceHeight: 1216, expansion: { top: 128, bottom: 192, left: 0, right: 0 },
      selectedRatioId: '9:16', onExpansionChange: vi.fn(), onSelectRatioId: vi.fn() };
    const view = render(<OutpaintCanvasStage {...props} />);
    expect(screen.getByText('输出：832 × 1536 px (9:16)')).toBeTruthy();
    expect(props.onExpansionChange).not.toHaveBeenCalled();
    view.rerender(<OutpaintCanvasStage {...props} />);
    expect(props.onExpansionChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /1:1/ }));
    expect(props.onExpansionChange).toHaveBeenCalledWith({ top: 0, bottom: 0, left: 192, right: 192 });
  });

  it('自定义四边的外框、输出尺寸与原图摆放按同一实际尺寸计算', () => {
    const onExpansionChange = vi.fn();
    const { container } = render(<OutpaintCanvasStage sourceWidth={832} sourceHeight={1216}
      expansion={{ top: 64, bottom: 128, left: 192, right: 256 }} selectedRatioId="custom"
      onExpansionChange={onExpansionChange} onSelectRatioId={vi.fn()} baseImagePreview="fixture.png" />);
    expect(screen.getByText('输出：1280 × 1408 px (自定义)')).toBeTruthy();
    expect(onExpansionChange).not.toHaveBeenCalled();
    const original = container.querySelector('img')!.parentElement!;
    expect(original.style.left).toBe('15%');
    expect(parseFloat(original.style.width)).toBeCloseTo(832 / 1280 * 100);
    expect(parseFloat(original.style.height)).toBeCloseTo(1216 / 1408 * 100);
    fireEvent.click(screen.getByRole('button', { name: '靠右' }));
    expect(onExpansionChange).toHaveBeenCalledWith({ top: 64, bottom: 128, left: 448, right: 0 });
  });
});
