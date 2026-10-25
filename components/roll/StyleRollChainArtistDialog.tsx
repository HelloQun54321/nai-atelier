import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Layers, X } from 'lucide-react';
import type { PromptChain } from '../../types';
import { t, useLanguage } from '../../services/i18n';
import { extractRollChainArtistTags } from '../../services/styleRollChainArtists';
import { normalizeArtistUsageKey } from '../../services/artistParticipation';
import { db } from '../../services/dbService';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { ImageActivityContext, SmartImage } from '../SmartImage';
import { IconButton, ToolbarButton, ToolbarSearch } from '../DesignSystem';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { useMobileHistoryLayer } from '../MobileUI';

interface Props {
  knownArtists: ReadonlySet<string>;
  pinned: string[];
  blocked: string[];
  limit: number;
  onConfirm: (tags: string[]) => void;
  onClose: () => void;
}

export const StyleRollChainArtistDialog: React.FC<Props> = props => <ImagePreviewPortal><ChainArtistContent {...props} /></ImagePreviewPortal>;

const ChainArtistContent: React.FC<Props> = ({ knownArtists, pinned, blocked, limit, onConfirm, onClose }) => {
  useLanguage();
  const active = useContext(ImageActivityContext);
  const dialog = useModalA11y<HTMLDivElement>(active);
  const close = useMobileHistoryLayer(active, onClose, 'roll-chain-artists');
  const applied = useRef(false);
  const [chains, setChains] = useState<PromptChain[]>([]), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [query, setQuery] = useState(''), [visibleLimit, setVisibleLimit] = useState(60), [error, setError] = useState('');
  const [selectedChains, setSelectedChains] = useState(new Set<string>()), [unchecked, setUnchecked] = useState(new Set<string>());
  useEffect(() => {
    if (!active) return;
    let current = true; setLoading(true); setError(''); setChains([]);
    void db.getAllChains().then(values => { if (current) setChains(values.filter(chain => !chain.type || chain.type === 'style')); })
      .catch(cause => { if (current) setError((cause as Error).message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, retry]);
  const parsed = useMemo(() => new Map<PromptChain, string[]>(), [knownArtists]);
  const extract = (chain: PromptChain) => {
    let tags = parsed.get(chain);
    if (!tags) { tags = extractRollChainArtistTags(chain, knownArtists); parsed.set(chain, tags); }
    return tags;
  };
  const filtered = useMemo(() => chains.filter(chain => chain.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [chains, query]);
  const pinnedKeys = useMemo(() => new Set(pinned.map(normalizeArtistUsageKey)), [pinned]);
  const blockedKeys = useMemo(() => new Set(blocked.map(normalizeArtistUsageKey)), [blocked]);
  const tags = [...new Set(chains.filter(chain => selectedChains.has(chain.id)).flatMap(extract))];
  const available = tags.filter(tag => !pinnedKeys.has(normalizeArtistUsageKey(tag)) && !blockedKeys.has(normalizeArtistUsageKey(tag)));
  const chosen = available.filter(tag => !unchecked.has(tag));
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialog.current)) { event.preventDefault(); close(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [active, close, dialog]);
  const confirm = () => {
    if (!active || loading || error || applied.current || !chosen.length) return;
    if (pinned.length + chosen.length > Math.min(64, limit)) { setError(t('最多可添加 {0} 位画师', [Math.min(64, limit)])); return; }
    applied.current = true;
    onConfirm([...pinned, ...chosen]);
    close();
  };
  return <div hidden={!active} className={active ? 'fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-2 backdrop-blur-sm sm:p-6' : 'hidden'} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('从风格串提取')} className="appearance-panel flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
      <header className="flex shrink-0 items-center gap-2 border-b border-gray-200 p-3 dark:border-gray-800"><h2 className="min-w-0 flex-1 text-sm font-semibold">{t('从风格串提取')}</h2><IconButton label="关闭" onClick={close}><X /></IconButton></header>
      <div className="shrink-0 p-3"><ToolbarSearch aria-label={t('搜索风格串')} placeholder={t('搜索风格串')} value={query} onChange={event => { setQuery(event.target.value); setVisibleLimit(60); }} containerClassName="!max-w-none" /></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3" onScroll={event => { const node = event.currentTarget; if (node.scrollHeight - node.scrollTop - node.clientHeight < 400) setVisibleLimit(value => value + 60); }}>
        {loading && <p role="status" className="p-3 text-xs text-gray-500">{t('加载中…')}</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{filtered.slice(0, visibleLimit).map(chain => <label key={chain.id} className="mobile-touch flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
          <input type="checkbox" aria-label={chain.name} checked={selectedChains.has(chain.id)} onChange={() => { setError(''); setSelectedChains(current => { const next = new Set(current); if (next.has(chain.id)) next.delete(chain.id); else next.add(chain.id); return next; }); }} />
          <div className="h-14 w-11 shrink-0 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">{chain.previewImage ? <SmartImage src={chain.previewImage} alt="" thumbnailVariant="thumb-320" containerClassName="h-full w-full" /> : <Layers className="m-auto h-full w-5 text-gray-400" />}</div>
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{chain.name}</span>{!extract(chain).length && <span className="block text-micro text-gray-500">{t('未识别到画师 Tag')}</span>}</span>
        </label>)}</div>
        {filtered.length > visibleLimit && <ToolbarButton className="my-2 w-full" onClick={() => setVisibleLimit(value => value + 60)}>{t('加载更多')}</ToolbarButton>}
        {!loading && !error && !filtered.length && <p className="p-5 text-center text-xs text-gray-500">{t('没有匹配的风格串')}</p>}
      </div>
      {tags.length > 0 && <section className="shrink-0 border-t border-gray-200 p-3 dark:border-gray-800" aria-label={t('画师 Tag')}>
        <div className="mb-2 flex items-center gap-3 text-xs"><button type="button" className="mobile-touch" onClick={() => { setError(''); setUnchecked(new Set()); }}>{t('全选')}</button><button type="button" className="mobile-touch" onClick={() => { setError(''); setUnchecked(new Set(available)); }}>{t('取消全选')}</button><span className="ml-auto tabular-nums text-gray-500">{t('固定 {0} 位', [pinned.length + chosen.length])}</span></div>
        <div className="flex max-h-[24dvh] flex-wrap gap-2 overflow-y-auto">{tags.map(tag => {
          const fixed = pinnedKeys.has(normalizeArtistUsageKey(tag)), banned = blockedKeys.has(normalizeArtistUsageKey(tag));
          return <label key={tag} className="mobile-touch flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700"><input type="checkbox" aria-label={tag} disabled={fixed || banned} checked={fixed || !banned && !unchecked.has(tag)} onChange={() => { setError(''); setUnchecked(current => { const next = new Set(current); if (next.has(tag)) next.delete(tag); else next.add(tag); return next; }); }} /><span>{tag}</span>{fixed ? <span className="text-gray-500">{t('已固定')}</span> : banned ? <span className="text-red-500">{t('已屏蔽 · 不参与 Roll')}</span> : null}</label>;
        })}</div>
      </section>}
      {error && <p role="alert" className="px-3 pb-2 text-xs text-red-500">{error}{!chains.length && <button type="button" className="mobile-touch ml-2 underline" onClick={() => setRetry(value => value + 1)}>{t('重试')}</button>}</p>}
      <footer className="flex shrink-0 justify-end gap-2 border-t border-gray-200 p-3 dark:border-gray-800"><ToolbarButton onClick={close}>{t('取消')}</ToolbarButton><ToolbarButton tone="primary" disabled={!chosen.length || !active || loading || Boolean(error)} onClick={confirm}>{t('确认提取')}</ToolbarButton></footer>
    </div>
  </div>;
};
