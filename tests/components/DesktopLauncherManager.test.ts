// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopLauncherManager } from '../../components/DesktopLauncherManager';
import * as desktopLauncherService from '../../services/desktopLauncher';

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
    expect(screen.queryByText(/Windows 安装依赖后自动创建/)).toBeNull();
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
      expect(screen.getByText(/仅支持 Windows（当前：linux）/)).toBeTruthy();
      expect(screen.getByText(/^运行 npm run dev:local$/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /桌面快捷方式/ })).toBeNull();
    });
  });

  it('安装版展示应用状态，快捷方式修复沿用同一入口', async () => {
    vi.spyOn(desktopLauncherService, 'getDesktopLauncherStatus').mockResolvedValue({
      supported: true, launcherKind: 'exe', platform: 'win32', projectDir: 'D:\\数据', desktopDir: 'D:\\桌面', desktopExists: true,
      batPath: 'D:\\自选目录\\NAI Atelier.exe', batExists: true, batMtime: null, shortcutPath: 'D:\\桌面\\NAI Atelier.lnk', shortcutExists: false, shortcutMtime: null, iconPath: 'D:\\图标.ico', iconExists: true,
    });
    render(React.createElement(DesktopLauncherManager, { notify: vi.fn() }));
    await waitFor(() => expect(screen.getByText('桌面应用:')).toBeTruthy());
    expect(screen.queryByText('项目内启动脚本:')).toBeNull();
    expect(screen.getByRole('button', { name: '创建桌面快捷方式' })).toBeTruthy();
  });

  it('已有其他安装版入口时仅提示已保留，不误报创建成功', async () => {
    const notify = vi.fn();
    vi.spyOn(desktopLauncherService, 'getDesktopLauncherStatus').mockResolvedValue({
      supported: true, launcherKind: 'script', platform: 'win32', projectDir: 'D:\\source', desktopDir: 'D:\\desktop', desktopExists: true,
      batPath: 'D:\\source\\NaiPromptManager.bat', batExists: true, batMtime: null, shortcutPath: 'D:\\desktop\\NAI Atelier.lnk', shortcutExists: true, shortcutMtime: null, iconPath: 'D:\\source\\public\\nai-atelier.ico', iconExists: true,
    });
    vi.spyOn(desktopLauncherService, 'createDesktopLauncher').mockResolvedValue({
      success: false, preserved: true, changed: false, batCreated: false, shortcutCreated: false,
      batPath: 'D:\\source\\NaiPromptManager.bat', shortcutPath: 'D:\\desktop\\NAI Atelier.lnk', message: '桌面已有安装版或自定义快捷方式，已保留，未覆盖。',
    });
    render(React.createElement(DesktopLauncherManager, { notify }));
    fireEvent.click(await screen.findByRole('button', { name: '修复桌面快捷方式' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('桌面已有安装版或自定义快捷方式，已保留，未覆盖。'));
    expect(notify).toHaveBeenCalledOnce();
    expect(screen.queryByText('桌面启动器已成功创建')).toBeNull();
  });
});
