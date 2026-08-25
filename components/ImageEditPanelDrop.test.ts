// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLabImageEditDraft } from '../services/labWorkspace';
import { DEFAULT_LAB_PAGE_LAYOUTS } from '../services/appearancePreferences';
import { ImageEditPanel } from './ImageEditPanel';

vi.mock('./ImageEditControls', () => ({
  ImageEditControls: () => React.createElement('div', null, '编辑控件'),
}));

vi.mock('./ImageEditPreview', () => ({
  ImageEditPreview: () => React.createElement('div', null, '编辑预览'),
}));

const params = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
};

afterEach(() => vi.restoreAllMocks());

describe('ImageEditPanel base image drop', () => {
  it('优先接收编辑区内拖入的图片并阻止全局配置导入', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    const onBaseImageChange = vi.fn();
    const onParentDrop = vi.fn();
    const draft = createLabImageEditDraft('inpaint', 'overall prompt', '', params);
    const { container } = render(React.createElement('div', { onDrop: onParentDrop }, React.createElement(ImageEditPanel, {
      baseImage: null,
      previewImage: null,
      operation: 'inpaint',
      layout: DEFAULT_LAB_PAGE_LAYOUTS.inpaint,
      draft,
      generationCostLabel: () => '免费',
      tagAssistEnabled: false,
      apiKey: '',
      notify: vi.fn(),
      onPromptChange: vi.fn(),
      onNegativePromptChange: vi.fn(),
      onPromptSource: vi.fn(),
      onDraftChange: vi.fn(),
      onBaseImageChange,
      onCanvasChange: vi.fn(),
      onGenerate: vi.fn(async () => undefined),
      onOpenLightbox: vi.fn(),
      getDownloadFilename: () => 'test.png',
    })));
    const dropZone = container.querySelector('[data-image-edit-drop-zone="true"]') as HTMLElement;
    const file = new File(['fixture'], 'base.png', { type: 'image/png' });

    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [file],
        items: [{ kind: 'file', type: 'image/png' }],
      },
    });

    await waitFor(() => expect(onBaseImageChange).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/), 'upload'));
    expect(onParentDrop).not.toHaveBeenCalled();
  });

  it('向 generateBarRef 写入移动端悬浮生成入口与费用标签', () => {
    const generateBarRef: { current: { generate: () => void; costLabel: string } | null } = { current: null };
    const draft = createLabImageEditDraft('inpaint', 'overall prompt', '', params);
    render(React.createElement(ImageEditPanel, {
      baseImage: null,
      previewImage: null,
      operation: 'inpaint',
      layout: DEFAULT_LAB_PAGE_LAYOUTS.inpaint,
      draft,
      generationCostLabel: (operation, focused, context) => focused && context?.focusedRect ? 'Opus 免费' : '12 点',
      tagAssistEnabled: false,
      apiKey: '',
      notify: vi.fn(),
      onPromptChange: vi.fn(),
      onNegativePromptChange: vi.fn(),
      onPromptSource: vi.fn(),
      onDraftChange: vi.fn(),
      onBaseImageChange: vi.fn(),
      onCanvasChange: vi.fn(),
      onGenerate: vi.fn(async () => undefined),
      onOpenLightbox: vi.fn(),
      getDownloadFilename: () => 'test.png',
      generateBarRef,
    }));

    expect(generateBarRef.current).not.toBeNull();
    expect(typeof generateBarRef.current?.generate).toBe('function');
    expect(generateBarRef.current?.costLabel).toBe('12 点');
  });
});
