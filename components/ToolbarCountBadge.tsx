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

/** 顶栏计数：贴着目录按钮显示上下两行的分数（分子为已加载、分母为总数），只有一个数字时就只显示它，不写字。 */
export const ToolbarCountBadge: React.FC<{ loaded?: number; total?: number; hint?: string; className?: string }> = ({ loaded, total, hint, className = '' }) => {
  useLanguage();
  const hasTotal = typeof total === 'number' && Number.isFinite(total);
  const hasLoaded = typeof loaded === 'number' && Number.isFinite(loaded);
  if (!hasTotal && !hasLoaded) return null;
  const fraction = hasLoaded && hasTotal && loaded !== total;
  const single = hasLoaded && hasTotal ? total : hasTotal ? total : loaded;
  const title = hint || (hasLoaded && hasTotal ? t('已加载 {0} / 共 {1}', [loaded, total]) : hasTotal ? t('共 {0}', [total]) : t('已加载 {0}', [loaded]));
  // 手机顶栏空间紧，不在文件夹旁常驻数字；电脑保留竖排「已加载／总数」徽标。
  return <span data-toolbar-count-badge="true" title={title} aria-label={title}
    className={`hidden flex-none select-none flex-col items-center justify-center font-semibold leading-none tabular-nums md:flex ${fraction ? 'text-micro' : 'text-xs'} text-gray-500 dark:text-gray-300 ${className}`}>
    {fraction ? <>
      <span>{compactCount(loaded as number)}</span>
      <span aria-hidden="true" className="my-[2px] h-px w-full bg-current opacity-40" />
      <span>{compactCount(total as number)}</span>
    </> : <span>{compactCount(single as number)}</span>}
  </span>;
};
