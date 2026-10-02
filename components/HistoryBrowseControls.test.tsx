// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryBrowseControls } from './HistoryBrowseControls';
import type { HistoryBrowseQuery } from '../services/historyBrowse';
beforeEach(() => {
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const setup = (query: HistoryBrowseQuery = { sort: 'newest' }, mobile = false) => {
  const onApply = vi.fn();
  const result = render(<div className="agent-stage safe-mode dark"><main className="isolate"><HistoryBrowseControls query={query} mobile={mobile} onApply={onApply} options={{ models: ['model-a'], sources: [{ id: 'preset', name: '合成来源' }] }} /></main></div>);
  fireEvent.click(screen.getByRole('button', { name: /最新生成|随机浏览|最近收藏/ }));
  return { ...result, onApply };
};
describe('历史筛选与排序', () => {
  it('最近收藏只在收藏范围提供，取消收藏筛选自动回到最新排序', () => {
    const { onApply } = setup();
    expect(screen.queryByRole('option', { name: '最近收藏' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: '只看收藏' }));
    fireEvent.change(screen.getByRole('combobox', { name: '历史排序' }), { target: { value: 'favorite' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '只看收藏' }));
    expect((screen.getByRole('combobox', { name: '历史排序' }) as HTMLSelectElement).value).toBe('newest');
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ favoriteOnly: false, sort: 'newest' }));
  });
  it('组合搜索/模型/方式/来源与完整日期边界，随机模式产生会话种子', () => {
    const { onApply } = setup();
    fireEvent.change(screen.getByPlaceholderText('输入关键词…'), { target: { value: '关键词' } });
    fireEvent.change(screen.getByRole('combobox', { name: '历史模型' }), { target: { value: 'model-a' } });
    fireEvent.change(screen.getByRole('combobox', { name: '历史生成方式' }), { target: { value: 'inpaint' } });
    fireEvent.change(screen.getByRole('combobox', { name: '历史来源' }), { target: { value: 'preset' } });
    fireEvent.change(screen.getByRole('combobox', { name: '历史排序' }), { target: { value: 'random' } });
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-02' } });
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ search: '关键词', model: 'model-a', operation: 'inpaint', source: 'preset', sort: 'random', seed: expect.any(String), from: new Date('2026-10-01T00:00:00').getTime(), to: new Date('2026-10-02T23:59:59.999').getTime() }));
  });
  it('无效日期不发查询；取消草稿后重新打开显示已应用条件', () => {
    const { onApply } = setup({ sort: 'newest', search: '已应用' });
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-03' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(onApply).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toBe('开始日期不能晚于结束日期');
    fireEvent.change(screen.getByPlaceholderText('输入关键词…'), { target: { value: '未应用' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '最新生成 · 已筛选' }));
    expect((screen.getByPlaceholderText('输入关键词…') as HTMLInputElement).value).toBe('已应用');
  });
  it('手机使用根层底部面板，重置不改变已应用条件，洗牌保留筛选', () => {
    const { container, onApply } = setup({ sort: 'random', seed: 'before', search: '关键词', favoriteOnly: true }, true);
    const dialog = screen.getByRole('dialog', { name: '筛选与排序' });
    expect(dialog.closest('main')).toBeNull(); expect(dialog.closest('.safe-mode.dark')).toBe(container.firstElementChild);
    fireEvent.click(screen.getByRole('button', { name: '重置条件' }));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新洗牌' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ sort: 'random', search: '关键词', favoriteOnly: true }));
    expect(onApply.mock.calls[0][0].seed).not.toBe('before');
  });
});
