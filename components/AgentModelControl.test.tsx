// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentModelControl } from './AgentModelControl';
import type { PromptAgentModel, PromptAgentThinkingLevel } from '../services/promptAgent';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const first = { id: 'vendor/synthetic-model', provider: 'first', providerName: '合成服务甲', reasoning: true, thinkingLevels: ['off', 'low', 'high'], imageInput: true } as PromptAgentModel;
const second = { ...first, provider: 'second', providerName: '合成服务乙', reasoning: false, thinkingLevels: ['off'], imageInput: false } as PromptAgentModel;
const defaults = { choose: vi.fn(async (_model: PromptAgentModel) => {}), think: vi.fn(async (_level: PromptAgentThinkingLevel) => {}) };
const Control = ({ disabled = false, choose = defaults.choose, think = defaults.think, model = first }: { disabled?: boolean; choose?: (model: PromptAgentModel) => Promise<void>; think?: (level: PromptAgentThinkingLevel) => Promise<void>; model?: PromptAgentModel }) => {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState(model), [level, setLevel] = useState<PromptAgentThinkingLevel>('low');
  return <AgentModelControl models={[first, second]} activeModel={selected} thinkingLevels={selected.thinkingLevels} thinkingLevel={selected.thinkingLevels.includes(level) ? level : 'off'} disabled={disabled} open={open} onOpenChange={setOpen} onModelChange={async next => { await choose(next); setSelected(next); }} onThinkingChange={async next => { await think(next); setLevel(next); }} onBusyChange={() => {}} onConfigure={() => {}} />;
};
it('当前模型和强度直接可见，只展示本模型支持的思考档位', async () => {
  const think = vi.fn(async () => {}); render(<Control think={think} />);
  const trigger = screen.getByRole('button', { name: '模型与思考设置' }); expect(trigger.textContent).toContain('synthetic-model (合成服务甲)低');
  fireEvent.click(trigger); const range = screen.getByRole('slider', { name: '思考强度' }); expect(range.getAttribute('max')).toBe('2'); expect(document.activeElement).toBe(range);
  expect(screen.queryByRole('button', { name: '思考强度：中' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '思考强度：高' }));
  await waitFor(() => expect(trigger.textContent).toContain('高')); expect(think).toHaveBeenCalledWith('high');
});
it('滑动期间只预览，释放后保存最终强度，键盘亦可保存', async () => {
  const think = vi.fn(async () => {}); render(<Control think={think} />); fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }));
  const range = screen.getByRole('slider', { name: '思考强度' });
  fireEvent.change(range, { target: { value: '0' } }); fireEvent.change(range, { target: { value: '2' } }); expect(think).not.toHaveBeenCalled();
  fireEvent.pointerUp(range); await waitFor(() => expect(think).toHaveBeenCalledWith('high')); expect(think).toHaveBeenCalledTimes(1);
  await waitFor(() => expect((range as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(range, { target: { value: '0' } }); fireEvent.keyUp(range, { key: 'Home' }); await waitFor(() => expect(think).toHaveBeenLastCalledWith('off'));
});
it('同名跨服务模型分别选择；保存失败保留原模型并显示原因', async () => {
  const choose = vi.fn(async () => { throw new Error('合成接口断连'); }); render(<Control choose={choose} />);
  const trigger = screen.getByRole('button', { name: '模型与思考设置' }); fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'synthetic-model (合成服务甲)' }));
  fireEvent.click(screen.getByRole('button', { name: '选择模型：synthetic-model (合成服务乙)' }));
  expect((await screen.findByRole('alert')).textContent).toBe('合成接口断连'); expect(trigger.textContent).toContain('合成服务甲');
  choose.mockResolvedValue(undefined as never); fireEvent.click(screen.getByRole('button', { name: '选择模型：synthetic-model (合成服务乙)' }));
  await waitFor(() => expect(trigger.textContent).toContain('合成服务乙')); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it('任务期间不能切换；普通模型不显示可调思考控件', () => {
  const view = render(<Control model={second} />); const trigger = screen.getByRole('button', { name: '模型与思考设置' }) as HTMLButtonElement;
  fireEvent.click(trigger); expect(screen.queryByRole('slider')).toBeNull(); expect(screen.getByText('当前模型不提供可调思考强度')).toBeTruthy();
  view.rerender(<Control model={second} disabled />); expect(trigger.disabled).toBe(true); expect(screen.queryByRole('dialog')).toBeNull();
});
it('Esc 仅关闭模型弹层并归还焦点，外部点击亦关闭', async () => {
  render(<Control />); const trigger = screen.getByRole('button', { name: '模型与思考设置' }); fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('slider'), { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger); fireEvent.pointerDown(document.body); expect(screen.queryByRole('dialog')).toBeNull();
});
it('弹层避让窄屏边缘，软键盘缩小视口后仍在可见区域且保持焦点', () => {
  const viewport = Object.assign(new EventTarget(), { width: 390, height: 400, offsetLeft: 0, offsetTop: 200 });
  vi.stubGlobal('visualViewport', viewport);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 280, y: 560, left: 280, right: 350, top: 560, bottom: 596, width: 70, height: 36, toJSON: () => ({}) });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(300);
  render(<Control />); fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }));
  const popover = screen.getByRole('dialog'), slider = screen.getByRole('slider');
  expect(popover.style.width).toBe('360px'); expect(popover.style.left).toBe('8px'); expect(popover.style.top).toBe('252px');
  viewport.width = 320; viewport.offsetTop = 500; viewport.height = 120;
  act(() => { viewport.dispatchEvent(new Event('resize')); });
  expect(popover.style.width).toBe('304px'); expect(popover.style.left).toBe('8px'); expect(popover.style.maxHeight).toBe('44px'); expect(popover.style.top).toBe('508px');
  expect(document.activeElement).toBe(slider);
});
