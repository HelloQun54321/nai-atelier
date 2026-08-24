import React from 'react';
import { ImageEditOperation } from '../types';
import { ChainEditorPreview } from './ChainEditorPreview';

interface ImageEditPreviewProps {
  operation: ImageEditOperation;
  image: string | null;
  error: string | null;
  generationCostLabel: string;
  isGenerating?: boolean;
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

export const ImageEditPreview: React.FC<ImageEditPreviewProps> = ({ operation, image, error, generationCostLabel, isGenerating = false, isLoading = false, onGenerate, onOpenLightbox, getDownloadFilename, canNavigateHistory, historyLabel, onPreviousHistory, onNextHistory, canManageHistoryGroup, onRemoveCurrentHistory, onClearHistoryGroup }) => (
  <div className="chain-editor-preview-wrapper order-1 flex min-h-0 flex-1 lg:contents">
    <ChainEditorPreview
      isGenerating={isGenerating}
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
      emptyLabel="请先在左侧选择要编辑的底图"
      resultAlt={`${getOperationLabel(operation)}预览`}
      showQueueStatus={false}
      generationDisabled={isLoading || !image}
    />
  </div>
);
