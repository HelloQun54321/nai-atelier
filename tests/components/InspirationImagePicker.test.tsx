// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InspirationImagePicker } from '../../components/InspirationImagePicker';

const mocks = vi.hoisted(() => ({ items: vi.fn(), boards: vi.fn() }));
vi.mock('../../services/dbService', () => ({ db: { getAllInspirations: mocks.items, getInspirationBoards: mocks.boards } }));
vi.mock('../../components/SmartImage', () => ({ SmartImage: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock('../../components/ImagePreviewPortal', () => ({ ImagePreviewPortal: ({ children }: { children: React.ReactNode }) => children }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('收藏选择器重开时旧筛选无匹配也显示读取，失败可重试且不把未知数量当零', async () => {
  mocks.boards.mockResolvedValue([]); mocks.items.mockResolvedValue([{ id: 'one', title: '旧缓存', imageUrl: '/one.png', createdAt: 1 }]);
  const props = { open: true, onClose: vi.fn(), onSelect: vi.fn() };
  const view = render(<InspirationImagePicker {...props} />); await screen.findByRole('button', { name: '选择收藏图片：旧缓存' });
  fireEvent.change(screen.getByPlaceholderText('搜索标题、提示词或标签…'), { target: { value: '新资料' } });
  view.rerender(<InspirationImagePicker {...props} open={false} />);
  let fail!: (error: Error) => void; mocks.items.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  view.rerender(<InspirationImagePicker {...props} />);
  expect(screen.getByText('正在读取收藏库…')).toBeTruthy(); expect(screen.getByText('— / — 张')).toBeTruthy(); expect(screen.queryByText('没有找到匹配的收藏图片')).toBeNull();
  await act(async () => fail(new Error('合成读取失败'))); expect(await screen.findByText('收藏库读取失败，请重试。')).toBeTruthy(); expect(screen.queryByText('没有找到匹配的收藏图片')).toBeNull();
  mocks.items.mockResolvedValue([]); fireEvent.click(screen.getByRole('button', { name: '重新读取' })); expect(await screen.findByText('没有找到匹配的收藏图片')).toBeTruthy(); expect(screen.getByText('0 / 0 张')).toBeTruthy();
});

it.each([390, 1280])('宽度 %s：收藏图片选择共用路径目录，父级包含后代且重叠归属不重复展示', async width => {
  vi.stubGlobal('innerWidth', width);
  mocks.boards.mockResolvedValue([{ id: 'root', name: '根夹' }, { id: 'child', name: '子夹', parentId: 'root' }, { id: 'deep', name: '深层', parentId: 'child' }]);
  mocks.items.mockResolvedValue([
    { id: 'deep-image', title: '深层作品', boardIds: ['root', 'deep'], imageUrl: '/deep.png', createdAt: 1 },
    { id: 'child-image', title: '子夹作品', boardIds: ['child'], imageUrl: '/child.png', createdAt: 1 },
    { id: 'unfiled', title: '无夹作品', boardIds: [], imageUrl: '/unfiled.png', createdAt: 1 },
  ]);
  render(<InspirationImagePicker open onClose={vi.fn()} onSelect={vi.fn()} />);
  await screen.findByRole('button', { name: '选择收藏图片：深层作品' });
  if (width < 768) fireEvent.change(screen.getByRole('combobox', { name: '选择目录' }), { target: { value: 'root' } });
  else fireEvent.click(screen.getByRole('button', { name: '根夹' }));
  expect(screen.getAllByRole('button', { name: '选择收藏图片：深层作品' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: '选择收藏图片：子夹作品' })).toBeTruthy(); expect(screen.queryByRole('button', { name: '选择收藏图片：无夹作品' })).toBeNull();
  expect(screen.getByText('根夹 · 根夹 / 子夹 / 深层')).toBeTruthy();
});

it('同一收藏可从各归属夹选到，旧单夹兼容，空多归属不会误回原夹', async () => {
  const image = { id: 'shared', userId: 'synthetic', title: '共享作品', prompt: 'keep', imageUrl: '/shared.png', boardId: 'a', boardIds: ['a', 'b'], createdAt: 1 };
  mocks.items.mockResolvedValue([image,
    { ...image, id: 'legacy', title: '旧单夹作品', boardIds: undefined },
    { ...image, id: 'empty', title: '未整理作品', boardIds: [] },
    { ...image, id: 'archived', title: '已取消收藏', archived: true },
  ]);
  mocks.boards.mockResolvedValue([{ id: 'a', name: '分类甲' }, { id: 'b', name: '分类乙' }]);
  const select = vi.fn();
  render(<InspirationImagePicker open onClose={() => {}} onSelect={select} />);
  await screen.findByRole('button', { name: '选择收藏图片：共享作品' });
  expect(screen.queryByRole('button', { name: '选择收藏图片：已取消收藏' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '分类乙' }));
  fireEvent.click(screen.getByRole('button', { name: '选择收藏图片：共享作品' }));
  expect(select).toHaveBeenCalledExactlyOnceWith(image, false);
  expect(screen.queryByRole('button', { name: '选择收藏图片：旧单夹作品' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '分类甲' }));
  expect(screen.getByRole('button', { name: '选择收藏图片：旧单夹作品' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '选择收藏图片：未整理作品' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '未整理' }));
  expect(screen.getByRole('button', { name: '选择收藏图片：未整理作品' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '选择收藏图片：共享作品' })).toBeNull();
});
