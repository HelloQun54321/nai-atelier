// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryBrowseControls } from '../../components/HistoryBrowseControls';
import type { HistoryBrowseQuery } from '../../services/historyBrowse';

let workWidth: number;
let resize: (width: number) => void;
beforeEach(() => {
  workWidth = 1200;
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: HTMLElement) {
      if (element.classList.contains('history-toolbar-shell')) {
        resize = width => { workWidth = width; this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); };
        resize(workWidth);
      }
    }
    disconnect() {}
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const setup = (query: HistoryBrowseQuery = { sort: 'newest' }, mobile = false) => {
  const onApply = vi.fn();
  const Harness = () => {
    const [current, setCurrent] = useState(query);
    return <HistoryBrowseControls query={current} mobile={mobile} onApply={next => { onApply(next); setCurrent(next); }} options={{ models: ['model-a'], sources: [{ id: 'preset', name: '合成来源' }] }} />;
  };
  const result = render(<div className="agent-stage safe-mode dark"><main className="isolate"><header><div className="history-toolbar-shell"><Harness /></div></header></main></div>);
  return { ...result, onApply };
};
const more = () => fireEvent.click(screen.getByRole('button', { name: /^更多筛选/ }));
const date = () => fireEvent.click(screen.getByRole('button', { name: /^时间范围：/ }));

describe('历史单行顶栏', () => {
  it('范围、更多条件、排序、随机依序直接可达，没有常驻搜索或重复控制', () => {
    const { container, onApply } = setup();
    const header = within(container.querySelector('header')!);
    expect(header.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['时间范围：全部时间', '只看收藏', '更多筛选', '随机浏览']);
    const sort = header.getByRole('combobox', { name: '历史排序' });
    expect(header.queryByRole('textbox')).toBeNull();
    fireEvent.change(sort, { target: { value: 'oldest' } });
    expect(onApply).toHaveBeenLastCalledWith({ sort: 'oldest', seed: undefined });
    more();
    const dialog = within(screen.getByRole('dialog', { name: '更多筛选' }));
    expect(dialog.queryByRole('combobox', { name: '历史排序' })).toBeNull();
    expect(dialog.queryByRole('checkbox', { name: '只看收藏' })).toBeNull();
    expect(dialog.queryByLabelText('开始日期')).toBeNull();
  });
  it('最近收藏仅在收藏范围提供，取消收藏立即恢复最新排序并保留其他条件', () => {
    const { onApply } = setup({ sort: 'newest', model: 'model-a', from: 123 });
    expect(screen.queryByRole('option', { name: '最近收藏' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '只看收藏' }));
    fireEvent.change(screen.getByRole('combobox', { name: '历史排序' }), { target: { value: 'favorite' } });
    fireEvent.click(screen.getByRole('button', { name: '只看收藏' }));
    expect((screen.getByRole('combobox', { name: '历史排序' }) as HTMLSelectElement).value).toBe('newest');
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ favoriteOnly: false, sort: 'newest', model: 'model-a', from: 123 }));
  });
  it('随机进入和再次洗牌不增加按钮，保留全部范围，时间排序退出随机', () => {
    const { container, onApply } = setup({ sort: 'oldest', favoriteOnly: true, source: 'preset', from: 123, search: '词' });
    const before = container.querySelector('header')!.querySelectorAll('button').length;
    fireEvent.click(screen.getByRole('button', { name: '随机浏览' }));
    const first = onApply.mock.calls.at(-1)![0];
    expect(first).toEqual(expect.objectContaining({ sort: 'random', seed: expect.any(String), favoriteOnly: true, source: 'preset', from: 123, search: '词' }));
    expect((screen.getByRole('combobox', { name: '历史排序' }) as HTMLSelectElement).value).toBe('random');
    fireEvent.click(screen.getByRole('button', { name: '重新洗牌' }));
    expect(onApply.mock.calls.at(-1)![0].seed).not.toBe(first.seed);
    expect(container.querySelector('header')!.querySelectorAll('button')).toHaveLength(before);
    fireEvent.change(screen.getByRole('combobox', { name: '历史排序' }), { target: { value: 'oldest' } });
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'oldest', seed: undefined, favoriteOnly: true, from: 123 }));
    expect(screen.getByRole('button', { name: '随机浏览' })).toBeTruthy();
  });
  it('更多筛选只修改自己的条件，保留日期、收藏和固定随机种子', () => {
    const { onApply } = setup({ sort: 'random', seed: 'fixed', favoriteOnly: true, from: 123, to: 456 });
    more();
    fireEvent.change(screen.getByPlaceholderText('可选关键词…'), { target: { value: '关键词' } });
    fireEvent.change(screen.getByRole('combobox', { name: '历史模型' }), { target: { value: 'model-a' } });
    fireEvent.change(screen.getByRole('combobox', { name: '历史生成方式' }), { target: { value: 'inpaint' } });
    fireEvent.change(screen.getByRole('combobox', { name: '历史来源' }), { target: { value: 'preset' } });
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ search: '关键词', model: 'model-a', operation: 'inpaint', source: 'preset', sort: 'random', seed: 'fixed', favoriteOnly: true, from: 123, to: 456 }));
    expect(screen.getByRole('button', { name: '更多筛选 4' })).toBeTruthy();
  });
  it('取消更多条件草稿不查询，重开恢复已应用值，重置不清除外露条件', () => {
    const { onApply } = setup({ sort: 'oldest', favoriteOnly: true, search: '已应用', model: 'model-a', from: 123 });
    more();
    fireEvent.change(screen.getByPlaceholderText('可选关键词…'), { target: { value: '未应用' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onApply).not.toHaveBeenCalled();
    more();
    expect((screen.getByPlaceholderText('可选关键词…') as HTMLInputElement).value).toBe('已应用');
    fireEvent.click(screen.getByRole('button', { name: '重置更多筛选' }));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'oldest', favoriteOnly: true, from: 123, search: '', model: '', source: '', operation: '' }));
  });
  it('自定义日期完整包含首尾当天，错误日期不应用，也不改变其他范围', () => {
    const { onApply } = setup({ sort: 'random', seed: 'fixed', source: 'preset' });
    date();
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-03' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: '应用日期' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('开始日期不能晚于结束日期');
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-02' } });
    fireEvent.click(screen.getByRole('button', { name: '应用日期' }));
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'random', seed: 'fixed', source: 'preset', from: new Date('2026-10-01T00:00:00').getTime(), to: new Date('2026-10-02T23:59:59.999').getTime() }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('日期快捷选择即时应用，不限日期只清除日期', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T12:00:00'));
    const { onApply } = setup({ sort: 'oldest', favoriteOnly: true, model: 'model-a' });
    date(); fireEvent.click(screen.getByRole('button', { name: '近 7 天' }));
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ from: new Date('2026-09-26T00:00:00').getTime(), to: new Date('2026-10-02T23:59:59.999').getTime(), sort: 'oldest', favoriteOnly: true, model: 'model-a' }));
    date(); fireEvent.click(screen.getByRole('button', { name: '不限日期' }));
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ from: undefined, to: undefined, model: 'model-a', favoriteOnly: true }));
  });
  it.each([false, true])('实际工作区窄于 700 时日期进入更多筛选，手机模式 %s 保留根层和主题', mobile => {
    workWidth = 620;
    const { container, onApply } = setup({ sort: 'random', seed: 'fixed', favoriteOnly: true, from: 123, model: 'model-a' }, mobile);
    expect(screen.queryByRole('button', { name: /^时间范围：/ })).toBeNull();
    expect(screen.getByRole('button', { name: '更多筛选 2' })).toBeTruthy();
    more();
    const dialog = screen.getByRole('dialog', { name: '更多筛选' });
    expect(dialog.closest('main')).toBeNull();
    expect(dialog.closest('.safe-mode.dark')).toBe(container.firstElementChild);
    expect(screen.getByLabelText('开始日期')).toBeTruthy();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重置更多筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'random', seed: 'fixed', favoriteOnly: true, model: '', from: undefined, to: undefined }));
  });
  it('侧栏挤窄工作区时取消未应用草稿；恢复空间后日期回到首位且条件不丢失', () => {
    const { onApply } = setup({ sort: 'newest', model: 'model-a', from: 123 });
    date();
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } });
    act(() => resize(620));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
    more();
    expect((screen.getByLabelText('开始日期') as HTMLInputElement).value).toBe('1970-01-01');
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => resize(1200));
    expect(screen.getByRole('button', { name: /^时间范围：/ })).toBeTruthy();
    more(); expect(screen.queryByLabelText('开始日期')).toBeNull();
    expect((screen.getByRole('combobox', { name: '历史模型' }) as HTMLSelectElement).value).toBe('model-a');
  });
});
