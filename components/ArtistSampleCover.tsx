import React, { useContext, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, ImageIcon, ImagePlus, RefreshCw } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { buildArtistSampleImageUrl, getArtistSampleLookup, type ArtistOwnSample, type ArtistSampleLookup, type ArtistSamplePack } from '../services/artistSamples';
import { ImageActivityContext, SmartImage } from './SmartImage';
import type { ArtistSampleGeneration } from '../services/artistSampleGeneration';
import { IMAGE_CARD_ACTION_CLASS, ImageShareActions } from './ImageShareActions';
import { ImageCardActions } from './ImageCardActions';

export const ArtistSampleCover: React.FC<{
  generation?: ArtistSampleGeneration;
  pending?: boolean;
  onGenerate?: () => void;
  tag: string;
  pack: ArtistSamplePack;
  revision: string;
  hasPackSample: boolean;
  ownSamples: ArtistOwnSample[];
  alt: string;
  imageClassName?: string;
  onPackChange: (pack: ArtistSamplePack) => void;
  sampleStatusText?: string;
  onSupplement: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
  onFavoriteChange?: (active: boolean) => void;
  onImageLoad?: (width: number, height: number) => void;
}> = ({ generation, pending = false, onGenerate, tag, pack, revision, hasPackSample, ownSamples, alt, imageClassName, onPackChange, sampleStatusText, onSupplement, notify, onFavoriteChange, onImageLoad }) => {
  useLanguage();
  const active = useContext(ImageActivityContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [lookupResult, setLookupResult] = useState<{ identity: string; data: ArtistSampleLookup }>();
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState(false);
  const [index, setIndex] = useState(0);
  const [retry, setRetry] = useState(0);
  const identity = JSON.stringify([pack, tag, revision, ownSamples.map(sample => sample.id)]);
  const lookup = lookupResult?.identity === identity ? lookupResult.data : undefined;
  useEffect(() => {
    setLookupResult(undefined); setError(''); setImageError(false); setIndex(0);
  }, [identity]);
  useEffect(() => {
    if (!active) { setVisible(false); return; }
    const node = rootRef.current;
    if (!node || !('IntersectionObserver' in window)) { setVisible(true); return; }
    let root = node.parentElement;
    while (root && !/auto|scroll|overlay/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    const observer = new IntersectionObserver(entries => setVisible(Boolean(entries[entries.length - 1]?.isIntersecting)), { root });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, identity]);
  useEffect(() => {
    if (!active || !visible || !hasPackSample || lookup) return;
    const controller = new AbortController();
    setError('');
    void getArtistSampleLookup(pack, tag, controller.signal).then(result => {
      if (!controller.signal.aborted) setLookupResult({ identity, data: result });
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('样张读取失败')); });
    return () => controller.abort();
  }, [active, visible, hasPackSample, identity, retry, lookup]);
  const own = ownSamples[index];
  const packIndex = index - ownSamples.length;
  const imageUrl = own?.imageUrl || (lookup && packIndex >= 0 && packIndex < lookup.imageCount ? buildArtistSampleImageUrl(pack, tag, packIndex, lookup.revision) : '');
  const preview = generation?.session?.preview?.image || (generation?.phase === 'save_failed' || generation?.phase === 'saving' ? generation.item?.imageUrl : generation?.phase === 'failed' ? generation.preview : undefined);
  const total = ownSamples.length + (lookup?.imageCount || 0);
  const sampleRevision = own?.id || lookup?.revision || revision;
  const favorite = { imageUrl, title: alt || tag, sourceType: 'artist' as const, sourceId: tag,
    imageId: JSON.stringify([pack, sampleRevision, tag, own ? 0 : packIndex]), sourceUrl: own ? undefined : lookup?.sourceUrl,
    prompt: own?.prompt, negativePrompt: own?.negativePrompt, params: own?.params,
    analysis: { artistSample: { pack, tag, revision: sampleRevision, index: own ? 0 : packIndex, ...(own ? { ownSampleId: own.id, model: own.params.model } : {}) } },
  };
  const filename = `artist-${pack}-${tag}-${own?.id || packIndex}.png`;
  const move = (direction: number) => { setIndex(current => Math.max(0, Math.min(total - 1, current + direction))); setImageError(false); };
  const stopCardAction = (event: React.SyntheticEvent) => event.stopPropagation();
  const nextPack = pack === 'v45' ? 'v5' : 'v45';
  const switchLabel = t('样张版本 {0}，切换为 {1}', [pack === 'v45' ? 'V4.5' : 'V5', nextPack === 'v45' ? 'V4.5' : 'V5']);
  const missing = (!hasPackSample || lookup?.imageCount === 0) && ownSamples.length === 0;
  return <div ref={rootRef} className="absolute inset-0">
    <div data-card-action="true" data-image-action-left className="absolute left-2 top-2 z-20 flex flex-col items-start gap-1" onClick={stopCardAction} onPointerDown={stopCardAction} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
      <button type="button" aria-label={switchLabel} title={switchLabel} onClick={() => onPackChange(nextPack)} className="mobile-touch mobile-size-locked inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-white/50 bg-black/55 px-2 text-white backdrop-blur hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:h-8 [@media(any-pointer:coarse)]:min-h-11"><span className="text-meta font-bold leading-none">{pack === 'v45' ? 'V4.5' : 'V5'}</span><ArrowLeftRight className="h-2.5 w-2.5" /></button>
    </div>
    {imageUrl && !imageError ? <>
      <SmartImage key={`${imageUrl}:${retry}`} src={imageUrl} alt={alt} eager={visible} className={imageClassName} previewTransform={!own && imageUrl.startsWith('/api/artist-samples/image?') ? 'artist-sample-padding-v1' : undefined} onError={() => setImageError(true)} onLoad={event => { if (event.currentTarget.naturalWidth && event.currentTarget.naturalHeight) onImageLoad?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight); }} />
      {!preview && <ImageCardActions><ImageShareActions variant="card" imageUrl={imageUrl} filename={filename} favorite={favorite} notify={notify} onFavoriteChange={onFavoriteChange} />
        {onGenerate && generation?.phase !== 'save_failed' && <button type="button" data-card-action="true" data-agent-action="business" title={t(own ? '重新生成样张' : '生成样张')} aria-label={t(own ? '重新生成样张' : '生成样张')} disabled={pending} onClick={event => { event.stopPropagation(); onGenerate(); }} onPointerDown={stopCardAction} onKeyDown={stopCardAction} className={`${IMAGE_CARD_ACTION_CLASS} hover-reveal-md inline-flex shrink-0 items-center justify-center disabled:opacity-40`}><RefreshCw className="h-4 w-4" /></button>}
      </ImageCardActions>}
      {own && <span className="pointer-events-none absolute bottom-14 left-2 rounded-full bg-black/60 px-2 py-1 text-mini font-bold text-white backdrop-blur">{t('自建样张')}</span>}
      {total > 1 && <>
        <button data-card-action="true" type="button" aria-label={t('上一张')} disabled={index === 0} onClick={event => { event.stopPropagation(); move(-1); }} className="gallery-cover-navigation hover-reveal-touch mobile-touch absolute bottom-2 left-2 rounded-full bg-black/65 p-2 text-white backdrop-blur disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button>
        <button data-card-action="true" type="button" aria-label={t('下一张')} disabled={index >= total - 1} onClick={event => { event.stopPropagation(); move(1); }} className="gallery-cover-navigation hover-reveal-touch mobile-touch absolute bottom-2 right-2 rounded-full bg-black/65 p-2 text-white backdrop-blur disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button>
      </>}
    </> : <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-gray-100 to-gray-200/60 px-3 pb-3 pt-14 text-center dark:from-gray-900 dark:to-gray-950 md:pt-12">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/70 text-gray-400 ring-1 ring-gray-200/80 dark:bg-gray-800/60 dark:text-gray-500 dark:ring-gray-700/60">{missing ? <ImagePlus className="h-4 w-4" strokeWidth={1.5} /> : <ImageIcon className="h-4 w-4" strokeWidth={1.5} />}</span>
      <span className="max-h-[4.5em] max-w-full overflow-y-auto break-words text-xs leading-normal text-gray-500 dark:text-gray-400">{imageError ? t('样张图片加载失败') : error || sampleStatusText || (missing ? t('{0} 暂无样张', [pack === 'v45' ? 'V4.5' : 'V5']) : t('正在读取样张…'))}</span>
      {(error || imageError) && <button type="button" data-card-action="true" onClick={event => { event.stopPropagation(); setLookupResult(undefined); setImageError(false); setRetry(current => current + 1); }} className="mobile-touch rounded-lg border border-gray-300 px-2 py-1 text-xs dark:border-gray-700">{t('重试')}</button>}
      {missing && !pending && !preview && generation?.phase !== 'save_failed' && <button type="button" data-agent-action="business" data-card-action="true" onClick={event => { event.stopPropagation(); onSupplement(); }} className="appearance-group mobile-touch inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white/80 px-3 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:border-indigo-400 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-300 dark:hover:border-indigo-500 dark:hover:text-indigo-300">{t('补充样张')}</button>}
    </div>}
    {preview && <img src={preview} alt={t('样张生成预览')} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />}
  </div>;
};
