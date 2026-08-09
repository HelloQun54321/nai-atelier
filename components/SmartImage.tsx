import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  acquireMobileThumbnailUrl,
  buildMediaUrl,
  canUseMediaGateway,
  getMobileOriginalUrl,
  isMobileViewport,
  type MediaVariant,
  selectThumbnailVariant,
} from '../services/mobileImageCache';

const ImageActivityContext = createContext(true);

export const ImageActivityProvider: React.FC<React.PropsWithChildren<{ active: boolean }>> = ({ active, children }) => (
  <ImageActivityContext.Provider value={active}>{children}</ImageActivityContext.Provider>
);

interface SmartImageProps {
  src: string;
  alt: string;
  eager?: boolean;
  thumbnailVariant?: Exclude<MediaVariant, 'original'>;
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
  thumbnailVariant,
  className = 'h-full w-full object-cover',
  containerClassName = 'relative h-full w-full overflow-hidden bg-gray-200 dark:bg-gray-900',
  onError,
  onLoad,
}) => {
  const viewActive = useContext(ImageActivityContext);
  const containerRef = useRef<HTMLDivElement>(null);
  const onErrorRef = useRef(onError);
  const [activatedSrc, setActivatedSrc] = useState('');
  const [displaySrc, setDisplaySrc] = useState('');
  const [measuredWidth, setMeasuredWidth] = useState(160);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [useOriginal, setUseOriginal] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    if (!viewActive) return;
    const node = containerRef.current;
    if (!node) return;
    const updateWidth = () => setMeasuredWidth(Math.max(1, node.clientWidth));
    updateWidth();
    if (!('ResizeObserver' in window)) return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [viewActive]);

  useEffect(() => {
    setDisplaySrc('');
    setLoaded(false);
    setFailed(false);
    setUseOriginal(false);
    if (!viewActive || !src) {
      setActivatedSrc('');
      return;
    }
    const node = containerRef.current;
    if (!node || eager || !('IntersectionObserver' in window)) {
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
  }, [eager, retryToken, src, viewActive]);

  const activated = viewActive && (eager || activatedSrc === src);
  const pixelWidth = measuredWidth * Math.max(1, window.devicePixelRatio || 1);
  const variant = thumbnailVariant ?? selectThumbnailVariant(pixelWidth);

  useEffect(() => {
    if (!activated || !src) {
      setDisplaySrc('');
      return;
    }
    setLoaded(false);
    setFailed(false);
    if (useOriginal || !canUseMediaGateway(src)) {
      setDisplaySrc(src);
      return;
    }

    const thumbnailUrl = buildMediaUrl(src, variant);
    if (!isMobileViewport()) {
      setDisplaySrc(thumbnailUrl);
      return;
    }
    const resource = acquireMobileThumbnailUrl(thumbnailUrl);
    let active = true;
    resource.promise.then(objectUrl => {
      if (active) setDisplaySrc(objectUrl);
    }).catch(error => {
      if (active && error?.name !== 'AbortError') setUseOriginal(true);
    });
    return () => {
      active = false;
      resource.release();
    };
  }, [activated, src, useOriginal, variant]);

  const handleImageError = () => {
    if (!useOriginal && canUseMediaGateway(src)) {
      setUseOriginal(true);
      return;
    }
    setFailed(true);
    onErrorRef.current?.();
  };

  return (
    <div ref={containerRef} className={containerClassName}>
      {activated && displaySrc && !failed && (
        <img
          src={displaySrc}
          alt={alt}
          className={`${className} ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={event => { setLoaded(true); onLoad?.(event); }}
          onError={handleImageError}
          decoding="async"
          loading={eager ? 'eager' : 'lazy'}
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

export const OriginalImage: React.FC<OriginalImageProps> = ({ src, decoding = 'async', onError, ...props }) => {
  const viewActive = useContext(ImageActivityContext);
  const gatewaySrc = getMobileOriginalUrl(src);
  const [displaySrc, setDisplaySrc] = useState(gatewaySrc);

  useEffect(() => setDisplaySrc(gatewaySrc), [gatewaySrc, src]);
  if (!viewActive) return null;

  return (
    <img
      src={displaySrc}
      decoding={decoding}
      onError={event => {
        if (displaySrc !== src) {
          setDisplaySrc(src);
          return;
        }
        onError?.(event);
      }}
      {...props}
    />
  );
};
