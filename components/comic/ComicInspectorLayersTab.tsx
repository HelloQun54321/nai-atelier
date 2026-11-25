import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  FlipHorizontal2,
  FlipVertical2,
  ImagePlus,
  Lock,
  MessageCircle,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Type,
  Unlock,
} from 'lucide-react';
import { t } from '../../services/i18n';
import {
  COMIC_CUSTOM_ASSET_ACCEPT,
  computeNormalizedAssetBox,
  type ComicCustomAsset,
  type ComicCustomAssetKind,
} from '../../services/comic/comicAssets';
import { COMIC_BUBBLE_SHAPES, COMIC_FONT_PRESETS } from '../../services/comic/comicArtwork';
import {
  COMIC_BLEND_MODES,
  findLayerNodeForSelection,
  syncComicLayerStack,
} from '../../services/comic/comicLayers';
import type { ComicFontCatalogState } from '../../services/comic/comicFonts';
import type {
  ComicBlendMode,
  ComicBubbleItem,
  ComicFontFamily,
  ComicImageLayerItem,
  ComicLayerNode,
  ComicPageDraft,
  ComicSelection,
  ComicStickerItem,
  ComicTextItem,
} from '../../services/comic/comicTypes';
import { ComicBubbleShapeIcon } from './ComicBubbleShapeIcon';
import {
  ComicStickerIcon,
  CORE_BUBBLE_SHAPE_IDS,
  STICKER_KINDS,
} from './ComicInspectorShared';
import { ComicInspectorAssetLibrary } from './ComicInspectorAssetLibrary';
import { ComicInspectorFontLibrary } from './ComicInspectorFontLibrary';

interface ComicInspectorLayersTabProps {
  draft: ComicPageDraft;
  selection: ComicSelection;
  overlayCount: number;
  customAssets: ComicCustomAsset[];
  fontCatalog: ComicFontCatalogState;
  defaultFontId?: string | null;
  downloadingFontId: string | null;
  onSelect: (selection: ComicSelection) => void;
  onUpdateDraft: (updater: (current: ComicPageDraft) => ComicPageDraft, commit?: boolean) => void;
  onUpdateBubble: (id: string, updater: (item: ComicBubbleItem) => ComicBubbleItem, commit?: boolean) => void;
  onDeleteBubble: (id: string) => void;
  onUpdateText: (id: string, updater: (item: ComicTextItem) => ComicTextItem, commit?: boolean) => void;
  onDeleteText: (id: string) => void;
  onUpdateSticker: (id: string, updater: (item: ComicStickerItem) => ComicStickerItem, commit?: boolean) => void;
  onDeleteSticker: (id: string) => void;
  onQuickAddBubble?: () => void;
  onQuickAddText?: () => void;
  onQuickAddSticker?: () => void;
  onUpdateImageLayer: (id: string, updater: (item: ComicImageLayerItem) => ComicImageLayerItem, commit?: boolean) => void;
  onDeleteImageLayer: (id: string) => void;
  onUploadCustomAssets?: (files: File[], kind: ComicCustomAssetKind, options?: { insertToCanvas?: boolean; applyToSelectedBubble?: boolean }) => void;
  onInsertCustomAsset?: (asset: ComicCustomAsset, targetBubbleId?: string) => void;
  onRenameCustomAsset?: (id: string, name: string) => void;
  onDeleteCustomAsset?: (id: string) => void;
  onApplyTemporaryBubbleImage?: (bubbleId: string, file: File) => void;
  onImportImageFiles?: (files: File[], options?: { saveToLibrary?: boolean }) => void;
  onSaveImageLayerToLibrary?: (imageLayer: ComicImageLayerItem) => void;
  onDownloadFont: (id: string) => void;
  onUploadCustomFont: (fileOrFiles: File | File[]) => void;
  onRenameCustomFont?: (id: string, name: string) => void;
  onSetDefaultFont?: (fontId: string | null) => void;
  onDeleteFont: (id: string) => void;
}

/** 漫画工作台步骤 3：气泡嵌字、效果文字、贴纸、透明底图片图层、素材库与字体库。 */
export const ComicInspectorLayersTab: React.FC<ComicInspectorLayersTabProps> = ({
  draft,
  selection,
  overlayCount,
  customAssets,
  fontCatalog,
  defaultFontId = null,
  downloadingFontId,
  onSelect,
  onUpdateDraft,
  onUpdateBubble,
  onDeleteBubble,
  onUpdateText,
  onDeleteText,
  onUpdateSticker,
  onDeleteSticker,
  onQuickAddBubble,
  onQuickAddText,
  onQuickAddSticker,
  onUpdateImageLayer,
  onDeleteImageLayer,
  onUploadCustomAssets,
  onInsertCustomAsset,
  onRenameCustomAsset,
  onDeleteCustomAsset,
  onApplyTemporaryBubbleImage,
  onImportImageFiles,
  onSaveImageLayerToLibrary,
  onDownloadFont,
  onUploadCustomFont,
  onRenameCustomFont,
  onSetDefaultFont,
  onDeleteFont,
}) => {
  const [showAllBubbleShapes, setShowAllBubbleShapes] = useState(false);
  const fontFileInputRef = useRef<HTMLInputElement>(null);
  const quickImageInputRef = useRef<HTMLInputElement>(null);
  const bubbleAssetInputRef = useRef<HTMLInputElement>(null);
  const tempBubbleInputRef = useRef<HTMLInputElement>(null);

  const selectedBubble = selection?.kind === 'bubble'
    ? draft.bubbles.find(item => item.id === selection.id)
    : undefined;
  const selectedText = selection?.kind === 'text'
    ? draft.texts.find(item => item.id === selection.id)
    : undefined;
  const selectedSticker = selection?.kind === 'sticker'
    ? draft.stickers.find(item => item.id === selection.id)
    : undefined;
  const selectedImageLayer = selection?.kind === 'image'
    ? (draft.imageLayers || []).find(item => item.id === selection.id)
    : undefined;

  const syncedLayerStack = useMemo(() => syncComicLayerStack(draft).layerStack || [], [draft]);
  const selectedImageLayerNode = useMemo(
    () => (selection?.kind === 'image' ? findLayerNodeForSelection(syncedLayerStack, selection) : undefined),
    [selection, syncedLayerStack],
  );
  const customBubbleAssets = useMemo(
    () => customAssets.filter(item => item.kind === 'bubble'),
    [customAssets],
  );

  const updateLayerNodeProp = (layerId: string, updater: (node: ComicLayerNode) => ComicLayerNode, commit = true) => {
    onUpdateDraft(cur => {
      const synced = syncComicLayerStack(cur);
      return {
        ...synced,
        layerStack: (synced.layerStack || []).map(node => (node.id === layerId ? updater(node) : node)),
      };
    }, commit);
  };

  return (
    <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3.5 pb-6 text-xs">
      {/* 共用隐藏字体文件选择器（气泡/文字「+ 导入」与字体库「导入本机字体」共用） */}
      <input
        ref={fontFileInputRef}
        type="file"
        multiple
        accept=".ttf,.otf,.woff2,.woff"
        className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) onUploadCustomFont(files);
          e.target.value = '';
        }}
      />

      {/* 顶部常驻快捷添加：气泡 / 文字 / 贴纸 / 透明底图片 */}
      {(onQuickAddBubble || onQuickAddText || onQuickAddSticker || onImportImageFiles) && (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {onQuickAddBubble && (
            <button
              type="button"
              onClick={onQuickAddBubble}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200/90 bg-white px-1.5 py-1.5 text-[11px] font-semibold text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-200"
            >
              <MessageCircle className="h-3.5 w-3.5 flex-none text-amber-500" />
              <span className="truncate">{t('添加气泡')}</span>
            </button>
          )}
          {onQuickAddText && (
            <button
              type="button"
              onClick={onQuickAddText}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200/90 bg-white px-1.5 py-1.5 text-[11px] font-semibold text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-200"
            >
              <Type className="h-3.5 w-3.5 flex-none text-indigo-500" />
              <span className="truncate">{t('添加文字')}</span>
            </button>
          )}
          {onQuickAddSticker && (
            <button
              type="button"
              onClick={onQuickAddSticker}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200/90 bg-white px-1.5 py-1.5 text-[11px] font-semibold text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-200"
            >
              <Sparkles className="h-3.5 w-3.5 flex-none text-purple-500" />
              <span className="truncate">{t('添加贴纸')}</span>
            </button>
          )}
          {onImportImageFiles && (
            <>
              <input
                ref={quickImageInputRef}
                type="file"
                multiple
                accept={COMIC_CUSTOM_ASSET_ACCEPT}
                className="hidden"
                onChange={e => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) onImportImageFiles(files, { saveToLibrary: true });
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                title={t('导入透明底 PNG/WebP/SVG 等图片图层并自动入库')}
                onClick={() => quickImageInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200/90 bg-white px-1.5 py-1.5 text-[11px] font-semibold text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-200"
              >
                <ImagePlus className="h-3.5 w-3.5 flex-none text-emerald-500" />
                <span className="truncate">{t('添加图片')}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* 当前选中的气泡 / 文字 / 贴纸 / 图片图层属性编辑 */}
      {selectedBubble && (() => {
        const isCustomBubble = Boolean(selectedBubble.customImageUrl);
        const visibleShapeIds = CORE_BUBBLE_SHAPE_IDS.includes(selectedBubble.shape)
          ? CORE_BUBBLE_SHAPE_IDS
          : [...CORE_BUBBLE_SHAPE_IDS.slice(0, 3), selectedBubble.shape];
        const displayedShapes = showAllBubbleShapes
          ? COMIC_BUBBLE_SHAPES
          : COMIC_BUBBLE_SHAPES.filter(s => visibleShapeIds.includes(s.id));
        return (
          <div className="space-y-2.5 rounded-xl border border-indigo-200/80 bg-indigo-50/30 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/20">
            <div className="flex items-center justify-between">
              <span className="font-bold text-gray-800 dark:text-gray-100">{t('当前对白气泡')}</span>
              <button type="button" aria-label={t('删除气泡')} onClick={() => onDeleteBubble(selectedBubble.id)} className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <textarea
              rows={2}
              value={selectedBubble.text}
              onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, text: e.target.value }), false)}
              onBlur={() => onUpdateBubble(selectedBubble.id, i => i, true)}
              className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />

            {/* 气泡样式：内置矢量气泡 + 自定义透明气泡 */}
            <div className="space-y-1.5">
              <div className={`grid gap-1 ${showAllBubbleShapes ? 'grid-cols-3' : 'grid-cols-4'}`}>
                {displayedShapes.map(shape => (
                  <button
                    key={shape.id}
                    type="button"
                    aria-pressed={!isCustomBubble && selectedBubble.shape === shape.id}
                    onClick={() => onUpdateBubble(selectedBubble.id, i => ({
                      ...i,
                      shape: shape.id,
                      customAssetId: undefined,
                      customImageUrl: undefined,
                      hasTail: shape.supportsTail ? i.hasTail : false,
                    }), true)}
                    className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1 text-[10px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500 ${!isCustomBubble && selectedBubble.shape === shape.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/70 dark:text-indigo-100' : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-800/85 dark:text-slate-100 dark:hover:border-indigo-400'}`}
                  >
                    <ComicBubbleShapeIcon shape={shape.id} className="h-5 w-8" />
                    <span className="w-full truncate text-center">{t(shape.label)}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-expanded={showAllBubbleShapes}
                onClick={() => setShowAllBubbleShapes(open => !open)}
                className="w-full text-center text-[10px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {showAllBubbleShapes ? t('收起样式') : `${t('更多样式')} (${COMIC_BUBBLE_SHAPES.length})`}
              </button>

              {/* 自定义透明气泡选择与快捷导入 */}
              <div className="space-y-1.5 rounded-lg border border-gray-200/80 bg-white/70 p-1.5 dark:border-gray-700/80 dark:bg-gray-900/50">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                    {t('自定义气泡')}
                  </span>
                  <div className="flex items-center gap-1">
                    {onApplyTemporaryBubbleImage && (
                      <>
                        <input
                          ref={tempBubbleInputRef}
                          type="file"
                          accept={COMIC_CUSTOM_ASSET_ACCEPT}
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) onApplyTemporaryBubbleImage(selectedBubble.id, file);
                            e.target.value = '';
                          }}
                        />
                        <button
                          type="button"
                          title={t('仅替换当前气泡图片（不存入素材库）')}
                          onClick={() => tempBubbleInputRef.current?.click()}
                          className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                        >
                          {t('仅本页换图')}
                        </button>
                      </>
                    )}
                    {onUploadCustomAssets && (
                      <>
                        <input
                          ref={bubbleAssetInputRef}
                          type="file"
                          multiple
                          accept={COMIC_CUSTOM_ASSET_ACCEPT}
                          className="hidden"
                          onChange={e => {
                            const files = Array.from(e.target.files || []);
                            if (files.length > 0) {
                              onUploadCustomAssets(files, 'bubble', { applyToSelectedBubble: true });
                            }
                            e.target.value = '';
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => bubbleAssetInputRef.current?.click()}
                          className="inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                        >
                          <Plus className="h-2.5 w-2.5" />
                          <span>{t('导入')}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {customBubbleAssets.length > 0 && (
                  <div className="grid max-h-28 grid-cols-4 gap-1 overflow-y-auto">
                    {customBubbleAssets.map(asset => {
                      const active = selectedBubble.customAssetId === asset.id || selectedBubble.customImageUrl === asset.url;
                      return (
                        <button
                          key={asset.id}
                          type="button"
                          title={asset.name}
                          aria-pressed={active}
                          onClick={() => {
                            const box = computeNormalizedAssetBox(
                              asset.width || 512,
                              asset.height || 360,
                              draft.width,
                              draft.height,
                              Math.max(selectedBubble.width, selectedBubble.height, 0.28),
                            );
                            onUpdateBubble(selectedBubble.id, i => ({
                              ...i,
                              customAssetId: asset.id,
                              customImageUrl: asset.url,
                              hasTail: false,
                              width: box.width,
                              height: box.height,
                            }), true);
                          }}
                          className={`flex flex-col items-center gap-0.5 rounded-md border p-1 transition ${active ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/60' : 'border-gray-200/80 bg-white hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-800'}`}
                        >
                          <div
                            className="flex h-6 w-full items-center justify-center overflow-hidden rounded-xs"
                            style={{
                              backgroundImage: 'linear-gradient(45deg, rgba(148,163,184,0.2) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.2) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.2) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.2) 75%)',
                              backgroundSize: '8px 8px',
                              backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                            }}
                          >
                            <img src={asset.url} alt={asset.name} className="h-full w-full object-contain" />
                          </div>
                          <span className="w-full truncate text-center text-[9px] text-gray-600 dark:text-gray-300">{asset.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {isCustomBubble ? (
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => onUpdateBubble(selectedBubble.id, i => ({ ...i, writingMode: i.writingMode === 'vertical' ? 'horizontal' : 'vertical' }), true)}
                  className="rounded-lg border border-gray-200 bg-white px-1.5 py-1 font-medium dark:border-gray-700 dark:bg-gray-800"
                >
                  {selectedBubble.writingMode === 'vertical' ? t('竖排') : t('横排')}
                </button>
                <button
                  type="button"
                  aria-pressed={Boolean(selectedBubble.flipX)}
                  onClick={() => onUpdateBubble(selectedBubble.id, i => ({ ...i, flipX: !i.flipX }), true)}
                  className={`inline-flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1 font-medium ${selectedBubble.flipX ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}
                >
                  <FlipHorizontal2 className="h-3 w-3" />
                  <span>{t('水平翻转')}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={Boolean(selectedBubble.flipY)}
                  onClick={() => onUpdateBubble(selectedBubble.id, i => ({ ...i, flipY: !i.flipY }), true)}
                  className={`inline-flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1 font-medium ${selectedBubble.flipY ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}
                >
                  <FlipVertical2 className="h-3 w-3" />
                  <span>{t('垂直翻转')}</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onUpdateBubble(selectedBubble.id, i => ({ ...i, writingMode: i.writingMode === 'vertical' ? 'horizontal' : 'vertical' }), true)}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 font-medium dark:border-gray-700 dark:bg-gray-800"
                >
                  {selectedBubble.writingMode === 'vertical' ? t('排版：竖排') : t('排版：横排')}
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateBubble(selectedBubble.id, i => ({ ...i, hasTail: !i.hasTail }), true)}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 font-medium dark:border-gray-700 dark:bg-gray-800"
                >
                  {selectedBubble.hasTail ? t('指向尾巴：开') : t('指向尾巴：关')}
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-gray-500">{t('字号')} {selectedBubble.fontSize}px</span>
                <input type="range" min={12} max={56} value={selectedBubble.fontSize} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, fontSize: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
              </label>
              <div className="block">
                <div className="mb-1 flex items-center justify-between gap-1">
                  <span className="text-gray-500">{t('漫画字体')}</span>
                  <button
                    type="button"
                    onClick={() => fontFileInputRef.current?.click()}
                    className="text-[10px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    + {t('导入')}
                  </button>
                </div>
                <select
                  aria-label={t('气泡字体')}
                  value={selectedBubble.fontFamily || 'comic-sans'}
                  onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, fontFamily: e.target.value as ComicFontFamily }), true)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                >
                  {(fontCatalog.fonts.some(f => f.installed) || fontCatalog.customFonts.length > 0) && (
                    <optgroup label={t('已安装开源 / 本机漫画字体')}>
                      {fontCatalog.fonts.filter(f => f.installed).map(f => (
                        <option key={f.id} value={f.id}>{`${f.name} (${f.styleTag})`}</option>
                      ))}
                      {fontCatalog.customFonts.map(f => (
                        <option key={f.id} value={f.id}>{`${f.name} (${t('本机导入')})`}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label={t('系统默认字体（回退）')}>
                    {COMIC_FONT_PRESETS.map(preset => (
                      <option key={preset.id} value={preset.id}>{t(preset.label)}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </div>

            {/* 快捷配色预设 */}
            {!isCustomBubble && (
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => onUpdateBubble(selectedBubble.id, i => ({ ...i, fillColor: '#ffffff', textColor: '#111827', strokeColor: '#111827', strokeWidth: i.strokeWidth || 3 }), true)}
                  className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition ${selectedBubble.fillColor === '#ffffff' && selectedBubble.textColor === '#111827' ? 'border-indigo-500 bg-white text-indigo-700' : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
                >
                  {t('白底黑字')}
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateBubble(selectedBubble.id, i => ({ ...i, fillColor: '#111827', textColor: '#ffffff', strokeColor: '#111827', strokeWidth: i.strokeWidth || 3 }), true)}
                  className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition ${selectedBubble.fillColor === '#111827' ? 'border-indigo-500 bg-gray-900 text-white' : 'border-gray-200 bg-gray-900 text-white opacity-85 hover:opacity-100'}`}
                >
                  {t('黑底白字')}
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateBubble(selectedBubble.id, i => ({ ...i, fillColor: 'transparent', textColor: '#111827', strokeColor: '#ffffff', strokeWidth: 0 }), true)}
                  className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition ${selectedBubble.fillColor === 'transparent' ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white/70 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
                >
                  {t('透明嵌字')}
                </button>
              </div>
            )}

            {/* 低频外观细节（默认折叠） */}
            <details className="group border-t border-indigo-200/60 pt-2 dark:border-indigo-900/50">
              <summary className="flex cursor-pointer list-none items-center gap-1 select-none text-[11px] font-semibold text-gray-600 hover:text-indigo-600 dark:text-gray-300">
                <ChevronDown className="h-3 w-3 text-gray-400 transition group-open:rotate-180" aria-hidden="true" />
                <span>{t('外观微调')}</span>
              </summary>
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-gray-500">{t('旋转')} {selectedBubble.rotation}°</span>
                    <input type="range" aria-label={t('气泡旋转角度')} min={isCustomBubble ? -180 : -45} max={isCustomBubble ? 180 : 45} value={selectedBubble.rotation} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, rotation: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
                  </label>
                  {!isCustomBubble && (
                    <label className="block">
                      <span className="mb-1 block text-gray-500">{t('边框粗细')} {selectedBubble.strokeWidth}px</span>
                      <input type="range" aria-label={t('气泡边框粗细')} min={0} max={10} value={selectedBubble.strokeWidth} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, strokeWidth: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
                    </label>
                  )}
                  {isCustomBubble && (
                    <label className="flex items-center gap-1.5 pt-3 text-[11px] text-gray-600 dark:text-gray-300">
                      <span>{t('字色')}</span>
                      <input
                        type="color"
                        aria-label={t('气泡字色')}
                        value={selectedBubble.textColor}
                        onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, textColor: e.target.value }), true)}
                        className="h-5 w-6 cursor-pointer rounded border border-gray-300 bg-transparent"
                      />
                    </label>
                  )}
                </div>

                {isCustomBubble ? (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-0.5 block text-[10px] text-gray-500">{t('文字水平内边距')} {Math.round((selectedBubble.textInsetX ?? 0.14) * 100)}%</span>
                        <input type="range" min={4} max={40} value={Math.round((selectedBubble.textInsetX ?? 0.14) * 100)} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, textInsetX: Number(e.target.value) / 100 }), false)} className="w-full accent-indigo-600" />
                      </label>
                      <label className="block">
                        <span className="mb-0.5 block text-[10px] text-gray-500">{t('文字垂直内边距')} {Math.round((selectedBubble.textInsetY ?? 0.14) * 100)}%</span>
                        <input type="range" min={4} max={40} value={Math.round((selectedBubble.textInsetY ?? 0.14) * 100)} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, textInsetY: Number(e.target.value) / 100 }), false)} className="w-full accent-indigo-600" />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-0.5 block text-[10px] text-gray-500">{t('文字横向偏移')} {Math.round((selectedBubble.textOffsetX ?? 0) * 100)}%</span>
                        <input type="range" min={-30} max={30} value={Math.round((selectedBubble.textOffsetX ?? 0) * 100)} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, textOffsetX: Number(e.target.value) / 100 }), false)} className="w-full accent-indigo-600" />
                      </label>
                      <label className="block">
                        <span className="mb-0.5 block text-[10px] text-gray-500">{t('文字纵向偏移')} {Math.round((selectedBubble.textOffsetY ?? 0) * 100)}%</span>
                        <input type="range" min={-30} max={30} value={Math.round((selectedBubble.textOffsetY ?? 0) * 100)} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, textOffsetY: Number(e.target.value) / 100 }), false)} className="w-full accent-indigo-600" />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600 dark:text-gray-300">
                    <label className="flex items-center gap-1">
                      <span>{t('底色')}</span>
                      <input
                        type="color"
                        aria-label={t('气泡底色')}
                        value={selectedBubble.fillColor === 'transparent' ? '#ffffff' : selectedBubble.fillColor}
                        onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, fillColor: e.target.value }), true)}
                        className="h-5 w-6 cursor-pointer rounded border border-gray-300 bg-transparent"
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      <span>{t('字色')}</span>
                      <input
                        type="color"
                        aria-label={t('气泡字色')}
                        value={selectedBubble.textColor}
                        onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, textColor: e.target.value }), true)}
                        className="h-5 w-6 cursor-pointer rounded border border-gray-300 bg-transparent"
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      <span>{t('边框')}</span>
                      <input
                        type="color"
                        aria-label={t('气泡边框颜色')}
                        value={selectedBubble.strokeColor === 'transparent' ? '#111827' : selectedBubble.strokeColor}
                        onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, strokeColor: e.target.value }), true)}
                        className="h-5 w-6 cursor-pointer rounded border border-gray-300 bg-transparent"
                      />
                    </label>
                  </div>
                )}
              </div>
            </details>
          </div>
        );
      })()}

      {selectedText && (
        <div className="space-y-2.5 rounded-xl border border-indigo-200/80 bg-indigo-50/30 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/20">
          <div className="flex items-center justify-between">
            <span className="font-bold text-gray-800 dark:text-gray-100">{t('当前效果文字')}</span>
            <button type="button" aria-label={t('删除文字')} onClick={() => onDeleteText(selectedText.id)} className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <textarea
            rows={2}
            value={selectedText.text}
            onChange={e => onUpdateText(selectedText.id, i => ({ ...i, text: e.target.value }), false)}
            onBlur={() => onUpdateText(selectedText.id, i => i, true)}
            className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => onUpdateText(selectedText.id, i => ({ ...i, writingMode: i.writingMode === 'vertical' ? 'horizontal' : 'vertical' }), true)} className="rounded-lg border border-gray-200 bg-white px-2 py-1 font-medium dark:border-gray-700 dark:bg-gray-800">
              {selectedText.writingMode === 'vertical' ? t('竖排') : t('横排')}
            </button>
            <button type="button" onClick={() => onUpdateText(selectedText.id, i => ({ ...i, bold: !i.bold }), true)} className="rounded-lg border border-gray-200 bg-white px-2 py-1 font-medium dark:border-gray-700 dark:bg-gray-800">
              {selectedText.bold ? t('粗体：开') : t('粗体：关')}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-gray-500">{t('字号')} {selectedText.fontSize}px</span>
              <input type="range" min={14} max={96} value={selectedText.fontSize} onChange={e => onUpdateText(selectedText.id, i => ({ ...i, fontSize: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
            </label>
            <div className="block">
              <div className="mb-1 flex items-center justify-between gap-1">
                <span className="text-gray-500">{t('漫画字体')}</span>
                <button
                  type="button"
                  onClick={() => fontFileInputRef.current?.click()}
                  className="text-[10px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  + {t('导入')}
                </button>
              </div>
              <select
                aria-label={t('文字字体')}
                value={selectedText.fontFamily || 'impact'}
                onChange={e => onUpdateText(selectedText.id, i => ({ ...i, fontFamily: e.target.value as ComicFontFamily }), true)}
                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                {(fontCatalog.fonts.some(f => f.installed) || fontCatalog.customFonts.length > 0) && (
                  <optgroup label={t('已安装开源 / 本机漫画字体')}>
                    {fontCatalog.fonts.filter(f => f.installed).map(f => (
                      <option key={f.id} value={f.id}>{`${f.name} (${f.styleTag})`}</option>
                    ))}
                    {fontCatalog.customFonts.map(f => (
                      <option key={f.id} value={f.id}>{`${f.name} (${t('本机导入')})`}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={t('系统默认字体（回退）')}>
                  {COMIC_FONT_PRESETS.map(preset => (
                    <option key={preset.id} value={preset.id}>{t(preset.label)}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={() => onUpdateText(selectedText.id, i => ({ ...i, color: '#111827', strokeColor: '#ffffff' }), true)}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-800 hover:border-indigo-400"
            >
              {t('黑字白边')}
            </button>
            <button
              type="button"
              onClick={() => onUpdateText(selectedText.id, i => ({ ...i, color: '#ffffff', strokeColor: '#111827' }), true)}
              className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] font-semibold text-white hover:border-indigo-400"
            >
              {t('白字黑边')}
            </button>
            <button
              type="button"
              onClick={() => onUpdateText(selectedText.id, i => ({ ...i, color: '#dc2626', strokeColor: '#ffffff' }), true)}
              className="rounded-md border border-red-200 bg-white px-2 py-1 text-[10px] font-semibold text-red-600 hover:border-red-400"
            >
              {t('红字白边')}
            </button>
          </div>
          <details className="group border-t border-indigo-200/60 pt-2 dark:border-indigo-900/50">
            <summary className="flex cursor-pointer list-none items-center gap-1 select-none text-[11px] font-semibold text-gray-600 hover:text-indigo-600 dark:text-gray-300">
              <ChevronDown className="h-3 w-3 text-gray-400 transition group-open:rotate-180" aria-hidden="true" />
              <span>{t('外观微调')}</span>
            </summary>
            <div className="mt-2 space-y-2">
              <label className="block">
                <span className="mb-1 block text-gray-500">{t('旋转')} {selectedText.rotation}°</span>
                <input type="range" aria-label={t('文字旋转角度')} min={-90} max={90} value={selectedText.rotation} onChange={e => onUpdateText(selectedText.id, i => ({ ...i, rotation: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
              </label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5"><span>{t('字色')}</span><input type="color" value={selectedText.color} onChange={e => onUpdateText(selectedText.id, i => ({ ...i, color: e.target.value }), true)} className="h-5 w-7 rounded border" /></label>
                <label className="flex items-center gap-1.5"><span>{t('描边')}</span><input type="color" value={selectedText.strokeColor || '#ffffff'} onChange={e => onUpdateText(selectedText.id, i => ({ ...i, strokeColor: e.target.value }), true)} className="h-5 w-7 rounded border" /></label>
              </div>
            </div>
          </details>
        </div>
      )}

      {selectedSticker && (
        <div className="space-y-2.5 rounded-xl border border-indigo-200/80 bg-indigo-50/30 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/20">
          <div className="flex items-center justify-between">
            <span className="font-bold text-gray-800 dark:text-gray-100">{t('当前贴纸')}</span>
            <button type="button" aria-label={t('删除贴纸')} onClick={() => onDeleteSticker(selectedSticker.id)} className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* 8 款贴纸图标可视化网格 */}
          <div className="grid grid-cols-4 gap-1">
            {STICKER_KINDS.map(item => (
              <button
                key={item.id}
                type="button"
                aria-pressed={selectedSticker.kind === item.id}
                onClick={() => onUpdateSticker(selectedSticker.id, s => ({ ...s, kind: item.id }), true)}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 text-[10px] font-medium transition ${selectedSticker.kind === item.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
              >
                <ComicStickerIcon kind={item.id} className="h-5 w-5" />
                <span className="w-full truncate text-center">{t(item.label)}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-gray-500">{t('尺寸')} {Math.round(selectedSticker.width * 100)}%</span>
              <input type="range" min={6} max={90} value={Math.round(selectedSticker.width * 100)} onChange={e => { const v = Number(e.target.value) / 100; onUpdateSticker(selectedSticker.id, s => ({ ...s, width: v, height: v }), false); }} className="w-full accent-indigo-600" />
            </label>
            <div className="flex flex-none items-center gap-1 pt-3">
              {['#111827', '#ef4444', '#f59e0b', '#2563eb'].map(swatch => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={swatch}
                  onClick={() => onUpdateSticker(selectedSticker.id, s => ({ ...s, color: swatch }), true)}
                  style={{ backgroundColor: swatch }}
                  className={`h-4 w-4 rounded-full border ${selectedSticker.color === swatch ? 'ring-2 ring-indigo-500 ring-offset-1' : 'border-gray-300'}`}
                />
              ))}
              <input type="color" aria-label={t('颜色')} value={selectedSticker.color} onChange={e => onUpdateSticker(selectedSticker.id, s => ({ ...s, color: e.target.value }), true)} className="h-5 w-6 rounded border bg-transparent" />
            </div>
          </div>
          <details className="group border-t border-indigo-200/60 pt-2 dark:border-indigo-900/50">
            <summary className="flex cursor-pointer list-none items-center gap-1 select-none text-[11px] font-semibold text-gray-600 hover:text-indigo-600 dark:text-gray-300">
              <ChevronDown className="h-3 w-3 text-gray-400 transition group-open:rotate-180" aria-hidden="true" />
              <span>{t('外观微调')}</span>
            </summary>
            <label className="mt-2 block">
              <span className="mb-1 block text-gray-500">{t('旋转')} {selectedSticker.rotation}°</span>
              <input type="range" min={-180} max={180} value={selectedSticker.rotation} onChange={e => onUpdateSticker(selectedSticker.id, s => ({ ...s, rotation: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
            </label>
          </details>
        </div>
      )}

      {selectedImageLayer && (
        <div className="space-y-2.5 rounded-xl border border-indigo-200/80 bg-indigo-50/30 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/20">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded border border-gray-300/80 dark:border-gray-600"
                style={{
                  backgroundImage: 'linear-gradient(45deg, rgba(148,163,184,0.22) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.22) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.22) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.22) 75%)',
                  backgroundSize: '8px 8px',
                  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                }}
              >
                <img src={selectedImageLayer.url} alt={selectedImageLayer.name} className="h-full w-full object-contain" />
              </div>
              <span className="truncate font-bold text-gray-800 dark:text-gray-100">{selectedImageLayer.name}</span>
            </div>
            <div className="flex flex-none items-center gap-1">
              {selectedImageLayer.url.startsWith('data:') && onSaveImageLayerToLibrary && (
                <button
                  type="button"
                  onClick={() => onSaveImageLayerToLibrary(selectedImageLayer)}
                  className="rounded border border-indigo-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-gray-800 dark:text-indigo-300"
                >
                  {t('存素材库')}
                </button>
              )}
              <button type="button" aria-label={t('删除图片图层')} onClick={() => onDeleteImageLayer(selectedImageLayer.id)} className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1">
            <button
              type="button"
              aria-pressed={Boolean(selectedImageLayer.flipX)}
              onClick={() => onUpdateImageLayer(selectedImageLayer.id, item => ({ ...item, flipX: !item.flipX }), true)}
              className={`inline-flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-[10px] font-medium ${selectedImageLayer.flipX ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}
            >
              <FlipHorizontal2 className="h-3 w-3" />
              <span>{t('水平')}</span>
            </button>
            <button
              type="button"
              aria-pressed={Boolean(selectedImageLayer.flipY)}
              onClick={() => onUpdateImageLayer(selectedImageLayer.id, item => ({ ...item, flipY: !item.flipY }), true)}
              className={`inline-flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-[10px] font-medium ${selectedImageLayer.flipY ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}
            >
              <FlipVertical2 className="h-3 w-3" />
              <span>{t('垂直')}</span>
            </button>
            <button
              type="button"
              aria-pressed={selectedImageLayer.lockAspect !== false}
              onClick={() => onUpdateImageLayer(selectedImageLayer.id, item => ({ ...item, lockAspect: item.lockAspect === false }), true)}
              className={`inline-flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-[10px] font-medium ${selectedImageLayer.lockAspect !== false ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}
            >
              {selectedImageLayer.lockAspect !== false ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
              <span>{t('比例锁')}</span>
            </button>
            <button
              type="button"
              onClick={() => onUpdateImageLayer(selectedImageLayer.id, item => {
                const box = computeNormalizedAssetBox(
                  item.naturalWidth || 512,
                  item.naturalHeight || 512,
                  draft.width,
                  draft.height,
                  Math.max(item.width, item.height, 0.3),
                );
                return { ...item, width: box.width, height: box.height, lockAspect: true };
              }, true)}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-[10px] font-medium hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-800"
            >
              <RotateCcw className="h-3 w-3" />
              <span>{t('原比例')}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-gray-500">{t('宽度')} {Math.round(selectedImageLayer.width * 100)}%</span>
              <input
                type="range"
                min={5}
                max={120}
                value={Math.round(selectedImageLayer.width * 100)}
                onChange={e => {
                  const nextW = Number(e.target.value) / 100;
                  onUpdateImageLayer(selectedImageLayer.id, item => {
                    if (item.lockAspect !== false && item.width > 0) {
                      const nextH = Math.min(1.5, Math.max(0.04, Number(((item.height / item.width) * nextW).toFixed(3))));
                      return { ...item, width: nextW, height: nextH };
                    }
                    return { ...item, width: nextW };
                  }, false);
                }}
                className="w-full accent-indigo-600"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-gray-500">{t('高度')} {Math.round(selectedImageLayer.height * 100)}%</span>
              <input
                type="range"
                min={5}
                max={120}
                value={Math.round(selectedImageLayer.height * 100)}
                onChange={e => {
                  const nextH = Number(e.target.value) / 100;
                  onUpdateImageLayer(selectedImageLayer.id, item => {
                    if (item.lockAspect !== false && item.height > 0) {
                      const nextW = Math.min(1.5, Math.max(0.04, Number(((item.width / item.height) * nextH).toFixed(3))));
                      return { ...item, width: nextW, height: nextH };
                    }
                    return { ...item, height: nextH };
                  }, false);
                }}
                className="w-full accent-indigo-600"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-gray-500">{t('旋转')} {selectedImageLayer.rotation}°</span>
              <input type="range" min={-180} max={180} value={selectedImageLayer.rotation} onChange={e => onUpdateImageLayer(selectedImageLayer.id, item => ({ ...item, rotation: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
            </label>
            {selectedImageLayerNode && (
              <label className="block">
                <span className="mb-1 block text-gray-500">{t('不透明度')} {Math.round(selectedImageLayerNode.opacity * 100)}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(selectedImageLayerNode.opacity * 100)}
                  onChange={e => updateLayerNodeProp(selectedImageLayerNode.id, node => ({ ...node, opacity: Number(e.target.value) / 100 }), false)}
                  onMouseUp={() => updateLayerNodeProp(selectedImageLayerNode.id, node => node, true)}
                  className="w-full accent-indigo-600"
                />
              </label>
            )}
          </div>

          {selectedImageLayerNode && (
            <label className="block">
              <span className="mb-1 block text-gray-500">{t('混合模式')}</span>
              <select
                aria-label={t('图片混合模式')}
                value={selectedImageLayerNode.blendMode}
                onChange={e => updateLayerNodeProp(selectedImageLayerNode.id, node => ({ ...node, blendMode: e.target.value as ComicBlendMode }), true)}
                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                {COMIC_BLEND_MODES.map(mode => (
                  <option key={mode.id} value={mode.id}>{t(mode.label)}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {/* 本页气泡 / 文字 / 贴纸 / 图片大纲列表 */}
      <div className="space-y-1.5">
        <div className="font-bold text-gray-700 dark:text-gray-200">{t('页面嵌字与叠图')}</div>
        {overlayCount === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 p-3 text-center text-[11px] text-gray-400 dark:border-gray-700">
            {t('点击上方快捷按钮、拖入透明底图片或 Ctrl+V 粘贴添加')}
          </p>
        ) : (
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {draft.bubbles.map(b => (
              <button
                key={b.id}
                type="button"
                onClick={() => onSelect({ kind: 'bubble', id: b.id })}
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left ${selection?.kind === 'bubble' && selection.id === b.id ? 'border-indigo-400 bg-indigo-50/60 dark:border-indigo-500 dark:bg-indigo-950/40' : 'border-gray-200/80 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/70'}`}
              >
                {b.customImageUrl ? (
                  <img src={b.customImageUrl} alt="" className="h-4 w-4 flex-none object-contain" />
                ) : (
                  <MessageCircle className="h-3.5 w-3.5 flex-none text-amber-500" />
                )}
                <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-100">{b.text || t('空白气泡')}</span>
              </button>
            ))}
            {draft.texts.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect({ kind: 'text', id: item.id })}
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left ${selection?.kind === 'text' && selection.id === item.id ? 'border-indigo-400 bg-indigo-50/60 dark:border-indigo-500 dark:bg-indigo-950/40' : 'border-gray-200/80 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/70'}`}
              >
                <Type className="h-3.5 w-3.5 flex-none text-indigo-500" />
                <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-100">{item.text}</span>
              </button>
            ))}
            {draft.stickers.map(st => (
              <button
                key={st.id}
                type="button"
                onClick={() => onSelect({ kind: 'sticker', id: st.id })}
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left ${selection?.kind === 'sticker' && selection.id === st.id ? 'border-indigo-400 bg-indigo-50/60 dark:border-indigo-500 dark:bg-indigo-950/40' : 'border-gray-200/80 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/70'}`}
              >
                <ComicStickerIcon kind={st.kind} className="h-3.5 w-3.5 flex-none text-purple-500" />
                <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-100">
                  {t(STICKER_KINDS.find(k => k.id === st.kind)?.label || st.kind)}
                </span>
              </button>
            ))}
            {(draft.imageLayers || []).map(img => (
              <button
                key={img.id}
                type="button"
                onClick={() => onSelect({ kind: 'image', id: img.id })}
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left ${selection?.kind === 'image' && selection.id === img.id ? 'border-indigo-400 bg-indigo-50/60 dark:border-indigo-500 dark:bg-indigo-950/40' : 'border-gray-200/80 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/70'}`}
              >
                <img src={img.url} alt="" className="h-4 w-4 flex-none rounded-xs object-contain" />
                <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-100">{img.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <ComicInspectorAssetLibrary
        customAssets={customAssets}
        selectedBubble={selectedBubble}
        onUploadCustomAssets={onUploadCustomAssets}
        onInsertCustomAsset={onInsertCustomAsset}
        onRenameCustomAsset={onRenameCustomAsset}
        onDeleteCustomAsset={onDeleteCustomAsset}
      />

      <ComicInspectorFontLibrary
        fontCatalog={fontCatalog}
        defaultFontId={defaultFontId}
        downloadingFontId={downloadingFontId}
        selectedBubble={selectedBubble}
        selectedText={selectedText}
        onTriggerFontUpload={() => fontFileInputRef.current?.click()}
        onDownloadFont={onDownloadFont}
        onRenameCustomFont={onRenameCustomFont}
        onSetDefaultFont={onSetDefaultFont}
        onDeleteFont={onDeleteFont}
        onUpdateBubble={onUpdateBubble}
        onUpdateText={onUpdateText}
      />
    </div>
  );
};
