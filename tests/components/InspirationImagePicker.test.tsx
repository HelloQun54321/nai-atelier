// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InspirationImagePicker } from '../../components/InspirationImagePicker';

const mocks = vi.hoisted(() => ({ items: vi.fn(), boards: vi.fn() }));
vi.mock('../../services/dbService', () => ({ db: { getAllInspirations: mocks.items, getInspirationBoards: mocks.boards } }));
vi.mock('../../components/SmartImage', () => ({ SmartImage: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock('../../components/ImagePreviewPortal', () => ({ ImagePreviewPortal: ({ children }: { children: React.ReactNode }) => children }));
afterEach(cleanup);

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
