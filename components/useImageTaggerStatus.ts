import { useEffect, useState } from 'react';
import { imageTaggerService, ImageTaggerStatus } from '../services/imageTaggerService';

export const IMAGE_TAGGER_CHANGED = 'nai-image-tagger-model-changed';
export const formatTaggerBytes = (bytes: number) => bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(2)} GB` : `${Math.round(bytes / 1_000_000)} MB`;
export const taggerProgressText = (model: ImageTaggerStatus['models'][number]) => {
  const amount = `${formatTaggerBytes(model.receivedBytes)} / ${formatTaggerBytes(model.totalBytes)}`;
  if (model.stage === 'verifying') return '下载完成，正在校验文件…';
  if (model.stage === 'downloading') return `正在下载 ${Math.min(99, Math.floor(model.receivedBytes / model.totalBytes * 100))}% · ${amount}`;
  if (model.stage === 'error') return model.error || '下载失败，点击继续下载';
  if (model.stage === 'paused') return `已暂停 · ${amount}`;
  return model.downloaded ? '已下载并校验' : '尚未下载';
};

export function useImageTaggerStatus(active: boolean) {
  const [status, setStatus] = useState<ImageTaggerStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!active) return;
    let disposed = false, running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try { const next = await imageTaggerService.getStatus(); if (!disposed) { setStatus(next); setError(''); } }
      catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : '无法读取反推模型状态'); }
      finally { running = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    window.addEventListener(IMAGE_TAGGER_CHANGED, refresh);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener(IMAGE_TAGGER_CHANGED, refresh); };
  }, [active]);
  return { status, error };
}
