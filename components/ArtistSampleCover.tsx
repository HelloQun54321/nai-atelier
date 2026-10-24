import React, { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon, ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { buildArtistSampleImageUrl, getArtistSampleLookup, getAvailableArtistSampleIndices, isArtistOwnSampleRemoved, isArtistOwnSampleForPack, isArtistSampleSourceForPack, type ArtistOwnSample, type ArtistSampleLookup, type ArtistSamplePack, type ArtistSampleRemoval } from '../services/artistSamples';
import { ImageActivityContext, SmartImage } from './SmartImage';
import type { ArtistSampleGeneration } from '../services/artistSampleGeneration';
import { IMAGE_CARD_ACTION_CLASS } from './ImageShareActions';
import { ArtistPreferenceActions } from './ArtistPreferenceActions';
import { toggleArtistPreference } from '../services/collectionFavorites';

export const ArtistSampleCover: React.FC<{
  generation?: ArtistSampleGeneration;
  pending?: boolean;
  onGenerate?: () => void;
  tag: string;
  pack: ArtistSamplePack;
  revision: string;
  hasPackSample: boolean;
  packTag?: string;
  ownSamples: ArtistOwnSample[];
  removedSamples?: ArtistSampleRemoval[];
  onDelete?: (removal: ArtistSampleRemoval) => Promise<void>;
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
  onImageLoad?: (width: number, height: number) => void;
  reserveStatusSpace?: boolean;
}> = ({ generation, pending = false, onGenerate, tag, pack, revision, hasPackSample, packTag, ownSamples, removedSamples = [], onDelete, alt, imageClassName, onPackChange, sampleStatusText, onSupplement, notify, preferred, blocked, blockPending, onBlock, onImageLoad, reserveStatusSpace = false }) => {
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
  const [deleting, setDeleting] = useState(false);
  const deleteLock = useRef(false);
  const identity = JSON.stringify([pack, tag, revision]);
  const availableOwn = ownSamples.filter(sample => (pack !== 'v5' || isArtistOwnSampleForPack(sample, pack)) && !isArtistOwnSampleRemoved(sample, removedSamples));
  const ownIds = JSON.stringify(availableOwn.map(sample => sample.id));
  const previousOwn = useRef({ identity, ids: availableOwn.map(sample => sample.id) });
  const lookup = lookupResult?.identity === identity && isArtistSampleSourceForPack(pack, lookupResult.data) ? lookupResult.data : undefined;
  useLayoutEffect(() => {
    setLookupResult(undefined); setError(''); setImageError(false); setIndex(0);
  }, [identity]);
  useLayoutEffect(() => {
    if (previousOwn.current.identity === identity && availableOwn.some(sample => !previousOwn.current.ids.includes(sample.id))) setIndex(0);
    previousOwn.current = { identity, ids: availableOwn.map(sample => sample.id) };
  }, [identity, ownIds]);
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
      if (!isArtistSampleSourceForPack(pack, result)) throw new Error(t('当前图包未确认为 V5 Full，原文件已保留'));
      if (!controller.signal.aborted) setLookupResult({ identity, data: result });
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('样张读取失败')); });
    return () => controller.abort();
  }, [active, visible, hasPackSample, identity, retry, lookup]);
  const canonicalTag = lookup?.canonicalTag || packTag || lookup?.tag || tag;
  const packIndices = lookup ? getAvailableArtistSampleIndices(pack, canonicalTag, lookup.revision, lookup.imageCount, removedSamples) : [];
  const total = availableOwn.length + packIndices.length;
  useLayoutEffect(() => { setIndex(current => Math.min(current, Math.max(0, total - 1))); }, [total]);
  const currentIndex = Math.min(index, Math.max(0, total - 1));
  const own = availableOwn[currentIndex];
  const packIndex = packIndices[currentIndex - availableOwn.length];
  const imageUrl = own?.imageUrl || (lookup && packIndex !== undefined ? buildArtistSampleImageUrl(pack, canonicalTag, packIndex, lookup.revision) : '');
  const preview = generation?.session?.preview?.image || (generation?.phase === 'save_failed' || generation?.phase === 'saving' ? generation.item?.imageUrl : generation?.phase === 'failed' ? generation.preview : undefined);
  const sampleRevision = own?.id || lookup?.revision || revision;
  const favorite = { imageUrl, title: alt || tag, sourceType: 'artist' as const, sourceId: tag,
    imageId: JSON.stringify([pack, sampleRevision, tag, own ? 0 : packIndex]), sourceUrl: own ? undefined : lookup?.sourceUrl,
    prompt: own?.prompt, negativePrompt: own?.negativePrompt, params: own?.params,
    analysis: { artistSample: { pack, tag, revision: sampleRevision, index: own ? 0 : packIndex, ...(own ? { ownSampleId: own.id, model: own.params.model } : {}) } },
  };
  const move = (direction: number) => { setIndex(Math.max(0, Math.min(total - 1, currentIndex + direction))); setImageError(false); };
  const stopCardAction = (event: React.SyntheticEvent) => event.stopPropagation();
  const missing = (!hasPackSample || lookup && packIndices.length === 0) && availableOwn.length === 0;
  const hasSample = !missing;
  const generateLabel = t(hasSample ? '重新生成样张' : '补充样张');
  const removal: ArtistSampleRemoval | undefined = own ? { source: 'own', pack, tag: own.tag, id: own.id }
    : lookup && packIndex !== undefined ? { source: 'pack', pack, tag: canonicalTag, revision: lookup.revision, index: packIndex, imageCount: lookup.imageCount } : undefined;
  const deleteCurrent = async () => {
    if (deleteLock.current || !removal || !onDelete) return;
    deleteLock.current = true; setDeleting(true);
    try { await onDelete(removal); }
    catch (cause) { notify((cause as Error).message, 'error'); }
    finally { deleteLock.current = false; setDeleting(false); }
  };
  const performPreference = async (action: () => Promise<unknown>) => {
    if (preferenceLock.current) return;
    preferenceLock.current = true; setPreferenceBusy(true);
    try { await action(); }
    catch (cause) { notify((cause as Error).message, 'error'); }
    finally { preferenceLock.current = false; setPreferenceBusy(false); }
  };
  return <div ref={rootRef} className="absolute inset-0">
    <ArtistPreferenceActions tag={tag} pack={pack} onPackChange={onPackChange} blocked={blocked} preferred={preferred} disabled={preferenceBusy || blockPending} onBlock={() => void performPreference(onBlock)} onFavorite={() => void performPreference(() => toggleArtistPreference(tag, imageUrl, imageUrl ? favorite : undefined))}>
      {generation?.phase !== 'save_failed' && (!hasSample || onGenerate) && <button type="button" data-card-action="true" data-agent-action="business" aria-label={generateLabel} title={generateLabel} disabled={pending}
        onPointerDown={stopCardAction} onKeyDown={stopCardAction} onClick={event => { stopCardAction(event); (hasSample ? onGenerate : onSupplement)?.(); }}
        className={`${IMAGE_CARD_ACTION_CLASS} hover-reveal-md flex items-center justify-center`}>
        <span className="relative" aria-hidden="true"><ImagePlus className="h-4 w-4" />{hasSample && <RefreshCw className="appearance-contrast absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-full bg-gray-900 p-px" />}</span>
      </button>}
    </ArtistPreferenceActions>
    {onDelete && removal && imageUrl && !preview && generation?.phase !== 'save_failed' && generation?.phase !== 'saving' && <div data-card-action="true" data-image-action-left="true" className="absolute left-2 top-14 z-20 md:top-11" onClick={stopCardAction} onPointerDown={stopCardAction} onKeyDown={stopCardAction}>
      <button type="button" aria-label={t('删除当前样张')} title={t('删除当前样张')} disabled={deleting || pending} onClick={() => void deleteCurrent()} className={`${IMAGE_CARD_ACTION_CLASS} hover-reveal-md flex items-center justify-center`}>
        <span className="relative" aria-hidden="true"><ImageIcon className="h-4 w-4" /><Trash2 className="appearance-contrast absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-full bg-gray-900 p-px" /></span>
      </button>
    </div>}
    {imageUrl && !imageError ? <>
      <SmartImage key={`${imageUrl}:${retry}`} src={imageUrl} alt={alt} eager={visible} className={imageClassName} previewTransform={!own && imageUrl.startsWith('/api/artist-samples/image?') ? 'artist-sample-padding-v2' : undefined} onError={() => setImageError(true)} onLoad={event => { if (event.currentTarget.naturalWidth && event.currentTarget.naturalHeight) onImageLoad?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight); }} />
    </> : <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-gray-100 to-gray-200/60 px-3 pb-3 pt-14 text-center dark:from-gray-900 dark:to-gray-950 md:pt-12">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/70 text-gray-400 ring-1 ring-gray-200/80 dark:bg-gray-800/60 dark:text-gray-500 dark:ring-gray-700/60">{missing ? <ImagePlus className="h-4 w-4" strokeWidth={1.5} /> : <ImageIcon className="h-4 w-4" strokeWidth={1.5} />}</span>
      <span className="max-h-[4.5em] max-w-full overflow-y-auto break-words text-xs leading-normal text-gray-500 dark:text-gray-400">{imageError ? t('样张图片加载失败') : error || sampleStatusText || (missing ? t('{0} 暂无样张', [pack === 'v45' ? 'V4.5' : 'V5 Full']) : t('正在读取样张…'))}</span>
      {(error || imageError) && <button type="button" data-card-action="true" onClick={event => { event.stopPropagation(); setLookupResult(undefined); setImageError(false); setRetry(current => current + 1); }} className="mobile-touch rounded-lg border border-gray-300 px-2 py-1 text-xs dark:border-gray-700">{t('重试')}</button>}
    </div>}
    {preview && <img src={preview} alt={t('样张生成预览')} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />}
    {total > 1 && !preview && <div data-card-action="true" className={`gallery-cover-navigation hover-reveal-md absolute left-2 ${reserveStatusSpace ? 'right-14' : 'right-2'} bottom-2 z-20 flex items-center justify-between gap-1`} onClick={stopCardAction} onPointerDown={stopCardAction} onKeyDown={stopCardAction}>
      <button type="button" aria-label={t('上一张')} title={t('上一张')} disabled={currentIndex === 0 || deleting} onClick={() => move(-1)} className={`${IMAGE_CARD_ACTION_CLASS} flex items-center justify-center disabled:opacity-35`}><ChevronLeft className="h-4 w-4" /></button>
      <span className="rounded-full bg-black/45 px-2 py-1 text-micro tabular-nums text-white backdrop-blur">{currentIndex + 1} / {total}</span>
      <button type="button" aria-label={t('下一张')} title={t('下一张')} disabled={currentIndex >= total - 1 || deleting} onClick={() => move(1)} className={`${IMAGE_CARD_ACTION_CLASS} flex items-center justify-center disabled:opacity-35`}><ChevronRight className="h-4 w-4" /></button>
    </div>}
  </div>;
};
