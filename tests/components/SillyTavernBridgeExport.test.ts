// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SillyTavernBridgeExport } from '../../components/SillyTavernBridgeExport';

const { preferences, save, refresh, baiBaiPreferences, saveBaiBai, refreshBaiBai } = vi.hoisted(() => ({
  preferences: { enabled: false, ready: true, busy: false, error: '' },
  save: vi.fn(),
  refresh: vi.fn(),
  baiBaiPreferences: { enabled: false, ready: true, busy: false, error: '' },
  saveBaiBai: vi.fn(),
  refreshBaiBai: vi.fn(),
}));
const download = vi.hoisted(() => vi.fn());
const pickDir = vi.hoisted(() => vi.fn());
vi.mock('../../services/fileDownload', () => ({ downloadFile: download }));
vi.mock('../../services/storageLocations', () => ({ pickStorageDirectory: pickDir }));
vi.mock('../../services/stChatu8Preferences', () => ({ useStChatu8Preferences: () => preferences, setStChatu8Enabled: save, refreshStChatu8Preferences: refresh }));
vi.mock('../../services/stBaiBaiPreferences', () => ({ useStBaiBaiPreferences: () => baiBaiPreferences, setStBaiBaiEnabled: saveBaiBai, refreshStBaiBaiPreferences: refreshBaiBai }));
vi.mock('../../services/localBackup', () => ({ openLocalBackupFolder: vi.fn() }));
beforeEach(() => {
  Object.assign(preferences, { enabled: false, ready: true, busy: false, error: '' }); save.mockReset(); refresh.mockReset();
  Object.assign(baiBaiPreferences, { enabled: false, ready: true, busy: false, error: '' }); saveBaiBai.mockReset(); refreshBaiBai.mockReset();
  download.mockReset();
  pickDir.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ sillyTavernRoot: 'D:\\SyntheticTavern' }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('设置里的智慧姬同步开关', () => {
  it('浏览器接管下载与真实落盘使用不同反馈，取消不能提示完成', async () => {
    preferences.enabled = true;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ files: { 'index.js': '// synthetic' } }))));
    const notify = vi.fn();
    render(React.createElement(SillyTavernBridgeExport, { notify }));
    const button = screen.getByRole('button', { name: '下载 ZIP 扩展包' });
    download.mockResolvedValueOnce({ saved: false, browserDownload: true }); fireEvent.click(button);
    await waitFor(() => expect(notify).toHaveBeenCalledWith('已交给浏览器下载 (npm-bridge.zip)'));
    download.mockRejectedValueOnce(new DOMException('已取消保存', 'AbortError')); fireEvent.click(button);
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalledWith('智慧姬同步扩展包已下载 (npm-bridge.zip)');
  });
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
  it('柏宝绘同步独立开关互不干扰，单独开启时共享目录与扩展安装入口', async () => {
    const view = render(React.createElement(SillyTavernBridgeExport, { notify: vi.fn() }));
    const chatu8Toggle = screen.getByRole('checkbox', { name: '智慧姬同步' }) as HTMLInputElement;
    const baiBaiToggle = screen.getByRole('checkbox', { name: '柏宝绘同步' }) as HTMLInputElement;
    expect(chatu8Toggle.checked).toBe(false);
    expect(baiBaiToggle.checked).toBe(false);
    fireEvent.click(baiBaiToggle);
    expect(saveBaiBai).toHaveBeenCalledWith(true);
    expect(save).not.toHaveBeenCalled();
    baiBaiPreferences.enabled = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ connected: true, sillyTavernRoot: 'D:\\SyntheticTavern', linkedArtists: 2, linkedVibes: 3, linkedHistory: 5 }))));
    view.rerender(React.createElement(SillyTavernBridgeExport, { notify: vi.fn() }));
    await waitFor(() => expect(screen.getByRole('button', { name: '扫描柏宝绘历史' })).toBeTruthy());
    expect(screen.getByRole('button', { name: '一键安装 / 更新扩展' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '扫描智慧姬历史' })).toBeNull();
  });
  it('检测到 TauriTavern 与 SillyTavern 并存时显示快速切换与准确扩展路径', async () => {
    baiBaiPreferences.enabled = true;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      connected: true,
      sillyTavernRoot: 'C:\\Users\\demo\\AppData\\Roaming\\com.tauritavern.client',
      tavernKind: 'tauritavern',
      extensionTargetDir: 'E:\\TTData\\default-user\\extensions\\npm-bridge',
      detectedRoots: [
        { kind: 'tauritavern', root: 'C:\\Users\\demo\\AppData\\Roaming\\com.tauritavern.client', extensionTargetDir: 'E:\\TTData\\default-user\\extensions\\npm-bridge' },
        { kind: 'sillytavern', root: 'D:\\SillyTavern', extensionTargetDir: 'D:\\SillyTavern\\public\\scripts\\extensions\\third-party\\npm-bridge' },
      ],
      linkedArtists: 1, linkedVibes: 1, linkedHistory: 2,
    })));
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(SillyTavernBridgeExport, { notify: vi.fn() }));
    await waitFor(() => expect(screen.getByText('已自动检测 · TauriTavern')).toBeTruthy());
    expect(screen.getByText('E:\\TTData\\default-user\\extensions\\npm-bridge')).toBeTruthy();
    const stSwitch = screen.getByRole('button', { name: 'SillyTavern' });
    fireEvent.click(stSwitch);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/integrations/st-baibai/root', expect.objectContaining({ method: 'POST' })));
  });
  it('点击「选择目录」可调起系统目录选择器并自动回填绑定', async () => {
    baiBaiPreferences.enabled = true;
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      connected: true,
      sillyTavernRoot: 'E:\\CustomTTData',
      tavernKind: 'tauritavern',
      extensionTargetDir: 'E:\\CustomTTData\\default-user\\extensions\\npm-bridge',
      linkedArtists: 0, linkedVibes: 0, linkedHistory: 0,
    })));
    vi.stubGlobal('fetch', fetchMock);
    pickDir.mockResolvedValueOnce({ path: 'E:\\CustomTTData', cancelled: false });
    const notify = vi.fn();
    render(React.createElement(SillyTavernBridgeExport, { notify }));
    fireEvent.click(screen.getByRole('button', { name: '选择本地酒馆目录' }));
    await waitFor(() => expect(pickDir).toHaveBeenCalledTimes(1));
    expect(pickDir.mock.calls[0][0]).toBe('tavern');
    await waitFor(() => expect(screen.getByTitle('SillyTavern 本地安装根目录').getAttribute('value')).toBe('E:\\CustomTTData'));
    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/st-baibai/root', expect.objectContaining({ method: 'POST' }));
    expect(notify).toHaveBeenCalledWith('已绑定 TauriTavern 目录：E:\\CustomTTData');
  });
});
