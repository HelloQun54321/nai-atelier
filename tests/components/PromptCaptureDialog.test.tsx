// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render as renderView, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
const render = (ui: React.ReactNode) => renderView(ui, { wrapper: ConfirmDialogProvider });
import { PromptCaptureDialog } from '../../components/PromptCaptureDialog';

afterEach(cleanup);

it.each(['关闭', '取消', 'Escape'])('原文编辑经%s离开时先确认，取消保留全部草稿，放弃才关闭', async action => {
  const close = vi.fn(), save = vi.fn();
  render(<PromptCaptureDialog open editing initialText="旧正文" initialName="旧名称" onSave={save} onClose={close} />);
  fireEvent.change(screen.getByRole('textbox', { name: '提示词原文' }), { target: { value: '新的正文' } });
  fireEvent.change(screen.getByRole('textbox', { name: '名称（可选）' }), { target: { value: '新名称' } });
  const leave = () => action === 'Escape' ? fireEvent.keyDown(window, { key: 'Escape' }) : fireEvent.click(screen.getByRole('button', { name: action }));
  leave(); await screen.findByRole('alertdialog');
  expect(close).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '取消' }).at(-1)!); });
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('新的正文');
  expect((screen.getByRole('textbox', { name: '名称（可选）' }) as HTMLInputElement).value).toBe('新名称');
  leave(); fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(save).not.toHaveBeenCalled();
});

it('离开前保存失败保留草稿和窗口，重试成功才关闭一次', async () => {
  const close = vi.fn(), save = vi.fn().mockRejectedValueOnce(new Error('合成失败')).mockResolvedValueOnce('saved');
  render(<PromptCaptureDialog open editing initialText="旧正文" onSave={save} onClose={close} />);
  fireEvent.change(screen.getByRole('textbox', { name: '提示词原文' }), { target: { value: '新正文' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存并离开' }));
  await screen.findByRole('alert');
  expect(close).not.toHaveBeenCalled();
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('新正文');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存并离开' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(save).toHaveBeenLastCalledWith('新正文', '', '', []);
});
const original = '  {{snow}}, 1.2::blue hair::\r\n[smile]  ';
const paste = () => fireEvent.paste(screen.getByRole('textbox', { name: '提示词原文' }), { clipboardData: { getData: () => original } });

it('主动粘贴后原样保存，空白禁用，保存期间不重复提交或关闭，成功清空草稿', async () => {
  let done!: () => void;
  const onSave = vi.fn(() => new Promise<string>(resolve => { done = () => resolve('entry-id'); })); const onClose = vi.fn(); const onSaved = vi.fn();
  const p = { open: true, onSave, onClose, onSaved }; const view = render(<PromptCaptureDialog {...p} />);
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '提示词原文' }));
  expect((screen.getByRole('button', { name: '保存原文' }) as HTMLButtonElement).disabled).toBe(true);
  paste(); fireEvent.change(screen.getByRole('textbox', { name: '名称（可选）' }), { target: { value: '雪天' } });
  fireEvent.click(screen.getByRole('button', { name: '保存原文' }));
  fireEvent.click(screen.getAllByRole('button', { name: '保存中…' })[0]); fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled(); expect(onSave).toHaveBeenCalledTimes(1); expect(onSave).toHaveBeenCalledWith(original, '雪天', '', []);
  await act(async () => done()); expect(onClose).toHaveBeenCalledTimes(1); expect(onSaved).toHaveBeenCalledWith('entry-id');
  view.rerender(<PromptCaptureDialog {...p} open={false} />); view.rerender(<PromptCaptureDialog {...p} />);
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('');
});

it('保存失败保留原文供重试；Esc 可关闭当前窗口', async () => {
  const onSave = vi.fn().mockRejectedValueOnce(new Error('合成失败')).mockResolvedValueOnce(undefined); const onClose = vi.fn();
  render(<PromptCaptureDialog open onSave={onSave} onClose={onClose} />); paste();
  fireEvent.click(screen.getByRole('button', { name: '保存原文' }));
  await screen.findByRole('alert'); expect(onClose).not.toHaveBeenCalled();
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe(original.replace(/\r\n/g, '\n'));
  fireEvent.click(screen.getByRole('button', { name: '保存原文' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[1]).toEqual([original, '', '', []]);
});

it('可选择六类分类，保存时传入分类并在成功后恢复不分类', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined); const onClose = vi.fn();
  const view = render(<PromptCaptureDialog open onSave={onSave} onClose={onClose} />); paste();
  fireEvent.change(screen.getByRole('combobox', { name: '分类' }), { target: { value: 'appearance' } });
  const button = screen.getByRole('button', { name: '保存片段' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(original, '', 'appearance', []));
  view.rerender(<PromptCaptureDialog open onSave={onSave} onClose={onClose} />);
  expect((screen.getByRole('combobox', { name: '分类' }) as HTMLSelectElement).value).toBe('');
});

it('保存并继续清空正文和名称，保留分类与标签；失败时保留输入', async () => {
  const onSave = vi.fn().mockResolvedValueOnce('one').mockRejectedValueOnce(new Error('稍后重试'));
  const onSaved = vi.fn(); const onClose = vi.fn();
  render(<PromptCaptureDialog open onSave={onSave} onSaved={onSaved} onClose={onClose} />);
  paste(); fireEvent.change(screen.getByRole('textbox', { name: '名称（可选）' }), { target: { value: '雪夜' } });
  fireEvent.change(screen.getByRole('combobox', { name: '分类' }), { target: { value: 'scene' } });
  fireEvent.change(screen.getByRole('textbox', { name: '标签（可选）' }), { target: { value: '冬天, 夜景，冬天' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(original, '雪夜', 'scene', ['冬天', '夜景']));
  expect(onSaved).toHaveBeenCalledWith('one'); expect(onClose).not.toHaveBeenCalled();
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('');
  expect((screen.getByRole('textbox', { name: '名称（可选）' }) as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('combobox', { name: '分类' }) as HTMLSelectElement).value).toBe('scene');
  expect((screen.getByRole('textbox', { name: '标签（可选）' }) as HTMLInputElement).value).toBe('冬天, 夜景，冬天');
  fireEvent.change(screen.getByRole('textbox', { name: '提示词原文' }), { target: { value: '新文本' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));
  await screen.findByRole('alert');
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('新文本');
  expect((screen.getByRole('combobox', { name: '分类' }) as HTMLSelectElement).value).toBe('scene');
  expect((screen.getByRole('textbox', { name: '标签（可选）' }) as HTMLInputElement).value).toBe('冬天, 夜景，冬天');
  expect(onSaved).toHaveBeenCalledTimes(1);
});

it('隐藏再打开保留草稿；新的入口初值只在新打开时替换草稿', () => {
  const props = { open: true, onSave: vi.fn().mockResolvedValue(undefined), onClose: vi.fn(), initialText: '来自历史', initialName: '历史记录', initialCategory: 'appearance', initialTags: '历史,参考' };
  const view = render(<PromptCaptureDialog {...props} />);
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('来自历史');
  expect((screen.getByRole('textbox', { name: '名称（可选）' }) as HTMLInputElement).value).toBe('历史记录');
  fireEvent.change(screen.getByRole('textbox', { name: '提示词原文' }), { target: { value: '人工修改' } });
  view.rerender(<PromptCaptureDialog {...props} initialText="更新的入口值" />);
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('人工修改');
  view.rerender(<PromptCaptureDialog {...props} open={false} />);
  expect(screen.queryByRole('textbox', { name: '提示词原文' })).toBeNull();
  view.rerender(<PromptCaptureDialog {...props} open={false} initialText="另一段历史" />);
  view.rerender(<PromptCaptureDialog {...props} open initialText="另一段历史" />);
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('另一段历史');
});

it('编辑模式保留初值，隐藏连续收录并使用修改提示', async () => {
  const onSave = vi.fn().mockRejectedValueOnce(new Error('暂时不可用'));
  render(<PromptCaptureDialog open editing initialText="原文正文" initialName="原文名称" initialCategory="scene" initialTags="冬夜" onSave={onSave} onClose={vi.fn()} />);
  expect(screen.getByRole('heading', { name: '编辑原文' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '保存并继续' })).toBeNull();
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('原文正文');
  expect((screen.getByRole('textbox', { name: '名称（可选）' }) as HTMLInputElement).value).toBe('原文名称');
  expect((screen.getByRole('combobox', { name: '分类' }) as HTMLSelectElement).value).toBe('scene');
  expect((screen.getByRole('textbox', { name: '标签（可选）' }) as HTMLInputElement).value).toBe('冬夜');
  fireEvent.click(screen.getByRole('button', { name: '另存片段' }));
  await screen.findByRole('alert');
  expect(onSave).toHaveBeenCalledWith('原文正文', '原文名称', 'scene', ['冬夜']);
  expect(screen.getByRole('alert').textContent).toBe('保存失败：暂时不可用');
});

it('分类禁用时保持原文分类并隐藏另存片段操作', async () => {
  const onSave = vi.fn().mockResolvedValue('negative-id');
  render(<PromptCaptureDialog open editing categoryDisabled initialText="negative prompt" initialCategory="appearance" onSave={onSave} onClose={vi.fn()} />);
  const category = screen.getByRole('combobox', { name: '分类' }) as HTMLSelectElement;
  expect(category.disabled).toBe(true); expect(category.value).toBe('');
  expect(screen.queryByRole('button', { name: '另存片段' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('negative prompt', '', '', []));
});

it('真实目录支持片段不归类并通过第五参数保留明确空归属', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<PromptCaptureDialog open directories={{ revision: 0, nodes: [] }} onSave={onSave} onClose={vi.fn()} />);
  paste();
  fireEvent.change(screen.getByRole('combobox', { name: '分类' }), { target: { value: 'fragment' } });
  fireEvent.click(screen.getByRole('button', { name: '保存片段' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(original, '', 'general', [], []));
});
