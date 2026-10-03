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
const Control = ({ disabled = false, choose = defaults.choose, think = defaults.think, model = first, configure = () => {} }: { disabled?: boolean; choose?: (model: PromptAgentModel) => Promise<void>; think?: (level: PromptAgentThinkingLevel) => Promise<void>; model?: PromptAgentModel; configure?: () => void }) => {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState(model), [level, setLevel] = useState<PromptAgentThinkingLevel>('low');
  return <AgentModelControl models={[first, second]} activeModel={selected} thinkingLevels={selected.thinkingLevels} thinkingLevel={selected.thinkingLevels.includes(level) ? level : 'off'} disabled={disabled} open={open} onOpenChange={setOpen} onModelChange={async next => { await choose(next); setSelected(next); }} onThinkingChange={async next => { await think(next); setLevel(next); }} onBusyChange={() => {}} onConfigure={configure} />;
};
it('当前模型和强度直接可见，只展示本模型支持的思考档位', async () => {
  const think = vi.fn(async () => {}); render(<Control think={think} />);
  const trigger = screen.getByRole('button', { name: '模型与思考设置' }); expect(trigger.textContent).toContain('synthetic-model (合成服务甲)低');
  fireEvent.click(trigger); const range = screen.getByRole('slider', { name: '思考强度' }); expect(range.getAttribute('max')).toBe('2'); expect(document.activeElement).toBe(range);
  expect(screen.queryByRole('button', { name: '思考强度：中' })).toBeNull();
  fireEvent.change(range, { target: { value: '2' } }); fireEvent.pointerUp(range);
  await waitFor(() => expect(trigger.textContent).toContain('高')); expect(think).toHaveBeenCalledWith('high');
});
it('稀疏接口档位不补上其他强度，强度面板不占用来源说明和配置入口的空间', () => {
  const model = { ...first, thinkingLevels: ['low', 'high', 'xhigh'], thinkingLevelsSource: 'metadata' } as PromptAgentModel;
  const view = render(<Control model={model} />); fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }));
  expect(screen.getByRole('slider').getAttribute('max')).toBe('2'); expect(screen.queryByRole('button', { name: '思考强度：中' })).toBeNull();
  expect(screen.queryByRole('button', { name: '思考强度：关闭' })).toBeNull(); expect(screen.queryByText('档位来自接口声明')).toBeNull();
  expect(screen.queryByRole('button', { name: '思考强度：低' })).toBeNull(); expect(screen.queryByRole('button', { name: '思考强度：高' })).toBeNull(); expect(screen.queryByRole('button', { name: '思考强度：极高' })).toBeNull();
  expect(screen.queryByRole('button', { name: '配置模型服务 →' })).toBeNull();
  view.unmount(); render(<Control />); fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }));
  expect(screen.queryByText(/接口未声明具体档位/)).toBeNull();
});
it('配置入口只在选择模型页出现，返回强度页隐藏；未接入模型仍可配置', () => {
  const configure = vi.fn(); const view = render(<Control configure={configure} />);
  fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }));
  fireEvent.click(screen.getByRole('button', { name: 'synthetic-model (合成服务甲)' }));
  expect(screen.getByRole('button', { name: '配置模型服务 →' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '选择模型' }));
  expect(screen.queryByRole('button', { name: '配置模型服务 →' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'synthetic-model (合成服务甲)' }));
  fireEvent.click(screen.getByRole('button', { name: '配置模型服务 →' }));
  expect(configure).toHaveBeenCalledTimes(1); expect(screen.queryByRole('dialog')).toBeNull();
  view.unmount();
  render(<AgentModelControl models={[]} thinkingLevels={['off']} thinkingLevel="off" open disabled={false} onOpenChange={() => {}} onModelChange={async () => {}} onThinkingChange={async () => {}} onBusyChange={() => {}} onConfigure={configure} />);
  expect(screen.getByText('尚未接入模型服务')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '配置模型服务 →' }));
  fireEvent.click(screen.getByRole('button', { name: '配置模型服务 →' })); expect(configure).toHaveBeenCalledTimes(2);
});
it('拖动允许连续位置，释放吸附后只保存可用档位，键盘仍逐档调节', async () => {
  const think = vi.fn(async () => {}); render(<Control think={think} />); fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }));
  const range = screen.getByRole('slider', { name: '思考强度' });
  fireEvent.pointerDown(range); fireEvent.change(range, { target: { value: '0.65' } }); expect((range as HTMLInputElement).value).toBe('0.65'); expect(range.getAttribute('aria-valuetext')).toBe('低');
  fireEvent.change(range, { target: { value: '1.7' } }); expect((range as HTMLInputElement).value).toBe('1.7'); expect(think).not.toHaveBeenCalled();
  fireEvent.pointerUp(range); await waitFor(() => expect(think).toHaveBeenCalledWith('high')); expect(think).toHaveBeenCalledTimes(1); expect((range as HTMLInputElement).value).toBe('2');
  await waitFor(() => expect((range as HTMLInputElement).disabled).toBe(false));
  fireEvent.keyDown(range, { key: 'Home' }); expect((range as HTMLInputElement).value).toBe('0'); fireEvent.keyUp(range, { key: 'Home' }); await waitFor(() => expect(think).toHaveBeenLastCalledWith('off'));
  await waitFor(() => expect((range as HTMLInputElement).disabled).toBe(false)); fireEvent.keyDown(range, { key: 'ArrowRight' }); expect((range as HTMLInputElement).value).toBe('1'); fireEvent.keyUp(range, { key: 'ArrowRight' }); await waitFor(() => expect(think).toHaveBeenLastCalledWith('low'));
});
it('拖动取消恢复原档位，保存失败也回到原值', async () => {
  const think = vi.fn(async () => { throw new Error('保存失败'); }); render(<Control think={think} />);
  fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' })); const range = screen.getByRole('slider') as HTMLInputElement;
  fireEvent.pointerDown(range); fireEvent.change(range, { target: { value: '1.85' } }); fireEvent.pointerCancel(range);
  expect(range.value).toBe('1'); expect(think).not.toHaveBeenCalled();
  fireEvent.pointerDown(range); fireEvent.change(range, { target: { value: '1.85' } }); fireEvent.pointerUp(range);
  await screen.findByRole('alert'); expect(range.value).toBe('1'); expect(range.getAttribute('aria-valuetext')).toBe('低');
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
  expect(popover.style.width).toBe('300px'); expect(popover.style.left).toBe('82px'); expect(popover.style.top).toBe('252px');
  viewport.width = 320; viewport.offsetTop = 500; viewport.height = 120;
  act(() => { viewport.dispatchEvent(new Event('resize')); });
  expect(popover.style.width).toBe('300px'); expect(popover.style.left).toBe('12px'); expect(popover.style.maxHeight).toBe('44px'); expect(popover.style.top).toBe('508px');
  expect(document.activeElement).toBe(slider);
});
it('有空间时卡片中心对准模型按钮，触发器尺寸改变后重新对齐', () => {
  vi.stubGlobal('innerWidth', 1200);
  const rect = { x: 600, y: 560, left: 600, right: 800, top: 560, bottom: 596, width: 200, height: 36, toJSON: () => ({}) };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect);
  render(<Control />); fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }));
  expect(screen.getByRole('dialog').style.left).toBe('550px');
  rect.width = 100; rect.right = 700;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(screen.getByRole('dialog').style.left).toBe('500px');
});
it('粒子密度与播放速率随强度增加，最高可用档位显示 Ultra 而不增加请求档位', async () => {
  const updatePlaybackRate = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', { configurable: true, value: () => [{ updatePlaybackRate }] });
  try {
    const model = { ...first, thinkingLevels: ['low', 'high', 'xhigh'] } as PromptAgentModel;
    const think = vi.fn(async () => {}); render(<Control model={model} think={think} />);
    fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }));
    const slider = screen.getByRole('slider'); const flow = document.querySelector('.agent-thinking-particles')!;
    expect(flow.getAttribute('data-particles')).toBe('5'); expect(updatePlaybackRate).toHaveBeenLastCalledWith(.65);
    fireEvent.change(slider, { target: { value: '1' } }); expect(Number(flow.getAttribute('data-particles'))).toBeGreaterThan(5); expect(updatePlaybackRate.mock.calls.at(-1)?.[0]).toBeCloseTo(1.825);
    fireEvent.change(slider, { target: { value: '2' } }); expect(flow.getAttribute('data-particles')).toBe('24'); expect(updatePlaybackRate).toHaveBeenLastCalledWith(3);
    expect(screen.getByText('Ultra')).toBeTruthy(); expect(screen.getByRole('dialog').getAttribute('data-ultra')).toBe('true'); expect(think).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider); await waitFor(() => expect(think).toHaveBeenCalledWith('xhigh'));
    expect(slider.getAttribute('aria-valuetext')).toBe('极高');
  } finally { delete (HTMLElement.prototype as unknown as { getAnimations?: unknown }).getAnimations; }
});
it('保存中保留滑条与卡片结构，状态提示不撑高卡片且没有快速模式标记', async () => {
  let resolve!: () => void;
  render(<Control think={() => new Promise<void>(done => { resolve = done; })} />);
  fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }));
  const dialog = screen.getByRole('dialog'), slider = screen.getByRole('slider');
  expect(dialog.querySelector('.lucide-zap')).toBeNull();
  fireEvent.change(slider, { target: { value: '2' } }); fireEvent.pointerUp(slider);
  expect(screen.getByRole('status').className).toBe('sr-only'); expect(screen.getByRole('slider')).toBe(slider);
  await act(async () => resolve()); expect(screen.queryByRole('status')).toBeNull();
});
it('模型触发器无常驻底色，圆环显示真实比例；未知与超过窗口分别处理', () => {
  const base = { models: [first], activeModel: first, thinkingLevels: first.thinkingLevels, thinkingLevel: 'low' as const, open: false, disabled: false, onOpenChange: () => {}, onModelChange: async () => {}, onThinkingChange: async () => {}, onBusyChange: () => {}, onConfigure: () => {} };
  const view = render(<AgentModelControl {...base} contextUsage={{ used: 4000, limit: 10000 }} />);
  expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('40');
  expect(screen.getByRole('meter').getAttribute('title')).toContain('4,000 / 10,000');
  expect(screen.getByRole('button', { name: '模型与思考设置' }).className).toContain('bg-transparent');
  expect(screen.getByRole('button', { name: '模型与思考设置' }).className).not.toContain('rounded-full');
  view.rerender(<AgentModelControl {...base} contextUsage={{ used: 12000, limit: 10000 }} />);
  expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('100');
  view.rerender(<AgentModelControl {...base} />);
  expect(screen.queryByRole('meter')).toBeNull(); expect(screen.getByRole('img', { name: /尚未收到当前模型的用量数据/ })).toBeTruthy();
});
