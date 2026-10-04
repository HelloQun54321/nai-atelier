import React, { useLayoutEffect, useRef, useState } from 'react';
import { Copy, FileDown, ImagePlus, MoreHorizontal, Quote, RotateCcw, Save, Tags } from 'lucide-react';
import { GenerationMode } from '../../types';
import { ChainEditorModeHeader } from '../ChainEditorModeHeader';
import { IconButton } from '../DesignSystem';
import { MobileBottomSheet } from '../MobileUI';
import { AnchoredToolbarPopover, TOOLBAR_MENU_CLASS } from '../ToolbarPopover';
import { ImagePreviewPortal } from '../ImagePreviewPortal';

const ActionRow: React.FC<{
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
    const headerRef = useRef<HTMLElement>(null);
    const moreAnchorRef = useRef<HTMLDivElement>(null);
    const isPlayground = chainId === 'playground';
    const [actionsOpen, setActionsOpen] = useState(false);
    const closeActions = React.useCallback(() => setActionsOpen(false), []);
    const saveAnchorRef = useRef<HTMLDivElement>(null);
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
    const [compact, setCompact] = useState(() => window.innerWidth <= 1180);
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
    // Agent 改变的是工作区宽度；窄栏与手机共用动作，桌面仍使用锚定菜单。
    useLayoutEffect(() => {
        const header = headerRef.current;
        if (!header) return;
        let measuredWidth = header.getBoundingClientRect().width || window.innerWidth;
        let previousLayout: string | undefined;
        const update = (width: number) => {
            measuredWidth = width;
            const mobile = window.innerWidth < 768;
            const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
            const nextCompact = mobile || width <= 73.75 * fontSize;
            const layout = `${mobile}/${nextCompact}`;
            setIsMobile(mobile);
            setCompact(nextCompact);
            if (previousLayout !== undefined && previousLayout !== layout) {
                closeActions();
                closeSaveActions();
            }
            previousLayout = layout;
        };
        const measure = () => update(header.getBoundingClientRect().width || measuredWidth);
        measure();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
            update(header.getBoundingClientRect().width || entries[0]?.contentRect.width || measuredWidth);
        });
        observer?.observe(header);
        const themeObserver = new MutationObserver(measure);
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-font-scale', 'data-density', 'style'] });
        window.addEventListener('resize', measure);
        return () => { observer?.disconnect(); themeObserver.disconnect(); window.removeEventListener('resize', measure); };
    }, [closeActions, closeSaveActions]);
    // 切入编辑模式时关闭保存面板，不能从旧面板提交不完整的底图／蒙版配置。
    React.useEffect(() => { closeActions(); closeSaveActions(); }, [activeGenerationMode, closeActions, closeSaveActions]);

    return (
        <>
        <header ref={headerRef} className={`chain-editor-header workspace-command-bar relative z-30 h-auto flex-shrink-0 items-center overflow-visible border-b border-gray-200 bg-white px-2 py-1 dark:border-gray-800/80 dark:bg-gray-900/90 md:px-5 lg:py-0 grid ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <div className={`chain-editor-header-main relative flex min-w-0 items-center gap-2 md:gap-4 ${compact ? '' : 'pr-4'}`}>
                <ChainEditorModeHeader
                    isLaboratory={isPlayground}
                    entityLabel={isCharacterMode ? '自定义角色' : '风格串'}
                    activeMode={activeGenerationMode}
                    onSelectMode={selectGenerationMode}
                    isGenerating={isGenerating}
                    onBack={onBack}
                />
                {compact && !isPlayground && canSaveActiveModeToLibrary && isOwner && <div ref={saveAnchorRef} className="flex-none"><IconButton label={saveLabel} disabled={isUploading} aria-haspopup="dialog" aria-expanded={saveActionsOpen} onClick={() => setSaveActionsOpen(value => !value)} className={`mobile-touch ${saveClass}`}><Save /></IconButton></div>}
                {compact && !isPlayground && canSaveActiveModeToLibrary && !isOwner && !isGuest && <IconButton label="另存为新串" disabled={isUploading} onClick={handleFork} className="mobile-touch"><Save /></IconButton>}
                {compact && <div ref={moreAnchorRef} className="ml-auto flex-none"><IconButton
                    label="更多操作"
                    aria-haspopup="dialog"
                    aria-expanded={actionsOpen}
                    onClick={() => setActionsOpen(value => !value)}
                    className="mobile-touch"
                >
                    <MoreHorizontal className="h-5 w-5" />
                </IconButton></div>}
            </div>

            {!compact && <div className="chain-editor-actions flex flex-none items-center justify-end gap-2 ml-auto">
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
            </div>}
        </header>
        <input aria-label="导入 PNG 或 JSON 创作配置" type="file" ref={importInputRef} className="hidden" accept="image/png,application/json,.json" onChange={handleImportImage} />
        {saveActionsOpen && canSaveActiveModeToLibrary && isOwner && !isPlayground && <>
            {isMobile
                ? <ImagePreviewPortal><MobileBottomSheet open title={`保存${entityLabel}`} onClose={closeSaveActions}>{renderSaveOptions()}</MobileBottomSheet></ImagePreviewPortal>
                : <AnchoredToolbarPopover anchorRef={saveAnchorRef} title={`保存${entityLabel}`} width={280} onClose={closeSaveActions}>{renderSaveOptions()}</AnchoredToolbarPopover>}
        </>}
        {actionsOpen && (isMobile
            ? <ImagePreviewPortal><MobileBottomSheet open title="更多操作" onClose={closeActions}>{renderActions()}</MobileBottomSheet></ImagePreviewPortal>
            : <AnchoredToolbarPopover anchorRef={moreAnchorRef} title="更多操作" width={280} onClose={closeActions}>{renderActions()}</AnchoredToolbarPopover>)}
        </>
    );

    function renderActions() {
        return <div className="flex flex-col gap-1">
                {canEdit && <ActionRow icon={<FileDown className="h-4 w-4" />} label="导入图片或 JSON 配置" onClick={() => { closeActions(); importInputRef.current?.click(); }} />}
                {canEdit && <ActionRow icon={<Quote className="h-4 w-4" />} label="引用预设" onClick={() => { closeActions(); setShowImportPreset(true); }} />}
                {canEdit && <ActionRow icon={<ImagePlus className="h-4 w-4" />} label="图片反推 Tag" onClick={() => { closeActions(); setTaggerOpen(true); }} />}
                <ActionRow
                    icon={<Tags className="h-4 w-4" />}
                    label="Tag 辅助"
                    detail={tagAssistEnabled ? '已开启' : '已关闭'}
                    onClick={() => {
                        const enabled = !tagAssistEnabled;
                        onTagAssistEnabledChange(enabled);
                        notify(`Tag 辅助已${enabled ? '开启' : '关闭'}`);
                        closeActions();
                    }}
                />
                {canEdit && <ActionRow icon={<RotateCcw className="h-4 w-4" />} label="重置当前模式" tone="danger" onClick={() => { closeActions(); handleReset(); }} />}
                {canSaveActiveModeToLibrary && isPlayground && <ActionRow icon={<Save className="h-4 w-4" />} label="保存到库" tone="primary" disabled={isUploading} onClick={() => { closeActions(); handleFork(); }} />}
            </div>;
    }
};
