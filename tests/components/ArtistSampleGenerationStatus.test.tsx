// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArtistSampleGenerationStatus } from '../../components/useArtistSampleActions';
import { ImageActivityContext } from '../../components/SmartImage';

const mocks = vi.hoisted(() => ({ retry: vi.fn(), stop: vi.fn() }));
vi.mock('../../services/artistSampleGeneration', async original => ({ ...await original<typeof import('../../services/artistSampleGeneration')>(), retryArtistSampleSave: mocks.retry }));
vi.mock('../../services/generationSeries', async original => ({ ...await original<typeof import('../../services/generationSeries')>(), stopGenerationSeriesSession: mocks.stop }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const setup = (generation: any, busy = true) => {
  const supplement = vi.fn(), manage = vi.fn(), select = vi.fn();
  const props = { tag: 'artist-a', pack: 'v5' as const, generation, busy, hasOwnSamples: false, supplementSample: supplement, manageGeneration: manage };
  const view = render(<div onClick={select} onPointerDown={select} onKeyDown={select}><ArtistSampleGenerationStatus {...props} /></div>);
  return { ...view, props, supplement, manage, select };
};

it.each(['generating', 'saving'])('%s只显示卡片右下角加载圈，不增加原占位行，点击后保留取消动作', phase => {
  const session = { state: 'running' }, view = setup({ phase, session });
  const button = screen.getByRole('button');
  expect(button.parentElement?.className).toBe('absolute bottom-2 right-2 z-30');
  expect(button.querySelector('svg')?.classList.contains('animate-spin')).toBe(true);
  expect(screen.queryByRole('status')).toBeNull(); expect(screen.queryByText('取消')).toBeNull();
  fireEvent.pointerDown(button); fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.click(button);
  expect(view.select).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toBe(phase === 'saving' ? '正在保存样张…' : '正在生成样张…');
  fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(mocks.stop).toHaveBeenCalledWith(session);
});

it.each([{ state: 'paused', label: '任务已暂停', action: 'resume', button: '继续' }, { state: 'running', awaiting: { cost: 1 }, label: '等待费用确认', action: 'approve', button: '确认费用' }])('等待状态使用静态图标，$label保留原操作', item => {
  const view = setup({ phase: 'generating', session: item }, false);
  view.manage.mockImplementation(() => { expect(screen.queryByRole('dialog')).toBeNull(); return Promise.resolve(); });
  const button = screen.getByRole('button', { name: item.label });
  expect(button.querySelector('svg')?.classList.contains('animate-spin')).toBe(false);
  fireEvent.click(button); fireEvent.click(screen.getByRole('button', { name: item.button }));
  expect(view.manage).toHaveBeenCalledWith('artist-a', 'v5', item.action);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('状态浮层中真实按钮的Tab事件仍到达焦点圈禁，Esc关闭后归还入口', () => {
  setup({ phase: 'generating', session: { state: 'running' } });
  const trigger = screen.getByRole('button'); trigger.focus(); fireEvent.click(trigger);
  const cancel = within(screen.getByRole('dialog')).getByRole('button', { name: '取消' });
  expect(document.activeElement).toBe(cancel);
  expect(fireEvent.keyDown(cancel, { key: 'Tab' })).toBe(false);
  expect(document.activeElement).toBe(cancel);
  expect(fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })).toBe(false);
  expect(document.activeElement).toBe(cancel);
  fireEvent.keyDown(cancel, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
});

it('归档失败只重试保存，失败预览仍能主动补图', () => {
  const view = setup({ phase: 'save_failed', error: '合成归档失败' }, false);
  fireEvent.click(screen.getByRole('button', { name: '重试保存样张' }));
  expect(screen.getByRole('alert').textContent).toBe('合成归档失败');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '重试保存样张' })); expect(mocks.retry).toHaveBeenCalledWith('artist-a', 'v5');
  view.unmount();
  const failed = setup({ phase: 'failed', error: '合成失败', preview: 'preview' }, false);
  const button = screen.getByRole('button', { name: '合成失败' }); expect(button.querySelector('svg')?.classList.contains('animate-spin')).toBe(false);
  fireEvent.click(button); expect(screen.getAllByText('合成失败')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '补充样张' }));
  expect(failed.supplement).toHaveBeenCalledWith('artist-a', 'v5');
});

it('保活页隐藏时关闭已打开的状态浮层，正常空闲不占位', () => {
  const view = setup({ phase: 'generating' }); fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  view.rerender(<ImageActivityContext.Provider value={false}><ArtistSampleGenerationStatus {...view.props} /></ImageActivityContext.Provider>);
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<ArtistSampleGenerationStatus {...view.props} generation={undefined} busy={false} />);
  expect(view.container.textContent).toBe('');
});

it('任务完成后新任务和切换画师版本均不会自动打开旧状态面板', () => {
  const view = setup({ phase: 'generating' });
  fireEvent.click(screen.getByRole('button')); expect(screen.getByRole('dialog')).toBeTruthy();
  view.rerender(<ArtistSampleGenerationStatus {...view.props} generation={{ phase: 'saved' } as any} busy={false} />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<ArtistSampleGenerationStatus {...view.props} />);
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('button')).toBeTruthy();
  fireEvent.click(screen.getByRole('button'));
  view.rerender(<ArtistSampleGenerationStatus {...view.props} pack="v45" />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button'));
  view.rerender(<ArtistSampleGenerationStatus {...view.props} pack="v45" tag="another-artist" />);
  expect(screen.queryByRole('dialog')).toBeNull();
});
