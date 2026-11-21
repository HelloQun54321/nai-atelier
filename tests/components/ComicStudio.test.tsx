// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { ComicStudio } from '../../components/comic/ComicStudio';
import type { PromptChain } from '../../types';

const mockChains: PromptChain[] = [
  {
    id: 'style-1',
    userId: 'owner',
    type: 'style',
    name: '清透日漫风',
    description: '',
    tags: [],
    basePrompt: 'artist:example, anime coloring, crisp lineart',
    negativePrompt: 'lowres, bad anatomy',
    modules: [],
    params: { width: 832, height: 1216, steps: 23, scale: 5, sampler: 'k_euler_ancestral' },
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'char-1',
    userId: 'owner',
    type: 'character',
    name: '银发女主',
    description: '',
    tags: [],
    basePrompt: '1girl, silver hair, twintails, sailor uniform',
    negativePrompt: '',
    modules: [],
    params: { width: 832, height: 1216, steps: 23, scale: 5, sampler: 'k_euler_ancestral' },
    createdAt: 1,
    updatedAt: 1,
  },
];

describe('ComicStudio Phase 1 redesigned 4-block workbench', () => {
  beforeEach(() => {
    localStorage.clear();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderStudio = () => {
    const notify = vi.fn();
    render(
      <ConfirmDialogProvider>
        <ComicStudio chains={mockChains} notify={notify} />
      </ConfirmDialogProvider>,
    );
    return { notify };
  };

  it('opens straight into panel generation tab with panel strip, anchors, and Delete/Undo support', () => {
    renderStudio();
    // 顶部极简栏 + 默认停在「分镜生图」标签，直接能看到第 1 格和「生成当前格」按钮
    expect(screen.getByRole('button', { name: /手动逐格/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('tab', { name: '分镜生图' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: /生成当前格/ })).toBeTruthy();
    expect(screen.getByText(/0\/12（上限 24）/)).toBeTruthy();

    // 从角色库直接加入角色锚点并追加空镜/道具点
    fireEvent.click(screen.getByRole('button', { name: /角色库/ }));
    fireEvent.click(screen.getByRole('button', { name: /银发女主/ }));
    expect(screen.getByText(/1\/12（上限 24）/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '定位锚点 银发女主' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /空镜\/道具/ }));
    expect(screen.getByText(/2\/12（上限 24）/)).toBeTruthy();

    // 点击格号条切换到第 2 格，Delete 键删除，撤销恢复
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect((screen.getByRole('textbox', { name: '分镜格名称' }) as HTMLInputElement).value).toBe('第 2 格');
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.queryByRole('button', { name: '4' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByRole('button', { name: '4' })).toBeTruthy();
  });

  it('supports style tab searchable chain picker, monochrome protection, floating dock brush card, and layers tab', () => {
    const { notify } = renderStudio();

    // 切到「画风设定」标签：搜索载入风格串 + 黑白网点漫净色提示
    fireEvent.click(screen.getByRole('tab', { name: '画风设定' }));
    fireEvent.click(screen.getByRole('button', { name: '选择风格串' }));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索风格串' }), { target: { value: '清透' } });
    fireEvent.click(screen.getByRole('button', { name: /清透日漫风/ }));
    expect(notify).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '黑白网点漫' }));
    expect(screen.getByText(/自动剥离发送副本中的彩色词/)).toBeTruthy();

    // 点击满高竖工具栏的「画笔」或按快捷键，顶栏动态属性条实时显示粗细且不切换右侧标签
    fireEvent.click(screen.getByRole('button', { name: '画笔' }));
    expect(screen.getByText('粗细')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '画风设定' }).getAttribute('aria-selected')).toBe('true');

    // PS 单键快捷键切换抓手平移与格内移图工具
    fireEvent.keyDown(window, { key: 'h' });
    expect(screen.getByRole('button', { name: '抓手平移' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 'm' });
    expect(screen.getByRole('button', { name: '格内移图' }).getAttribute('aria-pressed')).toBe('true');

    // 切到「嵌字·图层」标签管理 4 大图层
    fireEvent.click(screen.getByRole('tab', { name: /嵌字·图层/ }));
    expect(screen.getByText('分镜画格')).toBeTruthy();
    expect(screen.getByText('手绘涂鸦')).toBeTruthy();
  });
});
