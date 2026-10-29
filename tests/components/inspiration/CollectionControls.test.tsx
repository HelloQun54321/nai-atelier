// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollectionFolderPicker, CollectionTagInput } from '../../../components/inspiration/CollectionControls';
import { ToolbarPopover } from '../../../components/ToolbarPopover';
import { getRecentCollectionFolders, rememberCollectionFolder } from '../../../services/inspirationUtils';
import { ImageActivityContext } from '../../../components/SmartImage';

const folders = ['one', 'two', 'three'].map(id => ({ id, name: id, userId: 'test', sortOrder: 0, createdAt: 1, updatedAt: 1 }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([390, 1280])('宽度 %s：收藏夹待定和失败不显示暂无，已知空目录才显示空态', width => {
  vi.stubGlobal('innerWidth', width);
  const retry = vi.fn(), props = { boards: [], value: [], onToggle: vi.fn(), onRetry: retry };
  const view = render(<CollectionFolderPicker {...props} loading />); fireEvent.click(screen.getByRole('button', { name: '管理收藏夹' }));
  expect(screen.getByRole('status').textContent).toContain('正在读取…'); expect(screen.queryByText('暂无收藏夹')).toBeNull();
  view.rerender(<CollectionFolderPicker {...props} error="合成收藏夹读取失败" />);
  expect(screen.getByRole('alert').textContent).toContain('合成收藏夹读取失败'); expect(screen.queryByText('暂无收藏夹')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(retry).toHaveBeenCalledOnce();
  view.rerender(<CollectionFolderPicker {...props} boards={folders} loading />);
  expect(screen.getByRole('checkbox', { name: 'one' })).toHaveProperty('disabled', true); expect(screen.queryByText('暂无收藏夹')).toBeNull();
  view.rerender(<CollectionFolderPicker {...props} />); expect(screen.getByText('暂无收藏夹')).toBeTruthy();
});

it('多归属选择使用共用树复选框和完整路径，只勾选指定子夹，不连带勾选祖先', () => {
  const boards = folders.map((board, index) => ({ ...board, parentId: index ? folders[index - 1].id : null }));
  const onToggle = vi.fn();
  render(<CollectionFolderPicker boards={boards} value={['three']} onToggle={onToggle} />);
  const trigger = screen.getByRole('button', { name: '管理收藏夹' });
  expect(trigger.textContent).toContain('one / two / three'); fireEvent.click(trigger);
  expect((screen.getByRole('checkbox', { name: 'one / two / three' }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: 'one' }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('checkbox', { name: 'one / two' }));
  expect(onToggle).toHaveBeenCalledExactlyOnceWith('two', true);
});

it('多夹选择器默认未整理，目录保持树顺序，不因最近使用混排或展示已失效目录', () => {
  vi.stubGlobal('innerWidth', 1280);
  rememberCollectionFolder('missing'); rememberCollectionFolder('two');
  render(<CollectionFolderPicker boards={folders} value={[]} onToggle={vi.fn()} />);
  const trigger = screen.getByRole('button', { name: '管理收藏夹' });
  expect(trigger.textContent).toContain('未整理'); fireEvent.click(trigger);
  expect(screen.getAllByRole('checkbox').map(input => input.closest('label')!.textContent)).toEqual(['one', 'two', 'three']);
  expect(getRecentCollectionFolders()).toEqual(['two', 'missing']);
});

it('隐藏页面挂载及打开收藏夹控件不抢占返回历史，也不自行加载目录', () => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const push = vi.spyOn(window.history, 'pushState');
  render(<ImageActivityContext.Provider value={false}><CollectionFolderPicker boards={folders} value={['one']} onToggle={vi.fn()} /></ImageActivityContext.Provider>);
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '管理收藏夹' }));
  expect(screen.getByRole('checkbox', { name: 'one' })).toBeTruthy(); expect(push).not.toHaveBeenCalled();
  push.mockRestore();
});

it.each([390, 1280])('宽度 %s：收藏夹复选支持多选和部分选中，仅回报触及的归属，完成归还焦点', width => {
  vi.stubGlobal('innerWidth', width);
  const onToggle = vi.fn();
  const props = { boards: folders, value: ['one'], mixedIds: ['two'], onToggle };
  const view = render(<CollectionFolderPicker {...props} />);
  const trigger = screen.getByRole('button', { name: '管理收藏夹' });
  trigger.focus(); fireEvent.click(trigger);
  const panel = screen.getByRole('dialog', { name: '管理收藏夹' });
  expect((within(panel).getByRole('checkbox', { name: 'one' }) as HTMLInputElement).checked).toBe(true);
  const partial = within(panel).getByRole('checkbox', { name: /two/ }) as HTMLInputElement;
  expect(partial.indeterminate).toBe(true); expect(partial.getAttribute('aria-checked')).toBe('mixed');
  fireEvent.click(partial); expect(onToggle).toHaveBeenLastCalledWith('two', true);
  view.rerender(<CollectionFolderPicker {...props} value={['one', 'two']} mixedIds={[]} />);
  expect((within(panel).getByRole('checkbox', { name: 'one' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(panel).getByRole('checkbox', { name: 'two' })); expect(onToggle).toHaveBeenLastCalledWith('two', false);
  expect(within(panel).queryByRole('checkbox', { name: '未整理' })).toBeNull();
  fireEvent.click(within(panel).getByRole('button', { name: '完成' }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
});

it.each([390, 1280])('宽度 %s：嵌套表单的标签候选就地展开，不新建弹窗或返回层', width => {
  vi.stubGlobal('innerWidth', width);
  const push = vi.spyOn(window.history, 'pushState');
  const onPick = vi.fn();
  const view = render(<CollectionTagInput inlineSuggestions aria-label="组合标签" value="个人， " suggestions={['个人', '夜景']} onChange={vi.fn()} onPick={onPick} />);
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(push).not.toHaveBeenCalled();
  expect(view.container.contains(screen.getByRole('button', { name: '#夜景' }))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '#夜景' }));
  expect(onPick).toHaveBeenCalledWith('个人， 夜景');
  expect(screen.queryByRole('button', { name: '#夜景' })).toBeNull();
  push.mockRestore();
});

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
