import { t, useLanguage } from '../services/i18n';
import React from 'react';
import { ImageEditOperation } from '../types';
import { ChainEditorPreview } from './ChainEditorPreview';
import type { CollectionTarget } from '../services/collectionFavorites';
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
  favorite?: CollectionTarget;
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
  onGenerate, onOpenLightbox, getDownloadFilename, generationData, favorite, canNavigateHistory, historyLabel, onPreviousHistory, onNextHistory,
  canManageHistoryGroup, onRemoveCurrentHistory, onClearHistoryGroup,
}) => {
  useLanguage();
  const isGenerationDisabled = generationDisabled !== undefined
    ? generationDisabled
    : isLoading || (canGenerate !== undefined ? !canGenerate : false);

  return (
    <div className="image-edit-preview-shell chain-editor-preview-wrapper order-1 hidden min-h-0 flex-1 lg:contents">
      <ChainEditorPreview
        isGenerating={isGenerating}
        generationProgress={generationProgress}
        handleGenerate={onGenerate}
        errorMsg={t(error)}
        generatedImage={image}
        previewImage={undefined}
        setLightboxImg={onOpenLightbox}
        isOwner={false}
        isUploading={false}
        handleSavePreview={() => undefined}
        handleUploadCover={() => undefined}
        getDownloadFilename={getDownloadFilename}
        generationData={generationData} favorite={favorite}
        hideCoverActions
        canNavigateHistory={canNavigateHistory}
        historyLabel={historyLabel}
        onPreviousHistory={onPreviousHistory}
        onNextHistory={onNextHistory}
        canManageHistoryGroup={canManageHistoryGroup}
        onRemoveCurrentHistory={onRemoveCurrentHistory}
        onClearHistoryGroup={onClearHistoryGroup}
        generationCostLabel={generationCostLabel}
        unavailableLabel={unavailableLabel || (isLoading ? t("画布加载中…") : isGenerationDisabled && !isGenerating ? t("请先选择底图") : undefined)}
        emptyLabel={t("暂无生成结果")}
        resultAlt={t("{0}预览", [getOperationLabel(operation)])}
        generationDisabled={isGenerationDisabled}
        hideGenerateButtonOnMobile
      />
    </div>
  );
};
