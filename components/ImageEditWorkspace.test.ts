// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLabImageEditDraft } from '../services/labWorkspace';
import { ImageEditControls } from './ImageEditControls';
import { ImageEditPanel } from './ImageEditPanel';
import { ImageEditPreview } from './ImageEditPreview';

vi.mock('./ChainEditorParams', () => ({
  ChainEditorParams: () => React.createElement('div', { 'data-testid': 'common-params' }, '公共参数'),
}));

vi.mock('./VibeManager', () => ({
  VibeManager: () => React.createElement('div', { 'data-testid': 'vibe-manager' }, 'Vibe'),
}));

vi.mock('./CharacterReferenceManager', () => ({
  CharacterReferenceManager: () => React.createElement('div', { 'data-testid': 'character-reference-manager' }, 'Character Reference'),
}));

vi.mock('./ImageEditCanvas', () => ({
  ImageEditCanvas: () => React.createElement('div', { 'data-testid': 'edit-canvas' }, '画布'),
}));

vi.mock('./CloudQueueStatus', () => ({
  InlineCloudQueueStatus: () => React.createElement('div', null, '队列'),
  useCloudQueueStatus: () => null,
}));

vi.mock('./SmartImage', () => ({
  OriginalImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement('img', props),
  SmartImage: ({ thumbnailVariant: _thumbnailVariant, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { thumbnailVariant?: string }) => React.createElement('img', props),
}));

vi.mock('../services/dbService', () => ({
  db: {
    getAllInspirations: vi.fn(async () => [
      {
        id: 'insp-1',
        title: '测试灵感',
        imageUrl: 'data:image/png;base64,fixture-insp',
        prompt: 'masterpiece, 1girl',
        negativePrompt: 'low quality',
        params: { width: 832, height: 1216 },
        createdAt: Date.now(),
      },
    ]),
    getInspirationBoards: vi.fn(async () => []),
  },
}));

vi.mock('../services/localHistory', () => ({
  localHistory: {
    getPage: vi.fn(async (page: number) => ({
      items: [{ id: page === 0 ? 'history-1' : 'history-21', imageUrl: `data:image/png;base64,fixture-${page}`, prompt: 'history prompt', negativePrompt: '', params: { width: 832, height: 1216 }, createdAt: page + 1 }],
      count: 21,
    })),
    subscribe: vi.fn(() => () => undefined),
  },
}));

const params = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  seed: undefined,
  qualityToggle: true,
  ucPreset: 4,
};

const renderControls = (operation: 'image-to-image' | 'inpaint' | 'outpaint', manualMaskEditing = false, safeMode = false, tagAssistEnabled = false) => {
  const draft = createLabImageEditDraft(operation, 'blue bottle', 'low quality', params);
  const onManualMaskEditingChange = vi.fn();
  const onPromptChange = vi.fn();
  const onSelectImageSource = vi.fn();
  const historyItem = { id: 'history-1', imageUrl: 'data:image/png;base64,fixture', prompt: 'history prompt', negativePrompt: '', params, createdAt: 1 };
  return { ...render(React.createElement(ImageEditControls, {
    operation,
    draft,
    fileInputRef: React.createRef<HTMLInputElement>(),
    canvasProps: {
      imageCanvasRef: React.createRef<HTMLCanvasElement>(),
      maskCanvasRef: React.createRef<HTMLCanvasElement>(),
      overlayCanvasRef: React.createRef<HTMLCanvasElement>(),
      width: 832,
      height: 1216,
      focusedRect: null,
      focused: false,
      isLoading: false,
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    },
    latestTextToImageItem: historyItem,
    selectableParams: draft.params,
    strength: draft.strength,
    noise: draft.noise,
    brushSize: draft.brushSize,
    focused: draft.focused,
    minimumContextArea: draft.minimumContextArea,
    tool: 'brush',
    manualMaskEditing,
    safeMode,
    tagAssistEnabled,
    expansion: draft.expansion,
    apiKey: 'test-key',
    notify: vi.fn(),
    onPromptChange,
    onNegativePromptChange: vi.fn(),
    onPromptSource: vi.fn(),
    onDraftChange: vi.fn(),
    onFileChange: vi.fn(),
    onSelectImageSource,
    onStrengthChange: vi.fn(),
    onNoiseChange: vi.fn(),
    onBrushSizeChange: vi.fn(),
    onFocusedChange: vi.fn(),
    onMinimumContextAreaChange: vi.fn(),
    onToolChange: vi.fn(),
    onManualMaskEditingChange,
    onClearMask: vi.fn(),
    onInvertMask: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onExpansionChange: vi.fn(),
    onApplyOutpaint: vi.fn(),
  })), onManualMaskEditingChange, onPromptChange, onSelectImageSource };
};

afterEach(() => cleanup());

describe('ImageEditControls', () => {
  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('在 %s 的正负面提示词中启用 Tag 辅助', operation => {
    const { onPromptChange } = renderControls(operation, false, false, true);

    const assistedInputs = screen.getAllByRole('combobox');
    expect(assistedInputs).toHaveLength(2);
    fireEvent.change(assistedInputs[0], { target: { value: 'blue bottle, 1girl' } });
    expect(onPromptChange).toHaveBeenCalledWith('blue bottle, 1girl');
  });

  it('图生图只显示底图、Strength 和 Noise，不显示蒙版或扩图控件', () => {
    renderControls('image-to-image');

    expect(screen.getByText('底图来源')).toBeTruthy();
    expect(screen.getByText('Strength')).toBeTruthy();
    expect(screen.queryByTestId('edit-canvas')).toBeNull();
    expect(screen.queryByText('画笔')).toBeNull();
    expect(screen.queryByText('手动调整蒙版')).toBeNull();
    expect(screen.queryByText('Focused Inpainting')).toBeNull();
    expect(screen.queryByText('扩展画布（像素）')).toBeNull();
  });

  it('图生图底图缩略图显示在底图来源区', () => {
    const draft = createLabImageEditDraft('image-to-image', 'blue bottle', 'low quality', params);
    render(React.createElement(ImageEditControls, {
      operation: 'image-to-image',
      draft,
      fileInputRef: React.createRef<HTMLInputElement>(),
      canvasProps: {
        imageCanvasRef: React.createRef<HTMLCanvasElement>(),
        maskCanvasRef: React.createRef<HTMLCanvasElement>(),
        overlayCanvasRef: React.createRef<HTMLCanvasElement>(),
        width: 832,
        height: 1216,
        focusedRect: null,
        focused: false,
        isLoading: false,
        onPointerDown: vi.fn(),
        onPointerMove: vi.fn(),
        onPointerUp: vi.fn(),
      },
      latestTextToImageItem: undefined,
      selectableParams: draft.params,
      strength: draft.strength,
      noise: draft.noise,
      brushSize: draft.brushSize,
      focused: draft.focused,
      minimumContextArea: draft.minimumContextArea,
      tool: 'brush',
      expansion: draft.expansion,
      apiKey: 'test-key',
      tagAssistEnabled: false,
      notify: vi.fn(),
      onPromptChange: vi.fn(),
      onNegativePromptChange: vi.fn(),
      onPromptSource: vi.fn(),
      onDraftChange: vi.fn(),
      onFileChange: vi.fn(),
      onSelectImageSource: vi.fn(),
      onStrengthChange: vi.fn(),
      onNoiseChange: vi.fn(),
      onBrushSizeChange: vi.fn(),
      onFocusedChange: vi.fn(),
      onMinimumContextAreaChange: vi.fn(),
      onToolChange: vi.fn(),
      onClearMask: vi.fn(),
      onInvertMask: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onExpansionChange: vi.fn(),
      onApplyOutpaint: vi.fn(),
      baseImagePreview: 'data:image/png;base64,base',
    }));

    expect(screen.getByAltText('图生图底图')).toBeTruthy();
    expect(screen.getByText(/当前底图/)).toBeTruthy();
    // 未载入底图时显示引导
    cleanup();
    render(React.createElement(ImageEditControls, {
      operation: 'image-to-image',
      draft,
      fileInputRef: React.createRef<HTMLInputElement>(),
      canvasProps: {
        imageCanvasRef: React.createRef<HTMLCanvasElement>(),
        maskCanvasRef: React.createRef<HTMLCanvasElement>(),
        overlayCanvasRef: React.createRef<HTMLCanvasElement>(),
        width: 0,
        height: 0,
        focusedRect: null,
        focused: false,
        isLoading: false,
        onPointerDown: vi.fn(),
        onPointerMove: vi.fn(),
        onPointerUp: vi.fn(),
      },
      latestTextToImageItem: undefined,
      selectableParams: draft.params,
      strength: draft.strength,
      noise: draft.noise,
      brushSize: draft.brushSize,
      focused: draft.focused,
      minimumContextArea: draft.minimumContextArea,
      tool: 'brush',
      expansion: draft.expansion,
      apiKey: 'test-key',
      tagAssistEnabled: false,
      notify: vi.fn(),
      onPromptChange: vi.fn(),
      onNegativePromptChange: vi.fn(),
      onPromptSource: vi.fn(),
      onDraftChange: vi.fn(),
      onFileChange: vi.fn(),
      onSelectImageSource: vi.fn(),
      onStrengthChange: vi.fn(),
      onNoiseChange: vi.fn(),
      onBrushSizeChange: vi.fn(),
      onFocusedChange: vi.fn(),
      onMinimumContextAreaChange: vi.fn(),
      onToolChange: vi.fn(),
      onClearMask: vi.fn(),
      onInvertMask: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onExpansionChange: vi.fn(),
      onApplyOutpaint: vi.fn(),
    }));
    expect(screen.queryByAltText('图生图底图')).toBeNull();
    expect(screen.getByText(/请先上传/)).toBeTruthy();
  });

  it('局部重绘显示蒙版工具和 Focused，但不显示扩图四边', () => {
    renderControls('inpaint');

    expect(screen.getByTestId('edit-canvas')).toBeTruthy();
    expect(screen.getByText('Focused Inpainting')).toBeTruthy();
    expect(screen.getByText('画笔')).toBeTruthy();
    expect(screen.getByTitle('撤销')).toBeTruthy();
    expect(screen.queryByText('扩展画布（像素）')).toBeNull();
  });

  it('底图区域可选择文生图最新结果或历史页图片', async () => {
    const { onSelectImageSource } = renderControls('image-to-image');

    fireEvent.click(screen.getByRole('button', { name: /文生图最新/ }));
    expect(onSelectImageSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'history-1' }), 'generated');

    fireEvent.click(screen.getByRole('button', { name: /选择历史图片/ }));
    expect(screen.getByRole('dialog', { name: '选择历史图片' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /选择历史生成图片/ }));
    expect(onSelectImageSource).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'history-1' }), 'history', false);
  });

  it('底图区域支持选择灵感图片并展示灵感库来源状态', async () => {
    const { onSelectImageSource } = renderControls('image-to-image');

    fireEvent.click(screen.getByRole('button', { name: /选择灵感图片/ }));
    expect(screen.getByRole('dialog', { name: '选择灵感图片' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /选择灵感图片：测试灵感/ }));
    expect(onSelectImageSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'insp-1' }), 'inspiration', false);
  });

  it('历史选择器读取全局分页数据并完整显示缩略图', async () => {
    const { onSelectImageSource } = renderControls('inpaint');

    fireEvent.click(screen.getByRole('button', { name: /选择历史图片/ }));
    expect(await screen.findByText('全部 21 张')).toBeTruthy();
    expect(screen.getByText('第 1 / 2 页 · 每页 20 张')).toBeTruthy();
    expect(screen.getByRole('img', { name: '历史生成图片' }).className).toContain('object-contain');

    fireEvent.click(screen.getByRole('button', { name: '下一页历史图片' }));
    expect(await screen.findByText('第 2 / 2 页 · 每页 20 张')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /选择历史生成图片/ }));
    expect(onSelectImageSource).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'history-21' }), 'history', false);
  });

  it('扩图默认只显示自动边缘扩展与模拟画板摆放台，不直接暴露画笔工具', () => {
    const { onManualMaskEditingChange } = renderControls('outpaint');

    expect(screen.getByText('智能画幅扩展')).toBeTruthy();
    expect(screen.getByText('目标画幅比例（画布外框）')).toBeTruthy();
    expect(screen.getByText('画幅模拟摆放台')).toBeTruthy();
    expect(screen.getByRole('button', { name: '靠左' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '靠右' })).toBeTruthy();
    expect(screen.getByText('上 (top)')).toBeTruthy();
    expect(screen.getByText('手动调整蒙版')).toBeTruthy();
    expect(screen.queryByText('画笔')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: /手动调整蒙版/ }));
    expect(onManualMaskEditingChange).toHaveBeenCalledWith(true);
  });

  it('扩图开启手动调整蒙版后才显示画笔工具', () => {
    renderControls('outpaint', true);

    expect(screen.getByText('画笔')).toBeTruthy();
    expect(screen.getByTitle('撤销')).toBeTruthy();
  });

  it('安全模式开启时禁用局部重绘和扩图的全部蒙版交互', () => {
    renderControls('inpaint', false, true);

    expect(screen.getByRole('status').textContent).toContain('安全模式已开启');
    expect((screen.getByRole('button', { name: '画笔' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Focused Inpainting' }) as HTMLInputElement).disabled).toBe(true);
    cleanup();

    renderControls('outpaint', true, true);
    expect((screen.getByRole('switch', { name: /手动调整蒙版/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '画笔' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('显示底图尺寸规范化提示并支持点击裁剪、填充与缩放', () => {
    const draft = createLabImageEditDraft('image-to-image', 'blue bottle', 'low quality', params);
    const onNormalize = vi.fn();
    render(React.createElement(ImageEditControls, {
      operation: 'image-to-image',
      draft,
      fileInputRef: React.createRef<HTMLInputElement>(),
      canvasProps: {
        imageCanvasRef: React.createRef<HTMLCanvasElement>(),
        maskCanvasRef: React.createRef<HTMLCanvasElement>(),
        overlayCanvasRef: React.createRef<HTMLCanvasElement>(),
        width: 1024,
        height: 1368,
        focusedRect: null,
        focused: false,
        isLoading: false,
        onPointerDown: vi.fn(),
        onPointerMove: vi.fn(),
        onPointerUp: vi.fn(),
      },
      latestTextToImageItem: undefined,
      selectableParams: draft.params,
      strength: draft.strength,
      noise: draft.noise,
      brushSize: draft.brushSize,
      focused: draft.focused,
      minimumContextArea: draft.minimumContextArea,
      tool: 'brush',
      manualMaskEditing: false,
      safeMode: false,
      tagAssistEnabled: false,
      expansion: draft.expansion,
      apiKey: 'test-key',
      notify: vi.fn(),
      normalization: { sourceWidth: 1024, sourceHeight: 1368, targetWidth: 1024, targetHeight: 1344 },
      onNormalize,
      onPromptChange: vi.fn(),
      onNegativePromptChange: vi.fn(),
      onPromptSource: vi.fn(),
      onDraftChange: vi.fn(),
      onFileChange: vi.fn(),
      onSelectImageSource: vi.fn(),
      onStrengthChange: vi.fn(),
      onNoiseChange: vi.fn(),
      onBrushSizeChange: vi.fn(),
      onFocusedChange: vi.fn(),
      onMinimumContextAreaChange: vi.fn(),
      onToolChange: vi.fn(),
      onManualMaskEditingChange: vi.fn(),
      onClearMask: vi.fn(),
      onInvertMask: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onExpansionChange: vi.fn(),
      onApplyOutpaint: vi.fn(),
    }));

    expect(screen.getByText('底图尺寸需要规范化')).toBeTruthy();
    expect(screen.getByText(/当前 1024 × 1368，编辑接口建议使用 1024 × 1344/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /居中裁剪/ }));
    expect(onNormalize).toHaveBeenCalledWith('crop');
    fireEvent.click(screen.getByRole('button', { name: /完整保留并填充/ }));
    expect(onNormalize).toHaveBeenCalledWith('contain');
    fireEvent.click(screen.getByRole('button', { name: /直接缩放/ }));
    expect(onNormalize).toHaveBeenCalledWith('stretch');
  });
});

describe('ImageEditPreview', () => {
  it('复用文生图规格的预览区域、下载按钮和生成按钮', () => {
    const { container } = render(React.createElement(ImageEditPreview, {
      operation: 'inpaint',
      image: 'data:image/png;base64,fixture',
      error: null,
      generationCostLabel: '预计消耗 12 Anlas',
      onGenerate: vi.fn(),
      onOpenLightbox: vi.fn(),
      getDownloadFilename: () => 'fixture.png',
    }));

    const preview = container.querySelector('.chain-editor-preview');
    expect(preview?.className).toContain('order-1');
    expect(preview?.className).toContain('lg:order-2');
    expect(preview?.className).toContain('lg:w-1/2');
    expect(screen.queryByLabelText('图片编辑画布')).toBeNull();
    expect(screen.getByRole('button', { name: '下载' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /生成局部重绘结果/ })).toBeTruthy();
  });

  it('移动端编辑预览卡带 image-edit-preview-shell 标记并隐藏内嵌生成按钮', () => {
    const { container } = render(React.createElement(ImageEditPreview, {
      operation: 'inpaint',
      image: 'data:image/png;base64,fixture',
      error: null,
      generationCostLabel: '预计消耗 12 Anlas',
      onGenerate: vi.fn(),
      onOpenLightbox: vi.fn(),
      getDownloadFilename: () => 'fixture.png',
    }));

    const shell = container.querySelector('.image-edit-preview-shell') as HTMLElement;
    expect(shell).toBeTruthy();
    // 移动端整卡隐藏（hidden），桌面端以 contents 参与左右分区（lg:contents）——与文生图预览容器同款断点语义，绝不允许写成 lg:hidden（桌面隐藏/移动显示）。
    expect(shell.className).toContain('hidden');
    expect(shell.className).toContain('lg:contents');
    expect(shell.className).not.toContain('lg:hidden');
    const generateButton = screen.getByRole('button', { name: /生成局部重绘结果/ });
    // 移动端隐藏内嵌生成按钮（hidden），桌面端显示（lg:flex）——绝不允许写成 lg:hidden（桌面隐藏/移动显示）。
    expect(generateButton.className).toContain('hidden');
    expect(generateButton.className).toContain('lg:flex');
    expect(generateButton.className).not.toContain('lg:hidden');
  });

  it('与文生图一致显示历史管理按钮、切换按钮和计数', () => {
    const onRemoveCurrentHistory = vi.fn();
    const onClearHistoryGroup = vi.fn();
    render(React.createElement(ImageEditPreview, {
      operation: 'image-to-image',
      image: 'data:image/png;base64,fixture',
      error: null,
      generationCostLabel: '免费',
      onGenerate: vi.fn(),
      onOpenLightbox: vi.fn(),
      getDownloadFilename: () => 'fixture.png',
      canNavigateHistory: true,
      historyLabel: '2 / 21',
      canManageHistoryGroup: true,
      onPreviousHistory: vi.fn(),
      onNextHistory: vi.fn(),
      onRemoveCurrentHistory,
      onClearHistoryGroup,
    }));

    expect(screen.getByText('2 / 21')).toBeTruthy();
    expect(screen.getByRole('button', { name: '上一张历史图' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一张历史图' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    expect(onRemoveCurrentHistory).toHaveBeenCalledOnce();
    expect(onClearHistoryGroup).toHaveBeenCalledOnce();
  });

  it('载入底图后右侧无生成结果（image 为 null）时，若 canGenerate 为 true 则生成按钮可用', () => {
    const onGenerate = vi.fn();
    render(React.createElement(ImageEditPreview, {
      operation: 'image-to-image',
      image: null,
      error: null,
      generationCostLabel: '14 点',
      canGenerate: true,
      onGenerate,
      onOpenLightbox: vi.fn(),
      getDownloadFilename: () => 'fixture.png',
    }));

    const generateButton = screen.getByRole('button', { name: /生成图生图结果/ }) as HTMLButtonElement;
    expect(generateButton.disabled).toBe(false);
    fireEvent.click(generateButton);
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it('canGenerate 为 false 或 isLoading 为 true 时生成按钮禁用', () => {
    const { rerender } = render(React.createElement(ImageEditPreview, {
      operation: 'image-to-image',
      image: null,
      error: null,
      generationCostLabel: '14 点',
      canGenerate: false,
      onGenerate: vi.fn(),
      onOpenLightbox: vi.fn(),
      getDownloadFilename: () => 'fixture.png',
    }));

    const buttonNoBase = screen.getByRole('button', { name: /生成图生图结果/ }) as HTMLButtonElement;
    expect(buttonNoBase.disabled).toBe(true);

    rerender(React.createElement(ImageEditPreview, {
      operation: 'image-to-image',
      image: null,
      error: null,
      generationCostLabel: '14 点',
      isLoading: true,
      canGenerate: true,
      onGenerate: vi.fn(),
      onOpenLightbox: vi.fn(),
      getDownloadFilename: () => 'fixture.png',
    }));

    const buttonLoading = screen.getByRole('button', { name: /生成图生图结果/ }) as HTMLButtonElement;
    expect(buttonLoading.disabled).toBe(true);
  });

  describe('移动端实验室三段式 Tab 适配', () => {
    it('ImageEditPanel 针对图生图、局部重绘和扩图正确渲染对应的三段式 Tab 标签', () => {
      const draft = createLabImageEditDraft('image-to-image', 'test prompt', 'low quality', params);
      const { rerender } = render(React.createElement(ImageEditPanel, {
        baseImage: null,
        previewImage: null,
        operation: 'image-to-image',
        draft,
        layout: { order: ['prompt', 'baseImage', 'params', 'editSettings'], collapsed: {} } as any,
        generationCostLabel: () => '14 点',
        apiKey: 'test-key',
        notify: vi.fn(),
        onPromptChange: vi.fn(),
        onNegativePromptChange: vi.fn(),
        onPromptSource: vi.fn(),
        onDraftChange: vi.fn(),
        onBaseImageChange: vi.fn(),
        onCanvasChange: vi.fn(),
        onGenerate: vi.fn(),
        onOpenLightbox: vi.fn(),
        getDownloadFilename: () => 'test.png',
        tagAssistEnabled: false,
      }));

      // 图生图：底图 / 提示 / 参数
      expect(screen.getByRole('button', { name: '底图' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '提示' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '参数' })).toBeTruthy();

      // 切换到局部重绘：画板 / 提示 / 参数
      rerender(React.createElement(ImageEditPanel, {
        baseImage: null,
        previewImage: null,
        operation: 'inpaint',
        draft: createLabImageEditDraft('inpaint', 'test prompt', 'low quality', params),
        layout: { order: ['prompt', 'baseImage', 'params', 'editSettings'], collapsed: {} } as any,
        generationCostLabel: () => '14 点',
        apiKey: 'test-key',
        notify: vi.fn(),
        onPromptChange: vi.fn(),
        onNegativePromptChange: vi.fn(),
        onPromptSource: vi.fn(),
        onDraftChange: vi.fn(),
        onBaseImageChange: vi.fn(),
        onCanvasChange: vi.fn(),
        onGenerate: vi.fn(),
        onOpenLightbox: vi.fn(),
        getDownloadFilename: () => 'test.png',
        tagAssistEnabled: false,
      }));
      expect(screen.getByRole('button', { name: '画板' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '提示' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '参数' })).toBeTruthy();

      // 切换到扩图：画布 / 提示 / 参数
      rerender(React.createElement(ImageEditPanel, {
        baseImage: null,
        previewImage: null,
        operation: 'outpaint',
        draft: createLabImageEditDraft('outpaint', 'test prompt', 'low quality', params),
        layout: { order: ['prompt', 'baseImage', 'params', 'editSettings'], collapsed: {} } as any,
        generationCostLabel: () => '14 点',
        apiKey: 'test-key',
        notify: vi.fn(),
        onPromptChange: vi.fn(),
        onNegativePromptChange: vi.fn(),
        onPromptSource: vi.fn(),
        onDraftChange: vi.fn(),
        onBaseImageChange: vi.fn(),
        onCanvasChange: vi.fn(),
        onGenerate: vi.fn(),
        onOpenLightbox: vi.fn(),
        getDownloadFilename: () => 'test.png',
        tagAssistEnabled: false,
      }));
      expect(screen.getByRole('button', { name: '画布' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '提示' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '参数' })).toBeTruthy();
    });

    it('ImageEditControls 根据 mobileTab 属性精准应用响应式显示隐藏类名', () => {
      const draft = createLabImageEditDraft('inpaint', 'test prompt', 'low quality', params);
      const baseProps = {
        operation: 'inpaint' as const,
        draft,
        fileInputRef: React.createRef<HTMLInputElement>(),
        canvasProps: {
          imageCanvasRef: React.createRef<HTMLCanvasElement>(),
          maskCanvasRef: React.createRef<HTMLCanvasElement>(),
          overlayCanvasRef: React.createRef<HTMLCanvasElement>(),
          width: 832,
          height: 1216,
          focusedRect: null,
          focused: false,
          isLoading: false,
          onPointerDown: vi.fn(),
          onPointerMove: vi.fn(),
          onPointerUp: vi.fn(),
        },
        selectableParams: draft.params,
        strength: draft.strength,
        noise: draft.noise,
        brushSize: draft.brushSize,
        focused: draft.focused,
        minimumContextArea: draft.minimumContextArea,
        tool: 'brush' as const,
        apiKey: 'test-key',
        notify: vi.fn(),
        onPromptChange: vi.fn(),
        onNegativePromptChange: vi.fn(),
        onPromptSource: vi.fn(),
        onDraftChange: vi.fn(),
        onFileChange: vi.fn(),
        onSelectImageSource: vi.fn(),
        onStrengthChange: vi.fn(),
        onNoiseChange: vi.fn(),
        onBrushSizeChange: vi.fn(),
        onFocusedChange: vi.fn(),
        onMinimumContextAreaChange: vi.fn(),
        onToolChange: vi.fn(),
        onClearMask: vi.fn(),
        onInvertMask: vi.fn(),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        onExpansionChange: vi.fn(),
        onApplyOutpaint: vi.fn(),
        expansion: draft.expansion,
        tagAssistEnabled: false,
      };

      // mobileTab = 'canvas' 时：baseImage 是 block，prompt 和 params 是 hidden lg:block
      const { container, rerender } = render(React.createElement(ImageEditControls, { ...baseProps, mobileTab: 'canvas' }));
      const baseImageSection = container.querySelector('[data-lab-module="baseImage"]');
      const promptSection = container.querySelector('[data-lab-module="prompt"]');
      const paramsSection = container.querySelector('[data-lab-module="params"]');
      const editSettingsSection = container.querySelector('[data-lab-module="editSettings"]');

      expect(baseImageSection?.className).toContain('block');
      expect(baseImageSection?.className).not.toContain('hidden lg:block');
      expect(promptSection?.className).toContain('hidden lg:block');
      expect(paramsSection?.className).toContain('hidden lg:block');
      expect(editSettingsSection?.className).toContain('hidden lg:block');

      // mobileTab = 'prompt' 时：prompt 是 block，baseImage 和 params 是 hidden lg:block
      rerender(React.createElement(ImageEditControls, { ...baseProps, mobileTab: 'prompt' }));
      expect(baseImageSection?.className).toContain('hidden lg:block');
      expect(promptSection?.className).toContain('block');
      expect(promptSection?.className).not.toContain('hidden lg:block');
      expect(paramsSection?.className).toContain('hidden lg:block');

      // mobileTab = 'params' 时：params 与 editSettings 是 block，baseImage 和 prompt 是 hidden lg:block
      rerender(React.createElement(ImageEditControls, { ...baseProps, mobileTab: 'params' }));
      expect(baseImageSection?.className).toContain('hidden lg:block');
      expect(promptSection?.className).toContain('hidden lg:block');
      expect(paramsSection?.className).toContain('block');
      expect(paramsSection?.className).not.toContain('hidden lg:block');
      expect(editSettingsSection?.className).toContain('block');
      expect(editSettingsSection?.className).not.toContain('hidden lg:block');
    });
  });
});


