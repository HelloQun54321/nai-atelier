import { longPress } from '../support/touchEvents';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorPreview } from '../../components/ChainEditorPreview';
import { ImageEditPreview } from '../../components/ImageEditPreview';
import { CloudQueueStatus } from '../../components/CloudQueueStatus';
import { emitCloudQueueStatus, reportCloudQueueCleanupError } from '../../services/cloudQueue';
import { setCleanSharedImages } from '../../services/imageSharing';

vi.mock('../../components/SmartImage', () => ({
  OriginalImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement('img', props),
}));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  emitCloudQueueStatus(null);
});
afterEach(() => {
  cleanup();
  emitCloudQueueStatus(null);
});

const renderPreview = (onGenerate: () => void, isGenerating = false) => render(React.createElement(ChainEditorPreview, {
  isGenerating, handleGenerate: onGenerate, errorMsg: null, generatedImage: null, previewImage: undefined,
  setLightboxImg: vi.fn(), isOwner: false, isUploading: false, handleSavePreview: vi.fn(),
  handleUploadCover: vi.fn(), getDownloadFilename: () => 'test.png', generationCostLabel: '免费',
}));

describe('四模式的分享入口', () => {
  it('历史前后翻图共用触屏长按显露规则，按钮点击不误开大图', () => {
    const previous = vi.fn(), next = vi.fn(), open = vi.fn();
    render(React.createElement(ChainEditorPreview, { isGenerating: false, handleGenerate: vi.fn(), errorMsg: null, generatedImage: '/synthetic.png', previewImage: undefined,
      setLightboxImg: open, isOwner: false, isUploading: false, handleSavePreview: vi.fn(), handleUploadCover: vi.fn(), getDownloadFilename: () => 'test.png', generationCostLabel: '免费',
      canNavigateHistory: true, onPreviousHistory: previous, onNextHistory: next }));
    const image = screen.getByRole('img'); longPress(image);
    expect(image.closest('.press-reveal-surface')?.getAttribute('data-press-revealed')).toBe('true');
    expect(open).not.toHaveBeenCalled();
    for (const label of ['上一张历史图', '下一张历史图']) {
      const button = screen.getByRole('button', { name: label }); expect(button.classList.contains('hover-reveal-lg')).toBe(true); fireEvent.click(button);
    }
    expect(previous).toHaveBeenCalledOnce(); expect(next).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled();
  });
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 空预览只说明当前状态，保留生成动作与费用', operation => {
    const generate = vi.fn();
    if (operation === 'text-to-image') renderPreview(generate);
    else render(React.createElement(ImageEditPreview, {
      operation, image: null, error: null, generationCostLabel: '免费', canGenerate: true,
      onGenerate: generate, onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png',
    }));
    expect(screen.getByText('暂无生成结果')).toBeTruthy();
    expect(screen.queryByText(/选择编辑模式|在左侧/)).toBeNull();
    const action = screen.getByRole('button', { name: /生成.*免费/ });
    fireEvent.click(action);
    expect(generate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /上一张|下一张/ })).toBeNull();
  });

  it('分享与删除使用紧凑尺寸，左右分组一致，点击不误开大图', () => {
    const onCover = vi.fn();
    const onOpen = vi.fn();
    render(React.createElement(ChainEditorPreview, {
      isGenerating: false, handleGenerate: vi.fn(), errorMsg: null, generatedImage: '/image.png',
      previewImage: undefined, setLightboxImg: onOpen, isOwner: true, isUploading: false,
      handleSavePreview: onCover, handleUploadCover: vi.fn(), getDownloadFilename: () => 'NAI.png', generationCostLabel: '免费', canManageHistoryGroup: true,
    }));
    const cover = screen.getByRole('button', { name: '设为封面' });
    expect(cover.classList.contains('justify-center')).toBe(true);
    expect(cover.classList.contains('py-1.5')).toBe(true);
    expect(cover.classList.contains('min-h-10')).toBe(false);
    expect(cover.parentElement?.classList.contains('flex-col')).toBe(true);
    expect(cover.parentElement?.classList.contains('right-4')).toBe(true);
    expect(cover.parentElement?.classList.contains('w-28')).toBe(false);
    const remove = screen.getByRole('button', { name: '删除' });
    expect(remove.closest('[data-card-action]')?.classList.contains('left-4')).toBe(true);
    expect(remove.classList.contains('py-1.5')).toBe(true);
    expect(remove.classList.contains('text-xs')).toBe(cover.classList.contains('text-xs'));
    const download = screen.getByRole('button', { name: '下载图片' });
    expect(download.classList.contains('justify-center')).toBe(true);
    expect(download.classList.contains('rounded-full')).toBe(true);
    expect(download.classList.contains('h-11')).toBe(true);
    expect(download.classList.contains('min-h-10')).toBe(false);
    expect(download.classList.contains('mobile-touch')).toBe(true);
    expect(download.parentElement?.classList.contains('flex-col')).toBe(true);
    expect(download.parentElement?.classList.contains('items-center')).toBe(true);
    fireEvent.click(cover);
    expect(onCover).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 预览随设置清洗，始终只有复制和下载', operation => {
    setCleanSharedImages(true);
    const image = '/api/local-history/share-test/image';
    if (operation === 'text-to-image') {
      render(React.createElement(ChainEditorPreview, {
        isGenerating: false, handleGenerate: vi.fn(), errorMsg: null, generatedImage: image,
        previewImage: undefined, setLightboxImg: vi.fn(), isOwner: false, isUploading: false,
        handleSavePreview: vi.fn(), handleUploadCover: vi.fn(), getDownloadFilename: () => 'NAI.png', generationCostLabel: '免费',
      }));
    } else {
      render(React.createElement(ImageEditPreview, {
        operation, image, error: null, generationCostLabel: '免费',
        onGenerate: vi.fn(), onOpenLightbox: vi.fn(), getDownloadFilename: () => 'NAI.png',
      }));
    }
    expect(screen.getByRole('button', { name: '复制图片' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下载图片' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /原图|分享版/ })).toBeNull();
    act(() => setCleanSharedImages(false));
    expect(screen.getByRole('button', { name: '复制图片' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /原图|分享版/ })).toBeNull();
    expect(screen.getByRole('button', { name: '下载图片' })).toBeTruthy();
  });
});

describe('生成后的操作恢复', () => {
  it('文生图完成的同一轮渲染即可再次点击，切到其他页面也不出现完成残留', () => {
    emitCloudQueueStatus({ taskId: 'task', phase: 'waiting' });
    const onGenerate = vi.fn();
    const view = renderPreview(onGenerate);
    expect(screen.queryByRole('button', { name: /^生成.*免费$/ })).toBeNull();
    act(() => emitCloudQueueStatus({ taskId: 'task', phase: 'completed' }));
    const button = screen.getByRole('button', { name: /^生成.*免费$/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByText('生成完成')).toBeNull();
    fireEvent.click(button);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    view.unmount();
    render(React.createElement(CloudQueueStatus));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(['error', 'cancelled', 'cleanup-error'] as const)('%s 提示与可点击生成按钮并存', phase => {
    emitCloudQueueStatus({ taskId: 'task', phase: 'waiting' });
    if (phase === 'cleanup-error') reportCloudQueueCleanupError('task', '');
    emitCloudQueueStatus({ taskId: 'task', phase: phase === 'cleanup-error' ? 'completed' : phase });
    const onGenerate = vi.fn();
    renderPreview(onGenerate);
    expect(screen.getByRole('status')).toBeTruthy();
    const button = screen.getByRole('button', { name: /^生成.*免费$/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('生成仍在处理中时继续禁用按钮，终态不绕过真实忙碌状态', () => {
    emitCloudQueueStatus({ taskId: 'task', phase: 'completed' });
    const onGenerate = vi.fn();
    renderPreview(onGenerate, true);
    const button = screen.getByRole('button', { name: /生成中/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 完成后可立即再次生成，底图限制仍然有效', operation => {
    emitCloudQueueStatus({ taskId: 'task', phase: 'completed' });
    const onGenerate = vi.fn();
    const props = {
      operation, image: null, error: null, generationCostLabel: '免费',
      onGenerate, onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png', canGenerate: true,
    };
    const view = render(React.createElement(ImageEditPreview, props));
    const button = screen.getByRole('button', { name: /^生成.*免费$/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.className).toContain('hidden lg:flex');
    fireEvent.click(button);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    view.rerender(React.createElement(ImageEditPreview, { ...props, canGenerate: false }));
    expect((screen.getByRole('button', { name: '请先选择底图' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('四模式共用生成状态', () => {
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 桌面排队可取消，开始生成后显示步数，完成即恢复', operation => {
    emitCloudQueueStatus({ taskId: 'shared', phase: 'waiting', position: 2, cancelable: true });
    const common = { isGenerating: true, generationProgress: { step: 8, total: 28 }, generationCostLabel: '消耗 Opus 额度' };
    const props = { ...common, handleGenerate: vi.fn(), errorMsg: null, generatedImage: null, previewImage: undefined, setLightboxImg: vi.fn(), isOwner: false, isUploading: false, handleSavePreview: vi.fn(), handleUploadCover: vi.fn(), getDownloadFilename: () => 'test.png' };
    const editProps = { ...common, operation: operation === 'text-to-image' ? 'image-to-image' as const : operation, image: null, error: null, canGenerate: true, onGenerate: vi.fn(), onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png' };
    const view = render(operation === 'text-to-image' ? React.createElement(ChainEditorPreview, props) : React.createElement(ImageEditPreview, editProps));
    expect(screen.getByRole('status').textContent).toContain('排队中 · 前方 2 个任务');
    expect(screen.getByRole('button', { name: '取消排队' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /生成中/ })).toBeNull();
    act(() => emitCloudQueueStatus({ taskId: 'shared', phase: 'generating', cancelable: false }));
    expect(screen.getByRole('status').textContent).toContain('生成中 8/28');
    expect(screen.queryByRole('button', { name: '取消排队' })).toBeNull();
    act(() => emitCloudQueueStatus({ taskId: 'shared', phase: 'completed' }));
    view.rerender(operation === 'text-to-image' ? React.createElement(ChainEditorPreview, { ...props, isGenerating: false }) : React.createElement(ImageEditPreview, { ...editProps, isGenerating: false }));
    expect((screen.getByRole('button', { name: /^生成.*消耗 Opus 额度$/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(['读取图片中…', '画布加载中…', '请先框选区域', '请先涂画重绘区域', '请先应用画布扩展', '应用画布扩展中…'])('编辑未就绪准确显示 %s，不混入费用', unavailableLabel => {
    const generate = vi.fn();
    render(React.createElement(ImageEditPreview, { operation: 'inpaint', image: null, error: null, generationCostLabel: '消耗 Opus 额度', canGenerate: false, unavailableLabel, onGenerate: generate, onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png' }));
    const button = screen.getByRole('button', { name: unavailableLabel }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.queryByText('消耗 Opus 额度')).toBeNull();
    fireEvent.click(button);
    expect(generate).not.toHaveBeenCalled();
  });
});
