import React, { useRef, useState } from 'react';
import { FileDown, ImagePlus, MoreHorizontal, Quote, RotateCcw, Save, Tags } from 'lucide-react';
import { GenerationMode } from '../../types';
import { ChainEditorModeHeader } from '../ChainEditorModeHeader';
import { IconButton, ToolbarButton, WorkspaceToolbar } from '../DesignSystem';
import { MobileBottomSheet, MobileIconButton } from '../MobileUI';

const MobileActionRow: React.FC<{
    icon: React.ReactNode;
    label: string;
    detail?: string;
    tone?: 'default' | 'danger' | 'primary';
    disabled?: boolean;
    onClick: () => void;
}> = ({ icon, label, detail, tone = 'default', disabled = false, onClick }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`mobile-touch flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
            tone === 'danger'
                ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30'
                : tone === 'primary'
                    ? 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
        }`}
    >
        <span className="flex-none">{icon}</span>
        <span className="min-w-0 flex-1">{label}</span>
        {detail && <span className="flex-none text-xs font-normal text-gray-400">{detail}</span>}
    </button>
);

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
    /** 生成进行中禁用模式切换（透传至模式导航）。 */
    isGenerating?: boolean;
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
    isGenerating = false,
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
    const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
    const closeMobileActions = () => setMobileActionsOpen(false);

    return (
        <>
        <header className="chain-editor-header workspace-command-bar relative z-30 grid h-auto flex-shrink-0 grid-cols-1 items-center gap-1 overflow-visible border-b border-gray-200 bg-white px-2 py-1 dark:border-gray-800/80 dark:bg-gray-900/90 md:px-5 lg:grid-cols-2 lg:gap-0 lg:py-0">
            <div className="chain-editor-header-main relative flex min-w-0 items-center gap-2 md:gap-4 lg:pr-4">
                <ChainEditorModeHeader
                    isLaboratory={isPlayground}
                    chainName={chainName}
                    entityLabel={isCharacterMode ? '角色串' : '风格串'}
                    isOwner={isOwner}
                    activeMode={activeGenerationMode}
                    onSelectMode={selectGenerationMode}
                    isGenerating={isGenerating}
                    onEditInfo={() => setIsEditingInfo(true)}
                    onBack={onBack}
                />
                {!isPlayground && isEditingInfo && isOwner && <div role="dialog" aria-label={`编辑${isCharacterMode ? '角色串' : '风格串'}信息`} className="absolute left-12 top-[calc(100%+0.5rem)] z-50 w-[min(40rem,calc(100vw-2rem))] rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-bold text-gray-500">名称<input type="text" value={chainName} onChange={e => { setChainName(e.target.value); markChange(); }} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-indigo-500 dark:border-gray-800 dark:bg-gray-800 dark:text-white" placeholder="名称" /></label>
                        <label className="text-xs font-bold text-gray-500">描述<input type="text" value={chainDesc} onChange={e => { setChainDesc(e.target.value); markChange(); }} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300" placeholder="描述" /></label>
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
                <MobileIconButton
                    label="更多操作"
                    onClick={() => setMobileActionsOpen(true)}
                    className="ml-auto flex-none text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 md:hidden"
                >
                    <MoreHorizontal className="h-5 w-5" />
                </MobileIconButton>
            </div>

            <div className="chain-editor-actions hidden md:flex flex-none items-center gap-2 overflow-x-auto md:ml-auto md:justify-end">
                {canEdit && (
                    <>
                        <input
                            type="file"
                            ref={importInputRef}
                            className="hidden"
                            accept="image/png,application/json,.json"
                            onChange={handleImportImage}
                        />
                        <IconButton
                            label="导入图片或 JSON 配置"
                            onClick={() => importInputRef.current?.click()}
                        >
                            <FileDown className="h-4 w-4" />
                        </IconButton>
                    </>
                )}
                {canEdit && (
                    <IconButton
                        label="引用预设"
                        onClick={() => setShowImportPreset(true)}
                    >
                        <Quote className="h-4 w-4" />
                    </IconButton>
                )}
                {canEdit && (
                    <IconButton
                        label="图片反推 Tag"
                        onClick={() => setTaggerOpen(true)}
                    >
                        <ImagePlus className="h-4 w-4" />
                    </IconButton>
                )}
                <IconButton
                    label={tagAssistEnabled ? '关闭 Tag 辅助' : '开启 Tag 辅助'}
                    aria-pressed={tagAssistEnabled}
                    onClick={() => {
                        const enabled = !tagAssistEnabled;
                        onTagAssistEnabledChange(enabled);
                        notify(`Tag 辅助已${enabled ? '开启' : '关闭'}`);
                    }}
                    className={tagAssistEnabled ? '!border-indigo-300 !bg-indigo-50 !text-indigo-600 dark:!border-indigo-800 dark:!bg-indigo-950/40 dark:!text-indigo-300' : ''}
                >
                    <span className="relative block">
                        <Tags className="h-4 w-4" />
                        <span aria-hidden="true" className="absolute -bottom-1.5 -right-1.5 text-[9px] font-black leading-none">
                            {tagAssistEnabled ? 'o' : '−'}
                        </span>
                    </span>
                </IconButton>
                {isPlayground && (
                    <IconButton
                        label="重置实验室"
                        tone="danger"
                        onClick={handleReset}
                    >
                        <RotateCcw className="h-4 w-4" />
                    </IconButton>
                )}
                {/* Fork / Save to Library Button */}
                {canSaveActiveModeToLibrary && ((!isOwner && !isGuest) || isPlayground) && (
                    isPlayground ? (
                        <IconButton
                            label="保存到库"
                            disabled={isUploading}
                            onClick={handleFork}
                            className="!border-emerald-300 !bg-emerald-50 !text-emerald-600 hover:!bg-emerald-100 dark:!border-emerald-900/70 dark:!bg-emerald-950/35 dark:!text-emerald-300"
                        >
                            <Save className="h-4 w-4" />
                        </IconButton>
                    ) : (
                        <ToolbarButton
                            disabled={isUploading}
                            onClick={handleFork}
                        >
                            <Save className="h-4 w-4" />
                            <span>复制为新串</span>
                        </ToolbarButton>
                    )
                )}
                {canSaveActiveModeToLibrary && isOwner && !isPlayground && (
                    <ToolbarButton
                        tone="primary"
                        onClick={handleSaveAll}
                        disabled={!canSaveCurrentChain || isUploading}
                        className={canSaveCurrentChain && !isUploading
                            ? '!border-emerald-600 !bg-emerald-600 !text-white hover:!bg-emerald-500 shadow-sm shadow-emerald-600/20'
                            : ''}
                        title={isUploading ? '正在保存' : hasPendingPreviewCover ? '保存并将当前图片设为封面' : hasChanges ? '保存修改' : '已保存'}
                        aria-label={isUploading ? '正在保存' : hasPendingPreviewCover ? '保存并将当前图片设为封面' : hasChanges ? '保存修改' : '已保存'}
                    >
                        <Save className="h-4 w-4" />
                        <span className="hidden sm:inline">{isUploading ? '保存中' : canSaveCurrentChain ? '保存修改' : '已保存'}</span>
                    </ToolbarButton>
                )}
            </div>
        </header>
        <MobileBottomSheet open={mobileActionsOpen} title="更多操作" onClose={closeMobileActions}>
            <div className="flex flex-col gap-1">
                {canEdit && <MobileActionRow icon={<FileDown className="h-4 w-4" />} label="导入图片或 JSON 配置" onClick={() => { closeMobileActions(); importInputRef.current?.click(); }} />}
                {canEdit && <MobileActionRow icon={<Quote className="h-4 w-4" />} label="引用预设" onClick={() => { closeMobileActions(); setShowImportPreset(true); }} />}
                {canEdit && <MobileActionRow icon={<ImagePlus className="h-4 w-4" />} label="图片反推 Tag" onClick={() => { closeMobileActions(); setTaggerOpen(true); }} />}
                <MobileActionRow
                    icon={<Tags className="h-4 w-4" />}
                    label="Tag 辅助"
                    detail={tagAssistEnabled ? '已开启' : '已关闭'}
                    onClick={() => {
                        const enabled = !tagAssistEnabled;
                        onTagAssistEnabledChange(enabled);
                        notify(`Tag 辅助已${enabled ? '开启' : '关闭'}`);
                        closeMobileActions();
                    }}
                />
                {isPlayground && <MobileActionRow icon={<RotateCcw className="h-4 w-4" />} label="重置实验室" tone="danger" onClick={() => { closeMobileActions(); handleReset(); }} />}
                {canSaveActiveModeToLibrary && isPlayground && <MobileActionRow icon={<Save className="h-4 w-4" />} label="保存到库" tone="primary" disabled={isUploading} onClick={() => { closeMobileActions(); handleFork(); }} />}
                {canSaveActiveModeToLibrary && !isPlayground && isOwner && <MobileActionRow icon={<Save className="h-4 w-4" />} label={isUploading ? '保存中' : canSaveCurrentChain ? '保存修改' : '已保存'} tone="primary" disabled={!canSaveCurrentChain || isUploading} onClick={() => { closeMobileActions(); handleSaveAll(); }} />}
                {canSaveActiveModeToLibrary && !isPlayground && !isOwner && !isGuest && <MobileActionRow icon={<Save className="h-4 w-4" />} label="复制为新串" tone="primary" disabled={isUploading} onClick={() => { closeMobileActions(); handleFork(); }} />}
            </div>
        </MobileBottomSheet>
        </>
    );
};
