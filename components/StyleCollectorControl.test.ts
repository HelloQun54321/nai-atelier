// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StyleCollectorControl, collectorIsLocal, type CollectorState } from './StyleCollectorControl';

class FakeEvents {
  static instances: FakeEvents[] = [];
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  close = vi.fn();
  constructor() { FakeEvents.instances.push(this); }
  emit(state: CollectorState) { this.onmessage?.({ data: JSON.stringify(state) }); }
}
const initial: CollectorState = { available: true, enabled: false, paused: false, stage: '已关闭', session: '', pending: 0, saved: 0, failed: 0, skipped: 0, error: '', failures: [] };
let state: CollectorState;
const fetchMock = vi.fn();
beforeEach(() => {
  state = { ...initial }; FakeEvents.instances = []; vi.stubGlobal('EventSource', FakeEvents);
  fetchMock.mockReset(); fetchMock.mockImplementation(async (_url, options) => {
    if (options?.method === 'POST') state = { ...state, enabled: !state.enabled };
    return { ok: true, json: async () => state };
  }); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('风格串收集工具栏', () => {
  it('仅允许本机地址，局域网手机不启停电脑监听', () => {
    expect(collectorIsLocal('localhost')).toBe(true); expect(collectorIsLocal('::1')).toBe(true);
    expect(collectorIsLocal('192.168.1.3')).toBe(false); expect(collectorIsLocal('atelier.example.com')).toBe(false);
  });
  it('开关沿用服务端状态；卸载不发送停止请求', async () => {
    const view = render(React.createElement(StyleCollectorControl, { onSaved: vi.fn(), notify: vi.fn() }));
    const toggle = await screen.findByRole('switch'); expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle); await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/style-collector/start');
    expect(fetchMock.mock.calls[1][1].headers['X-Nai-Local-Control']).toBe('true');
    view.unmount(); expect(FakeEvents.instances[0].close).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith('/stop'))).toBe(false);
  });
  it('只有真实保存增加才刷新资料库；暂停和关闭由置顶窗双向同步', async () => {
    const saved = vi.fn(); render(React.createElement(StyleCollectorControl, { onSaved: saved, notify: vi.fn() }));
    await screen.findByRole('switch'); await waitFor(() => expect(FakeEvents.instances.length).toBe(1));
    const events = FakeEvents.instances[0];
    events.emit({ ...initial, session: 'run', enabled: true, saved: 1 });
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    events.emit({ ...initial, session: 'run', enabled: true, paused: true, saved: 1 });
    await screen.findByText('收集已暂停'); expect(saved).toHaveBeenCalledTimes(1);
    events.emit({ ...initial, session: 'run', enabled: false, saved: 1 });
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false'));
  });
  it('手动重试入口只发指定任务，不因失败自动重试', async () => {
    state = { ...initial, enabled: true, failed: 1, failures: [{ id: 'failed-task', name: 'synthetic.png', error: '模拟下载失败' }] };
    render(React.createElement(StyleCollectorControl, { onSaved: vi.fn(), notify: vi.fn() }));
    fireEvent.click(await screen.findByLabelText('收集状态与手动重试'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle('手动重试'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/style-collector/retry');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ id: 'failed-task' });
  });
  it('Windows 不可用时不显示会失效的开关；启动失败提示原因', async () => {
    state = { ...initial, available: false };
    const view = render(React.createElement(StyleCollectorControl, { onSaved: vi.fn(), notify: vi.fn() }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled()); expect(screen.queryByRole('switch')).toBeNull(); view.unmount();
    state = { ...initial }; const notify = vi.fn();
    render(React.createElement(StyleCollectorControl, { onSaved: vi.fn(), notify }));
    const toggle = await screen.findByRole('switch');
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: '监听注册失败' }) });
    fireEvent.click(toggle); await waitFor(() => expect(notify).toHaveBeenCalledWith('监听注册失败', 'error'));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });
});
