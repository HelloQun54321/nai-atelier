import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  MessageCircle,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  Wand2,
  X,
} from 'lucide-react';
import type { PromptChain } from '../../types';
import { t } from '../../services/i18n';
import { formatGenerationCostLabel } from '../../services/anlasBudget';
import { searchCharacterDictionary, type CharacterDictionaryEntry } from '../../services/tagDictionary';
import { clampAnchorCoord } from '../../services/comic/comicGeometry';
import { encodeDanbooruCastId, parseDanbooruCastId } from '../../services/comic/comicPromptBuilder';
import type { ComicAiZonePlan } from '../../services/comic/comicAiPageEngine';
import { resolveLayoutLockConfig } from '../../services/comic/comicLayoutTemplateRenderer';
import type { ComicBubbleCandidate } from '../../services/comic/comicBubbleDetector';
import type { ComicInpaintDraft } from '../../services/comic/comicInpaintEngine';
import type {
  ComicAiGuidePanel,
  ComicAiPagePlan,
  ComicAnchor,
  ComicAnchorKind,
  ComicBubbleShape,
  ComicPageDraft,
  ComicSelection,
} from '../../services/comic/comicTypes';
import { createUuid } from '../../services/id';
import { InlineSpinner } from '../DesignSystem';
import {
  ANCHOR_META,
  AnchorCharacterPicker,
  BubbleAnchorEditor,
  ChainThumb,
  ComicPromptField,
  GutterStylePreviewIcon,
  POSITIVE_LIBRARY_FIELD,
} from './ComicInspectorShared';

interface ComicInspectorAiPageTabProps {
  draft: ComicPageDraft;
  aiZonePlan: ComicAiZonePlan;
  inpaintDraft: ComicInpaintDraft | null;
  bubbleCandidates: ComicBubbleCandidate[] | null;
  preserveGuideLayout: boolean;
  comparingOriginalAiImage: boolean;
  selection: ComicSelection;
  allCharacterChains: PromptChain[];
  generatingPanelId: string | null;
  planningAiStoryboard: boolean;
  generatingAiPage: boolean;
  detectingBubbles: boolean;
  inpaintingAiPage: boolean;
  aiGenerationStageText: string;
  generationStageText: string;
  aiEstimatedCost: number;
  copyPrompt: (value: string, label: string) => void;
  onSelect: (selection: ComicSelection) => void;
  onUpdateAiPage: (updater: (aiPage: ComicAiPagePlan) => ComicAiPagePlan, commit?: boolean) => void;
  onTogglePreserveGuideLayout: (preserve: boolean) => void;
  onPlanAiStoryboard: () => void;
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
  onCancelGeneration: () => void;
  onConvertSingleAnchorBubbleToVector: (target: { kind: 'ai-anchor'; anchorId: string } | { kind: 'panel-anchor'; panelId: string; anchorId: string }) => void;
}

/** 漫画工作台步骤 2A：AI 整页编排、定位锚点、成图精修与整页生成控制。 */
export const ComicInspectorAiPageTab: React.FC<ComicInspectorAiPageTabProps> = ({
  draft,
  aiZonePlan,
  inpaintDraft,
  bubbleCandidates,
  preserveGuideLayout,
  comparingOriginalAiImage,
  selection,
  allCharacterChains,
  generatingPanelId,
  planningAiStoryboard,
  generatingAiPage,
  detectingBubbles,
  inpaintingAiPage,
  aiGenerationStageText,
  generationStageText,
  aiEstimatedCost,
  copyPrompt,
  onSelect,
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
  onCancelGeneration,
  onConvertSingleAnchorBubbleToVector,
}) => {
  const [castPickerOpen, setCastPickerOpen] = useState(false);
  const [castQuery, setCastQuery] = useState('');
  const [castDictResults, setCastDictResults] = useState<CharacterDictionaryEntry[]>([]);
  const [castDictLoading, setCastDictLoading] = useState(false);

  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [charQuery, setCharQuery] = useState('');
  const [charDictResults, setCharDictResults] = useState<CharacterDictionaryEntry[]>([]);
  const [charDictLoading, setCharDictLoading] = useState(false);

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

  const characterChains = useMemo(() => {
    const q = charQuery.trim().toLowerCase();
    if (!q) return allCharacterChains.slice(0, 60);
    return allCharacterChains.filter(item =>
      item.name.toLowerCase().includes(q)
      || item.basePrompt?.toLowerCase().includes(q),
    ).slice(0, 60);
  }, [allCharacterChains, charQuery]);

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
};
