import React, { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Palette, Sparkles, Wand2 } from 'lucide-react';
import type { LocalGenItem, PromptChain } from '../../types';
import { t, useLanguage } from '../../services/i18n';
import type { ComicCustomAsset, ComicCustomAssetKind } from '../../services/comic/comicAssets';
import type { ComicFontCatalogState } from '../../services/comic/comicFonts';
import type { ComicAiZonePlan } from '../../services/comic/comicAiPageEngine';
import type { ComicBubbleCandidate } from '../../services/comic/comicBubbleDetector';
import type { ComicInpaintDraft } from '../../services/comic/comicInpaintEngine';
import type {
  ComicAiGuidePanel,
  ComicAiPagePlan,
  ComicBubbleItem,
  ComicCreationMode,
  ComicImageLayerItem,
  ComicPageDraft,
  ComicPanel,
  ComicSelection,
  ComicStickerItem,
  ComicTextItem,
} from '../../services/comic/comicTypes';
import { HistoryImagePicker } from '../HistoryImagePicker';
import type { PromptTidyOptions } from '../PromptTidyActions';
import type { ComicInspectorTab } from './ComicInspectorShared';
import { ComicInspectorStyleTab } from './ComicInspectorStyleTab';
import { ComicInspectorAiPageTab } from './ComicInspectorAiPageTab';
import { ComicInspectorManualPanelTab } from './ComicInspectorManualPanelTab';
import { ComicInspectorLayersTab } from './ComicInspectorLayersTab';

export type { ComicInspectorTab } from './ComicInspectorShared';

interface ComicInspectorProps {
  draft: ComicPageDraft;
  aiZonePlan: ComicAiZonePlan;
  inpaintDraft: ComicInpaintDraft | null;
  bubbleCandidates: ComicBubbleCandidate[] | null;
  preserveGuideLayout: boolean;
  comparingOriginalAiImage: boolean;
  activeTab: ComicInspectorTab;
  selection: ComicSelection;
  chains: PromptChain[];
  generatingPanelId: string | null;
  batchGeneratingManual: boolean;
  batchProgressText: string;
  lastGeneratedSeed?: number;
  planningAiStoryboard: boolean;
  generatingAiPage: boolean;
  detectingBubbles: boolean;
  inpaintingAiPage: boolean;
  aiGenerationStageText: string;
  generationStageText: string;
  estimatedCost: number;
  aiEstimatedCost: number;
  notify?: (message: string, type?: 'success' | 'error') => void;
  onSelectTab: (tab: ComicInspectorTab) => void;
  onChangeMode: (mode: ComicCreationMode) => void;
  onSelect: (selection: ComicSelection) => void;
  onQuickAddPanel: () => void;
  onUpdateDraft: (updater: (current: ComicPageDraft) => ComicPageDraft, commit?: boolean) => void;
  onUpdateAiPage: (updater: (aiPage: ComicAiPagePlan) => ComicAiPagePlan, commit?: boolean) => void;
  onTogglePreserveGuideLayout: (preserve: boolean) => void;
  onPlanAiStoryboard: () => void;
  onInitAiFromTemplate: () => void;
  onConvertBubbleAnchorsToVector: () => void;
  onAutoDetectWhiteBubbles: () => void;
  onToggleBubbleCandidate: (id: string) => void;
  onEditBubbleCandidateText: (id: string, text: string) => void;
  onBulkSelectBubbleCandidates: (mode: 'all' | 'with-text' | 'none') => void;
  onConfirmBubbleCandidates: () => void;
  onCancelBubbleCandidates: () => void;
  onToggleCompareOriginalAiImage: () => void;
  onRestoreOriginalAiImage: () => void;
  onOpenInpaint: (guidePanel?: ComicAiGuidePanel) => void;
  onCloseInpaint: () => void;
  onUpdateInpaintDraft: (updater: (current: ComicInpaintDraft) => ComicInpaintDraft) => void;
  onRunInpaint: () => void;
  onGenerateAiPage: () => void;
  onGenerateAiZone: (zoneIndex: 0 | 1) => void;
  onRestitchAiZones: () => void;
  onApplyStyleChain: (chain: PromptChain) => void;
  onUpdatePanel: (panelId: string, updater: (panel: ComicPanel) => ComicPanel, commit?: boolean) => void;
  onDuplicatePanel: (panelId: string) => void;
  onDeletePanel: (panelId: string) => void;
  onBringPanelOrder: (panelId: string, mode: 'front' | 'back') => void;
  onTogglePanelOverlay?: (panelId: string) => void;
  onTogglePanelBorderless?: (panelId: string) => void;
  onUploadImageToPanel?: (panelId: string, file: File) => void;
  panelHistoryRequestToken?: number;
  onGeneratePanel: (panelId: string) => void;
  onGenerateAllPanels: () => void;
  onCancelGeneration: () => void;
  onUpdateBubble: (id: string, updater: (item: ComicBubbleItem) => ComicBubbleItem, commit?: boolean) => void;
  onDeleteBubble: (id: string) => void;
  onUpdateText: (id: string, updater: (item: ComicTextItem) => ComicTextItem, commit?: boolean) => void;
  onDeleteText: (id: string) => void;
  onUpdateSticker: (id: string, updater: (item: ComicStickerItem) => ComicStickerItem, commit?: boolean) => void;
  onDeleteSticker: (id: string) => void;
  onQuickAddBubble?: () => void;
  onQuickAddText?: () => void;
  onQuickAddSticker?: () => void;
  onUpdateImageLayer: (id: string, updater: (item: ComicImageLayerItem) => ComicImageLayerItem, commit?: boolean) => void;
  onDeleteImageLayer: (id: string) => void;
  onConvertSingleAnchorBubbleToVector: (target: { kind: 'ai-anchor'; anchorId: string } | { kind: 'panel-anchor'; panelId: string; anchorId: string }) => void;
  customAssets?: ComicCustomAsset[];
  onUploadCustomAssets?: (files: File[], kind: ComicCustomAssetKind, options?: { insertToCanvas?: boolean; applyToSelectedBubble?: boolean }) => void;
  onInsertCustomAsset?: (asset: ComicCustomAsset, targetBubbleId?: string) => void;
  onRenameCustomAsset?: (id: string, name: string) => void;
  onDeleteCustomAsset?: (id: string) => void;
  onApplyTemporaryBubbleImage?: (bubbleId: string, file: File) => void;
  onImportImageFiles?: (files: File[], options?: { saveToLibrary?: boolean }) => void;
  onSaveImageLayerToLibrary?: (imageLayer: ComicImageLayerItem) => void;
  fontCatalog: ComicFontCatalogState;
  defaultFontId?: string | null;
  downloadingFontId: string | null;
  onDownloadFont: (id: string) => void;
  onUploadCustomFont: (fileOrFiles: File | File[]) => void;
  onRenameCustomFont?: (id: string, name: string) => void;
  onSetDefaultFont?: (fontId: string | null) => void;
  onDeleteFont: (id: string) => void;
}

export const ComicInspector: React.FC<ComicInspectorProps> = ({
  draft,
  aiZonePlan,
  inpaintDraft,
  bubbleCandidates,
  preserveGuideLayout,
  comparingOriginalAiImage,
  activeTab,
  selection,
  chains,
  generatingPanelId,
  batchGeneratingManual,
  batchProgressText,
  lastGeneratedSeed,
  planningAiStoryboard,
  generatingAiPage,
  detectingBubbles,
  inpaintingAiPage,
  aiGenerationStageText,
  generationStageText,
  estimatedCost,
  aiEstimatedCost,
  notify,
  onSelectTab,
  onChangeMode,
  onSelect,
  onQuickAddPanel,
  onUpdateDraft,
  onUpdateAiPage,
  onTogglePreserveGuideLayout,
  onPlanAiStoryboard,
  onConvertBubbleAnchorsToVector,
  onAutoDetectWhiteBubbles,
  onToggleBubbleCandidate,
  onEditBubbleCandidateText,
  onBulkSelectBubbleCandidates,
  onConfirmBubbleCandidates,
  onCancelBubbleCandidates,
  onToggleCompareOriginalAiImage,
  onRestoreOriginalAiImage,
  onOpenInpaint,
  onCloseInpaint,
  onUpdateInpaintDraft,
  onRunInpaint,
  onGenerateAiPage,
  onGenerateAiZone,
  onRestitchAiZones,
  onApplyStyleChain,
  onUpdatePanel,
  onDeletePanel,
  onUploadImageToPanel,
  panelHistoryRequestToken,
  onGeneratePanel,
  onGenerateAllPanels,
  onCancelGeneration,
  onUpdateBubble,
  onDeleteBubble,
  onUpdateText,
  onDeleteText,
  onUpdateSticker,
  onDeleteSticker,
  onQuickAddBubble,
  onQuickAddText,
  onQuickAddSticker,
  onUpdateImageLayer,
  onDeleteImageLayer,
  onConvertSingleAnchorBubbleToVector,
  customAssets = [],
  onUploadCustomAssets,
  onInsertCustomAsset,
  onRenameCustomAsset,
  onDeleteCustomAsset,
  onApplyTemporaryBubbleImage,
  onImportImageFiles,
  onSaveImageLayerToLibrary,
  fontCatalog,
  defaultFontId = null,
  downloadingFontId,
  onDownloadFont,
  onUploadCustomFont,
  onRenameCustomFont,
  onSetDefaultFont,
  onDeleteFont,
  onTogglePanelOverlay,
  onTogglePanelBorderless,
}) => {
  useLanguage();
  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);

  const copyPrompt = (value: string, label: string) => {
    if (!value.trim()) {
      notify?.(t('{0}为空，无可复制内容', [label]), 'error');
      return;
    }
    void navigator.clipboard?.writeText(value);
    notify?.(t('已复制{0}', [label]), 'success');
  };

  const promptTidyOption = useMemo<PromptTidyOptions | undefined>(
    () => (notify ? { notify } : undefined),
    [notify],
  );

  useEffect(() => {
    if (panelHistoryRequestToken && panelHistoryRequestToken > 0) {
      setHistoryPickerOpen(true);
    }
  }, [panelHistoryRequestToken]);

  const allCharacterChains = useMemo(
    () => chains.filter(item => item.type === 'character'),
    [chains],
  );

  // 分镜生图标签默认锚定当前选中的格，若当前未选格则自动显示第 1 格
  const activePanel = (selection?.kind === 'panel'
    ? draft.panels.find(item => item.id === selection.id)
    : selection?.kind === 'panel-anchor'
      ? draft.panels.find(item => item.id === selection.panelId)
      : undefined) || draft.panels[0];

  const handleSelectHistoryImage = (item: LocalGenItem) => {
    if (!activePanel) return;
    onUpdatePanel(activePanel.id, current => ({
      ...current,
      image: {
        url: item.imageUrl,
        historyId: item.id,
        width: item.params?.width,
        height: item.params?.height,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
      },
    }), true);
    setHistoryPickerOpen(false);
  };

  const overlayCount = draft.bubbles.length + draft.texts.length + draft.stickers.length + (draft.imageLayers?.length ?? 0);

  return (
    <aside className="appearance-panel flex h-full w-full flex-col border-l border-gray-200 bg-white/90 dark:border-gray-800 dark:bg-gray-900/90">
      {/* 顶部顺次三步导航：1 画风 → 2 分镜 → 3 嵌字（贴合真实创作顺序，取消独立 PS 图层主标签） */}
      <div
        role="tablist"
        aria-label={t('漫画创作步骤')}
        className="grid flex-none grid-cols-3 border-b border-gray-200/80 bg-transparent dark:border-gray-800/80"
      >
        {([
          { id: 'style', step: 1, label: t('画风设定'), icon: Palette },
          { id: 'panel', step: 2, label: t('分镜生图'), icon: draft.creationMode === 'ai-page' ? Sparkles : Wand2 },
          { id: 'layers', step: 3, label: t('气泡嵌字'), badge: overlayCount > 0 ? overlayCount : undefined, icon: MessageCircle },
        ] as Array<{ id: ComicInspectorTab; step: number; label: string; badge?: number; icon: React.ElementType }>).map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectTab(tab.id)}
              className={`relative inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap px-2 text-xs font-semibold transition ${active ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200'}`}
            >
              <span
                aria-hidden="true"
                className={`inline-flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold leading-none ${active ? 'bg-indigo-600 text-white' : 'bg-gray-200/90 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}
              >
                {tab.step}
              </span>
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold leading-4 ${active ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-200' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                  {tab.badge}
                </span>
              )}
              {active && <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-indigo-500" />}
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 步骤 2 顶部的生成方式轻切换（同时保留手动逐格与 AI 整页） */}
        {activeTab === 'panel' && (
          <div className="flex flex-none items-center justify-between gap-2 border-b border-gray-200/80 bg-gray-50/50 px-3.5 py-2 dark:border-gray-800/80 dark:bg-gray-950/30">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{t('生图方式')}</span>
            <div
              className="inline-flex flex-none rounded-lg border border-gray-200/80 bg-gray-100/90 p-0.5 dark:border-gray-700/80 dark:bg-gray-800/90"
              role="group"
              aria-label={t('创作模式')}
            >
              <button
                type="button"
                aria-pressed={draft.creationMode === 'manual'}
                onClick={() => onChangeMode('manual')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${draft.creationMode === 'manual' ? 'bg-white text-indigo-600 shadow-xs dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
              >
                {t('手动逐格')}
              </button>
              <button
                type="button"
                aria-pressed={draft.creationMode === 'ai-page'}
                onClick={() => onChangeMode('ai-page')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition ${draft.creationMode === 'ai-page' ? 'bg-white text-indigo-600 shadow-xs dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
                title={t('AI 整页锚点一图成型（含自动双区拼合）')}
              >
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                <span>{t('AI 整页')}</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'style' && (
          <ComicInspectorStyleTab
            draft={draft}
            chains={chains}
            lastGeneratedSeed={lastGeneratedSeed}
            promptTidyOption={promptTidyOption}
            copyPrompt={copyPrompt}
            onApplyStyleChain={onApplyStyleChain}
            onUpdateDraft={onUpdateDraft}
            onSelectTab={onSelectTab}
          />
        )}

        {activeTab === 'panel' && draft.creationMode === 'ai-page' && (
          <ComicInspectorAiPageTab
            draft={draft}
            aiZonePlan={aiZonePlan}
            inpaintDraft={inpaintDraft}
            bubbleCandidates={bubbleCandidates}
            preserveGuideLayout={preserveGuideLayout}
            comparingOriginalAiImage={comparingOriginalAiImage}
            selection={selection}
            allCharacterChains={allCharacterChains}
            generatingPanelId={generatingPanelId}
            planningAiStoryboard={planningAiStoryboard}
            generatingAiPage={generatingAiPage}
            detectingBubbles={detectingBubbles}
            inpaintingAiPage={inpaintingAiPage}
            aiGenerationStageText={aiGenerationStageText}
            generationStageText={generationStageText}
            aiEstimatedCost={aiEstimatedCost}
            copyPrompt={copyPrompt}
            onSelect={onSelect}
            onUpdateAiPage={onUpdateAiPage}
            onTogglePreserveGuideLayout={onTogglePreserveGuideLayout}
            onPlanAiStoryboard={onPlanAiStoryboard}
            onConvertBubbleAnchorsToVector={onConvertBubbleAnchorsToVector}
            onAutoDetectWhiteBubbles={onAutoDetectWhiteBubbles}
            onToggleBubbleCandidate={onToggleBubbleCandidate}
            onEditBubbleCandidateText={onEditBubbleCandidateText}
            onBulkSelectBubbleCandidates={onBulkSelectBubbleCandidates}
            onConfirmBubbleCandidates={onConfirmBubbleCandidates}
            onCancelBubbleCandidates={onCancelBubbleCandidates}
            onToggleCompareOriginalAiImage={onToggleCompareOriginalAiImage}
            onRestoreOriginalAiImage={onRestoreOriginalAiImage}
            onOpenInpaint={onOpenInpaint}
            onCloseInpaint={onCloseInpaint}
            onUpdateInpaintDraft={onUpdateInpaintDraft}
            onRunInpaint={onRunInpaint}
            onGenerateAiPage={onGenerateAiPage}
            onGenerateAiZone={onGenerateAiZone}
            onRestitchAiZones={onRestitchAiZones}
            onCancelGeneration={onCancelGeneration}
            onConvertSingleAnchorBubbleToVector={onConvertSingleAnchorBubbleToVector}
          />
        )}

        {activeTab === 'panel' && draft.creationMode === 'manual' && (
          <ComicInspectorManualPanelTab
            draft={draft}
            activePanel={activePanel}
            allCharacterChains={allCharacterChains}
            generatingPanelId={generatingPanelId}
            batchGeneratingManual={batchGeneratingManual}
            batchProgressText={batchProgressText}
            generationStageText={generationStageText}
            estimatedCost={estimatedCost}
            promptTidyOption={promptTidyOption}
            copyPrompt={copyPrompt}
            onSelect={onSelect}
            onQuickAddPanel={onQuickAddPanel}
            onUpdatePanel={onUpdatePanel}
            onDeletePanel={onDeletePanel}
            onUploadImageToPanel={onUploadImageToPanel}
            onOpenHistoryPicker={() => setHistoryPickerOpen(true)}
            onTogglePanelOverlay={onTogglePanelOverlay}
            onTogglePanelBorderless={onTogglePanelBorderless}
            onGeneratePanel={onGeneratePanel}
            onGenerateAllPanels={onGenerateAllPanels}
            onCancelGeneration={onCancelGeneration}
            onConvertSingleAnchorBubbleToVector={onConvertSingleAnchorBubbleToVector}
          />
        )}

        {activeTab === 'layers' && (
          <ComicInspectorLayersTab
            draft={draft}
            selection={selection}
            overlayCount={overlayCount}
            customAssets={customAssets}
            fontCatalog={fontCatalog}
            defaultFontId={defaultFontId}
            downloadingFontId={downloadingFontId}
            onSelect={onSelect}
            onUpdateDraft={onUpdateDraft}
            onUpdateBubble={onUpdateBubble}
            onDeleteBubble={onDeleteBubble}
            onUpdateText={onUpdateText}
            onDeleteText={onDeleteText}
            onUpdateSticker={onUpdateSticker}
            onDeleteSticker={onDeleteSticker}
            onQuickAddBubble={onQuickAddBubble}
            onQuickAddText={onQuickAddText}
            onQuickAddSticker={onQuickAddSticker}
            onUpdateImageLayer={onUpdateImageLayer}
            onDeleteImageLayer={onDeleteImageLayer}
            onUploadCustomAssets={onUploadCustomAssets}
            onInsertCustomAsset={onInsertCustomAsset}
            onRenameCustomAsset={onRenameCustomAsset}
            onDeleteCustomAsset={onDeleteCustomAsset}
            onApplyTemporaryBubbleImage={onApplyTemporaryBubbleImage}
            onImportImageFiles={onImportImageFiles}
            onSaveImageLayerToLibrary={onSaveImageLayerToLibrary}
            onDownloadFont={onDownloadFont}
            onUploadCustomFont={onUploadCustomFont}
            onRenameCustomFont={onRenameCustomFont}
            onSetDefaultFont={onSetDefaultFont}
            onDeleteFont={onDeleteFont}
          />
        )}
      </div>

      <HistoryImagePicker
        open={historyPickerOpen}
        allowImportParams={false}
        onClose={() => setHistoryPickerOpen(false)}
        onSelect={item => handleSelectHistoryImage(item)}
      />
    </aside>
  );
};
