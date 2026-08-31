import React, { useState } from 'react';
import { ImageEditOperation } from '../types';
import { ChainEditorPreview } from './ChainEditorPreview';

interface ImageEditPreviewProps {
  operation: ImageEditOperation;
  image: string | null;
  /** 原始底图；图生图模式下用于底图/结果 A/B 对比。 */
  baseImage?: string | null;
  /** 把当前生成结果设为新一轮底图（图生图迭代）。 */
  onUseResultAsBase?: () => void;
  error: string | null;
  generationCostLabel: string;
  isGenerating?: boolean;
  generationProgress?: { step: number; total: number } | null;
  isLoading?: boolean;
  onGenerate: () => void;
  onOpenLightbox: (image: string | null) => void;
  getDownloadFilename: () => string;
  canNavigateHistory?: boolean;
  historyLabel?: string;
  onPreviousHistory?: () => void;
  onNextHistory?: () => void;
  canManageHistoryGroup?: boolean;
  onRemoveCurrentHistory?: () => void;
  onClearHistoryGroup?: () => void;
}

const getOperationLabel = (operation: ImageEditOperation) => operation === 'image-to-image' ? '图生图' : operation === 'inpaint' ? '局部重绘' : '扩图';

export const ImageEditPreview: React.FC<ImageEditPreviewProps> = ({
  operation, image, baseImage, onUseResultAsBase, error, generationCostLabel, isGenerating = false, generationProgress, isLoading = false,
  onGenerate, onOpenLightbox, getDownloadFilename, canNavigateHistory, historyLabel, onPreviousHistory, onNextHistory,
  canManageHistoryGroup, onRemoveCurrentHistory, onClearHistoryGroup,
}) => {
  // 图生图模式支持底图/结果 A/B 切换；仅当结果存在且与底图不同时才显示切换。
  const canCompare = operation === 'image-to-image' && Boolean(image) && Boolean(baseImage) && image !== baseImage;
  const [showBase, setShowBase] = useState(false);
  // 结果存在时优先显示结果；切换到底图则显示底图
  const displayedImage: string | null = canCompare && showBase ? (baseImage ?? null) : image;

  return (
    <div className="image-edit-preview-shell chain-editor-preview-wrapper order-1 hidden min-h-0 flex-1 lg:contents">
      {canCompare && (
        <div className="absolute left-4 top-4 z-20 flex gap-2">
          <button
            type="button"
            onClick={() => setShowBase(current => !current)}
            className="rounded-lg bg-black/60 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur transition hover:bg-black/75"
            title={showBase ? '当前显示底图，点击切换为生成结果' : '当前显示生成结果，点击切换为原始底图'}
          >
            {showBase ? '底图 · 点击看结果' : '结果 · 点击看底图'}
          </button>
          <button
            type="button"
            onClick={onUseResultAsBase}
            className="rounded-lg bg-indigo-600/90 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur transition hover:bg-indigo-600"
            title="把当前生成结果作为新一轮底图继续图生图"
          >
            以此为底图
          </button>
        </div>
      )}
      <ChainEditorPreview
        isGenerating={isGenerating}
        generationProgress={generationProgress}
        handleGenerate={onGenerate}
        errorMsg={error}
        generatedImage={displayedImage}
        previewImage={undefined}
        setLightboxImg={onOpenLightbox}
        isOwner={false}
        isUploading={false}
        handleSavePreview={() => undefined}
        handleUploadCover={() => undefined}
        getDownloadFilename={getDownloadFilename}
        hideCoverActions
        canNavigateHistory={canNavigateHistory}
        historyLabel={historyLabel}
        onPreviousHistory={onPreviousHistory}
        onNextHistory={onNextHistory}
        canManageHistoryGroup={canManageHistoryGroup}
        onRemoveCurrentHistory={onRemoveCurrentHistory}
        onClearHistoryGroup={onClearHistoryGroup}
        generationCostLabel={generationCostLabel}
        generateLabel={`生成${getOperationLabel(operation)}结果`}
        emptyLabel={operation === 'image-to-image' ? '在左侧「底图与导入」选择底图后生成' : '请先在左侧选择要编辑的底图'}
        resultAlt={`${getOperationLabel(operation)}预览`}
        showQueueStatus={false}
        generationDisabled={isLoading || !displayedImage}
        hideGenerateButtonOnMobile
      />
    </div>
  );
};
