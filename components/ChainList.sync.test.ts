// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../types';
import { ChainList } from './ChainList';

const { get, post, preferences } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), preferences: { enabled: true } }));
vi.mock('../services/stChatu8Preferences', () => ({ useStChatu8Preferences: () => preferences }));
vi.mock('../services/api', () => ({ api: { get, post } }));
vi.mock('./StyleCollectorControl', () => ({ StyleCollectorControl: () => null }));
vi.mock('./ImageTaggerPanel', () => ({ ImageTaggerAction: () => null }));
vi.mock('./chain/FolderBatchImportModal', () => ({ FolderBatchImportModal: () => null }));
vi.mock('./SmartImage', () => ({ SmartImage: () => null }));
vi.mock('./ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn() }));
vi.mock('../services/imageDisplayPreferences', () => ({ useMobileImageDisplayPreferences: () => ({ layout: 'grid' }), mobileGalleryClassName: () => '', mobileGalleryStyle: () => ({}) }));
vi.mock('./ShortestColumnMasonry', () => ({ useMasonryColumnCount: () => 2, ShortestColumnMasonry: () => null }));
vi.mock('./useRestoreListAnchor', () => ({ useRestoreListAnchor: () => {} }));
vi.mock('./useKeepAliveScrollRestore', () => ({ useKeepAliveScrollRestore: () => () => {} }));
vi.mock('../services/naiRuntime', () => ({ useNaiRuntime: () => ({}) }));
vi.mock('../services/naiModels', () => ({ DEFAULT_NAI_MODEL: 'nai-diffusion-4-5-full', getNaiModelDisplayLabel: (model: string) => model?.startsWith('nai-diffusion-5-') ? 'V5' : 'V4.5', getSelectableNaiModels: () => [] }));

const chain = (id: string, name: string, model = 'nai-diffusion-4-5-full'): PromptChain => ({
  id, userId: 'test-owner', name, type: 'style', description: '', tags: [], basePrompt: '', negativePrompt: '', modules: [],
  params: { model, width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 1, qualityToggle: true, ucPreset: 4 }, createdAt: 1, updatedAt: 1,
});
const chains = [chain('a', '风格 A'), chain('b', '风格 B'), chain('v5', '风格 V5', 'nai-diffusion-5-full'), chain('v4', '风格 V4', 'nai-diffusion-4-full')];
const props = () => ({ chains, type: 'style' as const, onCreate: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(), onRefresh: vi.fn(), isLoading: false, notify: vi.fn() });
beforeEach(() => {
  preferences.enabled = true;
  get.mockReset(); post.mockReset(); get.mockResolvedValue({ entries: [], lastSnapshotAt: 0 });
  post.mockImplementation(async (_path, body) => ({ entries: body.chainIds.map((chainId: string) => ({ chainId, requestId: chainId, status: 'pending', requestedAt: 1, confirmedAt: 0, lastVerifiedAt: 0 })), lastSnapshotAt: 0 }));
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('风格串列表的酒馆筛选交互', () => {
  it('卡片勾选取代打开编辑；跨搜索保持选择，V5 可选、V4 禁用，保存所选 V4.5 与 V5', async () => {
    const p = props(); render(React.createElement(ChainList, p));
    const trigger = screen.getByRole('button', { name: '智慧姬同步' }); await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false));
    fireEvent.click(trigger);
    const a = await screen.findByRole('checkbox', { name: '智慧姬同步：风格 A' });
    await waitFor(() => expect(a.getAttribute('aria-disabled')).toBe('false'));
    fireEvent.keyDown(a, { key: ' ' }); expect(a.getAttribute('aria-checked')).toBe('true');
    const v5 = screen.getByRole('checkbox', { name: '智慧姬同步：风格 V5' });
    expect(v5.getAttribute('aria-disabled')).toBe('false'); fireEvent.click(v5); expect(v5.getAttribute('aria-checked')).toBe('true');
    const v4 = screen.getByRole('checkbox', { name: '智慧姬同步：风格 V4' });
    expect(v4.getAttribute('aria-disabled')).toBe('true'); fireEvent.click(v4); expect(v4.getAttribute('aria-checked')).toBe('false');
    const search = screen.getByPlaceholderText('搜索我的风格串'); fireEvent.change(search, { target: { value: '风格 B' } });
    expect(search.parentElement?.classList.contains('min-w-0')).toBe(true);
    expect(search.parentElement?.classList.contains('min-w-[12rem]')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByRole('checkbox', { name: '智慧姬同步：风格 A' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: '智慧姬同步：风格 B' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '加入待同步' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/st-chatu8/workspace', { action: 'enqueue', chainIds: ['a', 'v5', 'b'] }));
    expect(p.onSelect).not.toHaveBeenCalled(); expect(p.onDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: '智慧姬同步：风格 A' })).toBeNull());
    expect(screen.getByRole('tab', { name: '待同步 3' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '返回资料库' }));
    fireEvent.click(screen.getByText('风格 A')); expect(p.onSelect).toHaveBeenCalledWith('a');
  });
  it('移动端在筛选面板提供同一选择入口；取消恢复列表且不保存', async () => {
    render(React.createElement(ChainList, props()));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '筛选与排序' }));
    const entry = await screen.findByRole('button', { name: '智慧姬同步（待同步 0）' });
    await waitFor(() => expect(entry.hasAttribute('disabled')).toBe(false)); fireEvent.click(entry);
    await screen.findByRole('checkbox', { name: '智慧姬同步：风格 A' });
    fireEvent.click(screen.getByRole('button', { name: '返回资料库' })); expect(post).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox', { name: '智慧姬同步：风格 A' })).toBeNull();
  });
  it('角色与游客页面不提供发送范围或读取请求', async () => {
    const view = render(React.createElement(ChainList, { ...props(), type: 'character' }));
    expect(screen.queryByRole('button', { name: '智慧姬同步' })).toBeNull(); expect(get).not.toHaveBeenCalled(); view.unmount();
    render(React.createElement(ChainList, { ...props(), isGuest: true }));
    expect(screen.queryByRole('button', { name: '智慧姬同步' })).toBeNull(); expect(get).not.toHaveBeenCalled();
  });
  it('待同步与接收记录分开，移出只改队列，对方移除条目可显式重新加入', async () => {
    const entry = (chainId: string, status: string) => ({ chainId, requestId: chainId, status, requestedAt: 1, confirmedAt: 2, lastVerifiedAt: 2 });
    const current = { entries: [entry('a', 'pending'), entry('b', 'synced'), entry('v5', 'removed')], lastSnapshotAt: 2 };
    get.mockResolvedValue(current);
    const p = props(); render(React.createElement(ChainList, p));
    const trigger = await screen.findByRole('button', { name: '智慧姬同步 1' });
    await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false)); fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('tab', { name: '待同步 1' }).getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByText('风格 A')).toBeTruthy(); expect(screen.queryByText('风格 B')).toBeNull();
    post.mockResolvedValueOnce({ entries: current.entries.slice(1), lastSnapshotAt: 2 });
    fireEvent.click(screen.getByRole('button', { name: '移出待同步：风格 A' }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/st-chatu8/workspace', { action: 'remove', chainIds: ['a'] }));
    expect(p.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: '同步记录 2' }));
    expect(screen.queryByText('风格 A')).toBeNull(); expect(screen.getByText('风格 B')).toBeTruthy(); expect(screen.getByText('智慧姬中已移除', { selector: 'span' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '记录状态' }), { target: { value: 'removed' } });
    expect(screen.queryByText('风格 B')).toBeNull(); expect(screen.getByText('风格 V5')).toBeTruthy();
    post.mockResolvedValueOnce({ entries: [entry('b', 'synced'), entry('v5', 'pending')], lastSnapshotAt: 2 });
    await waitFor(() => expect(screen.getByRole('button', { name: '重新加入待同步：风格 V5' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '重新加入待同步：风格 V5' }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/st-chatu8/workspace', { action: 'requeue', chainIds: ['v5'] }));
    expect(screen.getByRole('tab', { name: '待同步 1' }).getAttribute('aria-selected')).toBe('true');
  });
  it('关闭时桌面与手机隐藏入口；开启后显示，编辑中关闭立即退出且不提交草稿', async () => {
    preferences.enabled = false;
    const p = props(); const view = render(React.createElement(ChainList, p));
    expect(screen.queryByRole('button', { name: '智慧姬同步' })).toBeNull(); expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '筛选与排序' }));
    expect(screen.queryByRole('button', { name: '智慧姬同步（待同步 0）' })).toBeNull();
    preferences.enabled = true; view.rerender(React.createElement(ChainList, p));
    expect(await screen.findByRole('button', { name: '智慧姬同步（待同步 0）' })).toBeTruthy();
    const trigger = screen.getByRole('button', { name: '智慧姬同步' });
    await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false)); fireEvent.click(trigger);
    await screen.findByRole('checkbox', { name: '智慧姬同步：风格 A' });
    preferences.enabled = false; view.rerender(React.createElement(ChainList, p));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: '智慧姬同步：风格 A' })).toBeNull());
    expect(screen.queryByRole('button', { name: '智慧姬同步' })).toBeNull(); expect(post).not.toHaveBeenCalled();
  });
});
