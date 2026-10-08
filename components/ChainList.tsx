
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PromptChain, ChainType } from '../types';
import { useConfirmDialog } from './ConfirmDialog';
import { MobileBottomSheet, MobileIconButton } from './MobileUI';
import { SmartImage } from './SmartImage';
import { ImageShareOverlay } from './ImageShareActions';
import { getMobileOriginalUrl } from '../services/mobileImageCache';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { Check, Copy, EyeOff, Filter, FolderUp, Heart, Image, Link2, Pencil, Plus, Trash2, User } from 'lucide-react';
import { FavoriteButton, ToolbarButton, ToolbarSearch, WorkspaceToolbar, isUntestedChain } from './DesignSystem';
import { DEFAULT_NAI_MODEL, getNaiModelDisplayLabel, getSelectableNaiModels } from '../services/naiModels';
import { useNaiRuntime } from '../services/naiRuntime';
import { useRestoreListAnchor } from './useRestoreListAnchor';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { FolderBatchImportModal } from './chain/FolderBatchImportModal';
import { StyleCollectorControl } from './StyleCollectorControl';
import { useStChatu8Selection, wisdomEntryLabel } from '../services/stChatu8Sync';
import { useStChatu8Preferences } from '../services/stChatu8Preferences';
import { isStChatu8ExportableChain } from '../worker/stChatu8Policy.mjs';
import { WisdomSyncToolbar } from './WisdomSyncToolbar';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { PressRevealSurface } from './PressRevealSurface';
import { useModalA11y, isTopmostModal } from './useModalA11y';
import { ChainInfoModal, UpdateChainInfo } from './chain/ChainInfoModal';
import { getCustomChainTags } from '../services/chainTags';

interface ChainListProps {
  chains: PromptChain[];
  type: ChainType; // New Prop to filter view
  onCreate: (name: string, desc: string, type: ChainType) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  onUpdateChain: UpdateChainInfo;
  isLoading: boolean;
  notify: (msg: string, type?: 'success' | 'error') => void;
  isGuest?: boolean;
  returnTargetId?: string;
}

// Internal Component: Smart Copy Modal
const CopyModal: React.FC<{
    chain: PromptChain;
    onClose: () => void;
    notify: (msg: string) => void;
}> = ({ chain, onClose, notify }) => {
    const dialogRef = useModalA11y<HTMLDivElement>(true);
    useEffect(() => {
        const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && isTopmostModal(dialogRef.current)) onClose(); };
        window.addEventListener('keydown', close);
        return () => window.removeEventListener('keydown', close);
    }, [onClose]);
    // Default checked based on chain type
    // Artist chain: usually Base (artist tag) + Modules (Style)
    // Character chain: usually Base (char tag) + Modules (Costume)
    const [checkBase, setCheckBase] = useState(true);
    const [checkSubject, setCheckSubject] = useState(false); // Subject is variable, usually skipped for static copy
    const [checkNegative, setCheckNegative] = useState(false);

    // Initialize module selection (all active modules checked by default)
    const [selectedModules, setSelectedModules] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {};
        chain.modules?.forEach(m => {
            if (m.isActive) initial[m.id] = true;
        });
        return initial;
    });

    const handleCopy = () => {
        const parts: string[] = [];

        // 1. Base
        if (checkBase && chain.basePrompt) parts.push(chain.basePrompt);

        // 2. Pre-Modules
        chain.modules?.forEach(m => {
            if (selectedModules[m.id] && m.position === 'pre') parts.push(m.content);
        });

        // 3. Subject (Optional)
        if (checkSubject && chain.variableValues?.subject) parts.push(chain.variableValues.subject);

        // 4. Post-Modules
        chain.modules?.forEach(m => {
            if (selectedModules[m.id] && (m.position === 'post' || !m.position)) parts.push(m.content);
        });

        const finalPrompt = parts.join(', ').replace(/,\s*,/g, ',').replace(/^,\s*/, '').replace(/,\s*$/, '');
        navigator.clipboard.writeText(finalPrompt);
        notify('已复制选中内容');
        onClose();
    };

    const copyNegative = () => {
        navigator.clipboard.writeText(chain.negativePrompt);
        notify('负面 Prompt 已复制');
    };

    return (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={chain.type === 'character' ? '复制自定义角色内容' : '复制风格串内容'} className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="operation-dialog flex flex-col border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900" onClick={e => e.stopPropagation()}>
                <div className="operation-header px-4 border-b border-gray-200 dark:border-gray-800 flex flex-none justify-between items-center bg-gray-50 dark:bg-gray-900">
                    <h3 className="font-bold text-gray-900 dark:text-white truncate pr-4">{chain.name}</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white">✕</button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Description Section (Full View) */}
                    {chain.description && (
                         <div className="bg-yellow-50 dark:bg-yellow-900/10 p-3 rounded-xl border border-yellow-100 dark:border-yellow-900/30 text-sm text-gray-700 dark:text-gray-300">
                             <div className="font-bold text-xs text-yellow-600 dark:text-yellow-500 mb-1 uppercase">说明</div>
                             <div className="whitespace-pre-wrap break-words">{chain.description}</div>
                         </div>
                    )}

                    <div className="space-y-3">
                        <h4 className="font-bold text-xs text-indigo-500 uppercase tracking-wider">选择要复制的内容</h4>

                        {/* Base Prompt */}
                        <label className="flex items-start gap-2 p-3 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer">
                            <input type="checkbox" checked={checkBase} onChange={e => setCheckBase(e.target.checked)} className="mt-1" />
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-sm dark:text-white">基础画风</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 font-mono line-clamp-2 break-all">{chain.basePrompt || '(空)'}</div>
                            </div>
                        </label>

                        {/* Modules */}
                        {chain.modules && chain.modules.length > 0 && (
                            <div className="space-y-2 pl-4 border-l-2 border-gray-200 dark:border-gray-800">
                                {chain.modules.map(m => (
                                    <label key={m.id} className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={!!selectedModules[m.id]}
                                            onChange={e => setSelectedModules({...selectedModules, [m.id]: e.target.checked})}
                                        />
                                        <span className="text-sm dark:text-gray-300">{m.name}</span>
                                        <span className="text-xs text-gray-400 font-mono truncate max-w-[150px]">{m.content}</span>
                                    </label>
                                ))}
                            </div>
                        )}

                        {/* Subject */}
                        <label className="flex items-start gap-2 p-3 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer">
                            <input type="checkbox" checked={checkSubject} onChange={e => setCheckSubject(e.target.checked)} className="mt-1" />
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-sm dark:text-white">全局提示词 (变量)</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 font-mono line-clamp-1">{chain.variableValues?.subject || '(空)'}</div>
                            </div>
                        </label>
                    </div>

                    {/* Negative Prompt Quick Copy */}
                    <div className="pt-4 border-t border-gray-200 dark:border-gray-800">
                        <div className="flex justify-between items-center mb-1">
                            <span className="font-bold text-xs text-red-500 uppercase">全局负面提示词</span>
                            <button onClick={copyNegative} className="text-xs text-indigo-600 hover:underline">仅复制负面</button>
                        </div>
                        <div className="text-xs text-gray-400 bg-gray-50 dark:bg-gray-900 p-2 rounded-xl font-mono max-h-20 overflow-y-auto">
                            {chain.negativePrompt || '(空)'}
                        </div>
                    </div>
                </div>

                <div className="operation-footer border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex flex-none justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-gray-500 hover:text-gray-800 dark:hover:text-white">关闭</button>
                    <button onClick={handleCopy} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg">复制选中组合</button>
                </div>
            </div>
        </div>
    );
};

export const ChainList: React.FC<ChainListProps> = ({ chains, type, onCreate, onSelect, onDelete, onRefresh, onUpdateChain, notify, isGuest = false, returnTargetId }) => {
  const RENDER_BATCH_SIZE = 60;
  const imageDisplay = useMobileImageDisplayPreferences();
  const masonryColumns = useMasonryColumnCount(imageDisplay);
  const [previewRatios, setPreviewRatios] = useState<Record<string, number>>({});
  const confirmAction = useConfirmDialog();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagSearch, setTagSearch] = useState('');
  const [copyModalChain, setCopyModalChain] = useState<PromptChain | null>(null);
  const [infoChain, setInfoChain] = useState<PromptChain | null>(null);
  const [sortOption, setSortOption] = useState<'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc'>('updated_desc');
  const [favOnly, setFavOnly] = useState(false);
  const [untestedOnly, setUntestedOnly] = useState(false);
  const [isFolderImportOpen, setIsFolderImportOpen] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [showDesktopFilters, setShowDesktopFilters] = useState(false);
  const filterAnchorRef = useRef<HTMLDivElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [filterPosition, setFilterPosition] = useState({ left: 0, top: 0, offset: 0 });
  const [visibleCount, setVisibleCount] = useState(RENDER_BATCH_SIZE);
  const syncPreferences = useStChatu8Preferences(!isGuest && type === 'style');
  const canSync = !isGuest && type === 'style' && syncPreferences.enabled;
  const syncSelection = useStChatu8Selection(canSync, chains, notify);

  useEffect(() => {
    if (!showDesktopFilters) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowDesktopFilters(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [showDesktopFilters]);

  // Load favorites from localStorage (client-side only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('nai_chain_favs');
      if (saved) {
        const parsed: string[] = JSON.parse(saved);
        setFavorites(new Set(parsed));
      }
    } catch (e) {
      console.error('Failed to load chain favorites', e);
    }
  }, []);

  const toggleFav = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        localStorage.setItem('nai_chain_favs', JSON.stringify(Array.from(next)));
      } catch (err) {
        console.error('Failed to save chain favorites', err);
      }
      return next;
    });
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreate(newName, newDesc, type);
    setIsModalOpen(false);
    setNewName('');
    setNewDesc('');
  };

  // 模型筛选：选项固定为可选模型清单（注册表 + 网关同步的新模型），与链表内容无关。
  const runtime = useNaiRuntime();
  const modelFilterOptions = useMemo(() => getSelectableNaiModels(runtime), [runtime]);

  // 从当前资料类型的完整列表生成选项，编辑／导入后即时更新，不被其他筛选缩掉。
  const customTagOptions = useMemo(() => [...new Set(chains
    .filter(chain => chain.type === type || (!chain.type && type === 'style'))
    .flatMap(chain => getCustomChainTags(chain.tags)))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [chains, type]);
  useEffect(() => {
    setSelectedTags(current => {
      const next = new Set([...current].filter(tag => customTagOptions.includes(tag)));
      return next.size === current.size ? current : next;
    });
  }, [customTagOptions]);
  const visibleTagOptions = customTagOptions.filter(tag => customTagOptions.length <= 12 || tag.toLowerCase().includes(tagSearch.trim().toLowerCase()));
  const toggleTag = (tag: string) => setSelectedTags(current => {
    const next = new Set(current);
    if (next.has(tag)) next.delete(tag); else next.add(tag);
    return next;
  });

  // 自定义标签可组合筛选；待实测独立于用户分类。
  const filteredChains = useMemo(() => {
    return chains
      .filter(c =>
        (c.type === type || (!c.type && type === 'style')) && // Backward compat: default to style if no type
        (c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
         c.description.toLowerCase().includes(searchTerm.toLowerCase()))
      )
      .filter(c => !favOnly || favorites.has(c.id))
      .filter(c => !untestedOnly || isUntestedChain(c))
      .filter(c => !selectedModel || (c.params?.model?.trim() || DEFAULT_NAI_MODEL) === selectedModel)
      .filter(c => {
        if (selectedTags.size === 0) return true;
        const tags = new Set(getCustomChainTags(c.tags));
        return [...selectedTags].every(tag => tags.has(tag));
      })
      .filter(c => syncSelection.accepts(c.id))
      .slice()
      .sort((a, b) => {
        const ca = a.createdAt || 0;
        const cb = b.createdAt || 0;
        const ua = a.updatedAt || ca;
        const ub = b.updatedAt || cb;
        switch (sortOption) {
          case 'created_asc':
            return ca - cb;
          case 'created_desc':
            return cb - ca;
          case 'updated_asc':
            return ua - ub;
          case 'updated_desc':
          default:
            return ub - ua;
        }
      });
  }, [chains, type, searchTerm, favOnly, untestedOnly, favorites, selectedModel, selectedTags, sortOption, syncSelection.open, syncSelection.view, syncSelection.recordFilter, syncSelection.entries]);

  useEffect(() => setVisibleCount(RENDER_BATCH_SIZE), [chains, type, searchTerm, favOnly, untestedOnly, selectedModel, selectedTags, sortOption, syncSelection.view, syncSelection.recordFilter, syncSelection.open]);
  useEffect(() => {
    if (!returnTargetId) return;
    const targetIndex = filteredChains.findIndex(chain => chain.id === returnTargetId);
    if (targetIndex >= 0) setVisibleCount(count => Math.max(count, targetIndex + 1));
  }, [filteredChains, returnTargetId]);
  const visibleChains = filteredChains.slice(0, visibleCount);

  // 滚动接近列表底部自动追加一批；按钮保留作兜底。
  const chainScrollRef = useRef<HTMLDivElement>(null);
  const chainLoadSentinelRef = useRef<HTMLDivElement>(null);
  useRestoreListAnchor(chainScrollRef, returnTargetId, `${visibleCount}:${filteredChains.length}`);
  const onScrollRestore = useKeepAliveScrollRestore(chainScrollRef, 'list');
  useEffect(() => {
    const sentinel = chainLoadSentinelRef.current;
    const root = chainScrollRef.current;
    if (!sentinel || !root || visibleCount >= filteredChains.length) return;
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) setVisibleCount(count => count + RENDER_BATCH_SIZE);
    }, { root, rootMargin: '600px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredChains.length, visibleCount]);

  // 卡片预计高度：图片区（列宽 / 实际宽高比）+ 48px 标题区 + 上下边框。previewRatios 更新后自动重算分列。
  const estimateChainCardHeight = useCallback(
    (chain: PromptChain, columnWidth: number) => {
      const ratio = previewRatios[chain.id] || 4 / 3;
      return Math.max(1, columnWidth) / Math.max(0.1, ratio) + 50 + (syncSelection.open && syncSelection.entries.has(chain.id) ? 78 : 0);
    },
    [previewRatios, syncSelection.open, syncSelection.entries],
  );

  const deleteChain = async (chain: PromptChain) => {
    if (await confirmAction({ title: `删除“${chain.name}”？`, message: `该${chain.type === 'character' ? '自定义角色' : '风格串'}及其配置将被永久删除，此操作无法撤销。`, confirmLabel: '确认删除', tone: 'danger' })) onDelete(chain.id);
  };
  const renderChainCard = (chain: PromptChain) => (
    <PressRevealSurface pressDisabled={syncSelection.open} key={chain.id} data-safe-mode-work="true" data-return-item-id={chain.id}
      role={syncSelection.selecting ? 'checkbox' : 'button'}
      data-agent-action={syncSelection.selecting ? 'select' : 'browse'}
      aria-label={syncSelection.selecting ? `智慧姬同步：${chain.name}` : `打开${chain.type === 'character' ? '自定义角色' : '风格串'}：${chain.name}`}
      aria-checked={syncSelection.selecting ? syncSelection.selected.has(chain.id) : undefined}
      aria-disabled={syncSelection.selecting ? syncSelection.busy || !syncSelection.available.has(chain.id) : undefined}
      tabIndex={0}
      onKeyDown={event => { if (event.target === event.currentTarget && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); if (syncSelection.selecting) syncSelection.toggle(chain.id); else onSelect(chain.id); } }}
      onClick={() => syncSelection.selecting ? syncSelection.toggle(chain.id) : onSelect(chain.id)}
      className={`mobile-gallery-item group bg-white dark:bg-gray-850 border border-gray-200 dark:border-gray-800/80 hover:border-indigo-500 dark:hover:border-indigo-500/50 rounded-xl overflow-hidden transition-[border-color,box-shadow,transform] duration-200 hover:shadow-xl hover:shadow-indigo-500/10 flex flex-col cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${syncSelection.selecting && syncSelection.selected.has(chain.id) ? '!border-indigo-500 ring-2 ring-indigo-500/20' : ''} ${syncSelection.selecting && !isStChatu8ExportableChain(chain) ? '!cursor-default opacity-60' : ''}`}>
      {/* 原位操作由鼠标悬停／键盘聚焦／触屏长按显露。 */}
      {!syncSelection.open && <div data-card-action="true" className="hover-reveal-md absolute left-2 top-2 z-10 flex max-w-[calc(100%-4.5rem)] flex-wrap items-center gap-1">
          {!isGuest && <button type="button" onClick={event => { event.stopPropagation(); setInfoChain(chain); }} className="mobile-touch flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-gray-500 shadow-sm backdrop-blur hover:bg-gray-100 hover:text-gray-900 dark:bg-black/70 dark:text-gray-300 dark:hover:bg-gray-800" title="编辑信息" aria-label={`编辑${chain.type === 'character' ? '自定义角色' : '风格串'}信息：${chain.name}`}><Pencil className="h-4 w-4" /></button>}
          {!isGuest && <button
            type="button"
            onClick={async event => {
              event.stopPropagation();
              await deleteChain(chain);
            }}
            className="mobile-touch flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-gray-500 shadow-sm backdrop-blur hover:bg-red-50 hover:text-red-500 dark:bg-black/70 dark:text-gray-300 dark:hover:text-red-400"
            title="删除"
            aria-label={`删除：${chain.name}`}
          ><Trash2 className="h-4 w-4" /></button>}
          <button
              onClick={(e) => { e.stopPropagation(); setCopyModalChain(chain); }}
          className="mobile-touch flex h-9 w-9 items-center justify-center rounded-full bg-white/90 p-0 text-indigo-600 shadow-sm backdrop-blur hover:bg-indigo-50 dark:bg-black/70 dark:text-indigo-400 dark:hover:bg-indigo-900/50"
              title="复制/查看详情" aria-label={`复制/查看详情：${chain.name}`}
          >
              <Copy className="h-4 w-4" />
          </button>
      </div>}
      {syncSelection.selecting && syncSelection.available.has(chain.id) && <span aria-hidden="true" className={`absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg border shadow-sm ${syncSelection.selected.has(chain.id) ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-400 bg-white/90 text-transparent dark:border-gray-500 dark:bg-gray-900/90'}`}><Check className="h-4 w-4" /></span>}
      {syncSelection.selecting && !isStChatu8ExportableChain(chain) && <span className="absolute right-2 top-2 z-10 rounded-lg bg-white/90 px-2 py-1 text-xs text-gray-500 shadow-sm dark:bg-gray-900/90 dark:text-gray-400">仅 V4.5 / V5</span>}

      {/* Preview Image */}
      <div
          className="mobile-gallery-frame md:aspect-square bg-gray-200 dark:bg-gray-900 relative border-b border-gray-200 dark:border-gray-700 overflow-hidden flex items-center justify-center"
          style={{ '--mobile-image-ratio': String(previewRatios[chain.id] || 4 / 3) } as React.CSSProperties}
      >
          {isUntestedChain(chain) && (
            <div
              className="absolute left-2 bottom-2 z-10 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-micro font-medium text-amber-300 backdrop-blur-md shadow-sm border border-amber-400/20"
              title="待实测：在此风格串生成后自动去除"
            >
              <EyeOff className="h-3 w-3 text-amber-400 shrink-0" />
              <span>待实测</span>
            </div>
          )}
          {chain.previewImage ? (
              <div className="w-full h-full relative group/img">
                  <SmartImage
                      src={chain.previewImage}
                      alt={chain.name}
                      className="w-full h-full object-contain"
                      onLoad={event => {
                        const image = event.currentTarget;
                        const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
                        if (Number.isFinite(ratio) && ratio > 0 && previewRatios[chain.id] !== ratio) setPreviewRatios(previous => ({ ...previous, [chain.id]: ratio }));
                      }}
                  />
                  {!syncSelection.open && <ImageShareOverlay imageUrl={getMobileOriginalUrl(chain.previewImage)} filename={`${chain.name || 'cover'}.png`} notify={notify} />}
              </div>
          ) : (
              <div className="text-gray-400 dark:text-gray-700">
                   {type === 'character' ? (
                      <User className="h-12 w-12" strokeWidth={1.5} />
                   ) : (
                      <Image className="h-12 w-12" strokeWidth={1.5} />
                   )}
              </div>
          )}
      </div>

      <div className="flex h-12 flex-col justify-center px-3">
        <div className="flex items-center justify-between">
          <h3 data-safe-mode-title="true" className="w-full truncate pr-1 text-sm font-bold text-gray-900 dark:text-gray-100 md:pr-2" title={chain.name}>{chain.name}</h3>
          <span className="ml-1 flex-shrink-0 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-micro font-medium text-violet-700 dark:border-violet-500/30 dark:bg-violet-950/40 dark:text-violet-300" title="生成模型">{getNaiModelDisplayLabel(chain.params?.model)}</span>
          {!syncSelection.selecting && <FavoriteButton
            active={favorites.has(chain.id)}
            onClick={(e) => toggleFav(chain.id, e)}
            label={favorites.has(chain.id) ? '取消收藏' : '收藏该串'}
            className="hover-reveal-touch ml-1 flex-shrink-0"
          />}
        </div>
      </div>
      {syncSelection.open && syncSelection.entries.has(chain.id) && <div className="border-t border-gray-100 px-3 py-2 dark:border-gray-800" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate text-xs font-medium ${syncSelection.entries.get(chain.id)?.status === 'synced' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>{wisdomEntryLabel(syncSelection.entries.get(chain.id)!)}</span>
          {syncSelection.view !== 'pick' && <div className="flex flex-none gap-2">
            {syncSelection.entries.get(chain.id)?.status === 'pending' ? <>
              {syncSelection.entries.get(chain.id)?.error && isStChatu8ExportableChain(chain) && <button type="button" disabled={syncSelection.busy} onClick={() => void syncSelection.actOnEntries('requeue', [chain.id])} className="min-h-8 text-xs text-indigo-600 disabled:opacity-40 dark:text-indigo-300" aria-label={`重试：${chain.name}`}>重试</button>}
              <button type="button" disabled={syncSelection.busy} onClick={() => void syncSelection.actOnEntries('remove', [chain.id])} className="min-h-8 text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40 dark:text-gray-400 dark:hover:text-white" aria-label={`移出待同步：${chain.name}`}>移出</button>
            </> : <button type="button" disabled={syncSelection.busy || !isStChatu8ExportableChain(chain)} onClick={() => void syncSelection.actOnEntries('requeue', [chain.id])} className="min-h-8 text-xs text-indigo-600 disabled:opacity-40 dark:text-indigo-300" aria-label={`重新加入待同步：${chain.name}`}>重新加入</button>}
          </div>}
        </div>
        {syncSelection.entries.get(chain.id)?.error && <p className="truncate text-xs text-red-500" title={syncSelection.entries.get(chain.id)?.error}>{syncSelection.entries.get(chain.id)?.error}</p>}
        {!isStChatu8ExportableChain(chain) && <p className="text-xs text-gray-400">当前模型不可同步</p>}
        {syncSelection.view === 'records' && <p className="truncate text-micro text-gray-400">最近核对 {new Date(syncSelection.entries.get(chain.id)!.lastVerifiedAt).toLocaleString('zh-CN')}</p>}
      </div>}
    </PressRevealSurface>
  );

  const title = type === 'character' ? '我的自定义角色' : '我的风格串';
  const createLabel = type === 'character' ? '新建自定义角色' : '新建风格串';
  const filterCount = Number(Boolean(selectedModel)) + Number(favOnly) + Number(untestedOnly) + selectedTags.size;
  const filtersActive = filterCount > 0 || sortOption !== 'updated_desc';
  useLayoutEffect(() => {
    if (!showDesktopFilters) return;
    const align = () => {
      if (window.innerWidth < 768) { setShowDesktopFilters(false); return; }
      const anchor = filterAnchorRef.current?.getBoundingClientRect();
      const panel = filterPanelRef.current?.getBoundingClientRect();
      if (!anchor) return;
      // 默认与按钮中心对齐，仅在靠近屏幕边缘时让位，保证整个弹层可见。
      const width = panel?.width || Math.min(384, window.innerWidth - 32);
      const centeredLeft = anchor.left + (anchor.width - width) / 2;
      const visibleLeft = Math.max(16, Math.min(centeredLeft, window.innerWidth - width - 16));
      const next = { left: anchor.left + anchor.width / 2, top: anchor.bottom + 8, offset: visibleLeft - centeredLeft };
      setFilterPosition(current => current.left === next.left && current.top === next.top && current.offset === next.offset ? current : next);
    };
    align(); window.addEventListener('resize', align);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(align);
    if (filterAnchorRef.current) observer?.observe(filterAnchorRef.current);
    const toolbar = filterAnchorRef.current?.closest('header');
    if (toolbar) observer?.observe(toolbar);
    return () => { window.removeEventListener('resize', align); observer?.disconnect(); };
  }, [showDesktopFilters, filterCount, canSync, syncSelection.savedCount]);
  const resetFilters = () => {
    setSelectedModel(''); setFavOnly(false); setUntestedOnly(false); setSortOption('updated_desc'); setSelectedTags(new Set()); setTagSearch('');
  };
  // 桌面弹层与手机抽屉共享筛选内容，切换视图也保持同一份筛选状态。
  const filterContent = <div className="space-y-4">
    <div className="flex items-center justify-between"><span className="text-xs text-gray-500 dark:text-gray-400">{filterCount > 0 ? `${filterCount} 项筛选已启用` : '全部资料'}</span>{filtersActive && <button type="button" onClick={resetFilters} className="mobile-touch px-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300">重置筛选</button>}</div>
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">排序<select aria-label="排序" value={sortOption} onChange={event => setSortOption(event.target.value as typeof sortOption)} className="mobile-touch mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs font-normal outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800"><option value="updated_desc">最近更新</option><option value="updated_asc">最早更新</option><option value="created_desc">最近创建</option><option value="created_asc">最早创建</option></select></label>
      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">模型<select aria-label="模型筛选" value={selectedModel} onChange={event => setSelectedModel(event.target.value)} className="mobile-touch mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs font-normal outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800"><option value="">全部模型</option>{modelFilterOptions.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <button type="button" aria-pressed={untestedOnly} onClick={() => setUntestedOnly(value => !value)} className={`mobile-touch flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${untestedOnly ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}><EyeOff className="h-4 w-4" />只看待实测</button>
      <button type="button" aria-pressed={favOnly} onClick={() => setFavOnly(value => !value)} className={`mobile-touch flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${favOnly ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}><Heart className={`h-4 w-4 ${favOnly ? 'fill-current' : ''}`} />只看收藏</button>
    </div>
    <div>
      <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">自定义标签</span>{selectedTags.size > 0 && <button type="button" onClick={() => setSelectedTags(new Set())} className="mobile-touch px-2 text-xs text-gray-500 dark:text-gray-400">清除标签筛选</button>}</div>
      {customTagOptions.length > 12 && <input aria-label="搜索自定义标签" placeholder="搜索标签" value={tagSearch} onChange={event => setTagSearch(event.target.value)} className="mobile-touch mb-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-900 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />}
      {customTagOptions.length === 0 ? <p className="text-xs text-gray-400">暂无自定义标签，可在卡片铅笔中添加</p> : <div className="max-h-40 overflow-y-auto"><div className="flex flex-wrap gap-1.5">{visibleTagOptions.map(tag => <button key={tag} type="button" aria-pressed={selectedTags.has(tag)} onClick={() => toggleTag(tag)} className={`mobile-touch max-w-full break-words rounded-full border px-3 py-1.5 text-xs ${selectedTags.has(tag) ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'border-transparent bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{tag}</button>)}</div>{visibleTagOptions.length === 0 && <p className="py-1 text-xs text-gray-400">没有匹配的标签</p>}</div>}
      {selectedTags.size > 1 && <p className="mt-2 text-xs text-gray-400">同时包含所选标签</p>}
    </div>
  </div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto flex min-h-0 w-full max-w-[1920px] flex-1 flex-col">
        <WorkspaceToolbar>
          <ToolbarSearch value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder={`搜索${title}`} containerClassName="min-w-0 flex-1 md:max-w-none!" />
          <div className="hidden flex-none items-center gap-2 md:flex">
            <div ref={filterAnchorRef} className="relative flex-none">
              <ToolbarButton onClick={() => setShowDesktopFilters(value => !value)} title="筛选与排序" aria-label={`筛选${filterCount > 0 ? ` ${filterCount}` : ''}`} className={filtersActive ? '!border-indigo-300 !bg-indigo-50 !text-indigo-600 dark:!border-indigo-700 dark:!bg-indigo-950/40 dark:!text-indigo-300' : ''} aria-expanded={showDesktopFilters} aria-haspopup="dialog"><Filter className="h-4 w-4" /><span className="hidden xl:inline">筛选{filterCount > 0 ? ` ${filterCount}` : ''}</span></ToolbarButton>
              {showDesktopFilters && <ImagePreviewPortal>
                <div className="fixed inset-0 z-[1000]" onClick={() => setShowDesktopFilters(false)} />
                <div ref={filterPanelRef} role="dialog" aria-label="筛选与排序" style={{ left: filterPosition.left, top: filterPosition.top, marginLeft: filterPosition.offset }} className="appearance-panel fixed -translate-x-1/2 z-[1001] max-h-[calc(100dvh-7rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-900">{filterContent}</div>
              </ImagePreviewPortal>}
            </div>
            {canSync && <div className="border-l border-gray-200 pl-2 dark:border-gray-700"><ToolbarButton onClick={syncSelection.open ? syncSelection.cancel : syncSelection.begin} disabled={syncSelection.busy && !syncSelection.open} title="挑选风格串、待同步与同步记录" aria-label={`智慧姬同步${syncSelection.savedCount > 0 ? ` ${syncSelection.savedCount}` : ''}`} aria-expanded={syncSelection.open}><Link2 className="h-4 w-4" /><span className="hidden xl:inline">智慧姬同步{syncSelection.savedCount > 0 ? ` ${syncSelection.savedCount}` : ''}</span></ToolbarButton></div>}
          </div>
          <div className="flex flex-none gap-1 md:hidden">
            <MobileIconButton label="筛选与排序" onClick={() => setShowMobileFilters(true)} className={`border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 ${filtersActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-300'}`}><Filter className="h-5 w-5" /></MobileIconButton>
            {canSync && <MobileIconButton label={`智慧姬同步（待同步 ${syncSelection.savedCount}）`} onClick={syncSelection.open ? syncSelection.cancel : syncSelection.begin} disabled={syncSelection.busy && !syncSelection.open} className="border border-gray-200 bg-white text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"><Link2 className="h-5 w-5" /></MobileIconButton>}
          </div>
          {!isGuest && <div className="flex flex-none items-center gap-1 border-l border-gray-200 pl-2 dark:border-gray-700 md:gap-2">
            {type === 'style' && <StyleCollectorControl onSaved={onRefresh} notify={notify} />}
            <div className="hidden items-center gap-2 md:flex">
              {type === 'style' && <ToolbarButton onClick={() => setIsFolderImportOpen(true)} title="从本地文件夹批量读取 NovelAI 原图为风格串" aria-label="批量导入"><FolderUp className="h-4 w-4" /><span className="hidden xl:inline">批量导入</span></ToolbarButton>}
              <ToolbarButton tone="primary" onClick={() => setIsModalOpen(true)} aria-label={createLabel} title={createLabel}><Plus className="h-4 w-4" /><span className="hidden xl:inline">{createLabel}</span></ToolbarButton>
            </div>
            <div className="flex gap-1 md:hidden">
              {type === 'style' && <MobileIconButton label="批量导入" onClick={() => setIsFolderImportOpen(true)} className="border border-gray-200 bg-white text-indigo-600 dark:border-gray-800 dark:bg-gray-900 dark:text-indigo-400"><FolderUp className="h-5 w-5" /></MobileIconButton>}
              <MobileIconButton label={createLabel} onClick={() => setIsModalOpen(true)} className="bg-indigo-600 text-white"><Plus className="h-5 w-5" /></MobileIconButton>
            </div>
          </div>}
        </WorkspaceToolbar>

        {canSync && syncSelection.open && <WisdomSyncToolbar sync={syncSelection} filteredIds={filteredChains.map(chain => chain.id)} />}

        <ImagePreviewPortal><MobileBottomSheet open={showMobileFilters} title="筛选与排序" onClose={() => setShowMobileFilters(false)}>{filterContent}</MobileBottomSheet></ImagePreviewPortal>

        <div ref={chainScrollRef} onScroll={onScrollRestore} className="min-h-0 flex-1 overflow-y-auto p-3 md:p-5">
          {filteredChains.length === 0 ? (
            <div className="text-center py-20 bg-gray-100 dark:bg-gray-800/50 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700">
              <p className="text-gray-500 text-sm mb-4">{syncSelection.open ? syncSelection.view === 'pending' ? '没有符合筛选条件的待同步风格串，可在「挑选风格串」中加入。' : syncSelection.view === 'records' ? '没有符合筛选条件的同步记录，接收确认后会显示在这里。' : '没有符合筛选条件的风格串。' : '暂无数据'}</p>
              {!isGuest && !syncSelection.open && <button onClick={() => setIsModalOpen(true)} className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 font-medium">{createLabel}</button>}
            </div>
          ) : (
            /* Grid Layout */
            <>
            {imageDisplay.layout === 'masonry' ? (
              <ShortestColumnMasonry
                items={visibleChains}
                columns={masonryColumns}
                getItemKey={chain => chain.id}
                estimateItemHeight={estimateChainCardHeight}
                renderItem={renderChainCard}
              />
            ) : (
              <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-chain-grid`} style={mobileGalleryStyle(imageDisplay)}>
                {visibleChains.map(renderChainCard)}
              </div>
            )}
            {visibleCount < filteredChains.length && <div className="flex justify-center py-6"><button type="button" onClick={() => setVisibleCount(count => count + RENDER_BATCH_SIZE)} className="mobile-touch rounded-xl border border-gray-300 bg-white px-5 text-sm font-bold text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">加载更多（{filteredChains.length - visibleCount}）</button><div ref={chainLoadSentinelRef} className="h-4 w-full max-w-40" aria-hidden="true" /></div>}
            </>
          )}
        </div>
      </div>

      {/* Simple Create Modal */}
      {isModalOpen && (
        <ImagePreviewPortal><div role="dialog" aria-modal="true" aria-label={createLabel} className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="appearance-panel bg-white dark:bg-gray-800 rounded-xl p-6 md:p-8 w-full max-w-md border border-gray-200 dark:border-gray-700 shadow-2xl">
            <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">{createLabel}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">名称</label>
                <input
                  type="text"
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={type === 'character' ? '例如：新角色' : '例如：新风格串'}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">描述</label>
                <textarea
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none h-24 resize-none"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder={type === 'character' ? '描述这个角色的用途...' : '描述这个风格串的用途...'}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-8">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">取消</button>
              <button onClick={handleCreate} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium">创建</button>
            </div>
          </div>
        </div>
      </ImagePreviewPortal>)}

      {/* Smart Copy Modal */}
      {infoChain && <ChainInfoModal key={infoChain.id} chain={infoChain} onSave={onUpdateChain} onClose={() => setInfoChain(null)} notify={notify} />}
      {copyModalChain && (
          <ImagePreviewPortal><CopyModal
            chain={copyModalChain}
            onClose={() => setCopyModalChain(null)}
            notify={notify}
          /></ImagePreviewPortal>
      )}

      {/* Folder Batch Import Modal */}
      <FolderBatchImportModal
        isOpen={isFolderImportOpen}
        existingChains={chains}
        onClose={() => setIsFolderImportOpen(false)}
        onSuccess={onRefresh}
        notify={notify}
      />
    </div>
  );
};
