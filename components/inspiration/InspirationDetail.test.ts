// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspirationDetail } from './InspirationDetail';
import { Inspiration, InspirationBoard, User } from '../../types';
import { db } from '../../services/dbService';

vi.mock('../../services/dbService', () => ({
  db: {
    updateInspiration: vi.fn(async () => undefined),
    markInspirationUsed: vi.fn(async () => undefined),
  },
}));

vi.mock('../SmartImage', () => ({
  OriginalImage: (props: any) => React.createElement('img', props),
  SmartImage: (props: any) => React.createElement('img', props),
}));

vi.mock('../ParamsViewer', () => ({
  ParamsViewer: () => React.createElement('div', { 'data-testid': 'params-viewer' }, '参数视图'),
}));

vi.mock('../ImageTaggerPanel', () => ({
  ImageTaggerAction: () => React.createElement('button', { type: 'button' }, '反推 Tag'),
  ImageTaggerPanel: (props: any) => props.open ? React.createElement('div', { 'data-testid': 'image-tagger-panel' }, '反推面板') : null,
}));

vi.mock('../MobileUI', () => ({
  useMobileHistoryLayer: () => vi.fn(),
}));

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockUser: User = {
  id: 'user-1',
  username: 'test-user',
  role: 'user',
  createdAt: 1,
};

const mockBoards: InspirationBoard[] = [
  { id: 'board-1', name: '角色设计', color: '#6366f1', sortOrder: 0, userId: 'user-1', createdAt: 1, updatedAt: 1 },
];

const mockItem: Inspiration = {
  id: 'insp-1',
  userId: 'user-1',
  title: '海边少女',
  imageUrl: 'data:image/png;base64,mock',
  prompt: '1girl, beach, masterpiece',
  negativePrompt: 'low quality, blurry',
  notes: '适合夏日氛围图',
  tags: ['夏日', '少女'],
  boardId: '',
  rating: 3,
  isPinned: false,
  archived: false,
  sourceType: 'history',
  createdAt: 1700000000000,
};

describe('InspirationDetail 全新重构界面走查', () => {
  it('默认进入清爽浏览态，具备独立复制、顶栏画板快速切换与极简双核 Footer', () => {
    const notify = vi.fn();
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        boards: mockBoards,
        currentUser: mockUser,
        notify,
        onClose: vi.fn(),
        onRefresh: vi.fn(),
        onOpenItem: vi.fn(),
      })
    );

    // 标题可直接点击编辑（失焦自动保存），画板在顶栏快捷切换
    expect(screen.getByDisplayValue('海边少女')).toBeTruthy();
    const boardSelect = screen.getByTitle('切换所属灵感板') as HTMLSelectElement;
    expect(boardSelect.value).toBe('');

    // 独立复制按钮
    const copyButtons = screen.getAllByRole('button', { name: '复制' });
    expect(copyButtons.length).toBeGreaterThanOrEqual(1);

    // 标签胶囊化展示
    expect(screen.getByText('#夏日')).toBeTruthy();
    expect(screen.getByText('#少女')).toBeTruthy();

    // 底部工具条包含「反推 Tag」、高亮主按钮「导入实验室」、次按钮「提取资产」与下载
    expect(screen.getByRole('button', { name: /反推 Tag/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /导入实验室/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /提取资产/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: '下载原图' })).toBeTruthy();
  });

  it('底部点击反推 Tag 按钮弹出 WD Tagger 反推面板', () => {
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        boards: mockBoards,
        currentUser: mockUser,
        notify: vi.fn(),
        onClose: vi.fn(),
        onRefresh: vi.fn(),
        onOpenItem: vi.fn(),
      })
    );

    const taggerBtn = screen.getByRole('button', { name: /反推 Tag/ });
    fireEvent.click(taggerBtn);
    expect(screen.getByTestId('image-tagger-panel')).toBeTruthy();
  });

  it('顶栏切换画板即时持久化到数据库', async () => {
    const onRefresh = vi.fn();
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        boards: mockBoards,
        currentUser: mockUser,
        notify: vi.fn(),
        onClose: vi.fn(),
        onRefresh,
        onOpenItem: vi.fn(),
      })
    );

    const boardSelect = screen.getByTitle('切换所属灵感板');
    fireEvent.change(boardSelect, { target: { value: 'board-1' } });

    expect(db.updateInspiration).toHaveBeenCalledWith('insp-1', { boardId: 'board-1' });
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('顶栏图钉切换置顶状态并即时保存', async () => {
    const onRefresh = vi.fn();
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        boards: mockBoards,
        currentUser: mockUser,
        notify: vi.fn(),
        onClose: vi.fn(),
        onRefresh,
        onOpenItem: vi.fn(),
      })
    );

    const pinBtn = screen.getByRole('button', { name: '置顶灵感' });
    fireEvent.click(pinBtn);
    expect(db.updateInspiration).toHaveBeenCalledWith('insp-1', { isPinned: true });
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('底部双核工具条展开底图模式与资产提取子项', () => {
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        boards: mockBoards,
        currentUser: mockUser,
        notify: vi.fn(),
        onClose: vi.fn(),
        onRefresh: vi.fn(),
        onOpenItem: vi.fn(),
        onCreateArtistChain: vi.fn(),
      })
    );

    // 展开底图菜单
    const labMenuBtn = screen.getByRole('button', { name: '更多底图模式' });
    fireEvent.click(labMenuBtn);
    expect(screen.getByRole('button', { name: /底图：图生图/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /底图：局部重绘/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /底图：扩图/ })).toBeTruthy();

    // 展开资产菜单
    const assetBtn = screen.getByRole('button', { name: /提取资产/ });
    fireEvent.click(assetBtn);
    expect(screen.getByRole('button', { name: /创建风格串/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /创建角色参考/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /创建 Vibe/ })).toBeTruthy();
  });

  it('标题修改失焦后即时持久化保存', () => {
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        boards: mockBoards,
        currentUser: mockUser,
        notify: vi.fn(),
        onClose: vi.fn(),
        onRefresh: vi.fn(),
        onOpenItem: vi.fn(),
      })
    );

    const titleInput = screen.getByDisplayValue('海边少女');
    fireEvent.change(titleInput, { target: { value: '日落海滩少女' } });
    fireEvent.blur(titleInput);

    expect(db.updateInspiration).toHaveBeenCalledWith('insp-1', { title: '日落海滩少女' });
  });
});
