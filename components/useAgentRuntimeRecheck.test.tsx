// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { agentRuntimeWarning, promptAgentService, type PromptAgentConfig } from '../services/promptAgent';
import { useAgentRuntimeRecheck } from './useAgentRuntimeRecheck';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const current = { backendVersion: 'synthetic', sourceVersion: 'synthetic' } as PromptAgentConfig;
const Status = ({ enabled = true }) => {
  const [config, setConfig] = useState({} as PromptAgentConfig);
  const warning = agentRuntimeWarning(config, 'synthetic');
  useAgentRuntimeRecheck(setConfig, enabled, Boolean(warning));
  return <p>{warning || '已同步'}</p>;
};
it('旧版提示自动核验，短暂断连后重试，服务更新后停止轮询', async () => {
  vi.useFakeTimers(); const load = vi.spyOn(promptAgentService, 'getConfig').mockRejectedValueOnce(new Error('合成重启断连')).mockResolvedValue(current);
  render(<Status />);
  await act(() => vi.advanceTimersByTimeAsync(10_000)); expect(screen.getByText(/仍运行旧版/)).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(10_000)); expect(screen.getByText('已同步')).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(30_000)); expect(load).toHaveBeenCalledTimes(2);
});
it('回到页面重新读取；关闭面板和卸载后不继续请求', async () => {
  const load = vi.spyOn(promptAgentService, 'getConfig').mockResolvedValue(current);
  const view = render(<Status />);
  await act(async () => { fireEvent(window, new Event('focus')); }); expect(screen.getByText('已同步')).toBeTruthy();
  view.rerender(<Status enabled={false} />);
  await act(async () => { fireEvent(window, new Event('focus')); }); expect(load).toHaveBeenCalledTimes(1);
  view.unmount(); await act(async () => { fireEvent(window, new Event('focus')); }); expect(load).toHaveBeenCalledTimes(1);
});
