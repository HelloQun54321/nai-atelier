// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider } from './ConfirmDialog';
import { PromptAgentSettings } from './PromptAgentSettings';

vi.mock('./MobileUI', () => ({ useMobileHistoryLayer: (_open: boolean, close: () => void) => close }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('设置只加载模型与 API，保留生图协作，不再请求或展示注入预设', async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/config')) return Response.json({ provider: '', model: '', configured: false, configuredProviders: [], backendVersion: 'synthetic', sourceVersion: 'synthetic' });
    if (url.endsWith('/available-models') || url.endsWith('/custom-providers')) return Response.json({ items: [] });
    throw new Error(`不应调用的接口：${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const notify = vi.fn();
  render(<ConfirmDialogProvider><PromptAgentSettings notify={notify} /></ConfirmDialogProvider>);
  expect(await screen.findByText('尚未配置模型服务')).toBeTruthy();
  expect(screen.getByRole('region', { name: '生图协作' })).toBeTruthy();
  expect(screen.queryByText(/注入|预设管理/)).toBeNull();
  expect(fetch.mock.calls.some(([url]) => String(url).includes('creative-presets'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '连接 API' }));
  expect(screen.getByRole('dialog', { name: '连接 API' })).toBeTruthy();
  expect(screen.getByLabelText('API 地址')).toBeTruthy();
  expect(notify).not.toHaveBeenCalledWith('读取 AI 模型服务失败', 'error');
});
