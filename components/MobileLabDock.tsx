import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Image as ImageIcon } from 'lucide-react';
import type { useAnlasBudget } from '../services/anlasBudget';
import type { useNovelaiUsage } from '../services/naiUsage';
import type { NaiRuntimeConfig } from '../services/naiRuntime';
import { GenerationCountControl, type GenerationCountControlProps } from './GenerationCountControl';
import { MobileGenerationResources } from './MobileGenerationResources';
import { SmartImage } from './SmartImage';

export interface MobileLabDockProps {
  apiKey: string;
  budget: Pick<ReturnType<typeof useAnlasBudget>, 'remaining' | 'loading'>;
  subscription: ReturnType<typeof useNovelaiUsage>;
  runtime: NaiRuntimeConfig | null;
  keyboardOffset?: number;
  previewImage?: string | null;
  errorMsg?: string | null;
  onOpenLightbox?: (src: string) => void;
  generation: GenerationCountControlProps;
}

/**
 * 手机实验室底栏：额度折叠格｜短生成｜右侧小图；预览带默认收起、点小图展开。
 * 电脑预览列与侧栏资源不变。
 */
export const MobileLabDock: React.FC<MobileLabDockProps> = ({
  apiKey, budget, subscription, runtime, keyboardOffset = 0, previewImage, errorMsg, onOpenLightbox, generation,
}) => {
  useLanguage();
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    if (keyboardOffset > 0) setPreviewOpen(false);
  }, [keyboardOffset]);

  const hasPreview = Boolean(previewImage);
  const togglePreview = () => {
    if (!hasPreview) return;
    setPreviewOpen(open => !open);
  };

  return (
    <div
      className="mobile-lab-dock mobile-generation-actions fixed inset-x-0 z-[900] flex flex-col md:hidden"
      style={keyboardOffset > 0
        ? { ['--mobile-generation-bottom' as string]: `calc(${keyboardOffset}px + env(safe-area-inset-bottom))` }
        : undefined}
      data-preview-open={previewOpen || undefined}
    >
      {previewOpen && hasPreview && previewImage && (
        <div className="appearance-panel border-b border-gray-200 bg-white/95 px-3 pb-2 pt-2 dark:border-gray-800 dark:bg-gray-950/95">
          <div className="mx-auto flex max-h-[min(40dvh,18rem)] max-w-sm flex-col items-center gap-2">
            <button
              type="button"
              className="mobile-touch appearance-media overflow-hidden rounded-xl border border-gray-200 bg-black/5 dark:border-gray-700 dark:bg-black/30"
              aria-label={t('查看当前预览图')}
              onClick={() => onOpenLightbox?.(previewImage)}
            >
              <SmartImage src={previewImage} alt={t('当前预览图')} className="max-h-[min(36dvh,16rem)] w-auto max-w-full object-contain" />
            </button>
            <button type="button" className="mobile-touch inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-500" onClick={() => setPreviewOpen(false)}>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />{t('收起预览')}
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div role="alert" className="mx-3 mb-1 max-h-[20dvh] overflow-y-auto rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-600 shadow-sm dark:border-red-900/60 dark:bg-red-950/80 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      <div className="appearance-panel flex h-[3.25rem] items-center gap-2 overflow-hidden border-t border-gray-200 bg-white/95 px-2 dark:border-gray-800 dark:bg-gray-950/95">
        <MobileGenerationResources
          variant="dock"
          apiKey={apiKey}
          budget={budget}
          subscription={subscription}
          runtime={runtime}
        />
        <div className="min-w-0 flex-1">
          <GenerationCountControl {...generation} layout="dock" />
        </div>
        <button
          type="button"
          disabled={!hasPreview}
          aria-expanded={previewOpen}
          aria-label={hasPreview ? t(previewOpen ? '收起预览' : '展开预览') : t('暂无预览图')}
          onClick={togglePreview}
          className={`appearance-media mobile-touch relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border ${hasPreview ? 'border-gray-300 bg-gray-900 dark:border-gray-600' : 'border-dashed border-gray-300 bg-gray-50 text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500'}`}
        >
          {hasPreview && previewImage
            ? <SmartImage src={previewImage} alt="" className="h-full w-full object-cover" />
            : <ImageIcon className="h-4 w-4" aria-hidden="true" />}
          {hasPreview && !previewOpen && (
            <span className="absolute bottom-0.5 right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/55 text-white">
              <ChevronUp className="h-2.5 w-2.5" aria-hidden="true" />
            </span>
          )}
        </button>
      </div>
    </div>
  );
};
