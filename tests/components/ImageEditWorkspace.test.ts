// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLabImageEditDraft } from '../../services/labWorkspace';
import { ImageEditControls } from '../../components/ImageEditControls';
import { ImageEditPanel } from '../../components/ImageEditPanel';
import { ImageEditPreview } from '../../components/ImageEditPreview';
import type { NAIParams } from '../../types';
import { imageTaggerService } from '../../services/imageTaggerService';
const canvasState = vi.hoisted(() => ({ focused: false }));

vi.mock('../../components/ChainEditorParams', () => ({
  ChainEditorParams: () => React.createElement('div', { 'data-testid': 'common-params' }, '公共参数'),
}));

vi.mock('../../components/VibeManager', () => ({
  VibeManager: () => React.createElement('div', { 'data-testid': 'vibe-manager' }, 'Vibe'),
}));

vi.mock('../../components/CharacterReferenceManager', () => ({
  CharacterReferenceManager: () => React.createElement('div', { 'data-testid': 'character-reference-manager' }, 'Character Reference'),
}));

vi.mock('../../components/ImageEditCanvas', () => ({
  ImageEditCanvas: ({ focused }: { focused: boolean }) => { canvasState.focused = focused; return React.createElement('div', { 'data-testid': 'edit-canvas' }, '画布'); },
}));

vi.mock('../../components/CloudQueueStatus', () => ({
  InlineCloudQueueStatus: () => React.createElement('div', null, '队列'),
  useCloudQueueStatus: () => null,
}));

vi.mock('../../components/SmartImage', () => ({
  OriginalImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement('img', props),
  SmartImage: ({ thumbnailVariant: _thumbnailVariant, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { thumbnailVariant?: string }) => React.createElement('img', props),
}));

vi.mock('../../services/dbService', () => ({
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

vi.mock('../../services/localHistory', () => ({
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

const renderControls = (operation: 'image-to-image' | 'inpaint' | 'outpaint', manualMaskEditing = false, safeMode = false, tagAssistEnabled = false, paramsPatch: Partial<NAIParams> = {}, mobileTab: 'canvas' | 'prompt' | 'params' = 'canvas', positionSource?: { image: string; width: number; height: number }, focused = operation === 'inpaint') => {
  const draft = createLabImageEditDraft(operation, 'blue bottle', 'low quality', { ...params, ...paramsPatch },
    { focused, ...(operation === 'outpaint' ? { expansion: { top: 0, bottom: 0, left: 640, right: 704 } } : {}) });
  const onManualMaskEditingChange = vi.fn();
  const onPromptChange = vi.fn();
  const onSelectImageSource = vi.fn();
  const onPasteImage = vi.fn();
  const onDraftChange = vi.fn();
  const onBrushSizeChange = vi.fn();
  const notify = vi.fn();
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
    baseImagePreview: positionSource?.image,
    outpaintSourceSize: positionSource,
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
    notify,
    mobileTab,
    onPromptChange,
    onNegativePromptChange: vi.fn(),
    onPromptSource: vi.fn(),
    onDraftChange,
    onFileChange: vi.fn(),
    onPasteImage,
    onSelectImageSource,
    onStrengthChange: vi.fn(),
    onNoiseChange: vi.fn(),
    onBrushSizeChange,
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
  })), onManualMaskEditingChange, onPromptChange, onSelectImageSource, onPasteImage, onDraftChange, onBrushSizeChange, notify };
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ImageEditControls', () => {
  it.each(['canvas', 'params'] as const)('图生图输出尺寸随 %s Tab 正确显隐，选择不影响其他编辑模式', mobileTab => {
    const { onDraftChange } = renderControls('image-to-image', false, false, false, {}, mobileTab);
    const select = screen.getByRole('combobox', { name: '图生图输出尺寸' });
    const section = select.closest('[data-lab-module="params"]');
    expect(section?.className).toContain(mobileTab === 'params' ? 'block' : 'hidden lg:block');
    fireEvent.change(select, { target: { value: 'free' } });
    expect(onDraftChange).toHaveBeenCalledWith({ imageToImageSizeMode: 'free' });
    cleanup();
    renderControls('inpaint', false, false, false, {}, mobileTab);
    expect(screen.queryByRole('combobox', { name: '图生图输出尺寸' })).toBeNull();
    cleanup();
    renderControls('outpaint', false, false, false, {}, mobileTab);
    expect(screen.queryByRole('combobox', { name: '图生图输出尺寸' })).toBeNull();
  });
  it('新局部重绘的中文开关默认勾选，可手动关闭再开启', () => {
    const draft = createLabImageEditDraft('inpaint', 'test prompt', '', params);
    const onDraftChange = vi.fn();
    render(React.createElement(ImageEditPanel, {
      baseImage: null, previewImage: null, operation: 'inpaint', draft,
      layout: { order: ['prompt', 'baseImage', 'params', 'editSettings', 'characterReference'], collapsed: {} },
      generationCostLabel: () => '零点数', apiKey: 'test-key', notify: vi.fn(), onPromptChange: vi.fn(),
      onNegativePromptChange: vi.fn(), onPromptSource: vi.fn(), onDraftChange, onBaseImageChange: vi.fn(),
      onCanvasChange: vi.fn(), onGenerate: vi.fn(), onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png', tagAssistEnabled: false,
    }));
    const toggle = screen.getByRole('checkbox', { name: '聚焦重绘' }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(canvasState.focused).toBe(true);
    expect(screen.queryByText(/Focused/)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    expect(canvasState.focused).toBe(false);
    expect(onDraftChange).toHaveBeenLastCalledWith({ focused: false, focusedRect: undefined });
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(canvasState.focused).toBe(true);
    expect(onDraftChange).toHaveBeenLastCalledWith({ focused: true });
    fireEvent.change(screen.getByRole('slider', { name: '笔刷大小' }), { target: { value: '96' } });
    expect(screen.getByRole('spinbutton', { name: '笔刷大小数值' })).toHaveProperty('value', '96');
    expect(onDraftChange).toHaveBeenLastCalledWith({ brushSize: 96 });
  });

  it.each([
    ['inpaint', true], ['inpaint', false], ['outpaint', false],
  ] as const)('%s 聚焦=%s 均可调节笔刷大小', (operation, focused) => {
    const { container, onBrushSizeChange } = renderControls(operation, operation === 'outpaint', false, false, {}, 'canvas', undefined, focused);
    const slider = screen.getByRole('slider', { name: '笔刷大小' }) as HTMLInputElement;
    const numeric = screen.getByRole('spinbutton', { name: '笔刷大小数值' }) as HTMLInputElement;
    expect(slider.value).toBe('64');
    expect(numeric.value).toBe('64');
    expect([slider.min, slider.max, slider.step]).toEqual(['8', '512', '4']);
    fireEvent.change(slider, { target: { value: '128' } });
    expect(onBrushSizeChange).toHaveBeenLastCalledWith(128);
    fireEvent.change(numeric, { target: { value: '1024' } });
    expect(onBrushSizeChange).toHaveBeenLastCalledWith(512);
    fireEvent.click(screen.getByRole('button', { name: '橡皮擦' }));
    fireEvent.change(numeric, { target: { value: '32' } });
    expect(onBrushSizeChange).toHaveBeenLastCalledWith(32);
    const baseImageSection = container.querySelector('[data-lab-module="baseImage"]');
    expect(baseImageSection?.contains(slider)).toBe(true);
    expect(baseImageSection?.className).toContain('block');
    expect(baseImageSection?.className).not.toContain('hidden lg:block');
  });

  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 去掉常驻教程后仍可粘贴、取用底图和编辑提示词', operation => {
    const { container, onPasteImage, onSelectImageSource, onPromptChange } = renderControls(operation);
    expect(container.textContent).not.toMatch(/可直接粘贴|独立保存|绘制重绘区域|生成结果在右侧/);
    expect(screen.getByRole('button', { name: '上传图片' })).toBeTruthy();
    const paste = screen.getByRole('button', { name: '粘贴' });
    expect(paste.title).toContain('Ctrl+V');
    const latest = screen.getByRole('button', { name: '文生图最新' });
    if (operation === 'image-to-image') {
      expect(paste.title).toContain('保留当前配置');
      expect(paste.title).not.toContain('带入图片配置');
      expect(latest.title).toBe('取用最新结果作为底图 · 保留当前配置');
    } else {
      expect(paste.title).toContain('带入图片配置');
      expect(latest.title).toBe('取用最新结果及配置');
    }
    fireEvent.click(paste);
    expect(onPasteImage).toHaveBeenCalledOnce();
    fireEvent.click(latest);
    expect(onSelectImageSource).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'history prompt', params: expect.objectContaining({ width: 832, height: 1216 }),
    }), 'generated');
    const placeholder = operation === 'image-to-image' ? '图生图提示词' : operation === 'inpaint' ? '重绘提示词' : '扩图提示词';
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: 'new scene' } });
    expect(onPromptChange).toHaveBeenCalledWith('new scene');
    expect(screen.queryByText('无免费档')).toBeNull();
  });

  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 定位区按原图比例且沿用模型能力，手动定位原子更新开关和角色', operation => {
    const character = { id: 'role', prompt: 'girl', negativePrompt: 'hat', x: 0.223, y: 0.887 };
    const { onDraftChange } = renderControls(operation, false, false, false,
      { model: 'nai-diffusion-5-full', width: 1792, height: 768, characters: [character], useCoords: false }, 'prompt',
      { image: 'blob:original', width: 1280, height: 720 });
    fireEvent.click(screen.getByRole('button', { name: '角色定位' }));
    expect(screen.getByText('自由定位 · 1280 × 720')).toBeTruthy();
    expect(screen.getByRole('group', { name: '角色定位画布' }).style.aspectRatio).toBe(String(1280 / 720));
    expect(screen.getByAltText('角色定位底图').getAttribute('src')).toBe('blob:original');
    fireEvent.keyDown(screen.getByRole('button', { name: '定位角色 1' }), { key: 'ArrowRight' });
    expect(onDraftChange).toHaveBeenCalledExactlyOnceWith({ params: expect.objectContaining({ useCoords: true, width: 1792, height: 768, characters: [{ ...character, x: 0.233 }] }) });
  });
  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 粘贴反推只追加本模式角色，不改全局词、坐标或底图', async operation => {
    const character = { id: 'role', prompt: 'blue hair', negativePrompt: 'hat', x: 0.25, y: 0.75 };
    const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:role'); URL.revokeObjectURL = vi.fn();
    const tag = vi.spyOn(imageTaggerService, 'tagFile').mockResolvedValue({ model: 'selected', threshold: 0.53, characterThreshold: 0.85, tags: [{ name: 'sitting', category: 'general', confidence: 0.9 }], character: [], general: [], rating: null });
    vi.spyOn(imageTaggerService, 'getStatus').mockResolvedValue({ model: 'selected', downloaded: true, models: [], busy: false, downloadingModel: null });
    try {
      const { onDraftChange, onPromptChange, onSelectImageSource, onPasteImage } = renderControls(operation, false, false, false, { characters: [character] }, 'prompt');
      fireEvent.paste(screen.getByRole('button', { name: '粘贴反推' }), { clipboardData: { files: [new File(['synthetic'], 'role.png', { type: 'image/png' })] } });
      await waitFor(() => expect(onDraftChange).toHaveBeenCalledOnce());
      expect(onDraftChange).toHaveBeenCalledWith({ params: expect.objectContaining({ characters: [{ ...character, prompt: 'blue hair, sitting' }] }) });
      expect(tag).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'role.png' }));
      expect(onPromptChange).not.toHaveBeenCalled(); expect(onSelectImageSource).not.toHaveBeenCalled(); expect(onPasteImage).not.toHaveBeenCalled();
    } finally { cleanup(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
  });
  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 角色正负提示词、定位及增删只修改当前模式参数', operation => {
    const character = { id: 'c1', prompt: 'girl, blue hair', negativePrompt: 'red hair', x: 0.25, y: 0.75 };
    const { onDraftChange } = renderControls(operation, false, false, false, { characters: [character], useCoords: true }, 'prompt');
    fireEvent.change(screen.getByPlaceholderText('角色提示词'), { target: { value: 'girl, white hair' } });
    expect(onDraftChange).toHaveBeenLastCalledWith({ params: expect.objectContaining({ characters: [{ ...character, prompt: 'girl, white hair' }] }) });
    fireEvent.change(screen.getByDisplayValue('red hair'), { target: { value: 'black hair' } });
    expect(onDraftChange).toHaveBeenLastCalledWith({ params: expect.objectContaining({ characters: [{ ...character, negativePrompt: 'black hair' }] }) });
    fireEvent.click(screen.getByRole('checkbox', { name: 'AI 自动构图' }));
    expect(onDraftChange).toHaveBeenLastCalledWith({ params: expect.objectContaining({ useCoords: false, characters: [character] }) });
    fireEvent.click(screen.getByRole('button', { name: '+ 添加角色' }));
    expect(onDraftChange.mock.calls.at(-1)?.[0].params.characters).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '移除角色提示词' }));
    expect(onDraftChange).toHaveBeenLastCalledWith({ params: expect.objectContaining({ characters: [] }) });
    const module = screen.getByText('角色专属提示词').closest('details')!;
    expect(module.classList.contains('block')).toBe(true);
    expect(module.style.order).toBe('2');
    expect(character.prompt).toBe('girl, blue hair');
  });

  it('编辑模式遵守当前模型的角色数量限制', () => {
    const characters = Array.from({ length: 6 }, (_, index) => ({ id: String(index), prompt: 'girl', x: 0.5, y: 0.5 }));
    const { onDraftChange, notify } = renderControls('inpaint', false, false, false, { model: 'nai-diffusion-4-5-full', characters });
    fireEvent.click(screen.getByRole('button', { name: '+ 添加角色' }));
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('当前模型最多支持 6 个角色提示词', 'error');
  });

  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('在 %s 的正负面提示词中启用 Tag 辅助', operation => {
    const { onPromptChange } = renderControls(operation, false, false, true);

    const assistedInputs = screen.getAllByRole('combobox').filter(element => element.tagName === 'TEXTAREA');
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
    expect(screen.queryByText('聚焦重绘')).toBeNull();
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
    onPasteImage: vi.fn(),
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
    onPasteImage: vi.fn(),
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
    expect(screen.getByText(/^选择底图$/)).toBeTruthy();
  });

  it('局部重绘显示蒙版工具和聚焦重绘，但不显示扩图四边', () => {
    renderControls('inpaint');

    expect(screen.getByTestId('edit-canvas')).toBeTruthy();
    expect(screen.getByText('聚焦重绘')).toBeTruthy();
    expect(screen.getByText('画笔')).toBeTruthy();
    expect(screen.getByTitle('撤销')).toBeTruthy();
    expect(screen.queryByText('扩展画布（像素）')).toBeNull();
  });

  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 底图入口统一为上传、文生图最新和粘贴', operation => {
    const { onSelectImageSource, onPasteImage } = renderControls(operation);

    fireEvent.click(screen.getByRole('button', { name: /文生图最新/ }));
    expect(onSelectImageSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'history-1' }), 'generated');
    fireEvent.click(screen.getByRole('button', { name: '粘贴' }));
    expect(onPasteImage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '上传图片' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /选择历史图片|选择灵感图片/ })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    const sourceGroup = screen.getByRole('button', { name: '粘贴' }).parentElement!;
    expect(sourceGroup.querySelectorAll('button')).toHaveLength(3);
    expect(sourceGroup.className).toContain('grid-cols-3');
  });

  it('扩图默认只显示自动边缘扩展与模拟画板摆放台，不直接暴露画笔工具', () => {
    const { onManualMaskEditingChange } = renderControls('outpaint');

    expect(screen.getByText('智能画幅扩展')).toBeTruthy();
    expect(screen.getByText('目标画幅比例（画布外框）')).toBeTruthy();
    expect(screen.getByText('画幅预览')).toBeTruthy();
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

    expect(screen.getByRole('status').textContent).toContain('安全模式下不可绘制蒙版');
    expect((screen.getByRole('button', { name: '画笔' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: '聚焦重绘' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('slider', { name: '笔刷大小' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('spinbutton', { name: '笔刷大小数值' }) as HTMLInputElement).disabled).toBe(true);
    cleanup();

    renderControls('outpaint', true, true);
    expect((screen.getByRole('switch', { name: /手动调整蒙版/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '画笔' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('slider', { name: '笔刷大小' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('spinbutton', { name: '笔刷大小数值' }) as HTMLInputElement).disabled).toBe(true);
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
    onPasteImage: vi.fn(),
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
    expect(screen.getByText(/当前 1024 × 1368，需调整为 1024 × 1344/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /居中裁剪/ }));
    expect(onNormalize).toHaveBeenCalledWith('crop');
    fireEvent.click(screen.getByRole('button', { name: /完整保留并填充/ }));
    expect(onNormalize).toHaveBeenCalledWith('contain');
    fireEvent.click(screen.getByRole('button', { name: /直接缩放/ }));
    expect(onNormalize).toHaveBeenCalledWith('stretch');
  });
});

it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('Agent 的 %s 缺少画布时回传拦截原因，不被当作主动取消', async operation => {

  const draft = createLabImageEditDraft(operation, 'synthetic', '', params);
  const generate = vi.fn();
  let request!: (draft: import('../../types').PromptAgentDraft) => Promise<boolean>;
  render(React.createElement(ImageEditPanel, { baseImage: null, previewImage: null, operation, draft,
    layout: { order: ['prompt', 'baseImage', 'params', 'editSettings'], collapsed: {} }, generationCostLabel: () => '估算', apiKey: 'synthetic', notify: vi.fn(),
    onPromptChange: vi.fn(), onNegativePromptChange: vi.fn(), onPromptSource: vi.fn(), onDraftChange: vi.fn(), onBaseImageChange: vi.fn(), onCanvasChange: vi.fn(),
    onGenerate: generate, onAgentGenerateReady: value => { request = value; }, onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png', tagAssistEnabled: false }));
  await expect(request({ basePrompt: 'synthetic', subjectPrompt: '', negativePrompt: '', modules: [], params })).rejects.toMatchObject({ outcome: 'blocked', code: 'missing_base_image' });
  expect(generate).not.toHaveBeenCalled();
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
    expect(screen.getByRole('button', { name: '下载图片' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^生成.*预计消耗 12 Anlas$/ })).toBeTruthy();
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
    const generateButton = screen.getByRole('button', { name: /^生成.*预计消耗 12 Anlas$/ });
    // 移动端隐藏内嵌生成按钮（hidden），桌面端显示（lg:flex）——绝不允许写成 lg:hidden（桌面隐藏/移动显示）。
    expect(generateButton.className).toContain('hidden');
    expect(generateButton.className).toContain('lg:flex');
    expect(generateButton.className).not.toContain('lg:hidden');
  });

  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 与文生图一致显示圆形历史管理、切换按钮和计数，点击管理不误开大图', operation => {
    const onRemoveCurrentHistory = vi.fn();
    const onClearHistoryGroup = vi.fn();
    const onOpenLightbox = vi.fn();
    render(React.createElement(ImageEditPreview, {
      operation,
      image: 'data:image/png;base64,fixture',
      error: null,
      generationCostLabel: '免费',
      onGenerate: vi.fn(),
      onOpenLightbox,
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
    const remove = screen.getByRole('button', { name: '移除当前图片' });
    const clear = screen.getByRole('button', { name: '清空当前历史组' });
    expect(remove.classList.contains('rounded-full')).toBe(true);
    expect(remove.classList.contains('!bg-red-600/90')).toBe(true);
    expect(clear.classList.contains('rounded-full')).toBe(true);
    expect(clear.classList.contains('!bg-gray-900/85')).toBe(true);
    fireEvent.click(remove);
    fireEvent.click(clear);
    expect(onRemoveCurrentHistory).toHaveBeenCalledOnce();
    expect(onClearHistoryGroup).toHaveBeenCalledOnce();
    expect(onOpenLightbox).not.toHaveBeenCalled();
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

    const generateButton = screen.getByRole('button', { name: /^生成/ }) as HTMLButtonElement;
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

    const buttonNoBase = screen.getByRole('button', { name: '请先选择底图' }) as HTMLButtonElement;
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

    const buttonLoading = screen.getByRole('button', { name: '画布加载中…' }) as HTMLButtonElement;
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
      expect(screen.getByRole('tab', { name: '底图' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: '提示' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: '参数' })).toBeTruthy();

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
      expect(screen.getByRole('tab', { name: '画板' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: '提示' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: '参数' })).toBeTruthy();

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
      expect(screen.getByRole('tab', { name: '画布' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: '提示' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: '参数' })).toBeTruthy();
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
    onPasteImage: vi.fn(),
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
      const charactersSection = container.querySelector('[data-lab-module="characters"]');

      expect(baseImageSection?.className).toContain('block');
      expect(baseImageSection?.className).not.toContain('hidden lg:block');
      expect(promptSection?.className).toContain('hidden lg:block');
      expect(paramsSection?.className).toContain('hidden lg:block');
      expect(editSettingsSection?.className).toContain('hidden lg:block');
      expect(charactersSection?.className).toContain('hidden lg:block');

      // mobileTab = 'prompt' 时：prompt 是 block，baseImage 和 params 是 hidden lg:block
      rerender(React.createElement(ImageEditControls, { ...baseProps, mobileTab: 'prompt' }));
      expect(baseImageSection?.className).toContain('hidden lg:block');
      expect(promptSection?.className).toContain('block');
      expect(promptSection?.className).not.toContain('hidden lg:block');
      expect(charactersSection?.classList.contains('hidden')).toBe(false);
      expect(paramsSection?.className).toContain('hidden lg:block');

      // mobileTab = 'params' 时：params 与 editSettings 是 block，baseImage 和 prompt 是 hidden lg:block
      rerender(React.createElement(ImageEditControls, { ...baseProps, mobileTab: 'params' }));
      expect(baseImageSection?.className).toContain('hidden lg:block');
      expect(promptSection?.className).toContain('hidden lg:block');
      expect(charactersSection?.className).toContain('hidden lg:block');
      expect(paramsSection?.className).toContain('block');
      expect(paramsSection?.className).not.toContain('hidden lg:block');
      expect(editSettingsSection?.className).toContain('block');
      expect(editSettingsSection?.className).not.toContain('hidden lg:block');
    });
  });
});
