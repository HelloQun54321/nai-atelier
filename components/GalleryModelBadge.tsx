import React from 'react';
import { getNaiModelDisplayLabel } from '../services/naiModels';
import { t, useLanguage } from '../services/i18n';

/**
 * 卡片上的生成模型标识。所有图库卡片共用这一份，保证样式与落点一致：
 * 放在卡片信息栏最后一行右端，也就是视觉上的右下角。
 * 没有模型信息时返回 null，不留空位。
 */
export const GalleryModelBadge: React.FC<{ model?: string | null; className?: string }> = ({ model, className = '' }) => {
  useLanguage();
  // 与风格串原先的实现保持一致：没有记录模型时显示默认模型标签，而不是留空。
  const label = getNaiModelDisplayLabel(model?.trim() || undefined);
  return <span
    className={`gallery-card-badge inline-flex flex-shrink-0 items-center rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-micro font-medium text-violet-700 dark:border-violet-500/30 dark:bg-violet-950/40 dark:text-violet-300 ${className}`}
    title={t('生成模型')}
  >{label}</span>;
};
