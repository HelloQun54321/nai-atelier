import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Copy, Download, Heart, LoaderCircle } from 'lucide-react';
import { copySharedImage, downloadSharedImage, useCleanSharedImages } from '../services/imageSharing';
import type { ImageGenerationData } from '../services/imageClipboardContext';
import { collectionRevision, collectionTargetActive, ensureCollection, loadCollection, subscribeCollection, toggleCollectionTarget, type CollectionTarget } from '../services/collectionFavorites';

export const IMAGE_CARD_ACTION_CLASS = 'mobile-touch mobile-size-locked h-11 w-11 rounded-full border border-white/60 bg-black/45 text-white shadow backdrop-blur hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white dark:text-white/90 md:h-8 md:w-8';

interface Props {
  imageUrl: string;
  filename: string;
  notify?: (message: string, type?: 'success' | 'error') => void;
  variant?: 'overlay' | 'toolbar' | 'compact' | 'card';
  className?: string;
  generationData?: ImageGenerationData;
  favorite?: CollectionTarget;
  favoriteActive?: boolean;
  favoritePending?: boolean;
  onToggleFavorite?: () => Promise<void> | void;
  onFavoriteChange?: (active: boolean) => void;
  revealClassName?: string;
}

/** 收藏常驻，下载与复制仍按共用规则显露；所有页面共享收藏状态。 */
export const ImageShareActions: React.FC<Props> = ({ imageUrl, filename, notify, variant = 'toolbar', className = '', generationData, favorite, favoriteActive, favoritePending, onToggleFavorite, onFavoriteChange, revealClassName = 'hover-reveal-md' }) => {
  useLanguage();
  const clean = useCleanSharedImages();
  const busyRef = useRef(false);
  const favoriteBusyRef = useRef(false);
  const [busy, setBusy] = useState('');
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [error, setError] = useState('');
  useSyncExternalStore(subscribeCollection, collectionRevision, collectionRevision);
  useEffect(() => { void ensureCollection().catch(() => {}); }, []);
  const target: CollectionTarget = { imageUrl, title: filename.replace(/\.[^.]+$/, ''), ...generationData, ...favorite };
  const active = favoriteActive ?? collectionTargetActive(target);
  const toggleFavorite = async () => {
    if (favoriteBusyRef.current || favoritePending) return;
    favoriteBusyRef.current = true; setFavoriteBusy(true); setError('');
    try {
      if (onToggleFavorite) { await onToggleFavorite(); await loadCollection(); }
      else {
        const next = await toggleCollectionTarget(target);
        onFavoriteChange?.(next);
        notify?.(next ? (target.getGroup ? '已收藏整个作品组' : '已加入收藏库') : '已取消收藏', 'success');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '收藏失败';
      setError(message); notify?.(message, 'error');
    } finally { favoriteBusyRef.current = false; setFavoriteBusy(false); }
  };
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
    ? IMAGE_CARD_ACTION_CLASS
    : variant === 'overlay'
    ? 'rounded bg-black/70 px-3 py-1.5 text-xs font-medium leading-4 text-white hover:bg-black/85'
    : 'rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800';
  const actions = [
    { action: 'download' as const, label: '下载', title: '下载图片', Icon: Download },
    { action: 'copy' as const, label: '复制', title: '复制图片', Icon: Copy },
  ];
  return <div data-card-action="true" aria-busy={Boolean(busy) || favoriteBusy} className={`flex flex-wrap ${variant === 'overlay' ? 'items-stretch' : 'items-center'} gap-2 ${className}`} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
    <button type="button" data-image-favorite="true" aria-pressed={active}
      title={t(target.getGroup ? active ? '取消整组收藏' : '收藏整个作品组' : active ? '取消收藏' : '收藏')}
      aria-label={t(target.getGroup ? active ? '取消整组收藏' : '收藏整个作品组' : active ? '取消收藏' : '收藏')}
      aria-busy={Boolean(favoriteBusy || favoritePending)} disabled={favoriteBusy || favoritePending} onClick={() => void toggleFavorite()}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 transition disabled:cursor-wait disabled:opacity-50 ${buttonClass} ${active ? '!border-rose-400 !bg-rose-500 !text-white hover:!bg-rose-400' : ''} ${variant === 'compact' ? '!h-10 !w-10 !px-0' : ''}`}>
      {favoriteBusy || favoritePending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Heart className={`h-4 w-4 ${active ? 'fill-current' : ''}`} />}
      {!iconOnly && <span>{t('收藏')}</span>}
    </button>
    {actions.map(({ action, label, title, Icon }) => <button
      key={action} type="button" title={title} aria-label={title}
      disabled={Boolean(busy)} onClick={() => void perform(action)}
      className={`${variant === 'card' ? revealClassName : ''} ${variant === 'overlay' || variant === 'card' ? '' : 'mobile-touch min-h-10'} inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap transition disabled:cursor-wait disabled:opacity-50 ${buttonClass} ${variant === 'compact' ? '!h-10 !w-10 !px-0' : ''}`}
    >
      {busy === action ? <LoaderCircle className={`${variant === 'overlay' ? 'h-3.5 w-3.5' : 'h-4 w-4'} animate-spin`} /> : <Icon className={variant === 'overlay' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      {!iconOnly && <span>{t(label)}</span>}
    </button>)}
    {error && <span role="alert" className={variant === 'card' && notify ? 'sr-only' : `basis-full text-xs ${variant === 'overlay' || variant === 'card' ? 'max-w-64 rounded-lg bg-black/80 p-2 text-red-300' : 'text-red-600 dark:text-red-400'}`}>{t(error)}</span>}
  </div>;
};

/** 右上角依次为常驻收藏、下载、复制。 */
export const ImageShareOverlay: React.FC<Omit<Props, 'variant'>> = ({ className = '', ...props }) => (
  <ImageShareActions {...props} variant="card" className={`absolute right-2 top-2 z-20 flex-col ${className}`} />
);
