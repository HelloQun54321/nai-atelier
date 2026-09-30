// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SillyTavernBridgeExport } from './SillyTavernBridgeExport';

const { preferences, save, refresh } = vi.hoisted(() => ({ preferences: { enabled: false, ready: true, busy: false, error: '' }, save: vi.fn(), refresh: vi.fn() }));
vi.mock('../services/stChatu8Preferences', () => ({ useStChatu8Preferences: () => preferences, setStChatu8Enabled: save, refreshStChatu8Preferences: refresh }));
vi.mock('../services/localBackup', () => ({ openLocalBackupFolder: vi.fn() }));
beforeEach(() => {
  Object.assign(preferences, { enabled: false, ready: true, busy: false, error: '' }); save.mockReset(); refresh.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ sillyTavernRoot: 'D:\\SyntheticTavern' }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('设置里的智慧姬同步开关', () => {
  it('关闭时只有开关与说明；开启后显示安装配置，勾选使用持久化接口', async () => {
    const view = render(React.createElement(SillyTavernBridgeExport, { notify: vi.fn() }));
    const toggle = screen.getByRole('checkbox', { name: '智慧姬同步' }) as HTMLInputElement;
    expect(toggle.checked).toBe(false); expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByTitle('SillyTavern 本地安装根目录')).toBeNull();
    fireEvent.click(toggle); expect(save).toHaveBeenCalledWith(true);
    preferences.enabled = true; view.rerender(React.createElement(SillyTavernBridgeExport, { notify: vi.fn() }));
    await waitFor(() => expect(screen.getByTitle('SillyTavern 本地安装根目录').getAttribute('value')).toBe('D:\\SyntheticTavern'));
    expect(screen.getByRole('button', { name: '一键安装 / 更新扩展' })).toBeTruthy();
    fireEvent.click(toggle); expect(save).toHaveBeenLastCalledWith(false);
    preferences.enabled = false; view.rerender(React.createElement(SillyTavernBridgeExport, { notify: vi.fn() }));
    expect(screen.queryByRole('button', { name: '一键安装 / 更新扩展' })).toBeNull();
  });
  it('读写等待时防止重复操作；失败显示原因与手动重读', async () => {
    const notify = vi.fn(); preferences.ready = false;
    const view = render(React.createElement(SillyTavernBridgeExport, { notify }));
    const toggle = screen.getByRole('checkbox', { name: '智慧姬同步' }) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    preferences.ready = true; preferences.busy = true; view.rerender(React.createElement(SillyTavernBridgeExport, { notify }));
    expect(toggle.disabled).toBe(true);
    preferences.busy = false; preferences.error = '读取失败'; view.rerender(React.createElement(SillyTavernBridgeExport, { notify }));
    expect(screen.getByText('读取失败')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: '重新读取' })); expect(refresh).toHaveBeenCalledTimes(1);
    save.mockRejectedValueOnce(new Error('保存失败')); fireEvent.click(toggle);
    await waitFor(() => expect(notify).toHaveBeenCalledWith('保存失败'));
  });
});
