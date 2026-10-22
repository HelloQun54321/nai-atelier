import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ImageIcon, SlidersHorizontal, X } from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import type { ArtistDictionaryEntry, ArtistDictionarySort } from '../../services/tagDictionary';
import { compareLibraryTags } from '../../services/tagLibrary';
import type { RollRules } from '../../services/styleRoll';
import { normalizeArtistSampleTag, type ArtistSamplePack } from '../../services/artistSamples';
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
  const [defaultPack] = useState<ArtistSamplePack>(() => localStorage.getItem('nai_artist_sample_pack') === 'v5' ? 'v5' : 'v45');
  const [cardPacks, setCardPacks] = useState<Record<string, ArtistSamplePack>>({});
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [limit, setLimit] = useState(60);
  const [sort, setSort] = useState<ArtistDictionarySort>(() => {
    const saved = localStorage.getItem('nai_roll_artist_sort') || localStorage.getItem('nai_artist_sort');
    return saved === 'least' || saved === 'name-asc' || saved === 'name-desc' ? saved : 'popular';
  });
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
    void ensureCollection().catch(cause => { if (current) setError((cause as Error).message); });
    return () => { current = false; };
  }, []);
  const pinnedKeys = useMemo(() => new Set(pinned.map(normalizeRollArtistKey)), [pinned]);
  const blockedKeys = useMemo(() => new Set([...blocked, ...excluded].map(normalizeRollArtistKey)), [blocked, excluded]);
  const artists = useMemo(() => {
    const entries = new Map(library.map(entry => [normalizeRollArtistKey(entry.name), entry]));
    for (const tag of [...pinned, ...blocked, ...excluded, ...collection.filter(item => item.sourceType === 'artist' && !item.archived && item.sourceId).map(item => item.sourceId!)]) if (!entries.has(normalizeRollArtistKey(tag))) entries.set(normalizeRollArtistKey(tag), { name: tag, chinese: '', postCount: 0 });
    const search = normalizeRollArtistKey(query);
    return [...entries.values()].filter(entry => {
      const key = normalizeRollArtistKey(entry.name);
      return (!search || key.includes(search) || entry.chinese?.includes(query.trim())) && (filter === 'all' || filter === 'pinned' && pinnedKeys.has(key) || filter === 'preferred' && preferred.has(key) || filter === 'blocked' && blockedKeys.has(key));
    }).sort((left, right) => compareLibraryTags(left, right, sort));
  }, [library, pinned, blocked, excluded, collection, query, filter, pinnedKeys, preferred, blockedKeys, sort]);
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
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800 lg:px-5">
        <h2 className="min-w-0 flex-1 text-base font-semibold tracking-tight sm:flex-none">{t('管理画师与偏好')}</h2>
        <ToolbarSearch containerClassName="order-last basis-full !max-w-none sm:order-none sm:basis-0" aria-label={t('搜索画师')} placeholder={t('搜索画师 Tag 或中文名')} value={query} onChange={event => { setQuery(event.target.value); setLimit(60); if (gallery.current) gallery.current.scrollTop = 0; }} />
        <div ref={settingsAnchor} className="shrink-0"><ToolbarButton aria-label={t('抽取设置')} aria-expanded={settingsOpen} aria-haspopup="dialog" active={settingsOpen} onClick={() => setSettingsOpen(value => !value)}><SlidersHorizontal /><span className="hidden sm:inline">{t('抽取设置')}</span></ToolbarButton></div>
        <ToolbarButton tone="primary" disabled={busy} onClick={close}>{t('完成')}</ToolbarButton>
      </header>
      <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2 sm:px-5">
        <div role="group" aria-label={t('画师范围')} className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {([['all', '全部画师', undefined], ['pinned', '已锁定', pinned.length], ['preferred', '偏好画师', preferred.size], ['blocked', '已屏蔽', blockedKeys.size]] as const).map(([value, label, total]) => <button key={value} type="button" aria-label={t(label)} aria-pressed={filter === value} onClick={() => changeFilter(value)} className={`mobile-touch flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors ${filter === value ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>{t(label)}{total !== undefined && <span className="text-micro tabular-nums opacity-70">{total}</span>}</button>)}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs tabular-nums text-gray-400 lg:block">{t('{0} 位画师', [artists.length])}</span>
          <ToolbarSelect label="画师排序" value={sort} className="!text-xs" onChange={event => {
            const value = event.target.value as ArtistDictionarySort; setSort(value); setLimit(60);
            if (gallery.current) gallery.current.scrollTop = 0;
            try { localStorage.setItem('nai_roll_artist_sort', value); } catch { /* 无法持久保存时仍保留本次选择。 */ }
          }}>
            <option value="popular">{t('热度从高到低')}</option><option value="least">{t('热度从低到高')}</option><option value="name-asc">{t('名称 A → Z')}</option><option value="name-desc">{t('名称 Z → A')}</option>
          </ToolbarSelect>
        </div>
      </div>
      {error && <p role="alert" className="shrink-0 px-4 pb-2 text-xs text-red-500">{t(error)}</p>}
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
            const key = normalizeRollArtistKey(artist.name), selected = pinnedKeys.has(key), banned = blockedKeys.has(key), favorite = preferred.has(key), pack = cardPacks[key] || defaultPack, url = urls[pack].get(normalizeArtistSampleTag(artist.name));
            return <PressRevealSurface as="article" key={key} pressDisabled data-safe-mode-work="true" role="button" aria-label={t('锁定画师：{0}', [artist.name])} aria-pressed={selected} aria-disabled={busy} tabIndex={busy ? -1 : 0} onClick={() => { if (!busy) pin(artist.name); }} onKeyDown={event => { if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key) || busy) return; event.preventDefault(); pin(artist.name); }} className={`appearance-group gallery-image-card gallery-card-visual relative min-w-0 cursor-pointer overflow-hidden rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-gray-900 ${selected ? 'ring-2 ring-indigo-500' : ''}`}>
              <div className="appearance-media mobile-gallery-frame relative aspect-[2/3] overflow-hidden bg-gray-100 dark:bg-gray-950">
                <div className="absolute inset-0 h-full w-full">
                  {url ? <SmartImage src={url} alt={artist.chinese || artist.name} className="h-full w-full object-contain" previewTransform={url.startsWith('/api/artist-samples/image?') ? 'artist-sample-padding-v1' : undefined} /> : <span className="flex h-full flex-col items-center justify-center gap-2 text-xs text-gray-400"><ImageIcon className="h-7 w-7 opacity-40" strokeWidth={1.25} />{t('暂无样张')}</span>}
                </div>
                <ArtistPreferenceActions tag={artist.name} pack={pack} onPackChange={value => setCardPacks(current => ({ ...current, [key]: value }))} blocked={banned} preferred={favorite} disabled={busy} onBlock={() => void block(artist.name)} onFavorite={() => void perform(async () => { await toggleArtistPreference(artist.name, url || ''); })} />
              </div>
              <div className="gallery-card-caption !min-h-0 !px-2 !py-1.5 text-center before:!top-[-0.75rem]"><p data-safe-mode-title="true" className="truncate text-sm font-bold text-gray-900 dark:text-white" title={artist.name}>{selected && <Check aria-hidden="true" className="mr-1 inline h-3.5 w-3.5 text-indigo-500" strokeWidth={3} />}{artist.name}</p>{(banned || artist.chinese && artist.chinese !== artist.name) && <p className={`gallery-card-meta mt-0.5 truncate text-micro ${banned ? 'text-red-500' : 'text-gray-500'}`} data-safe-mode-title="true">{banned ? t('已屏蔽 · 不参与 Roll') : artist.chinese}</p>}</div>
            </PressRevealSurface>;
          })}
        </div>
        {artists.length > limit && <ToolbarButton className="mt-5 w-full" onClick={() => setLimit(current => current + 60)}>{t('加载更多')}</ToolbarButton>}
        {!loading && !artists.length && <p className="p-8 text-center text-sm text-gray-500">{t('没有匹配的画师')}</p>}
      </div>
    </div>
  </div>;
};
