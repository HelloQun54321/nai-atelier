// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopLauncherManager } from './DesktopLauncherManager';
import * as desktopLauncherService from '../services/desktopLauncher';

describe('DesktopLauncherManager', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders windows ready state and triggers creation', async () => {
    const notify = vi.fn();
    const mockStatus: desktopLauncherService.DesktopLauncherStatus = {
      supported: true,
      platform: 'win32',
      projectDir: 'C:\\projects\\nai-atelier',
      desktopDir: 'C:\\Users\\user\\Desktop',
      desktopExists: true,
      batPath: 'C:\\projects\\nai-atelier\\NaiPromptManager.bat',
      batExists: true,
      batMtime: '2026-09-07T04:00:00.000Z',
      shortcutPath: 'C:\\Users\\user\\Desktop\\NAI Atelier.lnk',
      shortcutExists: true,
      shortcutMtime: '2026-09-07T04:00:00.000Z',
      iconPath: 'C:\\projects\\nai-atelier\\public\\nai-atelier.ico',
      iconExists: true,
    };

    const statusSpy = vi.spyOn(desktopLauncherService, 'getDesktopLauncherStatus').mockResolvedValue(mockStatus);
    const createSpy = vi.spyOn(desktopLauncherService, 'createDesktopLauncher').mockResolvedValue({
      success: true,
      batCreated: false,
      shortcutCreated: true,
      batPath: mockStatus.batPath,
      shortcutPath: mockStatus.shortcutPath,
      message: '桌面快捷方式已就绪，启动脚本保留在项目内',
    });

    render(React.createElement(DesktopLauncherManager, { notify }));

    await waitFor(() => {
      expect(screen.getByText('Windows 桌面启动器')).toBeTruthy();
      expect(screen.getByText('C:\\Users\\user\\Desktop')).toBeTruthy();
      expect(screen.getByText('修复桌面快捷方式')).toBeTruthy();
    });

    expect(statusSpy).toHaveBeenCalledOnce();
    expect(screen.queryByTitle('刷新桌面状态')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('link', { name: /下载启动脚本/ })).toBeNull();
    expect(screen.getByText(/Windows 安装依赖后自动创建/)).toBeTruthy();
    const updateBtn = screen.getByText('修复桌面快捷方式');
    fireEvent.click(updateBtn);

    await waitFor(() => {
      expect(statusSpy).toHaveBeenCalledTimes(2);
      expect(createSpy).toHaveBeenCalledWith();
      expect(notify).toHaveBeenCalledWith('桌面快捷方式已就绪，启动脚本保留在项目内');
    });
  });

  it('handles non-windows environment with fallback prompt', async () => {
    const notify = vi.fn();
    const mockStatus: desktopLauncherService.DesktopLauncherStatus = {
      supported: false,
      platform: 'linux',
      projectDir: '/home/user/NaiPromptManager',
      desktopDir: '/home/user/Desktop',
      desktopExists: false,
      batPath: '/home/user/NaiPromptManager/NaiPromptManager.bat',
      batExists: false,
      batMtime: null,
      shortcutPath: '',
      shortcutExists: false,
      shortcutMtime: null,
      iconPath: '/home/user/NaiPromptManager/public/nai-atelier.ico',
      iconExists: true,
    };

    vi.spyOn(desktopLauncherService, 'getDesktopLauncherStatus').mockResolvedValue(mockStatus);

    render(React.createElement(DesktopLauncherManager, { notify }));

    await waitFor(() => {
      expect(screen.getByText(/桌面启动器主要针对 Windows 本地宿主机系统/)).toBeTruthy();
      expect(screen.getByText(/当前系统请在项目目录运行 npm run dev:local/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /桌面快捷方式/ })).toBeNull();
    });
  });
});
