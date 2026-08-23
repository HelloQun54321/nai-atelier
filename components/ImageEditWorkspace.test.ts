// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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

const renderControls = (operation: 'image-to-image' | 'inpaint' | 'outpaint') => {
  const draft = createLabImageEditDraft(operation, 'blue bottle', 'low quality', params);
  return render(React.createElement(ImageEditControls, {
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
    expansion: draft.expansion,
    apiKey: 'test-key',
    notify: vi.fn(),
    onPromptChange: vi.fn(),
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
    onClearMask: vi.fn(),
    onInvertMask: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onExpansionChange: vi.fn(),
    onApplyOutpaint: vi.fn(),
  }));
};

afterEach(() => cleanup());

describe('ImageEditControls', () => {
  it('图生图只显示底图、Strength 和 Noise，不显示蒙版或扩图控件', () => {
    renderControls('image-to-image');

    expect(screen.getByText('底图')).toBeTruthy();
    expect(screen.getByText('Strength')).toBeTruthy();
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

  it('扩图显示四边扩展并保留局部重绘蒙版工具', () => {
    renderControls('outpaint');

    expect(screen.getByText('扩展画布（像素）')).toBeTruthy();
    expect(screen.getByText('上')).toBeTruthy();
    expect(screen.getByText('右')).toBeTruthy();
    expect(screen.getByText('下')).toBeTruthy();
    expect(screen.getByText('左')).toBeTruthy();
    expect(screen.getByText('画笔')).toBeTruthy();
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
