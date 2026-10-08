import React, { useContext, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon } from 'lucide-react';
import { DanbooruCoverCandidate, DanbooruCoverSet, danbooruService } from '../services/danbooruService';
import { ImageActivityContext, SmartImage } from './SmartImage';
import { getMobileOriginalUrl, selectThumbnailVariant } from '../services/mobileImageCache';
import { ImageShareOverlay } from './ImageShareActions';
import { createMediaPrewarmSession } from '../services/mediaPrewarm';
import { ApiError } from '../services/api';

interface DanbooruCoverProps {
  tag: string;
  kind: 'artist' | 'character';
  alt: string;
  fixedSrc?: string;
  onCandidateChange?: (candidate: DanbooruCoverCandidate | null) => void;
  /** 封面图片加载完成后上报自然宽高（瀑布流按真实比例排布用）。 */
  onImageLoad?: (width: number, height: number) => void;
  notify?: (message: string, type?: 'success' | 'error') => void;
}

const firstCandidateIndex = (result: DanbooruCoverSet) => {
  const representativeIndex = result.candidates.findIndex(candidate => candidate.id === result.representative?.id);
  return representativeIndex >= 0 ? representativeIndex : 0;
};

const lookupErrorMessage = (error: unknown) => {
  if (error instanceof ApiError && (error.code?.startsWith('DANBOORU_') || error.status === 403 || error.status === 429)) return error.message;
  return error instanceof Error && /429/.test(error.message)
    ? 'Danbooru 请求过于频繁，请稍后重试' : '暂时无法读取 Danbooru 封面，请重试';
};

export const DanbooruCover: React.FC<DanbooruCoverProps> = ({ tag, kind, alt, fixedSrc = '', onCandidateChange, onImageLoad, notify }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewActive = useContext(ImageActivityContext);
  const prewarm = useRef<ReturnType<typeof createMediaPrewarmSession> | null>(null);
  if (!prewarm.current) prewarm.current = createMediaPrewarmSession();
  const requestController = useRef<AbortController | null>(null);
  const [browseSaved, setBrowseSaved] = useState(false);
  const [activated, setActivated] = useState(false);
  const [visible, setVisible] = useState(false);
  const viewportPriority = useRef(1000);
  const [coverSet, setCoverSet] = useState<DanbooruCoverSet | null | undefined>(undefined);
  const [candidateIndex, setCandidateIndex] = useState<number | null>(fixedSrc ? null : 0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextSourcePage, setNextSourcePage] = useState(1);
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set());
  const [lookupError, setLookupError] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const sessionRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const automaticPagesLeft = useRef(3);
  const latestFallbackTried = useRef(false);
  const loadedKey = useRef('');

  useEffect(() => {
    if (!viewActive) { setActivated(false); setVisible(false); return; }
    const node = rootRef.current;
    if (!node || !('IntersectionObserver' in window)) {
      setActivated(true);
      setVisible(true); viewportPriority.current = 0;
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
      const latest = entries[entries.length - 1];
      if (latest) setActivated(latest.isIntersecting);
    }, { root, rootMargin: `${Math.max(root?.clientHeight || window.innerHeight, 600)}px 0px` });
    observer.observe(node);
    const visibleObserver = new IntersectionObserver(entries => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const inView = Boolean(entry?.isIntersecting);
      const rect = entry?.boundingClientRect;
      const bounds = entry?.rootBounds;
      viewportPriority.current = inView ? 0 : 1000 + Math.max(0,
        (rect?.top || 0) - (bounds?.bottom || window.innerHeight), (bounds?.top || 0) - (rect?.bottom || 0));
      setVisible(inView);
    }, { root });
    visibleObserver.observe(node);
    return () => { observer.disconnect(); visibleObserver.disconnect(); };
  }, [tag, viewActive]);

  useEffect(() => { setBrowseSaved(false); }, [fixedSrc, tag]);
  useEffect(() => {
    loadedKey.current = '';
    setCoverSet(undefined); setCandidateIndex(fixedSrc ? null : 0);
    setNextSourcePage(1); setFailedSources(new Set()); setLookupError('');
    automaticPagesLeft.current = 3;
    latestFallbackTried.current = false;
  }, [fixedSrc, kind, tag, retryToken]);

  useEffect(() => {
    if (!activated || !viewActive || (fixedSrc && !browseSaved)) return;
    const session = ++sessionRef.current;
    let active = true;
    const controller = new AbortController();
    requestController.current = controller;
    const key = JSON.stringify([kind, tag, fixedSrc, retryToken]);
    setIsLoadingMore(false); loadingMoreRef.current = false;
    const load = async () => {
      try {
        const result = await danbooruService.getCoverSet(tag, kind, { signal: controller.signal, priority: () => viewportPriority.current });
        if (!active) return;
        loadedKey.current = key;
        setCoverSet(result);
        latestFallbackTried.current = Boolean(result.latestFallbackTried);
        setNextSourcePage(result.nextPage || 1);
        setCandidateIndex(firstCandidateIndex(result));
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        // 后台已做有限重试；验证、拒绝和限流应立即反馈，不能在两秒后再次联网。
        if (error instanceof ApiError && (error.code?.startsWith('DANBOORU_') || error.status === 403 || error.status === 429)) {
          loadedKey.current = key;
          setCoverSet(null);
          setLookupError(lookupErrorMessage(error));
          return;
        }
        await new Promise(resolve => window.setTimeout(resolve, 2000));
        if (!active) return;
        try {
          const result = await danbooruService.getCoverSet(tag, kind, { signal: controller.signal, priority: () => viewportPriority.current });
          if (active) {
            loadedKey.current = key;
            setCoverSet(result);
            latestFallbackTried.current = Boolean(result.latestFallbackTried);
            setNextSourcePage(result.nextPage || 1);
            setCandidateIndex(firstCandidateIndex(result));
          }
        } catch (error) {
          if (active) {
            loadedKey.current = key;
            setCoverSet(null);
            setLookupError(lookupErrorMessage(error));
          }
        }
      }
    };
    if (loadedKey.current !== key) void load();
    return () => { active = false; controller.abort(); prewarm.current?.cancel(); if (sessionRef.current === session) sessionRef.current++; };
  }, [activated, viewActive, browseSaved, fixedSrc, kind, tag, retryToken]);

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
  // 当前图片走显示请求优先通道；仅在附近预热紧接着的一个候选，档位跟随卡片与屏幕倍率。
  useEffect(() => {
    if (!activated || !visible || !viewActive || !rootRef.current || nextIndex < 0) return;
    const node = rootRef.current;
    let previousVariant = '';
    const warm = () => {
      const variant = selectThumbnailVariant(node.clientWidth * Math.max(1, window.devicePixelRatio || 1));
      if (variant === previousVariant) return;
      previousVariant = variant;
      prewarm.current?.cancel();
      prewarm.current?.enqueue([candidates[nextIndex].sampleUrl], variant, true);
    };
    warm();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(warm);
    observer?.observe(node);
    return () => { observer?.disconnect(); prewarm.current?.cancel(); };
  }, [activated, visible, viewActive, candidates, nextIndex]);
  const loadNextCandidatePage = async (automatic = false) => {
    if (!coverSet || loadingMoreRef.current
      || (!automatic && !coverSet.hasMore)
      || (automatic && latestFallbackTried.current && (!coverSet.hasMore || automaticPagesLeft.current <= 0))) return false;
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
        const result = await danbooruService.getCoverCandidatePage(tag, kind, page, { signal: requestController.current?.signal });
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
      // 地址存在但所有图片均加载失败，也需要一次最新作品兜底；分页游标继续只属于评分查询。
      if (automatic && !latestFallbackTried.current) {
        const fallback = await danbooruService.getCoverFallback(tag, kind, {
          signal: requestController.current?.signal, priority: () => viewportPriority.current,
        });
        if (sessionRef.current !== session) return false;
        // 离开视图会取消查询；仅完成后记为已兜底，返回视图仍可接着查。
        latestFallbackTried.current = true;
        const usable = fallback.candidates.find(candidate => Boolean(sourceFor(candidate)));
        setCoverSet(previous => {
          if (!previous) return previous;
          // 相同作品可能已替换图片地址；更新该候选而不重复追加 ID。
          const merged = new Map(previous.candidates.map(candidate => [candidate.id, candidate]));
          fallback.candidates.forEach(candidate => merged.set(candidate.id, candidate));
          return { ...previous, candidates: [...merged.values()], latestFallbackTried: true };
        });
        return Boolean(usable);
      }
      return false;
    } catch (error) {
      if (sessionRef.current === session) setLookupError(lookupErrorMessage(error));
      return false;
    } finally {
      if (sessionRef.current === session) { loadingMoreRef.current = false; setIsLoadingMore(false); }
    }
  };
  // 当前大图失败先用同一作品的公开预览；也失败才换候选，已保存封面不被改写。
  useEffect(() => {
    if (!activated || !viewActive || !coverSet || isSavedCover) return;
    if (candidateIndex === null || !displayedSrc) {
      const next = candidates.findIndex(candidate => Boolean(sourceFor(candidate)));
      if (next >= 0 && next !== candidateIndex) { setCandidateIndex(next); return; }
      if (!displayedSrc && failedSources.size && !lookupError) void loadNextCandidatePage(true);
    }
    // 候选或失败地址变化才推进，不因父页面回调变化重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated, viewActive, coverSet, candidateIndex, displayedSrc, failedSources, isSavedCover, lookupError]);
  const moveCandidate = (direction: -1 | 1) => {
    if (fixedSrc && !browseSaved && direction > 0) { setBrowseSaved(true); return; }
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
      <SmartImage key={displayedSrc} src={displayedSrc} alt={alt} pin eager={visible} onError={() => { setFailedSources(previous => new Set(previous).add(displayedSrc)); if (displayedSrc === fixedSrc) setBrowseSaved(true); }} onLoad={event => {
        const image = event.currentTarget;
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          onImageLoad?.(image.naturalWidth, image.naturalHeight);
        }
      }} />
      <ImageShareOverlay imageUrl={getMobileOriginalUrl(displayedSrc)} filename={`${kind}-${tag}-${currentCandidate?.id || 'cover'}.png`} notify={notify} />
      <span className="pointer-events-none absolute bottom-16 left-2 rounded-full bg-black/60 px-2 py-1 text-mini font-bold text-white backdrop-blur">{isSavedCover ? '已保存封面' : 'Danbooru'}</span>
      {canBrowse && <button data-card-action="true" type="button" disabled={previousIndex < 0} onClick={event => { event.stopPropagation(); moveCandidate(-1); }} className="hover-reveal-touch mobile-touch absolute left-2 bottom-2 rounded-full bg-black/65 p-2 text-white backdrop-blur hover:bg-black/85 disabled:cursor-default disabled:opacity-60" title="上一张" aria-label="上一张"><ChevronLeft className="h-4 w-4" /></button>}
      {canBrowse && <button data-card-action="true" type="button" disabled={isLoadingMore || (nextIndex < 0 && !coverSet?.hasMore)} onClick={event => { event.stopPropagation(); moveCandidate(1); }} className="hover-reveal-touch mobile-touch absolute right-2 bottom-2 rounded-full bg-black/65 p-2 text-white backdrop-blur hover:bg-black/85 disabled:cursor-default disabled:opacity-35" title="下一张" aria-label="下一张"><ChevronRight className="h-4 w-4" /></button>}
      {fixedSrc && !browseSaved && !canBrowse && <button data-card-action="true" type="button" onClick={event => { event.stopPropagation(); moveCandidate(1); }} className="hover-reveal-touch mobile-touch absolute right-2 bottom-2 rounded-full bg-black/65 p-2 text-white backdrop-blur hover:bg-black/85" title="下一张" aria-label="下一张"><ChevronRight className="h-4 w-4" /></button>}
    </> : <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center text-gray-400">
      <ImageIcon className={`h-7 w-7 ${coverSet === undefined || isLoadingMore ? 'animate-pulse' : ''}`} />
      <span className="mt-2 text-micro">{coverSet === undefined || isLoadingMore ? '正在查找参考图…' : lookupError || (failedSources.size ? '封面图片加载失败' : '暂无可用的 Danbooru 封面')}</span>
      {(coverSet === null || failedSources.size > 0) && !isLoadingMore && <button type="button" onClick={event => { event.stopPropagation(); setRetryToken(value => value + 1); }} className="mt-2 rounded-lg border border-gray-300 px-2 py-1.5 text-micro hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800">重试加载封面</button>}
      {coverSet?.hasMore && <button type="button" disabled={isLoadingMore} onClick={event => { event.stopPropagation(); void loadNextCandidatePage(); }} className="mt-2 rounded-lg border border-gray-300 px-2 py-1.5 text-micro hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800">继续查找封面</button>}
    </div>}
  </div>;
};
