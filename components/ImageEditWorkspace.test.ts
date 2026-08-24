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
  return { ...render(React.createElement(ImageEditControls, {
    operation,
    draft,
    fileInputRef: React.createRef<HTMLInputElement>(),
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
  })), onManualMaskEditingChange, onPromptChange };
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

    expect(screen.getByText('底图')).toBeTruthy();
    expect(screen.getByText('Strength')).toBeTruthy();
    expect(screen.queryByText('画笔')).toBeNull();
    expect(screen.queryByText('手动调整蒙版')).toBeNull();
    expect(screen.queryByText('Focused Inpainting')).toBeNull();
    expect(screen.queryByText('扩展画布（像素）')).toBeNull();
  });

  it('局部重绘显示蒙版工具和 Focused，但不显示扩图四边', () => {
    renderControls('inpaint');

    expect(screen.getByText('Focused Inpainting')).toBeTruthy();
    expect(screen.getByText('画笔')).toBeTruthy();
    expect(screen.getByTitle('撤销')).toBeTruthy();
    expect(screen.queryByText('扩展画布（像素）')).toBeNull();
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
  it('使用统一预览顺序，并只提供一个生成按钮', () => {
    const canvasProps = {
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
    };
    const { container } = render(React.createElement(ImageEditPreview, {
      operation: 'inpaint',
      baseImage: 'data:image/png;base64,fixture',
      error: null,
      generationCostLabel: '预计消耗 12 Anlas',
      onGenerate: vi.fn(),
      ...canvasProps,
    }));

    const preview = container.querySelector('.chain-editor-preview');
    expect(preview?.className).toContain('order-1');
    expect(preview?.className).toContain('lg:order-2');
    expect(preview?.className).toContain('lg:w-1/2');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /生成编辑结果/ })).toBeTruthy();
  });
});
