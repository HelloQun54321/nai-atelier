// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptLibraryTagEditor } from '../../components/PromptLibraryTagEditor';

afterEach(cleanup);
it('标签可为空或多个，输入只在保存时trim和去重，不在失焦时提交', async () => {
  const save = vi.fn(async (_tags: string[]) => {});
  render(<PromptLibraryTagEditor tags={[]} suggestions={[]} onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  const input = screen.getByRole('textbox', { name: '编辑自定义标签' });
  fireEvent.change(input, { target: { value: ' 夜晚，夜晚, 城市 ' } }); fireEvent.blur(input);
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存标签' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '编辑自定义标签' })).toBeNull());
  expect(save).toHaveBeenLastCalledWith(['夜晚', '城市']);
  expect(screen.getByText('城市')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  fireEvent.change(screen.getByRole('textbox', { name: '编辑自定义标签' }), { target: { value: ' , ， ' } });
  fireEvent.click(screen.getByRole('button', { name: '保存标签' }));
  await waitFor(() => expect(screen.getByText('暂无标签')).toBeTruthy());
  expect(save).toHaveBeenLastCalledWith([]);
});

it.each([390, 1280])('宽度%d复用就地标签候选，不产生被管理层遮挡的新浮层，取消不保存', width => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const save = vi.fn(async () => {});
  const pushState = vi.spyOn(window.history, 'pushState');
  const view = render(<div style={{ position: 'fixed', zIndex: 1900 }}><PromptLibraryTagEditor tags={['已有']} suggestions={['已有', '城市']} onSave={save} /></div>);
  try {
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  const input = screen.getByRole('textbox', { name: '编辑自定义标签' });
  fireEvent.change(input, { target: { value: '已有, ' } });
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  expect(view.container.contains(screen.getByRole('button', { name: '#城市' }))).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(pushState).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '#城市' }));
  expect((input as HTMLInputElement).value).toBe('已有, 城市');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  expect((screen.getByRole('textbox', { name: '编辑自定义标签' }) as HTMLInputElement).value).toBe('已有');
  } finally { view.unmount(); pushState.mockRestore(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth }); }
});

it('保存失败保留输入与错误，切换资料后迟到结果不改新资料标签', async () => {
  let reject!: (error: Error) => void;
  const save = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  const view = render(<PromptLibraryTagEditor key="one" tags={['旧']} suggestions={[]} onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  fireEvent.change(screen.getByRole('textbox', { name: '编辑自定义标签' }), { target: { value: '草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '保存标签' }));
  expect(screen.queryByText('草稿')).toBeNull();
  await act(async () => reject(new Error('synthetic failure')));
  expect((screen.getByRole('textbox', { name: '编辑自定义标签' }) as HTMLInputElement).value).toBe('草稿');
  expect(screen.getByRole('alert').textContent).toContain('synthetic failure');
  fireEvent.click(screen.getByRole('button', { name: '保存标签' }));
  view.rerender(<PromptLibraryTagEditor key="two" tags={['另一条']} suggestions={[]} onSave={save} />);
  await act(async () => reject(new Error('late failure')));
  expect(screen.getByText('另一条')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  expect((screen.getByRole('textbox', { name: '编辑自定义标签' }) as HTMLInputElement).value).toBe('另一条');
});

it('父资料确认新标签后丢弃旧来源缓存，随后恢复原标签不显示陈旧保存结果', async () => {
  const save = vi.fn(async () => {});
  const view = render(<PromptLibraryTagEditor tags={['旧标签']} suggestions={[]} onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  fireEvent.change(screen.getByRole('textbox', { name: '编辑自定义标签' }), { target: { value: '新标签' } });
  fireEvent.click(screen.getByRole('button', { name: '保存标签' }));
  await waitFor(() => expect(screen.getByText('新标签')).toBeTruthy());
  view.rerender(<PromptLibraryTagEditor tags={['新标签']} suggestions={[]} onSave={save} />);
  expect(screen.getByText('新标签')).toBeTruthy();
  view.rerender(<PromptLibraryTagEditor tags={['旧标签']} suggestions={[]} onSave={save} />);
  expect(screen.getByText('旧标签')).toBeTruthy();
  expect(screen.queryByText('新标签')).toBeNull();
});
