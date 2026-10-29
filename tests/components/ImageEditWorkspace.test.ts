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
  ChainEditorParams: (props: React.ComponentProps<typeof import('../../components/ChainEditorParams').ChainEditorParams>) => React.createElement('div', { 'data-testid': 'common-params' }, '公共参数',
    props.onForceEmptySeedChange && React.createElement('button', { onClick: () => props.onForceEmptySeedChange?.(!props.forceEmptySeed) }, props.forceEmptySeed ? '强制置空 ON' : '强制置空 OFF')),
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
  CloudQueueButton: () => null,
  useCloudQueueEnabled: () => false,
  useCloudQueueStatus: () => null,
}));

vi.mock('../../components/SmartImage', async original => ({
  ...await original<typeof import('../../components/SmartImage')>(),
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

const renderControls = (operation: 'image-to-image' | 'inpaint' | 'outpaint', manualMaskEditing = false, safeMode = false, tagAssistEnabled = false, paramsPatch: Partial<NAIParams> = {}, mobileTab: 'canvas' | 'prompt' | 'reference' | 'params' = 'canvas', positionSource?: { image: string; width: number; height: number }, focused = operation === 'inpaint') => {
  const draft = createLabImageEditDraft(operation, 'blue bottle', 'low quality', { ...params, ...paramsPatch },
    { focused, ...(operation === 'outpaint' ? { expansion: { top: 0, bottom: 0, left: 640, right: 704 } } : {}) });
  const onManualMaskEditingChange = vi.fn();
  const onPromptChange = vi.fn();
  const onNegativePromptChange = vi.fn();
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
    onNegativePromptChange,
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
  })), onManualMaskEditingChange, onPromptChange, onNegativePromptChange, onSelectImageSource, onPasteImage, onDraftChange, onBrushSizeChange, notify };
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 编辑面板将强制置空状态与回调传给公共参数，切换不改草稿', operation => {
  const onDraftChange = vi.fn();
  const draft = createLabImageEditDraft(operation, 'synthetic', '', { ...params, seed: 123 });
  const Harness = () => {
    const [forceEmptySeed, setForceEmptySeed] = React.useState(true);
    return React.createElement(ImageEditPanel, { baseImage: null, previewImage: null, operation, draft,
      layout: { collapsed: {} }, generationCostLabel: () => '估算', apiKey: '', notify: vi.fn(),
      forceEmptySeed, onForceEmptySeedChange: setForceEmptySeed,
      onPromptChange: vi.fn(), onNegativePromptChange: vi.fn(), onPromptSource: vi.fn(), onDraftChange, onBaseImageChange: vi.fn(), onCanvasChange: vi.fn(),
      onGenerate: vi.fn(), onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png', tagAssistEnabled: false });
  };
  render(React.createElement(Harness));
  fireEvent.click(screen.getByRole('button', { name: '强制置空 ON' }));
  fireEvent.click(screen.getByRole('button', { name: '强制置空 OFF' }));
  expect(screen.getByRole('button', { name: '强制置空 ON' })).toBeTruthy();
  expect(draft.params.seed).toBe(123); expect(onDraftChange).not.toHaveBeenCalled();
});

describe('ImageEditControls', () => {
  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 将角色库读取状态和重试传到共用选择器', operation => {
    const draft = createLabImageEditDraft(operation, '', '', { ...params, model: 'nai-diffusion-4-5-full', characters: [{ id: 'role', prompt: 'blue hair', x: 0.5, y: 0.5 }] });
    const onRetryChains = vi.fn();
    const props: React.ComponentProps<typeof ImageEditPanel> = {
      baseImage: null, previewImage: null, operation, draft, layout: { collapsed: {} }, generationCostLabel: () => '估算', apiKey: '', notify: vi.fn(),
      onPromptChange: vi.fn(), onNegativePromptChange: vi.fn(), onPromptSource: vi.fn(), onDraftChange: vi.fn(), onBaseImageChange: vi.fn(), onCanvasChange: vi.fn(),
      onGenerate: vi.fn(), onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png', tagAssistEnabled: false,
      allChains: [], chainsLoading: true, showCharacterReference: true, onRetryChains,
    };
    const view = render(React.createElement(ImageEditPanel, props));
    fireEvent.click(screen.getByRole('tab', { name: '提示' }));
    fireEvent.click(screen.getByRole('button', { name: '从角色库引用' }));
    expect(screen.getByText('加载中…')).toBeTruthy();
    expect(screen.queryByText('角色库中暂无自定义角色')).toBeNull();
    view.rerender(React.createElement(ImageEditPanel, { ...props, chainsLoading: false, chainsError: '角色库读取失败' }));
    expect(screen.getByRole('alert').textContent).toContain('角色库读取失败');
    expect(screen.queryByText('角色库中暂无自定义角色')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetryChains).toHaveBeenCalledOnce();
    view.rerender(React.createElement(ImageEditPanel, { ...props, chainsLoading: false }));
    expect(screen.getByText('角色库中暂无自定义角色')).toBeTruthy();
  });

  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 正负词清空分别在既有标题行，不覆盖框中文字或混清另一字段', operation => {
    const { onDraftChange } = renderControls(operation, false, false, false, {}, 'prompt');
    const positive = screen.getByPlaceholderText(operation === 'inpaint' ? '重绘提示词' : operation === 'outpaint' ? '扩图提示词' : '图生图提示词') as HTMLTextAreaElement;
    const negative = screen.getByPlaceholderText('输入本次负面提示词') as HTMLTextAreaElement;
    const [clearPositive, clearNegative] = screen.getAllByRole('button', { name: '清空当前提示词' });
    expect(positive.parentElement!.contains(clearPositive)).toBe(false);
    expect(negative.parentElement!.contains(clearNegative)).toBe(false);
    expect(clearPositive.parentElement!.parentElement!.parentElement!.textContent).toContain(operation === 'inpaint' ? '重绘提示词' : operation === 'outpaint' ? '扩图提示词' : '图生图提示词');
    expect(clearNegative.parentElement!.parentElement!.textContent).toContain('全局负面提示词');
    const originalNegative = negative.value;
    fireEvent.click(clearPositive); expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: '', promptSource: 'custom', negativePrompt: originalNegative }));
    expect(document.activeElement).toBe(positive);
    fireEvent.click(clearNegative); expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ negativePrompt: '' })); expect(onDraftChange.mock.lastCall![0]).not.toHaveProperty('prompt'); expect(document.activeElement).toBe(negative);
    expect(positive.className).not.toMatch(/pr-14|md:pr-9/); expect(negative.className).not.toMatch(/pr-14|md:pr-9/);
  });
  it.each(['canvas', 'params'] as const)('图生图输出尺寸随 %s Tab 正确显隐，选择不影响其他编辑模式', mobileTab => {
    const { onDraftChange } = renderControls('image-to-image', false, false, false, {}, mobileTab);
    const select = screen.getByRole('combobox', { name: '图生图输出尺寸' });
    const section = select.closest('[data-lab-module="params"]');
    expect(section?.classList.contains('hidden')).toBe(mobileTab !== 'params');
    expect(section?.classList.contains('lg:block')).toBe(false);
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
      layout: { collapsed: {} },
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
    expect(baseImageSection?.classList.contains('hidden')).toBe(false);
  });

  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 去掉常驻教程后仍可粘贴、取用底图和编辑提示词', operation => {
    const { container, onPasteImage, onSelectImageSource, onDraftChange } = renderControls(operation);
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
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'new scene', promptSource: 'custom' }));
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
      const tools = screen.getByRole('button', { name: '粘贴反推' }).closest('.character-tools')!;
      expect(tools.contains(screen.getByRole('button', { name: '坐标' }))).toBe(true);
      expect(tools.contains(screen.getByRole('button', { name: '下移角色 1' }))).toBe(true);
      expect(screen.getByRole('button', { name: '粘贴反推' }).textContent).toBe('');
      expect(screen.getByRole('button', { name: '坐标' }).textContent).toBe('');
      expect(tools.compareDocumentPosition(screen.getByPlaceholderText('角色提示词')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(module.style.order).toBe('');
    const promptModules = Array.from(module.parentElement!.querySelectorAll<HTMLElement>('[data-lab-module]')).filter(node => !node.classList.contains('hidden'));
    expect(promptModules.slice(0, 2).map(node => node.dataset.labModule)).toEqual(['prompt', 'characters']);
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
    const { onDraftChange } = renderControls(operation, false, false, true);

    const assistedInputs = screen.getAllByRole('combobox').filter(element => element.tagName === 'TEXTAREA');
    expect(assistedInputs).toHaveLength(2);
    fireEvent.change(assistedInputs[0], { target: { value: 'blue bottle, 1girl' } });
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'blue bottle, 1girl', promptSource: 'custom' }));
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
  // Agent 生成回调类型直接取组件真实 props 签名，不硬写旧布尔返回。
  let request!: Parameters<NonNullable<React.ComponentProps<typeof ImageEditPanel>['onAgentGenerateReady']>>[0];
  render(React.createElement(ImageEditPanel, { baseImage: null, previewImage: null, operation, draft,
    layout: { collapsed: {} }, generationCostLabel: () => '估算', apiKey: 'synthetic', notify: vi.fn(),
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

  describe('跨端实验室分区适配', () => {
    it('ImageEditPanel 针对图生图、局部重绘和扩图渲染对应分区', () => {
      const draft = createLabImageEditDraft('image-to-image', 'test prompt', 'low quality', params);
      const { rerender } = render(React.createElement(ImageEditPanel, {
        baseImage: null,
        previewImage: null,
        operation: 'image-to-image',
        draft,
        layout: { collapsed: {} } as any,
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
        layout: { collapsed: {} } as any,
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
        layout: { collapsed: {} } as any,
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

    it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 按当前能力显示参考页，V5 隐藏并回到画布且保留草稿', operation => {
      const draft = createLabImageEditDraft(operation, '保留提示词', '保留负面词', { ...params, model: 'nai-diffusion-4-5-full',
        characterReferences: { enabled: true, slots: [{ assetId: 'reference', type: 'style', strength: 0.6, fidelity: 1 }] } });
      const props: React.ComponentProps<typeof ImageEditPanel> = {
        baseImage: null, previewImage: null, operation, draft, layout: { collapsed: {} }, generationCostLabel: () => '估算', apiKey: '', notify: vi.fn(),
        onPromptChange: vi.fn(), onNegativePromptChange: vi.fn(), onPromptSource: vi.fn(), onDraftChange: vi.fn(), onBaseImageChange: vi.fn(), onCanvasChange: vi.fn(),
        onGenerate: vi.fn(), onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png', tagAssistEnabled: false,
      };
      const { container, rerender } = render(React.createElement(ImageEditPanel, props));
      expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([operation === 'image-to-image' ? '底图' : operation === 'inpaint' ? '画板' : '画布', '提示', '参考', '参数']);
      const reference = screen.getByTestId('character-reference-manager');
      const module = reference.closest('[data-lab-module]')!;
      expect(module.classList.contains('hidden')).toBe(true);
      fireEvent.click(screen.getByRole('tab', { name: '参考' }));
      expect(module.classList.contains('hidden')).toBe(false);
      expect(container.querySelector('[data-lab-module="prompt"]')!.classList.contains('hidden')).toBe(true);
      expect(Boolean(screen.queryByTestId('vibe-manager'))).toBe(operation === 'image-to-image');
      fireEvent.click(screen.getByRole('tab', { name: '提示' }));
      expect(module.classList.contains('hidden')).toBe(true);
      fireEvent.click(screen.getByRole('tab', { name: '参考' }));
      expect(screen.getByTestId('character-reference-manager')).toBe(reference);
      for (const model of ['nai-diffusion-5-full', 'nai-diffusion-5-curated', 'nai-diffusion-5-full-medium']) {
        rerender(React.createElement(ImageEditPanel, { ...props, draft: { ...draft, params: { ...draft.params, model } } }));
        expect(screen.queryByRole('tab', { name: '参考' })).toBeNull();
        expect(screen.getAllByRole('tab')).toHaveLength(3);
        expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
      }
      rerender(React.createElement(ImageEditPanel, props));
      expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
      expect(draft.params.characterReferences?.slots[0].type).toBe('style');
      expect(props.onDraftChange).not.toHaveBeenCalled();
      expect(props.onGenerate).not.toHaveBeenCalled();
    });

    it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('V4 的 %s 只为支持的 Vibe 显示参考页', operation => {
      const draft = createLabImageEditDraft(operation, '', '', { ...params, model: 'nai-diffusion-4-full' });
      render(React.createElement(ImageEditPanel, { baseImage: null, previewImage: null, operation, draft, layout: { collapsed: {} }, generationCostLabel: () => '估算', apiKey: '', notify: vi.fn(),
        onPromptChange: vi.fn(), onNegativePromptChange: vi.fn(), onPromptSource: vi.fn(), onDraftChange: vi.fn(), onBaseImageChange: vi.fn(), onCanvasChange: vi.fn(),
        onGenerate: vi.fn(), onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png', tagAssistEnabled: false }));
      expect(Boolean(screen.queryByRole('tab', { name: '参考' }))).toBe(operation === 'image-to-image');
      expect(screen.queryByTestId('character-reference-manager')).toBeNull();
    });

    it('ImageEditControls 在电脑与手机按同一分区显隐，保持非活动内容挂载', () => {
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

      // mobileTab = 'canvas' 时：baseImage 是 block，prompt 和 params 是 hidden
      const { container, rerender } = render(React.createElement(ImageEditControls, { ...baseProps, mobileTab: 'canvas' }));
      const baseImageSection = container.querySelector('[data-lab-module="baseImage"]');
      const promptSection = container.querySelector('[data-lab-module="prompt"]');
      const paramsSection = container.querySelector('[data-lab-module="params"]');
      const editSettingsSection = container.querySelector('[data-lab-module="editSettings"]');
      const charactersSection = container.querySelector('[data-lab-module="characters"]');

      expect(baseImageSection?.className).toContain('block');
      expect(baseImageSection?.classList.contains('hidden')).toBe(false);
      expect(promptSection?.classList.contains('hidden')).toBe(true);
      expect(paramsSection?.classList.contains('hidden')).toBe(true);
      expect(editSettingsSection?.classList.contains('hidden')).toBe(true);
      expect(charactersSection?.classList.contains('hidden')).toBe(true);

      // mobileTab = 'prompt' 时：prompt 是 block，baseImage 和 params 是 hidden
      rerender(React.createElement(ImageEditControls, { ...baseProps, mobileTab: 'prompt' }));
      expect(baseImageSection?.classList.contains('hidden')).toBe(true);
      expect(promptSection?.className).toContain('block');
      expect(promptSection?.classList.contains('hidden')).toBe(false);
      expect(charactersSection?.classList.contains('hidden')).toBe(false);
      expect(paramsSection?.classList.contains('hidden')).toBe(true);

      // mobileTab = 'params' 时：params 与 editSettings 是 block，baseImage 和 prompt 是 hidden
      rerender(React.createElement(ImageEditControls, { ...baseProps, mobileTab: 'params' }));
      expect(baseImageSection?.classList.contains('hidden')).toBe(true);
      expect(promptSection?.classList.contains('hidden')).toBe(true);
      expect(charactersSection?.classList.contains('hidden')).toBe(true);
      expect(paramsSection?.className).toContain('block');
      expect(paramsSection?.classList.contains('hidden')).toBe(false);
      expect(editSettingsSection?.className).toContain('block');
      expect(editSettingsSection?.classList.contains('hidden')).toBe(false);
      const visibleModules = Array.from(container.querySelectorAll<HTMLElement>('[data-lab-module]')).filter(node => !node.classList.contains('hidden'));
      expect(visibleModules.map(node => node.dataset.labModule)).toEqual(['editSettings', 'params']);
      expect(visibleModules.every(node => node.style.order === '')).toBe(true);
    });
  });
});
