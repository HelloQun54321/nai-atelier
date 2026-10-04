// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InfoPopover } from '../../components/InfoPopover';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each([390, 1024, 1280])('宽度 %s 的说明留在根层并限制在视口中，不改变原容器结构', width => {
  vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', 800);
  const view = render(<div className="agent-stage safe-mode dark"><main className="isolate overflow-hidden"><InfoPopover label="详情" content={'完整说明'.repeat(20)} /></main></div>);
  const trigger = screen.getByRole('button', { name: '详情' }); const originalChildren = trigger.parentElement!.childElementCount;
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ x: width - 44, y: 744, width: 44, height: 44, left: width - 44, right: width, top: 744, bottom: 788, toJSON() {} });
  fireEvent.click(trigger); const dialog = screen.getByRole('dialog', { name: '详情' });
  expect(dialog.parentElement).toBe(view.container.firstElementChild); expect(dialog.closest('main')).toBeNull();
  expect(dialog.style.position).toBe('fixed'); expect(parseFloat(dialog.style.left)).toBeGreaterThanOrEqual(8);
  expect(parseFloat(dialog.style.left) + parseFloat(dialog.style.width)).toBeLessThanOrEqual(width - 8);
  expect(parseFloat(dialog.style.top)).toBeLessThan(744); expect(trigger.parentElement!.childElementCount).toBe(originalChildren);
  fireEvent.pointerDown(document.body); expect(screen.queryByRole('dialog')).toBeNull();
});
it('说明保持文本选区，Esc 只关闭顶层说明，关闭后继续编辑', () => {
  const parentEscape = vi.fn(); window.addEventListener('keydown', parentEscape);
  const view = render(<><textarea aria-label="提示词" defaultValue="masterpiece, 1girl" /><InfoPopover label="权重说明" content="所选整组" preserveSelection /></>);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement; input.focus(); input.setSelectionRange(0, 11);
  const help = screen.getByRole('button', { name: '权重说明' });
  expect(fireEvent.mouseDown(help)).toBe(false); expect(document.activeElement).toBe(input);
  fireEvent.click(help); fireEvent.keyDown(screen.getByRole('button', { name: '关闭说明' }), { key: 'Escape' });
  expect(parentEscape).not.toHaveBeenCalled(); expect(document.activeElement).toBe(input); expect([input.selectionStart, input.selectionEnd]).toEqual([0, 11]);
  window.removeEventListener('keydown', parentEscape); view.unmount();
});
