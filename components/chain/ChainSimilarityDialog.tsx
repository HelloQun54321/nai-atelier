import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, Image, Loader2, Trash2, X } from 'lucide-react';
import type { PromptChain } from '../../types';
import { getArtistSampleDictionary } from '../../services/artistSamples';
import { normalizeRollArtistKey } from '../../services/styleRollSeed';
import { findSimilarChains, getChainComparisonDetails, getChainGroupSimilarity, getChainPromptTokenWeight, parseChainPromptTokens, type ChainSimilarityResult, type ChainStyleProfile } from '../../services/chainSimilarity';
import { getNaiModelDisplayLabel } from '../../services/naiModels';
import { t, useLanguage } from '../../services/i18n';
import { IconButton, ToolbarButton } from '../DesignSystem';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { ImageLightbox } from '../ImageLightbox';
import { SmartImage } from '../SmartImage';
import { PressRevealSurface } from '../PressRevealSurface';
import { useMobileHistoryLayer } from '../MobileUI';
import { isTopmostModal, useModalA11y } from '../useModalA11y';

export interface ChainSimilaritySession {
  source: PromptChain[] | null;
  result: ChainSimilarityResult | null;
  dictionaryMissing: boolean;
  onlyFiltered: boolean;
  expanded: string | null;
  visibleCount: number;
  scrollTop: number;
  detailsOpen: Record<string, boolean>;
}

interface ChainSimilarityDialogProps {
  chains: PromptChain[];
  filteredChains: PromptChain[];
  onClose: () => void;
  onOpenChain: (id: string) => void;
  /** 沿用列表的确认与保存回执；取消或失败不能从对比中移除。 */
  onDelete: (chain: PromptChain) => Promise<boolean>;
  sessionRef?: React.RefObject<ChainSimilaritySession | null>;
}

export const ChainSimilarityDialog: React.FC<ChainSimilarityDialogProps> = props =>
  <ImagePreviewPortal><ChainSimilarityPanel {...props} /></ImagePreviewPortal>;

const matchingTextClass = 'rounded-sm bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300';
type PromptToken = ReturnType<typeof parseChainPromptTokens>[number];
type ComparedPromptToken = PromptToken & { matchingText: boolean; matchingWeight: boolean };
const groupKey = (members: ChainStyleProfile[]) => JSON.stringify(members.map(member => member.chain.id).sort());

/** 全组取次数交集；任何一串缺失的词都不属于交集。 */
const commonTokenCounts = (keys: (string | null)[][]) => {
  const counts = keys.map(items => {
    const result = new Map<string, number>();
    items.forEach(key => { if (key !== null) result.set(key, (result.get(key) || 0) + 1); });
    return result;
  });
  const common = new Map(counts[0]);
  counts.slice(1).forEach(count => common.forEach((amount, key) => {
    const minimum = Math.min(amount, count.get(key) || 0);
    if (minimum) common.set(key, minimum); else common.delete(key);
  }));
  return common;
};

const comparisonPromptTokens = (members: ChainStyleProfile[]): ComparedPromptToken[][] => {
  const tokens = members.map(member => parseChainPromptTokens(member.prompt));
  const commonText = commonTokenCounts(tokens.map(items => items.map(token => token.key)));
  const weightKeys = tokens.map(items => items.map(token => {
    const weight = getChainPromptTokenWeight(token);
    return weight === null ? null : JSON.stringify([token.key, Number(weight.toPrecision(12))]);
  }));
  const commonWeights = commonTokenCounts(weightKeys);
  return tokens.map((items, index) => {
    const textRemaining = new Map(commonText), weightRemaining = new Map(commonWeights);
    // 先匹配全组共有的权重项，避免前面不同权重的同名词占掉交集次数。
    const compared = items.map((token, position) => {
      const key = weightKeys[index][position], count = key === null ? 0 : weightRemaining.get(key) || 0;
      const matchingWeight = count > 0;
      if (matchingWeight) {
        weightRemaining.set(key!, count - 1);
        textRemaining.set(token.key, textRemaining.get(token.key)! - 1);
      }
      return { ...token, matchingText: matchingWeight, matchingWeight };
    });
    return compared.map(token => {
      if (token.matchingWeight) return token;
      const count = textRemaining.get(token.key) || 0;
      if (count) textRemaining.set(token.key, count - 1);
      return { ...token, matchingText: count > 0 };
    });
  });
};

const PromptTokenText = ({ token }: { token: ComparedPromptToken }) => {
  if (token.matchingWeight) return <mark className={matchingTextClass}>{token.raw}</mark>;
  if (!token.matchingText) return <>{token.raw}</>;
  const start = token.raw.indexOf(token.text);
  // 权重不同或语义未知时只强调词本体，保留差异可见。
  return start < 0 ? <>{token.raw}</> : <>{token.raw.slice(0, start)}<mark className={matchingTextClass}>{token.text}</mark>{token.raw.slice(start + token.text.length)}</>;
};

const ChainCard = ({ profile, tokens, onOpen, onDelete, deletingId, busy, detailsOpen, onDetailsChange }: {
  profile: ChainStyleProfile; tokens: ComparedPromptToken[]; onOpen: (id: string) => void;
  onDelete: (chain: PromptChain) => void; deletingId: string | null; busy: boolean;
  detailsOpen: boolean; onDetailsChange: (open: boolean) => void;
}) => {
  const { chain } = profile;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptOverflow, setPromptOverflow] = useState(false);
  const promptRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const element = promptRef.current;
    if (!element || promptOpen) return;
    const measure = () => setPromptOverflow(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [tokens, promptOpen]);
  return <><section aria-label={chain.name} data-safe-mode-work="true" className="min-w-0 rounded-xl border border-gray-200 dark:border-gray-800">
    <PressRevealSurface className="relative h-80 max-h-[60dvh] overflow-hidden rounded-t-xl md:h-96 2xl:h-[28rem]" tabIndex={0} aria-label={chain.name}>
      {chain.previewImage
        ? <button type="button" disabled={busy} className="h-full w-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500" aria-label={t('放大查看：{0}', [chain.name])} onClick={event => { event.stopPropagation(); setPreviewOpen(true); }}>
          <SmartImage src={chain.previewImage} alt={chain.name} thumbnailVariant="thumb-960" className="h-full w-full object-contain" containerClassName="relative h-full w-full" />
        </button>
        : <div className="flex h-full items-center justify-center text-gray-400"><Image className="h-6 w-6" /></div>}
      <div data-card-action="true" data-image-action-left className="hover-reveal-md absolute left-2 top-2 z-20">
        <button type="button" disabled={busy} aria-busy={deletingId === chain.id}
          onClick={event => { event.stopPropagation(); onDelete(chain); }}
          className="mobile-size-locked flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 md:h-8 md:w-8"
          aria-label={t('删除：{0}', [chain.name])} title={t('删除')}>
          {deletingId === chain.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    </PressRevealSurface>
    <div className="space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><h3 data-safe-mode-title="true" className="break-words text-sm font-bold">{chain.name}</h3><p className="mt-1 text-xs text-gray-500">{chain.params?.model ? getNaiModelDisplayLabel(chain.params.model) : t('模型未记录')}</p></div>
        <IconButton label={t('打开原串：{0}', [chain.name])} disabled={busy} onClick={() => onOpen(chain.id)}><ExternalLink /></IconButton>
      </div>
      <div><h4 className="mb-2 text-xs font-semibold text-gray-500">{t('全局正向提示词')}</h4>
        <p ref={promptRef} className={`whitespace-pre-wrap break-words font-mono text-xs leading-relaxed ${promptOpen ? '' : 'line-clamp-4'}`}>{tokens.length
          ? tokens.map((token, index) => <React.Fragment key={index}>{index > 0 && ', '}<PromptTokenText token={token} /></React.Fragment>)
          : <span className="text-gray-500">{t('无')}</span>}</p>
        {(promptOverflow || promptOpen) && <button type="button" aria-expanded={promptOpen} onClick={() => setPromptOpen(open => !open)}
          className="mobile-touch mt-1 text-xs text-indigo-600 hover:underline dark:text-indigo-300">{promptOpen ? t('收起提示词') : t('展开提示词（{0} 项）', [tokens.length])}</button>}
      </div>
      <details open={detailsOpen} onToggle={event => { if (event.currentTarget.open !== detailsOpen) onDetailsChange(event.currentTarget.open); }} className="border-t border-gray-200 pt-2 dark:border-gray-800">
        <summary className="mobile-touch cursor-pointer text-xs font-semibold text-gray-500">{t('其余提示词与配置')}</summary>
        {detailsOpen && <div className="space-y-3 pt-2">
          {profile.uncertainWeights && <p className="text-xs text-amber-700 dark:text-amber-300">{t('权重语义待核对')}</p>}
          {[{ label: '完整提示词', value: profile.prompt }, ...getChainComparisonDetails(chain)].map(row => row.value && <div key={row.label}>
            <h4 className="mb-1 text-xs font-semibold text-gray-500">{t(row.label)}</h4>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{row.value}</pre>
          </div>)}
        </div>}
      </details>
    </div>
  </section>{previewOpen && chain.previewImage && <ImageLightbox src={chain.previewImage} alt={chain.name} filename={`${chain.name || 'cover'}.png`} onClose={() => setPreviewOpen(false)} />}</>;
};

const GroupComparison = ({ members, ...props }: Omit<React.ComponentProps<typeof ChainCard>, 'profile' | 'tokens' | 'detailsOpen' | 'onDetailsChange'> & {
  members: ChainStyleProfile[]; detailsOpen: Record<string, boolean>; onDetailsChange: (id: string, open: boolean) => void;
}) => {
  const tokens = useMemo(() => comparisonPromptTokens(members), [members]);
  return <div className={`grid grid-cols-1 items-start gap-3 px-3 pb-3 md:grid-cols-2 ${members.length > 2 ? 'lg:grid-cols-3' : ''} md:px-4 md:pb-4`}>
    {members.map((profile, index) => <ChainCard key={profile.chain.id} {...props} profile={profile} tokens={tokens[index]}
      detailsOpen={Boolean(props.detailsOpen[profile.chain.id])} onDetailsChange={open => props.onDetailsChange(profile.chain.id, open)} />)}
  </div>;
};

const ChainSimilarityPanel: React.FC<ChainSimilarityDialogProps> = ({ chains, filteredChains, onClose, onOpenChain, onDelete, sessionRef }) => {
  useLanguage();
  const localSession = useRef<ChainSimilaritySession | null>(null);
  const session = sessionRef || localSession;
  const saved = session.current;
  const dialogRef = useModalA11y<HTMLElement>(true);
  const deletingRef = useRef(false);
  const requestClose = useMobileHistoryLayer(true, () => {
    if (deletingRef.current) return false;
    onClose();
  }, 'chain-similarity');
  const [onlyFiltered, setOnlyFiltered] = useState(saved?.onlyFiltered || false);
  const [result, setResult] = useState<ChainSimilarityResult | null>(saved?.result || null);
  const [dictionaryMissing, setDictionaryMissing] = useState(saved?.dictionaryMissing || false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [progress, setProgress] = useState({ stage: 'extract', completed: 0, total: 0 });
  const [expanded, setExpanded] = useState<string | null>(saved?.expanded || null);
  const [visibleCount, setVisibleCount] = useState(saved?.visibleCount || 40);
  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>(saved?.detailsOpen || {});
  const scrollRef = useRef<HTMLDivElement>(null);
  const resultSource = useRef(saved?.source || null);
  const source = onlyFiltered ? filteredChains : chains;
  const [scanning, setScanning] = useState(saved?.source !== source);

  useLayoutEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = session.current?.scrollTop || 0; }, [result, session]);
  useEffect(() => {
    session.current = { source: resultSource.current, result, dictionaryMissing, onlyFiltered, expanded, visibleCount, detailsOpen,
      scrollTop: scrollRef.current?.scrollTop || 0 };
  }, [session, result, dictionaryMissing, onlyFiltered, expanded, visibleCount, detailsOpen]);
  useEffect(() => {
    if (resultSource.current === source && retry === 0) return;
    const controller = new AbortController();
    setError(''); setDictionaryMissing(false); setScanning(true);
    setProgress({ stage: 'extract', completed: 0, total: source.length });
    void (async () => {
      let knownArtists = new Set<string>();
      try { knownArtists = new Set((await getArtistSampleDictionary()).map(entry => normalizeRollArtistKey(entry.name))); }
      catch { if (!controller.signal.aborted) setDictionaryMissing(true); }
      if (controller.signal.aborted) return;
      try {
        const found = await findSimilarChains(source, knownArtists, controller.signal, (stage, completed, total) => setProgress({ stage, completed, total }));
        if (!controller.signal.aborted) {
          const hadResult = resultSource.current !== null;
          resultSource.current = source;
          setResult(found);
          setExpanded(current => {
            if (!current) return hadResult ? null : found.groups[0] ? groupKey(found.groups[0].members) : null;
            const ids = JSON.parse(current) as string[];
            const group = found.groups.find(group => groupKey(group.members) === current)
              || found.groups.find(group => group.members.some(member => ids.includes(member.chain.id))) || found.groups[0];
            return group ? groupKey(group.members) : null;
          });
        }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t('相似查找失败')); }
      finally { if (!controller.signal.aborted) setScanning(false); }
    })();
    return () => controller.abort();
  }, [source, retry]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && event.key === 'Escape' && isTopmostModal(dialogRef.current)) { event.preventDefault(); if (!deletingRef.current) requestClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogRef, requestClose]);

  const openOriginal = async (id: string) => {
    if (deletingRef.current) return;
    const returned = window.history.state?.__naiMobileLayer?.startsWith('chain-similarity-')
      ? new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true })) : null;
    requestClose();
    if (returned) await returned;
    onOpenChain(id);
  };
  const deleteOriginal = async (chain: PromptChain) => {
    if (deletingRef.current) return;
    deletingRef.current = true; setDeletingId(chain.id); setError('');
    try {
      if (!await onDelete(chain)) return;
      setResult(previous => {
        if (!previous || !previous.groups.some(group => group.members.some(member => member.chain.id === chain.id))) return previous;
        const groups = previous.groups.flatMap(group => {
          if (!group.members.some(member => member.chain.id === chain.id)) return [group];
          const members = group.members.filter(member => member.chain.id !== chain.id);
          return members.length > 1 ? [{ members, similarity: getChainGroupSimilarity(members) }] : [];
        });
        const uniqueGroups = [...new Map(groups.map(group => [groupKey(group.members), group])).values()]
          .sort((left, right) => right.similarity - left.similarity);
        return { ...previous, groups: uniqueGroups, total: previous.total - 1,
          matched: new Set(uniqueGroups.flatMap(group => group.members.map(member => member.chain.id))).size };
      });
      setExpanded(current => {
        if (!current) return null;
        const ids = (JSON.parse(current) as string[]).filter(id => id !== chain.id);
        return ids.length > 1 ? JSON.stringify(ids) : null;
      });
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('删除失败，请稍后重试')); }
    finally { deletingRef.current = false; setDeletingId(null); }
  };

  return <div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-end justify-center bg-black/55 backdrop-blur-sm md:items-center md:p-4" onPointerDown={event => { if (event.target === event.currentTarget && !deletingRef.current) requestClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('查找相似')} aria-busy={scanning} className="appearance-panel ui-sheet-enter mobile-safe-bottom flex max-h-[92dvh] w-full max-w-[96rem] flex-col overflow-hidden rounded-t-3xl border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 md:rounded-2xl">
      <header className="flex flex-none items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800"><h2 className="text-base font-bold">{t('查找相似')}</h2><IconButton label={t('关闭')} disabled={deletingId !== null} onClick={requestClose}><X /></IconButton></header>
      <div className="flex flex-none flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
        <p role="status">{deletingId ? t('正在删除：{0}', [chains.find(chain => chain.id === deletingId)?.name || ''])
          : scanning ? progress.completed === 0 ? t('正在读取本地画师词库…') : progress.stage === 'extract' ? t('正在识别 {0}/{1}', [progress.completed, progress.total]) : t('正在分组 {0}/{1}', [progress.completed, progress.total])
          : result ? t('已扫描 {0} 条 · {1} 组相似 · 涉及 {2} 条 · 线索不足 {3} 条', [result.total, result.groups.length, result.matched, result.insufficient.length]) : t('相似查找失败')}</p>
        <label className="mobile-touch flex cursor-pointer items-center gap-2"><input type="checkbox" checked={onlyFiltered} disabled={deletingId !== null} onChange={event => {
          setOnlyFiltered(event.target.checked); setResult(null); setExpanded(null); setVisibleCount(40); resultSource.current = null;
          if (session.current) session.current.scrollTop = 0;
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        }} />{t('仅当前筛选结果')}</label>
      </div>
      {dictionaryMissing && <p role="alert" className="px-4 pb-3 text-xs text-amber-700 dark:text-amber-300">{t('本地画师词库不可用，裸画师名可能漏识别；仍比较显式画师与画风词。')}</p>}
      <div ref={scrollRef} onScroll={event => { if (session.current) session.current.scrollTop = event.currentTarget.scrollTop; }} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 md:px-4">
        {error && <div role="alert" className="flex items-center justify-center gap-3 py-4 text-sm text-red-500">{error}{!result && <ToolbarButton onClick={() => setRetry(value => value + 1)}>{t('重试')}</ToolbarButton>}</div>}
        {!result && !error && <div className="flex justify-center py-12"><Loader2 aria-label={t('正在查找相似风格串')} className="h-6 w-6 animate-spin motion-reduce:animate-none text-gray-400" /></div>}
        {result && !result.groups.length && <p className="py-8 text-center text-sm text-gray-500">{t('未找到具有足够共同画风线索的风格串')}</p>}
        {result?.groups.slice(0, visibleCount).map(({ members, similarity }) => {
          const key = groupKey(members), id = `similarity-group-${encodeURIComponent(key)}`, open = expanded === key;
          return <article key={key} className="mb-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setExpanded(open ? null : key)} className="mobile-touch flex w-full items-center gap-3 px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 md:px-4">
              <span data-safe-mode-title="true" className="min-w-0 flex-1 truncate text-sm font-semibold">{members[0].chain.name}</span>
              <span className="shrink-0 whitespace-nowrap text-xs text-gray-500">{t('{0} 条相似', [members.length])}</span>
              <span title={t('组内最低相似度')} className="shrink-0 whitespace-nowrap text-xs tabular-nums text-gray-500">{t('相似度 {0}%', [Math.round(similarity * 1000) / 10])}</span>
              <ChevronDown className={`h-4 w-4 flex-none transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && <div id={id}><GroupComparison members={members} onOpen={id => void openOriginal(id)} onDelete={chain => void deleteOriginal(chain)} deletingId={deletingId} busy={scanning || deletingId !== null}
              detailsOpen={detailsOpen} onDetailsChange={(chainId, value) => setDetailsOpen(current => ({ ...current, [chainId]: value }))} /></div>}
          </article>;
        })}
        {result && visibleCount < result.groups.length && <ToolbarButton onClick={() => setVisibleCount(count => count + 40)}>{t('加载更多')}</ToolbarButton>}
        {result && result.insufficient.length > 0 && <details className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-800"><summary className="mobile-touch cursor-pointer text-xs text-gray-500">{t('线索不足 {0} 条', [result.insufficient.length])}</summary>
          <p className="py-2 text-xs text-gray-500">{t('画风线索不足或权重语义待核对，可打开原串核对。')}</p>
          {result.insufficient.map(profile => <button key={profile.chain.id} type="button" disabled={deletingId !== null} onClick={() => void openOriginal(profile.chain.id)} className="mobile-touch flex w-full items-center justify-between gap-3 border-t border-gray-100 py-2 text-left text-sm dark:border-gray-800"><span data-safe-mode-title="true" className="min-w-0 truncate">{profile.chain.name}</span>{profile.uncertainWeights && <span className="text-xs text-amber-700 dark:text-amber-300">{t('权重语义待核对')}</span>}<ExternalLink className="h-4 w-4 flex-none" /></button>)}
        </details>}
      </div>
    </section>
  </div>;
};
