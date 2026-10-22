import React, { useContext, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon, ImagePlus, RefreshCw } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { buildArtistSampleImageUrl, getArtistSampleLookup, type ArtistOwnSample, type ArtistSampleLookup, type ArtistSamplePack } from '../services/artistSamples';
import { ImageActivityContext, SmartImage } from './SmartImage';
import type { ArtistSampleGeneration } from '../services/artistSampleGeneration';
import { ImageShareActions } from './ImageShareActions';
import { ArtistPreferenceActions } from './ArtistPreferenceActions';
import { toggleArtistPreference } from '../services/collectionFavorites';
import { AnchoredToolbarPopover } from './ToolbarPopover';

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
  preferred: boolean;
  blocked: boolean;
  blockPending?: boolean;
  onBlock: () => Promise<void>;
  toolsAnchor?: React.RefObject<HTMLElement | null>;
  onCloseTools: () => void;
  onImageLoad?: (width: number, height: number) => void;
}> = ({ generation, pending = false, onGenerate, tag, pack, revision, hasPackSample, ownSamples, alt, imageClassName, onPackChange, sampleStatusText, onSupplement, notify, preferred, blocked, blockPending, onBlock, toolsAnchor, onCloseTools, onImageLoad }) => {
  useLanguage();
  const active = useContext(ImageActivityContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [lookupResult, setLookupResult] = useState<{ identity: string; data: ArtistSampleLookup }>();
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState(false);
  const [index, setIndex] = useState(0);
  const [retry, setRetry] = useState(0);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const preferenceLock = useRef(false);
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
  const missing = (!hasPackSample || lookup?.imageCount === 0) && ownSamples.length === 0;
  const performPreference = async (action: () => Promise<unknown>) => {
    if (preferenceLock.current) return;
    preferenceLock.current = true; setPreferenceBusy(true);
    try { await action(); }
    catch (cause) { notify((cause as Error).message, 'error'); }
    finally { preferenceLock.current = false; setPreferenceBusy(false); }
  };
  return <div ref={rootRef} className="absolute inset-0">
    <ArtistPreferenceActions tag={tag} pack={pack} onPackChange={onPackChange} blocked={blocked} preferred={preferred} disabled={preferenceBusy || blockPending} onBlock={() => void performPreference(onBlock)} onFavorite={() => void performPreference(() => toggleArtistPreference(tag, imageUrl, imageUrl ? favorite : undefined))} />
    {imageUrl && !imageError ? <>
      <SmartImage key={`${imageUrl}:${retry}`} src={imageUrl} alt={alt} eager={visible} className={imageClassName} previewTransform={!own && imageUrl.startsWith('/api/artist-samples/image?') ? 'artist-sample-padding-v1' : undefined} onError={() => setImageError(true)} onLoad={event => { if (event.currentTarget.naturalWidth && event.currentTarget.naturalHeight) onImageLoad?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight); }} />
    </> : <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-gray-100 to-gray-200/60 px-3 pb-3 pt-14 text-center dark:from-gray-900 dark:to-gray-950 md:pt-12">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/70 text-gray-400 ring-1 ring-gray-200/80 dark:bg-gray-800/60 dark:text-gray-500 dark:ring-gray-700/60">{missing ? <ImagePlus className="h-4 w-4" strokeWidth={1.5} /> : <ImageIcon className="h-4 w-4" strokeWidth={1.5} />}</span>
      <span className="max-h-[4.5em] max-w-full overflow-y-auto break-words text-xs leading-normal text-gray-500 dark:text-gray-400">{imageError ? t('样张图片加载失败') : error || sampleStatusText || (missing ? t('{0} 暂无样张', [pack === 'v45' ? 'V4.5' : 'V5']) : t('正在读取样张…'))}</span>
      {(error || imageError) && <button type="button" data-card-action="true" onClick={event => { event.stopPropagation(); setLookupResult(undefined); setImageError(false); setRetry(current => current + 1); }} className="mobile-touch rounded-lg border border-gray-300 px-2 py-1 text-xs dark:border-gray-700">{t('重试')}</button>}
    </div>}
    {preview && <img src={preview} alt={t('样张生成预览')} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />}
    {toolsAnchor && <div onClick={stopCardAction} onPointerDown={stopCardAction} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
      <AnchoredToolbarPopover anchorRef={toolsAnchor} title={t('样张操作')} width={300} allowMobile onClose={onCloseTools}>
        <div className="space-y-3">
          <p className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100" title={tag}>{tag}</p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-gray-500">{pack === 'v45' ? 'V4.5' : 'V5'}</span>
            {total > 1 && <div className="flex items-center gap-1 text-xs text-gray-500">
              <button type="button" aria-label={t('上一张')} disabled={index === 0} onClick={() => move(-1)} className="mobile-touch rounded-lg p-2 disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button>
              <span className="tabular-nums">{index + 1} / {total}</span>
              <button type="button" aria-label={t('下一张')} disabled={index >= total - 1} onClick={() => move(1)} className="mobile-touch rounded-lg p-2 disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button>
            </div>}
          </div>
          {own && <p className="text-xs text-gray-500">{t('自建样张')}</p>}
          {imageUrl && !imageError && !preview && <ImageShareActions imageUrl={imageUrl} filename={filename} favorite={favorite} notify={notify} showFavorite={false} className="[&>button]:flex-1" />}
          {!preview && generation?.phase !== 'save_failed' && (missing || imageUrl && onGenerate) && <button type="button" data-agent-action="business" disabled={pending} onClick={missing ? onSupplement : onGenerate} className="mobile-touch flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"><RefreshCw className="h-4 w-4" />{t(missing ? '补充样张' : own ? '重新生成样张' : '生成样张')}</button>}
        </div>
      </AnchoredToolbarPopover>
    </div>}
  </div>;
};
