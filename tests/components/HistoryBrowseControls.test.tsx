// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryBrowseControls } from '../../components/HistoryBrowseControls';
import type { HistoryBrowseQuery } from '../../services/historyBrowse';
import { setLanguage, t } from '../../services/i18n';

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { cleanup(); setLanguage('zh-CN'); vi.useRealTimers(); vi.unstubAllGlobals(); });
const setup = (query: HistoryBrowseQuery = { sort: 'newest' }, mobile = false) => {
  const onApply = vi.fn();
  const Harness = () => {
    const [current, setCurrent] = useState(query);
    return <HistoryBrowseControls query={current} mobile={mobile} onApply={next => { onApply(next); setCurrent(next); }} options={{ models: ['model-a'], sources: [{ id: 'preset', name: '合成来源' }] }} />;
  };
  const result = render(<div className="agent-stage safe-mode dark"><main className="isolate"><header><div className="history-toolbar-shell"><Harness /></div></header></main></div>);
  return { ...result, onApply };
};
const openFilters = () => fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + t('筛选{0}', [''])) }));

const legend = () => screen.getByText((_, element) => element?.tagName === 'LEGEND');

it.each(['en', 'ja', 'ko'] as const)('%s：全部时间及单侧日期边界随界面语言翻译', language => {
  setLanguage(language);
  const { unmount } = setup();
  openFilters();
  expect(legend().textContent).toContain(t('全部时间'));
  unmount();
  const fromView = setup({ from: new Date('2026-01-02T00:00:00').getTime() });
  openFilters();
  expect(legend().textContent).toContain(t('至今'));
  fromView.unmount();
  setup({ to: new Date('2026-01-02T00:00:00').getTime() });
  openFilters();
  expect(legend().textContent).toContain(t('不限'));
});

describe('历史筛选弹层', () => {
  it('顶栏只留一个筛选入口，常驻不再有日期、收藏、排序或随机按钮', () => {
    const { container } = setup();
    const header = within(container.querySelector('header')!);
    expect(header.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['筛选']);
    expect(header.queryByRole('combobox')).toBeNull();
    expect(header.queryByRole('textbox')).toBeNull();
  });

  it('筛选弹层集中时间、收藏、模型、方式、来源、排序与随机浏览', () => {
    setup({ sort: 'newest' });
    openFilters();
    const dialog = within(screen.getByRole('dialog', { name: '筛选' }));
    expect(dialog.getByLabelText('开始日期')).toBeTruthy();
    expect(dialog.getByRole('button', { name: '只看收藏' }).getAttribute('aria-pressed')).toBe('false');
    expect(dialog.getByRole('combobox', { name: '历史模型' })).toBeTruthy();
    expect(dialog.getByRole('combobox', { name: '历史生成方式' })).toBeTruthy();
    expect(dialog.getByRole('combobox', { name: '历史来源' })).toBeTruthy();
    expect(dialog.getByRole('combobox', { name: '历史排序' })).toBeTruthy();
    expect(dialog.getByRole('button', { name: '随机浏览' })).toBeTruthy();
    expect(dialog.queryByPlaceholderText('可选关键词…')).toBeNull();
  });

  it('应用筛选只合并本弹层条件，保留随机种子与其他范围', () => {
    const { onApply } = setup({ sort: 'random', seed: 'fixed', from: 123, to: 456 });
    openFilters();
    fireEvent.change(screen.getByRole('combobox', { name: '历史模型' }), { target: { value: 'model-a' } });
    fireEvent.change(screen.getByRole('combobox', { name: '历史生成方式' }), { target: { value: 'inpaint' } });
    fireEvent.change(screen.getByRole('combobox', { name: '历史来源' }), { target: { value: 'preset' } });
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-a', operation: 'inpaint', source: 'preset', sort: 'random', seed: 'fixed', from: 123, to: 456 }));
    expect(screen.getByRole('button', { name: '筛选 4' })).toBeTruthy();
  });

  it('取消草稿不查询，重开恢复已应用值', () => {
    const { onApply } = setup({ sort: 'oldest', search: '已应用', model: 'model-a', from: 123 });
    openFilters();
    fireEvent.change(screen.getByRole('combobox', { name: '历史模型' }), { target: { value: '' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onApply).not.toHaveBeenCalled();
    openFilters();
    expect((screen.getByRole('combobox', { name: '历史模型' }) as HTMLSelectElement).value).toBe('model-a');
  });

  it('只看收藏即时切换，取消收藏恢复最新排序并保留其他条件', () => {
    const { onApply } = setup({ sort: 'favorite', model: 'model-a', from: 123, favoriteOnly: true });
    openFilters();
    expect((screen.getByRole('combobox', { name: '历史排序' }) as HTMLSelectElement).value).toBe('favorite');
    const favButton = screen.getByRole('button', { name: '只看收藏' });
    expect(favButton.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(favButton);
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ favoriteOnly: false, sort: 'newest', model: 'model-a', from: 123 }));
  });

  it('随机进入和再次洗牌保留全部范围，时间排序退出随机', () => {
    const { onApply } = setup({ sort: 'oldest', favoriteOnly: true, source: 'preset', from: 123, search: '词' });
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: '随机浏览' }));
    const first = onApply.mock.calls.at(-1)![0];
    expect(first).toEqual(expect.objectContaining({ sort: 'random', seed: expect.any(String), favoriteOnly: true, source: 'preset', from: 123, search: '词' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: '重新洗牌' }));
    expect(onApply.mock.calls.at(-1)![0].seed).not.toBe(first.seed);
    openFilters();
    fireEvent.change(screen.getByRole('combobox', { name: '历史排序' }), { target: { value: 'oldest' } });
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'oldest', seed: undefined, favoriteOnly: true, from: 123 }));
  });

  it('自定义日期完整包含首尾当天，错误日期不应用，也不改变其他范围', () => {
    const { onApply } = setup({ sort: 'random', seed: 'fixed', source: 'preset' });
    openFilters();
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-03' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('开始日期不能晚于结束日期');
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-02' } });
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'random', seed: 'fixed', source: 'preset', from: new Date('2026-10-01T00:00:00').getTime(), to: new Date('2026-10-02T23:59:59.999').getTime() }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('日期快捷选择即时应用，不限日期只清除日期', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T12:00:00'));
    const { onApply } = setup({ sort: 'oldest', favoriteOnly: true, model: 'model-a' });
    openFilters(); fireEvent.click(screen.getByRole('button', { name: '近 7 天' }));
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ from: new Date('2026-09-26T00:00:00').getTime(), to: new Date('2026-10-02T23:59:59.999').getTime(), sort: 'oldest', favoriteOnly: true, model: 'model-a' }));
    fireEvent.click(screen.getByRole('button', { name: '不限日期' }));
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ from: undefined, to: undefined, model: 'model-a', favoriteOnly: true }));
  });

  it('重置筛选清空全部条件并恢复最新排序', () => {
    const { onApply } = setup({ sort: 'random', seed: 'fixed', favoriteOnly: true, model: 'model-a', from: 123 });
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
    expect(onApply).toHaveBeenLastCalledWith({ sort: 'newest', seed: undefined });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('手机模式用底部面板承载同一份筛选，弹层挂在主题根节点', () => {
    const { container } = setup({ sort: 'random', seed: 'fixed', favoriteOnly: true, from: 123, model: 'model-a' }, true);
    openFilters();
    const dialog = screen.getByRole('dialog', { name: '筛选' });
    expect(dialog.closest('main')).toBeNull();
    expect(dialog.closest('.safe-mode.dark')).toBe(container.firstElementChild);
    expect(within(dialog).getByLabelText('开始日期')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  });
});
