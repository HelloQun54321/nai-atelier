import React from 'react';
import { IconButton } from './DesignSystem';

/**
 * 图库详情层共享组件：统一"移动端全屏覆盖 → xl 桌面右侧栏"的面板骨架。
 * 规范（各图库详情页一律遵守，见 docs/plans 统一方案）：
 * - 断点：xl(1280px) 起变侧栏；移动/平板为 fixed 覆盖层（配 aitag-split 网格）。
 * - 头部：h-14 固定高、底边框；返回钮仅在覆盖形态显示（xl:hidden）。
 * - 图片容器：圆角 2xl、max-h 62vh 基准（DetailImageStage）。
 * - 操作按钮一律使用 DesignSystem 的 ToolbarButton/ToolbarLink/IconButton。
 */

interface DetailSidePanelProps {
  open: boolean;
  title: string;
  /** 将作品标题接入安全模式的点击显示逻辑 */
  sensitiveTitle?: boolean;
  /** 标题下的副信息行（尺寸·页数·来源等） */
  subInfo?: string;
  onClose: () => void;
  /** 覆盖形态下的返回按钮（移动端历史层） */
  onBack?: () => void;
  /** 面板滚动容器 ref（部分页面用于缓存滚动位置） */
  bodyRef?: React.Ref<HTMLDivElement>;
  /** 面板滚动容器滚动事件 */
  onBodyScroll?: React.UIEventHandler<HTMLDivElement>;
  children: React.ReactNode;
}

export const DetailSidePanel: React.FC<DetailSidePanelProps> = ({ open, title, sensitiveTitle = false, subInfo, onClose, onBack, bodyRef, onBodyScroll, children }) => (
  <aside
    data-safe-mode-work={sensitiveTitle ? 'true' : undefined}
    className={`aitag-detail-panel ${open ? 'aitag-detail-panel--open flex' : 'aitag-detail-panel--closed hidden'} fixed inset-0 z-[1050] min-h-0 flex-col border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 xl:static xl:z-auto xl:border-l`}
    aria-label={title}
  >
    <header className="flex h-14 flex-none items-center justify-between gap-2 border-b border-gray-200 px-4 dark:border-gray-800">
      <div className="flex min-w-0 items-center gap-2">
        {onBack && <IconButton label="返回" onClick={onBack} className="mobile-touch aitag-detail-back xl:hidden"><DetailBackIcon /></IconButton>}
        <div className="min-w-0">
          <p data-safe-mode-title={sensitiveTitle ? 'true' : undefined} className="truncate text-sm font-bold">{title}</p>
          {subInfo && <p className="truncate text-[10px] text-gray-500 dark:text-gray-400">{subInfo}</p>}
        </div>
      </div>
      <IconButton label="关闭" onClick={onClose} className="hidden xl:inline-flex"><DetailCloseIcon /></IconButton>
    </header>
    <div ref={bodyRef} onScroll={onBodyScroll} className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
  </aside>
);

interface DetailImageStageProps {
  /** 可选翻页控件（多页作品单页浏览模式） */
  pager?: {
    page: number;
    count: number;
    onPrev: () => void;
    onNext: () => void;
  };
  children: React.ReactNode;
}

export const DetailImageStage: React.FC<DetailImageStageProps> = ({ pager, children }) => (
  <div className="space-y-4">
    <div className="overflow-hidden rounded-2xl bg-black/5 dark:bg-black/30">{children}</div>
    {pager && pager.count > 1 && (
      <div className="flex items-center justify-center gap-3">
        <IconButton label="上一页" disabled={pager.page <= 0} onClick={pager.onPrev}><DetailPrevIcon /></IconButton>
        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">{pager.page + 1} / {pager.count}</span>
        <IconButton label="下一页" disabled={pager.page >= pager.count - 1} onClick={pager.onNext}><DetailNextIcon /></IconButton>
      </div>
    )}
  </div>
);

export interface TagChipDescriptor {
  label: string;
  onClick?: () => void;
}

/** 可点击 tag chip：点击通常触发同标签搜索。 */
export const TagChip: React.FC<TagChipDescriptor> = ({ label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 transition hover:border-indigo-400 hover:text-indigo-600 disabled:cursor-default disabled:hover:border-gray-200 disabled:hover:text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400 dark:disabled:hover:border-gray-700 dark:disabled:hover:text-gray-300"
  >
    {label}
  </button>
);

export const TagChipGroup: React.FC<{ chips: TagChipDescriptor[] }> = ({ chips }) => (
  <div className="flex flex-wrap gap-1.5">
    {chips.map(chip => <TagChip key={chip.label} {...chip} />)}
  </div>
);

/** 移动端覆盖形态返回用的箭头图标（与各页现用 lucide ArrowLeft 同形）。 */
const DetailBackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
);
const DetailCloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
);
const DetailPrevIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
);
const DetailNextIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
);
