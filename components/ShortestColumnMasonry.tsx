import { Fragment, ReactNode, RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { MobileImageDisplayPreferences } from '../services/imageDisplayPreferences';

/**
 * 通用“最短列分配”瀑布流（风格串/自定义角色、生成历史共用）。
 *
 * 不再依赖 CSS `column-count` 的自动平衡：CSS Multi-column 在小数量、大比例差异的
 * 组合下会只使用前 N-1 列，把第 N 列留成整块空白。这里改为显式生成等宽列容器，
 * 逐张卡片放入当前预计高度最小的列，从根源上保证每一列都被使用。
 *
 * 布局保持 requestedColumns 条固定宽度轨道；只渲染 min(requestedColumns, items.length)
 * 个非空列。数据少于列数时允许右侧轨道留空，以保持不同分组的卡片宽度一致。
 */

/**
 * 解析“偏好 + 当前视口 → 请求列数”，与 index.css 中 `.mobile-gallery` 的断点保持一致：
 *
 * 默认/手机：2；>= 768px：4；>= 1280px：5；>= 1600px：6。
 * 移动端设置（columns: 'auto' | 1 | 2 | 3）只在 < 768px 生效；
 * 桌面端设置（desktopColumns: 'auto' | 1-7）为明确数值时优先，auto 时用断点默认值。
 * 600-767px 横屏且移动端为 auto 时按 CSS 规则为 3 列。
 */
export const resolveMasonryColumnCount = (
  preferences: MobileImageDisplayPreferences,
  viewportWidth: number,
  isLandscape: boolean,
  desktopOverride?: number,
): number => {
  const { columns, desktopColumns } = preferences;
  if (viewportWidth < 768) {
    if (columns === 'auto') {
      return viewportWidth >= 600 && isLandscape ? 3 : 2;
    }
    return columns;
  }
  if (desktopColumns !== 'auto') return desktopColumns;
  if (desktopOverride !== undefined) return desktopOverride;
  if (viewportWidth < 1280) return 4;
  if (viewportWidth < 1600) return 5;
  return 6;
};

/** 自动列数同时受图库实际宽度约束；明确列数和手机偏好保持不变。 */
export const useMasonryColumnCount = (preferences: MobileImageDisplayPreferences, desktopOverride?: number, containerRef?: RefObject<HTMLElement | null>, minimumCardWidth = 180): number => {
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));
  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const [containerColumns, setContainerColumns] = useState(Infinity);
  const automaticDesktop = viewport.width >= 768 && preferences.desktopColumns === 'auto' && desktopOverride === undefined;
  useEffect(() => {
    const element = containerRef?.current;
    if (!automaticDesktop || !element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      // 隐藏的零宽度不改变列数；图片为主的工作区可沿用同一布局并要求更大的预览。
      if (width > 0) setContainerColumns(Math.max(1, Math.floor((width + 12) / (minimumCardWidth + 12))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, automaticDesktop, minimumCardWidth]);
  const requested = resolveMasonryColumnCount(preferences, viewport.width, viewport.width > viewport.height, desktopOverride);
  return automaticDesktop ? Math.min(requested, containerColumns) : requested;
};

/**
 * 按最短列分配卡片。保持 items 原有顺序，逐张放入当前预计高度最小的列；
 * 高度相同时取索引最小的列，保证最初的 N 张卡片自然从左到右各占一列。
 * 返回 usedColumns = min(columnCount, items.length) 个非空列（不生成空列）；
 * 网格轨道数与列宽由调用方按 requestedColumns 决定。
 */
export const computeShortestColumnAssignment = <T,>(
  items: readonly T[],
  columnCount: number,
  estimateHeight: (item: T, columnWidth: number) => number,
  columnWidth: number,
  /** 已显示卡片保持原列，尺寸更新只影响新卡片的最短列选择。 */
  placement?: { previous: ReadonlyMap<string, number>; next: Map<string, number>; key: (item: T) => string; measuredHeights?: readonly number[] },
  gap = 0,
): T[][] => {
  const count = Math.max(0, Math.min(columnCount, items.length));
  const columns: T[][] = Array.from({ length: count }, () => []);
  if (count === 0) return columns;
  const heights = placement?.measuredHeights ? placement.measuredHeights.map(height => height + gap) : new Array<number>(count).fill(0);
  for (const item of items) {
    let target = 0;
    for (let i = 1; i < count; i += 1) {
      if (heights[i] < heights[target]) target = i;
    }
    const retained = placement?.previous.get(placement.key(item));
    if (placement) {
      if (retained !== undefined && retained < count) target = retained;
      placement.next.set(placement.key(item), target);
    }
    columns[target].push(item);
    // 实测高度已包含旧卡片及其间距，只有新增卡片才继续累计。
    if (retained === undefined || !placement?.measuredHeights) heights[target] += estimateHeight(item, columnWidth) + gap;
  }
  return columns;
};

interface ShortestColumnMasonryProps<T> {
  /** 已排好序的展示数据，布局层不重新筛选或排序。 */
  items: readonly T[];
  /** 请求列数（用户设置/窗口断点解析结果）：决定网格轨道数与列宽，不随卡片数量变化。 */
  columns: number;
  getItemKey: (item: T) => string;
  /** 卡片预计高度（px）。columnWidth 为当前列实际宽度。 */
  estimateItemHeight: (item: T, columnWidth: number) => number;
  renderItem: (item: T) => ReactNode;
  className?: string;
  /** 列间距与卡片间距，默认 12px（与 .75rem 一致）。 */
  gap?: number;
  /** 默认保留已显示卡片所属列，避免侧栏挤压或图片尺寸返回时重挂载。 */
  stableColumns?: boolean;
  /** 主动改变查询条件时，即使结果恰好沿用旧前缀，也按新集合分列。 */
  resetKey?: unknown;
}

/**
 * 显式列容器瀑布流：外层等宽 Grid 只负责生成列，每列是 flex column，
 * 卡片保持自然高度。尺寸变化更新高度估算，旧卡片默认保留所属列。
 */
export const ShortestColumnMasonry = <T,>({
  items,
  columns,
  getItemKey,
  estimateItemHeight,
  renderItem,
  className,
  gap = 12,
  stableColumns = true,
  resetKey,
}: ShortestColumnMasonryProps<T>) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const latestWidth = useRef(0);
  const committed = useRef({ count: 0, keys: [] as string[], placement: new Map<string, number>(), resetKey });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      // 详情覆盖或 keep-alive 隐藏时宽度为 0；保留已有卡片，避免清空列表及滚动锚点。
      if (width <= 0) return;
      const firstMeasurement = latestWidth.current === 0;
      latestWidth.current = width;
      // 固定分列时由 CSS 连续伸缩；保留最新宽度供增删内容使用，不逐帧重渲染整批卡片。
      if (firstMeasurement) setContainerWidth(width);
      else if (!stableColumns) {
        setContainerWidth(previous => (Math.abs(previous - width) > 0.5 ? width : previous));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [stableColumns]);

  // 请求列数：决定网格轨道数与列宽，防御 NaN/Infinity/<1 后至少为 1
  const requestedColumns = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
  // 使用列数：实际需要放入内容的列数，只用于分列数组
  const usedColumns = Math.min(requestedColumns, items.length);

  // 列宽必须按 requestedColumns 计算：少图分组不能通过减少轨道数来放大卡片
  const columnWidth =
    containerWidth > 0 ? (latestWidth.current - (requestedColumns - 1) * gap) / requestedColumns : 0;

  const computed = useMemo(() => {
    const keys = items.map(getItemKey);
    // 仅同序列或尾部追加沿用列；筛选删项与中途插入必须按新集合重新平衡。
    const samePrefix = keys.length >= committed.current.keys.length && committed.current.keys.every((key, index) => key === keys[index]);
    const previous = stableColumns && committed.current.count === usedColumns && samePrefix && Object.is(committed.current.resetKey, resetKey)
      ? committed.current.placement : new Map<string, number>();
    // 纯尾追加按屏幕上的真实列高接续；异步图片/文字的估高误差不能让实际短列一直断粮。
    const measured = previous.size && keys.length > committed.current.keys.length
      ? Array.from(containerRef.current?.children || [], column => column.getBoundingClientRect().height) : [];
    const measuredHeights = measured.length === usedColumns && measured.every(height => height > 0) ? measured : undefined;
    const placement = new Map<string, number>();
    const layout = usedColumns === 0 || columnWidth <= 0 ? [] as T[][]
      : computeShortestColumnAssignment(items, usedColumns, estimateItemHeight, columnWidth,
        stableColumns ? { previous, next: placement, key: getItemKey, measuredHeights } : undefined, gap);
    return { layout, placement, keys, count: usedColumns, resetKey };
  }, [items, usedColumns, estimateItemHeight, columnWidth, stableColumns, getItemKey, gap, resetKey]);
  useEffect(() => { if (columnWidth > 0) committed.current = computed; }, [computed, columnWidth]);
  const layout = computed.layout;

  return (
    <div
      ref={containerRef}
      className={className ? `chain-masonry ${className}` : 'chain-masonry'}
      style={{ gridTemplateColumns: `repeat(${requestedColumns}, minmax(0, 1fr))`, gap: `${gap}px` }}
    >
      {layout.map((column, index) => (
        <div key={index} className="chain-masonry-column" style={{ position: 'relative' }}>
          {column.map(item => (
            <Fragment key={getItemKey(item)}>{renderItem(item)}</Fragment>
          ))}
          <div data-masonry-load-end="true" aria-hidden="true" style={{ position: 'absolute', bottom: 0, width: 1, height: 1 }} />
        </div>
      ))}
    </div>
  );
};
