// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GenerationCountControl } from '../../components/GenerationCountControl';
import { emitCloudQueueStatus, getCloudQueuePreferences, setCloudQueuePreferences } from '../../services/cloudQueue';
const queuePreferences = { enabled: true, serviceUrl: 'https://synthetic.example', greeting: '正在生成中～', showGreeting: true };
beforeEach(async () => {
  sessionStorage.clear(); localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(queuePreferences))));
  await getCloudQueuePreferences();
});
afterEach(() => { cleanup(); emitCloudQueueStatus(null); vi.unstubAllGlobals(); });
const state = { busy: true, completed: 2, total: 8, paused: false, pausing: false, waiting: [] };
const props = { count: 3, onCountChange: vi.fn(), series: null, onStop: vi.fn(), onQueue: vi.fn(), onGenerate: vi.fn(), costLabel: '90 Anlas' };

it.each([1280, 390])('%s 宽度左右小按钮用图片与人物区分分数，公共状态只在点开后出现', async width => {
  vi.stubGlobal('innerWidth', width);
  emitCloudQueueStatus({ taskId: 'queue', phase: 'waiting', position: 2, queueSize: 4, cancelable: true });
  render(<GenerationCountControl {...props} busy queueState={state} generationState="generating" />);
  const left = screen.getByRole('button', { name: '暂停生成' });
  const main = screen.getByRole('button', { name: /加入队列.*3 张/ });
  const right = screen.getByRole('button', { name: 'Key 排队 2/4' });
  expect(left.querySelector('.lucide-images')).toBeTruthy(); expect(left.textContent).toBe('2/8');
  expect(right.querySelector('.lucide-user-round')).toBeTruthy(); expect(right.textContent).toBe('2/4');
  expect(left.nextElementSibling).toBe(main); expect(main.nextElementSibling).toBe(right.parentElement);
  expect(left.classList.contains('lg:right-full')).toBe(true);
  expect(right.parentElement?.classList.contains('lg:left-full')).toBe(true);
  expect(main.parentElement?.classList.contains('lg:max-w-[calc(100%-14rem)]')).toBe(true);
  expect(main.classList.contains('max-lg:!min-w-0')).toBe(true);
  expect(main.firstElementChild?.classList.contains('max-lg:!px-2')).toBe(true);
  for (const button of [left, right]) expect(button.classList.contains('min-h-10')).toBe(true);
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(right);
  expect(screen.getByRole('dialog', { name: 'Key 排队' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('前方 2 个任务');
  expect(screen.getByRole('button', { name: '取消排队' })).toBeTruthy();
  if (width < 768) fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  else fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('右侧只跟随当前 Key 公共排队勾选，关闭连续生成仍可查看，取消勾选立即收起', async () => {
  emitCloudQueueStatus({ taskId: 'queue', phase: 'waiting', position: 0, queueSize: 0 });
  render(<GenerationCountControl {...props} continuousGenerationEnabled={false} busy generationState="generating" />);
  expect(screen.queryByRole('button', { name: '暂停生成' })).toBeNull();
  const right = screen.getByRole('button', { name: 'Key 排队 0/0' });
  fireEvent.click(right);
  expect(screen.getByRole('dialog', { name: 'Key 排队' })).toBeTruthy();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...queuePreferences, enabled: false }))));
  await act(async () => { await setCloudQueuePreferences({ ...queuePreferences, enabled: false }); });
  expect(screen.queryByRole('button', { name: /Key 排队/ })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each([1280, 390])('%s 宽度恢复主按钮尺寸、图标，切换连续模式和费用显隐不缩小', width => {
  vi.stubGlobal('innerWidth', width);
  const view = render(<GenerationCountControl {...props} continuousGenerationEnabled={false} />);
  const main = screen.getByRole('button', { name: /生成.*90 Anlas/ });
  expect(main.parentElement?.classList.contains('lg:w-80')).toBe(true);
  expect(main.classList.contains('generation-action-button--workbench')).toBe(true);
  expect(main.classList.contains('rounded-full')).toBe(true);
  expect(main.classList.contains('lg:rounded-xl')).toBe(true);
  expect(main.querySelector('.lucide-image')).toBeTruthy();
  expect(main.firstElementChild?.classList.contains('px-4')).toBe(true);
  view.rerender(<GenerationCountControl {...props} continuousGenerationEnabled={false} busy disabled generationState="generating" />);
  expect(screen.getByRole('button', { name: '生成中…' })).toBe(main);
  expect(main.classList.contains('generation-action-button--workbench')).toBe(true);
  expect(main.parentElement?.classList.contains('lg:w-80')).toBe(true);
  view.rerender(<GenerationCountControl {...props} generationState="saving" queueState={state} />);
  expect(screen.getByRole('button', { name: /加入队列.*3 张.*90 Anlas/ })).toBe(main);
  expect(main.parentElement?.classList.contains('lg:max-w-[calc(100%-8rem)]')).toBe(true);
  expect(main.classList.contains('generation-action-button--workbench')).toBe(true);
});

it.each([false, true])('连续生成 %s 时真实执行亮起特效，暂停、等待及费用确认停止，恢复后再亮起', continuousGenerationEnabled => {
  const queue = vi.fn(), generate = vi.fn();
  const common = { ...props, continuousGenerationEnabled, onQueue: queue, onGenerate: generate, busy: true, disabled: true, series: { current: 0, total: 3, stopping: false } };
  const view = render(<GenerationCountControl {...common} generationState="generating" queueState={state} />);
  const main = screen.getByRole('button', { name: continuousGenerationEnabled ? /加入队列.*3 张/ : '生成中…' });
  expect(main.classList.contains('generation-action-button--loading')).toBe(true);
  expect(main.getAttribute('aria-disabled')).toBe(String(!continuousGenerationEnabled));
  expect(main.firstElementChild?.classList.contains('opacity-50')).toBe(false);
  fireEvent.click(main);
  expect(queue).toHaveBeenCalledTimes(continuousGenerationEnabled ? 1 : 0);
  expect(generate).not.toHaveBeenCalled();
  for (const generationState of ['preparing', 'generating', 'saving'] as const) {
    view.rerender(<GenerationCountControl {...common} generationState={generationState} queueState={state} />);
    expect(main.classList.contains('generation-action-button--loading')).toBe(true);
  }
  view.rerender(<GenerationCountControl {...common} generationState="saving" queueState={{ ...state, paused: true, pausing: true }} />);
  expect(main.classList.contains('generation-action-button--loading')).toBe(true);
  for (const generationState of ['paused', 'waiting', 'awaiting_confirmation', 'succeeded', 'failed', 'cancelled'] as const) {
    view.rerender(<GenerationCountControl {...common} generationState={generationState} queueState={{ ...state, paused: generationState === 'paused' }} />);
    expect(main.classList.contains('generation-action-button--loading')).toBe(false);
  }
  view.rerender(<GenerationCountControl {...common} generationState="generating" queueState={{ ...state, paused: true }} />);
  expect(main.classList.contains('generation-action-button--loading')).toBe(false);
  view.rerender(<GenerationCountControl {...common} generationState="generating" queueState={state} />);
  expect(main.classList.contains('generation-action-button--loading')).toBe(true);
});

it('短间隔保留特效，等待插队或公共队列时停止，菜单仍可排到下一位', () => {
  const queue = vi.fn();
  const common = { ...props, onQueue: queue, busy: true, series: { current: 1, total: 3, stopping: false }, generationState: 'waiting' as const };
  const view = render(<GenerationCountControl {...common} queueState={state} />);
  const main = screen.getByRole('button', { name: /加入队列.*3 张/ });
  expect(main.classList.contains('generation-action-button--loading')).toBe(true);
  view.rerender(<GenerationCountControl {...common} series={{ ...common.series, position: 1 }} queueState={state} />);
  expect(main.classList.contains('generation-action-button--loading')).toBe(false);
  view.rerender(<GenerationCountControl {...common} generationState="generating" queueState={state} />);
  act(() => emitCloudQueueStatus({ taskId: 'synthetic-task', phase: 'waiting', position: 1 }));
  expect(main.classList.contains('generation-action-button--loading')).toBe(false);
  act(() => emitCloudQueueStatus({ taskId: 'synthetic-task', phase: 'generating' }));
  expect(main.classList.contains('generation-action-button--loading')).toBe(true);
  fireEvent.keyDown(main, { key: 'ArrowDown', altKey: true });
  fireEvent.click(within(screen.getByRole('dialog', { name: '生成选项' })).getByRole('button', { name: '排到下一位' }));
  expect(queue).toHaveBeenCalledWith('next');
});
it.each([1280, 390])('%s 宽度间隔默认显示 2.0 秒，保留一位小数、失焦保存，可设 0，非法输入恢复且不触发生图', width => {
  vi.stubGlobal('innerWidth', width); const interval = vi.fn(), generate = vi.fn();
  const view = render(<GenerationCountControl {...props} onGenerate={generate} onIntervalChange={interval} queueState={state} />);
  fireEvent.keyDown(screen.getByRole('button', { name: /加入队列.*3 张/ }), { key: 'ArrowDown', altKey: true });
  const input = screen.getByLabelText('生成间隔') as HTMLInputElement;
  expect(input.value).toBe('2.0'); expect(input.inputMode).toBe('decimal');
  fireEvent.change(input, { target: { value: '0.5' } }); expect(interval).not.toHaveBeenCalled(); fireEvent.blur(input);
  expect(interval).toHaveBeenLastCalledWith(0.5); expect(input.value).toBe('0.5');
  view.rerender(<GenerationCountControl {...props} onIntervalChange={interval} intervalSeconds={4} queueState={state} />);
  expect(input.value).toBe('4.0');
  input.focus(); fireEvent.change(input, { target: { value: '4.2' } }); fireEvent.keyDown(input, { key: 'Enter' });
  expect(interval).toHaveBeenLastCalledWith(4.2); expect(input.value).toBe('4.2');
  fireEvent.change(input, { target: { value: '0' } }); fireEvent.blur(input);
  expect(interval).toHaveBeenLastCalledWith(0);
  for (const value of ['', '-1', '0.55', '3601']) { fireEvent.change(input, { target: { value } }); fireEvent.blur(input); expect(input.value).toBe('4.0'); }
  expect(interval).toHaveBeenCalledTimes(3); expect(generate).not.toHaveBeenCalled();
  view.rerender(<GenerationCountControl {...props} onIntervalChange={interval} intervalSeconds={4} intervalPending queueState={state} />);
  expect(input.disabled).toBe(true);
  expect(screen.getByLabelText('减少生成间隔')).toHaveProperty('disabled', true);
  expect(screen.getByLabelText('增加生成间隔')).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByLabelText('减少生成间隔')); fireEvent.click(screen.getByLabelText('增加生成间隔'));
  expect(interval).toHaveBeenCalledTimes(3);
  view.rerender(<GenerationCountControl {...props} onIntervalChange={interval} intervalSeconds={4} queueState={state} />);
  expect(input.value).toBe('4.0'); expect(input.disabled).toBe(false);
});
it.each([1280, 390])('%s 宽度间隔按钮按十分之一秒增减并遵守 0.0～3600.0 边界', width => {
  vi.stubGlobal('innerWidth', width);
  const interval = vi.fn(), generate = vi.fn();
  const view = render(<GenerationCountControl {...props} onGenerate={generate} onIntervalChange={interval} intervalSeconds={0} />);
  fireEvent.keyDown(screen.getByRole('button', { name: /生成.*3 张/ }), { key: 'ArrowDown', altKey: true });
  const input = screen.getByLabelText('生成间隔') as HTMLInputElement;
  const decrease = screen.getByRole('button', { name: '减少生成间隔' });
  const increase = screen.getByRole('button', { name: '增加生成间隔' });
  expect(input.value).toBe('0.0'); expect(decrease).toHaveProperty('disabled', true);
  fireEvent.click(increase); expect(interval).toHaveBeenLastCalledWith(0.1);
  view.rerender(<GenerationCountControl {...props} onGenerate={generate} onIntervalChange={interval} intervalSeconds={0.1} />);
  fireEvent.click(decrease); expect(interval).toHaveBeenLastCalledWith(0);
  view.rerender(<GenerationCountControl {...props} onGenerate={generate} onIntervalChange={interval} intervalSeconds={3599.9} />);
  fireEvent.click(increase); expect(interval).toHaveBeenLastCalledWith(3600);
  view.rerender(<GenerationCountControl {...props} onGenerate={generate} onIntervalChange={interval} intervalSeconds={3600} />);
  expect(input.value).toBe('3600.0'); expect(increase).toHaveProperty('disabled', true);
  fireEvent.click(decrease); expect(interval).toHaveBeenLastCalledWith(3599.9);
  expect(generate).not.toHaveBeenCalled();
});

it('输入间隔后点加减只保存调整后的值一次', () => {
  const interval = vi.fn();
  render(<GenerationCountControl {...props} onIntervalChange={interval} intervalSeconds={2} />);
  fireEvent.keyDown(screen.getByRole('button', { name: /生成.*3 张/ }), { key: 'ArrowDown', altKey: true });
  const input = screen.getByLabelText('生成间隔') as HTMLInputElement;
  const increase = screen.getByRole('button', { name: '增加生成间隔' });
  input.focus(); fireEvent.change(input, { target: { value: '2.5' } });
  fireEvent.blur(input, { relatedTarget: increase });
  fireEvent.click(increase);
  expect(interval.mock.calls).toEqual([[2.6]]);
  expect(input.value).toBe('2.6');
});
it('关闭连续生成时空闲只保留单张生成，重新开启后恢复工作台选项', () => {
  const count = vi.fn(), interval = vi.fn(), queue = vi.fn(), generate = vi.fn();
  const view = render(<GenerationCountControl {...props} count={7} continuousGenerationEnabled={false} onCountChange={count} onIntervalChange={interval} onQueue={queue} onGenerate={generate} />);
  const main = screen.getByRole('button', { name: /生成.*90 Anlas/ });
  expect(screen.queryByText('0/0')).toBeNull();
  expect(screen.queryByText('7 张')).toBeNull();
  expect(screen.queryByLabelText('生成张数')).toBeNull();
  expect(screen.queryByLabelText('生成间隔')).toBeNull();
  expect(screen.queryByTitle('生成选项')).toBeNull();
  fireEvent.keyDown(main, { key: 'ArrowDown', altKey: true });
  expect(screen.queryByRole('dialog', { name: '生成选项' })).toBeNull();
  fireEvent.click(main);
  expect(generate).toHaveBeenCalledOnce(); expect(queue).not.toHaveBeenCalled();

  view.rerender(<GenerationCountControl {...props} count={1} continuousGenerationEnabled onCountChange={count} onIntervalChange={interval} onQueue={queue} onGenerate={generate} />);
  fireEvent.keyDown(screen.getByRole('button', { name: /生成.*1 张/ }), { key: 'ArrowDown', altKey: true });
  expect((screen.getByLabelText('生成张数') as HTMLInputElement).value).toBe('1');
  expect((screen.getByLabelText('生成间隔') as HTMLInputElement).value).toBe('2.0');
  fireEvent.click(within(screen.getByRole('dialog', { name: '生成选项' })).getByRole('button', { name: '增加生成张数' }));
  expect(count).toHaveBeenLastCalledWith(2);
});

it('关闭连续生成时保留真实忙碌、暂停与系列管理，但不把空队伍当成正在生成', () => {
  const toggle = vi.fn(), queue = vi.fn(), generate = vi.fn();
  const view = render(<GenerationCountControl {...props} continuousGenerationEnabled={false} onTogglePause={toggle} onQueue={queue} onGenerate={generate} queueState={state} />);
  const busyButton = screen.getByRole('button', { name: '生成中…' });
  expect(busyButton.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(busyButton); expect(generate).not.toHaveBeenCalled(); expect(queue).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '暂停生成' })); expect(toggle).toHaveBeenCalledOnce();
  view.rerender(<GenerationCountControl {...props} continuousGenerationEnabled={false} busy onTogglePause={toggle} onQueue={queue} onGenerate={generate} queueState={{ ...state, busy: false, completed: 2, total: 2 }} />);
  expect(screen.getByRole('button', { name: '生成中…' }).getAttribute('aria-disabled')).toBe('true');

  view.rerender(<GenerationCountControl {...props} continuousGenerationEnabled={false} onTogglePause={toggle} onQueue={queue} onGenerate={generate} queueState={{ ...state, busy: true, completed: 2, total: 2, paused: true }} />);
  const pausedButton = screen.getByRole('button', { name: '生成' });
  expect(pausedButton.getAttribute('aria-disabled')).toBe('true');
  expect(screen.queryByText('0/0')).toBeNull();
  fireEvent.click(pausedButton); expect(generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '继续生成' })); expect(toggle).toHaveBeenCalledTimes(2);

  view.rerender(<GenerationCountControl {...props} continuousGenerationEnabled={false} onTogglePause={toggle} onQueue={queue} onGenerate={generate} series={{ current: 1, total: 3, stopping: false }} />);
  expect(screen.getByRole('button', { name: '生成中…' }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '暂停生成' })); expect(toggle).toHaveBeenCalledTimes(3);
  view.rerender(<GenerationCountControl {...props} continuousGenerationEnabled={false} busy onTogglePause={toggle} series={{ current: 2, total: 3, stopping: false }} />);
  expect(screen.queryByRole('button', { name: '暂停生成' })).toBeNull();

  view.rerender(<GenerationCountControl {...props} continuousGenerationEnabled={false} onTogglePause={toggle} onQueue={queue} onGenerate={generate} queueDisabled unavailableLabel="请先选择底图" queueState={state} />);
  expect(screen.getByRole('button', { name: '请先选择底图' })).toBeTruthy();
});

it('关闭连续生成后普通单张全程只显示生成主按钮，完成后可再次生成', () => {
  const generate = vi.fn(), queue = vi.fn(), pause = vi.fn();
  const control = { ...props, count: 1, continuousGenerationEnabled: false, onGenerate: generate, onQueue: queue, onTogglePause: pause };
  const view = render(<GenerationCountControl {...control} busy series={{ current: 0, total: 1, stopping: false }}
    queueState={{ busy: true, completed: 0, total: 1, paused: false, pausing: false, waiting: [] }} />);
  expect(screen.queryByText('0/1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '生成中…' }));
  expect(generate).not.toHaveBeenCalled();
  expect(queue).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '暂停生成' })).toBeNull();
  expect(screen.queryByRole('button', { name: '继续生成' })).toBeNull();
  view.rerender(<GenerationCountControl {...control} series={{ current: 1, total: 1, stopping: false }}
    queueState={{ busy: false, completed: 1, total: 1, paused: false, pausing: false, waiting: [] }} />);
  expect(screen.queryByText('1/1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /生成.*90 Anlas/ }));
  expect(generate).toHaveBeenCalledOnce();
  expect(queue).not.toHaveBeenCalled();
});

it('已完成快照与残留完成系列不转成队列动作，空闲普通生成仍遵守 disabled', () => {
  const queue = vi.fn(), generate = vi.fn();
  const view = render(<GenerationCountControl {...props} onQueue={queue} onGenerate={generate} disabled queueState={{ ...state, busy: true, completed: 2, total: 2 }} />);
  const main = screen.getByRole('button', { name: /生成.*3 张/ });
  expect(main.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(main); expect(queue).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();

  view.rerender(<GenerationCountControl {...props} onQueue={queue} onGenerate={generate} queueState={{ ...state, busy: true, completed: 2, total: 2 }} />);
  fireEvent.click(screen.getByRole('button', { name: /生成.*3 张/ }));
  expect(generate).toHaveBeenCalledOnce(); expect(queue).not.toHaveBeenCalled();

  view.rerender(<GenerationCountControl {...props} onQueue={queue} onGenerate={generate} series={{ current: 3, total: 3, stopping: false }} />);
  fireEvent.click(screen.getByRole('button', { name: /生成.*3 张/ }));
  expect(generate).toHaveBeenCalledTimes(2); expect(queue).not.toHaveBeenCalled();

  view.rerender(<GenerationCountControl {...props} continuousGenerationEnabled={false} onQueue={queue} onGenerate={generate} queueState={{ ...state, busy: true, completed: 2, total: 2 }} />);
  expect(screen.getByRole('button', { name: /生成.*90 Anlas/ })).toBeTruthy();
  expect(screen.queryByText('0/0')).toBeNull(); expect(screen.queryByText('3 张')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /生成.*90 Anlas/ }));
  expect(generate).toHaveBeenCalledTimes(3); expect(queue).not.toHaveBeenCalled();

  view.rerender(<GenerationCountControl {...props} continuousGenerationEnabled={false} onQueue={queue} onGenerate={generate} series={{ current: 3, total: 3, stopping: false }} />);
  fireEvent.click(screen.getByRole('button', { name: /生成.*90 Anlas/ }));
  expect(generate).toHaveBeenCalledTimes(4); expect(queue).not.toHaveBeenCalled();
});

it('关闭连续生成后仅剩的旧等待项仍可取消，菜单没有追加且空后自动收起', () => {
  const cancel = vi.fn(), queue = vi.fn(), generate = vi.fn();
  const waiting = [{ id: 'old', progress: { current: 0, total: 2, stopping: false, position: 1 }, onCancel: cancel }];
  const view = render(<GenerationCountControl {...props} continuousGenerationEnabled={false} onQueue={queue} onGenerate={generate} onIntervalChange={vi.fn()} queued={waiting} />);
  const main = screen.getByRole('button', { name: '生成中…' });
  fireEvent.keyDown(main, { key: 'ArrowDown', altKey: true });
  const panel = within(screen.getByRole('dialog', { name: '生成选项' }));
  expect(panel.getByText('2 张 · 等待第 1 位')).toBeTruthy();
  expect(panel.queryByLabelText('生成张数')).toBeNull();
  expect(panel.queryByLabelText('生成间隔')).toBeNull();
  expect(panel.queryByRole('button', { name: '加入队列' })).toBeNull();
  expect(panel.queryByRole('button', { name: '排到下一位' })).toBeNull();
  fireEvent.click(panel.getByRole('button', { name: '取消待生成任务' }));
  expect(cancel).toHaveBeenCalledOnce(); expect(queue).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();

  view.rerender(<GenerationCountControl {...props} continuousGenerationEnabled={false} onQueue={queue} onGenerate={generate} onIntervalChange={vi.fn()} />);
  expect(screen.queryByRole('dialog', { name: '生成选项' })).toBeNull();
  expect(screen.queryByTitle('生成选项')).toBeNull();
  fireEvent.keyDown(main, { key: 'ArrowDown', altKey: true });
  expect(screen.queryByRole('dialog', { name: '生成选项' })).toBeNull();
});
it('生成中显示整队进度、本批张数与总资源，主按钮可加入队列', () => {
  const queue = vi.fn(); const view = render(<GenerationCountControl {...props} onQueue={queue} queueState={state} />);
  expect(screen.getByText('2/8')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /加入队列.*3 张.*90 Anlas/ })); expect(queue).toHaveBeenCalledWith('end');
  view.rerender(<GenerationCountControl {...props} queueState={{ ...state, total: 11, completed: 3 }} />);
  expect(screen.getByText('3/11')).toBeTruthy(); expect(screen.queryByLabelText('生成张数')).toBeNull();
});
it('整队快照暂不可读时按后台已保存张数回退，不把完成数误减一', () => {
  const view = render(<GenerationCountControl {...props} series={{ current: 2, total: 3, stopping: false }} />);
  expect(screen.getByText('2/3')).toBeTruthy();
  view.rerender(<GenerationCountControl {...props} series={{ current: 3, total: 3, stopping: false }} />);
  expect(screen.getByText('3/3')).toBeTruthy();
});
it('暂停中不可重复点击，保存后变继续，队列暂停仍能添加', () => {
  const toggle = vi.fn(), queue = vi.fn();
  const view = render(<GenerationCountControl {...props} onQueue={queue} onTogglePause={toggle} queueState={state} />);
  fireEvent.click(screen.getByRole('button', { name: '暂停生成' })); expect(toggle).toHaveBeenCalledOnce();
  view.rerender(<GenerationCountControl {...props} onTogglePause={toggle} queueState={{ ...state, paused: true, pausing: true }} />);
  expect(screen.getByRole('button', { name: '暂停中…' })).toHaveProperty('disabled', true);
  view.rerender(<GenerationCountControl {...props} onQueue={queue} onTogglePause={toggle} queueState={{ ...state, completed: 3, paused: true }} />);
  fireEvent.click(screen.getByRole('button', { name: '继续生成' })); expect(toggle).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: /加入队列/ })); expect(queue).toHaveBeenCalledOnce();
});
it.each([1280, 390])('%s 宽度菜单收纳张数、插队和取消，Esc 归还焦点', width => {
  vi.stubGlobal('innerWidth', width); const queue = vi.fn(), count = vi.fn(), cancel = vi.fn();
  render(<GenerationCountControl {...props} onQueue={queue} onCountChange={count} queueState={state} queued={[{ id: 'test', progress: { current: 0, total: 3, stopping: false, position: 1 }, onCancel: cancel }]} />);
  const button = screen.getByRole('button', { name: /加入队列/ }); button.focus(); fireEvent.keyDown(button, { key: 'ArrowDown', altKey: true });
  const panel = screen.getByRole('dialog', { name: '生成选项' });
  fireEvent.change(within(panel).getByLabelText('生成张数'), { target: { value: '4' } }); expect(count).toHaveBeenCalledWith(4);
  fireEvent.click(within(panel).getByRole('button', { name: '取消待生成任务' })); expect(cancel).toHaveBeenCalledOnce();
  fireEvent.click(within(panel).getByRole('button', { name: '排到下一位' })); expect(queue).toHaveBeenCalledWith('next');
  fireEvent.keyDown(button, { key: 'ArrowDown', altKey: true }); fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(button);
});
it('画布未就绪主按钮不发送，菜单仍可查看；空闲恢复生成', () => {
  const generate = vi.fn(), queue = vi.fn(); const view = render(<GenerationCountControl {...props} onGenerate={generate} onQueue={queue} disabled queueDisabled unavailableLabel="请先选择底图" />);
  const unavailable = screen.getByRole('button', { name: '请先选择底图' });
  fireEvent.click(unavailable); expect(generate).not.toHaveBeenCalled(); expect(queue).not.toHaveBeenCalled();
  fireEvent.keyDown(unavailable, { key: 'ArrowDown', altKey: true });
  expect(screen.getByRole('dialog', { name: '生成选项' })).toBeTruthy();
  view.rerender(<GenerationCountControl {...props} onGenerate={generate} queueState={{ ...state, busy: false, total: 0, completed: 0 }} />);
  expect(screen.getByRole('button', { name: '暂停生成' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: /生成.*3 张.*90 Anlas/ })); expect(generate).toHaveBeenCalledOnce();
});

it('菜单内的紧凑张数控件支持加减、直接输入和下限，调整不会触发生图', () => {
  const count = vi.fn(), generate = vi.fn();
  const view = render(<GenerationCountControl {...props} count={1} onCountChange={count} onGenerate={generate} />);
  fireEvent.keyDown(screen.getByRole('button', { name: /生成.*1 张/ }), { key: 'ArrowDown', altKey: true });
  expect(screen.getByRole('button', { name: '减少生成张数' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '增加生成张数' })); expect(count).toHaveBeenLastCalledWith(2);
  view.rerender(<GenerationCountControl {...props} count={2} onCountChange={count} onGenerate={generate} />);
  fireEvent.click(screen.getByRole('button', { name: '减少生成张数' })); expect(count).toHaveBeenLastCalledWith(1);
  fireEvent.change(screen.getByLabelText('生成张数'), { target: { value: '0' } });
  expect(count).toHaveBeenCalledTimes(2);
  fireEvent.blur(screen.getByLabelText('生成张数')); expect((screen.getByLabelText('生成张数') as HTMLInputElement).value).toBe('2');
  expect(generate).not.toHaveBeenCalled();
});

it.each([false, true])('空闲与忙碌（%s）时菜单始终保留加入队列和下一位，操作位置准确', busy => {
  const queue = vi.fn(); render(<GenerationCountControl {...props} onQueue={queue} queueState={{ ...state, busy, total: busy ? 8 : 0 }} />);
  const open = () => fireEvent.keyDown(screen.getByRole('button', { name: /^(生成|加入队列).*3 张/ }), { key: 'ArrowDown', altKey: true });
  open(); fireEvent.click(within(screen.getByRole('dialog', { name: '生成选项' })).getByRole('button', { name: '加入队列' }));
  expect(queue).toHaveBeenLastCalledWith('end');
  open(); fireEvent.click(within(screen.getByRole('dialog', { name: '生成选项' })).getByRole('button', { name: '排到下一位' }));
  expect(queue).toHaveBeenLastCalledWith('next'); expect(screen.queryByRole('dialog')).toBeNull();
});

it('桌面调整宽度时菜单保持展开，切到手机断点才关闭', () => {
  vi.stubGlobal('innerWidth', 1280); render(<GenerationCountControl {...props} />);
  fireEvent.keyDown(screen.getByRole('button', { name: /生成.*3 张/ }), { key: 'ArrowDown', altKey: true });
  expect(screen.getByRole('dialog', { name: '生成选项' })).toBeTruthy();
  vi.stubGlobal('innerWidth', 1360); fireEvent(window, new Event('resize'));
  expect(screen.getByRole('dialog', { name: '生成选项' })).toBeTruthy();
  vi.stubGlobal('innerWidth', 390); fireEvent(window, new Event('resize'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('桌面菜单锚定整个生成按钮的中心，不以右侧箭头为中心', () => {
  vi.stubGlobal('innerWidth', 1280); vi.stubGlobal('innerHeight', 800);
  render(<GenerationCountControl {...props} />);
  const button = screen.getByRole('button', { name: /生成.*3 张/ });
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ x: 600, y: 700, left: 600, top: 700, right: 800, bottom: 744, width: 200, height: 44, toJSON: () => ({}) });
  fireEvent.keyDown(button, { key: 'ArrowDown', altKey: true });
  expect(screen.getByRole('dialog', { name: '生成选项' }).style.left).toBe('700px');
});

it.each([1280, 390])('%s 保存末期计数已完成仍显示保存且不能再次生成', width => {
  vi.stubGlobal('innerWidth', width);
  const generate = vi.fn();
  render(<GenerationCountControl {...props} continuousGenerationEnabled={false} onGenerate={generate} generationState="saving" series={{ current: 1, total: 1, stopping: false }} queueState={{ ...state, completed: 1, total: 1 }} />);
  const button = screen.getByRole('button', { name: '正在保存…' });
  expect(button.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(button);
  expect(generate).not.toHaveBeenCalled();
});
