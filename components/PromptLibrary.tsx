/**
 * 提示词库：人物形象库 / 服饰库 / 姿势库共用一套「配置驱动」实现。
 *
 * 结构：
 *   - 列表态：卡片网格 + 搜索 + 标签筛选（多选，条目须同时包含全部所选标签）
 *   - 详情态：点卡片后在同一内容区铺开（内部 state，不跳转风格串编辑器）
 *   - 浮层：AI 生成面板、从本地历史选图、原图查看器
 *
 * 存储约定（与数据层一致，改动前先读 AGENTS.md 的数据边界说明）：
 *   - 条目本体仍是 PromptChain，type = 领域 kind
 *   - 纯英文提示词 → basePrompt
 *   - 中英对照 → params._promptLibrary.bilingual
 *   - 参考图 → params._promptLibrary.references（[{ id, url, prompt }]）
 *   - 封面 → previewImage，直接写 /api/local-history/<id>/image，由 Worker 转成独立资产
 *
 * 数据来源：列表数据来自 props.chains；增删改一律走 onCreate / onUpdateChain / onDelete，
 * 组件自身不直接 fetch /api/chains，避免与 App 的刷新与乐观更新逻辑分叉。
 */
import { t, useLanguage } from '../services/i18n';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  ImagePlus,
  LoaderCircle,
  PersonStanding,
  Plus,
  Shirt,
  Sparkles,
  Trash2,
  UserRound,
  Wand2,
  Image,
  X,
} from 'lucide-react';
import type { ChainType, LocalGenItem, NAIParams, PromptChain } from '../types';
import { promptAgentService, type PromptLibraryItem, type PromptLibraryKind } from '../services/promptAgent';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { useConfirmDialog } from './ConfirmDialog';
import { EmptyState, ToolbarButton, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { HistoryImagePicker } from './HistoryImagePicker';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { PressRevealSurface } from './PressRevealSurface';
import { OriginalImage, SmartImage } from './SmartImage';
import { TOOLBAR_FIELD_CLASS, ToolbarPopover } from './ToolbarPopover';
import { isTopmostModal, useModalA11y } from './useModalA11y';

import { PROMPT_LIBRARY_KINDS, type PromptLibraryKindConfig } from './promptLibraryConfig';
export { PROMPT_LIBRARY_KINDS } from './promptLibraryConfig';
export type { PromptLibraryFacet, PromptLibraryKindConfig } from './promptLibraryConfig';

/** 领域图标只用于展示，不放进纯数据配置表。 */
const KIND_ICONS: Record<PromptLibraryKind, React.FC<{ className?: string }>> = {
  appearance: UserRound,
  wardrobe: Shirt,
  pose: PersonStanding,
  scene: Image,
};

/* ---------------- 存储约定 ---------------- */

export interface PromptLibraryReference {
  id: string;
  url: string;
  prompt: string;
}

export interface PromptLibraryMeta {
  bilingual?: string;
  references?: PromptLibraryReference[];
}

/** NAIParams 上的扩展键；写入时必须与既有生图参数合并，不能整体覆盖。 */
type PromptLibraryParams = NAIParams & { _promptLibrary?: PromptLibraryMeta };

/** 历史图片统一用网关地址引用，Worker 保存封面时会转成独立资产。 */
export const promptLibraryHistoryImageUrl = (historyId: string) => `/api/local-history/${encodeURIComponent(historyId)}/image`;

const libraryMeta = (chain?: PromptChain | null): PromptLibraryMeta => {
  const raw = chain?.params ? (chain.params as PromptLibraryParams)._promptLibrary : undefined;
  return raw && typeof raw === 'object' ? raw : {};
};

const chainTags = (chain?: PromptChain | null): string[] =>
  (Array.isArray(chain?.tags) ? chain!.tags : []).map(value => String(value || '').trim()).filter(Boolean);

const chainPrompt = (chain?: PromptChain | null): string => String(chain?.basePrompt || '').replace(/\s+/g, ' ').trim();

const chainBilingual = (chain?: PromptChain | null): string => String(libraryMeta(chain).bilingual || '');

const chainReferences = (chain?: PromptChain | null): PromptLibraryReference[] => {
  const list = libraryMeta(chain).references;
  if (!Array.isArray(list)) return [];
  return list
    .filter(item => item && typeof item.url === 'string' && item.url)
    .map(item => ({ id: String(item.id || ''), url: String(item.url), prompt: String(item.prompt || '') }));
};

/** 逗号（中英）分隔的标签输入 → 标签数组，最多 12 个。 */
const parseTags = (value: string): string[] =>
  String(value || '')
    .split(/[,，]/)
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 12);

const sameIds = (list: string[], other: string[]) =>
  list.length === other.length && list.every((id, index) => id === other[index]);

const COUNT_OPTIONS = [1, 2, 3, 4, 5, 6];

/** 详情态的表单草稿：与库里的 chain 分开保存，未点「保存」不落库。 */
interface LibraryDraft {
  id: string;
  name: string;
  /** 逗号分隔的原始输入，保存时才拆成数组。 */
  tags: string;
  prompt: string;
  bilingual: string;
  negativePrompt: string;
  cover: string;
  /** 只有真正动过封面才写 previewImage，避免无谓地把旧值再写回去。 */
  coverChanged: boolean;
  references: PromptLibraryReference[];
}

interface ViewerEntry {
  url: string;
  caption?: string;
}

/* ---------------- Props ---------------- */

export type PromptLibraryUpdateChain = (id: string, updates: Partial<PromptChain>) => Promise<void> | void;

export interface PromptLibraryProps {
  chains: PromptChain[];
  /** 由 App 提供：只创建并刷新数据、不跳转导航；返回新条目 id，失败返回 undefined。 */
  onCreate: (name: string, description: string, type: ChainType) => Promise<string | undefined>;
  onSelect: (id: string) => void;
  onUpdateChain: PromptLibraryUpdateChain;
  onDelete: (id: string) => Promise<void> | void;
  notify: (message: string, type?: 'success' | 'error') => void;
  returnTargetId?: string;
  selectionFocusEnabled?: boolean;
}

interface PromptLibraryInternalProps extends PromptLibraryProps {
  config: PromptLibraryKindConfig;
  registerLeaveGuard?: (guard: () => Promise<boolean>) => () => void;
}

const DETAIL_FIELD_CLASS = 'mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const DETAIL_CARD_CLASS = 'rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const DETAIL_LABEL_CLASS = 'text-sm font-semibold text-gray-700 dark:text-gray-200';

/* ---------------- 内部通用组件 ---------------- */

/**
 * onSelect / returnTargetId / selectionFocusEnabled 保留在 props 契约里与 CharacterLibrary 对齐：
 * 本库详情用内部 state 展开（不跳转风格串编辑器），也不做多选，故这三个字段暂不参与逻辑。
 */
export const PromptLibrary: React.FC<PromptLibraryInternalProps> = ({
  config,
  registerLeaveGuard,
  chains,
  onCreate,
  onUpdateChain,
  onDelete,
  notify,
}) => {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const imageDisplay = useMobileImageDisplayPreferences();
  const Icon = KIND_ICONS[config.kind];
  const generatorTitle = config.generateLabel.replace('✦ ', '');

  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagQuery, setTagQuery] = useState('');

  const [detail, setDetail] = useState<LibraryDraft | null>(null);
  const [savingDetail, setSavingDetail] = useState(false);
  const [creating, setCreating] = useState(false);

  const [picker, setPicker] = useState<'cover' | 'reference' | null>(null);
  const [viewer, setViewer] = useState<{ items: ViewerEntry[]; index: number } | null>(null);

  const [genOpen, setGenOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [facets, setFacets] = useState<Record<string, string | string[]>>({});
  const [count, setCount] = useState(1);
  const [drafts, setDrafts] = useState<PromptLibraryItem[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [savingDrafts, setSavingDrafts] = useState(false);
  const [generatedBy, setGeneratedBy] = useState('');

  const genDialogRef = useModalA11y<HTMLDivElement>(genOpen);
  const viewerRef = useModalA11y<HTMLDivElement>(viewer !== null);
  // 异步流程里要读取「最新的 chains」：直接读 props 会闭包过期。
  const chainsRef = useRef(chains);
  chainsRef.current = chains;
  // 卸载后不再回写状态；用 effect 复位是为了兼容 StrictMode 的模拟卸载重挂。
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  /** onCreate 只保证创建 + 刷新数据，chains 的重新渲染可能晚一拍：等它出现再合并 params。 */
  const awaitChain = useCallback(async (id: string, timeoutMs = 3000): Promise<PromptChain | undefined> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = chainsRef.current.find(chain => chain.id === id);
      if (found) return found;
      if (!aliveRef.current || Date.now() >= deadline) return undefined;
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }
  }, []);

  useEffect(() => {
    setFacets(Object.fromEntries(config.facets.map(facet => [facet.key, facet.multiple ? [] : ''])));
  }, [config]);

  const items = useMemo(
    () => (Array.isArray(chains) ? chains : []).filter(chain => chain && (Array.isArray(config.type) ? config.type.includes(chain.type) : chain.type === config.type)),
    [chains, config.type],
  );

  const tagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chain of items) for (const value of chainTags(chain)) counts.set(value, (counts.get(value) || 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'));
  }, [items]);

  const visibleTagOptions = useMemo(() => {
    const keyword = tagQuery.trim().toLowerCase();
    return tagOptions.filter(([value]) => !keyword || value.toLowerCase().includes(keyword));
  }, [tagOptions, tagQuery]);

  const shown = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return items
      .filter(chain => {
        if (selectedTags.size) {
          const tags = chainTags(chain);
          for (const tag of selectedTags) if (!tags.includes(tag)) return false;
        }
        if (!keyword) return true;
        return [chain.name, chain.description, chain.basePrompt, chainBilingual(chain), ...chainTags(chain)]
          .join(' ')
          .toLowerCase()
          .includes(keyword);
      })
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  }, [items, query, selectedTags]);

  /* ---------------- 提示与复制 ---------------- */

  const copyText = useCallback(async (value: string, label: string) => {
    if (!value) { notify(t('还没有{0}', [label]), 'error'); return; }
    try {
      await navigator.clipboard.writeText(value);
      notify(t('{0}已保存到剪贴板', [label]));
    } catch {
      notify(t('复制失败，请手动选择文本'), 'error');
    }
  }, [notify]);

  const toggleTag = (value: string) => setSelectedTags(previous => {
    const next = new Set(previous);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });

  /* ---------------- 详情态 ---------------- */

  const draftFromChain = (chain: PromptChain): LibraryDraft => ({
    id: chain.id,
    name: String(chain.name || ''),
    tags: chainTags(chain).join(', '),
    prompt: chainPrompt(chain),
    bilingual: chainBilingual(chain),
    negativePrompt: String(chain.negativePrompt || ''),
    cover: String(chain.previewImage || ''),
    coverChanged: false,
    references: chainReferences(chain),
  });

  const patchDetail = useCallback((patch: Partial<LibraryDraft>) => {
    setDetail(previous => (previous ? { ...previous, ...patch } : previous));
  }, []);

  const draftDirty = useMemo(() => {
    if (!detail) return false;
    const base = items.find(chain => chain.id === detail.id);
    if (!base) return false;
    if (detail.coverChanged) return true;
    return detail.name !== String(base.name || '')
      || detail.tags !== chainTags(base).join(', ')
      || detail.prompt !== chainPrompt(base)
      || detail.bilingual !== chainBilingual(base)
      || detail.negativePrompt !== String(base.negativePrompt || '')
      || !sameIds(detail.references.map(row => row.id), chainReferences(base).map(row => row.id));
  }, [detail, items]);

  const closeDetail = useCallback(async () => {
    if (savingDetail) return false;
    if (draftDirty && !await confirmAction({
      title: t('放弃未保存的修改？'),
      message: t('返回{0}将丢弃本次编辑的改动。', [config.title]),
      confirmLabel: t('放弃修改'),
      tone: 'danger',
    })) return false;
    setDetail(null);
    return true;
  }, [config.title, confirmAction, draftDirty, savingDetail]);

  useEffect(() => registerLeaveGuard?.(async () => {
    if (generating || savingDrafts || creating || renamePending.current) return false;
    if (!await closeDetail()) return false;
    setGenOpen(false);
    setPicker(null);
    setViewer(null);
    return true;
  }), [registerLeaveGuard, closeDetail, generating, savingDrafts, creating]);

  const saveDetail = async () => {
    if (!detail || savingDetail) return;
    setSavingDetail(true);
    try {
      const base = items.find(chain => chain.id === detail.id) ?? await awaitChain(detail.id);
      if (!base) {
        notify(t('这条{0}已不在库中，请返回列表刷新', [config.itemNoun]), 'error');
        setDetail(null);
        return;
      }
      // params 是整字段覆盖：必须带上原有生图参数，只合并 _promptLibrary。
      const params: PromptLibraryParams = {
        ...(base.params || ({} as NAIParams)),
        _promptLibrary: {
          ...libraryMeta(base),
          bilingual: detail.bilingual,
          references: detail.references.map(row => ({ id: row.id, url: row.url, prompt: row.prompt })),
        },
      };
      const updates: Partial<PromptChain> = {
        name: detail.name.trim() || t('未命名{0}', [config.itemNoun]),
        tags: parseTags(detail.tags),
        basePrompt: detail.prompt,
        negativePrompt: detail.negativePrompt,
        params,
      };
      if (detail.coverChanged) updates.previewImage = detail.cover;
      await onUpdateChain(detail.id, updates);
      notify(t('{0}已保存', [config.itemNoun]));
      setDetail(null);
    } catch (error) {
      console.warn('Prompt library save failed:', error);
      notify(t('保存失败，请稍后重试'), 'error');
    } finally {
      setSavingDetail(false);
    }
  };

  const removeChain = async (id: string, name: string) => {
    if (!await confirmAction({
      title: t('删除“{0}”？', [name || t('未命名')]),
      message: t('该{0}及其封面、参考图引用将被永久删除，此操作无法撤销。', [config.itemNoun]),
      confirmLabel: t('确认删除'),
      tone: 'danger',
    })) return;
    try {
      await onDelete(id);
    } catch (error) {
      console.warn('Prompt library delete failed:', error);
      notify(t('删除失败，请稍后重试'), 'error');
      return;
    }
    setDetail(current => (current?.id === id ? null : current));
    setViewer(null);
    notify(t('已删除该{0}', [config.itemNoun]));
  };

  /** 新建：onCreate 只在创建并刷新数据后返回 id，拿到 id 就直接在库内打开详情。 */
  const createBlank = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const newId = await onCreate(config.defaultName, '', config.kind);
      if (!newId) {
        notify(t('创建失败，请稍后重试'), 'error');
        return;
      }
      setDetail({
        id: newId,
        name: config.defaultName,
        tags: '',
        prompt: '',
        bilingual: '',
        negativePrompt: '',
        cover: '',
        coverChanged: false,
        references: [],
      });
    } catch (error) {
      console.warn('Prompt library create failed:', error);
      notify(t('创建失败，请稍后重试'), 'error');
    } finally {
      setCreating(false);
    }
  };

  /* ---------------- 原图查看器 ---------------- */

  const openViewer = useCallback((list: ViewerEntry[], index: number) => {
    const entries = (Array.isArray(list) ? list : []).filter(entry => entry && entry.url);
    if (!entries.length) return;
    setViewer({ items: entries, index: Math.max(0, Math.min(index, entries.length - 1)) });
  }, []);

  const stepViewer = useCallback((step: number) => {
    setViewer(previous => (previous
      ? { ...previous, index: (previous.index + step + previous.items.length) % previous.items.length }
      : previous));
  }, []);

  useEffect(() => {
    if (!viewer) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostModal(viewerRef.current)) return;
      if (event.key === 'Escape') { event.preventDefault(); setViewer(null); return; }
      if (event.key === 'ArrowLeft') stepViewer(-1);
      else if (event.key === 'ArrowRight') stepViewer(1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stepViewer, viewer, viewerRef]);

  /* ---------------- 从本地历史选图 ---------------- */

  const handleHistorySelect = useCallback((item: LocalGenItem, _importParams: boolean) => {
    const url = promptLibraryHistoryImageUrl(item.id);
    if (picker === 'cover') {
      patchDetail({ cover: url, coverChanged: true });
      setPicker(null);
      notify(t('已选择封面，点「保存」后生效'));
      return;
    }
    if (!detail) return;
    if (detail.references.some(row => row.id === item.id)) {
      notify(t('这张图已经作为参考图了'), 'error');
      return;
    }
    // 参考图可连续追加，选图面板保持打开。
    patchDetail({ references: [...detail.references, { id: item.id, url, prompt: String(item.prompt || '').slice(0, 200) }] });
  }, [detail, notify, patchDetail, picker]);

  /* ---------------- AI 生成 ---------------- */

  const generate = async () => {
    const text = brief.trim();
    if (!text) { notify(t('请先描述想要的{0}', [config.itemNoun]), 'error'); return; }
    setGenerating(true);
    try {
      // 限定项按顶层字段提交：空串代表「不限」，由后端决定是否写进系统提示。
      const facetInput: Record<string, string> = {};
      for (const facet of config.facets) facetInput[facet.key] = Array.isArray(facets[facet.key]) ? (facets[facet.key] as string[]).join(', ') : String(facets[facet.key] || '');
      const result = await promptAgentService.generateLibraryPrompt({
        kind: config.kind,
        brief: text,
        count,
        ...facetInput,
      });
      const list = (Array.isArray(result?.items) ? result.items : []).filter(item => item && String(item.prompt || '').trim());
      if (!list.length) throw new Error(t('没有生成可用的方案，请换个描述再试'));
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
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });

  const closeGenerator = useCallback(() => {
    if (savingDrafts) return;
    setGenOpen(false);
    setDrafts(null);
    setPicked(new Set());
    setGeneratedBy('');
  }, [savingDrafts]);

  const openGenerator = () => setGenOpen(true);

  useEffect(() => {
    if (!genOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTopmostModal(genDialogRef.current)) return;
      event.preventDefault();
      closeGenerator();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeGenerator, genDialogRef, genOpen]);

  /** 逐条落库：先 onCreate 拿到 id，再把提示词、标签与 _promptLibrary 合并写回。 */
  const savePickedDrafts = async () => {
    const chosen = (drafts || []).filter((item, index) => picked.has(index) && String(item.prompt || '').trim());
    if (!chosen.length) { notify(t('请先勾选要保存的方案'), 'error'); return; }
    setSavingDrafts(true);
    let saved = 0;
    let failed = 0;
    for (const item of chosen) {
      try {
        const newId = await onCreate(String(item.name || '').trim() || t('未命名{0}', [config.itemNoun]), String(item.note || ''), config.kind);
        if (!newId) { failed++; continue; }
        // 新条目的 params 也要保留（合并而非覆盖），拿不到就退化为空参数。
        const created = await awaitChain(newId);
        const params: PromptLibraryParams = {
          ...(created?.params || ({} as NAIParams)),
          _promptLibrary: {
            ...libraryMeta(created),
            bilingual: String(item.bilingual || ''),
            references: [],
          },
        };
        await onUpdateChain(newId, {
          tags: Array.isArray(item.tags) ? item.tags.map(value => String(value || '').trim()).filter(Boolean).slice(0, 12) : [],
          basePrompt: String(item.prompt || ''),
          params,
        });
        saved++;
      } catch (error) {
        console.warn('Prompt library draft save failed:', error);
        failed++;
      }
    }
    if (aliveRef.current) setSavingDrafts(false);
    if (saved > 0) {
      notify(failed
        ? t('已保存 {0} 条{1}，{2} 条失败', [saved, config.itemNoun, failed])
        : t('已保存 {0} 条{1}到{2}', [saved, config.itemNoun, config.title]));
      setGenOpen(false);
      setDrafts(null);
      setPicked(new Set());
      setGeneratedBy('');
      return;
    }
    notify(t('保存失败，请稍后重试'), 'error');
  };

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const renameCancelled = useRef(false);
  const renamePending = useRef(false);
  const [savingRename, setSavingRename] = useState(false);
  const commitRename = async (chain: PromptChain) => {
    if (renameCancelled.current || renamePending.current) return;
    const nextName = renameText.trim();
    if (!nextName || nextName === chain.name) { setRenamingId(null); return; }
    renamePending.current = true;
    setSavingRename(true);
    try { await onUpdateChain(chain.id, { name: nextName }); setRenamingId(current => current === chain.id ? null : current); }
    catch { notify(t('改名失败，请重试'), 'error'); }
    finally { renamePending.current = false; setSavingRename(false); }
  };
  const facetSummary = config.facets.flatMap(facet => {
    const value = facets[facet.key];
    const text = Array.isArray(value) ? value.join('、') : value;
    return text ? [t(facet.label) + ' ' + text] : [];
  }).join(' · ');

  /* ---------------- 列表态渲染 ---------------- */

  const renderCard = (chain: PromptChain) => {
    const name = String(chain.name || t('未命名'));
    const prompt = chainPrompt(chain);
    const tags = chainTags(chain);
    const references = chainReferences(chain);
    return (
      <PressRevealSurface
        as="article"
        key={chain.id}
        data-prompt-library-id={chain.id}
        data-safe-mode-work="true"
        data-return-item-id={chain.id}
        role="button"
        data-agent-action="select"
        aria-label={t('{0}：{1}', [config.itemNoun, name])}
        tabIndex={0}
        aria-disabled={savingRename}
        onClick={() => { if (!renamePending.current) setDetail(draftFromChain(chain)); }}
        onKeyDown={event => {
          if (renamePending.current) return;
          if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
          event.preventDefault();
          setDetail(draftFromChain(chain));
        }}
        className="gallery-image-card gallery-card-visual group relative flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white transition-[filter,box-shadow,border-color] duration-150 cursor-pointer hover:border-indigo-400 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-indigo-600"
      >
        <div className="mobile-gallery-frame relative aspect-[2/3] overflow-hidden bg-gray-200 dark:bg-gray-900">
          {chain.previewImage ? (
            <SmartImage src={chain.previewImage} alt={name} className="h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center text-gray-400">
              <Icon className="h-8 w-8" />
              <span className="mt-2 line-clamp-3 text-meta break-words">{prompt || t('还没有提示词')}</span>
            </div>
          )}
          {references.length > 0 && (
            <span className="absolute bottom-2 left-2 z-10 rounded-full bg-black/60 px-2 py-0.5 text-micro text-white">{t('参考图 {0}', [references.length])}</span>
          )}
          <div data-card-action="true" className="hover-reveal-md absolute right-2 top-2 z-20 flex flex-col items-center gap-2">
            <button
              type="button"
              aria-label={t('复制「{0}」的英文提示词', [name])}
              title={t('复制英文提示词')}
              onClick={event => { event.stopPropagation(); void copyText(prompt, t('英文提示词')); }}
              className="mobile-size-locked inline-flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white/90 text-gray-600 shadow transition hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-300 md:h-8 md:w-8"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={t('删除「{0}」', [name])}
              title={t('删除')}
              onClick={event => { event.stopPropagation(); void removeChain(chain.id, name); }}
              className="mobile-size-locked inline-flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white shadow transition hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:h-8 md:w-8"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="gallery-card-caption p-3">
          <div className="flex items-center justify-between gap-1.5">
            {renamingId === chain.id ? <input autoFocus aria-label={t('条目名称')} maxLength={200} aria-busy={savingRename} disabled={savingRename}
              className="w-full min-w-0 rounded border border-indigo-400 bg-white px-1 text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100"
              value={renameText} onClick={event => event.stopPropagation()}
              onChange={event => setRenameText(event.target.value)}
              onBlur={() => { void commitRename(chain); }}
              onKeyDown={event => { event.stopPropagation();
                if (event.key === 'Enter') { event.preventDefault(); void commitRename(chain); }
                if (event.key === 'Escape') { event.preventDefault(); renameCancelled.current = true; setRenamingId(null); }
              }} /> : <button type="button" data-safe-mode-title="true" aria-label={t('重命名{0}', [name])}
            className="min-w-0 truncate text-left text-sm font-bold text-gray-900 dark:text-white" title={name} disabled={savingRename}
              onClick={event => { event.stopPropagation(); if (renamePending.current) return; renameCancelled.current = false; setRenameText(name); setRenamingId(chain.id); }}
              onKeyDown={event => event.stopPropagation()}>{name}</button>}
            {config.hideActions && <span className="shrink-0 text-micro text-gray-500">{t(PROMPT_LIBRARY_KINDS[chain.type as PromptLibraryKind]?.itemNoun || '')}</span>}
          </div>
          <div className="gallery-card-meta mt-1 flex flex-wrap items-center gap-1">
            {tags.slice(0, 3).map(tag => (
              <span key={tag} className="gallery-card-badge max-w-full truncate rounded bg-gray-100 px-1.5 py-0.5 text-micro font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400" title={tag}>{tag}</span>
            ))}
            {!tags.length && <span className="truncate font-mono text-micro text-gray-400 dark:text-gray-500" title={prompt}>{prompt || t('还没有提示词')}</span>}
          </div>
        </div>
      </PressRevealSurface>
    );
  };

  const listToolbar = (
    <WorkspaceToolbar>
      <div className="relative min-w-0 flex-1">
        <ToolbarSearch
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={t('搜索{0}名称、标签或提示词', [config.itemNoun])}
          containerClassName="md:max-w-none!"
        />
      </div>
      <ToolbarPopover title={t('筛选{0}', [config.title])} count={selectedTags.size} width={320}>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {selectedTags.size > 0 ? t('已启用 {0} 项标签筛选', [selectedTags.size]) : t('全部标签')}
            </span>
            {selectedTags.size > 0 && (
              <button type="button" onClick={() => setSelectedTags(new Set())} className="mobile-touch px-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300">{t('清除标签筛选')}</button>
            )}
          </div>
          {tagOptions.length > 12 && (
            <input
              aria-label={t('搜索标签')}
              placeholder={t('搜索标签')}
              value={tagQuery}
              onChange={event => setTagQuery(event.target.value)}
              className="mobile-touch w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-900 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          )}
          {tagOptions.length === 0 ? (
            <p className="text-xs text-gray-400">{t('还没有标签，可在详情里添加')}</p>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              <div className="flex flex-wrap gap-1.5">
                {visibleTagOptions.map(([value, total]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selectedTags.has(value)}
                    onClick={() => toggleTag(value)}
                    className={`mobile-touch max-w-full break-words rounded-full border px-3 py-1.5 text-xs ${selectedTags.has(value) ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'border-transparent bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
                  >
                    {t('{0}（{1}）', [value, total])}
                  </button>
                ))}
              </div>
              {visibleTagOptions.length === 0 && <p className="py-1 text-xs text-gray-400">{t('没有匹配的标签')}</p>}
            </div>
          )}
          {selectedTags.size > 1 && <p className="text-xs text-gray-400">{t('只显示同时包含全部所选标签的{0}', [config.itemNoun])}</p>}
        </div>
      </ToolbarPopover>
      {!config.hideActions && <div className="flex flex-none items-center gap-1 border-l border-gray-200 pl-2 dark:border-gray-700">
        <ToolbarButton onClick={config.hideActions ? undefined : openGenerator} aria-label={t(config.generateLabel)} title={t(config.generateLabel)} className="mobile-touch !px-2.5 md:!px-3">
          <Sparkles /><span className="hidden sm:inline">{t(generatorTitle)}</span>
        </ToolbarButton>
        <ToolbarButton tone="primary" onClick={() => void createBlank()} disabled={creating} aria-label={t(config.createLabel)} title={t(config.createLabel)} className="mobile-touch !px-2.5 md:!px-3">
          {creating ? <LoaderCircle className="animate-spin" /> : <Plus />}<span className="hidden sm:inline">{t(config.createLabel)}</span>
        </ToolbarButton>
      </div>}
    </WorkspaceToolbar>
  );

  const listBody = shown.length ? (
    <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-character-grid`} style={mobileGalleryStyle(imageDisplay)}>
      {shown.map(renderCard)}
    </div>
  ) : (
    <EmptyState
      className="py-20"
      icon={<Icon className="h-8 w-8" aria-hidden="true" />}
      title={items.length ? t('没有找到符合条件的{0}', [config.itemNoun]) : t(config.emptyTitle)}
      hint={items.length ? t('换个关键词，或清除标签筛选。') : t(config.emptyHint)}
      action={!items.length ? (
        !config.hideActions ? <ToolbarButton tone="primary" onClick={openGenerator}><Sparkles /><span>{t(generatorTitle)}</span></ToolbarButton> : undefined
      ) : undefined}
    />
  );

  /* ---------------- 详情态渲染 ---------------- */

  const referenceEntries: ViewerEntry[] = detail
    ? detail.references.map(row => ({ url: row.url, caption: row.prompt }))
    : [];

  const detailToolbar = detail ? (
    <WorkspaceToolbar>
      <ToolbarButton onClick={() => void closeDetail()} disabled={savingDetail} aria-label={t('返回{0}', [config.title])} title={t('返回{0}', [config.title])} className="mobile-touch !px-2.5 md:!px-3">
        <ArrowLeft /><span className="hidden sm:inline">{t('返回')}</span>
      </ToolbarButton>
      <div className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900 dark:text-white" title={detail.name || t('未命名')}>{detail.name || t('未命名')}</div>
      {draftDirty && <span className="flex-none rounded-full bg-amber-50 px-2 py-0.5 text-micro font-semibold text-amber-600 dark:bg-amber-950/40 dark:text-amber-300">{t('未保存')}</span>}
      <div className="flex flex-none items-center gap-1">
        <ToolbarButton tone="danger" disabled={savingDetail} onClick={() => void removeChain(detail.id, detail.name)} aria-label={t('删除')} title={t('删除')} className="mobile-touch !px-2.5 md:!px-3">
          <Trash2 /><span className="hidden sm:inline">{t('删除')}</span>
        </ToolbarButton>
        <ToolbarButton tone="primary" disabled={savingDetail} onClick={() => void saveDetail()} aria-label={t('保存')} title={t('保存')} className="mobile-touch !px-2.5 md:!px-3">
          {savingDetail && <LoaderCircle className="animate-spin" />}<span>{savingDetail ? t('保存中…') : t('保存')}</span>
        </ToolbarButton>
      </div>
    </WorkspaceToolbar>
  ) : null;

  const detailBody = detail ? (
    <div className="mx-auto grid w-full max-w-[1400px] gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className={`${DETAIL_CARD_CLASS} space-y-4`}>
        <label className="block">
          <span className={DETAIL_LABEL_CLASS}>{t('名称')}</span>
          <input
            value={detail.name}
            onChange={event => patchDetail({ name: event.target.value })}
            placeholder={t('例如：银发红瞳的少女')}
            aria-label={t('{0}名称', [config.itemNoun])}
            className={DETAIL_FIELD_CLASS}
          />
        </label>
        <label className="block">
          <span className={DETAIL_LABEL_CLASS}>{t('标签（逗号分隔）')}</span>
          <input
            value={detail.tags}
            onChange={event => patchDetail({ tags: event.target.value })}
            placeholder={t(config.tagPlaceholder)}
            aria-label={t('{0}标签', [config.itemNoun])}
            className={DETAIL_FIELD_CLASS}
          />
        </label>
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className={DETAIL_LABEL_CLASS}>{t('纯英文提示词（生图用）')}</span>
            <button type="button" onClick={() => void copyText(detail.prompt, t('英文提示词'))} aria-label={t('复制英文提示词')} title={t('复制英文提示词')} className="mobile-touch inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"><Copy className="h-4 w-4" /></button>
          </div>
          <textarea
            value={detail.prompt}
            onChange={event => patchDetail({ prompt: event.target.value })}
            aria-label={t('英文提示词')}
            className={`${DETAIL_FIELD_CLASS} h-32 resize-y font-mono`}
          />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className={DETAIL_LABEL_CLASS}>{t('中英对照')}</span>
            <button type="button" onClick={() => void copyText(detail.bilingual, t('中英对照'))} aria-label={t('复制中英对照')} title={t('复制中英对照')} className="mobile-touch inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"><Copy className="h-4 w-4" /></button>
          </div>
          <textarea
            value={detail.bilingual}
            onChange={event => patchDetail({ bilingual: event.target.value })}
            placeholder={t('AI 生成时自动写入，也可以手写或粘贴')}
            aria-label={t('中英对照提示词')}
            className={`${DETAIL_FIELD_CLASS} h-32 resize-y`}
          />
        </div>
        <label className="block">
          <span className={DETAIL_LABEL_CLASS}>{t('负面提示词（可选）')}</span>
          <textarea
            value={detail.negativePrompt}
            onChange={event => patchDetail({ negativePrompt: event.target.value })}
            aria-label={t('负面提示词')}
            className={`${DETAIL_FIELD_CLASS} h-20 resize-y font-mono`}
          />
        </label>
      </div>

      <div className="space-y-4">
        <div className={DETAIL_CARD_CLASS}>
          <span className={DETAIL_LABEL_CLASS}>{t('封面')}</span>
          {detail.cover ? (
            <button
              type="button"
              onClick={() => openViewer([{ url: detail.cover, caption: detail.name }], 0)}
              aria-label={t('查看封面原图')}
              title={t('点击查看原图')}
              className="mt-1.5 block w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
            >
              <SmartImage src={detail.cover} alt={t('封面预览')} thumbnailVariant="thumb-640" className="h-full w-full object-cover" containerClassName="relative aspect-[2/3] w-full overflow-hidden bg-gray-100 dark:bg-gray-950" />
            </button>
          ) : (
            <div className="mt-1.5 flex aspect-[2/3] items-center justify-center rounded-xl bg-gray-100 text-meta text-gray-400 dark:bg-gray-950">{t('暂无封面')}</div>
          )}
          <div className="mt-2 flex gap-2">
            <ToolbarButton onClick={() => setPicker('cover')} className="mobile-touch flex-1"><ImagePlus /><span>{t('从历史选图')}</span></ToolbarButton>
            <ToolbarButton disabled={!detail.cover} onClick={() => patchDetail({ cover: '', coverChanged: true })} className="mobile-touch flex-1"><X /><span>{t('清除')}</span></ToolbarButton>
          </div>
          <p className="mt-2 text-micro text-gray-400 dark:text-gray-500">{t('封面保存后由后端转成独立资产，不会随历史清理而失效。')}</p>
        </div>

        <div className={DETAIL_CARD_CLASS}>
          <div className="flex items-center justify-between gap-2">
            <span className={DETAIL_LABEL_CLASS}>{t('参考图（{0}）', [detail.references.length])}</span>
          </div>
          {detail.references.length ? (
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {detail.references.map((reference, index) => (
                <div key={reference.id} className="relative">
                  <button
                    type="button"
                    onClick={() => openViewer(referenceEntries, index)}
                    aria-label={t('查看参考图 {0}', [index + 1])}
                    title={reference.prompt || t('点击查看原图')}
                    className="block w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
                  >
                    <SmartImage src={reference.url} alt={t('参考图')} thumbnailVariant="thumb-480" className="h-full w-full object-cover" containerClassName="relative aspect-square w-full overflow-hidden bg-gray-100 dark:bg-gray-950" />
                  </button>
                  <button
                    type="button"
                    onClick={() => patchDetail({ references: detail.references.filter(row => row.id !== reference.id) })}
                    aria-label={t('移除参考图 {0}', [index + 1])}
                    title={t('移除')}
                    className="absolute -right-1.5 -top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-1.5 flex min-h-20 items-center justify-center rounded-xl bg-gray-50 text-meta text-gray-400 dark:bg-gray-950/60">{t('还没有参考图')}</div>
          )}
          <ToolbarButton onClick={() => setPicker('reference')} className="mobile-touch mt-2 w-full"><ImagePlus /><span>{t('从历史导入参考图')}</span></ToolbarButton>
          <p className="mt-2 text-micro text-gray-400 dark:text-gray-500">{t('参考图只引用历史图片，不会复制原图；数量不限，点图片可看原图。')}</p>
        </div>
      </div>
    </div>
  ) : null;

  /* ---------------- 浮层渲染 ---------------- */

  const generator = genOpen ? (
    <ImagePreviewPortal>
      <div
        className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
        onMouseDown={event => { if (event.target === event.currentTarget) closeGenerator(); }}
      >
        <div
          ref={genDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t(generatorTitle)}
          className="appearance-panel ui-modal-enter flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900 sm:rounded-2xl"
        >
          <header className="flex flex-none items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-5">
            <Wand2 className="h-4 w-4 text-indigo-500" />
            <h2 className="min-w-0 flex-1 truncate font-bold text-gray-900 dark:text-white">{t(generatorTitle)}</h2>
            <button type="button" onClick={closeGenerator} disabled={savingDrafts} aria-label={t('关闭生成面板')} className="mobile-touch flex h-10 w-10 flex-none items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            <label className="block">
              <span className={DETAIL_LABEL_CLASS}>{t(config.briefLabel)}</span>
              <textarea
                autoFocus
                value={brief}
                onChange={event => setBrief(event.target.value)}
                placeholder={t(config.briefPlaceholder)}
                aria-label={t(config.briefLabel)}
                className={`${DETAIL_FIELD_CLASS} h-20 resize-y`}
              />
            </label>

            {facetSummary && <p className="text-xs text-gray-600 dark:text-gray-300">{t(`限定：${facetSummary}`)}</p>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {config.facets.map(facet => facet.multiple ? (
                <fieldset key={facet.key} className="min-w-0">
                  <legend className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t(facet.label)}</legend>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button type="button" className="mobile-touch rounded-full border px-2 text-xs" onClick={() => setFacets(previous => ({...previous, [facet.key]: []}))}>{t('不限')}</button>
                    {facet.options.filter(Boolean).map(option => {
                      const selected = Array.isArray(facets[facet.key]) ? facets[facet.key] as string[] : [];
                      return <button key={option} type="button" aria-pressed={selected.includes(option)}
                        className={`mobile-touch rounded-full border px-2 text-xs ${selected.includes(option) ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200' : 'border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
                        onClick={() => setFacets(previous => ({...previous, [facet.key]: selected.includes(option) ? selected.filter(value => value !== option) : [...selected, option]}))}>{t(option)}</button>;
                    })}
                  </div>
                </fieldset>
              ) : (
                <label key={facet.key} className="block">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t(facet.label)}</span>
                  <select value={String(facets[facet.key] || '')}
                    onChange={event => setFacets(previous => ({...previous, [facet.key]: event.target.value}))}
                    aria-label={t(facet.label)} className={TOOLBAR_FIELD_CLASS}>
                    {facet.options.map(option => <option key={option || 'any'} value={option}>{option ? t(option) : t('不限')}</option>)}
                  </select>
                </label>
              ))}
              <label className="block">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('生成数量')}</span>
                <select value={count} onChange={event => setCount(Number(event.target.value))} aria-label={t('生成数量')} className={TOOLBAR_FIELD_CLASS}>
                  {COUNT_OPTIONS.map(value => <option key={value} value={value}>{t('{0} 条', [value])}</option>)}
                </select>
              </label>
            </div>

            <p className="text-micro text-gray-400 dark:text-gray-500">{t(config.generateHint)}</p>

            {drafts && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('生成候选（{0} 条，已选 {1} 条）', [drafts.length, picked.size])}</span>
                  {generatedBy && <span className="truncate text-micro text-gray-400" title={generatedBy}>{t('由 {0} 生成', [generatedBy])}</span>}
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
                        className={`${DETAIL_FIELD_CLASS} mt-0 flex-1`}
                      />
                    </div>
                    <label className="mt-2 block">
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t('纯英文（生图用）')}</span>
                      <textarea
                        value={draft.prompt || ''}
                        onChange={event => patchDraft(index, { prompt: event.target.value })}
                        aria-label={t('方案 {0} 英文提示词', [index + 1])}
                        className={`${DETAIL_FIELD_CLASS} h-20 resize-y font-mono`}
                      />
                    </label>
                    <label className="mt-2 block">
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t('中英对照')}</span>
                      <textarea
                        value={draft.bilingual || ''}
                        onChange={event => patchDraft(index, { bilingual: event.target.value })}
                        placeholder={t('模型未返回对照时可留空')}
                        aria-label={t('方案 {0} 中英对照', [index + 1])}
                        className={`${DETAIL_FIELD_CLASS} h-20 resize-y`}
                      />
                    </label>
                    {draft.tags && draft.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {draft.tags.map(value => <span key={value} className="rounded bg-gray-100 px-1.5 py-0.5 text-micro text-gray-500 dark:bg-gray-800 dark:text-gray-400">{value}</span>)}
                      </div>
                    )}
                    {draft.note && <p className="mt-1 text-micro text-gray-400">{draft.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <footer className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
            <ToolbarButton onClick={() => void generate()} disabled={generating} tone="primary" className="mobile-touch">
              {generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              <span>{generating ? t('生成中…') : drafts ? t('重新生成') : t('开始生成')}</span>
            </ToolbarButton>
            {drafts && (
              <ToolbarButton onClick={() => void savePickedDrafts()} disabled={savingDrafts} className="mobile-touch">
                {savingDrafts ? <LoaderCircle className="animate-spin" /> : null}
                <span>{savingDrafts ? t('保存中…') : t('保存选中（{0}）', [picked.size])}</span>
              </ToolbarButton>
            )}
            <ToolbarButton onClick={closeGenerator} disabled={savingDrafts} className="mobile-touch"><span>{t('取消')}</span></ToolbarButton>
          </footer>
        </div>
      </div>
    </ImagePreviewPortal>
  ) : null;

  const viewerModal = viewer ? (
    <ImagePreviewPortal>
      <div
        ref={viewerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('查看原图')}
        className="ui-backdrop-enter fixed inset-0 z-[1400] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
        onMouseDown={event => { if (event.target === event.currentTarget) setViewer(null); }}
      >
        <button
          type="button"
          onClick={() => setViewer(null)}
          aria-label={t('关闭原图')}
          title={t('关闭（Esc）')}
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
        >
          <X className="h-5 w-5" />
        </button>
        {viewer.items.length > 1 && (
          <button
            type="button"
            onClick={() => stepViewer(-1)}
            aria-label={t('上一张')}
            className="absolute left-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <OriginalImage
          src={viewer.items[viewer.index]?.url || ''}
          alt={t('原图')}
          data-safe-mode-ignore="true"
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
        {viewer.items.length > 1 && (
          <button
            type="button"
            onClick={() => stepViewer(1)}
            aria-label={t('下一张')}
            className="absolute right-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
        <div className="absolute bottom-5 left-1/2 max-w-[90%] -translate-x-1/2 truncate rounded bg-black/65 px-4 py-2 text-center text-sm text-white">
          {viewer.index + 1} / {viewer.items.length}{viewer.items[viewer.index]?.caption ? ` · ${viewer.items[viewer.index].caption}` : ''}
        </div>
      </div>
    </ImagePreviewPortal>
  ) : null;

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      {detail ? detailToolbar : listToolbar}
      <div className="relative flex-1 overflow-y-auto p-4 pb-28 md:p-6 md:pb-24">
        {detail ? detailBody : listBody}
      </div>
      {generator}
      <HistoryImagePicker open={picker !== null} onClose={() => setPicker(null)} onSelect={handleHistorySelect} />
      {viewerModal}
    </div>
  );
};

/* ---------------- 三个领域包装组件 ---------------- */

export const AppearanceLibrary: React.FC<PromptLibraryProps> = props => (
  <PromptLibrary config={PROMPT_LIBRARY_KINDS.appearance} {...props} />
);

export const WardrobeLibrary: React.FC<PromptLibraryProps> = props => (
  <PromptLibrary config={PROMPT_LIBRARY_KINDS.wardrobe} {...props} />
);

export const PoseLibrary: React.FC<PromptLibraryProps> = props => (
  <PromptLibrary config={PROMPT_LIBRARY_KINDS.pose} {...props} />
);

export const SceneLibrary: React.FC<PromptLibraryProps> = props => <PromptLibrary {...props} config={PROMPT_LIBRARY_KINDS.scene} />;
const ALL_CONFIG: PromptLibraryKindConfig = {...PROMPT_LIBRARY_KINDS.appearance, type: ['appearance','wardrobe','pose','scene'], title:'图片提示词库', itemNoun:'提示词', emptyTitle:'图片提示词库还是空的', hideActions:true};
const LIBRARY_CATEGORIES = ['all','appearance','wardrobe','pose','scene'] as const;
type LibraryCategory = typeof LIBRARY_CATEGORIES[number];
export const PromptLibraryHub: React.FC<PromptLibraryProps> = props => {
  useLanguage();
  const leaveGuards = useRef<Partial<Record<LibraryCategory, () => Promise<boolean>>>>({});
  const [kind, setKind] = useState<LibraryCategory>(() => {
    try { const saved=localStorage.getItem('nai-prompt-library-kind'); return LIBRARY_CATEGORIES.includes(saved as LibraryCategory) ? saved as LibraryCategory : 'all'; }
    catch { return 'all'; }
  });
  const selectKind = async (category: LibraryCategory) => {
    if (category === kind) return;
    const guard = leaveGuards.current[kind];
    if (guard && !await guard()) return;
    setKind(category);
    try { localStorage.setItem('nai-prompt-library-kind', category); } catch { /* 存储受限时仍可切换分类。 */ }
  };
  return <div className="flex h-full min-h-0 flex-1 flex-col">
    <div role="tablist" aria-label={t('提示词分类')} className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
      {LIBRARY_CATEGORIES.map(category => {
        const count=props.chains.filter(chain => category==='all' ? LIBRARY_CATEGORIES.includes(chain.type as LibraryCategory) : chain.type===category).length;
        const label=category==='all' ? '全部' : category==='scene' ? '场景' : PROMPT_LIBRARY_KINDS[category].title.replace('库','');
        return <button key={category} type="button" role="tab" aria-selected={kind===category}
          className={`mobile-touch shrink-0 rounded-lg px-3 text-sm ${kind===category ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200' : 'text-gray-600 dark:text-gray-300'}`}
          onClick={() => { void selectKind(category); }}>{t(label)} {count}</button>;
      })}
    </div>
    {LIBRARY_CATEGORIES.map(category => <div key={category} hidden={kind!==category} className="h-full min-h-0 flex-1">
      <PromptLibrary {...props} config={category==='all' ? ALL_CONFIG : PROMPT_LIBRARY_KINDS[category]}
        registerLeaveGuard={guard => { leaveGuards.current[category] = guard; return () => { delete leaveGuards.current[category]; }; }} />
    </div>)}
  </div>;
};
