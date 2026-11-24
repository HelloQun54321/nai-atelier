import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Dices,
  Download,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  MessageCircle,
  Palette,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Type,
  Upload,
  UserPlus,
  Wand2,
  X,
} from 'lucide-react';
import type { LocalGenItem, PromptChain } from '../../types';
import { t, useLanguage } from '../../services/i18n';
import { formatGenerationCostLabel } from '../../services/anlasBudget';
import { searchCharacterDictionary, type CharacterDictionaryEntry } from '../../services/tagDictionary';
import { COMIC_BUBBLE_SHAPES, COMIC_FONT_PRESETS } from '../../services/comic/comicArtwork';
import type { ComicFontCatalogState } from '../../services/comic/comicFonts';
import { ComicBubbleShapeIcon } from './ComicBubbleShapeIcon';
import {
  clampAnchorCoord,
  getPanelBoundingBox,
  getPanelTargetResolution,
} from '../../services/comic/comicGeometry';
import {
  COMIC_ANCHOR_HARD_LIMIT,
  COMIC_ANCHOR_SOFT_LIMIT,
  COMIC_V5_MODELS,
  encodeDanbooruCastId,
  evaluateAnchorGuard,
  parseDanbooruCastId,
} from '../../services/comic/comicPromptBuilder';
import type { ComicAiZonePlan } from '../../services/comic/comicAiPageEngine';
import { resolveLayoutLockConfig } from '../../services/comic/comicLayoutTemplateRenderer';
import {
  buildStyleWarningTagMap,
  detectStyleCharacterTags,
  inspectStyleCharacterTags,
  type StyleCharacterHit,
} from '../../services/comic/comicStyleGuard';
import type { ComicBubbleCandidate } from '../../services/comic/comicBubbleDetector';
import type { ComicInpaintDraft } from '../../services/comic/comicInpaintEngine';
import type {
  ComicAiGuidePanel,
  ComicAiPagePlan,
  ComicAnchor,
  ComicAnchorKind,
  ComicBubbleItem,
  ComicBubbleShape,
  ComicColorMode,
  ComicCreationMode,
  ComicDialogueMode,
  ComicFontFamily,
  ComicImageLayerItem,
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
import { PromptCopyButton } from '../chain/PresetSourceBadges';
import type { PromptTidyOptions } from '../PromptTidyActions';

export type ComicInspectorTab = 'style' | 'panel' | 'layers';

interface ComicInspectorProps {
  draft: ComicPageDraft;
  aiZonePlan: ComicAiZonePlan;
  inpaintDraft: ComicInpaintDraft | null;
  bubbleCandidates: ComicBubbleCandidate[] | null;
  preserveGuideLayout: boolean;
  comparingOriginalAiImage: boolean;
  activeTab: ComicInspectorTab;
  selection: ComicSelection;
  chains: PromptChain[];
  generatingPanelId: string | null;
  batchGeneratingManual: boolean;
  batchProgressText: string;
  lastGeneratedSeed?: number;
  planningAiStoryboard: boolean;
  generatingAiPage: boolean;
  detectingBubbles: boolean;
  inpaintingAiPage: boolean;
  aiGenerationStageText: string;
  generationStageText: string;
  estimatedCost: number;
  aiEstimatedCost: number;
  notify?: (message: string, type?: 'success' | 'error') => void;
  onSelectTab: (tab: ComicInspectorTab) => void;
  onChangeMode: (mode: ComicCreationMode) => void;
  onSelect: (selection: ComicSelection) => void;
  onQuickAddPanel: () => void;
  onUpdateDraft: (updater: (current: ComicPageDraft) => ComicPageDraft, commit?: boolean) => void;
  onUpdateAiPage: (updater: (aiPage: ComicAiPagePlan) => ComicAiPagePlan, commit?: boolean) => void;
  onTogglePreserveGuideLayout: (preserve: boolean) => void;
  onPlanAiStoryboard: () => void;
  onInitAiFromTemplate: () => void;
  onConvertBubbleAnchorsToVector: () => void;
  onAutoDetectWhiteBubbles: () => void;
  onToggleBubbleCandidate: (id: string) => void;
  onEditBubbleCandidateText: (id: string, text: string) => void;
  onBulkSelectBubbleCandidates: (mode: 'all' | 'with-text' | 'none') => void;
  onConfirmBubbleCandidates: () => void;
  onCancelBubbleCandidates: () => void;
  onToggleCompareOriginalAiImage: () => void;
  onRestoreOriginalAiImage: () => void;
  onOpenInpaint: (guidePanel?: ComicAiGuidePanel) => void;
  onCloseInpaint: () => void;
  onUpdateInpaintDraft: (updater: (current: ComicInpaintDraft) => ComicInpaintDraft) => void;
  onRunInpaint: () => void;
  onGenerateAiPage: () => void;
  onGenerateAiZone: (zoneIndex: 0 | 1) => void;
  onRestitchAiZones: () => void;
  onApplyStyleChain: (chain: PromptChain) => void;
  onUpdatePanel: (panelId: string, updater: (panel: ComicPanel) => ComicPanel, commit?: boolean) => void;
  onDuplicatePanel: (panelId: string) => void;
  onDeletePanel: (panelId: string) => void;
  onBringPanelOrder: (panelId: string, mode: 'front' | 'back') => void;
  onTogglePanelOverlay?: (panelId: string) => void;
  onTogglePanelBorderless?: (panelId: string) => void;
  onUploadImageToPanel?: (panelId: string, file: File) => void;
  panelHistoryRequestToken?: number;
  onGeneratePanel: (panelId: string) => void;
  onGenerateAllPanels: () => void;
  onCancelGeneration: () => void;
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
  onConvertSingleAnchorBubbleToVector: (target: { kind: 'ai-anchor'; anchorId: string } | { kind: 'panel-anchor'; panelId: string; anchorId: string }) => void;
  fontCatalog: ComicFontCatalogState;
  downloadingFontId: string | null;
  onDownloadFont: (id: string) => void;
  onUploadCustomFont: (file: File) => void;
  onDeleteFont: (id: string) => void;
}

/** 复用 Atelier 实验室同款提示词框：自带提示词库取用/保存、整理校对、橡皮擦清空/撤销、复制与常驻 Tag 翻译权重栏。 */
const ComicPromptField: React.FC<{
  label: string;
  ariaLabel?: string;
  value: string;
  placeholder: string;
  rows?: number;
  compact?: boolean;
  libraryField?: React.ComponentProps<typeof TagAutocompleteTextarea>['libraryField'];
  promptLibraryActions?: boolean | 'save';
  promptTidy?: PromptTidyOptions;
  warningTags?: ReadonlyMap<string, string>;
  onChange: (next: string) => void;
  onCopy?: (value: string, label: string) => void;
}> = ({
  label,
  ariaLabel,
  value,
  placeholder,
  rows = 3,
  compact = false,
  libraryField,
  promptLibraryActions = true,
  promptTidy,
  warningTags,
  onChange,
  onCopy,
}) => {
  const clearSlot = useRef<HTMLSpanElement>(null);
  return (
    <div className="space-y-1">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className={`min-w-0 truncate font-semibold ${compact ? 'text-[11px] text-gray-600 dark:text-gray-300' : 'text-xs text-gray-700 dark:text-gray-200'}`}>
          {label}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <span ref={clearSlot} className="inline-flex items-center gap-0.5" />
          {onCopy && (
            <PromptCopyButton
              onClick={() => onCopy(value, label)}
              title={t('复制{0}', [label])}
            />
          )}
        </div>
      </div>
      <TagAutocompleteTextarea
        rows={rows}
        aria-label={ariaLabel || label}
        clearActionSlotRef={clearSlot}
        libraryField={libraryField}
        promptLibraryActions={promptLibraryActions}
        promptTidy={promptTidy}
        warningTags={warningTags}
        autoHeightMax={compact ? '96px' : '128px'}
        compactToolbar
        tagAssistEnabled
        value={value}
        onValueChange={onChange}
        placeholder={placeholder}
        className={`w-full rounded-lg border border-gray-200 bg-gray-50/70 font-mono text-gray-900 outline-none focus:border-indigo-400 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 ${compact ? 'p-1.5 text-[11px]' : 'p-2 text-xs'}`}
      />
    </div>
  );
};

const ANCHOR_META: Record<ComicAnchorKind, { label: string; dotClass: string; badgeClass: string }> = {
  character: { label: '角色', dotClass: 'bg-blue-600', badgeClass: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' },
  scene: { label: '场景/道具', dotClass: 'bg-emerald-600', badgeClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
  bubble: { label: '气泡点', dotClass: 'bg-amber-600', badgeClass: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
  inset: { label: '特写叠框', dotClass: 'bg-purple-600', badgeClass: 'bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300' },
};

const STICKER_KINDS: Array<{ id: ComicStickerKind; label: string }> = [
  { id: 'speedlines', label: '速度线' },
  { id: 'sweat', label: '汗滴' },
  { id: 'anger', label: '青筋' },
  { id: 'sparkle', label: '星芒' },
  { id: 'exclamation', label: '惊叹 !' },
  { id: 'question', label: '问号 ?' },
  { id: 'shock', label: '震惊线' },
  { id: 'heart', label: '爱心' },
];

const CORE_BUBBLE_SHAPE_IDS: ReadonlyArray<ComicBubbleShape> = ['soft', 'oval', 'shout', 'thought'];

const ChainThumb: React.FC<{ image?: string; kind: 'style' | 'character'; sizeClass?: string }> = ({
  image,
  kind,
  sizeClass = 'h-8 w-8',
}) => {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        loading="lazy"
        className={`${sizeClass} flex-none rounded-md border border-gray-200/80 object-cover dark:border-gray-700`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${sizeClass} flex flex-none items-center justify-center rounded-md border border-gray-200/80 bg-gray-100/90 text-gray-400 dark:border-gray-700 dark:bg-gray-800`}
    >
      {kind === 'style' ? <Palette className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
    </span>
  );
};

const GutterStylePreviewIcon: React.FC<{ flashback?: boolean }> = ({ flashback = false }) => (
  <svg viewBox="0 0 28 20" aria-hidden="true" className="h-5 w-7 flex-none rounded border border-gray-300/80 dark:border-gray-600">
    <rect width="28" height="20" fill={flashback ? '#111827' : '#ffffff'} />
    <rect x="2.5" y="2.5" width="23" height="6.5" rx="0.8" fill={flashback ? '#4b5563' : '#e5e7eb'} stroke={flashback ? '#ffffff' : '#111827'} strokeWidth="1.2" />
    <rect x="2.5" y="11" width="10.5" height="6.5" rx="0.8" fill={flashback ? '#4b5563' : '#e5e7eb'} stroke={flashback ? '#ffffff' : '#111827'} strokeWidth="1.2" />
    <rect x="15" y="11" width="10.5" height="6.5" rx="0.8" fill={flashback ? '#4b5563' : '#e5e7eb'} stroke={flashback ? '#ffffff' : '#111827'} strokeWidth="1.2" />
  </svg>
);

const ComicStickerIcon: React.FC<{ kind: ComicStickerKind; className?: string }> = ({ kind, className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    {kind === 'speedlines' && (
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(deg => {
          const rad = (deg * Math.PI) / 180;
          return (
            <line
              key={deg}
              x1={12 + Math.cos(rad) * 5.2}
              y1={12 + Math.sin(rad) * 5.2}
              x2={12 + Math.cos(rad) * 10.5}
              y2={12 + Math.sin(rad) * 10.5}
            />
          );
        })}
      </g>
    )}
    {kind === 'sweat' && (
      <g>
        <path d="M12 3C16.5 9.2 17.5 19 12 19C6.5 19 7.5 9.2 12 3Z" fill="#dbeafe" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M10.2 11.2C9.4 13 9.8 15.2 11.3 15.7" fill="none" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    )}
    {kind === 'anger' && (
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M9.5 4.5Q9.5 9.5 4.5 9.5" />
        <path d="M14.5 4.5Q14.5 9.5 19.5 9.5" />
        <path d="M9.5 19.5Q9.5 14.5 4.5 14.5" />
        <path d="M14.5 19.5Q14.5 14.5 19.5 14.5" />
      </g>
    )}
    {kind === 'sparkle' && (
      <g fill="currentColor">
        <path d="M12 2Q13.2 10.8 22 12Q13.2 13.2 12 22Q10.8 13.2 2 12Q10.8 10.8 12 2Z" />
        <circle cx="18.2" cy="5.8" r="1.4" />
      </g>
    )}
    {kind === 'exclamation' && (
      <text x="12" y="13.5" textAnchor="middle" dominantBaseline="central" fontSize="18" fontWeight="900" fill="currentColor">!</text>
    )}
    {kind === 'question' && (
      <text x="12" y="13.5" textAnchor="middle" dominantBaseline="central" fontSize="18" fontWeight="900" fill="currentColor">?</text>
    )}
    {kind === 'shock' && (
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        {[5, 8.5, 12, 15.5, 19].map((x, idx) => (
          <line key={x} x1={x} y1={idx % 2 === 0 ? 4.5 : 3} x2={x + (idx % 2 === 0 ? 0.5 : -0.5)} y2={idx % 2 === 0 ? 19.5 : 21} />
        ))}
      </g>
    )}
    {kind === 'heart' && (
      <path d="M12 20C5.5 15.2 4 8.2 8.2 6C10.4 4.8 12 6.8 12 8.2C12 6.8 13.6 4.8 15.8 6C20 8.2 18.5 15.2 12 20Z" fill="currentColor" />
    )}
  </svg>
);

const AnchorCharacterPicker: React.FC<{
  query: string;
  onChangeQuery: (q: string) => void;
  characterChains: PromptChain[];
  dictResults: CharacterDictionaryEntry[];
  dictLoading: boolean;
  onAddBlank: () => void;
  onAddFromChain: (char: PromptChain) => void;
  onAddFromDict: (entry: CharacterDictionaryEntry) => void;
}> = ({
  query,
  onChangeQuery,
  characterChains,
  dictResults,
  dictLoading,
  onAddBlank,
  onAddFromChain,
  onAddFromDict,
}) => (
  <div className="space-y-1.5 rounded-lg border border-blue-200 bg-white p-1.5 dark:border-blue-800 dark:bg-gray-900">
    <button
      type="button"
      onClick={onAddBlank}
      className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-blue-300 bg-blue-50/70 px-2 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
    >
      <Plus className="h-3 w-3" />
      <span>{t('新建空白角色')}</span>
    </button>
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
      <input
        type="text"
        value={query}
        onChange={e => onChangeQuery(e.target.value)}
        placeholder={t('搜自定义角色库或输入中/英文搜 Danbooru 角色…')}
        className="w-full rounded border border-gray-200 bg-gray-50 py-1 pl-6 pr-2 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
      />
    </div>
    <div className="max-h-44 space-y-1 overflow-y-auto">
      {characterChains.length > 0 && (
        <div className="space-y-0.5">
          <div className="px-1.5 text-[10px] font-semibold text-gray-400">{t('我的角色库')}</div>
          {characterChains.map(char => (
            <button
              key={char.id}
              type="button"
              onClick={() => onAddFromChain(char)}
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] hover:bg-blue-50 dark:hover:bg-blue-950/50"
            >
              <ChainThumb image={char.previewImage} kind="character" sizeClass="h-6 w-6" />
              <span className="min-w-0 flex-1 truncate font-medium text-gray-800 dark:text-gray-100">{char.name}</span>
              <span className="flex-none text-blue-600 dark:text-blue-400">+ {t('加入')}</span>
            </button>
          ))}
        </div>
      )}
      <div className="space-y-0.5">
        <div className="flex items-center justify-between px-1.5 text-[10px] font-semibold text-gray-400">
          <span>{t('Danbooru 词库角色')}</span>
          {dictLoading && <InlineSpinner className="h-2.5 w-2.5" />}
        </div>
        {!query.trim() ? null : dictResults.length > 0 ? (
          dictResults.map(entry => (
            <button
              key={entry.name}
              type="button"
              onClick={() => onAddFromDict(entry)}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-blue-50 dark:hover:bg-blue-950/50"
            >
              <span className="min-w-0 flex-1 truncate font-medium text-gray-800 dark:text-gray-100">{entry.chinese || entry.name}</span>
              <span className="max-w-28 truncate font-mono text-[10px] text-gray-400">{entry.name}</span>
              <span className="flex-none text-blue-600 dark:text-blue-400">+ {t('加入')}</span>
            </button>
          ))
        ) : !dictLoading ? (
          <p className="px-2 py-1 text-[10px] text-gray-400">{t('词库中未找到匹配角色')}</p>
        ) : null}
      </div>
    </div>
  </div>
);

const BubbleAnchorEditor: React.FC<{
  anchor: ComicAnchor;
  dialogueMode: ComicDialogueMode;
  onChangeText: (text: string) => void;
  onChangeShape: (shape: ComicBubbleShape) => void;
  onConvert: () => void;
}> = ({
  anchor,
  dialogueMode,
  onChangeText,
  onChangeShape,
  onConvert,
}) => (
  <div className="space-y-1.5 rounded-lg border border-amber-200/80 bg-amber-50/40 p-2 dark:border-amber-900/50 dark:bg-amber-950/20">
    <div className="flex items-center justify-between gap-1">
      <span className="text-[10px] font-medium text-amber-800 dark:text-amber-200">
        {t('画布气泡预览')}
      </span>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          onConvert();
        }}
        className="flex-none rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-amber-600"
      >
        {t('转正式气泡')}
      </button>
    </div>
    <input
      type="text"
      value={anchor.bubbleText || ''}
      onClick={e => e.stopPropagation()}
      onChange={e => onChangeText(e.target.value)}
      placeholder={dialogueMode === 'ai-text' ? t('短台词（直出）') : t('台词内容（画布上双击气泡也可直接编辑）')}
      className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
    />
    <div className="grid grid-cols-4 gap-1">
      {COMIC_BUBBLE_SHAPES.slice(0, 4).map(shape => (
        <button
          key={shape.id}
          type="button"
          title={t(shape.label)}
          aria-pressed={(anchor.bubbleShape || 'soft') === shape.id}
          onClick={e => {
            e.stopPropagation();
            onChangeShape(shape.id);
          }}
          className={`flex flex-col items-center rounded border px-1 py-0.5 text-[9px] outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500 ${(anchor.bubbleShape || 'soft') === shape.id ? 'border-amber-500 bg-white font-semibold text-amber-700 shadow-xs dark:border-amber-400 dark:bg-amber-950/70 dark:text-amber-100' : 'border-transparent bg-white/80 text-gray-700 hover:border-amber-300 dark:bg-slate-800/80 dark:text-slate-100 dark:hover:border-amber-500/60'}`}
        >
          <ComicBubbleShapeIcon shape={shape.id} className="h-4 w-6" />
          <span className="w-full truncate text-center">{t(shape.label)}</span>
        </button>
      ))}
    </div>
  </div>
);

const POSITIVE_LIBRARY_FIELD = { negative: false } as const;
const NEGATIVE_LIBRARY_FIELD = { negative: true } as const;

const shortModelLabel = (id: ComicV5ModelId): string => {
  if (id === 'nai-diffusion-5-full-medium') return 'Medium (14步)';
  if (id === 'nai-diffusion-5-curated') return 'Curated';
  return 'High (23步)';
};

export const ComicInspector: React.FC<ComicInspectorProps> = ({
  draft,
  aiZonePlan,
  inpaintDraft,
  bubbleCandidates,
  preserveGuideLayout,
  comparingOriginalAiImage,
  activeTab,
  selection,
  chains,
  generatingPanelId,
  batchGeneratingManual,
  batchProgressText,
  lastGeneratedSeed,
  planningAiStoryboard,
  generatingAiPage,
  detectingBubbles,
  inpaintingAiPage,
  aiGenerationStageText,
  generationStageText,
  estimatedCost,
  aiEstimatedCost,
  notify,
  onSelectTab,
  onChangeMode,
  onSelect,
  onQuickAddPanel,
  onUpdateDraft,
  onUpdateAiPage,
  onTogglePreserveGuideLayout,
  onPlanAiStoryboard,
  onConvertBubbleAnchorsToVector,
  onAutoDetectWhiteBubbles,
  onToggleBubbleCandidate,
  onEditBubbleCandidateText,
  onBulkSelectBubbleCandidates,
  onConfirmBubbleCandidates,
  onCancelBubbleCandidates,
  onToggleCompareOriginalAiImage,
  onRestoreOriginalAiImage,
  onOpenInpaint,
  onCloseInpaint,
  onUpdateInpaintDraft,
  onRunInpaint,
  onGenerateAiPage,
  onGenerateAiZone,
  onRestitchAiZones,
  onApplyStyleChain,
  onUpdatePanel,
  onDeletePanel,
  onUploadImageToPanel,
  panelHistoryRequestToken,
  onGeneratePanel,
  onGenerateAllPanels,
  onCancelGeneration,
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
  onConvertSingleAnchorBubbleToVector,
  fontCatalog,
  downloadingFontId,
  onDownloadFont,
  onUploadCustomFont,
  onDeleteFont,
  onTogglePanelOverlay,
  onTogglePanelBorderless,
}) => {
  useLanguage();
  const copyPrompt = (value: string, label: string) => {
    if (!value.trim()) {
      notify?.(t('{0}为空，无可复制内容', [label]), 'error');
      return;
    }
    void navigator.clipboard?.writeText(value);
    notify?.(t('已复制{0}', [label]), 'success');
  };
  const promptTidyOption = useMemo<PromptTidyOptions | undefined>(
    () => (notify ? { notify } : undefined),
    [notify],
  );
  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [castPickerOpen, setCastPickerOpen] = useState(false);
  const [castQuery, setCastQuery] = useState('');
  const [castDictResults, setCastDictResults] = useState<CharacterDictionaryEntry[]>([]);
  const [castDictLoading, setCastDictLoading] = useState(false);
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [styleQuery, setStyleQuery] = useState('');
  const [charQuery, setCharQuery] = useState('');
  const [charDictResults, setCharDictResults] = useState<CharacterDictionaryEntry[]>([]);
  const [charDictLoading, setCharDictLoading] = useState(false);
  const [fontManagerOpen, setFontManagerOpen] = useState(false);
  const [showAllBubbleShapes, setShowAllBubbleShapes] = useState(false);
  const fontFileInputRef = useRef<HTMLInputElement>(null);
  const panelFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (panelHistoryRequestToken && panelHistoryRequestToken > 0) {
      setHistoryPickerOpen(true);
    }
  }, [panelHistoryRequestToken]);
  const [selectedAnchorId, setSelectedAnchorId] = useState<string>('');
  const anchorStageRef = useRef<HTMLDivElement>(null);
  const draggingAnchorRef = useRef<string | null>(null);
  const syncStyleHits = useMemo(() => detectStyleCharacterTags(draft.globalBasePrompt), [draft.globalBasePrompt]);
  const [dictStyleHits, setDictStyleHits] = useState<{ prompt: string; hits: StyleCharacterHit[] } | null>(null);

  useEffect(() => {
    const prompt = draft.globalBasePrompt;
    if (!prompt.trim()) {
      setDictStyleHits(null);
      return;
    }
    let cancelled = false;
    void inspectStyleCharacterTags(prompt).then(hits => {
      if (!cancelled) setDictStyleHits({ prompt, hits });
    });
    return () => { cancelled = true; };
  }, [draft.globalBasePrompt]);

  const styleCharacterHits = dictStyleHits?.prompt === draft.globalBasePrompt ? dictStyleHits.hits : syncStyleHits;
  const styleWarningMap = useMemo(() => buildStyleWarningTagMap(styleCharacterHits), [styleCharacterHits]);

  // 搜索 Danbooru 角色词库（AI 整页出场角色）
  useEffect(() => {
    const q = castQuery.trim();
    if (!castPickerOpen || !q) {
      setCastDictResults([]);
      setCastDictLoading(false);
      return;
    }
    let cancelled = false;
    setCastDictLoading(true);
    const timer = window.setTimeout(() => {
      void searchCharacterDictionary(q, 24)
        .then(items => { if (!cancelled) setCastDictResults(items); })
        .catch(() => { if (!cancelled) setCastDictResults([]); })
        .finally(() => { if (!cancelled) setCastDictLoading(false); });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [castPickerOpen, castQuery]);

  // 搜索 Danbooru 角色词库（单格 / 整页锚点角色选择）
  useEffect(() => {
    const q = charQuery.trim();
    if (!characterPickerOpen || !q) {
      setCharDictResults([]);
      setCharDictLoading(false);
      return;
    }
    let cancelled = false;
    setCharDictLoading(true);
    const timer = window.setTimeout(() => {
      void searchCharacterDictionary(q, 24)
        .then(items => { if (!cancelled) setCharDictResults(items); })
        .catch(() => { if (!cancelled) setCharDictResults([]); })
        .finally(() => { if (!cancelled) setCharDictLoading(false); });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [characterPickerOpen, charQuery]);

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

  // 分镜生图标签默认锚定当前选中的格，若当前未选格则自动显示第 1 格
  const activePanel = (selection?.kind === 'panel'
    ? draft.panels.find(item => item.id === selection.id)
    : selection?.kind === 'panel-anchor'
      ? draft.panels.find(item => item.id === selection.panelId)
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
  const selectedImageLayer = selection?.kind === 'image'
    ? (draft.imageLayers || []).find(item => item.id === selection.id)
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
      ...(kind === 'bubble' ? { bubbleShape: 'soft' as ComicBubbleShape, bubbleText: '', bubbleWritingMode: 'vertical' as const } : {}),
      ...(seed?.sourceCharacterId ? { sourceCharacterId: seed.sourceCharacterId } : {}),
    };
    onUpdatePanel(panel.id, current => ({ ...current, anchors: [...current.anchors, next] }), true);
    setSelectedAnchorId(next.id);
    if (kind === 'bubble') {
      onSelect({ kind: 'panel-anchor', panelId: panel.id, id: next.id });
    }
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
      ...(kind === 'bubble' ? { bubbleShape: 'soft' as ComicBubbleShape, bubbleText: '', bubbleWritingMode: 'vertical' as const } : {}),
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
    <aside className="appearance-panel flex h-full w-full flex-col border-l border-gray-200 bg-white/90 dark:border-gray-800 dark:bg-gray-900/90">
      {/* 顶部顺次三步导航：1 画风 → 2 分镜 → 3 嵌字（贴合真实创作顺序，取消独立 PS 图层主标签） */}
      <div
        role="tablist"
        aria-label={t('漫画创作步骤')}
        className="grid flex-none grid-cols-3 border-b border-gray-200/80 bg-transparent dark:border-gray-800/80"
      >
        {([
          { id: 'style', step: 1, label: t('画风设定'), icon: Palette },
          { id: 'panel', step: 2, label: t('分镜生图'), icon: draft.creationMode === 'ai-page' ? Sparkles : Wand2 },
          { id: 'layers', step: 3, label: t('气泡嵌字'), badge: overlayCount > 0 ? overlayCount : undefined, icon: MessageCircle },
        ] as Array<{ id: ComicInspectorTab; step: number; label: string; badge?: number; icon: React.ElementType }>).map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectTab(tab.id)}
              className={`relative inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap px-2 text-xs font-semibold transition ${active ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200'}`}
            >
              <span
                aria-hidden="true"
                className={`inline-flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold leading-none ${active ? 'bg-indigo-600 text-white' : 'bg-gray-200/90 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}
              >
                {tab.step}
              </span>
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold leading-4 ${active ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-200' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                  {tab.badge}
                </span>
              )}
              {active && <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-indigo-500" />}
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

      {/* 步骤 2 顶部的生成方式轻切换（同时保留手动逐格与 AI 整页） */}
      {activeTab === 'panel' && (
        <div className="flex flex-none items-center justify-between gap-2 border-b border-gray-200/80 bg-gray-50/50 px-3.5 py-2 dark:border-gray-800/80 dark:bg-gray-950/30">
          <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{t('生图方式')}</span>
          <div
            className="inline-flex flex-none rounded-lg border border-gray-200/80 bg-gray-100/90 p-0.5 dark:border-gray-700/80 dark:bg-gray-800/90"
            role="group"
            aria-label={t('创作模式')}
          >
            <button
              type="button"
              aria-pressed={draft.creationMode === 'manual'}
              onClick={() => onChangeMode('manual')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${draft.creationMode === 'manual' ? 'bg-white text-indigo-600 shadow-xs dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              {t('手动逐格')}
            </button>
            <button
              type="button"
              aria-pressed={draft.creationMode === 'ai-page'}
              onClick={() => onChangeMode('ai-page')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition ${draft.creationMode === 'ai-page' ? 'bg-white text-indigo-600 shadow-xs dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
              title={t('AI 整页锚点一图成型（含自动双区拼合）')}
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              <span>{t('AI 整页')}</span>
            </button>
          </div>
        </div>
      )}

      {/* ==================== 标签 1A：AI 整页锚点编排工作台 ==================== */}
      {activeTab === 'panel' && draft.creationMode === 'ai-page' && (() => {
        const aiPage = draft.aiPage;
        const selectedAiAnchor = selection?.kind === 'ai-anchor'
          ? aiPage.anchors.find(a => a.id === selection.id)
          : undefined;
        const selectedGuideIndex = selection?.kind === 'guide-panel'
          ? aiPage.guidePanels.findIndex(g => g.id === selection.id)
          : -1;
        const selectedGuide = selectedGuideIndex >= 0 ? aiPage.guidePanels[selectedGuideIndex] : undefined;
        const bubbleAnchorCount = aiPage.anchors.filter(a => a.enabled && a.kind === 'bubble').length;
        const anyGenerating = Boolean(generatingPanelId) || generatingAiPage;
        const hasSketchStrokes = (draft.drawingLayers || []).some(l => l.strokes.length > 0) || draft.strokes.length > 0;
        const lockCfg = resolveLayoutLockConfig(draft);
        const lockMode = lockCfg.mode;
        const isLocked = lockCfg.enabled;
        const isFlashback = aiPage.gutterStyle === 'black-flashback';
        const breakouts = aiPage.breakoutZones || [];

        return (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3.5 pb-6 text-xs">
              {/* 1. 剧情脚本与 AI 编排区 */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-gray-800 dark:text-gray-100">{t('本页剧情')}</span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {aiPage.guidePanels.length}{t('格')}
                  </span>
                </div>
                <textarea
                  rows={3}
                  aria-label={t('漫画整页剧情描述')}
                  value={aiPage.storyPrompt}
                  onChange={e => onUpdateAiPage(cur => ({ ...cur, storyPrompt: e.target.value }), false)}
                  placeholder={t('例如：放学后的雨中教室，黑发少女递给银发少年一把透明雨伞，少年愣住随后脸红，最后两人并肩走入雨幕（4 格）')}
                  className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />

                {/* 本页出场角色（带封面缩略图） */}
                {(() => {
                  const selectedCastBadges: { id: string; label: string; previewImage?: string }[] = [];
                  for (const id of aiPage.castCharacterIds) {
                    const custom = allCharacterChains.find(c => c.id === id);
                    if (custom) {
                      selectedCastBadges.push({ id: custom.id, label: custom.name, previewImage: custom.previewImage });
                      continue;
                    }
                    const db = parseDanbooruCastId(id);
                    if (db) selectedCastBadges.push({ id, label: db.label });
                  }
                  const q = castQuery.trim().toLowerCase();
                  const filteredCast = q
                    ? allCharacterChains.filter(c => c.name.toLowerCase().includes(q) || c.basePrompt?.toLowerCase().includes(q)).slice(0, 30)
                    : allCharacterChains.slice(0, 30);
                  return (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{t('出场角色')}</span>
                        {selectedCastBadges.map(badge => (
                          <span
                            key={badge.id}
                            className="inline-flex items-center gap-1 rounded-md border border-indigo-400/70 bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:border-indigo-500/70 dark:bg-indigo-950/60 dark:text-indigo-200"
                          >
                            {badge.previewImage && <img src={badge.previewImage} alt="" className="h-3.5 w-3.5 rounded-sm object-cover" />}
                            <span className="max-w-28 truncate">{badge.label}</span>
                            <button
                              type="button"
                              aria-label={t('移除角色 {0}', [badge.label])}
                              onClick={() => onUpdateAiPage(cur => ({
                                ...cur,
                                castCharacterIds: cur.castCharacterIds.filter(id => id !== badge.id),
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
                              placeholder={t('搜自定义角色库或输入中/英文搜 Danbooru 角色…')}
                              className="w-full rounded border border-gray-200 bg-gray-50 py-1 pl-6 pr-2 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                            />
                          </div>
                          <div className="max-h-48 space-y-1 overflow-y-auto">
                            {filteredCast.length > 0 && (
                              <div className="space-y-0.5">
                                <div className="px-1.5 text-[10px] font-semibold text-gray-400">{t('我的角色库')}</div>
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
                                      className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] transition ${checked ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800'}`}
                                    >
                                      <ChainThumb image={char.previewImage} kind="character" sizeClass="h-6 w-6" />
                                      <span className="min-w-0 flex-1 truncate font-medium">{char.name}</span>
                                      {checked && <Check className="h-3 w-3 flex-none text-indigo-500" />}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            <div className="space-y-0.5">
                              <div className="flex items-center justify-between px-1.5 text-[10px] font-semibold text-gray-400">
                                <span>{t('Danbooru 词库角色')}</span>
                                {castDictLoading && <InlineSpinner className="h-2.5 w-2.5" />}
                              </div>
                              {!castQuery.trim() ? null : castDictResults.length > 0 ? (
                                castDictResults.map(entry => {
                                  const encodedId = encodeDanbooruCastId(entry.name, entry.chinese);
                                  const checked = aiPage.castCharacterIds.includes(encodedId);
                                  const displayLabel = entry.chinese || entry.name;
                                  return (
                                    <button
                                      key={entry.name}
                                      type="button"
                                      aria-pressed={checked}
                                      onClick={() => onUpdateAiPage(cur => ({
                                        ...cur,
                                        castCharacterIds: checked
                                          ? cur.castCharacterIds.filter(id => id !== encodedId)
                                          : [...cur.castCharacterIds, encodedId],
                                      }), true)}
                                      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] transition ${checked ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800'}`}
                                    >
                                      <span className="min-w-0 flex-1 truncate font-medium">{displayLabel}</span>
                                      <span className="max-w-28 truncate font-mono text-[10px] text-gray-400">{entry.name}</span>
                                      {checked && <Check className="h-3 w-3 flex-none text-indigo-500" />}
                                    </button>
                                  );
                                })
                              ) : !castDictLoading ? (
                                <p className="px-2 py-1 text-[10px] text-gray-400">{t('词库中未找到匹配角色')}</p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <button
                  type="button"
                  disabled={planningAiStoryboard || !aiPage.storyPrompt.trim()}
                  onClick={onPlanAiStoryboard}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {planningAiStoryboard ? <InlineSpinner className="h-3.5 w-3.5 text-white" /> : <Sparkles className="h-3.5 w-3.5" />}
                  <span>{planningAiStoryboard ? t('AI 编排中…') : t('AI 编排分镜与锚点')}</span>
                </button>

                <div className="space-y-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={preserveGuideLayout}
                      onChange={e => onTogglePreserveGuideLayout(e.target.checked)}
                      className="rounded accent-indigo-600"
                    />
                    <span>{t('按画布现有布局编排')} ({aiPage.guidePanels.length}{t('格')})</span>
                  </label>
                  {!preserveGuideLayout && (
                    <div className="flex items-center justify-between gap-2">
                      <span>{t('目标格数')}</span>
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
                  )}
                </div>
              </div>

              {/* 2. 当前画布选中的引导格镜头卡（仅点选引导格时聚焦出现，替代整页长列表） */}
              {selectedGuide && (
                <div className="space-y-2 rounded-xl border border-indigo-200/80 bg-indigo-50/30 p-2.5 dark:border-indigo-900/60 dark:bg-indigo-950/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-indigo-900 dark:text-indigo-200">
                      {t('第 {0} 格镜头设置', [selectedGuideIndex + 1])}
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelect(null)}
                      aria-label={t('收起')}
                      className="rounded p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={selectedGuide.summary}
                    onChange={e => onUpdateAiPage(cur => ({
                      ...cur,
                      guidePanels: cur.guidePanels.map(item => item.id === selectedGuide.id ? { ...item, summary: e.target.value } : item),
                    }), false)}
                    placeholder={t('中文镜头剧情摘要')}
                    className="w-full rounded border border-gray-200/80 bg-white px-2 py-1 text-[11px] font-medium text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                  <input
                    type="text"
                    value={selectedGuide.visualNote || ''}
                    onChange={e => onUpdateAiPage(cur => ({
                      ...cur,
                      guidePanels: cur.guidePanels.map(item => item.id === selectedGuide.id ? { ...item, visualNote: e.target.value } : item),
                    }), false)}
                    placeholder={t('英文机位/景别/光影词（将自动喂给画图模型）')}
                    className="w-full rounded border border-gray-200/80 bg-white px-2 py-1 text-[10px] text-gray-600 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                  />
                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    {([
                      { key: 'inset', label: '画中画' },
                      { key: 'borderless', label: '无框' },
                      { key: 'bleed', label: '出血格' },
                      { key: 'speedlines', label: '预埋速度线' },
                    ] as const).map(flag => {
                      const active = Boolean(selectedGuide[flag.key]);
                      return (
                        <button
                          key={flag.key}
                          type="button"
                          aria-pressed={active}
                          onClick={() => onUpdateAiPage(cur => ({
                            ...cur,
                            guidePanels: cur.guidePanels.map(item => item.id === selectedGuide.id ? { ...item, [flag.key]: !item[flag.key] } : item),
                          }), true)}
                          className={`rounded border px-1.5 py-0.5 font-medium transition ${active ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
                        >
                          {t(flag.label)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 3. 角色与场景定位 */}
              <div className="space-y-2.5 border-t border-gray-200/80 pt-3.5 dark:border-gray-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-gray-800 dark:text-gray-100">{t('角色与场景定位')}</span>
                  <div className="flex items-center gap-1">
                    {bubbleAnchorCount > 0 && (
                      <button
                        type="button"
                        onClick={onConvertBubbleAnchorsToVector}
                        className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                      >
                        <MessageCircle className="h-3 w-3" />
                        <span>{t('气泡点转矢量嵌字')} ({bubbleAnchorCount})</span>
                      </button>
                    )}
                    <button
                      type="button"
                      title={aiPage.showGuideOverlay ? t('隐藏引导与锚点') : t('显示引导与锚点')}
                      aria-label={aiPage.showGuideOverlay ? t('隐藏引导与锚点') : t('显示引导与锚点')}
                      onClick={() => onUpdateAiPage(cur => ({ ...cur, showGuideOverlay: !cur.showGuideOverlay }), false)}
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                    >
                      {aiPage.showGuideOverlay ? <Eye className="h-3.5 w-3.5 text-indigo-500" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    {aiPage.generatedPageImage?.url && (
                      <button
                        type="button"
                        title={t('清成图')}
                        aria-label={t('清成图')}
                        onClick={() => onUpdateAiPage(cur => ({
                          ...cur,
                          generatedPageImage: undefined,
                          originalGeneratedPageImage: undefined,
                          zoneImages: undefined,
                          showGuideOverlay: true,
                        }), true)}
                        className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {aiZonePlan.overallLevel === 'hard-exceeded' && (
                  <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {t('单区超过 24 槽上限，请停用部分锚点')}
                  </p>
                )}

                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCharacterPickerOpen(open => !open)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${characterPickerOpen ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/50 dark:text-indigo-200' : 'border-gray-200/90 bg-white text-gray-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200'}`}
                  >
                    <Plus className="h-3 w-3 text-blue-500" />
                    {t('角色')}
                  </button>
                  <button
                    type="button"
                    onClick={() => addAnchorToAiPage('scene')}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200"
                  >
                    <Plus className="h-3 w-3 text-emerald-500" />
                    {t('场景/道具')}
                  </button>
                  {draft.dialogueMode !== 'clean-vector' && (
                    <button
                      type="button"
                      onClick={() => addAnchorToAiPage('bubble')}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200"
                    >
                      <Plus className="h-3 w-3 text-amber-500" />
                      {t('气泡点')}
                    </button>
                  )}
                </div>

                {characterPickerOpen && (
                  <AnchorCharacterPicker
                    query={charQuery}
                    onChangeQuery={setCharQuery}
                    characterChains={characterChains}
                    dictResults={charDictResults}
                    dictLoading={charDictLoading}
                    onAddBlank={() => {
                      addAnchorToAiPage('character');
                      setCharacterPickerOpen(false);
                      setCharQuery('');
                    }}
                    onAddFromChain={char => {
                      addAnchorToAiPage('character', {
                        label: char.name,
                        prompt: [char.basePrompt, char.variableValues?.subject].filter(Boolean).join(', '),
                        negativePrompt: char.negativePrompt || '',
                        sourceCharacterId: char.id,
                      });
                      setCharacterPickerOpen(false);
                      setCharQuery('');
                    }}
                    onAddFromDict={entry => {
                      addAnchorToAiPage('character', {
                        label: entry.chinese || entry.name,
                        prompt: entry.name.replace(/_/g, ' '),
                      });
                      setCharacterPickerOpen(false);
                      setCharQuery('');
                    }}
                  />
                )}

                {aiPage.anchors.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-center text-[11px] text-gray-400 dark:border-gray-700">
                    {t('暂无定位点，可点击 AI 编排或手动添加')}
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
                              <ComicPromptField
                                label={t('锚点提示词')}
                                ariaLabel={`${anchor.label || t('整页锚点')} · ${t('提示词')}`}
                                rows={2}
                                compact
                                libraryField={POSITIVE_LIBRARY_FIELD}
                                value={anchor.prompt}
                                onChange={val => onUpdateAiPage(cur => ({
                                  ...cur,
                                  anchors: cur.anchors.map(a => a.id === anchor.id ? { ...a, prompt: val } : a),
                                }), false)}
                                onCopy={copyPrompt}
                                placeholder={anchor.kind === 'bubble' ? t('气泡补充说明（如 tail pointing left）') : t('输入该锚点的英文外观、动作、表情或物件提示词')}
                              />
                              {anchor.kind === 'bubble' && (
                                <BubbleAnchorEditor
                                  anchor={anchor}
                                  dialogueMode={draft.dialogueMode}
                                  onChangeText={text => onUpdateAiPage(cur => ({
                                    ...cur,
                                    anchors: cur.anchors.map(a => a.id === anchor.id ? { ...a, bubbleText: text } : a),
                                  }), false)}
                                  onChangeShape={shape => onUpdateAiPage(cur => ({
                                    ...cur,
                                    anchors: cur.anchors.map(a => a.id === anchor.id ? { ...a, bubbleShape: shape } : a),
                                  }), true)}
                                  onConvert={() => onConvertSingleAnchorBubbleToVector({ kind: 'ai-anchor', anchorId: anchor.id })}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 4. 唯一折叠「更多选项」（默认收起，只放用户看得懂的控制项） */}
              <details className="group rounded-xl border border-gray-200/80 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/30">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-[11px] font-semibold text-gray-700 select-none hover:text-indigo-600 dark:text-gray-200 dark:hover:text-indigo-300">
                  <span className="inline-flex items-center gap-1.5">
                    <ChevronDown className="h-3.5 w-3.5 text-gray-400 transition group-open:rotate-180" aria-hidden="true" />
                    <span>{t('更多选项')}</span>
                  </span>
                  <span className="font-normal text-gray-400">
                    {lockMode === 'txt2img' ? t('不锁框') : t('锁框')}{isFlashback ? ` · ${t('黑底')}` : ''}
                  </span>
                </summary>
                <div className="space-y-2.5 border-t border-gray-200/70 px-2.5 pt-2.5 pb-2.5 dark:border-gray-800">
                  <div className="space-y-1.5">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-gray-800 dark:text-gray-100">
                      <input
                        type="checkbox"
                        checked={lockMode !== 'txt2img'}
                        onChange={e => onUpdateAiPage(cur => ({
                          ...cur,
                          layoutLockMode: e.target.checked ? 'infill' : 'txt2img',
                        }), true)}
                        className="rounded accent-indigo-600"
                      />
                      <span>{t('严格按画布框线出图')}</span>
                    </label>
                    <p className="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
                      {lockMode !== 'txt2img'
                        ? t('按你画好的格线精准填充，斜切与叠框不跑形')
                        : t('画布格与锚点仅作位置参考，具体分格与框线由 AI 自由发挥')}
                    </p>
                  </div>

                  {isLocked && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        aria-pressed={!isFlashback}
                        onClick={() => onUpdateAiPage(cur => ({ ...cur, gutterStyle: 'white' }), true)}
                        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[11px] font-medium transition ${!isFlashback ? 'border-indigo-500 bg-white text-indigo-700 shadow-xs dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200/80 bg-white/70 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-300'}`}
                      >
                        <GutterStylePreviewIcon />
                        <span className="truncate">{t('白底常规')}</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={isFlashback}
                        onClick={() => onUpdateAiPage(cur => ({ ...cur, gutterStyle: 'black-flashback' }), true)}
                        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[11px] font-medium transition ${isFlashback ? 'border-indigo-500 bg-gray-900 text-white shadow-xs dark:border-indigo-400' : 'border-gray-200/80 bg-white/70 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-300'}`}
                      >
                        <GutterStylePreviewIcon flashback />
                        <span className="truncate">{t('黑底回忆杀')}</span>
                      </button>
                    </div>
                  )}

                  <label className="block">
                    <span className="mb-1 block text-[10px] font-medium text-gray-500 dark:text-gray-400">
                      {t('全页统一环境光照词')}
                    </span>
                    <input
                      type="text"
                      aria-label={t('全页统一环境光照词')}
                      value={aiPage.sceneAtmosphere || ''}
                      onChange={e => onUpdateAiPage(cur => ({ ...cur, sceneAtmosphere: e.target.value }), false)}
                      placeholder="e.g. warm afternoon library sunlight, soft shadows"
                      className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                    />
                  </label>

                  {isLocked && (hasSketchStrokes || draft.texts.length > 0) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600 dark:text-gray-300">
                      {hasSketchStrokes && (
                        <label className="inline-flex cursor-pointer items-center gap-1">
                          <input
                            type="checkbox"
                            checked={Boolean(aiPage.projectSketchLayer)}
                            onChange={e => onUpdateAiPage(cur => ({ ...cur, projectSketchLayer: e.target.checked }), true)}
                            className="rounded accent-indigo-600"
                          />
                          <span>{t('手绘草图引导')}</span>
                        </label>
                      )}
                      {draft.texts.length > 0 && (
                        <label className="inline-flex cursor-pointer items-center gap-1">
                          <input
                            type="checkbox"
                            checked={Boolean(aiPage.projectSfxText)}
                            onChange={e => onUpdateAiPage(cur => ({ ...cur, projectSfxText: e.target.checked }), true)}
                            className="rounded accent-indigo-600"
                          />
                          <span>{t('拟声词融画')}</span>
                        </label>
                      )}
                    </div>
                  )}

                  {aiZonePlan.zones.length === 2 && (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200/80 bg-white/80 p-2 text-[11px] dark:border-gray-800 dark:bg-gray-900/50">
                      <span className="font-semibold text-gray-600 dark:text-gray-300">{t('单区精修')}</span>
                      <button
                        type="button"
                        disabled={anyGenerating || aiZonePlan.zones[0].guardLevel === 'hard-exceeded'}
                        onClick={() => onGenerateAiZone(0)}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 font-medium text-gray-700 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      >
                        {aiPage.zoneImages?.['0']?.url && <Check className="h-3 w-3 text-emerald-500" />}
                        <span>{aiPage.zoneImages?.['0']?.url ? t('重画区 1') : t('仅画区 1')}</span>
                      </button>
                      <button
                        type="button"
                        disabled={anyGenerating || aiZonePlan.zones[1].guardLevel === 'hard-exceeded'}
                        onClick={() => onGenerateAiZone(1)}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 font-medium text-gray-700 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      >
                        {aiPage.zoneImages?.['1']?.url && <Check className="h-3 w-3 text-emerald-500" />}
                        <span>{aiPage.zoneImages?.['1']?.url ? t('重画区 2') : t('仅画区 2')}</span>
                      </button>
                      {aiPage.zoneImages?.['0']?.url && aiPage.zoneImages?.['1']?.url && (
                        <button
                          type="button"
                          disabled={anyGenerating}
                          onClick={onRestitchAiZones}
                          className="ml-auto rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200"
                        >
                          {t('重新拼合')}
                        </button>
                      )}
                    </div>
                  )}

                  {isLocked && breakouts.length > 0 && (
                    <div className="space-y-1">
                      {breakouts.map((bz, idx) => (
                        <div
                          key={bz.id}
                          onClick={() => onSelect({ kind: 'breakout-zone', id: bz.id })}
                          className="flex items-center justify-between gap-1.5 rounded border border-gray-200 bg-white px-2 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-900"
                        >
                          <span className="truncate font-medium text-gray-700 dark:text-gray-200">
                            {bz.label || `${t('破格前景')} ${idx + 1}`}
                          </span>
                          <button
                            type="button"
                            aria-label={t('删除破格前景块')}
                            onClick={e => {
                              e.stopPropagation();
                              onUpdateAiPage(cur => ({
                                ...cur,
                                breakoutZones: (cur.breakoutZones || []).filter(item => item.id !== bz.id),
                              }), true);
                            }}
                            className="rounded p-0.5 text-gray-400 hover:text-red-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>

                {/* 成图精修区：可视化白泡候选校对 + 框选单格局部重绘 + 原图留底对照 */}
                {aiPage.generatedPageImage?.url && (
                  <div className="space-y-2 border-t border-gray-200/80 pt-2.5 dark:border-gray-800">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-gray-800 dark:text-gray-100">{t('成图精修')}</span>
                      <div className="flex items-center gap-1.5">
                        {aiPage.originalGeneratedPageImage?.url
                          && aiPage.originalGeneratedPageImage.url !== aiPage.generatedPageImage.url && (
                          <>
                            <button
                              type="button"
                              aria-pressed={comparingOriginalAiImage}
                              onClick={onToggleCompareOriginalAiImage}
                              className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition ${comparingOriginalAiImage ? 'bg-indigo-600 text-white' : 'border border-gray-200 bg-white text-gray-600 hover:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
                            >
                              {comparingOriginalAiImage ? t('正看原图') : t('对比原图')}
                            </button>
                            <button
                              type="button"
                              onClick={onRestoreOriginalAiImage}
                              title={t('恢复局部重绘前的初始 AI 整页原图')}
                              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40"
                            >
                              <RotateCcw className="h-3 w-3" /> {t('恢复原图')}
                            </button>
                          </>
                        )}
                        {inpaintDraft && (
                          <button
                            type="button"
                            onClick={onCloseInpaint}
                            className="text-[11px] font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                          >
                            {t('退出重绘')}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        disabled={detectingBubbles || anyGenerating}
                        onClick={onAutoDetectWhiteBubbles}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      >
                        {detectingBubbles ? <InlineSpinner className="h-3 w-3" /> : <MessageCircle className="h-3.5 w-3.5 text-amber-500" />}
                        <span>{detectingBubbles ? t('识别中…') : t('识别气泡并校对')}</span>
                      </button>
                      <button
                        type="button"
                        disabled={anyGenerating}
                        onClick={() => (inpaintDraft ? onCloseInpaint() : onOpenInpaint(aiPage.guidePanels[0]))}
                        aria-pressed={Boolean(inpaintDraft)}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 ${inpaintDraft ? 'border-rose-500 bg-rose-50 text-rose-700 dark:border-rose-500 dark:bg-rose-950/50 dark:text-rose-200' : 'border-gray-200 bg-white text-gray-700 hover:border-rose-400 hover:text-rose-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
                      >
                        <Wand2 className="h-3.5 w-3.5 text-rose-500" />
                        <span>{inpaintDraft ? t('重绘模式中') : t('单格局部重绘')}</span>
                      </button>
                    </div>

                    {/* 可视化气泡候选校对列表：勾选要嵌字的气泡并修改台词，点确认后才写入画布 */}
                    {bubbleCandidates && bubbleCandidates.length > 0 && (
                      <div className="space-y-2 rounded-xl border border-emerald-200/80 bg-emerald-50/30 p-2.5 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-bold text-emerald-800 dark:text-emerald-200">
                            {t('气泡候选校对')} ({bubbleCandidates.filter(c => c.selected).length}/{bubbleCandidates.length})
                          </span>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => onBulkSelectBubbleCandidates('all')} className="rounded px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/40">{t('全选')}</button>
                            <button type="button" onClick={() => onBulkSelectBubbleCandidates('with-text')} className="rounded px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/40">{t('仅选有词')}</button>
                            <button type="button" onClick={() => onBulkSelectBubbleCandidates('none')} className="rounded px-1.5 py-0.5 text-[10px] font-medium text-gray-500 hover:bg-gray-200/60 dark:text-gray-400">{t('全不选')}</button>
                          </div>
                        </div>
                        <div className="max-h-44 space-y-1.5 overflow-y-auto">
                          {bubbleCandidates.map((cand, idx) => (
                            <div key={cand.id} className="flex items-center gap-1.5 rounded-lg border border-gray-200/80 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-900">
                              <input
                                type="checkbox"
                                checked={cand.selected}
                                onChange={() => onToggleBubbleCandidate(cand.id)}
                                className="rounded accent-emerald-600"
                              />
                              <span className="w-5 flex-none font-mono text-[10px] font-bold text-emerald-600">#{idx + 1}</span>
                              <input
                                type="text"
                                value={cand.text}
                                onChange={e => onEditBubbleCandidateText(cand.id, e.target.value)}
                                placeholder={t('输入台词（留空将填占位字）')}
                                className="min-w-0 flex-1 bg-transparent text-[11px] text-gray-800 outline-none dark:text-gray-100"
                              />
                              <span className="flex-none font-mono text-[10px] text-gray-400">{Math.round(cand.confidence * 100)}%</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={!bubbleCandidates.some(c => c.selected)}
                            onClick={onConfirmBubbleCandidates}
                            className="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
                          >
                            {t('确认嵌字 ({0} 处)', [bubbleCandidates.filter(c => c.selected).length])}
                          </button>
                          <button
                            type="button"
                            onClick={onCancelBubbleCandidates}
                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                          >
                            {t('取消')}
                          </button>
                        </div>
                      </div>
                    )}

                    {inpaintDraft && (
                      <div className="space-y-2.5 rounded-xl border border-rose-200/80 bg-rose-50/30 p-2.5 dark:border-rose-900/60 dark:bg-rose-950/20">
                        <div className="space-y-1">
                          <span className="block text-[11px] font-medium text-gray-600 dark:text-gray-300">{t('快选目标格（或直接在画布拖红框）')}</span>
                          <div className="flex flex-wrap gap-1">
                            {aiPage.guidePanels.map((gp, idx) => (
                              <button
                                key={gp.id}
                                type="button"
                                onClick={() => onOpenInpaint(gp)}
                                className="rounded border border-rose-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:border-rose-400 dark:border-rose-900 dark:bg-gray-900 dark:text-rose-300"
                              >
                                {t('第 {0} 格', [idx + 1])}
                              </button>
                            ))}
                          </div>
                        </div>

                        <ComicPromptField
                          label={t('重绘区域画面描述')}
                          ariaLabel={t('局部重绘描述')}
                          rows={2}
                          compact
                          libraryField={POSITIVE_LIBRARY_FIELD}
                          value={inpaintDraft.prompt}
                          onChange={val => onUpdateInpaintDraft(cur => ({ ...cur, prompt: val }))}
                          onCopy={copyPrompt}
                          placeholder={t('例如：1girl, smiling softly, fixing hand holding umbrella...')}
                        />

                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <label className="flex flex-1 items-center gap-1.5 text-gray-600 dark:text-gray-300">
                            <span>{t('重绘强度')}</span>
                            <input
                              type="range"
                              min={40}
                              max={99}
                              value={Math.round(inpaintDraft.strength * 100)}
                              onChange={e => onUpdateInpaintDraft(cur => ({ ...cur, strength: Number(e.target.value) / 100 }))}
                              className="flex-1 accent-rose-600"
                            />
                            <span className="w-8 font-mono">{inpaintDraft.strength.toFixed(2)}</span>
                          </label>
                          <label className="inline-flex cursor-pointer items-center gap-1 text-gray-600 dark:text-gray-300">
                            <input
                              type="checkbox"
                              checked={inpaintDraft.focused}
                              onChange={e => onUpdateInpaintDraft(cur => ({ ...cur, focused: e.target.checked }))}
                              className="rounded accent-rose-600"
                            />
                            <span>{t('聚焦放大')}</span>
                          </label>
                        </div>

                        {/* 重绘区内空间锚点 */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-gray-700 dark:text-gray-200">{t('重绘区锚点')} ({inpaintDraft.anchors.length})</span>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => onUpdateInpaintDraft(cur => ({
                                  ...cur,
                                  anchors: [...cur.anchors, {
                                    id: createUuid(),
                                    kind: 'character',
                                    label: `重绘角色 ${cur.anchors.length + 1}`,
                                    prompt: '',
                                    negativePrompt: '',
                                    x: 0.5,
                                    y: 0.5,
                                    enabled: true,
                                  }],
                                }))}
                                className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-700 hover:border-rose-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> {t('角色')}
                              </button>
                              <button
                                type="button"
                                onClick={() => onUpdateInpaintDraft(cur => ({
                                  ...cur,
                                  anchors: [...cur.anchors, {
                                    id: createUuid(),
                                    kind: 'scene',
                                    label: `重绘物件 ${cur.anchors.length + 1}`,
                                    prompt: '',
                                    negativePrompt: '',
                                    x: 0.5,
                                    y: 0.5,
                                    enabled: true,
                                  }],
                                }))}
                                className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-700 hover:border-rose-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t('物件')}
                              </button>
                            </div>
                          </div>
                          {inpaintDraft.anchors.map((a, idx) => (
                            <div key={a.id} className="space-y-1 rounded border border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-900">
                              <div className="flex items-center gap-1 text-[11px]">
                                <span className="font-mono text-[10px] font-bold text-rose-500">{idx + 1}</span>
                                <input
                                  type="text"
                                  value={a.label}
                                  onChange={e => onUpdateInpaintDraft(cur => ({
                                    ...cur,
                                    anchors: cur.anchors.map(item => item.id === a.id ? { ...item, label: e.target.value } : item),
                                  }))}
                                  className="min-w-0 flex-1 bg-transparent font-medium text-gray-800 outline-none dark:text-gray-100"
                                />
                                <span className="font-mono text-[10px] text-gray-400">({a.x.toFixed(2)},{a.y.toFixed(2)})</span>
                                <button
                                  type="button"
                                  aria-label={t('删除重绘锚点')}
                                  onClick={() => onUpdateInpaintDraft(cur => ({
                                    ...cur,
                                    anchors: cur.anchors.filter(item => item.id !== a.id),
                                  }))}
                                  className="text-gray-400 hover:text-red-500"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                              <input
                                type="text"
                                value={a.prompt}
                                onChange={e => onUpdateInpaintDraft(cur => ({
                                  ...cur,
                                  anchors: cur.anchors.map(item => item.id === a.id ? { ...item, prompt: e.target.value } : item),
                                }))}
                                placeholder={t('输入该重绘锚点的英文外观或动作提示词')}
                                className="w-full rounded border border-gray-200 bg-gray-50 px-1.5 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                              />
                            </div>
                          ))}
                        </div>

                        <button
                          type="button"
                          disabled={anyGenerating || inpaintingAiPage}
                          onClick={onRunInpaint}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-rose-500 disabled:opacity-50"
                        >
                          {inpaintingAiPage ? <InlineSpinner className="h-3.5 w-3.5 text-white" /> : <Wand2 className="h-3.5 w-3.5" />}
                          <span>{inpaintingAiPage ? (aiGenerationStageText || t('局部重绘中…')) : t('重绘选中区域')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
            </div>

            {/* 底部常驻「生成 AI 整页」主操作栏 */}
            <div className="appearance-surface flex-none border-t border-gray-200/80 p-3 dark:border-gray-800/80">
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
                <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-3.5 pb-6 text-xs">
                  {/* 当前格标题与精简动作（只留上传/选图/删除，其余在画布条/右键菜单） */}
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      aria-label={t('分镜格名称')}
                      value={activePanel.name}
                      onChange={e => onUpdatePanel(activePanel.id, p => ({ ...p, name: e.target.value }), false)}
                      onBlur={() => onUpdatePanel(activePanel.id, p => p, true)}
                      className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm font-bold text-gray-800 outline-none hover:border-gray-200 focus:border-indigo-400 focus:bg-white dark:text-gray-100 dark:hover:border-gray-700 dark:focus:bg-gray-800"
                    />
                    <div className="flex flex-none items-center gap-1">
                      {onUploadImageToPanel && (
                        <>
                          <input
                            ref={panelFileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            aria-hidden="true"
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file) onUploadImageToPanel(activePanel.id, file);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => panelFileInputRef.current?.click()}
                            title={t('上传本地图片填入')}
                            aria-label={t('上传本地图片填入')}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                          >
                            <Upload className="h-3 w-3" /> {t('上传')}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setHistoryPickerOpen(true)}
                        title={t('从生成历史选图填入')}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                      >
                        <ImageIcon className="h-3 w-3" /> {t('选图')}
                      </button>
                      <button type="button" title={t('删除分镜格')} aria-label={t('删除分镜格')} onClick={() => onDeletePanel(activePanel.id)} className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>

                  {/* 单格画面描述 + 默认折叠补充负面词 */}
                  <div className="space-y-2.5">
                    <ComicPromptField
                      label={t('本格画面描述')}
                      rows={3}
                      libraryField={POSITIVE_LIBRARY_FIELD}
                      promptTidy={promptTidyOption}
                      value={activePanel.prompt}
                      onChange={val => onUpdatePanel(activePanel.id, p => ({ ...p, prompt: val }), false)}
                      onCopy={copyPrompt}
                      placeholder={t('例如：close-up, rain outside classroom window, looking surprised...')}
                    />
                    <details className="group rounded-lg border border-gray-200/80 bg-gray-50/40 dark:border-gray-800 dark:bg-gray-800/30">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 select-none hover:text-indigo-600 dark:text-gray-300 dark:hover:text-indigo-300">
                        <span className="inline-flex items-center gap-1">
                          <ChevronDown className="h-3 w-3 text-gray-400 transition group-open:rotate-180" aria-hidden="true" />
                          <span>{t('本格补充负面词（可选）')}</span>
                        </span>
                        {activePanel.negativePrompt.trim() && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                            {t('已填')}
                          </span>
                        )}
                      </summary>
                      <div className="border-t border-gray-200/70 p-2 dark:border-gray-800">
                        <ComicPromptField
                          label={t('本格补充负面词（可选）')}
                          rows={2}
                          compact
                          libraryField={NEGATIVE_LIBRARY_FIELD}
                          value={activePanel.negativePrompt}
                          onChange={val => onUpdatePanel(activePanel.id, p => ({ ...p, negativePrompt: val }), false)}
                          onCopy={copyPrompt}
                          placeholder={t('仅对当前格生效的额外排除项')}
                        />
                      </div>
                    </details>
                  </div>

                  {/* 有图时单行极简图内缩放条 */}
                  {activePanel.image?.url && (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-200/80 bg-gray-50/60 px-2.5 py-1.5 text-[11px] dark:border-gray-800 dark:bg-gray-800/40">
                      <span className="flex-none text-gray-500">{t('格内缩放')}</span>
                      <input
                        type="range"
                        min={50}
                        max={400}
                        value={Math.round((activePanel.image.scale || 1) * 100)}
                        onChange={e => onUpdatePanel(activePanel.id, p => p.image ? ({ ...p, image: { ...p.image, scale: Number(e.target.value) / 100 } }) : p, false)}
                        className="min-w-0 flex-1 accent-indigo-600"
                      />
                      <span className="w-9 flex-none font-mono text-[10px] text-gray-500">{Math.round((activePanel.image.scale || 1) * 100)}%</span>
                      <button
                        type="button"
                        title={t('重置')}
                        onClick={() => onUpdatePanel(activePanel.id, p => p.image ? ({ ...p, image: { ...p.image, offsetX: 0, offsetY: 0, scale: 1 } }) : p, true)}
                        className="rounded p-0.5 text-gray-500 hover:bg-gray-200/60 dark:hover:bg-gray-700"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdatePanel(activePanel.id, p => ({ ...p, image: undefined }), true)}
                        className="rounded px-1 py-0.5 text-[10px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                      >
                        {t('清图')}
                      </button>
                    </div>
                  )}

                  {/* 本格角色与场景定位 */}
                  <div className="space-y-2 border-t border-gray-200/80 pt-3 dark:border-gray-800">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-gray-800 dark:text-gray-100">{t('本格角色与场景')}</span>
                      {guard.activeCount > 0 && (
                        <span className={`text-[11px] font-semibold ${guard.level === 'hard-exceeded' ? 'text-red-500' : guard.level === 'soft-warning' ? 'text-amber-500' : 'text-gray-400'}`}>
                          {guard.activeCount}/{COMIC_ANCHOR_SOFT_LIMIT}
                        </span>
                      )}
                    </div>

                    {guard.level === 'soft-warning' && (
                      <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        {t('超过 12 个锚点，人物细节可能下降')}
                      </p>
                    )}
                    {guard.level === 'hard-exceeded' && (
                      <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
                        {t('超过 24 个锚点上限，请精简后再生成')}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={activePanel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT}
                        onClick={() => setCharacterPickerOpen(open => !open)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-40 ${characterPickerOpen ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/50 dark:text-indigo-200' : 'border-gray-200/90 bg-white text-gray-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200'}`}
                      >
                        <Plus className="h-3 w-3 text-blue-500" />
                        {t('角色')}
                      </button>
                      <button
                        type="button"
                        disabled={activePanel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT}
                        onClick={() => addAnchorToPanel(activePanel, 'scene')}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200"
                      >
                        <Plus className="h-3 w-3 text-emerald-500" />
                        {t('场景/道具')}
                      </button>
                      {draft.dialogueMode !== 'clean-vector' && (
                        <button
                          type="button"
                          disabled={activePanel.anchors.length >= COMIC_ANCHOR_HARD_LIMIT}
                          onClick={() => addAnchorToPanel(activePanel, 'bubble')}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-200"
                        >
                          <Plus className="h-3 w-3 text-amber-500" />
                          {t('气泡点')}
                        </button>
                      )}
                    </div>

                    {characterPickerOpen && (
                      <AnchorCharacterPicker
                        query={charQuery}
                        onChangeQuery={setCharQuery}
                        characterChains={characterChains}
                        dictResults={charDictResults}
                        dictLoading={charDictLoading}
                        onAddBlank={() => {
                          addAnchorToPanel(activePanel, 'character');
                          setCharacterPickerOpen(false);
                          setCharQuery('');
                        }}
                        onAddFromChain={char => {
                          addAnchorToPanel(activePanel, 'character', {
                            label: char.name,
                            prompt: [char.basePrompt, char.variableValues?.subject].filter(Boolean).join(', '),
                            negativePrompt: char.negativePrompt || '',
                            sourceCharacterId: char.id,
                          });
                          setCharacterPickerOpen(false);
                          setCharQuery('');
                        }}
                        onAddFromDict={entry => {
                          addAnchorToPanel(activePanel, 'character', {
                            label: entry.chinese || entry.name,
                            prompt: entry.name.replace(/_/g, ' '),
                          });
                          setCharacterPickerOpen(false);
                          setCharQuery('');
                        }}
                      />
                    )}

                    {activePanel.anchors.length > 0 && (
                      <div className="space-y-2 pt-1">
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
                          {activePanel.anchors.map((anchor, idx) => {
                            const isExpanded = selectedAnchor?.id === anchor.id;
                            return (
                              <div
                                key={anchor.id}
                                onClick={() => {
                                  setSelectedAnchorId(anchor.id);
                                  if (anchor.kind === 'bubble') {
                                    onSelect({ kind: 'panel-anchor', panelId: activePanel.id, id: anchor.id });
                                  }
                                }}
                                className={`rounded-lg border p-2 transition ${isExpanded ? 'border-indigo-400 bg-white dark:border-indigo-500 dark:bg-gray-900' : 'border-gray-200/80 bg-white/70 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900/50'}`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    checked={anchor.enabled}
                                    onClick={e => e.stopPropagation()}
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
                                    onClick={e => e.stopPropagation()}
                                    onChange={e => onUpdatePanel(activePanel.id, p => ({
                                      ...p,
                                      anchors: p.anchors.map(a => a.id === anchor.id ? { ...a, label: e.target.value } : a),
                                    }), false)}
                                    className="min-w-0 flex-1 bg-transparent text-xs font-medium text-gray-800 outline-none dark:text-gray-100"
                                  />
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
                                {isExpanded && (
                                  <div className="mt-2 space-y-1.5">
                                    <ComicPromptField
                                      label={t('锚点提示词')}
                                      ariaLabel={`${anchor.label || t('本格锚点')} · ${t('提示词')}`}
                                      rows={2}
                                      compact
                                      libraryField={POSITIVE_LIBRARY_FIELD}
                                      value={anchor.prompt}
                                      onChange={val => onUpdatePanel(activePanel.id, p => ({
                                        ...p,
                                        anchors: p.anchors.map(a => a.id === anchor.id ? { ...a, prompt: val } : a),
                                      }), false)}
                                      onCopy={copyPrompt}
                                      placeholder={anchor.kind === 'bubble' ? t('气泡补充说明（如 tail pointing right）') : t('输入该锚点的外观、动作、物件或景别提示词')}
                                    />
                                    {anchor.kind === 'bubble' && (
                                      <BubbleAnchorEditor
                                        anchor={anchor}
                                        dialogueMode={draft.dialogueMode}
                                        onChangeText={text => onUpdatePanel(activePanel.id, p => ({
                                          ...p,
                                          anchors: p.anchors.map(a => a.id === anchor.id ? { ...a, bubbleText: text } : a),
                                        }), false)}
                                        onChangeShape={shape => onUpdatePanel(activePanel.id, p => ({
                                          ...p,
                                          anchors: p.anchors.map(a => a.id === anchor.id ? { ...a, bubbleShape: shape } : a),
                                        }), true)}
                                        onConvert={() => onConvertSingleAnchorBubbleToVector({ kind: 'panel-anchor', panelId: activePanel.id, anchorId: anchor.id })}
                                      />
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 默认折叠：画格边框与外观样式 */}
                  <details className="group border-t border-gray-200/80 pt-3 dark:border-gray-800">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 select-none font-bold text-gray-700 hover:text-indigo-600 dark:text-gray-200 dark:hover:text-indigo-300">
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronDown className="h-3.5 w-3.5 text-gray-400 transition group-open:rotate-180" aria-hidden="true" />
                        <span>{t('画格边框与样式')}</span>
                      </span>
                      <span className="font-mono text-[10px] font-normal text-gray-400">
                        {activePanel.borderWidth}px{activePanel.rotation !== 0 ? ` · ${activePanel.rotation}°` : ''}
                      </span>
                    </summary>
                    <div className="mt-2.5 space-y-2.5">
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
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
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
                        {(onTogglePanelOverlay || onTogglePanelBorderless) && (
                          <div className="ml-auto flex items-center gap-1">
                            {onTogglePanelOverlay && (
                              <button
                                type="button"
                                aria-pressed={Boolean(activePanel.inset)}
                                onClick={() => onTogglePanelOverlay(activePanel.id)}
                                className={`rounded border px-2 py-0.5 text-[11px] font-medium transition ${activePanel.inset ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
                              >
                                {t('叠加画框')}
                              </button>
                            )}
                            {onTogglePanelBorderless && (
                              <button
                                type="button"
                                aria-pressed={activePanel.borderWidth === 0}
                                onClick={() => onTogglePanelBorderless(activePanel.id)}
                                className={`rounded border px-2 py-0.5 text-[11px] font-medium transition ${activePanel.borderWidth === 0 ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
                              >
                                {t('无边框')}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </details>
                </div>

                {/* 底部常驻「生成当前格」与「一键整页生成」主操作栏 */}
                <div className="appearance-surface flex-none border-t border-gray-200/80 p-3 dark:border-gray-800/80">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                    <span>{t('自动免费尺寸')}：{resolution.width} × {resolution.height}</span>
                    <span>{formatGenerationCostLabel(estimatedCost, draft.v5Model)}</span>
                  </div>
                  {(isGeneratingThis || batchGeneratingManual) ? (
                    <div className="flex items-center gap-2">
                      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white">
                        <InlineSpinner className="h-3.5 w-3.5 text-white" />
                        <span className="truncate">{batchProgressText || generationStageText || t('生成中…')}</span>
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
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={anyGenerating || guard.level === 'hard-exceeded'}
                        onClick={() => onGeneratePanel(activePanel.id)}
                        className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Wand2 className="h-4 w-4 flex-none" />
                        <span className="truncate">{t('生成当前格')}</span>
                        <span className="hidden rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-medium sm:inline">
                          {activePanel.name}
                        </span>
                      </button>
                      {draft.panels.length > 1 && (() => {
                        const emptyCount = draft.panels.filter(p => !p.image?.url).length;
                        return (
                          <button
                            type="button"
                            disabled={anyGenerating}
                            onClick={onGenerateAllPanels}
                            title={emptyCount > 0 ? t('依次生成本页尚未出图的 {0} 个分镜格', [emptyCount]) : t('依次重新生成本页全部 {0} 个分镜格', [draft.panels.length])}
                            className="inline-flex flex-none items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200 dark:hover:bg-indigo-950"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>{emptyCount > 0 && emptyCount < draft.panels.length ? t('余下 {0} 格', [emptyCount]) : t('整页生成')}</span>
                          </button>
                        );
                      })()}
                    </div>
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

      {/* ==================== 步骤 1：画风设定 ==================== */}
      {activeTab === 'style' && (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[var(--nai-canvas,#eef1f7)] p-3 pb-6 text-xs dark:bg-[var(--nai-canvas,#0d0f14)]">
            {/* 卡片 1：载入风格串（带封面缩略图）+ 全页公共正画风词 + 折叠负面词 */}
            <div className="space-y-3 rounded-xl border border-gray-200/90 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-gray-800 dark:bg-gray-900">
              <div className="space-y-1.5">
                <span className="block font-semibold text-gray-700 dark:text-gray-200">{t('载入风格串画风')}</span>
                <div className="flex min-w-0 items-center rounded-lg border border-gray-200 bg-gray-50/70 transition focus-within:border-indigo-400 hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-800/80 dark:hover:border-indigo-500">
                  <button
                    type="button"
                    aria-label={t('选择风格串')}
                    aria-expanded={stylePickerOpen}
                    onClick={() => setStylePickerOpen(open => !open)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs text-gray-800 dark:text-gray-100"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {boundStyleChain?.previewImage && (
                        <img src={boundStyleChain.previewImage} alt="" className="h-5 w-5 flex-none rounded object-cover" />
                      )}
                      <span className={`truncate ${boundStyleChain ? 'font-medium' : 'text-gray-400'}`}>
                        {boundStyleChain ? boundStyleChain.name : t('从风格串选择画风…')}
                      </span>
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 flex-none text-gray-400 transition-transform ${stylePickerOpen ? 'rotate-180 text-indigo-500' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                  {boundStyleChain && (
                    <button
                      type="button"
                      aria-label={t('解除风格串绑定')}
                      title={t('解除风格串绑定')}
                      onClick={() => onUpdateDraft(cur => ({ ...cur, styleChainId: undefined }), true)}
                      className="mr-1 flex h-6 w-6 flex-none items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
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
                    <div className="max-h-52 space-y-1 overflow-y-auto">
                      {styleChains.map(chain => (
                        <button
                          key={chain.id}
                          type="button"
                          onClick={() => {
                            onApplyStyleChain(chain);
                            setStylePickerOpen(false);
                            setStyleQuery('');
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${draft.styleChainId === chain.id ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                        >
                          <ChainThumb image={chain.previewImage} kind="style" sizeClass="h-8 w-8" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold text-gray-800 dark:text-gray-100">{chain.name}</span>
                            {chain.basePrompt && <span className="block truncate text-[10px] text-gray-400">{chain.basePrompt}</span>}
                          </span>
                        </button>
                      ))}
                      {!styleChains.length && (
                        <div className="py-3 text-center text-[11px] text-gray-400">{t('没有找到匹配的风格串')}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <ComicPromptField
                label={t('全页公共画风提示词')}
                rows={3}
                libraryField={POSITIVE_LIBRARY_FIELD}
                promptTidy={promptTidyOption}
                warningTags={styleWarningMap}
                value={draft.globalBasePrompt}
                onChange={val => onUpdateDraft(cur => ({ ...cur, globalBasePrompt: val }), false)}
                onCopy={copyPrompt}
                placeholder={t('输入画师串与全页统一画风，每格生图自动带上')}
              />

              <details className="group rounded-lg border border-gray-200/80 bg-gray-50/40 dark:border-gray-800 dark:bg-gray-800/30">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 select-none hover:text-indigo-600 dark:text-gray-300 dark:hover:text-indigo-300">
                  <span className="inline-flex items-center gap-1">
                    <ChevronDown className="h-3 w-3 text-gray-400 transition group-open:rotate-180" aria-hidden="true" />
                    <span>{t('全页公共负面词（选填）')}</span>
                  </span>
                  {draft.globalNegativePrompt.trim() && (
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                      {t('已填')}
                    </span>
                  )}
                </summary>
                <div className="border-t border-gray-200/70 p-2 dark:border-gray-800">
                  <ComicPromptField
                    label={t('全页公共负面词')}
                    rows={2}
                    compact
                    libraryField={NEGATIVE_LIBRARY_FIELD}
                    value={draft.globalNegativePrompt}
                    onChange={val => onUpdateDraft(cur => ({ ...cur, globalNegativePrompt: val }), false)}
                    onCopy={copyPrompt}
                    placeholder={t('全页公共排除词（自动过滤压制网点的冲突词）')}
                  />
                </div>
              </details>
            </div>

            {/* 卡片 2：模型档位 / 色彩模式（带视觉色标，精简掉与顶栏的重复和低频对白策略） */}
            <div className="space-y-2.5 rounded-xl border border-gray-200/90 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-gray-800 dark:bg-gray-900">
              <div>
                <span className="mb-1.5 block text-[11px] font-semibold text-gray-600 dark:text-gray-300">{t('V5 模型档位')}</span>
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
                <span className="mb-1.5 block text-[11px] font-semibold text-gray-600 dark:text-gray-300">{t('色彩模式')}</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    { id: 'color', label: '全彩漫画' },
                    { id: 'monochrome', label: '黑白网点漫' },
                  ] as Array<{ id: ComicColorMode; label: string }>).map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onUpdateDraft(cur => ({ ...cur, colorMode: item.id }), true)}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 font-semibold transition ${draft.colorMode === item.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
                    >
                      {item.id === 'color' ? (
                        <span aria-hidden="true" className="h-3 w-3 flex-none rounded-full bg-gradient-to-tr from-rose-400 via-amber-300 to-sky-400 ring-1 ring-black/10" />
                      ) : (
                        <span aria-hidden="true" className="h-3 w-3 flex-none rounded-full bg-gradient-to-r from-gray-900 from-50% to-white to-50% ring-1 ring-gray-400" />
                      )}
                      <span>{t(item.label)}</span>
                    </button>
                  ))}
                </div>
                {draft.colorMode === 'monochrome' && (
                  <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    {t('生图时自动剥离彩色词并压制色相')}
                  </p>
                )}
              </div>
            </div>

            {/* 卡片 3：低频生图参数微调与对白策略（默认折叠） */}
            <details className="group rounded-xl border border-gray-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-gray-800 dark:bg-gray-900">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold text-gray-700 select-none hover:text-indigo-600 dark:text-gray-200 dark:hover:text-indigo-300">
                <span className="inline-flex items-center gap-1.5">
                  <ChevronDown className="h-3.5 w-3.5 text-gray-400 transition group-open:rotate-180" aria-hidden="true" />
                  <span>{t('生图参数微调')}</span>
                </span>
                <span className="truncate font-mono text-[11px] font-normal text-gray-400">
                  {draft.v5Model === 'nai-diffusion-5-full-medium' ? 14 : draft.steps}{t('步')} · CFG {draft.scale.toFixed(1)}{draft.seed !== undefined ? ` · #${draft.seed}` : ''}
                </span>
              </summary>

              <div className="space-y-3 border-t border-gray-100 px-3 pt-2.5 pb-3 dark:border-gray-800">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-gray-500 dark:text-gray-400">{t('对白与气泡策略')}</span>
                  <select
                    aria-label={t('对白与气泡策略')}
                    value={draft.dialogueMode}
                    onChange={e => onUpdateDraft(cur => ({ ...cur, dialogueMode: e.target.value as ComicDialogueMode }), true)}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50/70 px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-indigo-400 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  >
                    <option value="clean-vector">{t('无气泡纯画面 + 画布矢量气泡')}</option>
                    <option value="empty-bubble">{t('空白气泡直出 + 后期嵌字')}</option>
                    <option value="ai-text">{t('AI 锚点直出短字 / 拟声词')}</option>
                  </select>
                </label>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{t('随机种子 (Seed)')}</span>
                    {lastGeneratedSeed !== undefined && (
                      <button
                        type="button"
                        onClick={() => onUpdateDraft(cur => ({ ...cur, seed: lastGeneratedSeed }), true)}
                        className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                      >
                        <Lock className="h-2.5 w-2.5" />
                        <span>{t('锁上次 Seed')} ({lastGeneratedSeed})</span>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={4294967295}
                      aria-label={t('随机种子')}
                      value={draft.seed ?? ''}
                      onChange={e => {
                        const raw = e.target.value.trim();
                        onUpdateDraft(cur => ({
                          ...cur,
                          seed: raw === '' ? undefined : Math.max(0, Math.min(4294967295, Math.floor(Number(raw) || 0))),
                        }), false);
                      }}
                      onBlur={() => onUpdateDraft(cur => cur, true)}
                      placeholder={t('留空每次随机')}
                      className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50/70 px-2.5 py-1 text-xs font-mono text-gray-800 outline-none focus:border-indigo-400 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                    <button
                      type="button"
                      title={t('清空 Seed，恢复随机')}
                      aria-label={t('随机 Seed')}
                      onClick={() => onUpdateDraft(cur => ({ ...cur, seed: undefined }), true)}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    >
                      <Dices className="h-3.5 w-3.5" /> {t('随机')}
                    </button>
                  </div>
                </div>

                {(() => {
                  const isMedium = draft.v5Model === 'nai-diffusion-5-full-medium';
                  return (
                    <>
                      <label className="block">
                        <span className="mb-1 flex items-center justify-between text-[11px] text-gray-600 dark:text-gray-300">
                          <span>{t('步数 (Steps)')}</span>
                          <span className="font-mono">{isMedium ? '14' : draft.steps}</span>
                        </span>
                        <input
                          type="range"
                          aria-label={t('生图步数')}
                          min={10}
                          max={28}
                          disabled={isMedium}
                          value={isMedium ? 14 : draft.steps}
                          onChange={e => onUpdateDraft(cur => ({ ...cur, steps: Number(e.target.value) }), false)}
                          className="w-full accent-indigo-600 disabled:opacity-40"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 flex items-center justify-between text-[11px] text-gray-600 dark:text-gray-300">
                          <span>{t('引导强度 (CFG)')}</span>
                          <span className="font-mono">{draft.scale.toFixed(1)}</span>
                        </span>
                        <input
                          type="range"
                          aria-label={t('引导强度')}
                          min={1}
                          max={12}
                          step={0.5}
                          value={draft.scale}
                          onChange={e => onUpdateDraft(cur => ({ ...cur, scale: Number(e.target.value) }), false)}
                          className="w-full accent-indigo-600"
                        />
                      </label>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">{t('采样器')}</span>
                          <select
                            aria-label={t('采样器')}
                            disabled={isMedium}
                            value={isMedium ? 'k_euler_ancestral' : draft.sampler}
                            onChange={e => onUpdateDraft(cur => ({ ...cur, sampler: e.target.value }), true)}
                            className="w-full rounded-lg border border-gray-200 bg-gray-50/70 px-2 py-1 text-[11px] text-gray-800 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          >
                            <option value="k_euler_ancestral">Euler Ancestral</option>
                            <option value="k_euler">Euler</option>
                            <option value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</option>
                            <option value="k_dpmpp_2m_sde">DPM++ 2M SDE</option>
                            <option value="k_dpmpp_sde">DPM++ SDE</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">{t('噪声调度')}</span>
                          <select
                            aria-label={t('噪声调度')}
                            value={draft.noiseSchedule}
                            onChange={e => onUpdateDraft(cur => ({ ...cur, noiseSchedule: e.target.value as ComicPageDraft['noiseSchedule'] }), true)}
                            className="w-full rounded-lg border border-gray-200 bg-gray-50/70 px-2 py-1 text-[11px] text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          >
                            <option value="karras">Karras</option>
                            <option value="exponential">Exponential</option>
                            <option value="polyexponential">Polyexponential</option>
                            <option value="native">Native</option>
                          </select>
                        </label>
                      </div>

                      <label className="block">
                        <span className="mb-1 flex items-center justify-between text-[11px] text-gray-600 dark:text-gray-300">
                          <span>{t('提示词引导重缩放 (CFG Rescale)')}</span>
                          <span className="font-mono">{(isMedium ? 0 : draft.cfgRescale).toFixed(2)}</span>
                        </span>
                        <input
                          type="range"
                          aria-label={t('CFG 重缩放')}
                          min={0}
                          max={1}
                          step={0.05}
                          disabled={isMedium}
                          value={isMedium ? 0 : draft.cfgRescale}
                          onChange={e => onUpdateDraft(cur => ({ ...cur, cfgRescale: Number(e.target.value) }), false)}
                          className="w-full accent-indigo-600 disabled:opacity-40"
                        />
                      </label>
                      {isMedium && (
                        <p className="text-[10px] text-gray-400">
                          {t('V5 Medium 固定 14 步与 Euler Ancestral')}
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            </details>
          </div>

          <div className="appearance-surface flex-none border-t border-gray-200/80 p-3 dark:border-gray-800/80">
            <button
              type="button"
              onClick={() => onSelectTab('panel')}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500"
            >
              <span>{t('下一步：分镜生图')}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </>
      )}

      {/* ==================== 标签 3：嵌字与图层 ==================== */}
      {activeTab === 'layers' && (
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3.5 pb-6 text-xs">
          {/* 顶部常驻快捷添加：进到第 3 步就能直接开工 */}
          {(onQuickAddBubble || onQuickAddText || onQuickAddSticker) && (
            <div className="grid grid-cols-3 gap-1.5">
              {onQuickAddBubble && (
                <button
                  type="button"
                  onClick={onQuickAddBubble}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200/90 bg-white px-2 py-1.5 text-[11px] font-semibold text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-200"
                >
                  <MessageCircle className="h-3.5 w-3.5 text-amber-500" />
                  <span>{t('添加气泡')}</span>
                </button>
              )}
              {onQuickAddText && (
                <button
                  type="button"
                  onClick={onQuickAddText}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200/90 bg-white px-2 py-1.5 text-[11px] font-semibold text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-200"
                >
                  <Type className="h-3.5 w-3.5 text-indigo-500" />
                  <span>{t('添加文字')}</span>
                </button>
              )}
              {onQuickAddSticker && (
                <button
                  type="button"
                  onClick={onQuickAddSticker}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200/90 bg-white px-2 py-1.5 text-[11px] font-semibold text-gray-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-200"
                >
                  <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                  <span>{t('添加贴纸')}</span>
                </button>
              )}
            </div>
          )}

          {/* 当前选中的气泡 / 文字 / 贴纸属性编辑 */}
          {selectedBubble && (() => {
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

                {/* 气泡样式：默认精简 4 款，点击按需展开全部 12 款 */}
                <div className="space-y-1">
                  <div className={`grid gap-1 ${showAllBubbleShapes ? 'grid-cols-3' : 'grid-cols-4'}`}>
                    {displayedShapes.map(shape => (
                      <button
                        key={shape.id}
                        type="button"
                        aria-pressed={selectedBubble.shape === shape.id}
                        onClick={() => onUpdateBubble(selectedBubble.id, i => ({
                          ...i,
                          shape: shape.id,
                          hasTail: shape.supportsTail ? i.hasTail : false,
                        }), true)}
                        className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1 text-[10px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500 ${selectedBubble.shape === shape.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/70 dark:text-indigo-100' : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-800/85 dark:text-slate-100 dark:hover:border-indigo-400'}`}
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

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-gray-500">{t('字号')} {selectedBubble.fontSize}px</span>
                    <input type="range" min={12} max={56} value={selectedBubble.fontSize} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, fontSize: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-gray-500">{t('漫画字体')}</span>
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
                  </label>
                </div>

                {/* 快捷配色预设 */}
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
                        <input type="range" aria-label={t('气泡旋转角度')} min={-45} max={45} value={selectedBubble.rotation} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, rotation: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-gray-500">{t('边框粗细')} {selectedBubble.strokeWidth}px</span>
                        <input type="range" aria-label={t('气泡边框粗细')} min={0} max={10} value={selectedBubble.strokeWidth} onChange={e => onUpdateBubble(selectedBubble.id, i => ({ ...i, strokeWidth: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
                      </label>
                    </div>
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
                <label className="block">
                  <span className="mb-1 block text-gray-500">{t('漫画字体')}</span>
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
                </label>
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
              <div className="flex items-center justify-between">
                <span className="truncate font-bold text-gray-800 dark:text-gray-100">{t('当前图片图层')} · {selectedImageLayer.name}</span>
                <button type="button" aria-label={t('删除图片图层')} onClick={() => onDeleteImageLayer(selectedImageLayer.id)} className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-gray-500">{t('宽度')} {Math.round(selectedImageLayer.width * 100)}%</span>
                  <input type="range" min={8} max={100} value={Math.round(selectedImageLayer.width * 100)} onChange={e => onUpdateImageLayer(selectedImageLayer.id, item => ({ ...item, width: Number(e.target.value) / 100 }), false)} className="w-full accent-indigo-600" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-gray-500">{t('高度')} {Math.round(selectedImageLayer.height * 100)}%</span>
                  <input type="range" min={8} max={100} value={Math.round(selectedImageLayer.height * 100)} onChange={e => onUpdateImageLayer(selectedImageLayer.id, item => ({ ...item, height: Number(e.target.value) / 100 }), false)} className="w-full accent-indigo-600" />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-gray-500">{t('旋转')} {selectedImageLayer.rotation}°</span>
                <input type="range" min={-180} max={180} value={selectedImageLayer.rotation} onChange={e => onUpdateImageLayer(selectedImageLayer.id, item => ({ ...item, rotation: Number(e.target.value) }), false)} className="w-full accent-indigo-600" />
              </label>
            </div>
          )}

          {/* 本页气泡 / 文字 / 贴纸大纲列表 */}
          <div className="space-y-1.5">
            <div className="font-bold text-gray-700 dark:text-gray-200">{t('页面嵌字与贴纸')}</div>
            {overlayCount === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-200 p-3 text-center text-[11px] text-gray-400 dark:border-gray-700">
                {t('点击上方快捷按钮或画布底部工具栏添加气泡、文字或贴纸')}
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
                    <ComicStickerIcon kind={st.kind} className="h-3.5 w-3.5 flex-none text-purple-500" />
                    <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-100">
                      {t(STICKER_KINDS.find(k => k.id === st.kind)?.label || st.kind)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 开源免费商用漫画字体库（按需缓存至 local-cache/comic-fonts/）+ 本机字体导入 */}
          <div className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                aria-expanded={fontManagerOpen}
                onClick={() => setFontManagerOpen(open => !open)}
                className="flex items-center gap-1.5 font-bold text-gray-700 hover:text-indigo-600 dark:text-gray-200 dark:hover:text-indigo-300"
              >
                <Type className="h-3.5 w-3.5 text-indigo-500" />
                <span>{t('开源漫画字体库')}</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {fontCatalog.fonts.filter(f => f.installed).length + fontCatalog.customFonts.length}/{fontCatalog.fonts.length}
                </span>
              </button>
              <div>
                <input
                  ref={fontFileInputRef}
                  type="file"
                  accept=".ttf,.otf,.woff2,.woff"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) onUploadCustomFont(file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fontFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                >
                  <Upload className="h-3 w-3" /> {t('导入本机字体')}
                </button>
              </div>
            </div>

            {fontManagerOpen && (
              <div className="space-y-1.5 rounded-xl border border-gray-200/80 bg-gray-50/70 p-2 dark:border-gray-800 dark:bg-gray-800/40">
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  {t('开源商用字体，下载后离线生效')}
                </p>
                {fontCatalog.fonts.map(font => {
                  const isBusy = downloadingFontId === font.id || font.downloading;
                  return (
                    <div
                      key={font.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-gray-200/80 bg-white px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="truncate font-semibold text-gray-800 dark:text-gray-100">{font.name}</span>
                          {font.installed && (
                            <span className="rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                              {t('已缓存')}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[10px] text-gray-400">
                          {font.styleTag} · ~{font.approxSizeMB}MB
                        </div>
                      </div>
                      {font.installed ? (
                        <div className="flex flex-none items-center gap-1">
                          {(selectedBubble || selectedText) && (
                            <button
                              type="button"
                              onClick={() => {
                                if (selectedBubble) onUpdateBubble(selectedBubble.id, i => ({ ...i, fontFamily: font.id }), true);
                                else if (selectedText) onUpdateText(selectedText.id, i => ({ ...i, fontFamily: font.id }), true);
                              }}
                              className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                            >
                              {t('应用')}
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={t('移除缓存字体 {0}', [font.name])}
                            onClick={() => onDeleteFont(font.id)}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={Boolean(downloadingFontId) || isBusy}
                          onClick={() => onDownloadFont(font.id)}
                          className="inline-flex flex-none items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
                        >
                          {isBusy ? <InlineSpinner className="h-3 w-3 text-white" /> : <Download className="h-3 w-3" />}
                          <span>{isBusy ? t('下载中…') : t('下载')}</span>
                        </button>
                      )}
                    </div>
                  );
                })}

                {fontCatalog.customFonts.length > 0 && (
                  <div className="space-y-1 border-t border-gray-200/80 pt-1.5 dark:border-gray-700">
                    <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">{t('我导入的本机字体')}</div>
                    {fontCatalog.customFonts.map(font => (
                      <div
                        key={font.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-indigo-200/70 bg-white px-2 py-1 dark:border-indigo-900/60 dark:bg-gray-900"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-gray-800 dark:text-gray-100">{font.name}</span>
                        <div className="flex flex-none items-center gap-1">
                          {(selectedBubble || selectedText) && (
                            <button
                              type="button"
                              onClick={() => {
                                if (selectedBubble) onUpdateBubble(selectedBubble.id, i => ({ ...i, fontFamily: font.id }), true);
                                else if (selectedText) onUpdateText(selectedText.id, i => ({ ...i, fontFamily: font.id }), true);
                              }}
                              className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                            >
                              {t('应用')}
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={t('删除导入字体 {0}', [font.name])}
                            onClick={() => onDeleteFont(font.id)}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
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
};
