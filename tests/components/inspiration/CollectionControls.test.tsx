// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollectionFolderSelect, CollectionTagInput } from '../../../components/inspiration/CollectionControls';
import { db } from '../../../services/dbService';
import { ToolbarPopover } from '../../../components/ToolbarPopover';
import { getRecentCollectionFolders, rememberCollectionFolder } from '../../../services/inspirationUtils';

const folders = ['one', 'two', 'three'].map(id => ({ id, name: id, userId: 'test', sortOrder: 0, createdAt: 1, updatedAt: 1 }));
vi.mock('../../../services/dbService', () => ({ db: { getInspirationBoards: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.mocked(db.getInspirationBoards).mockResolvedValue(folders); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('标签候选包含冷门标签，选择保留逗号前的标签，不重复推荐已输入项，也不使用原生补全', () => {
  const suggestions = Array.from({ length: 100 }, (_, index) => `tag-${index}`);
  const onPick = vi.fn();
  const view = render(<CollectionTagInput aria-label="标签" value="tag-0， " suggestions={suggestions} onPick={onPick} onChange={vi.fn()} />);
  const input = screen.getByRole('textbox', { name: '标签' });
  expect(input.hasAttribute('list')).toBe(false);
  expect(view.container.querySelector('datalist')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  const panel = screen.getByRole('dialog', { name: '选择已有标签' });
  expect(within(panel).queryByRole('button', { name: '#tag-0' })).toBeNull();
  fireEvent.click(within(panel).getByRole('button', { name: '#tag-99' }));
  expect(onPick).toHaveBeenCalledWith('tag-0， tag-99');
  view.rerender(<CollectionTagInput aria-label="标签" value="" suggestions={suggestions} onPick={onPick} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  expect(within(screen.getByRole('dialog', { name: '选择已有标签' })).getAllByRole('button')).toHaveLength(100);
});

it('默认未整理，最近使用的真实收藏夹优先，过期 ID 不出现，不重复选项', async () => {
  rememberCollectionFolder('missing'); rememberCollectionFolder('two');
  const onChange = vi.fn();
  render(<CollectionFolderSelect value="" onChange={onChange} notify={vi.fn()} />);
  const select = screen.getByRole('combobox', { name: '收藏夹' }) as HTMLSelectElement;
  await waitFor(() => expect(select.disabled).toBe(false));
  expect(select.value).toBe('');
  expect(select.querySelector('optgroup[label="最近使用"] option')?.getAttribute('value')).toBe('two');
  expect(Array.from(select.options).map(option => option.value)).toEqual(['', 'two', 'one', 'three']);
  fireEvent.change(select, { target: { value: 'three' } }); expect(onChange).toHaveBeenCalledWith('three');
  expect(getRecentCollectionFolders()).toEqual(['two', 'missing']);
});

it('已有列表不重复请求；读取失败保留当前归属，聚焦可重试', async () => {
  const view = render(<CollectionFolderSelect value="one" boards={folders} onChange={vi.fn()} notify={vi.fn()} />);
  expect(db.getInspirationBoards).not.toHaveBeenCalled();
  view.unmount(); vi.mocked(db.getInspirationBoards).mockRejectedValueOnce(new Error('offline'));
  const notify = vi.fn(); render(<CollectionFolderSelect value="one" onChange={vi.fn()} notify={notify} />);
  await waitFor(() => expect(notify).toHaveBeenCalledWith('收藏夹加载失败', 'error'));
  const select = screen.getByRole('combobox', { name: '收藏夹' }) as HTMLSelectElement;
  expect(select.value).toBe('one'); expect(db.getInspirationBoards).toHaveBeenCalledOnce();
  fireEvent.focus(select);
  await waitFor(() => expect(select.querySelector('option[value="three"]')).toBeTruthy());
  expect(db.getInspirationBoards).toHaveBeenCalledTimes(2); expect(select.value).toBe('one');
});

it('最近使用去重且有界，损坏的偏好不会影响收藏', () => {
  localStorage.setItem('nai-collection-recent-folders', '{}'); expect(getRecentCollectionFolders()).toEqual([]);
  localStorage.setItem('nai-collection-recent-folders', '["4", "4", 8, ""]'); expect(getRecentCollectionFolders()).toEqual(['4']);
  localStorage.clear();
  for (let i = 0; i < 8; i++) rememberCollectionFolder(String(i));
  rememberCollectionFolder('4'); rememberCollectionFolder('');
  expect(getRecentCollectionFolders()).toEqual(['4', '7', '6', '5', '3']);
  localStorage.setItem('nai-collection-recent-folders', 'broken'); expect(getRecentCollectionFolders()).toEqual([]);
});

it.each([390, 1280])('宽度 %s：紧凑标签选择器可搜索、点选，保留逗号前内容，不在打开时触发失焦保存', width => {
  vi.stubGlobal('innerWidth', width);
  const onPick = vi.fn(), onBlur = vi.fn();
  render(<CollectionTagInput aria-label="标签" value="构图， " suggestions={['构图', '光影', '夜景']} onPick={onPick} onBlur={onBlur} onChange={vi.fn()} className="h-10 w-44" />);
  const input = screen.getByRole('textbox', { name: '标签' });
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  fireEvent.blur(input);
  expect(onBlur).not.toHaveBeenCalled();
  const panel = screen.getByRole('dialog', { name: '选择已有标签' });
  expect(within(panel).queryByRole('button', { name: '#构图' })).toBeNull();
  fireEvent.change(within(panel).getByRole('searchbox', { name: '搜索标签' }), { target: { value: '夜' } });
  expect(within(panel).queryByRole('button', { name: '#光影' })).toBeNull();
  fireEvent.click(within(panel).getByRole('button', { name: '#夜景' }));
  expect(onPick).toHaveBeenCalledWith('构图， 夜景');
  expect(screen.queryByRole('dialog', { name: '选择已有标签' })).toBeNull();
  fireEvent.blur(input); expect(onBlur).toHaveBeenCalledOnce();
});

it('从筛选面板打开标签选择器，Tab 到箭头不提前保存，Esc 只关闭最上层并归还焦点', () => {
  vi.stubGlobal('innerWidth', 1280);
  const onBlur = vi.fn();
  render(<ToolbarPopover title="外层筛选"><CollectionTagInput aria-label="标签" value="未完成" suggestions={['光影']} onPick={vi.fn()} onBlur={onBlur} onChange={vi.fn()} /></ToolbarPopover>);
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const input = screen.getByRole('textbox', { name: '标签' });
  const trigger = screen.getByRole('button', { name: '选择已有标签' });
  fireEvent.blur(input, { relatedTarget: trigger });
  expect(onBlur).not.toHaveBeenCalled();
  trigger.focus(); fireEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: '选择已有标签' })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '选择已有标签' })).toBeNull();
  expect(screen.getByRole('dialog', { name: '外层筛选' })).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '外层筛选' })).toBeNull();
});
