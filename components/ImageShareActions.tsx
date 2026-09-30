import React, { useRef, useState } from 'react';
import { Copy, Download, FileDown, LoaderCircle } from 'lucide-react';
import { copySharedImage, downloadSharedImage, useCleanSharedImages } from '../services/imageSharing';

interface Props {
  imageUrl: string;
  filename: string;
  notify?: (message: string, type?: 'success' | 'error') => void;
  variant?: 'overlay' | 'toolbar' | 'compact';
  downloadLabel?: string;
  className?: string;
}

/** 各页面共用的图片分享入口，原图例外由显式按钮触发。 */
export const ImageShareActions: React.FC<Props> = ({ imageUrl, filename, notify, variant = 'toolbar', downloadLabel = '下载原图', className = '' }) => {
  const clean = useCleanSharedImages();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const perform = async (action: 'copy' | 'download' | 'original') => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    setError('');
    try {
      if (action === 'copy') {
        await copySharedImage(imageUrl, clean);
        notify?.(clean ? '已复制分享版图片' : '已复制图片', 'success');
      } else {
        await downloadSharedImage(imageUrl, filename, action === 'original' ? false : clean);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '图片操作失败';
      setError(message);
      notify?.(message, 'error');
    } finally { busyRef.current = false; setBusy(''); }
  };
  const buttonClass = variant === 'overlay'
    ? 'rounded-lg bg-black/70 px-3 py-2 text-xs font-bold text-white hover:bg-black/85'
    : 'rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800';
  const actions = [
    { action: 'copy' as const, label: '复制图片', title: clean ? '复制图片（移除生成信息的分享副本）' : '复制图片', Icon: Copy },
    { action: 'download' as const, label: clean ? '下载分享版' : downloadLabel, title: clean ? '下载分享版（移除生成信息）' : downloadLabel, Icon: Download },
    ...(clean ? [{ action: 'original' as const, label: '原图', title: '下载原图（含生成信息）', Icon: FileDown }] : []),
  ];
  return <div className={`flex flex-wrap items-center gap-2 ${className}`} onClick={event => event.stopPropagation()}>
    {actions.map(({ action, label, title, Icon }) => <button
      key={action} type="button" title={title} aria-label={action === 'original' ? title : label}
      disabled={Boolean(busy)} onClick={() => void perform(action)}
      className={`mobile-touch inline-flex shrink-0 items-center justify-center gap-1.5 transition disabled:cursor-wait disabled:opacity-50 ${buttonClass} ${variant === 'compact' ? '!h-10 !w-10 !px-0' : ''}`}
    >
      {busy === action ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {variant !== 'compact' && <span>{label}</span>}
    </button>)}
    {error && <span role="alert" className={`basis-full text-xs ${variant === 'overlay' ? 'max-w-64 rounded-lg bg-black/80 p-2 text-red-300' : 'text-red-600 dark:text-red-400'}`}>{error}</span>}
  </div>;
};
