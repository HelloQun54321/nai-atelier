// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TaggerRemoteAccessSettings } from '../../components/TaggerRemoteAccessSettings';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('读取服务器偏好，显式保存开关与列表，关闭不清空列表', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ enabled: false, origins: ['https://example.com'] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true, origins: ['https://example.com'] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: false, origins: ['https://example.com'] })));
  vi.stubGlobal('fetch', fetcher);
  render(<TaggerRemoteAccessSettings />);
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('https://example.com'));
  const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: '保存来源配置' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ enabled: true, origins: ['https://example.com'] });
  await waitFor(() => expect((screen.getByRole('button', { name: '保存来源配置' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: '保存来源配置' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ enabled: false, origins: ['https://example.com'] });
});
it('保存失败显示错误并保留未保存输入', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ enabled: false, origins: [] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: '来源尚未允许' }), { status: 403 })));
  render(<TaggerRemoteAccessSettings />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  fireEvent.change(input, { target: { value: 'https://example.com' } });
  fireEvent.click(screen.getByRole('button', { name: '保存来源配置' }));
  expect((await screen.findByRole('alert')).textContent).toBe('来源尚未允许');
  expect(input.value).toBe('https://example.com');
});
it('首次加载显示 InlineSpinner；失败禁写，重读成功才恢复编辑', async () => {
  let rejectFirst!: (error: Error) => void;
  const first = new Promise<Response>((_, reject) => { rejectFirst = reject; });
  const fetcher = vi.fn().mockReturnValueOnce(first)
    .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true, origins: ['https://example.com'] })));
  vi.stubGlobal('fetch', fetcher);
  render(<TaggerRemoteAccessSettings />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  const save = screen.getByRole('button', { name: '保存来源配置' }) as HTMLButtonElement;
  expect(screen.getByRole('status').textContent).toContain('正在读取配置');
  expect(input.disabled).toBe(true);
  expect(save.disabled).toBe(true);
  await act(async () => { rejectFirst(new Error('offline')); });
  expect((await screen.findByRole('alert')).textContent).toBe('offline');
  expect(screen.queryByRole('status')).toBeNull();
  expect(input.value).toBe('');
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  await waitFor(() => expect(input.value).toBe('https://example.com'));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect(input.disabled).toBe(false);
  expect(save.disabled).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('保存遇到读取错误及重读失败时保留草稿，成功重读后才重新启用', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ enabled: false, origins: [] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: '无法读取来源配置', code: 'TAGGER_REMOTE_ACCESS_READ_FAILED' }), { status: 503 }))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: false, origins: ['https://saved.example.com'] })));
  vi.stubGlobal('fetch', fetcher);
  render(<TaggerRemoteAccessSettings />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
  const save = screen.getByRole('button', { name: '保存来源配置' }) as HTMLButtonElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  fireEvent.click(checkbox);
  fireEvent.change(input, { target: { value: 'https://draft.example.com' } });
  fireEvent.click(save);
  await screen.findByRole('alert');
  expect(save.disabled).toBe(true);
  expect(input.value).toBe('https://draft.example.com');
  expect(checkbox.checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('offline'));
  expect(input.value).toBe('https://draft.example.com');
  expect(checkbox.checked).toBe(true);
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  await waitFor(() => expect(input.value).toBe('https://saved.example.com'));
  expect(checkbox.checked).toBe(false);
  expect(save.disabled).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});
it('读取返回无效载荷时禁止覆盖，仍可展开首次配置帮助并重新读取', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: false, origins: [] })));
  vi.stubGlobal('fetch', fetcher);
  render(<TaggerRemoteAccessSettings />);
  expect((await screen.findByRole('alert')).textContent).toBe('无法读取来源配置');
  expect((screen.getByRole('button', { name: '保存来源配置' }) as HTMLButtonElement).disabled).toBe(true);
  const summary = screen.getByText('首次配置方法（本机页面 / 命令行）');
  const help = summary.closest('details')!;
  expect(help.open).toBe(false);
  fireEvent.click(summary);
  expect(help.open).toBe(true);
  expect(help.textContent).toContain("curl --noproxy '*'");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '保存来源配置' }) as HTMLButtonElement).disabled).toBe(false));
});
