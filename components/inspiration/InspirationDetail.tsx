import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Folder,
  ImagePlus,
  MoreHorizontal,
  Palette,
  Pencil,
  Pin,
  Play,
  Sparkles,
  UserRound,
  Wand2,
  X,
} from 'lucide-react';
import { ImageEditOperation, Inspiration, InspirationBoard, PromptChain, User } from '../../types';
import { db } from '../../services/dbService';
import { IMPORT_SESSION_KEY, ImportMode, PendingImportData } from '../../services/metadataService';
import { createUuid } from '../../services/id';
import { characterReferenceService } from '../../services/characterReferenceService';
import { vibeService } from '../../services/vibeService';
import { inspirationSimilarity, normalizeInspirationTags, sourceLabel, suggestInspirationTags } from '../../services/inspirationUtils';
import { CloseButton } from '../DesignSystem';
import { OriginalImage, SmartImage } from '../SmartImage';
import { ParamsViewer } from '../ParamsViewer';
import { useMobileHistoryLayer } from '../MobileUI';
import { ImageTaggerAction } from '../ImageTaggerPanel';
import { canEditItem, DEFAULT_PARAMS, fetchImageFile, formatDate, RatingStars, sourceIcon, splitTags } from './InspirationShared';

interface Props {
  item: Inspiration;
  items: Inspiration[];
  boards: InspirationBoard[];
  currentUser: User;
  chains: PromptChain[];
  notify: (msg: string, type?: 'success' | 'error') => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onNavigateToPlayground?: () => void;
  onCreateArtistChain?: (chain: PromptChain) => Promise<void>;
  onSetChainCover?: (chainId: string, imageUrl: string) => Promise<void>;
  onOpenItem: (item: Inspiration) => void;
}

export const InspirationDetail: React.FC<Props> = ({
  item,
  items,
  boards,
  currentUser,
  chains,
  notify,
  onClose,
  onRefresh,
  onNavigateToPlayground,
  onCreateArtistChain,
  onSetChainCover,
  onOpenItem,
}) => {
  const closeLayer = useMobileHistoryLayer(true, onClose, 'inspiration-detail');
  const [draft, setDraft] = useState(item);
  const [busy, setBusy] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [coverModalOpen, setCoverModalOpen] = useState(false);
  const [coverChainId, setCoverChainId] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  const editable = canEditItem(item, currentUser);

  useEffect(() => {
    setDraft(item);
    setIsEditing(false);
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
   * 即时更新并静默持久化（用于星级、置顶、归档、画板切换、标签增删等单点操作）
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

  /**
   * 编辑态显式保存
   */
  const save = async () => {
    if (!draft.title.trim()) return notify('标题不能为空', 'error');
    setBusy('save');
    try {
      await db.updateInspiration(item.id, {
        title: draft.title.trim(),
        prompt: draft.prompt,
        negativePrompt: draft.negativePrompt || '',
        notes: draft.notes || '',
        tags: draft.tags || [],
        boardId: draft.boardId || '',
        rating: draft.rating || 0,
        isPinned: Boolean(draft.isPinned),
        archived: Boolean(draft.archived),
      });
      await onRefresh();
      notify('灵感整理已保存');
      setIsEditing(false);
    } catch (error: any) {
      notify(error?.message || '保存失败', 'error');
    } finally {
      setBusy('');
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

  const importToPlayground = async (mode: ImportMode) => {
    setBusy(mode);
    try {
      const payload: PendingImportData = {
        prompt: draft.prompt || '',
        negativePrompt: draft.negativePrompt || '',
        params: draft.params || DEFAULT_PARAMS,
        mode,
        sourceInspirationId: draft.id,
      };
      sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(payload));
      await db.markInspirationUsed(draft.id);
      notify(mode === 'replace' ? '完整参数已送往实验室' : '选定内容已送往实验室');
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
        tags: draft.tags || [],
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
      setMoreOpen(false);
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
      setMoreOpen(false);
    } catch (error: any) {
      notify(error?.message || '创建资产失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const handleSetCover = async () => {
    if (!coverChainId || !onSetChainCover) return;
    setBusy('cover');
    try {
      await onSetChainCover(coverChainId, draft.imageUrl);
      await db.markInspirationUsed(draft.id);
      notify('风格串封面已更新');
      setCoverModalOpen(false);
      setCoverChainId('');
    } catch (error: any) {
      notify(error?.message || '设置封面失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const SourceIcon = sourceIcon(draft.sourceType);

  return (
    <div className="ui-backdrop-enter fixed inset-0 z-[1500] flex items-center justify-center bg-black/80 p-0 backdrop-blur-sm md:p-6" onClick={closeLayer}>
      <div data-safe-mode-work="true" className="ui-modal-enter flex h-[100dvh] w-full max-w-7xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-950 md:h-[92vh] md:rounded-2xl md:border md:border-gray-800 lg:flex-row" onClick={event => event.stopPropagation()}>
        {/* 左侧作品大图舞台 */}
        <section className="relative flex min-h-[36vh] flex-1 items-center justify-center overflow-hidden bg-gray-100 dark:bg-black/60 lg:min-h-0">
          <OriginalImage src={draft.imageUrl} alt={draft.title} className="max-h-full max-w-full object-contain" data-safe-mode-ignore="true" />
          <button type="button" onClick={closeLayer} className="absolute left-3 top-[max(.75rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur lg:hidden" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
          <div className="absolute bottom-3 left-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm backdrop-blur dark:border-white/15 dark:bg-black/60 dark:text-white">
              <SourceIcon className="h-3.5 w-3.5" />
              {sourceLabel(draft.sourceType)}
            </span>
            {draft.parentId && (
              <span className="rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur">
                衍生自 {draft.parentId}
              </span>
            )}
          </div>
        </section>

        {/* 右侧灵感档案与流转面板 */}
        <section className="flex min-h-0 w-full flex-col border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 lg:w-[540px]">
          {/* 顶栏：元数据徽章、标题、画板快速下拉、评分与轻量开关 */}
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
                  title="切换所属灵感板"
                >
                  <option value="">📁 未整理</option>
                  {boards.map(board => (
                    <option key={board.id} value={board.id}>📁 {board.name}</option>
                  ))}
                </select>
              </div>

              {isEditing ? (
                <input
                  data-safe-mode-title="true"
                  disabled={!editable}
                  value={draft.title}
                  onChange={e => update('title', e.target.value)}
                  placeholder="输入灵感标题..."
                  className="h-8 w-full rounded-lg border border-indigo-400 bg-white px-2.5 text-base font-bold text-gray-950 outline-none dark:bg-gray-900 dark:text-white"
                  autoFocus
                />
              ) : (
                <h2 data-safe-mode-title="true" className="truncate text-base font-bold text-gray-950 dark:text-white sm:text-lg" title={draft.title}>
                  {draft.title || '（未命名灵感）'}
                </h2>
              )}
            </div>

            <div className="flex flex-none items-center gap-1.5">
              <RatingStars
                value={draft.rating || 0}
                onChange={editable ? value => void updateAndPersist('rating', value) : undefined}
                compact
              />
              <div className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-800" />
              <button
                type="button"
                disabled={!editable}
                onClick={() => void updateAndPersist('isPinned', !draft.isPinned, draft.isPinned ? '已取消置顶' : '已置顶')}
                title={draft.isPinned ? '取消置顶' : '置顶'}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${draft.isPinned ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300' : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-700 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:text-gray-200'}`}
                aria-label={draft.isPinned ? '已置顶' : '置顶'}
              >
                <Pin className={`h-3.5 w-3.5 ${draft.isPinned ? 'fill-current' : ''}`} />
              </button>
              <button
                type="button"
                disabled={!editable}
                onClick={() => void updateAndPersist('archived', !draft.archived, draft.archived ? '已取消归档' : '已归档')}
                title={draft.archived ? '取消归档' : '归档'}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${draft.archived ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-700 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:text-gray-200'}`}
                aria-label={draft.archived ? '已归档' : '归档'}
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
              {editable && (
                <button
                  type="button"
                  onClick={() => {
                    if (isEditing) {
                      setDraft(item);
                      setIsEditing(false);
                    } else {
                      setIsEditing(true);
                    }
                  }}
                  title={isEditing ? '退出编辑' : '编辑内容与备注'}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${isEditing ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-700 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:text-gray-200'}`}
                  aria-label={isEditing ? '退出编辑' : '编辑内容与备注'}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              <CloseButton onClick={closeLayer} className="hidden lg:inline-flex" />
            </div>
          </header>

          {/* 滚动内容区 */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
            {/* 正面提示词卡片 */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-600 dark:text-gray-300">
                  提示词
                  {promptTagCount > 0 && <span className="ml-1.5 text-micro font-normal text-gray-400">（{promptTagCount} 个词元）</span>}
                </span>
                {!isEditing && draft.prompt && (
                  <button
                    type="button"
                    onClick={() => handleCopy(draft.prompt, '提示词')}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
                  >
                    <Copy className="h-3 w-3" />
                    复制
                  </button>
                )}
              </div>
              {isEditing ? (
                <textarea
                  value={draft.prompt}
                  onChange={e => update('prompt', e.target.value)}
                  className="min-h-24 w-full resize-y rounded-xl border border-gray-200 bg-white p-3 font-mono text-xs leading-5 outline-none focus:border-indigo-400 dark:border-gray-800 dark:bg-gray-900"
                  placeholder="输入正向提示词..."
                />
              ) : (
                <div className="custom-scrollbar max-h-36 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/80 p-3 font-mono text-xs leading-relaxed text-gray-800 select-text dark:border-gray-800/80 dark:bg-gray-900/60 dark:text-gray-200">
                  {draft.prompt || <span className="text-gray-400 italic">（无提示词）</span>}
                </div>
              )}
            </div>

            {/* 负面提示词卡片 */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-600 dark:text-gray-300">
                  负面提示词
                  {negativeTagCount > 0 && <span className="ml-1.5 text-micro font-normal text-gray-400">（{negativeTagCount} 个词元）</span>}
                </span>
                {!isEditing && draft.negativePrompt && (
                  <button
                    type="button"
                    onClick={() => handleCopy(draft.negativePrompt || '', '负面提示词')}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
                  >
                    <Copy className="h-3 w-3" />
                    复制
                  </button>
                )}
              </div>
              {isEditing ? (
                <textarea
                  value={draft.negativePrompt || ''}
                  onChange={e => update('negativePrompt', e.target.value)}
                  className="min-h-20 w-full resize-y rounded-xl border border-gray-200 bg-white p-3 font-mono text-xs leading-5 outline-none focus:border-indigo-400 dark:border-gray-800 dark:bg-gray-900"
                  placeholder="输入负面提示词..."
                />
              ) : (
                <div className="custom-scrollbar max-h-24 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/80 p-3 font-mono text-xs leading-relaxed text-gray-800 select-text dark:border-gray-800/80 dark:bg-gray-900/60 dark:text-gray-200">
                  {draft.negativePrompt || <span className="text-gray-400 italic">（无负面提示词）</span>}
                </div>
              )}
            </div>

            {/* 标签 */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-600 dark:text-gray-300">
                  标签
                  {(draft.tags || []).length > 0 && (
                    <span className="ml-1 text-micro font-normal text-gray-400">（{(draft.tags || []).length}）</span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <ImageTaggerAction
                    notify={notify}
                    imageUrl={draft.imageUrl}
                    actionLabel="追加 {count} 个 Tag 到灵感标签"
                    onInsert={(newTags) => {
                      const combined = normalizeInspirationTags([...(draft.tags || []), ...splitTags(newTags)]);
                      void updateAndPersist('tags', combined, `已追加 ${splitTags(newTags).length} 个反推 Tag`);
                    }}
                  />
                  {editable && (
                    <button
                      type="button"
                      onClick={() => {
                        const tags = suggestInspirationTags({ ...draft, tags: draft.tags || [] });
                        void updateAndPersist('tags', tags, '已自动整理标签');
                      }}
                      className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      自动整理
                    </button>
                  )}
                </div>
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
                        title={`删除 #${tag}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
                {editable && (
                  <input
                    type="text"
                    placeholder="+ 添加标签 (回车保存)"
                    value={newTagInput}
                    onChange={e => setNewTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTag(newTagInput);
                      }
                    }}
                    className="h-7 w-32 rounded-lg border border-dashed border-gray-300 bg-transparent px-2 text-xs outline-none transition focus:w-44 focus:border-indigo-400 dark:border-gray-700 dark:focus:border-indigo-500"
                  />
                )}
              </div>
            </div>

            {/* 整理备注 */}
            <div>
              <span className="mb-1 block text-xs font-bold text-gray-600 dark:text-gray-300">整理备注</span>
              {isEditing ? (
                <textarea
                  disabled={!editable}
                  value={draft.notes || ''}
                  onChange={e => update('notes', e.target.value)}
                  placeholder="记录为什么收藏、适合什么场景、下次要怎么改……"
                  className="min-h-20 w-full resize-y rounded-xl border border-gray-200 bg-white p-3 text-xs leading-relaxed outline-none focus:border-indigo-400 dark:border-gray-800 dark:bg-gray-900"
                />
              ) : draft.notes ? (
                <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3 text-xs leading-relaxed text-gray-700 select-text dark:border-gray-800/80 dark:bg-gray-900/60 dark:text-gray-300">
                  {draft.notes}
                </div>
              ) : editable ? (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="flex w-full items-center gap-1.5 rounded-xl border border-dashed border-gray-200 p-2.5 text-xs text-gray-400 transition hover:border-gray-300 hover:text-gray-600 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:text-gray-300"
                >
                  <Pencil className="h-3 w-3" />
                  添加整理备注...
                </button>
              ) : null}
            </div>

            {/* 生成参数与来源详情（折叠面板） */}
            <details className="group rounded-2xl border border-gray-200 p-3 dark:border-gray-800">
              <summary className="flex cursor-pointer items-center justify-between text-xs font-bold text-gray-700 select-none dark:text-gray-200">
                <span className="flex items-center gap-1.5">
                  <span>生成参数与来源详情</span>
                  <span className="text-micro font-normal text-gray-400">（已使用 {draft.useCount || 0} 次）</span>
                </span>
                <ChevronDown className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-3 space-y-3 border-t border-gray-100 pt-3 dark:border-gray-800/60">
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <div className="flex items-center gap-1.5">
                    <SourceIcon className="h-3.5 w-3.5 text-gray-400" />
                    <span>来源：<b>{sourceLabel(draft.sourceType)}</b></span>
                  </div>
                  <div>
                    <span>收录：{formatDate(draft.createdAt)}</span>
                  </div>
                  {draft.lastUsedAt && (
                    <div className="col-span-2">
                      <span>最近流转：{formatDate(draft.lastUsedAt)}</span>
                    </div>
                  )}
                  {draft.sourceId && (
                    <p className="col-span-2 break-all text-meta text-gray-400">来源 ID：{draft.sourceId}</p>
                  )}
                  {draft.sourceUrl && (
                    <div className="col-span-2">
                      <a href={draft.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-indigo-600 hover:underline dark:text-indigo-400">
                        <ExternalLink className="h-3 w-3" />
                        打开原始页面
                      </a>
                    </div>
                  )}
                </div>
                <ParamsViewer params={draft.params || DEFAULT_PARAMS} notify={notify} />
              </div>
            </details>

            {/* 相似灵感推荐 */}
            {similar.length > 0 && (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-gray-700 dark:text-gray-200">
                  <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                  相似灵感
                </h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {similar.map(entry => (
                    <button
                      type="button"
                      key={entry.item.id}
                      data-safe-mode-work="true"
                      title={`${entry.item.title} (相似度 ${entry.score})`}
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

          {/* 底部单行操作条 */}
          <footer className="flex-none border-t border-gray-200 p-3 dark:border-gray-800">
            {isEditing ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">正在编辑灵感档案</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(item);
                      setIsEditing(false);
                    }}
                    className="mobile-touch rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={busy === 'save'}
                    onClick={() => void save()}
                    className="mobile-touch flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    完成保存
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void importToPlayground('replace')}
                    className="mobile-touch flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-500 whitespace-nowrap"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    完整导入
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void importToPlayground('append-prompt')}
                    className="mobile-touch hidden sm:flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 whitespace-nowrap"
                  >
                    追加提示词
                  </button>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setMoreOpen(!moreOpen)}
                      className="mobile-touch flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 whitespace-nowrap"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                      更多复用
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {moreOpen && (
                      <div className="absolute bottom-12 left-0 z-30 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => { setMoreOpen(false); void importToPlayground('append-prompt'); }}
                          className="flex sm:hidden w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          追加提示词
                        </button>
                        {([
                          ['prompt-only', '仅使用正向提示词'],
                          ['negative-only', '仅使用负面提示词'],
                          ['params-only', '仅使用生成参数'],
                        ] as [ImportMode, string][]).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => { setMoreOpen(false); void importToPlayground(mode); }}
                            className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                          >
                            {label}
                          </button>
                        ))}
                        <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => { setMoreOpen(false); void importAsBaseImage('image-to-image'); }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <ImagePlus className="h-3.5 w-3.5 text-indigo-500" />
                          底图：图生图
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => { setMoreOpen(false); void importAsBaseImage('inpaint'); }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <Wand2 className="h-3.5 w-3.5 text-indigo-500" />
                          底图：局部重绘
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => { setMoreOpen(false); void importAsBaseImage('outpaint'); }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <ExternalLink className="h-3.5 w-3.5 text-indigo-500" />
                          底图：扩图
                        </button>
                        <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                        <button
                          type="button"
                          disabled={!onCreateArtistChain || Boolean(busy)}
                          onClick={() => void createArtistChain()}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"
                        >
                          <Palette className="h-3.5 w-3.5 text-violet-500" />
                          创建风格串
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void createAsset('character')}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <UserRound className="h-3.5 w-3.5 text-amber-500" />
                          创建角色参考
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void createAsset('vibe')}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <Sparkles className="h-3.5 w-3.5 text-pink-500" />
                          创建 Vibe
                        </button>
                        {onSetChainCover && chains.some(chain => chain.type === 'style') && (
                          <button
                            type="button"
                            onClick={() => { setMoreOpen(false); setCoverModalOpen(true); }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                          >
                            <Folder className="h-3.5 w-3.5 text-blue-500" />
                            设为风格串封面...
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-none items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      handleCopy(draft.prompt, '提示词');
                    }}
                    title="复制正向提示词"
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <a
                    href={draft.imageUrl}
                    download={`${draft.title || 'inspiration'}.png`}
                    title="下载原图"
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              </div>
            )}
          </footer>
        </section>
      </div>

      {/* 设为风格串封面弹窗 */}
      {coverModalOpen && (
        <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setCoverModalOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">设为风格串封面</h3>
              <button type="button" onClick={() => setCoverModalOpen(false)} className="rounded-lg p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">选择将当前灵感图作为哪个风格串的预览封面：</p>
            <select
              value={coverChainId}
              onChange={e => setCoverChainId(e.target.value)}
              className="mb-4 h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
            >
              <option value="">请选择目标风格串...</option>
              {chains.filter(chain => chain.type === 'style').map(chain => (
                <option key={chain.id} value={chain.id}>{chain.name}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCoverModalOpen(false)}
                className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!coverChainId || busy === 'cover'}
                onClick={() => void handleSetCover()}
                className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-40"
              >
                确认设为封面
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
