import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Image as ImageIcon,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import type { PromptChain } from '../../types';
import { t } from '../../services/i18n';
import { formatGenerationCostLabel } from '../../services/anlasBudget';
import { searchCharacterDictionary, type CharacterDictionaryEntry } from '../../services/tagDictionary';
import {
  clampAnchorCoord,
  getPanelBoundingBox,
  getPanelTargetResolution,
} from '../../services/comic/comicGeometry';
import {
  COMIC_ANCHOR_HARD_LIMIT,
  COMIC_ANCHOR_SOFT_LIMIT,
  evaluateAnchorGuard,
} from '../../services/comic/comicPromptBuilder';
import type {
  ComicAnchor,
  ComicAnchorKind,
  ComicBubbleShape,
  ComicPageDraft,
  ComicPanel,
  ComicSelection,
} from '../../services/comic/comicTypes';
import { createUuid } from '../../services/id';
import { InlineSpinner } from '../DesignSystem';
import type { PromptTidyOptions } from '../PromptTidyActions';
import {
  ANCHOR_META,
  AnchorCharacterPicker,
  BubbleAnchorEditor,
  ComicPromptField,
  NEGATIVE_LIBRARY_FIELD,
  POSITIVE_LIBRARY_FIELD,
} from './ComicInspectorShared';

interface ComicInspectorManualPanelTabProps {
  draft: ComicPageDraft;
  activePanel?: ComicPanel;
  allCharacterChains: PromptChain[];
  generatingPanelId: string | null;
  batchGeneratingManual: boolean;
  batchProgressText: string;
  generationStageText: string;
  estimatedCost: number;
  promptTidyOption?: PromptTidyOptions;
  copyPrompt: (value: string, label: string) => void;
  onSelect: (selection: ComicSelection) => void;
  onQuickAddPanel: () => void;
  onUpdatePanel: (panelId: string, updater: (panel: ComicPanel) => ComicPanel, commit?: boolean) => void;
  onDeletePanel: (panelId: string) => void;
  onUploadImageToPanel?: (panelId: string, file: File) => void;
  onOpenHistoryPicker: () => void;
  onTogglePanelOverlay?: (panelId: string) => void;
  onTogglePanelBorderless?: (panelId: string) => void;
  onGeneratePanel: (panelId: string) => void;
  onGenerateAllPanels: () => void;
  onCancelGeneration: () => void;
  onConvertSingleAnchorBubbleToVector: (target: { kind: 'ai-anchor'; anchorId: string } | { kind: 'panel-anchor'; panelId: string; anchorId: string }) => void;
}

/** 漫画工作台步骤 2B：手动逐格生图、格内定位锚点与单格边框样式控制。 */
export const ComicInspectorManualPanelTab: React.FC<ComicInspectorManualPanelTabProps> = ({
  draft,
  activePanel,
  allCharacterChains,
  generatingPanelId,
  batchGeneratingManual,
  batchProgressText,
  generationStageText,
  estimatedCost,
  promptTidyOption,
  copyPrompt,
  onSelect,
  onQuickAddPanel,
  onUpdatePanel,
  onDeletePanel,
  onUploadImageToPanel,
  onOpenHistoryPicker,
  onTogglePanelOverlay,
  onTogglePanelBorderless,
  onGeneratePanel,
  onGenerateAllPanels,
  onCancelGeneration,
  onConvertSingleAnchorBubbleToVector,
}) => {
  const [selectedAnchorId, setSelectedAnchorId] = useState<string>('');
  const anchorStageRef = useRef<HTMLDivElement>(null);
  const draggingAnchorRef = useRef<string | null>(null);
  const panelFileInputRef = useRef<HTMLInputElement>(null);

  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [charQuery, setCharQuery] = useState('');
  const [charDictResults, setCharDictResults] = useState<CharacterDictionaryEntry[]>([]);
  const [charDictLoading, setCharDictLoading] = useState(false);

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

  return (
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
                    onClick={onOpenHistoryPicker}
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
  );
};
