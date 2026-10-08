import { t, useLanguage } from '../../services/i18n';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Copy,
  ExternalLink,
  FlaskConical,
  ImagePlus,
  Palette,
  Pencil,
  Pin,
  Plus,
  Sparkles,
  UserRound,
  Wand2,
  X,
} from 'lucide-react';
import { ImageEditOperation, Inspiration, InspirationBoard, PromptChain, User } from '../../types';
import { db } from '../../services/dbService';
import { IMPORT_SESSION_KEY, PendingImportData } from '../../services/metadataService';
import { createUuid } from '../../services/id';
import { characterReferenceService } from '../../services/characterReferenceService';
import { vibeService } from '../../services/vibeService';
import { inspirationSimilarity, normalizeInspirationTags, sourceLabel } from '../../services/inspirationUtils';
import { CloseButton, ToolbarButton } from '../DesignSystem';
import { copyTagText, readExternalImageTags } from '../../services/externalImageTags';
import { SmartImage } from '../SmartImage';
import { ParamsViewer } from '../ParamsViewer';
import { ImageShareOverlay } from '../ImageShareActions';
import { PressRevealSurface } from '../PressRevealSurface';
import { ViewableImage } from '../ImageLightbox';
import { getMobileOriginalUrl } from '../../services/mobileImageCache';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useMobileHistoryLayer } from '../MobileUI';
import { ImageTaggerPanel } from '../ImageTaggerPanel';
import { canEditItem, DEFAULT_PARAMS, fetchImageFile, formatDate, RatingStars, sourceIcon, splitTags } from './InspirationShared';

interface Props {
  item: Inspiration;
  items: Inspiration[];
  boards: InspirationBoard[];
  currentUser: User;
  notify: (msg: string, type?: 'success' | 'error') => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onNavigateToPlayground?: () => void;
  onCreateArtistChain?: (chain: PromptChain) => Promise<void>;
  onOpenItem: (item: Inspiration) => void;
}

export const InspirationDetail: React.FC<Props> = ({
  item,
  items,
  boards,
  currentUser,
  notify,
  onClose,
  onRefresh,
  onNavigateToPlayground,
  onCreateArtistChain,
  onOpenItem,
}) => {
  useLanguage();
  const closeLayer = useMobileHistoryLayer(true, onClose, 'inspiration-detail');
  const [draft, setDraft] = useState(item);
  const [busy, setBusy] = useState('');
  const [taggerOpen, setTaggerOpen] = useState(false);
  const [labMenuOpen, setLabMenuOpen] = useState(false);
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const editable = canEditItem(item, currentUser);
  const reverseTags = readExternalImageTags(draft);
  const sourceTags = Array.isArray(draft.analysis?.externalSourceTags) ? draft.analysis.externalSourceTags.filter((tag): tag is string => typeof tag === 'string') : [];

  useEffect(() => {
    setDraft(item);
    setTaggerOpen(false);
    setLabMenuOpen(false);
    setAssetMenuOpen(false);
    setIsAddingTag(false);
    setNewTagInput('');
  }, [item]);

  const similar = useMemo(() => items
    .filter(candidate => candidate.id !== item.id && !candidate.archived)
    .map(candidate => ({ item: candidate, score: inspirationSimilarity(item, candidate) }))
    .filter(entry => entry.score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6), [item, items]);

  const promptTagCount = useMemo(() => {
    return (draft.prompt || '').split(',').map(s => s.trim()).filter(Boolean).length;
  }, [draft.prompt]);

  const negativeTagCount = useMemo(() => {
    return (draft.negativePrompt || '').split(',').map(s => s.trim()).filter(Boolean).length;
  }, [draft.negativePrompt]);

  const update = <K extends keyof Inspiration>(key: K, value: Inspiration[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  /**
   * 即时更新并静默持久化到数据库
   */
  const updateAndPersist = async <K extends keyof Inspiration>(key: K, value: Inspiration[K], successMsg?: string) => {
    if (!editable) return;
    update(key, value);
    try {
      await db.updateInspiration(item.id, { [key]: value });
      await onRefresh();
      if (successMsg) notify(successMsg);
    } catch (error: any) {
      notify(error?.message || '更新失败', 'error');
    }
  };

  const handleAddTag = (tagToAdd: string) => {
    const trimmed = tagToAdd.trim().replace(/^#/, '');
    if (!trimmed) return;
    const currentTags = draft.tags || [];
    if (currentTags.includes(trimmed)) {
      setNewTagInput('');
      return;
    }
    const nextTags = normalizeInspirationTags([...currentTags, trimmed]);
    void updateAndPersist('tags', nextTags, `已添加标签 #${trimmed}`);
    setNewTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const nextTags = (draft.tags || []).filter(t => t !== tagToRemove);
    void updateAndPersist('tags', nextTags);
  };

  const handleCopy = (text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    notify(`${label}已复制`);
  };

  const importToPlayground = async () => {
    setBusy('import');
    try {
      const payload: PendingImportData = {
        prompt: draft.prompt || '',
        negativePrompt: draft.negativePrompt || '',
        params: draft.params || DEFAULT_PARAMS,
        mode: 'replace',
        targetMode: 'text-to-image',
        sourceInspirationId: draft.id,
      };
      sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(payload));
      await db.markInspirationUsed(draft.id);
      notify('完整参数已送往实验室');
      onClose();
      onNavigateToPlayground?.();
    } catch (error: any) {
      notify(error?.message || '导入失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const importAsBaseImage = async (operation: ImageEditOperation = 'image-to-image') => {
    setBusy(`base-image-${operation}`);
    try {
      const payload: PendingImportData = {
        mode: 'image-edit',
        prompt: draft.prompt || '',
        negativePrompt: draft.negativePrompt || '',
        params: draft.params || DEFAULT_PARAMS,
        baseImageUrl: draft.imageUrl,
        sourceInspirationId: draft.id,
        imageEditOperation: operation,
      };
      sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(payload));
      await db.markInspirationUsed(draft.id);
      const opLabel = operation === 'image-to-image' ? '图生图' : operation === 'inpaint' ? '局部重绘' : '扩图';
      notify(`已作为底图送往实验室（${opLabel}）`);
      onClose();
      onNavigateToPlayground?.();
    } catch (error: any) {
      notify(error?.message || '导入底图失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const createArtistChain = async () => {
    if (!onCreateArtistChain) return;
    setBusy('chain');
    try {
      const now = Date.now();
      await onCreateArtistChain({
        id: createUuid(),
        userId: currentUser.id,
        username: currentUser.username,
        type: 'style',
        name: draft.title || '灵感风格串',
        description: draft.notes || `由灵感库“${draft.title}”创建`,
        tags: [],
        previewImage: draft.imageUrl,
        basePrompt: draft.prompt || '',
        negativePrompt: draft.negativePrompt || '',
        modules: [],
        params: draft.params || DEFAULT_PARAMS,
        variableValues: { subject: '' },
        createdAt: now,
        updatedAt: now,
      });
      await db.markInspirationUsed(draft.id);
      notify('已创建风格串');
      setAssetMenuOpen(false);
    } catch (error: any) {
      notify(error?.message || '创建风格串失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const createAsset = async (kind: 'character' | 'vibe') => {
    setBusy(kind);
    try {
      const file = await fetchImageFile(draft);
      if (kind === 'character') await characterReferenceService.create(file, draft.title || '灵感角色参考');
      else await vibeService.create(file, draft.title || '灵感 Vibe');
      await db.markInspirationUsed(draft.id);
      notify(kind === 'character' ? '已创建角色参考' : '已创建 Vibe 资产');
      setAssetMenuOpen(false);
    } catch (error: any) {
      notify(error?.message || '创建资产失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const SourceIcon = sourceIcon(draft.sourceType);

  return (
    <ImagePreviewPortal>
    <div className="ui-backdrop-enter fixed inset-0 z-[1500] flex items-center justify-center bg-black/80 p-0 backdrop-blur-sm md:p-6" onClick={closeLayer}>
      <div data-safe-mode-work="true" data-agent-page-scope="detail" data-agent-page-title={t("灵感详情：{0} · #{1}", [draft.title || '未命名灵感', draft.id])} className="appearance-panel ui-modal-enter flex h-[100dvh] w-full max-w-7xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-950 md:h-[92vh] md:rounded-2xl md:border md:border-gray-800 lg:flex-row" onClick={event => event.stopPropagation()}>
        {/* 左侧大图展示舞台 */}
        <PressRevealSurface as="section" pressResetKey={draft.id} className="group relative flex min-h-[36vh] flex-1 items-center justify-center overflow-hidden bg-gray-100 dark:bg-black/60 lg:min-h-0">
          <ViewableImage src={draft.imageUrl} alt={draft.title} filename={`${draft.title || 'inspiration'}.png`} notify={notify} generationData={draft.params ? {prompt:draft.prompt,negativePrompt:draft.negativePrompt,params:draft.params} : undefined} className="max-h-full max-w-full object-contain" data-safe-mode-ignore="true" />
          <ImageShareOverlay imageUrl={getMobileOriginalUrl(draft.imageUrl)} generationData={draft.params ? { prompt: draft.prompt, negativePrompt: draft.negativePrompt, params: draft.params } : undefined} filename={`${draft.title || 'inspiration'}.png`} notify={notify} className="!top-[max(.75rem,env(safe-area-inset-top))]" />
          <button type="button" onClick={closeLayer} className="absolute left-3 top-[max(.75rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur lg:hidden" aria-label={t("关闭")}>
            <X className="h-5 w-5" />
          </button>
          <div className="absolute bottom-3 left-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm backdrop-blur dark:border-white/15 dark:bg-black/60 dark:text-white">
              <SourceIcon className="h-3.5 w-3.5" />
              {sourceLabel(draft.sourceType)}
            </span>
            {draft.parentId && (
              <span className="rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur">{t("衍生自 {0}", [draft.parentId])}</span>
            )}
          </div>
        </PressRevealSurface>

        {/* 右侧清爽灵感工作台 */}
        <section className="flex min-h-0 w-full flex-col border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 lg:w-[520px]">
          {/* 顶栏：轻量去噪，只留标题、来源时间、画板切换与关闭 */}
          <header className="flex flex-none items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-micro font-bold text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  <SourceIcon className="h-3 w-3" />
                  {sourceLabel(draft.sourceType)}
                </span>
                <span className="text-micro text-gray-400">
                  {formatDate(draft.createdAt)}
                </span>
                <select
                  disabled={!editable}
                  value={draft.boardId || ''}
                  onChange={e => void updateAndPersist('boardId', e.target.value, e.target.value ? '已移入灵感板' : '已移至未整理')}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-0.5 text-micro font-semibold text-gray-700 outline-none transition hover:border-indigo-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
                  title={t("切换所属灵感板")}
                >
                  <option value="">{t("📁 未整理")}</option>
                  {boards.map(board => (
                    <option key={board.id} value={board.id}>📁 {board.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => void updateAndPersist('isPinned', !draft.isPinned, draft.isPinned ? '已取消置顶' : '已置顶')}
                  title={draft.isPinned ? t("已置顶（点击取消）") : t("置顶灵感")}
                  aria-label={draft.isPinned ? t("已置顶") : t("置顶灵感")}
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-micro font-bold transition ${
                    draft.isPinned
                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950/70 dark:text-amber-300'
                      : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300'
                  }`}
                >
                  <Pin className={`h-3 w-3 ${draft.isPinned ? 'fill-current' : ''}`} />
                  <span>{draft.isPinned ? t("已置顶") : t("置顶")}</span>
                </button>
              </div>

              <input
                data-safe-mode-title="true"
                aria-label={t("灵感标题")}
                disabled={!editable}
                value={draft.title}
                onChange={e => update('title', e.target.value)}
                onBlur={() => {
                  if (draft.title.trim()) {
                    void updateAndPersist('title', draft.title.trim());
                  }
                }}
                placeholder={t("灵感标题...")}
                className="h-8 w-full rounded-lg border border-transparent bg-transparent px-1 text-base font-bold text-gray-950 transition hover:border-gray-200 focus:border-indigo-400 focus:bg-white dark:text-white dark:hover:border-gray-800 dark:focus:bg-gray-900 sm:text-lg"
              />
              <div role="group" aria-label={t("评分")}>
                <RatingStars value={draft.rating || 0} onChange={editable ? value => { void updateAndPersist('rating', value); } : undefined} />
              </div>
            </div>

            <div className="flex flex-none items-center gap-2">
              <CloseButton onClick={closeLayer} className="hidden lg:inline-flex" />
            </div>
          </header>

          {/* 滚动内容区 */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
            {/* 正面提示词卡片（核心主角） */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-700 dark:text-gray-200">
                  {t("提示词")}{promptTagCount > 0 && <span className="ml-1.5 text-micro font-normal text-gray-400">{t("（{0} 个词元）", [promptTagCount])}</span>}
                </span>
                {draft.prompt && (
                  <button
                    type="button"
                    onClick={() => handleCopy(draft.prompt, '提示词')}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
                  >
                    <Copy className="h-3 w-3" />
                    {t("复制")}</button>
                )}
              </div>
              <textarea
                aria-label={t("提示词")}
                readOnly={!editable}
                value={draft.prompt || ''}
                onChange={event => update('prompt', event.target.value)}
                onBlur={() => void updateAndPersist('prompt', draft.prompt)}
                placeholder={t("（无提示词）")}
                className="custom-scrollbar min-h-24 max-h-44 w-full resize-y overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/80 p-3 font-mono text-xs leading-relaxed text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-800/80 dark:bg-gray-900/60 dark:text-gray-200"
              />
            </div>

            {/* 负面提示词（默认轻量折叠单行，需要时才展开） */}
            {(draft.negativePrompt || editable) ? (
              <details className="group rounded-xl border border-gray-100 bg-gray-50/50 p-2.5 dark:border-gray-800/60 dark:bg-gray-900/30">
                <summary className="flex cursor-pointer items-center justify-between text-xs font-bold text-gray-600 select-none dark:text-gray-300">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                    <span>{t("负面提示词")}</span>
                    {negativeTagCount > 0 && <span className="text-micro font-normal text-gray-400">{t("（{0} 个词元）", [negativeTagCount])}</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!draft.negativePrompt}
                      onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleCopy(draft.negativePrompt || '', '负面提示词');
                      }}
                      className="text-micro font-semibold text-red-500 hover:underline dark:text-red-400"
                    >
                      {t("复制")}</button>
                    <ChevronDown className="h-3.5 w-3.5 text-gray-400 transition-transform group-open:rotate-180" />
                  </div>
                </summary>
                <textarea
                  aria-label={t("负面提示词")}
                  readOnly={!editable}
                  value={draft.negativePrompt || ''}
                  onChange={event => update('negativePrompt', event.target.value)}
                  onBlur={() => void updateAndPersist('negativePrompt', draft.negativePrompt || '')}
                  className="custom-scrollbar mt-2 min-h-16 max-h-28 w-full resize-y overflow-y-auto rounded-lg border border-gray-100 bg-transparent p-2 font-mono text-xs leading-relaxed text-gray-700 outline-none focus:border-indigo-400 dark:border-gray-800/50 dark:text-gray-300"
                />
              </details>
            ) : null}

            {/* 标签区：胶囊化展示 + 轻量添加 */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-700 dark:text-gray-200">
                  {t("标签")}{(draft.tags || []).length > 0 && (
                    <span className="ml-1 text-micro font-normal text-gray-400">（{(draft.tags || []).length}）</span>
                  )}
                </span>
                <button type="button" disabled={Boolean(busy)} onClick={() => setTaggerOpen(true)} aria-label={t("识别图片 Tag")} title={t("识别当前图片，挑选后追加到灵感标签")} className="mobile-touch flex items-center gap-1 rounded-lg px-2 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40"><ImagePlus className="h-3.5 w-3.5" />{t("识别图片 Tag")}</button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(draft.tags || []).map(tag => (
                  <span
                    key={tag}
                    className="group inline-flex items-center gap-1 rounded-lg bg-indigo-50/80 px-2.5 py-1 text-meta font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                  >
                    #{tag}
                    {editable && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="text-indigo-400 opacity-60 transition hover:opacity-100 hover:text-red-500 dark:text-indigo-400"
                        title={t("删除 #{0}", [tag])}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
                {isAddingTag ? (
                  <input
                    autoFocus
                    type="text"
                    placeholder={t("输入标签回车保存...")}
                    value={newTagInput}
                    onChange={e => setNewTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTag(newTagInput);
                        setIsAddingTag(false);
                      } else if (e.key === 'Escape') {
                        setIsAddingTag(false);
                      }
                    }}
                    onBlur={() => {
                      if (newTagInput.trim()) handleAddTag(newTagInput);
                      setIsAddingTag(false);
                    }}
                    className="h-6 w-36 rounded-lg border border-indigo-400 bg-white px-2 text-xs outline-none dark:bg-gray-900"
                  />
                ) : editable && (
                  <button
                    type="button"
                    onClick={() => setIsAddingTag(true)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
                  >
                    <Plus className="h-3 w-3" />
                    {t("添加标签")}</button>
                )}
              </div>
            </div>

            {(sourceTags.length > 0 || reverseTags) && <section className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              {sourceTags.length > 0 && <details><summary className="cursor-pointer text-xs font-bold">{draft.sourceType === 'danbooru' ? t("Danbooru 原站 Tag") : t("Pixiv 原站标签")} · {sourceTags.length}</summary><p className="my-2 break-words font-mono text-xs text-gray-500">{sourceTags.join(', ')}</p><ToolbarButton onClick={() => void copyTagText(sourceTags.join(', ')).then(() => notify('已复制原站标签'), () => notify('复制失败', 'error'))}><Copy />{t("复制原站标签")}</ToolbarButton></details>}
              {reverseTags && <details><summary className="cursor-pointer text-xs font-bold">{t("反推 Tag · 模型预测")}</summary><p className="my-2 break-words font-mono text-xs text-gray-500">{reverseTags.prompt}</p><ToolbarButton disabled={!reverseTags.prompt.trim()} onClick={() => void copyTagText(reverseTags.prompt).then(() => notify('已复制反推 Tag'), () => notify('复制失败', 'error'))}><Copy />{t("复制反推 Tag")}</ToolbarButton></details>}
            </section>}

            {/* 整理备注（有内容展示便签，无内容一行占位） */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-700 dark:text-gray-200">{t("整理备注")}</span>
              </div>
              {draft.notes ? (
                <textarea
                  disabled={!editable}
                  value={draft.notes}
                  onChange={e => update('notes', e.target.value)}
                  onBlur={() => void updateAndPersist('notes', draft.notes || '')}
                  className="min-h-16 w-full resize-y rounded-xl border border-gray-100 bg-gray-50/80 p-2.5 text-xs leading-relaxed text-gray-800 outline-none transition focus:border-indigo-400 focus:bg-white dark:border-gray-800/80 dark:bg-gray-900/60 dark:text-gray-200 dark:focus:bg-gray-900"
                />
              ) : editable ? (
                <button
                  type="button"
                  onClick={() => update('notes', ' ')}
                  className="flex w-full items-center gap-1.5 rounded-xl border border-dashed border-gray-200 p-2 text-xs text-gray-400 transition hover:border-gray-300 hover:text-gray-600 dark:border-gray-800 dark:hover:border-gray-700"
                >
                  <Pencil className="h-3 w-3" />
                  {t("添加整理备注...")}</button>
              ) : null}
            </div>

            {/* 生成参数与来源详情（折叠面板） */}
            <details className="group rounded-2xl border border-gray-200 p-3 dark:border-gray-800">
              <summary className="flex cursor-pointer items-center justify-between text-xs font-bold text-gray-700 select-none dark:text-gray-200">
                <span className="flex items-center gap-1.5">
                  <span>{t("生成参数与来源详情")}</span>
                  <span className="text-micro font-normal text-gray-400">{t("（已使用 {0} 次）", [draft.useCount || 0])}</span>
                </span>
                <ChevronDown className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-3 space-y-3 border-t border-gray-100 pt-3 dark:border-gray-800/60">
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <div className="flex items-center gap-1.5">
                    <SourceIcon className="h-3.5 w-3.5 text-gray-400" />
                    <span>{t("来源：")}<b>{sourceLabel(draft.sourceType)}</b></span>
                  </div>
                  <div>
                    <span>{t("收录：{0}", [formatDate(draft.createdAt)])}</span>
                  </div>
                  {draft.lastUsedAt && (
                    <div className="col-span-2">
                      <span>{t("最近流转：{0}", [formatDate(draft.lastUsedAt)])}</span>
                    </div>
                  )}
                  {draft.sourceId && (
                    <p className="col-span-2 break-all text-meta text-gray-400">{t("来源 ID：{0}", [draft.sourceId])}</p>
                  )}
                  {draft.sourceUrl && (
                    <div className="col-span-2">
                      <a href={draft.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-indigo-600 hover:underline dark:text-indigo-400">
                        <ExternalLink className="h-3 w-3" />
                        {t("打开原始页面")}</a>
                    </div>
                  )}
                </div>
                {draft.params ? <ParamsViewer params={draft.params} notify={notify} /> : <p className="text-xs text-gray-400">{t("未记录生成参数")}</p>}
              </div>
            </details>

            {/* 相似灵感推荐 */}
            {similar.length > 0 && (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-gray-700 dark:text-gray-200">
                  <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                  {t("相似灵感")}</h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {similar.map(entry => (
                    <button
                      type="button"
                      key={entry.item.id}
                      data-safe-mode-work="true"
                      title={t("{0} (相似度 {1})", [entry.item.title, entry.score])}
                      onClick={() => onOpenItem(entry.item)}
                      className="group overflow-hidden rounded-xl border border-gray-200 text-left transition hover:border-indigo-400 dark:border-gray-800 dark:hover:border-indigo-600"
                    >
                      <div className="aspect-square bg-gray-100 dark:bg-gray-900">
                        <SmartImage src={entry.item.imageUrl} alt={entry.item.title} eager thumbnailVariant="thumb-240" className="h-full w-full object-cover transition group-hover:scale-105" />
                      </div>
                      <p data-safe-mode-title="true" className="truncate px-1.5 py-1 text-micro font-bold text-gray-700 dark:text-gray-300">
                        {entry.item.title}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 底部操作条：窄屏换行，分享操作保持可靠触控宽度。 */}
          <footer className="flex-none border-t border-gray-200 p-3.5 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/60 backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
              {/* 导入实验室（带底图模式分流，自适应撑开，居于视觉核心） */}
              <div className="relative flex-1 min-w-[9rem] flex h-10 rounded-xl bg-indigo-600 shadow-sm shadow-indigo-600/20 hover:bg-indigo-500 transition-colors">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void importToPlayground()}
                  className="mobile-touch flex flex-1 min-w-0 items-center justify-center gap-1.5 px-2.5 text-xs font-bold text-white whitespace-nowrap sm:gap-2 sm:px-3.5"
                >
                  <FlaskConical className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t("导入实验室")}</span>
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => { setLabMenuOpen(!labMenuOpen); setAssetMenuOpen(false); }}
                  aria-label={t("更多底图模式")} aria-haspopup="menu" aria-expanded={labMenuOpen}
                  title={t("选择导入模式")}
                  className="mobile-touch flex items-center justify-center px-2.5 text-white/80 hover:text-white hover:bg-black/15 border-l border-white/15 transition-colors rounded-r-xl sm:px-3"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${labMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {labMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setLabMenuOpen(false)} />
                    <div role="menu" aria-label={t("选择底图模式")} className="appearance-panel absolute bottom-12 left-0 z-30 w-52 overflow-hidden rounded-2xl border border-gray-200 bg-white p-1.5 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => { setLabMenuOpen(false); void importToPlayground(); }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                      >
                        <FlaskConical className="h-3.5 w-3.5 text-indigo-500" />
                        {t("完整导入（文生图）")}</button>
                      <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => { setLabMenuOpen(false); void importAsBaseImage('image-to-image'); }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <ImagePlus className="h-3.5 w-3.5 text-indigo-500" />
                        {t("底图：图生图")}</button>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => { setLabMenuOpen(false); void importAsBaseImage('inpaint'); }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <Wand2 className="h-3.5 w-3.5 text-indigo-500" />
                        {t("底图：局部重绘")}</button>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => { setLabMenuOpen(false); void importAsBaseImage('outpaint'); }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-indigo-500" />
                        {t("底图：扩图")}</button>
                    </div>
                  </>
                )}
              </div>

              {/* 提取资产 */}
              <div className="relative flex-none">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  aria-haspopup="menu" aria-expanded={assetMenuOpen} onClick={() => { setAssetMenuOpen(!assetMenuOpen); setLabMenuOpen(false); }}
                  className="mobile-touch flex h-10 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 text-xs font-bold text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-700 dark:hover:bg-gray-800/80 whitespace-nowrap transition-colors sm:px-3.5"
                >
                  <Sparkles className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
                  {t("提取资产")}<ChevronDown className={`h-3 w-3 text-gray-400 transition-transform ${assetMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {assetMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setAssetMenuOpen(false)} />
                    <div role="menu" aria-label={t("提取图片资产")} className="appearance-panel absolute bottom-12 right-0 z-30 w-48 overflow-hidden rounded-2xl border border-gray-200 bg-white p-1.5 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
                      <button
                        type="button"
                        disabled={!onCreateArtistChain || Boolean(busy)}
                        onClick={() => { setAssetMenuOpen(false); void createArtistChain(); }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"
                      >
                        <Palette className="h-3.5 w-3.5 text-violet-500" />
                        {t("创建风格串")}</button>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => { setAssetMenuOpen(false); void createAsset('character'); }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        <UserRound className="h-3.5 w-3.5 text-amber-500" />
                        {t("创建角色参考")}</button>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => { setAssetMenuOpen(false); void createAsset('vibe'); }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                        {t("创建 Vibe")}</button>
                    </div>
                  </>
                )}
              </div>

            </div>
          </footer>
        </section>
      </div>

      {taggerOpen && (
        <ImageTaggerPanel
          contextual
          open={taggerOpen}
          onClose={() => setTaggerOpen(false)}
          imageUrl={draft.imageUrl}
          notify={notify}
          actionLabel={t("追加 {count} 个 Tag 到灵感标签")}
          onInsert={(newTags) => {
            const combined = normalizeInspirationTags([...(draft.tags || []), ...splitTags(newTags)]);
            void updateAndPersist('tags', combined, `已追加 ${splitTags(newTags).length} 个反推 Tag`);
          }}
        />
      )}
    </div>
    </ImagePreviewPortal>
  );
};
