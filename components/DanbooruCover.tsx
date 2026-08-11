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
    const load = async () => {
      try {
        const result = await danbooruService.getCoverSet(tag, kind);
        if (!active) return;
        setCoverSet(result);
        if (!fixedSrc) {
          const representativeIndex = result.representative
            ? result.candidates.findIndex(candidate => candidate.id === result.representative?.id)
            : -1;
          setCandidateIndex(representativeIndex >= 0 ? representativeIndex : (result.representative ? null : 0));
        }
      } catch {
        await new Promise(resolve => window.setTimeout(resolve, 2000));
        if (!active) return;
        try {
          const result = await danbooruService.getCoverSet(tag, kind);
          if (active) setCoverSet(result);
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
  const canBrowse = candidates.length > 1;
  const canSetCover = Boolean(currentCandidate && onSetCover);
  const moveCandidate = (direction: -1 | 1) => {
    if (!candidates.length) return;
    setCandidateIndex(index => {
      if (index === null) return direction > 0 ? 0 : candidates.length - 1;
      return (index + direction + candidates.length) % candidates.length;
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
      {candidateIndex === null && fixedSrc && <span className="pointer-events-none absolute left-2 top-8 rounded-full bg-indigo-600/85 px-2 py-1 text-[9px] font-bold text-white shadow">已固定封面</span>}
      {(canBrowse || canSetCover) && <div className="absolute bottom-2 right-2 flex items-center gap-1" onClick={event => event.stopPropagation()}>
        {canBrowse && <button type="button" onClick={() => moveCandidate(-1)} className="rounded-full bg-black/65 p-1.5 text-white backdrop-blur hover:bg-black/85" title="上一张热门图" aria-label="上一张热门图"><ChevronLeft className="h-3.5 w-3.5" /></button>}
        {canSetCover && <button type="button" disabled={isSaving} onClick={() => void saveCover()} className="flex items-center gap-1 rounded-full bg-indigo-600/90 px-2 py-1.5 text-[10px] font-bold text-white backdrop-blur hover:bg-indigo-500 disabled:opacity-60" title="设为这个 Tag 的封面" aria-label="设为这个 Tag 的封面"><Pin className="h-3.5 w-3.5" />{isSaving ? '保存中…' : '设封面'}</button>}
        {canBrowse && <button type="button" onClick={() => moveCandidate(1)} className="rounded-full bg-black/65 p-1.5 text-white backdrop-blur hover:bg-black/85" title="下一张热门图" aria-label="下一张热门图"><ChevronRight className="h-3.5 w-3.5" /></button>}
      </div>}
      {currentCandidate && <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[9px] font-bold text-white backdrop-blur">热门 {candidateIndex! + 1}/{candidates.length}</span>}
    </> : <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center text-gray-400">
      <ImageIcon className={`h-7 w-7 ${coverSet === undefined ? 'animate-pulse' : ''}`} />
      <span className="mt-2 text-[10px]">{coverSet === undefined ? '正在查找参考图…' : kind === 'character' ? '暂无合适的单人代表图' : 'Danbooru 暂无普通级图片'}</span>
    </div>}
  </div>;
};
