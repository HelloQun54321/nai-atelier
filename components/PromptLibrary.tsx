/**
 * 提示词库：人物形象 / 服饰 / 姿势 / 场景共用一套配置驱动实现。
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
import React, { useCallback, useEffect, useLayoutEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Copy,
  Folder,
  Library,
  ImagePlus,
  LoaderCircle,
  PersonStanding,
  Plus,
  Aperture,
  Shirt,
  Smile,
  Sparkles,
  Trash2,
  UserRound,
  Wand2,
  Image,
  X,
} from 'lucide-react';
import type { ChainType, LocalGenItem, NAIParams, PromptChain } from '../types';
import { promptAgentService, type PromptLibraryItem, type PromptLibraryKind } from '../services/promptAgent';
import { LAB_DEFAULT_PARAMS } from '../services/labWorkspace';
import { useConfirmDialog } from './ConfirmDialog';
import { EmptyState, ToolbarButton, ToolbarSearch, WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';
import { ToolbarCountCaption } from './ToolbarCountCaption';
import { HistoryImagePicker } from './HistoryImagePicker';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { PromptLibraryCard, PromptLibraryGallery } from './PromptLibraryCard';
import { ImageLightbox } from './ImageLightbox';
import { SmartImage } from './SmartImage';
import { TOOLBAR_FIELD_CLASS, ToolbarPopover } from './ToolbarPopover';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { PromptLibraryBundleDialog } from './PromptLibraryBundleDialog';
import type { PromptLibraryBundleChainWrite } from './PromptLibraryBundleDialog';
import { deleteLabWorkspaceSession, getLabWorkspaceSessionKey } from '../services/labWorkspace';
import { PromptLibraryUsageBadge, PromptLibraryUsageSection } from './PromptLibraryUsage';
import { fetchPromptLibraryUsageSummary } from '../services/promptLibraryUsage';

import { PROMPT_LIBRARY_KINDS, type PromptLibraryKindConfig } from './promptLibraryConfig';
import { fragmentKindOf, FRAGMENT_LABELS, parsePromptLibraryTags, promptLibraryEntryLabel } from '../services/promptLibraryEntries';
import { LibraryDialog, usePromptLibrary } from './PromptLibraryAccess';
import { PromptLibraryDirectoryPicker } from './PromptLibraryDirectoryPicker';
import { PromptLibraryDirectoryNavigation } from './PromptLibraryDirectoryNavigation';
import { getPromptLibraryEntryDirectoryIds, getPromptLibraryDirectoryPath, getPromptLibraryDirectoryLegacyKind, selectPromptLibraryDirectoryEntries } from '../services/promptLibraryDirectories';
import { removePromptTag, tagDetails } from '../services/promptTagFilter';
import { classifyPromptTags, summarizePromptSources } from '../services/promptProvenance';
export { PROMPT_LIBRARY_KINDS } from './promptLibraryConfig';
export type { PromptLibraryFacet, PromptLibraryKindConfig } from './promptLibraryConfig';

/** 领域图标只用于展示，不放进纯数据配置表。 */
const KIND_ICONS: Record<PromptLibraryKind, React.FC<{ className?: string }>> = {
  appearance: UserRound,
  wardrobe: Shirt,
  pose: PersonStanding,
  expression: Smile,
  scene: Image,
  camera: Aperture,
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
  const params = chain?.params as (PromptLibraryParams & { _wardrobe?: unknown }) | undefined;
  /* 双格式：源码条目写 _promptLibrary；本机旧条目把中文对照 / 参考图 / facets 写在 _wardrobe 里 */
  const raw = params
    ? (params._promptLibrary && typeof params._promptLibrary === 'object'
      ? params._promptLibrary
      : (params._wardrobe && typeof params._wardrobe === 'object' ? params._wardrobe as PromptLibraryMeta : undefined))
    : undefined;
  return raw && typeof raw === 'object' ? raw : {};
};

const chainTags = (chain?: PromptChain | null): string[] =>
  (Array.isArray(chain?.tags) ? chain!.tags : []).map(value => String(value || '').trim()).filter(Boolean);

const chainPrompt = (chain?: PromptChain | null): string => String(chain?.basePrompt || '');

const chainBilingual = (chain?: PromptChain | null): string => String(libraryMeta(chain).bilingual || '');

const chainReferences = (chain?: PromptChain | null): PromptLibraryReference[] => {
  const list = libraryMeta(chain).references;
  if (!Array.isArray(list)) return [];
  return list
    .filter(item => item && typeof item.url === 'string' && item.url)
    .map(item => ({ id: String(item.id || ''), url: String(item.url), prompt: String(item.prompt || '') }));
};

const sameIds = (list: string[], other: string[]) =>
  list.length === other.length && list.every((id, index) => id === other[index]);

const COUNT_OPTIONS = [1, 2, 3, 4, 5, 6];

/** 详情态的表单草稿：与库里的 chain 分开保存，未点「保存」不落库。 */
interface LibraryDraft {
  directoryIds: string[];
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
  /** 由 App 创建完整条目并同步列表，不跳转导航；返回新条目 id。 */
  onCreate: (name: string, description: string, type: ChainType, data?: Partial<PromptChain>) => Promise<string | undefined>;
  onUpdateChain: PromptLibraryUpdateChain;
  onDelete: (id: string) => Promise<void> | void;
  notify: (message: string, type?: 'success' | 'error') => void;
  /** 作为「提示词库」的子分区渲染：不再自带页面顶栏与外层画布。 */
  embedded?: boolean;
  /** 嵌入时把搜索／筛选工具栏挂到父级顶栏的槽位。 */
  toolbarSlot?: HTMLElement | null;
  requestCloseRef?: React.MutableRefObject<(() => void) | null>;
  onClose?: () => void;
}

interface PromptLibraryInternalProps extends PromptLibraryProps {
  dynamicDirectories?: boolean;
  initialDirectoryIds?: string[];
  directoryNavigation?: React.ReactNode;
  directorySelectionKey?: string;
  config: PromptLibraryKindConfig;
  initialEntry?: PromptChain;
  onEditorClose?: () => void;
  categoryNavigation?: React.ReactNode;
  categoryToggle?: React.ReactNode;
  registerLeaveGuard?: (guard: () => Promise<boolean>) => () => void;
  browsing?: LibraryBrowsing;
  rememberBrowsing?: (state: LibraryBrowsing) => void;
}

interface LibraryBrowsing {
  query: string;
  tags: string[];
  sort: 'updated' | 'name';
  scrollTop: number;
}

const DETAIL_FIELD_CLASS = 'mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const DETAIL_LABEL_CLASS = 'text-sm font-semibold text-gray-700 dark:text-gray-200';

/* ---------------- 内部通用组件 ---------------- */

export const PromptLibrary: React.FC<PromptLibraryInternalProps> = ({
  config,
  initialEntry,
  onEditorClose,
  requestCloseRef,
  categoryNavigation,
  categoryToggle,
  registerLeaveGuard,
  chains,
  onCreate,
  onUpdateChain,
  onDelete,
  notify,
  embedded = false,
  toolbarSlot = null,
  browsing,
  rememberBrowsing,
  dynamicDirectories = false,
  initialDirectoryIds = [],
  directoryNavigation,
  directorySelectionKey,
}) => {
  useLanguage();
  const library = usePromptLibrary();
  const confirmAction = useConfirmDialog();
  const Icon = config.general ? Library : KIND_ICONS[config.kind];
  const generatorTitle = library?.directories ? 'AI 生成片段' : config.generateLabel.replace('✦ ', '');

  const [query, setQuery] = useState(browsing?.query || '');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set(browsing?.tags));
  const [sort, setSort] = useState<LibraryBrowsing['sort']>(browsing?.sort || 'updated');
  const scrollRef = useRef<HTMLDivElement>(null);
  const browsingRef = useRef<LibraryBrowsing>({ query, tags: [...selectedTags], sort, scrollTop: browsing?.scrollTop || 0 });
  browsingRef.current = { ...browsingRef.current, query, tags: [...selectedTags], sort };
  const rememberRef = useRef(rememberBrowsing);
  rememberRef.current = rememberBrowsing;
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = browsingRef.current.scrollTop;
    return () => { rememberRef.current?.(browsingRef.current); };
  }, []);
  const resetScroll = () => { if (scrollRef.current) scrollRef.current.scrollTop = 0; browsingRef.current.scrollTop = 0; };
  const [tagQuery, setTagQuery] = useState('');

  const [detail, setDetail] = useState<LibraryDraft | null>(() => initialEntry ? draftFromChain(initialEntry) : null);
  const [savingDetail, setSavingDetail] = useState(false);
  const [creating, setCreating] = useState(false);

  const [picker, setPicker] = useState<'cover' | 'reference' | null>(null);
  const [viewer, setViewer] = useState<{ items: ViewerEntry[]; index: number } | null>(null);

  const [genOpen, setGenOpen] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);
  /* 六库结果写进风格串：只列风格串当目标，写完清掉该串的编辑器草稿 */
  const styleChains = useMemo(
    () => (Array.isArray(chains) ? chains : []).filter(chain => chain && chain.type === 'style'),
    [chains],
  );
  const writeBundleToChain = useCallback<PromptLibraryBundleChainWrite>(async ({ chain, name, params, variableValues }) => {
    if (chain) {
      await onUpdateChain(chain.id, { params, variableValues });
      deleteLabWorkspaceSession(getLabWorkspaceSessionKey(chain.id));
      return chain.id;
    }
    return onCreate(name, t('来自一键六库内容'), 'style', { params, variableValues });
  }, [onCreate, onUpdateChain]);
  const [brief, setBrief] = useState('');
  const [generationDirectoryIds, setGenerationDirectoryIds] = useState<string[]>(initialDirectoryIds.slice(0, 1));
  const previousDirectorySelection = useRef(directorySelectionKey);
  useLayoutEffect(() => {
    if (previousDirectorySelection.current === directorySelectionKey) return;
    previousDirectorySelection.current = directorySelectionKey;
    resetScroll(); setGenerationDirectoryIds(initialDirectoryIds.slice(0, 1));
  }, [directorySelectionKey]);
  const [facets, setFacets] = useState<Record<string, string | string[]>>({});
  const [count, setCount] = useState(1);
  /* 详细补全：三档（默认详细）+ 需求未提到的限定项保持留空 */
  const [detailMode, setDetailMode] = useState<'strict' | 'moderate' | 'detailed'>('detailed');
  const [keepEmpty, setKeepEmpty] = useState(false);
  const [drafts, setDrafts] = useState<PromptLibraryItem[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [savingDrafts, setSavingDrafts] = useState(false);
  const [generatedBy, setGeneratedBy] = useState('');

  const genDialogRef = useModalA11y<HTMLDivElement>(genOpen);
  // 异步流程里要读取「最新的 chains」：直接读 props 会闭包过期。
  const chainsRef = useRef(chains);
  chainsRef.current = chains;
  // 卸载后不再回写状态；用 effect 复位是为了兼容 StrictMode 的模拟卸载重挂。
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    setFacets(Object.fromEntries(config.facets.map(facet => [facet.key, facet.multiple ? [] : ''])));
  }, [config]);

  /* ---------------- 图墙计数（生成记录） ---------------- */

  const [usageById, setUsageById] = useState<Map<string, number>>(() => new Map());

  /** 汇总失败只是没有胶囊，不影响库的读写，因此不弹提示。 */
  const refreshUsage = useCallback(async () => {
    try {
      const summary = await fetchPromptLibraryUsageSummary();
      if (!aliveRef.current) return;
      setUsageById(new Map(summary.items.map(row => [row.chainId, row.count])));
    } catch (error) {
      console.warn('Prompt library usage summary failed:', error);
    }
  }, []);

  useEffect(() => { void refreshUsage(); }, [refreshUsage]);

  /* 生成新图不会实时推给前端：切回页面时重读一次，卡片角标才不会停在旧数字。 */
  useEffect(() => {
    const handleVisibility = () => { if (!document.hidden) void refreshUsage(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [refreshUsage]);

  const items = useMemo(
    () => (Array.isArray(chains) ? chains : []).filter(chain => chain && fragmentKindOf(chain) && (dynamicDirectories || config.hideActions || (config.general ? fragmentKindOf(chain) === 'general' : chain.type === config.type))),
    [chains, config.type, config.general, config.hideActions, dynamicDirectories],
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
      .sort((left, right) => sort === 'name' ? left.name.localeCompare(right.name) : Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  }, [items, query, selectedTags, sort]);

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

  const toggleTag = (value: string) => { resetScroll(); setSelectedTags(previous => {
    const next = new Set(previous);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  }); };

  /* ---------------- 详情态 ---------------- */

  function draftFromChain(chain: PromptChain): LibraryDraft { return {
    id: chain.id,
    directoryIds: library?.directories ? getPromptLibraryEntryDirectoryIds(chain, library.directories) : [],
    name: String(chain.name || ''),
    tags: chainTags(chain).join(', '),
    prompt: chainPrompt(chain),
    bilingual: chainBilingual(chain),
    negativePrompt: String(chain.negativePrompt || ''),
    cover: String(chain.previewImage || ''),
    coverChanged: false,
    references: chainReferences(chain),
  }; }

  const patchDetail = useCallback((patch: Partial<LibraryDraft>) => {
    setDetail(previous => (previous ? { ...previous, ...patch } : previous));
  }, []);

  const draftDirty = useMemo(() => {
    if (!detail) return false;
    const base = items.find(chain => chain.id === detail.id);
    if (!base) return false;
    if (detail.coverChanged) return true;
    return !!library?.directories && !sameIds(detail.directoryIds, getPromptLibraryEntryDirectoryIds(base, library.directories)) || detail.name !== String(base.name || '')
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
      message: t('返回{0}将丢弃本次编辑的改动。', [t(config.title)]),
      confirmLabel: t('放弃修改'),
      tone: 'danger',
      rememberKey: 'prompt-library-fragment.leave',
      onSave: () => saveDetail(false),
    })) return false;
    setDetail(null);
    onEditorClose?.();
    // 详情关闭时顺手刷新图墙计数：详情内的保存/删除/改名都发生在离开之后才可见。
    void refreshUsage();
    return true;
  }, [config.title, confirmAction, draftDirty, refreshUsage, savingDetail, onEditorClose, saveDetail]);

  useEffect(() => {
    if (!requestCloseRef) return;
    requestCloseRef.current = () => { void closeDetail(); };
    return () => { requestCloseRef.current = null; };
  }, [requestCloseRef, closeDetail]);

  useEffect(() => registerLeaveGuard?.(async () => {
    if (generating || savingDrafts || creating || renamePending.current) return false;
    if (!await closeDetail()) return false;
    setGenOpen(false);
    setBundleOpen(false);
    setPicker(null);
    setViewer(null);
    return true;
  }), [registerLeaveGuard, closeDetail, generating, savingDrafts, creating]);

  async function saveDetail(close = true) {
    if (!detail || savingDetail || library?.directoriesError) return false;
    setSavingDetail(true);
    try {
      const base = chainsRef.current.find(chain => chain.id === detail.id);
      if (!base) {
        notify(t('这条{0}已不在库中，请返回列表刷新', [t(config.itemNoun)]), 'error');
        return false;
      }
      // params 是整字段覆盖：必须带上原有生图参数，只合并 _promptLibrary。
      const params: PromptLibraryParams = {
        ...(base.params || ({} as NAIParams)),
        ...(library?.directories ? { _promptLibraryDirectoryIds: detail.directoryIds } : {}),
        _promptLibrary: {
          ...libraryMeta(base),
          bilingual: detail.bilingual,
          references: detail.references.map(row => ({ id: row.id, url: row.url, prompt: row.prompt })),
        },
      };
      const updates: Partial<PromptChain> = {
        name: detail.name.trim() || t('未命名{0}', [t(config.itemNoun)]),
        tags: parsePromptLibraryTags(detail.tags),
        basePrompt: detail.prompt,
        negativePrompt: detail.negativePrompt,
        params,
      };
      if (detail.coverChanged) updates.previewImage = detail.cover;
      await onUpdateChain(detail.id, updates);
      notify(t('{0}已保存', [t(config.itemNoun)]));
      void refreshUsage();
      if (close) { setDetail(null); onEditorClose?.(); }
      return true;
    } catch (error) {
      console.warn('Prompt library save failed:', error);
      notify(t('保存失败，请稍后重试'), 'error');
      return false;
    } finally {
      setSavingDetail(false);
    }
  }

  const removeChain = async (id: string, name: string) => {
    if (!await confirmAction({
      title: t('删除“{0}”？', [name || t('未命名')]),
      message: t('该{0}及其封面、参考图引用将被永久删除，此操作无法撤销。', [t(config.itemNoun)]),
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
    if (detail?.id === id) onEditorClose?.();
    setViewer(null);
    void refreshUsage();
    notify(t('已删除该{0}', [t(config.itemNoun)]));
  };

  /** 列表同步后在库内打开新条目的详情。 */
  const createBlank = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const newId = await onCreate(t(config.defaultName), '', library?.directories ? 'preset' : config.general ? 'preset' : config.kind, library?.directories ? { params: { _collectedCategory: 'general', _promptLibraryDirectoryIds: initialDirectoryIds } as unknown as NAIParams } : config.general ? { params: { _collectedPrompt: 1, _collectedCategory: 'general' } as unknown as NAIParams } : undefined);
      if (!newId) {
        notify(t('创建失败，请稍后重试'), 'error');
        return;
      }
      void refreshUsage();
      setDetail({
        id: newId,
        directoryIds: initialDirectoryIds,
        name: t(config.defaultName),
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
    if (!text) { notify(t('请先描述想要的{0}', [t(config.itemNoun)]), 'error'); return; }
    if (library?.directories && !generationDirectoryIds.length) { notify(t('请选择目录'), 'error'); return; }
    setGenerating(true);
    try {
      // 限定项按顶层字段提交：空串代表「不限」，由后端决定是否写进系统提示。
      const facetInput: Record<string, string> = {};
      for (const facet of config.facets) facetInput[facet.key] = Array.isArray(facets[facet.key]) ? (facets[facet.key] as string[]).join(', ') : String(facets[facet.key] || '');
      const result = await promptAgentService.generateLibraryPrompt({
        ...(library?.directories ? {} : { kind: config.kind }),
        ...(library?.directories ? { directories: library.directories, directoryId: generationDirectoryIds[0] } : {}),
        brief: text,
        count,
        detail: detailMode,
        keepEmpty,
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
    if (generating || savingDrafts) return;
    setGenOpen(false);
    setDrafts(null);
    setPicked(new Set());
    setGeneratedBy('');
  }, [generating, savingDrafts]);

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

  /** 每个候选一次创建完整条目；失败与未选择的候选保留，重试不重复创建成功项。 */
  const savePickedDrafts = async () => {
    const indexed = (drafts || []).map((item, index) => ({ item, index }));
    const chosen = indexed.filter(({ item, index }) => picked.has(index) && String(item.prompt || '').trim());
    if (!chosen.length) { notify(t('请先勾选要保存的方案'), 'error'); return; }
    setSavingDrafts(true);
    let saved = 0;
    const failures = new Set<number>();
    for (const { item, index } of chosen) {
      try {
        const params: PromptLibraryParams = {
          ...LAB_DEFAULT_PARAMS,
          _promptLibrary: { bilingual: String(item.bilingual || ''), references: [] },
          ...(library?.directories ? { _promptLibraryDirectoryIds: item.directoryId ? [item.directoryId] : generationDirectoryIds } : {}),
        };
        const generatedKind = library?.directories ? getPromptLibraryDirectoryLegacyKind(library.directories, item.directoryId || generationDirectoryIds[0]) : config.kind;
        const newId = await onCreate(String(item.name || '').trim() || t('未命名{0}', [t(config.itemNoun)]), String(item.note || ''), generatedKind && generatedKind !== 'general' ? generatedKind : 'preset', {
          tags: Array.isArray(item.tags) ? item.tags.map(value => String(value || '').trim()).filter(Boolean).slice(0, 12) : [],
          basePrompt: String(item.prompt || ''),
          params, variableValues: { subject: '' }, modules: [],
        });
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
    setPicked(new Set(remaining.flatMap(({ index }, position) => failures.has(index) ? [position] : [])));
    if (saved > 0) {
      if (aliveRef.current) void refreshUsage();
      notify(failures.size
        ? t('已保存 {0} 条{1}，{2} 条失败', [saved, t(config.itemNoun), failures.size])
        : t('已保存 {0} 条{1}到{2}', [saved, t(config.itemNoun), t(config.title)]));
      if (!remaining.length) closeGenerator();
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
    try {
      await onUpdateChain(chain.id, { name: nextName });
      setRenamingId(current => current === chain.id ? null : current);
      void refreshUsage();
    }
    catch { notify(t('改名失败，请重试'), 'error'); }
    finally { renamePending.current = false; setSavingRename(false); }
  };
  const facetSummary = config.facets.flatMap(facet => {
    const value = facets[facet.key];
    const text = Array.isArray(value) ? value.map(item => t(item)).join('、') : value ? t(value) : '';
    return text ? [t(facet.label) + ' ' + text] : [];
  }).join(' · ');

  /* ---------------- 列表态渲染 ---------------- */

  const renderCard = (chain: PromptChain) => {
    const name = chain.name || t('未命名');
    return <PromptLibraryCard chain={chain} label={promptLibraryEntryLabel(chain, library?.directories)} openLabel={t('{0}：{1}', [t(config.itemNoun), name])}
      busy={savingRename} onOpen={() => { if (!renamePending.current) setDetail(draftFromChain(chain)); }} onEdit={() => setDetail(draftFromChain(chain))}
      onDelete={() => void removeChain(chain.id, name)} onCopy={() => void copyText(chainPrompt(chain), t('英文提示词'))}
      onUse={library?.useEntry ? () => library.useEntry?.(chain) : undefined} notify={notify}
      mediaInfo={<><PromptLibraryUsageBadge count={usageById.get(chain.id) || 0} />{chainReferences(chain).length > 0 && <span className="absolute bottom-2 left-2 z-10 rounded-full bg-black/60 px-2 py-0.5 text-micro text-white">{t('参考图 {0}', [chainReferences(chain).length])}</span>}</>}
      summary={!chain.previewImage ? chainBilingual(chain) || chainPrompt(chain) : undefined}
      title={renamingId === chain.id ? <input autoFocus aria-label={t('条目名称')} maxLength={200} aria-busy={savingRename} disabled={savingRename}
        className="w-full min-w-0 rounded border border-indigo-400 bg-white px-1 text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100"
        value={renameText} onClick={event => event.stopPropagation()} onChange={event => setRenameText(event.target.value)} onBlur={() => { void commitRename(chain); }}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); void commitRename(chain); } if (event.key === 'Escape') { event.preventDefault(); renameCancelled.current = true; setRenamingId(null); } }} />
        : <button type="button" aria-label={t('重命名{0}', [name])} className="min-w-0 truncate text-left" disabled={savingRename} onClick={event => { event.stopPropagation(); if (renamePending.current) return; renameCancelled.current = false; setRenameText(name); setRenamingId(chain.id); }} onKeyDown={event => event.stopPropagation()}>{name}</button>} />;
  };

  const itemActions = !config.hideActions && <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-sm font-semibold text-gray-700 dark:text-gray-200">{t(config.title)} <span className="ml-1 text-xs font-normal tabular-nums text-gray-400">{shown.length}</span></span>
        <ToolbarButton onClick={() => setBundleOpen(true)} aria-label={t('AI 生成搭配')} title={t('AI 生成搭配')} className="mobile-touch !px-2.5 md:!px-3">
          <Wand2 /><span className="content-library-action-label hidden sm:inline">{t('AI 生成搭配')}</span>
        </ToolbarButton>
        {(library?.directories || !config.general) && <ToolbarButton onClick={openGenerator} aria-label={t(library?.directories ? generatorTitle : config.generateLabel)} title={t(library?.directories ? generatorTitle : config.generateLabel)} className="mobile-touch !px-2.5 md:!px-3">
          <Sparkles /><span className="content-library-action-label hidden sm:inline">{t(generatorTitle)}</span>
        </ToolbarButton>}
        <ToolbarButton tone="primary" onClick={() => void createBlank()} disabled={creating} aria-label={t(config.createLabel)} title={t(config.createLabel)} className="mobile-touch !px-2.5 md:!px-3">
          {creating ? <LoaderCircle className="animate-spin" /> : <Plus />}<span className="content-library-action-label hidden sm:inline">{t(config.createLabel)}</span>
        </ToolbarButton>
      </div>;

  const listToolbarContent = (
    <>
      {categoryToggle}
      <ToolbarPopover title={t('筛选{0}', [t(config.title)])} count={selectedTags.size} width={320} zIndex={dynamicDirectories ? 1960 : undefined}>
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-gray-500">{t('排序')}
            <select aria-label={t('排序')} className={TOOLBAR_FIELD_CLASS} value={sort} onChange={event => { setSort(event.target.value as LibraryBrowsing['sort']); resetScroll(); }}>
              <option value="updated">{t('最近更新')}</option><option value="name">{t('名称')}</option>
            </select>
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {selectedTags.size > 0 ? t('已启用 {0} 项标签筛选', [selectedTags.size]) : t('全部标签')}
            </span>
            {selectedTags.size > 0 && (
              <button type="button" onClick={() => { setSelectedTags(new Set()); resetScroll(); }} className="mobile-touch px-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300">{t('清除标签筛选')}</button>
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
                    className={`mobile-touch max-w-full break-words rounded-full border px-3 py-1.5 text-xs ${selectedTags.has(value) ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'appearance-group border-transparent bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
                  >
                    {t('{0}（{1}）', [value, total])}
                  </button>
                ))}
              </div>
              {visibleTagOptions.length === 0 && <p className="py-1 text-xs text-gray-400">{t('没有匹配的标签')}</p>}
            </div>
          )}
          {selectedTags.size > 1 && <p className="text-xs text-gray-400">{t('只显示同时包含全部所选标签的{0}', [t(config.itemNoun)])}</p>}
        </div>
      </ToolbarPopover>
      <div className="relative min-w-0 flex-1">
        <ToolbarSearch
          value={query}
          onChange={event => { setQuery(event.target.value); resetScroll(); }}
          aria-label={t('搜索名称、标签或提示词')}
          placeholder={t('搜索{0}名称、标签或提示词', [t(config.itemNoun)])}
          containerClassName="md:max-w-none!"
        />
      </div>
      {chains.length > 0 && <ToolbarCountCaption>{query.trim() || selectedTags.size
        ? t('匹配 {0} 条 · 共 {1} 条', [shown.length, items.length])
        : t('共 {0} 条', [items.length])}</ToolbarCountCaption>}

    </>
  );
  const listToolbar = <WorkspaceToolbar>{listToolbarContent}</WorkspaceToolbar>;

  const listBody = shown.length ? (
    <PromptLibraryGallery chains={shown} scrollRef={scrollRef} resetKey={JSON.stringify([query, sort, [...selectedTags], directorySelectionKey])} renderCard={renderCard} />
  ) : (
    <EmptyState
      className="py-20"
      icon={<Icon className="h-8 w-8" aria-hidden="true" />}
      title={items.length ? t('没有找到符合条件的{0}', [t(config.itemNoun)]) : t(config.emptyTitle)}
      hint={items.length ? t('换个关键词，或清除标签筛选。') : t(config.emptyHint)}
      action={items.length ? <ToolbarButton onClick={() => { setQuery(''); setSelectedTags(new Set()); resetScroll(); }}>{t('清除筛选')}</ToolbarButton> : undefined}
    />
  );

  /* ---------------- 详情态渲染 ---------------- */

  const referenceEntries: ViewerEntry[] = detail
    ? detail.references.map(row => ({ url: row.url, caption: row.prompt }))
    : [];

  const detailActions = detail ? (
      <div className="flex flex-none items-center gap-1">
        <ToolbarButton tone="danger" disabled={savingDetail} onClick={() => void removeChain(detail.id, detail.name)} aria-label={t('删除')} title={t('删除')} className="mobile-touch !px-2.5 md:!px-3">
          <Trash2 /><span className="hidden sm:inline">{t('删除')}</span>
        </ToolbarButton>
        <ToolbarButton tone="save" disabled={savingDetail} onClick={() => void saveDetail()} aria-label={t('保存')} title={t('保存')} className="mobile-touch !px-2.5 md:!px-3">
          {savingDetail && <LoaderCircle className="animate-spin" />}<span>{savingDetail ? t('保存中…') : t('保存')}</span>
        </ToolbarButton>
      </div>
  ) : null;
  const detailToolbarContent = detail ? (
    <>
      {categoryToggle}
      <ToolbarButton onClick={() => void closeDetail()} disabled={savingDetail} aria-label={t('返回{0}', [t(config.title)])} title={t('返回{0}', [t(config.title)])} className="mobile-touch !px-2.5 md:!px-3">
        <ArrowLeft /><span className="hidden sm:inline">{t('返回')}</span>
      </ToolbarButton>
      <div className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900 dark:text-white" title={detail.name || t('未命名')}>{detail.name || t('未命名')}</div>
      {draftDirty && <span className="flex-none rounded-full bg-amber-50 px-2 py-0.5 text-micro font-semibold text-amber-600 dark:bg-amber-950/40 dark:text-amber-300">{t('未保存')}</span>}
      {detailActions}
    </>
  ) : null;
  const detailToolbar = detailToolbarContent ? <WorkspaceToolbar>{detailToolbarContent}</WorkspaceToolbar> : null;

  const detailBody = detail ? (
    <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="min-w-0 space-y-3">
        <label className="block">
          <span className={DETAIL_LABEL_CLASS}>{t('名称')}</span>
          <input
            value={detail.name}
            onChange={event => patchDetail({ name: event.target.value })}
            placeholder={t('例如：银发红瞳的少女')}
            aria-label={t('{0}名称', [t(config.itemNoun)])}
            className={DETAIL_FIELD_CLASS}
          />
        </label>
        <label className="block">
          <span className={DETAIL_LABEL_CLASS}>{t('标签（逗号分隔）')}</span>
          <input
            value={detail.tags}
            onChange={event => patchDetail({ tags: event.target.value })}
            placeholder={t(config.tagPlaceholder)}
            aria-label={t('{0}标签', [t(config.itemNoun)])}
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
        {library?.directories && <PromptLibraryDirectoryPicker state={library.directories} selectedIds={detail.directoryIds} onChange={directoryIds => patchDetail({ directoryIds })} disabled={savingDetail} />}
      </div>

      <div className="min-w-0 space-y-4">
        <div>
          <span className={DETAIL_LABEL_CLASS}>{t('封面')}</span>
          {detail.cover ? (
            <button
              type="button"
              onClick={() => openViewer([{ url: detail.cover, caption: detail.name }], 0)}
              aria-label={t('查看封面原图')}
              title={t('点击查看原图')}
              className="mt-1.5 block w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
            >
              <SmartImage src={detail.cover} alt={t('封面预览')} thumbnailVariant="thumb-640" className="block max-h-48 w-full object-contain" containerClassName="relative w-full overflow-hidden" />
            </button>
          ) : (
            <div className="appearance-media mt-1.5 flex h-24 items-center justify-center rounded-xl bg-gray-100 text-meta text-gray-400 dark:bg-gray-950">{t('暂无封面')}</div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <ToolbarButton onClick={() => setPicker('cover')} className="mobile-touch flex-1"><ImagePlus /><span>{t('从历史选图')}</span></ToolbarButton>
            <ToolbarButton disabled={!detail.cover} onClick={() => patchDetail({ cover: '', coverChanged: true })} className="mobile-touch flex-1"><X /><span>{t('清除')}</span></ToolbarButton>
          </div>
        </div>

        <details>
          <summary className="mobile-touch cursor-pointer text-sm font-semibold">{t('参考图（{0}）', [detail.references.length])}</summary>
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
            <div className="appearance-group mt-1.5 flex min-h-20 items-center justify-center rounded-xl bg-gray-50 text-meta text-gray-400 dark:bg-gray-950/60">{t('还没有参考图')}</div>
          )}
          <ToolbarButton onClick={() => setPicker('reference')} className="mobile-touch mt-2 w-full"><ImagePlus /><span>{t('从历史导入参考图')}</span></ToolbarButton>
        </details>

        <PromptLibraryUsageSection chainId={detail.id} notify={notify} zIndex={library?.directories || initialEntry ? 2200 : undefined} />
      </div>
    </div>
  ) : null;

  /* ---------------- 浮层渲染 ---------------- */

  const generator = genOpen ? (
    <ImagePreviewPortal>
      <div
        style={{ zIndex: library?.directories ? 1950 : undefined }} className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
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
            <button type="button" onClick={closeGenerator} disabled={generating || savingDrafts} aria-label={t('关闭生成面板')} className="mobile-touch flex h-10 w-10 flex-none items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
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
              {library?.directories && <PromptLibraryDirectoryPicker state={library.directories} mode="single" includeAll={false} selectedIds={generationDirectoryIds} onChange={setGenerationDirectoryIds} disabled={generating} />}
              {(library?.directories ? [] : config.facets).map(facet => facet.multiple ? (
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
              <label className="block">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('详细程度')}</span>
                <select value={detailMode} onChange={event => setDetailMode(event.target.value as 'strict' | 'moderate' | 'detailed')}
                  aria-label={t('详细程度')} className={TOOLBAR_FIELD_CLASS} data-detail-mode="true">
                  <option value="strict">{t('严格：只写需求提到的')}</option>
                  <option value="moderate">{t('适度：少量合理补充')}</option>
                  <option value="detailed">{t('详细：按常见搭配补齐')}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 self-end pb-1.5 text-xs text-gray-600 dark:text-gray-300">
                <input type="checkbox" checked={keepEmpty} onChange={event => setKeepEmpty(event.target.checked)}
                  aria-label={t('未提到的限定项保持留空')} data-keep-empty="true" className="h-3.5 w-3.5 accent-indigo-500" />
                {t('未提到的限定项保持留空')}
              </label>
            </div>

            <p className="text-micro text-gray-400 dark:text-gray-500">{t(config.generateHint)}</p>
            <p className="text-micro text-gray-400 dark:text-gray-500">{t('使用当前创作助手模型生成提示词，模型服务可能收费；不消耗生图额度。')}</p>

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
                    {draft.filteredWarning && <p role="status" className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t('过滤后内容过少，已保留原文，请检查。')}</p>}
                    {Boolean(draft.filtered?.length) && !draft.filteredWarning && <p className="mt-2 break-words text-xs text-gray-500">{t('已过滤 {0} 个越界标签：{1}', [draft.filtered!.length, draft.filtered!.join(', ')])}</p>}
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
                    {(() => {
                      const chips = tagDetails(draft.prompt || '', draft.bilingual || '');
                      const marks = classifyPromptTags(draft.prompt || '', { brief, facets });
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
                            <button key={chip.raw} type="button"
                              title={chip.weighted ? t('带权重标签默认不拆，先去掉权重再删') : t('删除这个标签')}
                              onClick={() => {
                                const next = removePromptTag(draft.prompt || '', draft.bilingual || '', chip.tag);
                                if (!next.removed) return;
                                patchDraft(index, { prompt: next.prompt, bilingual: next.bilingual });
                              }}
                              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-micro ${chip.weighted
                                ? 'border-amber-300 text-amber-600 dark:border-amber-800 dark:text-amber-400'
                                : 'border-gray-200 text-gray-600 hover:border-red-400 hover:text-red-600 dark:border-gray-700 dark:text-gray-300'}`}
                              data-candidate-tag-source={sourceOf(chip.tag)}>
                              <span aria-hidden className={sourceOf(chip.tag) === 'user' ? 'text-emerald-700 dark:text-emerald-400' : sourceOf(chip.tag) === 'ai' ? 'text-indigo-500 dark:text-indigo-300' : 'text-gray-400'}>
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
            <ToolbarButton onClick={() => void generate()} disabled={generating} tone={drafts ? "neutral" : "primary"} className="mobile-touch">
              {generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              <span>{generating ? t('生成中…') : drafts ? t('重新生成') : t('开始生成')}</span>
            </ToolbarButton>
            {drafts && (
              <ToolbarButton tone="save" onClick={() => void savePickedDrafts()} disabled={generating || savingDrafts} className="mobile-touch">
                {savingDrafts ? <LoaderCircle className="animate-spin" /> : null}
                <span>{savingDrafts ? t('保存中…') : t('保存选中（{0}）', [picked.size])}</span>
              </ToolbarButton>
            )}
            <ToolbarButton onClick={closeGenerator} disabled={generating || savingDrafts} className="mobile-touch"><span>{t('取消')}</span></ToolbarButton>
          </footer>
        </div>
      </div>
    </ImagePreviewPortal>
  ) : null;

  const viewerModal = viewer ? <ImageLightbox src={viewer.items[viewer.index]?.url || ''} alt={viewer.items[viewer.index]?.caption || t('原图')} notify={notify}
    zIndex={library?.directories || initialEntry ? 2200 : undefined} onClose={() => setViewer(null)}
    pager={{ index: viewer.index, count: viewer.items.length, onChange: index => setViewer(previous => previous ? { ...previous, index } : previous) }} /> : null;

  const body = <>
    <div data-workspace-body className="flex min-h-0 flex-1 flex-col md:flex-row" style={directoryNavigation ? { '--workspace-chrome-height': '0px' } as React.CSSProperties : undefined}>{directoryNavigation}
    <div ref={scrollRef} onScroll={event => { if (!detail) browsingRef.current.scrollTop = event.currentTarget.scrollTop; }} className={`workspace-scroll-viewport relative min-h-0 min-w-0 flex-1 overflow-y-auto p-4 ${embedded ? '' : 'pb-28 md:p-6 md:pb-24'}`}>
      {detail ? detailBody : !initialEntry && <>{itemActions}{listBody}</>}
    </div></div>
    {generator}
    <PromptLibraryBundleDialog
      open={bundleOpen}
      onClose={() => setBundleOpen(false)}
      notify={notify}
      onCreate={onCreate}
      onSaved={() => { void refreshUsage(); }}
      styleChains={styleChains}
      onWriteToChain={writeBundleToChain}
    />
    <HistoryImagePicker zIndex={library?.directories ? 1950 : undefined} open={picker !== null} onClose={() => setPicker(null)} onSelect={handleHistorySelect}
      scopeChainId={picker === 'cover' && detail?.id ? detail.id : null} />
    {viewerModal}
  </>;
  if (initialEntry) return <>
    <LibraryDialog title={detail?.name || t('编辑')} wide className="max-w-5xl!" busy={savingDetail} headerActions={detailActions} onClose={() => { void closeDetail(); return false; }}>
      {draftDirty && <p role="status" className="text-xs text-amber-600 dark:text-amber-300">{t('未保存')}</p>}
      {detailBody}
    </LibraryDialog>
    {generator}{viewerModal}
    <HistoryImagePicker zIndex={2200} open={picker !== null} onClose={() => setPicker(null)} onSelect={handleHistorySelect} scopeChainId={picker === 'cover' && detail?.id ? detail.id : null} />
  </>;
  if (embedded) return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbarSlot ? createPortal(detail ? detailToolbarContent : listToolbarContent, toolbarSlot) : categoryToggle ? (detail ? detailToolbar : listToolbar) : null}
      {body}
    </div>
  );
  return (
    <div className="workspace-canvas relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      <WorkspaceChrome>{categoryNavigation}{detail ? detailToolbar : listToolbar}</WorkspaceChrome>
      {body}
    </div>
  );
};

const ALL_CONFIG: PromptLibraryKindConfig = {...PROMPT_LIBRARY_KINDS.appearance, type: ['appearance','wardrobe','pose','expression','scene','camera'], title:'图片提示词库', itemNoun:'提示词', emptyTitle:'图片提示词库还是空的', hideActions:true, emptyHint:'选择分类后可新建或生成提示词。'};
const GENERAL_CONFIG: PromptLibraryKindConfig = { ...PROMPT_LIBRARY_KINDS.appearance, general: true, type: 'preset', title: '通用', itemNoun: '片段', defaultName: '新片段', createLabel: '新建片段', emptyTitle: '通用片段还是空的', facets: [] };
export type PromptLibraryEntryEditorProps = Omit<PromptLibraryProps, 'embedded' | 'toolbarSlot'> & {
  entry: PromptChain;
  onClose: () => void;
  requestCloseRef?: React.MutableRefObject<(() => void) | null>;
};

export const PromptLibraryEntryEditor: React.FC<PromptLibraryEntryEditorProps> = ({ entry, onClose, ...props }) => {
  const kind = fragmentKindOf(entry);
  if (!kind) return null;
  return <PromptLibrary key={entry.id} {...props} config={kind === 'general' ? GENERAL_CONFIG : PROMPT_LIBRARY_KINDS[kind]}
    initialEntry={entry} onEditorClose={onClose} />;
};

const LIBRARY_CATEGORIES = ['all','appearance','wardrobe','pose','expression','scene','camera','general'] as const;
type LibraryCategory = typeof LIBRARY_CATEGORIES[number];
const LegacyPromptLibraryHub: React.FC<PromptLibraryProps> = props => {
  useLanguage();
  const navigationId = useId();
  const [categoriesExpanded, setCategoriesExpanded] = useState(() => { try { return localStorage.getItem('nai-prompt-library-categories-expanded') === 'true'; } catch { return false; } });
  const toggleCategories = () => {
    const next = !categoriesExpanded;
    setCategoriesExpanded(next);
    try { localStorage.setItem('nai-prompt-library-categories-expanded', String(next)); } catch { /* 存储受限时仍可展开。 */ }
  };
  const leaveGuards = useRef<Partial<Record<LibraryCategory, () => Promise<boolean>>>>({});
  const browsing = useRef<Partial<Record<LibraryCategory, LibraryBrowsing>>>({});
  const [kind, setKind] = useState<LibraryCategory>(() => {
    try { const saved=localStorage.getItem('nai-prompt-library-kind'); return LIBRARY_CATEGORIES.includes(saved as LibraryCategory) ? saved as LibraryCategory : 'all'; }
    catch { return 'all'; }
  });
  const { requestCloseRef, onClose } = props;
  useEffect(() => {
    if (!requestCloseRef) return;
    requestCloseRef.current = () => {
      void (async () => {
        const guard = leaveGuards.current[kind];
        if (!guard || await guard()) onClose?.();
      })();
    };
    return () => { requestCloseRef.current = null; };
  }, [requestCloseRef, onClose, kind]);
  const selectKind = async (category: LibraryCategory) => {
    if (category === kind) return;
    const guard = leaveGuards.current[kind];
    if (guard && !await guard()) return;
    setKind(category);
    try { localStorage.setItem('nai-prompt-library-kind', category); } catch { /* 存储受限时仍可切换分类。 */ }
  };
  const categoryLabel = t(kind === 'all' ? '全部' : FRAGMENT_LABELS[kind]);
  const categoryToggle = <ToolbarButton aria-label={t(categoriesExpanded ? '收起分类' : '展开分类')} title={[t(categoriesExpanded ? '收起分类' : '展开分类'), categoryLabel].join(' · ')} aria-expanded={categoriesExpanded} aria-controls={navigationId} active={categoriesExpanded || kind !== 'all'} onClick={toggleCategories}><Folder className="h-4 w-4" /></ToolbarButton>;
  return <div className="prompt-library-hub flex h-full min-h-0 flex-1 flex-col md:flex-row">
    {/* 展开时桌面竖排、手机横排；收起保留分类与内容草稿。 */}
    <nav id={navigationId} hidden={!categoriesExpanded} role="tablist" aria-label={t('提示词分类')} className={categoriesExpanded ? "appearance-panel m-2 flex shrink-0 gap-1 overflow-x-auto rounded-2xl border border-gray-200 p-3 dark:border-gray-800 md:w-52 md:flex-col md:overflow-y-auto" : "hidden"}>
      <p className="hidden text-xs font-semibold text-gray-500 md:mb-2 md:block md:px-2">{t('提示词分类')}</p>
      {LIBRARY_CATEGORIES.map(category => {
        const count=props.chains.filter(chain => category==='all' ? !!fragmentKindOf(chain) : fragmentKindOf(chain)===category).length;
        const label=category==='all' ? '全部' : FRAGMENT_LABELS[category];
        const Icon = category === 'all' || category === 'general' ? Library : KIND_ICONS[category];
        return <button key={category} type="button" role="tab" aria-selected={kind===category}
          className={`mobile-touch flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm transition md:h-10 md:w-full md:text-left ${kind===category ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
          onClick={() => { void selectKind(category); }}>
          <span className="flex h-5 w-5 flex-none items-center justify-center [&_svg]:h-4 [&_svg]:w-4"><Icon /></span>
          <span className="min-w-0 flex-1 truncate">{t(label)}</span>{' '}
          <span className="text-xs opacity-60">{count}</span>
        </button>;
      })}
    </nav>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PromptLibrary key={kind} {...props} categoryToggle={categoryToggle} requestCloseRef={undefined} config={kind==='all' ? ALL_CONFIG : kind === 'general' ? GENERAL_CONFIG : PROMPT_LIBRARY_KINDS[kind]}
        browsing={browsing.current[kind]} rememberBrowsing={state => { browsing.current[kind] = state; }}
        registerLeaveGuard={guard => { leaveGuards.current[kind] = guard; return () => { delete leaveGuards.current[kind]; }; }} />
    </div>
  </div>;
};

const DIRECTORY_CONFIG: PromptLibraryKindConfig = { ...GENERAL_CONFIG, title: '片段', emptyTitle: '还没有片段', emptyHint: '新建片段或使用 AI 生成片段。', generateLabel: 'AI 生成片段', briefLabel: '描述你想要的内容', briefPlaceholder: '描述要生成的提示词内容', generateHint: '', facets: [] };

const DirectoryPromptLibraryHub: React.FC<PromptLibraryProps> = props => {
  const library = usePromptLibrary()!;
  const directories = library.directories!;
  const navigationId = useId();
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem('nai-prompt-library-directories-expanded') === 'true'; } catch { return false; } });
  const toggleDirectories = () => { const next = !expanded; setExpanded(next); try { localStorage.setItem('nai-prompt-library-directories-expanded', String(next)); } catch { /* 本端存储受限时仍可切换。 */ } };
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [allSelected, setAllSelected] = useState(true);
  const [unclassified, setUnclassified] = useState(false);
  const leaveGuard = useRef<(() => Promise<boolean>) | null>(null);
  const select = async (ids: string[], all: boolean, unclassifiedOnly: boolean) => {
    if (leaveGuard.current && !await leaveGuard.current()) return;
    setSelectedIds(ids); setAllSelected(all); setUnclassified(unclassifiedOnly);
  };
  useEffect(() => {
    if (!props.requestCloseRef) return;
    props.requestCloseRef.current = () => { void (async () => { if (!leaveGuard.current || await leaveGuard.current()) props.onClose?.(); })(); };
    return () => { props.requestCloseRef!.current = null; };
  }, [props.requestCloseRef, props.onClose]);
  const fragments = props.chains.filter(chain => !!fragmentKindOf(chain));
  const chains = allSelected ? fragments : unclassified ? fragments.filter(chain => !getPromptLibraryEntryDirectoryIds(chain, directories).length) : selectPromptLibraryDirectoryEntries(fragments, directories, selectedIds);
  const selectionKey = allSelected ? 'all' : unclassified ? 'unclassified' : selectedIds.join(',');
  const currentPath = allSelected ? t('全部') : unclassified ? t('未归类') : selectedIds.map(id => getPromptLibraryDirectoryPath(directories, id).map(node => node.name).join(' / ')).join('、');
  const categoryToggle = <ToolbarButton aria-label={t(expanded ? '收起目录' : '展开目录')} title={[t(expanded ? '收起目录' : '展开目录'), currentPath].join(' · ')} aria-expanded={expanded} aria-controls={navigationId} active={expanded || !allSelected || unclassified} onClick={toggleDirectories}><Folder className="h-4 w-4" /></ToolbarButton>;
  const navigation = expanded && <div className="min-h-0 min-w-0 shrink-0 md:w-52 md:overflow-y-auto"><PromptLibraryDirectoryNavigation id={navigationId} state={directories} entries={fragments} selectedIds={selectedIds} allSelected={allSelected} unclassified={unclassified} expanded={expanded} embedded onCreate={library.onCreateDirectory} onRename={library.onRenameDirectory} onDelete={library.onDeleteDirectory} onMove={library.onMoveDirectory} disabled={library.directoriesBusy} onSelect={selection => { void select(selection.directoryIds, selection.allDirectories, selection.unclassified); }} /></div>;
  return <PromptLibrary {...props} chains={chains} requestCloseRef={undefined} config={DIRECTORY_CONFIG} dynamicDirectories initialDirectoryIds={allSelected || unclassified ? [] : selectedIds} directorySelectionKey={selectionKey} directoryNavigation={navigation} categoryToggle={categoryToggle} registerLeaveGuard={guard => { leaveGuard.current = guard; return () => { leaveGuard.current = null; }; }} />;
};

export const PromptLibraryHub: React.FC<PromptLibraryProps> = props => usePromptLibrary()?.directories ? <DirectoryPromptLibraryHub {...props} /> : <LegacyPromptLibraryHub {...props} />;
