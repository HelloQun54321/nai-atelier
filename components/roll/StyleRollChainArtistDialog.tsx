import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Dice5, Filter, Layers, X } from 'lucide-react';
import type { PromptChain } from '../../types';
import { t, useLanguage } from '../../services/i18n';
import { buildRollChainArtistSource, extractRollChainArtistTags } from '../../services/styleRollChainArtists';
import type { RollChainArtistSource } from '../../services/styleRoll';
import { normalizeArtistUsageKey } from '../../services/artistParticipation';
import { db } from '../../services/dbService';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { ImageActivityContext, SmartImage } from '../SmartImage';
import { IconButton, ToolbarButton, ToolbarSearch, ToolbarSelect } from '../DesignSystem';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { useMobileHistoryLayer } from '../MobileUI';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';
import { ShortestColumnMasonry, useMasonryColumnCount } from '../ShortestColumnMasonry';
import { useImageRatios } from '../useImageRatios';
import { AnchoredToolbarPopover } from '../ToolbarPopover';
import { getCustomChainTags } from '../../services/chainTags';
import { isUntestedChain } from '../../services/chainStatus';
import { DEFAULT_NAI_MODEL, getSelectableNaiModels } from '../../services/naiModels';
import { useNaiRuntime } from '../../services/naiRuntime';
import { collectionTargetActive, ensureCollection, readLegacyFavoriteIds, subscribeCollection } from '../../services/collectionFavorites';

interface Props {
  knownArtists: ReadonlySet<string>;
  source?: RollChainArtistSource;
  blocked: string[];
  onConfirm: (source: RollChainArtistSource | undefined) => void;
  onClose: () => void;
}

export const StyleRollChainArtistDialog: React.FC<Props> = props => <ImagePreviewPortal><ChainArtistContent {...props} /></ImagePreviewPortal>;

const ChainArtistContent: React.FC<Props> = ({ knownArtists, source, blocked, onConfirm, onClose }) => {
  useLanguage();
  const active = useContext(ImageActivityContext);
  const dialog = useModalA11y<HTMLDivElement>(active);
  const close = useMobileHistoryLayer(active, onClose, 'roll-chain-artists');
  const applied = useRef(false);
  const [chains, setChains] = useState<PromptChain[]>([]), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [query, setQuery] = useState(''), [visibleLimit, setVisibleLimit] = useState(60), [error, setError] = useState('');
  const [artistsOnly, setArtistsOnly] = useState(false);
  const [randomCount, setRandomCount] = useState('3'), [randomError, setRandomError] = useState(''), [randomPriority, setRandomPriority] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState(''), [favOnly, setFavOnly] = useState(false), [untestedOnly, setUntestedOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState(new Set<string>()), [tagSearch, setTagSearch] = useState('');
  const [sort, setSort] = useState<'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc'>('updated_desc');
  const [filterOpen, setFilterOpen] = useState(false), [favorites, setFavorites] = useState(new Set<string>());
  const [artistsOpen, setArtistsOpen] = useState(false);
  const artistsAnchor = useRef<HTMLDivElement>(null);
  const closeArtists = useCallback(() => setArtistsOpen(false), []);
  const [favoriteStatus, setFavoriteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle'), [favoriteError, setFavoriteError] = useState(''), [favoriteRetry, setFavoriteRetry] = useState(0);
  const filterAnchor = useRef<HTMLDivElement>(null);
  const closeFilters = useCallback(() => setFilterOpen(false), []);
  const runtime = useNaiRuntime();
  const modelOptions = useMemo(() => getSelectableNaiModels(runtime), [runtime]);
  const gallery = useRef<HTMLDivElement>(null);
  const display = useMobileImageDisplayPreferences('chains');
  const columns = useMasonryColumnCount(display, undefined, gallery, 240);
  const [ratios, updateRatio] = useImageRatios();
  const [selectedChains, setSelectedChains] = useState(() => new Set(source?.chainIds)), [unchecked, setUnchecked] = useState(new Set<string>());
  const restored = useRef(!source);
  const parsed = useMemo(() => new Map<PromptChain, string[]>(), [knownArtists]);
  const extract = useCallback((chain: PromptChain) => {
    let tags = parsed.get(chain);
    if (!tags) { tags = extractRollChainArtistTags(chain, knownArtists); parsed.set(chain, tags); }
    return tags;
  }, [parsed, knownArtists]);
  useEffect(() => {
    if (!active) return;
    let current = true; setLoading(true); setError(''); setChains([]);
    void db.getAllChains().then(values => {
      if (!current) return;
      const readable = values.filter(chain => !chain.type || chain.type === 'style');
      if (!restored.current) {
        restored.current = true;
        const enabled = new Set(source?.artists.map(artist => normalizeArtistUsageKey(artist.tag)));
        const original = buildRollChainArtistSource(readable.filter(chain => source?.chainIds.includes(chain.id)), knownArtists, extract);
        setUnchecked(new Set(original.artists.filter(artist => !enabled.has(normalizeArtistUsageKey(artist.tag))).map(artist => artist.tag)));
      }
      setChains(readable);
    })
      .catch(cause => { if (current) setError((cause as Error).message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, retry, knownArtists, source, extract]);
  const refreshFavorites = useCallback(() => {
    let legacy = new Set<string>();
    try { legacy = readLegacyFavoriteIds('nai_chain_favs'); } catch (cause) { console.warn('读取旧风格串收藏失败:', cause); }
    const next = new Set(legacy);
    for (const chain of chains) {
      if (!chain.previewImage) continue;
      if (collectionTargetActive({ imageUrl: chain.previewImage, sourceType: 'chain', sourceId: chain.id })) next.add(chain.id);
      else next.delete(chain.id);
    }
    setFavorites(next);
  }, [chains]);
  useEffect(() => { refreshFavorites(); return subscribeCollection(refreshFavorites); }, [refreshFavorites]);
  useEffect(() => {
    if (!active || !favOnly) return;
    let current = true; setFavoriteStatus('loading'); setFavoriteError('');
    void ensureCollection().then(() => { if (current) { refreshFavorites(); setFavoriteStatus('ready'); } })
      .catch(cause => { if (current) { setFavoriteError((cause as Error).message); setFavoriteStatus('error'); } });
    return () => { current = false; };
  }, [active, favOnly, favoriteRetry, refreshFavorites]);
  const favoritePending = favOnly && favoriteStatus !== 'ready';
  useEffect(() => { if (!active) { setFilterOpen(false); setArtistsOpen(false); } }, [active]);
  const customTags = useMemo(() => [...new Set(chains.flatMap(chain => getCustomChainTags(chain.tags)))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [chains]);
  useEffect(() => { setSelectedTags(current => { const next = new Set([...current].filter(tag => customTags.includes(tag))); return next.size === current.size ? current : next; }); }, [customTags]);
  const tagOptions = customTags.filter(tag => customTags.length <= 12 || tag.toLowerCase().includes(tagSearch.trim().toLowerCase()));
  const filtered = useMemo(() => chains.filter(chain =>
    (chain.name.toLowerCase().includes(query.toLowerCase()) || (chain.description || '').toLowerCase().includes(query.toLowerCase())) &&
    (!artistsOnly || extract(chain).length > 0) && (!favOnly || favorites.has(chain.id)) && (!untestedOnly || isUntestedChain(chain)) &&
    (!selectedModel || (chain.params?.model?.trim() || DEFAULT_NAI_MODEL) === selectedModel) &&
    [...selectedTags].every(tag => getCustomChainTags(chain.tags).includes(tag))
  ).sort((a, b) => {
    const ca = a.createdAt || 0, cb = b.createdAt || 0, ua = a.updatedAt || ca, ub = b.updatedAt || cb;
    return sort === 'created_asc' ? ca - cb : sort === 'created_desc' ? cb - ca : sort === 'updated_asc' ? ua - ub : ub - ua;
  }), [chains, query, artistsOnly, extract, favOnly, favorites, untestedOnly, selectedModel, selectedTags, sort]);
  const displayOrder = useMemo(() => {
    if (!randomPriority.length) return filtered;
    const priority = new Set(randomPriority);
    return [...filtered.filter(chain => priority.has(chain.id)), ...filtered.filter(chain => !priority.has(chain.id))];
  }, [filtered, randomPriority]);
  const visible = useMemo(() => displayOrder.slice(0, visibleLimit), [displayOrder, visibleLimit]);
  const blockedKeys = useMemo(() => new Set(blocked.map(normalizeArtistUsageKey)), [blocked]);
  const pool = useMemo(() => buildRollChainArtistSource(chains.filter(chain => selectedChains.has(chain.id)), knownArtists, extract), [chains, selectedChains, knownArtists, extract]);
  const missingSources = loading ? 0 : [...selectedChains].filter(id => !chains.some(chain => chain.id === id)).length;
  const available = pool.artists.filter(artist => !blockedKeys.has(normalizeArtistUsageKey(artist.tag)));
  const chosen = available.filter(artist => !unchecked.has(artist.tag));
  useEffect(() => { if (!pool.artists.length) setArtistsOpen(false); }, [pool.artists.length]);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialog.current)) { event.preventDefault(); close(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [active, close, dialog]);
  const confirm = () => {
    if (!active || loading || error || applied.current || !chosen.length) return;
    applied.current = true;
    onConfirm({ chainIds: pool.chainIds, artists: chosen });
    close();
  };
  const useAllArtists = () => { if (!active || applied.current) return; applied.current = true; onConfirm(undefined); close(); };
  const useAllChains = () => {
    if (!active || loading || error || applied.current) return;
    const all = buildRollChainArtistSource(chains, knownArtists, extract);
    all.artists = all.artists.filter(artist => !blockedKeys.has(normalizeArtistUsageKey(artist.tag)));
    if (!all.artists.length) { setRandomError(t('风格串中没有可用的画师 Tag')); return; }
    applied.current = true;
    onConfirm(all);
    close();
  };
  const changeResults = () => { setVisibleLimit(60); if (gallery.current) gallery.current.scrollTop = 0; };
  const resultKey = JSON.stringify([query, artistsOnly, favOnly, untestedOnly, selectedModel, [...selectedTags].sort(), sort]);
  useEffect(() => { setRandomPriority([]); setRandomError(''); changeResults(); }, [resultKey]);
  const randomDisabled = !active || loading || Boolean(error) || favoritePending;
  const randomlySelect = () => {
    if (randomDisabled) return;
    const count = Number(randomCount);
    if (!Number.isSafeInteger(count) || count < 1) { setRandomError(t('请填写正整数的风格串数量')); return; }
    const candidates = [...new Map(filtered.filter(chain => extract(chain).some(tag => !blockedKeys.has(normalizeArtistUsageKey(tag)) && !unchecked.has(tag))).map(chain => [chain.id, chain])).values()];
    if (count > candidates.length) { setRandomError(t('当前可随机选取 {0} 条风格串，请减少数量或调整筛选', [candidates.length])); return; }
    for (let index = 0; index < count; index++) {
      const next = index + Math.floor(Math.random() * (candidates.length - index));
      [candidates[index], candidates[next]] = [candidates[next], candidates[index]];
    }
    const ids = candidates.slice(0, count).map(chain => chain.id);
    setSelectedChains(new Set(ids)); setRandomPriority(ids); setRandomError(''); changeResults();
  };
  const filterCount = Number(artistsOnly) + Number(favOnly) + Number(untestedOnly) + Number(Boolean(selectedModel)) + selectedTags.size;
  const resultCount = !loading && !favoritePending ? (filterCount || query ? t('匹配 {0} 条 · 共 {1} 条', [filtered.length, chains.length]) : t('共 {0} 条', [filtered.length])) : '';
  const resetFilters = () => { setArtistsOnly(false); setFavOnly(false); setUntestedOnly(false); setSelectedModel(''); setSelectedTags(new Set()); setTagSearch(''); setSort('updated_desc'); };
  const ratio = (chain: PromptChain) => ratios[chain.id] || (chain.params?.width && chain.params?.height ? chain.params.width / chain.params.height : 2 / 3);
  const toggleChain = (id: string) => { setError(''); setSelectedChains(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const renderChain = (chain: PromptChain) => {
    const selected = selectedChains.has(chain.id);
    return <article key={chain.id} data-safe-mode-work="true" role="checkbox" aria-label={chain.name} aria-checked={selected} tabIndex={0}
      onClick={() => toggleChain(chain.id)} onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); toggleChain(chain.id); } }}
      className={`appearance-group mobile-gallery-item gallery-image-card gallery-card-visual group relative min-w-0 cursor-pointer overflow-hidden rounded-xl border bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-gray-850 ${selected ? '!border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-200 hover:border-indigo-500 dark:border-gray-800'}`}>
      <div className="appearance-media mobile-gallery-frame relative flex items-center justify-center overflow-hidden bg-gray-100 dark:bg-gray-900" style={{ '--mobile-image-ratio': String(ratio(chain)), ...(display.layout === 'masonry' ? { aspectRatio: String(ratio(chain)) } : {}) } as React.CSSProperties}>
        <span aria-hidden="true" className={`absolute left-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border shadow backdrop-blur ${selected ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-white/80 bg-black/35 text-transparent'}`}><Check className="h-4 w-4" /></span>
        {chain.previewImage ? <SmartImage src={chain.previewImage} alt="" thumbnailVariant="thumb-640" className="h-full w-full object-contain" containerClassName="h-full w-full" onLoad={event => updateRatio(chain.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} /> : <Layers className="h-12 w-12 text-gray-400" />}
      </div>
      <div className="gallery-card-caption flex min-h-12 flex-col justify-center px-3 py-2"><h3 data-safe-mode-title="true" className="truncate text-sm font-bold text-gray-900 dark:text-gray-100" title={chain.name}>{chain.name}</h3>{!extract(chain).length && <p className="gallery-card-meta truncate text-micro text-gray-500">{t('未识别到画师 Tag')}</p>}</div>
    </article>;
  };
  return <div hidden={!active} className={active ? 'fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-2 backdrop-blur-sm sm:p-6' : 'hidden'} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('从风格串提取')} className="appearance-panel flex h-[94dvh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
      <header className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{t('从风格串提取')}</h2>{resultCount && <p className="truncate text-xs tabular-nums text-gray-500" title={resultCount}>{resultCount}</p>}</div>
        <ToolbarButton tone="primary" className="!px-2 sm:!px-3" disabled={!chosen.length || !active || loading || Boolean(error)} onClick={confirm}>{t('设为抽取来源')}</ToolbarButton>
        <IconButton label="关闭" onClick={close}><X /></IconButton>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <div className="flex max-w-full flex-wrap items-center gap-2"><ToolbarButton disabled={!active} onClick={useAllArtists}>{t('使用画师库')}</ToolbarButton><ToolbarButton disabled={!active || loading || Boolean(error)} onClick={useAllChains}>{t('使用全部风格串')}</ToolbarButton></div>
        <ToolbarSearch aria-label={t('搜索风格串')} placeholder={t('搜索风格串')} value={query} onChange={event => setQuery(event.target.value)} containerClassName="min-w-0 basis-40 flex-1 !max-w-none" />
        <div ref={filterAnchor}><ToolbarButton aria-label={t('筛选')} aria-expanded={filterOpen} active={filterCount > 0 || sort !== 'updated_desc'} onClick={() => { setArtistsOpen(false); setFilterOpen(value => !value); }}><Filter />{t('筛选')}{filterCount > 0 && <span>{filterCount}</span>}</ToolbarButton></div>
        <div className="flex shrink-0 items-center gap-1"><input type="number" min={1} step={1} aria-label={t('随机选取风格串数量')} value={randomCount} disabled={randomDisabled} onChange={event => { setRandomCount(event.target.value); setRandomError(''); }} className="mobile-touch h-10 w-16 rounded-xl border border-gray-200 bg-transparent px-2 text-center text-sm tabular-nums dark:border-gray-700" /><ToolbarButton disabled={randomDisabled} onClick={randomlySelect}><Dice5 />{t('随机选取')}</ToolbarButton></div>
      </div>
      {randomError && <p role="alert" className="shrink-0 px-3 pb-2 text-xs text-red-500">{randomError}</p>}
      {filterOpen && active && <AnchoredToolbarPopover anchorRef={filterAnchor} title={t('筛选')} width={360} allowMobile onClose={closeFilters}>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-gray-500"><span>{filterCount ? t('{0} 项筛选已启用', [filterCount]) : t('全部资料')}</span>{(filterCount > 0 || sort !== 'updated_desc') && <button type="button" className="mobile-touch px-2 text-indigo-600 dark:text-indigo-300" onClick={resetFilters}>{t('重置筛选')}</button>}</div>
          <div className="grid grid-cols-2 gap-3"><ToolbarSelect label="排序" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="updated_desc">{t('最近更新')}</option><option value="updated_asc">{t('最早更新')}</option><option value="created_desc">{t('最近创建')}</option><option value="created_asc">{t('最早创建')}</option></ToolbarSelect><ToolbarSelect label="模型筛选" value={selectedModel} onChange={event => setSelectedModel(event.target.value)}><option value="">{t('全部模型')}</option>{modelOptions.map(model => <option key={model.id} value={model.id}>{t(model.label)}</option>)}</ToolbarSelect></div>
          <div className="flex gap-2"><ToolbarButton active={untestedOnly} aria-pressed={untestedOnly} onClick={() => setUntestedOnly(value => !value)}>{t('只看待实测')}</ToolbarButton><ToolbarButton active={favOnly} aria-pressed={favOnly} onClick={() => setFavOnly(value => !value)}>{t('只看收藏')}</ToolbarButton></div>
          <div><div className="mb-2 flex items-center justify-between text-xs"><span>{t('自定义标签')}</span>{selectedTags.size > 0 && <button type="button" className="mobile-touch px-2 text-gray-500" onClick={() => setSelectedTags(new Set())}>{t('清除标签筛选')}</button>}</div>
            {customTags.length > 12 && <ToolbarSearch aria-label={t('搜索自定义标签')} placeholder={t('搜索标签')} value={tagSearch} onChange={event => setTagSearch(event.target.value)} />}
            {!customTags.length ? <p className="text-xs text-gray-500">{t('暂无自定义标签')}</p> : <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">{tagOptions.map(tag => <button key={tag} type="button" aria-pressed={selectedTags.has(tag)} onClick={() => setSelectedTags(current => { const next = new Set(current); if (next.has(tag)) next.delete(tag); else next.add(tag); return next; })} className={`mobile-touch rounded-full px-3 py-1.5 text-xs ${selectedTags.has(tag) ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'appearance-group bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{tag}</button>)}{!tagOptions.length && <p className="text-xs text-gray-500">{t('没有匹配的标签')}</p>}</div>}
            {selectedTags.size > 1 && <p className="mt-2 text-xs text-gray-500">{t('同时包含所选标签')}</p>}
          </div>
        </div>
      </AnchoredToolbarPopover>}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 text-xs tabular-nums text-gray-500">
        <label className="mobile-touch flex items-center gap-2"><input type="checkbox" checked={artistsOnly} onChange={event => setArtistsOnly(event.target.checked)} />{t('只看有画师 Tag')}</label>
        <div ref={artistsAnchor} className="ml-auto min-w-0"><ToolbarButton className="!px-2 !text-xs" aria-label={t('画师 Tag')} title={t('画师 Tag')} disabled={!pool.artists.length} aria-expanded={artistsOpen} aria-haspopup="dialog" onClick={() => { setFilterOpen(false); setArtistsOpen(value => !value); }}><span aria-live="polite">{t('已选 {0} 串 · {1} 位画师', [pool.chainIds.length, chosen.length])}</span><ChevronDown /></ToolbarButton></div>
      </div>
      {artistsOpen && active && pool.artists.length > 0 && <AnchoredToolbarPopover anchorRef={artistsAnchor} title={t('画师 Tag')} width={440} allowMobile onClose={closeArtists}>
        <div className="mb-2 flex items-center gap-3 text-xs"><button type="button" className="mobile-touch" onClick={() => setUnchecked(new Set())}>{t('全选')}</button><button type="button" className="mobile-touch" onClick={() => setUnchecked(new Set(available.map(artist => artist.tag)))}>{t('取消全选')}</button></div>
        <div className="flex max-h-[50dvh] flex-wrap gap-2 overflow-y-auto">{pool.artists.map(({ tag, count }) => {
          const banned = blockedKeys.has(normalizeArtistUsageKey(tag));
          return <label key={tag} className="mobile-touch flex max-w-full items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700"><input type="checkbox" aria-label={tag} disabled={banned} checked={!banned && !unchecked.has(tag)} onChange={() => setUnchecked(current => { const next = new Set(current); if (next.has(tag)) next.delete(tag); else next.add(tag); return next; })} /><span className="min-w-0 [overflow-wrap:anywhere]">{tag}</span><span className="shrink-0 text-gray-500">{t('出现 {0} 次', [count])}</span>{banned && <span className="text-red-500">{t('已屏蔽 · 不参与 Roll')}</span>}</label>;
        })}</div>
      </AnchoredToolbarPopover>}
      {!loading && !error && missingSources > 0 && <p role="status" className="px-3 pb-2 text-xs text-amber-600">{t('有 {0} 条来源风格串不可用，将按现有条目重新计算', [missingSources])}</p>}
      {error && <p role="alert" className="px-3 pb-2 text-xs text-red-500">{error}{!chains.length && <button type="button" className="mobile-touch ml-2 underline" onClick={() => setRetry(value => value + 1)}>{t('重试')}</button>}</p>}
      {favOnly && favoriteStatus === 'error' && <p role="alert" className="px-3 pb-2 text-xs text-red-500">{favoriteError}<button type="button" className="mobile-touch ml-2 underline" onClick={() => setFavoriteRetry(value => value + 1)}>{t('重试')}</button></p>}
      <div ref={gallery} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" onScroll={event => { const node = event.currentTarget; if (node.scrollHeight - node.scrollTop - node.clientHeight < 400) setVisibleLimit(value => value + 60); }}>
        {(loading || favoritePending && favoriteStatus !== 'error') && <p role="status" className="p-3 text-xs text-gray-500">{t('加载中…')}</p>}
        {!favoritePending && (display.layout === 'masonry' ? <ShortestColumnMasonry items={visible} columns={columns} getItemKey={chain => chain.id} estimateItemHeight={(chain, width) => width / ratio(chain) + 48} renderItem={renderChain} resetKey={resultKey} stableColumns /> : <div className={`${mobileGalleryClassName(display)} workspace-card-grid`} style={mobileGalleryStyle(display, columns)}>{visible.map(renderChain)}</div>)}
        {!favoritePending && filtered.length > visibleLimit && <ToolbarButton className="my-2 w-full" onClick={() => setVisibleLimit(value => value + 60)}>{t('加载更多')}</ToolbarButton>}
        {!loading && !favoritePending && !error && !filtered.length && <p className="p-5 text-center text-xs text-gray-500">{t('没有匹配的风格串')}</p>}
      </div>
    </div>
  </div>;
};
