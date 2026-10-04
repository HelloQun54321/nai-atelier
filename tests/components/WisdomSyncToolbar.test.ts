// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WisdomSyncSelection, WisdomSyncView } from '../../services/stChatu8Sync';
import { WisdomSyncToolbar } from '../../components/WisdomSyncToolbar';

const entry = { chainId: 'pending-a', requestId: 'request-a', status: 'pending' as const, requestedAt: 1, confirmedAt: 0, lastVerifiedAt: 0 };
const selection = (overrides: Partial<WisdomSyncSelection> = {}): WisdomSyncSelection => ({
  open: true, view: 'pick', setView: vi.fn(), recordFilter: 'all', setRecordFilter: vi.fn(), selecting: true,
  busy: false, error: '', entries: new Map(), pending: [entry], records: [], selected: new Set(['a']), available: new Set(['a', 'b']),
  savedCount: 1, lastSnapshotAt: 0, begin: vi.fn(), cancel: vi.fn(), toggle: vi.fn(), setFiltered: vi.fn(),
  save: vi.fn(async () => {}), load: vi.fn(async () => {}), actOnEntries: vi.fn(async () => {}), accepts: vi.fn(() => true), ...overrides,
});
afterEach(cleanup);

describe('智慧姬同步工具栏', () => {
  it.each<WisdomSyncView>(['pick', 'pending', 'records'])('%s 的视图和操作连续排布，桌面不预留第二行或两端占位', view => {
    render(React.createElement(WisdomSyncToolbar, { sync: selection({ view }), filteredIds: ['a', 'b'] }));
    const toolbar = screen.getByRole('toolbar', { name: '智慧姬同步操作' });
    const navigation = screen.getByRole('tablist').parentElement!;
    const actions = screen.getByRole('group', { name: '当前同步视图操作' });
    expect(navigation.parentElement).toBe(toolbar);
    expect(actions.parentElement).toBe(toolbar);
    expect([...toolbar.children]).toEqual([navigation, actions]);
    // 两组以内容宽度相邻排列；手机独占行，窄屏自然换行而不溢出。
    expect(toolbar.classList.contains('flex-wrap')).toBe(true);
    for (const group of [navigation, actions]) {
      expect(group.classList.contains('w-full')).toBe(true);
      expect(group.classList.contains('sm:w-auto')).toBe(true);
      expect(group.classList.contains('flex-1')).toBe(false);
      expect(group.classList.contains('justify-between')).toBe(false);
      expect(group.classList.contains('mt-2')).toBe(false);
    }
    expect(navigation.firstElementChild).toBe(screen.getByRole('button', { name: '返回资料库' }));
    for (const button of within(toolbar).getAllByRole('button')) expect(button.classList.contains('mobile-touch')).toBe(true);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.classList.contains('mobile-touch')).toBe(true);
      expect(tab.getAttribute('aria-selected')).toBe(String(tab.getAttribute('aria-label')?.startsWith(view === 'pick' ? '挑选' : view === 'pending' ? '待同步' : '同步记录')));
    }
    if (view === 'records') expect(screen.getByRole('combobox', { name: '记录状态' }).closest('[role="group"]')).toBe(actions);
  });

  it('批量按钮只操作当前筛选，加入仍包含跨筛选选择；没有可操作结果时禁用', () => {
    const sync = selection({ selected: new Set(['a', 'outside']), available: new Set(['a', 'b', 'outside']) });
    const view = render(React.createElement(WisdomSyncToolbar, { sync, filteredIds: ['a', 'b', 'unsupported'] }));
    fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
    expect(sync.setFiltered).toHaveBeenLastCalledWith(['a', 'b', 'unsupported'], true);
    fireEvent.click(screen.getByRole('button', { name: '取消筛选结果' }));
    expect(sync.setFiltered).toHaveBeenLastCalledWith(['a', 'b', 'unsupported'], false);
    fireEvent.click(screen.getByRole('button', { name: '加入待同步' }));
    expect(sync.save).toHaveBeenCalledOnce();

    view.rerender(React.createElement(WisdomSyncToolbar, { sync, filteredIds: ['b'] }));
    expect(screen.getByRole('button', { name: '取消筛选结果' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '加入待同步' }).hasAttribute('disabled')).toBe(false);
    view.rerender(React.createElement(WisdomSyncToolbar, { sync, filteredIds: ['a', 'unsupported'] }));
    expect(screen.getByRole('button', { name: '全选筛选结果' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '取消筛选结果' }).hasAttribute('disabled')).toBe(false);
  });

  it('核对中禁用提交和批量操作，返回与视图切换仍可使用；错误才占用提示行', () => {
    const sync = selection({ busy: true, error: '连接暂时不可用' });
    const view = render(React.createElement(WisdomSyncToolbar, { sync, filteredIds: ['a', 'b'] }));
    for (const name of ['全选筛选结果', '取消筛选结果', '加入待同步']) expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '返回资料库' }));
    expect(sync.cancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('tab', { name: '同步记录 0' }));
    expect(sync.setView).toHaveBeenCalledWith('records');
    expect(screen.getByRole('alert').textContent).toContain('连接暂时不可用');
    view.rerender(React.createElement(WisdomSyncToolbar, { sync: { ...sync, busy: false, error: '' }, filteredIds: ['a', 'b'] }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: '核对同步列表' })).toBeNull();
    expect(sync.load).not.toHaveBeenCalled();
  });

  it('待同步移出与记录状态筛选沿用原行为，没有任务时隐藏批量移出', () => {
    const sync = selection({ view: 'pending' });
    const view = render(React.createElement(WisdomSyncToolbar, { sync, filteredIds: [] }));
    fireEvent.click(screen.getByRole('button', { name: '全部移出待同步' }));
    expect(sync.actOnEntries).toHaveBeenCalledWith('remove', ['pending-a']);
    view.rerender(React.createElement(WisdomSyncToolbar, { sync: { ...sync, pending: [] }, filteredIds: [] }));
    expect(screen.queryByRole('button', { name: '全部移出待同步' })).toBeNull();
    view.rerender(React.createElement(WisdomSyncToolbar, { sync: { ...sync, view: 'records', lastSnapshotAt: 1 }, filteredIds: [] }));
    const filter = screen.getByRole('combobox', { name: '记录状态' });
    expect(filter.classList.contains('mobile-touch')).toBe(true);
    fireEvent.change(filter, { target: { value: 'removed' } });
    expect(sync.setRecordFilter).toHaveBeenCalledWith('removed');
    expect(screen.getByText(/最近完整核对/).parentElement).toBe(filter.closest('[role="group"]'));
  });
});
