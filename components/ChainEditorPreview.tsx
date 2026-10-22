import { t, useLanguage } from '../services/i18n';
import { PressRevealSurface } from './PressRevealSurface';

import React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { OriginalImage } from './SmartImage';
import { CloudQueueButton, useCloudQueueStatus } from './CloudQueueStatus';
import { isCloudQueueTaskActive } from '../services/cloudQueue';
import { ImagePreviewActions } from './ImagePreviewActions';
import { GenerationCountControl, type GenerationCountControlProps } from './GenerationCountControl';
import type { CollectionTarget } from '../services/collectionFavorites';
import type { ImageGenerationData } from '../services/imageClipboardContext';

interface ChainEditorPreviewProps {
    isGenerating: boolean;
    handleGenerate: () => void;
    errorMsg: string | null;
    generatedImage: string | null;
    previewImage: string | undefined;
    setLightboxImg: (img: string | null) => void;
    isOwner: boolean;
    isUploading: boolean;
    handleSavePreview: () => void;
    onSaveArtistSample?: () => void;
    savingArtistSample?: boolean;
    handleUploadCover: (e: React.ChangeEvent<HTMLInputElement>) => void;
    getDownloadFilename: () => string;
    generationData?: ImageGenerationData;
    favorite?: CollectionTarget;
    hideCoverActions?: boolean;
    canNavigateHistory?: boolean;
    historyLabel?: string;
    onPreviousHistory?: () => void;
    onNextHistory?: () => void;
    canManageHistoryGroup?: boolean;
    onRemoveCurrentHistory?: () => void;
    onClearHistoryGroup?: () => void;
    generationCostLabel: string;
    generationCountControl?: GenerationCountControlProps;
    generationProgress?: { step: number; total: number } | null;
    unavailableLabel?: string;
    emptyLabel?: string;
    resultAlt?: string;
    showQueueStatus?: boolean;
    generationDisabled?: boolean;
    hideGenerateButtonOnMobile?: boolean;
    /** 下载失败时除 console.error 外同时走全局提示（若外部提供）。 */
    notify?: (msg: string, type?: 'success' | 'error') => void;
}

export const ChainEditorPreview: React.FC<ChainEditorPreviewProps> = ({
    isGenerating,
    handleGenerate,
    errorMsg,
    generatedImage,
    previewImage,
    setLightboxImg,
    isOwner,
    isUploading,
    handleSavePreview,
    onSaveArtistSample,
    savingArtistSample,
    handleUploadCover,
    getDownloadFilename,
    generationData,
    favorite,
    hideCoverActions,
    canNavigateHistory = false,
    historyLabel,
    onPreviousHistory,
    onNextHistory,
    canManageHistoryGroup = false,
    onRemoveCurrentHistory,
    onClearHistoryGroup,
    generationCostLabel,
    generationCountControl,
    generationProgress = null,
    unavailableLabel,
    emptyLabel = '暂无生成结果',
    resultAlt = '已生成',
    showQueueStatus = true,
    hideGenerateButtonOnMobile = false,
    generationDisabled = false,
    notify,
}) => {
  useLanguage();
    const queueStatus = useCloudQueueStatus();

    return (
        <div className="appearance-content chain-editor-preview min-w-0 w-full lg:w-1/2 flex flex-col bg-gray-100 dark:bg-black/20 order-1 lg:order-2 border-b lg:border-b-0 border-gray-200 dark:border-gray-800 lg:shrink-0">
            <div className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden lg:min-h-[400px]">
                {/* Generated Image */}
                <PressRevealSurface pressResetKey={generatedImage || previewImage}
                    className={`appearance-media lab-preview-stage flex-1 min-h-0 lg:min-h-[300px] flex items-center justify-center relative group overflow-hidden ${generatedImage || previewImage ? 'cursor-zoom-in' : 'cursor-default'}`}
                    onClick={() => {
                        const img = generatedImage || previewImage;
                        if (img) setLightboxImg(img);
                    }}
                >
                    {canNavigateHistory && (
                        <>
                            <button data-card-action="true" data-image-preview-navigation
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onPreviousHistory?.();
                                }}
                                className="hover-reveal-lg absolute left-3 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                                title={t("上一张")}
                                aria-label={t("上一张历史图")}
                            >
                                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>
                            <button data-card-action="true" data-image-preview-navigation
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onNextHistory?.();
                                }}
                                className="hover-reveal-lg absolute right-3 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                                title={t("下一张")}
                                aria-label={t("下一张历史图")}
                            >
                                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                </svg>
                            </button>
                        </>
                    )}

                    {generatedImage ? (
                        <>
                            <OriginalImage src={generatedImage} alt={resultAlt} className="max-w-full max-h-full object-contain shadow-2xl" />
                            {historyLabel && (
                                <div data-image-preview-footer className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-xs text-white pointer-events-none">
                                    {historyLabel}
                                </div>
                            )}

                        </>
                    ) : (
                        previewImage ? (
                            <>
                                <OriginalImage src={previewImage} alt={t("封面")} className="max-w-full max-h-full object-contain shadow-2xl opacity-50 grayscale hover:grayscale-0 transition-all duration-500" />
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <span className="bg-black/50 text-white px-3 py-1 rounded text-xs">{t("当前封面")}</span>
                                </div>

                            </>
                        ) : <p className="lab-preview-empty px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{emptyLabel}</p>
                    )}

                    {isGenerating && generationProgress && (
                        <div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1 text-meta font-semibold text-white shadow-lg backdrop-blur-sm pointer-events-none">{t("采样 {0} / {1}", [generationProgress.step, generationProgress.total])}</div>
                    )}


                    <ImagePreviewActions
                        imageUrl={generatedImage || previewImage}
                        filename={getDownloadFilename()}
                        generationData={generationData} favorite={favorite}
                        notify={notify}
                        canManageHistoryGroup={Boolean(generatedImage && canManageHistoryGroup)}
                        onRemoveCurrentHistory={onRemoveCurrentHistory}
                        onClearHistoryGroup={onClearHistoryGroup}
                        onSetCover={generatedImage && isOwner && !hideCoverActions ? handleSavePreview : undefined}
                        onUploadCover={isOwner && !hideCoverActions ? handleUploadCover : undefined}
                        isUploading={isUploading}
                        onSaveArtistSample={onSaveArtistSample}
                        savingArtistSample={savingArtistSample}
                    />
                </PressRevealSurface>

                <div className="mt-4 flex flex-none flex-col items-center">
                    {errorMsg && <div role="alert" className="mb-2 w-full max-w-sm rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{errorMsg}</div>}
                    <div className={`flex w-full items-stretch justify-center gap-2 ${hideGenerateButtonOnMobile ? 'hidden lg:flex' : ''}`}>
                    {generationCountControl ? <GenerationCountControl {...generationCountControl} generationProgress={generationProgress} showQueueStatus={showQueueStatus} onGenerate={handleGenerate} costLabel={generationCostLabel} unavailableLabel={unavailableLabel} busy={isGenerating} disabled={isGenerating || generationDisabled} /> : <>
                    <button data-agent-action="business" onClick={handleGenerate} disabled={isGenerating || generationDisabled || (showQueueStatus && isCloudQueueTaskActive(queueStatus))} className={`generation-action-button generation-action-button--workbench flex min-h-11 w-full max-w-xs items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold ${isGenerating && (!isCloudQueueTaskActive(queueStatus) || queueStatus?.phase === 'generating') ? 'generation-action-button--loading' : 'disabled:opacity-50'}`}>
                      <ImageIcon aria-hidden="true" className="h-4 w-4" /><span>{isGenerating ? t("生成中…") : unavailableLabel || t("生成")}</span>{!isGenerating && !unavailableLabel && <span className="generation-action-button__cost">{generationCostLabel}</span>}
                    </button>{showQueueStatus && <CloudQueueButton generationProgress={generationProgress} />}</>}
                    </div>
                </div>
            </div>
        </div>
    );
};
