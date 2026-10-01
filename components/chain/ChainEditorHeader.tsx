import React, { useRef, useState } from 'react';
import { Copy, FileDown, ImagePlus, MoreHorizontal, Quote, RotateCcw, Save, Tags } from 'lucide-react';
import { GenerationMode } from '../../types';
import { ChainEditorModeHeader } from '../ChainEditorModeHeader';
import { IconButton } from '../DesignSystem';
import { MobileBottomSheet, MobileIconButton } from '../MobileUI';
import { AnchoredToolbarPopover, TOOLBAR_MENU_CLASS } from '../ToolbarPopover';
import { ImagePreviewPortal } from '../ImagePreviewPortal';

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
    isCharacterMode: boolean;
    isOwner: boolean;
    isGuest: boolean;
    canEdit: boolean;
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
    isCharacterMode,
    isOwner,
    isGuest,
    canEdit,
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
    const ActionLayer = isPlayground ? React.Fragment : ImagePreviewPortal;
    const saveAnchorRef = useRef<HTMLDivElement>(null);
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
    const [saveActionsOpen, setSaveActionsOpen] = useState(false);
    const closeSaveActions = React.useCallback(() => setSaveActionsOpen(false), []);
    const entityLabel = isCharacterMode ? '自定义角色' : '风格串';
    const saveLabel = isUploading ? '正在保存' : `保存${entityLabel}`;
    const saveDetail = hasPendingPreviewCover ? '保存并将当前图片设为封面' : hasChanges ? '保存修改' : '已保存';
    const saveClass = canSaveCurrentChain && !isUploading
        ? '!border-emerald-300 !bg-emerald-50 !text-emerald-600 hover:!bg-emerald-100 dark:!border-emerald-900/70 dark:!bg-emerald-950/35 dark:!text-emerald-300'
        : '';
    const renderSaveOptions = () => <div className="space-y-1">
        <button type="button" className={`${TOOLBAR_MENU_CLASS} disabled:cursor-not-allowed disabled:opacity-40`} disabled={!canSaveCurrentChain || isUploading} onClick={() => { closeSaveActions(); handleSaveAll(); }}><Save />{saveDetail}</button>
        <button type="button" className={`${TOOLBAR_MENU_CLASS} disabled:cursor-not-allowed disabled:opacity-40`} disabled={isUploading} onClick={() => { closeSaveActions(); handleFork(); }}><Copy />另存为新串</button>
    </div>;
    React.useEffect(() => {
        const onResize = () => { setIsMobile(window.innerWidth < 768); closeSaveActions(); };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [closeSaveActions]);
    // 切入编辑模式时关闭保存面板，不能从旧面板提交不完整的底图／蒙版配置。
    React.useEffect(() => { closeSaveActions(); }, [activeGenerationMode, closeSaveActions]);

    return (
        <>
        <header className="chain-editor-header workspace-command-bar relative z-30 h-auto flex-shrink-0 items-center overflow-visible border-b border-gray-200 bg-white px-2 py-1 dark:border-gray-800/80 dark:bg-gray-900/90 md:px-5 lg:py-0 grid grid-cols-1 gap-1 lg:grid-cols-2 lg:gap-0">
            <div className="chain-editor-header-main relative flex min-w-0 items-start lg:items-center gap-2 md:gap-4 lg:pr-4">
                <ChainEditorModeHeader
                    isLaboratory={isPlayground}
                    entityLabel={isCharacterMode ? '自定义角色' : '风格串'}
                    activeMode={activeGenerationMode}
                    onSelectMode={selectGenerationMode}
                    isGenerating={isGenerating}
                    onBack={onBack}
                />
                {!isPlayground && canSaveActiveModeToLibrary && isOwner && <IconButton label={saveLabel} disabled={isUploading} onClick={() => setSaveActionsOpen(true)} className={`mobile-touch md:hidden ${saveClass}`}><Save /></IconButton>}
                {!isPlayground && canSaveActiveModeToLibrary && !isOwner && !isGuest && <IconButton label="另存为新串" disabled={isUploading} onClick={handleFork} className="mobile-touch md:hidden"><Save /></IconButton>}
                <MobileIconButton
                    label="更多操作"
                    onClick={() => setMobileActionsOpen(true)}
                    className="ml-auto flex-none text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 md:hidden"
                >
                    <MoreHorizontal className="h-5 w-5" />
                </MobileIconButton>
            </div>

            <div className="chain-editor-actions hidden md:flex flex-none items-center gap-2 overflow-x-auto md:ml-auto md:justify-end">
                {canEdit && <>
                    <IconButton label="导入图片或 JSON 配置" onClick={() => importInputRef.current?.click()}><FileDown /></IconButton>
                    <IconButton label="引用预设" onClick={() => setShowImportPreset(true)}><Quote /></IconButton>
                    <IconButton label="图片反推 Tag" onClick={() => setTaggerOpen(true)}><ImagePlus /></IconButton>
                </>}
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
                    <span className="relative block"><Tags /><span aria-hidden="true" className="absolute -bottom-1.5 -right-1.5 text-mini font-black leading-none">{tagAssistEnabled ? 'o' : '−'}</span></span>
                </IconButton>
                {canEdit && <IconButton label="重置当前模式" tone="danger" onClick={handleReset}><RotateCcw /></IconButton>}
                {canSaveActiveModeToLibrary && (isPlayground || (!isOwner && !isGuest)) && <IconButton label={isPlayground ? '保存到库' : '另存为新串'} disabled={isUploading} onClick={handleFork} className="!border-emerald-300 !bg-emerald-50 !text-emerald-600 hover:!bg-emerald-100 dark:!border-emerald-900/70 dark:!bg-emerald-950/35 dark:!text-emerald-300"><Save /></IconButton>}
                {canSaveActiveModeToLibrary && isOwner && !isPlayground && <div ref={saveAnchorRef} className="flex-none">
                    <IconButton label={saveLabel} title={saveDetail} disabled={isUploading} aria-haspopup="dialog" aria-expanded={saveActionsOpen} onClick={() => setSaveActionsOpen(value => !value)} className={saveClass}><Save /></IconButton>
                </div>}
            </div>
        </header>
        <input type="file" ref={importInputRef} className="hidden" accept="image/png,application/json,.json" onChange={handleImportImage} />
        {saveActionsOpen && canSaveActiveModeToLibrary && isOwner && !isPlayground && <>
            {isMobile
                ? <ActionLayer><MobileBottomSheet open title={`保存${entityLabel}`} onClose={closeSaveActions}>{renderSaveOptions()}</MobileBottomSheet></ActionLayer>
                : <AnchoredToolbarPopover anchorRef={saveAnchorRef} title={`保存${entityLabel}`} width={280} onClose={closeSaveActions}>{renderSaveOptions()}</AnchoredToolbarPopover>}
        </>}
        <ActionLayer><MobileBottomSheet open={mobileActionsOpen} title="更多操作" onClose={closeMobileActions}>
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
                {canEdit && <MobileActionRow icon={<RotateCcw className="h-4 w-4" />} label="重置当前模式" tone="danger" onClick={() => { closeMobileActions(); handleReset(); }} />}
                {canSaveActiveModeToLibrary && isPlayground && <MobileActionRow icon={<Save className="h-4 w-4" />} label="保存到库" tone="primary" disabled={isUploading} onClick={() => { closeMobileActions(); handleFork(); }} />}
            </div>
        </MobileBottomSheet></ActionLayer>
        </>
    );
};
