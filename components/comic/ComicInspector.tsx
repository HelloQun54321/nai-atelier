import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Check,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  Lock,
  MessageCircle,
  Palette,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Sticker,
  Trash2,
  Type,
  Unlock,
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
import type { ComicAiZonePlan } from '../../services/comic/comicAiPageEngine';
import type {
  ComicAiPagePlan,
  ComicAiZoneSplitMode,
  ComicAnchor,
  ComicAnchorKind,
  ComicBubbleItem,
  ComicBubbleShape,
  ComicColorMode,
  ComicDialogueMode,
  ComicLayerId,
  ComicPageDraft,
  ComicPanel,
  ComicSelection,
  ComicStickerItem,
  ComicStickerKind,
  ComicTextItem,
  ComicV5ModelId,
} from '../../services/comic/comicTypes';
import { createUuid } from '../../services/id';
import { InlineSpinner } from '../DesignSystem';
import { HistoryImagePicker } from '../HistoryImagePicker';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';

export type ComicInspectorTab = 'panel' | 'style' | 'layers';

interface ComicInspectorProps {
  draft: ComicPageDraft;
  aiZonePlan: ComicAiZonePlan;
  activeTab: ComicInspectorTab;
  selection: ComicSelection;
  chains: PromptChain[];
  generatingPanelId: string | null;
  planningAiStoryboard: boolean;
  generatingAiPage: boolean;
  aiGenerationStageText: string;
  generationStageText: string;
  estimatedCost: number;
  aiEstimatedCost: number;
  onSelectTab: (tab: ComicInspectorTab) => void;
  onSelect: (selection: ComicSelection) => void;
  onQuickAddPanel: () => void;
  onUpdateDraft: (updater: (current: ComicPageDraft) => ComicPageDraft, commit?: boolean) => void;
  onUpdateAiPage: (updater: (aiPage: ComicAiPagePlan) => ComicAiPagePlan, commit?: boolean) => void;
  onPlanAiStoryboard: () => void;
  onInitAiFromTemplate: () => void;
  onConvertBubbleAnchorsToVector: () => void;
  onGenerateAiPage: () => void;
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
  onToggleLayerVisible: (layerId: ComicLayerId) => void;
  onToggleLayerLocked: (layerId: ComicLayerId) => void;
  onMoveLayerOrder: (layerId: ComicLayerId, direction: 'up' | 'down') => void;
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
  { id: 'exclamation', label: '惊叹 !' },
  { id: 'question', label: '问号 ?' },
  { id: 'shock', label: '震惊线' },
  { id: 'heart', label: '爱心' },
];

const LAYER_LABELS: Record<ComicLayerId, string> = {
  panels: '分镜画格',
  drawing: '手绘涂鸦',
  bubbles: '气泡与文字',
  stickers: '效果贴纸',
};

const POSITIVE_LIBRARY_FIELD = { negative: false } as const;
const NEGATIVE_LIBRARY_FIELD = { negative: true } as const;

const shortModelLabel = (id: ComicV5ModelId): string => {
  if (id === 'nai-diffusion-5-full-medium') return 'Medium (14步)';
  if (id === 'nai-diffusion-5-curated') return 'Curated';
  return 'High (23步)';
};

const SPLIT_MODE_OPTIONS: Array<{ id: ComicAiZoneSplitMode; label: string }> = [
  { id: 'auto', label: '自动' },
  { id: 'single', label: '单区' },
  { id: 'dual-vertical', label: '上下双区' },
  { id: 'dual-horizontal', label: '左右双区' },
];

export const ComicInspector: React.FC<ComicInspectorProps> = ({
  draft,
  aiZonePlan,
  activeTab,
  selection,
  chains,
  generatingPanelId,
  planningAiStoryboard,
  generatingAiPage,
  aiGenerationStageText,
  generationStageText,
  estimatedCost,
  aiEstimatedCost,
  onSelectTab,
  onSelect,
  onQuickAddPanel,
  onUpdateDraft,
  onUpdateAiPage,
  onPlanAiStoryboard,
  onInitAiFromTemplate,
  onConvertBubbleAnchorsToVector,
  onGenerateAiPage,
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
  onToggleLayerVisible,
  onToggleLayerLocked,
  onMoveLayerOrder,
}) => {
  useLanguage();
  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [castPickerOpen, setCastPickerOpen] = useState(false);
  const [castQuery, setCastQuery] = useState('');
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [styleQuery, setStyleQuery] = useState('');
  const [charQuery, setCharQuery] = useState('');
  const [selectedAnchorId, setSelectedAnchorId] = useState<string>('');
  const anchorStageRef = useRef<HTMLDivElement>(null);
  const draggingAnchorRef = useRef<string | null>(null);

  const styleChains = useMemo(() => {
    const named = chains.filter(item =>
      item.type === 'style'
      && item.id !== 'playground'
      && item.name.trim()
      && item.name.trim() !== '生图实验室',
    );
    const q = styleQuery.trim().toLowerCase();
    if (!q) return named.slice(0, 60);
    return named.filter(item =>
      item.name.toLowerCase().includes(q)
      || item.basePrompt?.toLowerCase().includes(q)
      || item.tags?.some(tag => tag.toLowerCase().includes(q)),
    ).slice(0, 60);
  }, [chains, styleQuery]);

  const boundStyleChain = useMemo(
    () => draft.styleChainId ? chains.find(item => item.id === draft.styleChainId) : undefined,
    [chains, draft.styleChainId],
  );

  const characterChains = useMemo(() => {
    const chars = chains.filter(item => item.type === 'character');
    const q = charQuery.trim().toLowerCase();
    if (!q) return chars.slice(0, 60);
    return chars.filter(item =>
      item.name.toLowerCase().includes(q)
      || item.basePrompt?.toLowerCase().includes(q),
    ).slice(0, 60);
  }, [chains, charQuery]);

  const hasAnyCharacterChains = useMemo(
    () => chains.some(item => item.type === 'character'),
    [chains],
  );

  // 分镜生图标签默认锚定当前选中的格，若当前未选格则自动显示第 1 格
  const activePanel = (selection?.kind === 'panel'
    ? draft.panels.find(item => item.id === selection.id)
    : undefined) || draft.panels[0];

  const selectedBubble = selection?.kind === 'bubble'
    ? draft.bubbles.find(item => item.id === selection.id)
    : undefined;
  const selectedText = selection?.kind === 'text'
    ? draft.texts.find(item => item.id === selection.id)
    : undefined;
  const selectedSticker = selection?.kind === 'sticker'
    ? draft.stickers.find(item => item.id === selection.id)
    : undefined;

  const orderedLayers = (['panels', 'drawing', 'bubbles', 'stickers'] as ComicLayerId[])
    .sort((a, b) => (draft.layers[b]?.order ?? 0) - (draft.layers[a]?.order ?? 0));

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

  const addAnchorToAiPage = (kind: ComicAnchorKind, seed?: { label?: string; prompt?: string; negativePrompt?: string; sourceCharacterId?: string }) => {
    const countOfKind = draft.aiPage.anchors.filter(a => a.kind === kind).length + 1;
    // 默认落在新引导格或页面中段，略微错开防止重叠
    const offset = (draft.aiPage.anchors.length % 5) * 0.06;
    const next: ComicAnchor = {
      id: createUuid(),
      kind,
      label: seed?.label || `${ANCHOR_META[kind].label} ${countOfKind}`,
      prompt: seed?.prompt || '',
      negativePrompt: seed?.negativePrompt || '',
      x: clampAnchorCoord(0.32 + offset),
      y: clampAnchorCoord(0.28 + offset),
      enabled: true,
      ...(kind === 'bubble' ? { bubbleShape: 'oval' as ComicBubbleShape, bubbleText: '' } : {}),
      ...(seed?.sourceCharacterId ? { sourceCharacterId: seed.sourceCharacterId } : {}),
    };
    onUpdateAiPage(cur => ({
      ...cur,
      showGuideOverlay: true,
      anchors: [...cur.anchors, next],
    }), true);
    onSelect({ kind: 'ai-anchor', id: next.id });
  };

  const allCharacterChains = useMemo(
    () => chains.filter(item => item.type === 'character'),
    [chains],
  );

  const handleSelectHistoryImage = (item: LocalGenItem) => {
    if (!activePanel) return;
    onUpdatePanel(activePanel.id, current => ({
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

  const overlayCount = draft.bubbles.length + draft.texts.length + draft.stickers.length;

  return (
    <aside className="flex h-full w-full flex-col border-l border-gray-200 bg-white/95 dark:border-gray-800 dark:bg-gray-900/95">
      {/* 顶部平铺式三标签导航（去外层套娃胶囊，底边强调线，绝不裁切下方行） */}
      <div
        role="tablist"
        aria-label={t('漫画工作台分区')}
        className="grid flex-none grid-cols-3 border-b border-gray-200/90 bg-white/95 dark:border-gray-800/90 dark:bg-gray-900/95"
      >
        {([
          { id: 'panel', label: draft.creationMode === 'ai-page' ? 'AI 整页编排' : '分镜生图', icon: draft.creationMode === 'ai-page' ? Sparkles : Wand2 },
          { id: 'style', label: '画风设定', icon: Palette },
          { id: 'layers', label: overlayCount > 0 ? `嵌字·图层 (${overlayCount})` : '嵌字·图层', icon: Layers },
        ] as Array<{ id: ComicInspectorTab; label: string; icon: React.ElementType }>).map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectTab(tab.id)}
              className={`relative inline-flex h-10 items-center justify-center gap-1.5 px-2 text-xs font-semibold transition ${active ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200'}`}
            >
              <Icon className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
              <span className="truncate">{t(tab.label)}</span>
              {active && <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-indigo-500" />}
            </button>
          );
        })}
      </div>

      {/* ==================== 标签 1A：AI 整页锚点编排工作台（第二期核心） ==================== */}
      {activeTab === 'panel' && draft.creationMode === 'ai-page' && (() => {
        const aiPage = draft.aiPage;
        const selectedAiAnchor = selection?.kind === 'ai-anchor'
          ? aiPage.anchors.find(a => a.id === selection.id)
          : undefined;
        const bubbleAnchorCount = aiPage.anchors.filter(a => a.enabled && a.kind === 'bubble').length;
        const anyGenerating = Boolean(generatingPanelId) || generatingAiPage;

        return (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3.5 pb-6 text-xs">
              {/* 剧情脚本与 AI 编排区 */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-gray-800 dark:text-gray-100">{t('本页剧情与分镜编排')}</span>
                  <span className="text-[11px] text-gray-400">{t('调用创作助手，不消耗生图额度')}</span>
                </div>
                <textarea
                  rows={3}
                  aria-label={t('漫画整页剧情描述')}
                  value={aiPage.storyPrompt}
                  onChange={e => onUpdateAiPage(cur => ({ ...cur, storyPrompt: e.target.value }), false)}
                  placeholder={t('例如：放学后的雨中教室，黑发少女递给银发少年一把透明雨伞，少年愣住随后脸红，最后两人并肩走入雨幕（4 格）')}
                  className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />

                {/* 目标格数快选 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{t('目标格数')}</span>
                  <div className="flex items-center gap-1">
                    {[3, 4, 5, 6, 8].map(count => (
                      <button
                        key={count}
                        type="button"
                        aria-pressed={aiPage.targetPanelCount === count}
                        onClick={() => onUpdateAiPage(cur => ({ ...cur, targetPanelCount: count }), true)}
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold transition ${aiPage.targetPanelCount === count ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
                      >
                        {count}{t('格')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 本页出场角色：紧凑可搜选择器（只展示已选角色，不堆满一屏角色卡片） */}
                {allCharacterChains.length > 0 && (() => {
                  const selectedCast = aiPage.castCharacterIds
                    .map(id => allCharacterChains.find(c => c.id === id))
                    .filter((c): c is PromptChain => Boolean(c));
                  const q = castQuery.trim().toLowerCase();
                  const filteredCast = q
                    ? allCharacterChains.filter(c => c.name.toLowerCase().includes(q) || c.basePrompt?.toLowerCase().includes(q)).slice(0, 40)
                    : allCharacterChains.slice(0, 40);
                  return (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{t('出场角色')}</span>
                        {selectedCast.map(char => (
                          <span
                            key={char.id}
                            className="inline-flex items-center gap-1 rounded-md border border-indigo-400/70 bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:border-indigo-500/70 dark:bg-indigo-950/60 dark:text-indigo-200"
                          >
                            <span className="max-w-24 truncate">{char.name}</span>
                            <button
                              type="button"
                              aria-label={t('移除角色 {0}', [char.name])}
                              onClick={() => onUpdateAiPage(cur => ({
                                ...cur,
                                castCharacterIds: cur.castCharacterIds.filter(id => id !== char.id),
                              }), true)}
                              className="rounded hover:text-red-500"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </span>
                        ))}
                        <button
                          type="button"
                          aria-expanded={castPickerOpen}
                          onClick={() => setCastPickerOpen(open => !open)}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                        >
                          <UserPlus className="h-3 w-3 text-indigo-500" />
                          <span>{t('选择出场角色')}</span>
                        </button>
                      </div>
                      {castPickerOpen && (
                        <div className="space-y-1.5 rounded-lg border border-indigo-200 bg-white p-1.5 dark:border-indigo-800 dark:bg-gray-900">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                            <input
                              type="text"
                              value={castQuery}
                              onChange={e => setCastQuery(e.target.value)}
                              placeholder={t('搜索角色库…')}
                              className="w-full rounded border border-gray-200 bg-gray-50 py-1 pl-6 pr-2 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                            />
                          </div>
                          <div className="max-h-36 space-y-0.5 overflow-y-auto">
                            {filteredCast.map(char => {
                              const checked = aiPage.castCharacterIds.includes(char.id);
                              return (
                                <button
                                  key={char.id}
                                  type="button"
                                  aria-pressed={checked}
                                  onClick={() => onUpdateAiPage(cur => ({
                                    ...cur,
                                    castCharacterIds: checked
                                      ? cur.castCharacterIds.filter(id => id !== char.id)
                                      : [...cur.castCharacterIds, char.id],
                                  }), true)}
                                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] transition ${checked ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800'}`}
                                >
                                  <span className="min-w-0 flex-1 truncate font-medium">{char.name}</span>
                                  {char.basePrompt && (
                                    <span className="max-w-28 truncate text-[10px] text-gray-400">{char.basePrompt}</span>
                                  )}
                                  {checked && <Check className="h-3 w-3 flex-none text-indigo-500" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={planningAiStoryboard || !aiPage.storyPrompt.trim()}
                    onClick={onPlanAiStoryboard}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {planningAiStoryboard ? <InlineSpinner className="h-3.5 w-3.5 text-white" /> : <Sparkles className="h-3.5 w-3.5" />}
                    <span>{planningAiStoryboard ? t('AI 编排中…') : t('AI 编排分镜与锚点')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={planningAiStoryboard}
                    onClick={onInitAiFromTemplate}
                    title={t('按当前目标格数重置引导区（不调用大模型）')}
                    className="inline-flex flex-none items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[11px] font-medium text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  >
                    {t('重置引导格')}
                  </button>
                </div>
              </div>

              {/* 分区策略、槽位护栏与引导层控制 */}
              <div className="space-y-2 border-t border-gray-200/80 pt-3.5 dark:border-gray-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-gray-800 dark:text-gray-100">{t('分区策略与槽位护栏')}</span>
                  <span className={`text-[11px] font-semibold ${aiZonePlan.overallLevel === 'hard-exceeded' ? 'text-red-500' : aiZonePlan.overallLevel === 'soft-warning' ? 'text-amber-500' : 'text-gray-500 dark:text-gray-400'}`}>
                    {aiZonePlan.totalPanels}{t('格')} · {aiZonePlan.totalActiveAnchors}{t('槽')} · {aiZonePlan.zones.length}{t('区')}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1" role="group" aria-label={t('AI 整页分区方式')}>
                  {SPLIT_MODE_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={aiPage.splitMode === opt.id}
                      onClick={() => onUpdateAiPage(cur => ({ ...cur, splitMode: opt.id }), true)}
                      className={`rounded-md border px-1.5 py-1 text-[11px] font-semibold transition ${aiPage.splitMode === opt.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
                    >
                      {t(opt.label)}
                    </button>
                  ))}
                </div>

                {aiZonePlan.autoSplitTriggered && (
                  <p className="rounded-lg bg-indigo-50/90 px-2.5 py-1.5 text-[11px] text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200">
                    {t('格数或槽位超过单区甜点区，已自动拆为 2 张免费 Opus 区依次生成并无缝拼合。')}
                  </p>
                )}
                {aiZonePlan.recommendDualSplit && (
                  <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    {t('当前强制单区已超过甜点密度，建议切换「自动」或双区以保持人物清晰度。')}
                  </p>
                )}
                {aiZonePlan.overallLevel === 'soft-warning' && (
                  <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    {t('存在单个分区超过 12 个锚点，人物可能缩为 Q 版；可切双区或精简次要锚点。')}
                  </p>
                )}
                {aiZonePlan.overallLevel === 'hard-exceeded' && (
                  <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {t('单个分区超过 24 槽硬上限，请切换双区或停用部分锚点后再生成。')}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onUpdateAiPage(cur => ({ ...cur, showGuideOverlay: !cur.showGuideOverlay }), false)}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  >
                    {aiPage.showGuideOverlay ? <Eye className="h-3 w-3 text-indigo-500" /> : <EyeOff className="h-3 w-3 text-gray-400" />}
                    <span>{aiPage.showGuideOverlay ? t('隐藏引导与锚点') : t('显示引导与锚点')}</span>
                  </button>
                  {bubbleAnchorCount > 0 && (
                    <button
                      type="button"
                      onClick={onConvertBubbleAnchorsToVector}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    >
                      <MessageCircle className="h-3 w-3 text-amber-500" />
                      <span>{t('气泡点转矢量嵌字')} ({bubbleAnchorCount})</span>
                    </button>
                  )}
                  {aiPage.generatedPageImage?.url && (
                    <button
                      type="button"
                      onClick={() => onUpdateAiPage(cur => ({ ...cur, generatedPageImage: undefined, showGuideOverlay: true }), true)}
                      className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-3 w-3" /> {t('清成图')}
                    </button>
                  )}
                </div>
              </div>

              {/* 整页四类空间锚点（与画布可拖圆点双向联动） */}
              <div className="space-y-2.5 border-t border-gray-200/80 pt-3.5 dark:border-gray-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-gray-800 dark:text-gray-100">{t('整页四类空间锚点')}</span>
                  <span className="text-[11px] text-gray-400">{t('画布上可直接拖拽坐标')}</span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => addAnchorToAiPage('character')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200"
                  >
                    <span className="h-2 w-2 rounded-full bg-blue-500" aria-hidden="true" />
                    {t('角色')}
                  </button>
                  {hasAnyCharacterChains && (
                    <button
                      type="button"
                      onClick={() => setCharacterPickerOpen(open => !open)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${characterPickerOpen ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/50 dark:text-indigo-200' : 'border-gray-200/90 bg-white text-gray-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200'}`}
                    >
                      <UserPlus className="h-3 w-3 text-blue-500" /> {t('角色库')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => addAnchorToAiPage('scene')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200"
                  >
                    <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                    {t('空镜/道具')}
                  </button>
                  <button
                    type="button"
                    onClick={() => addAnchorToAiPage('bubble')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200"
                  >
                    <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
                    {t('气泡点')}
                  </button>
                  <button
                    type="button"
                    onClick={() => addAnchorToAiPage('inset')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200"
                  >
                    <span className="h-2 w-2 rounded-full bg-purple-500" aria-hidden="true" />
                    {t('特写叠框')}
                  </button>
                </div>

                {characterPickerOpen && hasAnyCharacterChains && (
                  <div className="space-y-1.5 rounded-lg border border-blue-200 bg-white p-1.5 dark:border-blue-800 dark:bg-gray-900">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={charQuery}
                        onChange={e => setCharQuery(e.target.value)}
                        placeholder={t('搜索角色库加入整页锚点…')}
                        className="w-full rounded border border-gray-200 bg-gray-50 py-1 pl-6 pr-2 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>
                    <div className="max-h-36 space-y-1 overflow-y-auto">
                      {characterChains.map(char => (
                        <button
                          key={char.id}
                          type="button"
                          onClick={() => {
                            addAnchorToAiPage('character', {
                              label: char.name,
                              prompt: [char.basePrompt, char.variableValues?.subject].filter(Boolean).join(', '),
                              negativePrompt: char.negativePrompt || '',
                              sourceCharacterId: char.id,
                            });
                            setCharacterPickerOpen(false);
                            setCharQuery('');
                          }}
                          className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] hover:bg-blue-50 dark:hover:bg-blue-950/50"
                        >
                          <span className="truncate font-medium text-gray-800 dark:text-gray-100">{char.name}</span>
                          <span className="ml-2 flex-none text-blue-600 dark:text-blue-400">+ {t('加入')}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {aiPage.anchors.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-[11px] text-gray-400 dark:border-gray-700">
                    {t('输入剧情点「AI 编排分镜与锚点」，或直接点击上方按钮手动放置整页锚点')}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {aiPage.anchors.map((anchor, idx) => {
                      const isExpanded = selectedAiAnchor?.id === anchor.id || (!selectedAiAnchor && idx === 0);
                      return (
                        <div
                          key={anchor.id}
                          onClick={() => onSelect({ kind: 'ai-anchor', id: anchor.id })}
                          className={`rounded-lg border p-2 transition ${isExpanded ? 'border-indigo-400 bg-white dark:border-indigo-500 dark:bg-gray-900' : 'border-gray-200/80 bg-white/70 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900/50'}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              aria-label={t('启用锚点')}
                              checked={anchor.enabled}
                              onClick={e => e.stopPropagation()}
                              onChange={e => onUpdateAiPage(cur => ({
                                ...cur,
                                anchors: cur.anchors.map(a => a.id === anchor.id ? { ...a, enabled: e.target.checked } : a),
                              }), true)}
                              className="rounded accent-indigo-600"
                            />
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ANCHOR_META[anchor.kind].badgeClass}`}>
                              {idx + 1} · {t(ANCHOR_META[anchor.kind].label)}
                            </span>
                            <input
                              type="text"
                              value={anchor.label}
                              onClick={e => e.stopPropagation()}
                              onChange={e => onUpdateAiPage(cur => ({
                                ...cur,
                                anchors: cur.anchors.map(a => a.id === anchor.id ? { ...a, label: e.target.value } : a),
                              }), false)}
                              className="min-w-0 flex-1 bg-transparent text-xs font-medium text-gray-800 outline-none dark:text-gray-100"
                            />
                            <span className="font-mono text-[10px] text-gray-400">({anchor.x.toFixed(2)}, {anchor.y.toFixed(2)})</span>
                            <button
                              type="button"
                              aria-label={t('删除整页锚点')}
                              onClick={e => {
                                e.stopPropagation();
                                onUpdateAiPage(cur => ({
                                  ...cur,
                                  anchors: cur.anchors.filter(a => a.id !== anchor.id),
                                }), true);
                              }}
                              className="rounded p-0.5 text-gray-400 hover:text-red-500"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>

                          {isExpanded && (
                            <div className="mt-2 space-y-1.5">
                              <textarea
                                rows={2}
                                value={anchor.prompt}
                                onChange={e => onUpdateAiPage(cur => ({
                                  ...cur,
                                  anchors: cur.anchors.map(a => a.id === anchor.id ? { ...a, prompt: e.target.value } : a),
                                }), false)}
                                placeholder={anchor.kind === 'bubble' ? t('气泡补充说明（如 tail pointing left）') : t('输入该锚点的英文外观、动作、表情或物件提示词')}
                                className="w-full rounded border border-gray-200 bg-gray-50/70 p-1.5 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                              />
                              {anchor.kind === 'bubble' && (
                                <div className="grid grid-cols-2 gap-1.5">
                                  <select
                                    value={anchor.bubbleShape || 'oval'}
                                    onChange={e => onUpdateAiPage(cur => ({
                                      ...cur,
                                      anchors: cur.anchors.map(a => a.id === anchor.id ? { ...a, bubbleShape: e.target.value as ComicBubbleShape } : a),
                                    }), true)}
                                    className="rounded border border-gray-200 bg-white px-1.5 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                  >
                                    {BUBBLE_SHAPES.map(shape => <option key={shape.id} value={shape.id}>{t(shape.label)}</option>)}
                                  </select>
                                  <input
                                    type="text"
                                    value={anchor.bubbleText || ''}
                                    onChange={e => onUpdateAiPage(cur => ({
                                      ...cur,
                                      anchors: cur.anchors.map(a => a.id === anchor.id ? { ...a, bubbleText: e.target.value } : a),
                                    }), false)}
                                    placeholder={draft.dialogueMode === 'ai-text' ? t('短台词（直出）') : t('备用台词（可转矢量）')}
                                    className="rounded border border-gray-200 bg-white px-1.5 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 折叠细节：构图总述与引导区微调 */}
              <details className="border-t border-gray-200/80 pt-3.5 dark:border-gray-800">
                <summary className="cursor-pointer select-none font-bold text-gray-700 dark:text-gray-200">
                  {t('整页版式词与构图引导区')} ({aiPage.guidePanels.length})
                </summary>
                <div className="mt-2.5 space-y-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-gray-500">{t('极简版式总词（不写单格剧情，防止串格）')}</span>
                    <input
                      type="text"
                      value={aiPage.layoutHint}
                      onChange={e => onUpdateAiPage(cur => ({ ...cur, layoutHint: e.target.value }), false)}
                      placeholder="4-panel manga page, clean white gutters"
                      className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </label>
                  <div className="space-y-1">
                    {aiPage.guidePanels.map((gp, idx) => (
                      <div key={gp.id} className="flex items-center gap-1.5 rounded border border-gray-200/80 bg-gray-50/70 px-2 py-1 dark:border-gray-800 dark:bg-gray-800/50">
                        <span className="font-mono text-[10px] font-bold text-indigo-500">{String(idx + 1).padStart(2, '0')}</span>
                        <input
                          type="text"
                          value={gp.summary}
                          onChange={e => onUpdateAiPage(cur => ({
                            ...cur,
                            guidePanels: cur.guidePanels.map(item => item.id === gp.id ? { ...item, summary: e.target.value } : item),
                          }), false)}
                          placeholder={gp.label}
                          className="min-w-0 flex-1 bg-transparent text-[11px] text-gray-700 outline-none dark:text-gray-200"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            </div>

            {/* 底部常驻「生成 AI 整页」主操作栏 */}
            <div className="flex-none border-t border-gray-200 bg-white/95 p-3 dark:border-gray-800 dark:bg-gray-900/95">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                <span>
                  {aiZonePlan.zones.length === 1
                    ? `${t('免费单区')}：${aiZonePlan.zones[0].resolution.width} × ${aiZonePlan.zones[0].resolution.height}`
                    : `${t('双区无缝拼合')}：2 × ${t('免费档')}`}
                </span>
                <span>{formatGenerationCostLabel(aiEstimatedCost, draft.v5Model)}</span>
              </div>
              {generatingAiPage ? (
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white">
                    <InlineSpinner className="h-3.5 w-3.5 text-white" />
                    <span className="truncate">{aiGenerationStageText || generationStageText || t('整页生成中…')}</span>
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
                  disabled={anyGenerating || aiZonePlan.overallLevel === 'hard-exceeded'}
                  onClick={onGenerateAiPage}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>{t('生成 AI 整页')}</span>
                  <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-medium">
                    {aiZonePlan.zones.length === 1 ? t('1 张直出') : t('2 区拼合')}
                  </span>
                </button>
              )}
            </div>
          </>
        );
      })()}

      {/* ==================== 标签 1B：手动逐格生图 ==================== */}
      {activeTab === 'panel' && draft.creationMode === 'manual' && (
        <>
          {/* 顶部常驻分镜格快速切换条 */}
          <div className="flex flex-none items-center gap-1.5 overflow-x-auto border-b border-gray-200/80 bg-gray-50/50 px-3.5 py-2 dark:border-gray-800/80 dark:bg-gray-950/30">
            {draft.panels.map((panel, index) => {
              const isActive = activePanel?.id === panel.id;
              const hasImg = Boolean(panel.image?.url);
              return (
                <button
                  key={panel.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => onSelect({ kind: 'panel', id: panel.id })}
                  className={`inline-flex h-7 min-w-8 flex-none items-center justify-center gap-1 rounded-lg border px-2 text-xs font-semibold transition ${isActive ? 'border-indigo-500 bg-indigo-600 text-white shadow-xs' : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-200 dark:hover:border-indigo-500'}`}
                >
                  <span>{index + 1}</span>
                  {hasImg && <Check className={`h-3 w-3 ${isActive ? 'text-emerald-200' : 'text-emerald-500'}`} />}
                </button>
              );
            })}
            <button
              type="button"
              aria-label={t('新增分镜格')}
              title={t('新增分镜格')}
              onClick={onQuickAddPanel}
              className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-500 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-indigo-400 dark:hover:text-indigo-300"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {activePanel ? (() => {
            const resolution = getPanelTargetResolution(activePanel, draft.width, draft.height);
            const bounds = getPanelBoundingBox(activePanel.points, draft.width, draft.height);
            const panelRatio = Math.max(0.35, Math.min(2.8, bounds.width / Math.max(1, bounds.height)));
            const guard = evaluateAnchorGuard(activePanel.anchors);
            const isGeneratingThis = generatingPanelId === activePanel.id;
            const anyGenerating = Boolean(generatingPanelId);
            const selectedAnchor = activePanel.anchors.find(a => a.id === selectedAnchorId) || activePanel.anchors[0];

            const moveAnchorFromPointer = (event: React.PointerEvent<HTMLDivElement>, anchorId: string) => {
              const rect = anchorStageRef.current?.getBoundingClientRect();
              if (!rect || !rect.width || !rect.height) return;
              const nx = clampAnchorCoord((event.clientX - rect.left) / rect.width);
              const ny = clampAnchorCoord((event.clientY - rect.top) / rect.height);
              onUpdatePanel(activePanel.id, current => ({
                ...current,
                anchors: current.anchors.map(a => a.id === anchorId ? { ...a, x: nx, y: ny } : a),
              }), false);
            };

            return (
              <>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3.5 pb-6 text-xs">
                  {/* 当前格标题与快捷动作行 */}
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      aria-label={t('分镜格名称')}
                      value={activePanel.name}
                      onChange={e => onUpdatePanel(activePanel.id, p => ({ ...p, name: e.target.value }), false)}
                      onBlur={() => onUpdatePanel(activePanel.id, p => p, true)}
                      className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm font-bold text-gray-800 outline-none hover:border-gray-200 focus:border-indigo-400 focus:bg-white dark:text-gray-100 dark:hover:border-gray-700 dark:focus:bg-gray-800"
                    />
                    <div className="flex flex-none items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setHistoryPickerOpen(true)}
                        title={t('从生成历史选图填入')}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                      >
                        <ImageIcon className="h-3 w-3" /> {t('选图')}
                      </button>
                      <button type="button" title={t('置顶叠框')} aria-label={t('置顶叠框')} onClick={() => onBringPanelOrder(activePanel.id, 'front')} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ArrowUpToLine className="h-3.5 w-3.5" /></button>
                      <button type="button" title={t('置底')} aria-label={t('置底')} onClick={() => onBringPanelOrder(activePanel.id, 'back')} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ArrowDownToLine className="h-3.5 w-3.5" /></button>
                      <button type="button" title={t('复制分镜格')} aria-label={t('复制分镜格')} onClick={() => onDuplicatePanel(activePanel.id)} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Copy className="h-3.5 w-3.5" /></button>
                      <button type="button" title={t('删除分镜格')} aria-label={t('删除分镜格')} onClick={() => onDeletePanel(activePanel.id)} className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>

                  {/* 单格画面提示词（去掉多余外框，整洁直写） */}
                  <div className="space-y-2.5">
                    <label className="block">
                      <span className="mb-1 block font-semibold text-gray-700 dark:text-gray-200">{t('本格画面描述（输入 @ 可搜个人提示词库）')}</span>
                      <TagAutocompleteTextarea
                        rows={3}
                        libraryField={POSITIVE_LIBRARY_FIELD}
                        showTranslations={Boolean(activePanel.prompt.trim())}
                        promptLibraryActions="save"
                        value={activePanel.prompt}
                        onValueChange={val => onUpdatePanel(activePanel.id, p => ({ ...p, prompt: val }), false)}
                        placeholder={t('例如：close-up, rain outside classroom window, looking surprised...')}
                        className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block font-semibold text-gray-600 dark:text-gray-300">{t('本格补充负面词（可选）')}</span>
                      <TagAutocompleteTextarea
                        rows={2}
                        libraryField={NEGATIVE_LIBRARY_FIELD}
                        showTranslations={Boolean(activePanel.negativePrompt.trim())}
                        promptLibraryActions={false}
                        value={activePanel.negativePrompt}
                        onValueChange={val => onUpdatePanel(activePanel.id, p => ({ ...p, negativePrompt: val }), false)}
                        placeholder={t('仅对当前格生效的额外排除项')}
                        className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                      />
                    </label>
                  </div>

                  {/* 单格四类空间锚点（扁平分割线 + 克制同色中性按钮配微色点，彻底告别 5 色彩虹药丸和盒套盒） */}
                  <div className="space-y-2.5 border-t border-gray-200/80 pt-3.5 dark:border-gray-800">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-gray-800 dark:text-gray-100">{t('本格空间锚点')}</span>
                      <span className={`text-[11px] font-semibold ${guard.level === 'hard-exceeded' ? 'text-red-500' : guard.level === 'soft-warning' ? 'text-amber-500' : 'text-gray-500 dark:text-gray-400'}`}>
                        {guard.activeCount}/{COMIC_ANCHOR_SOFT_LIMIT}（上限 {COMIC_ANCHOR_HARD_LIMIT}）
                      </span>
                    </div>

                    {guard.level === 'soft-warning' && (
                      <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        {t('当前格锚点超过 12 个全精甜点区，人物可能自动缩为 Q 版以容纳所有元素。')}
                      </p>
                    )}
                    {guard.level === 'hard-exceeded' && (
                      <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
                        {t('单次生图硬上限为 24 个锚点，请停用或删除超出部分后再生成。')}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={activePanel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT}
                        onClick={() => addAnchorToPanel(activePanel, 'character')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200 dark:hover:border-indigo-400 dark:hover:text-indigo-300"
                      >
                        <span className="h-2 w-2 rounded-full bg-blue-500" aria-hidden="true" />
                        {t('角色')}
                      </button>
                      {hasAnyCharacterChains && (
                        <button
                          type="button"
                          disabled={activePanel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT}
                          onClick={() => setCharacterPickerOpen(open => !open)}
                          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-40 ${characterPickerOpen ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/50 dark:text-indigo-200' : 'border-gray-200/90 bg-white text-gray-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200 dark:hover:border-indigo-400 dark:hover:text-indigo-300'}`}
                        >
                          <UserPlus className="h-3 w-3 text-blue-500" /> {t('角色库')}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={activePanel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT}
                        onClick={() => addAnchorToPanel(activePanel, 'scene')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200 dark:hover:border-indigo-400 dark:hover:text-indigo-300"
                      >
                        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                        {t('空镜/道具')}
                      </button>
                      <button
                        type="button"
                        disabled={activePanel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT}
                        onClick={() => addAnchorToPanel(activePanel, 'bubble')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200 dark:hover:border-indigo-400 dark:hover:text-indigo-300"
                      >
                        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
                        {t('气泡点')}
                      </button>
                      <button
                        type="button"
                        disabled={activePanel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT}
                        onClick={() => addAnchorToPanel(activePanel, 'inset')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200 dark:hover:border-indigo-400 dark:hover:text-indigo-300"
                      >
                        <span className="h-2 w-2 rounded-full bg-purple-500" aria-hidden="true" />
                        {t('特写叠框')}
                      </button>
                    </div>

                    {characterPickerOpen && hasAnyCharacterChains && (
                      <div className="space-y-1.5 rounded-lg border border-blue-200 bg-white p-1.5 dark:border-blue-800 dark:bg-gray-900">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            value={charQuery}
                            onChange={e => setCharQuery(e.target.value)}
                            placeholder={t('搜索角色库…')}
                            className="w-full rounded border border-gray-200 bg-gray-50 py-1 pl-6 pr-2 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          />
                        </div>
                        <div className="max-h-36 space-y-1 overflow-y-auto">
                          {characterChains.map(char => (
                            <button
                              key={char.id}
                              type="button"
                              onClick={() => {
                                addAnchorToPanel(activePanel, 'character', {
                                  label: char.name,
                                  prompt: [char.basePrompt, char.variableValues?.subject].filter(Boolean).join(', '),
                                  negativePrompt: char.negativePrompt || '',
                                  sourceCharacterId: char.id,
                                });
                                setCharacterPickerOpen(false);
                                setCharQuery('');
                              }}
                              className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] hover:bg-blue-50 dark:hover:bg-blue-950/50"
                            >
                              <span className="truncate font-medium text-gray-800 dark:text-gray-100">{char.name}</span>
                              <span className="ml-2 flex-none text-blue-600 dark:text-blue-400">+ {t('加入')}</span>
                            </button>
                          ))}
                          {!characterChains.length && (
                            <div className="py-2 text-center text-[11px] text-gray-400">{t('没有匹配的角色')}</div>
                          )}
                        </div>
                      </div>
                    )}

                    {activePanel.anchors.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between text-[11px] text-gray-500">
                          <span>{t('可在此或主画布直接拖动圆点')}</span>
                          <label className="inline-flex cursor-pointer items-center gap-1">
                            <input
                              type="checkbox"
                              checked={activePanel.useCoords}
                              onChange={e => onUpdatePanel(activePanel.id, p => ({ ...p, useCoords: e.target.checked }), true)}
                              className="rounded accent-indigo-600"
                            />
                            <span>{t('启用坐标')}</span>
                          </label>
                        </div>
                        <div className="flex justify-center">
                          <div
                            ref={anchorStageRef}
                            style={{ width: Math.min(200, Math.round(120 * panelRatio)), aspectRatio: `${panelRatio}` }}
                            onPointerMove={e => { if (draggingAnchorRef.current) moveAnchorFromPointer(e, draggingAnchorRef.current); }}
                            onPointerUp={() => { if (draggingAnchorRef.current) { draggingAnchorRef.current = null; onUpdatePanel(activePanel.id, p => p, true); } }}
                            onPointerCancel={() => { draggingAnchorRef.current = null; }}
                            className="relative touch-none overflow-hidden rounded-lg border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900"
                          >
                            {activePanel.image?.url && (
                              <img src={activePanel.image.url} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40" />
                            )}
                            {activePanel.anchors.map((anchor, idx) => (
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

                        <div className="space-y-1.5">
                          {activePanel.anchors.map((anchor, idx) => (
                            <div
                              key={anchor.id}
                              onClick={() => setSelectedAnchorId(anchor.id)}
                              className={`rounded-lg border p-2 ${selectedAnchor?.id === anchor.id ? 'border-indigo-400 bg-white dark:border-indigo-500 dark:bg-gray-900' : 'border-gray-200 bg-white/70 dark:border-gray-700 dark:bg-gray-900/50'}`}
                            >
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={anchor.enabled}
                                  onChange={e => onUpdatePanel(activePanel.id, p => ({
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
                                  onChange={e => onUpdatePanel(activePanel.id, p => ({
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
                                    onUpdatePanel(activePanel.id, p => ({
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
                                onChange={e => onUpdatePanel(activePanel.id, p => ({
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
                                    onChange={e => onUpdatePanel(activePanel.id, p => ({
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
                                      onChange={e => onUpdatePanel(activePanel.id, p => ({
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

                  {/* 扁平折叠分割线：画格样式与图内构图微调（去外层套娃框） */}
                  <details open={Boolean(activePanel.image?.url)} className="border-t border-gray-200/80 pt-3.5 dark:border-gray-800">
                    <summary className="cursor-pointer select-none font-bold text-gray-700 dark:text-gray-200">
                      {t('画格样式与图内构图微调')}
                    </summary>
                    <div className="mt-2.5 space-y-2.5">
                      {activePanel.image?.url && (
                        <div className="space-y-1.5 border-b border-gray-200 pb-2.5 dark:border-gray-700">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-gray-500">{t('格内缩放')} {Math.round((activePanel.image.scale || 1) * 100)}%（Alt+拖平移）</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => onUpdatePanel(activePanel.id, p => p.image ? ({ ...p, image: { ...p.image, offsetX: 0, offsetY: 0, scale: 1 } }) : p, true)}
                                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                              >
                                <RotateCcw className="h-3 w-3" /> {t('重置')}
                              </button>
                              <button
                                type="button"
                                onClick={() => onUpdatePanel(activePanel.id, p => ({ ...p, image: undefined }), true)}
                                className="rounded px-1.5 py-0.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                              >
                                {t('清图')}
                              </button>
                            </div>
                          </div>
                          <input
                            type="range"
                            min={100}
                            max={250}
                            value={Math.round((activePanel.image.scale || 1) * 100)}
                            onChange={e => onUpdatePanel(activePanel.id, p => p.image ? ({ ...p, image: { ...p.image, scale: Number(e.target.value) / 100 } }) : p, false)}
                            className="w-full accent-indigo-600"
                          />
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-gray-500">{t('旋转')} {activePanel.rotation}°</span>
                          <input
                            type="range"
                            min={-45}
                            max={45}
                            value={activePanel.rotation}
                            onChange={e => onUpdatePanel(activePanel.id, p => ({ ...p, rotation: Number(e.target.value) }), false)}
                            className="w-full accent-indigo-600"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-gray-500">{t('边框')} {activePanel.borderWidth}px</span>
                          <input
                            type="range"
                            min={0}
                            max={12}
                            value={activePanel.borderWidth}
                            onChange={e => onUpdatePanel(activePanel.id, p => ({ ...p, borderWidth: Number(e.target.value) }), false)}
                            className="w-full accent-indigo-600"
                          />
                        </label>
                      </div>
                      <div className="flex items-center gap-4 text-[11px] text-gray-600 dark:text-gray-300">
                        <label className="flex items-center gap-1.5">
                          <span>{t('边框色')}</span>
                          <input
                            type="color"
                            aria-label={t('画格边框颜色')}
                            value={activePanel.borderColor || '#111827'}
                            onChange={e => onUpdatePanel(activePanel.id, p => ({ ...p, borderColor: e.target.value }), true)}
                            className="h-5 w-7 cursor-pointer rounded border border-gray-300 bg-transparent"
                          />
                        </label>
                        <label className="flex items-center gap-1.5">
                          <span>{t('底色')}</span>
                          <input
                            type="color"
                            aria-label={t('画格背景底色')}
                            value={activePanel.backgroundColor || '#f8fafc'}
                            onChange={e => onUpdatePanel(activePanel.id, p => ({ ...p, backgroundColor: e.target.value }), true)}
                            className="h-5 w-7 cursor-pointer rounded border border-gray-300 bg-transparent"
                          />
                        </label>
                      </div>
                    </div>
                  </details>
                </div>

                {/* 底部常驻「生成当前格」主操作栏 */}
                <div className="flex-none border-t border-gray-200 bg-white/95 p-3 dark:border-gray-800 dark:bg-gray-900/95">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                    <span>{t('自动免费尺寸')}：{resolution.width} × {resolution.height}</span>
                    <span>{formatGenerationCostLabel(estimatedCost, draft.v5Model)}</span>
                  </div>
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
                      onClick={() => onGeneratePanel(activePanel.id)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Wand2 className="h-4 w-4" />
                      <span>{t('生成当前格')}</span>
                      <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-medium">
                        {activePanel.name}
                      </span>
                    </button>
                  )}
                </div>
              </>
            );
          })() : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-gray-400">
              <p>{t('当前页面还没有分镜格')}</p>
              <button
                type="button"
                onClick={onQuickAddPanel}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-500"
              >
                + {t('新建分镜格')}
              </button>
            </div>
          )}
        </>
      )}

      {/* ==================== 标签 2：画风设定 ==================== */}
      {activeTab === 'style' && (
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3.5 pb-6 text-xs">
          {/* 优先放最高频的风格串载入与公共画风词 */}
          <div className="space-y-1.5">
            <span className="block font-semibold text-gray-700 dark:text-gray-200">{t('载入风格串画风')}</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={t('选择风格串')}
                aria-expanded={stylePickerOpen}
                onClick={() => setStylePickerOpen(open => !open)}
                className="flex min-w-0 flex-1 items-center justify-between rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-left text-xs text-gray-800 transition hover:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <span className="truncate">{boundStyleChain ? boundStyleChain.name : t('点击搜索并载入风格串…')}</span>
                <Search className="ml-2 h-3.5 w-3.5 flex-none text-gray-400" />
              </button>
              {boundStyleChain && (
                <button
                  type="button"
                  aria-label={t('解除风格串绑定')}
                  onClick={() => onUpdateDraft(cur => ({ ...cur, styleChainId: undefined }), true)}
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {stylePickerOpen && (
              <div className="space-y-1.5 rounded-xl border border-indigo-200 bg-white p-2 shadow-sm dark:border-indigo-800 dark:bg-gray-900">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    autoFocus
                    aria-label={t('搜索风格串')}
                    value={styleQuery}
                    onChange={e => setStyleQuery(e.target.value)}
                    placeholder={t('按名称、画师或标签筛选风格串…')}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-2 text-xs text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <div className="max-h-44 space-y-1 overflow-y-auto">
                  {styleChains.map(chain => (
                    <button
                      key={chain.id}
                      type="button"
                      onClick={() => {
                        onApplyStyleChain(chain);
                        setStylePickerOpen(false);
                        setStyleQuery('');
                      }}
                      className={`flex w-full flex-col rounded-lg px-2 py-1.5 text-left transition ${draft.styleChainId === chain.id ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                    >
                      <span className="truncate font-semibold text-gray-800 dark:text-gray-100">{chain.name}</span>
                      {chain.basePrompt && <span className="truncate text-[10px] text-gray-400">{chain.basePrompt}</span>}
                    </button>
                  ))}
                  {!styleChains.length && (
                    <div className="py-3 text-center text-[11px] text-gray-400">{t('没有找到匹配的风格串')}</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <label className="block">
            <span className="mb-1 block font-semibold text-gray-700 dark:text-gray-200">{t('全页公共画风提示词')}</span>
            <TagAutocompleteTextarea
              rows={3}
              libraryField={POSITIVE_LIBRARY_FIELD}
              showTranslations={Boolean(draft.globalBasePrompt.trim())}
              promptLibraryActions="save"
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
              libraryField={NEGATIVE_LIBRARY_FIELD}
              showTranslations={Boolean(draft.globalNegativePrompt.trim())}
              promptLibraryActions={false}
              value={draft.globalNegativePrompt}
              onValueChange={val => onUpdateDraft(cur => ({ ...cur, globalNegativePrompt: val }), false)}
              placeholder={t('全页公共排除词（自动过滤压制网点的冲突词）')}
              className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </label>

          {/* 紧凑版 V5 模型 / 色彩 / 对白策略（不再占半屏） */}
          <div className="space-y-2.5 rounded-xl border border-gray-200/80 bg-gray-50/60 p-2.5 dark:border-gray-800 dark:bg-gray-800/40">
            <div>
              <span className="mb-1 block text-[11px] font-semibold text-gray-500 dark:text-gray-400">{t('V5 模型档位（独立于实验室）')}</span>
              <div className="grid grid-cols-3 gap-1">
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
                      className={`rounded-lg border px-1.5 py-1.5 text-center text-[11px] font-semibold transition ${active ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
                    >
                      {shortModelLabel(model.id)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="mb-1 block text-[11px] font-semibold text-gray-500 dark:text-gray-400">{t('色彩模式')}</span>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { id: 'color', label: '全彩漫画' },
                  { id: 'monochrome', label: '黑白网点漫' },
                ] as Array<{ id: ComicColorMode; label: string }>).map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onUpdateDraft(cur => ({ ...cur, colorMode: item.id }), true)}
                    className={`rounded-lg border px-2 py-1.5 font-semibold transition ${draft.colorMode === item.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
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

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-gray-500 dark:text-gray-400">{t('对白与气泡策略')}</span>
              <select
                value={draft.dialogueMode}
                onChange={e => onUpdateDraft(cur => ({ ...cur, dialogueMode: e.target.value as ComicDialogueMode }), true)}
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="clean-vector">{t('无气泡纯画面 + 画布矢量气泡')}</option>
                <option value="empty-bubble">{t('空白气泡直出 + 后期嵌字')}</option>
                <option value="ai-text">{t('AI 锚点直出短字 / 拟声词')}</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {/* ==================== 标签 3：嵌字与图层 ==================== */}
      {activeTab === 'layers' && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3.5 pb-6 text-xs">
          {/* 当前选中的气泡 / 文字 / 贴纸属性编辑 */}
          {selectedBubble && (
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
              <div className="grid grid-cols-2 gap-1.5">
                {BUBBLE_SHAPES.map(shape => (
                  <button
                    key={shape.id}
                    type="button"
                    onClick={() => onUpdateBubble(selectedBubble.id, i => ({ ...i, shape: shape.id }), true)}
                    className={`rounded-lg border px-2 py-1 font-medium ${selectedBubble.shape === shape.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
                  >
                    {t(shape.label)}
                  </button>
                ))}
              </div>
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
              <label className="block">
                <span className="mb-1 block text-gray-500">{t('字号')} {selectedBubble.fontSize}px</span>
                <input type="range" min={12} max={56} value={selectedBubble.fontSize} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, fontSize: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
              </label>
            </div>
          )}

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
              <label className="block">
                <span className="mb-1 block text-gray-500">{t('字号')} {selectedText.fontSize}px</span>
                <input type="range" min={14} max={96} value={selectedText.fontSize} onChange={e => onUpdateText(selectedText.id, i => ({ ...i, fontSize: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
              </label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5"><span>{t('字色')}</span><input type="color" value={selectedText.color} onChange={e => onUpdateText(selectedText.id, i => ({ ...i, color: e.target.value }), true)} className="h-5 w-7 rounded border" /></label>
                <label className="flex items-center gap-1.5"><span>{t('描边')}</span><input type="color" value={selectedText.strokeColor || '#ffffff'} onChange={e => onUpdateText(selectedText.id, i => ({ ...i, strokeColor: e.target.value }), true)} className="h-5 w-7 rounded border" /></label>
              </div>
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
              <div className="grid grid-cols-2 gap-1">
                {STICKER_KINDS.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onUpdateSticker(selectedSticker.id, s => ({ ...s, kind: item.id }), true)}
                    className={`rounded-lg border px-2 py-1 font-medium ${selectedSticker.kind === item.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}
                  >
                    {t(item.label)}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-gray-500">{t('尺寸')} {Math.round(selectedSticker.width * 100)}%</span>
                  <input type="range" min={6} max={90} value={Math.round(selectedSticker.width * 100)} onChange={e => { const v = Number(e.target.value) / 100; onUpdateSticker(selectedSticker.id, s => ({ ...s, width: v, height: v }), false); }} className="w-full accent-indigo-600" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-gray-500">{t('旋转')} {selectedSticker.rotation}°</span>
                  <input type="range" min={-180} max={180} value={selectedSticker.rotation} onChange={e => onUpdateSticker(selectedSticker.id, s => ({ ...s, rotation: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
                </label>
              </div>
              <label className="flex items-center gap-2">
                <span>{t('颜色')}</span>
                <input type="color" value={selectedSticker.color} onChange={e => onUpdateSticker(selectedSticker.id, s => ({ ...s, color: e.target.value }), true)} className="h-5 w-7 rounded border" />
              </label>
            </div>
          )}

          {/* 本页气泡 / 文字 / 贴纸大纲列表 */}
          <div className="space-y-1.5">
            <div className="font-bold text-gray-700 dark:text-gray-200">{t('页面嵌字与贴纸')}</div>
            {overlayCount === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-200 p-3 text-center text-[11px] text-gray-400 dark:border-gray-700">
                {t('使用画布左侧工具坞添加气泡、文字或贴纸后，将在此集中管理')}
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
                    <MessageCircle className="h-3.5 w-3.5 flex-none text-amber-500" />
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
                    <Sticker className="h-3.5 w-3.5 flex-none text-purple-500" />
                    <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-100">
                      {t(STICKER_KINDS.find(k => k.id === st.kind)?.label || st.kind)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 常驻 4 大图层管理 */}
          <div className="space-y-1.5 border-t border-gray-200 pt-3 dark:border-gray-800">
            <div className="font-bold text-gray-700 dark:text-gray-200">{t('图层顺序（上层优先显示）')}</div>
            <div className="space-y-1.5">
              {orderedLayers.map((layerId, index) => {
                const layer = draft.layers[layerId];
                return (
                  <div
                    key={layerId}
                    className="flex items-center justify-between gap-1 rounded-lg border border-gray-200/80 bg-gray-50/80 px-2.5 py-1.5 dark:border-gray-700 dark:bg-gray-800/80"
                  >
                    <span className={`min-w-0 flex-1 truncate font-medium ${layer.visible ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 line-through'}`}>
                      {t(LAYER_LABELS[layerId])}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button type="button" aria-label={t('上移图层')} disabled={index === 0} onClick={() => onMoveLayerOrder(layerId, 'up')} className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-gray-700"><ArrowUp className="h-3 w-3" /></button>
                      <button type="button" aria-label={t('下移图层')} disabled={index === orderedLayers.length - 1} onClick={() => onMoveLayerOrder(layerId, 'down')} className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-gray-700"><ArrowDown className="h-3 w-3" /></button>
                      <button type="button" aria-label={layer.locked ? t('解锁图层') : t('锁定图层')} onClick={() => onToggleLayerLocked(layerId)} className={`rounded p-1 ${layer.locked ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>{layer.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}</button>
                      <button type="button" aria-label={layer.visible ? t('隐藏图层') : t('显示图层')} onClick={() => onToggleLayerVisible(layerId)} className={`rounded p-1 ${layer.visible ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>{layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <HistoryImagePicker
        open={historyPickerOpen}
        allowImportParams={false}
        onClose={() => setHistoryPickerOpen(false)}
        onSelect={item => handleSelectHistoryImage(item)}
      />
    </aside>
  );
};
