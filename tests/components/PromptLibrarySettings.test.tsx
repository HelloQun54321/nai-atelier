// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptLibrarySettings } from '../../components/PromptLibrarySettings';
import { PromptLibraryContext } from '../../components/PromptLibraryAccess';
import { promptAgentService } from '../../services/promptAgent';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('读取失败时不允许用空框覆盖原配置', async () => {
  vi.spyOn(promptAgentService, 'getLibraryPrompts').mockRejectedValue(new Error('synthetic failure'));
  const save = vi.spyOn(promptAgentService, 'saveLibraryPrompts');
  render(<PromptLibrarySettings />);
  await screen.findByText('读取已保存的库生成提示词失败');
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('textbox', { name: '规范提示词' }) as HTMLTextAreaElement).disabled).toBe(true);
  expect(save).not.toHaveBeenCalled();
});

it('预览使用当前未保存的输入，保存失败保留草稿和再次保存入口', async () => {
  vi.spyOn(promptAgentService, 'getLibraryPrompts').mockResolvedValue({ spec: 'saved', extra: '' });
  const preview = vi.spyOn(promptAgentService, 'previewLibrarySystemPrompt').mockResolvedValue({ kind: 'appearance', length: 7, systemPrompt: 'preview' });
  vi.spyOn(promptAgentService, 'saveLibraryPrompts').mockRejectedValue(new Error('synthetic save failure'));
  render(<PromptLibrarySettings />);
  await waitFor(() => expect((screen.getByRole('textbox', { name: '规范提示词' }) as HTMLTextAreaElement).value).toBe('saved'));
  fireEvent.change(screen.getByRole('textbox', { name: '规范提示词' }), { target: { value: 'unsaved' } });
  fireEvent.click(screen.getByRole('button', { name: '预览最终系统提示词' }));
  await waitFor(() => expect(preview).toHaveBeenCalledWith({ kind: 'appearance', spec: 'unsaved', extra: '' }));
  await screen.findByText('preview');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('synthetic save failure');
  expect((screen.getByRole('textbox', { name: '规范提示词' }) as HTMLTextAreaElement).value).toBe('unsaved');
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false);
});

it('生成规则预览使用当前真实目录而不是固定领域', async () => {
  vi.spyOn(promptAgentService, 'getLibraryPrompts').mockResolvedValue({ spec: 'saved', extra: '' });
  const preview = vi.spyOn(promptAgentService, 'previewLibrarySystemPrompt').mockResolvedValue({ directoryId: 'props', length: 6, systemPrompt: 'custom' });
  const directories = { revision: 1, nodes: [{ id: 'props', parentId: null, name: '道具' }] };
  render(<PromptLibraryContext.Provider value={{ chains: [], directories, save: vi.fn() }}><PromptLibrarySettings /></PromptLibraryContext.Provider>);
  await waitFor(() => expect((screen.getByRole('button', { name: '预览最终系统提示词' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '预览最终系统提示词' }));
  await waitFor(() => expect(preview).toHaveBeenCalledWith({ directories, directoryId: 'props', spec: 'saved', extra: '' }));
  expect(screen.queryByRole('tab', { name: '外貌' })).toBeNull();
});
