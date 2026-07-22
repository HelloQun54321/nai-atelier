
import React, { useRef, useState } from 'react';
import { TagAutocompleteTextarea } from './TagAutocompleteTextarea';
import { OriginalImage } from './SmartImage';
import { InlineCloudQueueStatus, useCloudQueueStatus } from './CloudQueueStatus';

interface ChainEditorPreviewProps {
    subjectPrompt: string;
    setSubjectPrompt: (s: string) => void;
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
    onCopyFinalPrompt: () => void;
    subjectPresetSource?: { name: string; modified: boolean };
    estimatedAnlasCost: number;
}

export const ChainEditorPreview: React.FC<ChainEditorPreviewProps> = ({
    subjectPrompt,
    setSubjectPrompt,
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
    onCopyFinalPrompt,
    subjectPresetSource,
    estimatedAnlasCost
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
        <div className="w-full lg:w-1/2 flex flex-col bg-gray-100 dark:bg-black/20 order-1 lg:order-2 border-b lg:border-b-0 border-gray-200 dark:border-gray-800 shrink-0">
            <div className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden min-h-[400px]">
                {/* Subject / Variable Input */}
                <div className="mb-4 bg-white dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-800">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-500">3. 主体 / 变量提示词</h3>
                            {subjectPresetSource && <span className="max-w-28 truncate rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 sm:max-w-40" title={`来自：${subjectPresetSource.name}${subjectPresetSource.modified ? ' · 已修改' : ''}`}>来自：{subjectPresetSource.name}{subjectPresetSource.modified ? ' · 已修改' : ''}</span>}
                        </div>
                        <button type="button" onClick={onCopyFinalPrompt} className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30" title="复制基础画风、模块和主体合成后的完整提示词">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                            复制完整提示词
                        </button>
                    </div>
                    <p className="text-[10px] text-gray-400 mb-2">放置画师串固定提示词以外的内容，比如人物、场景。</p>
                    <TagAutocompleteTextarea
                        className="w-full h-24 md:h-32 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-3 text-sm outline-none focus:border-indigo-500 font-mono resize-none"
                        placeholder="输入动态主体描述，例如：1girl, blue hair, sitting..."
                        value={subjectPrompt}
                        onValueChange={setSubjectPrompt}
                    />
                </div>

                {/* Generated Image */}
                {isGenerating && queueStatus ? <InlineCloudQueueStatus className="mb-4 flex-shrink-0" /> : <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className={`w-full py-3 rounded-lg font-bold text-white shadow-lg transition-all mb-4 flex-shrink-0 ${isGenerating ? 'bg-gray-400 cursor-wait' : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500'
                        }`}
                >
                    {isGenerating ? '生成中...' : `生成预览 · ${estimatedAnlasCost ? `${estimatedAnlasCost} 点` : '免费'}`}
                </button>}
                {errorMsg && <div className="text-red-500 text-xs mb-2 text-center">{errorMsg}</div>}

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
                                title="从当前画师串历史组移除这张图，历史页仍会保留"
                            >
                                删除
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClearHistoryGroup?.();
                                }}
                                className="bg-gray-900/85 hover:bg-gray-800 text-white px-3 py-1.5 rounded text-xs font-medium shadow-lg backdrop-blur"
                                title="清空当前画师串历史组，历史页仍会保留"
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
            </div>
        </div>
    );
};
