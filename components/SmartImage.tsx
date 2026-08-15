import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  acquireMobileThumbnailUrl,
  buildMediaUrl,
  canUseMediaGateway,
  getMobileOriginalUrl,
  isMobileViewport,
  type MediaVariant,
  ratchetVariantWidth,
  selectThumbnailVariant,
} from '../services/mobileImageCache';

export const ImageActivityContext = createContext(true);

export const ImageActivityProvider: React.FC<React.PropsWithChildren<{ active: boolean }>> = ({ active, children }) => (
  <ImageActivityContext.Provider value={active}>{children}</ImageActivityContext.Provider>
);

interface SmartImageProps {
  src: string;
  alt: string;
  eager?: boolean;
  thumbnailVariant?: Exclude<MediaVariant, 'original'>;
  /** 渐进升级：低清 src 先显示，卡片接近/进入视口（或 eager 详情）后叠加更清晰源，加载完成淡入、失败静默保留低清。 */
  upgradeSrc?: string;
  upgradeVariant?: MediaVariant;
  /** 请求缩略图时附加 pin=1：网关将该图标记为固定保留，不参与 LRU 淘汰（封面图持久本地化）。 */
  pin?: boolean;
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
  upgradeSrc,
  upgradeVariant,
  className = 'h-full w-full object-cover',
  containerClassName = 'relative h-full w-full overflow-hidden bg-gray-200 dark:bg-gray-900',
  onError,
  onLoad,
  pin = false,
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
  const [upgradeActivatedSrc, setUpgradeActivatedSrc] = useState('');
  const [upgradeDisplaySrc, setUpgradeDisplaySrc] = useState('');
  const [upgradeLoaded, setUpgradeLoaded] = useState(false);
  const [upgradeFailed, setUpgradeFailed] = useState(false);

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
    // 提前约两屏预取缩略图：滚动到达时图已加载，避免“滚到哪卡到哪”。
    const preloadDistance = Math.max(root?.clientHeight || window.innerHeight, 1200);
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
  // 档位棘轮（只升不降）：详情侧栏打开会挤压卡片、移动端详情会整栏隐藏（宽度归零），
  // 若档位随之降档，全部卡片的缓存键跳变、整列表重新请求并闪占位。
  const variantFloorRef = useRef(0);
  variantFloorRef.current = ratchetVariantWidth(variantFloorRef.current, pixelWidth);
  const variant = thumbnailVariant ?? selectThumbnailVariant(variantFloorRef.current);
  const upgradeTarget = upgradeSrc && upgradeSrc !== src ? upgradeSrc : undefined;

  useEffect(() => {
    setUpgradeActivatedSrc('');
    setUpgradeDisplaySrc('');
    setUpgradeLoaded(false);
    setUpgradeFailed(false);
    if (!viewActive || !upgradeTarget) return;
    const node = containerRef.current;
    if (!node || eager || !('IntersectionObserver' in window)) {
      setUpgradeActivatedSrc(upgradeTarget);
      return;
    }
    const root = findScrollRoot(node);
    // 升级源只在卡片接近/进入视口时触发，避免与低清首屏同时抢带宽。
    const upgradeDistance = Math.max(root?.clientHeight ? Math.round(root.clientHeight * 0.2) : 0, 160);
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) return;
      setUpgradeActivatedSrc(upgradeTarget);
      observer.disconnect();
    }, { root, rootMargin: `${upgradeDistance}px 0px` });
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, retryToken, src, upgradeTarget, viewActive]);

  const upgradeActivated = viewActive && Boolean(upgradeTarget) && (eager || upgradeActivatedSrc === upgradeTarget);

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
    const displayUrl = pin && thumbnailUrl.startsWith('/api/media') ? `${thumbnailUrl}&pin=1` : thumbnailUrl;
    if (!isMobileViewport()) {
      setDisplaySrc(displayUrl);
      return;
    }
    const resource = acquireMobileThumbnailUrl(displayUrl);
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
  }, [activated, pin, src, useOriginal, variant]);

  useEffect(() => {
    if (!upgradeActivated || !upgradeTarget) {
      setUpgradeDisplaySrc('');
      return;
    }
    setUpgradeLoaded(false);
    setUpgradeFailed(false);
    if (!canUseMediaGateway(upgradeTarget)) {
      setUpgradeDisplaySrc(upgradeTarget);
      return;
    }
    const upgradeUrl = buildMediaUrl(upgradeTarget, upgradeVariant ?? 'thumb-960');
    if (!isMobileViewport()) {
      setUpgradeDisplaySrc(upgradeUrl);
      return;
    }
    const resource = acquireMobileThumbnailUrl(upgradeUrl);
    let active = true;
    resource.promise.then(objectUrl => {
      if (active) setUpgradeDisplaySrc(objectUrl);
    }).catch(() => {
      // 移动端缓存失败时回退到网关 URL，不再尝试直连远程源。
      if (active) setUpgradeDisplaySrc(upgradeUrl);
    });
    return () => {
      active = false;
      resource.release();
    };
  }, [upgradeActivated, upgradeTarget, upgradeVariant]);

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
      {upgradeActivated && upgradeDisplaySrc && !upgradeFailed && (
        <img
          src={upgradeDisplaySrc}
          alt={alt}
          aria-hidden="true"
          className={`${className} absolute inset-0 pointer-events-none transition-opacity duration-300 ${upgradeLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={event => { setUpgradeLoaded(true); }}
          onError={() => setUpgradeFailed(true)}
          decoding="async"
          loading={eager ? 'eager' : 'lazy'}
        />
      )}
      {activated && !loaded && !failed && !upgradeLoaded && <div className="smart-image-shimmer absolute inset-0 flex items-center justify-center text-xs text-gray-400"><span className="animate-pulse">加载中…</span></div>}
      {activated && failed && !upgradeLoaded && (
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
