import React, { useEffect, useState } from 'react';
import { Copy, Image as ImageIcon, Layers, MessageCircle, Move, Trash2, Upload } from 'lucide-react';
import { t } from '../../services/i18n';
import { getPanelBoundingBox } from '../../services/comic/comicGeometry';
import { COMIC_BUBBLE_SHAPES, getBubbleShapeMeta } from '../../services/comic/comicArtwork';
import { getGuidePanelPolygon } from '../../services/comic/comicLayoutTemplateRenderer';
import type {
  ComicAiGuidePanel,
  ComicAnchor,
  ComicBubbleItem,
  ComicBubbleShape,
  ComicPanel,
  ComicPoint,
  ComicTool,
} from '../../services/comic/comicTypes';
import { ComicBubbleShapeIcon } from './ComicBubbleShapeIcon';

export type FloatingBubbleTarget =
  | {
    mode: 'vector';
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    shape: ComicBubbleShape;
    writingMode: ComicBubbleItem['writingMode'];
    hasTail: boolean;
    isCustomImage: boolean;
    fontSize: number;
  }
  | {
    mode: 'ai-anchor';
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    shape: ComicBubbleShape;
    writingMode: ComicBubbleItem['writingMode'];
    hasTail: boolean;
    fontSize: number;
  }
  | {
    mode: 'panel-anchor';
    panelId: string;
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    shape: ComicBubbleShape;
    writingMode: ComicBubbleItem['writingMode'];
    hasTail: boolean;
    fontSize: number;
  };

/** 选格极简悬浮快捷条（手动格：上传/历史选图/叠框/移图/清图；AI 引导格：叠框/无框/出血/复制/删除）。 */
export const ComicPanelFloatingBar: React.FC<{
  targetManual: ComicPanel | null;
  targetGuide: ComicAiGuidePanel | null;
  getEffectiveManualPoly: (panel: ComicPanel) => ComicPoint[];
  onTriggerPanelUpload: (panelId: string) => void;
  onOpenPanelHistoryPicker?: (panelId: string) => void;
  onTogglePanelOverlay?: (panelId: string) => void;
  onSelectTool?: (tool: ComicTool) => void;
  onUpdatePanel: (panelId: string, updater: (panel: ComicPanel) => ComicPanel, commit?: boolean) => void;
  onToggleGuidePanelFlag?: (guideId: string, flag: 'inset' | 'borderless' | 'bleed') => void;
  onDuplicateGuidePanel?: (guideId: string) => void;
  onDeleteGuidePanel?: (guideId: string) => void;
}> = ({
  targetManual,
  targetGuide,
  getEffectiveManualPoly,
  onTriggerPanelUpload,
  onOpenPanelHistoryPicker,
  onTogglePanelOverlay,
  onSelectTool,
  onUpdatePanel,
  onToggleGuidePanelFlag,
  onDuplicateGuidePanel,
  onDeleteGuidePanel,
}) => {
  if (!targetManual && !targetGuide) return null;
  const poly = targetManual ? getEffectiveManualPoly(targetManual) : getGuidePanelPolygon(targetGuide!);
  const b = getPanelBoundingBox(poly, 1, 1);
  const showBelow = b.minY < 0.14;
  const alignMode = b.cx < 0.34 ? 'left' : b.cx > 0.66 ? 'right' : 'center';
  const style: React.CSSProperties = {
    top: `${(showBelow ? Math.min(0.95, b.maxY) : Math.max(0.03, b.minY)) * 100}%`,
    ...(alignMode === 'left' ? { left: '6px' } : alignMode === 'right' ? { right: '6px' } : { left: `${b.cx * 100}%` }),
    transform: `translate(${alignMode === 'center' ? '-50%' : '0%'}, ${showBelow ? '12px' : 'calc(-100% - 34px)'})`,
  };
  if (targetManual) {
    return (
      <div
        role="toolbar"
        aria-label={t('分镜格快捷操作')}
        style={style}
        onPointerDown={e => e.stopPropagation()}
        className="appearance-panel absolute z-30 flex w-max items-center gap-1 whitespace-nowrap rounded-xl border border-gray-200/95 bg-white/95 px-1.5 py-1 text-[11px] shadow-lg backdrop-blur dark:border-gray-700/90 dark:bg-gray-900/95"
      >
        <button
          type="button"
          aria-label={t('上传图片填入该格')}
          title={t('上传图片填入该格')}
          onClick={() => onTriggerPanelUpload(targetManual.id)}
          className="inline-flex h-6 items-center gap-1 rounded-lg px-2 font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <Upload className="h-3 w-3 text-indigo-500" />
          <span>{t('上传')}</span>
        </button>
        {onOpenPanelHistoryPicker && (
          <button
            type="button"
            aria-label={t('从历史选图填入该格')}
            title={t('从生成历史选图填入该格')}
            onClick={() => onOpenPanelHistoryPicker(targetManual.id)}
            className="inline-flex h-6 items-center gap-1 rounded-lg px-2 font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <ImageIcon className="h-3 w-3 text-indigo-500" />
            <span>{t('选图')}</span>
          </button>
        )}
        {onTogglePanelOverlay && (
          <button
            type="button"
            aria-label={t('切换叠加画框')}
            aria-pressed={Boolean(targetManual.inset)}
            title={t('切换上层叠加画框（支持透明立绘压在普通框之上）')}
            onClick={() => onTogglePanelOverlay(targetManual.id)}
            className={`inline-flex h-6 items-center gap-1 rounded-lg px-2 font-semibold transition ${targetManual.inset ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-200' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
          >
            <Layers className="h-3 w-3" />
            <span>{t('叠框')}</span>
          </button>
        )}
        {targetManual.image?.url && onSelectTool && (
          <button
            type="button"
            aria-label={t('格内移图位置')}
            title={t('调整格内构图与缩放 (M)')}
            onClick={() => onSelectTool('frame-image')}
            className="inline-flex h-6 items-center gap-1 rounded-lg px-2 font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <Move className="h-3 w-3 text-indigo-500" />
            <span>{t('移图')}</span>
          </button>
        )}
        {targetManual.image?.url && (
          <button
            type="button"
            aria-label={t('清除当前格图片')}
            title={t('清除当前格图片')}
            onClick={() => onUpdatePanel(targetManual.id, p => ({ ...p, image: undefined }), true)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }
  return (
    <div
      role="toolbar"
      aria-label={t('引导格快捷操作')}
      style={style}
      onPointerDown={e => e.stopPropagation()}
      className="appearance-panel absolute z-30 flex w-max items-center gap-1 whitespace-nowrap rounded-xl border border-gray-200/95 bg-white/95 px-1.5 py-1 text-[11px] shadow-lg backdrop-blur dark:border-gray-700/90 dark:bg-gray-900/95"
    >
      {onToggleGuidePanelFlag && (
        <>
          <button
            type="button"
            aria-pressed={Boolean(targetGuide!.inset)}
            onClick={() => onToggleGuidePanelFlag(targetGuide!.id, 'inset')}
            className={`inline-flex h-6 items-center rounded-lg px-2 font-semibold transition ${targetGuide!.inset ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-200' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
          >
            {t('叠框')}
          </button>
          <button
            type="button"
            aria-pressed={Boolean(targetGuide!.borderless)}
            onClick={() => onToggleGuidePanelFlag(targetGuide!.id, 'borderless')}
            className={`inline-flex h-6 items-center rounded-lg px-2 font-semibold transition ${targetGuide!.borderless ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-200' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
          >
            {t('无框')}
          </button>
          <button
            type="button"
            aria-pressed={Boolean(targetGuide!.bleed)}
            onClick={() => onToggleGuidePanelFlag(targetGuide!.id, 'bleed')}
            className={`inline-flex h-6 items-center rounded-lg px-2 font-semibold transition ${targetGuide!.bleed ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-200' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
          >
            {t('出血')}
          </button>
        </>
      )}
      {onDuplicateGuidePanel && (
        <button
          type="button"
          aria-label={t('复制引导格')}
          onClick={() => onDuplicateGuidePanel(targetGuide!.id)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <Copy className="h-3 w-3" />
        </button>
      )}
      {onDeleteGuidePanel && (
        <button
          type="button"
          aria-label={t('删除引导格')}
          onClick={() => onDeleteGuidePanel(targetGuide!.id)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};

/** PS 上下文悬浮气泡迷你工具条：点击气泡立即可切换 12 种日漫框形、横竖排、尾巴、字号、复制、删除。 */
export const ComicBubbleFloatingBar: React.FC<{
  fb: FloatingBubbleTarget;
  onUpdateBubble?: (id: string, updater: (item: ComicBubbleItem) => ComicBubbleItem, commit?: boolean) => void;
  onDuplicateBubble?: (id: string) => void;
  onDeleteBubble?: (id: string) => void;
  onUpdateAiAnchor?: (anchorId: string, updater: (anchor: ComicAnchor) => ComicAnchor, commit?: boolean) => void;
  onDeleteAiAnchor?: (anchorId: string) => void;
  onUpdatePanel: (panelId: string, updater: (panel: ComicPanel) => ComicPanel, commit?: boolean) => void;
  onSelectPanel: (panelId: string) => void;
  onConvertAnchorBubbleToVector?: (source: { kind: 'ai-anchor'; anchorId: string } | { kind: 'panel-anchor'; panelId: string; anchorId: string }) => void;
}> = ({
  fb,
  onUpdateBubble,
  onDuplicateBubble,
  onDeleteBubble,
  onUpdateAiAnchor,
  onDeleteAiAnchor,
  onUpdatePanel,
  onSelectPanel,
  onConvertAnchorBubbleToVector,
}) => {
  const [shapePopoverOpen, setShapePopoverOpen] = useState(false);

  useEffect(() => {
    setShapePopoverOpen(false);
  }, [fb.mode, fb.id]);

  const anchorTop = Math.max(0.03, fb.y - fb.height / 2);
  const showBelow = anchorTop < 0.18;
  const barTopPct = showBelow ? Math.min(0.95, fb.y + fb.height / 2) * 100 : anchorTop * 100;
  // 靠画纸左侧时左对齐、靠右侧时右对齐，彻底防止悬浮工具条超出画布左右边界被裁切
  const alignMode = fb.x < 0.36 ? 'left' : fb.x > 0.64 ? 'right' : 'center';
  const translateX = alignMode === 'left' ? '0%' : alignMode === 'right' ? '0%' : '-50%';
  const translateY = showBelow ? '16px' : 'calc(-100% - 34px)';
  const posStyle: React.CSSProperties = {
    top: `${barTopPct}%`,
    ...(alignMode === 'left'
      ? { left: '4px' }
      : alignMode === 'right'
        ? { right: '4px' }
        : { left: `${fb.x * 100}%` }),
    transform: `translate(${translateX}, ${translateY})`,
  };
  const shapeMeta = getBubbleShapeMeta(fb.shape);

  const updateShape = (shape: ComicBubbleShape) => {
    if (fb.mode === 'vector') {
      onUpdateBubble?.(fb.id, cur => ({
        ...cur,
        shape,
        customAssetId: undefined,
        customImageUrl: undefined,
      }), true);
    } else if (fb.mode === 'ai-anchor') {
      onUpdateAiAnchor?.(fb.id, cur => ({ ...cur, bubbleShape: shape }), true);
    } else {
      onUpdatePanel(fb.panelId, panel => ({
        ...panel,
        anchors: panel.anchors.map(a => a.id === fb.id ? { ...a, bubbleShape: shape } : a),
      }), true);
    }
    setShapePopoverOpen(false);
  };

  const toggleWritingMode = () => {
    const next = fb.writingMode === 'vertical' ? 'horizontal' : 'vertical';
    if (fb.mode === 'vector') {
      onUpdateBubble?.(fb.id, cur => ({ ...cur, writingMode: next }), true);
    } else if (fb.mode === 'ai-anchor') {
      onUpdateAiAnchor?.(fb.id, cur => ({ ...cur, bubbleWritingMode: next }), true);
    } else {
      onUpdatePanel(fb.panelId, panel => ({
        ...panel,
        anchors: panel.anchors.map(a => a.id === fb.id ? { ...a, bubbleWritingMode: next } : a),
      }), true);
    }
  };

  const adjustFontSize = (delta: number) => {
    const next = Math.max(12, Math.min(54, fb.fontSize + delta));
    if (fb.mode === 'vector') {
      onUpdateBubble?.(fb.id, cur => ({ ...cur, fontSize: next }), true);
    } else if (fb.mode === 'ai-anchor') {
      onUpdateAiAnchor?.(fb.id, cur => ({ ...cur, bubbleFontSize: next }), true);
    } else {
      onUpdatePanel(fb.panelId, panel => ({
        ...panel,
        anchors: panel.anchors.map(a => a.id === fb.id ? { ...a, bubbleFontSize: next } : a),
      }), true);
    }
  };

  const handleDelete = () => {
    if (fb.mode === 'vector') {
      onDeleteBubble?.(fb.id);
    } else if (fb.mode === 'ai-anchor') {
      onDeleteAiAnchor?.(fb.id);
    } else {
      onUpdatePanel(fb.panelId, panel => ({
        ...panel,
        anchors: panel.anchors.filter(a => a.id !== fb.id),
      }), true);
      onSelectPanel(fb.panelId);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label={t('气泡快捷编辑条')}
      style={posStyle}
      onPointerDown={e => e.stopPropagation()}
      className="appearance-panel absolute z-35 flex w-max items-center gap-1 whitespace-nowrap rounded-xl border border-gray-200/95 bg-white/95 px-1.5 py-1 shadow-xl backdrop-blur dark:border-gray-700/90 dark:bg-gray-900/95"
    >
      <div className="relative flex-none">
        <button
          type="button"
          aria-label={t('切换气泡样式')}
          onClick={() => setShapePopoverOpen(v => !v)}
          className="flex h-7 flex-none items-center gap-1 whitespace-nowrap rounded-lg border border-gray-200 bg-gray-50 px-1.5 text-[11px] font-semibold text-gray-700 hover:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          <ComicBubbleShapeIcon shape={fb.shape} className="h-4 w-5 flex-none text-gray-800 dark:text-slate-100" />
          <span className="max-w-16 truncate">{t(shapeMeta.label)}</span>
        </button>
        {shapePopoverOpen && (
          <div className="absolute left-0 top-full z-50 mt-1.5 grid w-64 grid-cols-4 gap-1 rounded-xl border border-gray-200 bg-white p-1.5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            {COMIC_BUBBLE_SHAPES.map(meta => (
              <button
                key={meta.id}
                type="button"
                onClick={() => updateShape(meta.id)}
                className={`flex flex-col items-center rounded-lg border p-1 transition ${fb.shape === meta.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-transparent text-gray-700 hover:border-gray-200 hover:bg-gray-50 dark:text-slate-200 dark:hover:border-gray-700 dark:hover:bg-gray-800'}`}
              >
                <ComicBubbleShapeIcon shape={meta.id} className="h-5 w-7" />
                <span className="mt-0.5 w-full truncate text-center text-[9px] font-medium">{t(meta.label)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        aria-label={t('切换横排竖排')}
        title={t('切换横排竖排')}
        onClick={toggleWritingMode}
        className="flex h-7 flex-none items-center whitespace-nowrap rounded-lg px-2 text-[11px] font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        {fb.writingMode === 'vertical' ? t('竖排') : t('横排')}
      </button>

      {fb.mode === 'vector' && !fb.isCustomImage && (
        <button
          type="button"
          aria-label={t('切换气泡尾巴')}
          title={t('切换气泡尾巴')}
          onClick={() => onUpdateBubble?.(fb.id, cur => ({ ...cur, hasTail: !cur.hasTail }), true)}
          className={`flex h-7 flex-none items-center whitespace-nowrap rounded-lg px-2 text-[11px] font-semibold transition ${fb.hasTail ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
        >
          {t('尾巴')}
        </button>
      )}

      <div className="flex flex-none items-center rounded-lg border border-gray-200/80 dark:border-gray-700/80">
        <button
          type="button"
          aria-label={t('缩小字号')}
          onClick={() => adjustFontSize(-2)}
          className="flex h-7 w-6 items-center justify-center text-[11px] font-bold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          A-
        </button>
        <button
          type="button"
          aria-label={t('放大字号')}
          onClick={() => adjustFontSize(2)}
          className="flex h-7 w-6 items-center justify-center border-l border-gray-200/80 text-[11px] font-bold text-gray-600 hover:bg-gray-100 dark:border-gray-700/80 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          A+
        </button>
      </div>

      {fb.mode !== 'vector' && onConvertAnchorBubbleToVector && (
        <button
          type="button"
          aria-label={t('转为正式矢量气泡')}
          title={t('转为可精细调色与压层的正式漫画矢量气泡')}
          onClick={() => onConvertAnchorBubbleToVector(
            fb.mode === 'ai-anchor'
              ? { kind: 'ai-anchor', anchorId: fb.id }
              : { kind: 'panel-anchor', panelId: fb.panelId, anchorId: fb.id },
          )}
          className="flex h-7 flex-none items-center gap-1 whitespace-nowrap rounded-lg bg-amber-600 px-2 text-[11px] font-semibold text-white hover:bg-amber-500"
        >
          <MessageCircle className="h-3 w-3 flex-none" />
          <span>{t('转正式气泡')}</span>
        </button>
      )}

      {fb.mode === 'vector' && onDuplicateBubble && (
        <button
          type="button"
          aria-label={t('复制气泡')}
          title={t('复制气泡')}
          onClick={() => onDuplicateBubble(fb.id)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}

      <button
        type="button"
        aria-label={t('删除气泡')}
        title={t('删除气泡')}
        onClick={handleDelete}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
