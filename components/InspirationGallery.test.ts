// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspirationGallery } from './InspirationGallery';
import { Inspiration, User } from '../types';

vi.mock('../services/dbService', () => ({
  db: {
    getInspirationBoards: vi.fn(async () => [
      { id: 'board-1', name: '角色设计', color: '#6366f1', sortOrder: 0, userId: 'user-1', createdAt: 1, updatedAt: 1 },
    ]),
    getAllInspirations: vi.fn(async () => []),
    updateInspiration: vi.fn(),
    deleteInspirationBoard: vi.fn(),
  },
}));

vi.mock('./SmartImage', () => ({
  SmartImage: (props: any) => React.createElement('img', props),
  OriginalImage: (props: any) => React.createElement('img', props),
}));

vi.mock('./ConfirmDialog', () => ({
  useConfirmDialog: () => vi.fn(async () => true),
}));

vi.mock('../services/appearancePreferences', () => ({
  useMobileImageDisplayPreferences: () => ({
    mobileImageAspectRatio: 'auto',
    mobileImageObjectFit: 'contain',
    desktopColumns: 4,
    mobileColumns: 2,
  }),
}));

vi.mock('./useKeepAliveScrollRestore', () => ({
  useKeepAliveScrollRestore: () => vi.fn(),
}));

afterEach(() => cleanup());

const mockUser: User = {
  id: 'user-1',
  username: 'test-user',
  role: 'user',
  createdAt: 1,
};

const mockInspirations: Inspiration[] = [
  {
    id: 'insp-1',
    userId: 'user-1',
    title: '已整理角色图',
    imageUrl: 'data:image/png;base64,1',
    prompt: 'girl',
    boardId: 'board-1',
    sourceType: 'history',
    tags: ['生成历史', '原创'],
    createdAt: 1000,
  },
  {
    id: 'insp-2',
    userId: 'user-1',
    title: '未整理带有标签的图',
    imageUrl: 'data:image/png;base64,2',
    prompt: 'danbooru art',
    boardId: undefined, // 未分类/未整理
    sourceType: 'danbooru',
    tags: ['Danbooru', '1girl'],
    notes: '自动收录',
    createdAt: 2000,
  },
  {
    id: 'insp-3',
    userId: 'user-1',
    title: 'Pixiv 收藏图',
    imageUrl: 'data:image/png;base64,3',
    prompt: 'pixiv illustration',
    boardId: undefined, // 未整理
    sourceType: 'pixiv',
    tags: ['Pixiv'],
    createdAt: 3000,
  },
];

describe('InspirationGallery 来源筛选与未整理心智', () => {
  it('未整理分类正确包含未分配灵感板的卡片（即使有来源标签与备注）', () => {
    render(
      React.createElement(InspirationGallery, {
        currentUser: mockUser,
        inspirationsData: mockInspirations,
        onRefresh: vi.fn(),
        notify: vi.fn(),
      })
    );

    // 侧栏存在“未整理”按钮且计数为 2（insp-2 与 insp-3）
    const unorganizedButtons = screen.getAllByRole('button', { name: /未整理/ });
    expect(unorganizedButtons.length).toBeGreaterThan(0);
    expect(screen.getByText('2', { selector: 'span' })).toBeTruthy();

    // 点击未整理按钮
    fireEvent.click(unorganizedButtons[0]);

    // 页面应展示 insp-2 与 insp-3，不展示已归入 board-1 的 insp-1
    expect(screen.getByText('未整理带有标签的图')).toBeTruthy();
    expect(screen.getByText('Pixiv 收藏图')).toBeTruthy();
    expect(screen.queryByText('已整理角色图')).toBeNull();
  });

  it('侧栏来源导航包含 Danbooru 与 Pixiv 并可按来源精确筛选', () => {
    render(
      React.createElement(InspirationGallery, {
        currentUser: mockUser,
        inspirationsData: mockInspirations,
        onRefresh: vi.fn(),
        notify: vi.fn(),
      })
    );

    // 查找 Danbooru 来源按钮（侧栏带计数的按钮）
    const danbooruButton = screen.getByRole('button', { name: /Danbooru\s+1/ });
    expect(danbooruButton).toBeTruthy();
    fireEvent.click(danbooruButton);

    expect(screen.getByText('未整理带有标签的图')).toBeTruthy();
    expect(screen.queryByText('Pixiv 收藏图')).toBeNull();
    expect(screen.queryByText('已整理角色图')).toBeNull();

    // 查找 Pixiv 来源按钮（侧栏带计数的按钮）
    const pixivButton = screen.getByRole('button', { name: /Pixiv\s+1/ });
    expect(pixivButton).toBeTruthy();
    fireEvent.click(pixivButton);

    expect(screen.getByText('Pixiv 收藏图')).toBeTruthy();
    expect(screen.queryByText('未整理带有标签的图')).toBeNull();
    expect(screen.queryByText('已整理角色图')).toBeNull();
  });
});
