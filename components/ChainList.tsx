
import React, { useState, useEffect, useMemo } from 'react';
import { PromptChain, ChainType } from '../types';

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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [copyModalChain, setCopyModalChain] = useState<PromptChain | null>(null);
  const [sortOption, setSortOption] = useState<'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc'>('updated_desc');
  const [favOnly, setFavOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

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
  const subtitle = type === 'character' ? '管理角色外观、服装与特征预设。' : '管理并迭代你的 NovelAI 提示词风格组合。';
  const createLabel = type === 'character' ? '新建角色串' : '新建画师串';

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-4 md:p-8">
      <div className="max-w-[1920px] mx-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between mb-6 md:mb-10 gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2">{title}</h1>
            <p className="text-sm md:text-base text-gray-500 dark:text-gray-400">{subtitle}</p>
          </div>
          <div className="flex flex-col md:flex-row gap-2 md:gap-4 w-full md:w-auto">
             <div className="flex gap-2 w-full md:w-auto">
                <button 
                    onClick={onRefresh} 
                    className={`p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex-shrink-0`}
                    title="刷新列表"
                >
                    <svg className={`w-6 h-6 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
                <input
                    type="text"
                    placeholder="搜索..."
                    className="w-full md:w-64 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
             </div>
             {/* Tag Filter Bar */}
             {allTags.length > 0 && (
               <div className="flex flex-wrap gap-2 p-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 max-h-20 overflow-y-auto">
                 {allTags.map(tag => (
                   <button
                     key={tag}
                     type="button"
                     aria-pressed={selectedTags.has(tag)}
                     onClick={() => {
                       const newSelected = new Set(selectedTags);
                       if (newSelected.has(tag)) {
                         newSelected.delete(tag);
                       } else {
                         newSelected.add(tag);
                       }
                       setSelectedTags(newSelected);
                     }}
                     className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                       selectedTags.has(tag)
                         ? 'bg-indigo-600 text-white'
                         : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                     }`}
                   >
                     {tag}
                   </button>
                 ))}
               </div>
             )}
             {/* Sort & Favorite Controls */}
             <div className="flex gap-2 w-full md:w-auto items-center">
                <select
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value as any)}
                  className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs rounded-lg px-2 py-2 focus:ring-2 focus:ring-indigo-500 outline-none w-full md:w-40"
                >
                  <option value="updated_desc">按最近更新</option>
                  <option value="updated_asc">按最早更新</option>
                  <option value="created_desc">按最近创建</option>
                  <option value="created_asc">按最早创建</option>
                </select>
                <button
                  type="button"
                  onClick={() => setFavOnly(!favOnly)}
                  className={`px-3 py-2 rounded-lg border text-xs flex items-center gap-1 transition-colors ${
                    favOnly
                      ? 'bg-yellow-50 border-yellow-300 text-yellow-700 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-400'
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-400'
                  }`}
                  title="仅显示收藏的串"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path>
                  </svg>
                  <span className="hidden md:inline">收藏</span>
                </button>
             </div>
            {!isGuest && (
                <button
                onClick={() => setIsModalOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20 flex items-center justify-center md:justify-start"
                >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                {createLabel}
                </button>
            )}
          </div>
        </header>

        {filteredChains.length === 0 ? (
          <div className="text-center py-20 bg-gray-100 dark:bg-gray-800/50 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700">
            <p className="text-gray-500 text-lg mb-4">暂无数据</p>
            {!isGuest && <button onClick={() => setIsModalOpen(true)} className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 font-medium">{createLabel}</button>}
          </div>
        ) : (
          /* Grid Layout */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredChains.map((chain) => (
              <div key={chain.id} onClick={() => onSelect(chain.id)} className="group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-indigo-500 dark:hover:border-indigo-500/50 rounded-xl overflow-hidden transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10 flex flex-col cursor-pointer relative">
                {/* Copy Button Overlay - Trigger Modal */}
                <div className="absolute top-2 right-2 z-10 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                        onClick={(e) => { e.stopPropagation(); setCopyModalChain(chain); }} 
                        className="bg-white/90 dark:bg-black/70 backdrop-blur px-3 py-1.5 rounded-full shadow-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 text-xs font-bold flex items-center gap-1"
                        title="复制/查看详情"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                        复制
                    </button>
                </div>

                {/* Preview Image */}
                <div 
                    className="aspect-square bg-gray-200 dark:bg-gray-900 relative border-b border-gray-200 dark:border-gray-700 overflow-hidden flex items-center justify-center"
                >
                    {chain.previewImage ? (
                        <div className="w-full h-full relative group/img">
                            <img 
                                src={chain.previewImage} 
                                alt={chain.name} 
                                className="w-full h-full object-contain" 
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

                <div className="p-3 flex flex-col flex-1">
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate pr-2 w-full" title={chain.name}>{chain.name}</h3>
                    <button
                      type="button"
                      onClick={(e) => toggleFav(chain.id, e)}
                      className={`ml-2 p-1 rounded-full flex-shrink-0 ${
                        favorites.has(chain.id)
                          ? 'text-yellow-500'
                          : 'text-gray-300 hover:text-yellow-400 dark:text-gray-500 dark:hover:text-yellow-400'
                      }`}
                      title={favorites.has(chain.id) ? '取消收藏' : '收藏该串'}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill={favorites.has(chain.id) ? 'currentColor' : 'none'} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.563.044.8.77.38 1.178l-4.244 4.134a.563.563 0 00-.153.476l1.24 5.376c.13.565-.487 1.01-.967.756L12 18.232l-4.894 3.08c-.48.254-1.097-.19-.967-.756l1.24-5.376a.563.563 0 00-.153-.476L2.985 10.575c-.42-.408-.183-1.134.38-1.178l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 text-xs mb-2 line-clamp-2 h-8 leading-tight">{chain.description || '暂无描述'}</p>

                  {/* Tags 显示 */}
                  {chain.tags && chain.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {chain.tags.slice(0, 3).map(tag => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 text-[10px] rounded-full truncate max-w-16ch"
                          title={tag}
                        >
                          {tag}
                        </span>
                      ))}
                      {chain.tags.length > 3 && (
                        <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[10px] rounded-full shrink-0">
                          +{chain.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-auto flex justify-between items-center pt-2 border-t border-gray-100 dark:border-gray-700/50">
                     <div className="flex flex-col min-w-0 mr-2">
                        <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 truncate" title={chain.username}>
                            @{chain.username || 'Unknown'}
                        </span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                            {new Date(chain.updatedAt).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                     </div>
                     {!isGuest && (
                        <button
                        onClick={(e) => { e.stopPropagation(); if(confirm('确认删除?')) onDelete(chain.id); }}
                        className="p-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors rounded hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0"
                        title="删除"
                        >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                     )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Simple Create Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 md:p-8 w-full max-w-md border border-gray-200 dark:border-gray-700 shadow-2xl">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">{createLabel}</h2>
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
