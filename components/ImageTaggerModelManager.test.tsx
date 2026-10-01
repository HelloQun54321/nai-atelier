// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageTaggerModelManager } from './ImageTaggerModelManager';
import { imageTaggerService, ImageTaggerStatus } from '../services/imageTaggerService';
import { taggerProgressText } from './useImageTaggerStatus';

vi.mock('../services/imageTaggerService', () => ({ imageTaggerService: { getStatus: vi.fn(), selectModel: vi.fn(), downloadModel: vi.fn(), pauseDownload: vi.fn() } }));
let status: ImageTaggerStatus;
beforeEach(() => {
  status = { model: 'vit', downloaded: true, downloadingModel: null, busy: false, models: [
    { id: 'vit', label: 'WD ViT V3', description: '默认模型', downloaded: true, stage: 'ready', totalBytes: 379_000_000, receivedBytes: 379_000_000, threshold: 0.35, characterThreshold: 0.85, error: '' },
    { id: 'eva', label: 'WD EVA02-Large V3', description: '优先效果', downloaded: false, stage: 'missing', totalBytes: 1_260_000_000, receivedBytes: 0, threshold: 0.53, characterThreshold: 0.85, error: '' },
  ] };
  vi.mocked(imageTaggerService.getStatus).mockImplementation(async () => structuredClone(status));
  vi.mocked(imageTaggerService.selectModel).mockImplementation(async model => { status.model = model; });
  vi.mocked(imageTaggerService.downloadModel).mockResolvedValue();
  vi.mocked(imageTaggerService.pauseDownload).mockResolvedValue();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('下载不改变使用模型，用户单独选择后更新所有状态', async () => {
  const notify = vi.fn(); render(<ImageTaggerModelManager notify={notify} />);
  await screen.findByText('WD EVA02-Large V3');
  fireEvent.click(screen.getByRole('button', { name: '下载' }));
  await waitFor(() => expect(imageTaggerService.downloadModel).toHaveBeenCalledWith('eva'));
  expect(imageTaggerService.selectModel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^使用$/ }));
  await waitFor(() => expect(imageTaggerService.selectModel).toHaveBeenCalledWith('eva'));
  await waitFor(() => expect(screen.getByText('WD EVA02-Large V3').parentElement?.textContent).toContain('当前使用'));
});

it('下载显示真实进度，可暂停和继续，识别中禁用切换', async () => {
  status.downloadingModel = 'eva'; status.busy = true; status.models[1].stage = 'downloading'; status.models[1].receivedBytes = 630_000_000;
  render(<ImageTaggerModelManager notify={vi.fn()} />);
  expect(await screen.findByText(/正在下载 50%/)).toBeTruthy();
  expect((screen.getByRole('button', { name: /^使用$/ }) as HTMLButtonElement).disabled).toBe(true);
  const progress = screen.getByRole('progressbar', { name: 'WD EVA02-Large V3 下载进度' }) as HTMLProgressElement;
  expect(progress.value / progress.max).toBe(0.5);
  fireEvent.click(screen.getByRole('button', { name: '暂停' }));
  await waitFor(() => expect(imageTaggerService.pauseDownload).toHaveBeenCalledOnce());
});

it('失败原因一行展示并保留续传入口', async () => {
  status.models[1].stage = 'error'; status.models[1].receivedBytes = 10_000_000; status.models[1].error = 'HTTP 503，源站暂时不可用';
  render(<ImageTaggerModelManager notify={vi.fn()} />);
  expect(await screen.findByText('HTTP 503，源站暂时不可用')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '继续下载' }));
  await waitFor(() => expect(imageTaggerService.downloadModel).toHaveBeenCalledWith('eva'));
});

it('切换保存失败保持当前模型并显示原因', async () => {
  const notify = vi.fn(); vi.mocked(imageTaggerService.selectModel).mockRejectedValue(new Error('保存失败'));
  render(<ImageTaggerModelManager notify={notify} />);
  fireEvent.click(await screen.findByRole('button', { name: /^使用$/ }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('保存失败', 'error'));
  expect(status.model).toBe('vit');
});

it('校验阶段不误报为已完成，也不把模型加载当成下载', () => {
  expect(taggerProgressText({ ...status.models[1], stage: 'verifying' })).toContain('正在校验');
  expect(taggerProgressText(status.models[0])).toBe('已下载并校验');
});
