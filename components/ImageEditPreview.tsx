import React from 'react';
import { ImageEditOperation } from '../types';
import { ChainEditorPreview } from './ChainEditorPreview';
import type { ImageGenerationData } from '../services/imageClipboardContext';

interface ImageEditPreviewProps {
  operation: ImageEditOperation;
  image: string | null;
  error: string | null;
  generationCostLabel: string;
  isGenerating?: boolean;
  generationProgress?: { step: number; total: number } | null;
  isLoading?: boolean;
  canGenerate?: boolean;
  generationDisabled?: boolean;
  unavailableLabel?: string;
  onGenerate: () => void;
  onOpenLightbox: (image: string | null) => void;
  getDownloadFilename: () => string;
  generationData?: ImageGenerationData;
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
  operation, image, error, generationCostLabel, isGenerating = false, generationProgress, isLoading = false,
  canGenerate, generationDisabled, unavailableLabel,
  onGenerate, onOpenLightbox, getDownloadFilename, generationData, canNavigateHistory, historyLabel, onPreviousHistory, onNextHistory,
  canManageHistoryGroup, onRemoveCurrentHistory, onClearHistoryGroup,
}) => {
  const isGenerationDisabled = generationDisabled !== undefined
    ? generationDisabled
    : isLoading || (canGenerate !== undefined ? !canGenerate : false);

  return (
    <div className="image-edit-preview-shell chain-editor-preview-wrapper order-1 hidden min-h-0 flex-1 lg:contents">
      <ChainEditorPreview
        isGenerating={isGenerating}
        generationProgress={generationProgress}
        handleGenerate={onGenerate}
        errorMsg={error}
        generatedImage={image}
        previewImage={undefined}
        setLightboxImg={onOpenLightbox}
        isOwner={false}
        isUploading={false}
        handleSavePreview={() => undefined}
        handleUploadCover={() => undefined}
        getDownloadFilename={getDownloadFilename}
        generationData={generationData}
        hideCoverActions
        canNavigateHistory={canNavigateHistory}
        historyLabel={historyLabel}
        onPreviousHistory={onPreviousHistory}
        onNextHistory={onNextHistory}
        canManageHistoryGroup={canManageHistoryGroup}
        onRemoveCurrentHistory={onRemoveCurrentHistory}
        onClearHistoryGroup={onClearHistoryGroup}
        generationCostLabel={generationCostLabel}
        unavailableLabel={unavailableLabel || (isLoading ? '画布加载中…' : isGenerationDisabled && !isGenerating ? '请先选择底图' : undefined)}
        emptyLabel="暂无生成结果"
        resultAlt={`${getOperationLabel(operation)}预览`}
        generationDisabled={isGenerationDisabled}
        hideGenerateButtonOnMobile
      />
    </div>
  );
};
