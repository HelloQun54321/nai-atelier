// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollectionFolderSelect, CollectionTagInput } from '../../../components/inspiration/CollectionControls';
import { db } from '../../../services/dbService';
import { getRecentCollectionFolders, rememberCollectionFolder } from '../../../services/inspirationUtils';

const folders = ['one', 'two', 'three'].map(id => ({ id, name: id, userId: 'test', sortOrder: 0, createdAt: 1, updatedAt: 1 }));
vi.mock('../../../services/dbService', () => ({ db: { getInspirationBoards: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.mocked(db.getInspirationBoards).mockResolvedValue(folders); });
afterEach(cleanup);

it('标签候选包含冷门标签，逗号补全保留之前的标签，不重复推荐已输入项', () => {
  const suggestions = Array.from({ length: 100 }, (_, index) => `tag-${index}`);
  const view = render(<CollectionTagInput aria-label="标签" value="tag-0， " suggestions={suggestions} readOnly />);
  const input = screen.getByRole('combobox', { name: '标签' });
  const list = document.getElementById(input.getAttribute('list')!)!;
  expect(list.querySelector('option[value="tag-0， tag-99"]')).toBeTruthy();
  expect(list.querySelector('option[value="tag-0， tag-0"]')).toBeNull();
  view.rerender(<CollectionTagInput aria-label="标签" value="" suggestions={suggestions} readOnly />);
  expect(list.querySelectorAll('option')).toHaveLength(100);
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
