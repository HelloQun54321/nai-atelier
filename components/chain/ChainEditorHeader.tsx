import React, { useRef } from 'react';
import { FileDown, ImagePlus, Quote, RotateCcw, Save, Tags } from 'lucide-react';
import { GenerationMode } from '../../types';
import { ChainEditorModeHeader } from '../ChainEditorModeHeader';

export interface ChainEditorHeaderProps {
    chainId: string;
    chainName: string;
    chainDesc: string;
    chainTags: string[];
    setChainName: (value: string) => void;
    setChainDesc: (value: string) => void;
    setChainTags: (value: string[]) => void;
    isCharacterMode: boolean;
    isOwner: boolean;
    isGuest: boolean;
    canEdit: boolean;
    isEditingInfo: boolean;
    setIsEditingInfo: (value: boolean) => void;
    canSaveActiveModeToLibrary: boolean;
    canSaveCurrentChain: boolean;
    isUploading: boolean;
    hasChanges: boolean;
    hasPendingPreviewCover: boolean;
    tagAssistEnabled: boolean;
    onTagAssistEnabledChange: (enabled: boolean) => void;
    activeGenerationMode: GenerationMode;
    selectGenerationMode: (mode: GenerationMode) => void | Promise<void>;
    onBack: () => void | Promise<void>;
    markChange: () => void;
    handleReset: () => void;
    handleFork: () => void;
    handleSaveAll: () => void;
    handleImportImage: (event: React.ChangeEvent<HTMLInputElement>) => void;
    setShowImportPreset: (value: boolean) => void;
    setTaggerOpen: (value: boolean) => void;
    notify: (msg: string, type?: 'success' | 'error') => void;
}

export const ChainEditorHeader: React.FC<ChainEditorHeaderProps> = ({
    chainId,
    chainName,
    chainDesc,
    chainTags,
    setChainName,
    setChainDesc,
    setChainTags,
    isCharacterMode,
    isOwner,
    isGuest,
    canEdit,
    isEditingInfo,
    setIsEditingInfo,
    canSaveActiveModeToLibrary,
    canSaveCurrentChain,
    isUploading,
    hasChanges,
    hasPendingPreviewCover,
    tagAssistEnabled,
    onTagAssistEnabledChange,
    activeGenerationMode,
    selectGenerationMode,
    onBack,
    markChange,
    handleReset,
    handleFork,
    handleSaveAll,
    handleImportImage,
    setShowImportPreset,
    setTaggerOpen,
    notify,
}) => {
    const importInputRef = useRef<HTMLInputElement>(null);
    const isPlayground = chainId === 'playground';

    return (
        <header className="chain-editor-header workspace-command-bar relative z-30 grid h-auto flex-shrink-0 grid-cols-1 items-center gap-1 overflow-visible border-b border-gray-200 bg-white px-2 py-1 dark:border-gray-800 dark:bg-gray-950 md:gap-2 md:px-6 lg:grid-cols-2 lg:gap-0 lg:py-0">
            <div className="chain-editor-header-main relative flex min-w-0 items-center gap-2 md:gap-4">
                <ChainEditorModeHeader
                    isLaboratory={isPlayground}
                    chainName={chainName}
                    entityLabel={isCharacterMode ? '角色串' : '风格串'}
                    isOwner={isOwner}
                    activeMode={activeGenerationMode}
                    onSelectMode={selectGenerationMode}
                    onEditInfo={() => setIsEditingInfo(true)}
                    onBack={onBack}
                />
                {!isPlayground && isEditingInfo && isOwner && <div role="dialog" aria-label={`编辑${isCharacterMode ? '角色串' : '风格串'}信息`} className="absolute left-12 top-[calc(100%+0.5rem)] z-50 w-[min(40rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-bold text-gray-500">名称<input type="text" value={chainName} onChange={e => { setChainName(e.target.value); markChange(); }} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white" placeholder="名称" /></label>
                        <label className="text-xs font-bold text-gray-500">描述<input type="text" value={chainDesc} onChange={e => { setChainDesc(e.target.value); markChange(); }} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300" placeholder="描述" /></label>
                    </div>
                    <div className="mt-3 text-xs font-bold text-gray-500">标签</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {chainTags.map((tag, idx) => (
                            <span key={idx} className="px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 flex items-center gap-1">
                                {tag}
                                {canEdit && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setChainTags(chainTags.filter((_, i) => i !== idx));
                                            markChange();
                                        }}
                                        className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                                    >
                                        ✕
                                    </button>
                                )}
                            </span>
                        ))}
                        {canEdit && <input
                            type="text"
                            placeholder="添加标签..."
                            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-full bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                    const newTag = e.currentTarget.value.trim();
                                    if (!chainTags.includes(newTag)) {
                                        setChainTags([...chainTags, newTag]);
                                        markChange();
                                    }
                                    e.currentTarget.value = '';
                                }
                            }}
                            onBlur={(e) => {
                                if (e.target.value.trim()) {
                                    const newTag = e.target.value.trim();
                                    if (!chainTags.includes(newTag)) {
                                        setChainTags([...chainTags, newTag]);
                                        markChange();
                                    }
                                    e.target.value = '';
                                }
                            }}
                        />}
                    </div>
                    <div className="mt-4 flex justify-end"><button type="button" onClick={() => setIsEditingInfo(false)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500">完成</button></div>
                </div>}
            </div>

            <div className="chain-editor-actions ml-auto flex w-full flex-shrink-0 items-center justify-end gap-2 overflow-x-auto lg:w-auto">
                {canEdit && (
                    <>
                        <input
                            type="file"
                            ref={importInputRef}
                            className="hidden"
                            accept="image/png,application/json,.json"
                            onChange={handleImportImage}
                        />
                        <button
                            type="button"
                            onClick={() => importInputRef.current?.click()}
                            className="mobile-touch flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 p-0 text-indigo-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 dark:border-gray-700 dark:bg-gray-800 dark:text-indigo-300 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/40"
                            title="导入图片或 JSON 配置"
                            aria-label="导入图片或 JSON 配置"
                        >
                            <FileDown className="h-[18px] w-[18px] md:h-5 md:w-5" />
                        </button>
                    </>
                )}
                {canEdit && (
                    <button
                        type="button"
                        onClick={() => setShowImportPreset(true)}
                        className="mobile-touch flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 p-0 text-indigo-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 dark:border-gray-700 dark:bg-gray-800 dark:text-indigo-300 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/40"
                        title="引用预设"
                        aria-label="引用预设"
                    >
                        <Quote className="h-[18px] w-[18px] md:h-5 md:w-5" />
                    </button>
                )}
                {canEdit && (
                    <button
                        type="button"
                        onClick={() => setTaggerOpen(true)}
                        className="mobile-touch flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 p-0 text-indigo-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 dark:border-gray-700 dark:bg-gray-800 dark:text-indigo-300 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/40"
                        title="图片反推 Tag"
                        aria-label="图片反推 Tag"
                    >
                        <ImagePlus className="h-[18px] w-[18px] md:h-5 md:w-5" />
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => {
                        const enabled = !tagAssistEnabled;
                        onTagAssistEnabledChange(enabled);
                        notify(`Tag 辅助已${enabled ? '开启' : '关闭'}`);
                    }}
                    aria-pressed={tagAssistEnabled}
                    className={`mobile-touch flex h-11 w-11 items-center justify-center rounded-xl border p-0 transition-colors ${tagAssistEnabled
                        ? 'border-indigo-200 bg-indigo-50 text-indigo-600 hover:border-indigo-300 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/60'
                        : 'border-gray-200 bg-gray-100 text-gray-500 hover:border-gray-300 hover:bg-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-700'}`}
                    title={tagAssistEnabled ? '关闭 Tag 辅助' : '开启 Tag 辅助'}
                    aria-label={tagAssistEnabled ? '关闭 Tag 辅助' : '开启 Tag 辅助'}
                >
                    <span className="relative block">
                        <Tags className="h-[18px] w-[18px] md:h-5 md:w-5" />
                        <span aria-hidden="true" className="absolute -bottom-1.5 -right-1.5 text-[9px] font-black leading-none">
                            {tagAssistEnabled ? 'o' : '−'}
                        </span>
                    </span>
                </button>
                {isPlayground && (
                    <button
                        type="button"
                        onClick={handleReset}
                        className="mobile-touch ml-1 flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 p-0 text-red-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-gray-700 dark:bg-gray-800 dark:text-red-400 dark:hover:border-red-900/60 dark:hover:bg-red-950/30"
                        title="重置实验室"
                        aria-label="重置实验室"
                    >
                        <RotateCcw className="h-[18px] w-[18px] md:h-5 md:w-5" />
                    </button>
                )}
                {/* Fork / Save to Library Button */}
                {canSaveActiveModeToLibrary && ((!isOwner && !isGuest) || isPlayground) && (
                    <button
                        onClick={handleFork}
                        disabled={isUploading}
                        className={`mobile-touch flex h-11 items-center justify-center rounded-xl border p-0 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isPlayground
                            ? 'w-11 border-emerald-200 bg-emerald-50 text-emerald-600 hover:border-emerald-300 hover:bg-emerald-100 hover:text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/35 dark:text-emerald-300 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/60'
                            : 'w-auto border-gray-200 bg-gray-100 px-4 text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 dark:border-gray-700 dark:bg-gray-800 dark:text-indigo-300 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/40'}`}
                        title={isPlayground ? '保存到库' : 'Fork'}
                        aria-label={isPlayground ? '保存到库' : 'Fork'}
                    >
                        <Save className={`block h-[18px] w-[18px] md:h-5 md:w-5 ${isPlayground ? '' : 'mr-1'}`} />
                        {!isPlayground && <span>Fork</span>}
                    </button>
                )}
                {canSaveActiveModeToLibrary && isOwner && !isPlayground && (
                    <button
                        type="button"
                        onClick={handleSaveAll}
                        disabled={!canSaveCurrentChain || isUploading}
                        className={`mobile-touch flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-bold transition-colors lg:w-11 lg:px-0 ${canSaveCurrentChain && !isUploading
                            ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20 hover:bg-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500'
                            : 'bg-gray-100 text-gray-400 dark:bg-gray-800'}`}
                        title={isUploading ? '正在保存' : hasPendingPreviewCover ? '保存并将当前图片设为封面' : hasChanges ? '保存修改' : '已保存'}
                        aria-label={isUploading ? '正在保存' : hasPendingPreviewCover ? '保存并将当前图片设为封面' : hasChanges ? '保存修改' : '已保存'}
                    >
                        <Save className="h-[18px] w-[18px] md:h-5 md:w-5" />
                        <span className="lg:hidden">{isUploading ? '保存中' : canSaveCurrentChain ? '保存' : '已保存'}</span>
                    </button>
                )}
            </div>
        </header>
    );
};
