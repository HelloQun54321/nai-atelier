import React, { useRef } from 'react';
import { Palette, Plus, Search, UserPlus } from 'lucide-react';
import { t } from '../../services/i18n';
import type { CharacterDictionaryEntry } from '../../services/tagDictionary';
import { COMIC_BUBBLE_SHAPES } from '../../services/comic/comicArtwork';
import { ComicBubbleShapeIcon } from './ComicBubbleShapeIcon';
import type {
  ComicAnchor,
  ComicAnchorKind,
  ComicBubbleShape,
  ComicDialogueMode,
  ComicStickerKind,
  ComicV5ModelId,
} from '../../services/comic/comicTypes';
import type { PromptChain } from '../../types';
import { InlineSpinner } from '../DesignSystem';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { PromptCopyButton } from '../chain/PresetSourceBadges';
import type { PromptTidyOptions } from '../PromptTidyActions';

export type ComicInspectorTab = 'style' | 'panel' | 'layers';

export const POSITIVE_LIBRARY_FIELD = { negative: false } as const;
export const NEGATIVE_LIBRARY_FIELD = { negative: true } as const;

export const ANCHOR_META: Record<ComicAnchorKind, { label: string; dotClass: string; badgeClass: string }> = {
  character: { label: '角色', dotClass: 'bg-blue-600', badgeClass: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' },
  scene: { label: '场景/道具', dotClass: 'bg-emerald-600', badgeClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
  bubble: { label: '气泡点', dotClass: 'bg-amber-600', badgeClass: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
  inset: { label: '特写叠框', dotClass: 'bg-purple-600', badgeClass: 'bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300' },
};

export const STICKER_KINDS: Array<{ id: ComicStickerKind; label: string }> = [
  { id: 'speedlines', label: '速度线' },
  { id: 'sweat', label: '汗滴' },
  { id: 'anger', label: '青筋' },
  { id: 'sparkle', label: '星芒' },
  { id: 'exclamation', label: '惊叹 !' },
  { id: 'question', label: '问号 ?' },
  { id: 'shock', label: '震惊线' },
  { id: 'heart', label: '爱心' },
];

export const CORE_BUBBLE_SHAPE_IDS: ReadonlyArray<ComicBubbleShape> = ['soft', 'oval', 'shout', 'thought'];

export const shortModelLabel = (id: ComicV5ModelId): string => {
  if (id === 'nai-diffusion-5-full-medium') return 'Medium (14步)';
  if (id === 'nai-diffusion-5-curated') return 'Curated';
  return 'High (23步)';
};

/** 复用 Atelier 实验室同款提示词框：自带提示词库取用/保存、整理校对、橡皮擦清空/撤销、复制与常驻 Tag 翻译权重栏。 */
export const ComicPromptField: React.FC<{
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

export const ChainThumb: React.FC<{ image?: string; kind: 'style' | 'character'; sizeClass?: string }> = ({
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

export const GutterStylePreviewIcon: React.FC<{ flashback?: boolean }> = ({ flashback = false }) => (
  <svg viewBox="0 0 28 20" aria-hidden="true" className="h-5 w-7 flex-none rounded border border-gray-300/80 dark:border-gray-600">
    <rect width="28" height="20" fill={flashback ? '#111827' : '#ffffff'} />
    <rect x="2.5" y="2.5" width="23" height="6.5" rx="0.8" fill={flashback ? '#4b5563' : '#e5e7eb'} stroke={flashback ? '#ffffff' : '#111827'} strokeWidth="1.2" />
    <rect x="2.5" y="11" width="10.5" height="6.5" rx="0.8" fill={flashback ? '#4b5563' : '#e5e7eb'} stroke={flashback ? '#ffffff' : '#111827'} strokeWidth="1.2" />
    <rect x="15" y="11" width="10.5" height="6.5" rx="0.8" fill={flashback ? '#4b5563' : '#e5e7eb'} stroke={flashback ? '#ffffff' : '#111827'} strokeWidth="1.2" />
  </svg>
);

export const ComicStickerIcon: React.FC<{ kind: ComicStickerKind; className?: string }> = ({ kind, className = 'h-5 w-5' }) => (
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

export const AnchorCharacterPicker: React.FC<{
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

export const BubbleAnchorEditor: React.FC<{
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
