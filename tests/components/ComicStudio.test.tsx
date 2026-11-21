// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { ComicStudio } from '../../components/comic/ComicStudio';
import { promptAgentService } from '../../services/promptAgent';
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

    // 从角色库直接加入角色锚点并追加空镜/道具点，且画布锚点必须落在第 1 格高度内（绝不能飘到第 2 格）
    fireEvent.click(screen.getByRole('button', { name: /角色库/ }));
    fireEvent.click(screen.getByRole('button', { name: /银发女主/ }));
    expect(screen.getByText(/1\/12（上限 24）/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '定位锚点 银发女主' })).toBeTruthy();
    const canvasPin = screen.getByRole('button', { name: '画布锚点 银发女主' });
    const pinTopPercent = parseFloat(canvasPin.style.top);
    expect(pinTopPercent).toBeGreaterThan(5);
    expect(pinTopPercent).toBeLessThan(30);

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

  it('supports Phase 2 AI whole-page storyboard orchestration, dual-zone preview, and bubble-to-vector conversion', async () => {
    const planSpy = vi.spyOn(promptAgentService, 'planComicStoryboard').mockResolvedValue({
      title: '雨中递伞',
      layoutHint: '4-panel manga page, clean white gutters',
      guidePanels: [
        { label: '第 1 格', summary: '雨中教室门口', x: 0.04, y: 0.04, width: 0.92, height: 0.44 },
        { label: '第 2 格', summary: '递出透明雨伞', x: 0.04, y: 0.52, width: 0.92, height: 0.44 },
      ],
      anchors: [
        { kind: 'character', label: '银发女主-格1', prompt: '1girl, silver hair, umbrella', negativePrompt: '', x: 0.35, y: 0.25, enabled: true },
        { kind: 'bubble', label: '台词-格2', prompt: 'tail pointing left', negativePrompt: '', x: 0.72, y: 0.65, enabled: true, bubbleShape: 'oval', bubbleText: '一起走吧' },
      ],
      model: 'mock-llm',
    });

    const { notify } = renderStudio();

    // 切换到 AI 整页模式
    fireEvent.click(screen.getByRole('button', { name: 'AI 整页' }));
    expect(screen.getByRole('button', { name: 'AI 整页' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('tab', { name: 'AI 整页编排' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: /生成 AI 整页/ })).toBeTruthy();

    // 勾选出场角色并输入剧情，点击 AI 编排分镜与锚点
    fireEvent.click(screen.getByRole('button', { name: /选择出场角色/ }));
    fireEvent.click(screen.getByRole('button', { name: /银发女主/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '漫画整页剧情描述' }), {
      target: { value: '放学后下雨，银发少女递伞给少年' },
    });
    fireEvent.click(screen.getByRole('button', { name: /AI 编排分镜与锚点/ }));

    await waitFor(() => {
      expect(planSpy).toHaveBeenCalledTimes(1);
    });
    expect(planSpy.mock.calls[0][0].castCharacters?.[0]?.name).toBe('银发女主');

    // 画布渲染整页可拖锚点
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '整页锚点 银发女主-格1' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '整页锚点 台词-格2' })).toBeTruthy();
    });

    // 切换上下双区，按钮展示「2 区拼合」
    fireEvent.click(screen.getByRole('button', { name: '上下双区' }));
    expect(screen.getByText('2 区拼合')).toBeTruthy();

    // 一键将气泡锚点转为可编辑矢量气泡
    fireEvent.click(screen.getByRole('button', { name: /气泡点转矢量嵌字/ }));
    expect(screen.getByText('当前对白气泡')).toBeTruthy();
    expect(notify).toHaveBeenCalled();
  });

  it('supports Phase 4 two-level comic bookshelf (create book, add page, reorder, open reader)', async () => {
    renderStudio();

    // 点击顶栏书架按钮打开两级漫画书架（默认自带「速写单页集」）
    fireEvent.click(screen.getByRole('button', { name: '打开漫画书架' }));
    expect(screen.getByRole('dialog', { name: '漫画书架与整话阅读' })).toBeTruthy();
    expect(screen.getAllByText('速写单页集').length).toBeGreaterThan(0);

    // 新建一部作品并新增第二页
    fireEvent.click(screen.getByRole('button', { name: /新建作品/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '新作品名称' }), { target: { value: '第 1 话 雨夜车站' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(screen.getAllByText('第 1 话 雨夜车站').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /新增一页/ }));
    expect(screen.getByText('P02')).toBeTruthy();

    // 切换进入整话连续阅读视图并切回书架
    fireEvent.click(screen.getByRole('button', { name: /整话连续阅读/ }));
    expect(screen.getByRole('button', { name: /返回书架/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /返回书架/ }));
    expect(screen.getByRole('button', { name: /整话打包导出 ZIP/ })).toBeTruthy();
  });
});
