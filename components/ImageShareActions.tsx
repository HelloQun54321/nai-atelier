import React, { useRef, useState } from 'react';
import { Copy, Download, LoaderCircle } from 'lucide-react';
import { copySharedImage, downloadSharedImage, useCleanSharedImages } from '../services/imageSharing';
import type { ImageGenerationData } from '../services/imageClipboardContext';

interface Props {
  imageUrl: string;
  filename: string;
  notify?: (message: string, type?: 'success' | 'error') => void;
  variant?: 'overlay' | 'toolbar' | 'compact' | 'card';
  className?: string;
  generationData?: ImageGenerationData;
}

/** 各页面仅提供复制和下载，是否清洗统一由设置决定。 */
export const ImageShareActions: React.FC<Props> = ({ imageUrl, filename, notify, variant = 'toolbar', className = '', generationData }) => {
  const clean = useCleanSharedImages();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const perform = async (action: 'copy' | 'download') => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    setError('');
    try {
      if (action === 'copy') {
        if (generationData) await copySharedImage(imageUrl, clean, generationData);
        else await copySharedImage(imageUrl, clean);
        notify?.('已复制图片', 'success');
      } else {
        await downloadSharedImage(imageUrl, filename, clean);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '图片操作失败';
      setError(message);
      notify?.(message, 'error');
    } finally { busyRef.current = false; setBusy(''); }
  };
  const iconOnly = variant === 'compact' || variant === 'card';
  const buttonClass = variant === 'card'
    ? 'mobile-size-locked h-11 w-11 rounded-full border border-white/60 bg-black/45 text-white shadow backdrop-blur hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white dark:text-white/90 md:h-8 md:w-8'
    : variant === 'overlay'
    ? 'rounded bg-black/70 px-3 py-1.5 text-xs font-medium leading-4 text-white hover:bg-black/85'
    : 'rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800';
  const actions = [
    { action: 'copy' as const, label: '复制', title: '复制图片', Icon: Copy },
    { action: 'download' as const, label: '下载', title: '下载图片', Icon: Download },
  ];
  const orderedActions = variant === 'card' ? [...actions].reverse() : actions;
  return <div aria-busy={Boolean(busy)} className={`flex flex-wrap ${variant === 'overlay' ? 'items-stretch' : 'items-center'} gap-2 ${className} ${variant === 'card' && busy ? '!opacity-100 !pointer-events-auto' : ''}`} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    {orderedActions.map(({ action, label, title, Icon }) => <button
      key={action} type="button" title={title} aria-label={label}
      disabled={Boolean(busy)} onClick={() => void perform(action)}
      className={`${variant === 'overlay' || variant === 'card' ? '' : 'mobile-touch min-h-10'} inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap transition disabled:cursor-wait disabled:opacity-50 ${buttonClass} ${variant === 'compact' ? '!h-10 !w-10 !px-0' : ''}`}
    >
      {busy === action ? <LoaderCircle className={`${variant === 'overlay' ? 'h-3.5 w-3.5' : 'h-4 w-4'} animate-spin`} /> : <Icon className={variant === 'overlay' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      {!iconOnly && <span>{label}</span>}
    </button>)}
    {error && <span role="alert" className={variant === 'card' && notify ? 'sr-only' : `basis-full text-xs ${variant === 'overlay' || variant === 'card' ? 'max-w-64 rounded-lg bg-black/80 p-2 text-red-300' : 'text-red-600 dark:text-red-400'}`}>{error}</span>}
  </div>;
};
