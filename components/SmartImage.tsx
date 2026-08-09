import React, { useEffect, useRef, useState } from 'react';
import {
  acquireMobileThumbnail,
  buildMediaUrl,
  canUseMediaGateway,
  getMobileOriginalUrl,
  isMobileViewport,
} from '../services/mobileImageCache';

interface SmartImageProps {
  src: string;
  alt: string;
  eager?: boolean;
  className?: string;
  containerClassName?: string;
  onError?: () => void;
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
}

const findScrollRoot = (node: HTMLElement) => {
  let parent = node.parentElement;
  while (parent) {
    const { overflowY } = window.getComputedStyle(parent);
    if (/auto|scroll|overlay/.test(overflowY)) return parent;
    parent = parent.parentElement;
  }
  return null;
};

export const SmartImage: React.FC<SmartImageProps> = ({
  src,
  alt,
  eager = false,
  className = 'h-full w-full object-cover',
  containerClassName = 'relative h-full w-full overflow-hidden bg-gray-200 dark:bg-gray-900',
  onError,
  onLoad,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const onErrorRef = useRef(onError);
  const objectUrlRef = useRef('');
  const [activatedSrc, setActivatedSrc] = useState('');
  const [displaySrc, setDisplaySrc] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const replaceObjectUrl = (nextUrl = '') => {
    if (objectUrlRef.current && objectUrlRef.current !== nextUrl) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = nextUrl;
  };

  useEffect(() => () => replaceObjectUrl(), []);

  useEffect(() => {
    replaceObjectUrl();
    setDisplaySrc('');
    setLoaded(false);
    setFailed(false);
    const node = containerRef.current;
    if (!node) return;
    if (eager) {
      setActivatedSrc(src);
      return;
    }
    if (!('IntersectionObserver' in window)) {
      setActivatedSrc(src);
      return;
    }
    const root = findScrollRoot(node);
    const preloadDistance = Math.max(root?.clientHeight || window.innerHeight, 600);
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) return;
      setActivatedSrc(src);
      observer.disconnect();
    }, { root, rootMargin: `${preloadDistance}px 0px` });
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, src]);

  const activated = eager || activatedSrc === src;

  useEffect(() => {
    if (!activated || !src) return;
    setLoaded(false);
    setFailed(false);
    if (!canUseMediaGateway(src)) {
      setDisplaySrc(src);
      return;
    }

    const width = (containerRef.current?.clientWidth || 160) * Math.max(1, window.devicePixelRatio || 1);
    const variant = width > 320 ? 'thumb-640' : 'thumb-320';
    const thumbnailUrl = buildMediaUrl(src, variant);
    if (!isMobileViewport()) {
      setDisplaySrc(thumbnailUrl);
      return;
    }
    const request = acquireMobileThumbnail(thumbnailUrl);
    let active = true;
    request.promise.then(blob => {
      if (!active) return;
      const objectUrl = URL.createObjectURL(blob);
      replaceObjectUrl(objectUrl);
      setDisplaySrc(objectUrl);
    }).catch(error => {
      if (!active || error?.name === 'AbortError') return;
      if (onErrorRef.current) {
        setFailed(true);
        onErrorRef.current();
      } else {
        setLoaded(false);
        setDisplaySrc(getMobileOriginalUrl(src));
      }
    });
    return () => {
      active = false;
      request.release();
    };
  }, [activated, retryToken, src]);

  return (
    <div ref={containerRef} className={containerClassName}>
      {activated && displaySrc && !failed && (
        <img
          src={displaySrc}
          alt={alt}
          className={`${className} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={event => { setLoaded(true); onLoad?.(event); }}
          onError={() => { setFailed(true); onErrorRef.current?.(); }}
          decoding="async"
          loading={eager ? 'eager' : undefined}
          fetchPriority={eager ? 'high' : 'auto'}
        />
      )}
      {activated && !loaded && !failed && <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400"><span className="animate-pulse">加载中…</span></div>}
      {activated && failed && (
        <button
          type="button"
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-transparent px-2 text-[10px] text-gray-500 dark:text-gray-400"
          onClick={event => { event.stopPropagation(); setRetryToken(value => value + 1); }}
        >
          <span className="text-lg opacity-70">▧</span><span>加载失败 · 重试</span>
        </button>
      )}
    </div>
  );
};

interface OriginalImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

export const OriginalImage: React.FC<OriginalImageProps> = ({ src, ...props }) => (
  <img src={getMobileOriginalUrl(src)} {...props} />
);
