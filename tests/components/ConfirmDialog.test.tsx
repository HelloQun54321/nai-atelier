// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider, useConfirmDialog, type ConfirmDialogOptions } from '../../components/ConfirmDialog';
import { LANGUAGES, setLanguage, t } from '../../services/i18n';

beforeEach(() => {
  localStorage.clear(); setLanguage('zh-CN');
  window.history.replaceState({ source: 'synthetic' }, '');
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
});
afterEach(() => { cleanup(); setLanguage('zh-CN'); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, ''); });
const setup = (onSave?: () => Promise<boolean>) => {
  const result = vi.fn();
  const options: ConfirmDialogOptions = { title: '有未保存的修改', message: '是否保存当前修改后离开？', cancelLabel: '继续编辑', confirmLabel: '放弃并离开', tone: 'danger', onSave };
  const Harness = () => {
    const confirm = useConfirmDialog();
    return <button onClick={() => { void confirm(options).then(result); }}>打开提示</button>;
  };
  render(<ConfirmDialogProvider><Harness /></ConfirmDialogProvider>);
  const opener = screen.getByRole('button', { name: '打开提示' });
  opener.focus(); fireEvent.click(opener);
  return { result, opener, dialog: screen.getByRole('alertdialog') };
};

it.each(LANGUAGES)('$name 三按钮文案完整，桌面顺序与手机纵排准确，放弃不是默认焦点', async language => {
  setLanguage(language.code);
  const { dialog, result } = setup(vi.fn(async () => true));
  expect(dialog.textContent).toContain(t('有未保存的修改'));
  expect(dialog.textContent).toContain(t('是否保存当前修改后离开？'));
  const save = within(dialog).getByRole('button', { name: t('保存并离开') });
  const discard = within(dialog).getByRole('button', { name: t('放弃并离开') });
  const cancel = within(dialog).getByRole('button', { name: t('继续编辑') });
  expect(save.parentElement?.className).toContain('grid-cols-1');
  expect(save.parentElement?.className).not.toContain('grid-cols-2');
  expect(save.className).toContain('order-1'); expect(save.className).toContain('md:order-3');
  expect(save.className).toContain('bg-emerald-600');
  expect(discard.className).toContain('order-2'); expect(discard.className).toContain('md:order-1');
  expect(discard.className).toContain('md:mr-auto'); expect(discard.className).toContain('bg-red-600');
  expect(discard.className).toContain('text-white');
  expect(cancel.className).toContain('order-3'); expect(cancel.className).toContain('md:order-2');
  expect(document.activeElement).not.toBe(discard);
  fireEvent.click(save);
  await waitFor(() => expect(result).toHaveBeenCalledExactlyOnceWith(true));
});

it.each(['继续编辑', 'Escape', '遮罩', '放弃并离开'])('%s 保留既有选择语义，不调用保存', async action => {
  const onSave = vi.fn(async () => true);
  const { dialog, result, opener } = setup(onSave);
  if (action === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
  else if (action === '遮罩') fireEvent.click(dialog.parentElement!);
  else fireEvent.click(within(dialog).getByRole('button', { name: action }));
  await waitFor(() => expect(result).toHaveBeenCalledExactlyOnceWith(action === '放弃并离开'));
  expect(onSave).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(opener);
});

it('保存等待真实结果，连点、Esc、遮罩和放弃不能打断在途保存', async () => {
  let resolve!: (result: boolean) => void;
  const onSave = vi.fn(() => new Promise<boolean>(done => { resolve = done; }));
  const { dialog, result } = setup(onSave);
  const save = within(dialog).getByRole('button', { name: '保存并离开' });
  fireEvent.click(save); fireEvent.click(save);
  expect(onSave).toHaveBeenCalledOnce(); expect(result).not.toHaveBeenCalled();
  expect(dialog.getAttribute('aria-busy')).toBe('true');
  expect(within(dialog).getByRole('button', { name: '保存中…' }).getAttribute('aria-busy')).toBe('true');
  for (const button of within(dialog).getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' }); fireEvent.click(dialog.parentElement!);
  fireEvent.click(within(dialog).getByRole('button', { name: '放弃并离开' }));
  expect(screen.getByRole('alertdialog')).toBe(dialog);
  await act(async () => resolve(true));
  expect(result).toHaveBeenCalledExactlyOnceWith(true);
});

it.each([false, true])('保存失败（抛出异常=%s）取消跳转，关闭提示后可继续处理原草稿', async throws => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { result } = setup(vi.fn(async () => { if (throws) throw new Error('合成保存异常'); return false; }));
  fireEvent.click(screen.getByRole('button', { name: '保存并离开' }));
  await waitFor(() => expect(result).toHaveBeenCalledExactlyOnceWith(false));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(error).toHaveBeenCalledTimes(throws ? 1 : 0);
});

it('未提供保存动作时，原有两按钮危险确认保持原布局与返回结果', async () => {
  const { dialog, result } = setup();
  expect(within(dialog).getAllByRole('button')).toHaveLength(2);
  const discard = within(dialog).getByRole('button', { name: '放弃并离开' });
  expect(discard.parentElement?.className).toContain('grid-cols-2');
  expect(discard.className).toContain('bg-red-600');
  expect(screen.queryByRole('button', { name: '保存并离开' })).toBeNull();
  fireEvent.click(discard);
  await waitFor(() => expect(result).toHaveBeenCalledExactlyOnceWith(true));
});

it.each([true, false])('手机返回等同继续编辑，不执行保存或放弃（有保存按钮=%s）', async canSave => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
  const onSave = vi.fn(async () => true);
  const { result } = setup(canSave ? onSave : undefined);
  expect(window.history.state.__naiMobileLayer).toContain('confirm');
  const state = { source: 'synthetic' };
  window.history.replaceState(state, '');
  fireEvent(window, new PopStateEvent('popstate', { state }));
  await waitFor(() => expect(result).toHaveBeenCalledExactlyOnceWith(false));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(window.history.back).not.toHaveBeenCalled();
});

it('手机保存中连续返回保持当前层，完成后才退出并清理该层', async () => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
  let resolve!: (result: boolean) => void;
  const { result, dialog } = setup(() => new Promise<boolean>(done => { resolve = done; }));
  const layerState = window.history.state;
  fireEvent.click(screen.getByRole('button', { name: '保存并离开' }));
  for (let back = 0; back < 2; back++) {
    const state = { source: 'synthetic' };
    window.history.replaceState(state, '');
    fireEvent(window, new PopStateEvent('popstate', { state }));
    expect(window.history.state).toEqual(layerState);
    expect(screen.getByRole('alertdialog')).toBe(dialog);
    expect(result).not.toHaveBeenCalled();
  }
  await act(async () => resolve(true));
  expect(result).toHaveBeenCalledExactlyOnceWith(true);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(window.history.back).toHaveBeenCalledOnce();
});
