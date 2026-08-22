
import React, { useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { OriginalImage } from './SmartImage';
import { InlineCloudQueueStatus, useCloudQueueStatus } from './CloudQueueStatus';

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
    hideCoverActions?: boolean;
    canNavigateHistory?: boolean;
    historyLabel?: string;
    onPreviousHistory?: () => void;
    onNextHistory?: () => void;
    canManageHistoryGroup?: boolean;
    onRemoveCurrentHistory?: () => void;
    onClearHistoryGroup?: () => void;
    generationCostLabel: string;
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
    hideCoverActions,
    canNavigateHistory = false,
    historyLabel,
    onPreviousHistory,
    onNextHistory,
    canManageHistoryGroup = false,
    onRemoveCurrentHistory,
    onClearHistoryGroup,
    generationCostLabel
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const queueStatus = useCloudQueueStatus();

    // 跨域图片下载：先 fetch 转 blob，再创建本地 URL 下载
    const handleDownload = async (imageUrl: string, filename: string) => {
        if (isDownloading) return;
        setIsDownloading(true);
        try {
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`下载失败: ${response.status}`);
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            // 延迟释放 URL，给浏览器足够时间处理下载请求
            // 某些浏览器（如移动端 Alook）处理 click 事件较慢，立即释放会导致下载失败
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            console.error('下载失败:', error);
            // 可选：这里可以添加 notify 提示用户下载失败
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div className="chain-editor-preview w-full lg:w-1/2 flex flex-col bg-gray-100 dark:bg-black/20 order-1 lg:order-2 border-b lg:border-b-0 border-gray-200 dark:border-gray-800 shrink-0">
            <div className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden min-h-[400px]">
                {/* Generated Image */}
                <div
                    className="flex-1 min-h-[300px] lg:min-h-0 bg-white dark:bg-gray-950/50 rounded-xl border border-gray-200 dark:border-gray-800 flex items-center justify-center relative group overflow-hidden cursor-zoom-in"
                    onClick={() => {
                        const img = generatedImage || previewImage;
                        if (img) setLightboxImg(img);
                    }}
                >
                    {generatedImage && canManageHistoryGroup && (
                        <div className="absolute top-4 left-4 z-30 flex flex-col gap-2 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveCurrentHistory?.();
                                }}
                                className="bg-red-600/90 hover:bg-red-500 text-white px-3 py-1.5 rounded text-xs font-medium shadow-lg backdrop-blur"
                                title="从当前风格串历史组移除这张图，历史页仍会保留"
                            >
                                删除
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClearHistoryGroup?.();
                                }}
                                className="bg-gray-900/85 hover:bg-gray-800 text-white px-3 py-1.5 rounded text-xs font-medium shadow-lg backdrop-blur"
                                title="清空当前风格串历史组，历史页仍会保留"
                            >
                                清除
                            </button>
                        </div>
                    )}

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
                            <OriginalImage src={generatedImage} alt="已生成" className="max-w-full max-h-full object-contain shadow-2xl" />
                            {historyLabel && (
                                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-xs text-white pointer-events-none">
                                    {historyLabel}
                                </div>
                            )}
                            <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                <button onClick={(e) => { e.stopPropagation(); handleDownload(generatedImage, getDownloadFilename()); }} disabled={isDownloading} className="bg-black/70 text-white px-3 py-1.5 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed">{isDownloading ? '下载中...' : '下载'}</button>
                                {isOwner && !hideCoverActions && <button onClick={(e) => { e.stopPropagation(); handleSavePreview(); }} disabled={isUploading} className="bg-indigo-600/90 text-white px-3 py-1.5 rounded text-xs flex items-center gap-1">{isUploading ? '上传中...' : '设为封面'}</button>}
                            </div>
                        </>
                    ) : (
                        previewImage ? (
                            <>
                                <OriginalImage src={previewImage} alt="封面" className="max-w-full max-h-full object-contain shadow-2xl opacity-50 grayscale hover:grayscale-0 transition-all duration-500" />
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <span className="bg-black/50 text-white px-3 py-1 rounded text-xs">当前封面</span>
                                </div>
                                <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                    <button onClick={(e) => { e.stopPropagation(); handleDownload(previewImage, getDownloadFilename()); }} disabled={isDownloading} className="bg-black/70 text-white px-3 py-1.5 rounded text-xs text-center cursor-pointer pointer-events-auto disabled:opacity-50 disabled:cursor-not-allowed">{isDownloading ? '下载中...' : '下载封面'}</button>
                                </div>
                            </>
                        ) : <div className="text-gray-400 text-xs">预览区</div>
                    )}


                    {/* Manual Upload Cover Button */}
                    {isOwner && !hideCoverActions && (
                        <div className="absolute bottom-4 right-4 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleUploadCover}
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploading}
                                className="bg-gray-800/80 hover:bg-gray-700 text-white px-3 py-1.5 rounded text-xs shadow-lg backdrop-blur"
                            >
                                {isUploading ? '上传中...' : '手动上传'}
                            </button>
                        </div>
                    )}
                </div>

                <div className="mt-4 flex flex-none flex-col items-center">
                    {errorMsg && <div role="alert" className="mb-2 w-full max-w-sm rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{errorMsg}</div>}
                    {queueStatus ? <InlineCloudQueueStatus className="w-full max-w-xs flex-shrink-0" /> : <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className={`generation-action-button flex h-11 w-full max-w-xs items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold ${isGenerating ? 'generation-action-button--loading' : ''}`}
                    >
                        <ImageIcon aria-hidden="true" className="relative z-[1] h-4 w-4 shrink-0" strokeWidth={2.2} />
                        <span>{isGenerating ? '生成中…' : '生成图片'}</span>
                        {!isGenerating && <span className="generation-action-button__cost">{generationCostLabel}</span>}
                    </button>}
                </div>
            </div>
        </div>
    );
};
