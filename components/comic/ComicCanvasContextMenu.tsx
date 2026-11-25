import React from 'react';
import { Copy, Image as ImageIcon, Layers, Maximize2, MessageCircle, RotateCcw, Scissors, Trash2, Upload } from 'lucide-react';
import { t } from '../../services/i18n';
import type {
  ComicAiGuidePanel,
  ComicCreationMode,
  ComicPanel,
  ComicSelection,
  ComicTool,
} from '../../services/comic/comicTypes';

/** 轻量化右键快捷菜单：围绕选定画格/引导格与高频画布操作提供就手动作。 */
export const ComicCanvasContextMenu: React.FC<{
  contextMenu: { x: number; y: number };
  creationMode: ComicCreationMode;
  selection: ComicSelection;
  selectedPanel?: ComicPanel;
  selectedGuidePanel?: ComicAiGuidePanel;
  canUndo?: boolean;
  canRedo?: boolean;
  onClose: () => void;
  onTriggerPanelUpload?: (panelId: string) => void;
  onOpenPanelHistoryPicker?: (panelId: string) => void;
  onTogglePanelOverlay?: (panelId: string) => void;
  onTogglePanelBorderless?: (panelId: string) => void;
  onSelectTool?: (tool: ComicTool) => void;
  onBringPanelOrder?: (panelId: string, mode: 'front' | 'back') => void;
  onDuplicatePanel?: (panelId: string) => void;
  onDeletePanel?: (panelId: string) => void;
  onToggleGuidePanelFlag?: (guideId: string, flag: 'inset' | 'borderless' | 'bleed') => void;
  onDuplicateGuidePanel?: (guideId: string) => void;
  onDeleteGuidePanel?: (guideId: string) => void;
  onToggleLayersDrawer?: () => void;
  onZoomFit: () => void;
  onZoomChange: (nextZoom: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}> = ({
  contextMenu,
  creationMode,
  selection,
  selectedPanel,
  selectedGuidePanel,
  canUndo,
  canRedo,
  onClose,
  onTriggerPanelUpload,
  onOpenPanelHistoryPicker,
  onTogglePanelOverlay,
  onTogglePanelBorderless,
  onSelectTool,
  onBringPanelOrder,
  onDuplicatePanel,
  onDeletePanel,
  onToggleGuidePanelFlag,
  onDuplicateGuidePanel,
  onDeleteGuidePanel,
  onToggleLayersDrawer,
  onZoomFit,
  onZoomChange,
  onUndo,
  onRedo,
}) => (
  <div
    role="menu"
    aria-label={t('画布快捷菜单')}
    onPointerDown={e => e.stopPropagation()}
    onContextMenu={e => e.preventDefault()}
    style={{
      left: `${Math.min(contextMenu.x, Math.max(8, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 216))}px`,
      top: `${Math.min(contextMenu.y, Math.max(8, (typeof window !== 'undefined' ? window.innerHeight : 800) - 320))}px`,
    }}
    className="appearance-panel fixed z-50 min-w-48 rounded-xl border border-gray-200/95 bg-white/96 p-1.5 text-xs shadow-2xl backdrop-blur-md dark:border-gray-700/90 dark:bg-gray-900/96"
  >
    {creationMode === 'manual' && selection?.kind === 'panel' && selectedPanel && (
      <>
        <div className="px-2 py-1 text-[10px] font-semibold text-gray-400">
          {selectedPanel.name}
        </div>
        {onTriggerPanelUpload && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onTriggerPanelUpload(selectedPanel.id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
          >
            <Upload className="h-3.5 w-3.5 text-indigo-500" />
            <span>{t('上传图片填入该格')}</span>
          </button>
        )}
        {onOpenPanelHistoryPicker && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenPanelHistoryPicker(selectedPanel.id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
          >
            <ImageIcon className="h-3.5 w-3.5 text-indigo-500" />
            <span>{t('从历史选图填入该格')}</span>
          </button>
        )}
        {onTogglePanelOverlay && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onTogglePanelOverlay(selectedPanel.id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
          >
            <Layers className="h-3.5 w-3.5 text-amber-500" />
            <span>{selectedPanel.inset ? t('恢复为普通分镜格') : t('转为上层叠加画框')}</span>
          </button>
        )}
        {onTogglePanelBorderless && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onTogglePanelBorderless(selectedPanel.id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
          >
            <Maximize2 className="h-3.5 w-3.5 text-indigo-500" />
            <span>{selectedPanel.borderWidth === 0 ? t('恢复黑色边框') : t('切换无边框效果')}</span>
          </button>
        )}
        {onSelectTool && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onSelectTool('slice');
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
          >
            <Scissors className="h-3.5 w-3.5 text-indigo-500" />
            <span>{t('切分分镜格')}</span>
          </button>
        )}
        {onBringPanelOrder && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onBringPanelOrder(selectedPanel.id, 'front');
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
          >
            <Layers className="h-3.5 w-3.5 text-gray-500" />
            <span>{t('置顶叠框')}</span>
          </button>
        )}
        {onDuplicatePanel && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDuplicatePanel(selectedPanel.id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
          >
            <Copy className="h-3.5 w-3.5 text-gray-500" />
            <span>{t('复制分镜格')}</span>
          </button>
        )}
        {onDeletePanel && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDeletePanel(selectedPanel.id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t('删除分镜格')}</span>
          </button>
        )}
        <div className="my-1 border-t border-gray-200/80 dark:border-gray-800/80" />
      </>
    )}

    {creationMode === 'ai-page' && selectedGuidePanel && (
      <>
        <div className="px-2 py-1 text-[10px] font-semibold text-gray-400">
          {selectedGuidePanel.label}
        </div>
        {onToggleGuidePanelFlag && (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onToggleGuidePanelFlag(selectedGuidePanel.id, 'inset');
                onClose();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
            >
              <Layers className="h-3.5 w-3.5 text-amber-500" />
              <span>{selectedGuidePanel.inset ? t('取消叠加画框') : t('转为叠加画框')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onToggleGuidePanelFlag(selectedGuidePanel.id, 'borderless');
                onClose();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
            >
              <Maximize2 className="h-3.5 w-3.5 text-indigo-500" />
              <span>{selectedGuidePanel.borderless ? t('恢复引导黑边框') : t('切换无边框引导格')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onToggleGuidePanelFlag(selectedGuidePanel.id, 'bleed');
                onClose();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
            >
              <Maximize2 className="h-3.5 w-3.5 text-gray-500" />
              <span>{selectedGuidePanel.bleed ? t('取消出血格') : t('设为出血格')}</span>
            </button>
          </>
        )}
        {onSelectTool && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onSelectTool('slice');
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
          >
            <Scissors className="h-3.5 w-3.5 text-indigo-500" />
            <span>{t('切分引导格')}</span>
          </button>
        )}
        {onDuplicateGuidePanel && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDuplicateGuidePanel(selectedGuidePanel.id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
          >
            <Copy className="h-3.5 w-3.5 text-gray-500" />
            <span>{t('复制引导格')}</span>
          </button>
        )}
        {onDeleteGuidePanel && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDeleteGuidePanel(selectedGuidePanel.id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t('删除引导格')}</span>
          </button>
        )}
        <div className="my-1 border-t border-gray-200/80 dark:border-gray-800/80" />
      </>
    )}

    {onSelectTool && (
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onSelectTool('bubble');
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
      >
        <MessageCircle className="h-3.5 w-3.5 text-indigo-500" />
        <span>{t('添加气泡')}</span>
      </button>
    )}
    {onToggleLayersDrawer && (
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onToggleLayersDrawer();
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
      >
        <Layers className="h-3.5 w-3.5 text-gray-500" />
        <span>{t('图层与叠图')}</span>
      </button>
    )}
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onZoomFit();
        onClose();
      }}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
    >
      <Maximize2 className="h-3.5 w-3.5 text-gray-500" />
      <span>{t('适应屏幕')}</span>
    </button>
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onZoomChange(1);
        onClose();
      }}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
    >
      <RotateCcw className="h-3.5 w-3.5 text-gray-500" />
      <span>{t('重置 100% 缩放')}</span>
    </button>
    {(onUndo || onRedo) && (
      <div className="mt-1 grid grid-cols-2 gap-1 border-t border-gray-200/80 pt-1 dark:border-gray-800/80">
        {onUndo && (
          <button
            type="button"
            role="menuitem"
            disabled={!canUndo}
            onClick={() => {
              onUndo();
              onClose();
            }}
            className="rounded-lg px-2 py-1.5 text-center font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {t('撤销')}
          </button>
        )}
        {onRedo && (
          <button
            type="button"
            role="menuitem"
            disabled={!canRedo}
            onClick={() => {
              onRedo();
              onClose();
            }}
            className="rounded-lg px-2 py-1.5 text-center font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {t('重做')}
          </button>
        )}
      </div>
    )}
  </div>
);
