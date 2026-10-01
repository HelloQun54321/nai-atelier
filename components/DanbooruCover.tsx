import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon } from 'lucide-react';
import { DanbooruCoverCandidate, DanbooruCoverSet, danbooruService } from '../services/danbooruService';
import { SmartImage } from './SmartImage';

interface DanbooruCoverProps {
  tag: string;
  kind: 'artist' | 'character';
  alt: string;
  fixedSrc?: string;
  onCandidateChange?: (candidate: DanbooruCoverCandidate | null) => void;
  /** 封面图片加载完成后上报自然宽高（瀑布流按真实比例排布用）。 */
  onImageLoad?: (width: number, height: number) => void;
}

export const DanbooruCover: React.FC<DanbooruCoverProps> = ({ tag, kind, alt, fixedSrc = '', onCandidateChange, onImageLoad }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activated, setActivated] = useState(false);
  const [coverSet, setCoverSet] = useState<DanbooruCoverSet | null | undefined>(undefined);
  const [candidateIndex, setCandidateIndex] = useState<number | null>(fixedSrc ? null : 0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextSourcePage, setNextSourcePage] = useState(1);
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set());
  const [lookupError, setLookupError] = useState('');
  const sessionRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const automaticPagesLeft = useRef(3);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || !('IntersectionObserver' in window)) {
      setActivated(true);
      return;
    }
    const root = (() => {
      let parent = node.parentElement;
      while (parent) {
        if (/auto|scroll|overlay/.test(getComputedStyle(parent).overflowY)) return parent;
        parent = parent.parentElement;
      }
      return null;
    })();
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) return;
      setActivated(true);
      observer.disconnect();
    }, { root, rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [tag]);

  useEffect(() => {
    if (!activated) return;
    const session = ++sessionRef.current;
    let active = true;
    setCoverSet(undefined);
    setCandidateIndex(fixedSrc ? null : 0);
    setNextSourcePage(1);
    setFailedSources(new Set()); setLookupError(''); setIsLoadingMore(false);
    loadingMoreRef.current = false; automaticPagesLeft.current = 3;
    const load = async () => {
      try {
        const result = await danbooruService.getCoverSet(tag, kind);
        if (!active) return;
        setCoverSet(result);
        setNextSourcePage(result.nextPage || 1);
        if (!fixedSrc) setCandidateIndex(0);
      } catch {
        await new Promise(resolve => window.setTimeout(resolve, 2000));
        if (!active) return;
        try {
          const result = await danbooruService.getCoverSet(tag, kind);
          if (active) {
            setCoverSet(result);
            setNextSourcePage(result.nextPage || 1);
            if (!fixedSrc) setCandidateIndex(0);
          }
        } catch {
          if (active) setCoverSet(null);
        }
      }
    };
    void load();
    return () => { active = false; if (sessionRef.current === session) sessionRef.current++; };
  }, [activated, fixedSrc, kind, tag]);

  const candidates = coverSet?.candidates || [];
  const currentCandidate = candidateIndex === null ? null : candidates[candidateIndex];
  const sourceFor = (candidate: DanbooruCoverCandidate | null | undefined) =>
    [candidate?.sampleUrl, candidate?.previewUrl].find(source => source && !failedSources.has(source)) || '';
  const displayedSrc = candidateIndex === null && fixedSrc && !failedSources.has(fixedSrc)
    ? fixedSrc : currentCandidate ? sourceFor(currentCandidate) : sourceFor(coverSet?.representative);
  const isSavedCover = candidateIndex === null && displayedSrc === fixedSrc && Boolean(fixedSrc);
  const previousIndex = candidates.findLastIndex((candidate, index) => candidateIndex !== null && index < candidateIndex && Boolean(sourceFor(candidate)));
  const nextIndex = candidates.findIndex((candidate, index) => (candidateIndex === null || index > candidateIndex) && Boolean(sourceFor(candidate)));
  const canBrowse = candidates.length > 0;
  useEffect(() => { onCandidateChange?.(currentCandidate && displayedSrc ? { ...currentCandidate, sampleUrl: displayedSrc } : null); }, [currentCandidate, displayedSrc, onCandidateChange]);
  // 拿到候选集后预热前几张封面：首张显示命中缓存，点“下一张”也顺滑（与直接加载单飞，不重复抓取）。
  useEffect(() => {
    const sources = (coverSet?.candidates || []).slice(0, 3).map(candidate => candidate.sampleUrl).filter(Boolean);
    if (!sources.length) return;
    fetch('/api/media/prewarm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources }),
    }).catch(() => {});
  }, [coverSet]);
  const loadNextCandidatePage = async (automatic = false) => {
    if (!coverSet?.hasMore || loadingMoreRef.current || (automatic && automaticPagesLeft.current <= 0)) return false;
    const session = sessionRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    setLookupError('');
    try {
      let page = nextSourcePage;
      let hasMore: boolean = coverSet.hasMore;
      // 每次最多查三页；不可用图片不能触发无界自动翻页。
      let pagesLeft = automatic ? automaticPagesLeft.current : 3;
      while (hasMore && pagesLeft-- > 0) {
        if (automatic) automaticPagesLeft.current--;
        const result = await danbooruService.getCoverCandidatePage(tag, kind, page);
        if (sessionRef.current !== session) return false;
        page += 1;
        hasMore = result.hasMore;
        const known = new Set(coverSet.candidates.map(candidate => candidate.id));
        const additions = result.candidates.filter(candidate => !known.has(candidate.id));
        setNextSourcePage(page);
        if (additions.length) {
          setCoverSet(previous => previous ? {
            ...previous,
            candidates: [...previous.candidates, ...additions],
            hasMore,
            nextPage: page,
          } : previous);
          return true;
        }
      }
      setCoverSet(previous => previous ? { ...previous, hasMore, nextPage: page } : previous);
      return false;
    } catch {
      if (sessionRef.current === session) setLookupError('暂时无法读取 Danbooru 封面');
      return false;
    } finally {
      if (sessionRef.current === session) { loadingMoreRef.current = false; setIsLoadingMore(false); }
    }
  };
  // 当前大图失败先用同一作品的公开预览；也失败才换候选，已保存封面不被改写。
  useEffect(() => {
    if (!coverSet || isSavedCover) return;
    if (candidateIndex === null || !displayedSrc) {
      const next = candidates.findIndex(candidate => Boolean(sourceFor(candidate)));
      if (next >= 0 && next !== candidateIndex) { setCandidateIndex(next); return; }
      if (!displayedSrc && failedSources.size && !lookupError) void loadNextCandidatePage(true);
    }
    // 候选或失败地址变化才推进，不因父页面回调变化重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverSet, candidateIndex, displayedSrc, failedSources, isSavedCover, lookupError]);
  const moveCandidate = (direction: -1 | 1) => {
    if (direction < 0) {
      if (previousIndex >= 0) setCandidateIndex(previousIndex);
      return;
    }
    if (candidateIndex === null) {
      if (nextIndex >= 0) setCandidateIndex(nextIndex);
      return;
    }
    if (nextIndex >= 0) {
      setCandidateIndex(nextIndex);
      return;
    }
    const session = sessionRef.current;
    void loadNextCandidatePage().then(found => {
      if (found && sessionRef.current === session) setCandidateIndex(index => index === candidateIndex ? index + 1 : index);
    });
  };
  return <div ref={rootRef} className="absolute inset-0">
    {displayedSrc ? <>
      <SmartImage key={displayedSrc} src={displayedSrc} alt={alt} pin onError={() => setFailedSources(previous => new Set(previous).add(displayedSrc))} onLoad={event => {
        const image = event.currentTarget;
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          onImageLoad?.(image.naturalWidth, image.naturalHeight);
        }
      }} />
      <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-1 text-mini font-bold text-white backdrop-blur">{isSavedCover ? '已保存封面' : 'Danbooru'}</span>
      {canBrowse && <button type="button" disabled={previousIndex < 0} onClick={event => { event.stopPropagation(); moveCandidate(-1); }} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/65 p-2 text-white backdrop-blur hover:bg-black/85 disabled:cursor-default disabled:opacity-60" title="上一张" aria-label="上一张"><ChevronLeft className="h-4 w-4" /></button>}
      {canBrowse && <button type="button" disabled={isLoadingMore || (nextIndex < 0 && !coverSet?.hasMore)} onClick={event => { event.stopPropagation(); moveCandidate(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/65 p-2 text-white backdrop-blur hover:bg-black/85 disabled:cursor-default disabled:opacity-35" title="下一张" aria-label="下一张"><ChevronRight className="h-4 w-4" /></button>}
    </> : <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center text-gray-400">
      <ImageIcon className={`h-7 w-7 ${coverSet === undefined || isLoadingMore ? 'animate-pulse' : ''}`} />
      <span className="mt-2 text-micro">{coverSet === undefined || isLoadingMore ? '正在查找参考图…' : lookupError || '暂无可用的 Danbooru 封面'}</span>
      {coverSet?.hasMore && <button type="button" disabled={isLoadingMore} onClick={event => { event.stopPropagation(); void loadNextCandidatePage(); }} className="mt-2 rounded-lg border border-gray-300 px-2 py-1.5 text-micro hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800">继续查找封面</button>}
    </div>}
  </div>;
};
