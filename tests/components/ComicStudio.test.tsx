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

    // 切到「嵌字」与「图层」标签，右侧满高展示 Photoshop 风格图层面板（支持多手绘图层、图层组、混合模式与不透明度）
    fireEvent.click(screen.getByRole('tab', { name: /嵌字/ }));
    expect(screen.getByRole('tab', { name: /嵌字/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /图层/ }));
    expect(screen.getByRole('tab', { name: /图层/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('region', { name: 'PS 图层面板' })).toBeTruthy();
    expect(screen.getAllByText('分镜画格底图').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('手绘图层 1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('combobox', { name: '图层混合模式' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: '图层不透明度' })).toBeTruthy();
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
    expect(planSpy.mock.calls[0][0].preserveExistingLayout).toBe(true);
    expect(planSpy.mock.calls[0][0].existingGuidePanels?.length).toBeGreaterThan(0);

    // 画布渲染整页可拖锚点，且气泡锚点直接在漫画上可视化显示真实台词气泡（而非盲猜橙色圆点）
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '整页锚点 银发女主-格1' })).toBeTruthy();
      expect(screen.getByText('一起走吧')).toBeTruthy();
      expect(screen.getByText('AI 气泡')).toBeTruthy();
    });

    // 切换上下双区，按钮展示「2 区拼合」且提供单区独立精修入口
    fireEvent.click(screen.getByRole('button', { name: '上下双区' }));
    expect(screen.getByText('2 区拼合')).toBeTruthy();
    expect(screen.getByRole('button', { name: /仅画区 1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /仅画区 2/ })).toBeTruthy();

    // 验证 V5 img2img 硬锁版式控件：默认开启、可切黑底回忆杀、填统一光照词并添加破格前景块
    const lockToggle = screen.getByRole('checkbox', { name: '按画布分镜框硬锁版式（图生图）' }) as HTMLInputElement;
    expect(lockToggle.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '黑底回忆杀' }));
    expect(screen.getByRole('button', { name: '黑底回忆杀' }).getAttribute('aria-pressed')).toBe('true');
    const atmosInput = screen.getByRole('textbox', { name: '全页统一环境光照词' }) as HTMLInputElement;
    fireEvent.change(atmosInput, { target: { value: 'warm afternoon library sunlight' } });
    expect(atmosInput.value).toBe('warm afternoon library sunlight');
    fireEvent.click(screen.getByRole('button', { name: '破格前景块' }));
    expect(screen.getAllByText(/破格前景 1/).length).toBeGreaterThanOrEqual(1);

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

    // 切换进入整话连续阅读视图并切回书架，同时验证可编辑工程导入/导出入口存在
    expect(screen.getByRole('button', { name: /导出工程/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /导入工程/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /整话连续阅读/ }));
    expect(screen.getByRole('button', { name: /返回书架/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /返回书架/ }));
    expect(screen.getByRole('button', { name: /整话打包导出 ZIP/ })).toBeTruthy();
  });

  it('exposes batch panel generation, full V5 parameter tuning, rich bubble styling, and custom layout templates', () => {
    renderStudio();

    // 手动逐格模式提供「整页生成」一键顺序生图入口
    expect(screen.getByRole('button', { name: /整页生成/ })).toBeTruthy();

    // 画风设定标签提供完整的 Seed / Steps / CFG / Sampler / Noise Schedule 参数微调
    fireEvent.click(screen.getByRole('tab', { name: '画风设定' }));
    const seedInput = screen.getByRole('spinbutton', { name: '随机种子' }) as HTMLInputElement;
    fireEvent.change(seedInput, { target: { value: '123456' } });
    expect(seedInput.value).toBe('123456');
    expect(screen.getByRole('slider', { name: '生图步数' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: '引导强度' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '采样器' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '噪声调度' })).toBeTruthy();

    // 顶栏「画幅与模板」支持将当前分镜保存为自定义模板并删除
    fireEvent.click(screen.getByRole('button', { name: '画幅与模板' }));
    fireEvent.change(screen.getByRole('textbox', { name: '自定义模板名称' }), { target: { value: '我的经典四格' } });
    fireEvent.click(screen.getByRole('button', { name: /存为模板/ }));
    expect(screen.getByText('我的经典四格')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除自定义模板 我的经典四格' }));
    expect(screen.queryByText('我的经典四格')).toBeNull();

    // 添加矢量气泡后，右侧属性栏支持字体、旋转、边框粗细与颜色调节
    fireEvent.click(screen.getByRole('button', { name: '画幅与模板' }));
    fireEvent.click(screen.getByRole('button', { name: '添加气泡' }));
    const stage = screen.getByRole('application', { name: '漫画分镜画布' });
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 500, bottom: 700, width: 500, height: 700, toJSON: () => ({}),
    });
    fireEvent(stage, new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 120,
      clientY: 120,
    }));
    expect(screen.getByRole('combobox', { name: '气泡字体' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '爆裂吼叫' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '意识放射' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '心理双线' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /开源漫画字体库/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '导入本机字体' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: '气泡旋转角度' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: '气泡边框粗细' })).toBeTruthy();
    expect(screen.getByLabelText('气泡底色')).toBeTruthy();
  });

  it('renders live WYSIWYG bubble anchor with PS floating toolbar and supports full PS Layers panel operations', () => {
    renderStudio();

    // 在手动模式下添加「气泡点」：不再只有盲猜圆点，直接在画布渲染可视化漫画气泡并弹出快捷编辑条
    fireEvent.click(screen.getByRole('button', { name: '气泡点' }));
    expect(screen.getByText('气泡预演')).toBeTruthy();
    expect(screen.getByRole('toolbar', { name: '气泡快捷编辑条' })).toBeTruthy();

    // 双击画布上的气泡必须立刻弹出原地编辑文本框
    fireEvent.doubleClick(screen.getByText('双击输入台词'));
    const inlineBox = screen.getByRole('textbox', { name: '原地编辑文字' }) as HTMLTextAreaElement;
    fireEvent.change(inlineBox, { target: { value: '原地改词成功' } });
    fireEvent.keyDown(inlineBox, { key: 'Enter', ctrlKey: true });
    expect(screen.getByText('原地改词成功')).toBeTruthy();

    // 切到 AI 整页时，手动模式气泡快捷条不得悬空残留
    fireEvent.click(screen.getByRole('button', { name: 'AI 整页' }));
    expect(screen.queryByRole('toolbar', { name: '气泡快捷编辑条' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '手动逐格' }));
    const bubbleTextEl = screen.getByText('原地改词成功');
    fireEvent.pointerDown(bubbleTextEl, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(bubbleTextEl);

    // 一键转为正式矢量漫画气泡，立刻进入 PS 图层栈
    fireEvent.click(screen.getByRole('button', { name: '转为正式矢量气泡' }));
    expect(screen.getByText('当前对白气泡')).toBeTruthy();

    // 切到右侧「图层」标签页：满高展示完整 PS 图层操作（混合模式、不透明度、新建手绘层/图层组、点选图层停留当前标签、删除图层）
    fireEvent.click(screen.getByRole('tab', { name: /图层/ }));
    expect(screen.getByRole('tab', { name: /图层/ }).getAttribute('aria-selected')).toBe('true');

    const blendSelect = screen.getByRole('combobox', { name: '图层混合模式' }) as HTMLSelectElement;
    fireEvent.change(blendSelect, { target: { value: 'multiply' } });
    expect(blendSelect.value).toBe('multiply');

    const opacitySlider = screen.getByRole('slider', { name: '图层不透明度' }) as HTMLInputElement;
    fireEvent.change(opacitySlider, { target: { value: '65' } });
    expect(opacitySlider.value).toBe('65');

    fireEvent.click(screen.getByRole('button', { name: '新建手绘图层' }));
    expect(screen.getAllByText('手绘图层 2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('tab', { name: /图层/ }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '新建图层组' }));
    expect(screen.getAllByText('图层组 1').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: '删除当前图层' }));
    expect(screen.queryByText('图层组 1')).toBeNull();
  });
});
