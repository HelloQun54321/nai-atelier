import React, { useEffect, useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import type { NAIParams } from '../types';
import { t, useLanguage } from '../services/i18n';
import { getPromptArtists, type PromptArtist } from '../services/promptArtists';
import { ARTIST_SAMPLES_CHANGED, buildArtistSampleImageUrl, getArtistSampleLibrary, getArtistSampleLookup, getArtistSampleStatus, getAvailableArtistSampleIndices, isArtistOwnSampleForPack, isArtistSampleSourceForPack, normalizeArtistSampleTag, type ArtistSamplePack, type ArtistSampleLookup } from '../services/artistSamples';
import { getArtistSampleData, type ArtistSampleData } from '../services/artistSampleDrafts';
import { codexMediaUrl, loadCodexAuxiliary, loadCodexBootstrap, type CodexBootstrap } from '../services/codexService';
import { copyTagText } from '../services/externalImageTags';
import { getMobileOriginalUrl } from '../services/mobileImageCache';
import { ViewableImage } from './ImageLightbox';
import { ToolbarButton } from './DesignSystem';

interface Resources {
  names: string[]; data?: ArtistSampleData; packs: Set<ArtistSamplePack>;
  boot?: CodexBootstrap; index?: Record<string, any>; error: boolean;
  loading?: boolean;
}
let pending: Promise<Resources> | undefined;
async function readResources(): Promise<Resources> {
  const [library, data, status] = await Promise.allSettled([getArtistSampleLibrary(), getArtistSampleData(), getArtistSampleStatus()]);
  return {
    names: library.status === 'fulfilled' ? library.value.map(item => item.name) : [],
    data: data.status === 'fulfilled' ? data.value : undefined,
    packs: new Set(status.status === 'fulfilled' && data.status === 'fulfilled' ? status.value.packs.filter(pack => pack.phase === 'ready' && isArtistSampleSourceForPack(pack.id, pack)).map(pack => pack.id) : []),
    error: library.status === 'rejected' || status.status === 'rejected' || data.status === 'rejected',
  };
}
function loadResources() {
  if (!pending) {
    const request = readResources().catch(() => ({ names: [], packs: new Set<ArtistSamplePack>(), error: true }));
    pending = request;
    void request.then(() => { if (pending === request) pending = undefined; });
  }
  return pending;
}

function ArtistCard({ artist, pack, resources, onOpenEntry }: { artist: PromptArtist; pack: ArtistSamplePack; resources?: Resources; onOpenEntry?: (book: string, id: string) => void }) {
  const identity = JSON.stringify([artist.name, pack]);
  const [result, setResult] = useState<{ identity: string; lookup: ArtistSampleLookup }>();
  const [failure, setFailure] = useState('');
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [failedImage, setFailedImage] = useState('');
  const candidates = resources?.data?.samples.filter(sample => sample.pack === pack && isArtistOwnSampleForPack(sample, pack)
    && normalizeArtistSampleTag(sample.tag) === normalizeArtistSampleTag(artist.name)) || [];
  const exact = candidates.filter(sample => sample.tag === artist.name);
  const own = exact.length ? exact : new Set(candidates.map(sample => sample.tag)).size === 1 ? candidates : [];
  useEffect(() => { setPage(0); setCopied(false); setCopyError(false); }, [identity]);
  useEffect(() => {
    setFailure(''); setResult(undefined);
    if (!resources?.packs.has(pack)) return;
    const controller = new AbortController();
    void getArtistSampleLookup(pack, artist.name, controller.signal).then(lookup => {
      if (!isArtistSampleSourceForPack(pack, lookup)) throw new Error(t('样张读取失败'));
      if (!controller.signal.aborted) setResult({ identity, lookup });
    }).catch(cause => { if (!controller.signal.aborted) setFailure(cause instanceof Error ? cause.message : t('样张读取失败')); });
    return () => controller.abort();
  }, [identity, resources?.packs, retry]);
  const lookup = result?.identity === identity ? result.lookup : undefined;
  const tag = lookup?.canonicalTag || lookup?.tag || artist.name;
  const indices = lookup ? getAvailableArtistSampleIndices(pack, tag, lookup.revision, lookup.imageCount, resources?.data?.removedSamples) : [];
  const version = pack === 'v5' ? 'n5' : 'n45';
  const remote = resources?.index?.versions?.[version];
  const other = resources?.index?.versions?.[version === 'n5' ? 'n45' : 'n5'];
  const key = normalizeArtistSampleTag(artist.name);
  const record = remote?.samples?.[key] || other?.samples?.[key];
  const remoteInfo = remote?.samples?.[key] ? remote : other;
  const book = resources?.boot?.books.find(item => item.id === remoteInfo?.book);
  const remoteUrl = Array.isArray(record) && book && resources?.boot ? codexMediaUrl(record[1] || `${record[0]}.jpg`, book, resources.boot.media, { assetRev: record[2], assetCodexId: record[4] }) : '';
  const count = own.length + indices.length;
  const current = Math.min(page, Math.max(0, count - 1));
  const sample = own[current];
  const localUrl = sample?.imageUrl || (lookup && indices[current - own.length] !== undefined ? buildArtistSampleImageUrl(pack, tag, indices[current - own.length], lookup.revision) : '');
  const url = localUrl || remoteUrl;
  const displayedPack = !localUrl && remoteUrl && remoteInfo !== remote ? pack === 'v5' ? 'v45' : 'v5' : pack;
  return <div data-safe-mode-work="true" className="min-w-0" data-prompt-artist={artist.name}>
    {url && failedImage !== url ? <ViewableImage src={getMobileOriginalUrl(url)} alt={`artist:${artist.name}`} onError={() => setFailedImage(url)} className="aspect-square w-full rounded-lg object-cover" /> : <div className="appearance-group flex aspect-square items-center justify-center rounded-lg bg-gray-100 px-2 text-center text-xs text-gray-500 dark:bg-gray-800">{failure || url && failedImage === url ? <button type="button" onClick={() => { setFailedImage(''); setRetry(value => value + 1); }}>{t('样张读取失败')} · {t('重试')}</button> : !resources || resources.loading || resources.packs.has(pack) && !lookup ? t('正在读取样张…') : resources.error ? t('样张读取失败') : t('暂无样张')}</div>}
    <p className="mt-1 truncate text-xs" title={artist.name}>{artist.name}</p>
    <p className="break-words text-micro text-gray-500">{displayedPack === 'v5' ? 'V5 Full' : 'V4.5'} · {artist.weights.map(weight => weight === null ? '?' : `×${Number(weight.toFixed(6))}`).join(' / ')}</p>
    {count > 1 && <div className="mt-1 flex items-center justify-between text-xs"><button type="button" className="mobile-touch" aria-label={t('上一张样张')} disabled={!current} onClick={() => setPage(current - 1)}>‹</button><span>{current + 1}/{count}</span><button type="button" className="mobile-touch" aria-label={t('下一张样张')} disabled={current >= count - 1} onClick={() => setPage(current + 1)}>›</button></div>}
    <div className="mt-1 flex flex-wrap gap-2">
      <button type="button" className="mobile-touch inline-flex items-center gap-1 text-micro text-indigo-600 dark:text-indigo-300" aria-label={t('复制画师 Tag：{0}', [artist.name])} onClick={() => { void copyTagText(`artist:${artist.name}`).then(() => { setCopied(true); setCopyError(false); }, () => setCopyError(true)); }}><Copy className="h-3 w-3" />{t(copyError ? '复制失败' : copied ? '已复制' : '复制')}</button>
      {onOpenEntry && remoteUrl && book && <button type="button" className="mobile-touch text-micro text-indigo-600 dark:text-indigo-300" onClick={() => onOpenEntry(book.id, String(record[0]))}>{t('打开词条')}</button>}
    </div>
  </div>;
}

/** 图片数据页共用的只读画师样张；仅展开时加载，不改变配方或触发生图。 */
export function PromptArtistSamples({ prompt = '', sourcePrompt, params, initialPack, defaultOpen = false, boot, onOpenEntry }: {
  sourcePrompt?: string;
  prompt?: string; params?: Partial<NAIParams>; initialPack?: ArtistSamplePack; defaultOpen?: boolean;
  boot?: CodexBootstrap; onOpenEntry?: (book: string, id: string) => void;
}) {
  useLanguage();
  const preferred = initialPack || (params?.model?.includes('diffusion-5') ? 'v5' : 'v45');
  const [pack, setPack] = useState<ArtistSamplePack>(preferred);
  const [open, setOpen] = useState(defaultOpen);
  const [resources, setResources] = useState<Resources>();
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setPack(preferred); }, [preferred]);
  useEffect(() => {
    const reload = () => { pending = undefined; setRetry(value => value + 1); };
    window.addEventListener(ARTIST_SAMPLES_CHANGED, reload);
    return () => window.removeEventListener(ARTIST_SAMPLES_CHANGED, reload);
  }, []);
  useEffect(() => {
    if (!open) return;
    let active = true; setBusy(true);
    void loadResources().then(value => { if (active) setResources(value); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open, retry]);
  const [remote, setRemote] = useState<{ boot: CodexBootstrap; index: Record<string, any> }>();
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteFailed, setRemoteFailed] = useState(false);
  useEffect(() => {
    // 已就绪的本地样张立即展示，法典补充索引不能阻塞历史和收藏。
    if (!open || !boot && (!resources || resources.packs.has(pack))) return;
    let active = true; setRemoteBusy(true); setRemoteFailed(false);
    void (async () => { const source = boot || await loadCodexBootstrap(); return { boot: source, index: await loadCodexAuxiliary(source, 'artist_index.json') }; })()
      .then(value => { if (active) setRemote(value); }).catch(() => { if (active) setRemoteFailed(true); })
      .finally(() => { if (active) setRemoteBusy(false); });
    return () => { active = false; };
  }, [open, boot, resources, pack, retry]);
  const combined = useMemo<Resources>(() => {
    const local = resources || { names: [], packs: new Set<ArtistSamplePack>(), error: false };
    return { ...local, ...remote, loading: !resources || remoteBusy && !local.packs.has(pack),
      error: local.error || remoteFailed && !local.packs.has(pack), names: [...new Set([...local.names,
      ...Object.values(remote?.index?.versions || {}).flatMap((version: any) => Object.keys(version?.samples || {}))])] };
  }, [resources, remote, remoteBusy, remoteFailed, pack]);
  const actualArtists = useMemo(() => getPromptArtists(prompt, params, combined.names), [prompt, params, combined]);
  const sourceArtists = useMemo(() => getPromptArtists(sourcePrompt, undefined, combined.names), [sourcePrompt, combined]);
  const fromSource = !actualArtists.length && sourceArtists.length > 0;
  const artists = fromSource ? sourceArtists : actualArtists;
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800" data-prompt-artists="true">
    <summary className="cursor-pointer text-sm font-semibold">{t('画师样张')}</summary>
    {open && <>
      <div className="mt-2 flex gap-2">{(['v45', 'v5'] as const).map(version => <ToolbarButton key={version} tone={pack === version ? 'primary' : 'neutral'} aria-pressed={pack === version} onClick={() => setPack(version)}>{version === 'v5' ? 'V5 Full' : 'V4.5'}</ToolbarButton>)}</div>
      {fromSource && <p className="mt-2 text-xs text-gray-500">{t('画师来自法典条目配方')}</p>}
      {(busy || combined.loading) && <p className="mt-2 text-xs text-gray-500" role="status">{t('正在读取样张…')}</p>}
      {combined.error && !busy && !remoteBusy && <button type="button" className="mt-2 text-xs text-amber-600" onClick={() => { pending = undefined; setRetry(value => value + 1); }}>{t('样张读取失败')} · {t('重试')}</button>}
      {!busy && !remoteBusy && !combined.error && !artists.length && <p className="mt-2 text-xs text-gray-500">{t('未找到画师 Tag')}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{(expanded ? artists : artists.slice(0, 9)).map(artist => <ArtistCard key={`${pack}:${artist.name}`} artist={artist} pack={pack} resources={combined} onOpenEntry={onOpenEntry} />)}</div>
      {artists.length > 9 && <ToolbarButton className="mt-2" onClick={() => setExpanded(value => !value)}>{t(expanded ? '收起' : '展开全部')}</ToolbarButton>}
    </>}
  </details>;
}
