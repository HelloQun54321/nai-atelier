// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLabImageEditDraft } from '../../services/labWorkspace';
import { DEFAULT_LAB_PAGE_LAYOUTS } from '../../services/appearancePreferences';
import { ImageEditPanel } from '../../components/ImageEditPanel';
import { extractMetadata } from '../../services/metadataService';
import { getCopiedImageData } from '../../services/imageClipboardContext';

vi.mock('../../components/ImageEditControls', () => ({
  ImageEditControls: (props: React.ComponentProps<typeof import('../../components/ImageEditControls').ImageEditControls>) => React.createElement('div', null,
    React.createElement('button', { onClick: props.onPasteImage, disabled: props.isBusy }, '粘贴'),
    props.latestTextToImageItem && React.createElement('button', { onClick: () => props.onSelectImageSource(props.latestTextToImageItem!, 'generated'), disabled: props.isBusy }, '文生图最新'),
    React.createElement('textarea', { 'aria-label': '提示词' }),
  ),
}));

vi.mock('../../components/ImageEditPreview', () => ({
  ImageEditPreview: ({ error }: { error: string | null }) => React.createElement('div', null, error || '编辑预览'),
}));

vi.mock('../../services/metadataService', async importOriginal => ({ ...await importOriginal<typeof import('../../services/metadataService')>(), extractMetadata: vi.fn(async () => null) }));
vi.mock('../../services/imageClipboardContext', () => ({ getCopiedImageData: vi.fn(async () => undefined) }));

const params = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const panelProps = (operation: 'image-to-image' | 'inpaint' | 'outpaint' = 'inpaint') => ({
  baseImage: null, previewImage: null, operation, layout: DEFAULT_LAB_PAGE_LAYOUTS[operation],
  draft: createLabImageEditDraft(operation, 'current prompt', 'current negative', params),
  generationCostLabel: () => '免费', tagAssistEnabled: false, apiKey: '', notify: vi.fn(),
  onPromptChange: vi.fn(), onNegativePromptChange: vi.fn(), onPromptSource: vi.fn(), onDraftChange: vi.fn(),
  onBaseImageChange: vi.fn(), onCanvasChange: vi.fn(), onGenerate: vi.fn(async () => undefined),
  onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png',
});

const mockClipboard = (read: () => Promise<unknown[]>) => {
  vi.stubGlobal('navigator', { clipboard: { read } });
};

describe('ImageEditPanel 图片粘贴', () => {
  it('上传全局为空的原图仍导入角色提示词，不丢掉有效生成信息', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    vi.mocked(extractMetadata).mockResolvedValueOnce(JSON.stringify({ prompt: '',
      v4_prompt: { caption: { base_caption: '', char_captions: [{ char_caption: 'girl, blue hair', centers: [{ x: 0.3, y: 0.7 }] }] }, use_coords: true },
      v4_negative_prompt: { caption: { base_caption: '', char_captions: [{ char_caption: 'red hair' }] } },
    }));
    const props = panelProps();
    const { container } = render(React.createElement(ImageEditPanel, props));
    fireEvent.drop(container.querySelector('[data-image-edit-drop-zone]')!, { dataTransfer: { files: [new File(['synthetic'], 'original.png', { type: 'image/png' })], items: [] } });
    await waitFor(() => expect(props.onBaseImageChange).toHaveBeenCalledWith(expect.any(String), 'upload', undefined, {
      prompt: '', negativePrompt: '', params: expect.objectContaining({ useCoords: true, characters: [expect.objectContaining({ prompt: 'girl, blue hair', negativePrompt: 'red hair', x: 0.3, y: 0.7 })] }),
    }));
    expect(props.notify).toHaveBeenCalledWith('已自动解析并带入底图提示词与参数', 'success');
  });

  it('点击编辑区后可直接键盘粘贴，不抢走输入框焦点', () => {
    const { container } = render(React.createElement(ImageEditPanel, panelProps()));
    const zone = container.querySelector('[data-image-edit-drop-zone]')!;
    fireEvent.pointerDown(screen.getByText('编辑预览'));
    expect(document.activeElement).toBe(zone);
    const textarea = screen.getByLabelText('提示词');
    textarea.focus();
    fireEvent.pointerDown(textarea);
    expect(document.activeElement).toBe(textarea);
  });

  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 无生成信息的图片只替换底图，不覆盖配置', async operation => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close })));
    const getType = vi.fn(async () => new Blob(['synthetic'], { type: 'image/png' }));
    mockClipboard(async () => [{ types: ['image/png'], getType }]);
    const props = panelProps(operation);
    render(React.createElement(ImageEditPanel, props));
    fireEvent.click(screen.getByRole('button', { name: '粘贴' }));
    await waitFor(() => expect(props.onBaseImageChange).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^data:image\/png;base64,/), 'clipboard'));
    expect(extractMetadata).toHaveBeenCalledTimes(1);
    expect(props.onPromptChange).not.toHaveBeenCalled();
    expect(props.onDraftChange).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 粘贴图片带入完整角色正负词与坐标，包括空全局文本', async operation => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    vi.mocked(extractMetadata).mockResolvedValueOnce(JSON.stringify({ prompt: '', uc: '',
      v4_prompt: { caption: { base_caption: '', char_captions: [{ char_caption: 'girl, blue hair', centers: [{ x: 0.3, y: 0.7 }] }] }, use_coords: true },
      v4_negative_prompt: { caption: { base_caption: '', char_captions: [{ char_caption: 'red hair' }] } },
    }));
    mockClipboard(async () => [{ types: ['image/png'], getType: async () => new Blob(['synthetic'], { type: 'image/png' }) }]);
    const props = panelProps(operation);
    render(React.createElement(ImageEditPanel, props));
    fireEvent.click(screen.getByRole('button', { name: '粘贴' }));
    await waitFor(() => expect(props.onBaseImageChange).toHaveBeenCalledWith(expect.any(String), 'clipboard', undefined, {
      prompt: '', negativePrompt: '', params: expect.objectContaining({ useCoords: true,
        characters: [expect.objectContaining({ prompt: 'girl, blue hair', negativePrompt: 'red hair', x: 0.3, y: 0.7 })] }),
    }));
  });

  it.each(['button', 'keyboard'])('%s 粘贴使用与图片匹配的工坊复制配置，不依赖已被清洗的元数据', async entry => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    const meta = { prompt: 'history scene', negativePrompt: '', params: { ...params, characters: [{ id: 'source-role', prompt: 'history role', x: 0.2, y: 0.8 }] } };
    vi.mocked(getCopiedImageData).mockResolvedValueOnce(meta);
    const file = new File(['synthetic'], 'copy.png', { type: 'image/png' });
    mockClipboard(async () => [{ types: ['image/png'], getType: async () => file }]);
    const props = panelProps('outpaint');
    const { container } = render(React.createElement(ImageEditPanel, props));
    if (entry === 'button') fireEvent.click(screen.getByRole('button', { name: '粘贴' }));
    else fireEvent.paste(container.querySelector('[data-image-edit-drop-zone]')!, { clipboardData: { files: [file], items: [] } });
    await waitFor(() => expect(props.onBaseImageChange).toHaveBeenCalledWith(expect.any(String), 'clipboard', undefined, meta));
    expect(extractMetadata).not.toHaveBeenCalled();
  });

  it('键盘粘贴接收图片，而提示词粘贴与普通文字不被劫持', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    const props = panelProps();
    const { container } = render(React.createElement(ImageEditPanel, props));
    const zone = container.querySelector('[data-image-edit-drop-zone]')!;
    const file = new File(['image'], 'test.png', { type: 'image/png' });
    const clipboardData = { files: [file], items: [] };
    fireEvent.paste(screen.getByLabelText('提示词'), { clipboardData });
    fireEvent.paste(zone, { clipboardData: { files: [], items: [{ kind: 'string', type: 'text/plain' }] } });
    expect(props.onBaseImageChange).not.toHaveBeenCalled();
    expect(fireEvent.paste(zone, { clipboardData })).toBe(false);
    await waitFor(() => expect(props.onBaseImageChange).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'clipboard'));
  });

  it('图片损坏或保存失败时显示原因，损坏图片不提交底图', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('图片解码失败'); }));
    mockClipboard(async () => [{ types: ['image/png'], getType: async () => new Blob(['broken'], { type: 'image/png' }) }]);
    const props = panelProps();
    render(React.createElement(ImageEditPanel, props));
    fireEvent.click(screen.getByRole('button', { name: '粘贴' }));
    await screen.findByText('图片解码失败');
    expect(props.onBaseImageChange).not.toHaveBeenCalled();
    expect(props.notify).toHaveBeenCalledWith('图片解码失败', 'error');
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    props.onBaseImageChange.mockRejectedValueOnce(new Error('本地保存失败'));
    fireEvent.click(screen.getByRole('button', { name: '粘贴' }));
    await screen.findByText('本地保存失败');
    expect((screen.getByRole('button', { name: '粘贴' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('读取期间只发起一次请求，切模式后旧读取不提交', async () => {
    let resolveRead!: (items: unknown[]) => void;
    const read = vi.fn(() => new Promise<unknown[]>(resolve => { resolveRead = resolve; }));
    mockClipboard(read);
    const props = panelProps();
    const view = render(React.createElement(ImageEditPanel, props));
    fireEvent.click(screen.getByRole('button', { name: '粘贴' }));
    fireEvent.click(screen.getByRole('button', { name: '粘贴' }));
    expect(read).toHaveBeenCalledTimes(1);
    const nextProps = { ...panelProps('outpaint'), onBaseImageChange: props.onBaseImageChange };
    view.rerender(React.createElement(ImageEditPanel, nextProps));
    await act(async () => { resolveRead([{ types: ['image/png'], getType: async () => new Blob(['image'], { type: 'image/png' }) }]); });
    await waitFor(() => expect((screen.getByRole('button', { name: '粘贴' }) as HTMLButtonElement).disabled).toBe(false));
    expect(props.onBaseImageChange).not.toHaveBeenCalled();
  });

  it('生成期间不接收粘贴图片', () => {
    const read = vi.fn(async () => []);
    mockClipboard(read);
    const props = panelProps();
    const { container } = render(React.createElement(ImageEditPanel, { ...props, isGenerating: true }));
    fireEvent.click(screen.getByRole('button', { name: '粘贴' }));
    fireEvent.paste(container.querySelector('[data-image-edit-drop-zone]')!, { clipboardData: { files: [new File(['image'], 'test.png', { type: 'image/png' })] } });
    expect(read).not.toHaveBeenCalled();
    expect(props.onBaseImageChange).not.toHaveBeenCalled();
  });

  it('文生图最新仍在保存时不能并发粘贴，避免两个底图互相覆盖', async () => {
    const read = vi.fn(async () => []);
    mockClipboard(read);
    let finish!: () => void;
    const props = panelProps();
    props.onBaseImageChange.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    render(React.createElement(ImageEditPanel, { ...props, latestTextToImageItem: {
      id: 'latest', imageUrl: 'data:image/png;base64,bGF0ZXN0', prompt: 'latest', negativePrompt: '', params, createdAt: 1,
    } }));
    fireEvent.click(screen.getByRole('button', { name: '文生图最新' }));
    fireEvent.click(screen.getByRole('button', { name: '粘贴' }));
    expect(read).not.toHaveBeenCalled();
    expect(props.onBaseImageChange).toHaveBeenCalledExactlyOnceWith('data:image/png;base64,bGF0ZXN0', 'generated', 'latest');
    await act(async () => { finish(); });
    expect((screen.getByRole('button', { name: '粘贴' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

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

  it('通过 onGenerateBarChange 上报移动端悬浮生成入口与费用标签', () => {
    const onGenerateBarChange = vi.fn();
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
      onGenerateBarChange,
    }));

    const lastCall = onGenerateBarChange.mock.calls.at(-1)?.[0];
    expect(lastCall).toBeDefined();
    expect(typeof lastCall.generate).toBe('function');
    expect(lastCall.costLabel).toBe('12 点');
    expect(lastCall.canGenerate).toBe(false);
  });
});
