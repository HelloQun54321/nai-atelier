
import React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { OriginalImage } from './SmartImage';
import { InlineCloudQueueStatus, useCloudQueueStatus } from './CloudQueueStatus';
import { isCloudQueueTaskActive } from '../services/cloudQueue';
import { ImagePreviewActions } from './ImagePreviewActions';
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
    handleUploadCover: (e: React.ChangeEvent<HTMLInputElement>) => void;
    getDownloadFilename: () => string;
    generationData?: ImageGenerationData;
    hideCoverActions?: boolean;
    canNavigateHistory?: boolean;
    historyLabel?: string;
    onPreviousHistory?: () => void;
    onNextHistory?: () => void;
    canManageHistoryGroup?: boolean;
    onRemoveCurrentHistory?: () => void;
    onClearHistoryGroup?: () => void;
    generationCostLabel: string;
    transparentPreview?: boolean;
    generationProgress?: { step: number; total: number } | null;
    generateLabel?: string;
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
    handleUploadCover,
    getDownloadFilename,
    generationData,
    hideCoverActions,
    canNavigateHistory = false,
    historyLabel,
    onPreviousHistory,
    onNextHistory,
    canManageHistoryGroup = false,
    onRemoveCurrentHistory,
    onClearHistoryGroup,
    generationCostLabel,
    transparentPreview = false,
    generationProgress = null,
    generateLabel = '生成图片',
    emptyLabel = '暂无预览图，请从上方模式栏选择编辑模式',
    resultAlt = '已生成',
    showQueueStatus = true,
    hideGenerateButtonOnMobile = false,
    generationDisabled = false,
    notify,
}) => {
    const queueStatus = useCloudQueueStatus();

    return (
        <div className="chain-editor-preview w-full lg:w-1/2 flex flex-col bg-gray-100 dark:bg-black/20 order-1 lg:order-2 border-b lg:border-b-0 border-gray-200 dark:border-gray-800 lg:shrink-0">
            <div className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden lg:min-h-[400px]">
                {/* Generated Image */}
                <div
                    className={`flex-1 min-h-0 lg:min-h-[300px] rounded-xl border border-gray-200 dark:border-gray-800 flex items-center justify-center relative group overflow-hidden cursor-zoom-in ${transparentPreview ? 'nai-alpha-checker' : 'bg-white dark:bg-gray-950/50'}`}
                    onClick={() => {
                        const img = generatedImage || previewImage;
                        if (img) setLightboxImg(img);
                    }}
                >
                    {canNavigateHistory && (
                        <>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onPreviousHistory?.();
                                }}
                                className="absolute left-3 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full bg-black/45 text-white flex items-center justify-center opacity-100 lg:opacity-0 group-hover:opacity-100 hover:bg-black/70 transition-all"
                                title="上一张"
                                aria-label="上一张历史图"
                            >
                                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onNextHistory?.();
                                }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full bg-black/45 text-white flex items-center justify-center opacity-100 lg:opacity-0 group-hover:opacity-100 hover:bg-black/70 transition-all"
                                title="下一张"
                                aria-label="下一张历史图"
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
                                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-xs text-white pointer-events-none">
                                    {historyLabel}
                                </div>
                            )}

                        </>
                    ) : (
                        previewImage ? (
                            <>
                                <OriginalImage src={previewImage} alt="封面" className="max-w-full max-h-full object-contain shadow-2xl opacity-50 grayscale hover:grayscale-0 transition-all duration-500" />
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <span className="bg-black/50 text-white px-3 py-1 rounded text-xs">当前封面</span>
                                </div>

                            </>
                        ) : <div className="rounded-lg border border-dashed border-gray-300 px-4 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">{emptyLabel}</div>
                    )}

                    {isGenerating && generationProgress && (
                        <div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1 text-meta font-semibold text-white shadow-lg backdrop-blur-sm pointer-events-none">
                            采样 {generationProgress.step} / {generationProgress.total}
                        </div>
                    )}


                    <ImagePreviewActions
                        imageUrl={generatedImage || previewImage}
                        filename={getDownloadFilename()}
                        generationData={generationData}
                        notify={notify}
                        canManageHistoryGroup={Boolean(generatedImage && canManageHistoryGroup)}
                        onRemoveCurrentHistory={onRemoveCurrentHistory}
                        onClearHistoryGroup={onClearHistoryGroup}
                        onSetCover={generatedImage && isOwner && !hideCoverActions ? handleSavePreview : undefined}
                        onUploadCover={isOwner && !hideCoverActions ? handleUploadCover : undefined}
                        isUploading={isUploading}
                    />
                </div>

                <div className="mt-4 flex flex-none flex-col items-center">
                    {errorMsg && <div role="alert" className="mb-2 w-full max-w-sm rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{errorMsg}</div>}
                    {showQueueStatus && queueStatus && <InlineCloudQueueStatus className="mb-2 w-full max-w-xs flex-shrink-0" />}
                    {!(showQueueStatus && isCloudQueueTaskActive(queueStatus)) && <button
                        onClick={handleGenerate}
                        disabled={isGenerating || generationDisabled}
                        className={`generation-action-button flex h-11 w-full max-w-xs items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${isGenerating ? 'generation-action-button--loading' : ''} ${hideGenerateButtonOnMobile ? 'hidden lg:flex' : ''}`}
                    >
                        <ImageIcon aria-hidden="true" className="relative z-[1] h-4 w-4 shrink-0" strokeWidth={2.2} />
                        <span>{isGenerating ? generationProgress ? `生成中 ${generationProgress.step}/${generationProgress.total}` : '生成中…' : generateLabel}</span>
                        {!isGenerating && <span className="generation-action-button__cost">{generationCostLabel}</span>}
                    </button>}
                </div>
            </div>
        </div>
    );
};
