// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      batPath: 'C:\\Users\\user\\Desktop\\NaiPromptManager.bat',
      batExists: true,
      batMtime: '2026-09-07T04:00:00.000Z',
      shortcutPath: 'C:\\Users\\user\\Desktop\\NAI Atelier.lnk',
      shortcutExists: true,
      shortcutMtime: '2026-09-07T04:00:00.000Z',
      iconPath: 'C:\\projects\\nai-atelier\\public\\nai-atelier.ico',
      iconExists: true,
    };

    vi.spyOn(desktopLauncherService, 'getDesktopLauncherStatus').mockResolvedValue(mockStatus);
    const createSpy = vi.spyOn(desktopLauncherService, 'createDesktopLauncher').mockResolvedValue({
      success: true,
      batCreated: true,
      shortcutCreated: true,
      batPath: mockStatus.batPath,
      shortcutPath: mockStatus.shortcutPath,
      message: '桌面启动脚本与专属图标快捷方式已成功创建/更新',
    });

    render(React.createElement(DesktopLauncherManager, { notify }));

    await waitFor(() => {
      expect(screen.getByText('Windows 桌面启动器')).toBeTruthy();
      expect(screen.getByText('C:\\Users\\user\\Desktop')).toBeTruthy();
      expect(screen.getByText('更新桌面启动器')).toBeTruthy();
    });

    const updateBtn = screen.getByText('更新桌面启动器');
    fireEvent.click(updateBtn);

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({
        createShortcut: true,
        hideBat: true,
      });
      expect(notify).toHaveBeenCalledWith('桌面启动脚本与专属图标快捷方式已成功创建/更新');
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
      batPath: '/home/user/Desktop/NaiPromptManager.bat',
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
      expect(screen.getByText('下载启动脚本 (.bat)')).toBeTruthy();
    });
  });
});
