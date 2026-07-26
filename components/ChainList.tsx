
import React, { useState, useEffect, useMemo } from 'react';
import { PromptChain, ChainType } from '../types';
import { useConfirmDialog } from './ConfirmDialog';
import { MobileBottomSheet, MobileIconButton } from './MobileUI';
import { SmartImage } from './SmartImage';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { Copy, Heart, Menu, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { IconButton, ToolbarButton, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';

interface ChainListProps {
  chains: PromptChain[];
  type: ChainType; // New Prop to filter view
  onCreate: (name: string, desc: string, type: ChainType) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  isLoading: boolean;
  notify: (msg: string, type?: 'success' | 'error') => void;
  isGuest?: boolean;
}

// Internal Component: Smart Copy Modal
const CopyModal: React.FC<{
    chain: PromptChain;
    onClose: () => void;
    notify: (msg: string) => void;
}> = ({ chain, onClose, notify }) => {
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900 rounded-t-xl">
                    <h3 className="font-bold text-gray-900 dark:text-white truncate pr-4">{chain.name}</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white">✕</button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Description Section (Full View) */}
                    {chain.description && (
                         <div className="bg-yellow-50 dark:bg-yellow-900/10 p-3 rounded-lg border border-yellow-100 dark:border-yellow-900/30 text-sm text-gray-700 dark:text-gray-300">
                             <div className="font-bold text-xs text-yellow-600 dark:text-yellow-500 mb-1 uppercase">说明</div>
                             <div className="whitespace-pre-wrap break-words">{chain.description}</div>
                         </div>
                    )}

                    <div className="space-y-3">
                        <h4 className="font-bold text-xs text-indigo-500 uppercase tracking-wider">选择要复制的内容</h4>
                        
                        {/* Base Prompt */}
                        <label className="flex items-start gap-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                            <input type="checkbox" checked={checkBase} onChange={e => setCheckBase(e.target.checked)} className="mt-1" />
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-sm dark:text-white">基础 Prompt (Base)</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 font-mono line-clamp-2 break-all">{chain.basePrompt || '(空)'}</div>
                            </div>
                        </label>

                        {/* Modules */}
                        {chain.modules && chain.modules.length > 0 && (
                            <div className="space-y-2 pl-4 border-l-2 border-gray-100 dark:border-gray-700">
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
                        <label className="flex items-start gap-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                            <input type="checkbox" checked={checkSubject} onChange={e => setCheckSubject(e.target.checked)} className="mt-1" />
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-sm dark:text-white">变量/主体 (Subject)</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 font-mono line-clamp-1">{chain.variableValues?.subject || '(空)'}</div>
                            </div>
                        </label>
                    </div>

                    {/* Negative Prompt Quick Copy */}
                    <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                        <div className="flex justify-between items-center mb-1">
                            <span className="font-bold text-xs text-red-500 uppercase">负面 Prompt</span>
                            <button onClick={copyNegative} className="text-xs text-indigo-600 hover:underline">仅复制负面</button>
                        </div>
                        <div className="text-xs text-gray-400 bg-gray-50 dark:bg-gray-900 p-2 rounded font-mono max-h-20 overflow-y-auto">
                            {chain.negativePrompt || '(空)'}
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-b-xl flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-gray-500 hover:text-gray-800 dark:hover:text-white">关闭</button>
                    <button onClick={handleCopy} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold shadow-lg">复制选中组合</button>
                </div>
            </div>
        </div>
    );
};

export const ChainList: React.FC<ChainListProps> = ({ chains, type, onCreate, onSelect, onDelete, onRefresh, isLoading, notify, isGuest = false }) => {
  const imageDisplay = useMobileImageDisplayPreferences();
  const [previewRatios, setPreviewRatios] = useState<Record<string, number>>({});
  const confirmAction = useConfirmDialog();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [copyModalChain, setCopyModalChain] = useState<PromptChain | null>(null);
  const [sortOption, setSortOption] = useState<'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc'>('updated_desc');
  const [favOnly, setFavOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [showMobileFilters, setShowMobileFilters] = useState(false);

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

  // Memoize allTags extraction
  const allTags = useMemo(() => {
    return Array.from(
      new Set(
        chains.flatMap(chain => chain.tags || [])
      )
    ).sort();
  }, [chains]);

  // Filter chains by Type, search term, favorites, and selected tags
  const filteredChains = useMemo(() => {
    return chains
      .filter(c =>
        (c.type === type || (!c.type && type === 'style')) && // Backward compat: default to style if no type
        (c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
         c.description.toLowerCase().includes(searchTerm.toLowerCase()))
      )
      .filter(c => !favOnly || favorites.has(c.id))
      .filter(c => {
        // If no tags are selected, show all
        if (selectedTags.size === 0) return true;
        // Check if the chain has ALL the selected tags (AND logic)
        const chainTagSet = new Set(c.tags || []);
        return Array.from(selectedTags).every(tag => chainTagSet.has(tag));
      })
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
  }, [chains, type, searchTerm, favOnly, favorites, selectedTags, sortOption]);

  const title = type === 'character' ? '我的角色串' : '我的画师串';
  const createLabel = type === 'character' ? '新建角色串' : '新建画师串';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto flex min-h-0 w-full max-w-[1920px] flex-1 flex-col">
        <WorkspaceToolbar>
          <ToolbarSearch value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder={`搜索${title}`} containerClassName="md:w-[22rem] md:flex-none" />
          <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
            {allTags.length > 0 && <div className="flex max-w-56 flex-nowrap gap-1 overflow-x-auto">{allTags.map(tag => <button key={tag} type="button" aria-pressed={selectedTags.has(tag)} onClick={() => setSelectedTags(previous => { const next = new Set(previous); next.has(tag) ? next.delete(tag) : next.add(tag); return next; })} className={`h-8 whitespace-nowrap rounded-full px-2.5 text-xs font-medium transition ${selectedTags.has(tag) ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'}`}>{tag}</button>)}</div>}
            <select value={sortOption} onChange={event => setSortOption(event.target.value as typeof sortOption)} className="ml-auto h-10 w-36 rounded-xl border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"><option value="updated_desc">最近更新</option><option value="updated_asc">最早更新</option><option value="created_desc">最近创建</option><option value="created_asc">最早创建</option></select>
            <IconButton label="仅显示收藏" onClick={() => setFavOnly(value => !value)} className={favOnly ? '!border-indigo-200 !bg-indigo-50 !text-indigo-600 dark:!bg-indigo-950/40' : ''}><Heart className={`h-4 w-4 ${favOnly ? 'fill-current' : ''}`} /></IconButton>
            <IconButton label="刷新列表" onClick={onRefresh} disabled={isLoading}><RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /></IconButton>
            {!isGuest && <ToolbarButton tone="primary" onClick={() => setIsModalOpen(true)}><Plus className="h-4 w-4" />{createLabel}</ToolbarButton>}
          </div>
          <MobileIconButton label="筛选与排序" onClick={() => setShowMobileFilters(true)} className="border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 md:hidden"><Menu className="h-5 w-5" /></MobileIconButton>
          {!isGuest && <MobileIconButton label={createLabel} onClick={() => setIsModalOpen(true)} className="bg-indigo-600 text-white md:hidden"><Plus className="h-5 w-5" /></MobileIconButton>}
        </WorkspaceToolbar>

        <MobileBottomSheet open={showMobileFilters} title="筛选与排序" onClose={() => setShowMobileFilters(false)}>
          <div className="space-y-5">
            <label className="block text-sm font-bold dark:text-white">排序<select value={sortOption} onChange={event => setSortOption(event.target.value as typeof sortOption)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 font-normal dark:border-gray-600 dark:bg-gray-800"><option value="updated_desc">最近更新</option><option value="updated_asc">最早更新</option><option value="created_desc">最近创建</option><option value="created_asc">最早创建</option></select></label>
            <button onClick={() => setFavOnly(value => !value)} className={`mobile-touch w-full rounded-xl px-4 text-left font-bold ${favOnly ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300' : 'bg-gray-100 dark:bg-gray-800'}`}>★ 只看收藏</button>
            {allTags.length > 0 && <div><div className="mb-2 text-sm font-bold dark:text-white">Tag</div><div className="flex flex-wrap gap-2">{allTags.map(tag => <button key={tag} onClick={() => setSelectedTags(previous => { const next = new Set(previous); next.has(tag) ? next.delete(tag) : next.add(tag); return next; })} className={`mobile-touch rounded-full px-3 text-xs ${selectedTags.has(tag) ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}>{tag}</button>)}</div></div>}
            <button onClick={() => { void onRefresh(); setShowMobileFilters(false); }} className="mobile-touch w-full rounded-xl border border-gray-300 dark:border-gray-600">刷新列表</button>
          </div>
        </MobileBottomSheet>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-5">
          {filteredChains.length === 0 ? (
            <div className="text-center py-20 bg-gray-100 dark:bg-gray-800/50 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700">
              <p className="text-gray-500 text-lg mb-4">暂无数据</p>
              {!isGuest && <button onClick={() => setIsModalOpen(true)} className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 font-medium">{createLabel}</button>}
            </div>
          ) : (
            /* Grid Layout */
            <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-chain-grid md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 md:gap-4`} style={mobileGalleryStyle(imageDisplay)}>
              {filteredChains.map((chain) => (
              <div key={chain.id} onClick={() => onSelect(chain.id)} className="mobile-gallery-item group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-indigo-500 dark:hover:border-indigo-500/50 rounded-xl overflow-hidden transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10 flex flex-col cursor-pointer relative">
                {/* Copy Button Overlay - Trigger Modal */}
                <div className="absolute right-2 top-2 z-10 hidden items-center gap-1 opacity-0 transition-opacity md:group-hover:flex md:group-hover:opacity-100">
                    {!isGuest && <button
                      type="button"
                      onClick={async event => {
                        event.stopPropagation();
                        if (await confirmAction({ title: `删除“${chain.name}”？`, message: `该${chain.type === 'character' ? '角色串' : '画师串'}及其配置将被永久删除，此操作无法撤销。`, confirmLabel: '确认删除', tone: 'danger' })) onDelete(chain.id);
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-gray-500 shadow-sm backdrop-blur hover:bg-red-50 hover:text-red-500 dark:bg-black/70 dark:text-gray-300 dark:hover:text-red-400"
                      title="删除"
                    ><Trash2 className="h-4 w-4" /></button>}
                    <button 
                        onClick={(e) => { e.stopPropagation(); setCopyModalChain(chain); }} 
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 p-0 text-indigo-600 shadow-sm backdrop-blur hover:bg-indigo-50 dark:bg-black/70 dark:text-indigo-400 dark:hover:bg-indigo-900/50"
                        title="复制/查看详情"
                    >
                        <Copy className="h-4 w-4" />
                    </button>
                </div>

                {/* Preview Image */}
                <div 
                    className="mobile-gallery-frame md:aspect-square bg-gray-200 dark:bg-gray-900 relative border-b border-gray-200 dark:border-gray-700 overflow-hidden flex items-center justify-center"
                    style={{ '--mobile-image-ratio': String(previewRatios[chain.id] || 4 / 3) } as React.CSSProperties}
                >
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
                        </div>
                    ) : (
                        <div className="text-gray-400 dark:text-gray-700">
                             {type === 'character' ? (
                                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                             ) : (
                                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                             )}
                        </div>
                    )}
                </div>

                <div className="flex h-12 flex-col justify-center px-3">
                  <div className="flex items-center justify-between">
                    <h3 className="w-full truncate pr-1 text-sm font-bold text-gray-900 dark:text-gray-100 md:pr-2" title={chain.name}>{chain.name}</h3>
                    <button
                      type="button"
                      onClick={(e) => toggleFav(chain.id, e)}
                      className={`mobile-touch ml-1 flex translate-x-1 flex-shrink-0 items-center justify-center rounded-full p-0 ${
                        favorites.has(chain.id)
                          ? 'text-rose-500'
                          : 'text-gray-300 hover:text-rose-400 dark:text-gray-500 dark:hover:text-rose-400'
                      }`}
                      title={favorites.has(chain.id) ? '取消收藏' : '收藏该串'}
                    >
                      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill={favorites.has(chain.id) ? 'currentColor' : 'none'} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78Z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Simple Create Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 md:p-8 w-full max-w-md border border-gray-200 dark:border-gray-700 shadow-2xl">
            <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">{createLabel}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">名称</label>
                <input
                  type="text"
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如：新预设"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">描述</label>
                <textarea
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none h-24 resize-none"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="描述这个预设的用途..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-8">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">取消</button>
              <button onClick={handleCreate} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* Smart Copy Modal */}
      {copyModalChain && (
          <CopyModal 
            chain={copyModalChain} 
            onClose={() => setCopyModalChain(null)} 
            notify={notify} 
          />
      )}
    </div>
  );
};
