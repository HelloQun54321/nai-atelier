import React, { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { ARTIST_SAMPLES_CHANGED, getArtistSampleCatalog, getArtistSampleDictionary, getArtistSampleStatus, isArtistSampleSourceForPack, mergeArtistSampleDictionary, normalizeArtistSampleTag, type ArtistSampleCatalog, type ArtistSamplePack } from '../services/artistSamples';
import type { ArtistDictionaryEntry } from '../services/tagDictionary';
import { getArtistSampleData, type ArtistSampleData } from '../services/artistSampleDrafts';
import { indexArtistSampleGallery } from '../services/artistSampleGallery';
import { artistSampleGenerationBusy, artistSampleGenerationRevision, getArtistSampleGeneration, getGeneratedArtistSamples, subscribeArtistSampleGeneration } from '../services/artistSampleGeneration';
import { collectionSnapshot, ensureCollection, subscribeCollection } from '../services/collectionFavorites';
import { loadRollBlocklist, ROLL_BLOCKLIST_CHANGED, saveRollBlocklist } from '../services/styleRollApi';
import { normalizeRollArtistKey } from '../services/styleRollSeed';
import { ArtistSampleCover } from './ArtistSampleCover';
import { ArtistSampleGenerationStatus, useArtistSampleActions } from './useArtistSampleActions';
import { DanbooruCover } from './DanbooruCover';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { PressRevealSurface } from './PressRevealSurface';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';
import { ImageActivityContext } from './SmartImage';
import { loadAppearancePreferences } from '../services/appearancePreferences';

export interface PromptTagLibraryTarget {
  kind: 'artist' | 'character';
  name: string;
  chinese?: string;
  postCount?: number;
}
type Notify = (message: string, type?: 'success' | 'error') => void;

const ArtistInfo: React.FC<{ target: PromptTagLibraryTarget; notify: Notify; enforceFreeStepLimit: boolean }> = ({ target, notify, enforceFreeStepLimit }) => {
  const active = useContext(ImageActivityContext);
  useSyncExternalStore(subscribeArtistSampleGeneration, artistSampleGenerationRevision);
  const [pack, setPack] = useState<ArtistSamplePack>(() => localStorage.getItem('nai_artist_sample_pack') === 'v5' ? 'v5' : 'v45');
  const [data, setData] = useState<ArtistSampleData>({ templates: {}, samples: [] });
  const [catalogs, setCatalogs] = useState<Partial<Record<ArtistSamplePack, ArtistSampleCatalog>>>({});
  const [dictionary, setDictionary] = useState<ArtistDictionaryEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [blockPending, setBlockPending] = useState(false);
  const blockLock = useRef(false);
  const [preferred, setPreferred] = useState(false);
  const actions = useArtistSampleActions({ active, data, setData, notify, enforceFreeStepLimit });
  useEffect(() => {
    const changed = () => setRefresh(value => value + 1);
    window.addEventListener(ARTIST_SAMPLES_CHANGED, changed);
    return () => window.removeEventListener(ARTIST_SAMPLES_CHANGED, changed);
  }, []);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true); setError('');
    void Promise.all([getArtistSampleStatus(), getArtistSampleData(), getArtistSampleDictionary()]).then(async ([status, next, entries]) => {
      if (cancelled) return;
      setDictionary(entries);
      setData(current => ({ ...next, removedSamples: [...new Map([...(current.removedSamples || []), ...(next.removedSamples || [])].map(item => [JSON.stringify(item), item])).values()] }));
      const available = status.packs.find(item => item.id === pack && item.phase === 'ready' && isArtistSampleSourceForPack(pack, item));
      if (available) {
        const catalog = await getArtistSampleCatalog(pack);
        if (!isArtistSampleSourceForPack(pack, catalog)) throw new Error(t('当前图包未确认为 V5 Full，原文件已保留'));
        if (!cancelled) setCatalogs(current => ({ ...current, [pack]: catalog }));
      } else if (!cancelled) {
        setCatalogs(current => { const next = { ...current }; delete next[pack]; return next; });
      }
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : t('样张读取失败')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, pack, refresh]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const changed = (event: Event) => { cancelled = true; setBlocked((event as CustomEvent<string[]>).detail); };
    window.addEventListener(ROLL_BLOCKLIST_CHANGED, changed);
    void loadRollBlocklist().then(tags => { if (!cancelled) setBlocked(tags); }).catch(cause => { if (!cancelled) notify((cause as Error).message, 'error'); });
    return () => { cancelled = true; window.removeEventListener(ROLL_BLOCKLIST_CHANGED, changed); };
  }, [active, notify]);
  useEffect(() => {
    if (!active) return;
    const sync = () => setPreferred(collectionSnapshot().some(item => item.sourceType === 'artist' && !item.archived && normalizeRollArtistKey(item.sourceId || '') === normalizeRollArtistKey(target.name)));
    sync(); void ensureCollection().catch(cause => notify((cause as Error).message, 'error'));
    return subscribeCollection(sync);
  }, [active, target.name, notify]);
  const toggleBlocked = async () => {
    if (blockLock.current) return;
    blockLock.current = true; setBlockPending(true);
    try {
      const current = await loadRollBlocklist(), key = normalizeRollArtistKey(target.name);
      setBlocked(await saveRollBlocklist(current.some(tag => normalizeRollArtistKey(tag) === key) ? current.filter(tag => normalizeRollArtistKey(tag) !== key) : [...current, target.name]));
    } finally { blockLock.current = false; setBlockPending(false); }
  };
  const library = useMemo(() => {
    const entries = mergeArtistSampleDictionary(dictionary, Object.values(catalogs).flatMap(catalog => catalog.tags));
    return entries.some(entry => entry.name === target.name) ? entries : [...entries, { name: target.name, chinese: target.chinese || '', postCount: target.postCount ?? 0, postCountKnown: target.postCount !== undefined }];
  }, [dictionary, catalogs, target]);
  const generatedSamples = getGeneratedArtistSamples();
  const samplesByPack = useMemo(() => indexArtistSampleGallery(library, data, catalogs, generatedSamples), [library, data, catalogs, generatedSamples]);
  const samples = samplesByPack[pack];
  const own = samples.ownNames.has(target.name) ? samples.own.filter(sample => sample.tag === target.name || (!samples.ownTags.has(target.name) && normalizeArtistSampleTag(sample.tag) === normalizeArtistSampleTag(target.name))) : [];
  const generation = getArtistSampleGeneration(target.name, pack);
  const busy = artistSampleGenerationBusy(generation) || actions.requestingTarget === `${pack}:${target.name}`;
  return <>
    <PressRevealSurface pressResetKey={pack} className="group relative aspect-[2/3] overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-900" data-safe-mode-work="true">
      <ArtistSampleCover reserveStatusSpace={busy || Boolean(generation?.error || generation?.session?.awaiting || generation?.session?.connectionError) || generation?.phase === 'save_failed' || generation?.session?.state === 'paused'} tag={target.name} pack={pack} onPackChange={setPack} revision={catalogs[pack]?.revision || ''} hasPackSample={samples.packedNames.has(target.name)} packTag={samples.packTagNames.has(target.name) ? target.name : samples.normalizedPackTags.get(normalizeArtistSampleTag(target.name))}
        ownSamples={own} removedSamples={data.removedSamples} generation={generation} pending={busy || loading || Boolean(error)} preferred={preferred} blocked={blocked.some(tag => normalizeRollArtistKey(tag) === normalizeRollArtistKey(target.name))} blockPending={blockPending} onBlock={toggleBlocked}
        onDelete={actions.removeSample} onGenerate={() => actions.supplementSample(target.name, pack, true)} onSupplement={() => actions.supplementSample(target.name, pack)} alt={target.chinese || target.name} imageClassName="h-full w-full object-contain" sampleStatusText={error || (loading ? t('正在读取样张…') : undefined)} notify={notify} />
      <ArtistSampleGenerationStatus tag={target.name} pack={pack} generation={generation} busy={busy} hasOwnSamples={own.length > 0} supplementSample={actions.supplementSample} manageGeneration={actions.manageGeneration} />
    </PressRevealSurface>
    {error && <div role="alert" className="flex items-center gap-2 py-2 text-xs text-red-600 dark:text-red-300"><span>{error}</span><button type="button" className="mobile-touch min-h-11 underline" onClick={() => setRefresh(value => value + 1)}>{t('重试')}</button></div>}
    {actions.settingsDialog}
  </>;
};

interface PromptTagLibraryInfoProps { target: PromptTagLibraryTarget; onClose: () => void; notify?: Notify; enforceFreeStepLimit?: boolean }

export const PromptTagLibraryInfo: React.FC<PromptTagLibraryInfoProps> = props => {
  return <ImagePreviewPortal><PromptTagLibraryInfoContent {...props} /></ImagePreviewPortal>;
};

const PromptTagLibraryInfoContent: React.FC<PromptTagLibraryInfoProps> = ({ target, onClose, notify, enforceFreeStepLimit = loadAppearancePreferences().enforceFreeStepLimit }) => {
  useLanguage();
  const active = useContext(ImageActivityContext);
  const titleId = useId();
  const dialogRef = useModalA11y<HTMLDivElement>(active);
  const close = useMobileHistoryLayer(active, onClose, 'prompt-tag-library-info');
  const [message, setMessage] = useState('');
  const report = useCallback<Notify>((text, type) => { setMessage(text); notify?.(text, type); }, [notify]);
  useEffect(() => {
    if (!active) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialogRef.current)) { event.preventDefault(); event.stopPropagation(); close(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [active, close, dialogRef]);
  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} hidden={!active} className={active ? 'fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm' : 'hidden'} onMouseDown={event => { if (active && event.target === event.currentTarget && isTopmostModal(dialogRef.current)) close(); }}>
    <section className="appearance-content max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-gray-200 bg-white p-3 text-gray-800 shadow-xl dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
      <header className="mb-2 flex items-start justify-between gap-2"><div className="min-w-0"><div className="text-xs text-gray-500">{t(target.kind === 'artist' ? '画师库' : '角色库')}</div><h2 id={titleId} data-safe-mode-title="true" className="break-words text-sm font-semibold">{target.name}</h2>{target.chinese && <p data-safe-mode-title="true" className="break-words text-xs text-gray-500 dark:text-gray-400">{target.chinese}</p>}{Number.isFinite(target.postCount) && target.postCount! < Number.MAX_SAFE_INTEGER && <p className="text-xs text-gray-500" title={t('Danbooru 关联作品数')}>{t('作品 {0}', [target.postCount!.toLocaleString()])}</p>}</div><button type="button" aria-label={t('关闭')} onClick={() => close()} className="mobile-touch flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><X className="h-4 w-4" /></button></header>
      {target.kind === 'artist' ? <ArtistInfo key={target.name} target={target} notify={report} enforceFreeStepLimit={enforceFreeStepLimit} /> : <PressRevealSurface key={target.name} className="group relative aspect-[2/3] overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-900" data-safe-mode-work="true"><DanbooruCover tag={target.name} kind="character" alt={target.chinese || target.name} imageClassName="h-full w-full object-contain" notify={report} /></PressRevealSurface>}
      {message && <p role="status" className="mt-2 break-words text-xs">{message}</p>}
    </section>
  </div>;
};
