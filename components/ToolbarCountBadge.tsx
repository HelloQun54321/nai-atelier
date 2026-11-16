import React from 'react';
import { t, useLanguage } from '../services/i18n';

/** 大数字只留概数：统一用 k／M，避免顶栏被一长串数字撑开。 */
export const compactCount = (value: number) => {
  const trim = (input: number) => input.toFixed(input >= 100 ? 0 : 1).replace(/\.0$/, '');
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(value / 1_000)}k`;
  return String(value);
};

/** 顶栏计数：贴着目录按钮显示「已加载/总数」，只有一个数字时就只显示它，不写字。 */
export const ToolbarCountBadge: React.FC<{ loaded?: number; total?: number; hint?: string; className?: string }> = ({ loaded, total, hint, className = '' }) => {
  useLanguage();
  const hasTotal = typeof total === 'number' && Number.isFinite(total);
  const hasLoaded = typeof loaded === 'number' && Number.isFinite(loaded);
  if (!hasTotal && !hasLoaded) return null;
  const text = hasLoaded && hasTotal ? (loaded === total ? compactCount(total) : `${compactCount(loaded)}/${compactCount(total)}`) : compactCount((hasTotal ? total : loaded) as number);
  const title = hint || (hasLoaded && hasTotal ? t('已加载 {0} / 共 {1}', [loaded, total]) : hasTotal ? t('共 {0}', [total]) : t('已加载 {0}', [loaded]));
  return <span data-toolbar-count-badge="true" title={title} aria-label={title}
    className={`flex-none select-none rounded-md bg-gray-500/10 px-1.5 py-0.5 text-micro font-semibold leading-none tabular-nums text-gray-500 dark:bg-gray-100/10 dark:text-gray-300 ${className}`}>{text}</span>;
};
