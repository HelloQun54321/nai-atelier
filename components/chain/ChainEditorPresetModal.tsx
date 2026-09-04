import React from 'react';
import { Info } from 'lucide-react';
import { PromptChain } from '../../types';
import { LabPresetImportOptions } from '../../services/labModeTools';
import { CloseButton, isInternalChainTag } from '../DesignSystem';
import { SmartImage } from '../SmartImage';

export interface ChainEditorPresetModalProps {
    showImportPreset: boolean;
    importCandidate: PromptChain | null;
    setImportCandidate: (value: PromptChain | null) => void;
    quickImportMode: boolean;
    setQuickImportMode: (value: boolean) => void;
    importTab: 'style' | 'character';
    setImportTab: (value: 'style' | 'character') => void;
    setShowImportPreset: (value: boolean) => void;
    allChains: PromptChain[];
    importModalSearch: string;
    setImportModalSearch: (value: string) => void;
    importModalSelectedTags: Set<string>;
    setImportModalSelectedTags: (value: Set<string>) => void;
    favorites: Set<string>;
    initiateImport: (chain: PromptChain) => void;
    importOptions: LabPresetImportOptions;
    setImportOptions: (value: LabPresetImportOptions) => void;
    selectedImportModuleIds: Set<string>;
    setSelectedImportModuleIds: (value: Set<string>) => void;
    confirmImport: () => void;
}

export const ChainEditorPresetModal: React.FC<ChainEditorPresetModalProps> = ({
    showImportPreset,
    importCandidate,
    setImportCandidate,
    quickImportMode,
    setQuickImportMode,
    importTab,
    setImportTab,
    setShowImportPreset,
    allChains,
    importModalSearch,
    setImportModalSearch,
    importModalSelectedTags,
    setImportModalSelectedTags,
    favorites,
    initiateImport,
    importOptions,
    setImportOptions,
    selectedImportModuleIds,
    setSelectedImportModuleIds,
    confirmImport,
}) => {
    React.useEffect(() => {
        if (!showImportPreset) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (importCandidate) setImportCandidate(null);
                else setShowImportPreset(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showImportPreset, importCandidate, setImportCandidate, setShowImportPreset]);

    return (
    <>
        {/* Import Preset List Modal */}
        {showImportPreset && !importCandidate && (
            <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 p-2 backdrop-blur-sm md:p-4" onMouseDown={e => { if (e.target === e.currentTarget) setShowImportPreset(false); }}>
                <div className="flex max-h-[90dvh] w-full max-w-4xl flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900 md:max-h-[85vh] md:max-w-5xl lg:max-w-6xl">
                    <div className="relative flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 p-3 dark:border-gray-800 md:justify-between md:gap-4 md:p-4">
                        <h3 className="pr-10 font-bold dark:text-white md:pr-0">引用预设</h3>

                        {/* 快速导入开关 */}
                        <label className="order-2 flex w-full flex-shrink-0 cursor-pointer select-none items-center gap-2 group md:order-none md:w-auto">
                            <span className="text-xs text-gray-500 dark:text-gray-400">快速导入</span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={quickImportMode}
                                onClick={() => setQuickImportMode(!quickImportMode)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setQuickImportMode(!quickImportMode); } }}
                                className="mobile-touch flex h-11 w-11 items-center justify-center border-0 bg-transparent p-0 outline-none shadow-none"
                            >
                                <span className={`relative block h-5 w-10 rounded-full transition-colors ${quickImportMode ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${quickImportMode ? 'left-5' : 'left-0.5'}`} />
                                </span>
                            </button>
                            <span className="relative">
                                <Info className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-400 transition-colors" />
                                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                    开启后点击预设直接导入，关闭则显示详细选项
                                </span>
                            </span>
                        </label>

                        <div className="order-3 flex w-full max-w-none rounded-lg bg-gray-100 p-1 dark:bg-gray-700/50 md:order-none md:max-w-xs md:flex-1">
                            <button
                                onClick={() => setImportTab('style')}
                                className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${importTab === 'style' ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-white' : 'text-gray-500'}`}
                            >
                                画师/风格串
                            </button>
                            <button
                                onClick={() => setImportTab('character')}
                                className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${importTab === 'character' ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-white' : 'text-gray-500'}`}
                            >
                                Character (角色)
                            </button>
                        </div>

                        <CloseButton onClick={() => setShowImportPreset(false)} label="关闭引用预设" size="sm" className="absolute right-3 top-3 md:static" />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
                        {/* Extract all unique tags from the filtered list for this modal */}
                        {(() => {
                          const filteredForTags = allChains.filter(c => (importTab === 'character' ? c.type === 'character' : (c.type === 'style' || !c.type)));
                          const allModalTags = Array.from(
                            new Set(
                              filteredForTags.flatMap(chain => chain.tags || []).filter(tag => !isInternalChainTag(tag))
                            )
                          ).sort();

                          // Filter the list based on search and tags
                          const filteredChains = filteredForTags
                            .filter(c =>
                              (c.name.toLowerCase().includes(importModalSearch.toLowerCase()) ||
                               c.description.toLowerCase().includes(importModalSearch.toLowerCase()))
                            )
                            .filter(c => {
                              if (importModalSelectedTags.size === 0) return true;
                              const chainTagSet = new Set(c.tags || []);
                              return Array.from(importModalSelectedTags).every(tag => chainTagSet.has(tag));
                            })
                            .sort((a, b) => {
                              const aFav = favorites.has(a.id); const bFav = favorites.has(b.id);
                              if (aFav && !bFav) return -1; if (!aFav && bFav) return 1; return 0;
                            });

                          return (
                            <>
                              {/* Search Input for Modal */}
                              <div className="flex gap-2 w-full mb-4">
                                <input
                                  type="text"
                                  placeholder="搜索预设..."
                                  className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                                  value={importModalSearch}
                                  onChange={(e) => setImportModalSearch(e.target.value)}
                                />
                              </div>
                              {/* Tag Filter Bar for Modal */}
                              {allModalTags.length > 0 && (
                                <div className="flex flex-wrap gap-2 p-2 bg-gray-100 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600 mb-4 max-h-20 overflow-y-auto">
                                  {allModalTags.map(tag => (
                                    <button
                                      key={tag}
                                      type="button"
                                      onClick={() => {
                                        const newSelected = new Set(importModalSelectedTags);
                                        if (newSelected.has(tag)) {
                                          newSelected.delete(tag);
                                        } else {
                                          newSelected.add(tag);
                                        }
                                        setImportModalSelectedTags(newSelected);
                                      }}
                                      className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                                        importModalSelectedTags.has(tag)
                                          ? 'bg-indigo-600 text-white'
                                          : 'bg-white dark:bg-gray-600 text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-500'
                                      }`}
                                    >
                                      {tag}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                                {filteredChains.map(c => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => initiateImport(c)}
                                    className="flex flex-col rounded-xl border border-gray-200 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-gray-50 dark:hover:bg-gray-700/50 bg-white dark:bg-gray-800/80 overflow-hidden text-left transition-colors"
                                  >
                                    <div className="aspect-square w-full bg-black/5 dark:bg-black/20 flex-shrink-0 relative">
                                      {c.previewImage ? (
                                        <SmartImage src={c.previewImage} alt="" className="absolute inset-0 w-full h-full object-contain" />
                                      ) : (
                                        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs">无图</div>
                                      )}
                                      {favorites.has(c.id) && (
                                        <span className="absolute top-1 right-1 text-amber-500 text-lg drop-shadow-md" title="已收藏">★</span>
                                      )}
                                    </div>
                                    <div className="p-2 flex-1 min-h-0 flex flex-col">
                                      <div className="font-semibold text-sm dark:text-gray-200 truncate">{c.name}</div>
                                      <div className="text-xs text-gray-500 truncate mt-0.5 flex-1">{c.description || '无描述'}</div>
                                      <span className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">选择</span>
                                    </div>
                                  </button>
                                ))}
                              </div>
                              {filteredChains.length === 0 && (
                                <div className="text-center text-gray-400 py-12 text-sm">暂无匹配的预设</div>
                              )}
                            </>
                          );
                        })()}
                    </div>
                </div>
            </div>
        )}

        {/* Import Detail/Confirm Modal */}
        {importCandidate && (
            <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onMouseDown={e => { if (e.target === e.currentTarget) setImportCandidate(null); }}>
                <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm shadow-2xl border border-gray-200 dark:border-gray-800">
                    <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 rounded-t-2xl">
                        <h3 className="font-bold text-gray-900 dark:text-white truncate" title={importCandidate.name}>
                            导入: {importCandidate.name}
                        </h3>
                    </div>
                    <div className="p-5 space-y-3">
                        <label className="flex items-center gap-3 cursor-pointer select-none">
                            <input type="checkbox" checked={importOptions.importBasePrompt} onChange={e => setImportOptions({ ...importOptions, importBasePrompt: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                            <span className="text-sm font-medium dark:text-gray-200">基础画风</span>
                        </label>

                        <label className="flex items-center gap-3 cursor-pointer select-none">
                            <input type="checkbox" checked={importOptions.importSubject} onChange={e => setImportOptions({ ...importOptions, importSubject: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                            <span className="text-sm font-medium dark:text-gray-200">主体提示词</span>
                        </label>

                        <label className="flex items-center gap-3 cursor-pointer select-none">
                            <input type="checkbox" checked={importOptions.importNegative} onChange={e => setImportOptions({ ...importOptions, importNegative: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                            <span className="text-sm font-medium dark:text-gray-200">负面提示词</span>
                        </label>

                        <div className="space-y-2">
                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importModules} onChange={e => setImportOptions({ ...importOptions, importModules: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">增强模块</span>
                            </label>
                            {importOptions.importModules && (
                                <label className="flex items-center gap-3 cursor-pointer select-none pl-8">
                                    <input type="checkbox" checked={importOptions.appendModules} onChange={e => setImportOptions({ ...importOptions, appendModules: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                    <span className="text-xs text-gray-500 dark:text-gray-400">追加</span>
                                </label>
                            )}
                            {importOptions.importModules && importCandidate.modules && importCandidate.modules.length > 0 && (
                                <div className="ml-8 mt-2 border border-gray-200 dark:border-gray-800 rounded-xl p-2 max-h-40 overflow-y-auto bg-gray-50 dark:bg-gray-900 custom-scrollbar">
                                    {importCandidate.modules.map(m => (
                                        <label key={m.id} className="flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 p-1 rounded cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={selectedImportModuleIds.has(m.id)}
                                                onChange={e => {
                                                    const next = new Set(selectedImportModuleIds);
                                                    if (e.target.checked) next.add(m.id);
                                                    else next.delete(m.id);
                                                    setSelectedImportModuleIds(next);
                                                }}
                                                className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-0 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                                            />
                                            <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1" title={m.content}>{m.name || '未命名模块'}</span>
                                            {m.group && <span className="text-[9px] bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded text-gray-500 uppercase">{m.group}</span>}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importCharacters} onChange={e => setImportOptions({ ...importOptions, importCharacters: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">多角色管理</span>
                            </label>
                            {importOptions.importCharacters && (
                                <label className="flex items-center gap-3 cursor-pointer select-none pl-8">
                                    <input type="checkbox" checked={importOptions.appendCharacters} onChange={e => setImportOptions({ ...importOptions, appendCharacters: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                    <span className="text-xs text-gray-500 dark:text-gray-400">追加</span>
                                </label>
                            )}
                        </div>

                        <label className="flex items-center gap-3 cursor-pointer select-none">
                            <input type="checkbox" checked={importOptions.importSettings} onChange={e => setImportOptions({ ...importOptions, importSettings: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                            <span className="text-sm font-medium dark:text-gray-200">生成参数</span>
                        </label>

                        <label className="flex items-center gap-3 cursor-pointer select-none">
                            <input type="checkbox" checked={importOptions.importSeed} onChange={e => setImportOptions({ ...importOptions, importSeed: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                            <span className="text-sm font-medium dark:text-gray-200">种子</span>
                        </label>
                    </div>
                    <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-3">
                        <button onClick={() => setImportCandidate(null)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors">取消</button>
                        <button onClick={confirmImport} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded shadow-lg shadow-indigo-500/20 transition-all">导入</button>
                    </div>
                </div>
            </div>
        )}
    </>
    );
};
