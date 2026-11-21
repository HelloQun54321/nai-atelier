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

describe('ComicStudio Phase 1 workspace', () => {
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

  it('renders global V5 settings, loads style chain, and toggles monochrome protection notice', () => {
    const { notify } = renderStudio();
    expect(screen.getByRole('button', { name: /手动逐格/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /导出 PNG/ })).toBeTruthy();

    // 选择风格串载入画风
    fireEvent.change(screen.getByRole('combobox', { name: '选择风格串' }), { target: { value: 'style-1' } });
    expect(notify).toHaveBeenCalled();

    // 切换黑白网点漫
    fireEvent.click(screen.getByRole('button', { name: '黑白网点漫' }));
    expect(screen.getByText(/自动剥离发送副本中的彩色词/)).toBeTruthy();
  });

  it('selects a panel, displays auto-matched free resolution, and manages spatial anchors', () => {
    renderStudio();
    // 点击分镜格列表中的第 1 格
    fireEvent.click(screen.getByRole('button', { name: /第 1 格/ }));
    expect(screen.getByRole('button', { name: /生成当前格/ })).toBeTruthy();
    expect(screen.getByText(/0\/12（上限 24）/)).toBeTruthy();

    // 从角色库直接加入角色锚点
    fireEvent.click(screen.getByRole('button', { name: /角色库/ }));
    fireEvent.click(screen.getByRole('button', { name: /银发女主/ }));
    expect(screen.getByText(/1\/12（上限 24）/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '定位锚点 银发女主' })).toBeTruthy();

    // 追加空镜/道具点
    fireEvent.click(screen.getByRole('button', { name: /空镜\/道具/ }));
    expect(screen.getByText(/2\/12（上限 24）/)).toBeTruthy();
  });
});
