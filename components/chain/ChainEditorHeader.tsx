import { t, useLanguage } from '../../services/i18n';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { ClipboardPaste, Copy, Download, FolderOpen, ImagePlus, Languages, ListTree, LoaderCircle, MoreVertical, RotateCcw, Save, Tags } from 'lucide-react';
import { GenerationMode } from '../../types';
import { ChainEditorModeHeader } from '../ChainEditorModeHeader';
import { IconButton, ToolbarActionRow as ActionRow, ToolbarDivider } from '../DesignSystem';
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
    onOpenComic?: () => void;
    handleReset: () => void;
    handleFork: () => void;
    handleSaveAll: () => void;
    handleImportImage: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onImportFromClipboard?: () => Promise<boolean> | boolean | void;
    onImportText?: (text: string) => Promise<boolean> | boolean | void;
    /** 编辑三模式的反推入口：对当前底图或结果图跑本地模型，结果追加到当前模式正面提示词。 */
    onReverseTag?: () => void;
    onTranslateMissingPrompts: () => void;
    translationPending?: boolean;
    notify: (msg: string, type?: 'success' | 'error') => void;
    sectionedPrompt?: boolean;
    onSectionedPromptChange?: (enabled: boolean) => void;
}

const GENERATION_MODE_LABELS: Record<GenerationMode, string> = {
    'text-to-image': '文生图',
    'image-to-image': '图生图',
    inpaint: '局部重绘',
    outpaint: '扩图',
};

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
    onOpenComic,
    handleReset,
    handleFork,
    handleSaveAll,
    handleImportImage,
    onImportFromClipboard,
    onImportText,
    onReverseTag,
    onTranslateMissingPrompts,
    translationPending = false,
    notify,
    sectionedPrompt = false,
    onSectionedPromptChange,
}) => {
  useLanguage();
    const importInputRef = useRef<HTMLInputElement>(null);
    const importAnchorRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLElement>(null);
    const moreAnchorRef = useRef<HTMLDivElement>(null);
    const isPlayground = chainId === 'playground';
    const [actionsOpen, setActionsOpen] = useState(false);
    const closeActions = React.useCallback(() => setActionsOpen(false), []);
    const [importOpen, setImportOpen] = useState(false);
    const closeImport = React.useCallback(() => setImportOpen(false), []);
    const [importText, setImportText] = useState('');
    const [importingClipboard, setImportingClipboard] = useState(false);
    const [importingText, setImportingText] = useState(false);
    const saveAnchorRef = useRef<HTMLDivElement>(null);
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
    const [compact, setCompact] = useState(() => window.innerWidth < 1024);
    const promptSlotCleanupRef = useRef<(() => void) | null>(null);
    const setPromptToolbarSlot = React.useCallback((element: HTMLDivElement | null) => {
        promptSlotCleanupRef.current?.();
        promptSlotCleanupRef.current = null;
        if (element) {
            const handleSlotClick = (event: MouseEvent) => {
                const button = (event.target as Element | null)?.closest('button');
                if (button && !button.hasAttribute('disabled')) {
                    // 等待 React 在根节点派发完 Portal 子按钮的 onClick 后再关闭更多菜单。
                    window.setTimeout(() => closeActions(), 0);
                }
            };
            element.addEventListener('click', handleSlotClick);
            promptSlotCleanupRef.current = () => element.removeEventListener('click', handleSlotClick);
        }
        onPromptToolbarSlotChange?.(element ? { element, variant: 'menu' } : null);
    }, [closeActions, onPromptToolbarSlotChange]);
    const [saveActionsOpen, setSaveActionsOpen] = useState(false);
    const closeSaveActions = React.useCallback(() => setSaveActionsOpen(false), []);
    const entityLabel = isCharacterMode ? '自定义角色' : '风格串';
    const activeModeLabel = t(GENERATION_MODE_LABELS[activeGenerationMode]);
    const saveLabel = isUploading ? '正在保存' : `保存${entityLabel}`;
    const forkLabel = isCharacterMode ? t("另存为新角色") : t("另存为新串");
    const saveDetail = hasPendingPreviewCover ? '保存并将当前图片设为封面' : hasChanges ? '保存修改' : '已保存';
    const ownerSaveTone = canSaveCurrentChain && !isUploading ? 'save' : 'neutral';
    const forkSaveTone = (!isPlayground || canSaveCurrentChain) && !isUploading ? 'save' : 'neutral';
    const handleClipboardImport = async () => {
        if (!onImportFromClipboard || importingClipboard) return;
        setImportingClipboard(true);
        try {
            const applied = await onImportFromClipboard();
            if (applied !== false) closeImport();
        } finally {
            setImportingClipboard(false);
        }
    };
    const handleTextImportSubmit = async () => {
        if (!onImportText || importingText || !importText.trim()) return;
        setImportingText(true);
        try {
            const applied = await onImportText(importText);
            if (applied !== false) {
                setImportText('');
                closeImport();
            }
        } finally {
            setImportingText(false);
        }
    };
    const renderSaveOptions = () => <div className="space-y-1">
        <button type="button" className={`${TOOLBAR_MENU_CLASS} disabled:cursor-not-allowed disabled:opacity-40`} disabled={!canSaveCurrentChain || isUploading} onClick={() => { closeSaveActions(); handleSaveAll(); }}><Save />{saveDetail}</button>
        <button type="button" className={`${TOOLBAR_MENU_CLASS} disabled:cursor-not-allowed disabled:opacity-40`} disabled={isUploading} onClick={() => { closeSaveActions(); handleFork(); }}><Copy />{forkLabel}</button>
    </div>;
    const renderImportOptions = () => <div data-import-metadata-popover="true" className="flex flex-col gap-1.5">
        <ActionRow
            icon={<FolderOpen className="h-4 w-4" />}
            label={t("选择文件")}
            detail="PNG / WebP / JSON"
            onClick={() => {
                closeImport();
                importInputRef.current?.click();
            }}
        />
        {onImportFromClipboard && <ActionRow
            icon={<ClipboardPaste className="h-4 w-4" />}
            label={t("从剪贴板导入")}
            detail={importingClipboard ? t("读取中…") : t("图片 / JSON")}
            disabled={importingClipboard}
            onClick={() => { void handleClipboardImport(); }}
        />}
        {onImportText && <>
            <div className="my-0.5 border-t border-gray-200/70 dark:border-gray-700/70" />
            <div className="flex flex-col gap-1.5 px-1 pt-0.5">
                <textarea
                    rows={3}
                    value={importText}
                    onChange={event => setImportText(event.target.value)}
                    placeholder={t("粘贴 JSON 配置文本…")}
                    aria-label={t("粘贴 JSON 配置文本")}
                    className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 outline-none placeholder:text-gray-400 focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                />
                <button
                    type="button"
                    disabled={!importText.trim() || importingText}
                    onClick={() => { void handleTextImportSubmit(); }}
                    className="mobile-touch inline-flex h-8 w-full items-center justify-center rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                    {importingText ? t("解析中…") : t("解析并导入")}
                </button>
            </div>
        </>}
        <p className="px-2 pt-0.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
            {activeGenerationMode === 'text-to-image'
                ? t("支持拖入文件，或在页面空白处直接 Ctrl+V 导入")
                : t("此弹窗打开时可直接 Ctrl+V 导入参数（页面粘贴仍为底图）")}
        </p>
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
                closeImport();
            }
            previousLayout = layout;
        };
        measure();
        const observer = new MutationObserver(measure);
        if (workspace) observer.observe(workspace, { attributes: true, attributeFilter: ['class'] });
        window.addEventListener('resize', measure);
        return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
    }, [closeActions, closeImport, closeSaveActions]);
    // 切入编辑模式时关闭保存与导入面板，不能从旧面板提交不完整的底图／蒙版配置。
    React.useEffect(() => { closeActions(); closeSaveActions(); closeImport(); }, [activeGenerationMode, closeActions, closeImport, closeSaveActions]);

    return (
        <>
        <header ref={headerRef} className={`chain-editor-header workspace-command-bar workspace-page-heading relative z-30 h-auto flex-shrink-0 items-center overflow-visible border-b border-gray-200 bg-white px-2 py-1 dark:border-gray-800/80 dark:bg-gray-900/90 md:px-5 lg:py-0 grid ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <div aria-hidden="true" className="lab-navigation-surface workspace-command-bar" />
            <div className={`chain-editor-header-main relative flex min-w-0 items-center gap-2 md:gap-4 ${compact ? '' : 'pr-4'}`}>
                <ChainEditorModeHeader
                    isLaboratory={isPlayground}
                    entityLabel={isCharacterMode ? '自定义角色' : '风格串'}
                    activeMode={activeGenerationMode}
                    onSelectMode={selectGenerationMode}
                    isGenerating={isGenerating}
                    onBack={onBack}
                    onOpenComic={onOpenComic}
                />
                {compact && !isPlayground && canSaveActiveModeToLibrary && isOwner && <div ref={saveAnchorRef} className="flex-none"><IconButton label={t(saveLabel)} tone={ownerSaveTone} disabled={isUploading} aria-haspopup="dialog" aria-expanded={saveActionsOpen} onClick={() => { closeActions(); closeImport(); setSaveActionsOpen(value => !value); }} className="mobile-touch"><Save /></IconButton></div>}
                {compact && !isPlayground && canSaveActiveModeToLibrary && !isOwner && !isGuest && <IconButton label={forkLabel} tone="save" disabled={isUploading} onClick={handleFork} className="mobile-touch"><Save /></IconButton>}
                {compact && <div ref={moreAnchorRef} className="ml-auto flex-none"><IconButton
                    label={t("更多操作")}
                    active={actionsOpen}
                    aria-haspopup="dialog"
                    aria-expanded={actionsOpen}
                    onClick={() => { closeSaveActions(); closeImport(); setActionsOpen(value => !value); }}
                    className="mobile-touch"
                >
                    <MoreVertical className="h-5 w-5" />
                </IconButton></div>}
            </div>

            {!compact && <div className="chain-editor-actions flex flex-none items-center justify-end gap-1.5 ml-auto">
                {/* 高频输入与提示词库入口（低频辅助开关与重置收进更多菜单） */}
                {canEdit && onReverseTag && <IconButton label={t('从图片反推 Tag')} title={t('上传或粘贴图片，识别后追加到当前模式的正面提示词')} onClick={onReverseTag}><ImagePlus /></IconButton>}
                {canEdit && <div ref={importAnchorRef} className="flex-none">
                    <IconButton
                        label={t("导入图片或 JSON 配置")}
                        title={activeGenerationMode === 'text-to-image' ? t("导入图片或 JSON 配置（支持直接 Ctrl+V 粘贴）") : t("导入图片或 JSON 配置")}
                        active={importOpen}
                        aria-haspopup="dialog"
                        aria-expanded={importOpen}
                        onClick={() => { closeActions(); closeSaveActions(); setImportOpen(value => !value); }}
                    >
                        <Download />
                    </IconButton>
                </div>}
                <ToolbarDivider />
                {canSaveActiveModeToLibrary && (isPlayground || (!isOwner && !isGuest)) && <IconButton label={isPlayground ? t("保存到库") : forkLabel} tone={forkSaveTone} disabled={isUploading} onClick={handleFork}><Save /></IconButton>}
                {canSaveActiveModeToLibrary && isOwner && !isPlayground && <div ref={saveAnchorRef} className="flex-none">
                    <IconButton label={t(saveLabel)} title={saveDetail} tone={ownerSaveTone} disabled={isUploading} aria-haspopup="dialog" aria-expanded={saveActionsOpen} onClick={() => { closeActions(); closeImport(); setSaveActionsOpen(value => !value); }}><Save /></IconButton>
                </div>}
                <div ref={moreAnchorRef} className="flex-none">
                    <IconButton
                        label={t("更多操作")}
                        active={actionsOpen}
                        aria-haspopup="dialog"
                        aria-expanded={actionsOpen}
                        onClick={() => { closeSaveActions(); closeImport(); setActionsOpen(value => !value); }}
                    >
                        <MoreVertical className="h-4 w-4" />
                    </IconButton>
                </div>
            </div>}
        </header>
        <input aria-label={t("导入图片或 JSON 创作配置")} type="file" ref={importInputRef} className="hidden" accept="image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg,application/json,.json" onChange={handleImportImage} />
        {importOpen && canEdit && (isMobile
            ? <ImagePreviewPortal><MobileBottomSheet open title={t("导入图片或 JSON 配置")} onClose={closeImport}>{renderImportOptions()}</MobileBottomSheet></ImagePreviewPortal>
            : <AnchoredToolbarPopover anchorRef={compact ? moreAnchorRef : importAnchorRef} title={t("导入图片或 JSON 配置")} width={300} onClose={closeImport}>{renderImportOptions()}</AnchoredToolbarPopover>)}
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
                {compact && canEdit && onReverseTag && <ActionRow icon={<ImagePlus className="h-4 w-4" />} label={t("从图片反推 Tag")} detail={t("上传图片后识别")} onClick={() => { closeActions(); onReverseTag(); }} />}
                {compact && canEdit && <ActionRow icon={<Download className="h-4 w-4" />} label={t("导入图片或 JSON 配置")} onClick={() => { closeActions(); setImportOpen(true); }} />}
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
                {onSectionedPromptChange && <ActionRow icon={<ListTree className="h-4 w-4" />} label={t('提示词细分')} detail={sectionedPrompt ? t('已开启') : t('已关闭')} onClick={() => { onSectionedPromptChange(!sectionedPrompt); closeActions(); }} />}
                {renderPromptTools()}
                {canEdit && <ActionRow icon={translationPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />} label={t(translationPending ? "正在翻译提示词" : "翻译所有未翻译提示词")} detail={translationPending ? t("翻译中") : undefined} disabled={translationPending} onClick={() => { closeActions(); onTranslateMissingPrompts(); }} />}
                {canEdit && <div className="my-1 border-t border-gray-200/70 dark:border-gray-700/70" />}
                {canEdit && <ActionRow icon={<RotateCcw className="h-4 w-4" />} label={t("重置当前模式")} detail={activeModeLabel} tone="danger" onClick={() => { closeActions(); handleReset(); }} />}
                {compact && canSaveActiveModeToLibrary && isPlayground && <ActionRow icon={<Save className="h-4 w-4" />} label={t("保存到库")} tone={canSaveCurrentChain ? 'primary' : 'default'} disabled={isUploading} onClick={() => { closeActions(); handleFork(); }} />}
            </div>;
    }

    function renderPromptTools() {
        return <div ref={setPromptToolbarSlot} className="flex flex-col gap-1 empty:hidden" />;
    }

};
