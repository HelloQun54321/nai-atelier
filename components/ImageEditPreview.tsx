import React from 'react';
import { ImageEditOperation } from '../types';
import { ImageEditCanvas, ImageEditCanvasProps } from './ImageEditCanvas';

interface ImageEditPreviewProps extends ImageEditCanvasProps {
  operation: ImageEditOperation;
  baseImage: string | null;
  error: string | null;
  generationCostLabel: string;
  isGenerating?: boolean;
  onGenerate: () => void;
}

const getOperationLabel = (operation: ImageEditOperation) => operation === 'image-to-image' ? '图生图' : operation === 'inpaint' ? '局部重绘' : '扩图';

export const ImageEditPreview: React.FC<ImageEditPreviewProps> = ({ operation, baseImage, error, generationCostLabel, isGenerating = false, onGenerate, ...canvasProps }) => (
  <div className="chain-editor-preview-wrapper order-1 flex min-h-0 flex-1 lg:contents">
    <div className="chain-editor-preview order-1 flex min-h-0 w-full shrink-0 flex-1 flex-col border-b border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-black/20 lg:order-2 lg:w-1/2 lg:border-b-0">
      <div className="flex min-h-[400px] flex-1 flex-col overflow-hidden p-4 md:p-6">
        <ImageEditCanvas {...canvasProps} />
        {error && <div role="alert" className="mt-3 w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
        <div className="mt-4 flex flex-none flex-col items-center">
          <div className="mb-2 text-xs text-gray-500 dark:text-gray-400">{getOperationLabel(operation)} · 结果会保存为新的历史图片</div>
        <button type="button" onClick={onGenerate} disabled={canvasProps.isLoading || isGenerating || !baseImage} className={`generation-action-button flex h-11 w-full max-w-xs items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 ${isGenerating ? 'generation-action-button--loading' : ''}`}><span>{isGenerating ? '编辑生成中…' : '生成编辑结果'}</span>{!isGenerating && <span className="generation-action-button__cost">{generationCostLabel}</span>}</button>
        </div>
      </div>
    </div>
  </div>
);
