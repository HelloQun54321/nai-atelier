import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { MobileImageDisplayPreferences } from '../services/imageDisplayPreferences';

/**
 * 通用“最短列分配”瀑布流（画师串/角色串、生成历史共用）。
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
 * 桌面端设置（desktopColumns: 'auto' | 1-5）为明确数值时优先，auto 时用断点默认值。
 * 600-767px 横屏且移动端为 auto 时按 CSS 规则为 3 列。
 */
export const resolveMasonryColumnCount = (
  preferences: MobileImageDisplayPreferences,
  viewportWidth: number,
  isLandscape: boolean,
): number => {
  const { columns, desktopColumns } = preferences;
  if (viewportWidth < 768) {
    if (columns === 'auto') {
      return viewportWidth >= 600 && isLandscape ? 3 : 2;
    }
    return columns;
  }
  if (viewportWidth < 1280) return desktopColumns === 'auto' ? 4 : desktopColumns;
  if (viewportWidth < 1600) return desktopColumns === 'auto' ? 5 : desktopColumns;
  return desktopColumns === 'auto' ? 6 : desktopColumns;
};

/** 响应窗口尺寸变化，返回当前请求的列数（尚未扣除卡片数量）。 */
export const useMasonryColumnCount = (preferences: MobileImageDisplayPreferences): number => {
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));
  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return resolveMasonryColumnCount(preferences, viewport.width, viewport.width > viewport.height);
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
): T[][] => {
  const count = Math.max(0, Math.min(columnCount, items.length));
  const columns: T[][] = Array.from({ length: count }, () => []);
  if (count === 0) return columns;
  const heights = new Array<number>(count).fill(0);
  for (const item of items) {
    let target = 0;
    for (let i = 1; i < count; i += 1) {
      if (heights[i] < heights[target]) target = i;
    }
    columns[target].push(item);
    heights[target] += estimateHeight(item, columnWidth);
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
}

/**
 * 显式列容器瀑布流：外层等宽 Grid 只负责生成列，每列是 flex column，
 * 卡片保持自然高度。容器宽度经 ResizeObserver 监听，尺寸变化即重新分列。
 */
export const ShortestColumnMasonry = <T,>({
  items,
  columns,
  getItemKey,
  estimateItemHeight,
  renderItem,
  className,
  gap = 12,
}: ShortestColumnMasonryProps<T>) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(previous => (Math.abs(previous - width) > 0.5 ? width : previous));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 请求列数：决定网格轨道数与列宽，防御 NaN/Infinity/<1 后至少为 1
  const requestedColumns = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
  // 使用列数：实际需要放入内容的列数，只用于分列数组
  const usedColumns = Math.min(requestedColumns, items.length);

  // 列宽必须按 requestedColumns 计算：少图分组不能通过减少轨道数来放大卡片
  const columnWidth =
    containerWidth > 0 ? (containerWidth - (requestedColumns - 1) * gap) / requestedColumns : 0;

  const layout = useMemo(() => {
    if (usedColumns === 0 || columnWidth <= 0 || items.length === 0) return [] as T[][];
    return computeShortestColumnAssignment(items, usedColumns, estimateItemHeight, columnWidth);
  }, [items, usedColumns, estimateItemHeight, columnWidth]);

  return (
    <div
      ref={containerRef}
      className={className ? `chain-masonry ${className}` : 'chain-masonry'}
      style={{ gridTemplateColumns: `repeat(${requestedColumns}, minmax(0, 1fr))`, gap: `${gap}px` }}
    >
      {layout.map((column, index) => (
        <div key={index} className="chain-masonry-column">
          {column.map(item => (
            <Fragment key={getItemKey(item)}>{renderItem(item)}</Fragment>
          ))}
        </div>
      ))}
    </div>
  );
};
