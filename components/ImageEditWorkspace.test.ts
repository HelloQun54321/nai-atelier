// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLabImageEditDraft } from '../services/labWorkspace';
import { ImageEditControls } from './ImageEditControls';
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
    expect(onSelectImageSource).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'history-1' }), 'history');
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
    expect(onSelectImageSource).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'history-21' }), 'history');
  });

  it('扩图默认只显示自动边缘扩展，不直接暴露画笔工具', () => {
    const { onManualMaskEditingChange } = renderControls('outpaint');

    expect(screen.getByText('扩展画布（像素）')).toBeTruthy();
    expect(screen.getByText('上')).toBeTruthy();
    expect(screen.getByText('右')).toBeTruthy();
    expect(screen.getByText('下')).toBeTruthy();
    expect(screen.getByText('左')).toBeTruthy();
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
});
