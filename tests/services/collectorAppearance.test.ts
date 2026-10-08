// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE_PREFERENCES } from '../../services/appearancePreferences';
import { collectorIsLocal, syncCollectorAppearance, useCollectorAppearance } from '../../services/collectorAppearance';
import { LANGUAGES, setLanguage } from '../../services/i18n';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); setLanguage('zh-CN'); vi.unstubAllGlobals(); });
describe('悬浮窗外观同步', () => {
  it('电脑本机才发送，局域网手机不改悬浮窗外观', () => {
    expect(collectorIsLocal('localhost')).toBe(true); expect(collectorIsLocal('127.0.0.1')).toBe(true);
    expect(collectorIsLocal('192.168.1.8')).toBe(false);
  });
  it('初始化与切换明暗／主题色／系统解析结果均同步，无关偏好不发送', async () => {
    const initial = { preferences: DEFAULT_APPEARANCE_PREFERENCES, isDark: false };
    const view = renderHook(({ preferences, isDark }) => useCollectorAppearance(preferences, isDark), { initialProps: initial });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/style-collector/appearance');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ themeMode: 'system', isDark: false, accentColor: '#0ea5e9', motion: 'full', language: 'zh-CN' });
    view.rerender({ ...initial, preferences: { ...initial.preferences, forceEmptySeed: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    view.rerender({ preferences: { ...initial.preferences, accentColor: '#8b5cf6', motion: 'off' }, isDark: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ themeMode: 'system', isDark: true, accentColor: '#8b5cf6', motion: 'off', language: 'zh-CN' });
    view.rerender({ preferences: { ...initial.preferences, themeMode: 'light' }, isDark: false });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    view.unmount(); act(() => window.dispatchEvent(new Event('focus'))); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('五种语言原位同步到原生悬浮窗，不需要重开收集任务', async () => {
    renderHook(() => useCollectorAppearance(DEFAULT_APPEARANCE_PREFERENCES, false));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    for (const item of LANGUAGES.slice(1)) {
      act(() => setLanguage(item.code));
      await waitFor(() => expect(JSON.parse(fetchMock.mock.lastCall![1].body).language).toBe(item.code));
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.every(call => call[0] === '/api/style-collector/appearance')).toBe(true);
  });
  it('快速调色串行提交并合并中间值，最后的颜色不会被旧请求覆盖', async () => {
    let release!: () => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ ok: true }); }));
    const first = syncCollectorAppearance({ themeMode: 'dark', isDark: true, accentColor: '#0ea5e9', motion: 'full' });
    void syncCollectorAppearance({ themeMode: 'dark', isDark: true, accentColor: '#ff0000', motion: 'full' });
    void syncCollectorAppearance({ themeMode: 'light', isDark: false, accentColor: '#8b5cf6', motion: 'off' });
    expect(fetchMock).toHaveBeenCalledTimes(1); release(); await first;
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(JSON.parse(fetchMock.mock.calls[1][1].body).accentColor).toBe('#8b5cf6');
  });
  it('回到页面时重发最新偏好；网络中断不影响网页且不自动重试', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const view = renderHook(() => useCollectorAppearance(DEFAULT_APPEARANCE_PREFERENCES, false));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)); view.unmount();
  });
});
