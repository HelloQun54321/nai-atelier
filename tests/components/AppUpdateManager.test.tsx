// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LANGUAGES, setLanguage, t } from '../../services/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUpdateManager } from '../../components/AppUpdateManager';
import { AppUpdateState } from '../../services/appUpdate';
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => async () => true }));
const idle: AppUpdateState = { phase: 'idle', currentVersion: '1.0.0', version: '', progress: 0, allowPrerelease: true, message: '', releaseNotes: '' };
beforeEach(() => { vi.stubGlobal('__APP_VERSION__', '1.0.0'); localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); setLanguage('zh-CN'); delete window.atelierUpdate; vi.unstubAllGlobals(); });
describe('应用更新入口', () => {
  it('桌面更新状态随五种语言切换，查看状态不下载安装', async () => {
    const unavailable = vi.fn(async () => idle);
    window.atelierUpdate = { status: async () => ({ ...idle, phase: 'latest' }), check: unavailable, download: unavailable, install: unavailable, channel: unavailable, releases: unavailable, onStatus: () => () => {} };
    render(<AppUpdateManager />);
    await screen.findByText('当前渠道没有更新版本');
    for (const language of LANGUAGES) {
      act(() => setLanguage(language.code));
      expect(screen.getByText(t('当前渠道没有更新版本'))).toBeTruthy();
    }
    expect(unavailable).not.toHaveBeenCalled();
  });
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
    expect(screen.queryByText('只检查已发布版本')).toBeNull();
    expect(screen.queryByText(/双击项目中的/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更新方式' }));
    expect(screen.getByText(/双击项目中的/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭说明' }));
    fireEvent.click(screen.getByText('检查更新'));
    await screen.findByRole('alert'); expect(screen.getByRole('alert').textContent).toContain('503');
    expect(screen.getByText('下载页').getAttribute('href')).toBe('https://github.com/HelloQun54321/nai-atelier/releases');
  });
});
