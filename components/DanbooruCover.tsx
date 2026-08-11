import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon, Pin } from 'lucide-react';
import { DanbooruCoverCandidate, DanbooruCoverSet, danbooruService } from '../services/danbooruService';
import { SmartImage } from './SmartImage';

interface DanbooruCoverProps {
  tag: string;
  kind: 'artist' | 'character';
  alt: string;
  fixedSrc?: string;
  onSetCover?: (candidate: DanbooruCoverCandidate) => Promise<void> | void;
}

export const DanbooruCover: React.FC<DanbooruCoverProps> = ({ tag, kind, alt, fixedSrc = '', onSetCover }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activated, setActivated] = useState(false);
  const [coverSet, setCoverSet] = useState<DanbooruCoverSet | null | undefined>(undefined);
  const [candidateIndex, setCandidateIndex] = useState<number | null>(fixedSrc ? null : 0);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextSourcePage, setNextSourcePage] = useState(1);

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
    let active = true;
    setCoverSet(undefined);
    setCandidateIndex(fixedSrc ? null : 0);
    setNextSourcePage(1);
    const load = async () => {
      try {
        const result = await danbooruService.getCoverSet(tag, kind);
        if (!active) return;
        setCoverSet(result);
        if (!fixedSrc) setCandidateIndex(0);
      } catch {
        await new Promise(resolve => window.setTimeout(resolve, 2000));
        if (!active) return;
        try {
          const result = await danbooruService.getCoverSet(tag, kind);
          if (active) {
            setCoverSet(result);
            if (!fixedSrc) setCandidateIndex(0);
          }
        } catch {
          if (active) setCoverSet(null);
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [activated, fixedSrc, kind, tag]);

  const candidates = coverSet?.candidates || [];
  const currentCandidate = candidateIndex === null ? null : candidates[candidateIndex];
  const displayedSrc = currentCandidate?.sampleUrl || fixedSrc || coverSet?.representative?.sampleUrl || '';
  const canBrowse = candidates.length > 0;
  const canSetCover = Boolean(currentCandidate && onSetCover);
  const loadNextCandidatePage = async () => {
    if (!coverSet?.hasMore || isLoadingMore) return false;
    setIsLoadingMore(true);
    try {
      let page = nextSourcePage;
      let hasMore: boolean = coverSet.hasMore;
      // A source page can contain no eligible character images. Keep following
      // pages until an image is found or the source is exhausted.
      while (hasMore) {
        const result = await danbooruService.getCoverCandidatePage(tag, kind, page);
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
          } : previous);
          return true;
        }
      }
      setCoverSet(previous => previous ? { ...previous, hasMore: false } : previous);
      return false;
    } finally {
      setIsLoadingMore(false);
    }
  };
  const moveCandidate = (direction: -1 | 1) => {
    if (direction < 0) {
      if (candidateIndex !== null && candidateIndex > 0) setCandidateIndex(candidateIndex - 1);
      return;
    }
    if (candidateIndex === null) {
      if (candidates.length) setCandidateIndex(0);
      return;
    }
    if (candidateIndex < candidates.length - 1) {
      setCandidateIndex(candidateIndex + 1);
      return;
    }
    void loadNextCandidatePage().then(found => {
      if (found) setCandidateIndex(index => index === candidateIndex ? index + 1 : index);
    });
  };
  const saveCover = async () => {
    if (!currentCandidate || !onSetCover || isSaving) return;
    setIsSaving(true);
    try {
      await onSetCover(currentCandidate);
    } finally {
      setIsSaving(false);
    }
  };

  return <div ref={rootRef} className="absolute inset-0">
    {displayedSrc ? <>
      <SmartImage src={displayedSrc} alt={alt} thumbnailVariant="thumb-640" />
      <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-1 text-[9px] font-bold text-white backdrop-blur">{fixedSrc && candidateIndex === null ? '已保存封面' : 'Danbooru'}</span>
      {candidateIndex === null && fixedSrc && <span className="pointer-events-none absolute right-2 top-9 z-10 rounded-full bg-indigo-600/90 p-1.5 text-white shadow" title="当前固定封面"><Pin className="h-3.5 w-3.5" /></span>}
      {canBrowse && <button type="button" disabled={candidateIndex === null || candidateIndex === 0} onClick={event => { event.stopPropagation(); moveCandidate(-1); }} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/65 p-2 text-white backdrop-blur hover:bg-black/85 disabled:cursor-default disabled:opacity-60" title="上一张" aria-label="上一张"><ChevronLeft className="h-4 w-4" /></button>}
      {canSetCover && <button type="button" disabled={isSaving} onClick={event => { event.stopPropagation(); void saveCover(); }} className="absolute right-2 top-9 z-10 rounded-full bg-indigo-600/90 p-1.5 text-white shadow backdrop-blur hover:bg-indigo-500 disabled:opacity-60" title="设为固定封面" aria-label="设为固定封面"><Pin className="h-3.5 w-3.5" /></button>}
      {canBrowse && <button type="button" disabled={isLoadingMore || (candidateIndex !== null && candidateIndex >= candidates.length - 1 && !coverSet?.hasMore)} onClick={event => { event.stopPropagation(); moveCandidate(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/65 p-2 text-white backdrop-blur hover:bg-black/85 disabled:cursor-default disabled:opacity-35" title="下一张" aria-label="下一张"><ChevronRight className="h-4 w-4" /></button>}
    </> : <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center text-gray-400">
      <ImageIcon className={`h-7 w-7 ${coverSet === undefined ? 'animate-pulse' : ''}`} />
      <span className="mt-2 text-[10px]">{coverSet === undefined ? '正在查找参考图…' : kind === 'character' ? '暂无合适的单人代表图' : 'Danbooru 暂无普通级图片'}</span>
    </div>}
  </div>;
};
