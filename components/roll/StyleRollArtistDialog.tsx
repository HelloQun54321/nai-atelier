import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ImageIcon, SlidersHorizontal, X } from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import type { ArtistDictionaryEntry } from '../../services/tagDictionary';
import { matchesArtistSearch, parseArtistSearchTerms } from '../../services/tagLibrary';
import { getArtistUsage, isArtistUsageSort, artistUsageCount, compareArtistUsage, matchesArtistUsage, type ArtistBrowseSort, type ArtistUsageFilter, type ArtistUsageIndex } from '../../services/artistUsage';
import { localHistory } from '../../services/localHistory';
import type { RollRules } from '../../services/styleRoll';
import { ARTIST_SAMPLES_CHANGED, normalizeArtistSampleTag, type ArtistSamplePack } from '../../services/artistSamples';
import { loadArtistSampleUrls } from '../../services/artistSampleUrls';
import { collectionSnapshot, ensureCollection, subscribeCollection, toggleArtistPreference } from '../../services/collectionFavorites';
import { normalizeRollArtistKey } from '../../services/styleRollSeed';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { SmartImage } from '../SmartImage';
import { IconButton, ToolbarButton, ToolbarSearch, ToolbarSelect } from '../DesignSystem';
import { AnchoredToolbarPopover, TOOLBAR_FIELD_CLASS } from '../ToolbarPopover';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { useMobileHistoryLayer } from '../MobileUI';
import { PressRevealSurface } from '../PressRevealSurface';
import { ArtistPreferenceActions } from '../ArtistPreferenceActions';
import { StyleRollArtistInput } from './StyleRollArtistInput';
import { ToolbarCountCaption } from '../ToolbarCountCaption';

interface Props {
  library: ArtistDictionaryEntry[]; loading?: boolean;
  pinned: string[]; onPinnedChange: (tags: string[]) => void;
  blocked: string[]; onBlockedChange: (tags: string[]) => Promise<void>;
  excluded: string[]; onExcludedChange: (tags: string[]) => void;
  sampledOnly: boolean; onSampledOnlyChange: (value: boolean) => void;
  rules: RollRules; onRulesChange: (rules: RollRules) => void;
  onClose: () => void;
}

export const StyleRollArtistDialog: React.FC<Props> = props => <ImagePreviewPortal><ArtistDialog {...props} /></ImagePreviewPortal>;

const ArtistDialog: React.FC<Props> = ({ library, loading, pinned, onPinnedChange, blocked, onBlockedChange, excluded, onExcludedChange, sampledOnly, onSampledOnlyChange, rules, onRulesChange, onClose }) => {
  useLanguage();
  const collection = useSyncExternalStore(subscribeCollection, collectionSnapshot);
  const preferred = useMemo(() => new Set(collection.filter(item => item.sourceType === 'artist' && !item.archived && item.sourceId).map(item => normalizeRollArtistKey(item.sourceId!))), [collection]);
  const [urls, setUrls] = useState<Record<ArtistSamplePack, Map<string, string>>>({ v45: new Map(), v5: new Map() }), [sampleLoading, setSampleLoading] = useState(true);
  const [sampleRetry, setSampleRetry] = useState(0);
  useEffect(() => { const changed = () => setSampleRetry(value => value + 1); window.addEventListener(ARTIST_SAMPLES_CHANGED, changed); return () => window.removeEventListener(ARTIST_SAMPLES_CHANGED, changed); }, []);
  const [defaultPack] = useState<ArtistSamplePack>(() => localStorage.getItem('nai_artist_sample_pack') === 'v5' ? 'v5' : 'v45');
  const [cardPacks, setCardPacks] = useState<Record<string, ArtistSamplePack>>({});
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [limit, setLimit] = useState(60);
  const searchTerms = useMemo(() => parseArtistSearchTerms(query), [query]);
  const [sort, setSort] = useState<ArtistBrowseSort>(() => {
    const saved = localStorage.getItem('nai_roll_artist_sort') || localStorage.getItem('nai_artist_sort');
    return saved === 'least' || saved === 'name-asc' || saved === 'name-desc' || isArtistUsageSort(saved || '') ? saved as ArtistBrowseSort : 'popular';
  });
  const [usage, setUsage] = useState<ArtistUsageIndex | null>(null), [usageStatus, setUsageStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [usageRetry, setUsageRetry] = useState(0), [usageOpen, setUsageOpen] = useState(false);
  const [chainsFilter, setChainsFilter] = useState<ArtistUsageFilter>('all'), [imagesFilter, setImagesFilter] = useState<ArtistUsageFilter>('all');
  const usageAnchor = useRef<HTMLDivElement>(null);
  const closeUsage = React.useCallback(() => setUsageOpen(false), []);
  const usageReady = usageStatus === 'ready' && usage !== null;
  useEffect(() => {
    const controller = new AbortController(); let current = true; setUsageStatus('loading');
    void getArtistUsage(controller.signal).then(index => { if (current) { setUsage(index); setUsageStatus('ready'); } })
      .catch(() => { if (current && !controller.signal.aborted) setUsageStatus('error'); });
    return () => { current = false; controller.abort(); };
  }, [usageRetry]);
  useEffect(() => localHistory.subscribe(() => setUsageRetry(value => value + 1)), []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gallery = useRef<HTMLDivElement>(null);
  const settingsAnchor = useRef<HTMLDivElement>(null);
  const closeSettings = React.useCallback(() => setSettingsOpen(false), []);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dialog = useModalA11y<HTMLDivElement>(true);
  const close = useMobileHistoryLayer(true, () => { if (busy) return false; onClose(); }, 'roll-artists');
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialog.current)) { event.preventDefault(); close(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [close, dialog]);
  useEffect(() => {
    let current = true;
    void Promise.all([loadArtistSampleUrls('v45'), loadArtistSampleUrls('v5')]).then(([v45, v5]) => { if (current) setUrls({ v45, v5 }); }).catch(cause => { if (current) setError((cause as Error).message); }).finally(() => { if (current) setSampleLoading(false); });
    return () => { current = false; };
  }, [sampleRetry]);
  useEffect(() => { void ensureCollection().catch(cause => setError((cause as Error).message)); }, []);
  const pinnedKeys = useMemo(() => new Set(pinned.map(normalizeRollArtistKey)), [pinned]);
  const blockedKeys = useMemo(() => new Set([...blocked, ...excluded].map(normalizeRollArtistKey)), [blocked, excluded]);
  const sampleNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const name of new Set(library.map(entry => entry.name))) { const key = normalizeArtistSampleTag(name); counts.set(key, (counts.get(key) || 0) + 1); }
    return counts;
  }, [library]);
  const sampleUrl = (name: string, pack: ArtistSamplePack) => {
    const key = normalizeArtistSampleTag(name), url = urls[pack].get(key);
    if (!url || (sampleNameCounts.get(key) || 0) < 2) return url;
    // 归一冲突只接受地址明确记录的原 Tag；普通资产地址不能证明属于哪个别名。
    return url.startsWith('/api/artist-samples/image?') && new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('tag') === name ? url : undefined;
  };
  const artists = useMemo(() => {
    const entries = new Map(library.map(entry => [entry.name, entry]));
    const known = new Set(library.map(entry => normalizeRollArtistKey(entry.name)));
    for (const tag of [...pinned, ...blocked, ...excluded, ...collection.filter(item => item.sourceType === 'artist' && !item.archived && item.sourceId).map(item => item.sourceId!)]) if (!known.has(normalizeRollArtistKey(tag))) { entries.set(tag, { name: tag, chinese: '', postCount: 0, postCountKnown: false }); known.add(normalizeRollArtistKey(tag)); }
    const index = usage || { byTag: new Map(), indexed: 0, total: 0 };
    const activeSort = !usage && isArtistUsageSort(sort) ? 'popular' : sort;
    return [...entries.values()].filter(entry => {
      const key = normalizeRollArtistKey(entry.name);
      return matchesArtistSearch(entry, searchTerms) && (!usage || matchesArtistUsage(entry.name, usage, chainsFilter, imagesFilter)) && (filter === 'all' || filter === 'pinned' && pinnedKeys.has(key) || filter === 'preferred' && preferred.has(key) || filter === 'blocked' && blockedKeys.has(key));
    }).sort((left, right) => compareArtistUsage(left, right, activeSort, index));
  }, [library, pinned, blocked, excluded, collection, searchTerms, filter, pinnedKeys, preferred, blockedKeys, sort, usage, chainsFilter, imagesFilter]);
  const changeFilter = (value: string) => { setFilter(value); setLimit(60); if (gallery.current) gallery.current.scrollTop = 0; };
  const perform = async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError('');
    try { await action(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const pin = (tag: string) => {
    const key = normalizeRollArtistKey(tag); setError('');
    if (pinnedKeys.has(key)) onPinnedChange(pinned.filter(value => normalizeRollArtistKey(value) !== key));
    else if (blockedKeys.has(key)) setError(t('画师已被屏蔽或排除：{0}', [tag]));
    else if (pinned.length >= rules.maxArtists) setError(t('最多可添加 {0} 位画师', [rules.maxArtists]));
    else onPinnedChange([...pinned, tag]);
  };
  const block = (tag: string) => perform(async () => {
    const key = normalizeRollArtistKey(tag), active = blockedKeys.has(key);
    await onBlockedChange(active ? blocked.filter(value => normalizeRollArtistKey(value) !== key) : [...blocked, tag]);
    if (active) onExcludedChange(excluded.filter(value => normalizeRollArtistKey(value) !== key));
    else onPinnedChange(pinned.filter(value => normalizeRollArtistKey(value) !== key));
  });
  return <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-0 backdrop-blur-sm sm:p-4 lg:p-6">
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('Roll 画师')} className="appearance-panel flex h-dvh w-full max-w-7xl flex-col overflow-hidden border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 sm:h-[92dvh] sm:rounded-2xl">
      <header data-toolbar-caption-host="true" className="relative flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800 lg:px-5">
        <h2 className="min-w-0 flex-1 text-base font-semibold tracking-tight sm:flex-none">{t('管理画师与偏好')}</h2>
        <ToolbarSearch containerClassName="order-last basis-full !max-w-none sm:order-none sm:basis-0" aria-label={t('搜索画师')} placeholder={t('搜索画师，多个词用逗号分隔')} value={query} onChange={event => { setQuery(event.target.value); setLimit(60); if (gallery.current) gallery.current.scrollTop = 0; }} />
        <div ref={settingsAnchor} className="shrink-0"><ToolbarButton aria-label={t('抽取设置')} aria-expanded={settingsOpen} aria-haspopup="dialog" active={settingsOpen} onClick={() => { setUsageOpen(false); setSettingsOpen(value => !value); }}><SlidersHorizontal /><span className="hidden sm:inline">{t('抽取设置')}</span></ToolbarButton></div>
        <ToolbarButton tone="primary" disabled={busy} onClick={close}>{t('完成')}</ToolbarButton>
        <ToolbarCountCaption>{loading ? t('已加载 {0} 位', [artists.length]) : filter !== 'all' || chainsFilter !== 'all' || imagesFilter !== 'all' || searchTerms.length > 0 ? t('匹配 {0} 位', [artists.length]) : t('共 {0} 位', [artists.length])}</ToolbarCountCaption>
      </header>
      <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2 sm:px-5">
        <div role="group" aria-label={t('画师范围')} className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {([['all', '全部画师', undefined], ['pinned', '已锁定', pinned.length], ['preferred', '偏好画师', preferred.size], ['blocked', '已屏蔽', blockedKeys.size]] as const).map(([value, label, total]) => <button key={value} type="button" aria-label={t(label)} aria-pressed={filter === value} onClick={() => changeFilter(value)} className={`mobile-touch flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors ${filter === value ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>{t(label)}{total !== undefined && <span className="text-micro tabular-nums opacity-70">{total}</span>}</button>)}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs tabular-nums text-gray-400 lg:block">{t('{0} 位画师', [artists.length])}</span>
          <div ref={usageAnchor}><ToolbarButton aria-label={t('筛选')} aria-expanded={usageOpen} active={chainsFilter !== 'all' || imagesFilter !== 'all'} onClick={() => { setSettingsOpen(false); setUsageOpen(value => !value); }}><SlidersHorizontal /><span className="hidden sm:inline">{t('筛选')}</span></ToolbarButton></div>
          <ToolbarSelect label="画师排序" value={sort} containerClassName="min-w-0 max-w-[44vw] sm:max-w-none" className="truncate !text-xs" onChange={event => {
            const value = event.target.value as ArtistBrowseSort; setSort(value); setLimit(60);
            if (gallery.current) gallery.current.scrollTop = 0;
            try { localStorage.setItem('nai_roll_artist_sort', value); } catch { /* 无法持久保存时仍保留本次选择。 */ }
          }}>
            <option value="popular">{t('热度从高到低')}</option><option value="least">{t('热度从低到高')}</option><option value="name-asc">{t('名称 A → Z')}</option><option value="name-desc">{t('名称 Z → A')}</option>
            <option value="usage-chains" disabled={!usageReady}>{t('收录串数从高到低')}</option><option value="usage-chains-asc" disabled={!usageReady}>{t('收录串数从低到高')}</option>
            <option value="usage-images" disabled={!usageReady}>{t('生成图片数从高到低')}</option><option value="usage-images-asc" disabled={!usageReady}>{t('生成图片数从低到高')}</option>
          </ToolbarSelect>
        </div>
      </div>
      {error && <p role="alert" className="shrink-0 px-4 pb-2 text-xs text-red-500">{t(error)}</p>}
      {usageOpen && <AnchoredToolbarPopover anchorRef={usageAnchor} title={t('筛选')} width={280} allowMobile onClose={closeUsage}>
        <div className="space-y-3">
          {usageStatus === 'loading' && <p role="status" className="text-xs text-gray-500">{t('正在统计画师使用…')}</p>}
          {usageStatus === 'error' && <p role="alert" className="flex items-center justify-between gap-2 text-xs text-red-500">{t('画师使用统计暂不可用')}<button type="button" className="shrink-0 underline" onClick={() => setUsageRetry(value => value + 1)}>{t('重试统计')}</button></p>}
          <div className="space-y-1"><p className="text-xs font-medium">{t('风格串收录')}</p><ToolbarSelect containerClassName="w-full" label={t('风格串收录')} value={chainsFilter} disabled={!usageReady} onChange={event => { setChainsFilter(event.target.value as ArtistUsageFilter); setLimit(60); if (gallery.current) gallery.current.scrollTop = 0; }}>
            <option value="all">{t('全部')}</option><option value="used">{t('已收录')}</option><option value="unused">{t('未收录')}</option>
          </ToolbarSelect>
          </div>
          <div className="space-y-1"><p className="text-xs font-medium">{t('图片生成')}</p><ToolbarSelect containerClassName="w-full" label={t('图片生成')} value={imagesFilter} disabled={!usageReady} onChange={event => { setImagesFilter(event.target.value as ArtistUsageFilter); setLimit(60); if (gallery.current) gallery.current.scrollTop = 0; }}>
            <option value="all">{t('全部')}</option><option value="used">{t('已生成')}</option><option value="unused">{t('未生成')}</option>
          </ToolbarSelect></div>
          {(chainsFilter !== 'all' || imagesFilter !== 'all') && <button type="button" className="mobile-touch text-xs font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => { setChainsFilter('all'); setImagesFilter('all'); setLimit(60); if (gallery.current) gallery.current.scrollTop = 0; }}>{t('重置筛选')}</button>}
        </div>
      </AnchoredToolbarPopover>}
      {settingsOpen && <AnchoredToolbarPopover anchorRef={settingsAnchor} title={t('抽取设置')} width={320} allowMobile onClose={closeSettings}>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2"><strong className="text-sm">{t('抽取设置')}</strong><IconButton label="关闭" className="!h-7 !w-7 !border-transparent !bg-transparent" onClick={closeSettings}><X /></IconButton></div>
          <label className="flex items-center justify-between gap-3 text-xs text-gray-600 dark:text-gray-300"><span>{t('偏好抽中倍率')}</span><span className="flex w-24 shrink-0 items-center gap-1.5"><input aria-label={t('偏好抽中倍率')} className={`${TOOLBAR_FIELD_CLASS} !mt-0 !px-2 text-center tabular-nums`} type="number" min={1} step={0.1} value={rules.preferredMultiplier ?? 1} onChange={event => onRulesChange({ ...rules, preferredMultiplier: Number(event.target.value) })} /><span aria-hidden="true">×</span></span></label>
          <label className="flex items-center justify-between gap-3 text-xs text-gray-600 dark:text-gray-300"><span>{t('每串偏好保底人数')}</span><span className="flex w-24 shrink-0 items-center gap-1.5"><input aria-label={t('每串偏好保底人数')} className={`${TOOLBAR_FIELD_CLASS} !mt-0 !px-2 text-center tabular-nums`} type="number" min={0} max={rules.maxArtists} step={1} value={rules.preferredMinArtists ?? 0} onChange={event => onRulesChange({ ...rules, preferredMinArtists: Number(event.target.value) })} /><span aria-hidden="true">{t('人')}</span></span></label>
          <label className="mobile-touch flex items-center gap-2 border-t border-gray-200 pt-3 text-xs dark:border-gray-800"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={sampledOnly} onChange={event => onSampledOnlyChange(event.target.checked)} />{t('只从有样张的画师中抽取')}</label>
          <details><summary className="mobile-touch cursor-pointer text-xs text-gray-500">{t('手动添加固定 Tag')}</summary><div className="mt-2"><StyleRollArtistInput label="固定画师 Tag（可选）" value={pinned} onChange={onPinnedChange} limit={rules.maxArtists} blocked={[...blocked, ...excluded]} disabled={busy} /></div></details>
        </div>
      </AnchoredToolbarPopover>}
      <div ref={gallery} data-roll-artist-gallery className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2 sm:px-5" onScroll={event => { const node = event.currentTarget; if (node.scrollHeight - node.scrollTop - node.clientHeight < 500) setLimit(current => Math.min(artists.length, current + 60)); }}>
        {(loading || sampleLoading) && <p role="status" className="mb-3 text-xs text-gray-500">{t('正在读取画师样张…')}</p>}
        <div className="grid grid-cols-2 items-start gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {artists.slice(0, limit).map(artist => {
            const key = normalizeRollArtistKey(artist.name), selected = pinnedKeys.has(key), banned = blockedKeys.has(key), favorite = preferred.has(key), pack = cardPacks[key] || defaultPack, url = sampleUrl(artist.name, pack);
            return <PressRevealSurface as="article" key={artist.name} pressResetKey={pack} pressDisabled={busy} data-safe-mode-work="true" role="button" aria-label={t('锁定画师：{0}', [artist.name])} aria-pressed={selected} aria-disabled={busy} tabIndex={busy ? -1 : 0} onClick={() => { if (!busy) pin(artist.name); }} onKeyDown={event => { if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key) || busy) return; event.preventDefault(); pin(artist.name); }} className={`appearance-group gallery-image-card gallery-card-visual relative min-w-0 cursor-pointer overflow-hidden rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-gray-900 ${selected ? 'ring-2 ring-indigo-500' : ''}`}>
              <div className="appearance-media mobile-gallery-frame relative aspect-[2/3] overflow-hidden bg-gray-100 dark:bg-gray-950">
                <div className="absolute inset-0 h-full w-full">
                  {url ? <SmartImage src={url} alt={artist.chinese || artist.name} className="h-full w-full object-contain" previewTransform={url.startsWith('/api/artist-samples/image?') ? 'artist-sample-padding-v2' : undefined} /> : <span className="flex h-full flex-col items-center justify-center gap-2 text-xs text-gray-400"><ImageIcon className="h-7 w-7 opacity-40" strokeWidth={1.25} />{t('暂无样张')}</span>}
                </div>
                <ArtistPreferenceActions tag={artist.name} pack={pack} onPackChange={value => setCardPacks(current => ({ ...current, [key]: value }))} blocked={banned} preferred={favorite} disabled={busy} onBlock={() => void block(artist.name)} onFavorite={() => void perform(async () => { await toggleArtistPreference(artist.name, url || ''); })} />
              </div>
              <div className="gallery-card-caption !min-h-0 !px-2 !py-1.5 text-center before:!top-[-0.75rem]"><p data-safe-mode-title="true" className="truncate text-sm font-bold text-gray-900 dark:text-white" title={artist.name}>{selected && <Check aria-hidden="true" className="mr-1 inline h-3.5 w-3.5 text-indigo-500" strokeWidth={3} />}{artist.name}</p>{(banned || artist.chinese && artist.chinese !== artist.name) && <p className={`gallery-card-meta mt-0.5 truncate text-micro ${banned ? 'text-red-500' : 'text-gray-500'}`} data-safe-mode-title="true">{banned ? t('已屏蔽 · 不参与 Roll') : artist.chinese}</p>}<p className="gallery-card-meta mt-0.5 truncate text-micro tabular-nums text-gray-500">{usageReady ? t('收录 {0} 串 · 生成 {1} 张', [artistUsageCount(artist.name, usage!, 'chains'), artistUsageCount(artist.name, usage!, 'images')]) : t('收录 — 串 · 生成 — 张')}</p></div>
            </PressRevealSurface>;
          })}
        </div>
        {artists.length > limit && <ToolbarButton className="mt-5 w-full" onClick={() => setLimit(current => current + 60)}>{t('加载更多')}</ToolbarButton>}
        {!loading && !artists.length && <p className="p-8 text-center text-sm text-gray-500">{t('没有匹配的画师')}</p>}
      </div>
    </div>
  </div>;
};
