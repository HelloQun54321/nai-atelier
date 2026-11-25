import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, FileText, Folder, Image as ImageIcon, ImagePlus, Layers, LoaderCircle, Trash2 } from 'lucide-react';
import type { PromptChain } from '../types';
import { t } from '../services/i18n';
import { getCustomChainTags } from '../services/chainTags';
import { librarySectionOf, type PromptCardBadge } from '../services/promptLibraryEntries';
import { useGalleryFrostedCaption } from '../services/appearancePreferences';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { PressRevealSurface } from './PressRevealSurface';
import { SmartImage } from './SmartImage';
import { ImageCardActions } from './ImageCardActions';
import { IMAGE_CARD_ACTION_CLASS, IMAGE_CARD_ACTION_TONE, ImageShareActions } from './ImageShareActions';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { useConfirmDialog } from './ConfirmDialog';
import { PromptLibraryCoverGenerateButton, PromptLibraryCoverGenerationStatus } from './usePromptLibraryCoverActions';
import { promptLibraryCoverGenerationBusy, type PromptLibraryCoverGeneration } from '../services/promptLibraryCoverGeneration';

const BADGE_CLASS: Record<PromptCardBadge['kind'], string> = {
  folder: 'gallery-card-badge inline-flex max-w-28 items-center gap-1 truncate rounded-md bg-gray-100 px-1.5 py-0.5 text-micro text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  purpose: 'gallery-card-badge inline-flex max-w-28 truncate rounded-md bg-indigo-50 px-1.5 py-0.5 text-micro text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
  character: 'gallery-card-badge inline-flex max-w-28 truncate rounded-md bg-emerald-50 px-1.5 py-0.5 text-micro text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  negative: 'gallery-card-badge inline-flex max-w-24 truncate rounded-md bg-amber-50 px-1.5 py-0.5 text-micro text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  tag: 'gallery-card-badge inline-flex max-w-24 truncate rounded-md bg-gray-100 px-1.5 py-0.5 text-micro text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

const stopActionEvent = (event: React.SyntheticEvent) => { event.stopPropagation(); };

/**
 * 提示词库混合形态卡片：
 * - 有封面（含流式生成中预览）：沿用全站 2:3 磨砂视觉图卡；
 * - 无封面：紧凑轻爽文字卡（标题 + 提示词正文预览 + 去重分类胶囊 + 悬停一键复制/生成封面/删除）。
 */
export function PromptLibraryCard({
  chain,
  label: _label,
  title,
  summary,
  bilingualPreview,
  tagContent,
  badges,
  copyText,
  usageCount = 0,
  openLabel,
  selected = false,
  selecting = false,
  checked = false,
  onToggleSelect,
  dimmed = false,
  busy = false,
  deleteDisabled = busy,
  draggable = false,
  onDragStart,
  onOpen,
  onDelete,
  onClearCover,
  actions,
  mediaInfo,
  notify,
  coverGeneration,
  coverBusy = false,
  coverDisabled = false,
  onGenerateCover,
  onManageCoverGeneration,
}: {
  chain: PromptChain;
  label?: string;
  title?: React.ReactNode;
  summary?: React.ReactNode;
  bilingualPreview?: string;
  tagContent?: React.ReactNode;
  badges?: PromptCardBadge[];
  copyText?: string;
  usageCount?: number;
  openLabel?: string;
  selected?: boolean;
  selecting?: boolean;
  checked?: boolean;
  onToggleSelect?: () => void;
  dimmed?: boolean;
  busy?: boolean;
  deleteDisabled?: boolean;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLElement>;
  onOpen: () => void;
  onDelete?: () => void;
  onClearCover?: () => Promise<void>;
  actions?: React.ReactNode;
  mediaInfo?: React.ReactNode;
  notify: (message: string, kind?: 'success' | 'error') => void;
  coverGeneration?: PromptLibraryCoverGeneration;
  coverBusy?: boolean;
  coverDisabled?: boolean;
  onGenerateCover?: () => void;
  onManageCoverGeneration?: (chainId: string, action: 'approve' | 'resume') => Promise<void>;
}) {
  const frosted = useGalleryFrostedCaption();
  const confirm = useConfirmDialog();
  const clearLock = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clearing, setClearing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imageRatio, setImageRatio] = useState<{ src: string; value: number }>();

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const name = chain.name?.trim() || t('未命名');
  const section = librarySectionOf(chain);
  const combination = section === 'saved';
  const streamingPreview = coverGeneration?.session?.preview?.image
    || (coverGeneration?.phase === 'save_failed' || coverGeneration?.phase === 'saving' ? coverGeneration.item?.imageUrl : coverGeneration?.phase === 'failed' ? coverGeneration.preview : undefined)
    || coverGeneration?.previewImage;
  const imageSrc = streamingPreview || chain.previewImage;
  const ratio = imageRatio && imageRatio.src === imageSrc ? imageRatio.value : 2 / 3;
  const showClearCover = Boolean(!selecting && onClearCover && chain.previewImage && coverGeneration?.phase !== 'save_failed' && coverGeneration?.phase !== 'saving');
  const effectiveCopyText = copyText ?? (chain.basePrompt || '').trim();
  const activeHighlight = selecting ? checked : selected;
  const coverStatusVisible = Boolean(
    onGenerateCover && onManageCoverGeneration && (
      coverBusy
      || promptLibraryCoverGenerationBusy(coverGeneration)
      || Boolean(coverGeneration?.error || coverGeneration?.session?.awaiting || coverGeneration?.session?.connectionError)
      || coverGeneration?.phase === 'save_failed'
      || coverGeneration?.session?.state === 'paused'
    ),
  );

  const handleCopyPrompt = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!effectiveCopyText) {
      notify(t('还没有提示词'), 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(effectiveCopyText);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
      notify(t('已复制提示词'));
    } catch {
      notify(t('复制失败，请手动选择文本'), 'error');
    }
  };

  const clearCover = async () => {
    if (!onClearCover || clearLock.current || !chain.previewImage) return;
    clearLock.current = true;
    try {
      if (!await confirm({
        title: t('删除这张封面？'),
        message: t('只清除条目封面，历史、收藏和原图保留。'),
        confirmLabel: t('删除当前封面'),
        tone: 'danger',
        rememberKey: 'prompt-library-cover.delete',
      })) return;
      setClearing(true);
      await onClearCover();
      notify(t('已清除封面'));
    } catch (cause) {
      notify(t('清除封面失败：{0}', [cause instanceof Error ? cause.message : String(cause)]), 'error');
    } finally {
      clearLock.current = false;
      setClearing(false);
    }
  };

  const renderBadgeRow = () => {
    if (tagContent) return tagContent;
    if (badges) {
      return badges.map(badge => (
        <span key={badge.key} className={BADGE_CLASS[badge.kind]}>
          {badge.kind === 'folder' && <Folder className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />}
          <span className="truncate">{badge.label}</span>
        </span>
      ));
    }
    return getCustomChainTags(chain.tags).slice(0, 3).map(tag => (
      <span key={tag} className={BADGE_CLASS.tag}>{tag}</span>
    ));
  };

  const handleActivate = () => {
    if (busy) return;
    if (selecting) onToggleSelect?.();
    else onOpen();
  };

  const commonProps = {
    as: 'article' as const,
    'data-agent-action': selecting ? 'select' : 'browse',
    role: selecting ? ('checkbox' as const) : ('button' as const),
    tabIndex: 0,
    'aria-label': selecting ? t('选择提示词：{0}', [name]) : (openLabel || t('查看{0}', [name])),
    'aria-checked': selecting ? checked : undefined,
    'aria-pressed': selecting ? undefined : selected,
    'aria-busy': busy,
    'aria-disabled': busy,
    pressDisabled: busy || selecting,
    draggable: Boolean(draggable && !busy),
    onDragStart,
    'data-prompt-library-entry': chain.id,
    'data-prompt-library-id': chain.id,
    'data-return-item-id': chain.id,
    'data-gallery-work-id': chain.id,
    'data-safe-mode-work': 'true',
    onClick: handleActivate,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        handleActivate();
      }
    },
  };

  if (imageSrc) {
    return (
      <PressRevealSurface
        {...commonProps}
        className={`appearance-group mobile-gallery-item gallery-image-card gallery-card-visual group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white text-left transition-[filter,border-color] focus-visible:outline-2 focus-visible:outline-indigo-500 dark:bg-gray-850 ${activeHighlight ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-200 dark:border-gray-800'} ${!selecting && dimmed ? 'brightness-[.7]' : ''}`}
        style={{ display: frosted ? 'grid' : undefined }}
      >
        <div className="appearance-media mobile-gallery-frame relative aspect-[2/3] w-full overflow-hidden" style={{ '--mobile-image-ratio': ratio } as React.CSSProperties}>
          <SmartImage
            src={imageSrc}
            alt={name}
            thumbnailVariant="thumb-640"
            className="h-full w-full object-cover"
            containerClassName="h-full w-full"
            onLoad={event => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth && naturalHeight) {
                setImageRatio(previous => (previous && previous.src === imageSrc && previous.value === naturalWidth / naturalHeight ? previous : { src: imageSrc, value: naturalWidth / naturalHeight }));
              }
            }}
          />
          {selecting && (
            <span
              aria-hidden="true"
              className={`absolute left-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border shadow ${checked ? 'border-indigo-500 bg-indigo-700 text-white dark:bg-indigo-600' : 'border-white/80 bg-black/35 text-transparent'}`}
            >
              <Check className="h-4 w-4" />
            </span>
          )}
          {!selecting && onDelete && (
            <div data-card-action data-image-action-left className="hover-reveal-md absolute left-2 top-2 z-20">
              <button
                type="button"
                disabled={deleteDisabled}
                aria-label={t('删除「{0}」', [name])}
                title={t('删除')}
                onClick={event => { event.stopPropagation(); onDelete(); }}
                className={`${IMAGE_CARD_ACTION_CLASS} ${IMAGE_CARD_ACTION_TONE.delete} inline-flex items-center justify-center disabled:opacity-50`}
              >
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          )}
          {showClearCover && (
            <div
              data-card-action
              data-image-action-left
              className={`absolute left-2 z-20 ${onDelete ? 'top-14 md:top-11' : 'top-2'}`}
              onClick={stopActionEvent}
              onPointerDown={stopActionEvent}
              onKeyDown={stopActionEvent}
            >
              <button
                type="button"
                aria-label={t('删除当前封面')}
                title={t('删除当前封面')}
                disabled={busy || coverBusy || clearing || deleteDisabled}
                onClick={() => void clearCover()}
                className={`${IMAGE_CARD_ACTION_CLASS} hover-reveal-md flex items-center justify-center`}
              >
                <span className="relative" aria-hidden="true">
                  <ImageIcon className="h-4 w-4" />
                  <Trash2 className="appearance-contrast absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-full bg-gray-900 p-px" />
                </span>
              </button>
            </div>
          )}
          {mediaInfo}
          {!selecting && onGenerateCover && onManageCoverGeneration && (
            <PromptLibraryCoverGenerationStatus
              chainId={chain.id}
              generation={coverGeneration}
              busy={coverBusy}
              hasCover={Boolean(chain.previewImage)}
              onRetryGenerate={onGenerateCover}
              manageGeneration={onManageCoverGeneration}
            />
          )}
          {!selecting && (
            <ImageCardActions>
              {chain.previewImage && (
                <ImageShareActions
                  variant="card"
                  className="flex-col"
                  showTransfer={false}
                  imageUrl={chain.previewImage}
                  filename={`${name}.png`}
                  notify={notify}
                  favorite={{ imageUrl: chain.previewImage, title: name, sourceType: 'other', sourceId: chain.id }}
                />
              )}
              {effectiveCopyText && (
                <button
                  type="button"
                  aria-label={t('复制提示词')}
                  title={t('复制提示词')}
                  onClick={event => void handleCopyPrompt(event)}
                  className={`hover-reveal-md inline-flex items-center justify-center ${IMAGE_CARD_ACTION_CLASS}`}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              )}
              {onGenerateCover && (
                <PromptLibraryCoverGenerateButton
                  hasCover={Boolean(chain.previewImage)}
                  disabled={busy || coverBusy || coverDisabled}
                  onClick={onGenerateCover}
                />
              )}
              {actions}
            </ImageCardActions>
          )}
        </div>
        <div className="gallery-card-caption min-w-0 p-3">
          {summary && <p className="line-clamp-1 break-words text-xs text-gray-600 dark:text-gray-300">{summary}</p>}
          <h3 data-safe-mode-title className={`${summary ? 'mt-1' : ''} min-w-0 truncate text-sm font-bold text-gray-800 dark:text-gray-100`}>{title ?? name}</h3>
          <div className="gallery-card-meta mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
            {renderBadgeRow()}
            {usageCount > 0 && <span className="ml-auto text-micro tabular-nums opacity-75">{t('{0} 图', [usageCount])}</span>}
          </div>
        </div>
      </PressRevealSurface>
    );
  }

  return (
    <PressRevealSurface
      {...commonProps}
      className={`appearance-group prompt-text-card group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-3.5 text-left transition-[filter,border-color] focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-gray-800 dark:bg-gray-850 ${activeHighlight ? 'border-indigo-500 ring-2 ring-indigo-500/20' : ''} ${!selecting && dimmed ? 'brightness-[.7]' : ''}`}
    >
      <div className="flex items-start gap-2">
        {selecting ? (
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${checked ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-300 bg-transparent text-transparent dark:border-gray-600'}`}
          >
            <Check className="h-3.5 w-3.5" />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${combination ? 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300' : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300'}`}
          >
            {combination ? <Layers className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
          </span>
        )}
        <h3 data-safe-mode-title className="min-w-0 flex-1 truncate pt-0.5 text-sm font-bold text-gray-900 dark:text-gray-100">
          {title ?? name}
        </h3>
      </div>

      {!selecting && (
        <div
          data-card-action
          onClick={stopActionEvent}
          onPointerDown={stopActionEvent}
          onKeyDown={stopActionEvent}
          className="hover-reveal-md absolute right-2 top-2 z-20 flex items-center gap-0.5 rounded-xl bg-white/95 p-0.5 shadow-sm ring-1 ring-black/5 dark:bg-gray-850/95 dark:ring-white/10"
        >
          {effectiveCopyText && (
            <button
              type="button"
              aria-label={t('复制提示词')}
              title={t('复制提示词')}
              onClick={event => void handleCopyPrompt(event)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
          {onGenerateCover && (
            <button
              type="button"
              aria-label={t('生成封面')}
              title={t('生成封面')}
              disabled={busy || coverBusy || coverDisabled}
              onClick={event => { event.stopPropagation(); onGenerateCover(); }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              disabled={deleteDisabled}
              aria-label={t('删除「{0}」', [name])}
              title={t('删除')}
              onClick={event => { event.stopPropagation(); onDelete(); }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
            >
              {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          )}
          {actions}
        </div>
      )}

      {bilingualPreview && (
        <p className="mt-1.5 line-clamp-1 break-words text-xs text-gray-500 dark:text-gray-400">{bilingualPreview}</p>
      )}
      <p className={`${bilingualPreview ? 'mt-1' : 'mt-2'} line-clamp-5 break-words font-mono text-xs leading-relaxed text-gray-600 dark:text-gray-300`}>
        {summary || chain.basePrompt || t('还没有提示词')}
      </p>

      <div className={`mt-3 flex min-w-0 flex-wrap items-center gap-1.5 ${coverStatusVisible ? 'pr-9' : ''}`}>
        {renderBadgeRow()}
        {usageCount > 0 && (
          <span className="ml-auto text-micro tabular-nums text-gray-400 dark:text-gray-500">{t('{0} 图', [usageCount])}</span>
        )}
      </div>

      {!selecting && onGenerateCover && onManageCoverGeneration && (
        <PromptLibraryCoverGenerationStatus
          chainId={chain.id}
          generation={coverGeneration}
          busy={coverBusy}
          hasCover={Boolean(chain.previewImage)}
          onRetryGenerate={onGenerateCover}
          manageGeneration={onManageCoverGeneration}
        />
      )}
    </PressRevealSurface>
  );
}

export function PromptLibraryGallery({ chains, scrollRef, fitColumns = false, freezeColumns = false, resetKey, renderCard }: {
  chains: PromptChain[]; scrollRef: React.RefObject<HTMLDivElement | null>; fitColumns?: boolean; freezeColumns?: boolean; resetKey: string; renderCard: (chain: PromptChain) => React.ReactNode;
}) {
  const preferences = useMobileImageDisplayPreferences();
  const frosted = useGalleryFrostedCaption();
  const columns = useMasonryColumnCount(preferences, undefined, scrollRef, 180, fitColumns, freezeColumns);
  return preferences.layout === 'masonry'
    ? <ShortestColumnMasonry items={chains} columns={columns} resetKey={resetKey} getItemKey={chain => chain.id} estimateItemHeight={(chain, width) => chain.previewImage ? width * 1.5 + (frosted ? 4 : 68) : 168} renderItem={renderCard} />
    : <div className={`${mobileGalleryClassName(preferences)} workspace-card-grid workspace-character-grid items-start`} style={mobileGalleryStyle(preferences, columns)}>{chains.map(chain => <React.Fragment key={chain.id}>{renderCard(chain)}</React.Fragment>)}</div>;
}
