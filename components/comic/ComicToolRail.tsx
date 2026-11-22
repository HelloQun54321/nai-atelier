import React, { useEffect, useRef, useState } from 'react';
import {
  Brush,
  Eraser,
  Hand,
  Layers,
  MessageCircle,
  MoreHorizontal,
  MousePointer2,
  Move,
  Scissors,
  Search,
  SquarePlus,
  Sticker,
  Type,
} from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import type { ComicTool } from '../../services/comic/comicTypes';

interface ComicToolRailProps {
  activeTool: ComicTool;
  foregroundColor: string;
  layerCount?: number;
  layersDrawerOpen?: boolean;
  onSelectTool: (tool: ComicTool) => void;
  onChangeForegroundColor: (color: string) => void;
  onToggleLayersDrawer?: () => void;
}

interface ToolDef {
  id: ComicTool;
  label: string;
  shortLabel: string;
  shortcut: string;
  tip: string;
  icon: React.ElementType;
}

const PRIMARY_TOOLS: ToolDef[] = [
  { id: 'select', label: '选择与移动', shortLabel: '选择', shortcut: 'V', tip: '选择与移动 (V)：选格、拖移、调斜角、双击改字', icon: MousePointer2 },
  { id: 'draw-panel', label: '自由拉框', shortLabel: '加格', shortcut: 'R', tip: '自由拉框 (R)：在画布拖出新的分镜格', icon: SquarePlus },
  { id: 'slice', label: '两点一刀切分', shortLabel: '切格', shortcut: 'C', tip: '两点一刀切分 (C)：拖线切分划过的画格（Shift 锁 45°）', icon: Scissors },
  { id: 'bubble', label: '添加气泡', shortLabel: '气泡', shortcut: 'B', tip: '添加气泡 (B)：在顶栏选框形后点击画布放置', icon: MessageCircle },
  { id: 'text', label: '添加文字', shortLabel: '文字', shortcut: 'T', tip: '添加文字 (T)：点击画布放置拟声词或效果字', icon: Type },
];

const SECONDARY_TOOLS: ToolDef[] = [
  { id: 'frame-image', label: '格内移图', shortLabel: '移图', shortcut: 'M', tip: '格内移图 (M)：直接拖拽调整画格内成图的构图位置', icon: Move },
  { id: 'sticker', label: '添加贴纸', shortLabel: '贴纸', shortcut: 'S', tip: '添加贴纸 (S)：在顶栏选样式后点击画布放置', icon: Sticker },
  { id: 'brush', label: '画笔', shortLabel: '画笔', shortcut: 'P', tip: '画笔 (P)：在独立手绘层作画（不伤分镜画面）', icon: Brush },
  { id: 'eraser', label: '橡皮擦', shortLabel: '橡皮', shortcut: 'E', tip: '橡皮擦 (E)：擦除独立手绘层笔迹', icon: Eraser },
  { id: 'hand', label: '抓手平移', shortLabel: '抓手', shortcut: 'H', tip: '抓手平移 (H)：左键直接拖动画布视野（日常也可空格拖拽）', icon: Hand },
  { id: 'zoom', label: '缩放镜', shortLabel: '缩放', shortcut: 'Z', tip: '缩放镜 (Z)：点击放大，按住 Alt 点击缩小', icon: Search },
];

/**
 * 画布底部居中悬浮轻工具胶囊：
 * 仅常驻分格与嵌字 5 个高频工具，低频工具（移图、贴纸、画笔、橡皮、抓手、图层叠加）收入「更多」弹层，
 * 彻底告别贴在全局侧栏旁的 PS 第二条竖工具栏。
 */
export const ComicToolRail: React.FC<ComicToolRailProps> = ({
  activeTool,
  foregroundColor,
  layerCount = 2,
  layersDrawerOpen = false,
  onSelectTool,
  onChangeForegroundColor,
  onToggleLayersDrawer,
}) => {
  useLanguage();
  const [moreOpen, setMoreOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const activeSecondary = SECONDARY_TOOLS.find(item => item.id === activeTool);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  return (
    <div
      ref={wrapRef}
      role="toolbar"
      aria-label={t('漫画画布工具')}
      className="pointer-events-auto relative inline-flex items-center gap-0.5 rounded-full border border-gray-200/90 bg-white/95 p-1 shadow-md backdrop-blur-md dark:border-gray-700/90 dark:bg-gray-900/95"
    >
      {PRIMARY_TOOLS.map(item => {
        const Icon = item.icon;
        const active = activeTool === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-label={t(item.label)}
            aria-pressed={active}
            title={t(item.tip)}
            onClick={() => {
              onSelectTool(item.id);
              setMoreOpen(false);
            }}
            className={`inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition ${active ? 'bg-indigo-600 text-white shadow-xs' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'}`}
          >
            <Icon className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            <span className="hidden sm:inline">{t(item.shortLabel)}</span>
          </button>
        );
      })}

      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-gray-200 dark:bg-gray-700" />

      <button
        type="button"
        aria-label={t('更多画布工具')}
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        title={t('更多工具（移图、贴纸、画笔、图层与叠加图片）')}
        onClick={() => setMoreOpen(open => !open)}
        className={`inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs font-semibold transition ${activeSecondary || moreOpen || layersDrawerOpen ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-200' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'}`}
      >
        {activeSecondary ? (
          <>
            <activeSecondary.icon className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            <span className="hidden sm:inline">{t(activeSecondary.shortLabel)}</span>
          </>
        ) : (
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      {moreOpen && (
        <div
          role="menu"
          aria-label={t('更多画布工具菜单')}
          className="absolute right-0 bottom-full z-40 mb-2 w-56 rounded-2xl border border-gray-200/90 bg-white/98 p-2 text-xs shadow-xl backdrop-blur-md dark:border-gray-700/90 dark:bg-gray-900/98"
        >
          <div className="grid grid-cols-2 gap-1">
            {SECONDARY_TOOLS.map(item => {
              const Icon = item.icon;
              const active = activeTool === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  aria-label={t(item.label)}
                  aria-pressed={active}
                  title={t(item.tip)}
                  onClick={() => {
                    onSelectTool(item.id);
                    setMoreOpen(false);
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left font-medium transition ${active ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'}`}
                >
                  <Icon className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{t(item.shortLabel)}</span>
                  <span className={`font-mono text-[10px] ${active ? 'text-white/75' : 'text-gray-400'}`}>{item.shortcut}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 border-t border-gray-200/80 pt-2 dark:border-gray-800">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-medium text-gray-600 dark:text-gray-300">
              <span
                className="relative flex h-5 w-5 items-center justify-center rounded-md border border-gray-300 shadow-xs dark:border-gray-600"
                style={{ backgroundColor: foregroundColor }}
              >
                <input
                  type="color"
                  aria-label={t('前景色')}
                  value={foregroundColor}
                  onChange={event => onChangeForegroundColor(event.target.value)}
                  className="sr-only"
                />
              </span>
              <span>{t('前景色')}</span>
            </label>

            {onToggleLayersDrawer && (
              <button
                type="button"
                aria-pressed={layersDrawerOpen}
                onClick={() => {
                  onToggleLayersDrawer();
                  setMoreOpen(false);
                }}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${layersDrawerOpen ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/70 dark:text-indigo-200' : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
              >
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('图层与叠图')}</span>
                <span className="rounded-full bg-gray-200/90 px-1 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">{layerCount}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
