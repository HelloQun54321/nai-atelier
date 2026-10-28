// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasNewProjectDialog, CanvasOpenProjectDialog } from '../../../components/canvas/CanvasProjectDialogs';

afterEach(cleanup);

it('新建工程可修改名称和尺寸，禁止非正整数，不设固定尺寸上限', () => {
  const create = vi.fn();
  const view = render(<CanvasNewProjectDialog open onClose={() => {}} onCreate={create} />);
  expect((view.getByLabelText('工程名称') as HTMLInputElement).value).toBe('未命名画布');
  expect((view.getByLabelText('画布宽度') as HTMLInputElement).value).toBe('1920');
  expect((view.getByLabelText('画布高度') as HTMLInputElement).value).toBe('1080');
  fireEvent.change(view.getByLabelText('工程名称'), { target: { value: '  风景  ' } });
  fireEvent.change(view.getByLabelText('画布宽度'), { target: { value: '0' } });
  expect((view.getByRole('button', { name: '新建' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(view.getByLabelText('画布宽度'), { target: { value: '100000' } });
  fireEvent.change(view.getByLabelText('画布高度'), { target: { value: '1.5' } });
  expect((view.getByRole('button', { name: '新建' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(view.getByLabelText('画布高度'), { target: { value: '3000' } });
  fireEvent.click(view.getByRole('button', { name: '新建' }));
  expect(create).toHaveBeenCalledWith('风景', 100000, 3000);
});

it('工程缩略图打开对应工程，删除按钮只发出删除请求', () => {
  const open = vi.fn();
  const remove = vi.fn();
  const view = render(<CanvasOpenProjectDialog open projects={[{ id: 'a', name: '人物', updatedAt: 0, thumbnail: 'data:image/png;base64,AA==' }, { id: 'b', name: '风景', updatedAt: 0 }]} onClose={() => {}} onOpen={open} onDelete={remove} />);
  expect(view.getByRole('dialog', { name: '打开画布工程' }).getAttribute('aria-modal')).toBe('true');
  expect(view.container.ownerDocument.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA==');
  fireEvent.click(view.getByRole('button', { name: '关闭画布 人物' }));
  expect(remove).toHaveBeenCalledWith('a');
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '打开工程 风景' }));
  expect(open).toHaveBeenCalledWith('b');
});

it('对话框捕获 Tab，Escape 关闭并在关闭后恢复焦点', () => {
  const close = vi.fn();
  const props = { projects: [], onClose: close, onOpen: () => {}, onDelete: () => {} };
  const view = render(<><button type="button">入口</button><CanvasOpenProjectDialog open={false} {...props} /></>);
  const trigger = view.getByRole('button', { name: '入口' });
  trigger.focus();
  view.rerender(<><button type="button">入口</button><CanvasOpenProjectDialog open {...props} /></>);
  const dialog = view.getByRole('dialog', { name: '打开画布工程' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
  view.rerender(<><button type="button">入口</button><CanvasOpenProjectDialog open={false} {...props} /></>);
  expect(document.activeElement).toBe(trigger);
});

it('忙碌时新建弹窗禁用全部控件和关闭路径，恢复后保留草稿', () => {
  const close = vi.fn();
  const create = vi.fn();
  const view = render(<CanvasNewProjectDialog open onClose={close} onCreate={create} />);
  fireEvent.change(view.getByLabelText('工程名称'), { target: { value: '我的画布' } });
  view.rerender(<CanvasNewProjectDialog open busy onClose={close} onCreate={create} />);
  const dialog = view.getByRole('dialog', { name: '新建画布工程' });
  expect(dialog.getAttribute('aria-busy')).toBe('true');
  for (const name of ['工程名称', '画布宽度', '画布高度']) expect((view.getByLabelText(name) as HTMLInputElement).disabled).toBe(true);
  for (const name of ['关闭', '取消', '新建']) {
    const button = view.getByRole('button', { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  }
  fireEvent.submit(dialog.querySelector('form')!);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.mouseDown(dialog.parentElement!);
  expect(create).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  view.rerender(<CanvasNewProjectDialog open onClose={close} onCreate={create} />);
  expect((view.getByLabelText('工程名称') as HTMLInputElement).value).toBe('我的画布');
  fireEvent.click(view.getByRole('button', { name: '新建' }));
  expect(create).toHaveBeenCalledWith('我的画布', 1920, 1080);
});

it('忙碌时工程列表不可打开、关闭画布或关闭弹窗', () => {
  const close = vi.fn();
  const open = vi.fn();
  const remove = vi.fn();
  const view = render(<CanvasOpenProjectDialog open busy projects={[{ id: 'a', name: '人物', updatedAt: 0 }]} onClose={close} onOpen={open} onDelete={remove} />);
  const dialog = view.getByRole('dialog', { name: '打开画布工程' });
  for (const name of ['关闭', '打开工程 人物', '关闭画布 人物']) {
    const button = view.getByRole('button', { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  }
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.mouseDown(dialog.parentElement!);
  expect(open).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
