import React from 'react';
import { Magnet, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { t } from '../../services/i18n';

/** 右下角极简缩放与吸附悬浮胶囊。 */
export const ComicCanvasZoomBar: React.FC<{
  snapEnabled: boolean;
  zoom: number;
  onToggleSnap: () => void;
  onZoomChange: (nextZoom: number) => void;
  onZoomFit: () => void;
}> = ({
  snapEnabled,
  zoom,
  onToggleSnap,
  onZoomChange,
  onZoomFit,
}) => (
  <div className="appearance-panel absolute right-3 bottom-3 z-20 flex items-center gap-1 rounded-full border border-gray-200/90 bg-white/92 px-1.5 py-1 shadow-md backdrop-blur dark:border-gray-700/80 dark:bg-gray-900/92">
    <button
      type="button"
      aria-label={t('边缘与网格吸附')}
      aria-pressed={snapEnabled}
      title={t('边缘与网格吸附')}
      onClick={onToggleSnap}
      className={`flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold transition ${snapEnabled ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
    >
      <Magnet className="h-3 w-3" />
      <span className="hidden md:inline">{t('吸附')}</span>
    </button>
    <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
    <button
      type="button"
      aria-label={t('缩小画布')}
      onClick={() => onZoomChange(Math.max(0.25, Number((zoom - 0.1).toFixed(2))))}
      className="flex h-6 w-6 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      <ZoomOut className="h-3.5 w-3.5" />
    </button>
    <button
      type="button"
      aria-label={t('适配画布缩放')}
      onClick={onZoomFit}
      title={t('点击适应屏幕（也可用 Ctrl+滚轮缩放，抓手/空格平移）')}
      className="min-w-11 px-1 text-center font-mono text-xs font-semibold text-gray-700 hover:text-indigo-600 dark:text-gray-200"
    >
      {Math.round(zoom * 100)}%
    </button>
    <button
      type="button"
      aria-label={t('放大画布')}
      onClick={() => onZoomChange(Math.min(3, Number((zoom + 0.1).toFixed(2))))}
      className="flex h-6 w-6 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      <ZoomIn className="h-3.5 w-3.5" />
    </button>
    <button
      type="button"
      aria-label={t('适应屏幕')}
      title={t('适应屏幕')}
      onClick={onZoomFit}
      className="flex h-6 w-6 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      <Maximize2 className="h-3 w-3" />
    </button>
  </div>
);
