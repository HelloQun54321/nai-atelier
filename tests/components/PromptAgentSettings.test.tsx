// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { PromptAgentSettings } from '../../components/PromptAgentSettings';

vi.mock('../../components/MobileUI', () => ({ useMobileHistoryLayer: (_open: boolean, close: () => void) => close }));
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
  expect(screen.queryByText(/注入预设|预设管理/)).toBeNull();
  expect(fetch.mock.calls.some(([url]) => String(url).includes('creative-presets'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '连接 API' }));
  expect(screen.getByRole('dialog', { name: '连接 API' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '自定义模型 API' }));
  expect(screen.getByLabelText('API 地址')).toBeTruthy();
  expect(notify).not.toHaveBeenCalledWith('读取 AI 模型服务失败', 'error');
});

it('模型和连接首读未完成时不显示空状态，读取失败可在原位重试', async () => {
  let resolveModels!: (response: Response) => void;
  let configReads = 0, modelReads = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/config')) {
      if (++configReads === 1) throw new Error('synthetic offline');
      return Response.json({ provider: '', model: '', configured: false, configuredProviders: [], backendVersion: 'synthetic', sourceVersion: 'synthetic' });
    }
    if (url.endsWith('/available-models')) return ++modelReads === 1 ? Response.json({ items: [] }) : new Promise<Response>(resolve => { resolveModels = resolve; });
    if (url.endsWith('/custom-providers')) return Response.json({ items: [] });
    throw new Error(`不应调用的接口：${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const notify = vi.fn();
  render(<ConfirmDialogProvider><PromptAgentSettings notify={notify} /></ConfirmDialogProvider>);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('尚未配置模型服务')).toBeNull();
  expect(screen.queryByText('尚未连接 API')).toBeNull();
  fireEvent.click(screen.getByRole('alert').querySelector('button')!);
  expect(await screen.findByText('正在读取模型列表…')).toBeTruthy();
  expect(screen.queryByText('还没有模型，请先连接 API')).toBeNull();
  await act(async () => resolveModels(Response.json({ items: [] })));
  expect(await screen.findByText('尚未配置模型服务')).toBeTruthy();
  expect(screen.getByText('尚未连接 API')).toBeTruthy();
  expect(notify).toHaveBeenCalledWith('读取 AI 模型服务失败', 'error');
});

it('破限模式读取服务端默认状态与规则，保存失败保留开关，重试成功后再次打开仍使用保存值', async () => {
  let enabled = true, attempts = 0;
  const updates: unknown[] = [];
  const config = () => ({ provider: '', model: '', configured: false, configuredProviders: [], backendVersion: 'synthetic', sourceVersion: 'synthetic', creativeDirect: enabled, creativeDirectRules: 'synthetic direct rules', creativeDirectRulesDefault: 'synthetic default rules', creativeDirectRulesCustom: true });
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/config')) return Response.json(config());
    if (url.endsWith('/available-models') || url.endsWith('/custom-providers')) return Response.json({ items: [] });
    if (url.endsWith('/library-prompts')) return Response.json({ spec: '', extra: '' });
    if (url.endsWith('/creative-direct')) {
      expect(init?.method).toBe('PUT'); updates.push(JSON.parse(String(init?.body)));
      if (++attempts === 1) return Response.json({ error: 'synthetic save failure' }, { status: 500 });
      enabled = JSON.parse(String(init?.body)).enabled;
      return Response.json(config());
    }
    throw new Error(`不应调用的接口：${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const notify = vi.fn();
  const mount = () => render(<ConfirmDialogProvider><PromptAgentSettings notify={notify} /></ConfirmDialogProvider>);
  mount();
  const toggle = screen.getByRole('checkbox', { name: '破限模式' }) as HTMLInputElement;
  await waitFor(() => expect(toggle.checked).toBe(true));
  fireEvent.click(screen.getByText('查看与编辑破限规则'));
  await waitFor(() => expect((screen.getByRole('textbox', { name: '破限规则正文' }) as HTMLTextAreaElement).value).toBe('synthetic direct rules'));
  fireEvent.click(toggle);
  await waitFor(() => expect(notify).toHaveBeenCalledWith('synthetic save failure', 'error'));
  expect(toggle.checked).toBe(true);
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.checked).toBe(false));
  expect(updates).toEqual([{ enabled: false }, { enabled: false }]);
  cleanup(); mount();
  await waitFor(() => expect((screen.getByRole('checkbox', { name: '破限模式' }) as HTMLInputElement).disabled).toBe(false));
  expect((screen.getByRole('checkbox', { name: '破限模式' }) as HTMLInputElement).checked).toBe(false);
});

it('破限规则可编辑保存并恢复内置默认，失败保留草稿与提示', async () => {
  let currentRules = 'synthetic direct rules', custom = true, failNext = false;
  const writes: unknown[] = [];
  const config = () => ({ provider: '', model: '', configured: false, configuredProviders: [], backendVersion: 'synthetic', sourceVersion: 'synthetic', creativeDirect: true, creativeDirectRules: currentRules, creativeDirectRulesDefault: 'synthetic default rules', creativeDirectRulesCustom: custom });
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/config')) return Response.json(config());
    if (url.endsWith('/available-models') || url.endsWith('/custom-providers')) return Response.json({ items: [] });
    if (url.endsWith('/library-prompts')) return Response.json({ spec: '', extra: '' });
    if (url.endsWith('/creative-direct-rules')) {
      expect(init?.method).toBe('PUT');
      const body = JSON.parse(String(init?.body)); writes.push(body);
      if (failNext) { failNext = false; return Response.json({ error: 'synthetic rules failure' }, { status: 500 }); }
      currentRules = body.rules.trim() || 'synthetic default rules';
      custom = Boolean(body.rules.trim());
      return Response.json(config());
    }
    throw new Error(`不应调用的接口：${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const notify = vi.fn();
  render(<ConfirmDialogProvider><PromptAgentSettings notify={notify} /></ConfirmDialogProvider>);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '破限模式' })).toBeTruthy());
  fireEvent.click(screen.getByText('查看与编辑破限规则'));
  const field = () => screen.getByRole('textbox', { name: '破限规则正文' }) as HTMLTextAreaElement;
  await waitFor(() => expect(field().value).toBe('synthetic direct rules'));
  fireEvent.change(field(), { target: { value: 'custom rules from user' } });
  failNext = true;
  fireEvent.click(screen.getByRole('button', { name: '保存规则' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('synthetic rules failure', 'error'));
  expect(field().value).toBe('custom rules from user');
  fireEvent.click(screen.getByRole('button', { name: '保存规则' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('破限规则已保存'));
  expect(writes.at(-1)).toEqual({ rules: 'custom rules from user' });
  await waitFor(() => expect(field().value).toBe('custom rules from user'));
  fireEvent.click(screen.getByRole('button', { name: '恢复内置默认' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('已恢复内置默认规则'));
  expect(writes.at(-1)).toEqual({ rules: '' });
  await waitFor(() => expect(field().value).toBe('synthetic default rules'));
});

it('联网搜索可保存独立地址与 Key，未配置时提示回退免费搜索', async () => {
  let enabled = false, baseUrl = 'https://api.deepseek.com', custom = false;
  const config = () => ({ provider: '', model: '', configured: false, configuredProviders: [], backendVersion: 'synthetic', sourceVersion: 'synthetic', creativeDirect: false, creativeDirectRules: '', creativeDirectRulesCustom: false, searchEnabled: enabled, searchApiBaseUrl: baseUrl, searchApiKeyConfigured: custom, searchApiKeyCustom: custom });
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/config')) return Response.json(config());
    if (url.endsWith('/available-models') || url.endsWith('/custom-providers')) return Response.json({ items: [] });
    if (url.endsWith('/library-prompts')) return Response.json({ spec: '', extra: '' });
    if (url.endsWith('/search-api')) {
      expect(init?.method).toBe('PUT');
      const body = JSON.parse(String(init?.body));
      if (body.enabled !== undefined) enabled = body.enabled;
      if (body.baseUrl) baseUrl = body.baseUrl;
      if (typeof body.apiKey === 'string') custom = Boolean(body.apiKey.trim());
      return Response.json(config());
    }
    throw new Error(`不应调用的接口：${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  render(<ConfirmDialogProvider><PromptAgentSettings notify={vi.fn()} /></ConfirmDialogProvider>);
  const toggle = screen.getByRole('checkbox', { name: '使用搜索 API' }) as HTMLInputElement;
  await waitFor(() => expect(toggle.disabled).toBe(false));
  expect(toggle.checked).toBe(false);
  expect(screen.getByText('未检测到可用 Key，开启后仍使用免费搜索。')).toBeTruthy();
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.checked).toBe(true));
  fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'synthetic-key' } });
  fireEvent.click(screen.getByRole('button', { name: '保存搜索设置' }));
  await waitFor(() => expect(screen.getByText('已保存搜索专用 Key。')).toBeTruthy());
  expect(fetch.mock.calls.some(([url, init]) => String(url).endsWith('/search-api') && JSON.parse(String(init?.body)).apiKey === 'synthetic-key')).toBe(true);
});
