import React from 'react';
import {
  Brush,
  Eraser,
  Hand,
  MessageCircle,
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
  onSelectTool: (tool: ComicTool) => void;
  onChangeForegroundColor: (color: string) => void;
}

interface ToolDef {
  id: ComicTool;
  label: string;
  shortcut: string;
  tip: string;
  icon: React.ElementType;
}

const TOOL_GROUPS: ToolDef[][] = [
  [
    { id: 'select', label: '选择与移动', shortcut: 'V', tip: '选择与移动 (V)：选格、拖移、调斜角、双击改字', icon: MousePointer2 },
    { id: 'hand', label: '抓手平移', shortcut: 'H', tip: '抓手平移 (H)：左键直接拖动画布视野', icon: Hand },
    { id: 'zoom', label: '缩放镜', shortcut: 'Z', tip: '缩放镜 (Z)：点击放大，按住 Alt 点击缩小', icon: Search },
  ],
  [
    { id: 'draw-panel', label: '自由拉框', shortcut: 'R', tip: '自由拉框 (R)：在画布拖出新的分镜格', icon: SquarePlus },
    { id: 'slice', label: '两点一刀切分', shortcut: 'C', tip: '两点一刀切分 (C)：拖线切分划过的画格（Shift 锁 45°）', icon: Scissors },
    { id: 'frame-image', label: '格内移图', shortcut: 'M', tip: '格内移图 (M)：直接拖拽调整画格内成图的构图位置', icon: Move },
  ],
  [
    { id: 'bubble', label: '添加气泡', shortcut: 'B', tip: '添加气泡 (B)：在顶栏选框形后点击画布放置', icon: MessageCircle },
    { id: 'text', label: '添加文字', shortcut: 'T', tip: '添加文字 (T)：点击画布放置拟声词或效果字', icon: Type },
    { id: 'sticker', label: '添加贴纸', shortcut: 'S', tip: '添加贴纸 (S)：在顶栏选样式后点击画布放置', icon: Sticker },
  ],
  [
    { id: 'brush', label: '画笔', shortcut: 'P', tip: '画笔 (P)：在独立手绘层作画（不伤分镜画面）', icon: Brush },
    { id: 'eraser', label: '橡皮擦', shortcut: 'E', tip: '橡皮擦 (E)：擦除独立手绘层笔迹', icon: Eraser },
  ],
];

/**
 * 仿 PS / CSP 满高停靠式竖向工具栏（手机窄屏自动折为顶部单行滚动条）。
 */
export const ComicToolRail: React.FC<ComicToolRailProps> = ({
  activeTool,
  foregroundColor,
  onSelectTool,
  onChangeForegroundColor,
}) => {
  useLanguage();
  return (
    <div
      role="toolbar"
      aria-label={t('漫画画布工具')}
      className="appearance-panel flex flex-none flex-row items-center gap-1 overflow-x-auto border-b border-gray-200/80 bg-white/85 px-2 py-1.5 backdrop-blur-md dark:border-gray-800/80 dark:bg-gray-900/85 md:w-12 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:border-r md:px-1.5 md:py-2.5"
    >
      {TOOL_GROUPS.map((group, groupIdx) => (
        <React.Fragment key={groupIdx}>
          {groupIdx > 0 && (
            <span
              aria-hidden="true"
              className="h-5 w-px flex-none bg-gray-200 dark:bg-gray-700/80 md:my-1 md:h-px md:w-6"
            />
          )}
          <div className="flex flex-none flex-row items-center gap-0.5 md:flex-col md:gap-1">
            {group.map(item => {
              const Icon = item.icon;
              const active = activeTool === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={t(item.label)}
                  aria-pressed={active}
                  title={t(item.tip)}
                  onClick={() => onSelectTool(item.id)}
                  className={`group relative flex h-9 w-9 flex-none items-center justify-center rounded-lg transition ${active ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'}`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute right-0.5 bottom-0.5 hidden text-[8px] font-bold leading-none md:block ${active ? 'text-white/80' : 'text-gray-400/70 group-hover:text-gray-500 dark:text-gray-500'}`}
                  >
                    {item.shortcut}
                  </span>
                </button>
              );
            })}
          </div>
        </React.Fragment>
      ))}

      {/* PS 经典左下角前景色块：一键切换画笔/文字/贴纸主色 */}
      <div className="ml-auto flex flex-none items-center pl-2 md:mt-auto md:ml-0 md:flex-col md:border-t md:border-gray-200 md:pt-2.5 md:pl-0 dark:md:border-gray-800">
        <label
          title={t('前景色（画笔 / 文字 / 贴纸主色）')}
          className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border-2 border-white shadow-sm ring-1 ring-gray-300 transition hover:scale-105 dark:border-gray-800 dark:ring-gray-600"
          style={{ backgroundColor: foregroundColor }}
        >
          <input
            type="color"
            aria-label={t('前景色')}
            value={foregroundColor}
            onChange={event => onChangeForegroundColor(event.target.value)}
            className="sr-only"
          />
        </label>
      </div>
    </div>
  );
};
