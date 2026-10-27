// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DirectoryNodeDialog } from '../../components/DirectoryNodeDialog';
import { ImageActivityProvider } from '../../components/SmartImage';

const nodes = [
  { id: 'root', name: '根', parentId: null }, { id: 'child', name: '子项', parentId: 'root' },
  { id: 'leaf', name: '末层', parentId: 'child' }, { id: 'other', name: '另一根', parentId: null },
];
const props = () => ({ title: '编辑目录', nodes, name: '子项', parentId: 'root', editingId: 'child', onNameChange: vi.fn(), onParentChange: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn() });

function Harness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('目录草稿');
  const [parentId, setParentId] = useState('root');
  return <><button onClick={() => setOpen(true)}>打开目录</button>{open && <DirectoryNodeDialog {...props()} name={name} parentId={parentId} busy={busy} onNameChange={setName} onParentChange={setParentId} onClose={() => setOpen(false)} />}</>;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('一层紧凑面板复用完整路径父级选择，排除自己与后代并保留业务扩展字段', () => {
  const callbacks = props();
  render(<DirectoryNodeDialog {...callbacks} nameLabel="文件夹名称" namePlaceholder="例如：电影感光影" parentLabel="上级文件夹" rootLabel="顶层位置" error="合成保存失败"><label>业务字段<input aria-label="业务字段" /></label></DirectoryNodeDialog>);
  const dialog = screen.getByRole('dialog', { name: '编辑目录' });
  expect(document.querySelectorAll('.appearance-panel')).toHaveLength(1);
  expect(dialog.className).toContain('max-w-md');
  expect(dialog.parentElement?.className).toContain('z-[2100]');
  expect(screen.getByPlaceholderText('例如：电影感光影')).toBe(screen.getByLabelText('文件夹名称'));
  expect(screen.getByLabelText('文件夹名称').hasAttribute('maxlength')).toBe(false);
  const parent = screen.getByLabelText('上级文件夹');
  expect(within(parent).getByRole('option', { name: '根' })).toBeTruthy();
  expect(within(parent).getByRole('option', { name: '另一根' })).toBeTruthy();
  expect(within(parent).queryByRole('option', { name: '根 / 子项' })).toBeNull();
  expect(within(parent).queryByRole('option', { name: '根 / 子项 / 末层' })).toBeNull();
  expect(within(parent).getByRole('option', { name: '顶层位置' })).toHaveProperty('value', '');
  expect(screen.getByRole('alert').textContent).toBe('合成保存失败');
  expect(screen.getByLabelText('业务字段')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('文件夹名称'), { target: { value: '新名称' } });
  fireEvent.change(parent, { target: { value: 'other' } });
  fireEvent.submit(dialog.querySelector('form')!);
  expect(callbacks.onNameChange).toHaveBeenCalledWith('新名称');
  expect(callbacks.onParentChange).toHaveBeenCalledWith('other');
  expect(callbacks.onSubmit).toHaveBeenCalledOnce();
  expect(callbacks.onClose).not.toHaveBeenCalled();
});

it('Portal就绪后移入焦点、Tab圈禁，Escape关闭后归还触发器', () => {
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: '打开目录' });
  trigger.focus(); fireEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByLabelText('名称'));
  const parent = screen.getByLabelText('上级目录');
  parent.focus();
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '后续草稿' } });
  expect(document.activeElement).toBe(parent);
  screen.getByRole('button', { name: '关闭' }).focus();
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '保存' }));
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('异步就绪后首次聚焦名称，后续busy切换不抢用户焦点', () => {
  const callbacks = props();
  const view = render(<DirectoryNodeDialog {...callbacks} disabled />);
  const name = screen.getByLabelText('名称');
  expect(document.activeElement).not.toBe(name);
  view.rerender(<DirectoryNodeDialog {...callbacks} />);
  expect(document.activeElement).toBe(name);
  const parent = screen.getByLabelText('上级目录');
  parent.focus();
  view.rerender(<DirectoryNodeDialog {...callbacks} busy />);
  view.rerender(<DirectoryNodeDialog {...callbacks} />);
  expect(document.activeElement).toBe(parent);
});

it('仅最上层目录窗响应Escape与遮罩，disabled只禁编辑和提交并允许关闭', () => {
  const callbacks = props();
  const view = render(<DirectoryNodeDialog {...callbacks} disabled />);
  const dialog = screen.getByRole('dialog', { name: '编辑目录' });
  expect((screen.getByLabelText('名称') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(dialog.querySelector('form')!);
  expect(callbacks.onSubmit).not.toHaveBeenCalled();
  const upper = render(<div role="dialog" aria-modal="true" aria-label="更高窗口" style={{ position: 'fixed', zIndex: 2200 }} />);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.mouseDown(dialog.parentElement!);
  expect(callbacks.onClose).not.toHaveBeenCalled();
  upper.unmount();
  fireEvent.mouseDown(dialog.parentElement!);
  expect(callbacks.onClose).toHaveBeenCalledOnce();
  view.rerender(<DirectoryNodeDialog {...callbacks} name="   " maxLength={60} />);
  expect(screen.getByLabelText('名称')).toHaveProperty('maxLength', 60);
  fireEvent.submit(dialog.querySelector('form')!);
  expect(callbacks.onSubmit).not.toHaveBeenCalled();
});

it('后台视图释放焦点与键盘，恢复后保持受控草稿', () => {
  const page = (active: boolean) => <ImageActivityProvider active={active}><Harness /></ImageActivityProvider>;
  const view = render(page(true));
  const trigger = screen.getByRole('button', { name: '打开目录' });
  trigger.focus(); fireEvent.click(trigger);
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '保留草稿' } });
  const dialog = screen.getByRole('dialog');
  view.rerender(page(false));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(dialog.contains(document.activeElement)).toBe(false);
  fireEvent.keyDown(window, { key: 'Escape' });
  view.rerender(page(true));
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(screen.getByLabelText('名称')).toHaveProperty('value', '保留草稿');
});

it('保存中禁止Escape、遮罩、关闭和手机返回，结束后返回仅退出本层', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState({ __naiMobileLayers: ['parent'], __naiMobileLayer: 'parent' }, '');
  const view = render(<Harness busy />);
  fireEvent.click(screen.getByRole('button', { name: '打开目录' }));
  await waitFor(() => expect(window.history.state.__naiMobileLayers).toHaveLength(2));
  const dialog = screen.getByRole('dialog');
  expect(dialog.getAttribute('aria-busy')).toBe('true');
  for (const label of ['关闭', '取消', '保存']) expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.mouseDown(dialog.parentElement!);
  fireEvent.submit(dialog.querySelector('form')!);
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(window.history.state.__naiMobileLayers).toHaveLength(2);
  view.rerender(<Harness />);
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(window.history.state.__naiMobileLayers).toEqual(['parent']);
});
