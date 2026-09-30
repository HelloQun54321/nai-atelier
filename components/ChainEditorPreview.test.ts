// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorPreview } from './ChainEditorPreview';
import { ImageEditPreview } from './ImageEditPreview';
import { CloudQueueStatus } from './CloudQueueStatus';
import { emitCloudQueueStatus, reportCloudQueueCleanupError } from '../services/cloudQueue';
import { setCleanSharedImages } from '../services/imageSharing';

vi.mock('./SmartImage', () => ({
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
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 预览跟随开关，同时保留显式原图入口', operation => {
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
    expect(screen.getByRole('button', { name: '下载分享版' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下载原图（含生成信息）' })).toBeTruthy();
    act(() => setCleanSharedImages(false));
    expect(screen.queryByRole('button', { name: '下载分享版' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下载原图（含生成信息）' })).toBeNull();
    expect(screen.getByRole('button', { name: '下载' })).toBeTruthy();
  });
});

describe('生成后的操作恢复', () => {
  it('文生图完成的同一轮渲染即可再次点击，切到其他页面也不出现完成残留', () => {
    emitCloudQueueStatus({ taskId: 'task', phase: 'waiting' });
    const onGenerate = vi.fn();
    const view = renderPreview(onGenerate);
    expect(screen.queryByRole('button', { name: /生成图片/ })).toBeNull();
    act(() => emitCloudQueueStatus({ taskId: 'task', phase: 'completed' }));
    const button = screen.getByRole('button', { name: /生成图片/ }) as HTMLButtonElement;
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
    const button = screen.getByRole('button', { name: /生成图片/ }) as HTMLButtonElement;
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
    const button = screen.getByRole('button', { name: /生成.*结果/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.className).toContain('hidden lg:flex');
    fireEvent.click(button);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    view.rerender(React.createElement(ImageEditPreview, { ...props, canGenerate: false }));
    expect((screen.getByRole('button', { name: /生成.*结果/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
