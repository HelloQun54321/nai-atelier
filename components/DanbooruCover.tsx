import React, { useEffect, useRef, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { DanbooruPost, danbooruService } from '../services/danbooruService';
import { SmartImage } from './SmartImage';

interface DanbooruCoverProps {
  tag: string;
  kind: 'artist' | 'character';
  alt: string;
}

export const DanbooruCover: React.FC<DanbooruCoverProps> = ({ tag, kind, alt }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activated, setActivated] = useState(false);
  const [post, setPost] = useState<DanbooruPost | null | undefined>(undefined);

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
    setPost(undefined);
    const load = async () => {
      try {
        const result = await danbooruService.getCover(tag, kind);
        if (active) setPost(result);
      } catch {
        await new Promise(resolve => window.setTimeout(resolve, 2000));
        if (!active) return;
        try {
          const result = await danbooruService.getCover(tag, kind);
          if (active) setPost(result);
        } catch {
          if (active) setPost(null);
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [activated, kind, tag]);

  return <div ref={rootRef} className="absolute inset-0">
    {post ? <>
      <SmartImage src={post.sampleUrl} alt={alt} thumbnailVariant="thumb-640" />
      <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-1 text-[9px] font-bold text-white backdrop-blur">Danbooru</span>
    </> : <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center text-gray-400">
      <ImageIcon className={`h-7 w-7 ${post === undefined ? 'animate-pulse' : ''}`} />
      <span className="mt-2 text-[10px]">{post === undefined ? '正在查找参考图…' : 'Danbooru 暂无普通级图片'}</span>
    </div>}
  </div>;
};
