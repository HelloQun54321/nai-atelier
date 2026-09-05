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
  it('默认进入清爽浏览态，具备独立复制、顶栏画板快速切换与单行 Footer', () => {
    const notify = vi.fn();
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        boards: mockBoards,
        currentUser: mockUser,
        chains: [],
        notify,
        onClose: vi.fn(),
        onRefresh: vi.fn(),
        onOpenItem: vi.fn(),
      })
    );

    // 标题与画板在顶栏展示
    expect(screen.getByRole('heading', { name: '海边少女' })).toBeTruthy();
    const boardSelect = screen.getByTitle('切换所属灵感板') as HTMLSelectElement;
    expect(boardSelect.value).toBe('');

    // 顶栏轻量置顶与归档按钮
    expect(screen.getByRole('button', { name: '置顶' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '归档' })).toBeTruthy();

    // 独立复制按钮（提示词与负面提示词各自独立）
    const copyButtons = screen.getAllByRole('button', { name: '复制' });
    expect(copyButtons.length).toBe(2);

    // 标签胶囊化展示
    expect(screen.getByText('#夏日')).toBeTruthy();
    expect(screen.getByText('#少女')).toBeTruthy();

    // 底部工具条包含高亮主按钮「完整导入」、次按钮「追加提示词」、更多复用
    expect(screen.getByRole('button', { name: /完整导入/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /追加提示词/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /更多复用/ })).toBeTruthy();
  });

  it('顶栏切换画板即时持久化到数据库', async () => {
    const onRefresh = vi.fn();
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        boards: mockBoards,
        currentUser: mockUser,
        chains: [],
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

  it('置顶与归档状态可一键切换并即时保存', async () => {
    const onRefresh = vi.fn();
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        boards: mockBoards,
        currentUser: mockUser,
        chains: [],
        notify: vi.fn(),
        onClose: vi.fn(),
        onRefresh,
        onOpenItem: vi.fn(),
      })
    );

    const pinBtn = screen.getByRole('button', { name: '置顶' });
    fireEvent.click(pinBtn);
    expect(db.updateInspiration).toHaveBeenCalledWith('insp-1', { isPinned: true });

    const archiveBtn = screen.getByRole('button', { name: '归档' });
    fireEvent.click(archiveBtn);
    expect(db.updateInspiration).toHaveBeenCalledWith('insp-1', { archived: true });
  });

  it('点击编辑铅笔切换到编辑态，展示输入框并切换底部操作栏', () => {
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        boards: mockBoards,
        currentUser: mockUser,
        chains: [],
        notify: vi.fn(),
        onClose: vi.fn(),
        onRefresh: vi.fn(),
        onOpenItem: vi.fn(),
      })
    );

    const editBtn = screen.getByRole('button', { name: '编辑内容与备注' });
    fireEvent.click(editBtn);

    // 编辑态下出现标题输入框、提示词文本框、负面提示词文本框
    expect(screen.getByPlaceholderText('输入灵感标题...')).toBeTruthy();
    expect(screen.getByPlaceholderText('输入正向提示词...')).toBeTruthy();
    expect(screen.getByPlaceholderText('输入负面提示词...')).toBeTruthy();

    // 底部切换为完成保存与取消
    expect(screen.getByRole('button', { name: /完成保存/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
  });
});
