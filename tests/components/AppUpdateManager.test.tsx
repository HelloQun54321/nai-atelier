// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUpdateManager } from '../../components/AppUpdateManager';
import { AppUpdateState } from '../../services/appUpdate';
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => async () => true }));
const idle: AppUpdateState = { phase: 'idle', currentVersion: '1.0.0', version: '', progress: 0, allowPrerelease: true, message: '', releaseNotes: '' };
beforeEach(() => { vi.stubGlobal('__APP_VERSION__', '1.0.0'); localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); delete window.atelierUpdate; vi.unstubAllGlobals(); });
describe('应用更新入口', () => {
  it('下载与重启分别由用户点击，忙碌时不重复检查，关闭面板解绑事件', async () => {
    const unsubscribe = vi.fn();
    const bridge = { status: vi.fn(async () => idle), check: vi.fn(async () => ({ ...idle, phase: 'available' as const, version: '1.1.0' })), download: vi.fn(async () => ({ ...idle, phase: 'downloaded' as const, version: '1.1.0', progress: 100 })), install: vi.fn(async () => ({ ...idle, phase: 'installing' as const })), channel: vi.fn(async () => idle), releases: vi.fn(async () => idle), onStatus: vi.fn(() => unsubscribe) };
    window.atelierUpdate = bridge;
    const { unmount } = render(<AppUpdateManager />);
    await waitFor(() => expect(bridge.status).toHaveBeenCalled());
    fireEvent.click(screen.getByText('检查更新'));
    await screen.findByText('下载更新'); expect(bridge.download).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('下载更新'));
    await screen.findByText('重启并安装'); expect(bridge.install).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('重启并安装'));
    await waitFor(() => expect(bridge.install).toHaveBeenCalledOnce());
    expect((screen.getByText('检查更新') as HTMLButtonElement).disabled).toBe(true);
    unmount(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('浏览器和手机不提供安装操作，检查失败明确显示并保留手动下载入口', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    render(<AppUpdateManager />);
    expect(screen.queryByText('重启并安装')).toBeNull();
    expect(screen.queryByText('下载更新')).toBeNull();
    expect(screen.getByText(/双击项目中的/)).toBeTruthy();
    fireEvent.click(screen.getByText('检查更新'));
    await screen.findByRole('alert'); expect(screen.getByRole('alert').textContent).toContain('503');
    expect(screen.getByText('下载页').getAttribute('href')).toBe('https://github.com/HelloQun54321/nai-atelier/releases');
  });
});
