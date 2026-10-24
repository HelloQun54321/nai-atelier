import { longPress } from '../support/touchEvents';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorPreview } from '../../components/ChainEditorPreview';
import { ImageEditPreview } from '../../components/ImageEditPreview';
import { CloudQueueStatus } from '../../components/CloudQueueStatus';
import { emitCloudQueueStatus, getCloudQueuePreferences, reportCloudQueueCleanupError } from '../../services/cloudQueue';
import { setCleanSharedImages } from '../../services/imageSharing';

vi.mock('../../components/SmartImage', async original => ({
  ...await original<typeof import('../../components/SmartImage')>(),
  OriginalImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement('img', props),
}));

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  emitCloudQueueStatus(null);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: true, serviceUrl: 'https://synthetic.example', greeting: '正在生成中～', showGreeting: true }))));
  await getCloudQueuePreferences();
});
afterEach(() => {
  cleanup();
  emitCloudQueueStatus(null);
  vi.unstubAllGlobals();
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
    const empty = screen.getByText('暂无生成结果');
    expect(empty.tagName).toBe('P');
    const stage = empty.closest('.lab-preview-stage')!;
    expect(stage.classList.contains('appearance-group')).toBe(false);
    expect(stage.classList.contains('nai-alpha-checker')).toBe(false);
    expect(stage.classList.contains('lab-preview-image')).toBe(false);
    expect(stage.classList.contains('cursor-zoom-in')).toBe(false);
    expect(screen.queryByText(/选择编辑模式|在左侧/)).toBeNull();
    const action = screen.getByRole('button', { name: /生成.*免费/ });
    fireEvent.click(action);
    expect(generate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /上一张|下一张/ })).toBeNull();
  });
  it('透明底作品直接透出背景，不铺衬底也不画棋盘格', () => {
    const open = vi.fn();
    render(React.createElement(ChainEditorPreview, {
      isGenerating: false, handleGenerate: vi.fn(), errorMsg: null, generatedImage: '/synthetic.png', previewImage: undefined,
      setLightboxImg: open, isOwner: false, isUploading: false, handleSavePreview: vi.fn(), handleUploadCover: vi.fn(),
      getDownloadFilename: () => 'test.png', generationCostLabel: '免费',
    }));
    const image = screen.getByRole('img');
    const stage = image.closest('.lab-preview-stage')!;
    expect(stage.classList.contains('nai-alpha-checker')).toBe(false);
    expect(image.classList.contains('nai-alpha-checker')).toBe(false);
    expect(image.classList.contains('lab-preview-image')).toBe(false);
    expect(stage.classList.contains('appearance-group')).toBe(false);
    expect(image.getAttribute('src')).toBe('/synthetic.png');
    expect(image.getAttribute('style')).toBeNull();
    fireEvent.click(image);
    expect(open).toHaveBeenCalledWith('/synthetic.png');
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
    expect(cover.classList.contains('rounded-full')).toBe(true);
    expect(cover.classList.contains('!bg-indigo-600/90')).toBe(true);
    expect(cover.classList.contains('min-h-10')).toBe(false);
    expect(cover.parentElement?.classList.contains('image-preview-action-group')).toBe(true);
    expect(cover.parentElement?.classList.contains('right-4')).toBe(true);
    expect(cover.parentElement?.classList.contains('w-28')).toBe(false);
    const remove = screen.getByRole('button', { name: '移除当前图片' });
    expect(remove.closest('[data-card-action]')?.classList.contains('left-4')).toBe(true);
    expect(remove.classList.contains('rounded-full')).toBe(true);
    expect(remove.classList.contains('!bg-red-600/90')).toBe(true);
    expect(remove.classList.contains('h-11')).toBe(cover.classList.contains('h-11'));
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
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 预览随设置清洗，收藏常驻且复用下载与复制', operation => {
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
    expect((screen.getByRole('button', { name: /^生成.*免费$/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
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
    const button = screen.getByRole('button', { name: /^生成.*免费$/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Key 排队/ }));
    expect(screen.getByRole('status')).toBeTruthy();
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
    expect(button.parentElement?.className).toContain('hidden lg:flex');
    fireEvent.click(button);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    view.rerender(React.createElement(ImageEditPreview, { ...props, canGenerate: false }));
    expect(screen.getByRole('button', { name: '请先选择底图' }).getAttribute('aria-disabled') === 'true' || (screen.getByRole('button', { name: '请先选择底图' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('四模式共用生成状态', () => {
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 备用生成入口保留旧宽高并恢复生成特效，完成后可点击', operation => {
    const generate = vi.fn();
    const props = { isGenerating: true, handleGenerate: generate, errorMsg: null, generatedImage: null, previewImage: undefined, setLightboxImg: vi.fn(), isOwner: false, isUploading: false, handleSavePreview: vi.fn(), handleUploadCover: vi.fn(), getDownloadFilename: () => 'test.png', generationCostLabel: '免费' };
    const editProps = { operation: operation === 'text-to-image' ? 'image-to-image' as const : operation, image: null, error: null, isGenerating: true, canGenerate: true, onGenerate: generate, onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png', generationCostLabel: '免费' };
    const view = render(operation === 'text-to-image' ? React.createElement(ChainEditorPreview, props) : React.createElement(ImageEditPreview, editProps));
    const button = screen.getByRole('button', { name: '生成中…' }) as HTMLButtonElement;
    expect(button.classList.contains('generation-action-button--loading')).toBe(true);
    expect(button.classList.contains('min-h-11')).toBe(true);
    expect(button.classList.contains('w-full')).toBe(true);
    expect(button.classList.contains('max-w-xs')).toBe(true);
    expect(button.disabled).toBe(true);
    fireEvent.click(button); expect(generate).not.toHaveBeenCalled();
    view.rerender(operation === 'text-to-image' ? React.createElement(ChainEditorPreview, { ...props, isGenerating: false }) : React.createElement(ImageEditPreview, { ...editProps, isGenerating: false }));
    expect(button.classList.contains('generation-action-button--loading')).toBe(false);
    fireEvent.click(button); expect(generate).toHaveBeenCalledOnce();
  });

  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 桌面排队可取消，开始生成后显示步数，完成即恢复', operation => {
    emitCloudQueueStatus({ taskId: 'shared', phase: 'waiting', position: 2, cancelable: true });
    const common = { isGenerating: true, generationProgress: { step: 8, total: 28 }, generationCostLabel: '消耗 Opus 额度' };
    const props = { ...common, handleGenerate: vi.fn(), errorMsg: null, generatedImage: null, previewImage: undefined, setLightboxImg: vi.fn(), isOwner: false, isUploading: false, handleSavePreview: vi.fn(), handleUploadCover: vi.fn(), getDownloadFilename: () => 'test.png' };
    const editProps = { ...common, operation: operation === 'text-to-image' ? 'image-to-image' as const : operation, image: null, error: null, canGenerate: true, onGenerate: vi.fn(), onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png' };
    const view = render(operation === 'text-to-image' ? React.createElement(ChainEditorPreview, props) : React.createElement(ImageEditPreview, editProps));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Key 排队 2/?' }));
    expect(screen.getByRole('status').textContent).toContain('排队中 · 前方 2 个任务');
    expect(screen.getByRole('button', { name: '取消排队' })).toBeTruthy();
    expect((view.container.querySelector('.generation-action-button') as HTMLButtonElement).disabled).toBe(true);
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

vi.mock('../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../services/collectionFavorites')>(),
  ensureCollection: vi.fn(async () => {}), loadCollection: vi.fn(async () => []),
  subscribeCollection: () => () => {}, collectionRevision: () => 0, collectionTargetActive: () => false,
  toggleCollectionTarget: vi.fn(async () => true), syncHistoryCollectionFavorites: vi.fn(async () => {}),
}));

it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 忙碌时主按钮直接加入队列，空闲恢复生成，画布未就绪不允许入队', operation => {
  const generate = vi.fn(), queue = vi.fn();
  const control = { count: 1, onCountChange: vi.fn(), series: null, onStop: vi.fn(), onQueue: queue, queueDisabled: false };
  const element = (busy: boolean, ready: boolean, cloud: boolean) => {
    const common = { isGenerating: cloud, generationDisabled: busy || !ready, generationCountControl: { ...control, queueDisabled: !ready, queueState: { busy, completed: 0, total: busy ? 1 : 0, paused: false, pausing: false, waiting: [] } }, generationCostLabel: '免费', unavailableLabel: !ready ? '请先选择底图' : busy ? '此 Key 正在生成' : undefined };
    return operation === 'text-to-image'
      ? React.createElement(ChainEditorPreview, { ...common, handleGenerate: generate, errorMsg: null, generatedImage: null, previewImage: undefined,
        setLightboxImg: vi.fn(), isOwner: false, isUploading: false, handleSavePreview: vi.fn(), handleUploadCover: vi.fn(), getDownloadFilename: () => 'test.png' })
      : React.createElement(ImageEditPreview, { ...common, operation, image: null, error: null, onGenerate: generate, onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png' });
  };
  const view = render(element(true, true, false));
  const button = screen.getByRole('button', { name: /加入队列/ }) as HTMLButtonElement;
  expect(button.disabled).toBe(false); fireEvent.click(button);
  expect(queue).toHaveBeenCalledWith('end'); expect(generate).not.toHaveBeenCalled();
  emitCloudQueueStatus({ taskId: 'synthetic-primary-queue', phase: 'waiting' });
  view.rerender(element(true, true, true));
  expect((screen.getByRole('button', { name: /加入队列/ }) as HTMLButtonElement).disabled).toBe(false);
  emitCloudQueueStatus({ taskId: 'synthetic-primary-queue', phase: 'completed' });
  view.rerender(element(false, true, false));
  fireEvent.click(screen.getByRole('button', { name: /生成.*免费/ })); expect(generate).toHaveBeenCalledOnce();
  view.rerender(element(true, false, false));
  expect(screen.queryByRole('button', { name: '加入队列' })).toBeNull();
  expect(screen.getByRole('button', { name: '请先选择底图' }).getAttribute('aria-disabled')).toBe('true');
});

it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 关闭连续生成后忙碌不能入队，未就绪说明仍优先，空闲只生成单张', operation => {
  const generate = vi.fn(), queue = vi.fn();
  const element = (busy: boolean, ready: boolean) => {
    const common = { isGenerating: busy, generationDisabled: busy || !ready, generationCountControl: {
      continuousGenerationEnabled: false, count: 1, onCountChange: vi.fn(), series: null, onStop: vi.fn(), onQueue: queue, queueDisabled: !ready,
    }, generationCostLabel: '免费', unavailableLabel: !ready ? '请先选择底图' : busy ? '此 Key 正在生成' : undefined };
    return operation === 'text-to-image'
      ? React.createElement(ChainEditorPreview, { ...common, handleGenerate: generate, errorMsg: null, generatedImage: null, previewImage: undefined,
        setLightboxImg: vi.fn(), isOwner: false, isUploading: false, handleSavePreview: vi.fn(), handleUploadCover: vi.fn(), getDownloadFilename: () => 'test.png' })
      : React.createElement(ImageEditPreview, { ...common, operation, image: null, error: null, onGenerate: generate, onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png' });
  };
  const view = render(element(true, true));
  fireEvent.click(screen.getByRole('button', { name: '此 Key 正在生成' }));
  expect(queue).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /加入队列/ })).toBeNull();
  view.rerender(element(false, false));
  fireEvent.click(screen.getByRole('button', { name: '请先选择底图' }));
  expect(generate).not.toHaveBeenCalled();
  view.rerender(element(false, true));
  fireEvent.click(screen.getByRole('button', { name: /生成.*免费/ }));
  expect(generate).toHaveBeenCalledOnce();
  expect(queue).not.toHaveBeenCalled();
});

it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 没有任务时不把暂不可提交误判为加入队列', operation => {
  const generate = vi.fn(), queue = vi.fn();
  const common = { isGenerating: false, generationDisabled: true, generationCountControl: {
    count: 1, onCountChange: vi.fn(), series: null, onStop: vi.fn(), onQueue: queue, queueDisabled: false,
    queueState: { busy: false, completed: 2, total: 2, paused: false, pausing: false, waiting: [] },
  }, generationCostLabel: '免费' };
  render(operation === 'text-to-image'
    ? React.createElement(ChainEditorPreview, { ...common, handleGenerate: generate, errorMsg: null, generatedImage: null, previewImage: undefined,
      setLightboxImg: vi.fn(), isOwner: false, isUploading: false, handleSavePreview: vi.fn(), handleUploadCover: vi.fn(), getDownloadFilename: () => 'test.png' })
    : React.createElement(ImageEditPreview, { ...common, operation, image: null, error: null, onGenerate: generate, onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png', unavailableLabel: '画布加载中…' }));
  expect(screen.queryByRole('button', { name: /^加入队列/ })).toBeNull();
  const button = screen.getByRole('button', { name: operation === 'text-to-image' ? /生成.*免费/ : '画布加载中…' });
  fireEvent.click(button);
  expect(queue).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});


it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 连续生成在云排队期间仍能停止后续，停止中禁止重复操作', operation => {
  emitCloudQueueStatus({ taskId: 'synthetic-series', phase: 'waiting' });
  const stop = vi.fn();
  const control = { count: 3, onCountChange: vi.fn(), series: { current: 1, total: 3, stopping: false }, onStop: stop };
  const common = { isGenerating: true, generationCountControl: control, generationCostLabel: '免费' };
  const element = (stopping: boolean) => operation === 'text-to-image'
    ? React.createElement(ChainEditorPreview, { ...common, generationCountControl: { ...control, series: { ...control.series, stopping } }, handleGenerate: vi.fn(), errorMsg: null, generatedImage: null, previewImage: undefined,
      setLightboxImg: vi.fn(), isOwner: false, isUploading: false, handleSavePreview: vi.fn(), handleUploadCover: vi.fn(), getDownloadFilename: () => 'test.png' })
    : React.createElement(ImageEditPreview, { ...common, operation, image: null, error: null, generationCountControl: { ...control, series: { ...control.series, stopping } }, onGenerate: vi.fn(), onOpenLightbox: vi.fn(), getDownloadFilename: () => 'test.png' });
  const view = render(element(false));
  const button = screen.getByRole('button', { name: '暂停生成' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false); fireEvent.click(button); expect(stop).toHaveBeenCalledOnce();
  view.rerender(element(true));
  expect((screen.getByRole('button', { name: '暂停生成' }) as HTMLButtonElement).disabled).toBe(true);
});

it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 保存期间保留完整成图，用保存状态替换末步采样', operation => {
  const generate = vi.fn();
  const control = { count: 1, onCountChange: vi.fn(), series: { current: 1, total: 1, stopping: false }, onStop: vi.fn(), continuousGenerationEnabled: false, generationState: 'saving' as const };
  const common = { isGenerating: true, generationProgress: { step: 28, total: 28 }, generationCountControl: control, generationCostLabel: '免费', getDownloadFilename: () => 'synthetic.png' };
  if (operation === 'text-to-image') render(React.createElement(ChainEditorPreview, {
    ...common, handleGenerate: generate, errorMsg: null, generatedImage: '/synthetic-final.png', previewImage: undefined,
    setLightboxImg: vi.fn(), isOwner: false, isUploading: false, handleSavePreview: vi.fn(), handleUploadCover: vi.fn(),
  }));
  else render(React.createElement(ImageEditPreview, { ...common, operation, image: '/synthetic-final.png', error: null, canGenerate: true, onGenerate: generate, onOpenLightbox: vi.fn() }));
  expect(screen.getByRole('img').getAttribute('src')).toBe('/synthetic-final.png');
  expect(screen.getByRole('status').textContent).toBe('正在保存…');
  expect(screen.queryByText('采样 28 / 28')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '正在保存…' }));
  expect(generate).not.toHaveBeenCalled();
});
