import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Image as ImageIcon,
  Layers,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  UserPlus,
  Wand2,
  X,
} from 'lucide-react';
import type { LocalGenItem, PromptChain } from '../../types';
import { t, useLanguage } from '../../services/i18n';
import { formatGenerationCostLabel } from '../../services/anlasBudget';
import {
  clampAnchorCoord,
  getPanelBoundingBox,
  getPanelTargetResolution,
} from '../../services/comic/comicGeometry';
import {
  COMIC_ANCHOR_HARD_LIMIT,
  COMIC_ANCHOR_SOFT_LIMIT,
  COMIC_V5_MODELS,
  evaluateAnchorGuard,
} from '../../services/comic/comicPromptBuilder';
import type {
  ComicAnchor,
  ComicAnchorKind,
  ComicBubbleItem,
  ComicBubbleShape,
  ComicColorMode,
  ComicDialogueMode,
  ComicPageDraft,
  ComicPanel,
  ComicSelection,
  ComicStickerItem,
  ComicStickerKind,
  ComicTextItem,
  ComicTool,
  ComicV5ModelId,
} from '../../services/comic/comicTypes';
import { createUuid } from '../../services/id';
import { InlineSpinner } from '../DesignSystem';
import { HistoryImagePicker } from '../HistoryImagePicker';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';

interface ComicInspectorProps {
  draft: ComicPageDraft;
  activeTool: ComicTool;
  selection: ComicSelection;
  chains: PromptChain[];
  brushColor: string;
  brushSize: number;
  brushOpacity: number;
  defaultStickerKind: ComicStickerKind;
  generatingPanelId: string | null;
  generationStageText: string;
  estimatedCost: number;
  onChangeBrush: (patch: { color?: string; size?: number; opacity?: number }) => void;
  onChangeDefaultStickerKind: (kind: ComicStickerKind) => void;
  onSelect: (selection: ComicSelection) => void;
  onUpdateDraft: (updater: (current: ComicPageDraft) => ComicPageDraft, commit?: boolean) => void;
  onApplyStyleChain: (chain: PromptChain) => void;
  onUpdatePanel: (panelId: string, updater: (panel: ComicPanel) => ComicPanel, commit?: boolean) => void;
  onDuplicatePanel: (panelId: string) => void;
  onDeletePanel: (panelId: string) => void;
  onBringPanelOrder: (panelId: string, mode: 'front' | 'back') => void;
  onGeneratePanel: (panelId: string) => void;
  onCancelGeneration: () => void;
  onUpdateBubble: (id: string, updater: (item: ComicBubbleItem) => ComicBubbleItem, commit?: boolean) => void;
  onDeleteBubble: (id: string) => void;
  onUpdateText: (id: string, updater: (item: ComicTextItem) => ComicTextItem, commit?: boolean) => void;
  onDeleteText: (id: string) => void;
  onUpdateSticker: (id: string, updater: (item: ComicStickerItem) => ComicStickerItem, commit?: boolean) => void;
  onDeleteSticker: (id: string) => void;
  onClearStrokes: () => void;
}

const ANCHOR_META: Record<ComicAnchorKind, { label: string; dotClass: string; badgeClass: string }> = {
  character: { label: '角色', dotClass: 'bg-blue-600', badgeClass: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' },
  scene: { label: '空镜/道具', dotClass: 'bg-emerald-600', badgeClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
  bubble: { label: '气泡点', dotClass: 'bg-amber-600', badgeClass: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
  inset: { label: '特写叠框', dotClass: 'bg-purple-600', badgeClass: 'bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300' },
};

const BUBBLE_SHAPES: Array<{ id: ComicBubbleShape; label: string }> = [
  { id: 'oval', label: '椭圆对白' },
  { id: 'shout', label: '锯齿吼叫' },
  { id: 'thought', label: '云朵思考' },
  { id: 'caption', label: '旁白方框' },
];

const STICKER_KINDS: Array<{ id: ComicStickerKind; label: string }> = [
  { id: 'speedlines', label: '集中线' },
  { id: 'sweat', label: '汗滴' },
  { id: 'anger', label: '怒筋' },
  { id: 'sparkle', label: '星芒' },
  { id: 'exclamation', label: '惊叹号 !' },
  { id: 'question', label: '问号 ?' },
  { id: 'shock', label: '震惊线' },
  { id: 'heart', label: '爱心' },
];

export const ComicInspector: React.FC<ComicInspectorProps> = ({
  draft,
  activeTool,
  selection,
  chains,
  brushColor,
  brushSize,
  brushOpacity,
  defaultStickerKind,
  generatingPanelId,
  generationStageText,
  estimatedCost,
  onChangeBrush,
  onChangeDefaultStickerKind,
  onSelect,
  onUpdateDraft,
  onApplyStyleChain,
  onUpdatePanel,
  onDuplicatePanel,
  onDeletePanel,
  onBringPanelOrder,
  onGeneratePanel,
  onCancelGeneration,
  onUpdateBubble,
  onDeleteBubble,
  onUpdateText,
  onDeleteText,
  onUpdateSticker,
  onDeleteSticker,
  onClearStrokes,
}) => {
  useLanguage();
  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [selectedAnchorId, setSelectedAnchorId] = useState<string>('');
  const anchorStageRef = useRef<HTMLDivElement>(null);
  const draggingAnchorRef = useRef<string | null>(null);

  const styleChains = useMemo(
    () => chains.filter(item => item.type === 'style'),
    [chains],
  );
  const characterChains = useMemo(
    () => chains.filter(item => item.type === 'character'),
    [chains],
  );

  const selectedPanel = selection?.kind === 'panel'
    ? draft.panels.find(item => item.id === selection.id)
    : undefined;
  const selectedBubble = selection?.kind === 'bubble'
    ? draft.bubbles.find(item => item.id === selection.id)
    : undefined;
  const selectedText = selection?.kind === 'text'
    ? draft.texts.find(item => item.id === selection.id)
    : undefined;
  const selectedSticker = selection?.kind === 'sticker'
    ? draft.stickers.find(item => item.id === selection.id)
    : undefined;

  const addAnchorToPanel = (panel: ComicPanel, kind: ComicAnchorKind, seed?: { label?: string; prompt?: string; negativePrompt?: string; sourceCharacterId?: string }) => {
    if (panel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT) return;
    const countOfKind = panel.anchors.filter(a => a.kind === kind).length + 1;
    const next: ComicAnchor = {
      id: createUuid(),
      kind,
      label: seed?.label || `${ANCHOR_META[kind].label} ${countOfKind}`,
      prompt: seed?.prompt || '',
      negativePrompt: seed?.negativePrompt || '',
      x: 0.5,
      y: 0.5,
      enabled: true,
      ...(kind === 'bubble' ? { bubbleShape: 'oval' as ComicBubbleShape, bubbleText: '' } : {}),
      ...(seed?.sourceCharacterId ? { sourceCharacterId: seed.sourceCharacterId } : {}),
    };
    onUpdatePanel(panel.id, current => ({ ...current, anchors: [...current.anchors, next] }), true);
    setSelectedAnchorId(next.id);
  };

  const handleSelectHistoryImage = (item: LocalGenItem) => {
    if (!selectedPanel) return;
    onUpdatePanel(selectedPanel.id, current => ({
      ...current,
      image: {
        url: item.imageUrl,
        historyId: item.id,
        width: item.params?.width,
        height: item.params?.height,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
      },
    }), true);
    setHistoryPickerOpen(false);
  };

  // 手绘工具上下文面板
  if ((activeTool === 'brush' || activeTool === 'eraser') && !selectedPanel && !selectedBubble && !selectedText && !selectedSticker) {
    return (
      <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-gray-200 bg-white/95 p-3.5 dark:border-gray-800 dark:bg-gray-900/95">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">
            {activeTool === 'brush' ? t('画笔设置') : t('橡皮擦设置')}
          </h3>
          {draft.strokes.length > 0 && (
            <button
              type="button"
              onClick={onClearStrokes}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-3 w-3" /> {t('清空手绘层')}
            </button>
          )}
        </div>
        <div className="space-y-3 text-xs">
          <div>
            <div className="mb-1 flex justify-between text-gray-600 dark:text-gray-300">
              <span>{t('笔刷粗细')}</span>
              <span className="font-mono">{brushSize}px</span>
            </div>
            <input
              type="range"
              min={2}
              max={64}
              value={brushSize}
              onChange={event => onChangeBrush({ size: Number(event.target.value) })}
              className="w-full accent-indigo-600"
            />
          </div>
          {activeTool === 'brush' && (
            <>
              <div>
                <div className="mb-1 flex justify-between text-gray-600 dark:text-gray-300">
                  <span>{t('不透明度')}</span>
                  <span className="font-mono">{Math.round(brushOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round(brushOpacity * 100)}
                  onChange={event => onChangeBrush({ opacity: Number(event.target.value) / 100 })}
                  className="w-full accent-indigo-600"
                />
              </div>
              <div>
                <span className="mb-1.5 block text-gray-600 dark:text-gray-300">{t('画笔颜色')}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {['#111827', '#ffffff', '#ef4444', '#2563eb', '#f59e0b', '#10b981', '#ec4899'].map(color => (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      onClick={() => onChangeBrush({ color })}
                      style={{ backgroundColor: color }}
                      className={`h-6 w-6 rounded-full border-2 ${brushColor === color ? 'border-indigo-500 ring-2 ring-indigo-300' : 'border-gray-300 dark:border-gray-600'}`}
                    />
                  ))}
                  <input
                    type="color"
                    aria-label={t('自定义画笔颜色')}
                    value={brushColor}
                    onChange={event => onChangeBrush({ color: event.target.value })}
                    className="h-6 w-8 cursor-pointer rounded border border-gray-300 bg-transparent"
                  />
                </div>
              </div>
            </>
          )}
          <p className="rounded-lg bg-gray-50 p-2.5 text-[11px] leading-relaxed text-gray-500 dark:bg-gray-800/70 dark:text-gray-400">
            {t('提示：手绘与橡皮仅作用于独立手绘层，不会破坏下方已生成的漫画分镜画面。')}
          </p>
        </div>
      </aside>
    );
  }

  // 贴纸工具预选面板
  if (activeTool === 'sticker' && !selectedSticker) {
    return (
      <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-gray-200 bg-white/95 p-3.5 dark:border-gray-800 dark:bg-gray-900/95">
        <h3 className="mb-2 text-sm font-bold text-gray-800 dark:text-gray-100">{t('选择贴纸后在画布点击放置')}</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {STICKER_KINDS.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => onChangeDefaultStickerKind(item.id)}
              className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition ${defaultStickerKind === item.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      </aside>
    );
  }

  // 选中气泡编辑
  if (selectedBubble) {
    return (
      <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-gray-200 bg-white/95 p-3.5 dark:border-gray-800 dark:bg-gray-900/95">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">{t('编辑对白气泡')}</h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={t('删除气泡')}
              onClick={() => onDeleteBubble(selectedBubble.id)}
              className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button type="button" aria-label={t('返回全页设置')} onClick={() => onSelect(null)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="space-y-3 text-xs">
          <label className="block">
            <span className="mb-1 block font-semibold text-gray-600 dark:text-gray-300">{t('台词内容')}</span>
            <textarea
              rows={3}
              value={selectedBubble.text}
              onChange={event => onUpdateBubble(selectedBubble.id, item => ({ ...item, text: event.target.value }), false)}
              onBlur={() => onUpdateBubble(selectedBubble.id, item => item, true)}
              className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </label>
          <div>
            <span className="mb-1 block font-semibold text-gray-600 dark:text-gray-300">{t('气泡形状')}</span>
            <div className="grid grid-cols-2 gap-1.5">
              {BUBBLE_SHAPES.map(shape => (
                <button
                  key={shape.id}
                  type="button"
                  onClick={() => onUpdateBubble(selectedBubble.id, item => ({ ...item, shape: shape.id }), true)}
                  className={`rounded-lg border px-2 py-1.5 font-medium ${selectedBubble.shape === shape.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-300'}`}
                >
                  {t(shape.label)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onUpdateBubble(selectedBubble.id, item => ({ ...item, writingMode: item.writingMode === 'vertical' ? 'horizontal' : 'vertical' }), true)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {selectedBubble.writingMode === 'vertical' ? t('排版：竖排') : t('排版：横排')}
            </button>
            <button
              type="button"
              onClick={() => onUpdateBubble(selectedBubble.id, item => ({ ...item, hasTail: !item.hasTail }), true)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {selectedBubble.hasTail ? t('指向尾巴：开') : t('指向尾巴：关')}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-gray-500">{t('宽')} {Math.round(selectedBubble.width * 100)}%</span>
              <input type="range" min={10} max={75} value={Math.round(selectedBubble.width * 100)} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, width: Number(e.target.value) / 100 }), false)} className="w-full accent-indigo-600" />
            </label>
            <label className="block">
              <span className="mb-1 block text-gray-500">{t('高')} {Math.round(selectedBubble.height * 100)}%</span>
              <input type="range" min={8} max={60} value={Math.round(selectedBubble.height * 100)} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, height: Number(e.target.value) / 100 }), false)} className="w-full accent-indigo-600" />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-gray-500">{t('字号')} {selectedBubble.fontSize}px</span>
            <input type="range" min={12} max={56} value={selectedBubble.fontSize} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, fontSize: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
          </label>
          <p className="rounded-lg bg-gray-50 p-2 text-[11px] text-gray-500 dark:bg-gray-800/70 dark:text-gray-400">
            {t('提示：在画布上拖动气泡上的橙色圆点可直接调整尾巴指向说话人。')}
          </p>
        </div>
      </aside>
    );
  }

  // 选中自由文字编辑
  if (selectedText) {
    return (
      <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-gray-200 bg-white/95 p-3.5 dark:border-gray-800 dark:bg-gray-900/95">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">{t('编辑文字')}</h3>
          <div className="flex items-center gap-1">
            <button type="button" aria-label={t('删除文字')} onClick={() => onDeleteText(selectedText.id)} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">
              <Trash2 className="h-4 w-4" />
            </button>
            <button type="button" aria-label={t('返回全页设置')} onClick={() => onSelect(null)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="space-y-3 text-xs">
          <textarea
            rows={3}
            value={selectedText.text}
            onChange={e => onUpdateText(selectedText.id, i => ({ ...i, text: e.target.value }), false)}
            onBlur={() => onUpdateText(selectedText.id, i => i, true)}
            className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onUpdateText(selectedText.id, i => ({ ...i, writingMode: i.writingMode === 'vertical' ? 'horizontal' : 'vertical' }), true)}
              className="rounded-lg border border-gray-200 px-2 py-1.5 font-medium dark:border-gray-700"
            >
              {selectedText.writingMode === 'vertical' ? t('竖排') : t('横排')}
            </button>
            <button
              type="button"
              onClick={() => onUpdateText(selectedText.id, i => ({ ...i, bold: !i.bold }), true)}
              className="rounded-lg border border-gray-200 px-2 py-1.5 font-medium dark:border-gray-700"
            >
              {selectedText.bold ? t('粗体：开') : t('粗体：关')}
            </button>
          </div>
          <label className="block">
            <span className="mb-1 block text-gray-500">{t('字号')} {selectedText.fontSize}px</span>
            <input type="range" min={14} max={96} value={selectedText.fontSize} onChange={e => onUpdateText(selectedText.id, i => ({ ...i, fontSize: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5">
              <span>{t('字色')}</span>
              <input type="color" value={selectedText.color} onChange={e => onUpdateText(selectedText.id, i => ({ ...i, color: e.target.value }), true)} className="h-6 w-8 rounded border" />
            </label>
            <label className="flex items-center gap-1.5">
              <span>{t('描边')}</span>
              <input type="color" value={selectedText.strokeColor || '#ffffff'} onChange={e => onUpdateText(selectedText.id, i => ({ ...i, strokeColor: e.target.value }), true)} className="h-6 w-8 rounded border" />
            </label>
          </div>
        </div>
      </aside>
    );
  }

  // 选中贴纸编辑
  if (selectedSticker) {
    return (
      <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-gray-200 bg-white/95 p-3.5 dark:border-gray-800 dark:bg-gray-900/95">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">{t('编辑贴纸')}</h3>
          <div className="flex items-center gap-1">
            <button type="button" aria-label={t('删除贴纸')} onClick={() => onDeleteSticker(selectedSticker.id)} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">
              <Trash2 className="h-4 w-4" />
            </button>
            <button type="button" aria-label={t('返回全页设置')} onClick={() => onSelect(null)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-1.5">
            {STICKER_KINDS.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => onUpdateSticker(selectedSticker.id, s => ({ ...s, kind: item.id }), true)}
                className={`rounded-lg border px-2 py-1.5 font-medium ${selectedSticker.kind === item.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 dark:border-gray-700'}`}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-gray-500">{t('尺寸')} {Math.round(selectedSticker.width * 100)}%</span>
            <input type="range" min={6} max={90} value={Math.round(selectedSticker.width * 100)} onChange={e => { const v = Number(e.target.value) / 100; onUpdateSticker(selectedSticker.id, s => ({ ...s, width: v, height: v }), false); }} className="w-full accent-indigo-600" />
          </label>
          <label className="block">
            <span className="mb-1 block text-gray-500">{t('旋转')} {selectedSticker.rotation}°</span>
            <input type="range" min={-180} max={180} value={selectedSticker.rotation} onChange={e => onUpdateSticker(selectedSticker.id, s => ({ ...s, rotation: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
          </label>
          <label className="flex items-center gap-2">
            <span>{t('颜色')}</span>
            <input type="color" value={selectedSticker.color} onChange={e => onUpdateSticker(selectedSticker.id, s => ({ ...s, color: e.target.value }), true)} className="h-6 w-8 rounded border" />
          </label>
        </div>
      </aside>
    );
  }

  // 选中分镜格面板：单格生图与锚点精控
  if (selectedPanel) {
    const resolution = getPanelTargetResolution(selectedPanel, draft.width, draft.height);
    const bounds = getPanelBoundingBox(selectedPanel.points, draft.width, draft.height);
    const panelRatio = Math.max(0.35, Math.min(2.8, bounds.width / Math.max(1, bounds.height)));
    const guard = evaluateAnchorGuard(selectedPanel.anchors);
    const isGeneratingThis = generatingPanelId === selectedPanel.id;
    const anyGenerating = Boolean(generatingPanelId);
    const selectedAnchor = selectedPanel.anchors.find(a => a.id === selectedAnchorId) || selectedPanel.anchors[0];

    const moveAnchorFromPointer = (event: React.PointerEvent<HTMLDivElement>, anchorId: string) => {
      const rect = anchorStageRef.current?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;
      const nx = clampAnchorCoord((event.clientX - rect.left) / rect.width);
      const ny = clampAnchorCoord((event.clientY - rect.top) / rect.height);
      onUpdatePanel(selectedPanel.id, current => ({
        ...current,
        anchors: current.anchors.map(a => a.id === anchorId ? { ...a, x: nx, y: ny } : a),
      }), false);
    };

    return (
      <aside className="flex h-full w-full flex-col border-l border-gray-200 bg-white/95 dark:border-gray-800 dark:bg-gray-900/95">
        <div className="flex flex-none items-center justify-between gap-2 border-b border-gray-200 px-3.5 py-2.5 dark:border-gray-800">
          <input
            type="text"
            aria-label={t('分镜格名称')}
            value={selectedPanel.name}
            onChange={e => onUpdatePanel(selectedPanel.id, p => ({ ...p, name: e.target.value }), false)}
            onBlur={() => onUpdatePanel(selectedPanel.id, p => p, true)}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-bold text-gray-800 outline-none focus:border-indigo-400 focus:bg-white dark:text-gray-100 dark:focus:bg-gray-800"
          />
          <div className="flex flex-none items-center gap-0.5">
            <button type="button" title={t('置顶叠框')} aria-label={t('置顶叠框')} onClick={() => onBringPanelOrder(selectedPanel.id, 'front')} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ArrowUpToLine className="h-3.5 w-3.5" /></button>
            <button type="button" title={t('置底')} aria-label={t('置底')} onClick={() => onBringPanelOrder(selectedPanel.id, 'back')} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ArrowDownToLine className="h-3.5 w-3.5" /></button>
            <button type="button" title={t('复制分镜格')} aria-label={t('复制分镜格')} onClick={() => onDuplicatePanel(selectedPanel.id)} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Copy className="h-3.5 w-3.5" /></button>
            <button type="button" title={t('删除分镜格')} aria-label={t('删除分镜格')} onClick={() => onDeletePanel(selectedPanel.id)} className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"><Trash2 className="h-3.5 w-3.5" /></button>
            <button type="button" title={t('返回全页设置')} aria-label={t('返回全页设置')} onClick={() => onSelect(null)} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3.5 text-xs">
          {/* 自动匹配 Opus 免费分辨率提示 */}
          <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 dark:border-indigo-900/50 dark:bg-indigo-950/30">
            <div>
              <div className="font-semibold text-indigo-800 dark:text-indigo-200">
                {t('自动匹配分辨率')}：{resolution.width} × {resolution.height}
              </div>
              <div className="text-[11px] text-indigo-600/80 dark:text-indigo-300/80">
                {COMIC_V5_MODELS.find(m => m.id === draft.v5Model)?.label} · {formatGenerationCostLabel(estimatedCost, draft.v5Model)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setHistoryPickerOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-gray-800 dark:text-indigo-300"
            >
              <ImageIcon className="h-3 w-3" /> {t('历史选图')}
            </button>
          </div>

          {/* 单格正向 / 负面提示词（复用 @ 提示词库与 Tag 补全） */}
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block font-semibold text-gray-700 dark:text-gray-200">{t('本格画面描述（支持 @ 检索提示词库）')}</span>
              <TagAutocompleteTextarea
                rows={4}
                value={selectedPanel.prompt}
                onValueChange={val => onUpdatePanel(selectedPanel.id, p => ({ ...p, prompt: val }), false)}
                placeholder={t('例如：close-up, rain outside classroom window, looking surprised, dramatic lighting...')}
                className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-semibold text-gray-600 dark:text-gray-300">{t('本格补充负面词（可选）')}</span>
              <TagAutocompleteTextarea
                rows={2}
                value={selectedPanel.negativePrompt}
                onValueChange={val => onUpdatePanel(selectedPanel.id, p => ({ ...p, negativePrompt: val }), false)}
                placeholder={t('仅对当前格生效的额外排除项')}
                className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </label>
          </div>

          {/* 单格四类空间锚点 */}
          <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/70 p-2.5 dark:border-gray-700/80 dark:bg-gray-800/40">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-gray-800 dark:text-gray-100">{t('本格空间锚点')}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${guard.level === 'hard-exceeded' ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300' : guard.level === 'soft-warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'}`}>
                {guard.activeCount}/{COMIC_ANCHOR_SOFT_LIMIT}（上限 {COMIC_ANCHOR_HARD_LIMIT}）
              </span>
            </div>

            {guard.level === 'soft-warning' && (
              <p className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {t('当前格锚点超过 12 个全精甜点区，人物可能自动缩为 Q 版以容纳所有元素。')}
              </p>
            )}
            {guard.level === 'hard-exceeded' && (
              <p className="rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {t('单次生图硬上限为 24 个锚点，请停用或删除超出部分后再生成。')}
              </p>
            )}

            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                disabled={selectedPanel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT}
                onClick={() => addAnchorToPanel(selectedPanel, 'character')}
                className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-40 dark:bg-blue-950/50 dark:text-blue-300"
              >
                <Plus className="h-3 w-3" /> {t('角色')}
              </button>
              {characterChains.length > 0 && (
                <button
                  type="button"
                  disabled={selectedPanel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT}
                  onClick={() => setCharacterPickerOpen(open => !open)}
                  className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40 dark:border-blue-800 dark:bg-gray-800 dark:text-blue-300"
                >
                  <UserPlus className="h-3 w-3" /> {t('角色库')}
                </button>
              )}
              <button
                type="button"
                disabled={selectedPanel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT}
                onClick={() => addAnchorToPanel(selectedPanel, 'scene')}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 dark:bg-emerald-950/50 dark:text-emerald-300"
              >
                <Plus className="h-3 w-3" /> {t('空镜/道具')}
              </button>
              <button
                type="button"
                disabled={selectedPanel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT}
                onClick={() => addAnchorToPanel(selectedPanel, 'bubble')}
                className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-40 dark:bg-amber-950/50 dark:text-amber-300"
              >
                <Plus className="h-3 w-3" /> {t('气泡点')}
              </button>
              <button
                type="button"
                disabled={selectedPanel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT}
                onClick={() => addAnchorToPanel(selectedPanel, 'inset')}
                className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-1 text-[11px] font-semibold text-purple-700 hover:bg-purple-100 disabled:opacity-40 dark:bg-purple-950/50 dark:text-purple-300"
              >
                <Plus className="h-3 w-3" /> {t('特写叠框')}
              </button>
            </div>

            {characterPickerOpen && characterChains.length > 0 && (
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-blue-200 bg-white p-1.5 dark:border-blue-800 dark:bg-gray-900">
                {characterChains.map(char => (
                  <button
                    key={char.id}
                    type="button"
                    onClick={() => {
                      addAnchorToPanel(selectedPanel, 'character', {
                        label: char.name,
                        prompt: [char.basePrompt, char.variableValues?.subject].filter(Boolean).join(', '),
                        negativePrompt: char.negativePrompt || '',
                        sourceCharacterId: char.id,
                      });
                      setCharacterPickerOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] hover:bg-blue-50 dark:hover:bg-blue-950/40"
                  >
                    <span className="truncate font-medium text-gray-800 dark:text-gray-100">{char.name}</span>
                    <span className="ml-2 flex-none text-blue-600 dark:text-blue-400">+ {t('加入')}</span>
                  </button>
                ))}
              </div>
            )}

            {/* 单格迷你锚点拖拽画板 */}
            {selectedPanel.anchors.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>{t('拖动圆点调整单格站位')}</span>
                  <label className="inline-flex cursor-pointer items-center gap-1">
                    <input
                      type="checkbox"
                      checked={selectedPanel.useCoords}
                      onChange={e => onUpdatePanel(selectedPanel.id, p => ({ ...p, useCoords: e.target.checked }), true)}
                      className="rounded accent-indigo-600"
                    />
                    <span>{t('启用坐标')}</span>
                  </label>
                </div>
                <div className="flex justify-center">
                  <div
                    ref={anchorStageRef}
                    style={{ width: Math.min(220, Math.round(130 * panelRatio)), aspectRatio: `${panelRatio}` }}
                    onPointerMove={e => { if (draggingAnchorRef.current) moveAnchorFromPointer(e, draggingAnchorRef.current); }}
                    onPointerUp={() => { if (draggingAnchorRef.current) { draggingAnchorRef.current = null; onUpdatePanel(selectedPanel.id, p => p, true); } }}
                    onPointerCancel={() => { draggingAnchorRef.current = null; }}
                    className="relative touch-none overflow-hidden rounded-lg border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900"
                  >
                    {selectedPanel.image?.url && (
                      <img src={selectedPanel.image.url} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40" />
                    )}
                    {selectedPanel.anchors.map((anchor, idx) => (
                      <button
                        key={anchor.id}
                        type="button"
                        aria-label={t('定位锚点 {0}', [anchor.label])}
                        onPointerDown={e => {
                          e.stopPropagation();
                          setSelectedAnchorId(anchor.id);
                          draggingAnchorRef.current = anchor.id;
                          anchorStageRef.current?.setPointerCapture?.(e.pointerId);
                        }}
                        style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
                        className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white shadow ${ANCHOR_META[anchor.kind].dotClass} ${selectedAnchor?.id === anchor.id ? 'ring-2 ring-indigo-500' : ''} ${anchor.enabled ? '' : 'opacity-40'}`}
                      >
                        {idx + 1}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 锚点列表 */}
                <div className="space-y-1.5">
                  {selectedPanel.anchors.map((anchor, idx) => (
                    <div
                      key={anchor.id}
                      onClick={() => setSelectedAnchorId(anchor.id)}
                      className={`rounded-lg border p-2 ${selectedAnchor?.id === anchor.id ? 'border-indigo-400 bg-white dark:border-indigo-500 dark:bg-gray-900' : 'border-gray-200 bg-white/70 dark:border-gray-700 dark:bg-gray-900/50'}`}
                    >
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={anchor.enabled}
                          onChange={e => onUpdatePanel(selectedPanel.id, p => ({
                            ...p,
                            anchors: p.anchors.map(a => a.id === anchor.id ? { ...a, enabled: e.target.checked } : a),
                          }), true)}
                          className="rounded accent-indigo-600"
                        />
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ANCHOR_META[anchor.kind].badgeClass}`}>
                          {idx + 1} · {t(ANCHOR_META[anchor.kind].label)}
                        </span>
                        <input
                          type="text"
                          value={anchor.label}
                          onChange={e => onUpdatePanel(selectedPanel.id, p => ({
                            ...p,
                            anchors: p.anchors.map(a => a.id === anchor.id ? { ...a, label: e.target.value } : a),
                          }), false)}
                          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-gray-800 outline-none dark:text-gray-100"
                        />
                        <span className="font-mono text-[10px] text-gray-400">({anchor.x.toFixed(2)}, {anchor.y.toFixed(2)})</span>
                        <button
                          type="button"
                          aria-label={t('删除锚点')}
                          onClick={e => {
                            e.stopPropagation();
                            onUpdatePanel(selectedPanel.id, p => ({
                              ...p,
                              anchors: p.anchors.filter(a => a.id !== anchor.id),
                            }), true);
                          }}
                          className="rounded p-0.5 text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        value={anchor.prompt}
                        onChange={e => onUpdatePanel(selectedPanel.id, p => ({
                          ...p,
                          anchors: p.anchors.map(a => a.id === anchor.id ? { ...a, prompt: e.target.value } : a),
                        }), false)}
                        placeholder={anchor.kind === 'bubble' ? t('气泡补充说明（如 tail pointing right）') : t('输入该锚点的外观、动作、物件或景别提示词')}
                        className="w-full rounded border border-gray-200 bg-gray-50/70 p-1.5 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      />
                      {anchor.kind === 'bubble' && (
                        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                          <select
                            value={anchor.bubbleShape || 'oval'}
                            onChange={e => onUpdatePanel(selectedPanel.id, p => ({
                              ...p,
                              anchors: p.anchors.map(a => a.id === anchor.id ? { ...a, bubbleShape: e.target.value as ComicBubbleShape } : a),
                            }), true)}
                            className="rounded border border-gray-200 bg-white px-1.5 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          >
                            {BUBBLE_SHAPES.map(shape => <option key={shape.id} value={shape.id}>{t(shape.label)}</option>)}
                          </select>
                          {draft.dialogueMode === 'ai-text' && (
                            <input
                              type="text"
                              value={anchor.bubbleText || ''}
                              onChange={e => onUpdatePanel(selectedPanel.id, p => ({
                                ...p,
                                anchors: p.anchors.map(a => a.id === anchor.id ? { ...a, bubbleText: e.target.value } : a),
                              }), false)}
                              placeholder={t('短台词（2-6字）')}
                              className="rounded border border-gray-200 bg-white px-1.5 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 构图微调（已填图时） */}
          {selectedPanel.image?.url && (
            <div className="space-y-2 rounded-xl border border-gray-200 p-2.5 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-700 dark:text-gray-200">{t('格内构图微调（Alt+拖拽可平移）')}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onUpdatePanel(selectedPanel.id, p => p.image ? ({ ...p, image: { ...p.image, offsetX: 0, offsetY: 0, scale: 1 } }) : p, true)}
                    className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    <RotateCcw className="h-3 w-3" /> {t('重置')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdatePanel(selectedPanel.id, p => ({ ...p, image: undefined }), true)}
                    className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                  >
                    {t('清图')}
                  </button>
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-gray-500">{t('缩放')} {Math.round((selectedPanel.image.scale || 1) * 100)}%</span>
                <input
                  type="range"
                  min={100}
                  max={250}
                  value={Math.round((selectedPanel.image.scale || 1) * 100)}
                  onChange={e => onUpdatePanel(selectedPanel.id, p => p.image ? ({ ...p, image: { ...p.image, scale: Number(e.target.value) / 100 } }) : p, false)}
                  className="w-full accent-indigo-600"
                />
              </label>
            </div>
          )}

          {/* 边框与旋转微调 */}
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-gray-200 p-2.5 dark:border-gray-700">
            <label className="block">
              <span className="mb-1 block text-gray-500">{t('旋转角度')} {selectedPanel.rotation}°</span>
              <input
                type="range"
                min={-45}
                max={45}
                value={selectedPanel.rotation}
                onChange={e => onUpdatePanel(selectedPanel.id, p => ({ ...p, rotation: Number(e.target.value) }), false)}
                className="w-full accent-indigo-600"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-gray-500">{t('边框粗细')} {selectedPanel.borderWidth}px</span>
              <input
                type="range"
                min={0}
                max={12}
                value={selectedPanel.borderWidth}
                onChange={e => onUpdatePanel(selectedPanel.id, p => ({ ...p, borderWidth: Number(e.target.value) }), false)}
                className="w-full accent-indigo-600"
              />
            </label>
          </div>
        </div>

        {/* 底部固定生成操作栏 */}
        <div className="flex-none border-t border-gray-200 bg-white/95 p-3 dark:border-gray-800 dark:bg-gray-900/95">
          {isGeneratingThis ? (
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white">
                <InlineSpinner className="h-3.5 w-3.5 text-white" />
                <span className="truncate">{generationStageText || t('生成中…')}</span>
              </div>
              <button
                type="button"
                onClick={onCancelGeneration}
                className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
              >
                {t('停止')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={anyGenerating || guard.level === 'hard-exceeded'}
              onClick={() => onGeneratePanel(selectedPanel.id)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Wand2 className="h-4 w-4" />
              <span>{t('生成当前格')}</span>
              <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-medium">
                {resolution.width}×{resolution.height}
              </span>
            </button>
          )}
        </div>

        <HistoryImagePicker
          open={historyPickerOpen}
          allowImportParams={false}
          onClose={() => setHistoryPickerOpen(false)}
          onSelect={item => handleSelectHistoryImage(item)}
        />
      </aside>
    );
  }

  // 默认：全页画风与 V5 统一配置面板
  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-gray-200 bg-white/95 p-3.5 dark:border-gray-800 dark:bg-gray-900/95">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">{t('全页画风与 V5 设置')}</h3>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
          {draft.panels.length} {t('格')}
        </span>
      </div>

      {draft.creationMode === 'ai-page' && (
        <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/70 p-2.5 text-xs text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">
          <div className="mb-1 flex items-center gap-1.5 font-bold">
            <Sparkles className="h-3.5 w-3.5" /> {t('AI 整页锚点一图成型（第二期即将上线）')}
          </div>
          <p className="text-[11px] leading-relaxed opacity-90">
            {t('当前第一期已完整打通分镜画布、自由切格与手动逐格 V5 生图。点击画布任意分镜格即可立刻设词生图，第二期将在此接入 AI 编排整页剧本与四类可视化锚点。')}
          </p>
        </div>
      )}

      <div className="space-y-3.5 text-xs">
        {/* V5 模型档位 */}
        <div>
          <span className="mb-1.5 block font-semibold text-gray-700 dark:text-gray-200">{t('NovelAI V5 模型（仅漫画模式独立生效）')}</span>
          <div className="grid grid-cols-1 gap-1.5">
            {COMIC_V5_MODELS.map(model => {
              const active = draft.v5Model === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => onUpdateDraft(cur => ({
                    ...cur,
                    v5Model: model.id as ComicV5ModelId,
                    steps: model.id === 'nai-diffusion-5-full-medium' ? 14 : 23,
                  }), true)}
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-left transition ${active ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
                >
                  <span className="font-semibold">{model.label}</span>
                  <span className="text-[11px] opacity-75">{t(model.badge)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 色彩模式：全彩 / 黑白网点漫 */}
        <div>
          <span className="mb-1.5 block font-semibold text-gray-700 dark:text-gray-200">{t('漫画色彩模式')}</span>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              { id: 'color', label: '全彩漫画' },
              { id: 'monochrome', label: '黑白网点漫' },
            ] as Array<{ id: ComicColorMode; label: string }>).map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => onUpdateDraft(cur => ({ ...cur, colorMode: item.id }), true)}
                className={`rounded-lg border px-2.5 py-1.5 font-semibold transition ${draft.colorMode === item.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
          {draft.colorMode === 'monochrome' && (
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              {t('生图时会自动剥离发送副本中的彩色词并压制色相，绝不修改角色库原资料。')}
            </p>
          )}
        </div>

        {/* 三选一对白文字策略 */}
        <div>
          <span className="mb-1.5 block font-semibold text-gray-700 dark:text-gray-200">{t('对白与气泡策略')}</span>
          <div className="space-y-1">
            {([
              { id: 'clean-vector', label: '无气泡纯画面 + 画布矢量气泡', desc: '画面零杂字，气泡用画布工具自由排版' },
              { id: 'empty-bubble', label: '空白气泡直出 + 后期嵌字', desc: 'AI 画纯白空气泡，出图后再填字' },
              { id: 'ai-text', label: 'AI 锚点直出短字 / 拟声词', desc: '通过气泡锚点把短台词融入画风绘出' },
            ] as Array<{ id: ComicDialogueMode; label: string; desc: string }>).map(mode => (
              <button
                key={mode.id}
                type="button"
                onClick={() => onUpdateDraft(cur => ({ ...cur, dialogueMode: mode.id }), true)}
                className={`flex w-full flex-col rounded-lg border px-2.5 py-1.5 text-left transition ${draft.dialogueMode === mode.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
              >
                <span className="font-semibold">{t(mode.label)}</span>
                <span className="text-[11px] opacity-75">{t(mode.desc)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 引用工坊风格串 */}
        <div>
          <span className="mb-1.5 block font-semibold text-gray-700 dark:text-gray-200">{t('载入风格串画风')}</span>
          <select
            aria-label={t('选择风格串')}
            value={draft.styleChainId || ''}
            onChange={event => {
              const found = styleChains.find(c => c.id === event.target.value);
              if (found) onApplyStyleChain(found);
              else onUpdateDraft(cur => ({ ...cur, styleChainId: undefined }), true);
            }}
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">{t('不绑定风格串（手动填写全局画风）')}</option>
            {styleChains.map(chain => (
              <option key={chain.id} value={chain.id}>{chain.name}</option>
            ))}
          </select>
        </div>

        {/* 全局画风正负面词 */}
        <label className="block">
          <span className="mb-1 block font-semibold text-gray-700 dark:text-gray-200">{t('全页公共画风提示词')}</span>
          <TagAutocompleteTextarea
            rows={3}
            value={draft.globalBasePrompt}
            onValueChange={val => onUpdateDraft(cur => ({ ...cur, globalBasePrompt: val }), false)}
            placeholder={t('输入画师串与全页统一画风，每格生图自动带上')}
            className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-semibold text-gray-600 dark:text-gray-300">{t('全页公共负面词')}</span>
          <TagAutocompleteTextarea
            rows={2}
            value={draft.globalNegativePrompt}
            onValueChange={val => onUpdateDraft(cur => ({ ...cur, globalNegativePrompt: val }), false)}
            placeholder={t('全页公共排除词（自动过滤压制网点的冲突词）')}
            className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
        </label>

        {/* 分镜格快速列表（方便点选与手机端操作） */}
        <div className="border-t border-gray-200 pt-3 dark:border-gray-800">
          <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-gray-700 dark:text-gray-200">
            <Layers className="h-3.5 w-3.5 text-indigo-500" />
            {t('分镜格列表（点击选中单格生图）')}
          </div>
          <div className="space-y-1">
            {draft.panels.map(panel => (
              <button
                key={panel.id}
                type="button"
                onClick={() => onSelect({ kind: 'panel', id: panel.id })}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200/80 bg-gray-50/70 px-2.5 py-1.5 text-left transition hover:border-indigo-400 hover:bg-indigo-50/40 dark:border-gray-700 dark:bg-gray-800/70"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Square className="h-3.5 w-3.5 flex-none text-indigo-500" />
                  <span className="truncate font-medium text-gray-800 dark:text-gray-100">{panel.name}</span>
                </div>
                <span className={`ml-2 flex-none text-[11px] ${panel.image?.url ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
                  {panel.image?.url ? t('已成图') : t('待生图')}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
};
