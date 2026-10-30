import { t, useLanguage } from '../../services/i18n';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Copy, FileDown, Languages, ListTree, LoaderCircle, MoreHorizontal, RotateCcw, Save, Tags } from 'lucide-react';
import { GenerationMode } from '../../types';
import { ChainEditorModeHeader } from '../ChainEditorModeHeader';
import { IconButton, ToolbarActionRow as ActionRow } from '../DesignSystem';
import type { PromptToolbarSlot } from '../PromptLibraryAccess';
import { MobileBottomSheet } from '../MobileUI';
import { AnchoredToolbarPopover, TOOLBAR_MENU_CLASS } from '../ToolbarPopover';
import { ImagePreviewPortal } from '../ImagePreviewPortal';

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
    onPromptToolbarSlotChange?: (slot: PromptToolbarSlot | null) => void;
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
    onTranslateMissingPrompts: () => void;
    translationPending?: boolean;
    notify: (msg: string, type?: 'success' | 'error') => void;
    sectionedPrompt?: boolean;
    onSectionedPromptChange?: (enabled: boolean) => void;
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
    onPromptToolbarSlotChange,
    onTagAssistEnabledChange,
    activeGenerationMode,
    selectGenerationMode,
    isGenerating = false,
    onBack,
    handleReset,
    handleFork,
    handleSaveAll,
    handleImportImage,
    onTranslateMissingPrompts,
    translationPending = false,
    notify,
    sectionedPrompt = false,
    onSectionedPromptChange,
}) => {
  useLanguage();
    const importInputRef = useRef<HTMLInputElement>(null);
    const headerRef = useRef<HTMLElement>(null);
    const moreAnchorRef = useRef<HTMLDivElement>(null);
    const isPlayground = chainId === 'playground';
    const [actionsOpen, setActionsOpen] = useState(false);
    const closeActions = React.useCallback(() => setActionsOpen(false), []);
    const saveAnchorRef = useRef<HTMLDivElement>(null);
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
    const [compact, setCompact] = useState(() => window.innerWidth < 1024);
    const setPromptToolbarSlot = React.useCallback((element: HTMLDivElement | null) => {
        onPromptToolbarSlotChange?.(element ? { element, variant: compact ? 'menu' : 'icon' } : null);
    }, [compact, onPromptToolbarSlotChange]);
    const [saveActionsOpen, setSaveActionsOpen] = useState(false);
    const closeSaveActions = React.useCallback(() => setSaveActionsOpen(false), []);
    const entityLabel = isCharacterMode ? '自定义角色' : '风格串';
    const saveLabel = isUploading ? '正在保存' : `保存${entityLabel}`;
    const forkLabel = isCharacterMode ? t("另存为新角色") : t("另存为新串");
    const saveDetail = hasPendingPreviewCover ? '保存并将当前图片设为封面' : hasChanges ? '保存修改' : '已保存';
    const saveClass = canSaveCurrentChain && !isUploading
        ? '!border-emerald-300 !bg-emerald-50 !text-emerald-700 hover:!bg-emerald-100 dark:!border-emerald-900/70 dark:!bg-emerald-950/35 dark:!text-emerald-300'
        : '';
    const renderSaveOptions = () => <div className="space-y-1">
        <button type="button" className={`${TOOLBAR_MENU_CLASS} disabled:cursor-not-allowed disabled:opacity-40`} disabled={!canSaveCurrentChain || isUploading} onClick={() => { closeSaveActions(); handleSaveAll(); }}><Save />{saveDetail}</button>
        <button type="button" className={`${TOOLBAR_MENU_CLASS} disabled:cursor-not-allowed disabled:opacity-40`} disabled={isUploading} onClick={() => { closeSaveActions(); handleFork(); }}><Copy />{forkLabel}</button>
    </div>;
    // 顶栏与编辑／预览共用 Layout 的分栏状态，不能单独提前展开成整行。
    useLayoutEffect(() => {
        const header = headerRef.current;
        if (!header) return;
        const workspace = header.closest('.workspace-container');
        let previousLayout: string | undefined;
        const measure = () => {
            const mobile = window.innerWidth < 768;
            const nextCompact = window.innerWidth < 1024 || Boolean(workspace?.classList.contains('workspace-editor-compact'));
            const layout = `${mobile}/${nextCompact}`;
            setIsMobile(mobile);
            setCompact(nextCompact);
            if (previousLayout !== undefined && previousLayout !== layout) {
                closeActions();
                closeSaveActions();
            }
            previousLayout = layout;
        };
        measure();
        const observer = new MutationObserver(measure);
        if (workspace) observer.observe(workspace, { attributes: true, attributeFilter: ['class'] });
        window.addEventListener('resize', measure);
        return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
    }, [closeActions, closeSaveActions]);
    // 切入编辑模式时关闭保存面板，不能从旧面板提交不完整的底图／蒙版配置。
    React.useEffect(() => { closeActions(); closeSaveActions(); }, [activeGenerationMode, closeActions, closeSaveActions]);

    return (
        <>
        <header ref={headerRef} className={`chain-editor-header workspace-command-bar relative z-30 h-auto flex-shrink-0 items-center overflow-visible border-b border-gray-200 bg-white px-2 py-1 dark:border-gray-800/80 dark:bg-gray-900/90 md:px-5 lg:py-0 grid ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <div aria-hidden="true" className="lab-navigation-surface workspace-command-bar" />
            <div className={`chain-editor-header-main relative flex min-w-0 items-center gap-2 md:gap-4 ${compact ? '' : 'pr-4'}`}>
                <ChainEditorModeHeader
                    isLaboratory={isPlayground}
                    entityLabel={isCharacterMode ? '自定义角色' : '风格串'}
                    activeMode={activeGenerationMode}
                    onSelectMode={selectGenerationMode}
                    isGenerating={isGenerating}
                    onBack={onBack}
                />
                {compact && !isPlayground && canSaveActiveModeToLibrary && isOwner && <div ref={saveAnchorRef} className="flex-none"><IconButton label={t(saveLabel)} disabled={isUploading} aria-haspopup="dialog" aria-expanded={saveActionsOpen} onClick={() => setSaveActionsOpen(value => !value)} className={`mobile-touch ${saveClass}`}><Save /></IconButton></div>}
                {compact && !isPlayground && canSaveActiveModeToLibrary && !isOwner && !isGuest && <IconButton label={forkLabel} disabled={isUploading} onClick={handleFork} className="mobile-touch"><Save /></IconButton>}
                {compact && <div ref={moreAnchorRef} className="ml-auto flex-none"><IconButton
                    label={t("更多操作")}
                    aria-haspopup="dialog"
                    aria-expanded={actionsOpen}
                    onClick={() => setActionsOpen(value => !value)}
                    className="mobile-touch"
                >
                    <MoreHorizontal className="h-5 w-5" />
                </IconButton></div>}
            </div>

            {!compact && <div className="chain-editor-actions flex flex-none items-center justify-end gap-2 ml-auto">
                {renderPromptTools()}
                {canEdit && <>
                    <IconButton label={t("导入图片或 JSON 配置")} onClick={() => importInputRef.current?.click()}><FileDown /></IconButton>
                    <IconButton label={t(translationPending ? "正在翻译提示词" : "翻译所有未翻译提示词")} title={t("使用当前助手模型翻译当前模式所有提示词框里的未翻译 Tag，可能产生模型调用费用")} disabled={translationPending} onClick={onTranslateMissingPrompts}>{translationPending ? <LoaderCircle className="animate-spin" /> : <Languages />}</IconButton>
                </>}
                {onSectionedPromptChange && <IconButton label={t(sectionedPrompt ? '切换为整段编辑' : '切换为分类编辑')} aria-pressed={sectionedPrompt === true} onClick={() => onSectionedPromptChange(!sectionedPrompt)} className={sectionedPrompt ? '!border-indigo-300 !bg-indigo-50 !text-indigo-600 dark:!border-indigo-800 dark:!bg-indigo-950/40 dark:!text-indigo-300' : ''}><ListTree /></IconButton>}
                <IconButton
                    label={tagAssistEnabled ? t("关闭 Tag 辅助") : t("开启 Tag 辅助")}
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
                {canEdit && <IconButton label={t("重置当前模式")} tone="danger" onClick={handleReset}><RotateCcw /></IconButton>}
                {canSaveActiveModeToLibrary && (isPlayground || (!isOwner && !isGuest)) && <IconButton label={isPlayground ? t("保存到库") : forkLabel} disabled={isUploading} onClick={handleFork} className="!border-emerald-300 !bg-emerald-50 !text-emerald-700 hover:!bg-emerald-100 dark:!border-emerald-900/70 dark:!bg-emerald-950/35 dark:!text-emerald-300"><Save /></IconButton>}
                {canSaveActiveModeToLibrary && isOwner && !isPlayground && <div ref={saveAnchorRef} className="flex-none">
                    <IconButton label={t(saveLabel)} title={saveDetail} disabled={isUploading} aria-haspopup="dialog" aria-expanded={saveActionsOpen} onClick={() => setSaveActionsOpen(value => !value)} className={saveClass}><Save /></IconButton>
                </div>}
            </div>}
        </header>
        <input aria-label={t("导入 PNG 或 JSON 创作配置")} type="file" ref={importInputRef} className="hidden" accept="image/png,application/json,.json" onChange={handleImportImage} />
        {saveActionsOpen && canSaveActiveModeToLibrary && isOwner && !isPlayground && <>
            {isMobile
                ? <ImagePreviewPortal><MobileBottomSheet open title={t("保存{0}", [entityLabel])} onClose={closeSaveActions}>{renderSaveOptions()}</MobileBottomSheet></ImagePreviewPortal>
                : <AnchoredToolbarPopover anchorRef={saveAnchorRef} title={t("保存{0}", [entityLabel])} width={280} onClose={closeSaveActions}>{renderSaveOptions()}</AnchoredToolbarPopover>}
        </>}
        {actionsOpen && (isMobile
            ? <ImagePreviewPortal><MobileBottomSheet open title={t("更多操作")} onClose={closeActions}>{renderActions()}</MobileBottomSheet></ImagePreviewPortal>
            : <AnchoredToolbarPopover anchorRef={moreAnchorRef} title={t("更多操作")} width={280} onClose={closeActions}>{renderActions()}</AnchoredToolbarPopover>)}
        </>
    );

    function renderActions() {
        return <div className="flex flex-col gap-1">
                {renderPromptTools()}
                {canEdit && <ActionRow icon={<FileDown className="h-4 w-4" />} label={t("导入图片或 JSON 配置")} onClick={() => { closeActions(); importInputRef.current?.click(); }} />}
                {canEdit && <ActionRow icon={translationPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />} label={t(translationPending ? "正在翻译提示词" : "翻译所有未翻译提示词")} detail={translationPending ? t("翻译中") : undefined} disabled={translationPending} onClick={() => { closeActions(); onTranslateMissingPrompts(); }} />}
                {onSectionedPromptChange && <ActionRow icon={<ListTree className="h-4 w-4" />} label={t(sectionedPrompt ? '切换为整段编辑' : '切换为分类编辑')} detail={t(sectionedPrompt ? '分类' : '整段')} onClick={() => { onSectionedPromptChange(!sectionedPrompt); closeActions(); }} />}
                <ActionRow
                    icon={<Tags className="h-4 w-4" />}
                    label={t("Tag 辅助")}
                    detail={tagAssistEnabled ? t("已开启") : t("已关闭")}
                    onClick={() => {
                        const enabled = !tagAssistEnabled;
                        onTagAssistEnabledChange(enabled);
                        notify(`Tag 辅助已${enabled ? '开启' : '关闭'}`);
                        closeActions();
                    }}
                />
                {canEdit && <ActionRow icon={<RotateCcw className="h-4 w-4" />} label={t("重置当前模式")} tone="danger" onClick={() => { closeActions(); handleReset(); }} />}
                {canSaveActiveModeToLibrary && isPlayground && <ActionRow icon={<Save className="h-4 w-4" />} label={t("保存到库")} tone="primary" disabled={isUploading} onClick={() => { closeActions(); handleFork(); }} />}
            </div>;
    }

    function renderPromptTools() {
        return <div ref={setPromptToolbarSlot} className={compact ? "flex flex-col gap-1" : "flex items-center gap-2"} />;
    }

};
