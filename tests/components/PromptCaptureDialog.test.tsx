// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptCaptureDialog } from '../../components/PromptCaptureDialog';

afterEach(cleanup);
const original = '  {{snow}}, 1.2::blue hair::\r\n[smile]  ';
const paste = () => fireEvent.paste(screen.getByRole('textbox', { name: '提示词原文' }), { clipboardData: { getData: () => original } });

it('主动粘贴后原样保存，空白禁用，保存期间不重复提交或关闭，成功清空草稿', async () => {
  let done!: () => void;
  const onSave = vi.fn(() => new Promise<void>(resolve => { done = resolve; })); const onClose = vi.fn();
  const p = { open: true, onSave, onClose }; const view = render(<PromptCaptureDialog {...p} />);
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '提示词原文' }));
  expect((screen.getByRole('button', { name: '存入组合库' }) as HTMLButtonElement).disabled).toBe(true);
  paste(); fireEvent.change(screen.getByRole('textbox', { name: '名称（可选）' }), { target: { value: '雪天' } });
  fireEvent.click(screen.getByRole('button', { name: '存入组合库' }));
  fireEvent.click(screen.getByRole('button', { name: '保存中…' })); fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled(); expect(onSave).toHaveBeenCalledTimes(1); expect(onSave).toHaveBeenCalledWith(original, '雪天', '');
  await act(async () => done()); expect(onClose).toHaveBeenCalledTimes(1);
  view.rerender(<PromptCaptureDialog {...p} open={false} />); view.rerender(<PromptCaptureDialog {...p} />);
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('');
});

it('保存失败和关闭重开均保留原文；Esc 只关闭当前窗口，未保存不写库', async () => {
  const onSave = vi.fn().mockRejectedValueOnce(new Error('合成失败')).mockResolvedValueOnce(undefined); const onClose = vi.fn();
  const view = render(<PromptCaptureDialog open onSave={onSave} onClose={onClose} />); paste();
  fireEvent.click(screen.getByRole('button', { name: '存入组合库' }));
  await screen.findByRole('alert'); expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' }); expect(onClose).toHaveBeenCalledTimes(1);
  view.rerender(<PromptCaptureDialog open={false} onSave={onSave} onClose={onClose} />);
  view.rerender(<PromptCaptureDialog open onSave={onSave} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: '存入组合库' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onSave.mock.calls[1]).toEqual([original, '', '']);
});

it('可选择六类分类，保存时传入分类并在成功后恢复不分类', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined); const onClose = vi.fn();
  const view = render(<PromptCaptureDialog open onSave={onSave} onClose={onClose} />); paste();
  fireEvent.change(screen.getByRole('combobox', { name: '分类' }), { target: { value: 'appearance' } });
  const button = screen.getByRole('button', { name: '存入内容库' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(original, '', 'appearance'));
  view.rerender(<PromptCaptureDialog open onSave={onSave} onClose={onClose} />);
  expect((screen.getByRole('combobox', { name: '分类' }) as HTMLSelectElement).value).toBe('');
});
