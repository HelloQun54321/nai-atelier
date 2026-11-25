import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, LoaderCircle, Sparkles, WandSparkles, X } from 'lucide-react';
import type { ChainType, NAIParams, PromptChain } from '../types';
import { t, useLanguage } from '../services/i18n';
import { LAB_DEFAULT_PARAMS } from '../services/labWorkspace';
import { promptAgentService, type PromptLibraryItem } from '../services/promptAgent';
import { inferPurposesFromDirectoryIds, type PromptLibraryTreeState } from '../services/promptLibraryDirectories';
import { promptPurposeLabel, readPromptPurposes, type PromptPurposeId } from '../services/promptPurposes.mjs';
import { removePromptTag, tagDetails } from '../services/promptTagFilter';
import { classifyPromptTags, summarizePromptSources } from '../services/promptProvenance';
import { IconButton, ToolbarButton } from './DesignSystem';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { useMobileHistoryLayer } from './MobileUI';
import { PromptLibraryDirectoryPicker } from './PromptLibraryDirectoryPicker';
import { PromptPurposePicker } from './PromptPurposePicker';
import { TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { isTopmostModal, useModalA11y } from './useModalA11y';

const COUNT_OPTIONS = [1, 2, 3, 4, 5, 6];
const FIELD_CLASS = 'mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LABEL_CLASS = 'text-sm font-semibold text-gray-700 dark:text-gray-200';

export interface PromptLibraryGenerateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, type: ChainType, data?: Partial<PromptChain>) => Promise<string | undefined>;
  onSaved?: () => void;
  directories?: PromptLibraryTreeState;
  initialDirectoryIds?: string[];
  notify: (message: string, type?: 'success' | 'error') => void;
  zIndex?: number;
}

/** 独立 AI 生成提示词片段弹窗：复用当前目录预设与自动用途联动，支持逐标签微调后批量入库。 */
export const PromptLibraryGenerateDialog: React.FC<PromptLibraryGenerateDialogProps> = ({
  open,
  onClose,
  onCreate,
  onSaved,
  directories,
  initialDirectoryIds = [],
  notify,
  zIndex,
}) => {
  useLanguage();
  const [brief, setBrief] = useState('');
  const [generationDirectoryIds, setGenerationDirectoryIds] = useState<string[]>(() => initialDirectoryIds.slice(0, 1));
  const [generationPurposes, setGenerationPurposes] = useState<PromptPurposeId[]>([]);
  const [count, setCount] = useState(1);
  const [detailMode, setDetailMode] = useState<'strict' | 'moderate' | 'detailed'>('detailed');
  const [keepEmpty, setKeepEmpty] = useState(false);
  const [drafts, setDrafts] = useState<PromptLibraryItem[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [savingDrafts, setSavingDrafts] = useState(false);
  const [generatedBy, setGeneratedBy] = useState('');

  const dialogRef = useModalA11y<HTMLDivElement>(open);
  const aliveRef = useRef(true);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    const nextDirs = initialDirectoryIds.slice(0, 1);
    setGenerationDirectoryIds(nextDirs);
    setGenerationPurposes([]);
  }, [open, initialDirectoryIds]);

  const closeGenerator = useCallback(() => {
    if (generating || savingDrafts) return;
    setDrafts(null);
    setPicked(new Set());
    setGeneratedBy('');
    onClose();
  }, [generating, savingDrafts, onClose]);

  const requestClose = useMobileHistoryLayer(open, () => {
    if (generating || savingDrafts) return false;
    closeGenerator();
  }, 'prompt-library-generate');

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopmostModal(dialogRef.current)) return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, requestClose, dialogRef]);

  const inheritedPurposes = directories ? readPromptPurposes(inferPurposesFromDirectoryIds(generationDirectoryIds, directories)) : [];
  const effectivePurposes = generationPurposes.length ? generationPurposes : inheritedPurposes;
  const purposeSummary = generationPurposes.length
    ? `${t('已单独指定')}：${generationPurposes.map(id => t(promptPurposeLabel(id))).join('、')}`
    : inheritedPurposes.length
      ? `${t('跟随目录')}：${inheritedPurposes.map(id => t(promptPurposeLabel(id))).join('、')}`
      : t('未标记用途');

  const generate = async () => {
    const text = brief.trim();
    if (!text) {
      notify(t('请先描述想要的{0}', [t('片段')]), 'error');
      return;
    }
    setGenerating(true);
    try {
      const result = await promptAgentService.generateLibraryPrompt({
        purposes: effectivePurposes,
        ...(directories ? { directories, directoryId: generationDirectoryIds[0] } : {}),
        brief: text,
        count,
        detail: detailMode,
        keepEmpty,
      });
      const list = (Array.isArray(result?.items) ? result.items : []).filter(item => item && String(item.prompt || '').trim());
      if (!list.length) throw new Error(t('没有生成可用的方案，请换个描述再试'));
      if (!aliveRef.current) return;
      setDrafts(list);
      setPicked(new Set(list.map((_, index) => index)));
      setGeneratedBy([result?.provider, result?.model].filter(Boolean).join(' · '));
    } catch (error) {
      console.warn('Prompt library generate failed:', error);
      notify(error instanceof Error && error.message ? error.message : t('生成失败，请稍后重试'), 'error');
    } finally {
      if (aliveRef.current) setGenerating(false);
    }
  };

  const patchDraft = (index: number, patch: Partial<PromptLibraryItem>) => {
    setDrafts(previous => (previous || []).map((item, position) => (position === index ? { ...item, ...patch } : item)));
  };

  const togglePick = (index: number) => setPicked(previous => {
    const next = new Set(previous);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    return next;
  });

  const savePickedDrafts = async () => {
    const indexed = (drafts || []).map((item, index) => ({ item, index }));
    const chosen = indexed.filter(({ item, index }) => picked.has(index) && String(item.prompt || '').trim());
    if (!chosen.length) {
      notify(t('请先勾选要保存的方案'), 'error');
      return;
    }
    setSavingDrafts(true);
    let saved = 0;
    const failures = new Set<number>();
    for (const { item, index } of chosen) {
      try {
        const itemDirIds = directories ? (item.directoryId ? [item.directoryId] : generationDirectoryIds) : [];
        const itemInherited = directories ? readPromptPurposes(inferPurposesFromDirectoryIds(itemDirIds, directories)) : [];
        const candidatePurposes = readPromptPurposes(item.purposes);
        const matchesInherited = Boolean(directories)
          && candidatePurposes.length === itemInherited.length
          && candidatePurposes.every((id, pos) => id === itemInherited[pos]);
        const params = {
          ...LAB_DEFAULT_PARAMS,
          _promptLibrary: { bilingual: String(item.bilingual || ''), references: [] },
          _promptLibraryPurposes: matchesInherited ? [] : candidatePurposes,
          _collectedCategory: 'general',
          ...(directories ? { _promptLibraryDirectoryIds: itemDirIds } : {}),
        } as unknown as NAIParams;
        const newId = await onCreate(
          String(item.name || '').trim() || t('未命名{0}', [t('片段')]),
          String(item.note || ''),
          'preset',
          {
            tags: [],
            basePrompt: String(item.prompt || ''),
            negativePrompt: String(item.negativePrompt || ''),
            params,
            variableValues: { subject: '' },
            modules: [],
          },
        );
        if (!newId) throw new Error('创建提示词条目失败');
        saved++;
      } catch (error) {
        console.warn('Prompt library draft save failed:', error);
        failures.add(index);
      }
    }
    if (!aliveRef.current) return;
    setSavingDrafts(false);
    const remaining = indexed.filter(({ index }) => !picked.has(index) || failures.has(index));
    setDrafts(remaining.map(({ item }) => item));
    setPicked(new Set(remaining.flatMap(({ index }, position) => (failures.has(index) ? [position] : []))));
    if (saved > 0) {
      onSaved?.();
      notify(
        failures.size
          ? t('已保存 {0} 条{1}，{2} 条失败', [saved, t('片段'), failures.size])
          : t('已保存 {0} 条{1}到{2}', [saved, t('片段'), t('提示词库')]),
      );
      if (!remaining.length) closeGenerator();
      return;
    }
    notify(t('保存失败，请稍后重试'), 'error');
  };

  if (!open) return null;

  return (
    <ImagePreviewPortal>
      <div
        style={zIndex ? { zIndex } : undefined}
        className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
        onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('AI 生成片段')}
          className="content-library appearance-panel ui-modal-enter flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900 sm:rounded-2xl"
        >
          <header className="flex flex-none items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-5">
            <WandSparkles className="h-4 w-4 text-indigo-500" aria-hidden="true" />
            <h2 className="min-w-0 flex-1 truncate font-bold text-gray-900 dark:text-white">{t('AI 生成片段')}</h2>
            <IconButton label={t('关闭生成面板')} disabled={generating || savingDrafts} onClick={requestClose}>
              <X />
            </IconButton>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            <label className="block">
              <span className={LABEL_CLASS}>{t('描述你想要的内容')}</span>
              <textarea
                autoFocus
                value={brief}
                onChange={event => setBrief(event.target.value)}
                placeholder={t('描述要生成的提示词内容')}
                aria-label={t('描述你想要的内容')}
                className={`${FIELD_CLASS} h-20 resize-y`}
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {directories && (
                <PromptLibraryDirectoryPicker
                  state={directories}
                  mode="single"
                  includeAll={false}
                  selectedIds={generationDirectoryIds}
                  onChange={setGenerationDirectoryIds}
                  disabled={generating}
                />
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('生成数量')}</span>
                  <select
                    value={count}
                    onChange={event => setCount(Number(event.target.value))}
                    aria-label={t('生成数量')}
                    className={TOOLBAR_FIELD_CLASS}
                  >
                    {COUNT_OPTIONS.map(value => <option key={value} value={value}>{t('{0} 条', [value])}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('详细程度')}</span>
                  <select
                    value={detailMode}
                    onChange={event => setDetailMode(event.target.value as 'strict' | 'moderate' | 'detailed')}
                    aria-label={t('详细程度')}
                    className={TOOLBAR_FIELD_CLASS}
                    data-detail-mode="true"
                  >
                    <option value="strict">{t('严格：只写需求提到的')}</option>
                    <option value="moderate">{t('适度：少量合理补充')}</option>
                    <option value="detailed">{t('详细：按常见搭配补齐')}</option>
                  </select>
                </label>
              </div>
            </div>

            <details className="min-w-0">
              <summary className="appearance-input mobile-touch flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 [&::-webkit-details-marker]:hidden">
                <span className="shrink-0">{t('生成用途')}</span>
                <span className="min-w-0 flex-1 truncate text-gray-500 dark:text-gray-400" title={purposeSummary}>{purposeSummary}</span>
                <ChevronDown className="h-4 w-4 shrink-0" />
              </summary>
              <div className="mt-2 space-y-2">
                {generationPurposes.length > 0 && directories && (
                  <div className="flex justify-end">
                    <button type="button" disabled={generating} onClick={() => setGenerationPurposes([])} className="mobile-touch text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-300">
                      {t('恢复默认')}
                    </button>
                  </div>
                )}
                <PromptPurposePicker
                  label="生成用途"
                  value={generationPurposes}
                  onChange={setGenerationPurposes}
                  disabled={generating}
                />
              </div>
            </details>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={keepEmpty}
                  onChange={event => setKeepEmpty(event.target.checked)}
                  aria-label={t('未提到的限定项保持留空')}
                  data-keep-empty="true"
                  className="h-3.5 w-3.5 accent-indigo-500"
                />
                {t('未提到的限定项保持留空')}
              </label>
              <p className="text-micro text-gray-400 dark:text-gray-500">{t('调用助手模型，可能产生模型费用')}</p>
            </div>

            {drafts && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                    {t('生成候选（{0} 条，已选 {1} 条）', [drafts.length, picked.size])}
                  </span>
                  {generatedBy && (
                    <span className="truncate text-micro text-gray-400" title={generatedBy}>
                      {t('由 {0} 生成', [generatedBy])}
                    </span>
                  )}
                </div>
                {drafts.map((draft, index) => (
                  <div
                    key={index}
                    className={`rounded-2xl border p-3 ${picked.has(index) ? 'border-indigo-300 bg-indigo-50/40 dark:border-indigo-700 dark:bg-indigo-950/20' : 'border-gray-200 dark:border-gray-800'}`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={picked.has(index)}
                        onChange={() => togglePick(index)}
                        aria-label={t('选择方案 {0}', [index + 1])}
                        className="h-4 w-4 flex-none accent-indigo-500"
                      />
                      <input
                        value={draft.name || ''}
                        onChange={event => patchDraft(index, { name: event.target.value })}
                        aria-label={t('方案 {0} 名称', [index + 1])}
                        placeholder={t('方案名称')}
                        className={`${FIELD_CLASS} mt-0 flex-1`}
                      />
                    </div>
                    {draft.filteredWarning && (
                      <p role="status" className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                        {t('过滤后内容过少，已保留原文，请检查。')}
                      </p>
                    )}
                    {Boolean(draft.filtered?.length) && !draft.filteredWarning && (
                      <p className="mt-2 break-words text-xs text-gray-500">
                        {t('已过滤 {0} 个越界标签：{1}', [draft.filtered!.length, draft.filtered!.join(', ')])}
                      </p>
                    )}
                    <label className="mt-2 block">
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t('纯英文（生图用）')}</span>
                      <textarea
                        value={draft.prompt || ''}
                        onChange={event => patchDraft(index, { prompt: event.target.value })}
                        aria-label={t('方案 {0} 英文提示词', [index + 1])}
                        className={`${FIELD_CLASS} h-20 resize-y font-mono`}
                      />
                    </label>
                    <label className="mt-2 block">
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t('中英对照')}</span>
                      <textarea
                        value={draft.bilingual || ''}
                        onChange={event => patchDraft(index, { bilingual: event.target.value })}
                        placeholder={t('模型未返回对照时可留空')}
                        aria-label={t('方案 {0} 中英对照', [index + 1])}
                        className={`${FIELD_CLASS} h-20 resize-y`}
                      />
                    </label>
                    {(() => {
                      const chips = tagDetails(draft.prompt || '', draft.bilingual || '');
                      const marks = classifyPromptTags(draft.prompt || '', { brief, facets: {} });
                      const sourceOf = (tag: string) => marks.find(mark => mark.tag === tag)?.source || 'unmarked';
                      if (!chips.length) return null;
                      return (
                        <div className="mt-1 flex flex-wrap items-center gap-1" data-candidate-tags={index}>
                          <span className="text-micro text-gray-400">{t('逐标签删除')}</span>
                          {(() => {
                            const summary = summarizePromptSources(marks);
                            return (
                              <span className="text-micro text-gray-400" data-candidate-source-summary={index}>
                                {t('用户 {0} · AI {1}', [String(summary.user), String(summary.ai)])}
                              </span>
                            );
                          })()}
                          {chips.map(chip => (
                            <button
                              key={chip.raw}
                              type="button"
                              title={chip.weighted ? t('带权重标签默认不拆，先去掉权重再删') : t('删除这个标签')}
                              onClick={() => {
                                const next = removePromptTag(draft.prompt || '', draft.bilingual || '', chip.tag);
                                if (!next.removed) return;
                                patchDraft(index, { prompt: next.prompt, bilingual: next.bilingual });
                              }}
                              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-micro ${
                                chip.weighted
                                  ? 'border-amber-300 text-amber-600 dark:border-amber-800 dark:text-amber-400'
                                  : 'border-gray-200 text-gray-600 hover:border-red-400 hover:text-red-600 dark:border-gray-700 dark:text-gray-300'
                              }`}
                              data-candidate-tag-source={sourceOf(chip.tag)}
                            >
                              <span
                                aria-hidden
                                className={
                                  sourceOf(chip.tag) === 'user'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : sourceOf(chip.tag) === 'ai'
                                      ? 'text-indigo-500 dark:text-indigo-300'
                                      : 'text-gray-400'
                                }
                              >
                                {sourceOf(chip.tag) === 'user' ? 'U' : sourceOf(chip.tag) === 'ai' ? 'A' : '·'}
                              </span>
                              {chip.tag}
                              {chip.bilingual ? <span className="font-sans text-gray-400">{chip.bilingual}</span> : null}
                              <span aria-hidden>×</span>
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                    <PromptPurposePicker value={draft.purposes || []} onChange={purposes => patchDraft(index, { purposes })} disabled={savingDrafts} />
                    {draft.note && <p className="mt-1 text-micro text-gray-400">{draft.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <footer className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
            <ToolbarButton onClick={() => void generate()} disabled={generating} tone={drafts ? 'neutral' : 'primary'} className="mobile-touch">
              {generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              <span>{generating ? t('生成中…') : drafts ? t('重新生成') : t('开始生成')}</span>
            </ToolbarButton>
            {drafts && (
              <ToolbarButton tone="save" onClick={() => void savePickedDrafts()} disabled={generating || savingDrafts} className="mobile-touch">
                {savingDrafts ? <LoaderCircle className="animate-spin" /> : null}
                <span>{savingDrafts ? t('保存中…') : t('保存选中（{0}）', [picked.size])}</span>
              </ToolbarButton>
            )}
            <ToolbarButton onClick={requestClose} disabled={generating || savingDrafts} className="mobile-touch">
              <span>{t('取消')}</span>
            </ToolbarButton>
          </footer>
        </div>
      </div>
    </ImagePreviewPortal>
  );
};
