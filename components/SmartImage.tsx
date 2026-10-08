import { t, useLanguage } from '../services/i18n';
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
  useLanguage();
  const viewActive = useContext(ImageActivityContext);
  const containerRef = useRef<HTMLDivElement>(null);
  const onErrorRef = useRef(onError);
  const [activatedSrc, setActivatedSrc] = useState('');
  const [displaySrc, setDisplaySrc] = useState('');
  const displaySrcRef = useRef('');
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

  // 换图或手动重试时重置展示状态。页面隐藏/显示的切换刻意不在此列：
  // 切走时保留已显示的 <img>（display:none 不产生任何流量），切回瞬时完整呈现，
  // 不再整列表闪现"加载中"；图片字节本就走浏览器/网关的永久缓存。
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    setUseOriginal(false);
    setDisplaySrc('');
    displaySrcRef.current = '';
    setActivatedSrc('');
  }, [src, retryToken]);

  // 懒加载激活：仅在页面可见时挂载观察器；隐藏期间不激活任何新图片。
  useEffect(() => {
    if (!viewActive || !src || activatedSrc === src) return;
    const node = containerRef.current;
    if (!node || eager || !('IntersectionObserver' in window)) {
      setActivatedSrc(src);
      return;
    }
    const root = findScrollRoot(node);
    // 提前约两屏预取缩略图：滚动到达时图已加载，避免“滚到哪卡到哪”。
    const preloadDistance = Math.max(root?.clientHeight || window.innerHeight, 1200);
    const observer = new IntersectionObserver(entries => {
      // 同一目标可能在一批内先离开再进入；不能漏掉后续的进入记录。
      if (!entries.some(entry => entry.isIntersecting)) return;
      setActivatedSrc(src);
      observer.disconnect();
    }, { root, rootMargin: `${preloadDistance}px 0px` });
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, src, viewActive, activatedSrc]);

  // 页面隐藏时已激活的图保持展示（见上方激活 effect）；只有真正激活过的源才算可渲染。
  const activated = eager || activatedSrc === src;
  const pixelWidth = measuredWidth * Math.max(1, window.devicePixelRatio || 1);
  // 档位棘轮（只升不降）：详情侧栏打开会挤压卡片、移动端详情会整栏隐藏（宽度归零），
  // 若档位随之降档，全部卡片的缓存键跳变、整列表重新请求并闪占位。
  const variantFloorRef = useRef(0);
  variantFloorRef.current = ratchetVariantWidth(variantFloorRef.current, pixelWidth);
  const variant = thumbnailVariant ?? selectThumbnailVariant(variantFloorRef.current);
  const upgradeTarget = upgradeSrc && upgradeSrc !== src ? upgradeSrc : undefined;

  // 升级源随目标变化重置；页面隐藏/显示不重置（与主图同样保留已显示内容）。
  useEffect(() => {
    setUpgradeActivatedSrc('');
    setUpgradeDisplaySrc('');
    setUpgradeLoaded(false);
    setUpgradeFailed(false);
  }, [upgradeTarget, retryToken]);

  // 升级源懒加载激活：仅在页面可见时进行。
  useEffect(() => {
    if (!viewActive || !upgradeTarget || upgradeActivatedSrc === upgradeTarget) return;
    const node = containerRef.current;
    if (!node || eager || !('IntersectionObserver' in window)) {
      setUpgradeActivatedSrc(upgradeTarget);
      return;
    }
    const root = findScrollRoot(node);
    // 升级源只在卡片接近/进入视口时触发，避免与低清首屏同时抢带宽。
    const upgradeDistance = Math.max(root?.clientHeight ? Math.round(root.clientHeight * 0.2) : 0, 160);
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setUpgradeActivatedSrc(upgradeTarget);
      observer.disconnect();
    }, { root, rootMargin: `${upgradeDistance}px 0px` });
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, upgradeTarget, viewActive, upgradeActivatedSrc]);

  const upgradeActivated = Boolean(upgradeTarget) && (eager || upgradeActivatedSrc === upgradeTarget);

  useEffect(() => {
    if (!activated || !src) {
      displaySrcRef.current = '';
      setDisplaySrc('');
      return;
    }
    const showImage = (url: string) => {
      // 原图回退或非网关源的地址不随缩略档位变化；同地址不会再触发 load，不能重置为透明。
      if (displaySrcRef.current === url) return;
      displaySrcRef.current = url;
      setLoaded(false);
      setFailed(false);
      setDisplaySrc(url);
    };
    if (useOriginal || !canUseMediaGateway(src)) {
      showImage(getMobileOriginalUrl(src));
      return;
    }

    const thumbnailUrl = buildMediaUrl(src, variant);
    const displayUrl = pin && thumbnailUrl.startsWith('/api/media') ? `${thumbnailUrl}&pin=1` : thumbnailUrl;
    if (!isMobileViewport()) {
      showImage(displayUrl);
      return;
    }
    const resource = acquireMobileThumbnailUrl(displayUrl);
    let active = true;
    resource.promise.then(objectUrl => {
      if (active) showImage(objectUrl);
    }).catch(error => {
      if (active && error?.name !== 'AbortError') setUseOriginal(true);
    });
    return () => {
      active = false;
      resource.release();
    };
  }, [activated, pin, src, useOriginal, variant, retryToken]);

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
  }, [upgradeActivated, upgradeTarget, upgradeVariant, retryToken]);

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
          key={`${displaySrc}:${retryToken}`}
          src={displaySrc}
          data-agent-original-src={getMobileOriginalUrl(src)}
          alt={alt}
          className={`${className} ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={event => { setLoaded(true); onLoad?.(event); }}
          onError={handleImageError}
          decoding="async"
          loading="eager"
          fetchPriority={eager ? 'high' : 'auto'}
        />
      )}
      {upgradeActivated && upgradeDisplaySrc && !upgradeFailed && (
        <img
          key={`${upgradeDisplaySrc}:${retryToken}`}
          src={upgradeDisplaySrc}
          alt={alt}
          aria-hidden="true"
          className={`${className} absolute inset-0 pointer-events-none transition-opacity duration-300 ${upgradeLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={event => { setUpgradeLoaded(true); }}
          onError={() => setUpgradeFailed(true)}
          decoding="async"
          loading="eager"
        />
      )}
      {activated && !loaded && !failed && !upgradeLoaded && <div className="smart-image-shimmer absolute inset-0 flex items-center justify-center text-xs text-gray-400"><span className="animate-pulse">{t("加载中…")}</span></div>}
      {activated && failed && !upgradeLoaded && (
        <button
          type="button"
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-transparent px-2 text-micro text-gray-500 dark:text-gray-400"
          onClick={event => { event.stopPropagation(); setRetryToken(value => value + 1); }}
        >
          <span className="text-lg opacity-70">▧</span><span>{t("加载失败 · 重试")}</span>
        </button>
      )}
    </div>
  );
};

interface OriginalImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

export const OriginalImage: React.FC<OriginalImageProps> = ({ src, decoding = 'async', onError, ...props }) => {
  useLanguage();
  const viewActive = useContext(ImageActivityContext);
  const gatewaySrc = getMobileOriginalUrl(src);
  const [displaySrc, setDisplaySrc] = useState(gatewaySrc);

  useEffect(() => setDisplaySrc(gatewaySrc), [gatewaySrc, src]);
  if (!viewActive) return null;

  return (
    <img
      src={displaySrc}
      data-agent-original-src={gatewaySrc}
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
